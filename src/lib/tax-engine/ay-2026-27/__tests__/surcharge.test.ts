/**
 * K4-11 — surcharge and marginal relief.
 *
 * The arithmetic here is small; the load-bearing part is WHERE IT STOPS. Two
 * boundaries are proved rather than asserted, in the `D95`/`D117` style this
 * repository already uses for the loss-set-off windows:
 *
 *   1. the 15% proviso on dividend / 111A / 112 / 112A income is non-binding at
 *      every declared band rate — which is why no apportionment is needed
 *      inside the window; and
 *   2. the marginal-relief "provably nil" bound is SOUND (it never claims nil
 *      when some lawful reference composition would give relief) and NOT
 *      VACUOUS (there really are cases it refuses, and they really do disagree
 *      across compositions).
 */

import { describe, expect, it } from "vitest";

import { CAPITAL_GAINS, SURCHARGE } from "../rules";
import { applySlabTax, NEW_REGIME_SLABS, OLD_REGIME_SLABS } from "../slabs";
import {
  computeSurcharge,
  describeSurchargeBandCoverage,
  maxMarginalRateFor,
  surchargeBandFor,
  type SurchargeInput,
} from "../surcharge";
import { AY_2026_27_COMPUTATION_FIGURES as FIGURES } from "../rate-figures";

/**
 * `K4-PORT-03`: the schedule is now an INPUT rather than a module constant, so
 * every call site names the world whose rates it is asserting about. The
 * expected values are unchanged — `SCHEDULE` is `SURCHARGE` by reference.
 */
const SCHEDULE = FIGURES.surcharge;

const NEW = NEW_REGIME_SLABS;
const OLD = OLD_REGIME_SLABS;

/** Slab-only case: income-tax is just the slab tax on the whole total income. */
function slabOnly(totalIncome: number, slabs = NEW): SurchargeInput {
  return {
    totalIncome,
    incomeTaxBeforeSurcharge: applySlabTax(totalIncome, slabs),
    specialRateIncome: 0,
    slabs,
    schedule: SCHEDULE,
  };
}

describe("declared bands and the window they define", () => {
  it("declares ONLY the two tiers the engine implements — the 25%/37% tiers are absent, not present-but-unused", () => {
    expect(SURCHARGE.bands.map((b) => b.rate)).toEqual([0.1, 0.15]);
    expect(SURCHARGE.bands.map((b) => b.exceeding)).toEqual([50_00_000, 1_00_00_000]);
    expect(SURCHARGE.entryThreshold).toBe(50_00_000);
    expect(SURCHARGE.supportedTotalIncomeCeiling).toBe(2_00_00_000);
  });

  // THE proof the whole window rests on. If a future session adds the 25% or
  // 37% tier without also implementing the apportionment the proviso then
  // requires, this fails.
  it("every declared band rate is at or below the 15% cap on dividend / 111A / 112 / 112A income — so the proviso is provably NON-BINDING inside the window", () => {
    for (const band of SURCHARGE.bands) {
      expect(band.rate).toBeLessThanOrEqual(SURCHARGE.specialRateSurchargeRateCap);
    }
  });

  // AUDIT-05-F3. The engine's refusal above the ceiling and its computation
  // below it are only honest if the declared bands actually cover
  // `(entryThreshold, supportedTotalIncomeCeiling]`. That was previously an
  // unchecked prose claim in two module docs; it is now derived and asserted,
  // so widening one without the other fails here.
  it("declared band coverage is EXACTLY the supported window — contiguous, starting at the entry threshold, ending at the ceiling", () => {
    const coverage = describeSurchargeBandCoverage(SCHEDULE);
    expect(coverage).toEqual({
      ascending: true,
      contiguous: true,
      startsAtEntryThreshold: true,
      endsAtSupportedCeiling: true,
      everyRateWithinSpecialRateCap: true,
      highestCoveredIncome: SURCHARGE.supportedTotalIncomeCeiling,
    });
    // Stated as the equality it is, not only as a boolean: the highest income
    // any band covers IS the highest income the engine claims to support.
    expect(coverage.highestCoveredIncome).toBe(SURCHARGE.supportedTotalIncomeCeiling);
    expect(SURCHARGE.bands[0].exceeding).toBe(SURCHARGE.entryThreshold);
  });

  it("band selection honours each band's `upTo`, not just its floor (AUDIT-05-F3)", () => {
    // Below and at the entry threshold: no band at all.
    expect(surchargeBandFor(SCHEDULE, 50_00_000)).toBeNull();
    // Inside each band, at both edges.
    expect(surchargeBandFor(SCHEDULE, 50_00_001)?.rate).toBe(0.1);
    expect(surchargeBandFor(SCHEDULE, 1_00_00_000)?.rate).toBe(0.1);
    expect(surchargeBandFor(SCHEDULE, 1_00_00_001)?.rate).toBe(0.15);
    expect(surchargeBandFor(SCHEDULE, 2_00_00_000)?.rate).toBe(0.15);
    // ABOVE the top band's `upTo` there is NO band. Under the pre-F3 selector
    // this returned the 15% band — the declared upper bound was decorative and
    // the top rate extended indefinitely upward.
    expect(surchargeBandFor(SCHEDULE, 2_00_00_001)).toBeNull();
    expect(surchargeBandFor(SCHEDULE, 50_00_00_000)).toBeNull();
  });

  it("derives the highest marginal rate from the live slab tables and special rates, not a literal", () => {
    expect(maxMarginalRateFor(NEW)).toBe(0.3);
    expect(maxMarginalRateFor(OLD)).toBe(0.3);
    // The special rates are genuinely in the max, not ignored.
    expect(maxMarginalRateFor([{ from: 0, to: Infinity, rate: 0.05 }])).toBe(
      Math.max(CAPITAL_GAINS.stcg111aRate, CAPITAL_GAINS.ltcg112aRate),
    );
  });
});

