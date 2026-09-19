/**
 * K4-12 — Section 87A rebate + rebate-threshold marginal relief.
 *
 * These tests carry the load for a change no existing golden fixture exercises:
 * the full suite passed 1276/1276 UNCHANGED immediately after the engine edit
 * and before this file existed, which proved the change moved nothing that was
 * already covered — and equally proved that nothing already covered the new
 * window. Everything asserted here is new ground.
 */

import { describe, expect, it } from "vitest";

import { computeTax } from "../compute-tax";
import {
  REBATE_RELIEF_WINDOW_UPPER_INR,
  computeRebate87A,
  rebateReliefUpperIncomeBound,
} from "../rebate-relief";
import { AY_2026_27_COMPUTATION_FIGURES as FIGURES } from "../rate-figures";
import { REBATE_87A, SURCHARGE } from "../rules";
import { NEW_REGIME_SLABS, OLD_REGIME_SLABS, applySlabTax } from "../slabs";
import type { TaxEngineInput } from "../types";

/**
 * `K4-PORT-03`: the rebate schedule is now an INPUT rather than a module
 * constant. `SCHEDULE` is `REBATE_87A` by reference, so every expected value
 * below is unchanged.
 */
const SCHEDULE = FIGURES.rebate;

const newCase = (over: {
  totalIncome: number;
  slabTax?: number;
  specialRateTax?: number;
  specialRateIncome?: number;
}) =>
  computeRebate87A({
    regime: "new",
    totalIncome: over.totalIncome,
    slabTax: over.slabTax ?? applySlabTax(over.totalIncome, NEW_REGIME_SLABS),
    specialRateTax: over.specialRateTax ?? 0,
    specialRateIncome: over.specialRateIncome ?? 0,
    schedule: SCHEDULE,
  });

describe("computeRebate87A — clause (a), at or below the ceiling", () => {
  it("allows the ordinary rebate under the new regime", () => {
    const t = newCase({ totalIncome: 11_00_000 });
    expect(t.state).toBe("ordinary_rebate");
    expect(t.supported).toBe(true);
    expect(t.ordinaryRebate).toBe(50_000); // min(slab tax 50,000, 60,000)
    expect(t.marginalRelief).toBe(0);
    expect(t.rebate).toBe(50_000);
  });

  it("caps the ordinary rebate at the statutory maximum", () => {
    const t = newCase({ totalIncome: 12_00_000 });
    expect(t.ordinaryRebate).toBe(REBATE_87A.new.maxRebate);
    expect(t.rebate).toBe(60_000);
  });

  it("treats EXACTLY the ceiling as clause (a), not clause (b)", () => {
    // "does not exceed" is inclusive — the boundary belongs to the ordinary
    // rebate. The same strict-vs-inclusive care TAX-SAFE-01A applied to the
    // surcharge threshold, applied here in the opposite direction.
    const t = newCase({ totalIncome: REBATE_87A.new.incomeLimit });
    expect(t.state).toBe("ordinary_rebate");
    expect(newCase({ totalIncome: REBATE_87A.new.incomeLimit + 1 }).state).toBe("relief_computed");
  });

  it("allows the old-regime ordinary rebate at or below its own ceiling", () => {
    const t = computeRebate87A({
      regime: "old",
      totalIncome: 4_90_000,
      slabTax: applySlabTax(4_90_000, OLD_REGIME_SLABS),
      specialRateTax: 0,
      specialRateIncome: 0,
      schedule: SCHEDULE,
    });
    expect(t.state).toBe("ordinary_rebate");
    // Slab tax on ₹4,90,000 is 5% x ₹2,40,000 = ₹12,000, which is BELOW the
    // ₹12,500 statutory maximum — so the rebate is the tax, not the cap.
    expect(t.rebate).toBe(12_000);
    expect(t.rebate).toBeLessThanOrEqual(REBATE_87A.old.maxRebate);
  });
});

describe("computeRebate87A — the regimes are NOT symmetric", () => {
  it("gives the OLD regime no relief above its ceiling: the cliff is real and is a computed nil", () => {
    const t = computeRebate87A({
      regime: "old",
      totalIncome: 5_00_001,
      slabTax: applySlabTax(5_00_001, OLD_REGIME_SLABS),
      specialRateTax: 0,
      specialRateIncome: 0,
      schedule: SCHEDULE,
    });
    expect(t.state).toBe("not_applicable");
    // SUPPORTED — this ₹0 is the law, not a gap. Marking it unsupported would
    // newly reliance-block essentially every old-regime case above ₹5,00,000.
    expect(t.supported).toBe(true);
    expect(t.marginalRelief).toBe(0);
    expect(t.rebate).toBe(0);
    expect(t.message).toContain("115BAC(1A)");
  });

  it("records the asymmetry as data, not prose", () => {
    expect(REBATE_87A.new.marginalReliefAvailable).toBe(true);
    expect(REBATE_87A.old.marginalReliefAvailable).toBe(false);
    expect(rebateReliefUpperIncomeBound(SCHEDULE, "old", OLD_REGIME_SLABS)).toBeNull();
  });
});

