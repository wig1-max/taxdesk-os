/**
 * TaxDesk OS — Snapshot-bound evidence lineage + internal draft-output package
 * (Wave 3, K3-32).
 *
 * PURE TYPESCRIPT ONLY. Like the rest of `src/lib/tax-desk/*`,
 * `src/lib/tax-engine/*`, `src/lib/tax-pack/*` and `src/lib/tax-lab/*`, this
 * module must NOT import React, Next.js, the Supabase client, UI components,
 * server actions, env/config, or app routes.
 *
 * WHAT THIS CLOSES. `K3-30`/`K3-31` proved that an accepted, promoted source
 * fact participates correctly in computation and shows its lineage — but
 * there was still no concept of an APPROVED, IMMUTABLE evidence + computation
 * artifact that a client's approval binds to, nor any internal draft-output
 * derived from that exact artifact. This module adds two things:
 *
 *   (A) `resolveSnapshotEvidenceLineage` — which promoted-proposal facts fed
 *       a SPECIFIC computation snapshot (not live data), reusing
 *       `resolvePromotedProposalLineage` (K3-31) verbatim. No second
 *       "which rows contributed" derivation: the snapshot's OWN stored
 *       `engineInput.income`/`.taxPaid` entries ARE the contributing rows —
 *       nothing here re-derives that list.
 *
 *   (B) `buildDraftOutputPackage` — a minimal, versioned, INTERNAL
 *       representation of what the return currently contains, derived
 *       EXCLUSIVELY from one immutable, currently-approved, non-reliance-
 *       blocked snapshot. It never reads live mutable ledgers — the function
 *       accepts no live-ledger parameter, so it structurally cannot (proved
 *       by `__tests__/draft-output.test.ts`'s determinism/purity checks, the
 *       same "prove it, don't just assert it" discipline `K3-26`'s raw-
 *       engine-type boundary test established). Every material figure in the
 *       package is resolved through `describeCaseTraceability` (K3-22..26) —
 *       no second rule/evidence-mapping vocabulary is introduced.
 *
 * WHAT THIS IS NOT. This is NOT an ITD JSON payload, NOT an e-filing upload
 * package, NOT a filing claim, and NOT ERI-scoped work
 * (the eri-readiness-program design notes §7's boundary). It invents no
 * ITR-form-specific field beyond what the existing engine/adapter already
 * compute. A future ITD JSON adapter (ERI-03+) is expected to consume a
 * `DraftOutputPackage` as its ONLY input — never a live case — which is
 * exactly the invariant this module enforces structurally: a reliance-
 * blocked or not-currently-approved snapshot never produces a package at
 * all, so there is nothing for a future adapter to wrongly serialize
 * (the eri-readiness-program design notes §7 rule 5, and its explicit "no
 * ITD JSON adapter may ever serialize a reliance-blocked snapshot" clause).
 *
 * PACK VERIFICATION IS DISCLOSED, NOT AN ADDITIONAL GATE. Every shipped tax
 * pack is truthfully `draft` (no pack is `ca_verified` — `PROJECT_
 * CONSTITUTION.md` §2 rule 10), so gating this package on the pack-level
 * `tax_pack_unverified` reliance blocker would make it permanently
 * unreachable today — a stricter bar than internal FINALIZATION already
 * imposes (finalization proceeds today without CA verification; see
 * `filing-readiness.ts`). This package is explicitly LESS authoritative than
 * finalization (its own disclaimer says so), so it does not impose a
 * stricter gate. The pack's truthful verification state
 * (`GoverningPackState`, `TaxPackRelianceBlocker`) is carried IN the package
 * so nobody can misread it as CA-verified-ready — the same "traceable
 * lineage is not implementation completeness" discipline `K3-25`/`D28`
 * already established for the surcharge placeholder. The ONE gate this
 * module DOES enforce is `tax-capability.ts`'s reliance-blocker evaluator
 * (today: the surcharge/marginal-relief risk detector) — the SAME evaluator
 * that already gates client-review capture and finalization readiness. No
 * second blocker derivation is introduced (program §2, "one authority per
 * concept").
 */

