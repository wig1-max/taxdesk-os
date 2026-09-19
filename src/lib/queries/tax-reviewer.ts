import { createClient as createServerClient } from "@/lib/supabase/server";
import { getTaxCaseEligibility } from "@/lib/queries/tax-eligibility";
import {
  requiresManualReview,
  manualReviewBlockers,
  signoffDecisionBlockedReason,
  type ManualReviewStatus,
} from "@/lib/tax-desk/reviewer";
import type { EligibilityBlocker } from "@/lib/tax-desk/eligibility";
import type { SessionUser } from "@/lib/auth";

/**
 * Manual-review / reviewer sign-off loaders (K.2.8.9B). All reads run with the
 * SESSION client (RLS staff/admin). Credential-sensitive fields are never
 * selected here — staff surfaces read the reference-free curated views
 * (qualified_reviewers, tax_case_review_history), admins read the base tables
 * elsewhere. No PAN / Aadhaar / notes.
 */

export interface QualifiedReviewer {
  credentialId: string;
  userId: string;
  fullName: string;
  email: string;
  qualification: string;
  status: string;
}

export interface CaseReviewHistoryRow {
  id: string;
  reviewerId: string;
  reviewerName: string;
  qualification: string;
  decision: string;
  reason: string | null;
  blocker: string | null;
  createdAt: string;
}

export interface ManualReviewView {
  taxCaseId: string;
  caseId: string;
  clientName: string;
  finalized: boolean;
  /** Manual-review blockers from the 9A evaluator (why review is required). */
  requiresReview: boolean;
  reviewBlockers: EligibilityBlocker[];
  status: ManualReviewStatus;
  assignedReviewerId: string | null;
  assignedReviewerName: string | null;
  decidedAt: string | null;
  history: CaseReviewHistoryRow[];
  /** Active qualified reviewers available to assign / select. */
  reviewers: QualifiedReviewer[];
  /** Whether the CURRENT user may record a sign-off (active reviewer, not the
   *  preparer, allowed state) — and, if not, the reason. */
  canSignoff: boolean;
  signoffBlockedReason: string | null;
  currentUserIsActiveReviewer: boolean;
  currentUserIsPreparer: boolean;
}

const MR_SELECT =
  "id, case_id, finalized_at, manual_review_status, manual_review_reviewer_id, " +
  "manual_review_decided_at, reviewer_id, assigned_staff_id, taxpayer_profile_updated_by, " +
  "clients:client_id(full_name)";

