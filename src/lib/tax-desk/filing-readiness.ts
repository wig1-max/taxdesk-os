/**
 * Tax Desk → Filing Readiness assembler (K.2.8). PURE — no React/Next/Supabase,
 * no DB writes, no server actions. Deterministic and unit-testable.
 *
 * Produces an explainable set of readiness items (each passed / warning /
 * blocked / not_applicable), an overall readiness status, and finalize/reopen
 * capability — from ONE explicit latest-complete computation snapshot compared
 * against current live Tax Desk data.
 *
 * "Ready for internal finalization" means every BLOCKING check passes. It does
 * NOT mean the return is filed, accepted, e-verified, certified, or correct.
 *
 * Nothing sensitive flows through: no PAN, Aadhaar, ledger notes, file URLs,
 * storage paths, credentials, or auth identifiers.
 */

import type { TaxEngineInput, Regime } from "@/lib/tax-engine/ay-2026-27";
import { evaluateRebateMarginalReliefRisk, evaluateSurchargeMarginalReliefRisk } from "./tax-capability";
import { evaluateSeniorTreatmentRisk, type TaxpayerAgeBand } from "./senior-treatment";

/** Version stamp for the K.2.8 readiness rule catalogue (independent of the
 *  engine rules version, which is checked separately per-snapshot). */
export const READINESS_RULES_VERSION = "K2.8.readiness.v1";

// Two DISTINCT concepts, kept separate on purpose (K.2.9.4 status-copy):
//   • preparation-only boundary — this checks preparation; it does not file,
//     authorize e-filing, confirm acceptance, and is not tax advice; and
//   • the universal quality policy — every return still gets independent
//     professional review before filing (worded as "independent professional
//     review", NEVER conflated with the eligibility-triggered manual
//     preparation gate or the credentialed qualified-reviewer sign-off).
export const FILING_READINESS_DISCLAIMER =
  "Filing Readiness is an internal TaxDesk OS preparation check. It does not " +
  "file the return, authorize e-filing, or confirm tax authority acceptance, " +
  "and it is not tax advice. Every return still requires independent " +
  "professional review before filing.";

export type ReadinessItemStatus = "passed" | "warning" | "blocked" | "not_applicable";
export type OverallReadiness = "blocked" | "ready" | "finalized" | "reopened_needs_review";

export interface ReadinessItem {
  itemKey: string;
  category: "computation" | "validation" | "documents" | "client_review" | "itr" | "case";
  title: string;
  message: string;
  status: ReadinessItemStatus;
  isBlocking: boolean;
  /** Safe structured details — counts/ids/flags only, never sensitive text. */
  details: Record<string, unknown>;
  /** Optional safe subject reference (e.g. a snapshot id). */
  subject?: string | null;
  rulesVersion: string;
}

// --- normalized, already-safe inputs ---------------------------------------

export interface ReadinessCaseContext {
  clientName: string;
  caseDisplayCode: string | null;
  caseTitle: string | null;
  assessmentYear: string;
  financialYear: string;
  selectedItrType: string | null;
  recommendedItrType: string | null;
  finalizedAt: string | null;
  finalizedByName: string | null;
  finalizedSnapshotId: string | null;
  reopenedAt: string | null;
  reopenedByName: string | null;
}

/** A parsed latest-complete snapshot, with its stored engine input for the
 *  live-vs-snapshot comparison. `parseOk` is false when the payload could not
 *  be parsed into a usable engine input. */
export interface ReadinessSnapshot {
  id: string;
  createdAt: string;
  rulesVersion: string;
  complete: boolean;
  parseOk: boolean;
  selectedItrType: string | null;
  createdByName: string | null;
  /** The stored notes-free input for computation-output replay. */
  engineInput: ReadinessEngineInput | null;
}

export interface ReadinessLive {
  engineInput: TaxEngineInput & { presumptiveActivityEligibility?: unknown };
  complete: boolean;
  unsupportedEntryCount: number;
  selectedItrType: string | null;
}

export type ReadinessEngineInput = Partial<TaxEngineInput> & {
  presumptiveActivityEligibility?: unknown;
};

export interface ReadinessDocuments {
  requiredTotal: number;
  requiredOutstanding: number; // required & pending/requested (not yet received)
  requiredRejected: number; // required & rejected
  receivedUnverified: number; // received but not verified (warning only)
}

export interface ReadinessValidation {
  runExists: boolean;
  lastRunAt: string | null;
  rulesVersion: string | null;
  openError: number;
  openBlocker: number;
  openWarning: number;
  openInfo: number;
  /** Newest change to live ledgers (max updated_at), if known. */
  latestLedgerChangeAt: string | null;
  /** Open error/blocker finding ids (safe — ids only) for evidence. */
  openBlockerFindingIds: string[];
}

