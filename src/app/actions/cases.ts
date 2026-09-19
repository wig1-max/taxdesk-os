"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { isUniqueViolation, nextCaseCode } from "@/lib/display-code";
import {
  checkTransition,
  defaultNextAction,
  isTerminal,
  type TransitionContext,
} from "@/lib/status-flow";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { StatusFlow } from "@/lib/db/types";
import { caseCreateSchema } from "@/lib/validation";
import { validateServiceData } from "@/lib/validation/service-data";

type ActionResult = { ok: boolean; caseId?: string; error?: string };

export async function createCaseAction(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = caseCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;

  const svcData = validateServiceData(d.service_code, d.service_data);
  if (!svcData.success) return { ok: false, error: svcData.error };

  const supabase = await createServerClient();
  const { data: service } = await supabase
    .from("services")
    .select("id, code, name, status_flow, default_fee_config")
    .eq("code", d.service_code)
    .eq("is_active", true)
    .maybeSingle();
  if (!service) return { ok: false, error: "Unknown service." };

  const flow = service.status_flow as StatusFlow;
  const ay = d.service_code === "itr" ? (svcData.data.ay as string | undefined) : undefined;

  let caseId: string | null = null;
  let displayCode = "";
  for (let attempt = 0; attempt < 3 && !caseId; attempt++) {
    displayCode = await nextCaseCode(d.service_code, ay);
    const { data, error } = await supabase
      .from("cases")
      .insert({
        display_code: displayCode,
        client_id: d.client_id,
        service_id: service.id,
        title: d.title || service.name,
        status: flow.initial,
        next_action: defaultNextAction(flow, flow.initial),
        next_action_due: null,
        owner_id: d.owner_id,
        priority: d.priority,
        lead_source: d.lead_source ?? null,
        service_data: svcData.data,
      })
      .select("id")
      .single();
    if (error) {
      if (isUniqueViolation(error)) continue;
      return { ok: false, error: "Could not create case." };
    }
    caseId = data.id;
  }
  if (!caseId) return { ok: false, error: "Could not allocate a case code. Please retry." };

  // Instantiate the service checklist.
  const { data: reqs } = await supabase
    .from("document_requirements")
    .select("id, name, is_required")
    .eq("service_id", service.id)
    .eq("is_active", true);
  if (reqs && reqs.length > 0) {
    await supabase.from("case_documents").insert(
      reqs.map((r) => ({
        case_id: caseId,
        requirement_id: r.id,
        name: r.name,
        is_required: r.is_required,
      }))
    );
  }

  // IEPF extras: identity review shell + default fee row.
  if (d.service_code === "iepf") {
    await supabase.from("identity_reviews").insert({ case_id: caseId });
    const cfg = (service.default_fee_config ?? {}) as { percent?: number; upfront?: number };
    await supabase.from("fees").insert({
      case_id: caseId,
      fee_type: "percent_of_recovery",
      description: "IEPF recovery fee",
      percent: cfg.percent ?? 15,
      upfront_amount: cfg.upfront ?? 5000,
      estimated_claim_value: (svcData.data.estimated_claim_value as number | undefined) ?? null,
      confidence: (svcData.data.confidence as string | undefined) ?? "medium",
      expected_closure_month:
        (svcData.data.expected_closure_month as string | undefined) ?? null,
      status: "draft",
    });
  }

  // History is service-role only (authenticated INSERT revoked in K.2.8.8B).
  const admin = createAdminClient();
  await admin.from("case_status_history").insert({
    case_id: caseId,
    from_status: null,
    to_status: flow.initial,
    reason: "Case created",
    changed_by: user.id,
  });

  await audit({
    actor: user,
    action: "case.created",
    entityType: "cases",
    entityId: caseId,
    caseId,
    after: { display_code: displayCode, service: service.code, status: flow.initial },
  });

  revalidatePath("/cases");
  return { ok: true, caseId };
}

/**
 * THE single choke point for status changes. Loads guard context,
 * delegates the decision to lib/status-flow.checkTransition, then
 * writes status + history + audit.
 */
export async function transitionCaseAction(args: {
  caseId: string;
  toStatus: string;
  reason?: string;
  confirmedManualAction?: boolean;
  nextActionOverride?: string;
  nextActionDue?: string;
}): Promise<ActionResult> {
  const user = await requireUser();
  const supabase = await createServerClient();

  const { data: kase } = await supabase
    .from("cases")
    .select("id, status, service_id, on_hold_reason, services(code, status_flow, default_fee_config)")
    .eq("id", args.caseId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!kase) return { ok: false, error: "Case not found." };

  const service = kase.services as unknown as {
    code: string;
    status_flow: StatusFlow;
    default_fee_config: { upfront?: number } | null;
  };
  const flow = service.status_flow;

  // Build guard context (IEPF needs real data).
  const ctx: TransitionContext = {
    isAdmin: user.role === "admin",
    reason: args.reason,
    confirmedManualAction: args.confirmedManualAction,
  };

  if (service.code === "iepf") {
    const [{ data: idr }, { data: docs }, { data: balances }] = await Promise.all([
      supabase
        .from("identity_reviews_completeness")
        .select("is_complete")
        .eq("case_id", args.caseId)
        .maybeSingle(),
      supabase
        .from("case_documents")
        .select("status, document_requirements(code)")
        .eq("case_id", args.caseId),
      supabase
        .from("fee_balances")
        .select("balance_fee_due, payments_received")
        .eq("case_id", args.caseId),
    ]);

    const verified = (code: string) =>
      (docs ?? []).some(
        (cd) =>
          (cd.document_requirements as unknown as { code: string } | null)?.code === code &&
          cd.status === "verified"
      );
    ctx.identityReviewComplete = idr?.is_complete === true;
    ctx.authorizationVerified = verified("authorization_letter");
    ctx.feeAgreementVerified = verified("fee_agreement");
    ctx.upfrontPaidTotal = (balances ?? []).reduce(
      (s, b) => s + Number(b.payments_received ?? 0),
      0
    );
    ctx.requiredUpfront = service.default_fee_config?.upfront ?? 5000;
    ctx.balanceFeeDue = (balances ?? []).reduce(
      (s, b) => s + Number(b.balance_fee_due ?? 0),
      0
    );
  }

  const check = checkTransition(flow, service.code, kase.status, args.toStatus, ctx);
  if (!check.ok) return { ok: false, error: check.error };

  // Apply the vetted decision through the guarded transactional RPC: it
  // re-checks role + current state + target validity + manual-filing
  // confirmation, and writes cases.status + case_status_history + audit
  // atomically as the least-privilege app_writer role (K.2.8.8B). Direct
  // authenticated writes to cases.status / case_status_history are revoked.
  const hold = flow.hold ?? "on_hold";
  const { error } = await supabase.rpc("transition_case_status", {
    p_case_id: args.caseId,
    p_from_status: kase.status,
    p_to_status: args.toStatus,
    p_reason: args.reason?.trim() || null,
    p_confirmed_manual: !!args.confirmedManualAction,
    p_next_action: args.nextActionOverride?.trim() || defaultNextAction(flow, args.toStatus),
    p_next_action_due: args.nextActionDue || null,
    p_on_hold_reason: args.toStatus === hold ? (args.reason?.trim() || null) : null,
    p_completed: isTerminal(flow, args.toStatus),
    p_event_id: crypto.randomUUID(),
  });
  if (error) return { ok: false, error: "Status update failed." };

  revalidatePath(`/cases/${args.caseId}`);
  revalidatePath("/dashboard");
  return { ok: true, caseId: args.caseId };
}
