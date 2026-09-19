"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { getTaxCaseEligibility } from "@/lib/queries/tax-eligibility";
import { computationWithheld } from "@/lib/tax-desk/eligibility";
import {
  evaluateHouseSaleLtcgRisk,
  evaluateRebateMarginalReliefRisk,
  evaluateSurchargeMarginalReliefRisk,
  snapshotHasHouseSaleLtcg,
  totalIncomeForSurchargeApplicability,
} from "@/lib/tax-desk/tax-capability";
import type { SessionUser } from "@/lib/auth";
import {
  approvalMethodSchema,
  approvalReferenceSchema,
  changesSummarySchema,
} from "@/lib/validation/tax-case";
import { checkCaseNotFinalized } from "@/lib/tax-desk-server/finalization";

/**
 * Client Review Pack actions (K.2.7). STAFF-ONLY (RLS on tax_cases enforces
 * staff/admin via the session client). Every action is snapshot-bound:
 * approval is recorded against ONE immutable computation snapshot and never
 * silently carried to a newer one.
 *
 * PREPARATION-ONLY. No email/WhatsApp is sent; "mark sent" and "capture
 * approval" only RECORD that a staff member did so. Approval-reference and
 * changes-summary text is screened + length-capped and is NEVER written to
 * audit metadata.
 */

type ActionResult = { ok: boolean; error?: string };

const idSchema = z.object({ taxCaseId: z.string().uuid() });

interface ReviewCaseState {
  taxCaseId: string;
  caseId: string;
  finalized: boolean;
  status: string;
  reviewSnapshotId: string | null;
  latestCompleteSnapshotId: string | null;
  latestCompleteRulesVersion: string | null;
  latestCompleteTotalIncome: number | null;
  /** K4-11 — the snapshot's own `computation.surchargeTreatmentSupported`.
   *  `undefined` for a pre-K4-11 snapshot, which fails closed. */
  latestCompleteSurchargeSupported: boolean | undefined;
  /** K4-12 — the snapshot's own NEW-regime total income and section 87A
   *  verdict. `undefined` for a pre-K4-12 snapshot, which fails closed inside
   *  the relief window. */
  latestCompleteNewRegimeTotalIncome: number | null;
  latestCompleteRebateReliefSupported: boolean | undefined;
  /** K4-23 review F1 — the snapshot's own s.112 house-sale verdict, and
   *  whether such a gain is present. Absent on a pre-K4-23 snapshot,
   *  which cannot carry one, so absence blocks nothing there. */
  latestCompleteHouseSaleLtcgSupported: boolean | undefined;
  latestCompleteHasHouseSaleLtcg: boolean;
  openErrorCount: number;
}

