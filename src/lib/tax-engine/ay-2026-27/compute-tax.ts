/**
 * Core tax computation for AY 2026-27 / FY 2025-26. PURE — no external imports.
 *
 * Design invariants:
 *  - Capital gains (STCG 111A / LTCG 112A) are taxed at special rates and are
 *    NEVER merged into ordinary slab income.
 *  - Every returned number is a ComputedValue carrying its formula + sources.
 *  - Old vs new regime are computed independently; the lower gross liability
 *    is recommended.
 *  - `K4-PORT-03` (decision `D299`): the slab tables, surcharge schedule, cess
 *    rate and section 87A rebate schedule are no longer imported from
 *    `./rules` and `./slabs`. They arrive as a `ComputationRateFigures` value
 *    supplied by the GOVERNING PACK, so the arithmetic here is Act-agnostic and
 *    the statutory figures belong to the world that authorises them. There is
 *    no per-Act conditional and none may be added: a world that cannot source a
 *    figure withholds it, and its pack then carries no computation surface at
 *    all. `computeRegime` takes the figures with NO default; only the public
 *    entry point defaults, and only because its signature is bound by reference
 *    into `TaxPackComputation` (see `rate-figures.ts`).
 *
 * PREPARATION-ONLY. All figures require CA verification before client reliance.
 */

import type { ComputationRateFigures } from "@/lib/tax-engine/core/statutory-rate-parameters";
import {
  asAdjustmentSet,
  BUSINESS_BOOKS_ADJUSTMENTS,
  BUSINESS_BOOKS_ACTIVITY_CLASSIFICATIONS,
  CAPITAL_GAINS,
  deductionCapForSection,
  HOUSE_PROPERTY,
  isNoneOnlyAdjustments,
  NOT_IMPLEMENTED,
  PRESUMPTIVE_44AD,
  PRESUMPTIVE_44ADA,
  RULES_VERSION,
  STANDARD_DEDUCTION,
} from "./rules";
import { computeSection32Allowance } from "./section-32";
import {
  computeHouseSale,
  HOUSE_SALE_LTCG_BASIC_EXEMPTION_REFUSAL,
  type HouseSaleLtcgDetail,
} from "./house-sale";
import { AY_2026_27_COMPUTATION_FIGURES } from "./rate-figures";
import { computeRebate87A } from "./rebate-relief";
import { computeSurcharge } from "./surcharge";
import {
  applySlabTax,
  describeSlabs,
  maximumAmountNotChargeable,
  slabsForRegime,
  type TaxpayerAgeBand,
} from "./slabs";
import {
  computeBroughtForwardSetOff,
  resolveLossAllocationPolicyId,
} from "./brought-forward-set-off";
import type {
  BroughtForwardLossEntry,
  BroughtForwardLossSetOff,
  BusinessBooksEntry,
  CapitalGainEntry,
  CapitalLossSetOff,
  ComputedValue,
  DeductionEntry,
  HousePropertyEntry,
  IncomeEntry,
  Regime,
  RegimeComputation,
  TaxComputation,
  TaxEngineInput,
  TaxPaidEntry,
} from "./types";

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Round to whole rupees (tax figures are rounded to the nearest rupee). */
export function roundRupee(n: number): number {
  return Math.round(n);
}

function toPaise(n: number): number {
  return Math.round(n * 100);
}

function booksEntryNet(e: BusinessBooksEntry): number {
  const set = asAdjustmentSet(e.adjustments);
  let paise = toPaise(e.revenue) - toPaise(e.expenses);
  if (set.includes("depreciation_s32")) {
    paise += toPaise(e.bookDepreciation ?? 0);
    paise -= toPaise(computeSection32Allowance(e.depreciationBlocks ?? []));
  }
  return paise / 100;
}

export function computed(
  value: number,
  formula: string,
  sources: string[] = [],
  notes: string[] = [],
): ComputedValue {
  return { value, formula, sources, notes };
}

function sourceTag(prefix: string, entry: { sourceType: string; id: string; sourceDocumentId?: string }): string {
  return entry.sourceDocumentId
    ? `${prefix}:${entry.sourceType}:${entry.sourceDocumentId}`
    : `${prefix}:${entry.sourceType}:${entry.id}`;
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values));
}

// ---------------------------------------------------------------------------
// Income derivation
// ---------------------------------------------------------------------------

const SLAB_INCOME_CATEGORIES = new Set([
  "savings_interest",
  "fd_interest",
  "dividend",
  "other_sources",
]);

export interface DerivedIncome {
  grossSalary: number;
  otherSlabIncome: number;
  exemptIncome: number;
  /** NET of the K4-09 within-year loss set-off (never below zero). */
  stcg111a: number;
  /** NET of the K4-09 within-year loss set-off (never below zero). */
  ltcg112a: number;
  /**
   * K4-21: house-sale STCG (s.45 / s.48), taxed at slab rates — not 111A.
   * A long-term house sale reaches `houseSaleLtcg` instead, never this.
   */
  houseSaleStcg: number;
  /**
   * K4-23: house-sale LTCG (s.112). The UNINDEXED gain, which is what
   * enters total income (`D337` item 2). Its TAX is not simply 12.5% of
   * this figure whenever the second proviso's comparator bites.
   */
  houseSaleLtcg: number;
  /**
   * The adopted s.112 tax, summed over the PER-PROPERTY comparisons
   * (`D337` item 1). Never re-derived from `houseSaleLtcg`.
   */
  houseSaleLtcgTax: number;
  /** Total of each property's ignored excess. Disclosure only. */
  houseSaleLtcgExcessIgnored: number;
  /** Per-property comparison detail. Disclosure only. */
  houseSaleLtcgDetails: HouseSaleLtcgDetail[];
  /** K4-09 — the set-off that produced the two net figures above. */
  capitalLossSetOff: CapitalLossSetOff;
  /**
   * K4-10 — the BROUGHT-FORWARD (Section 74) set-off applied AFTER the
   * within-year one, and already reflected in `stcg111a`/`ltcg112a`.
   */
  broughtForwardLossSetOff: BroughtForwardLossSetOff;
  /** Placeholder heads captured but NOT taxed in K.2.0. */
  placeholderIncome: number;
  /**
   * K4-07: deemed profit from Section 44ADA presumptive professional income
   * (50% of declared gross receipts, summed across every declared row —
   * multiple 44ADA sources ARE in scope this session, unlike house
   * property's single-row scope, since aggregation here is a simple linear
   * sum with no per-row regime/usage nuance to combine incorrectly).
   * REGIME-INDEPENDENT — reused as-is by both regimes in `computeRegime`.
   */
  presumptiveProfessionalIncome: ComputedValue;
  /**
   * K4-08: deemed profit from Section 44AD presumptive business income —
   * 6% of the banking/electronic-mode turnover portion PLUS 8% of the cash
   * portion, each summed across every declared row of its head. Two rates
   * on two portions, unlike 44ADA's single rate on the whole.
   * REGIME-INDEPENDENT — reused as-is by both regimes in `computeRegime`.
   */
  presumptiveBusinessIncome: ComputedValue;
  salarySources: string[];
  otherSlabSources: string[];
  stcg111aSources: string[];
  ltcg112aSources: string[];
  houseSaleStcgSources: string[];
  houseSaleLtcgSources: string[];
  /** K4-10 — source tags for the carry-forward records actually APPLIED. */
  broughtForwardSources: string[];
  notes: string[];
}

/** Taxable gain for a capital-gain entry: explicit value, else sale - cost - exp - exemption. */
export function taxableGainOf(entry: CapitalGainEntry): number {
  if (typeof entry.taxable_gain === "number") return Math.max(0, entry.taxable_gain);
  const sale = entry.sale_value ?? 0;
  const cost = entry.cost ?? 0;
  const expenses = entry.expenses ?? 0;
  const exemption = entry.exemption_claimed ?? 0;
  return Math.max(0, sale - cost - expenses - exemption);
}

/**
 * K4-09 — the SIGNED counterpart of {@link taxableGainOf}: identical
 * derivation, without the `Math.max(0, …)` floor, so a capital LOSS survives
 * as a negative number instead of silently becoming zero.
 *
 * Deliberately a separate function rather than a change to `taxableGainOf`:
 * that function's two other callers (`recommend-itr-form.ts`,
 * `validate-case.ts`) both test `> 0` to mean "this case has capital gains",
 * and re-pointing them at signed values would change behaviour this session
 * did not source. `deriveIncome` is the only caller that wants the sign.
 */
export function signedGainOf(entry: CapitalGainEntry): number {
  if (typeof entry.taxable_gain === "number") return entry.taxable_gain;
  const sale = entry.sale_value ?? 0;
  const cost = entry.cost ?? 0;
  const expenses = entry.expenses ?? 0;
  const exemption = entry.exemption_claimed ?? 0;
  return sale - cost - expenses - exemption;
}

/**
 * K4-09 — applies the within-year set-off described in `rules.ts`'s
 * {@link import("./rules").CAPITAL_LOSS_SET_OFF} doc. PURE arithmetic over
 * already-aggregated buckets.
 *
 * A long-term loss may only reduce long-term gains (Section 74(1)(b)); a
 * short-term loss may reduce either, but the adapter only admits a short-term
 * loss when the case has NO 112A gain, so the elective ordering (Q2) never
 * arises here. Nothing in this function chooses between two lawful orders —
 * if it ever needs to, that is a sourcing question, not an implementation one.
 */
export function computeCapitalLossSetOff(
  grossStcg111a: number,
  grossLtcg112a: number,
  stcl111a: number,
  ltcl112a: number,
): CapitalLossSetOff {
  const absorbedAgainstLtcg = Math.min(ltcl112a, grossLtcg112a);
  const absorbedAgainstStcg = Math.min(stcl111a, grossStcg111a);
  const residual = ltcl112a - absorbedAgainstLtcg + (stcl111a - absorbedAgainstStcg);
  return {
    grossStcg111a,
    grossLtcg112a,
    stcl111a,
    ltcl112a,
    absorbedAgainstStcg,
    absorbedAgainstLtcg,
    residual,
  };
}

/**
 * K4-10 — brought-forward set-off inputs. Optional and defaulted so every
 * pre-existing two-argument caller keeps compiling AND keeps computing exactly
 * what it computed before: with no records, `computeBroughtForwardSetOff`
 * absorbs nothing and the net gains are untouched.
 */
