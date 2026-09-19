/**
 * K4-21 — capital gains on a house-property sale (land or building or both),
 * AY 2026-27 / Income-tax Act, 1961.
 *
 * PURE. Rates, the holding-period threshold, the s.50C 110% tolerance and
 * the 23 July 2024 cutoff live here and nowhere else.
 *
 * SOURCE, not memory (`D326` / `D302`). Every figure this module quotes was
 * resolved on 2026-08-18 against:
 *   1. the live PDF `K4-PORT-04-S2` (hash
 *      626134660ea5ca236d967eb5ed7d7b989d48f3240f0c4dfaa57dc09846288ff5,
 *      bytes 5371727, HASH_MATCH);
 *   2. three-mode `pdftotext` extracts of pages 4-20 (s.2), 236-276
 *      (s.45-s.55) and 433-440 (s.111A/s.112/s.112A) — `-raw` is usually
 *      best, default is the cross-check, `-layout` agreed on every
 *      load-bearing span this slice quotes (`D302`);
 *   3. Gazette Chapter III Part A (`K4-PORT-04-S1` pages 30-79): Finance
 *      Act 2026 does NOT amend s.45, s.47, s.48, s.49, s.50, s.50C, s.54,
 *      s.54F, s.55, s.111A, s.112 or s.112A of the 1961 Act. The FA 2025
 *      vintage of those provisions is the governing text.
 *
 * THIS IS NOT HOUSE-PROPERTY INCOME. Section 22/23 GAV on a self-occupied
 * or let-out property (`K4-06`) is a different head. A sale is s.45.
 *
 * WHAT THIS MODULE DOES NOT DO, stated so a later session does not grow it
 * silently:
 *   - s.54 / s.54F / s.54B / s.54EC (or any other exemption). Claimed →
 *     refused. The conditions are time-windowed and fact-heavy;
 *   - s.50 depreciable-asset block computation;
 *   - s.49 previous-owner cost (gift / inheritance / partition);
 *   - agricultural land (s.2(14) exclusion);
 *   - s.50C agreement-date vs registration-date when those dates differ;
 *   - s.111A / s.112A. Those remain listed-equity / equity-MF. This
 *     module never taxes `other_stcg` / `other_ltcg`;
 *   - a TY / 2025-Act computation.
 *
 * `K4-23` (`D337`) ADDED THE LONG-TERM PATH, and this header used to say
 * the opposite. It stated that indexation and "ANY long-term house-sale in
 * AY 2026-27" were out of scope because the held CII table ended at
 * 2024-25 : 363. `K4-SOURCE-04` (`D334`) closed that gap for FY 2025-26 and
 * `D337` decided the mechanics, so those two bullets are removed rather
 * than left to be read as current (`PROJECT_CONSTITUTION.md` §4: corrected
 * forward). What the long-term path now does:
 *   - s.112(1)(a)(ii)(B) charges 12.5% on the UNINDEXED gain (branch A);
 *   - the SECOND proviso caps that at the pre-Finance (No. 2) Act, 2024
 *     figure, 20% on the INDEXED gain (branch B), for land or building
 *     acquired before 23 July 2024. "such excess shall be ignored" is
 *     one-way, so the adopted figure is the lower, and A on equality;
 *   - the comparison is PER PROPERTY, never on an aggregate (`D337` item 1);
 *   - total income carries the UNINDEXED gain; only the tax is capped
 *     (`D337` item 2);
 *   - a nil-or-negative indexed comparator makes branch B ₹0 and is not a
 *     refusal (`D337` item 3);
 *   - improvements, pre-2001 acquisitions, an undeclared assessee share, an
 *     unaccepted stamp value and an unheld CII year all refuse, each under
 *     its own code.
 * The s.112(1)(a) FIRST proviso (basic-exemption absorption) is NOT applied
 * here and is not silently omitted either: it needs total income, so
 * `compute-tax.ts` fails the whole long-term treatment closed whenever it
 * could bite in either regime — see
 * `HOUSE_SALE_LTCG_BASIC_EXEMPTION_REFUSAL`.
 */

import {
  CII_BASE_FINANCIAL_YEAR,
  costInflationIndexFor,
  financialYearOfIsoDate,
  indexedCost,
} from "./cost-inflation-index";