/** Load the minimal state every guard needs. Returns null when not found. */
async function loadReviewCase(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  taxCaseId: string,
): Promise<ReviewCaseState | null> {
  const { data: tc } = await supabase
    .from("tax_cases")
    .select("id, case_id, finalized_at, client_review_status, client_review_snapshot_id")
    .eq("id", taxCaseId)
    .maybeSingle();
  if (!tc) return null;

  const [{ data: snaps }, { count: openErrorCount }] = await Promise.all([
    supabase
      .from("tax_computation_snapshots")
      .select("id, rules_version, input_snapshot, output_snapshot, created_at")
      .eq("tax_case_id", taxCaseId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("tax_validation_findings")
      .select("id", { count: "exact", head: true })
      .eq("tax_case_id", taxCaseId)
      .eq("status", "open")
      .in("severity", ["error", "blocker"]),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const latestComplete = ((snaps ?? []) as any[]).find(
    (s) => (s.input_snapshot ?? {})?.complete === true,
  );

  // TAX-SAFE-01 / TAX-SAFE-01A: read BOTH regimes' total income the snapshot
  // itself computed — never recomputed or trusted from the browser — and
  // take the conservative higher figure via the canonical helper. The
  // top-level `computation.totalIncome` is only the RECOMMENDED regime's
  // figure; using it alone could miss a case whose non-recommended regime
  // is the one that actually crosses the risk threshold.
  const oldRegimeTotalIncomeRaw = latestComplete?.output_snapshot?.computation?.oldRegime?.totalIncome?.value;
  const newRegimeTotalIncomeRaw = latestComplete?.output_snapshot?.computation?.newRegime?.totalIncome?.value;
  const latestCompleteTotalIncome = totalIncomeForSurchargeApplicability(
    oldRegimeTotalIncomeRaw,
    newRegimeTotalIncomeRaw,
  );
  // K4-11: the engine's OWN surcharge verdict, read from the same immutable
  // snapshot — never re-derived here from the income above. A snapshot taken
  // before K4-11 has no such property (`undefined`), which fails closed and
  // reproduces this gate's pre-K4-11 behaviour exactly.
  const latestCompleteSurchargeSupported: boolean | undefined =
    latestComplete?.output_snapshot?.computation?.surchargeTreatmentSupported;
  // K4-12: the section 87A relief window is tested against the NEW regime's own
  // figure (the relief reaches that regime only), read from the same immutable
  // snapshot, with the engine's own verdict beside it.
  const latestCompleteNewRegimeTotalIncome: number | null =
    typeof newRegimeTotalIncomeRaw === "number" && Number.isFinite(newRegimeTotalIncomeRaw)
      ? newRegimeTotalIncomeRaw
      : null;
  const latestCompleteRebateReliefSupported: boolean | undefined =
    latestComplete?.output_snapshot?.computation?.rebateReliefTreatmentSupported;
  // K4-23 review F1: the s.112 verdict from that SAME immutable snapshot.
  const latestCompleteHouseSaleLtcgSupported: boolean | undefined =
    latestComplete?.output_snapshot?.computation?.houseSaleLtcgTreatmentSupported;
  const latestCompleteHasHouseSaleLtcg: boolean = latestComplete?.output_snapshot
    ? snapshotHasHouseSaleLtcg(latestComplete.output_snapshot as never)
    : false;

  return {
    taxCaseId: tc.id,
    caseId: tc.case_id,
    finalized: !!tc.finalized_at,
    status: tc.client_review_status ?? "not_started",
    reviewSnapshotId: tc.client_review_snapshot_id ?? null,
    latestCompleteSnapshotId: latestComplete?.id ?? null,
    latestCompleteRulesVersion: latestComplete?.rules_version ?? null,
    latestCompleteTotalIncome,
    latestCompleteSurchargeSupported,
    latestCompleteNewRegimeTotalIncome,
    latestCompleteRebateReliefSupported,
    latestCompleteHouseSaleLtcgSupported,
    latestCompleteHasHouseSaleLtcg,
    openErrorCount: openErrorCount ?? 0,
  };
}

const FINALIZED_MSG = "This tax case is finalized. Client review actions are read-only.";

/**
 * Shared eligibility gate for a review progression step (K.2.8.9A). Recomputes
 * eligibility server-side; on a blocked case it audits the attempt with the
 * stable blocker codes and returns an error message. The guarded RPCs re-assert
 * the profile subset in the database, so this is defense-in-depth + audit, not
 * the sole enforcement.
 */
async function eligibilityGate(
  user: SessionUser,
  taxCaseId: string,
  operation: string,
): Promise<ActionResult | null> {
  const elig = await getTaxCaseEligibility(taxCaseId);
  if (!elig) return { ok: false, error: "Tax case not found." };
  // Profile / declared-situation blockers withhold review entirely. Open
  // validation findings are handled by the existing capture/finalize checks, so
  // preparing a pack with an open finding stays allowed (as before).
  if (!computationWithheld(elig.result)) return null;
  await audit({
    actor: user,
    action: "tax_eligibility.progression_blocked",
    entityType: "tax_cases",
    entityId: taxCaseId,
    caseId: elig.caseId,
    after: {
      operation,
      tax_case_id: taxCaseId,
      blocker_codes: elig.result.blockers.map((b) => b.code),
    },
  });
  return {
    ok: false,
    error: `Not eligible for computation yet: ${elig.result.blockers[0]?.message ?? "resolve the eligibility blockers."}`,
  };
}

/**
 * TAX-SAFE-01 / TAX-SAFE-01A: structurally block review preparation/approval
 * when the latest complete snapshot's own computed total income (the
 * conservative higher of old/new regime, per
 * `totalIncomeForSurchargeApplicability`) EXCEEDS the sourced surcharge/
 * marginal-relief risk threshold (`tax-capability.ts`) — exactly ₹50,00,000
 * is not blocked. This does not depend on a preparer having declared a
 * special situation — it is derived automatically from the snapshot the
 * engine itself produced. The guarded RPCs re-assert the same check in the
 * database (defense in depth, not the sole enforcement).
 */
function surchargeRiskGate(state: ReviewCaseState): ActionResult | null {
  const risk = evaluateSurchargeMarginalReliefRisk(
    state.latestCompleteTotalIncome,
    state.latestCompleteSurchargeSupported,
  );
  if (risk) {
    return {
      ok: false,
      error: `Not approval-ready: ${risk.message}`,
    };
  }
  // K4-12: the SEPARATE section 87A rebate-threshold relief gate, evaluated in
  // the same place and against the same immutable snapshot. Checked after the
  // surcharge gate purely for ordering stability; the two windows are disjoint,
  // so at most one can ever fire for a given case.
  const rebateRisk = evaluateRebateMarginalReliefRisk(
    state.latestCompleteNewRegimeTotalIncome,
    state.latestCompleteRebateReliefSupported,
  );
  if (rebateRisk) {
    return {
      ok: false,
      error: `Not approval-ready: ${rebateRisk.message}`,
    };
  }
  // K4-23 review F1: the THIRD gate. A snapshot whose s.112 long-term
  // treatment the engine refused is knowingly incomplete — the gain is absent
  // from both its tax and its gross total income — so it may not be sent for
  // client approval.
  const houseSaleRisk = evaluateHouseSaleLtcgRisk(
    state.latestCompleteHasHouseSaleLtcg,
    state.latestCompleteHouseSaleLtcgSupported,
  );
  if (houseSaleRisk) {
    return {
      ok: false,
      error: `Not approval-ready: ${houseSaleRisk.message}`,
    };
  }
  return null;
}

function revalidate(taxCaseId: string) {
  revalidatePath(`/tax-desk/cases/${taxCaseId}/review`);
  revalidatePath(`/tax-desk/cases/${taxCaseId}`);
}

/**
 * Prepare (or re-prepare) a review pack bound to the LATEST complete snapshot.
 * Clears prior sent/approved/changes state because the binding changes — but
 * the audit trail of earlier prepared/approved events is preserved (append-only
 * audit_logs, never deleted).
 */
export async function prepareClientReviewAction(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  const supabase = await createServerClient();
  const state = await loadReviewCase(supabase, parsed.data.taxCaseId);
  if (!state) return { ok: false, error: "Tax case not found." };
  const mutable = checkCaseNotFinalized(state.finalized, FINALIZED_MSG);
  if (!mutable.ok) return { ok: false, error: mutable.error };
  const gate = await eligibilityGate(user, parsed.data.taxCaseId, "prepare_client_review");
  if (gate) return gate;
  if (!state.latestCompleteSnapshotId) {
    return { ok: false, error: "No complete computation snapshot exists yet. Create one in Computation first." };
  }
  const capabilityGate = surchargeRiskGate(state);
  if (capabilityGate) return capabilityGate;

  // Prepare through the guarded RPC: it re-derives the latest complete snapshot
  // server-side, binds it, resets downstream review state, and writes audit
  // atomically. Direct authenticated writes to the review columns are revoked
  // (K.2.8.8B), so lifecycle state can no longer be forged via PostgREST.
  const { error } = await supabase.rpc("prepare_client_review", {
    p_tax_case_id: state.taxCaseId,
    p_event_id: crypto.randomUUID(),
  });
  if (error) {
    if (/SURCHARGE_MARGINAL_RELIEF_UNSUPPORTED/.test(error.message ?? "")) {
      return {
        ok: false,
        error: "Not approval-ready: this case's total income may attract surcharge/marginal relief, which is not implemented.",
      };
    }
    return { ok: false, error: "Could not prepare the review pack." };
  }

  revalidate(state.taxCaseId);
  return { ok: true };
}

/** Record that the prepared pack was sent to the client (no message is sent). */
export async function markClientReviewSentAction(input: unknown): Promise<ActionResult> {
  await requireUser();
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  const supabase = await createServerClient();
  const state = await loadReviewCase(supabase, parsed.data.taxCaseId);
  if (!state) return { ok: false, error: "Tax case not found." };
  const mutable = checkCaseNotFinalized(state.finalized, FINALIZED_MSG);
  if (!mutable.ok) return { ok: false, error: mutable.error };
  if (!state.reviewSnapshotId) {
    return { ok: false, error: "Prepare the review pack before marking it sent." };
  }
  if (state.status !== "prepared") {
    return { ok: false, error: "Only a prepared review can be marked sent." };
  }
  if (state.reviewSnapshotId !== state.latestCompleteSnapshotId) {
    return { ok: false, error: "A newer snapshot exists. Prepare the latest snapshot again before sending." };
  }

  const { error } = await supabase.rpc("mark_client_review_sent", {
    p_tax_case_id: state.taxCaseId,
    p_event_id: crypto.randomUUID(),
  });
  if (error) return { ok: false, error: "Could not mark the review as sent." };

  revalidate(state.taxCaseId);
  return { ok: true };
}

const approvalSchema = z.object({
  taxCaseId: z.string().uuid(),
  method: approvalMethodSchema,
  reference: approvalReferenceSchema,
  // Optional ISO datetime; defaults to now when omitted/blank.
  approvedAt: z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z.string().datetime({ offset: true }).optional(),
  ),
});

/**
 * Capture a STAFF-RECORDED client confirmation for the CURRENT snapshot. This
 * is NOT an e-signature, e-filing consent or filing authorization. Blocked
 * when finalized, when the reviewed snapshot is not the latest complete one,
 * or while any open validation error exists. Open warnings do NOT block.
 */
export async function captureClientApprovalAction(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = approvalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const supabase = await createServerClient();
  const state = await loadReviewCase(supabase, d.taxCaseId);
  if (!state) return { ok: false, error: "Tax case not found." };
  const mutable = checkCaseNotFinalized(state.finalized, FINALIZED_MSG);
  if (!mutable.ok) return { ok: false, error: mutable.error };
  const gate = await eligibilityGate(user, d.taxCaseId, "capture_client_approval");
  if (gate) return gate;
  if (!state.reviewSnapshotId) {
    return { ok: false, error: "Prepare the review pack before capturing approval." };
  }
  if (!state.latestCompleteSnapshotId) {
    return { ok: false, error: "No complete computation snapshot exists to approve." };
  }
  if (state.reviewSnapshotId !== state.latestCompleteSnapshotId) {
    return {
      ok: false,
      error: "Client approval is out of date — a newer snapshot exists. Prepare the latest snapshot again.",
    };
  }
  if (state.openErrorCount > 0) {
    return { ok: false, error: "Resolve open validation errors before capturing client approval." };
  }
  const capabilityGate = surchargeRiskGate(state);
  if (capabilityGate) return capabilityGate;

  // K3-32B: approval now binds to an accepted-evidence manifest, not only a
  // snapshot. The manifest must already exist for THIS review snapshot — the
  // latest one generated for it (staff generates it explicitly, choosing a
  // regime, before capturing approval).
  const { data: manifestRow } = await supabase
    .from("tax_evidence_manifests")
    .select("id")
    .eq("tax_case_id", state.taxCaseId)
    .eq("computation_snapshot_id", state.reviewSnapshotId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!manifestRow) {
    return {
      ok: false,
      error: "Generate an accepted-evidence manifest (select a regime) before capturing client approval.",
    };
  }

  const { error } = await supabase.rpc("capture_client_approval", {
    p_tax_case_id: state.taxCaseId,
    p_manifest_id: manifestRow.id,
    p_method: d.method,
    p_reference: d.reference,
    p_approved_at: d.approvedAt ?? null,
    p_event_id: crypto.randomUUID(),
  });
  if (error) {
    if (/newer snapshot|out of date/i.test(error.message ?? "")) {
      return {
        ok: false,
        error: "Client approval is out of date — a newer snapshot exists. Prepare the latest snapshot again.",
      };
    }
    if (/open validation errors/i.test(error.message ?? "")) {
      return { ok: false, error: "Resolve open validation errors before capturing client approval." };
    }
    if (/SURCHARGE_MARGINAL_RELIEF_UNSUPPORTED/.test(error.message ?? "")) {
      return {
        ok: false,
        error: "Not approval-ready: this case's total income may attract surcharge/marginal relief, which is not implemented.",
      };
    }
    if (/manifest/i.test(error.message ?? "")) {
      return {
        ok: false,
        error: "Generate a fresh accepted-evidence manifest for the latest snapshot before capturing approval.",
      };
    }
    return { ok: false, error: "Could not capture the approval." };
  }

  revalidate(state.taxCaseId);
  return { ok: true };
}

const changesSchema = z.object({
  taxCaseId: z.string().uuid(),
  summary: changesSummarySchema,
  method: z
    .preprocess((v) => (v === "" || v === null ? undefined : v), approvalMethodSchema.optional()),
});

/**
 * Record that the client requested changes. Retains the previously reviewed
 * snapshot binding and does NOT mutate any computation or ledger row.
 */
export async function recordClientChangesRequestedAction(input: unknown): Promise<ActionResult> {
  await requireUser();
  const parsed = changesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const supabase = await createServerClient();
  const state = await loadReviewCase(supabase, d.taxCaseId);
  if (!state) return { ok: false, error: "Tax case not found." };
  const mutable = checkCaseNotFinalized(state.finalized, FINALIZED_MSG);
  if (!mutable.ok) return { ok: false, error: mutable.error };
  if (state.status === "not_started" || !state.reviewSnapshotId) {
    return { ok: false, error: "Prepare a review pack before recording requested changes." };
  }

  const { error } = await supabase.rpc("record_client_changes", {
    p_tax_case_id: state.taxCaseId,
    p_summary: d.summary,
    p_method: d.method ?? null,
    p_event_id: crypto.randomUUID(),
  });
  if (error) return { ok: false, error: "Could not record the requested changes." };

  revalidate(state.taxCaseId);
  return { ok: true };
}