describe("the entry threshold is strict (TAX-SAFE-01A)", () => {
  it("is a COMPUTED nil at and below ₹50,00,000 — not an unimplemented placeholder", () => {
    for (const income of [0, 12_00_000, 49_99_999, 50_00_000]) {
      const r = computeSurcharge(slabOnly(income));
      expect(r.state, `₹${income}`).toBe("not_applicable");
      expect(r.supported).toBe(true);
      expect(r.surcharge).toBe(0);
      expect(r.message).toMatch(/computed nil, not an unimplemented placeholder/);
    }
  });

  it("engages one rupee above the threshold", () => {
    const r = computeSurcharge(slabOnly(50_00_001));
    expect(r.state).toBe("computed");
    expect(r.rate).toBe(0.1);
  });
});

describe("band selection", () => {
  it("uses 10% up to and including ₹1,00,00,000, then 15%", () => {
    expect(computeSurcharge(slabOnly(1_00_00_000)).rate).toBe(0.1);
    expect(computeSurcharge(slabOnly(1_00_00_001)).rate).toBe(0.15);
    expect(computeSurcharge(slabOnly(1_99_99_999)).rate).toBe(0.15);
  });

  it("computes AT the ceiling and refuses one rupee above it", () => {
    const at = computeSurcharge(slabOnly(2_00_00_000));
    expect(at.state).toBe("computed");
    expect(at.supported).toBe(true);

    const above = computeSurcharge(slabOnly(2_00_00_001));
    expect(above.state).toBe("unsupported_above_ceiling");
    expect(above.supported).toBe(false);
    // Never a best-guess figure, and never a ₹0 that reads as a nil.
    expect(above.surcharge).toBe(0);
    expect(above.message).toMatch(/not a nil surcharge/);
  });
});

