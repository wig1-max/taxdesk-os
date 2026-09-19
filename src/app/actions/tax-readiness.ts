"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeTaxCaseReadiness } from "@/lib/queries/tax-readiness";
import { WITHHOLDING_BLOCKER_CODES } from "@/lib/tax-desk/eligibility";
import type { FilingReadinessModel } from "@/lib/tax-desk/filing-readiness";
import { finalizationNoteSchema, reopenReasonSchema } from "@/lib/validation/tax-case";
import { checkCaseNotFinalized } from "@/lib/tax-desk-server/finalization";

/**
 * Filing Readiness + internal finalization / reopen actions (K.2.8).
 *
 * STAFF/ADMIN via RLS (session client). Every mutating decision recomputes
 * readiness server-side — browser-supplied blocker counts, statuses, snapshot
 * ids and approval freshness are NEVER trusted. "Finalized" locks the internal
 * TaxDesk OS preparation record; it does NOT file the return or set filing_status.
 */

type ActionResult = { ok: boolean; error?: string };
type RefreshResult = ActionResult & {
  counts?: { blocked: number; warning: number; passed: number; notApplicable: number };
  overall?: string;
};

const idSchema = z.object({ taxCaseId: z.string().uuid() });

function revalidate(taxCaseId: string) {
  revalidatePath(`/tax-desk/cases/${taxCaseId}/readiness`);
  revalidatePath(`/tax-desk/cases/${taxCaseId}`);
}

/**
 * Upsert current readiness items (deterministic identity: tax_case_id + code)
 * and mark any previously-persisted item no longer produced as not_applicable.
 * Never appends duplicates; repeated refresh is stable.
 */
async function persistReadinessItems(
  taxCaseId: string,
  model: FilingReadinessModel,
): Promise<boolean> {
  // Readiness items are engine-derived and written server-only: authenticated
  // INSERT/UPDATE on tax_readiness_items is revoked (K.2.8.8B), so direct
  // PostgREST cannot forge a "passed" item. The rows here are recomputed from
  // live ledger data by computeTaxCaseReadiness — never a client payload.
  const supabase = createAdminClient();
  const nowIso = new Date().toISOString();
  const rows = model.items.map((i) => ({
    tax_case_id: taxCaseId,
    code: i.itemKey,
    label: i.title,
    category: i.category,
    status: i.status,
    is_blocking: i.isBlocking,
    details: i.details,
    last_checked_at: nowIso,
    rules_version: i.rulesVersion,
    blocked_by_finding_ids:
      i.itemKey === "validation.no_open_blockers" && Array.isArray(i.details.findingIds)
        ? (i.details.findingIds as string[])
        : [],
  }));
  const { error } = await supabase.from("tax_readiness_items").upsert(rows, { onConflict: "tax_case_id,code" });
  if (error) return false;

  // Mark obsolete rule rows (not in the current catalogue) as not_applicable.
  const currentKeys = new Set(model.items.map((i) => i.itemKey));
  const { data: existing } = await supabase
    .from("tax_readiness_items")
    .select("code")
    .eq("tax_case_id", taxCaseId);
  const obsolete = (existing ?? []).map((r) => r.code).filter((c) => !currentKeys.has(c));
  if (obsolete.length > 0) {
    await supabase
      .from("tax_readiness_items")
      .update({ status: "not_applicable", is_blocking: false, last_checked_at: nowIso })
      .eq("tax_case_id", taxCaseId)
      .in("code", obsolete);
  }
  return true;
}

/** Recompute + persist readiness items. Blocked on finalized cases (read-only). */
export async function refreshTaxReadinessAction(input: unknown): Promise<RefreshResult> {
  const user = await requireUser();
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  const computed = await computeTaxCaseReadiness(parsed.data.taxCaseId);
  if (!computed) return { ok: false, error: "Tax case not found." };
  const mutable = checkCaseNotFinalized(
    !!computed.model.case.finalizedAt,
    "This tax case is finalized. Readiness is read-only.",
  );
  if (!mutable.ok) return { ok: false, error: mutable.error };

  const ok = await persistReadinessItems(parsed.data.taxCaseId, computed.model);
  if (!ok) return { ok: false, error: "Could not save readiness items." };

  await audit({
    actor: user,
    action: "tax_readiness.refreshed",
    entityType: "tax_cases",
    entityId: parsed.data.taxCaseId,
    caseId: computed.caseId,
    after: {
      tax_case_id: parsed.data.taxCaseId,
      snapshot_id: computed.latestSnapshotId,
      overall: computed.model.overall,
      blocked: computed.model.counts.blocked,
      warning: computed.model.counts.warning,
      passed: computed.model.counts.passed,
      rules_version: computed.model.readinessRulesVersion,
      snapshot_fresh: computed.model.snapshotFresh,
      validation_fresh: computed.model.validationFresh,
    },
  });

  revalidate(parsed.data.taxCaseId);
  return { ok: true, counts: computed.model.counts, overall: computed.model.overall };
}

const finalizeSchema = z.object({
  taxCaseId: z.string().uuid(),
  note: finalizationNoteSchema,
  confirm: z.literal(true, { errorMap: () => ({ message: "Confirm that the case will become read-only." }) }),
});

/** Internally finalize an eligible case. Recomputes readiness at action time;
 *  all blocking checks must pass. Binds to the latest complete snapshot. Does
 *  NOT set filing_status to filed. */
