"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { REVIEWER_REASON_MAX } from "@/lib/tax-desk/reviewer";
import { checkCaseNotFinalized } from "@/lib/tax-desk-server/finalization";

/**
 * Manual professional review / reviewer sign-off actions (K.2.8.9B). STAFF/ADMIN
 * (RLS + the guarded RPCs enforce authorization). Every write goes through a
 * SECURITY DEFINER RPC that re-asserts reviewer qualification, active status,
 * allowed case state, self-review prevention and required reason in the database
 * — this layer is defense-in-depth + audits DENIED attempts.
 *
 * A reviewer approval AUTHORIZES manual handling and is recorded immutably; it
 * does NOT flip the K.2.8.9A computation eligibility gate.
 */

type ActionResult = { ok: boolean; error?: string };

const reasonSchema = z.preprocess(
  (v) => (v === "" || v === null ? undefined : v),
  z.string().trim().max(REVIEWER_REASON_MAX, "Keep the reason under 1000 characters.").optional(),
);

const assignSchema = z.object({
  taxCaseId: z.string().uuid(),
  reviewerId: z.string().uuid(),
});

const signoffSchema = z.object({
  taxCaseId: z.string().uuid(),
  decision: z.enum(["approved_for_progression", "returned_for_changes"]),
  reason: reasonSchema,
});

function revalidate(taxCaseId: string) {
  revalidatePath(`/tax-desk/cases/${taxCaseId}/manual-review`);
  revalidatePath(`/tax-desk/cases/${taxCaseId}`);
}

async function loadCaseMeta(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  taxCaseId: string,
): Promise<{ caseId: string; finalized: boolean } | null> {
  const { data } = await supabase.from("tax_cases").select("case_id, finalized_at").eq("id", taxCaseId).maybeSingle();
  if (!data) return null;
  return { caseId: data.case_id as string, finalized: !!data.finalized_at };
}

/** Assign a case that requires manual review to a qualified, active reviewer. */
export async function assignCaseReviewerAction(input: unknown): Promise<ActionResult> {
  await requireUser();
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const d = parsed.data;

  const supabase = await createServerClient();
  const meta = await loadCaseMeta(supabase, d.taxCaseId);
  if (!meta) return { ok: false, error: "Tax case not found." };
  const mutable = checkCaseNotFinalized(meta.finalized, "This tax case is finalized. Manual review is read-only.");
  if (!mutable.ok) return { ok: false, error: mutable.error };

  const { error } = await supabase.rpc("assign_case_reviewer", {
    p_tax_case_id: d.taxCaseId,
    p_reviewer_id: d.reviewerId,
    p_event_id: crypto.randomUUID(),
  });
  if (error) {
    if (/not require manual/i.test(error.message ?? "")) {
      return { ok: false, error: "This case does not require qualified-reviewer sign-off." };
    }
    if (/active qualified reviewer/i.test(error.message ?? "")) {
      return { ok: false, error: "The selected reviewer is not an active qualified reviewer." };
    }
    if (/completed reviewer sign-off/i.test(error.message ?? "")) {
      return { ok: false, error: "This case already has a completed reviewer sign-off." };
    }
    return { ok: false, error: "Could not assign the reviewer." };
  }

  revalidate(d.taxCaseId);
  return { ok: true };
}

/**
 * Record a qualified reviewer's decision (approve-for-progression or
 * return/request-changes). The RPC enforces qualification, self-review, state
 * and the required reason. A DENIED attempt is audited here (the raising RPC
 * rolls back its own transaction, so the record is written by the action).
 */
export async function recordReviewerSignoffAction(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = signoffSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const supabase = await createServerClient();
  const meta = await loadCaseMeta(supabase, d.taxCaseId);
  if (!meta) return { ok: false, error: "Tax case not found." };
  const mutable = checkCaseNotFinalized(meta.finalized, "This tax case is finalized. Manual review is read-only.");
  if (!mutable.ok) return { ok: false, error: mutable.error };

  if (d.decision === "returned_for_changes" && !d.reason) {
    return { ok: false, error: "A reason is required when returning a case for changes." };
  }

  const { error } = await supabase.rpc("record_reviewer_signoff", {
    p_tax_case_id: d.taxCaseId,
    p_decision: d.decision,
    p_reason: d.reason ?? null,
    p_event_id: crypto.randomUUID(),
  });

  if (error) {
    const msg = error.message ?? "";
    // Classify the denial for a stable audit record + a clear user message.
    let denialCode = "unknown";
    let userError = "Could not record the reviewer decision.";
    if (/not an active qualified reviewer/i.test(msg)) {
      denialCode = "not_qualified_reviewer";
      userError = "You are not an active qualified reviewer.";
    } else if (/separation of duties|they prepared/i.test(msg)) {
      denialCode = "self_review";
      userError = "A reviewer cannot sign off on a case they prepared (separation of duties).";
    } else if (/not require manual/i.test(msg)) {
      denialCode = "review_not_required";
      userError = "This case does not require qualified-reviewer sign-off.";
    } else if (/completed reviewer sign-off/i.test(msg)) {
      denialCode = "already_approved";
      userError = "This case already has a completed reviewer sign-off.";
    } else if (/reason is required/i.test(msg)) {
      denialCode = "reason_required";
      userError = "A reason is required when returning a case for changes.";
    }

    await audit({
      actor: user,
      action: "tax_manual_review.signoff_denied",
      entityType: "tax_cases",
      entityId: d.taxCaseId,
      caseId: meta.caseId,
      after: { tax_case_id: d.taxCaseId, decision: d.decision, denial_code: denialCode },
    });

    return { ok: false, error: userError };
  }

  revalidate(d.taxCaseId);
  return { ok: true };
}
