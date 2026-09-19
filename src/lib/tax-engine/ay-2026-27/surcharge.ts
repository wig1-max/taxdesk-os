/**
 * K4-11 — surcharge and marginal relief for AY 2026-27 / FY 2025-26. PURE — no
 * imports beyond this engine's own rules/slabs/types.
 *
 * The statutory text this implements, the window it is bounded to, and the ONE
 * ambiguity it refuses rather than guesses are all documented on
 * {@link import("./rules").SURCHARGE} — read that first. This file is the
 * arithmetic only.
 *
 * `K4-PORT-03` (decision `D299`) made that separation real rather than
 * rhetorical: the schedule is no longer imported from `./rules`, it arrives on
 * `SurchargeInput.schedule` from the governing pack. Every figure below is the
 * supplied world's; every rule below is shared.
 *
 * FAIL-CLOSED CONTRACT. Every path either returns a figure this engine can
 * defend or returns `supported: false` with a reason. There is no path that
 * returns a best-guess number. Where a case is refused, the surcharge reported
 * is GROSS of marginal relief, so the figure is never UNDERSTATED — but it is
 * still marked unsupported, because "not understated" is not "correct".
 */

import type {
  SurchargeBandShape,
  SurchargeSchedule,
} from "@/lib/tax-engine/core/statutory-rate-parameters";
import { CAPITAL_GAINS } from "./rules";
import { applySlabTax, type SlabBand } from "./slabs";

/**
 * Why the surcharge figure is (or is not) a complete treatment.
 *
 * `not_applicable` is a POSITIVE result, not an absence: a total income at or
 * below ₹50,00,000 attracts nil surcharge as a matter of law, so ₹0 there is a
 * computed nil and NOT the unimplemented placeholder it was before K4-11.
 */
export type SurchargeSupportState =
  /** Total income does not exceed ₹50,00,000 — surcharge is nil by law. */
  | "not_applicable"
  /** Inside the implemented window; the figure is complete. */
  | "computed"
  /** Total income exceeds ₹2,00,00,000 — the 25%/37% tiers and the binding
   *  15% proviso are unmodelled, so no surcharge is computed at all. */
  | "unsupported_above_ceiling"
  /** Inside the window, but the case mixes slab income with special-rate
   *  111A/112A gains AND marginal relief could be non-zero — the notional
   *  reference income's composition is not resolved by any located source. */
  | "unsupported_marginal_relief_reference_ambiguous";

export interface SurchargeTreatment {
  readonly state: SurchargeSupportState;
  /**
   * TRUE only when the surcharge figure is a complete, defensible treatment
   * for this case. Every enforcement layer reads THIS — never the state string,
   * and never a re-derivation of the income test (D44's single-derivation rule,
   * generalised from a number to a judgement).
   */
  readonly supported: boolean;
  /** The regime's own total income the treatment was evaluated against. */
  readonly totalIncome: number;
  /** Applicable band rate (0 when nil or unsupported-above-ceiling). */
  readonly rate: number;
  /** Surcharge before marginal relief. */
  readonly surchargeBeforeRelief: number;
  /** Marginal relief actually applied (never negative). */
  readonly marginalRelief: number;
  /** Surcharge after relief — the figure the engine charges. */
  readonly surcharge: number;
  /** The reference threshold relief was measured against, when one applied. */
  readonly marginalReliefThreshold: number | null;
  /**
   * True when relief was proved nil under EVERY reading of the ambiguous
   * reference composition rather than computed exactly. A preparer reading a
   * ₹0 relief is entitled to know which of the two it is.
   */
  readonly marginalReliefProvedNilUnderEveryReading: boolean;
  /** Plain-language statement of what was and was not done. Always present. */
  readonly message: string;
}

