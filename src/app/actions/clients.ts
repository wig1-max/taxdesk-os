"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { encryptPan, panLast4 } from "@/lib/crypto/pan";
import { isUniqueViolation, nextClientCode } from "@/lib/display-code";
import {
  resolveClientWriteResult,
  type ClientWriteResult,
} from "@/lib/pan-write-plan";
import {
  clientSearchLabel,
  CLIENT_SEARCH_LIMIT,
  type ClientSearchOption,
} from "@/lib/clients/client-search";
import { escapeLikePattern } from "@/lib/sql-like";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { clientInputSchema } from "@/lib/validation";
import { panSchema } from "@/lib/validation/common";

/** base64 GCM payload -> PostgREST bytea hex literal. */
function panBytea(payloadB64: string): string {
  return "\\x" + Buffer.from(payloadB64, "base64").toString("hex");
}

function nonPanRow(d: ReturnType<typeof clientInputSchema.parse>) {
  return {
    full_name: d.full_name,
    primary_phone: d.primary_phone,
    email: d.email || null,
    date_of_birth: d.date_of_birth || null,
    address_line1: d.address_line1 || null,
    address_line2: d.address_line2 || null,
    city: d.city || null,
    state: d.state || null,
    pincode: d.pincode || null,
    kyc_status: d.kyc_status,
    notes: d.notes || null,
  };
}

/**
 * Appendix C6: create is ONE operation. With PAN -> a single
 * service-role INSERT containing the row + both PAN columns
 * (atomic by construction). Without PAN -> session client (RLS).
 */
export async function createClientAction(input: unknown): Promise<ClientWriteResult> {
  const user = await requireUser();
  const parsed = clientInputSchema.safeParse(input);
  if (!parsed.success) {
    return resolveClientWriteResult({
      rowSaved: false,
      panRequested: false,
      panWriteOk: false,
      rowErrorMsg: parsed.error.issues[0]?.message ?? "Invalid input.",
    });
  }
  const d = parsed.data;
  const pan = d.pan ? d.pan : undefined;

  for (let attempt = 0; attempt < 3; attempt++) {
    const display_code = await nextClientCode();
    const base = { ...nonPanRow(d), display_code, created_by: user.id };

    if (pan) {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("clients")
        .insert({
          ...base,
          pan_encrypted: panBytea(encryptPan(pan)),
          pan_last4: panLast4(pan),
        })
        .select("id")
        .single();
      if (error) {
        if (isUniqueViolation(error)) continue; // display-code race, retry
        return resolveClientWriteResult({
          rowSaved: false,
          panRequested: true,
          panWriteOk: false,
          rowErrorMsg: "Could not save client. Nothing was stored (PAN included).",
        });
      }
      await audit({
        actor: user,
        action: "client.created_with_pan",
        entityType: "clients",
        entityId: data.id,
        after: { ...base, pan_last4: panLast4(pan) },
      });
      revalidatePath("/clients");
      return resolveClientWriteResult({
        rowSaved: true,
        clientId: data.id,
        panRequested: true,
        panWriteOk: true,
      });
    }

    const supabase = await createServerClient();
    const { data, error } = await supabase
      .from("clients")
      .insert(base)
      .select("id")
      .single();
    if (error) {
      if (isUniqueViolation(error)) continue;
      return resolveClientWriteResult({
        rowSaved: false,
        panRequested: false,
        panWriteOk: false,
        rowErrorMsg: "Could not save client.",
      });
    }
    await audit({
      actor: user,
      action: "client.created",
      entityType: "clients",
      entityId: data.id,
      after: base,
    });
    revalidatePath("/clients");
    return resolveClientWriteResult({
      rowSaved: true,
      clientId: data.id,
      panRequested: false,
      panWriteOk: false,
    });
  }

  return resolveClientWriteResult({
    rowSaved: false,
    panRequested: !!pan,
    panWriteOk: false,
    rowErrorMsg: "Could not allocate a client code. Please retry.",
  });
}