export const HOUSE_SALE_PREVIOUS_YEAR_START = "2025-04-01";
export const HOUSE_SALE_PREVIOUS_YEAR_END = "2026-03-31";
/** s.2(42A), default limb — "not more than 9[twenty-four] months". */
export const HOUSE_SALE_SHORT_TERM_MONTHS = 24;
/** s.48 second proviso / s.112(1)(a)(ii) — Finance (No. 2) Act, 2024. */
export const HOUSE_SALE_INDEXATION_CUTOFF = "2024-07-23";
/**
 * s.112(1)(a)(ii)(B) — "at the rate of twelve and one-half per cent for
 * any transfer which takes place on or after the 23rd day of July, 2024".
 */
export const HOUSE_SALE_LTCG_RATE = 0.125;
/**
 * s.112(1)(a)(ii)(A) — "at the rate of twenty per cent for any transfer
 * which takes place before the 23rd day of July, 2024". This is the rate of
 * the Act "as [it] stood immediately before [its] amendment by the Finance
 * (No. 2) Act, 2024", which the SECOND proviso makes the comparator for
 * land or building acquired before that date. It is not a rate this engine
 * charges directly — it only ever caps the item (B) figure.
 */
export const HOUSE_SALE_LTCG_OLD_LAW_RATE = 0.2;
/**
 * s.50C(1) third proviso — "does not exceed one hundred and ten per cent
 * of the consideration".
 */
export const HOUSE_SALE_S50C_TOLERANCE = 1.1;

export const HOUSE_SALE_ASSET_KINDS = ["land", "building", "both"] as const;
export type HouseSaleAssetKind = (typeof HOUSE_SALE_ASSET_KINDS)[number];

/** Closed. Gift / inheritance / partition are s.49 and refuse. */
export const HOUSE_SALE_ACQUISITION_MODES = ["purchase"] as const;
export type HouseSaleAcquisitionMode = (typeof HOUSE_SALE_ACQUISITION_MODES)[number];

/**
 * Closed "not this out-of-set fact" declarations. The adapter requires the
 * full set before a row reaches this module. Silence is incomplete.
 */
export const HOUSE_SALE_REQUIRED_DECLARATIONS = [
  "not_agricultural_land",
  "not_depreciable_asset",
  "interest_not_in_cost",
  "agreement_and_registration_same_date",
] as const;
export type HouseSaleRequiredDeclaration = (typeof HOUSE_SALE_REQUIRED_DECLARATIONS)[number];

/**
 * `K4-23` / `D337` items 7 and 11 — two further attestations required ONLY
 * on the long-term path.
 *
 * SCOPED TO LTCG DELIBERATELY. `D337`'s proof list requires that `K4-21`'s
 * short-term behaviour be *unchanged*, and every stored short-term row
 * carries exactly the four declarations above. Requiring six of a
 * short-term row would refuse cases that compute today, which is a
 * behaviour change in the wrong direction. The share and stamp-value
 * questions are real for a short-term sale too; extending them there is a
 * separate, deliberate slice, not something this one does by widening a
 * constant.
 */
export const HOUSE_SALE_LTCG_REQUIRED_DECLARATIONS = [
  "amounts_are_assessee_share",
  "stamp_duty_value_accepted",
] as const;
export type HouseSaleLtcgRequiredDeclaration =
  (typeof HOUSE_SALE_LTCG_REQUIRED_DECLARATIONS)[number];

/** Every value the ledger may store, and the DB CHECK constraint's vocabulary. */
export const HOUSE_SALE_ALL_DECLARATIONS = [
  ...HOUSE_SALE_REQUIRED_DECLARATIONS,
  ...HOUSE_SALE_LTCG_REQUIRED_DECLARATIONS,
] as const;
export type HouseSaleDeclaration = (typeof HOUSE_SALE_ALL_DECLARATIONS)[number];

export type HouseSaleHolding = "short_term" | "long_term";

