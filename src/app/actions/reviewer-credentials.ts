"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { REVIEWER_QUALIFICATIONS, CREDENTIAL_STATUSES } from "@/lib/tax-desk/reviewer";

/**
 * Reviewer credential management (K.2.8.9B). ADMIN ONLY — enforced here by
 * requireAdmin AND in the guarded RPCs (app.is_admin()). Credential-sensitive
 * fields (the registration/membership reference) are only ever written; they are
 * never returned to ordinary staff (admin-only RLS + reference-free views).
 */

type ActionResult = { ok: boolean; error?: string };

const QUAL_CODES = REVIEWER_QUALIFICATIONS.map((q) => q.code) as [string, ...string[]];

const upsertSchema = z.object({
  userId: z.string().uuid(),
  qualification: z.enum(QUAL_CODES),
  credentialReference: z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z.string().trim().max(120, "Keep the reference under 120 characters.").optional(),
  ),
  notes: z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z.string().trim().max(500).optional(),
  ),
});

const statusSchema = z.object({
  credentialId: z.string().uuid(),
  status: z.enum(CREDENTIAL_STATUSES as unknown as [string, ...string[]]),
  reason: z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z.string().trim().max(500).optional(),
  ),
});

function revalidate() {
  revalidatePath("/settings/reviewers");
}

/** Create or update a reviewer credential (qualification + reference). */
export async function upsertReviewerCredentialAction(input: unknown): Promise<ActionResult> {
  await requireAdmin();
  const parsed = upsertSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const supabase = await createServerClient();
  const { error } = await supabase.rpc("upsert_reviewer_credential", {
    p_user_id: d.userId,
    p_qualification: d.qualification,
    p_reference: d.credentialReference ?? null,
    p_notes: d.notes ?? null,
    p_event_id: crypto.randomUUID(),
  });
  if (error) {
    if (/active team member/i.test(error.message ?? "")) {
      return { ok: false, error: "The selected user is not an active team member." };
    }
    return { ok: false, error: "Could not save the reviewer credential." };
  }

  revalidate();
  return { ok: true };
}

/** Activate / deactivate / revoke a reviewer credential. */
export async function setReviewerCredentialStatusAction(input: unknown): Promise<ActionResult> {
  await requireAdmin();
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  if (d.status === "revoked" && !d.reason) {
    return { ok: false, error: "A reason is required to revoke a credential." };
  }

  const supabase = await createServerClient();
  const { error } = await supabase.rpc("set_reviewer_credential_status", {
    p_credential_id: d.credentialId,
    p_status: d.status,
    p_reason: d.reason ?? null,
    p_event_id: crypto.randomUUID(),
  });
  if (error) {
    if (/not found/i.test(error.message ?? "")) return { ok: false, error: "Reviewer credential not found." };
    return { ok: false, error: "Could not update the credential status." };
  }

  revalidate();
  return { ok: true };
}
