/**
 * Tax Desk → Client Review Pack assembler (K.2.7). PURE — no React/Next/
 * Supabase imports, so it is deterministic and trivially unit-testable.
 *
 * A review pack is ALWAYS built around ONE explicit computation snapshot (the
 * snapshot the review/approval is bound to), never directly from mutable live
 * ledger rows. The query layer parses the immutable snapshot JSON into the
 * safe {@link ReviewSnapshot} shape below and hands it here.
 *
 * PREPARATION-ONLY. This pack is NOT filing readiness, e-signature, e-filing
 * consent or CA certification. It records a STAFF-entered confirmation that a
 * client reviewed a specific computation. All numbers require CA verification.
 *
 * Nothing sensitive is carried through: no PAN, Aadhaar, ledger notes, file
 * URLs, storage paths, credentials, or raw resolution notes.
 */

/** The mandatory, verbatim disclaimer shown on every review pack. Keeps the
 *  preparation-only boundary and the universal-quality-policy concepts distinct
 *  (K.2.9.4): the recorded client approval is a staff-entered CONFIRMATION (not
 *  filing authorization), and every return still gets "independent professional
 *  review" — never conflated with the eligibility manual-preparation gate or the
 *  credentialed qualified-reviewer sign-off. */
export const REVIEW_PACK_DISCLAIMER =
  "This review pack is based on information entered and documents recorded in " +
  "TaxDesk OS. It records a staff-entered client confirmation only — it is not " +
  "proof of filing, tax authority acceptance, or professional certification. " +
  "Every return still requires independent professional review before filing.";

/** Wording used for the recorded confirmation — NEVER "signature"/"e-consent". */
export const STAFF_CONFIRMATION_WORDING = "Staff-recorded client confirmation";

export const APPROVAL_METHODS = [
  "whatsapp",
  "email",
  "phone",
  "in_person",
  "signed_document",
  "other",
] as const;
export type ApprovalMethod = (typeof APPROVAL_METHODS)[number];

export const REVIEW_STATUSES = [
  "not_started",
  "prepared",
  "sent",
  "approved",
  "changes_requested",
  "superseded",
] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

// ---------------------------------------------------------------------------
// Safe, already-normalized inputs (parsed from immutable snapshot JSON + DB).
// ---------------------------------------------------------------------------

export interface ReviewCaseContext {
  taxCaseId: string;
  caseId: string;
  caseDisplayCode: string | null;
  caseTitle: string | null;
  clientName: string;
  assessmentYear: string;
  financialYear: string;
  selectedItrType: string | null;
  recommendedItrType: string | null;
  finalized: boolean;
}

/** Income/deduction figures lifted from the snapshot's normalized summary. */
export interface ReviewSnapshotSummary {
  salary: number;
  interest: number;
  dividendOther: number;
  exempt: number;
  deductions: number;
  stcg111a: number;
  ltcg112a: number;
  totalTaxPaid: number;
}

/** Tax outputs lifted from the snapshot's computation (values only). */
export interface ReviewSnapshotTax {
  grossTotalIncome: number;
  totalIncome: number;
  specialRateCapitalGains: number;
  oldRegimeTax: number;
  newRegimeTax: number;
  recommendedRegime: string | null;
  rebate: number;
  cess: number;
  taxPaid: number;
  refundOrPayable: number;
  /** Unsupported-entry count on the snapshot's input (K.2.8.7). A bound review
   *  snapshot is always complete (partial snapshots are blocked from review), so
   *  this is 0 in the normal flow; carried through so the completeness guard is
   *  applied at the Client Review outcome surface too. Optional for back-compat. */
  unsupportedCount?: number;
}

/** One immutable snapshot, already parsed into a safe shape. */
export interface ReviewSnapshot {
  id: string;
  createdAt: string;
  rulesVersion: string;
  complete: boolean;
  selectedItrType: string | null;
  recommendedItrType: string | null;
  createdByName: string | null;
  summary: ReviewSnapshotSummary;
  tax: ReviewSnapshotTax;
}