import {
  describeCaseTraceability,
  resolvePromotedProposalLineage,
  type CaseCompleteness,
  type ComputationFigureOutputs,
  type GoverningPackState,
  type PromotedProposalLineage,
  type TraceableLine,
} from "./case-traceability";
import { isApprovalCurrentForSnapshot } from "./filing-readiness";
import {
  evaluateTaxCapability,
  totalIncomeForSurchargeApplicability,
  type TaxCapabilityBlocker,
  snapshotHasHouseSaleLtcg,
} from "./tax-capability";
import type { TaxCaseStatutoryContext } from "@/lib/tax-pack/case-pack";
import type { TaxPackRelianceBlocker } from "@/lib/tax-pack/verification-state";
import {
  verifyStoredPresumptiveActivityEligibility,
  type AdapterResult,
  type LedgerRows,
  type PresumptiveActivityEligibilitySnapshot,
} from "./computation-adapter";
import type {
  BroughtForwardLossEntry,
  BusinessBooksEntry,
  CapitalGainEntry,
  DeductionEntry,
  HousePropertyEntry,
  IncomeEntry,
  ItrFormRecommendation,
  RegimeComparison,
  TaxComputation,
  TaxpayerProfile,
  TaxPaidEntry,
} from "@/lib/tax-engine/ay-2026-27/types";

export const DRAFT_OUTPUT_FORMAT_VERSION = "TAX_DRAFT_OUTPUT_V1";
export type DraftOutputFormatVersion = typeof DRAFT_OUTPUT_FORMAT_VERSION;

export const DRAFT_OUTPUT_DISCLAIMER =
  "Internal preparation-only draft output. This is NOT an ITD JSON payload, " +
  "not an e-filing upload package, not a filing action, and not a tax-" +
  "authority-acceptance claim. It reflects exactly the figures the client " +
  "approved at the time of approval — nothing computed or changed since.";

// ---------------------------------------------------------------------------
// Part A — snapshot-bound evidence lineage
// ---------------------------------------------------------------------------

/** The subset of a stored snapshot's `input_snapshot.engineInput` this
 *  module needs to resolve evidence lineage — exactly the fields
 *  `tax-computation.ts` already persists for every income/tax-paid entry. */
export interface StoredSnapshotFactEntry {
  readonly id: string;
  readonly sourceType: IncomeEntry["sourceType"];
  readonly sourceDocumentId?: string;
}

export interface SnapshotEvidenceFact {
  readonly ledgerId: string;
  readonly ledgerKind: "income" | "tax_paid";
  readonly sourceDocumentId: string | null;
  /** Non-null ONLY when this exact row was inserted by an accepted, promoted
   *  source-proposal pair (`K3-30`/`K3-31`) — never inferred from
   *  `sourceType` alone. See `resolvePromotedProposalLineage`. */
  readonly promotedProposal: PromotedProposalLineage | null;
}

export interface SnapshotEvidenceLineage {
  readonly facts: readonly SnapshotEvidenceFact[];
}

/**
 * K3-32 Part A. Which facts fed a SNAPSHOT (not live ledger data), and — for
 * each — its promoted-proposal decision lineage, if any. This enumerates the
 * snapshot's OWN already-stored income/taxPaid entries (the snapshot itself
 * recorded them, immutably, at save time) and asks `resolvePromotedProposalLineage`
 * (K3-31, unmodified) the same question that function already answers for
 * live contributing facts. No new "which rows contributed" or "was this row
 * promoted" derivation is introduced.
 */
export function resolveSnapshotEvidenceLineage(
  engineInput: { readonly income: readonly StoredSnapshotFactEntry[]; readonly taxPaid: readonly StoredSnapshotFactEntry[] },
  taxCaseId: string,
  promotedProposals: readonly PromotedProposalLineage[],
): SnapshotEvidenceLineage {
  const facts: SnapshotEvidenceFact[] = [];
  const push = (ledgerKind: "income" | "tax_paid", entry: StoredSnapshotFactEntry) => {
    const sourceDocumentId = entry.sourceDocumentId ?? null;
    facts.push(
      Object.freeze({
        ledgerId: entry.id,
        ledgerKind,
        sourceDocumentId,
        promotedProposal: resolvePromotedProposalLineage(
          { ledgerKind, ledgerId: entry.id, sourceDocumentId },
          taxCaseId,
          promotedProposals,
        ),
      }),
    );
  };
  for (const e of engineInput.income) push("income", e);
  for (const e of engineInput.taxPaid) push("tax_paid", e);
  return Object.freeze({ facts: Object.freeze(facts) });
}

