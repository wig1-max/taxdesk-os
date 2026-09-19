"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTaxCaseComputationData } from "@/lib/queries/tax-desk";
import { getTaxCaseEligibility } from "@/lib/queries/tax-eligibility";
import { computationWithheld } from "@/lib/tax-desk/eligibility";
import {
  buildEngineInput,
  hasMeaningfulInput,
} from "@/lib/tax-desk/computation-adapter";
import { bindDefaultTaxPackToCase, taxCaseStatutoryContext } from "@/lib/tax-pack";
import {
  buildStoredComputationReplayInput,
  COMPUTATION_REPLAY_CONTRACT,
} from "@/lib/tax-pack/computation-replay-input";
import { checkCaseNotFinalized } from "@/lib/tax-desk-server/finalization";

type SnapshotResult = { ok: boolean; snapshotId?: string; error?: string };

const schema = z.object({ taxCaseId: z.string().uuid() });

/**
 * Create an APPEND-ONLY computation snapshot (K.2.5).
 *
 * Safety policy (the safer of the two the spec allows): an authoritative
 * snapshot is BLOCKED while any unsupported non-zero ledger entry exists, so a
 * saved snapshot is always a complete AY 2026-27 computation. The engine is
 * ALWAYS recomputed server-side from live ledger rows — the browser's preview
 * JSON is never trusted. Notes / PAN / Aadhaar / storage URLs are never
 * persisted (they are not part of the engine input or source trace).
 */