export interface SurchargeInput {
  /** This regime's own total income (normal taxable + special-rate gains). */
  readonly totalIncome: number;
  /**
   * Income-tax before surcharge and cess: `max(0, slabTax − 87A rebate) +
   * specialRateTax`. The 87A rebate is nil throughout the surcharge range
   * under both regimes (its ceilings are ₹12,00,000 / ₹5,00,000), so no
   * rebate-vs-reference asymmetry can arise here.
   */
  readonly incomeTaxBeforeSurcharge: number;
  /**
   * Special-rate (111A + 112A) income included in `totalIncome`, NET of every
   * loss set-off. This is the ONLY thing that makes the marginal-relief
   * reference composition ambiguous — dividend does not, because this engine
   * already taxes it at slab rates, so a notional ₹50,00,000 of slab income is
   * the same figure whether or not part of it is dividend.
   */
  readonly specialRateIncome: number;
  /** The slab table actually used for this regime/age band. */
  readonly slabs: readonly SlabBand[];
  /**
   * The surcharge schedule SUPPLIED BY THE GOVERNING PACK (`K4-PORT-03`,
   * decision `D299`) — bands, entry threshold, supported ceiling, and the
   * special-rate rate cap.
   *
   * This file used to import the AY world's `SURCHARGE` object from `./rules`.
   * Taking it as an input is what makes the arithmetic below Act-agnostic: the
   * band test, the marginal-relief reference and the ambiguity refusal are
   * mechanics, while every figure they turn on is a statutory rate belonging to
   * the world that authorises it. A world holding no surcharge authority
   * withholds the parameter, so its pack carries no computation surface and
   * this function is never reached — never a per-Act branch (`D299`).
   */
  readonly schedule: SurchargeSchedule;
}

/**
 * The highest marginal rate any rupee of this engine's income can bear —
 * DERIVED from the slab table in play and the two special rates, never a
 * literal. It is what bounds how much removing income can reduce tax by, and
 * therefore what bounds marginal relief from above when the reference
 * composition is unknown.
 */
export function maxMarginalRateFor(slabs: readonly SlabBand[]): number {
  return Math.max(
    ...slabs.map((b) => b.rate),
    CAPITAL_GAINS.stcg111aRate,
    CAPITAL_GAINS.ltcg112aRate,
  );
}

/**
 * One declared surcharge band.
 *
 * **THIS IS THE REFACTOR EDGE `D309` NAMED.** It used to be
 * `(typeof SURCHARGE.bands)[number]` — a type DERIVED from one Act's constant,
 * exported from this module, and therefore a way for the 1961-Act figures to
 * reach any consumer of the "surcharge band" concept. It is now the shared
 * core's shape, so the concept is owned Act-agnostically and the constant is
 * just one value of it.
 */
export type SurchargeBand = SurchargeBandShape;

/**
 * The band an income falls INSIDE — `exceeding < totalIncome <= upTo` — or
 * `null` when no declared band covers it.
 *
 * `AUDIT-05-F3`: this used to consult `exceeding` only, keeping the LAST band
 * whose floor the income cleared and ignoring `upTo` entirely. That made the
 * declared upper bound decorative: an income above the whole table returned the
 * top band's rate rather than nothing, so the table's own coverage claim was
 * never enforced. It was harmless only because `computeSurcharge` refuses above
 * `supportedTotalIncomeCeiling` first — i.e. correctness rested on a guard in a
 * different function, not on this one. It now enforces both edges, so a band
 * table that stops short of the supported ceiling yields `null` (→ the explicit
 * no-band refusal) instead of silently extending the top rate upward.
 *
 * The half-open shape is the statute's own: surcharge applies where total income
 * EXCEEDS the floor (strict — TAX-SAFE-01A), and exactly ₹1,00,00,000 sits in
 * the 10% band, not the 15% one.
 */
export function surchargeBandFor(
  schedule: SurchargeSchedule,
  totalIncome: number,
): SurchargeBand | null {
  for (const band of schedule.bands) {
    if (totalIncome > band.exceeding && totalIncome <= band.upTo) return band;
  }
  return null;
}