export interface BroughtForwardContext {
  readonly assessmentYear: string;
  readonly entries: readonly BroughtForwardLossEntry[];
}

/**
 * The ONE place a `TaxEngineInput` is turned into brought-forward context.
 * `computeTax` and `compareRegimes` both derive income independently (they
 * always have), so without this they would be two places that could drift on
 * whether carry-forward records are passed through at all — precisely the
 * "same question answered two ways" class `AUDIT-04-F10` recorded.
 */
export function broughtForwardContextOf(input: TaxEngineInput): BroughtForwardContext {
  return {
    assessmentYear: input.assessmentYear,
    entries: input.broughtForwardLosses ?? [],
  };
}

export function deriveIncome(
  income: IncomeEntry[],
  capitalGains: CapitalGainEntry[],
  broughtForward: BroughtForwardContext = { assessmentYear: "", entries: [] },
): DerivedIncome {
  let grossSalary = 0;
  let otherSlabIncome = 0;
  let exemptIncome = 0;
  let placeholderIncome = 0;
  let presumptive44adaReceipts = 0;
  let presumptive44adDigitalTurnover = 0;
  let presumptive44adCashTurnover = 0;
  const salarySources: string[] = [];
  const otherSlabSources: string[] = [];
  const presumptive44adaSources: string[] = [];
  const presumptive44adSources: string[] = [];
  const notes: string[] = [];

  for (const e of income) {
    if (e.category === "salary") {
      grossSalary += e.amount;
      salarySources.push(sourceTag("salary", e));
    } else if (SLAB_INCOME_CATEGORIES.has(e.category)) {
      otherSlabIncome += e.amount;
      otherSlabSources.push(sourceTag(e.category, e));
    } else if (e.category === "exempt_income") {
      exemptIncome += e.amount;
    } else if (e.category === "house_property" || e.category === "business_income") {
      placeholderIncome += e.amount;
      notes.push(
        `${e.category} of ₹${e.amount} captured but NOT taxed in K.2.0 (placeholder head).`,
      );
    } else if (e.category === "presumptive_professional_44ada") {
      presumptive44adaReceipts += e.amount;
      presumptive44adaSources.push(sourceTag("presumptive_professional_44ada", e));
    } else if (e.category === "presumptive_business_44ad_digital") {
      presumptive44adDigitalTurnover += e.amount;
      presumptive44adSources.push(sourceTag("presumptive_business_44ad_digital", e));
    } else if (e.category === "presumptive_business_44ad_cash") {
      presumptive44adCashTurnover += e.amount;
      presumptive44adSources.push(sourceTag("presumptive_business_44ad_cash", e));
    }
  }

  const presumptiveDeemedProfitValue = presumptive44adaReceipts * PRESUMPTIVE_44ADA.deemedProfitRate;
  const presumptiveProfessionalIncome = computed(
    roundRupee(presumptiveDeemedProfitValue),
    presumptive44adaReceipts > 0
      ? `Section 44ADA: ${PRESUMPTIVE_44ADA.deemedProfitRate * 100}% × gross receipts ₹${presumptive44adaReceipts}`
      : "no presumptive professional (44ADA) income declared",
    uniq(presumptive44adaSources),
    presumptive44adaReceipts > 0
      ? [
          "Deemed profit only — no separate expense/depreciation deduction is claimed on top (Sections 28-43C " +
            "disallowed under Section 44ADA); the adapter has already confirmed gross receipts are within the " +
            "applicable eligibility ceiling (CA-verify).",
        ]
      : [],
  );

  // K4-08 — Section 44AD. Two rates on two portions of turnover (6% on the
  // banking/electronic-mode portion, 8% on the cash portion), NOT one rate
  // on the whole. Each portion is summed across every declared row of its
  // own head; the adapter has already confirmed the AGGREGATE turnover is
  // within the applicable ₹2cr/₹3cr ceiling before any row reaches here.
  const presumptive44adTurnover = presumptive44adDigitalTurnover + presumptive44adCashTurnover;
  const presumptive44adDeemedProfitValue =
    presumptive44adDigitalTurnover * PRESUMPTIVE_44AD.deemedProfitRateDigital +
    presumptive44adCashTurnover * PRESUMPTIVE_44AD.deemedProfitRateCash;
  const presumptiveBusinessIncome = computed(
    roundRupee(presumptive44adDeemedProfitValue),
    presumptive44adTurnover > 0
      ? `Section 44AD: ${PRESUMPTIVE_44AD.deemedProfitRateDigital * 100}% × banking/electronic-mode ` +
        `turnover ₹${presumptive44adDigitalTurnover} + ` +
        `${PRESUMPTIVE_44AD.deemedProfitRateCash * 100}% × cash turnover ₹${presumptive44adCashTurnover}`
      : "no presumptive business (44AD) income declared",
    uniq(presumptive44adSources),
    presumptive44adTurnover > 0
      ? [
          "Deemed profit only — no separate expense/depreciation deduction is claimed on top (Sections " +
            "28-43C are deemed already allowed under Section 44AD); the adapter has already confirmed " +
            "aggregate turnover is within the applicable eligibility ceiling. This engine does NOT test " +
            "whether the business itself is eligible for Section 44AD (an agency, commission/brokerage, " +
            "Section 44AE goods-carriage business or a Section 44AA(1) profession is not), and does NOT " +
            "apply the Section 44AD(4)/(5) five-year lock-in or its Section 44AB audit trigger " +
            "(CA-verify).",
        ]
      : [],
  );

  // K4-09: gains and losses are accumulated SEPARATELY per bucket (signed
  // values, so a loss is no longer floored to zero on the way in), then the
  // within-year set-off is applied once over the aggregates. Accumulating a
  // signed running total instead would make the outcome depend on the order
  // rows happen to arrive in, which is exactly what must not happen.
  let grossStcg111a = 0;
  let grossLtcg112a = 0;
  let stcl111a = 0;
  let ltcl112a = 0;
  let houseSaleStcg = 0;
  const stcg111aSources: string[] = [];
  const ltcg112aSources: string[] = [];
  const houseSaleStcgSources: string[] = [];
  // K4-23 / D337 — the long-term house-sale head.
  let houseSaleLtcg = 0;
  let houseSaleLtcgTax = 0;
  let houseSaleLtcgExcessIgnored = 0;
  const houseSaleLtcgDetails: HouseSaleLtcgDetail[] = [];
  const houseSaleLtcgSources: string[] = [];
  for (const cg of capitalGains) {
    const gain = signedGainOf(cg);
    const tag = sourceTag(cg.category, { ...cg, sourceDocumentId: cg.source_document_id ?? cg.sourceDocumentId });
    if (cg.category === "stcg_111a") {
      if (gain < 0) stcl111a += -gain;
      else grossStcg111a += gain;
      stcg111aSources.push(tag);
    } else if (cg.category === "ltcg_112a") {
      if (gain < 0) ltcl112a += -gain;
      else grossLtcg112a += gain;
      ltcg112aSources.push(tag);
    } else if (cg.category === "house_sale") {
      // Defence in depth: the adapter is the gate. A refused house-sale that
      // still arrives is captured, not taxed, and never treated as 111A/112A.
      const hs = cg.houseSale;
      const computed = hs
        ? computeHouseSale({
            consideration: cg.sale_value ?? 0,
            costOfAcquisition: cg.cost ?? 0,
            costOfImprovement: hs.costOfImprovement,
            transferExpenses: cg.expenses ?? 0,
            stampDutyValue: hs.stampDutyValue,
            transferDate: hs.transferDate,
            acquisitionDate: hs.acquisitionDate,
            assetKind: hs.assetKind,
            acquisitionMode: hs.acquisitionMode,
            exemptionClaimed: cg.exemption_claimed ?? 0,
            interestIncludedInCost: hs.interestIncludedInCost,
            agriculturalLand: hs.agriculturalLand,
            depreciableAsset: hs.depreciableAsset,
            agreementDateDiffersFromRegistration: hs.agreementDateDiffersFromRegistration,
            // K4-23: the defence-in-depth recomputation must see the SAME
            // facts the adapter saw, or it reaches a different verdict and
            // silently drops a row the adapter admitted.
            amountsAreAssesseeShare: hs.amountsAreAssesseeShare,
            stampDutyValueAccepted: hs.stampDutyValueAccepted,
          })
        : null;
      if (computed?.outcome === "computed" && computed.holding === "short_term") {
        houseSaleStcg += computed.taxableGain;
        houseSaleStcgSources.push(tag);
      } else if (computed?.outcome === "computed" && computed.ltcg) {
        // K4-23 / D337. The comparison is PER PROPERTY (item 1), so each row's
        // own adopted tax is accumulated here — never a comparison on the
        // summed gain, which would let one property's indexation relief leak
        // onto another's. Total income carries the UNINDEXED gain (item 2).
        houseSaleLtcg += computed.ltcg.currentLawGain;
        houseSaleLtcgTax += computed.ltcg.taxSelected;
        houseSaleLtcgExcessIgnored += computed.ltcg.excessIgnored;
        houseSaleLtcgDetails.push(computed.ltcg);
        houseSaleLtcgSources.push(tag);
      } else {
        notes.push(
          `house_sale of ₹${gain} captured but NOT taxed` +
            (computed && computed.outcome === "refused" ? ` (${computed.code})` : " (incomplete house-sale facts)"),
        );
      }
    } else {
      // other_stcg / other_ltcg — placeholders, not computed. Never 111A/112A.
      notes.push(`${cg.category} of ₹${gain} captured but NOT taxed in K.2.0 (placeholder).`);
    }
  }

  const capitalLossSetOff = computeCapitalLossSetOff(grossStcg111a, grossLtcg112a, stcl111a, ltcl112a);
  const withinYearStcg111a = grossStcg111a - capitalLossSetOff.absorbedAgainstStcg;
  const withinYearLtcg112a = grossLtcg112a - capitalLossSetOff.absorbedAgainstLtcg;

  // K4-10: BROUGHT-FORWARD set-off (Section 74) runs on what SURVIVES the
  // within-year set-off above, never on the gross figures. That ordering is
  // the pipeline's, not a preference: Sections 70/71 consume the year's own
  // gains first, and only the remainder is "income under the head Capital
  // gains" for a Section 74 loss to reach. With no brought-forward record the
  // call absorbs nothing, so a pre-K4-10 case is byte-identical.
  const broughtForwardLossSetOff = computeBroughtForwardSetOff({
    currentAssessmentYear: broughtForward.assessmentYear,
    netStcg111a: withinYearStcg111a,
    netLtcg112a: withinYearLtcg112a,
    entries: broughtForward.entries,
    policyId: resolveLossAllocationPolicyId(broughtForward.entries),
  });
  const stcg111a = withinYearStcg111a - broughtForwardLossSetOff.absorbedAgainstStcg;
  const ltcg112a = withinYearLtcg112a - broughtForwardLossSetOff.absorbedAgainstLtcg;

  // Tags for the carry-forward records that were actually APPLIED — the same
  // `sourceTag` shape every other ledger kind uses, so `case-traceability`
  // resolves them through its ordinary fact index rather than a special case.
  // Records that were EXCLUDED (expired, ineligible) contributed nothing to the
  // number and are deliberately not tagged; they are disclosed as findings.
  const appliedBroughtForwardIds = new Set(
    broughtForwardLossSetOff.allocations.map((a) => a.recordId),
  );
  const broughtForwardSources = broughtForward.entries
    .filter((e) => appliedBroughtForwardIds.has(e.id))
    .map((e) =>
      sourceTag(`brought_forward_${e.lossType}`, {
        id: e.id,
        sourceType: e.sourceType ?? "manual",
        sourceDocumentId: e.sourceDocumentId,
      }),
    );

  if (capitalLossSetOff.absorbedAgainstStcg > 0 || capitalLossSetOff.absorbedAgainstLtcg > 0) {
    notes.push(
      `Within-year capital-loss set-off (s.70/74): ₹${capitalLossSetOff.absorbedAgainstStcg} against ` +
        `STCG 111A and ₹${capitalLossSetOff.absorbedAgainstLtcg} against LTCG 112A. A capital loss may ` +
        "not be set off against any other head (s.71(3)).",
    );
  }
  if (capitalLossSetOff.residual > 0) {
    // Defense in depth. The adapter refuses to hand this engine a case with an
    // unabsorbed residual (it would need s.74 carry-forward, unmodelled), so
    // reaching here means the two authorities disagreed — say so rather than
    // quietly returning a number that understates the loss.
    notes.push(
      `UNABSORBED capital loss of ₹${capitalLossSetOff.residual} remains; carry-forward under s.74 is ` +
        "NOT modelled and this figure is therefore incomplete (CA-verify).",
    );
  }

  // K4-10 disclosures. Every one of these names the ORIGINATING assessment
  // year, because an exclusion a preparer cannot attribute to a specific
  // carry-forward record is indistinguishable from a silent drop.
  const bf = broughtForwardLossSetOff;
  if (bf.absorbedAgainstStcg > 0 || bf.absorbedAgainstLtcg > 0) {
    notes.push(
      `Brought-forward capital-loss set-off (s.74): ₹${bf.absorbedAgainstStcg} against STCG 111A and ` +
        `₹${bf.absorbedAgainstLtcg} against LTCG 112A, applied AFTER within-year set-off, under the ` +
        `"${bf.policyId}" allocation policy (${bf.policyVersion}). That policy is a NAMED DEFAULT for ` +
        "specific official-artifact versions, not a statutory ordering rule.",
    );
    for (const a of bf.allocations) {
      notes.push(
        `  s.74 allocation: ₹${a.amount} of the AY ${a.originatingAssessmentYear} ` +
          `${a.lossType === "ltcl" ? "long-term" : "short-term"} loss against ` +
          `${a.target === "stcg_111a" ? "STCG 111A" : "LTCG 112A"} (policy "${a.policyId}").`,
      );
    }
  }
  for (const r of bf.residuals) {
    notes.push(
      `Brought-forward residual: ₹${r.amount} of the AY ${r.originatingAssessmentYear} ` +
        `${r.lossType === "ltcl" ? "long-term" : "short-term"} loss remains unabsorbed and carries ` +
        `forward; it may last be set off in AY ${r.finalEligibleAssessmentYear}` +
        (r.expiresAfterThisYear ? " — this is its FINAL year, it lapses after this one." : "."),
    );
  }
  for (const x of bf.excluded) notes.push(x.message);
  for (const d of bf.electionDivergences) notes.push(d.message);

  return {
    grossSalary,
    otherSlabIncome,
    exemptIncome,
    stcg111a,
    ltcg112a,
    houseSaleStcg,
    houseSaleLtcg,
    houseSaleLtcgTax,
    houseSaleLtcgExcessIgnored,
    houseSaleLtcgDetails,
    capitalLossSetOff,
    broughtForwardLossSetOff,
    placeholderIncome,
    presumptiveProfessionalIncome,
    presumptiveBusinessIncome,
    salarySources,
    otherSlabSources,
    stcg111aSources,
    ltcg112aSources,
    houseSaleStcgSources,
    houseSaleLtcgSources,
    broughtForwardSources,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Deductions (Chapter VI-A) — old regime only in K.2.0
// ---------------------------------------------------------------------------

/**
 * `ageBand` (K4-03) drives the age-aware 80D / 80TTA / 80TTB caps —
 * {@link deductionCapForSection}. `null` (unknown/below-60) applies the
 * non-senior caps, matching `slabsForRegime`'s own convention. Callers pass
 * `null` for the new regime (Chapter VI-A is not computed there at all —
 * see `computeRegime` below) and for an old-regime non-resident taxpayer,
 * for whom resident senior/super-senior treatment never applies.
 *
 * `residentOldRegime` (K4-05) gates the SEPARATE `"80D_PARENTS"` bucket's
 * confirmed-senior cap — mirroring the SAME `regime === "old" &&
 * residentStatus === "resident"` condition `ageBand` is itself computed
 * under, rather than trusting `ageBand`'s own null-ness (which already
 * conflates "non-resident/new-regime" with "resident but own age
 * unknown" — the latter must NOT suppress an independently-confirmed
 * senior PARENT's cap). Defaults conservatively to `false` (flat cap) for
 * any future caller that omits it.
 */
export function computeDeductions(
  deductions: DeductionEntry[],
  ageBand: TaxpayerAgeBand | null = null,
  residentOldRegime = false,
): ComputedValue {
  const bySection = new Map<string, number>();
  const sources: string[] = [];
  // K4-05: the "80D_PARENTS" bucket's cap is driven by whether ANY row in
  // that bucket CONFIRMS the insured parent is senior/super-senior — an
  // INDEPENDENT fact from the taxpayer's own `ageBand`, and never inferred
  // true from an absent/false flag (matches the ITD's own "₹50,000 if ANY
  // person is a Senior Citizen" wording for the whole parents bucket, not a
  // per-row cap — see `deductionCapForSection`'s own doc). Gated on
  // `residentOldRegime` — a non-resident taxpayer's ledger cannot claim the
  // parent-senior cap either, matching every other senior-aware Chapter
  // VI-A treatment in this module.
  let parentBucketConfirmedSenior = false;
  for (const d of deductions) {
    bySection.set(d.section, (bySection.get(d.section) ?? 0) + d.amount);
    sources.push(sourceTag(d.section, d));
    if (residentOldRegime && d.section === "80D_PARENTS" && d.insuredPartySenior === true) {
      parentBucketConfirmedSenior = true;
    }
  }
  const parentBucketAgeBand: TaxpayerAgeBand | null = parentBucketConfirmedSenior ? "senior" : null;

  let total = 0;
  const parts: string[] = [];
  const ageMismatchNotes: string[] = [];
  for (const [section, claimed] of bySection) {
    const cap = deductionCapForSection(section, section === "80D_PARENTS" ? parentBucketAgeBand : ageBand);
    const allowed = Math.min(claimed, cap);
    total += allowed;
    parts.push(
      cap === Infinity
        ? `${section}=₹${allowed}`
        : `${section}=min(₹${claimed}, cap ₹${cap})=₹${allowed}`,
    );
    // K4-03: 80TTA/80TTB are mutually exclusive by age — a claim under the
    // section that does NOT match this taxpayer's age band is excluded
    // (cap ₹0), never silently granted the other section's cap. Surface WHY
    // rather than leaving a ₹0 line unexplained.
    if (cap === 0 && claimed > 0 && (section === "80TTA" || section === "80TTB")) {
      const other = section === "80TTA" ? "80TTB" : "80TTA";
      ageMismatchNotes.push(
        `Section ${section} claim of ₹${claimed} excluded (₹0 cap): Section 80TTA and Section 80TTB are ` +
          `mutually exclusive by age, and this taxpayer's age band does not match the claimed section. ` +
          `Re-tag the ledger row to ${other} if that is the correct section (K4-03, CA-verify).`,
      );
    }
  }

  return computed(
    roundRupee(total),
    parts.length ? `Chapter VI-A: ${parts.join(" + ")}` : "Chapter VI-A: none",
    uniq(sources),
    [
      "Basic caps only — 80G qualifying-limit nuances are not modelled, and the 80D self/family " +
        "bucket's cap does not yet widen for a senior SPOUSE (only the taxpayer's own age band and " +
        "the parents bucket's confirmed-senior flag are age-aware) (CA-verify).",
      ...ageMismatchNotes,
    ],
  );
}

// ---------------------------------------------------------------------------
// House property (Sections 22-27) — K4-06
// ---------------------------------------------------------------------------

/**
 * Net income (or loss) from house property, Sections 22-27 (K4-06, Wave-4
 * priority #2). REGIME-DEPENDENT (unlike `deriveIncome`'s other categories)
 * because Section 24(b)'s self-occupied interest treatment and the
 * cross-head loss set-off both differ by regime — so this is called once per
 * regime from {@link computeRegime}, never hoisted into the shared
 * `DerivedIncome`.
 *
 * Per property: Gross Annual Value (GAV) = actual rent received for a
 * let-out property, 0 (deemed nil) for self-occupied (Section 23(2); the
 * "up to two self-occupied properties" widening is confirmed current for AY
 * 2026-27 but not modelled — this session scopes to ONE property). GAV
 * simplification (CA-verify): the fair-rent/municipal-value/standard-rent
 * comparison that can raise GAV above actual rent received is NOT modelled —
 * actual rent received is used directly. Municipal taxes paid are deducted
 * from GAV only for a let-out property (self-occupied has no GAV to deduct
 * from) and only when marked ACTUALLY PAID (the ledger has no separate
 * "accrued vs paid" field — every entered figure is treated as paid; do not
 * enter an accrued-but-unpaid amount). Net Annual Value (NAV) is not floored
 * at 0 (a rare edge case where municipal tax exceeds rent), but the Section
 * 24(a) 30% standard-deduction BASIS is floored at 0 to avoid computing a
 * negative "deduction" (an addition) from a negative NAV.
 *
 * Section 24(b) interest: let-out is uncapped in BOTH regimes; self-occupied
 * is capped at ₹2,00,000 under the OLD regime only and is DISALLOWED
 * entirely (₹0) under the NEW regime (Section 115BAC).
 *
 * Cross-head set-off of a resulting LOSS: old regime caps the loss actually
 * applied against other heads at ₹2,00,000/year (Section 71(3A)) — any
 * excess is NOT carried forward by this engine (out of session scope, Wave-4
 * priority #5, loss set-off). New regime disallows cross-head set-off of a
 * house-property loss entirely (Section 115BAC) — the loss stays trapped
 * within the head and contributes 0 to total income for that regime.
 */
export function computeHouseProperty(
  entries: HousePropertyEntry[],
  regime: Regime,
): ComputedValue {
  if (entries.length === 0) {
    return computed(0, "no house property declared", [], []);
  }
  let rawNet = 0;
  const sources: string[] = [];
  const parts: string[] = [];
  const notes: string[] = [
    "GAV = actual rent received (fair-rent/municipal-value/standard-rent comparison not modelled).",
    "Municipal taxes reduce GAV only for a let-out property, and only when actually paid during the year.",
  ];
  for (const e of entries) {
    sources.push(sourceTag("house_property", e));
    const gav = e.usage === "let_out" ? e.annualRentReceived : 0;
    const municipalDeduction = e.usage === "let_out" ? e.municipalTaxesPaid : 0;
    const nav = gav - municipalDeduction;
    const standardDeduction = HOUSE_PROPERTY.standardDeductionRate * Math.max(0, nav);
    let interestAllowed: number;
    if (e.usage === "self_occupied") {
      interestAllowed =
        regime === "old"
          ? Math.min(e.homeLoanInterest, HOUSE_PROPERTY.selfOccupiedInterestCapOld)
          : 0;
    } else {
      interestAllowed = e.homeLoanInterest;
    }
    const netForProperty = nav - standardDeduction - interestAllowed;
    rawNet += netForProperty;
    parts.push(
      `${e.usage}: GAV ₹${gav} - municipal ₹${municipalDeduction} = NAV ₹${roundRupee(nav)}; ` +
        `- 30% std ded ₹${roundRupee(standardDeduction)} - interest ₹${roundRupee(interestAllowed)} = ₹${roundRupee(netForProperty)}`,
    );
    if (e.usage === "self_occupied" && regime === "new" && e.homeLoanInterest > 0) {
      notes.push("New regime: self-occupied home-loan interest is not deductible (Section 115BAC) — excluded.");
    }
  }

  let value = rawNet;
  if (rawNet < 0) {
    if (regime === "old") {
      value = Math.max(rawNet, -HOUSE_PROPERTY.lossSetOffCapOld);
      if (rawNet < -HOUSE_PROPERTY.lossSetOffCapOld) {
        notes.push(
          `Loss of ₹${roundRupee(Math.abs(rawNet))} exceeds the ₹${HOUSE_PROPERTY.lossSetOffCapOld} Section 71(3A) ` +
            "annual set-off cap against other heads — the excess is not applied this year and is not carried forward.",
        );
      }
    } else {
      value = 0;
      notes.push(
        "New regime: a house-property loss cannot be set off against any other head (Section 115BAC) — excluded from total income.",
      );
    }
  }

  return computed(roundRupee(value), parts.join("; "), uniq(sources), notes);
}

/**
 * K4-14 — net profit of a BOOKS-BASED business or profession (Sections 28/29).
 *
 * Deliberately the plainest arithmetic in this engine: declared revenue less
 * declared expenses. Everything interesting about this function is what it
 * REFUSES to do, because Section 29 makes book profit and taxable profit
 * different numbers whenever any of Sections 30-43D bites.
 *
 * Takes NO regime argument, and that is a sourced consequence rather than a
 * convenience: Section 115BAC(2) disallows particular business deductions in
 * the new regime, so an adjusted figure WOULD differ by regime — but this
 * slice admits only the unadjusted case, where it cannot. See
 * `RegimeComputation.businessBooksIncome`.
 *
 * TWO DEFENSIVE REFUSALS, neither of which should ever fire in production,
 * because `computation-adapter.ts` has already excluded such a row and marked
 * the result incomplete. They exist because a stored snapshot, a hand-built
 * fixture or a future caller could route around the adapter, and a wrong
 * business profit that merely looks plausible is exactly the failure `K4-13`
 * was created to remove. Each reads the SAME authority the adapter reads
 * (`BUSINESS_BOOKS_ADJUSTMENTS`), so this is defence in depth, not a second
 * rule that could drift:
 *
 *  1. a basis whose `computable` is false — contributes nothing, and says so;
 *  2. a NEGATIVE aggregate — Section 70(1) intra-head set-off has not fully
 *     absorbed the current-year loss, so the residual would require Section
 *     71 cross-head treatment or Section 72 carry-forward, neither modelled.
 *
 * AGGREGATION ACROSS BUSINESSES (K4-15). Section 28(i) charges "the profits and
 * gains of ANY business or profession which was carried on by the assessee at
 * any time during the previous year", so a taxpayer carrying on several is
 * charged on all of them under this one head, and the head's figure is their
 * SUM. K4-14 refused a multi-entry set outright; that refusal is now gone.
 *
 * The refusals that remain are refusals of the WHOLE head, never of one entry
 * within it, and that is deliberate. This function returns a single
 * `ComputedValue` for the head, so excluding one entry while summing the rest
 * would publish a number corresponding to no statutory quantity — a partial
 * head total presented as the head. Every entry counts or none does.
 *
 * K4-17: a negative ENTRY may now be netted against positive current-year
 * entries under Section 70(1), verbatim:
 *
 *   "Save as otherwise provided in this Act, where the net result for any assessment year in respect of"
 *   "any source falling under any head of income, other than \"Capital gains\", is a loss, the assessee"
 *   "shall be entitled to have the amount of such loss set off against his income from any other source"
 *   "under the same head."
 *
 * The bounded implementation admits that entitlement only when the WHOLE
 * books-business/profession aggregate is zero or positive. A negative
 * aggregate would leave a residual for Sections 71/72 and still refuses.
 */
export function computeBusinessBooksIncome(entries: BusinessBooksEntry[]): ComputedValue {
  if (entries.length === 0) {
    return computed(0, "no books-based business or profession declared", [], []);
  }

  const describe = (e: BusinessBooksEntry) => (e.isProfession ? "profession" : "business");

  // Defence in depth, reading the SAME authority the adapter reads. Ordered to
  // match the adapter's own gate order so a snapshot rehydrated around the
  // adapter reports the same reason the adapter would have.
  for (const e of entries) {
    const set = asAdjustmentSet(e.adjustments);
    const noneOnly = isNoneOnlyAdjustments(e.adjustments);
    const hasNone = set.includes("none_s30_43d");
    const hasDepreciation = set.includes("depreciation_s32");
    const uncomputable = set.find((member) => !BUSINESS_BOOKS_ADJUSTMENTS[member].computable);
    const depFactsMissing =
      hasDepreciation &&
      (e.claimsAdditionalDepreciation === true ||
        e.claimsAdditionalDepreciation !== false ||
        e.bookDepreciation === undefined ||
        e.bookDepreciation === null ||
        !e.depreciationBlocks ||
        e.depreciationBlocks.length === 0);
    if (set.length === 0 || (hasNone && set.length > 1) || uncomputable || depFactsMissing) {
      const refused = uncomputable
        ? BUSINESS_BOOKS_ADJUSTMENTS[uncomputable]
        : hasDepreciation
          ? BUSINESS_BOOKS_ADJUSTMENTS.depreciation_s32
          : undefined;
      return computed(
        0,
        `books-based ${describe(e)} declares "${refused?.label ?? (set.join(", ") || "undeclared")}" — not computed`,
        [],
        [
          `A Sections 30-43D adjustment is owed (${refused?.authority ?? "unclassified or contradictory basis"}) ` +
            "that this engine cannot compute on the facts declared. The declared net profit is therefore NOT the " +
            "taxable figure and was excluded rather than used. Section 28 charges this head on every " +
            "business carried on, so the whole head was excluded, not just this record.",
        ],
      );
    }
    if (!noneOnly && !hasDepreciation) {
      return computed(
        0,
        `books-based ${describe(e)} declares "${set.join(", ")}" — not computed`,
        [],
        [
          "No recognised computable Sections 30-43D basis was declared. The whole head was excluded.",
        ],
      );
    }
    const activity = BUSINESS_BOOKS_ACTIVITY_CLASSIFICATIONS[e.activityClassification];
    if (!activity || !activity.computable) {
      return computed(
        0,
        `books-based ${describe(e)} declares "${activity?.label ?? e.activityClassification}" — not computed`,
        [],
        [
          `The declared activity is outside the admitted Section 70 pool (${activity?.authority ?? "unclassified activity"}). ` +
            "That pool holds an ordinary business or profession and, since K4-18, exchange-traded F&O affirmed as " +
            "eligible transactions under Section 43(5) proviso (d). Speculation-business treatment (Explanation 2 to " +
            "Section 28 with Section 73) and Sections 35AD/73A specified-business treatment are not implemented, so " +
            "the whole head was excluded.",
        ],
      );
    }
  }

  const total = entries.reduce((sum, e) => sum + toPaise(booksEntryNet(e)), 0) / 100;
  if (total < 0) {
    return computed(
      0,
      `books-based business/profession aggregate = residual loss ₹${roundRupee(Math.abs(total))} — not computed`,
      [],
      [
        `Section 70(1) intra-head set-off leaves a current-year business-head loss of ₹${roundRupee(Math.abs(total))}. ` +
          "Cross-head set-off under Section 71 and carry-forward under Section 72 are not implemented, so " +
          "the residual was neither applied nor treated as ₹0 income. The whole head was excluded.",
      ],
    );
  }
  const label =
    entries.length === 1
      ? `books-based ${describe(entries[0] as BusinessBooksEntry)}`
      : `${entries.length} books-based businesses/professions`;
  const arithmetic = entries
    .map((e) => {
      if (asAdjustmentSet(e.adjustments).includes("depreciation_s32")) {
        const allowance = computeSection32Allowance(e.depreciationBlocks ?? []);
        return (
          `revenue ₹${e.revenue} - expenses ₹${e.expenses} + book depreciation ₹${e.bookDepreciation ?? 0} ` +
          `- Section 32(1)(ii) ₹${allowance}`
        );
      }
      return `revenue ₹${e.revenue} - expenses ₹${e.expenses}`;
    })
    .join(" + ");
  const anyDepreciation = entries.some((e) => asAdjustmentSet(e.adjustments).includes("depreciation_s32"));

  return computed(
    roundRupee(total),
    `${label} (Sections 28/29): ${arithmetic}`,
    uniq(entries.map((e) => sourceTag("business_books", e))),
    [
      anyDepreciation
        ? "Net profit per the DECLARED books after a bounded Section 32(1)(ii) adjustment: book " +
          "depreciation is added back and the Appendix I standing-class allowance is deducted. " +
          "This engine does not compute written-down value under Section 43(6)(c), additional " +
          "depreciation under Section 32(1)(iia), or unabsorbed depreciation under Section 32(2). " +
          "The WDV of each block is the preparer's declaration. No Section 37/40/43B disallowance " +
          "and no presumptive-to-books transition is applied (CA-verify)."
        : "Net profit per the DECLARED books. The preparer has declared that no Sections 30-43D adjustment " +
          "arises: no depreciation charge or Section 32 claim, no Section 37/40/43B disallowance or " +
          "add-back, and no move to books from a presumptive scheme. This engine verifies none of that — " +
          "it records the declaration and computes only on it. It applies NO Sections 30-43D provision of " +
          "its own, so this figure is a declared profit, not an independently derived taxable profit " +
          "(CA-verify).",
      ...(entries.length > 1
        ? [
            `This is the AGGREGATE of ${entries.length} separate businesses or professions, summed under ` +
              "the single head Section 28 charges. " +
              (entries.some((e) => booksEntryNet(e) < 0)
                ? "Section 70(1) current-year intra-head set-off absorbed the negative source result in full; the aggregate is non-negative, so no residual was sent to cross-head set-off or carry-forward."
                : "Every source result was non-negative, so Section 70(1) was not engaged."),
          ]
        : []),
    ],
  );
}

// ---------------------------------------------------------------------------
// Per-regime computation
// ---------------------------------------------------------------------------

/**
 * `K4-23` / `D337` item 5. `compareBothRegimes` sets this on a SECOND pass
 * when either regime found the s.112 first proviso could bite, so the
 * refusal is case-level rather than per-regime and a recommended regime can
 * never quietly tax a gain the other regime refused.
 */
export interface HouseSaleLtcgRegimeOptions {
  forceHouseSaleLtcgRefusal?: boolean;
}

export function computeRegime(
  input: TaxEngineInput,
  regime: Regime,
  derived: DerivedIncome,
  figures: ComputationRateFigures,
  options?: HouseSaleLtcgRegimeOptions,
): RegimeComputation {
  const notes: string[] = [];

  // Standard deduction (only if salary present; capped at gross salary).
  const stdCap = STANDARD_DEDUCTION[regime];
  const stdDeduction = derived.grossSalary > 0 ? Math.min(stdCap, derived.grossSalary) : 0;
  const standardDeduction = computed(
    roundRupee(stdDeduction),
    derived.grossSalary > 0
      ? `min(₹${stdCap} standard deduction, gross salary ₹${derived.grossSalary})`
      : "no salary income → no standard deduction",
    derived.salarySources,
  );

  const salaryIncome = Math.max(0, derived.grossSalary - stdDeduction);

  // K4-02/K4-03: the effective age band for OLD-regime, resident-only
  // treatment (basic-exemption widening AND the age-aware 80D/80TTA/80TTB
  // caps below) — the new regime's slabs and deductions are age-neutral, and
  // a non-resident/unresolved-residency taxpayer never receives resident
  // senior/super-senior treatment merely from age (mirrors senior-
  // treatment.ts's own residency gate). Computed once, reused by both
  // Chapter VI-A deductions and the slab selection further below.
  const effectiveOldRegimeAgeBand =
    regime === "old" && input.taxpayer.residentStatus === "resident"
      ? (input.taxpayer.ageCategory ?? null)
      : null;

  // Chapter VI-A deductions: old regime only. New regime disallows them.
  // K4-05: `residentOldRegime` gates the "80D_PARENTS" bucket's confirmed-
  // senior cap — the SAME condition `effectiveOldRegimeAgeBand` is itself
  // computed under, kept as an explicit boolean rather than re-derived from
  // that value's own null-ness (see `computeDeductions`'s own doc).
  const residentOldRegime = regime === "old" && input.taxpayer.residentStatus === "resident";
  const chapterVIA =
    regime === "old"
      ? computeDeductions(input.deductions, effectiveOldRegimeAgeBand, residentOldRegime)
      : computed(0, "new regime: Chapter VI-A deductions not allowed", [], [
          "New regime (s.115BAC) disallows most Chapter VI-A deductions.",
        ]);

  const deductionsAllowed = computed(
    roundRupee(stdDeduction + chapterVIA.value),
    `standard deduction ₹${roundRupee(stdDeduction)} + Chapter VI-A ₹${chapterVIA.value}`,
    uniq([...standardDeduction.sources, ...chapterVIA.sources]),
    chapterVIA.notes,
  );

  // K4-06: house property (Sections 22-27) — regime-dependent (self-occupied
  // Section 24(b) interest treatment + Section 71(3A)/115BAC loss set-off
  // both differ by regime), so computed per-regime here rather than in the
  // shared, regime-independent `derived`.
  const housePropertyIncome = computeHouseProperty(input.housePropertyEntries ?? [], regime);

  // K4-14: books-based business/profession net profit (Sections 28/29) —
  // regime-INdependent (see `computeBusinessBooksIncome`'s own doc for why
  // that is a consequence of this slice's narrowness, not a general claim
  // about business income), but computed here beside house property rather
  // than on the shared `derived`, because it reads `input`, not `input.income`.
  const businessBooksIncome = computeBusinessBooksIncome(input.businessBooksEntries ?? []);

  // Normal (slab-rate) taxable income — capital gains excluded by design.
  // House property net income/loss, Section 44ADA presumptive professional
  // income (K4-07), Section 44AD presumptive business income (K4-08) — the
  // latter two both regime-independent — and the K4-14 books-based business
  // net profit are all ordinary slab-rate income, included here (never as a
  // special-rate item, and never summed a second time).
  const normalTaxableValue = Math.max(
    0,
    salaryIncome +
      derived.otherSlabIncome +
      housePropertyIncome.value +
      derived.presumptiveProfessionalIncome.value +
      derived.presumptiveBusinessIncome.value +
      businessBooksIncome.value +
      derived.houseSaleStcg -
      chapterVIA.value,
  );
  const houseSaleClause =
    derived.houseSaleStcg > 0 ? ` + house-sale STCG ₹${derived.houseSaleStcg}` : "";
  const normalTaxableIncome = computed(
    roundRupee(normalTaxableValue),
    `salary (₹${derived.grossSalary} - std ₹${roundRupee(stdDeduction)}) + other slab income ₹${derived.otherSlabIncome} + house property ₹${housePropertyIncome.value} + presumptive professional income (44ADA) ₹${derived.presumptiveProfessionalIncome.value} + presumptive business income (44AD) ₹${derived.presumptiveBusinessIncome.value} + books-based business income ₹${businessBooksIncome.value}${houseSaleClause} - Chapter VI-A ₹${chapterVIA.value}`,
    uniq([
      ...derived.salarySources,
      ...derived.otherSlabSources,
      ...housePropertyIncome.sources,
      ...derived.presumptiveProfessionalIncome.sources,
      ...derived.presumptiveBusinessIncome.sources,
      ...businessBooksIncome.sources,
      ...derived.houseSaleStcgSources,
      ...chapterVIA.sources,
    ]),
    derived.houseSaleStcg > 0
      ? [
          "Excludes special-rate capital gains (111A/112A). House-sale STCG under s.45/s.48 is slab-rate income, not s.111A.",
        ]
      : ["Excludes capital gains — those are taxed at special rates."],
  );

  // K4-23 / D337 item 5 — the s.112(1)(a) FIRST proviso.
  //
  // It reduces the long-term gain by the amount by which "the total income
  // as so reduced falls short of the maximum amount which is not chargeable
  // to income-tax". This engine does not apply that reduction, and `D337`
  // forbids merely disclosing the omission: wherever the shortfall COULD
  // change the s.112 figure, the whole long-term treatment fails closed.
  //
  // The base is total income REDUCED BY the s.112 gain — which is exactly
  // `normalTaxableValue + the 111A/112A gains`, so it does not depend on the
  // house LTCG and there is no circularity. `forceHouseSaleLtcgRefusal`
  // carries the OTHER regime's verdict in, because `D337` says fail closed
  // when it could bite "in either tax regime"; `compareBothRegimes` runs the
  // second pass.
  const basicExemption = maximumAmountNotChargeable(
    slabsForRegime(figures, regime, effectiveOldRegimeAgeBand),
  );
  const incomeOutsideHouseLtcg = normalTaxableValue + derived.stcg111a + derived.ltcg112a;
  const basicExemptionCouldBite =
    derived.houseSaleLtcg > 0 && incomeOutsideHouseLtcg < basicExemption;
  const houseSaleLtcgRefusalCode = options?.forceHouseSaleLtcgRefusal
    ? HOUSE_SALE_LTCG_BASIC_EXEMPTION_REFUSAL
    : basicExemptionCouldBite
      ? HOUSE_SALE_LTCG_BASIC_EXEMPTION_REFUSAL
      : null;
  const houseSaleLtcgTreatmentSupported = houseSaleLtcgRefusalCode === null;
  const houseSaleLtcg = houseSaleLtcgTreatmentSupported ? derived.houseSaleLtcg : 0;
  const houseSaleLtcgTax = houseSaleLtcgTreatmentSupported ? derived.houseSaleLtcgTax : 0;
  if (!houseSaleLtcgTreatmentSupported && derived.houseSaleLtcg > 0) {
    notes.push(
      `house_sale LTCG of ₹${derived.houseSaleLtcg} is REFUSED (${houseSaleLtcgRefusalCode}): ` +
        `income outside that gain (₹${roundRupee(incomeOutsideHouseLtcg)}) is below the maximum ` +
        `amount not chargeable to income-tax (₹${basicExemption}) in at least one regime, so the ` +
        "first proviso to s.112(1)(a) could change the figure. It is not computed and not taxed.",
    );
  }

  // K4-23 / D337 item 16 — the comparison is DISCLOSED, per property, not
  // just applied. A preparer must be able to see both branches, which one
  // was adopted, how much tax the second proviso ignored, and which index
  // values were used, because the adopted figure is not recomputable from
  // the gain alone.
  if (houseSaleLtcgTreatmentSupported && derived.houseSaleLtcgDetails.length > 0) {
    for (const d of derived.houseSaleLtcgDetails) {
      const branch = d.taxSelected === d.taxCurrentLaw ? "A" : "B";
      notes.push(
        `house_sale LTCG (s.112, per property): unindexed gain ₹${d.currentLawGain} → branch A ` +
          `12.5% = ₹${d.taxCurrentLaw}; ` +
          (d.comparisonApplies
            ? `indexed cost ₹${d.indexedCostOfAcquisition} (CII ${d.transferIndex} for ` +
              `${d.transferFinancialYear} ÷ ${d.acquisitionIndex} for ${d.acquisitionFinancialYear})` +
              `${d.comparatorNil ? ", comparator nil" : ` → comparator gain ₹${d.comparatorGain}`}` +
              ` → branch B 20% = ₹${d.taxComparator}; ADOPTED branch ${branch} = ₹${d.taxSelected}` +
              (d.excessIgnored > 0
                ? `, excess ignored under the second proviso to s.112(1)(a) = ₹${d.excessIgnored}`
                : ", no excess to ignore")
            : "acquired on or after 23 July 2024, so the second proviso does not apply and no " +
              `comparison is made; ADOPTED ₹${d.taxSelected}`) +
          ". Total income carries the UNINDEXED gain; only the tax is capped. No s.87A rebate " +
          "is applied against this tax.",
      );
    }
    if (derived.houseSaleLtcgDetails.some((d) => d.comparisonApplies)) {
      notes.push(
        "The Cost Inflation Index values above are notified figures under s.48 Explanation (v). " +
          "All twenty-five values this engine holds now come from registered e-Gazette " +
          "notifications, each hash-registered and committed as a three-mode extract, with the " +
          "amendment chain unbroken from FY 2001-02 to FY 2025-26. Those are rank-2 e-Gazette " +
          "PDFs of statutory instruments, not the instruments as issued. The s.112(1)(a) FIRST " +
          "proviso (basic-exemption absorption) is not " +
          "applied; a case where it could bite is refused rather than computed. Sections 54 " +
          "and 54F are refused, not computed. Preparation-only — CA verification required.",
      );
    }
  }

  const specialGainsValue = derived.stcg111a + derived.ltcg112a + houseSaleLtcg;
  // K4-09: when a within-year loss set-off occurred, the formula states the
  // gross figures and the amount absorbed, so the net number a preparer sees
  // can be reconciled back to the declared rows rather than appearing to
  // contradict them.
  const setOff = derived.capitalLossSetOff;
  const setOffApplied = setOff.absorbedAgainstStcg > 0 || setOff.absorbedAgainstLtcg > 0;
  // K4-10: the brought-forward leg is stated SEPARATELY from the within-year
  // leg in the formula, never folded into one "loss set off" number. They are
  // governed by different sections and only the brought-forward one leaves a
  // residual that carries into a future year — a preparer reconciling this
  // figure has to be able to tell them apart.
  const bfSetOff = derived.broughtForwardLossSetOff;
  const bfApplied = bfSetOff.absorbedAgainstStcg > 0 || bfSetOff.absorbedAgainstLtcg > 0;
  const withinYearStcg = setOff.grossStcg111a - setOff.absorbedAgainstStcg;
  const withinYearLtcg = setOff.grossLtcg112a - setOff.absorbedAgainstLtcg;
  const bfClause = bfApplied
    ? ` - brought-forward loss set off ₹${bfSetOff.absorbedAgainstStcg} (STCG) / ` +
      `₹${bfSetOff.absorbedAgainstLtcg} (LTCG) [s.74, "${bfSetOff.policyId}" allocation policy — a ` +
      "named default for specific official-artifact versions, not a statutory ordering rule]"
    : "";
  const specialRateCapitalGains = computed(
    roundRupee(specialGainsValue),
    (setOffApplied
      ? `STCG 111A ₹${setOff.grossStcg111a} - within-year loss set off ₹${setOff.absorbedAgainstStcg} (₹${withinYearStcg}) + ` +
        `LTCG 112A ₹${setOff.grossLtcg112a} - within-year loss set off ₹${setOff.absorbedAgainstLtcg} (₹${withinYearLtcg}) ` +
        "[within-year set-off, s.70/74; a capital loss may not reduce any other head, s.71(3)]"
      : `STCG 111A ₹${withinYearStcg} + LTCG 112A ₹${withinYearLtcg}`) +
      bfClause +
      // K4-23 review F4 (P1): the VALUE already included the house gain while
      // the formula and the source list did not, so the house ledger row was
      // absent from the lineage of special gains, total income, special tax,
      // surcharge and gross liability despite materially determining all of
      // them. A figure whose sources omit a row that determines it is exactly
      // the traceability defect `K3-22` exists to prevent.
      (houseSaleLtcg > 0 ? ` + house-sale LTCG ₹${houseSaleLtcg} (s.112)` : ""),
    uniq([
      ...derived.stcg111aSources,
      ...derived.ltcg112aSources,
      ...(houseSaleLtcg > 0 ? derived.houseSaleLtcgSources : []),
    ]),
  );

  // K4-10 traceability figure. Regime-independent by construction — Section 74
  // set-off does not vary by regime — so both regimes reuse this value; it is
  // ALREADY inside `specialRateCapitalGains` and is never subtracted twice.
  const broughtForwardLossSetOffValue = computed(
    roundRupee(bfSetOff.absorbedAgainstStcg + bfSetOff.absorbedAgainstLtcg),
    bfApplied
      ? `s.74 brought-forward loss absorbed: ₹${bfSetOff.absorbedAgainstStcg} against STCG 111A + ` +
        `₹${bfSetOff.absorbedAgainstLtcg} against LTCG 112A, under the "${bfSetOff.policyId}" ` +
        `allocation policy (${bfSetOff.policyVersion})`
      : "no brought-forward capital loss was absorbed",
    // The facts behind THIS number are the carry-forward records that were
    // actually applied, plus the gain rows that absorbed them — both halves are
    // load-bearing and neither alone explains the figure. Records that were
    // excluded (expired, ineligible) contributed nothing and are deliberately
    // NOT tagged here; they are disclosed as their own findings instead.
    uniq([
      ...derived.broughtForwardSources,
      ...derived.stcg111aSources,
      ...derived.ltcg112aSources,
    ]),
    bfApplied
      ? [
          "Applied AFTER within-year set-off (ss.70/71), against the gains surviving it. The " +
            "allocation sequence comes from a NAMED, VERSIONED policy reproducing the official " +
            "utility's default for ITR-2 utility v1.2 / JSON schema v1.1 / validation rules v1.0 — " +
            "it is portal-conformance behaviour, NOT a statutory ordering rule, and no source " +
            "making any intra-head rate-bucket sequence mandatory was located (CA-verify).",
        ]
      : [],
  );

  const totalIncomeValue = normalTaxableValue + specialGainsValue;
  const totalIncome = computed(
    roundRupee(totalIncomeValue),
    `normal taxable ₹${roundRupee(normalTaxableValue)} + special-rate gains ₹${roundRupee(specialGainsValue)}`,
    uniq([...normalTaxableIncome.sources, ...specialRateCapitalGains.sources]),
  );

  // Slab tax on normal income — reuses the SAME `effectiveOldRegimeAgeBand`
  // computed above (never a second, independently-derived value).
  const slabs = slabsForRegime(figures, regime, effectiveOldRegimeAgeBand);
  const slabTaxValue = applySlabTax(normalTaxableValue, slabs);
  const slabTax = computed(
    roundRupee(slabTaxValue),
    `${describeSlabs(regime, effectiveOldRegimeAgeBand)} on ₹${roundRupee(normalTaxableValue)}`,
    normalTaxableIncome.sources,
  );

  // Special-rate tax: STCG 111A @20%, LTCG 112A @12.5% over ₹1.25L exemption.
  //
  // K4-10 / D93 Q1 / D114: the ₹1,25,000 threshold is applied to the Section
  // 112A income SURVIVING loss set-off — `derived.ltcg112a` is already net of
  // BOTH the within-year (ss.70/71) and the brought-forward (s.74) legs — and
  // is NEVER subtracted from the gross Schedule 112A gain beforehand. That
  // ordering is reproduced from the byte-verified official ITR-2 v1.2 workbook
  // by `TAX-SAFE-02A`: worksheet `SPI - SI`, `P3 = MIN(125000,H28)` with
  // `I28 = ROUND(IF(taxableInc2B>P3,(taxableInc2B-P3)*F28/100,0),0)`, where the
  // threshold is taken FROM the figure being taxed. It is PORTAL-CONFORMANCE
  // EVIDENCE, not statute, and it is not CA-verified.
  const ltcgTaxable = Math.max(0, derived.ltcg112a - CAPITAL_GAINS.ltcg112aExemption);
  const stcgTax = derived.stcg111a * CAPITAL_GAINS.stcg111aRate;
  const ltcgTax = ltcgTaxable * CAPITAL_GAINS.ltcg112aRate;
  // K4-23 / D337 item 14 — house-sale LTCG is s.112 SPECIAL-RATE income.
  // Its tax is the PER-PROPERTY adopted figure carried on `derived`, never
  // a rate re-applied to the summed gain here: re-deriving it would silently
  // discard the second proviso's cap. There is no ₹1,25,000 threshold —
  // that is s.112A's and applies to listed equity only.
  const specialRateTaxValue = stcgTax + ltcgTax + houseSaleLtcgTax;
  const specialRateTax = computed(
    roundRupee(specialRateTaxValue),
    `STCG 111A ₹${derived.stcg111a}×20% (₹${roundRupee(stcgTax)}) + LTCG 112A max(0, ₹${derived.ltcg112a} - ₹${CAPITAL_GAINS.ltcg112aExemption})×12.5% (₹${roundRupee(ltcgTax)})` +
      (houseSaleLtcgTax > 0 || houseSaleLtcg > 0
        ? ` + house-sale LTCG (s.112, per-property comparison) ₹${houseSaleLtcgTax}`
        : ""),
    specialRateCapitalGains.sources,
    bfApplied
      ? [
          "The ₹1,25,000 Section 112A threshold is applied to the 112A income SURVIVING loss " +
            "set-off, not to the gross Schedule 112A gain. That sequence is reproduced from the " +
            "official ITR-2 v1.2 workbook (`SPI - SI`, P3 = MIN(125000,H28)) and is " +
            "portal-conformance evidence for those artifact versions, NOT statute (CA-verify).",
        ]
      : [],
  );

  // K4-12: Section 87A rebate AND its rebate-threshold marginal relief. ONE
  // authority owns both — `rebate-relief.ts` — because clause (a) and clause
  // (b) of the same proviso are two ways of quantifying ONE deduction. Applied
  // to slab (normal) tax only; NOT applied to special-rate tax (112A
  // explicitly excluded; 111A conservatively excluded). Outside the clause (b)
  // window this returns exactly what the previous inline arithmetic did, which
  // is why every fixture below ₹12,00,000 is byte-identical.
  const rebateCfg = figures.rebate[regime];
  const rebateTreatment = computeRebate87A({
    regime,
    totalIncome: totalIncomeValue,
    slabTax: slabTaxValue,
    specialRateTax: specialRateTaxValue,
    specialRateIncome: specialGainsValue,
    schedule: figures.rebate,
  });
  const rebateValue = rebateTreatment.rebate;
  const rebate = computed(
    roundRupee(rebateValue),
    rebateTreatment.state === "ordinary_rebate"
      ? `total income ₹${roundRupee(totalIncomeValue)} ≤ ₹${rebateCfg.incomeLimit} → min(slab tax ₹${roundRupee(slabTaxValue)}, ₹${rebateCfg.maxRebate})`
      : rebateTreatment.marginalRelief > 0
        ? `total income ₹${roundRupee(totalIncomeValue)} > ₹${rebateCfg.incomeLimit} → s.87A marginal relief: slab tax ₹${roundRupee(slabTaxValue)} - excess ₹${roundRupee(totalIncomeValue - rebateCfg.incomeLimit)}`
        : `total income ₹${roundRupee(totalIncomeValue)} > ₹${rebateCfg.incomeLimit} → no 87A rebate`,
    [],
    ["87A rebate not applied to special-rate capital-gains tax (CA-verify).", rebateTreatment.message],
  );

  // K4-12 traceability figure. Kept separate from `rebate` for the same reason
  // `marginalRelief` is kept separate from `surcharge`: a preparer reconciling
  // a rebate that exists ABOVE the ₹12,00,000 ceiling has to be able to see the
  // relief itself. It is ALREADY inside `rebate` and is never added twice.
  const rebateMarginalRelief = computed(
    roundRupee(rebateTreatment.marginalRelief),
    rebateTreatment.marginalRelief > 0
      ? `income-tax ₹${roundRupee(slabTaxValue)} - (total income ₹${roundRupee(totalIncomeValue)} - ₹${rebateCfg.incomeLimit}), capped at the income-tax payable at s.115BAC(1A) rates`
      : "no section 87A rebate-threshold marginal relief arises",
    [],
    [rebateTreatment.message],
  );

  // K4-11: surcharge and marginal relief (Sections: Finance Act 2025 First
  // Schedule Part III / s.2(3)'s 115BAC proviso). Computed only inside the
  // window `rules.ts`'s SURCHARGE documents; outside it this returns ₹0 with
  // `supported: false` and the case stays reliance-blocked. A case at or below
  // ₹50,00,000 returns ₹0 with `supported: true` — a computed nil, which is
  // why every pre-K4-11 fixture below that income is byte-identical.
  const incomeTaxBeforeSurcharge = Math.max(0, slabTaxValue - rebateValue) + specialRateTaxValue;
  const surchargeTreatment = computeSurcharge({
    totalIncome: totalIncomeValue,
    incomeTaxBeforeSurcharge,
    specialRateIncome: specialGainsValue,
    slabs,
    schedule: figures.surcharge,
  });
  const surcharge = computed(
    roundRupee(surchargeTreatment.surcharge),
    surchargeTreatment.state === "computed"
      ? `${surchargeTreatment.rate * 100}% × income-tax ₹${roundRupee(incomeTaxBeforeSurcharge)}` +
        (surchargeTreatment.marginalRelief > 0
          ? ` - marginal relief ₹${roundRupee(surchargeTreatment.marginalRelief)}`
          : "")
      : surchargeTreatment.state === "not_applicable"
        ? `total income ₹${roundRupee(totalIncomeValue)} does not exceed ₹${figures.surcharge.entryThreshold} → nil surcharge`
        : `surcharge NOT computed for a total income of ₹${roundRupee(totalIncomeValue)}`,
    // Real lineage: surcharge is a percentage of the slab and special-rate tax,
    // so its facts are exactly theirs. Empty only when there is nothing behind
    // it (an empty case), which is an honest empty, not an untraced one.
    uniq([...slabTax.sources, ...specialRateTax.sources]),
    [surchargeTreatment.message, ...(surchargeTreatment.supported ? [] : [NOT_IMPLEMENTED.surcharge])],
  );

  // K4-11 traceability figure. Kept separate from `surcharge` because a
  // preparer reconciling a reduced surcharge has to be able to see the relief
  // itself; it is ALREADY netted inside `surcharge` and is never subtracted
  // twice.
  const marginalRelief = computed(
    roundRupee(surchargeTreatment.marginalRelief),
    surchargeTreatment.marginalReliefThreshold === null
      ? "no surcharge threshold applies, so no marginal relief arises"
      : `income-tax + surcharge capped at (income-tax on a total income of ₹${surchargeTreatment.marginalReliefThreshold}) ` +
        `+ (income exceeding ₹${surchargeTreatment.marginalReliefThreshold})`,
    uniq([...slabTax.sources, ...specialRateTax.sources]),
    [surchargeTreatment.message],
  );

  const taxAfterRebate = incomeTaxBeforeSurcharge + surcharge.value;

  // Health & Education Cess @4%.
  const cessValue = taxAfterRebate * figures.cess;
  const cess = computed(
    roundRupee(cessValue),
    `4% × (slab tax ₹${roundRupee(slabTaxValue)} - rebate ₹${roundRupee(rebateValue)} + special tax ₹${roundRupee(specialRateTaxValue)} + surcharge ₹${surcharge.value})`,
  );

  const grossTaxLiabilityValue = taxAfterRebate + cessValue;
  const grossTaxLiability = computed(
    roundRupee(grossTaxLiabilityValue),
    `slab tax ₹${roundRupee(slabTaxValue)} - rebate ₹${roundRupee(rebateValue)} + special tax ₹${roundRupee(specialRateTaxValue)} + surcharge ₹${surcharge.value} + cess ₹${roundRupee(cessValue)}`,
    uniq([...slabTax.sources, ...specialRateTax.sources]),
  );

  // Taxes paid (TDS/TCS/advance/self-assessment).
  const taxPaid = computeTaxPaid(input.taxPaid);

  const refundOrPayableValue = roundRupee(grossTaxLiabilityValue) - taxPaid.value;
  const refundOrPayable = computed(
    refundOrPayableValue,
    `gross tax liability ₹${roundRupee(grossTaxLiabilityValue)} - taxes paid ₹${taxPaid.value}`,
    taxPaid.sources,
    [
      refundOrPayableValue > 0
        ? `Tax payable of ₹${refundOrPayableValue}.`
        : refundOrPayableValue < 0
          ? `Refund of ₹${Math.abs(refundOrPayableValue)}.`
          : "No tax payable / no refund.",
    ],
  );

  notes.push(...derived.notes);

  return {
    regime,
    houseSaleLtcgTreatmentSupported,
    houseSaleLtcgDetails: houseSaleLtcgTreatmentSupported ? derived.houseSaleLtcgDetails : [],
    houseSaleLtcgExcessIgnored: houseSaleLtcgTreatmentSupported
      ? derived.houseSaleLtcgExcessIgnored
      : 0,
    standardDeduction,
    chapterVIADeductions: chapterVIA,
    deductionsAllowed,
    housePropertyIncome,
    presumptiveProfessionalIncome: derived.presumptiveProfessionalIncome,
    presumptiveBusinessIncome: derived.presumptiveBusinessIncome,
    businessBooksIncome,
    broughtForwardLossSetOff: broughtForwardLossSetOffValue,
    normalTaxableIncome,
    specialRateCapitalGains,
    totalIncome,
    slabTax,
    specialRateTax,
    rebate,
    rebateMarginalRelief,
    rebateTreatment,
    surcharge,
    marginalRelief,
    surchargeTreatment,
    cess,
    grossTaxLiability,
    taxPaid,
    refundOrPayable,
    notes,
  };
}

/**
 * `K4-23` / `D337` item 5 — run BOTH regimes, failing the s.112 house-sale
 * long-term treatment closed in BOTH whenever EITHER found the first
 * proviso's basic-exemption absorption could change the figure.
 *
 * WHY A SECOND PASS RATHER THAN A PRE-TEST. The test's base is total income
 * reduced by the s.112 gain, and that base is regime-dependent (standard
 * deduction, Chapter VI-A, house property all differ), so it is only known
 * once a regime has been computed. A per-regime refusal would be wrong in
 * the dangerous direction: the recommended regime is the LOWER tax, so a
 * case refused in the old regime and computed in the new would recommend the
 * new one and quietly tax a gain the engine had just said it could not
 * compute. The second pass costs one extra arithmetic run in the rare
 * refusing case and nothing otherwise.
 *
 * ONE HELPER, TWO CALLERS. `computeTax` and `compareRegimes` both route
 * through this so the rule cannot be implemented twice and drift.
 */
export function computeBothRegimes(
  input: TaxEngineInput,
  derived: DerivedIncome,
  figures: ComputationRateFigures,
): { oldRegime: RegimeComputation; newRegime: RegimeComputation } {
  let oldRegime = computeRegime(input, "old", derived, figures);
  let newRegime = computeRegime(input, "new", derived, figures);
  if (
    derived.houseSaleLtcg > 0 &&
    (!oldRegime.houseSaleLtcgTreatmentSupported || !newRegime.houseSaleLtcgTreatmentSupported)
  ) {
    const force = { forceHouseSaleLtcgRefusal: true };
    oldRegime = computeRegime(input, "old", derived, figures, force);
    newRegime = computeRegime(input, "new", derived, figures, force);
  }
  return { oldRegime, newRegime };
}

export function computeTaxPaid(taxPaid: TaxPaidEntry[]): ComputedValue {
  let total = 0;
  const sources: string[] = [];
  const parts: string[] = [];
  const byCat = new Map<string, number>();
  for (const t of taxPaid) {
    total += t.amount;
    byCat.set(t.category, (byCat.get(t.category) ?? 0) + t.amount);
    sources.push(sourceTag(t.category, t));
  }
  for (const [cat, amt] of byCat) parts.push(`${cat}=₹${amt}`);
  return computed(
    roundRupee(total),
    parts.length ? `taxes paid: ${parts.join(" + ")}` : "no taxes paid recorded",
    uniq(sources),
  );
}

// ---------------------------------------------------------------------------
// Public: computeTax
// ---------------------------------------------------------------------------

export function computeTax(
  input: TaxEngineInput,
  figures: ComputationRateFigures = AY_2026_27_COMPUTATION_FIGURES,
): TaxComputation {
  const derived = deriveIncome(input.income, input.capitalGains, broughtForwardContextOf(input));
  const { oldRegime, newRegime } = computeBothRegimes(input, derived, figures);

  // Recommend the lower gross tax liability; tie → new (default) regime.
  const recommendedRegime: Regime =
    newRegime.grossTaxLiability.value <= oldRegime.grossTaxLiability.value ? "new" : "old";
  const rec = recommendedRegime === "new" ? newRegime : oldRegime;

  // K4-06: `grossTotalIncome` is ONE regime-independent top-level figure
  // (both `comparison.old.grossTotalIncome` and `comparison.new.
  // grossTotalIncome` already read this SAME value — a pre-existing
  // architecture, unchanged by this session). House property's net income
  // under the head is genuinely regime-dependent (Section 24(b) self-
  // occupied interest + Section 71(3A)/115BAC loss set-off both differ by
  // regime), unlike every other head this figure sums. This top-line GTI
  // therefore uses the OLD-regime house-property treatment as its single
  // reference figure — the same convention this engine already applies to
  // Chapter VI-A (an old-regime-only concept GTI is defined to exclude);
  // Section 24 is not a Chapter VI-A deduction, so it is included here
  // (unlike Chapter VI-A) but at the OLD regime's figure specifically. A
  // disclosed limitation, not a silent one — see `oldRegime.housePropertyIncome`
  // for the regime that produced this GTI's house-property component, and
  // `oldRegime`/`newRegime.totalIncome` for the figure each regime's own tax
  // is actually computed from (which correctly uses each regime's own
  // house-property treatment).
  // K4-14: the books-based business figure is REGIME-INDEPENDENT, so — unlike
  // house property immediately above — reading it off `oldRegime` carries no
  // regime convention and needs no caveat; `oldRegime` and `newRegime` hold
  // equal values by construction.
  const grossTotalIncomeValue =
    derived.grossSalary +
    derived.otherSlabIncome +
    oldRegime.housePropertyIncome.value +
    derived.presumptiveProfessionalIncome.value +
    derived.presumptiveBusinessIncome.value +
    oldRegime.businessBooksIncome.value +
    derived.stcg111a +
    derived.ltcg112a +
    derived.houseSaleStcg +
    // K4-23 review F2 (P1): this sum ended at `houseSaleStcg` and never
    // added the long-term gain, so gross total income understated by the
    // whole house-sale LTCG on the Computation summary, case traceability
    // and the Review page while the tax calculation used it. `oldRegime` is
    // the reference regime for this top-line figure (the convention house
    // property already uses), and its verdict decides whether the gain is
    // in scope at all — a refused LTCG must not enter GTI either.
    (oldRegime.houseSaleLtcgTreatmentSupported ? derived.houseSaleLtcg : 0);
  const gtiHouseSaleClause =
    derived.houseSaleStcg > 0 ? ` + house-sale STCG ₹${derived.houseSaleStcg}` : "";
  const gtiHouseSaleLtcgClause =
    oldRegime.houseSaleLtcgTreatmentSupported && derived.houseSaleLtcg > 0
      ? ` + house-sale LTCG ₹${derived.houseSaleLtcg}`
      : "";
  const grossTotalIncome = computed(
    roundRupee(grossTotalIncomeValue),
    `salary ₹${derived.grossSalary} + other slab income ₹${derived.otherSlabIncome} + house property (old-regime treatment) ₹${oldRegime.housePropertyIncome.value} + presumptive professional income (44ADA) ₹${derived.presumptiveProfessionalIncome.value} + presumptive business income (44AD) ₹${derived.presumptiveBusinessIncome.value} + books-based business income ₹${oldRegime.businessBooksIncome.value} + STCG 111A ₹${derived.stcg111a} + LTCG 112A ₹${derived.ltcg112a}${gtiHouseSaleClause}${gtiHouseSaleLtcgClause} (before standard deduction & Chapter VI-A)`,
    uniq([
      ...derived.salarySources,
      ...derived.otherSlabSources,
      ...oldRegime.housePropertyIncome.sources,
      ...derived.presumptiveProfessionalIncome.sources,
      ...derived.presumptiveBusinessIncome.sources,
      ...oldRegime.businessBooksIncome.sources,
      ...derived.stcg111aSources,
      ...derived.ltcg112aSources,
      ...derived.houseSaleStcgSources,
      // K4-23 review F6 (P1): the SIBLING of F4, missed for the same reason
      // F4 existed — the value and the formula were updated while the source
      // array was not, so `grossTotalIncome.sources` omitted the ledger row
      // that materially determines it, and Computation, case traceability and
      // Review could not evidence GTI back to the house-sale input.
      // the project status notes names this the recurring "if you fix one, grep for
      // the others" class. This is that class, inside one session.
      ...(oldRegime.houseSaleLtcgTreatmentSupported ? derived.houseSaleLtcgSources : []),
    ]),
    [
      ...(derived.exemptIncome > 0
        ? [`Exempt income ₹${derived.exemptIncome} excluded from GTI.`]
        : []),
      ...(input.housePropertyEntries && input.housePropertyEntries.length > 0
        ? [
            "House property uses the OLD-regime treatment for this single top-line GTI figure (CA-verify) — " +
              "each regime's own comparison/total-income figures below correctly use that regime's own treatment.",
          ]
        : []),
    ],
  );

  const notes: string[] = [
    `Rules version ${RULES_VERSION}. Preparation-only — CA verification required before client reliance.`,
    `Recommended regime: ${recommendedRegime} (old ₹${oldRegime.grossTaxLiability.value} vs new ₹${newRegime.grossTaxLiability.value}).`,
    ...derived.notes,
  ];

  return {
    assessmentYear: input.assessmentYear,
    financialYear: input.financialYear,
    rulesVersion: RULES_VERSION,
    grossTotalIncome,
    ordinaryIncome: rec.normalTaxableIncome,
    specialRateCapitalGains: rec.specialRateCapitalGains,
    deductionsAllowed: rec.deductionsAllowed,
    totalIncome: rec.totalIncome,
    oldRegimeTax: oldRegime.grossTaxLiability,
    newRegimeTax: newRegime.grossTaxLiability,
    recommendedRegime,
    specialRateTax: rec.specialRateTax,
    rebate: rec.rebate,
    cess: rec.cess,
    grossTaxLiability: rec.grossTaxLiability,
    taxPaid: rec.taxPaid,
    refundOrPayable: rec.refundOrPayable,
    oldRegime,
    newRegime,
    capitalLossSetOff: derived.capitalLossSetOff,
    broughtForwardLossSetOff: derived.broughtForwardLossSetOff,
    // K4-11 — the ONE marker every enforcement layer reads (UI banner, filing
    // readiness, client-review action, and the guarded RPCs via the stored
    // snapshot JSON). Deliberately the CONJUNCTION of both regimes, for the same
    // reason `totalIncomeForSurchargeApplicability` takes the higher of the two
    // (D44): a case whose NON-recommended regime is the one the engine cannot
    // treat must not read as supported just because the recommended one is.
    surchargeTreatmentSupported:
      oldRegime.surchargeTreatment.supported && newRegime.surchargeTreatment.supported,
    // K4-23 / D337 item 5 — the third such marker. `computeBothRegimes`
    // already forces the two regimes to agree, so the AND is a restatement
    // of that invariant rather than a second rule; it is written as an AND
    // anyway so this line stays correct if that ever stops holding.
    houseSaleLtcgTreatmentSupported:
      oldRegime.houseSaleLtcgTreatmentSupported && newRegime.houseSaleLtcgTreatmentSupported,
    // K4-12 — the second such marker, for the SEPARATE section 87A
    // rebate-threshold relief. Deliberately its OWN boolean rather than being
    // ANDed into the surcharge one: the two refuse different cases at incomes
    // three orders of magnitude apart, and a preparer told "surcharge is not
    // supported" for a ₹12.2 lakh case would be told something false. Also the
    // conjunction of both regimes, for the same D44 reason — the relief reaches
    // the new regime only, but the OLD regime's figure still drives the
    // comparison and therefore the recommendation.
    rebateReliefTreatmentSupported:
      oldRegime.rebateTreatment.supported && newRegime.rebateTreatment.supported,
    notes,
  };
}
