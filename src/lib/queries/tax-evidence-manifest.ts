import { createClient as createServerClient } from "@/lib/supabase/server";
import {
  buildManifestPayload,
  computeManifestContentHash,
  isApprovalCurrentForManifest,
  manifestStatutoryContextForSnapshot,
  resolveEvidenceManifestCandidate,
  type EvidenceManifestResult,
  type ManifestPayload,
  type SourceDocumentHashLookup,
} from "@/lib/tax-desk/evidence-manifest";
import {
  buildDraftOutputArtifactPackage,
  checkDraftOutputEligibility,
  computeDraftOutputArtifactContentHash,
  type DraftOutputArtifactPackage,
  type DraftOutputEligibilityCheck,
} from "@/lib/tax-desk/draft-output-artifact";
import {
  normalizeStoredEngineInputPayload,
  type StoredEngineInputPayload,
  type StoredSnapshotForDraftOutput,
} from "@/lib/tax-desk/draft-output";
import { taxpayerAgeBandOrNull } from "@/lib/tax-desk/senior-treatment";
import type { Regime } from "@/lib/tax-engine/ay-2026-27/types";
import { getPromotedProposalLineage } from "./tax-source-proposals";

/**
 * K3-32B read models for the accepted-evidence manifest + persisted internal
 * draft-output workflow. Session-scoped Supabase client (RLS applies) —
 * mirrors `tax-draft-output.ts` (K3-32) and `tax-source-proposals.ts`
 * (K3-30). All decision logic (regime-selective capability gate, canonical
 * serialization, sha256 hash, eligibility checks) lives in
 * `src/lib/tax-desk/evidence-manifest.ts` / `draft-output-artifact.ts` — this
 * file only loads rows and hands them over.
 */

export interface EvidenceManifestSummary {
  readonly id: string;
  readonly computationSnapshotId: string;
  readonly selectedRegime: Regime;
  readonly selectedRegimeTotalIncome: number;
  readonly preApprovalConservativeTotalIncome: number | null;
  readonly manifestContentHash: string;
  readonly activeBlockerCodes: readonly string[];
  /** K4-01 — read from the manifest's own frozen payload (never re-derived):
   *  the taxpayer's age band + residential status as evaluated at manifest-
   *  creation time, and whether the pre-approval regime comparison was
   *  disclosed as unreliable for this taxpayer. `seniorTreatmentSelectedRegimeRiskCode`
   *  is always `null` for a persisted manifest — a blocked evaluation is
   *  refused before a manifest is ever created. */
  readonly seniorTreatmentAgeBand: string | null;
  readonly seniorTreatmentResidentialStatus: string | null;
  readonly seniorTreatmentSelectedRegimeRiskCode: string | null;
  readonly seniorTreatmentComparisonUnreliable: boolean;
  readonly taxPackId: string;
  readonly taxPackVersion: string;
  readonly taxPackLifecycleStatus: string;
  readonly createdAt: string;
  readonly createdByName: string | null;
}

export interface DraftOutputArtifactSummary {
  readonly id: string;
  readonly sourceSnapshotId: string;
  readonly sourceManifestId: string;
  readonly sourceManifestHash: string;
  readonly packageContentHash: string;
  readonly status: string;
  readonly createdAt: string;
  readonly createdByName: string | null;
  readonly package: DraftOutputArtifactPackage;
}

export interface EvidenceManifestWorkflowView {
  readonly taxCaseId: string;
  readonly finalized: boolean;
  readonly latestCompleteSnapshot: {
    readonly id: string;
    readonly createdAt: string;
    readonly oldRegimeTotalIncome: number | null;
    readonly newRegimeTotalIncome: number | null;
  } | null;
  /** The snapshot the review pack currently binds to — a manifest may only
   *  be generated for THIS snapshot (staff must Prepare the review pack
   *  first). `null` when no review pack has been prepared yet. */
  readonly reviewSnapshotId: string | null;
  readonly manifests: readonly EvidenceManifestSummary[];
  readonly latestManifest: EvidenceManifestSummary | null;
  readonly review: {
    readonly status: string;
    readonly reviewSnapshotId: string | null;
    readonly reviewManifestId: string | null;
  };
  /** Whether the CURRENT client approval is bound to `latestManifest`. */
  readonly approvalCurrentForLatestManifest: boolean;
  readonly openValidationBlockerCount: number;
  readonly draftOutputs: readonly DraftOutputArtifactSummary[];
  readonly draftOutputEligibility: DraftOutputEligibilityCheck;
}