export type HouseSaleRefusalCode =
  | "HOUSE_SALE_FACTS_INCOMPLETE"
  | "HOUSE_SALE_TRANSFER_OUTSIDE_PREVIOUS_YEAR"
  | "HOUSE_SALE_ACQUISITION_AFTER_TRANSFER"
  | "HOUSE_SALE_EXEMPTION_CLAIMED"
  | "HOUSE_SALE_INTEREST_IN_COST"
  | "HOUSE_SALE_AGRICULTURAL_LAND"
  | "HOUSE_SALE_DEPRECIABLE_ASSET"
  | "HOUSE_SALE_NON_PURCHASE_ACQUISITION"
  | "HOUSE_SALE_AGREEMENT_DATE_DIFFERS"
  | "HOUSE_SALE_INDEXATION_COMPARISON_UNSUPPORTED"
  | "HOUSE_SALE_LOSS_UNSUPPORTED"
  // K4-23 / D337 — long-term branches held closed.
  | "HOUSE_SALE_LTCG_IMPROVEMENT_UNSUPPORTED"
  | "HOUSE_SALE_LTCG_PRE_2001_ACQUISITION"
  | "HOUSE_SALE_LTCG_SHARE_UNDECLARED"
  | "HOUSE_SALE_LTCG_STAMP_VALUE_NOT_ACCEPTED"
  | "HOUSE_SALE_LTCG_CII_UNAVAILABLE";

/**
 * `D337` item 5 — the ONE long-term refusal this module cannot reach.
 *
 * s.112(1)(a)'s FIRST proviso reduces the long-term gain by the amount by
 * which "the total income as so reduced falls short of the maximum amount
 * which is not chargeable to income-tax". That test needs TOTAL INCOME and
 * the regime's own basic exemption, neither of which is a property of one
 * ledger row, so it is evaluated in `compute-tax.ts` where both are known
 * and fails closed across BOTH regimes. It is declared here so the refusal
 * vocabulary lives in one place.
 */
export const HOUSE_SALE_LTCG_BASIC_EXEMPTION_REFUSAL =
  "HOUSE_SALE_LTCG_BASIC_EXEMPTION_ABSORPTION_UNSUPPORTED" as const;

export interface HouseSaleFacts {
  consideration: number;
  costOfAcquisition: number;
  costOfImprovement: number;
  transferExpenses: number;
  stampDutyValue: number;
  transferDate: string;
  acquisitionDate: string;
  assetKind: HouseSaleAssetKind;
  acquisitionMode: HouseSaleAcquisitionMode;
  exemptionClaimed: number;
  interestIncludedInCost: boolean;
  agriculturalLand: boolean;
  depreciableAsset: boolean;
  agreementDateDiffersFromRegistration: boolean;
  /**
   * K4-23 / D337 items 7 and 11. Read only on the long-term path; a
   * short-term row is unaffected by either (see
   * `HOUSE_SALE_LTCG_REQUIRED_DECLARATIONS`).
   */
  amountsAreAssesseeShare?: boolean;
  stampDutyValueAccepted?: boolean;
}

/**
 * The s.112(1)(a) comparison, shown in full so a preparer can reconcile it.
 * Every figure here is a whole rupee (`D337` item 4).
 */
export interface HouseSaleLtcgDetail {
  /** Gain under item (B), no indexation — the figure that enters total income. */
  currentLawGain: number;
  /** Gain under the Act as it stood before Finance (No. 2) Act, 2024. */
  comparatorGain: number;
  /** True when indexation produced a nil-or-negative comparator (`D337` item 3). */
  comparatorNil: boolean;
  indexedCostOfAcquisition: number;
  acquisitionFinancialYear: string;
  transferFinancialYear: string;
  acquisitionIndex: number;
  transferIndex: number;
  /** A = 12.5% of `currentLawGain`, rounded. */
  taxCurrentLaw: number;
  /** B = 20% of `comparatorGain`, rounded; ₹0 when the comparator is nil. */
  taxComparator: number;
  /** The adopted figure: the lower of A and B, and A when they are equal. */
  taxSelected: number;
  /** max(0, A - B) — the excess the second proviso ignores. */
  excessIgnored: number;
  /** False where the asset was acquired on or after 23 July 2024. */
  comparisonApplies: boolean;
}

export type HouseSaleComputation =
  | {
      outcome: "computed";
      holding: HouseSaleHolding;
      fullValueOfConsideration: number;
      taxableGain: number;
      usedStampDutyValue: boolean;
      /** Present exactly when `holding === "long_term"`. */
      ltcg?: HouseSaleLtcgDetail;
    }
  | {
      outcome: "refused";
      code: HouseSaleRefusalCode;
      reason: string;
    };

interface Ymd {
  y: number;
  m: number;
  d: number;
}

export function parseIsoDate(value: string): Ymd | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const y = Number(m[1]);
  const month = Number(m[2]);
  const d = Number(m[3]);
  if (month < 1 || month > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, month - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return { y, m: month, d };
}

function compareYmd(a: Ymd, b: Ymd): number {
  if (a.y !== b.y) return a.y - b.y;
  if (a.m !== b.m) return a.m - b.m;
  return a.d - b.d;
}