/** Update mirrors create: PAN present -> single service-role UPDATE. */
export async function updateClientAction(
  clientId: string,
  input: unknown
): Promise<ClientWriteResult> {
  const user = await requireUser();
  const parsed = clientInputSchema.safeParse(input);
  if (!parsed.success) {
    return resolveClientWriteResult({
      rowSaved: false,
      panRequested: false,
      panWriteOk: false,
      rowErrorMsg: parsed.error.issues[0]?.message ?? "Invalid input.",
    });
  }
  const d = parsed.data;
  const pan = d.pan ? d.pan : undefined;

  const supabase = await createServerClient();
  const { data: before } = await supabase
    .from("clients_safe")
    .select("*")
    .eq("id", clientId)
    .maybeSingle();
  if (!before) {
    return resolveClientWriteResult({
      rowSaved: false,
      panRequested: !!pan,
      panWriteOk: false,
      rowErrorMsg: "Client not found.",
    });
  }

  if (pan) {
    const admin = createAdminClient();
    const { error } = await admin
      .from("clients")
      .update({
        ...nonPanRow(d),
        pan_encrypted: panBytea(encryptPan(pan)),
        pan_last4: panLast4(pan),
      })
      .eq("id", clientId);
    if (error) {
      return resolveClientWriteResult({
        rowSaved: false,
        panRequested: true,
        panWriteOk: false,
        rowErrorMsg: "Update failed. Nothing was changed (PAN included).",
      });
    }
    await audit({
      actor: user,
      action: "client.updated_with_pan",
      entityType: "clients",
      entityId: clientId,
      before,
      after: { ...nonPanRow(d), pan_last4: panLast4(pan) },
    });
    revalidatePath(`/clients/${clientId}`);
    return resolveClientWriteResult({
      rowSaved: true,
      clientId,
      panRequested: true,
      panWriteOk: true,
    });
  }

  const { error } = await supabase.from("clients").update(nonPanRow(d)).eq("id", clientId);
  if (error) {
    return resolveClientWriteResult({
      rowSaved: false,
      panRequested: false,
      panWriteOk: false,
      rowErrorMsg: "Update failed.",
    });
  }
  await audit({
    actor: user,
    action: "client.updated",
    entityType: "clients",
    entityId: clientId,
    before,
    after: nonPanRow(d),
  });
  revalidatePath(`/clients/${clientId}`);
  return resolveClientWriteResult({
    rowSaved: true,
    clientId,
    panRequested: false,
    panWriteOk: false,
  });
}

/**
 * Dedicated PAN set/retry path (contract C6). Staff-permitted.
 * Failure is audited as client.pan_write_failed.
 */
export async function setClientPanAction(
  clientId: string,
  panInput: string
): Promise<ClientWriteResult> {
  const user = await requireUser();
  const parsed = panSchema.safeParse(panInput);
  if (!parsed.success) {
    return resolveClientWriteResult({
      rowSaved: true,
      clientId,
      panRequested: true,
      panWriteOk: false,
      panErrorMsg: "Invalid PAN format (ABCDE1234F).",
    });
  }
  const pan = parsed.data;

  const admin = createAdminClient();
  const { error, data } = await admin
    .from("clients")
    .update({
      pan_encrypted: panBytea(encryptPan(pan)),
      pan_last4: panLast4(pan),
    })
    .eq("id", clientId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    await audit({
      actor: user,
      action: "client.pan_write_failed",
      entityType: "clients",
      entityId: clientId,
      after: { error: error?.message ?? "client not found" },
    });
    return resolveClientWriteResult({
      rowSaved: true,
      clientId,
      panRequested: true,
      panWriteOk: false,
      panErrorMsg: "PAN could not be saved. Please retry.",
    });
  }

  await audit({
    actor: user,
    action: "client.pan_updated",
    entityType: "clients",
    entityId: clientId,
    after: { pan_last4: panLast4(pan) },
  });
  revalidatePath(`/clients/${clientId}`);
  return resolveClientWriteResult({
    rowSaved: true,
    clientId,
    panRequested: true,
    panWriteOk: true,
  });
}

