/**
 * Tax Desk workflow model (Phase K.2.8.5). PURE — no React/Next/Supabase.
 *
 * Turns the already-computed filing-readiness signals into (a) the seven
 * pipeline stages with a per-stage state, and (b) the single "next action" a
 * preparer should take. Every screen (shell rail, case overview, dashboard)
 * reads THIS so they always agree. It derives nothing new about tax rules — it
 * only re-expresses existing state for the UI.
 */

import type { Tone } from "@/lib/ui/status-tone";

export type StageStatus =
  | "complete"
  | "current"
  | "waiting"
  | "warning"
  | "blocked"
  | "stale"
  | "finalized"
  | "upcoming";

export type StageKey =
  | "documents"
  | "data_entry"
  | "computation"
  | "validation"
  | "client_review"
  | "filing_readiness"
  | "finalization";

export interface WorkflowStage {
  key: StageKey;
  label: string;
  /** Route segment under /tax-desk/cases/[id]/…; "" is the overview. */
  segment: string;
  status: StageStatus;
  /** Short human hint for the current state. */
  hint: string;
}

export interface NextAction {
  tone: Tone;
  title: string;
  description: string;
  /** Route segment to act in ("" = overview). */
  segment: string;
  cta: string;
  done?: boolean;
  locked?: boolean;
}

export interface WorkflowSummary {
  stages: WorkflowStage[];
  nextAction: NextAction;
  overall: { label: string; tone: Tone };
  /** Index of the stage the user is "on" (first non-complete, else last). */
  currentIndex: number;
}

/** Normalized, already-safe signals — mapped from FilingReadinessModel + review. */
export interface WorkflowInput {
  finalized: boolean;
  reopened: boolean;
  overallReady: boolean;
  overallBlocked: boolean;
  hasCompleteSnapshot: boolean;
  snapshotFresh: boolean;
  validationRunExists: boolean;
  validationFresh: boolean;
  openBlockers: number;
  openWarnings: number;
  liveComplete: boolean;
  /** Whether the case has at least one meaningful live ledger entry. Distinct
   *  from `liveComplete` (which is "no unsupported rows" and is TRUE for an empty
   *  ledger). Used only for truthful empty-state copy — never for stage status.
   *  Optional: when omitted the hint keeps its prior behaviour. */
  hasLiveData?: boolean;
  unsupportedEntries: number;
  docsRequiredOutstanding: number;
  docsRequiredRejected: number;
  docsReceivedUnverified: number;
  reviewStatus: string;
  approvalCurrent: boolean;
  itrSelected: boolean;
  /** Whether readiness checks have been persisted (tax_readiness_items exist).
   *  Distinguishes a live-ready case from one whose result is saved. */
  readinessPersisted?: boolean;
}

export const STAGE_LABELS: Record<StageKey, string> = {
  documents: "Documents",
  data_entry: "Ledgers",
  computation: "Computation",
  validation: "Validation",
  client_review: "Client Review",
  filing_readiness: "Filing Readiness",
  finalization: "Finalization",
};

export const STAGE_SEGMENTS: Record<StageKey, string> = {
  documents: "documents",
  data_entry: "ledgers",
  computation: "computation",
  validation: "validation",
  client_review: "review",
  filing_readiness: "readiness",
  finalization: "readiness",
};

/** Map a stage status to a semantic tone (shared with StatusDot/Badge). */
export const STAGE_TONE: Record<StageStatus, Tone> = {
  complete: "success",
  finalized: "success",
  current: "info",
  waiting: "warning",
  warning: "warning",
  stale: "warning",
  blocked: "danger",
  upcoming: "neutral",
};

function stage(key: StageKey, status: StageStatus, hint: string): WorkflowStage {
  return { key, label: STAGE_LABELS[key], segment: STAGE_SEGMENTS[key], status, hint };
}

/**
 * Live ledger data counts as "ready to progress" only when it is BOTH complete
 * (no unsupported rows) AND has at least one meaningful entry. `liveComplete`
 * alone is TRUE for an empty ledger — it means "no unsupported rows", which is
 * vacuously satisfied when there are no rows at all. An empty case must never
 * derive a completed/green data-entry stage, a "computation is current" beckon,
 * or a next action recommending computation (K3-00 readiness closeout).
 *
 * When `hasLiveData` is omitted (legacy callers that never supply it), the
 * prior behaviour is preserved — only an explicit `false` withholds readiness.
 */
function liveReadyToProgress(i: WorkflowInput): boolean {
  return i.liveComplete && i.hasLiveData !== false;
}