function addMonths(date: Ymd, months: number): Ymd {
  const idx = date.y * 12 + (date.m - 1) + months;
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { y, m, d: Math.min(date.d, dim) };
}

function isFiniteNonNegative(n: number): boolean {
  return Number.isFinite(n) && n >= 0;
}

/**
 * s.2(42A): a capital asset "held by an assessee for not more than
 * twenty-four months immediately preceding the date of its transfer" is
 * short-term. Exactly twenty-four months is therefore short-term; the day
 * after the 24-month anniversary is long-term.
 */
export function houseSaleHolding(acquisition: Ymd, transfer: Ymd): HouseSaleHolding {
  return compareYmd(transfer, addMonths(acquisition, HOUSE_SALE_SHORT_TERM_MONTHS)) <= 0
    ? "short_term"
    : "long_term";
}

/**
 * s.50C(1) + third proviso: if stamp duty value does not exceed 110% of
 * consideration, consideration is the full value; otherwise stamp duty
 * value is deemed to be the full value.
 */
export function houseSaleFullValueOfConsideration(
  consideration: number,
  stampDutyValue: number,
): { value: number; usedStampDutyValue: boolean } {
  if (stampDutyValue <= consideration * HOUSE_SALE_S50C_TOLERANCE) {
    return { value: consideration, usedStampDutyValue: false };
  }
  return { value: stampDutyValue, usedStampDutyValue: true };
}