// ---------------------------------------------------------------------------
// Snapshot -> AdapterResult/LedgerRows reconstruction (read-only helpers,
// used only to feed the EXISTING `describeCaseTraceability` authority — see
// Part C/D below)
// ---------------------------------------------------------------------------

/** Fields read from `input_snapshot.engineInput`. Optional head/profile fields
 *  preserve compatibility with legacy snapshots that predate complete V1
 *  computation-input storage. */
export interface StoredEngineInputPayload {
  readonly assessmentYear: string;
  readonly financialYear: string;
  readonly selectedItrType: string | null;
  readonly taxpayer?: TaxpayerProfile;
  readonly income: readonly IncomeEntry[];
  readonly taxPaid: readonly TaxPaidEntry[];
  readonly deductions: readonly DeductionEntry[];
  readonly capitalGains: readonly CapitalGainEntry[];
  readonly housePropertyEntries?: readonly HousePropertyEntry[];
  readonly businessBooksEntries?: readonly BusinessBooksEntry[];
  readonly broughtForwardLosses?: readonly BroughtForwardLossEntry[];
  /** Absent on legacy snapshots. A legacy snapshot containing presumptive
   *  engine income is deliberately unverifiable and therefore incomplete. */
  readonly presumptiveActivityEligibility?: PresumptiveActivityEligibilitySnapshot | unknown;
}

/** Normalize one snapshot's stored computation input without silently dropping
 * V1 head/profile fields. Legacy rows remain supported through explicit empty
 * arrays and the caller-supplied statutory-period fallback. */
export function normalizeStoredEngineInputPayload(
  stored: Partial<StoredEngineInputPayload> | null | undefined,
  fallback: { readonly assessmentYear: string; readonly financialYear: string },
): StoredEngineInputPayload {
  return {
    assessmentYear: stored?.assessmentYear ?? fallback.assessmentYear,
    financialYear: stored?.financialYear ?? fallback.financialYear,
    selectedItrType: stored?.selectedItrType ?? null,
    ...(stored?.taxpayer ? { taxpayer: stored.taxpayer } : {}),
    income: stored?.income ?? [],
    taxPaid: stored?.taxPaid ?? [],
    deductions: stored?.deductions ?? [],
    capitalGains: stored?.capitalGains ?? [],
    housePropertyEntries: stored?.housePropertyEntries ?? [],
    businessBooksEntries: stored?.businessBooksEntries ?? [],
    broughtForwardLosses: stored?.broughtForwardLosses ?? [],
    presumptiveActivityEligibility: stored?.presumptiveActivityEligibility,
  };
}

/**
 * Rebuild an `AdapterResult` shape from a snapshot's OWN stored engine input
 * — NEVER from live ledgers (this function has no live-ledger parameter).
 * Only a COMPLETE snapshot may ever be saved (`createTaxComputationSnapshotAction`
 * refuses an incomplete one), so `warnings` is always empty and `complete`
 * always true here.
 *
 * Legacy snapshots omitted taxpayer and newer head arrays. Safe placeholders
 * are used only for those historical rows; V1 snapshots persist the actual
 * notes-free computation input and flow it through this reconstruction.
 */