export async function createTaxComputationSnapshotAction(input: unknown): Promise<SnapshotResult> {
  const user = await requireUser();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  const data = await getTaxCaseComputationData(parsed.data.taxCaseId);
  if (!data) return { ok: false, error: "Tax case not found." };
  const mutable = checkCaseNotFinalized(
    data.finalized,
    "This tax case is finalized. Reopen it before creating a new snapshot.",
  );
  if (!mutable.ok) return { ok: false, error: mutable.error };

  // Recompute from live ledger rows (never trust the browser).
  const adapter = buildEngineInput(data.rows, {
    assessmentYear: data.assessmentYear,
    financialYear: data.financialYear,
    selectedItrType: data.selectedItrType,
    finalized: false,
    dateOfBirth: data.dateOfBirth,
    residentialStatus: data.residentialStatus,
  });

  if (!adapter.complete) {
    return {
      ok: false,
      error:
        `Cannot save a snapshot while ${adapter.unsupportedEntryCount} unsupported entr` +
        `${adapter.unsupportedEntryCount === 1 ? "y" : "ies"} exist. ` +
        "Remove or fix them in Ledgers, then recompute.",
    };
  }
  if (!hasMeaningfulInput(adapter)) {
    return { ok: false, error: "No mapped income or tax figures to snapshot yet. Add ledger entries first." };
  }

  // Computation eligibility gate (K.2.8.9A). A COMPLETE snapshot may only be
  // created for an ELIGIBLE case — so a complete snapshot is always provable
  // evidence of eligibility-at-creation. Recomputed server-side; the browser
  // never supplies eligibility. Downstream RPCs (review/finalize) additionally
  // re-assert the profile subset live, so a snapshot cannot be relied on if the
  // profile later changes.
  // The existing checks above already reject unsupported entries + empty data;
  // this adds the NEW profile / declared-situation gate (open findings do NOT
  // block a snapshot — they block downstream approval/finalize, as before).
  const eligibility = await getTaxCaseEligibility(parsed.data.taxCaseId);
  if (!eligibility) return { ok: false, error: "Tax case not found." };
  // TAX-SAFE-03: the snapshot writer and eligibility loader must have read the
  // same load-bearing income fields. Refuse a projection drift rather than
  // persisting contradictory `complete: true` / `eligible: false` metadata.
  if (
    eligibility.adapter.complete !== adapter.complete ||
    JSON.stringify(eligibility.adapter.presumptiveActivityEligibility) !==
      JSON.stringify(adapter.presumptiveActivityEligibility)
  ) {
    return {
      ok: false,
      error: "The computation and eligibility reads disagree. Reload the case before saving a snapshot.",
    };
  }
  if (computationWithheld(eligibility.result)) {
    const first = eligibility.result.blockers.find((b) =>
      /PROFILE_|UNSUPPORTED_RESIDENTIAL|UNSUPPORTED_TAXPAYER|MANUAL_/.test(b.code),
    );
    return {
      ok: false,
      error: `Not eligible for computation yet: ${first?.message ?? "resolve the taxpayer profile."}`,
    };
  }

  // Versioned tax pack (K3-12). A stored snapshot must be SELF-DESCRIBING about
  // the pack version that produced it, so the rules version is resolved from the
  // case's statutory coordinates through the one canonical authority — never an
  // ad-hoc engine constant. A case whose coordinates resolve to no pack (or to
  // an unbound/ambiguous one) is refused rather than stamped with a guess.
  // `tax_cases.assessment_year` is DB-constrained to the supported year, so this
  // refusal cannot fire today; it is the fail-safe for the multi-pack world.
  const packBinding = bindDefaultTaxPackToCase(
    taxCaseStatutoryContext(data.assessmentYear, data.law),
  );
  if (packBinding.outcome !== "bound") {
    return { ok: false, error: `No versioned tax pack governs this case: ${packBinding.reason}` };
  }
  const rulesVersion = packBinding.versions.computationRulesVersion;

  const computation = packBinding.computation.computeTax(adapter.input);
  const comparison = packBinding.computation.compareRegimes(adapter.input);
  const recommendation = packBinding.computation.recommendItrForm(adapter.input);
  const storedEngineInput = buildStoredComputationReplayInput(adapter.input);

  // input_snapshot: normalized, NOTES-FREE engine input + trace metadata.
  const inputSnapshot = {
    assessmentYear: data.assessmentYear,
    financialYear: data.financialYear,
    selectedItrType: adapter.input.selectedItrType ?? null,
    recommendedItrType: recommendation.recommendedItrType,
    complete: adapter.complete,
    // Provable eligibility-at-creation (K.2.8.9A). A complete snapshot always
    // carries eligible: true because ineligible cases are rejected above.
    eligibility: {
      eligible: eligibility.result.eligible,
      version: eligibility.result.version,
      blockerCodes: eligibility.result.blockers.map((b) => b.code),
    },
    warningCodes: [...new Set(adapter.warnings.map((w) => w.code))],
    excludedLedgerIds: adapter.excludedLedgerIds,
    mappedEntryCount: adapter.mappedEntryCount,
    unsupportedEntryCount: adapter.unsupportedEntryCount,
    summary: adapter.summary,
    sourceTrace: adapter.sourceTrace,
    // Complete notes-free input for deterministic computation replay. The
    // adjacent contract states why validation replay is intentionally partial.
    engineInputReplay: COMPUTATION_REPLAY_CONTRACT,
    engineInput: {
      ...storedEngineInput,
      // TAX-SAFE-03: produced by this exact adapter run from authoritative
      // live rows; never accepted from the browser.
      presumptiveActivityEligibility: adapter.presumptiveActivityEligibility,
    },
  };
  const outputSnapshot = { computation, comparison, recommendation };

  // Snapshots are append-only evidence recomputed server-side from live ledger
  // data. Authenticated INSERT is revoked (K.2.8.8B) so a staff token cannot
  // forge a snapshot (e.g. a fake `complete:true` to unlock finalize) via direct
  // PostgREST; the write goes through the server-only service role.
  const supabase = createAdminClient();
  const { data: row, error } = await supabase
    .from("tax_computation_snapshots")
    .insert({
      tax_case_id: data.taxCaseId,
      rules_version: rulesVersion,
      input_snapshot: inputSnapshot,
      output_snapshot: outputSnapshot,
      is_final: false,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !row) return { ok: false, error: "Could not save the snapshot." };

  await audit({
    actor: user,
    action: "tax_computation.snapshot_created",
    entityType: "tax_computation_snapshots",
    entityId: row.id,
    caseId: data.caseId,
    after: {
      tax_case_id: data.taxCaseId,
      snapshot_id: row.id,
      engine_version: rulesVersion,
      selected_regime: computation.recommendedRegime,
      recommended_itr: recommendation.recommendedItrType,
      complete: adapter.complete,
      mapped_entry_count: adapter.mappedEntryCount,
      unsupported_entry_count: adapter.unsupportedEntryCount,
    },
  });

  revalidatePath(`/tax-desk/cases/${data.taxCaseId}/computation`);
  return { ok: true, snapshotId: row.id };
}