describe("marginal relief — exact, where the reference income is unambiguous", () => {
  // The same arithmetic the seeded golden fixture pins, re-derived here from
  // the statute's own wording rather than from the engine's output.
  it("caps tax+surcharge at (tax on ₹50,00,000) + excess, exactly", () => {
    const totalIncome = 51_25_000;
    const r = computeSurcharge(slabOnly(totalIncome));
    const referenceTax = applySlabTax(50_00_000, NEW);

    expect(r.marginalRelief).toBe(24_250);
    expect(r.surcharge).toBe(87_500);
    // The statutory statement itself, restated as an equality.
    expect(applySlabTax(totalIncome, NEW) + r.surcharge).toBe(referenceTax + (totalIncome - 50_00_000));
  });

  it("reproduces the statute's ASYMMETRY: the ₹50,00,000 reference carries no surcharge term, the ₹1,00,00,000 reference does", () => {
    const below = computeSurcharge(slabOnly(51_25_000));
    expect(below.marginalReliefThreshold).toBe(50_00_000);
    expect(below.message).not.toMatch(/income-tax and surcharge on a total income/);

    const above = computeSurcharge(slabOnly(1_01_00_000));
    expect(above.marginalReliefThreshold).toBe(1_00_00_000);
    // At ₹1,00,00,000 the reference itself bears surcharge, at the 10% band's
    // rate (₹1,00,00,000 does not EXCEED ₹1,00,00,000, so the 15% band does not
    // apply to the reference).
    const refTax = applySlabTax(1_00_00_000, NEW);
    const expectedRelief = Math.max(
      0,
      applySlabTax(1_01_00_000, NEW) +
        0.15 * applySlabTax(1_01_00_000, NEW) -
        (refTax + 0.1 * refTax + 1_00_000),
    );
    expect(above.marginalRelief).toBe(expectedRelief);
    expect(above.marginalRelief).toBeGreaterThan(0);
  });

  it("is nil once the excess income is large enough to absorb the surcharge", () => {
    const r = computeSurcharge(slabOnly(80_00_000));
    expect(r.state).toBe("computed");
    expect(r.marginalRelief).toBe(0);
    expect(r.surcharge).toBe(r.surchargeBeforeRelief);
    expect(r.marginalReliefProvedNilUnderEveryReading).toBe(false); // computed exactly, not bounded
  });

  it("relief never exceeds the surcharge itself — the charge floors at zero, never negative", () => {
    for (let income = 50_00_001; income <= 52_50_000; income += 7_331) {
      const r = computeSurcharge(slabOnly(income));
      expect(r.surcharge, `₹${income}`).toBeGreaterThanOrEqual(0);
      expect(r.marginalRelief).toBeLessThanOrEqual(r.surchargeBeforeRelief);
    }
  });
});

// ---------------------------------------------------------------------------
// The ambiguous case, proved both ways
// ---------------------------------------------------------------------------

/**
 * Income-tax on a NOTIONAL total income of `threshold`, for ONE admissible
 * composition: `special` rupees of it are 112A gains (taxed at 12.5% above the
 * ₹1,25,000 exemption) and the rest is slab income. This is the reading the
 * statute does not fix — the whole point of the refusal.
 */
function referenceTaxForComposition(threshold: number, special: number, slabs: readonly { from: number; to: number; rate: number }[]): number {
  const normal = threshold - special;
  const specialTax = Math.max(0, special - CAPITAL_GAINS.ltcg112aExemption) * CAPITAL_GAINS.ltcg112aRate;
  return applySlabTax(normal, slabs) + specialTax;
}

/** Every admissible composition of the notional reference income, swept. */
function reliefsAcrossCompositions(input: SurchargeInput, threshold: number): number[] {
  const normal = input.totalIncome - input.specialRateIncome;
  const excess = input.totalIncome - threshold;
  const surcharge = (rate: number, tax: number) => rate * tax;
  const band = input.totalIncome > 1_00_00_000 ? 0.15 : 0.1;
  const referenceBand = threshold > 50_00_000 ? 0.1 : 0;

  const lo = Math.max(0, threshold - normal);
  const hi = Math.min(input.specialRateIncome, threshold);
  const out: number[] = [];
  const steps = 200;
  for (let i = 0; i <= steps; i += 1) {
    const special = lo + ((hi - lo) * i) / steps;
    const refTax = referenceTaxForComposition(threshold, special, input.slabs);
    const refTotal = refTax + surcharge(referenceBand, refTax);
    out.push(
      Math.max(
        0,
        input.incomeTaxBeforeSurcharge + surcharge(band, input.incomeTaxBeforeSurcharge) - (refTotal + excess),
      ),
    );
  }
  return out;
}

/** A mixed case: slab income plus a 112A gain, at a given total income. */
function mixed(totalIncome: number, special: number, slabs = NEW): SurchargeInput {
  const normal = totalIncome - special;
  const specialTax = Math.max(0, special - CAPITAL_GAINS.ltcg112aExemption) * CAPITAL_GAINS.ltcg112aRate;
  return {
    totalIncome,
    incomeTaxBeforeSurcharge: applySlabTax(normal, slabs) + specialTax,
    specialRateIncome: special,
    slabs,
    schedule: SCHEDULE,
  };
}