export interface ReadinessReview {
  status: string; // client_review_status
  reviewSnapshotId: string | null;
  approvedAt: string | null;
  approvalMethod: string | null;
}

/**
 * Whether `review`'s CURRENT client approval is bound to EXACTLY this
 * snapshot id (K3-32). The single derivation of "is this the snapshot
 * approval currently points to" — `assembleFilingReadiness`'s own
 * `approvalCurrent` item and `draft-output.ts`'s package builder both
 * consume this rather than re-deriving it (program §2, "one authority per
 * concept").
 */
export function isApprovalCurrentForSnapshot(
  review: Pick<ReadinessReview, "status" | "reviewSnapshotId">,
  snapshotId: string,
): boolean {
  return review.status === "approved" && review.reviewSnapshotId === snapshotId;
}

/** Canonical computation-eligibility signal (K.2.8.9A). Derived by the one
 *  eligibility evaluator and surfaced here as a blocking readiness item so the
 *  rail, Readiness page and finalize capability all agree. */
export interface ReadinessEligibility {
  eligible: boolean;
  blockers: { code: string; message: string }[];
}

/** K4-01: the taxpayer's age band + residential status (derived from the
 *  CURRENT profile — never a hardcoded literal), and the regime the LATEST
 *  evidence manifest bound to the latest complete snapshot explicitly
 *  selected, if any (`null` when no manifest exists yet — the case has not
 *  reached the `snapshot_selected_regime` evaluation context). Used ONLY to
 *  evaluate {@link evaluateSeniorTreatmentRisk}. */
export interface ReadinessSeniorTreatment {
  ageBand: TaxpayerAgeBand | null;
  residentialStatus: string | null;
  selectedRegimeForLatestManifest: Regime | null;
}

/** TAX-SAFE-01: the case's computed total income, when known — used ONLY to
 *  evaluate the sourced, conservative surcharge/marginal-relief reliance
 *  detector (`tax-capability.ts`). `null` when no computation exists yet. */
export interface ReadinessCapability {
  totalIncome: number | null;
  /** K4-11 — the engine's own surcharge verdict for the SAME computation
   *  `totalIncome` came from. `null`/`undefined` fails closed. Never derived
   *  from `totalIncome` here: `surcharge.ts` is the single authority. */
  surchargeTreatmentSupported: boolean | null | undefined;
  /** K4-12 — the NEW regime's own total income, the base the section 87A
   *  rebate-relief window is tested against. Deliberately NOT the
   *  higher-of-both base `totalIncome` above carries: the relief reaches the
   *  new regime only. `null` when no computation exists yet. */
  newRegimeTotalIncome: number | null;
  /** K4-12 — the engine's own section 87A verdict for the SAME computation.
   *  `null`/`undefined` fails closed, but only inside the relief window. */
  rebateReliefTreatmentSupported: boolean | null | undefined;
  /**
   * K4-23 review F1 (P1) — the engine's own verdict on the section 112
   * long-term house-sale treatment for the SAME computation.
   *
   * `false` means the engine REMOVED a real long-term gain from both tax and
   * gross total income, because the s.112(1)(a) first proviso could have
   * changed the figure (`D337` item 5). The computation that results is
   * knowingly incomplete, and before this was wired it could still proceed
   * to approval and finalization with the gain silently absent — which is
   * the opposite of failing closed.
   *
   * `null`/`undefined` fails closed only when a long-term house sale is
   * actually present, so no pre-K4-23 snapshot is blocked by absence: every
   * such case refused the gain outright and carries none.
   */
  houseSaleLtcgTreatmentSupported: boolean | null | undefined;
  /** K4-23 — whether the computation carries a long-term house sale at all. */
  hasHouseSaleLtcg: boolean;
  seniorTreatment: ReadinessSeniorTreatment;
}

export interface FilingReadinessInput {
  case: ReadinessCaseContext;
  latestCompleteSnapshot: ReadinessSnapshot | null;
  live: ReadinessLive;
  documents: ReadinessDocuments;
  validation: ReadinessValidation;
  review: ReadinessReview;
  eligibility: ReadinessEligibility;
  capability: ReadinessCapability;
  engineRulesVersion: string;
}

// --- canonical engine-input comparison -------------------------------------

const round2 = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};
const s = (v: unknown): string | null => (v === undefined || v === null || v === "" ? null : String(v));

/**
 * Produce a STABLE canonical string for an engine input: arrays sorted by a
 * deterministic key, decimals normalized, storage-only metadata ignored, and
 * actual tax-input fields preserved. Order of ledger rows is not materially
 * significant, so sorting makes the comparison robust to reordering.
 */
