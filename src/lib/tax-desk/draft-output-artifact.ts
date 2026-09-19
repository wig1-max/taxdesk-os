/**
 * TaxDesk OS — Persisted internal draft-output artifact (Wave 3, K3-32B).
 *
 * PURE TYPESCRIPT ONLY (see `evidence-manifest.ts`'s module doc for the exact
 * boundary this file also honours). This module is deliberately thin: it
 * packages an ALREADY-FROZEN `ManifestPayload` (`evidence-manifest.ts`) into
 * the shape a persisted `tax_draft_outputs` row stores, and derives its own
 * canonical hash the same way `evidence-manifest.ts` derives the manifest's.
 * It introduces NO second figure/evidence/rule derivation — every figure and
 * evidence fact in a built package is copied verbatim from the manifest that
 * produced it, never recomputed, never read from a live ledger (this module
 * has no live-ledger, no adapter, and no `describeCaseTraceability` import at
 * all — it structurally cannot read live data).
 *
 * `checkDraftOutputEligibility` is the pure, reusable gate the server action
 * calls BEFORE invoking the guarded RPC (defense-in-depth mirror of the
 * `eligibilityGate`/`surchargeRiskGate` pattern in `tax-client-review.ts` —
 * the RPC re-derives the same checks independently and is the real
 * authority). It reuses `isApprovalCurrentForManifest` from
 * `evidence-manifest.ts` rather than re-deriving currentness.
 */

import { isApprovalCurrentForManifest, type ManifestBoundReview, type ManifestPayload } from "./evidence-manifest";
import { createHash } from "node:crypto";

export const DRAFT_OUTPUT_PACKAGE_SCHEMA_VERSION = "TAX_DRAFT_OUTPUT_PACKAGE_V1";
export type DraftOutputPackageSchemaVersion = typeof DRAFT_OUTPUT_PACKAGE_SCHEMA_VERSION;

export const DRAFT_OUTPUT_ARTIFACT_STATUS = "internal_draft" as const;

export const DRAFT_OUTPUT_ARTIFACT_DISCLAIMER =
  "Internal preparation-only draft output, derived exclusively from an immutable, approval-bound " +
  "accepted-evidence manifest. This is NOT an ITD JSON payload, not an e-filing upload package, not " +
  "a filing action, and not a tax-authority-acceptance claim.";

export interface DraftOutputArtifactPackage {
  readonly schemaVersion: DraftOutputPackageSchemaVersion;
  readonly taxCaseId: string;
  readonly sourceSnapshotId: string;
  readonly sourceManifestId: string;
  readonly sourceManifestHash: string;
  readonly assessmentYear: string;
  readonly financialYear: string;
  readonly selectedItrType: string | null;
  readonly recommendedItrType: string;
  readonly selectedRegime: ManifestPayload["selectedRegime"];
  readonly selectedRegimeTotalIncome: number;
  readonly taxPackId: string;
  readonly taxPackVersion: string;
  readonly taxPackLifecycleStatus: string;
  readonly figures: ManifestPayload["figures"];
  readonly evidenceFacts: ManifestPayload["evidenceFacts"];
  readonly status: typeof DRAFT_OUTPUT_ARTIFACT_STATUS;
  readonly disclaimer: string;
}

/**
 * Build the persisted package from an already-produced manifest. Takes no
 * live-ledger, adapter, or traceability input — everything but four small
 * display fields (`assessmentYear`/`financialYear`/`selectedItrType`/
 * `recommendedItrType`, which the manifest payload itself does not carry) is
 * copied verbatim from `manifestPayload`.
 */
export function buildDraftOutputArtifactPackage(args: {
  readonly manifestId: string;
  readonly manifestHash: string;
  readonly manifestPayload: ManifestPayload;
  readonly snapshot: {
    readonly assessmentYear: string;
    readonly financialYear: string;
    readonly selectedItrType: string | null;
    readonly recommendedItrType: string;
  };
}): DraftOutputArtifactPackage {
  const m = args.manifestPayload;
  return Object.freeze({
    schemaVersion: DRAFT_OUTPUT_PACKAGE_SCHEMA_VERSION,
    taxCaseId: m.taxCaseId,
    sourceSnapshotId: m.computationSnapshotId,
    sourceManifestId: args.manifestId,
    sourceManifestHash: args.manifestHash,
    assessmentYear: args.snapshot.assessmentYear,
    financialYear: args.snapshot.financialYear,
    selectedItrType: args.snapshot.selectedItrType,
    recommendedItrType: args.snapshot.recommendedItrType,
    selectedRegime: m.selectedRegime,
    selectedRegimeTotalIncome: m.selectedRegimeTotalIncome,
    taxPackId: m.taxPackId,
    taxPackVersion: m.taxPackVersion,
    taxPackLifecycleStatus: m.taxPackLifecycleStatus,
    figures: m.figures,
    evidenceFacts: m.evidenceFacts,
    status: DRAFT_OUTPUT_ARTIFACT_STATUS,
    disclaimer: DRAFT_OUTPUT_ARTIFACT_DISCLAIMER,
  });
}

