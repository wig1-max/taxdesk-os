"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { createClient as createServerClient } from "@/lib/supabase/server";

type Result = { ok: boolean; error?: string };

/**
 * Logs a composed message when staff copy it for WhatsApp.
 * NOTHING is sent automatically — copy-paste only, by design.
 */
export async function logCopiedMessageAction(args: {
  caseId: string;
  templateId: string | null;
  renderedBody: string;
}): Promise<Result> {
  const user = await requireUser();
  const body = args.renderedBody.trim();
  if (!body) return { ok: false, error: "Nothing to log." };
  if (body.length > 4000) return { ok: false, error: "Message too long." };

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("case_messages")
    .insert({
      case_id: args.caseId,
      template_id: args.templateId,
      rendered_body: body,
      copied_at: new Date().toISOString(),
      composed_by: user.id,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: "Could not log message." };

  await audit({
    actor: user,
    action: "message.copied",
    entityType: "case_messages",
    entityId: data.id,
    caseId: args.caseId,
    after: { template_id: args.templateId, length: body.length },
  });

  revalidatePath(`/cases/${args.caseId}/messages`);
  return { ok: true };
}

/**
 * Builds the variable map for a case's message templates.
 * Server-side (RLS applies); returns plain strings only.
 */
export async function getCaseMessageVariables(
  caseId: string
): Promise<Record<string, string>> {
  await requireUser();
  const supabase = await createServerClient();

  const [{ data: kase }, { data: pendingDocs }, { data: balances }, { data: settings }] =
    await Promise.all([
      supabase
        .from("cases")
        .select(
          "id, display_code, next_action, service_data, clients:client_id(full_name), services(name, code)"
        )
        .eq("id", caseId)
        .is("deleted_at", null)
        .maybeSingle(),
      supabase
        .from("case_documents")
        .select("name, status, is_required")
        .eq("case_id", caseId)
        .is("deleted_at", null),
      supabase.from("fee_balances").select("balance_fee_due, effective_total").eq("case_id", caseId),
      supabase.from("settings").select("key, value").in("key", ["company_profile", "upload_link_defaults"]),
    ]);

  if (!kase) return {};

  const client = kase.clients as unknown as { full_name: string };
  const service = kase.services as unknown as { name: string; code: string };
  const sd = (kase.service_data ?? {}) as Record<string, unknown>;

  const pending = (pendingDocs ?? [])
    .filter((d) => (d.status === "pending" || d.status === "requested") && d.is_required)
    .map((d) => d.name);
  const allRequired = (pendingDocs ?? []).filter((d) => d.is_required).map((d) => d.name);
  const balance = (balances ?? []).reduce((s, b) => s + Number(b.balance_fee_due ?? 0), 0);

  const defaults = new Map((settings ?? []).map((s) => [s.key, s.value as Record<string, unknown>]));
  const expiryHours = String(
    (defaults.get("upload_link_defaults")?.default_expiry_hours as number | undefined) ?? 72
  );

  const inrPlain = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

  return {
    client_name: client.full_name.split(" ")[0] ?? client.full_name,
    service_name: service.name,
    case_code: kase.display_code ?? "",
    document_list: allRequired.join(", "),
    pending_list: pending.join(", "),
    expiry_hours: expiryHours,
    // upload_link intentionally NOT auto-filled: raw tokens are shown
    // once at creation and never stored. Staff paste the fresh link.
    balance_amount: balance > 0 ? inrPlain(balance) : "",
    recovered_value:
      sd.estimated_claim_value != null ? inrPlain(Number(sd.estimated_claim_value)) : "",
    srn: sd.srn != null ? String(sd.srn) : "",
    next_step: kase.next_action ?? "",
    amount: "", // staff fill for upfront requests
    payment_details: "", // staff fill (kept out of DB config for v1)
    reference: "",
    objection_summary: "",
    required_from_client: "",
  };
}