function mapManifestRow(row: {
  id: string;
  computation_snapshot_id: string;
  selected_regime: string;
  selected_regime_total_income: number | string;
  pre_approval_conservative_total_income: number | string | null;
  manifest_content_hash: string;
  active_blocker_codes: string[] | null;
  tax_pack_id: string;
  tax_pack_version: string;
  tax_pack_lifecycle_status: string;
  created_at: string;
  created_by_name: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  manifest_payload: any;
}): EvidenceManifestSummary {
  const payload = row.manifest_payload ?? {};
  return {
    id: row.id,
    computationSnapshotId: row.computation_snapshot_id,
    selectedRegime: row.selected_regime as Regime,
    selectedRegimeTotalIncome: Number(row.selected_regime_total_income),
    preApprovalConservativeTotalIncome:
      row.pre_approval_conservative_total_income === null ? null : Number(row.pre_approval_conservative_total_income),
    manifestContentHash: row.manifest_content_hash,
    activeBlockerCodes: row.active_blocker_codes ?? [],
    seniorTreatmentAgeBand: payload.seniorTreatmentAgeBand ?? null,
    seniorTreatmentResidentialStatus: payload.seniorTreatmentResidentialStatus ?? null,
    seniorTreatmentSelectedRegimeRiskCode: payload.seniorTreatmentSelectedRegimeRiskCode ?? null,
    seniorTreatmentComparisonUnreliable: payload.seniorTreatmentComparisonUnreliable === true,
    taxPackId: row.tax_pack_id,
    taxPackVersion: row.tax_pack_version,
    taxPackLifecycleStatus: row.tax_pack_lifecycle_status,
    createdAt: row.created_at,
    createdByName: row.created_by_name,
  };
}

/** Load the everything-the-UI-needs view for the evidence-manifest + draft-
 *  output panel on the Client Review page. Returns `null` when the case does
 *  not exist. */