describe("computeRebate87A — clause (b) marginal relief", () => {
  it("computes relief exactly just above the ceiling", () => {
    const t = newCase({ totalIncome: 12_20_000 });
    // slab tax 63,000; excess 20,000; relief = 43,000
    expect(t.state).toBe("relief_computed");
    expect(t.supported).toBe(true);
    expect(t.marginalRelief).toBe(43_000);
    expect(t.rebate).toBe(43_000);
    expect(t.ordinaryRebate).toBe(0);
  });

  it("leaves income-tax equal to EXACTLY the excess over the ceiling — the whole point of the relief", () => {
    for (const totalIncome of [12_00_001, 12_10_000, 12_20_000, 12_50_000]) {
      const slabTax = applySlabTax(totalIncome, NEW_REGIME_SLABS);
      const t = newCase({ totalIncome });
      expect(slabTax - t.rebate).toBeCloseTo(totalIncome - REBATE_87A.new.incomeLimit, 6);
    }
  });

  it("never allows a deduction exceeding the slab tax (the second proviso's cap)", () => {
    for (let ti = 12_00_001; ti <= 13_00_000; ti += 4_999) {
      const t = newCase({ totalIncome: ti });
      expect(t.rebate).toBeLessThanOrEqual(applySlabTax(ti, NEW_REGIME_SLABS) + 1e-9);
      expect(t.marginalRelief).toBeGreaterThanOrEqual(0);
    }
  });

  it("tapers to nothing at the derived bound and stays nil above it", () => {
    const bound = rebateReliefUpperIncomeBound(SCHEDULE, "new", NEW_REGIME_SLABS) as number;
    expect(newCase({ totalIncome: bound - 1 }).marginalRelief).toBeGreaterThan(0);
    expect(newCase({ totalIncome: bound + 1 }).marginalRelief).toBe(0);
    const above = newCase({ totalIncome: 20_00_000 });
    expect(above.state).toBe("not_applicable");
    expect(above.supported).toBe(true);
    expect(above.rebate).toBe(0);
  });

  it("keeps rebate = ordinaryRebate + marginalRelief, with the two mutually exclusive", () => {
    for (const ti of [5_00_000, 11_00_000, 12_00_000, 12_20_000, 12_70_000, 30_00_000]) {
      const t = newCase({ totalIncome: ti });
      expect(t.rebate).toBeCloseTo(t.ordinaryRebate + t.marginalRelief, 9);
      expect(Math.min(t.ordinaryRebate, t.marginalRelief)).toBe(0);
    }
  });
});

describe("computeRebate87A — the refused ambiguity", () => {
  it("REFUSES a case in the relief window carrying special-rate income", () => {
    // Salary-derived slab income ₹11,00,000 + ₹1,20,000 of 112A gain, all of it
    // inside the ₹1,25,000 exemption, so the special-rate TAX is nil while the
    // special-rate INCOME is not. The refusal must still bite: the open
    // question is whether the deduction is available at all.
    const t = newCase({
      totalIncome: 12_20_000,
      slabTax: 50_000,
      specialRateTax: 0,
      specialRateIncome: 1_20_000,
    });
    expect(t.state).toBe("unsupported_special_rate_income_present");
    expect(t.supported).toBe(false);
    // Relief is ZERO, never a guess — the tax is never understated.
    expect(t.marginalRelief).toBe(0);
    expect(t.rebate).toBe(0);
    expect(t.reliefProvedNilUnderEveryReading).toBe(false);
  });

  it("triggers on the PRESENCE of special-rate income, not on a non-zero special-rate tax", () => {
    const withTax = newCase({ totalIncome: 12_20_000, slabTax: 50_000, specialRateTax: 9_000, specialRateIncome: 60_000 });
    const withoutTax = newCase({ totalIncome: 12_20_000, slabTax: 50_000, specialRateTax: 0, specialRateIncome: 60_000 });
    expect(withTax.supported).toBe(false);
    expect(withoutTax.supported).toBe(false);
  });

  it("allows a PROVED nil where no lawful reading could produce relief", () => {
    const t = newCase({
      totalIncome: 20_00_000,
      slabTax: 1_60_000,
      specialRateTax: 20_000,
      specialRateIncome: 2_00_000,
    });
    // excess 8,00,000 exceeds the whole income-tax, so relief is nil under the
    // LARGEST reading and therefore under every reading.
    expect(t.state).toBe("not_applicable");
    expect(t.supported).toBe(true);
    expect(t.reliefProvedNilUnderEveryReading).toBe(true);
    expect(t.marginalRelief).toBe(0);
  });

  it("distinguishes a proved nil from an ordinary nil", () => {
    expect(newCase({ totalIncome: 20_00_000 }).reliefProvedNilUnderEveryReading).toBe(false);
  });

  it("refuses an indeterminate total income rather than assuming one", () => {
    const t = newCase({ totalIncome: Number.NaN, slabTax: 0 });
    expect(t.state).toBe("unsupported_total_income_indeterminate");
    expect(t.supported).toBe(false);
    expect(t.rebate).toBe(0);
  });
});