/** A single open validation finding, reduced to safe display fields only. */
export interface ReviewOpenFinding {
  ruleCode: string;
  category: string;
  severity: string;
  title: string;
}

export interface ReviewDocumentSummary {
  requiredTotal: number;
  missing: number;
  received: number;
  verified: number;
  rejected: number;
  requiredOutstanding: number;
}

export interface ReviewValidationSummary {
  openError: number;
  openWarning: number;
  openInfo: number;
  resolved: number;
  openFindings: ReviewOpenFinding[];
}

export interface ReviewReconRow {
  sourceType: string;
  total: number;
  count: number;
}
export interface ReviewReconGroup {
  category: string;
  key: string;
  rows: ReviewReconRow[];
  total: number;
}
export interface ReviewReconPair {
  label: string;
  sourceA: string;
  totalA: number;
  sourceB: string;
  totalB: number;
  delta: number;
  mismatch: boolean;
}
export interface ReviewReconciliationSummary {
  groups: ReviewReconGroup[];
  pairs: ReviewReconPair[];
}

/** The persisted review/approval record (from tax_cases review columns). */
export interface ReviewRecord {
  status: ReviewStatus;
  reviewSnapshotId: string | null;
  sentAt: string | null;
  sentByName: string | null;
  approvedAt: string | null;
  approvalCapturedByName: string | null;
  approvalMethod: ApprovalMethod | null;
  /** Brief, screened, safe reference (e.g. "Confirmed by WhatsApp on 10 Jul"). */
  approvalReference: string | null;
  changesRequestedAt: string | null;
  changesRequestedByName: string | null;
  changesSummary: string | null;
}

export interface AssembleReviewPackInput {
  case: ReviewCaseContext;
  /** The snapshot the review is bound to (client_review_snapshot_id), if any. */
  reviewSnapshot: ReviewSnapshot | null;
  /** The newest COMPLETE snapshot in the case, if any. */
  latestCompleteSnapshot: ReviewSnapshot | null;
  documents: ReviewDocumentSummary;
  validation: ReviewValidationSummary;
  reconciliation: ReviewReconciliationSummary;
  review: ReviewRecord;
}

// ---------------------------------------------------------------------------
// Approval freshness — deterministic, snapshot-bound.
// ---------------------------------------------------------------------------

export type ApprovalFreshness =
  | "unavailable" // no complete snapshot exists at all
  | "not_prepared" // a complete snapshot exists but no review is bound yet
  | "current" // bound review snapshot === latest complete snapshot
  | "stale" // a newer complete snapshot exists than the one reviewed
  | "blocked_partial" // bound snapshot is not a complete snapshot
  | "blocked_finalized"; // tax case is finalized (read-only)

/**
 * Deterministic freshness of the review binding. Approval NEVER carries from
 * one snapshot to another: freshness is purely a function of ids + flags.
 */
export function computeApprovalFreshness(args: {
  finalized: boolean;
  reviewSnapshot: ReviewSnapshot | null;
  latestCompleteSnapshot: ReviewSnapshot | null;
}): ApprovalFreshness {
  if (args.finalized) return "blocked_finalized";
  if (!args.latestCompleteSnapshot) return "unavailable";
  if (!args.reviewSnapshot) return "not_prepared";
  if (!args.reviewSnapshot.complete) return "blocked_partial";
  return args.reviewSnapshot.id === args.latestCompleteSnapshot.id ? "current" : "stale";
}

// ---------------------------------------------------------------------------
// Assembled model.
// ---------------------------------------------------------------------------

export interface ReviewPackCaseModel {
  clientName: string;
  caseDisplayCode: string | null;
  caseTitle: string | null;
  assessmentYear: string;
  financialYear: string;
  snapshotAt: string | null;
  rulesVersion: string | null;
  snapshotCreatedByName: string | null;
}

export interface ReviewPackReturnSelection {
  selectedItrType: string | null;
  recommendedItrType: string | null;
  mismatch: boolean;
}