describe("marginal relief — the ambiguous reference composition is refused, never guessed", () => {
  it("SOUNDNESS: wherever the engine claims relief is nil on a mixed case, it IS nil under every admissible composition", () => {
    let provedNilCases = 0;
    for (let totalIncome = 50_50_000; totalIncome <= 1_60_00_000; totalIncome += 3_70_000) {
      for (const special of [2_00_000, 10_00_000, 30_00_000]) {
        if (special >= totalIncome) continue;
        const input = mixed(totalIncome, special);
        const r = computeSurcharge(input);
        if (r.state !== "computed" || !r.marginalReliefProvedNilUnderEveryReading) continue;
        provedNilCases += 1;
        const threshold = r.marginalReliefThreshold!;
        for (const relief of reliefsAcrossCompositions(input, threshold)) {
          // Tolerance is a rupee: the sweep re-derives the reference tax
          // independently and both sides round differently.
          expect(relief, `₹${totalIncome} / special ₹${special}`).toBeLessThanOrEqual(1);
        }
      }
    }
    // The claim must not be vacuously satisfied by there being no such cases.
    expect(provedNilCases).toBeGreaterThan(20);
  });

  it("NON-VACUITY: the cases it refuses genuinely DISAGREE across compositions — the refusal is a real constraint", () => {
    // Just above the threshold with a substantial 112A gain: relief is real,
    // and its amount depends on which reading of the reference income is taken.
    const input = mixed(51_00_000, 20_00_000);
    const r = computeSurcharge(input);
    expect(r.state).toBe("unsupported_marginal_relief_reference_ambiguous");
    expect(r.supported).toBe(false);

    const reliefs = reliefsAcrossCompositions(input, 50_00_000);
    const distinct = new Set(reliefs.map((x) => Math.round(x)));
    expect(distinct.size).toBeGreaterThan(1); // the readings really do differ
    expect(Math.max(...reliefs)).toBeGreaterThan(0);
  });

  it("a refused case reports surcharge GROSS of relief — never understated — and says so", () => {
    const input = mixed(51_00_000, 20_00_000);
    const r = computeSurcharge(input);
    expect(r.surcharge).toBe(r.surchargeBeforeRelief);
    expect(r.marginalRelief).toBe(0);
    expect(r.message).toMatch(/GROSS of/);
    expect(r.message).toMatch(/no composition was assumed/i);
  });

  it("a mixed case far above the relief zone is still COMPUTED — the refusal is narrow, not a blanket ban on capital gains", () => {
    const r = computeSurcharge(mixed(1_50_00_000, 40_00_000));
    expect(r.state).toBe("computed");
    expect(r.supported).toBe(true);
    expect(r.marginalRelief).toBe(0);
    expect(r.marginalReliefProvedNilUnderEveryReading).toBe(true);
    expect(r.surcharge).toBeGreaterThan(0);
  });

  it("a mixed case above the ceiling is refused for the CEILING reason, not the ambiguity one", () => {
    const r = computeSurcharge(mixed(2_20_00_000, 40_00_000));
    expect(r.state).toBe("unsupported_above_ceiling");
    expect(r.surcharge).toBe(0);
  });
});

describe("both regimes' slab tables are handled, and neither is assumed", () => {
  it("computes a different relief under the old regime's slabs for the same total income", () => {
    const income = 51_50_000;
    const newRegime = computeSurcharge(slabOnly(income, NEW));
    const oldRegime = computeSurcharge(slabOnly(income, OLD));
    expect(newRegime.marginalRelief).not.toBe(oldRegime.marginalRelief);
    for (const r of [newRegime, oldRegime]) {
      expect(r.state).toBe("computed");
      expect(r.rate).toBe(0.1);
    }
    // The old regime's reference tax is the OLD table's, not the new one's.
    expect(applySlabTax(income, OLD) + oldRegime.surcharge).toBe(
      applySlabTax(50_00_000, OLD) + (income - 50_00_000),
    );
  });
});