describe("rebateReliefUpperIncomeBound — the structural non-interaction proof", () => {
  it("derives the bound from the slab table rather than restating it", () => {
    const bound = rebateReliefUpperIncomeBound(SCHEDULE, "new", NEW_REGIME_SLABS) as number;
    // 60,000 = 0.85 x excess  ->  excess = 70,588.23...
    expect(bound).toBeCloseTo(12_00_000 + 60_000 / 0.85, 6);
    // and it is a real crossing: slab tax equals the excess there.
    expect(applySlabTax(bound, NEW_REGIME_SLABS)).toBeCloseTo(bound - REBATE_87A.new.incomeLimit, 6);
  });

  it("PROVES 87A relief and surcharge can never both be live for one case", () => {
    // This is the reason K4-12 adds nothing to SURCHARGE_DEPENDENT_FIGURE_IDS
    // and touches no surcharge code: the two windows are disjoint by three
    // orders of magnitude, and that is asserted rather than asserted-in-prose.
    const bound = rebateReliefUpperIncomeBound(SCHEDULE, "new", NEW_REGIME_SLABS) as number;
    expect(bound).toBeLessThan(SURCHARGE.entryThreshold);
  });

  it("pins the integer window bound the SQL blocker compares against", () => {
    const bound = rebateReliefUpperIncomeBound(SCHEDULE, "new", NEW_REGIME_SLABS) as number;
    // Rounded UP — widening the window a blocker examines is the safe
    // direction; narrowing it below a real relief is not.
    expect(REBATE_RELIEF_WINDOW_UPPER_INR).toBeGreaterThanOrEqual(bound);
    expect(REBATE_RELIEF_WINDOW_UPPER_INR - bound).toBeLessThan(1);
  });
});

describe("computeTax — the relief reaches the real computation", () => {
  const caseWithTotalIncome = (salary: number, ltcg?: number): TaxEngineInput => ({
    assessmentYear: "2026-27",
    financialYear: "2025-26",
    taxpayer: { residentStatus: "resident", ageCategory: "below_60" },
    selectedItrType: "ITR-1",
    clientApprovalStatus: "pending",
    filingStatus: "in_preparation",
    eVerificationStatus: "not_applicable",
    finalized: false,
    requiredDocuments: [],
    income: [{ id: "inc_1", category: "salary", amount: salary, sourceType: "Form16", sourceDocumentId: "d1" }],
    taxPaid: [],
    deductions: [],
    capitalGains: ltcg
      ? [
          {
            id: "cg_1",
            category: "ltcg_112a",
            amount: ltcg,
            taxable_gain: ltcg,
            sourceType: "broker_report",
            source_document_id: "d2",
          },
        ]
      : [],
    sourceRecordIds: ["r1"],
  });

  it("applies relief to a new-regime case inside the window", () => {
    // salary 12,95,000 - 75,000 standard deduction = 12,20,000 total income
    const out = computeTax(caseWithTotalIncome(12_95_000));
    const nw = out.newRegime;
    expect(nw.totalIncome.value).toBe(12_20_000);
    expect(nw.rebateTreatment.state).toBe("relief_computed");
    expect(nw.rebate.value).toBe(43_000);
    expect(nw.rebateMarginalRelief.value).toBe(43_000);
    // Income-tax after the rebate is exactly the ₹20,000 of income above the
    // ceiling; cess follows it.
    expect(nw.grossTaxLiability.value).toBe(20_800);
    expect(out.rebateReliefTreatmentSupported).toBe(true);
  });

  it("leaves the OLD regime's own figures untouched by the relief", () => {
    const out = computeTax(caseWithTotalIncome(12_95_000));
    expect(out.oldRegime.rebateTreatment.state).toBe("not_applicable");
    expect(out.oldRegime.rebateMarginalRelief.value).toBe(0);
    expect(out.oldRegime.rebate.value).toBe(0);
  });

  it("reports the case UNSUPPORTED when special-rate income enters the window", () => {
    // salary 11,75,000 - 75,000 = 11,00,000 slab income, plus 1,20,000 of 112A
    // gain -> total income 12,20,000, inside the window, ambiguous.
    const out = computeTax(caseWithTotalIncome(11_75_000, 1_20_000));
    expect(out.newRegime.totalIncome.value).toBe(12_20_000);
    expect(out.newRegime.rebateTreatment.state).toBe("unsupported_special_rate_income_present");
    expect(out.newRegime.rebate.value).toBe(0);
    expect(out.rebateReliefTreatmentSupported).toBe(false);
  });

  it("keeps an ordinary sub-ceiling case supported and unchanged in shape", () => {
    const out = computeTax(caseWithTotalIncome(8_75_000));
    expect(out.newRegime.totalIncome.value).toBe(8_00_000);
    expect(out.newRegime.rebateTreatment.state).toBe("ordinary_rebate");
    expect(out.newRegime.rebateMarginalRelief.value).toBe(0);
    expect(out.rebateReliefTreatmentSupported).toBe(true);
  });
});