export function deriveWorkflow(i: WorkflowInput): WorkflowSummary {
  const liveReady = liveReadyToProgress(i);

  // --- per-stage states -----------------------------------------------------
  // Documents
  const documents: StageStatus =
    i.docsRequiredRejected > 0
      ? "blocked"
      : i.docsRequiredOutstanding > 0
        ? "warning"
        : i.docsReceivedUnverified > 0
          ? "warning"
          : "complete";

  // Data entry. A fresh complete snapshot is the deciding signal (stays complete
  // even once live rows are no longer meaningful); otherwise unsupported rows
  // warn, and only genuinely populated+supported live data reads complete — an
  // empty ledger falls through to "current" (still needs entries).
  const dataEntry: StageStatus =
    i.hasCompleteSnapshot && i.snapshotFresh
      ? "complete"
      : i.unsupportedEntries > 0
        ? "warning"
        : liveReady
          ? "complete"
          : "current";

  // Computation. Without a snapshot it only becomes the "current" step once live
  // data is genuinely ready to compute; an empty ledger keeps it "upcoming".
  const computation: StageStatus = !i.hasCompleteSnapshot
    ? liveReady
      ? "current"
      : "upcoming"
    : i.snapshotFresh
      ? "complete"
      : "stale";

  // Validation
  const validation: StageStatus = !i.hasCompleteSnapshot
    ? "upcoming"
    : !i.validationRunExists
      ? "current"
      : i.openBlockers > 0
        ? "blocked"
        : !i.validationFresh
          ? "stale"
          : i.openWarnings > 0
            ? "warning"
            : "complete";

  // Client review
  const clientReview: StageStatus = i.approvalCurrent
    ? "complete"
    : i.reviewStatus === "sent"
      ? "waiting"
      : i.reviewStatus === "changes_requested"
        ? "warning"
        : i.reviewStatus === "approved"
          ? "stale"
          : i.reviewStatus === "superseded"
            ? "warning"
            : i.hasCompleteSnapshot && i.snapshotFresh && validation === "complete"
              ? "current"
              : "upcoming";

  // Filing readiness
  const filingReadiness: StageStatus = i.finalized
    ? "complete"
    : i.reopened
      ? "warning"
      : i.overallReady
        ? "current"
        : i.overallBlocked
          ? "blocked"
          : "upcoming";

  // Finalization
  const finalization: StageStatus = i.finalized
    ? "finalized"
    : i.overallReady
      ? "current"
      : "upcoming";

  const stages: WorkflowStage[] = [
    stage("documents", documents, docHint(i)),
    stage("data_entry", dataEntry, dataEntryHint(i)),
    stage("computation", computation, computationHint(i)),
    stage("validation", validation, validationHint(i)),
    stage("client_review", clientReview, reviewHint(i)),
    stage("filing_readiness", filingReadiness, readinessHint(i)),
    stage("finalization", finalization, i.finalized ? "Locked" : i.overallReady ? "Ready" : "Pending"),
  ];

  const firstOpen = stages.findIndex(
    (s) => s.status !== "complete" && s.status !== "finalized" && s.status !== "waiting",
  );
  const currentIndex = firstOpen === -1 ? stages.length - 1 : firstOpen;

  return {
    stages,
    nextAction: deriveNextAction(i),
    overall: overallLabel(i),
    currentIndex,
  };
}

// --- next action (pipeline-ordered) ------------------------------------------