export function computeHouseSale(facts: HouseSaleFacts): HouseSaleComputation {
  if (
    !isFiniteNonNegative(facts.consideration) ||
    !isFiniteNonNegative(facts.costOfAcquisition) ||
    !isFiniteNonNegative(facts.costOfImprovement) ||
    !isFiniteNonNegative(facts.transferExpenses) ||
    !isFiniteNonNegative(facts.stampDutyValue) ||
    !isFiniteNonNegative(facts.exemptionClaimed)
  ) {
    return {
      outcome: "refused",
      code: "HOUSE_SALE_FACTS_INCOMPLETE",
      reason: "A house-sale figure is missing, negative or not a number.",
    };
  }
  if (
    !(HOUSE_SALE_ASSET_KINDS as readonly string[]).includes(facts.assetKind) ||
    !(HOUSE_SALE_ACQUISITION_MODES as readonly string[]).includes(facts.acquisitionMode)
  ) {
    return {
      outcome: "refused",
      code: "HOUSE_SALE_FACTS_INCOMPLETE",
      reason: "Asset kind or acquisition mode is outside the closed set.",
    };
  }

  const transfer = parseIsoDate(facts.transferDate);
  const acquisition = parseIsoDate(facts.acquisitionDate);
  const pyStart = parseIsoDate(HOUSE_SALE_PREVIOUS_YEAR_START);
  const pyEnd = parseIsoDate(HOUSE_SALE_PREVIOUS_YEAR_END);
  if (!transfer || !acquisition || !pyStart || !pyEnd) {
    return {
      outcome: "refused",
      code: "HOUSE_SALE_FACTS_INCOMPLETE",
      reason: "Transfer date or acquisition date is not a real ISO calendar day.",
    };
  }
  if (compareYmd(transfer, pyStart) < 0 || compareYmd(transfer, pyEnd) > 0) {
    return {
      outcome: "refused",
      code: "HOUSE_SALE_TRANSFER_OUTSIDE_PREVIOUS_YEAR",
      reason:
        "s.45(1) charges the previous year in which the transfer took place. This engine assesses " +
        "FY 2025-26 only.",
    };
  }
  if (compareYmd(acquisition, transfer) > 0) {
    return {
      outcome: "refused",
      code: "HOUSE_SALE_ACQUISITION_AFTER_TRANSFER",
      reason: "Acquisition date is after the transfer date.",
    };
  }
  if (facts.exemptionClaimed > 0) {
    return {
      outcome: "refused",
      code: "HOUSE_SALE_EXEMPTION_CLAIMED",
      reason:
        "s.54 / s.54F (and the other s.45(1) savings) are not implemented. A claimed exemption refuses.",
    };
  }
  if (facts.interestIncludedInCost) {
    return {
      outcome: "refused",
      code: "HOUSE_SALE_INTEREST_IN_COST",
      reason:
        "The first proviso to s.48 excludes interest deducted under s.24(b) or Chapter VIA from cost. " +
        "This slice does not strip an unknown amount.",
    };
  }
  if (facts.agriculturalLand) {
    return {
      outcome: "refused",
      code: "HOUSE_SALE_AGRICULTURAL_LAND",
      reason: "s.2(14) excludes agricultural land (with location tests this slice does not apply).",
    };
  }
  if (facts.depreciableAsset) {
    return {
      outcome: "refused",
      code: "HOUSE_SALE_DEPRECIABLE_ASSET",
      reason: "s.50 block-of-assets computation is not implemented.",
    };
  }
  if (facts.acquisitionMode !== "purchase") {
    return {
      outcome: "refused",
      code: "HOUSE_SALE_NON_PURCHASE_ACQUISITION",
      reason: "s.49 previous-owner cost is not implemented. Only a purchase is in this slice.",
    };
  }
  if (facts.agreementDateDiffersFromRegistration) {
    return {
      outcome: "refused",
      code: "HOUSE_SALE_AGREEMENT_DATE_DIFFERS",
      reason:
        "s.50C first proviso (agreement-date stamp duty value) is not implemented when the " +
        "agreement and registration dates differ.",
    };
  }

  const holding = houseSaleHolding(acquisition, transfer);

  const fvc = houseSaleFullValueOfConsideration(facts.consideration, facts.stampDutyValue);
  const taxableGain =
    fvc.value - facts.costOfAcquisition - facts.costOfImprovement - facts.transferExpenses;
  if (taxableGain < 0) {
    return {
      outcome: "refused",
      code: "HOUSE_SALE_LOSS_UNSUPPORTED",
      reason:
        "A house-sale loss would reopen s.70 set-off ordering against 111A/112A (K4-09 Q2). " +
        "A loss is refused rather than guessed.",
    };
  }

  if (holding === "short_term") {
    // K4-21, unchanged. Slab-rate income, never s.111A.
    return {
      outcome: "computed",
      holding,
      fullValueOfConsideration: fvc.value,
      taxableGain,
      usedStampDutyValue: fvc.usedStampDutyValue,
    };
  }

  // ----- K4-23 / D337: the long-term path -----

  // D337 item 6 — an improvement has no stored year, so its indexed cost
  // (s.48 Explanation (iv) needs "the year in which the improvement ...
  // took place") cannot be formed. Refused rather than indexed at the
  // acquisition year, which would be a guess.
  if (facts.costOfImprovement > 0) {
    return {
      outcome: "refused",
      code: "HOUSE_SALE_LTCG_IMPROVEMENT_UNSUPPORTED",
      reason:
        "s.48 Explanation (iv) indexes a cost of improvement by the Cost Inflation Index for the " +
        "year the improvement took place. This slice stores no improvement year, so a long-term " +
        "case declaring any improvement cost is refused rather than indexed at a guessed year.",
    };
  }

  // D337 item 7 — the amounts must already be the assessee's share.
  if (facts.amountsAreAssesseeShare !== true) {
    return {
      outcome: "refused",
      code: "HOUSE_SALE_LTCG_SHARE_UNDECLARED",
      reason:
        "A long-term case must declare that consideration, stamp duty value, expenses and costs " +
        "already represent the assessee's proportionate share. Silence is never read as sole " +
        "ownership.",
    };
  }

  // D337 item 11 — s.50C(2) is an Assessing-Officer referral this product
  // cannot model, so a disputed or unaccepted stamp value refuses.
  if (facts.stampDutyValueAccepted !== true) {
    return {
      outcome: "refused",
      code: "HOUSE_SALE_LTCG_STAMP_VALUE_NOT_ACCEPTED",
      reason:
        "A long-term case must declare that the stamp duty value is accepted and that there is no " +
        "s.50C(2) fair-market-value claim, dispute, appeal, reference or pending valuation. " +
        "s.50C(2) refers the valuation to a Valuation Officer, which this product does not model.",
    };
  }

  const transferFy = financialYearOfIsoDate(facts.transferDate);
  const acquisitionFy = financialYearOfIsoDate(facts.acquisitionDate);
  if (!transferFy || !acquisitionFy) {
    return {
      outcome: "refused",
      code: "HOUSE_SALE_FACTS_INCOMPLETE",
      reason: "A transfer or acquisition date could not be resolved to a financial year.",
    };
  }

  // D337 item 8 — s.48 Explanation (iii) floors the base year at FY 2001-02,
  // and s.55(2)(b)'s fair-market-value-as-on-1-April-2001 option (with the
  // stamp-value ceiling the Finance Act 2020 proviso adds) is represented by
  // no stored fact. Refused.
  if (acquisitionFy < CII_BASE_FINANCIAL_YEAR) {
    return {
      outcome: "refused",
      code: "HOUSE_SALE_LTCG_PRE_2001_ACQUISITION",
      reason:
        "The asset was acquired before 1 April 2001. s.55(2)(b) then offers the fair market value " +
        "as on that date as the cost, and this slice stores neither that value nor the stamp-value " +
        "ceiling on it. Refused rather than indexed from a cost the Act may not use.",
    };
  }

  const cutoff = parseIsoDate(HOUSE_SALE_INDEXATION_CUTOFF);
  // s.112(1)(a) second proviso is available only for land or building "which
  // is acquired before the 23rd day of July, 2024".
  //
  // MEASURED, NOT ASSUMED (`D337` item 18): for a FY 2025-26 transfer this is
  // ALWAYS true of a long-term holding. Long-term needs
  // `acquisition + 24 months < transfer <= 2026-03-31`, so
  // `acquisition < 2024-03-31`, which is strictly before the cutoff. The
  // `false` branch is therefore unreachable this assessment year and is
  // implemented correctly rather than removed, because it becomes reachable
  // the moment this engine is pointed at a later previous year. The
  // invariant is pinned by test.
  const comparisonApplies = !!cutoff && compareYmd(acquisition, cutoff) < 0;

  const transferIndex = costInflationIndexFor(transferFy);
  const acquisitionIndex = costInflationIndexFor(acquisitionFy);
  if (comparisonApplies && (transferIndex === null || acquisitionIndex === null)) {
    return {
      outcome: "refused",
      code: "HOUSE_SALE_LTCG_CII_UNAVAILABLE",
      reason:
        `No notified Cost Inflation Index is held for ${
          transferIndex === null ? transferFy : acquisitionFy
        }. s.48 Explanation (v) makes the Index a notified figure; a missing year is a stop, never ` +
        "an interpolation.",
    };
  }

  // D337 item 4 — whole-rupee portal-style rounding, applied in this order:
  // each indexed cost component is rounded first, then each branch's tax is
  // formed and rounded, and only those rounded amounts are compared.
  const indexedCostOfAcquisition =
    comparisonApplies && transferIndex !== null && acquisitionIndex !== null
      ? indexedCost(facts.costOfAcquisition, transferIndex, acquisitionIndex)
      : facts.costOfAcquisition;

  const currentLawGain = taxableGain;
  const comparatorGainRaw =
    fvc.value - indexedCostOfAcquisition - facts.transferExpenses;
  // D337 item 3 — a nil-or-negative indexed comparator is NOT a refusal. The
  // comparator is treated as nil and B is zero, which is the second proviso
  // read literally: the old law would have charged nothing, so the whole of A
  // is excess and is ignored. The unindexed gain still enters total income
  // (item 2), and an actual CURRENT-LAW loss still refuses above.
  const comparatorNil = comparatorGainRaw <= 0;
  const comparatorGain = comparatorNil ? 0 : comparatorGainRaw;

  const taxCurrentLaw = Math.round(currentLawGain * HOUSE_SALE_LTCG_RATE);
  const taxComparator = comparisonApplies
    ? Math.round(comparatorGain * HOUSE_SALE_LTCG_OLD_LAW_RATE)
    : taxCurrentLaw;
  // "such excess shall be ignored" — one-way, so the adopted figure is A
  // capped at B. `<=` makes equality select A deterministically (item 4).
  const taxSelected = taxCurrentLaw <= taxComparator ? taxCurrentLaw : taxComparator;

  return {
    outcome: "computed",
    holding,
    fullValueOfConsideration: fvc.value,
    taxableGain: currentLawGain,
    usedStampDutyValue: fvc.usedStampDutyValue,
    ltcg: {
      currentLawGain,
      comparatorGain,
      comparatorNil,
      indexedCostOfAcquisition,
      acquisitionFinancialYear: acquisitionFy,
      transferFinancialYear: transferFy,
      acquisitionIndex: acquisitionIndex ?? 0,
      transferIndex: transferIndex ?? 0,
      taxCurrentLaw,
      taxComparator,
      taxSelected,
      excessIgnored: Math.max(0, taxCurrentLaw - taxComparator),
      comparisonApplies,
    },
  };
}
