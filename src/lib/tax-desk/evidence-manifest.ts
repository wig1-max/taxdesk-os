/**
 * TaxDesk OS — Immutable accepted-evidence manifest (Wave 3, K3-32B).
 *
 * PURE TYPESCRIPT ONLY. Like the rest of `src/lib/tax-desk/*`,
 * `src/lib/tax-engine/*`, `src/lib/tax-pack/*` and `src/lib/tax-lab/*`, this
 * module must NOT import React, Next.js, the Supabase client, UI components,
 * server actions, env/config, or app routes. `node:crypto` is used only for
 * `createHash("sha256")` — the same Node built-in `src/lib/upload-token.ts`
 * already uses for a content hash; it is not React/Next/Supabase/env/route.
 *
 * WHAT THIS CLOSES. `K3-32` produced a strong PURE/READ-MODEL draft-output
 * projection (`draft-output.ts`), but nothing about it was ever written to
 * the database, so there was no durable, immutable, hash-identified record of
 * exactly what evidence a client's approval was captured against. This module
 * is the domain logic for that record — the "accepted-evidence manifest" —
 * kept deliberately separate from `draft-output.ts` because it answers a
 * DIFFERENT question with a DIFFERENT (stricter, regime-specific) gate:
 *
 *   - `draft-output.ts`'s `buildDraftOutputPackage` gate: is the CURRENT
 *     client approval bound to this exact snapshot, and is the CONSERVATIVE
 *     (higher-of-both-regimes) total income clear of the surcharge/marginal-
 *     relief reliance blocker? (K3-32, D45.)
 *   - THIS module's gate: has staff EXPLICITLY selected a regime for this
 *     snapshot (never silently defaulted to the recommended regime), and is
 *     THAT SELECTED REGIME'S OWN total income clear of the same reliance
 *     blocker? A case whose non-selected regime happens to exceed the
 *     threshold does not block a manifest for a selected regime that does
 *     not.
 *
 * Both gates reuse the exact SAME canonical evaluator
 * (`tax-capability.ts`'s `evaluateTaxCapability`) — there is no second
 * ₹50-lakh rule anywhere in this module; only the INCOME FIGURE fed into that
 * one evaluator differs, and that difference is itself the design intent
 * (regime-specific manifest capability vs. conservative preparation-stage
 * capability), not an inconsistency. Both figures are captured on the
 * manifest for audit (`selectedRegimeTotalIncome`,
 * `preApprovalConservativeTotalIncome`) so nobody has to guess which was used.
 *
 * WHAT THIS IS NOT. Not an ITD JSON payload, not an e-filing artifact, not a
 * filing claim, not a second traceability/evidence derivation — every
 * figure, rule citation and evidence fact in a built manifest comes from the
 * SAME `describeCaseTraceability` (K3-22..26) and `resolveSnapshotEvidenceLineage`
 * (K3-32 Part A) authorities `draft-output.ts` already uses, imported here
 * rather than re-derived.
 */

import { createHash } from "node:crypto";
import {
  describeCaseTraceability,
  type CaseCompleteness,
  type ComputationFigureOutputs,
  type GoverningPackState,
  type PromotedProposalLineage,
  type TraceableLine,
} from "./case-traceability";
import {
  buildAdapterResultFromSnapshot,
  buildLedgerRowsFromSnapshot,
  resolveSnapshotEvidenceLineage,
  type SnapshotEvidenceLineage,
  type StoredSnapshotForDraftOutput,
} from "./draft-output";
import { isApprovalCurrentForSnapshot } from "./filing-readiness";
import {
  evaluateTaxCapability,
  totalIncomeForSurchargeApplicability,
  type TaxCapabilityBlocker,
  type TaxCapabilityEvaluation,
  snapshotHasHouseSaleLtcg,
} from "./tax-capability";
import {
  evaluateSeniorTreatmentRisk,
  type SeniorTreatmentResult,
  type TaxpayerAgeBand,
} from "./senior-treatment";
import type { TaxCaseStatutoryContext } from "@/lib/tax-pack/case-pack";
import type { TaxPackRelianceBlocker } from "@/lib/tax-pack/verification-state";
import type { Regime } from "@/lib/tax-engine/ay-2026-27/types";