/** Admin-only, audited, returns the value once. Never cached. */
export async function revealClientPanAction(
  clientId: string,
  reason: string
): Promise<{ ok: boolean; pan?: string; error?: string }> {
  const user = await requireAdmin();
  if (!reason.trim()) return { ok: false, error: "A reason is required to reveal a PAN." };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("clients")
    .select("pan_encrypted")
    .eq("id", clientId)
    .maybeSingle();
  if (error || !data?.pan_encrypted) {
    return { ok: false, error: "No PAN stored for this client." };
  }

  // PostgREST returns bytea as "\x<hex>"
  const hex = String(data.pan_encrypted).replace(/^\\x/, "");
  let pan: string;
  try {
    const { decryptPan } = await import("@/lib/crypto/pan");
    pan = decryptPan(Buffer.from(hex, "hex").toString("base64"));
  } catch {
    return { ok: false, error: "Stored PAN could not be decrypted. Check PAN_ENCRYPTION_KEY." };
  }

  await audit({
    actor: user,
    action: "client.pan_revealed",
    entityType: "clients",
    entityId: clientId,
    after: { reason: reason.trim() },
  });
  return { ok: true, pan };
}

export async function softDeleteClientAction(clientId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireAdmin();
  const supabase = await createServerClient();
  const { error } = await supabase
    .from("clients")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", clientId);
  if (error) return { ok: false, error: "Delete failed." };
  await audit({
    actor: user,
    action: "client.soft_deleted",
    entityType: "clients",
    entityId: clientId,
  });
  revalidatePath("/clients");
  return { ok: true };
}

/**
 * Search clients for the New Case picker (`K3-ENV-4`).
 *
 * Replaces the old "first 500 clients ordered by name" dropdown, which silently
 * hid every client outside that window — an office with more than 500 clients
 * simply could not select the newer ones, and the E2E suite hit the same wall.
 * Searching server-side removes the cap as a correctness factor entirely.
 *
 * Reads `clients_safe` (the PII-safe view — never the PAN ciphertext) through
 * the REQUEST-scoped client, so RLS applies exactly as it does elsewhere; this
 * is deliberately not the service-role client. Soft-deleted clients are
 * excluded, matching the previous behaviour.
 *
 * The term is matched against name and phone with two separate `ilike` filters
 * rather than one `or(...)` string: PostgREST parses `or` as a filter
 * expression, so interpolating raw user input there is a filter-injection seam.
 * `%` and `_` are escaped so a typed wildcard is treated as a literal character.
 */
export async function searchClientsAction(term: string): Promise<ClientSearchOption[]> {
  await requireUser();
  const supabase = await createServerClient();
  const q = term.trim();

  const base = () =>
    supabase
      .from("clients_safe")
      .select("id, full_name, primary_phone")
      .is("deleted_at", null)
      .order("full_name")
      .limit(CLIENT_SEARCH_LIMIT);

  if (q === "") {
    const { data } = await base();
    return toOptions(data);
  }

  const pattern = `%${escapeLikePattern(q)}%`;
  const [byName, byPhone] = await Promise.all([
    base().ilike("full_name", pattern),
    base().ilike("primary_phone", pattern),
  ]);

  const merged = [...toOptions(byName.data), ...toOptions(byPhone.data)];
  const seen = new Set<string>();
  const unique = merged.filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)));
  unique.sort((a, b) => a.label.localeCompare(b.label));
  return unique.slice(0, CLIENT_SEARCH_LIMIT);
}

function toOptions(
  rows: { id: string; full_name: string; primary_phone: string }[] | null,
): ClientSearchOption[] {
  return (rows ?? []).map((c) => ({ id: c.id, label: clientSearchLabel(c) }));
}