export function deriveNextAction(i: WorkflowInput): NextAction {
  if (i.finalized) {
    return {
      tone: "neutral",
      title: "Internally finalized",
      description: "This preparation record is locked and read-only. Admins can reopen if changes are needed.",
      segment: "readiness",
      cta: "View readiness",
      locked: true,
    };
  }
  if (i.reopened) {
    return na("warning", "Case reopened — start a fresh review", "Prior approval was superseded. Save a current snapshot and obtain fresh client approval before finalizing.", "readiness", "Open readiness");
  }
  if (i.docsRequiredRejected > 0) {
    return na("danger", `Resolve ${i.docsRequiredRejected} rejected required document${plural(i.docsRequiredRejected)}`, "One or more required documents were rejected. Re-request or replace them.", "documents", "Open documents");
  }
  if (i.docsRequiredOutstanding > 0) {
    return na("warning", `Collect ${i.docsRequiredOutstanding} required document${plural(i.docsRequiredOutstanding)}`, "Required checklist items are still outstanding from the client.", "documents", "Request documents");
  }
  if (!i.itrSelected) {
    return na("info", "Select the ITR form", "No ITR form is selected yet. Choose one in Computation before proceeding.", "computation", "Open computation");
  }
  // An empty ledger has liveComplete === true only vacuously — it must never
  // skip straight to "save a snapshot" as though data exists (K3-00). Route to
  // data entry until live data is genuinely populated and supported.
  if (!i.hasCompleteSnapshot && !liveReadyToProgress(i)) {
    return na("info", "Enter income & tax data", "Add the income, tax-paid and deduction entries needed before computation.", "ledgers", "Open data entry");
  }
  if (i.unsupportedEntries > 0) {
    return na("warning", `Review ${i.unsupportedEntries} unsupported entr${i.unsupportedEntries === 1 ? "y" : "ies"}`, "Some ledger entries aren't yet supported by the AY 2026-27 engine. Review them before computing.", "ledgers", "Open data entry");
  }
  if (!i.hasCompleteSnapshot) {
    return na("info", "Save a computation snapshot", "Live data is ready. Compute the return and save a complete snapshot.", "computation", "Open computation");
  }
  if (!i.snapshotFresh) {
    return na("warning", "Data changed — save a new snapshot", "Live Tax Desk data has changed since the last snapshot. Save a fresh snapshot and re-obtain approval.", "computation", "Open computation");
  }
  if (!i.validationRunExists) {
    return na("info", "Run validation", "Run the deterministic validation checks against the current snapshot.", "validation", "Open validation");
  }
  if (i.openBlockers > 0) {
    return na("danger", `Resolve ${i.openBlockers} validation error${plural(i.openBlockers)}`, "Blocking validation findings must be resolved before client review.", "validation", "Open validation");
  }
  if (!i.validationFresh) {
    return na("warning", "Re-run validation", "Validation is stale — data or the snapshot changed after the last run.", "validation", "Open validation");
  }
  if (!i.approvalCurrent) {
    if (i.reviewStatus === "sent") {
      return na("warning", "Awaiting client response", "The review pack has been sent. Record the client's approval or requested changes when it arrives.", "review", "Open client review");
    }
    if (i.reviewStatus === "changes_requested") {
      return na("warning", "Client requested changes", "Apply the requested changes, save a new snapshot, and prepare a fresh review.", "review", "Open client review");
    }
    return na("info", "Prepare client review", "Prepare the review pack for the current snapshot and capture staff-recorded client approval.", "review", "Open client review");
  }
  if (i.overallReady) {
    return { tone: "success", title: "Ready for internal finalization", description: "All blocking checks pass. Finalize the internal preparation record when you're ready.", segment: "readiness", cta: "Open readiness", done: false };
  }
  return na("info", "Continue filing readiness", "Review the remaining readiness checks.", "readiness", "Open readiness");
}

function na(tone: Tone, title: string, description: string, segment: string, cta: string): NextAction {
  return { tone, title, description, segment, cta };
}
function plural(n: number): string {
  return n === 1 ? "" : "s";
}

function overallLabel(i: WorkflowInput): { label: string; tone: Tone } {
  if (i.finalized) return { label: "Finalized", tone: "success" };
  if (i.reopened) return { label: "Reopened", tone: "warning" };
  if (i.overallReady) return { label: "Ready to finalize", tone: "success" };
  if (i.overallBlocked) return { label: "Blocked", tone: "danger" };
  return { label: "In preparation", tone: "info" };
}

// --- per-stage hints ---------------------------------------------------------
function docHint(i: WorkflowInput): string {
  if (i.docsRequiredRejected > 0) return `${i.docsRequiredRejected} rejected`;
  if (i.docsRequiredOutstanding > 0) return `${i.docsRequiredOutstanding} outstanding`;
  if (i.docsReceivedUnverified > 0) return `${i.docsReceivedUnverified} to verify`;
  return "All required collected";
}
function dataEntryHint(i: WorkflowInput): string {
  if (i.unsupportedEntries > 0) return `${i.unsupportedEntries} unsupported`;
  if (i.hasCompleteSnapshot) return "Entries complete";
  // An empty ledger is "complete" only in the vacuous "no unsupported rows"
  // sense — it must never read as a completion affirmative (K.2.9.4).
  if (i.hasLiveData === false) return "No entries yet";
  if (i.liveComplete) return "Entries complete";
  return "Entries needed";
}
function computationHint(i: WorkflowInput): string {
  if (!i.hasCompleteSnapshot) return "No snapshot yet";
  if (!i.snapshotFresh) return "Snapshot stale";
  return "Snapshot current";
}
function validationHint(i: WorkflowInput): string {
  if (!i.hasCompleteSnapshot) return "Awaiting snapshot";
  if (!i.validationRunExists) return "Not run";
  if (i.openBlockers > 0) return `${i.openBlockers} error${plural(i.openBlockers)}`;
  if (!i.validationFresh) return "Stale";
  if (i.openWarnings > 0) return `${i.openWarnings} warning${plural(i.openWarnings)}`;
  return "Passed";
}
function reviewHint(i: WorkflowInput): string {
  if (i.approvalCurrent) return "Approved (current)";
  if (i.reviewStatus === "sent") return "Awaiting client";
  if (i.reviewStatus === "changes_requested") return "Changes requested";
  if (i.reviewStatus === "approved") return "Approval stale";
  if (i.reviewStatus === "superseded") return "Superseded";
  return "Not prepared";
}
function readinessHint(i: WorkflowInput): string {
  if (i.finalized) return "Finalized";
  if (i.reopened) return "Needs review";
  if (i.overallReady) return i.readinessPersisted ? "Checks saved" : "Live checks pass";
  if (i.overallBlocked) return "Blocked";
  return "Pending";
}