export interface ReviewPackModel {
  case: ReviewPackCaseModel;
  returnSelection: ReviewPackReturnSelection;
  income: ReviewSnapshotSummary | null;
  tax: ReviewSnapshotTax | null;
  documents: ReviewDocumentSummary;
  validation: ReviewValidationSummary;
  reconciliation: ReviewReconciliationSummary;
  approval: {
    status: ReviewStatus;
    freshness: ApprovalFreshness;
    reviewSnapshotId: string | null;
    latestCompleteSnapshotId: string | null;
    sentAt: string | null;
    sentByName: string | null;
    approvedAt: string | null;
    approvalCapturedByName: string | null;
    approvalMethod: ApprovalMethod | null;
    approvalReference: string | null;
    changesRequestedAt: string | null;
    changesRequestedByName: string | null;
    changesSummary: string | null;
    /** True only when the bound snapshot is still the latest complete one. */
    isCurrent: boolean;
    stale: boolean;
  };
  /** Hard blockers that prevent capturing a client approval right now. */
  blocking: string[];
  /** Non-blocking cautions that MUST stay visible (never silently dropped). */
  warnings: string[];
  /** What the UI is allowed to offer, given state. */
  capabilities: {
    canPrepare: boolean;
    canMarkSent: boolean;
    canCaptureApproval: boolean;
    canRequestChanges: boolean;
    canReprepareStale: boolean;
  };
  disclaimer: string;
  confirmationWording: string;
}

/**
 * Assemble the normalized review-pack model, blocking conditions, warnings and
 * approval freshness. Pure + deterministic.
 */