/** Canonical, deterministic serialization — same discipline as
 *  `canonicalizeManifestPayload`: explicit sorted key order, arrays sorted by
 *  their own semantic id where order carries no meaning. */
export function canonicalizeDraftOutputArtifactPayload(pkg: DraftOutputArtifactPackage): string {
  const sortByKey = <T>(arr: readonly T[], key: (v: T) => string): T[] =>
    [...arr].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));

  const canonicalFigures = sortByKey(pkg.figures, (f) => f.id).map((f) => ({
    id: f.id,
    kind: f.kind,
    authoredState: f.authoredState,
    state: f.state,
    format: f.format,
    value: f.value,
    ruleIds: [...f.ruleIds].sort(),
    limitation: f.limitation,
    implementationCaveat: f.implementationCaveat,
    rulesUnverified: f.rulesUnverified,
  }));
  const canonicalEvidence = sortByKey(pkg.evidenceFacts, (f) => f.ledgerId).map((f) => ({
    ledgerId: f.ledgerId,
    ledgerKind: f.ledgerKind,
    sourceType: f.sourceType,
    sourceDocumentId: f.sourceDocumentId,
    retainedSourceDocumentHash: f.retainedSourceDocumentHash,
    proposal: f.proposal
      ? {
          proposalId: f.proposal.proposalId,
          factKind: f.proposal.factKind,
          decidedByName: f.proposal.decidedByName,
          decidedAt: f.proposal.decidedAt,
          promotedByName: f.proposal.promotedByName,
          promotedAt: f.proposal.promotedAt,
        }
      : null,
  }));

  const canonical = {
    schemaVersion: pkg.schemaVersion,
    taxCaseId: pkg.taxCaseId,
    sourceSnapshotId: pkg.sourceSnapshotId,
    sourceManifestId: pkg.sourceManifestId,
    sourceManifestHash: pkg.sourceManifestHash,
    assessmentYear: pkg.assessmentYear,
    financialYear: pkg.financialYear,
    selectedItrType: pkg.selectedItrType,
    recommendedItrType: pkg.recommendedItrType,
    selectedRegime: pkg.selectedRegime,
    selectedRegimeTotalIncome: pkg.selectedRegimeTotalIncome,
    taxPackId: pkg.taxPackId,
    taxPackVersion: pkg.taxPackVersion,
    taxPackLifecycleStatus: pkg.taxPackLifecycleStatus,
    figures: canonicalFigures,
    evidenceFacts: canonicalEvidence,
    status: pkg.status,
    disclaimer: pkg.disclaimer,
  };
  return JSON.stringify(canonical);
}

export function computeDraftOutputArtifactContentHash(pkg: DraftOutputArtifactPackage): string {
  return createHash("sha256").update(canonicalizeDraftOutputArtifactPayload(pkg)).digest("hex");
}

// ---------------------------------------------------------------------------
// Eligibility gate (TS-side defense in depth; the guarded RPC is authoritative)
// ---------------------------------------------------------------------------

export type DraftOutputEligibilityRefusalReason =
  | "case_finalized"
  | "manifest_not_found"
  | "not_approved"
  | "reliance_blocked"
  | "open_validation_blockers";

export interface DraftOutputEligibilityCheck {
  readonly eligible: boolean;
  readonly reason: DraftOutputEligibilityRefusalReason | null;
  readonly message: string | null;
}

/**
 * Pure pre-check run by the server action before calling the guarded RPC.
 * Reuses `isApprovalCurrentForManifest` (no second currentness derivation).
 * The RPC re-derives every one of these conditions independently against
 * live database state — this function exists only to give the UI a precise
 * error before making the network round trip, never as the sole gate.
 */
export function checkDraftOutputEligibility(args: {
  readonly finalized: boolean;
  readonly manifest: { readonly id: string; readonly snapshotId: string; readonly activeBlockerCodes: readonly string[] } | null;
  readonly review: ManifestBoundReview;
  readonly openValidationBlockerCount: number;
}): DraftOutputEligibilityCheck {
  if (args.finalized) {
    return { eligible: false, reason: "case_finalized", message: "This tax case is finalized and read-only." };
  }
  if (!args.manifest) {
    return {
      eligible: false,
      reason: "manifest_not_found",
      message: "Generate an accepted-evidence manifest before generating an internal draft output.",
    };
  }
  if (!isApprovalCurrentForManifest(args.review, args.manifest.snapshotId, args.manifest.id)) {
    return {
      eligible: false,
      reason: "not_approved",
      message:
        "Client approval is not current for this manifest. Capture a fresh approval bound to this exact " +
        "manifest before generating a draft output.",
    };
  }
  if (args.manifest.activeBlockerCodes.length > 0) {
    return {
      eligible: false,
      reason: "reliance_blocked",
      message: "This manifest carries an active reliance blocker and cannot produce a draft output.",
    };
  }
  if (args.openValidationBlockerCount > 0) {
    return {
      eligible: false,
      reason: "open_validation_blockers",
      message: "Resolve open validation errors before generating a draft output.",
    };
  }
  return { eligible: true, reason: null, message: null };
}