export function buildAdapterResultFromSnapshot(payload: StoredEngineInputPayload): AdapterResult {
  const activityVerification = verifyStoredPresumptiveActivityEligibility(
    payload.income,
    payload.presumptiveActivityEligibility,
  );
  const activityWarnings = activityVerification.ok
    ? []
    : payload.income
        .filter((entry) => entry.category.startsWith("presumptive_"))
        .map((entry) => ({
          code: "PRESUMPTIVE_ACTIVITY_SNAPSHOT_UNVERIFIED" as const,
          ledgerKind: "income" as const,
          ledgerId: entry.id,
          entryType: entry.category,
          amount: entry.amount,
          message: `Stored presumptive activity eligibility is unverifiable: ${activityVerification.reason}.`,
        }));
  return {
    input: {
      assessmentYear: payload.assessmentYear,
      financialYear: payload.financialYear,
      taxpayer: payload.taxpayer ?? { residentStatus: "resident", ageCategory: "below_60" },
      selectedItrType: undefined,
      clientApprovalStatus: "not_requested",
      filingStatus: "in_preparation",
      eVerificationStatus: "not_applicable",
      finalized: false,
      requiredDocuments: [],
      income: [...payload.income],
      taxPaid: [...payload.taxPaid],
      deductions: [...payload.deductions],
      capitalGains: [...payload.capitalGains],
      housePropertyEntries: [...(payload.housePropertyEntries ?? [])],
      businessBooksEntries: [...(payload.businessBooksEntries ?? [])],
      broughtForwardLosses: [...(payload.broughtForwardLosses ?? [])],
    },
    warnings: activityWarnings,
    // `ageDerivation` is not stored and `describeCaseTraceability` never reads
    // it. The manifest's OWN senior-treatment fields (evidence-manifest.ts) are
    // computed fresh from the CURRENT profile, never reconstructed here.
    ageDerivation: { outcome: "unavailable", reason: "missing_dob" },
    complete: activityVerification.ok,
    presumptiveActivityEligibility:
      payload.presumptiveActivityEligibility &&
      typeof payload.presumptiveActivityEligibility === "object"
        ? (payload.presumptiveActivityEligibility as PresumptiveActivityEligibilitySnapshot)
        : { version: "TAX_SAFE_03.presumptive_activity_snapshot.v1", eligible: false, rows: [] },
    excludedLedgerIds: activityWarnings.map((warning) => warning.ledgerId),
    sourceTrace: [],
    mappedEntryCount:
      payload.income.length +
      payload.taxPaid.length +
      payload.deductions.length +
      payload.capitalGains.length +
      (payload.housePropertyEntries?.length ?? 0) +
      (payload.businessBooksEntries?.length ?? 0) +
      (payload.broughtForwardLosses?.length ?? 0),
    unsupportedEntryCount: activityWarnings.length,
    summary: {
      salary: 0,
      interest: 0,
      dividendOther: 0,
      exempt: 0,
      deductions: 0,
      stcg111a: 0,
      ltcg112a: 0,
      totalTaxPaid: 0,
      houseProperty: (payload.housePropertyEntries ?? []).reduce(
        (total, entry) => total + entry.annualRentReceived - entry.homeLoanInterest,
        0,
      ),
      // K4-07: same disclosed limitation — presumptive professional (44ADA)
      // facts are not (yet) persisted into StoredEngineInputPayload either.
      presumptiveProfessionalIncome: 0,
      // K4-08: same disclosed limitation for presumptive business (44AD).
      presumptiveBusinessTurnover: 0,
      businessBooksNetProfit: (payload.businessBooksEntries ?? []).reduce(
        (total, entry) => total + entry.revenue - entry.expenses,
        0,
      ),
      broughtForwardLoss: (payload.broughtForwardLosses ?? []).reduce(
        (total, entry) => total + entry.amount,
        0,
      ),
    },
  };
}

/**
 * Rebuild a `LedgerRows` shape from a snapshot's stored engine input — used
 * ONLY so `describeCaseTraceability` can resolve which facts contributed to
 * each figure. Document LABELS were not captured in the snapshot's stored
 * engine input (only ids/amounts/source types were), so every row's label is
 * `null` here — an honest limitation, not a fabrication, the same discipline
 * `case-traceability.ts` already applies to a deduction's separate proof
 * document (`documentLabelIndex`'s own doc comment).
 */