export function assembleClientReviewPack(input: AssembleReviewPackInput): ReviewPackModel {
  const { case: c, reviewSnapshot, latestCompleteSnapshot, documents, validation, reconciliation, review } = input;

  const freshness = computeApprovalFreshness({
    finalized: c.finalized,
    reviewSnapshot,
    latestCompleteSnapshot,
  });

  // The pack is presented from the bound (reviewed) snapshot when present,
  // otherwise from the latest complete snapshot as a "what would be reviewed"
  // preview. Either way it is ONE explicit, identified snapshot.
  const packSnapshot = reviewSnapshot ?? latestCompleteSnapshot;

  const selectedItr = c.selectedItrType ?? packSnapshot?.selectedItrType ?? null;
  const recommendedItr = c.recommendedItrType ?? packSnapshot?.recommendedItrType ?? null;
  const mismatch = !!selectedItr && !!recommendedItr && selectedItr !== recommendedItr;

  const blocking: string[] = [];
  const warnings: string[] = [];

  if (c.finalized) {
    blocking.push("Tax case is finalized — client review actions are read-only.");
  }
  if (!latestCompleteSnapshot) {
    blocking.push("No complete computation snapshot is available to review.");
  }
  if (validation.openError > 0) {
    blocking.push(
      `Open validation ${validation.openError === 1 ? "error" : "errors"} prevent approval (${validation.openError}).`,
    );
  }
  if (freshness === "stale") {
    blocking.push("Client approval is out of date because a newer computation snapshot exists.");
  }
  if (freshness === "blocked_partial") {
    blocking.push("The reviewed snapshot is partial/incomplete — approval is blocked.");
  }

  // Warnings: shown clearly, never block approval, never silently disappear.
  if (validation.openWarning > 0) {
    warnings.push(
      `${validation.openWarning} open validation warning${validation.openWarning === 1 ? "" : "s"} remain — review before approving.`,
    );
  }
  if (validation.openInfo > 0) {
    warnings.push(`${validation.openInfo} open validation information item${validation.openInfo === 1 ? "" : "s"}.`);
  }
  if (mismatch) {
    warnings.push(
      `Selected ITR form (${selectedItr}) differs from the recommended form (${recommendedItr}).`,
    );
  }
  if (documents.requiredOutstanding > 0) {
    warnings.push(
      `${documents.requiredOutstanding} required document${documents.requiredOutstanding === 1 ? "" : "s"} still outstanding.`,
    );
  }
  if (reconciliation.pairs.some((p) => p.mismatch)) {
    warnings.push("One or more configured source pairs do not reconcile — see reconciliation summary.");
  }

  const isCurrent = freshness === "current";
  const stale = freshness === "stale";

  const hasLatestComplete = !!latestCompleteSnapshot;
  const canPrepare = !c.finalized && hasLatestComplete;
  const canMarkSent = !c.finalized && review.status === "prepared" && isCurrent;
  const canCaptureApproval =
    !c.finalized &&
    isCurrent &&
    !!reviewSnapshot?.complete &&
    validation.openError === 0 &&
    (review.status === "prepared" || review.status === "sent" || review.status === "changes_requested");
  const canRequestChanges =
    !c.finalized && review.status !== "not_started" && !!reviewSnapshot;
  const canReprepareStale = !c.finalized && stale && hasLatestComplete;

  return {
    case: {
      clientName: c.clientName,
      caseDisplayCode: c.caseDisplayCode,
      caseTitle: c.caseTitle,
      assessmentYear: c.assessmentYear,
      financialYear: c.financialYear,
      snapshotAt: packSnapshot?.createdAt ?? null,
      rulesVersion: packSnapshot?.rulesVersion ?? null,
      snapshotCreatedByName: packSnapshot?.createdByName ?? null,
    },
    returnSelection: { selectedItrType: selectedItr, recommendedItrType: recommendedItr, mismatch },
    income: packSnapshot?.summary ?? null,
    tax: packSnapshot?.tax ?? null,
    documents,
    validation,
    reconciliation,
    approval: {
      status: review.status,
      freshness,
      reviewSnapshotId: review.reviewSnapshotId,
      latestCompleteSnapshotId: latestCompleteSnapshot?.id ?? null,
      sentAt: review.sentAt,
      sentByName: review.sentByName,
      approvedAt: review.approvedAt,
      approvalCapturedByName: review.approvalCapturedByName,
      approvalMethod: review.approvalMethod,
      approvalReference: review.approvalReference,
      changesRequestedAt: review.changesRequestedAt,
      changesRequestedByName: review.changesRequestedByName,
      changesSummary: review.changesSummary,
      isCurrent,
      stale,
    },
    blocking,
    warnings,
    capabilities: {
      canPrepare,
      canMarkSent,
      canCaptureApproval,
      canRequestChanges,
      canReprepareStale,
    },
    disclaimer: REVIEW_PACK_DISCLAIMER,
    confirmationWording: STAFF_CONFIRMATION_WORDING,
  };
}

/** Human-readable one-line banner for the current freshness/status. */
export function reviewStatusBanner(model: ReviewPackModel): { tone: "info" | "ok" | "warn" | "error"; text: string } {
  const a = model.approval;
  if (model.case.snapshotAt === null && a.freshness === "unavailable") {
    return { tone: "warn", text: "No complete computation snapshot is available. Create one in Computation first." };
  }
  if (a.freshness === "blocked_finalized") {
    return { tone: "info", text: "Tax case is finalized — client review is read-only." };
  }
  if (model.validation.openError > 0) {
    return { tone: "error", text: "Open validation errors prevent approval. Resolve them in Validation." };
  }
  if (a.stale) {
    return { tone: "warn", text: "Client approval is out of date because a newer snapshot exists. Prepare the latest snapshot again." };
  }
  switch (a.status) {
    case "approved":
      return { tone: "ok", text: "Client approval captured for the current snapshot (staff-recorded confirmation)." };
    case "sent":
      return { tone: "info", text: "Review recorded as sent to the client." };
    case "prepared":
      return { tone: "info", text: "Review pack prepared and bound to the latest complete snapshot." };
    case "changes_requested":
      return { tone: "warn", text: "Client requested changes. Update the case and prepare a new review." };
    default:
      return { tone: "info", text: "Ready to prepare a client review pack for the latest complete snapshot." };
  }
}