export const MANIFEST_SCHEMA_VERSION = "TAX_EVIDENCE_MANIFEST_V1";
export type ManifestSchemaVersion = typeof MANIFEST_SCHEMA_VERSION;

export const REGIME_VALUES: readonly Regime[] = ["old", "new"];
export function isRegime(value: unknown): value is Regime {
  return value === "old" || value === "new";
}

/** Bind manifest traceability to the immutable computation version stamped on
 * its snapshot. An unknown version then refuses through normal pack resolution
 * instead of silently falling through to the current pack. */
export function manifestStatutoryContextForSnapshot(
  assessmentYear: string,
  computationRulesVersion: string,
): TaxCaseStatutoryContext {
  return { assessmentYear, computationRulesVersion };
}

// ---------------------------------------------------------------------------
// Candidate resolution — the manifest-creation gate
// ---------------------------------------------------------------------------

export type ManifestRefusalReason =
  | "regime_not_selected"
  | "snapshot_incomplete"
  | "reliance_blocked"
  | "senior_treatment_blocked"
  | "pack_refused";

export interface ManifestRefusal {
  readonly outcome: "refused";
  readonly reason: ManifestRefusalReason;
  readonly message: string;
  /** Populated only for `reliance_blocked`. K4-12 widened this to the union:
   *  the section 87A rebate-relief blocker can also refuse a manifest. */
  readonly blocker: TaxCapabilityBlocker | null;
  /** Populated only for `senior_treatment_blocked` (K4-01). */
  readonly seniorTreatmentResult: SeniorTreatmentResult | null;
}

export interface EvidenceManifestCandidate {
  readonly outcome: "candidate";
  readonly taxCaseId: string;
  readonly snapshotId: string;
  readonly selectedRegime: Regime;
  readonly selectedRegimeTotalIncome: number;
  /** The conservative higher-of-both-regimes figure preparation-stage checks
   *  use (`totalIncomeForSurchargeApplicability`) — disclosed for audit, never
   *  used as this module's own gate. `null` only when neither regime parses,
   *  which cannot occur for a complete snapshot. */
  readonly preApprovalConservativeTotalIncome: number | null;
  /** Capability evaluated against `selectedRegimeTotalIncome` — THIS is the
   *  gate this module enforces. Always blocker-free for a produced candidate
   *  (a blocked evaluation is refused, never carried through). */
  readonly snapshotCapabilityResult: TaxCapabilityEvaluation;
  /** Capability evaluated against `preApprovalConservativeTotalIncome` —
   *  disclosure only, mirrors what `prepare_client_review`/
   *  `capture_client_approval` already gated on upstream. May legitimately
   *  carry a blocker even when `snapshotCapabilityResult` does not (the
   *  non-selected regime crossing the threshold does not block this regime's
   *  manifest — see module doc). */
  readonly preApprovalCapabilityResult: TaxCapabilityEvaluation;
  readonly pack: GoverningPackState;
  readonly packRelianceBlocker: TaxPackRelianceBlocker | null;
  readonly completeness: CaseCompleteness;
  readonly figures: readonly TraceableLine[];
  readonly evidence: SnapshotEvidenceLineage;
  /** K4-01: the taxpayer's age band + residential status, as evaluated fresh
   *  at manifest-creation time. */
  readonly ageBand: TaxpayerAgeBand | null;
  readonly residentialStatus: string | null;
  /** Evaluated against THIS manifest's selected regime — never blocking for a
   *  produced candidate (a blocked evaluation is refused, never carried
   *  through). As of K4-05 (decision D79) this evaluator's OLD-regime block
   *  was removed, so `riskCode` is `null` for every resident senior/super-
   *  senior taxpayer at either regime — `RESIDENTIAL_STATUS_UNRESOLVED` is
   *  the only code that can still fire, and it always refuses the candidate
   *  entirely rather than reaching this field. */
  readonly seniorTreatmentSelectedRegimeResult: SeniorTreatmentResult;
  /** The PRE-APPROVAL comparison-reliability disclosure — always disclosure
   *  only (never blocks a candidate), carried forward so it is never
   *  silently dropped once a regime is selected. As of K4-05 (decision D79)
   *  `REGIME_COMPARISON_UNRELIABLE` was removed from this evaluator too, so
   *  `riskCode` is `null` here for every resident senior/super-senior
   *  taxpayer — this field is kept structurally (never renamed, per the
   *  "stable contract" discipline) in case a future gap reopens it. */
  readonly seniorTreatmentPreApprovalResult: SeniorTreatmentResult;
}