const bandFor = surchargeBandFor;

/** Derived structural facts about the declared band table. Never restated. */
export interface SurchargeBandCoverage {
  /** Bands are declared in ascending order of their floors. */
  readonly ascending: boolean;
  /** Each band's floor is exactly the previous band's `upTo` — no gap, no overlap. */
  readonly contiguous: boolean;
  /** The first band's floor is exactly the schedule's `entryThreshold`. */
  readonly startsAtEntryThreshold: boolean;
  /** The last band's `upTo` is exactly the schedule's `supportedTotalIncomeCeiling`. */
  readonly endsAtSupportedCeiling: boolean;
  /** Every declared rate is at or below the 15% special-rate proviso cap. */
  readonly everyRateWithinSpecialRateCap: boolean;
  /** The highest total income any declared band covers. */
  readonly highestCoveredIncome: number;
}

/**
 * `AUDIT-05-F3`: ties the declared bands to the supported window STRUCTURALLY,
 * so the two can no longer drift apart silently. `computeSurcharge` refuses
 * above `supportedTotalIncomeCeiling` and computes below it — a claim that is
 * only honest if the band table actually covers
 * `(entryThreshold, supportedTotalIncomeCeiling]` with no gap. Widening the
 * ceiling without widening the bands (or vice versa) now breaks a derived
 * predicate rather than producing a quietly wrong rate.
 */
export function describeSurchargeBandCoverage(
  schedule: SurchargeSchedule,
): SurchargeBandCoverage {
  const bands: readonly SurchargeBand[] = schedule.bands;
  const first = bands[0];
  const last = bands[bands.length - 1];
  let ascending = true;
  let contiguous = true;
  for (let i = 1; i < bands.length; i += 1) {
    const previous = bands[i - 1];
    const current = bands[i];
    if (!previous || !current) continue;
    if (current.exceeding <= previous.exceeding) ascending = false;
    if (current.exceeding !== previous.upTo) contiguous = false;
  }
  for (const band of bands) {
    if (band.upTo <= band.exceeding) contiguous = false;
  }
  return {
    ascending,
    contiguous,
    startsAtEntryThreshold: first !== undefined && first.exceeding === schedule.entryThreshold,
    endsAtSupportedCeiling:
      last !== undefined && last.upTo === schedule.supportedTotalIncomeCeiling,
    everyRateWithinSpecialRateCap: bands.every(
      (b) => b.rate <= schedule.specialRateSurchargeRateCap,
    ),
    highestCoveredIncome: last !== undefined ? last.upTo : schedule.entryThreshold,
  };
}

/**
 * Income-tax on a NOTIONAL total income of `threshold`, on the assumption that
 * all of it is ordinary slab income. Correct — and the only reading — when the
 * case has no special-rate income at all. Never called otherwise.
 */
function unambiguousReferenceTax(threshold: number, slabs: readonly SlabBand[]): number {
  return applySlabTax(threshold, slabs);
}

/**
 * Surcharge on the reference income itself. Reproduces the statute's own
 * asymmetry exactly: the ₹50,00,000 reference is "income-tax on a total income
 * of fifty lakh rupees" with NO surcharge term (surcharge is nil at exactly
 * ₹50,00,000), while the ₹1,00,00,000 reference is "income-tax AND surcharge on
 * a total income of one crore rupees" — and at exactly ₹1,00,00,000 the
 * applicable rate is the 10% band's, not the 15% band's.
 */
function referenceSurchargeOn(
  schedule: SurchargeSchedule,
  threshold: number,
  referenceTax: number,
): number {
  const band = bandFor(schedule, threshold);
  return band ? band.rate * referenceTax : 0;
}