export async function finalizeTaxCaseAction(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = finalizeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const computed = await computeTaxCaseReadiness(d.taxCaseId);
  if (!computed) return { ok: false, error: "Tax case not found." };
  const m = computed.model;
  const mutable = checkCaseNotFinalized(!!m.case.finalizedAt, "This tax case is already finalized.");
  if (!mutable.ok) return { ok: false, error: mutable.error };

  // Eligibility gate (K.2.8.9A) — audit a blocked finalize attempt with the
  // stable blocker codes before refusing. Only the profile / declared-situation
  // (withholding) blockers short-circuit here with an eligibility message; other
  // blockers (open findings, stale snapshot, docs) fall through to the existing
  // readiness-item messaging below. The DB RPC re-asserts the profile subset too.
  const eligItem = m.items.find((i) => i.itemKey === "eligibility.case_eligible");
  const eligBlockerCodes = (eligItem?.details.blockerCodes as string[] | undefined) ?? [];
  if (eligItem && eligItem.status === "blocked" && eligBlockerCodes.some((code) => WITHHOLDING_BLOCKER_CODES.has(code))) {
    await audit({
      actor: user,
      action: "tax_eligibility.progression_blocked",
      entityType: "tax_cases",
      entityId: d.taxCaseId,
      caseId: computed.caseId,
      after: {
        operation: "finalize",
        tax_case_id: d.taxCaseId,
        blocker_codes: (eligItem.details.blockerCodes as string[]) ?? [],
      },
    });
    return { ok: false, error: `Not eligible for computation yet: ${eligItem.message}` };
  }

  if (!m.capabilities.canFinalize) {
    const firstBlocker = m.items.find((i) => i.isBlocking && i.status === "blocked");
    return {
      ok: false,
      error: firstBlocker
        ? `Cannot finalize: ${firstBlocker.message}`
        : "Cannot finalize: one or more readiness checks are blocked.",
    };
  }
  if (!computed.latestSnapshotId) {
    return { ok: false, error: "Cannot finalize without a complete computation snapshot." };
  }

  // Persist the final (all-passing) readiness snapshot for the finalized view.
  await persistReadinessItems(d.taxCaseId, m);

  // Finalize atomically through the guarded RPC. It re-validates role, that the
  // case is not already finalized, that the bound snapshot is complete for this
  // case, and that there are zero open blocking findings — then writes the
  // finalize columns + audit event in ONE transaction as the least-privilege
  // app_writer role. Direct authenticated writes to the finalize columns are
  // revoked (K.2.8.8B), so this is the only path.
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("finalize_tax_case", {
    p_tax_case_id: d.taxCaseId,
    p_snapshot_id: computed.latestSnapshotId,
    p_note: d.note,
    p_confirm: true,
    p_event_id: crypto.randomUUID(),
  });
  if (error) {
    const msg = error.message ?? "";
    if (/already finalized/i.test(msg)) return { ok: false, error: "This tax case is already finalized." };
    if (/blocking findings/i.test(msg)) {
      return { ok: false, error: "Cannot finalize: resolve all open blocking findings first." };
    }
    if (/complete computation snapshot/i.test(msg)) {
      return { ok: false, error: "Cannot finalize without a complete computation snapshot." };
    }
    if (/SURCHARGE_MARGINAL_RELIEF_UNSUPPORTED/.test(msg)) {
      return {
        ok: false,
        error: "Cannot finalize: this case's total income may attract surcharge/marginal relief, which is not implemented.",
      };
    }
    return { ok: false, error: "Could not finalize the case." };
  }

  revalidate(d.taxCaseId);
  return { ok: true };
}

const reopenSchema = z.object({
  taxCaseId: z.string().uuid(),
  reason: reopenReasonSchema,
  confirm: z.literal(true, { errorMap: () => ({ message: "Confirm the reopen (prior approval will be superseded)." }) }),
});

/** Reopen a finalized case (ADMIN ONLY). Clears the finalization lock, records
 *  reopen metadata, and conservatively supersedes the current client approval
 *  (retaining its snapshot binding + timestamps as history). Preserves all
 *  snapshots, findings and audit events. */
export async function reopenTaxCaseAction(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  if (user.role !== "admin") {
    return { ok: false, error: "Only an admin can reopen a finalized tax case." };
  }
  const parsed = reopenSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const supabase = await createServerClient();
  const { data: tc } = await supabase
    .from("tax_cases")
    .select("id, finalized_at")
    .eq("id", d.taxCaseId)
    .maybeSingle();
  if (!tc) return { ok: false, error: "Tax case not found." };
  if (!tc.finalized_at) return { ok: false, error: "This tax case is not finalized." };

  // Reopen atomically through the admin-only guarded RPC. It re-asserts
  // app.is_admin() at the database boundary (so a staff token cannot reopen
  // even by calling the RPC directly), clears the finalization lock, supersedes
  // the approval, and writes the audit event in the same transaction.
  const { error } = await supabase.rpc("reopen_tax_case", {
    p_tax_case_id: d.taxCaseId,
    p_reason: d.reason,
    p_confirm: true,
    p_event_id: crypto.randomUUID(),
  });
  if (error) {
    const msg = error.message ?? "";
    if (/only an admin/i.test(msg)) {
      return { ok: false, error: "Only an admin can reopen a finalized tax case." };
    }
    if (/not finalized/i.test(msg)) return { ok: false, error: "This tax case is not finalized." };
    return { ok: false, error: "Could not reopen the case." };
  }

  revalidate(d.taxCaseId);
  return { ok: true };
}
