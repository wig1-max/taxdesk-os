"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createClient as createServerClient } from "@/lib/supabase/server";
import {
  getEvidenceManifestWorkflowView,
  resolveDraftOutputArtifactInput,
  resolveManifestCreationInput,
} from "@/lib/queries/tax-evidence-manifest";
import { assertTaxCaseMutable } from "@/lib/tax-desk-server/finalization";

/**
 * K3-32B server actions — accepted-evidence manifest creation and guarded
 * internal draft-output generation. Every decision (regime-selective
 * reliance gate, canonical payload, sha256 hash, eligibility check) is
 * computed by the pure `src/lib/tax-desk/evidence-manifest.ts` /
 * `draft-output-artifact.ts` modules via the read models in
 * `src/lib/queries/tax-evidence-manifest.ts`; this file only validates
 * input, calls the guarded RPC, and revalidates. Both RPCs independently
 * re-derive every guard they can from live database state — this layer is
 * defense-in-depth (a precise error before the round trip), never the sole
 * enforcement.
 */

type ActionResult = { ok: boolean; error?: string; id?: string };

const createSchema = z.object({
  taxCaseId: z.string().uuid(),
  selectedRegime: z.enum(["old", "new"]),
});

function revalidate(taxCaseId: string) {
  revalidatePath(`/tax-desk/cases/${taxCaseId}/review`);
  revalidatePath(`/tax-desk/cases/${taxCaseId}`);
}

/**
 * Generate an immutable accepted-evidence manifest for the case's current
 * review-bound snapshot under an EXPLICITLY selected regime. Never defaults
 * to the recommended regime — `selectedRegime` is a required, explicit
 * staff choice from the UI (no pre-selected default).
 */
export async function createEvidenceManifestAction(input: unknown): Promise<ActionResult> {
  await requireUser();
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const { taxCaseId, selectedRegime } = parsed.data;

  // AUDIT-01-F5: this file previously had no PROACTIVE pre-check (only the
  // reactive `/finalized/i` translation below after the RPC's own rejection)
  // — the one call site among the eight that didn't fail fast. Adding it here
  // can only ever reject a case that the RPC would already reject (same
  // finalized_at column), so it closes the gap without loosening or
  // tightening what is actually allowed.
  const supabase = await createServerClient();
  const mutable = await assertTaxCaseMutable(supabase, taxCaseId, "This tax case is finalized and read-only.");
  if (!mutable.ok) return { ok: false, error: mutable.error };

  const resolved = await resolveManifestCreationInput(taxCaseId, selectedRegime);
  if (!resolved) return { ok: false, error: "Tax case or snapshot not found." };
  if (resolved.result.outcome === "refused") {
    return { ok: false, error: resolved.result.message };
  }
  if (!resolved.payload || !resolved.contentHash || !resolved.snapshotId) {
    return { ok: false, error: "Could not build the evidence manifest payload." };
  }
  const candidate = resolved.result;

  const { data, error } = await supabase.rpc("create_evidence_manifest", {
    p_tax_case_id: taxCaseId,
    p_snapshot_id: resolved.snapshotId,
    p_selected_regime: selectedRegime,
    p_manifest_payload: resolved.payload,
    p_manifest_content_hash: resolved.contentHash,
    p_validation_rules_version: resolved.validationRulesVersion,
    p_tax_pack_id: candidate.pack.key,
    p_tax_pack_version: candidate.pack.computationRulesVersion,
    p_tax_pack_lifecycle_status: candidate.pack.status,
    p_pre_approval_capability_result: candidate.preApprovalCapabilityResult,
    p_snapshot_capability_result: candidate.snapshotCapabilityResult,
    p_event_id: crypto.randomUUID(),
  });
  if (error) {
    if (/SURCHARGE_MARGINAL_RELIEF_UNSUPPORTED/.test(error.message ?? "")) {
      // AUDIT-05-F1(b): the old wording said surcharge "is not implemented for
      // this income level", which stopped being true when K4-11 implemented the
      // ₹50,00,000–₹2,00,00,000 window. A case refused here is refused because
      // the ENGINE did not report a complete treatment for it — above the
      // ceiling, marginal relief indeterminate, or a snapshot predating the
      // verdict — not because of its income level. Kept in step with the same
      // sentence in the guarded RPCs (migration 20260802120000), and naming no
      // threshold so it cannot drift when the window moves.
      return {
        ok: false,
        error: `Not eligible for an evidence manifest under the ${selectedRegime} regime: the computation engine did not report a complete surcharge / marginal-relief treatment for this case, so it must be prepared manually by a professional.`,
      };
    }
    if (/finalized/i.test(error.message ?? "")) {
      return { ok: false, error: "This tax case is finalized and read-only." };
    }
    return { ok: false, error: "Could not generate the evidence manifest." };
  }

  revalidate(taxCaseId);
  return { ok: true, id: data as string };
}

const idSchema = z.object({ taxCaseId: z.string().uuid() });

/**
 * Generate the persisted internal draft-output artifact from the case's
 * current evidence manifest. Refuses (via the guarded RPC) unless approval
 * is current for that exact manifest, the manifest carries no active
 * reliance blocker, and no open validation error/blocker exists.
 */
export async function generateInternalDraftOutputAction(input: unknown): Promise<ActionResult> {
  await requireUser();
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const { taxCaseId } = parsed.data;

  // AUDIT-01-F5: same proactive-check addition as createEvidenceManifestAction
  // above — see its comment.
  const supabase = await createServerClient();
  const mutable = await assertTaxCaseMutable(supabase, taxCaseId, "This tax case is finalized and read-only.");
  if (!mutable.ok) return { ok: false, error: mutable.error };

  const view = await getEvidenceManifestWorkflowView(taxCaseId);
  if (!view) return { ok: false, error: "Tax case not found." };
  if (!view.draftOutputEligibility.eligible) {
    return { ok: false, error: view.draftOutputEligibility.message ?? "Not eligible to generate a draft output." };
  }

  const resolved = await resolveDraftOutputArtifactInput(taxCaseId);
  if (!resolved) {
    return { ok: false, error: "Generate an evidence manifest before generating an internal draft output." };
  }

  const { data, error } = await supabase.rpc("generate_internal_draft_output", {
    p_tax_case_id: taxCaseId,
    p_manifest_id: resolved.manifestId,
    p_package_payload: resolved.package,
    p_package_content_hash: resolved.contentHash,
    p_event_id: crypto.randomUUID(),
  });
  if (error) {
    if (/not current/i.test(error.message ?? "")) {
      return { ok: false, error: "Client approval is not current for this manifest." };
    }
    if (/reliance blocker/i.test(error.message ?? "")) {
      return { ok: false, error: "This manifest carries an active reliance blocker." };
    }
    if (/open validation errors/i.test(error.message ?? "")) {
      return { ok: false, error: "Resolve open validation errors before generating a draft output." };
    }
    if (/finalized/i.test(error.message ?? "")) {
      return { ok: false, error: "This tax case is finalized and read-only." };
    }
    return { ok: false, error: "Could not generate the internal draft output." };
  }

  const row = Array.isArray(data) ? data[0] : data;
  revalidate(taxCaseId);
  return { ok: true, id: row?.draft_output_id ?? undefined };
}
