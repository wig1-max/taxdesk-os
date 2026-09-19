/**
 * Tax Desk → Qualified-reviewer sign-off (K.2.8.9B). PURE — no React/Next/
 * Supabase, no DB writes. Deterministic and unit-testable.
 *
 * The K.2.8.9A eligibility gate blocks unsupported / special-situation cases from
 * automatic computation and routes them to MANUAL PROFESSIONAL REVIEW. This
 * module models that manual-review track: which blockers require a professional
 * sign-off, the reviewer qualifications, the decision outcomes, and the allowed
 * status transitions.
 *
 * IMPORTANT: this is a PARALLEL, auditable overlay. A reviewer approval AUTHORIZES
 * manual handling of the case and is recorded immutably; it does NOT flip the 9A
 * computation eligibility gate. Never treat an approved sign-off as making an
 * ineligible case eligible for automatic computation.
 */

import type { EligibilityResult } from "@/lib/tax-desk/eligibility";

/** Bump when qualifications, decisions, or transition rules change. */
export const REVIEWER_RULES_VERSION = "K2.8.9B.reviewer.v1";

/** Qualifications a reviewer credential can hold. */
export const REVIEWER_QUALIFICATIONS = [
  { code: "chartered_accountant", label: "Chartered Accountant (CA)" },
  { code: "advocate", label: "Advocate" },
  { code: "tax_return_preparer", label: "Tax Return Preparer (TRP)" },
  { code: "other", label: "Other qualified professional" },
] as const;

export type ReviewerQualification = (typeof REVIEWER_QUALIFICATIONS)[number]["code"];

const QUALIFICATION_LABEL = new Map(REVIEWER_QUALIFICATIONS.map((q) => [q.code, q.label] as const));

export function isReviewerQualification(v: string): v is ReviewerQualification {
  return QUALIFICATION_LABEL.has(v as ReviewerQualification);
}

export function qualificationLabel(code: string | null | undefined): string {
  return (code && QUALIFICATION_LABEL.get(code as ReviewerQualification)) || code || "—";
}

/** Reviewer credential lifecycle status. */
export const CREDENTIAL_STATUSES = ["active", "inactive", "revoked"] as const;
export type CredentialStatus = (typeof CREDENTIAL_STATUSES)[number];

export function isCredentialStatus(v: string): v is CredentialStatus {
  return (CREDENTIAL_STATUSES as readonly string[]).includes(v);
}

/** Reviewer decisions. */
export const REVIEWER_DECISIONS = [
  { code: "approved_for_progression", label: "Approve for progression" },
  { code: "returned_for_changes", label: "Return / request changes" },
] as const;

export type ReviewerDecision = (typeof REVIEWER_DECISIONS)[number]["code"];

export function isReviewerDecision(v: string): v is ReviewerDecision {
  return v === "approved_for_progression" || v === "returned_for_changes";
}

/** Manual-review overlay status stored on tax_cases. */
export const MANUAL_REVIEW_STATUSES = ["none", "pending", "approved", "changes_requested"] as const;
export type ManualReviewStatus = (typeof MANUAL_REVIEW_STATUSES)[number];

/**
 * The 9A blocker codes that route a case to a PROFESSIONAL sign-off — the
 * unsupported / declared-situation subset. Deliberately excludes mere profile
 * incompleteness (the preparer just fills it in) and engine-unsupported ledger
 * entries (resolved in Ledgers). Mirrors app.tax_case_requires_manual_review().
 */
export const MANUAL_REVIEW_BLOCKER_CODES: ReadonlySet<string> = new Set([
  "UNSUPPORTED_RESIDENTIAL_STATUS",
  "UNSUPPORTED_TAXPAYER_CATEGORY",
  "MANUAL_PROFESSIONAL_REVIEW_REQUIRED",
]);

/** True when the case's eligibility result includes a manual-review blocker. */
export function requiresManualReview(result: EligibilityResult): boolean {
  return result.blockers.some((b) => MANUAL_REVIEW_BLOCKER_CODES.has(b.code));
}

/** The concrete manual-review blockers, in the evaluator's deterministic order. */
export function manualReviewBlockers(result: EligibilityResult) {
  return result.blockers.filter((b) => MANUAL_REVIEW_BLOCKER_CODES.has(b.code));
}

/** Max length of a reviewer decision reason (screened + capped at the action). */
export const REVIEWER_REASON_MAX = 1000;

/**
 * Can a new sign-off decision be recorded for a case in this manual-review
 * status? An already-approved case is terminal (no re-decide); every other
 * status (none / pending / changes_requested) can receive a decision.
 */
export function canRecordSignoff(status: ManualReviewStatus | string): boolean {
  return status !== "approved";
}

/** Reason a sign-off cannot be recorded right now (or null if it can). */
export function signoffDecisionBlockedReason(input: {
  requiresReview: boolean;
  finalized: boolean;
  status: ManualReviewStatus | string;
  isActiveReviewer: boolean;
  isPreparer: boolean;
}): string | null {
  if (input.finalized) return "This case is finalized. Manual review is read-only.";
  if (!input.requiresReview) return "This case does not require qualified-reviewer sign-off.";
  if (!canRecordSignoff(input.status)) return "This case already has a completed reviewer sign-off.";
  if (!input.isActiveReviewer) return "You are not an active qualified reviewer.";
  if (input.isPreparer)
    return "A reviewer cannot sign off on a case they prepared (separation of duties).";
  return null;
}

/** One-line manual-review status summary for a banner/pill. */
export function manualReviewBanner(
  status: ManualReviewStatus | string,
): { tone: "ok" | "warn" | "danger" | "neutral"; text: string } {
  switch (status) {
    case "approved":
      return { tone: "ok", text: "Reviewer signed off — approved for progression." };
    case "changes_requested":
      return { tone: "danger", text: "Reviewer returned the case — changes requested." };
    case "pending":
      return { tone: "warn", text: "Awaiting qualified-reviewer sign-off." };
    default:
      return { tone: "warn", text: "Requires qualified-reviewer sign-off." };
  }
}