export function computeSurcharge(input: SurchargeInput): SurchargeTreatment {
  const { totalIncome, incomeTaxBeforeSurcharge, specialRateIncome, slabs, schedule } = input;

  const nil = (state: SurchargeSupportState, message: string): SurchargeTreatment => ({
    state,
    supported: state === "not_applicable",
    totalIncome,
    rate: 0,
    surchargeBeforeRelief: 0,
    marginalRelief: 0,
    surcharge: 0,
    marginalReliefThreshold: null,
    marginalReliefProvedNilUnderEveryReading: false,
    message,
  });

  if (!Number.isFinite(totalIncome) || totalIncome <= schedule.entryThreshold) {
    return nil(
      "not_applicable",
      `Total income ₹${Math.max(0, Math.round(totalIncome || 0))} does not exceed the ₹${schedule.entryThreshold} ` +
        "surcharge entry threshold, so surcharge is nil as a matter of law (Finance Act 2025, First " +
        "Schedule Part III). This ₹0 is a computed nil, not an unimplemented placeholder.",
    );
  }

  if (totalIncome > schedule.supportedTotalIncomeCeiling) {
    return nil(
      "unsupported_above_ceiling",
      `Total income ₹${Math.round(totalIncome)} exceeds ₹${schedule.supportedTotalIncomeCeiling}, where the ` +
        "25%/37% surcharge tiers engage and the 15% cap on dividend / 111A / 112 / 112A income becomes " +
        "binding. Apportioning income-tax to those components — and the band test on total income " +
        "EXCLUDING them — are NOT modelled, so NO surcharge is computed for this case and it stays " +
        "reliance-blocked. ₹0 here is not a nil surcharge (CA-verify).",
    );
  }

  const band = bandFor(schedule, totalIncome);
  // Unreachable while the declared bands actually cover
  // `(entryThreshold, supportedTotalIncomeCeiling]` — which is exactly what
  // `describeSurchargeBandCoverage` asserts. Since AUDIT-05-F3 this is a REAL
  // guard rather than a formality: `surchargeBandFor` now honours each band's
  // `upTo`, so a table that stops short of the ceiling (or leaves a hole)
  // arrives here and refuses, instead of silently extending the top band's rate
  // over income the table never claimed.
  if (!band) {
    return nil(
      "unsupported_above_ceiling",
      `No surcharge band covers a total income of ₹${Math.round(totalIncome)} — the band table and the ` +
        "supported window disagree, so no figure is computed (CA-verify).",
    );
  }

  // The PROOF that the 15% proviso is non-binding inside this window. It is
  // asserted here against the declared rates rather than left to the module
  // doc, so a future session that widens a schedule's bands without widening the
  // apportionment logic fails loudly instead of silently over-charging the
  // special-rate part.
  if (band.rate > schedule.specialRateSurchargeRateCap) {
    return nil(
      "unsupported_above_ceiling",
      `The applicable surcharge rate (${band.rate * 100}%) exceeds the ${schedule.specialRateSurchargeRateCap * 100}% ` +
        "cap on dividend / 111A / 112 / 112A income, so income-tax would have to be apportioned between " +
        "the capped and uncapped parts — which is not modelled. No surcharge is computed (CA-verify).",
    );
  }

  const surchargeBeforeRelief = band.rate * incomeTaxBeforeSurcharge;
  const threshold = band.exceeding;
  const excess = totalIncome - threshold;

  const settled = (
    marginalRelief: number,
    provedNil: boolean,
    extra: string,
  ): SurchargeTreatment => ({
    state: "computed",
    supported: true,
    totalIncome,
    rate: band.rate,
    surchargeBeforeRelief,
    marginalRelief,
    surcharge: Math.max(0, surchargeBeforeRelief - marginalRelief),
    marginalReliefThreshold: threshold,
    marginalReliefProvedNilUnderEveryReading: provedNil,
    message:
      `Surcharge at ${band.rate * 100}% of income-tax ₹${Math.round(incomeTaxBeforeSurcharge)} ` +
      `(total income ₹${Math.round(totalIncome)} exceeds ₹${threshold}). ` +
      extra,
  });

  if (specialRateIncome <= 0) {
    // Unambiguous: every rupee of the notional reference income is slab income.
    const referenceTax = unambiguousReferenceTax(threshold, slabs);
    const referenceSurcharge = referenceSurchargeOn(schedule, threshold, referenceTax);
    const relief = Math.max(
      0,
      incomeTaxBeforeSurcharge + surchargeBeforeRelief - (referenceTax + referenceSurcharge + excess),
    );
    return settled(
      relief,
      false,
      relief > 0
        ? `Marginal relief ₹${Math.round(relief)} applied: income-tax plus surcharge may not exceed ` +
          `income-tax${referenceSurcharge > 0 ? " and surcharge" : ""} on a total income of ₹${threshold} ` +
          `(₹${Math.round(referenceTax + referenceSurcharge)}) by more than the ₹${Math.round(excess)} of income ` +
          "that exceeds it."
        : `Marginal relief is nil — income-tax plus surcharge does not exceed income-tax` +
          `${referenceSurcharge > 0 ? " and surcharge" : ""} on a total income of ₹${threshold} by more than ` +
          `the ₹${Math.round(excess)} of income that exceeds it.`,
    );
  }

  // Ambiguous reference composition. Bound the relief from ABOVE by bounding
  // the reference tax from BELOW: removing `excess` rupees of income from the
  // actual composition cannot reduce income-tax by more than `maxRate × excess`,
  // whichever component those rupees are taken from. A lower reference tax also
  // means a lower reference surcharge, so using the bound for both yields the
  // LARGEST relief any lawful reading could produce.
  const maxRate = maxMarginalRateFor(slabs);
  const referenceTaxLowerBound = Math.max(0, incomeTaxBeforeSurcharge - maxRate * excess);
  const referenceSurchargeLowerBound = referenceSurchargeOn(
    schedule,
    threshold,
    referenceTaxLowerBound,
  );
  const reliefUpperBound =
    incomeTaxBeforeSurcharge +
    surchargeBeforeRelief -
    (referenceTaxLowerBound + referenceSurchargeLowerBound + excess);

  if (reliefUpperBound <= 0) {
    return settled(
      0,
      true,
      "Marginal relief is nil. This case mixes slab income with special-rate 111A/112A gains, so the " +
        `notional "total income of ₹${threshold}" the relief is measured against has no single composition ` +
        "the statute fixes — but relief is nil under EVERY lawful reading of it (proved by bounding the " +
        `reference income-tax from below at ₹${Math.round(referenceTaxLowerBound)}, using the highest ` +
        `marginal rate in play, ${Math.round(maxRate * 100)}%). No composition was assumed.`,
    );
  }

  return {
    state: "unsupported_marginal_relief_reference_ambiguous",
    supported: false,
    totalIncome,
    rate: band.rate,
    surchargeBeforeRelief,
    marginalRelief: 0,
    // GROSS of relief — never understated. Still unsupported: a figure that is
    // merely "not too low" is not a correct figure.
    surcharge: surchargeBeforeRelief,
    marginalReliefThreshold: threshold,
    marginalReliefProvedNilUnderEveryReading: false,
    message:
      `Surcharge at ${band.rate * 100}% of income-tax ₹${Math.round(incomeTaxBeforeSurcharge)} is shown GROSS of ` +
      "marginal relief, and this case is NOT reliance-ready. Marginal relief may be due (up to about " +
      `₹${Math.round(reliefUpperBound)}), but this case mixes slab income with special-rate 111A/112A gains and ` +
      `the statute does not fix how the notional "total income of ₹${threshold}" it is measured against is ` +
      "composed. Reducing the slab part, the special-rate part, or both proportionally give different " +
      "reliefs, and no located source resolves it — so no composition was assumed and no relief was " +
      "applied. A professional must compute the relief manually (CA-verify).",
  };
}