export async function getEvidenceManifestWorkflowView(taxCaseId: string): Promise<EvidenceManifestWorkflowView | null> {
  const supabase = await createServerClient();
  const { data: tc } = await supabase
    .from("tax_cases")
    .select(
      "id, finalized_at, client_review_status, client_review_snapshot_id, client_review_manifest_id",
    )
    .eq("id", taxCaseId)
    .maybeSingle();
  if (!tc) return null;

  const [{ data: manifestRows }, { data: snap }, { count: openValidationBlockerCount }, { data: draftRows }] =
    await Promise.all([
      supabase
        .from("tax_evidence_manifests")
        .select(
          "id, computation_snapshot_id, selected_regime, selected_regime_total_income, " +
            "pre_approval_conservative_total_income, manifest_content_hash, active_blocker_codes, " +
            "tax_pack_id, tax_pack_version, tax_pack_lifecycle_status, created_at, created_by:users!created_by(full_name), " +
            "manifest_payload",
        )
        .eq("tax_case_id", taxCaseId)
        .order("created_at", { ascending: false }),
      tc.client_review_snapshot_id
        ? supabase
            .from("tax_computation_snapshots")
            .select("id, created_at, output_snapshot")
            .eq("id", tc.client_review_snapshot_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("tax_validation_findings")
        .select("id", { count: "exact", head: true })
        .eq("tax_case_id", taxCaseId)
        .eq("status", "open")
        .in("severity", ["error", "blocker"]),
      supabase
        .from("tax_draft_outputs")
        .select(
          "id, source_snapshot_id, source_manifest_id, source_manifest_hash, package_payload, " +
            "package_content_hash, status, created_at, created_by:users!created_by(full_name)",
        )
        .eq("tax_case_id", taxCaseId)
        .order("created_at", { ascending: false }),
    ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const manifests = ((manifestRows ?? []) as any[]).map((r) =>
    mapManifestRow({ ...r, created_by_name: r.created_by?.full_name ?? null }),
  );
  const latestManifest = manifests[0] ?? null;

  const review = {
    status: tc.client_review_status ?? "not_started",
    reviewSnapshotId: tc.client_review_snapshot_id ?? null,
    reviewManifestId: tc.client_review_manifest_id ?? null,
  };
  const approvalCurrentForLatestManifest = latestManifest
    ? isApprovalCurrentForManifest(review, latestManifest.computationSnapshotId, latestManifest.id)
    : false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const output = (snap?.output_snapshot ?? null) as any;
  const latestCompleteSnapshot = snap
    ? {
        id: snap.id,
        createdAt: snap.created_at,
        oldRegimeTotalIncome: output?.computation?.oldRegime?.totalIncome?.value ?? null,
        newRegimeTotalIncome: output?.computation?.newRegime?.totalIncome?.value ?? null,
      }
    : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const draftOutputs: DraftOutputArtifactSummary[] = ((draftRows ?? []) as any[]).map((r) => ({
    id: r.id,
    sourceSnapshotId: r.source_snapshot_id,
    sourceManifestId: r.source_manifest_id,
    sourceManifestHash: r.source_manifest_hash,
    packageContentHash: r.package_content_hash,
    status: r.status,
    createdAt: r.created_at,
    createdByName: r.created_by?.full_name ?? null,
    package: r.package_payload as DraftOutputArtifactPackage,
  }));

  const draftOutputEligibility = checkDraftOutputEligibility({
    finalized: !!tc.finalized_at,
    manifest: latestManifest
      ? { id: latestManifest.id, snapshotId: latestManifest.computationSnapshotId, activeBlockerCodes: latestManifest.activeBlockerCodes }
      : null,
    review,
    openValidationBlockerCount: openValidationBlockerCount ?? 0,
  });

  return {
    taxCaseId,
    finalized: !!tc.finalized_at,
    latestCompleteSnapshot,
    reviewSnapshotId: tc.client_review_snapshot_id ?? null,
    manifests,
    latestManifest,
    review,
    approvalCurrentForLatestManifest,
    openValidationBlockerCount: openValidationBlockerCount ?? 0,
    draftOutputs,
    draftOutputEligibility,
  };
}

/** Everything the create-manifest server action needs to build a candidate
 *  payload for one explicitly selected regime, resolved against the case's
 *  CURRENT review-bound snapshot (`client_review_snapshot_id` — set only by
 *  `prepare_client_review`). Returns `null` when the case or its review
 *  snapshot cannot be found. */
export async function resolveManifestCreationInput(
  taxCaseId: string,
  selectedRegime: Regime,
): Promise<{
  readonly result: EvidenceManifestResult;
  readonly snapshotId: string | null;
  readonly payload: ManifestPayload | null;
  readonly contentHash: string | null;
  readonly validationRulesVersion: string;
} | null> {
  const supabase = await createServerClient();
  const { data: tcRow } = await supabase
    .from("tax_cases")
    .select(
      "id, assessment_year, financial_year, client_review_snapshot_id, validation_rules_version, " +
        "residential_status, clients:client_id(date_of_birth)",
    )
    .eq("id", taxCaseId)
    .maybeSingle();
  if (!tcRow) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tc = tcRow as any;
  // K4-01: the taxpayer's age band + residential status, evaluated fresh from
  // the CURRENT profile — never reconstructed from the snapshot's stored
  // engine input (which never persisted it).
  const dateOfBirth: string | null = tc.clients?.date_of_birth ?? null;
  const residentialStatus: string | null = tc.residential_status ?? null;
  const ageBand = taxpayerAgeBandOrNull(dateOfBirth, tc.assessment_year);
  if (!tc.client_review_snapshot_id) {
    return {
      result: {
        outcome: "refused",
        reason: "regime_not_selected",
        message: "Prepare the review pack before generating an evidence manifest.",
        blocker: null,
        seniorTreatmentResult: null,
      },
      snapshotId: null,
      payload: null,
      contentHash: null,
      validationRulesVersion: tc.validation_rules_version ?? "unknown",
    };
  }

  const [{ data: snap }, promotedProposals] = await Promise.all([
    supabase
      .from("tax_computation_snapshots")
      .select("id, rules_version, created_at, input_snapshot, output_snapshot")
      .eq("id", tc.client_review_snapshot_id)
      .eq("tax_case_id", taxCaseId)
      .maybeSingle(),
    getPromotedProposalLineage(taxCaseId),
  ]);
  if (!snap) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const input = (snap.input_snapshot ?? {}) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const output = (snap.output_snapshot ?? {}) as any;
  const engineInput: StoredEngineInputPayload = normalizeStoredEngineInputPayload(
    input.engineInput,
    { assessmentYear: tc.assessment_year, financialYear: tc.financial_year },
  );
  const storedSnapshot: StoredSnapshotForDraftOutput = {
    id: snap.id,
    createdAt: snap.created_at,
    complete: input.complete === true,
    assessmentYear: input.assessmentYear ?? tc.assessment_year,
    financialYear: input.financialYear ?? tc.financial_year,
    selectedItrType: input.selectedItrType ?? null,
    recommendedItrType: input.recommendedItrType ?? output.recommendation?.recommendedItrType ?? "ITR-1",
    engineInput,
    computation: output.computation,
    comparison: output.comparison,
    recommendation: output.recommendation,
  };

  const result = resolveEvidenceManifestCandidate({
    taxCaseId,
    statutory: manifestStatutoryContextForSnapshot(
      tc.assessment_year,
      snap.rules_version,
    ),
    snapshot: storedSnapshot,
    selectedRegime,
    promotedProposals,
    ageBand,
    residentialStatus,
  });

  const validationRulesVersion = tc.validation_rules_version ?? "unknown";
  if (result.outcome !== "candidate") {
    return { result, snapshotId: storedSnapshot.id, payload: null, contentHash: null, validationRulesVersion };
  }

  const sourceTypeByLedgerId = new Map<string, string>();
  for (const e of engineInput.income) sourceTypeByLedgerId.set(e.id, e.sourceType);
  for (const e of engineInput.taxPaid) sourceTypeByLedgerId.set(e.id, e.sourceType);

  const sourceDocIds = [...new Set(result.evidence.facts.map((f) => f.sourceDocumentId).filter((v): v is string => !!v))];
  const sourceDocumentHashes: SourceDocumentHashLookup = await loadSourceDocumentHashes(supabase, sourceDocIds);

  const payload = buildManifestPayload(result, { validationRulesVersion, sourceTypeByLedgerId, sourceDocumentHashes });
  const contentHash = computeManifestContentHash(payload);

  return { result, snapshotId: storedSnapshot.id, payload, contentHash, validationRulesVersion };
}

async function loadSourceDocumentHashes(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  caseDocumentIds: readonly string[],
): Promise<SourceDocumentHashLookup> {
  const hashes = new Map<string, string>();
  if (caseDocumentIds.length === 0) return hashes;
  const { data } = await supabase
    .from("uploaded_files")
    .select("case_document_id, sha256, created_at")
    .in("case_document_id", caseDocumentIds)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  for (const row of data ?? []) {
    if (!row.case_document_id || !row.sha256) continue;
    if (!hashes.has(row.case_document_id)) hashes.set(row.case_document_id, row.sha256);
  }
  return hashes;
}

/** Everything the generate-draft-output server action needs to build the
 *  persisted package for the case's latest evidence manifest. Returns `null`
 *  when the case or its latest manifest cannot be found. */
export async function resolveDraftOutputArtifactInput(taxCaseId: string): Promise<{
  readonly manifestId: string;
  readonly manifestHash: string;
  readonly package: DraftOutputArtifactPackage;
  readonly contentHash: string;
} | null> {
  const supabase = await createServerClient();
  const { data: tc } = await supabase
    .from("tax_cases")
    .select("id, assessment_year, financial_year, client_review_manifest_id")
    .eq("id", taxCaseId)
    .maybeSingle();
  if (!tc || !tc.client_review_manifest_id) return null;

  const { data: manifest } = await supabase
    .from("tax_evidence_manifests")
    .select("id, manifest_payload, manifest_content_hash, computation_snapshot_id")
    .eq("id", tc.client_review_manifest_id)
    .eq("tax_case_id", taxCaseId)
    .maybeSingle();
  if (!manifest) return null;

  const { data: snap } = await supabase
    .from("tax_computation_snapshots")
    .select("input_snapshot")
    .eq("id", manifest.computation_snapshot_id)
    .maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const input = (snap?.input_snapshot ?? {}) as any;

  const manifestPayload = manifest.manifest_payload as ManifestPayload;
  const pkg = buildDraftOutputArtifactPackage({
    manifestId: manifest.id,
    manifestHash: manifest.manifest_content_hash,
    manifestPayload,
    snapshot: {
      assessmentYear: input.assessmentYear ?? tc.assessment_year,
      financialYear: input.financialYear ?? tc.financial_year,
      selectedItrType: input.selectedItrType ?? null,
      recommendedItrType: input.recommendedItrType ?? "ITR-1",
    },
  });
  const contentHash = computeDraftOutputArtifactContentHash(pkg);

  return { manifestId: manifest.id, manifestHash: manifest.manifest_content_hash, package: pkg, contentHash };
}
