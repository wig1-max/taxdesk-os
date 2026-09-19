import { cache } from "react";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { computeTaxCaseReadiness } from "@/lib/queries/tax-readiness";
import type { FilingReadinessModel, ReadinessItem } from "@/lib/tax-desk/filing-readiness";
import { deriveWorkflow, type WorkflowInput, type WorkflowSummary } from "@/lib/tax-desk/workflow";

/**
 * Shared Tax-case workspace context (K.2.8.5) — the single load that powers the
 * persistent TaxCaseShell (header + workflow rail + next action) on every Tax
 * Desk case route. Reuses the authoritative readiness compute so the rail and
 * the Readiness page can never disagree, and adds the financial anchor
 * (refund/payable) from the latest complete snapshot's output. No PAN/Aadhaar.
 */

export interface WorkspaceMoney {
  /** Engine signed value = grossTaxLiability - taxPaid (>0 payable, <0 refund).
   *  Always resolve through resolveFinancialOutcome — never interpret directly. */
  refundOrPayable: number;
  regime: string | null;
  totalIncome: number;
  taxPaid: number;
  /** Unsupported-entry count stored on the snapshot's input (K.2.8.7). Always 0
   *  for a saved snapshot (snapshots are gated complete); carried through so the
   *  completeness guard is applied consistently at every call site. */
  unsupportedCount: number;
}

/** Live (unsaved) preview outcome — shown in the shell when no snapshot exists,
 *  clearly tagged as a preview. Same sign convention as WorkspaceMoney. */
export interface WorkspacePreview {
  refundOrPayable: number;
  regime: string | null;
}

export interface TaxCaseWorkspace {
  taxCaseId: string;
  caseId: string;
  caseDisplayCode: string | null;
  caseTitle: string | null;
  clientName: string;
  assessmentYear: string;
  financialYear: string;
  itrSelected: string | null;
  itrRecommended: string | null;
  finalizedAt: string | null;
  finalizedByName: string | null;
  reopenedAt: string | null;
  snapshotAt: string | null;
  workflow: WorkflowSummary;
  money: WorkspaceMoney | null;
  /** Live preview outcome (unsaved) — present when there's meaningful ledger data. */
  preview: WorkspacePreview | null;
  /** Engine-derived count of live ledger entries needing manual tax treatment
   *  (K.2.8.7). Gates the shell preview anchor so an incomplete input never
   *  renders as a trustworthy refund/payable/nil balance. */
  liveUnsupportedCount: number;
  /** Manual professional review overlay (K.2.8.9B). `requiresManualReview` is
   *  derived from the same unsupported / declared-situation subset as
   *  app.tax_case_requires_manual_review(); `manualReviewStatus` is the stored
   *  overlay pointer. Both drive the shell's manual-review affordance only. */
  requiresManualReview: boolean;
  manualReviewStatus: string;
  /** Full readiness model — reused by the case Overview command centre. */
  readiness: FilingReadinessModel;
}