export function buildLedgerRowsFromSnapshot(payload: StoredEngineInputPayload): LedgerRows {
  const activityRows = new Map(
    Array.isArray(
      (payload.presumptiveActivityEligibility as { rows?: unknown } | undefined)?.rows,
    )
      ? (
          (payload.presumptiveActivityEligibility as PresumptiveActivityEligibilitySnapshot)
            .rows
        ).map((row) => [row.ledgerId, row] as const)
      : [],
  );
  return {
    income: payload.income.map((e) => ({
      id: e.id,
      income_head: e.category,
      amount: e.amount,
      source_type: e.sourceType,
      source_document_id: e.sourceDocumentId ?? null,
      source_document_name: null,
      source_file_name: null,
      presumptive_activity_type: activityRows.get(e.id)?.activityType ?? null,
      receipts_via_banking_channels:
        activityRows.get(e.id)?.bankingChannelsConfirmed ?? null,
    })),
    taxPaid: payload.taxPaid.map((e) => ({
      id: e.id,
      tax_paid_type: e.category,
      amount: e.amount,
      source_type: e.sourceType,
      source_document_id: e.sourceDocumentId ?? null,
      source_document_name: null,
      source_file_name: null,
    })),
    deductions: payload.deductions.map((e) => ({
      id: e.id,
      deduction_type: e.section,
      amount: e.amount,
      source_type: e.sourceType,
      source_document_id: e.sourceDocumentId ?? null,
      proof_case_document_id: e.proofDocumentId ?? null,
      source_document_name: null,
      source_file_name: null,
    })),
    capitalGains: payload.capitalGains.map((e) => ({
      id: e.id,
      gain_type: e.category,
      sale_value: e.sale_value ?? 0,
      cost: e.cost ?? 0,
      expenses: e.expenses ?? 0,
      exemption_claimed: e.exemption_claimed ?? 0,
      taxable_gain: e.taxable_gain ?? e.amount,
      source_type: e.sourceType,
      source_document_id: e.source_document_id ?? e.sourceDocumentId ?? null,
      source_document_name: null,
      source_file_name: null,
    })),
    housePropertyEntries: (payload.housePropertyEntries ?? []).map((e) => ({
      id: e.id,
      usage: e.usage,
      annual_rent_received: e.annualRentReceived,
      municipal_taxes_paid: e.municipalTaxesPaid,
      home_loan_interest: e.homeLoanInterest,
      source_type: e.sourceType,
      source_document_id: e.sourceDocumentId ?? null,
      proof_case_document_id: e.proofDocumentId ?? null,
      source_document_name: null,
      source_file_name: null,
    })),
    businessBooksEntries: (payload.businessBooksEntries ?? []).map((e) => ({
      id: e.id,
      revenue: e.revenue,
      expenses: e.expenses,
      is_profession: e.isProfession,
      adjustments: e.adjustments,
      activity_classification: e.activityClassification,
      // K4-18 — reconstructed because it is a DECLARED fact that changed what
      // the engine was permitted to conclude about Section 44AB, not a derived
      // one. Omitting it would make the replay input describe a different case
      // from the one that produced the output.
      declared_turnover: e.declaredTurnover ?? null,
      book_depreciation: e.bookDepreciation ?? null,
      claims_additional_depreciation: e.claimsAdditionalDepreciation ?? null,
      depreciation_blocks: (e.depreciationBlocks ?? []).map((block) => ({
        asset_class: block.assetClass,
        wdv: block.wdv,
        put_to_use: block.putToUse,
      })),
      source_type: e.sourceType,
      source_document_id: e.sourceDocumentId ?? null,
      proof_case_document_id: e.proofDocumentId ?? null,
      source_document_name: null,
      source_file_name: null,
    })),
    broughtForwardLosses: (payload.broughtForwardLosses ?? []).map((e) => ({
      id: e.id,
      originating_assessment_year: e.originatingAssessmentYear,
      loss_type: e.lossType,
      amount: e.amount,
      filing_eligibility: e.filingEligibility,
      loss_provenance: e.provenance,
      prior_tax_case_id: e.priorTaxCaseId ?? null,
      elected_set_off_target: e.electedSetOffTarget ?? null,
      source_type: e.sourceType ?? "manual",
      source_document_id: e.sourceDocumentId ?? null,
      proof_case_document_id: null,
      source_document_name: null,
      source_file_name: null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Part C/D — internal draft-output package
// ---------------------------------------------------------------------------

/** Everything `buildDraftOutputPackage` needs from a stored computation
 *  snapshot row — a plain projection of `tax_computation_snapshots`, never a
 *  live ledger read. */
export interface StoredSnapshotForDraftOutput {
  readonly id: string;
  readonly createdAt: string;
  readonly complete: boolean;
  readonly assessmentYear: string;
  readonly financialYear: string;
  readonly selectedItrType: string | null;
  readonly recommendedItrType: string;
  readonly engineInput: StoredEngineInputPayload;
  readonly computation: TaxComputation;
  readonly comparison: RegimeComparison;
  readonly recommendation: ItrFormRecommendation;
}

export interface DraftOutputReview {
  readonly status: string;
  readonly reviewSnapshotId: string | null;
}

export type DraftOutputRefusalReason =
  | "not_approved"
  | "snapshot_incomplete"
  | "reliance_blocked"
  | "pack_refused";

export interface DraftOutputRefusal {
  readonly outcome: "refused";
  readonly reason: DraftOutputRefusalReason;
  readonly message: string;
  /** Populated only for `reliance_blocked`. K4-12 widened this to the union:
   *  the section 87A rebate-relief blocker can also refuse a draft output. */
  readonly blocker: TaxCapabilityBlocker | null;
}

export interface DraftOutputPackage {
  readonly outcome: "produced";
  readonly formatVersion: DraftOutputFormatVersion;
  readonly taxCaseId: string;
  readonly snapshotId: string;
  readonly snapshotCreatedAt: string;
  readonly assessmentYear: string;
  readonly financialYear: string;
  readonly selectedItrType: string | null;
  readonly recommendedItrType: string;
  /** Truthful pack disclosure — draft/not-CA-verified is DISCLOSED here,
   *  never gated on (see module doc). */
  readonly pack: GoverningPackState;
  readonly packRelianceBlocker: TaxPackRelianceBlocker | null;
  readonly completeness: CaseCompleteness;
  /** Every material figure, resolved through the SAME `describeCaseTraceability`
   *  authority used by Computation/Validation — no second vocabulary. */
  readonly figures: readonly TraceableLine[];
  readonly evidence: SnapshotEvidenceLineage;
  readonly disclaimer: string;
}

export type DraftOutputResult = DraftOutputPackage | DraftOutputRefusal;

/** Refusal for the case where there is no snapshot to even evaluate (the
 *  case carries no `client_review_snapshot_id` at all) — a read model may
 *  use this instead of fabricating a snapshot argument to pass through
 *  `buildDraftOutputPackage`. Same `not_approved` reason and wording
 *  discipline as the in-function refusal below. */
export function noCurrentApprovalRefusal(): DraftOutputRefusal {
  return Object.freeze({
    outcome: "refused",
    reason: "not_approved",
    message:
      "This case has no computation snapshot currently bound to an approved " +
      "client review. Capture client approval in Client Review first.",
    blocker: null,
  });
}

/**
 * K3-32 Part C/D. Build the internal draft-output package for exactly ONE
 * immutable snapshot — but only when that snapshot currently carries the
 * case's approval AND is not reliance-blocked. Never reads live ledgers: the
 * function accepts no live-ledger parameter, so it structurally cannot
 * (`__tests__/draft-output.test.ts` proves determinism — identical inputs
 * always yield identical output, and varying the inert placeholder fields
 * `buildAdapterResultFromSnapshot` must supply never changes it).
 *
 * Refuses (never guesses) when:
 *   - `not_approved` — this snapshot is not the one the case's CURRENT
 *     approval is bound to (`isApprovalCurrentForSnapshot`, `filing-
 *     readiness.ts` — the SAME check `assembleFilingReadiness`'s own
 *     `approvalCurrent` item uses; no second derivation).
 *   - `snapshot_incomplete` — defensive; unreachable in practice because
 *     only a complete snapshot may ever be approved, but never trusted.
 *   - `reliance_blocked` — `tax-capability.ts`'s evaluator (today: the
 *     surcharge/marginal-relief risk detector) trips against the snapshot's
 *     OWN stored total income, via the same conservative
 *     `totalIncomeForSurchargeApplicability` helper every other enforcement
 *     layer uses.
 *   - `pack_refused` — the case's statutory coordinates resolve to no bound
 *     tax pack (`describeCaseTraceability`'s own refusal, passed through
 *     verbatim).
 */
export function buildDraftOutputPackage(args: {
  readonly taxCaseId: string;
  readonly statutory: TaxCaseStatutoryContext;
  readonly snapshot: StoredSnapshotForDraftOutput;
  readonly review: DraftOutputReview;
  readonly promotedProposals: readonly PromotedProposalLineage[];
}): DraftOutputResult {
  const { taxCaseId, statutory, snapshot, review, promotedProposals } = args;

  if (!isApprovalCurrentForSnapshot(review, snapshot.id)) {
    return Object.freeze({
      outcome: "refused",
      reason: "not_approved",
      message:
        "This snapshot does not carry the case's current client approval. A " +
        "draft output may only be built from the exact snapshot the case's " +
        "current approval is bound to.",
      blocker: null,
    });
  }
  if (!snapshot.complete) {
    return Object.freeze({
      outcome: "refused",
      reason: "snapshot_incomplete",
      message: "The approved snapshot is not a complete computation snapshot.",
      blocker: null,
    });
  }

  const totalIncome = totalIncomeForSurchargeApplicability(
    snapshot.computation.oldRegime.totalIncome.value,
    snapshot.computation.newRegime.totalIncome.value,
  );
  // K4-11: the engine's own surcharge verdict, from the SAME approved snapshot
  // `totalIncome` was read from. Absent on a pre-K4-11 snapshot → fails closed.
  const capability = evaluateTaxCapability({
    totalIncome,
    surchargeTreatmentSupported: snapshot.computation.surchargeTreatmentSupported,
    // K4-12: the section 87A relief window is tested against the NEW regime's
    // own total income (the relief reaches that regime only), from the same
    // approved snapshot. Absent on a pre-K4-12 snapshot → fails closed, but
    // only inside the window where relief could actually have been due.
    newRegimeTotalIncome: snapshot.computation.newRegime.totalIncome.value,
    rebateReliefTreatmentSupported: snapshot.computation.rebateReliefTreatmentSupported,
    // K4-23 review F1: read from the SAME stored snapshot every other figure
    // here comes from. Absent on a pre-K4-23 snapshot, which cannot carry a
    // long-term house sale at all (every such case refused), so
    // `hasHouseSaleLtcg` is false there and absence blocks nothing.
    hasHouseSaleLtcg: snapshotHasHouseSaleLtcg(snapshot),
    houseSaleLtcgTreatmentSupported: snapshot.computation.houseSaleLtcgTreatmentSupported,
  });
  const blocker = capability.blockers[0] ?? null;
  if (blocker) {
    return Object.freeze({
      outcome: "refused",
      reason: "reliance_blocked",
      message: `Not eligible for a draft output: ${blocker.message}`,
      blocker,
    });
  }

  const adapter = buildAdapterResultFromSnapshot(snapshot.engineInput);
  if (!adapter.complete) {
    return Object.freeze({
      outcome: "refused",
      reason: "snapshot_incomplete",
      message: "The approved snapshot has no verifiable presumptive activity eligibility contract.",
      blocker: null,
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
    });
  }

  const evidence = resolveSnapshotEvidenceLineage(snapshot.engineInput, taxCaseId, promotedProposals);

  return Object.freeze({
    outcome: "produced",
    formatVersion: DRAFT_OUTPUT_FORMAT_VERSION,
    taxCaseId,
    snapshotId: snapshot.id,
    snapshotCreatedAt: snapshot.createdAt,
    assessmentYear: snapshot.assessmentYear,
    financialYear: snapshot.financialYear,
    selectedItrType: snapshot.selectedItrType,
    recommendedItrType: snapshot.recommendedItrType,
    pack: traceability.pack,
    packRelianceBlocker: traceability.relianceBlocker,
    completeness: traceability.completeness,
    figures: traceability.lines,
    evidence,
    disclaimer: DRAFT_OUTPUT_DISCLAIMER,
  });
}