export async function getManualReviewView(
  taxCaseId: string,
  user: SessionUser,
): Promise<ManualReviewView | null> {
  const supabase = await createServerClient();

  const { data: tc } = await supabase.from("tax_cases").select(MR_SELECT).eq("id", taxCaseId).maybeSingle();
  if (!tc) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = tc as any;

  const eligibility = await getTaxCaseEligibility(taxCaseId);
  const requiresReview = !!eligibility && requiresManualReview(eligibility.result);
  const reviewBlockers = eligibility ? manualReviewBlockers(eligibility.result) : [];

  // Latest snapshot creator — part of the "preparer" set for self-review checks.
  const { data: latestSnap } = await supabase
    .from("tax_computation_snapshots")
    .select("created_by")
    .eq("tax_case_id", taxCaseId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const [{ data: reviewersRaw }, { data: historyRaw }, { data: myCred }] = await Promise.all([
    supabase
      .from("qualified_reviewers")
      .select("credential_id, user_id, full_name, email, qualification, status")
      .eq("status", "active")
      .order("full_name"),
    supabase
      .from("tax_case_review_history")
      .select("id, reviewer_id, reviewer_name, reviewer_qualification_snapshot, decision, reason, eligibility_blocker_at_review, created_at")
      .eq("tax_case_id", taxCaseId)
      .order("created_at", { ascending: false }),
    supabase.from("qualified_reviewers").select("user_id, status").eq("user_id", user.id).eq("status", "active").maybeSingle(),
  ]);

  const reviewers: QualifiedReviewer[] = ((reviewersRaw ?? []) as Record<string, unknown>[]).map((r) => ({
    credentialId: r.credential_id as string,
    userId: r.user_id as string,
    fullName: r.full_name as string,
    email: r.email as string,
    qualification: r.qualification as string,
    status: r.status as string,
  }));

  const history: CaseReviewHistoryRow[] = ((historyRaw ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    reviewerId: r.reviewer_id as string,
    reviewerName: r.reviewer_name as string,
    qualification: r.reviewer_qualification_snapshot as string,
    decision: r.decision as string,
    reason: (r.reason as string | null) ?? null,
    blocker: (r.eligibility_blocker_at_review as string | null) ?? null,
    createdAt: r.created_at as string,
  }));

  const status = (t.manual_review_status ?? "none") as ManualReviewStatus;
  const finalized = !!t.finalized_at;
  const assignedReviewerId = (t.reviewer_id as string | null) ?? null;
  const assignedReviewerName = assignedReviewerId
    ? reviewers.find((r) => r.userId === assignedReviewerId)?.fullName ?? null
    : null;

  const preparerSet = new Set(
    [t.assigned_staff_id, t.taxpayer_profile_updated_by, latestSnap?.created_by].filter(Boolean) as string[],
  );
  const currentUserIsPreparer = preparerSet.has(user.id);
  const currentUserIsActiveReviewer = !!myCred;

  const signoffBlockedReason = signoffDecisionBlockedReason({
    requiresReview,
    finalized,
    status,
    isActiveReviewer: currentUserIsActiveReviewer,
    isPreparer: currentUserIsPreparer,
  });

  return {
    taxCaseId: t.id,
    caseId: t.case_id,
    clientName: t.clients?.full_name ?? "—",
    finalized,
    requiresReview,
    reviewBlockers,
    status,
    assignedReviewerId,
    assignedReviewerName,
    decidedAt: (t.manual_review_decided_at as string | null) ?? null,
    history,
    reviewers,
    canSignoff: signoffBlockedReason === null,
    signoffBlockedReason,
    currentUserIsActiveReviewer,
    currentUserIsPreparer,
  };
}

export interface ReviewerCredentialRow {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  qualification: string;
  credentialReference: string | null;
  status: string;
  revokedReason: string | null;
  updatedAt: string;
}

export interface AssignableUser {
  id: string;
  fullName: string;
  email: string;
  role: string;
}

/**
 * Admin credential-management data. Reads the ADMIN-ONLY base table (RLS gates it
 * to admins), so the credential reference is included for the management view.
 */
export async function getReviewerCredentialsAdmin(): Promise<{
  credentials: ReviewerCredentialRow[];
  users: AssignableUser[];
}> {
  const supabase = await createServerClient();

  const [{ data: credsRaw }, { data: usersRaw }] = await Promise.all([
    supabase
      .from("tax_reviewer_credentials")
      .select("id, user_id, qualification, credential_reference, status, revoked_reason, updated_at, users:user_id(full_name, email)")
      .order("updated_at", { ascending: false }),
    supabase
      .from("users")
      .select("id, full_name, email, role")
      .is("deleted_at", null)
      .eq("is_active", true)
      .order("full_name"),
  ]);

  const credentials: ReviewerCredentialRow[] = ((credsRaw ?? []) as Record<string, unknown>[]).map((c) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const u = (c as any).users;
    return {
      id: c.id as string,
      userId: c.user_id as string,
      fullName: u?.full_name ?? "—",
      email: u?.email ?? "—",
      qualification: c.qualification as string,
      credentialReference: (c.credential_reference as string | null) ?? null,
      status: c.status as string,
      revokedReason: (c.revoked_reason as string | null) ?? null,
      updatedAt: c.updated_at as string,
    };
  });

  const users: AssignableUser[] = ((usersRaw ?? []) as Record<string, unknown>[]).map((u) => ({
    id: u.id as string,
    fullName: u.full_name as string,
    email: u.email as string,
    role: u.role as string,
  }));

  return { credentials, users };
}