const byKey = (items: ReadinessItem[], key: string) => items.find((i) => i.itemKey === key);
const numDetail = (item: ReadinessItem | undefined, field: string): number => {
  const v = item?.details?.[field];
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const boolDetail = (item: ReadinessItem | undefined, field: string): boolean =>
  item?.details?.[field] === true;

/** Map the readiness model into the normalized workflow signals. */
export function readinessToWorkflowInput(
  model: FilingReadinessModel,
  readinessPersisted = false,
): WorkflowInput {
  const items = model.items;
  const snapComplete = byKey(items, "computation.snapshot_complete");
  const matchesLive = byKey(items, "computation.snapshot_matches_live_data");
  const runExists = byKey(items, "validation.run_exists");
  const noBlockers = byKey(items, "validation.no_open_blockers");
  const warnings = byKey(items, "validation.open_warnings");
  const docsSatisfied = byKey(items, "documents.required_items_satisfied");
  const docsUnverified = byKey(items, "documents.received_unverified");
  const review = byKey(items, "client_review.current_approval");
  const eligibility = byKey(items, "eligibility.case_eligible");
  // "Has meaningful live entries?" — derived from the eligibility item the model
  // already carries. The evaluator raises NO_MEANINGFUL_DATA iff there is no
  // meaningful income/tax-paid figure, so its absence == real entries exist.
  // Feeds only the truthful empty-ledger hint (K.2.9.4), not any stage status.
  const blockerCodes = (eligibility?.details?.blockerCodes as string[] | undefined) ?? [];
  const hasLiveData = !blockerCodes.includes("NO_MEANINGFUL_DATA");

  return {
    finalized: model.overall === "finalized",
    reopened: model.overall === "reopened_needs_review",
    overallReady: model.overall === "ready",
    overallBlocked: model.overall === "blocked",
    hasCompleteSnapshot: snapComplete?.status === "passed",
    snapshotFresh: model.snapshotFresh,
    validationRunExists: runExists?.status === "passed",
    validationFresh: model.validationFresh,
    openBlockers: numDetail(noBlockers, "openError") + numDetail(noBlockers, "openBlocker"),
    openWarnings: numDetail(warnings, "openWarning"),
    liveComplete: boolDetail(matchesLive, "liveComplete"),
    hasLiveData,
    unsupportedEntries: numDetail(matchesLive, "liveUnsupportedEntries"),
    docsRequiredOutstanding: numDetail(docsSatisfied, "requiredOutstanding"),
    docsRequiredRejected: numDetail(docsSatisfied, "requiredRejected"),
    docsReceivedUnverified: numDetail(docsUnverified, "receivedUnverified"),
    reviewStatus: (review?.details?.reviewStatus as string) ?? "not_started",
    approvalCurrent: model.approvalCurrent,
    itrSelected: !!model.case.selectedItrType,
    readinessPersisted,
  };
}

const cval = (v: unknown): number => {
  const n = Number((v as { value?: unknown } | null)?.value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Request-memoized so the shared case layout and the page it wraps compute the
 * workspace (and its heavy readiness derivation) only once per request.
 */
export const getTaxCaseWorkspace = cache(async function getTaxCaseWorkspace(
  taxCaseId: string,
): Promise<TaxCaseWorkspace | null> {
  const computed = await computeTaxCaseReadiness(taxCaseId);
  if (!computed) return null;
  const { model } = computed;

  const supabase = await createServerClient();

  // Manual-review overlay (K.2.8.9B). `requiresManualReview` mirrors the DB
  // helper's unsupported / declared-situation subset (NOT mere profile
  // incompleteness, NOT ledger support). One light read, no eligibility recompute.
  const { data: mr } = await supabase
    .from("tax_cases")
    .select("manual_review_status, residential_status, taxpayer_category, declared_special_situations")
    .eq("id", taxCaseId)
    .maybeSingle();
  const requiresManualReview =
    !!mr &&
    (((mr.residential_status as string | null) != null && mr.residential_status !== "resident") ||
      ((mr.taxpayer_category as string | null) != null && mr.taxpayer_category !== "individual") ||
      (((mr.declared_special_situations as string[] | null) ?? []).length > 0));
  const manualReviewStatus = (mr?.manual_review_status as string | null) ?? "none";

  // Financial anchor from the latest complete snapshot's output.
  let money: WorkspaceMoney | null = null;
  if (model.case.snapshotId) {
    const { data: snap } = await supabase
      .from("tax_computation_snapshots")
      .select("input_snapshot, output_snapshot")
      .eq("id", model.case.snapshotId)
      .maybeSingle();
    const comp = ((snap?.output_snapshot ?? {}) as Record<string, unknown>).computation as
      | Record<string, unknown>
      | undefined;
    const input = (snap?.input_snapshot ?? {}) as Record<string, unknown>;
    if (comp) {
      money = {
        refundOrPayable: cval(comp.refundOrPayable),
        regime: (comp.recommendedRegime as string | null) ?? null,
        totalIncome: cval(comp.totalIncome),
        taxPaid: cval(comp.taxPaid),
        unsupportedCount: Number(input.unsupportedEntryCount ?? 0) || 0,
      };
    }
  }

  return {
    taxCaseId,
    caseId: computed.caseId,
    caseDisplayCode: model.case.caseDisplayCode,
    caseTitle: model.case.caseTitle,
    clientName: model.case.clientName,
    assessmentYear: model.case.assessmentYear,
    financialYear: model.case.financialYear,
    itrSelected: model.case.selectedItrType,
    itrRecommended: model.case.recommendedItrType,
    finalizedAt: model.case.finalizedAt,
    finalizedByName: model.case.finalizedByName,
    reopenedAt: model.case.reopenedAt,
    snapshotAt: model.case.snapshotAt,
    workflow: deriveWorkflow(readinessToWorkflowInput(model, computed.hasPersistedReadiness)),
    money: money,
    preview: computed.livePreview
      ? { refundOrPayable: computed.livePreview.refundOrPayable, regime: computed.livePreview.regime }
      : null,
    liveUnsupportedCount: computed.liveUnsupportedCount,
    requiresManualReview,
    manualReviewStatus,
    readiness: model,
  };
});