export type EvidenceManifestResult = EvidenceManifestCandidate | ManifestRefusal;

function regimeTotalIncome(snapshot: StoredSnapshotForDraftOutput, regime: Regime): number | null {
  const v =
    regime === "old"
      ? snapshot.computation.oldRegime.totalIncome.value
      : snapshot.computation.newRegime.totalIncome.value;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * K3-32B. Resolve whether an accepted-evidence manifest MAY be built for one
 * immutable snapshot + one EXPLICITLY selected regime. Never reads live
 * ledgers — same structural discipline as `buildDraftOutputPackage`: no
 * live-ledger parameter exists in this function's signature.
 *
 * Refuses (never guesses) when:
 *   - `regime_not_selected` — `selectedRegime` is `null`. This module never
 *     silently substitutes the recommended regime.
 *   - `snapshot_incomplete` — defensive; unreachable in practice (only a
 *     complete snapshot may ever be saved), but never trusted.
 *   - `reliance_blocked` — `tax-capability.ts`'s evaluator trips against the
 *     SELECTED regime's OWN total income (not the conservative figure).
 *   - `pack_refused` — the case's statutory coordinates resolve to no bound
 *     tax pack (`describeCaseTraceability`'s own refusal, passed through
 *     verbatim).
 */
export function resolveEvidenceManifestCandidate(args: {
  readonly taxCaseId: string;
  readonly statutory: TaxCaseStatutoryContext;
  readonly snapshot: StoredSnapshotForDraftOutput;
  readonly selectedRegime: Regime | null;
  readonly promotedProposals: readonly PromotedProposalLineage[];
  /** K4-01: the taxpayer's age band (derived from the CURRENT profile date of
   *  birth — never reconstructed from the snapshot's stored engine input,
   *  which never persisted it) and residential status, evaluated fresh at
   *  manifest-creation time. `null` age band when undelivable — this module
   *  does not itself withhold for that (eligibility.ts's PROFILE_DOB_MISSING
   *  already does). */
  readonly ageBand: TaxpayerAgeBand | null;
  readonly residentialStatus: string | null;
}): EvidenceManifestResult {
  const { taxCaseId, statutory, snapshot, selectedRegime, promotedProposals, ageBand, residentialStatus } = args;

  if (selectedRegime === null) {
    return Object.freeze({
      outcome: "refused",
      reason: "regime_not_selected",
      message:
        "No regime has been explicitly selected for this snapshot. Select old or new regime before " +
        "generating an accepted-evidence manifest — the recommended regime is never used silently.",
      blocker: null,
      seniorTreatmentResult: null,
    });
  }
  if (!snapshot.complete) {
    return Object.freeze({
      outcome: "refused",
      reason: "snapshot_incomplete",
      message: "The snapshot is not a complete computation snapshot.",
      blocker: null,
      seniorTreatmentResult: null,
    });
  }

  // K4-01: the senior/super-senior selected-regime gate — evaluated BEFORE
  // the surcharge gate below (order does not matter for correctness since
  // both must clear, but this keeps the two reliance-boundary checks
  // together at the top). A resident senior/super-senior taxpayer selecting
  // the OLD regime is refused; NEW regime is not blocked solely for age; an
  // unresolved residency fails closed (defense-in-depth — eligibility.ts
  // already withholds this case entirely upstream in production).
  const seniorTreatmentResult = evaluateSeniorTreatmentRisk({
    ageBand,
    residentialStatus,
    context: "snapshot_selected_regime",
    selectedRegime,
  });
  if (seniorTreatmentResult.isRelianceBlocked) {
    return Object.freeze({
      outcome: "refused",
      reason: "senior_treatment_blocked",
      message: `Not eligible for an evidence manifest under the ${selectedRegime} regime: ${seniorTreatmentResult.reason}`,
      blocker: null,
      seniorTreatmentResult,
    });
  }

  const preApprovalConservativeTotalIncome = totalIncomeForSurchargeApplicability(
    snapshot.computation.oldRegime.totalIncome.value,
    snapshot.computation.newRegime.totalIncome.value,
  );
  // K4-11: the engine's own surcharge verdict, taken from the SAME stored
  // snapshot both income figures come from. Absent on a pre-K4-11 snapshot,
  // which fails closed and preserves that snapshot's original treatment.
  const surchargeTreatmentSupported = snapshot.computation.surchargeTreatmentSupported;
  // K4-12: the 87A relief verdict and its window base, threaded into BOTH
  // evaluations exactly as the surcharge verdict already is. The window base is
  // the NEW regime's own total income in both cases — unlike the surcharge
  // base, it does NOT vary with the selected regime, because the relief reaches
  // the new regime only.
  const rebateReliefTreatmentSupported = snapshot.computation.rebateReliefTreatmentSupported;
  const newRegimeTotalIncome = snapshot.computation.newRegime.totalIncome.value;
  const preApprovalCapabilityResult = evaluateTaxCapability({
    totalIncome: preApprovalConservativeTotalIncome,
    surchargeTreatmentSupported,
    newRegimeTotalIncome,
    rebateReliefTreatmentSupported,
    // K4-23 review F1: read from the SAME stored snapshot every other figure
    // here comes from. Absent on a pre-K4-23 snapshot, which cannot carry a
    // long-term house sale at all (every such case refused), so
    // `hasHouseSaleLtcg` is false there and absence blocks nothing.
    hasHouseSaleLtcg: snapshotHasHouseSaleLtcg(snapshot),
    houseSaleLtcgTreatmentSupported: snapshot.computation.houseSaleLtcgTreatmentSupported,
  });

  const selectedRegimeTotalIncome = regimeTotalIncome(snapshot, selectedRegime);
  const snapshotCapabilityResult = evaluateTaxCapability({
    totalIncome: selectedRegimeTotalIncome,
    surchargeTreatmentSupported,
    newRegimeTotalIncome,
    rebateReliefTreatmentSupported,
    // K4-23 review F1: read from the SAME stored snapshot every other figure
    // here comes from. Absent on a pre-K4-23 snapshot, which cannot carry a
    // long-term house sale at all (every such case refused), so
    // `hasHouseSaleLtcg` is false there and absence blocks nothing.
    hasHouseSaleLtcg: snapshotHasHouseSaleLtcg(snapshot),
    houseSaleLtcgTreatmentSupported: snapshot.computation.houseSaleLtcgTreatmentSupported,
  });
  const blocker = snapshotCapabilityResult.blockers[0] ?? null;
  if (blocker) {
    return Object.freeze({
      outcome: "refused",
      reason: "reliance_blocked",
      message: `Not eligible for an evidence manifest under the ${selectedRegime} regime: ${blocker.message}`,
      blocker,
      seniorTreatmentResult,
    });
  }

  // K4-01: the PRE-APPROVAL comparison-reliability disclosure — never a
  // blocker (the gate above already refused a blocking case), carried onto
  // the candidate/manifest so a resident senior/super-senior taxpayer's
  // "alternative regime comparison was unreliable" caveat is disclosed even
  // when the NEW regime was (correctly) selected and not blocked.
  const preApprovalSeniorTreatmentResult = evaluateSeniorTreatmentRisk({
    ageBand,
    residentialStatus,
    context: "pre_approval_regime_comparison",
    selectedRegime: null,
  });

  const adapter = buildAdapterResultFromSnapshot(snapshot.engineInput);
  if (!adapter.complete) {
    return Object.freeze({
      outcome: "refused",
      reason: "snapshot_incomplete",
      message: "The snapshot has no verifiable presumptive activity eligibility contract.",
      blocker: null,
      seniorTreatmentResult,
    });
  }
  const rows = buildLedgerRowsFromSnapshot(snapshot.engineInput);
  const outputs: ComputationFigureOutputs = {
    computation: snapshot.computation,
    comparison: snapshot.comparison,
    itrRecommendation: snapshot.recommendation,
  };
  const traceability = describeCaseTraceability({
    statutory,
    adapter,
    rows,
    outputs,
    taxCaseId,
    promotedProposals,
  });
  if (traceability.outcome === "refused") {
    return Object.freeze({
      outcome: "refused",
      reason: "pack_refused",
      message: traceability.reason,
      blocker: null,
      seniorTreatmentResult,
    });
  }

  const evidence = resolveSnapshotEvidenceLineage(snapshot.engineInput, taxCaseId, promotedProposals);

  return Object.freeze({
    outcome: "candidate",
    taxCaseId,
    snapshotId: snapshot.id,
    selectedRegime,
    // selectedRegimeTotalIncome is non-null here: a null value can only occur
    // when the regime's own totalIncome.value fails to parse, which would
    // make evaluateTaxCapability's blocker never trip (see tax-capability.ts:
    // null totalIncome is never risky) — but a `reliance_blocked` snapshot
    // never reaches this branch, so an unparseable figure is not itself
    // possible for a COMPLETE snapshot's own computed regime. Coalesced to 0
    // defensively rather than widening the type to `number | null` and
    // pushing that defensive check onto every caller.
    selectedRegimeTotalIncome: selectedRegimeTotalIncome ?? 0,
    preApprovalConservativeTotalIncome,
    snapshotCapabilityResult,
    preApprovalCapabilityResult,
    pack: traceability.pack,
    packRelianceBlocker: traceability.relianceBlocker,
    completeness: traceability.completeness,
    figures: traceability.lines,
    evidence,
    ageBand,
    residentialStatus,
    seniorTreatmentSelectedRegimeResult: seniorTreatmentResult,
    seniorTreatmentPreApprovalResult: preApprovalSeniorTreatmentResult,
  });
}

// ---------------------------------------------------------------------------
// Canonical payload + deterministic hash
// ---------------------------------------------------------------------------

/** A manifest-frozen figure — every field a rule/value/limitation change
 *  would alter, and nothing else (no rendering-only text). */
export interface ManifestFigureRecord {
  readonly id: string;
  readonly kind: string;
  readonly authoredState: string;
  readonly state: string;
  readonly format: string;
  readonly value: number | string;
  readonly ruleIds: readonly string[];
  readonly limitation: string | null;
  readonly implementationCaveat: string | null;
  readonly rulesUnverified: boolean;
}

export interface ManifestEvidenceFactRecord {
  readonly ledgerId: string;
  readonly ledgerKind: "income" | "tax_paid";
  readonly sourceType: string | null;
  readonly sourceDocumentId: string | null;
  /** sha256 of the retained source document, when one is on file for
   *  `sourceDocumentId` — `null` when there is no document (manual entry) or
   *  no retained hash (never fabricated). */
  readonly retainedSourceDocumentHash: string | null;
  /** `null` for a manually entered row — this is the field that keeps a
   *  manually tagged `Form16` row from ever being described as
   *  proposal-accepted (K3-30/K3-31's own distinction, never re-derived). */
  readonly proposal: {
    readonly proposalId: string;
    readonly factKind: string;
    readonly decidedByName: string | null;
    readonly decidedAt: string | null;
    readonly promotedByName: string | null;
    readonly promotedAt: string | null;
  } | null;
}

export interface ManifestPayload {
  readonly schemaVersion: ManifestSchemaVersion;
  readonly taxCaseId: string;
  readonly computationSnapshotId: string;
  readonly selectedRegime: Regime;
  readonly selectedRegimeTotalIncome: number;
  readonly preApprovalConservativeTotalIncome: number | null;
  readonly activeBlockerCodes: readonly string[];
  /** K4-01: additive fields (schema version deliberately NOT bumped — see
   *  senior-treatment.ts / the K4-01 session log's decision entry — these are
   *  new disclosure keys on the same JSONB payload shape, not a structural
   *  break). Captures the taxpayer's age band + residential status as
   *  evaluated fresh at manifest-creation time, the selected-regime senior-
   *  treatment risk code (always non-blocking here — a blocked evaluation is
   *  refused before a manifest is ever created), and whether the PRE-APPROVAL
   *  regime comparison was disclosed as unreliable for this taxpayer. */
  readonly seniorTreatmentAgeBand: string | null;
  readonly seniorTreatmentResidentialStatus: string | null;
  readonly seniorTreatmentSelectedRegimeRiskCode: string | null;
  readonly seniorTreatmentComparisonUnreliable: boolean;
  readonly taxPackId: string;
  readonly taxPackVersion: string;
  readonly taxPackLifecycleStatus: string;
  readonly validationIdentity: {
    readonly validationRulesVersion: string;
  };
  readonly figures: readonly ManifestFigureRecord[];
  readonly evidenceFacts: readonly ManifestEvidenceFactRecord[];
  readonly disclaimer: string;
}

export const EVIDENCE_MANIFEST_DISCLAIMER =
  "Immutable accepted-evidence manifest. This is NOT an ITD JSON payload, not an e-filing " +
  "upload package, and not a filing action. It freezes exactly the figures, rules and evidence " +
  "in scope for one computation snapshot under one explicitly selected regime.";

/** Optional source-document hash lookup — the manifest builder never reads
 *  storage itself; the caller (a read model) supplies whatever it already
 *  knows. Missing entries are honestly `null`, never fabricated. */
export type SourceDocumentHashLookup = ReadonlyMap<string, string>;

export function buildManifestPayload(
  candidate: EvidenceManifestCandidate,
  args: {
    readonly validationRulesVersion: string;
    /** Each evidence fact's own stored `sourceType` (from the snapshot's
     *  engine input) — `SnapshotEvidenceLineage` itself does not carry it, so
     *  the caller (which already has `StoredEngineInputPayload`) supplies it
     *  keyed by ledger row id. Missing entries are honestly `null`. */
    readonly sourceTypeByLedgerId: ReadonlyMap<string, string>;
    readonly sourceDocumentHashes?: SourceDocumentHashLookup;
  },
): ManifestPayload {
  const hashes = args.sourceDocumentHashes ?? new Map<string, string>();

  const figures: ManifestFigureRecord[] = candidate.figures.map((line) =>
    Object.freeze({
      id: line.id,
      kind: line.kind,
      authoredState: line.authoredState,
      state: line.state,
      format: line.format,
      value: line.value,
      ruleIds: Object.freeze(line.rules.map((r) => r.ruleId)),
      limitation: line.limitation,
      implementationCaveat: line.implementationCaveat,
      rulesUnverified: line.rulesUnverified,
    }),
  );

  const evidenceFacts: ManifestEvidenceFactRecord[] = candidate.evidence.facts.map((fact) =>
    Object.freeze({
      ledgerId: fact.ledgerId,
      ledgerKind: fact.ledgerKind,
      sourceType: args.sourceTypeByLedgerId.get(fact.ledgerId) ?? null,
      sourceDocumentId: fact.sourceDocumentId,
      retainedSourceDocumentHash: fact.sourceDocumentId ? (hashes.get(fact.sourceDocumentId) ?? null) : null,
      proposal: fact.promotedProposal
        ? Object.freeze({
            proposalId: fact.promotedProposal.proposalId,
            factKind: fact.promotedProposal.factKind,
            decidedByName: fact.promotedProposal.decidedByName,
            decidedAt: fact.promotedProposal.decidedAt,
            promotedByName: fact.promotedProposal.promotedByName,
            promotedAt: fact.promotedProposal.promotedAt,
          })
        : null,
    }),
  );

  return Object.freeze({
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    taxCaseId: candidate.taxCaseId,
    computationSnapshotId: candidate.snapshotId,
    selectedRegime: candidate.selectedRegime,
    selectedRegimeTotalIncome: candidate.selectedRegimeTotalIncome,
    preApprovalConservativeTotalIncome: candidate.preApprovalConservativeTotalIncome,
    activeBlockerCodes: Object.freeze(candidate.snapshotCapabilityResult.blockers.map((b) => b.code)),
    seniorTreatmentAgeBand: candidate.ageBand,
    seniorTreatmentResidentialStatus: candidate.residentialStatus,
    seniorTreatmentSelectedRegimeRiskCode: candidate.seniorTreatmentSelectedRegimeResult.riskCode,
    seniorTreatmentComparisonUnreliable: candidate.seniorTreatmentPreApprovalResult.riskCode === "REGIME_COMPARISON_UNRELIABLE",
    taxPackId: candidate.pack.key,
    taxPackVersion: candidate.pack.computationRulesVersion,
    taxPackLifecycleStatus: candidate.pack.status,
    validationIdentity: Object.freeze({ validationRulesVersion: args.validationRulesVersion }),
    figures: Object.freeze(figures),
    evidenceFacts: Object.freeze(evidenceFacts),
    disclaimer: EVIDENCE_MANIFEST_DISCLAIMER,
  });
}

/**
 * Stable canonical JSON for a manifest payload: recursively sorted object
 * keys, and arrays whose order is not already semantically meaningful
 * (`figures` by `id`, `evidenceFacts` by `ledgerId`) sorted for determinism.
 * `activeBlockerCodes`/`ruleIds` are sorted too (order carries no meaning).
 * Two semantically-identical payloads ALWAYS canonicalize identically; any
 * material change to a figure, evidence fact, regime, pack identity or
 * blocker set ALWAYS changes the output.
 */
export function canonicalizeManifestPayload(payload: ManifestPayload): string {
  const sortStrings = (arr: readonly string[]): string[] => [...arr].sort();
  const sortByKey = <T>(arr: readonly T[], key: (v: T) => string): T[] =>
    [...arr].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));

  const canonicalFigures = sortByKey(payload.figures, (f) => f.id).map((f) => ({
    id: f.id,
    kind: f.kind,
    authoredState: f.authoredState,
    state: f.state,
    format: f.format,
    value: f.value,
    ruleIds: sortStrings(f.ruleIds),
    limitation: f.limitation,
    implementationCaveat: f.implementationCaveat,
    rulesUnverified: f.rulesUnverified,
  }));

  const canonicalEvidence = sortByKey(payload.evidenceFacts, (f) => f.ledgerId).map((f) => ({
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

  // Explicit key order (never `JSON.stringify`'s own insertion order) is what
  // makes this "canonical" rather than merely "an object literal in source
  // order that happens to be stable today".
  const canonical = {
    schemaVersion: payload.schemaVersion,
    taxCaseId: payload.taxCaseId,
    computationSnapshotId: payload.computationSnapshotId,
    selectedRegime: payload.selectedRegime,
    selectedRegimeTotalIncome: payload.selectedRegimeTotalIncome,
    preApprovalConservativeTotalIncome: payload.preApprovalConservativeTotalIncome,
    activeBlockerCodes: sortStrings(payload.activeBlockerCodes),
    seniorTreatmentAgeBand: payload.seniorTreatmentAgeBand,
    seniorTreatmentResidentialStatus: payload.seniorTreatmentResidentialStatus,
    seniorTreatmentSelectedRegimeRiskCode: payload.seniorTreatmentSelectedRegimeRiskCode,
    seniorTreatmentComparisonUnreliable: payload.seniorTreatmentComparisonUnreliable,
    taxPackId: payload.taxPackId,
    taxPackVersion: payload.taxPackVersion,
    taxPackLifecycleStatus: payload.taxPackLifecycleStatus,
    validationIdentity: { validationRulesVersion: payload.validationIdentity.validationRulesVersion },
    figures: canonicalFigures,
    evidenceFacts: canonicalEvidence,
    disclaimer: payload.disclaimer,
  };
  return JSON.stringify(canonical);
}

/** sha256 hex digest of a manifest payload's canonical serialization. */
export function computeManifestContentHash(payload: ManifestPayload): string {
  return createHash("sha256").update(canonicalizeManifestPayload(payload)).digest("hex");
}

// ---------------------------------------------------------------------------
// Approval currentness bound to a manifest (extends, never re-derives,
// `filing-readiness.ts`'s `isApprovalCurrentForSnapshot`)
// ---------------------------------------------------------------------------

export interface ManifestBoundReview {
  readonly status: string;
  readonly reviewSnapshotId: string | null;
  readonly reviewManifestId: string | null;
}

/**
 * Whether `review`'s CURRENT client approval is bound to EXACTLY this
 * snapshot AND this manifest. Builds on (never duplicates)
 * `isApprovalCurrentForSnapshot` — the snapshot half of the check stays that
 * function's sole authority; this adds only the manifest-identity half.
 * `capture_client_approval` sets both `client_review_snapshot_id` and
 * `client_review_manifest_id` together, and `prepare_client_review` resets
 * both to `null` together, so a later material live-case change (which
 * always re-prepares before a fresh approval) can never leave this pair
 * mismatched without also being caught by the snapshot half.
 */
export function isApprovalCurrentForManifest(
  review: ManifestBoundReview,
  snapshotId: string,
  manifestId: string,
): boolean {
  return isApprovalCurrentForSnapshot(review, snapshotId) && review.reviewManifestId === manifestId;
}