export function canonicalizeEngineInput(input: ReadinessEngineInput | null | undefined): string {
  if (!input) return "null";
  const income = (input.income ?? [])
    .map((e) => ({ id: e.id, category: e.category, amount: round2(e.amount), sourceType: e.sourceType, doc: s(e.sourceDocumentId) }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const taxPaid = (input.taxPaid ?? [])
    .map((e) => ({ id: e.id, category: e.category, amount: round2(e.amount), sourceType: e.sourceType, doc: s(e.sourceDocumentId) }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const deductions = (input.deductions ?? [])
    .map((e) => ({
      id: e.id,
      section: e.section,
      amount: round2(e.amount),
      sourceType: e.sourceType,
      doc: s(e.sourceDocumentId),
      proof: s(e.proofDocumentId),
      insuredPartySenior: e.insuredPartySenior === true,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const capitalGains = (input.capitalGains ?? [])
    .map((e) => ({
      id: e.id,
      category: e.category,
      taxable_gain: round2(e.taxable_gain ?? e.amount),
      sale_value: round2(e.sale_value),
      cost: round2(e.cost),
      expenses: round2(e.expenses),
      exemption_claimed: round2(e.exemption_claimed),
      sourceType: e.sourceType,
      doc: s(e.source_document_id ?? e.sourceDocumentId),
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const housePropertyEntries = (input.housePropertyEntries ?? [])
    .map((e) => ({
      id: e.id,
      usage: e.usage,
      amount: round2(e.amount),
      annualRentReceived: round2(e.annualRentReceived),
      municipalTaxesPaid: round2(e.municipalTaxesPaid),
      homeLoanInterest: round2(e.homeLoanInterest),
      sourceType: e.sourceType,
      doc: s(e.sourceDocumentId),
      proof: s(e.proofDocumentId),
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const businessBooksEntries = (input.businessBooksEntries ?? [])
    .map((e) => ({
      id: e.id,
      amount: round2(e.amount),
      revenue: round2(e.revenue),
      expenses: round2(e.expenses),
      isProfession: e.isProfession === true,
      adjustments: e.adjustments,
      activityClassification: e.activityClassification,
      sourceType: e.sourceType,
      doc: s(e.sourceDocumentId),
      proof: s(e.proofDocumentId),
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const broughtForwardLosses = (input.broughtForwardLosses ?? [])
    .map((e) => ({
      id: e.id,
      originatingAssessmentYear: e.originatingAssessmentYear,
      lossType: e.lossType,
      amount: round2(e.amount),
      filingEligibility: e.filingEligibility,
      provenance: e.provenance,
      priorTaxCaseId: s(e.priorTaxCaseId),
      electedSetOffTarget: s(e.electedSetOffTarget),
      sourceType: s(e.sourceType),
      doc: s(e.sourceDocumentId),
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const hasPresumptiveIncome = income.some((entry) =>
    entry.category.startsWith("presumptive_"),
  );
  const rawActivity = input.presumptiveActivityEligibility as
    | { version?: unknown; eligible?: unknown; rows?: unknown }
    | undefined;
  const activity = hasPresumptiveIncome
    ? {
        version: rawActivity?.version ?? null,
        eligible: rawActivity?.eligible === true,
        rows: Array.isArray(rawActivity?.rows)
          ? rawActivity.rows
              .map((raw) => {
                const row = raw as Record<string, unknown>;
                return {
                  ledgerId: s(row.ledgerId),
                  incomeHead: s(row.incomeHead),
                  amount: round2(row.amount),
                  activityType: s(row.activityType),
                  bankingChannelsConfirmed:
                    row.bankingChannelsConfirmed === true,
                };
              })
              .sort((a, b) =>
                (a.ledgerId ?? "") < (b.ledgerId ?? "") ? -1 :
                (a.ledgerId ?? "") > (b.ledgerId ?? "") ? 1 : 0,
              )
          : null,
      }
    : null;
  return JSON.stringify({
    assessmentYear: s(input.assessmentYear),
    financialYear: s(input.financialYear),
    taxpayer: {
      residentStatus: s(input.taxpayer?.residentStatus),
      ageCategory: s(input.taxpayer?.ageCategory),
    },
    itr: s(input.selectedItrType),
    hasForeignAssets: input.hasForeignAssets === true,
    income,
    taxPaid,
    deductions,
    capitalGains,
    housePropertyEntries,
    businessBooksEntries,
    broughtForwardLosses,
    presumptiveActivityEligibility: activity,
  });
}

/** True when live normalized input exactly equals the snapshot's stored input. */
export function liveMatchesSnapshot(
  live: ReadinessEngineInput | null,
  snapshot: ReadinessEngineInput | null,
): boolean {
  return canonicalizeEngineInput(live) === canonicalizeEngineInput(snapshot);
}

// --- timestamp helpers -----------------------------------------------------

const isAfter = (a: string | null, b: string | null): boolean => {
  if (!a || !b) return false;
  return new Date(a).getTime() > new Date(b).getTime();
};

// --- assembled output ------------------------------------------------------

export interface FilingReadinessModel {
  case: {
    clientName: string;
    caseDisplayCode: string | null;
    caseTitle: string | null;
    assessmentYear: string;
    financialYear: string;
    selectedItrType: string | null;
    recommendedItrType: string | null;
    snapshotAt: string | null;
    snapshotId: string | null;
    rulesVersion: string | null;
    finalizedAt: string | null;
    finalizedByName: string | null;
    finalizedSnapshotId: string | null;
    reopenedAt: string | null;
    reopenedByName: string | null;
  };
  items: ReadinessItem[];
  counts: { blocked: number; warning: number; passed: number; notApplicable: number };
  overall: OverallReadiness;
  snapshotFresh: boolean;
  validationFresh: boolean;
  approvalCurrent: boolean;
  capabilities: { canFinalize: boolean; canReopen: boolean };
  disclaimer: string;
  readinessRulesVersion: string;
}

const V = READINESS_RULES_VERSION;

/** Assemble the deterministic filing-readiness model. Pure. */
export function assembleFilingReadiness(input: FilingReadinessInput): FilingReadinessModel {
  const { case: c, latestCompleteSnapshot: snap, live, documents: docs, validation: val, review, eligibility } = input;
  const items: ReadinessItem[] = [];
  const add = (i: Omit<ReadinessItem, "rulesVersion">) => items.push({ ...i, rulesVersion: V });

  const hasSnapshot = !!snap && snap.complete && snap.parseOk;

  // 0. Computation eligibility (K.2.8.9A) — the gate ahead of every other check.
  //    When ineligible, no computation/recommendation/review/finalization may
  //    proceed, so this is the first blocking item.
  add({
    itemKey: "eligibility.case_eligible",
    category: "case",
    title: "Eligible for computation",
    message: eligibility.eligible
      ? "The taxpayer profile, data and supported-rule coverage satisfy the computation eligibility gate."
      : `Not eligible for computation yet — ${eligibility.blockers.length} item${eligibility.blockers.length === 1 ? "" : "s"} to resolve${eligibility.blockers[0] ? `: ${eligibility.blockers[0].message}` : "."}`,
    status: eligibility.eligible ? "passed" : "blocked",
    isBlocking: true,
    details: {
      eligible: eligibility.eligible,
      blockerCodes: eligibility.blockers.map((b) => b.code),
    },
  });

  // 0b. TAX-SAFE-01: surcharge / marginal-relief structural reliance blocker.
  //     Automatic and income-derived — unlike the declared special-situation
  //     mechanism above, this does not depend on a preparer remembering to
  //     flag the case. Blocks approval/finalization readiness; it does NOT
  //     block a provisional computation from being produced/reviewed.
  //     K4-11: narrowed — a case above the threshold is now blocked only where
  //     the engine could not complete the treatment (see `tax-capability.ts`).
  const surchargeRisk = evaluateSurchargeMarginalReliefRisk(
    input.capability.totalIncome,
    input.capability.surchargeTreatmentSupported,
  );
  add({
    itemKey: "capability.surcharge_marginal_relief",
    category: "computation",
    title: "Surcharge / marginal relief not applicable or handled",
    message: surchargeRisk
      ? surchargeRisk.message
      : "Surcharge is either not applicable to this case's total income, or was computed within the " +
        "supported window with marginal relief either exactly computed or provably nil — or no " +
        "computation exists yet.",
    status: surchargeRisk ? "blocked" : "passed",
    isBlocking: true,
    details: surchargeRisk
      ? {
          blockerCode: surchargeRisk.code,
          totalIncome: surchargeRisk.totalIncome,
          thresholdInr: surchargeRisk.thresholdInr,
        }
      : { totalIncome: input.capability.totalIncome },
  });

  // 0b-ii. K4-12: the SEPARATE section 87A rebate-threshold relief blocker. Its
  //        own readiness item rather than a second reason folded into the one
  //        above, because they refuse different cases at incomes three orders
  //        of magnitude apart — and a preparer of a ₹12.2 lakh case told
  //        "surcharge / marginal relief" would be reading something untrue
  //        (`D129`'s status-copy rule).
  const rebateReliefRisk = evaluateRebateMarginalReliefRisk(
    input.capability.newRegimeTotalIncome,
    input.capability.rebateReliefTreatmentSupported,
  );
  add({
    itemKey: "capability.rebate_marginal_relief",
    category: "computation",
    title: "Section 87A rebate-threshold relief not applicable or handled",
    message: rebateReliefRisk
      ? rebateReliefRisk.message
      : "The new-regime total income is either outside the narrow band just above the ₹12,00,000 " +
        "section 87A rebate ceiling where marginal relief can arise, or the relief was computed " +
        "within the supported window — or no computation exists yet.",
    status: rebateReliefRisk ? "blocked" : "passed",
    isBlocking: true,
    details: rebateReliefRisk
      ? {
          blockerCode: rebateReliefRisk.code,
          totalIncome: rebateReliefRisk.totalIncome,
          ceilingInr: rebateReliefRisk.ceilingInr,
          windowUpperInr: rebateReliefRisk.windowUpperInr,
        }
      : { newRegimeTotalIncome: input.capability.newRegimeTotalIncome },
  });

  // 0b-ii. K4-23 review F1: the section 112 long-term house-sale verdict.
  //        A THIRD marker, deliberately its own rather than ANDed into the two
  //        above, for the same reason `D172` gives: they refuse different
  //        cases, and a preparer told "surcharge" about a house-sale refusal
  //        would be reading something untrue (`D129`'s status-copy rule).
  const houseSaleLtcgRefused =
    input.capability.hasHouseSaleLtcg &&
    input.capability.houseSaleLtcgTreatmentSupported !== true;
  add({
    itemKey: "capability.house_sale_ltcg",
    category: "computation",
    title: "House-sale long-term capital gain computed or not present",
    message: houseSaleLtcgRefused
      ? "This case carries a long-term house sale whose section 112 treatment the engine REFUSED, " +
        "so the gain has been removed from both the tax and the gross total income. The first " +
        "proviso to section 112(1)(a) reduces a long-term gain where total income as reduced by " +
        "it falls short of the maximum amount not chargeable to tax, and this engine does not " +
        "apply that reduction — so the figure could be wrong in either regime. The computation is " +
        "knowingly incomplete and must not be relied on or approved."
      : "Either no long-term house sale is present, or its section 112 comparison was computed " +
        "within the supported window.",
    status: houseSaleLtcgRefused ? "blocked" : "passed",
    isBlocking: true,
    details: houseSaleLtcgRefused
      ? { blockerCode: "HOUSE_SALE_LTCG_BASIC_EXEMPTION_ABSORPTION_UNSUPPORTED" }
      : { hasHouseSaleLtcg: input.capability.hasHouseSaleLtcg },
  });

  // 0c. K4-01: senior/super-senior PRE-APPROVAL regime-comparison reliability.
  //     As of K4-05 (decision D79) this no longer disclosures a risk for a
  //     resident senior/super-senior taxpayer — the full later-computation
  //     dossier is closed — but STILL fails closed (blocking) when
  //     residential status is unresolved, mirroring
  //     evaluateSeniorTreatmentRisk's own residency handling (unchanged).
  const st = input.capability.seniorTreatment;
  const preApprovalSenior = evaluateSeniorTreatmentRisk({
    ageBand: st.ageBand,
    residentialStatus: st.residentialStatus,
    context: "pre_approval_regime_comparison",
    selectedRegime: null,
  });
  add({
    itemKey: "capability.senior_treatment_comparison_reliability",
    category: "computation",
    title: "Regime comparison reliable for taxpayer's age",
    message: preApprovalSenior.riskCode
      ? preApprovalSenior.reason
      : "No senior/super-senior regime-comparison risk detected for this taxpayer.",
    status: preApprovalSenior.isRelianceBlocked ? "blocked" : preApprovalSenior.riskCode ? "warning" : "passed",
    isBlocking: preApprovalSenior.isRelianceBlocked,
    details: {
      riskCode: preApprovalSenior.riskCode,
      ageBand: preApprovalSenior.ageBand,
      residentialStatus: preApprovalSenior.residentialStatus,
    },
  });

  // 0d. K4-01: senior/super-senior SELECTED-REGIME reliance (the real
  //     enforcement layer). `not_applicable` until a regime has been
  //     explicitly selected (an evidence manifest exists) for the latest
  //     complete snapshot — this item never guesses a regime.
  const selectedRegimeSenior = st.selectedRegimeForLatestManifest
    ? evaluateSeniorTreatmentRisk({
        ageBand: st.ageBand,
        residentialStatus: st.residentialStatus,
        context: "snapshot_selected_regime",
        selectedRegime: st.selectedRegimeForLatestManifest,
      })
    : null;
  add({
    itemKey: "capability.senior_treatment_selected_regime",
    category: "computation",
    title: "Selected-regime senior/super-senior treatment supported",
    message: !st.selectedRegimeForLatestManifest
      ? "No regime has been explicitly selected yet (generate an accepted-evidence manifest in Client Review)."
      : selectedRegimeSenior?.riskCode
        ? selectedRegimeSenior.reason
        : "The selected regime is not blocked by senior/super-senior treatment.",
    status: !st.selectedRegimeForLatestManifest
      ? "not_applicable"
      : selectedRegimeSenior?.isRelianceBlocked
        ? "blocked"
        : "passed",
    isBlocking: !!selectedRegimeSenior?.isRelianceBlocked,
    details: {
      selectedRegime: st.selectedRegimeForLatestManifest,
      riskCode: selectedRegimeSenior?.riskCode ?? null,
    },
  });

  // 1. Computation snapshot exists + complete + parses.
  add({
    itemKey: "computation.snapshot_complete",
    category: "computation",
    title: "Complete computation snapshot",
    message: hasSnapshot
      ? "A complete computation snapshot exists for this case."
      : snap && !snap.complete
        ? "The latest snapshot is partial/incomplete. Save a complete snapshot in Computation."
        : snap && !snap.parseOk
          ? "The latest snapshot payload could not be parsed. Save a new complete snapshot."
          : "No complete computation snapshot exists. Save one in Computation first.",
    status: hasSnapshot ? "passed" : "blocked",
    isBlocking: true,
    details: { hasSnapshot, complete: snap?.complete ?? false, parseOk: snap?.parseOk ?? false },
    subject: snap?.id ?? null,
  });

  // 2. Snapshot engine/rules version supported.
  add({
    itemKey: "computation.snapshot_engine_version",
    category: "computation",
    title: "Supported engine version",
    message: !snap
      ? "No snapshot to check the engine version against."
      : snap.rulesVersion === input.engineRulesVersion
        ? `Snapshot uses the supported engine (${snap.rulesVersion}).`
        : `Snapshot engine (${snap.rulesVersion}) differs from the supported engine (${input.engineRulesVersion}). Save a fresh snapshot.`,
    status: !snap ? "not_applicable" : snap.rulesVersion === input.engineRulesVersion ? "passed" : "blocked",
    isBlocking: true,
    details: { snapshotEngine: snap?.rulesVersion ?? null, supportedEngine: input.engineRulesVersion },
    subject: snap?.id ?? null,
  });

  // 3. Snapshot matches live data (the mandatory freshness check).
  const snapshotFresh =
    hasSnapshot &&
    live.complete &&
    live.unsupportedEntryCount === 0 &&
    liveMatchesSnapshot(live.engineInput, snap?.engineInput ?? null);
  add({
    itemKey: "computation.snapshot_matches_live_data",
    category: "computation",
    title: "Snapshot matches live data",
    message: !hasSnapshot
      ? "No complete snapshot to compare against live data."
      : snapshotFresh
        ? "Live Tax Desk data matches the latest computation snapshot."
        : "Live Tax Desk data has changed since the latest computation snapshot. Save a new complete snapshot and obtain fresh client review before finalization.",
    status: !hasSnapshot ? "blocked" : snapshotFresh ? "passed" : "blocked",
    isBlocking: true,
    details: {
      liveComplete: live.complete,
      liveUnsupportedEntries: live.unsupportedEntryCount,
      matches: hasSnapshot ? liveMatchesSnapshot(live.engineInput, snap?.engineInput ?? null) : false,
    },
    subject: snap?.id ?? null,
  });

  // 4. Validation has been run at least once.
  add({
    itemKey: "validation.run_exists",
    category: "validation",
    title: "Validation has been run",
    message: val.runExists
      ? "A validation refresh has been completed for this case."
      : "Validation has never been run. Run validation before finalization.",
    status: val.runExists ? "passed" : "blocked",
    isBlocking: true,
    details: { runExists: val.runExists, lastRunAt: val.lastRunAt },
  });

  // 5. Validation is current (not older than snapshot / latest ledger change).
  const validationFresh =
    val.runExists &&
    !!val.lastRunAt &&
    !isAfter(snap?.createdAt ?? null, val.lastRunAt) &&
    !isAfter(val.latestLedgerChangeAt, val.lastRunAt);
  add({
    itemKey: "validation.is_current",
    category: "validation",
    title: "Validation is current",
    message: !val.runExists
      ? "Validation has not been run yet."
      : validationFresh
        ? "The latest validation run reflects the current snapshot and data."
        : "Validation is stale — data or the snapshot changed after the last validation run. Re-run validation.",
    status: !val.runExists ? "not_applicable" : validationFresh ? "passed" : "blocked",
    isBlocking: true,
    details: {
      validationLastRunAt: val.lastRunAt,
      snapshotAt: snap?.createdAt ?? null,
      latestLedgerChangeAt: val.latestLedgerChangeAt,
    },
  });

  // 6. No open error/blocker findings.
  const openBlockers = val.openError + val.openBlocker;
  add({
    itemKey: "validation.no_open_blockers",
    category: "validation",
    title: "No open validation errors",
    message: openBlockers === 0
      ? "There are no open validation errors or blockers."
      : `Resolve ${openBlockers} open validation error/blocker finding${openBlockers === 1 ? "" : "s"} before finalization.`,
    status: openBlockers === 0 ? "passed" : "blocked",
    isBlocking: true,
    details: { openError: val.openError, openBlocker: val.openBlocker, findingIds: val.openBlockerFindingIds },
  });

  // 7. Open warnings — visible, non-blocking.
  add({
    itemKey: "validation.open_warnings",
    category: "validation",
    title: "Open validation warnings",
    message: val.openWarning === 0 && val.openInfo === 0
      ? "No open validation warnings or information items."
      : `${val.openWarning} open warning(s) and ${val.openInfo} information item(s) — review, but they do not block finalization.`,
    status: val.openWarning > 0 || val.openInfo > 0 ? "warning" : "passed",
    isBlocking: false,
    details: { openWarning: val.openWarning, openInfo: val.openInfo },
  });

  // 8. Required documents satisfied.
  const docsSatisfied = docs.requiredOutstanding === 0 && docs.requiredRejected === 0;
  add({
    itemKey: "documents.required_items_satisfied",
    category: "documents",
    title: "Required documents satisfied",
    message: docsSatisfied
      ? "All required checklist items are received, verified or waived."
      : docs.requiredRejected > 0
        ? `${docs.requiredRejected} required document(s) are rejected. Resolve them before finalization.`
        : `${docs.requiredOutstanding} required document(s) are still outstanding.`,
    status: docsSatisfied ? "passed" : "blocked",
    isBlocking: true,
    details: {
      requiredTotal: docs.requiredTotal,
      requiredOutstanding: docs.requiredOutstanding,
      requiredRejected: docs.requiredRejected,
    },
  });

  // 9. Received-but-unverified documents — warning.
  add({
    itemKey: "documents.received_unverified",
    category: "documents",
    title: "Documents pending verification",
    message: docs.receivedUnverified === 0
      ? "No received documents are awaiting verification."
      : `${docs.receivedUnverified} received document(s) are not yet verified — review, non-blocking.`,
    status: docs.receivedUnverified > 0 ? "warning" : "passed",
    isBlocking: false,
    details: { receivedUnverified: docs.receivedUnverified },
  });

  // 10. Client review / approval is current for the latest complete snapshot.
  const approvalCurrent = hasSnapshot && isApprovalCurrentForSnapshot(review, snap!.id);
  const reviewMsg = (() => {
    if (approvalCurrent) return "Client approval is current for the latest complete snapshot.";
    if (review.status === "superseded") return "Client approval was superseded (case reopened). Obtain a fresh client review.";
    if (review.status === "changes_requested") return "Client requested changes. Update the case and obtain a fresh approval.";
    if (review.status === "approved" && review.reviewSnapshotId !== (snap?.id ?? null))
      return "Client approval is stale — it applies to an older snapshot. Prepare the latest snapshot and re-capture approval.";
    return "No current client approval bound to the latest complete snapshot. Capture client approval in Client Review.";
  })();
  // Title is a NEUTRAL category, not an affirmative — a blocked item must never
  // read as if a current approval exists. The state lives in `reviewMsg` (which
  // says "No current client approval…" when none) + the status pill (K.2.9.4).
  add({
    itemKey: "client_review.current_approval",
    category: "client_review",
    title: "Client approval",
    message: reviewMsg,
    status: approvalCurrent ? "passed" : "blocked",
    isBlocking: true,
    details: {
      reviewStatus: review.status,
      reviewSnapshotId: review.reviewSnapshotId,
      latestSnapshotId: snap?.id ?? null,
      approvalMethod: review.approvalMethod,
      approvedAt: review.approvedAt,
    },
  });

  // 11. Selected ITR present.
  add({
    itemKey: "itr.selected",
    category: "itr",
    title: "ITR form selected",
    message: c.selectedItrType
      ? `Selected ITR form: ${c.selectedItrType}.`
      : "No ITR form is selected. Select one before finalization.",
    status: c.selectedItrType ? "passed" : "blocked",
    isBlocking: true,
    details: { selectedItrType: c.selectedItrType },
  });

  // 12. Selected vs recommended ITR — warning only (professional judgment).
  const itrMismatch = !!c.selectedItrType && !!c.recommendedItrType && c.selectedItrType !== c.recommendedItrType;
  add({
    itemKey: "itr.recommendation_match",
    category: "itr",
    title: "ITR matches recommendation",
    message: !c.selectedItrType || !c.recommendedItrType
      ? "No selected/recommended ITR pair to compare."
      : itrMismatch
        ? `Selected ITR (${c.selectedItrType}) differs from the recommended form (${c.recommendedItrType}). Confirm this is intentional.`
        : "Selected ITR matches the recommended form.",
    status: !c.selectedItrType || !c.recommendedItrType ? "not_applicable" : itrMismatch ? "warning" : "passed",
    isBlocking: false,
    details: { selectedItrType: c.selectedItrType, recommendedItrType: c.recommendedItrType },
  });

  // --- roll up ---
  const counts = {
    blocked: items.filter((i) => i.status === "blocked").length,
    warning: items.filter((i) => i.status === "warning").length,
    passed: items.filter((i) => i.status === "passed").length,
    notApplicable: items.filter((i) => i.status === "not_applicable").length,
  };

  const finalized = !!c.finalizedAt;
  const reopened = !!c.reopenedAt && !finalized;
  const blockingFail = items.some((i) => i.isBlocking && i.status === "blocked");

  let overall: OverallReadiness;
  if (finalized) overall = "finalized";
  else if (reopened && blockingFail) overall = "reopened_needs_review";
  else if (blockingFail) overall = "blocked";
  else overall = "ready";

  return {
    case: {
      clientName: c.clientName,
      caseDisplayCode: c.caseDisplayCode,
      caseTitle: c.caseTitle,
      assessmentYear: c.assessmentYear,
      financialYear: c.financialYear,
      selectedItrType: c.selectedItrType,
      recommendedItrType: c.recommendedItrType,
      snapshotAt: snap?.createdAt ?? null,
      snapshotId: snap?.id ?? null,
      rulesVersion: snap?.rulesVersion ?? null,
      finalizedAt: c.finalizedAt,
      finalizedByName: c.finalizedByName,
      finalizedSnapshotId: c.finalizedSnapshotId,
      reopenedAt: c.reopenedAt,
      reopenedByName: c.reopenedByName,
    },
    items,
    counts,
    overall,
    snapshotFresh,
    validationFresh,
    approvalCurrent,
    capabilities: {
      canFinalize: !finalized && !blockingFail,
      canReopen: finalized,
    },
    disclaimer: FILING_READINESS_DISCLAIMER,
    readinessRulesVersion: V,
  };
}

/** One-line banner for the current overall readiness state. */
export function readinessBanner(model: FilingReadinessModel): { tone: "info" | "ok" | "warn" | "error"; text: string } {
  if (model.overall === "finalized") {
    return { tone: "ok", text: "Internally finalized. The Tax Desk record is locked (this is not proof of filing)." };
  }
  if (model.overall === "reopened_needs_review") {
    return { tone: "warn", text: "Reopened — fresh client review and a current snapshot are required before re-finalization." };
  }
  if (!model.case.snapshotId) {
    return { tone: "warn", text: "No complete computation snapshot available." };
  }
  if (!model.snapshotFresh) {
    return { tone: "warn", text: "Live data has changed since the snapshot. Save a new snapshot and re-approve." };
  }
  if (model.overall === "blocked") {
    return { tone: "error", text: "Internal finalization is blocked. Resolve the blocking items below." };
  }
  return { tone: "ok", text: "Ready for internal finalization." };
}

/**
 * Body copy for the readiness status callout (K.2.8.6 polish). Distinguishes
 * the LIVE evaluation (recomputed every load) from PERSISTED checks (`hasRun`),
 * and never shows "run readiness checks" guidance once finalized.
 */
export function readinessStatusLine(args: {
  overall: OverallReadiness;
  hasRun: boolean;
  finalizedAtLabel: string | null;
  finalizedByName: string | null;
}): string {
  if (args.overall === "finalized") {
    const when = args.finalizedAtLabel ? ` on ${args.finalizedAtLabel}` : "";
    const who = args.finalizedByName ? ` by ${args.finalizedByName}` : "";
    return `Internally finalized${when}${who}. The Tax Desk record is locked and read-only — this is not proof of filing. An admin can reopen it if changes are needed.`;
  }
  if (args.overall === "reopened_needs_review") {
    return "Reopened — fresh client review and a current snapshot are required before re-finalization.";
  }
  if (args.overall === "ready") {
    // Finalization re-runs and persists the checks server-side, so saving first
    // is NOT a prerequisite — don't imply it is.
    return args.hasRun
      ? "Readiness checks are saved and current."
      : "Current live checks pass. Finalization will re-run and save these checks before locking the case.";
  }
  return "Internal finalization is blocked. Resolve the blocking items below.";
}
