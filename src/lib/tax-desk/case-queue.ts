/**
 * List-level case summary (K.2.8.5). PURE. Derives a coarse stage + next-step
 * hint + waiting-on from the per-case statuses that the Tax Desk case LIST
 * already returns — cheap enough to render a work queue without running the
 * full per-case readiness compute. Less precise than the case workspace, and
 * labelled as such in the UI.
 */

import type { Tone } from "@/lib/ui/status-tone";

export interface CaseRowStatuses {
  caseStatus: string;
  clientReviewStatus: string;
  filingStatus: string;
  eVerificationStatus: string;
  itrSelected: string | null;
}

export interface CaseRowSummary {
  stage: string;
  tone: Tone;
  next: string;
  waitingOn: string | null;
}

/** Segmented-queue buckets — all derivable from the list statuses (no per-case
 *  readiness compute, so honest but coarse). A row belongs to exactly one. */
export type CaseSegment = "attention" | "waiting_client" | "ready_review" | "approved" | "closed";

export const CASE_SEGMENTS: { key: CaseSegment; label: string }[] = [
  { key: "attention", label: "Needs attention" },
  { key: "waiting_client", label: "Waiting on client" },
  { key: "ready_review", label: "Ready for review" },
  { key: "approved", label: "Client approved" },
  { key: "closed", label: "Closed" },
];

export function caseRowSegment(s: CaseRowStatuses): CaseSegment {
  if (s.caseStatus === "closed") return "closed";
  const summary = summarizeCaseRow(s);
  if (summary.waitingOn === "Client") return "waiting_client";
  if (s.clientReviewStatus === "approved") return "approved";
  if (s.clientReviewStatus === "prepared" || s.caseStatus === "computation_ready") return "ready_review";
  return "attention";
}

export function summarizeCaseRow(s: CaseRowStatuses): CaseRowSummary {
  // Terminal / late-stage first.
  if (s.caseStatus === "closed") {
    return { stage: "Closed", tone: "neutral", next: "—", waitingOn: null };
  }
  if (s.eVerificationStatus === "pending" && s.filingStatus === "filed") {
    return { stage: "E-verification", tone: "warning", next: "Await e-verification", waitingOn: "Client" };
  }
  if (s.filingStatus === "portal_filing_pending") {
    return { stage: "Filing", tone: "info", next: "File on the portal", waitingOn: null };
  }
  // Review lifecycle.
  switch (s.clientReviewStatus) {
    case "approved":
      return { stage: "Filing readiness", tone: "info", next: "Check filing readiness", waitingOn: null };
    case "sent":
      return { stage: "Client review", tone: "warning", next: "Awaiting client response", waitingOn: "Client" };
    case "changes_requested":
      return { stage: "Client review", tone: "warning", next: "Apply requested changes", waitingOn: null };
    case "prepared":
      return { stage: "Client review", tone: "info", next: "Send review to client", waitingOn: null };
    case "superseded":
      return { stage: "Client review", tone: "warning", next: "Prepare a fresh review", waitingOn: null };
  }
  // Preparation buckets from case_status.
  switch (s.caseStatus) {
    case "data_entry_pending":
      return { stage: "Data entry", tone: "warning", next: "Enter income & tax data", waitingOn: null };
    case "reconciliation_pending":
      return { stage: "Validation", tone: "warning", next: "Reconcile & run validation", waitingOn: null };
    case "computation_ready":
      return { stage: "Computation", tone: "info", next: "Save snapshot & prepare review", waitingOn: null };
    case "review_pending":
      return { stage: "Client review", tone: "info", next: "Prepare client review", waitingOn: null };
  }
  return { stage: "In preparation", tone: "neutral", next: "Continue preparation", waitingOn: null };
}
