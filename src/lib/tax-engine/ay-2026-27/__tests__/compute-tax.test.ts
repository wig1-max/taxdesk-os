import { describe, expect, it } from "vitest";
import { computeBusinessBooksIncome, computeHouseProperty, computeTax } from "../compute-tax";
import { simpleSalariedRefundCase } from "../fixtures";
import type { BusinessBooksEntry, HousePropertyEntry, TaxEngineInput } from "../types";

/** Minimal input builder — override only what a test cares about. */
function makeInput(overrides: Partial<TaxEngineInput> = {}): TaxEngineInput {
  return {
    assessmentYear: "2026-27",
    financialYear: "2025-26",
    taxpayer: { residentStatus: "resident", ageCategory: "below_60" },
    clientApprovalStatus: "pending",
    filingStatus: "in_preparation",
    eVerificationStatus: "not_applicable",
    finalized: false,
    requiredDocuments: [],
    income: [],
    taxPaid: [],
    deductions: [],
    capitalGains: [],
    ...overrides,
  };
}

describe("computeTax — AY 2026-27 / FY 2025-26", () => {
  it("new regime: 87A rebate wipes out tax under the ₹12L threshold", () => {
    const r = computeTax(
      makeInput({
        income: [{ id: "s1", category: "salary", amount: 900_000, sourceType: "Form16" }],
      }),
    );
    // salary 900000 - std 75000 = 825000 slab income.
    // slab tax = 5%*400000 + 10%*25000 = 20000 + 2500 = 22500, fully rebated.
    expect(r.newRegime.slabTax.value).toBe(22500);
    expect(r.newRegime.rebate.value).toBe(22500);
    expect(r.newRegime.grossTaxLiability.value).toBe(0);
    expect(r.recommendedRegime).toBe("new");
  });

  it("new regime: above the rebate threshold, no rebate and cess applies", () => {
    const r = computeTax(
      makeInput({
        income: [{ id: "s1", category: "salary", amount: 1_500_000, sourceType: "Form16" }],
      }),
    );
    // 1500000 - 75000 = 1425000 → slab tax 93750, no rebate, +4% cess = 97500.
    expect(r.newRegime.slabTax.value).toBe(93750);
    expect(r.newRegime.rebate.value).toBe(0);
    expect(r.newRegime.cess.value).toBe(3750);
    expect(r.newRegime.grossTaxLiability.value).toBe(97500);
  });

  it("old regime: 80C is capped at ₹1,50,000", () => {
    const r = computeTax(
      makeInput({
        income: [{ id: "s1", category: "salary", amount: 1_000_000, sourceType: "manual" }],
        deductions: [{ id: "d1", section: "80C", amount: 200_000, sourceType: "manual", proofDocumentId: "p1" }],
      }),
    );
    expect(r.oldRegime.chapterVIADeductions.value).toBe(150_000);
    // std 50000 + 80C 150000 = 200000 total deductions.
    expect(r.oldRegime.deductionsAllowed.value).toBe(200_000);
    // 1000000 - 50000 - 150000 = 800000 slab income.
    expect(r.oldRegime.normalTaxableIncome.value).toBe(800_000);
  });

  it("aggregates salary + interest + dividend into gross total income", () => {
    const r = computeTax(
      makeInput({
        income: [
          { id: "s1", category: "salary", amount: 500_000, sourceType: "Form16" },
          { id: "i1", category: "savings_interest", amount: 8_000, sourceType: "manual" },
          { id: "i2", category: "fd_interest", amount: 12_000, sourceType: "manual" },
          { id: "i3", category: "dividend", amount: 5_000, sourceType: "AIS" },
        ],
      }),
    );
    expect(r.grossTotalIncome.value).toBe(525_000);
    // new regime normal taxable = (500000 - 75000) + 25000 = 450000.
    expect(r.newRegime.normalTaxableIncome.value).toBe(450_000);
  });

  it("taxes STCG u/s 111A at 20% (separate from slab income)", () => {
    const r = computeTax(
      makeInput({
        income: [{ id: "s1", category: "salary", amount: 400_000, sourceType: "Form16" }],
        capitalGains: [
          { id: "cg1", category: "stcg_111a", amount: 100_000, taxable_gain: 100_000, sourceType: "broker_report" },
        ],
      }),
    );
    expect(r.newRegime.specialRateTax.value).toBe(20_000); // 100000 * 20%
    // 87A rebate must NOT wipe special-rate tax → cess on 20000 = 800.
    expect(r.newRegime.grossTaxLiability.value).toBe(20_800);
  });

  it("taxes LTCG u/s 112A at 12.5% above the ₹1.25L exemption", () => {
    const r = computeTax(
      makeInput({
        income: [{ id: "s1", category: "salary", amount: 400_000, sourceType: "Form16" }],
        capitalGains: [
          { id: "cg1", category: "ltcg_112a", amount: 300_000, taxable_gain: 300_000, sourceType: "broker_report" },
        ],
      }),
    );
    // (300000 - 125000) * 12.5% = 21875.
    expect(r.newRegime.specialRateTax.value).toBe(21_875);
  });

  it("reports tax payable when liability exceeds TDS", () => {
    const r = computeTax(
      makeInput({
        income: [{ id: "s1", category: "salary", amount: 1_500_000, sourceType: "Form16" }],
        taxPaid: [{ id: "t1", category: "salary_tds", amount: 50_000, sourceType: "Form16" }],
      }),
    );
    // gross new 97500 - TDS 50000 = 47500 payable (positive).
    expect(r.refundOrPayable.value).toBe(47_500);
    expect(r.refundOrPayable.notes.join(" ")).toContain("payable");
  });

  it("reports a refund when TDS exceeds liability", () => {
    const r = computeTax(simpleSalariedRefundCase);
    expect(r.recommendedRegime).toBe("new");
    expect(r.grossTaxLiability.value).toBe(0);
    expect(r.refundOrPayable.value).toBe(-60_000); // refund
    expect(r.refundOrPayable.notes.join(" ")).toContain("Refund");
  });

  it("does NOT merge capital gains into ordinary slab income", () => {
    const r = computeTax(
      makeInput({
        income: [{ id: "s1", category: "salary", amount: 400_000, sourceType: "Form16" }],
        capitalGains: [
          { id: "cg1", category: "stcg_111a", amount: 500_000, taxable_gain: 500_000, sourceType: "broker_report" },
        ],
      }),
    );
    // Ordinary income = salary - std only (325000). Gains stay separate.
    expect(r.newRegime.normalTaxableIncome.value).toBe(325_000);
    expect(r.newRegime.specialRateCapitalGains.value).toBe(500_000);
    expect(r.grossTotalIncome.value).toBe(900_000);
    // Slab tax on 325000 is nil — proving gains were not slabbed.
    expect(r.newRegime.slabTax.value).toBe(0);
  });

  it("carries source traceability on computed values", () => {
    const r = computeTax(
      makeInput({
        income: [{ id: "s1", category: "salary", amount: 800_000, sourceType: "Form16", sourceDocumentId: "doc_f16" }],
        capitalGains: [
          {
            id: "cg1",
            category: "stcg_111a",
            amount: 50_000,
            taxable_gain: 50_000,
            sourceType: "broker_report",
            source_document_id: "doc_broker",
          },
        ],
      }),
    );
    expect(r.grossTotalIncome.sources).toContain("salary:Form16:doc_f16");
    expect(r.grossTotalIncome.sources).toContain("stcg_111a:broker_report:doc_broker");
    expect(r.newRegime.specialRateCapitalGains.sources).toContain("stcg_111a:broker_report:doc_broker");
  });
});

describe("computeTax — K4-02 senior/super-senior OLD-regime basic-exemption widening", () => {
  // Salary ₹8,00,000 → old-regime taxable (after ₹50,000 std deduction) is
  // ₹7,50,000 for every case below — only the age band and residency vary.
  function salaryOnlyInput(overrides: Partial<TaxEngineInput> = {}): TaxEngineInput {
    return makeInput({
      income: [{ id: "s1", category: "salary", amount: 800_000, sourceType: "Form16" }],
      ...overrides,
    });
  }

  it("resident senior: old-regime slab tax uses the widened ₹3L exemption (₹60,000, not ₹62,500)", () => {
    const r = computeTax(
      salaryOnlyInput({ taxpayer: { residentStatus: "resident", ageCategory: "senior" } }),
    );
    expect(r.oldRegime.slabTax.value).toBe(60_000);
    // No 87A rebate above ₹5L old-regime ceiling; cess 4% of 60,000 = 2,400.
    expect(r.oldRegime.cess.value).toBe(2_400);
    expect(r.oldRegime.grossTaxLiability.value).toBe(62_400);
  });

  it("resident super-senior: old-regime slab tax uses the widened ₹5L exemption (₹50,000)", () => {
    const r = computeTax(
      salaryOnlyInput({ taxpayer: { residentStatus: "resident", ageCategory: "super_senior" } }),
    );
    expect(r.oldRegime.slabTax.value).toBe(50_000);
    expect(r.oldRegime.cess.value).toBe(2_000);
    expect(r.oldRegime.grossTaxLiability.value).toBe(52_000);
  });

  it("resident below-60 (control): old-regime slab tax is UNCHANGED at ₹62,500", () => {
    const r = computeTax(
      salaryOnlyInput({ taxpayer: { residentStatus: "resident", ageCategory: "below_60" } }),
    );
    expect(r.oldRegime.slabTax.value).toBe(62_500);
    expect(r.oldRegime.grossTaxLiability.value).toBe(65_000);
  });

  it("NON-resident senior: widening does NOT apply — falls back to the below-60 table", () => {
    const r = computeTax(
      salaryOnlyInput({ taxpayer: { residentStatus: "non_resident", ageCategory: "senior" } }),
    );
    expect(r.oldRegime.slabTax.value).toBe(62_500);
    expect(r.oldRegime.grossTaxLiability.value).toBe(65_000);
  });

  it("resident, ageCategory unknown/undefined: falls back to the below-60 table (no crash, no guess)", () => {
    const r = computeTax(
      salaryOnlyInput({ taxpayer: { residentStatus: "resident", ageCategory: undefined } }),
    );
    expect(r.oldRegime.slabTax.value).toBe(62_500);
  });

  it("NEW regime tax is IDENTICAL for a senior and a below-60 resident with the same income (age-neutral)", () => {
    const seniorResult = computeTax(
      salaryOnlyInput({ taxpayer: { residentStatus: "resident", ageCategory: "senior" } }),
    );
    const belowSixtyResult = computeTax(
      salaryOnlyInput({ taxpayer: { residentStatus: "resident", ageCategory: "below_60" } }),
    );
    expect(seniorResult.newRegime.slabTax.value).toBe(belowSixtyResult.newRegime.slabTax.value);
    expect(seniorResult.newRegime.grossTaxLiability.value).toBe(belowSixtyResult.newRegime.grossTaxLiability.value);
  });

  it("the slab-tax formula names the senior-citizen table for a resident senior's old-regime figure", () => {
    const r = computeTax(
      salaryOnlyInput({ taxpayer: { residentStatus: "resident", ageCategory: "senior" } }),
    );
    expect(r.oldRegime.slabTax.formula).toContain("senior-citizen");
  });

  // -------------------------------------------------------------------------
  // K4-03: age-aware Section 80D / 80TTA / 80TTB caps (spec §10.2 / §10.3).
  // -------------------------------------------------------------------------

  it("resident senior: 80D caps at ₹50,000 (not the flat ₹25,000)", () => {
    const r = computeTax(
      salaryOnlyInput({
        taxpayer: { residentStatus: "resident", ageCategory: "senior" },
        deductions: [{ id: "d1", section: "80D", amount: 60_000, sourceType: "manual", proofDocumentId: "p1" }],
      }),
    );
    expect(r.oldRegime.chapterVIADeductions.value).toBe(50_000);
  });

  it("resident super-senior: 80D also caps at ₹50,000", () => {
    const r = computeTax(
      salaryOnlyInput({
        taxpayer: { residentStatus: "resident", ageCategory: "super_senior" },
        deductions: [{ id: "d1", section: "80D", amount: 60_000, sourceType: "manual", proofDocumentId: "p1" }],
      }),
    );
    expect(r.oldRegime.chapterVIADeductions.value).toBe(50_000);
  });

  it("resident below-60 (control): 80D stays capped at the flat ₹25,000", () => {
    const r = computeTax(
      salaryOnlyInput({
        taxpayer: { residentStatus: "resident", ageCategory: "below_60" },
        deductions: [{ id: "d1", section: "80D", amount: 60_000, sourceType: "manual", proofDocumentId: "p1" }],
      }),
    );
    expect(r.oldRegime.chapterVIADeductions.value).toBe(25_000);
  });

  it("NON-resident senior: 80D widening does NOT apply — falls back to the flat ₹25,000 cap", () => {
    const r = computeTax(
      salaryOnlyInput({
        taxpayer: { residentStatus: "non_resident", ageCategory: "senior" },
        deductions: [{ id: "d1", section: "80D", amount: 60_000, sourceType: "manual", proofDocumentId: "p1" }],
      }),
    );
    expect(r.oldRegime.chapterVIADeductions.value).toBe(25_000);
  });

  it("resident below-60: 80TTA is allowed at its ₹10,000 cap", () => {
    const r = computeTax(
      salaryOnlyInput({
        taxpayer: { residentStatus: "resident", ageCategory: "below_60" },
        deductions: [{ id: "d1", section: "80TTA", amount: 12_000, sourceType: "manual", proofDocumentId: "p1" }],
      }),
    );
    expect(r.oldRegime.chapterVIADeductions.value).toBe(10_000);
  });

  it("resident senior: an 80TTA claim is EXCLUDED entirely (₹0 cap) — mutually exclusive with 80TTB", () => {
    const r = computeTax(
      salaryOnlyInput({
        taxpayer: { residentStatus: "resident", ageCategory: "senior" },
        deductions: [{ id: "d1", section: "80TTA", amount: 10_000, sourceType: "manual", proofDocumentId: "p1" }],
      }),
    );
    expect(r.oldRegime.chapterVIADeductions.value).toBe(0);
    expect(r.oldRegime.chapterVIADeductions.notes.some((n) => n.includes("80TTA") && n.includes("excluded"))).toBe(
      true,
    );
  });

  it("resident senior: 80TTB is allowed at its ₹50,000 cap (all deposit interest)", () => {
    const r = computeTax(
      salaryOnlyInput({
        taxpayer: { residentStatus: "resident", ageCategory: "senior" },
        deductions: [{ id: "d1", section: "80TTB", amount: 60_000, sourceType: "manual", proofDocumentId: "p1" }],
      }),
    );
    expect(r.oldRegime.chapterVIADeductions.value).toBe(50_000);
  });

  it("resident below-60: an 80TTB claim is EXCLUDED entirely (₹0 cap) — closes the K4-02 dossier's second finding (over-claim at the senior cap)", () => {
    const r = computeTax(
      salaryOnlyInput({
        taxpayer: { residentStatus: "resident", ageCategory: "below_60" },
        deductions: [{ id: "d1", section: "80TTB", amount: 50_000, sourceType: "manual", proofDocumentId: "p1" }],
      }),
    );
    expect(r.oldRegime.chapterVIADeductions.value).toBe(0);
    expect(r.oldRegime.chapterVIADeductions.notes.some((n) => n.includes("80TTB") && n.includes("excluded"))).toBe(
      true,
    );
  });

  it("resident, ageCategory unknown/undefined: 80TTB falls back to EXCLUDED (never grants senior treatment without confirmed age)", () => {
    const r = computeTax(
      salaryOnlyInput({
        taxpayer: { residentStatus: "resident", ageCategory: undefined },
        deductions: [{ id: "d1", section: "80TTB", amount: 50_000, sourceType: "manual", proofDocumentId: "p1" }],
      }),
    );
    expect(r.oldRegime.chapterVIADeductions.value).toBe(0);
  });

  it("NEW regime: 80D/80TTA/80TTB are all disallowed regardless of age (Chapter VI-A not computed at all)", () => {
    const r = computeTax(
      salaryOnlyInput({
        taxpayer: { residentStatus: "resident", ageCategory: "senior" },
        deductions: [
          { id: "d1", section: "80D", amount: 60_000, sourceType: "manual", proofDocumentId: "p1" },
          { id: "d2", section: "80TTB", amount: 50_000, sourceType: "manual", proofDocumentId: "p2" },
        ],
      }),
    );
    expect(r.newRegime.chapterVIADeductions.value).toBe(0);
  });

  // -------------------------------------------------------------------------
  // K4-05: Section 80D "insured party" — the parents bucket (spec §10.2's
  // residual gap). An INDEPENDENT ₹25,000/₹50,000 cap, summed with — never
  // merged into — the self/family "80D" bucket's own cap.
  // -------------------------------------------------------------------------

  it("below-60 resident taxpayer, confirmed-senior parent: 80D_PARENTS caps at ₹50,000", () => {
    const r = computeTax(
      salaryOnlyInput({
        taxpayer: { residentStatus: "resident", ageCategory: "below_60" },
        deductions: [
          {
            id: "d1",
            section: "80D_PARENTS",
            amount: 60_000,
            sourceType: "manual",
            proofDocumentId: "p1",
            insuredPartySenior: true,
          },
        ],
      }),
    );
    expect(r.oldRegime.chapterVIADeductions.value).toBe(50_000);
  });

  it("below-60 resident taxpayer, parent NOT confirmed senior: 80D_PARENTS stays at the conservative flat ₹25,000", () => {
    const r = computeTax(
      salaryOnlyInput({
        taxpayer: { residentStatus: "resident", ageCategory: "below_60" },
        deductions: [
          { id: "d1", section: "80D_PARENTS", amount: 60_000, sourceType: "manual", proofDocumentId: "p1" },
        ],
      }),
    );
    expect(r.oldRegime.chapterVIADeductions.value).toBe(25_000);
  });

  it("insuredPartySenior: false is treated identically to undefined — never inferred senior", () => {
    const r = computeTax(
      salaryOnlyInput({
        taxpayer: { residentStatus: "resident", ageCategory: "below_60" },
        deductions: [
          {
            id: "d1",
            section: "80D_PARENTS",
            amount: 60_000,
            sourceType: "manual",
            proofDocumentId: "p1",
            insuredPartySenior: false,
          },
        ],
      }),
    );
    expect(r.oldRegime.chapterVIADeductions.value).toBe(25_000);
  });

  it("resident senior taxpayer with BOTH a self/family 80D claim AND a confirmed-senior parent 80D_PARENTS claim: the two ₹50,000 caps are SUMMED, not merged into one shared ceiling", () => {
    const r = computeTax(
      salaryOnlyInput({
        taxpayer: { residentStatus: "resident", ageCategory: "senior" },
        deductions: [
          { id: "d1", section: "80D", amount: 60_000, sourceType: "manual", proofDocumentId: "p1" },
          {
            id: "d2",
            section: "80D_PARENTS",
            amount: 60_000,
            sourceType: "manual",
            proofDocumentId: "p2",
            insuredPartySenior: true,
          },
        ],
      }),
    );
    expect(r.oldRegime.chapterVIADeductions.value).toBe(1_00_000);
  });

  it("NON-resident taxpayer, confirmed-senior parent: 80D_PARENTS widening does NOT apply — falls back to the flat ₹25,000 cap", () => {
    const r = computeTax(
      salaryOnlyInput({
        taxpayer: { residentStatus: "non_resident", ageCategory: "below_60" },
        deductions: [
          {
            id: "d1",
            section: "80D_PARENTS",
            amount: 60_000,
            sourceType: "manual",
            proofDocumentId: "p1",
            insuredPartySenior: true,
          },
        ],
      }),
    );
    expect(r.oldRegime.chapterVIADeductions.value).toBe(25_000);
  });

  it("NEW regime: 80D_PARENTS is disallowed regardless of the confirmed-senior flag (Chapter VI-A not computed at all)", () => {
    const r = computeTax(
      salaryOnlyInput({
        taxpayer: { residentStatus: "resident", ageCategory: "below_60" },
        deductions: [
          {
            id: "d1",
            section: "80D_PARENTS",
            amount: 60_000,
            sourceType: "manual",
            proofDocumentId: "p1",
            insuredPartySenior: true,
          },
        ],
      }),
    );
    expect(r.newRegime.chapterVIADeductions.value).toBe(0);
  });
});

describe("computeHouseProperty — K4-06 (Sections 22-27, 71(3A)/115BAC)", () => {
  function hp(overrides: Partial<HousePropertyEntry> = {}): HousePropertyEntry {
    return {
      id: "hp1",
      amount: 0,
      sourceType: "manual",
      usage: "self_occupied",
      annualRentReceived: 0,
      municipalTaxesPaid: 0,
      homeLoanInterest: 0,
      ...overrides,
    };
  }

  it("returns a zero, no-op ComputedValue when no property is declared", () => {
    const r = computeHouseProperty([], "old");
    expect(r.value).toBe(0);
    expect(r.sources).toEqual([]);
  });

  it("self-occupied, old regime: interest capped at ₹2,00,000", () => {
    const r = computeHouseProperty([hp({ homeLoanInterest: 350_000 })], "old");
    expect(r.value).toBe(-200_000);
  });

  it("self-occupied, old regime: interest under the cap is allowed in full", () => {
    const r = computeHouseProperty([hp({ homeLoanInterest: 120_000 })], "old");
    expect(r.value).toBe(-120_000);
  });

  it("self-occupied, new regime: interest is disallowed entirely (Section 115BAC)", () => {
    const r = computeHouseProperty([hp({ homeLoanInterest: 150_000 })], "new");
    expect(r.value).toBe(0);
    expect(r.notes.some((n) => n.includes("115BAC"))).toBe(true);
  });

  it("let-out: 30% standard deduction + uncapped interest, both regimes", () => {
    const entry = hp({
      usage: "let_out",
      annualRentReceived: 300_000,
      municipalTaxesPaid: 20_000,
      homeLoanInterest: 400_000,
    });
    // NAV = 300,000 - 20,000 = 280,000; std ded 30% = 84,000; net = 280,000 - 84,000 - 400,000 = -204,000.
    const old = computeHouseProperty([entry], "old");
    const nw = computeHouseProperty([entry], "new");
    // Old regime: loss set-off capped at ₹2,00,000 (Section 71(3A)).
    expect(old.value).toBe(-200_000);
    // New regime: loss cannot be set off against any other head at all.
    expect(nw.value).toBe(0);
    expect(nw.notes.some((n) => n.includes("115BAC"))).toBe(true);
  });

  it("let-out with a gain contributes fully (no cap on a positive figure)", () => {
    const entry = hp({
      usage: "let_out",
      annualRentReceived: 500_000,
      municipalTaxesPaid: 10_000,
      homeLoanInterest: 50_000,
    });
    // NAV = 490,000; std ded 30% = 147,000; net = 490,000 - 147,000 - 50,000 = 293,000.
    expect(computeHouseProperty([entry], "old").value).toBe(293_000);
    expect(computeHouseProperty([entry], "new").value).toBe(293_000);
  });

  it("municipal taxes reduce GAV only for a let-out property, never for self-occupied", () => {
    const r = computeHouseProperty(
      [hp({ usage: "self_occupied", municipalTaxesPaid: 15_000, homeLoanInterest: 0 })],
      "old",
    );
    // Self-occupied GAV is deemed nil regardless of municipal taxes paid.
    expect(r.value).toBe(0);
  });

  it("tags the ComputedValue with the engine's sourceTag convention", () => {
    const r = computeHouseProperty([hp({ id: "abc", sourceType: "manual" })], "old");
    expect(r.sources).toEqual(["house_property:manual:abc"]);
  });
});

describe("computeTax — house property integration (K4-06)", () => {
  function salaryOnlyInputWithHouseProperty(
    salary: number,
    entries: HousePropertyEntry[],
  ): TaxEngineInput {
    return {
      assessmentYear: "2026-27",
      financialYear: "2025-26",
      taxpayer: { residentStatus: "resident", ageCategory: "below_60" },
      clientApprovalStatus: "pending",
      filingStatus: "in_preparation",
      eVerificationStatus: "not_applicable",
      finalized: false,
      requiredDocuments: [],
      income: [{ id: "s1", category: "salary", amount: salary, sourceType: "Form16" }],
      taxPaid: [],
      deductions: [],
      capitalGains: [],
      housePropertyEntries: entries,
    };
  }

  it("a self-occupied loss reduces old-regime taxable income but not new-regime (115BAC)", () => {
    const r = computeTax(
      salaryOnlyInputWithHouseProperty(800_000, [
        {
          id: "hp1",
          amount: 0,
          sourceType: "manual",
          usage: "self_occupied",
          annualRentReceived: 0,
          municipalTaxesPaid: 0,
          homeLoanInterest: 150_000,
        },
      ]),
    );
    // Old: 800,000 - 50,000 std ded - 150,000 house-property loss = 600,000.
    expect(r.oldRegime.totalIncome.value).toBe(600_000);
    // New: 800,000 - 75,000 std ded + 0 house property = 725,000 (interest disallowed).
    expect(r.newRegime.totalIncome.value).toBe(725_000);
    expect(r.recommendedRegime).toBe("new");
  });

  it("missing housePropertyEntries behaves identically to an empty array", () => {
    const withUndefined = computeTax(salaryOnlyInputWithHouseProperty(800_000, []));
    const input2 = salaryOnlyInputWithHouseProperty(800_000, []);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (input2 as any).housePropertyEntries;
    const withMissing = computeTax(input2);
    expect(withMissing.oldRegime.totalIncome.value).toBe(withUndefined.oldRegime.totalIncome.value);
    expect(withMissing.newRegime.totalIncome.value).toBe(withUndefined.newRegime.totalIncome.value);
  });
});

describe("deriveIncome / computeTax — presumptive professional income (44ADA, K4-07)", () => {
  function salaryPlusPresumptiveInput(salary: number, grossReceipts: number): TaxEngineInput {
    return {
      assessmentYear: "2026-27",
      financialYear: "2025-26",
      taxpayer: { residentStatus: "resident", ageCategory: "below_60" },
      clientApprovalStatus: "pending",
      filingStatus: "in_preparation",
      eVerificationStatus: "not_applicable",
      finalized: false,
      requiredDocuments: [],
      income: [
        { id: "s1", category: "salary", amount: salary, sourceType: "Form16" },
        ...(grossReceipts > 0
          ? [{ id: "p1", category: "presumptive_professional_44ada" as const, amount: grossReceipts, sourceType: "manual" as const }]
          : []),
      ],
      taxPaid: [],
      deductions: [],
      capitalGains: [],
    };
  }

  it("deemed profit is 50% of declared gross receipts", () => {
    const r = computeTax(salaryPlusPresumptiveInput(0, 800_000));
    expect(r.oldRegime.presumptiveProfessionalIncome.value).toBe(400_000);
    expect(r.newRegime.presumptiveProfessionalIncome.value).toBe(400_000);
  });

  it("is regime-independent — identical under old and new regime", () => {
    const r = computeTax(salaryPlusPresumptiveInput(500_000, 800_000));
    expect(r.oldRegime.presumptiveProfessionalIncome.value).toBe(r.newRegime.presumptiveProfessionalIncome.value);
  });

  it("returns a zero, no-op ComputedValue when nothing is declared", () => {
    const r = computeTax(salaryPlusPresumptiveInput(500_000, 0));
    expect(r.oldRegime.presumptiveProfessionalIncome.value).toBe(0);
    expect(r.oldRegime.presumptiveProfessionalIncome.sources).toEqual([]);
  });

  it("flows into normalTaxableIncome and grossTotalIncome, both regimes", () => {
    const r = computeTax(salaryPlusPresumptiveInput(500_000, 800_000));
    // Old: 500,000 - 50,000 std ded + 400,000 deemed profit = 850,000.
    expect(r.oldRegime.normalTaxableIncome.value).toBe(850_000);
    // New: 500,000 - 75,000 std ded + 400,000 deemed profit = 825,000.
    expect(r.newRegime.normalTaxableIncome.value).toBe(825_000);
    // GTI: 500,000 salary + 400,000 deemed profit (regime-independent) = 900,000.
    expect(r.grossTotalIncome.value).toBe(900_000);
  });

  it("sums across multiple declared presumptive-44ADA rows (multiplicity IS in scope, K4-07)", () => {
    const input = salaryPlusPresumptiveInput(0, 0);
    input.income = [
      { id: "p1", category: "presumptive_professional_44ada", amount: 300_000, sourceType: "manual" },
      { id: "p2", category: "presumptive_professional_44ada", amount: 200_000, sourceType: "manual" },
    ];
    const r = computeTax(input);
    expect(r.oldRegime.presumptiveProfessionalIncome.value).toBe(250_000); // 50% of 500,000
  });

  it("tags the ComputedValue with the engine's sourceTag convention", () => {
    const r = computeTax(salaryPlusPresumptiveInput(0, 800_000));
    expect(r.oldRegime.presumptiveProfessionalIncome.sources).toEqual([
      "presumptive_professional_44ada:manual:p1",
    ]);
  });
});

describe("deriveIncome / computeTax — presumptive business income (44AD, K4-08)", () => {
  function salaryPlus44adInput(salary: number, digital: number, cash: number): TaxEngineInput {
    return {
      assessmentYear: "2026-27",
      financialYear: "2025-26",
      taxpayer: { residentStatus: "resident", ageCategory: "below_60" },
      clientApprovalStatus: "pending",
      filingStatus: "in_preparation",
      eVerificationStatus: "not_applicable",
      finalized: false,
      requiredDocuments: [],
      income: [
        ...(salary > 0
          ? [{ id: "s1", category: "salary" as const, amount: salary, sourceType: "Form16" as const }]
          : []),
        ...(digital > 0
          ? [{ id: "d1", category: "presumptive_business_44ad_digital" as const, amount: digital, sourceType: "manual" as const }]
          : []),
        ...(cash > 0
          ? [{ id: "c1", category: "presumptive_business_44ad_cash" as const, amount: cash, sourceType: "manual" as const }]
          : []),
      ],
      taxPaid: [],
      deductions: [],
      capitalGains: [],
    };
  }

  // The defining difference from 44ADA: TWO rates on TWO portions. If this
  // ever collapses to a single blended rate on aggregate turnover, these
  // three cases disagree.
  it("applies 6% to the digital portion only", () => {
    const r = computeTax(salaryPlus44adInput(0, 1_000_000, 0));
    expect(r.oldRegime.presumptiveBusinessIncome.value).toBe(60_000);
  });

  it("applies 8% to the cash portion only", () => {
    const r = computeTax(salaryPlus44adInput(0, 0, 1_000_000));
    expect(r.oldRegime.presumptiveBusinessIncome.value).toBe(80_000);
  });

  it("applies each rate to its OWN portion when both are present — never one blended rate", () => {
    const r = computeTax(salaryPlus44adInput(0, 4_000_000, 100_000));
    // 6% x 4,000,000 = 240,000 plus 8% x 100,000 = 8,000 → 248,000.
    expect(r.oldRegime.presumptiveBusinessIncome.value).toBe(248_000);
    // Explicitly NOT 6% or 8% of the 4,100,000 aggregate.
    expect(r.oldRegime.presumptiveBusinessIncome.value).not.toBe(246_000);
    expect(r.oldRegime.presumptiveBusinessIncome.value).not.toBe(328_000);
  });

  it("is regime-independent — identical under old and new regime", () => {
    const r = computeTax(salaryPlus44adInput(500_000, 4_000_000, 100_000));
    expect(r.oldRegime.presumptiveBusinessIncome.value).toBe(
      r.newRegime.presumptiveBusinessIncome.value,
    );
  });

  it("returns a zero, no-op ComputedValue when nothing is declared", () => {
    const r = computeTax(salaryPlus44adInput(500_000, 0, 0));
    expect(r.oldRegime.presumptiveBusinessIncome.value).toBe(0);
    expect(r.oldRegime.presumptiveBusinessIncome.sources).toEqual([]);
  });

  it("flows into normalTaxableIncome and grossTotalIncome, both regimes", () => {
    const r = computeTax(salaryPlus44adInput(500_000, 4_000_000, 100_000));
    // Old: 500,000 - 50,000 std ded + 248,000 deemed profit = 698,000.
    expect(r.oldRegime.normalTaxableIncome.value).toBe(698_000);
    // New: 500,000 - 75,000 std ded + 248,000 deemed profit = 673,000.
    expect(r.newRegime.normalTaxableIncome.value).toBe(673_000);
    // GTI: 500,000 salary + 248,000 deemed profit (regime-independent).
    expect(r.grossTotalIncome.value).toBe(748_000);
  });

  it("sums across multiple declared rows within each receipt-mode head", () => {
    const input = salaryPlus44adInput(0, 0, 0);
    input.income = [
      { id: "d1", category: "presumptive_business_44ad_digital", amount: 600_000, sourceType: "manual" },
      { id: "d2", category: "presumptive_business_44ad_digital", amount: 400_000, sourceType: "manual" },
      { id: "c1", category: "presumptive_business_44ad_cash", amount: 500_000, sourceType: "manual" },
    ];
    const r = computeTax(input);
    // 6% x 1,000,000 = 60,000 plus 8% x 500,000 = 40,000 → 100,000.
    expect(r.oldRegime.presumptiveBusinessIncome.value).toBe(100_000);
  });

  it("tags the ComputedValue with each row's OWN head, keeping the split traceable", () => {
    const r = computeTax(salaryPlus44adInput(0, 4_000_000, 100_000));
    expect(r.oldRegime.presumptiveBusinessIncome.sources).toEqual([
      "presumptive_business_44ad_digital:manual:d1",
      "presumptive_business_44ad_cash:manual:c1",
    ]);
  });

  it("is independent of Section 44ADA — both can be declared and neither absorbs the other", () => {
    const input = salaryPlus44adInput(0, 1_000_000, 0);
    input.income = [
      ...input.income,
      { id: "p1", category: "presumptive_professional_44ada", amount: 800_000, sourceType: "manual" },
    ];
    const r = computeTax(input);
    expect(r.oldRegime.presumptiveBusinessIncome.value).toBe(60_000);
    expect(r.oldRegime.presumptiveProfessionalIncome.value).toBe(400_000);
    expect(r.grossTotalIncome.value).toBe(460_000);
  });
});

describe("deriveIncome / computeTax — within-year capital-loss set-off (K4-09)", () => {
  function capitalGainsInput(
    gains: Array<{ id: string; category: "stcg_111a" | "ltcg_112a"; taxable_gain: number }>,
  ): TaxEngineInput {
    return {
      assessmentYear: "2026-27",
      financialYear: "2025-26",
      taxpayer: { residentStatus: "resident", ageCategory: "below_60" },
      clientApprovalStatus: "pending",
      filingStatus: "in_preparation",
      eVerificationStatus: "not_applicable",
      finalized: false,
      requiredDocuments: [],
      income: [{ id: "s1", category: "salary", amount: 600_000, sourceType: "Form16" }],
      taxPaid: [],
      deductions: [],
      capitalGains: gains.map((g) => ({
        id: g.id,
        category: g.category,
        amount: g.taxable_gain,
        sourceType: "broker_report" as const,
        taxable_gain: g.taxable_gain,
      })),
    };
  }

  it("sets a long-term loss off against long-term gains (s.74(1)(b))", () => {
    const r = computeTax(capitalGainsInput([
      { id: "g", category: "ltcg_112a", taxable_gain: 500_000 },
      { id: "l", category: "ltcg_112a", taxable_gain: -200_000 },
    ]));
    expect(r.capitalLossSetOff?.absorbedAgainstLtcg).toBe(200_000);
    expect(r.capitalLossSetOff?.residual).toBe(0);
    // Net 300,000; taxed above the 125,000 exemption at 12.5% = 21,875.
    expect(r.specialRateCapitalGains.value).toBe(300_000);
    expect(r.specialRateTax.value).toBe(21_875);
  });

  it("does NOT let a long-term loss reduce short-term gains", () => {
    const r = computeTax(capitalGainsInput([
      { id: "g", category: "stcg_111a", taxable_gain: 400_000 },
      { id: "l", category: "ltcg_112a", taxable_gain: -100_000 },
    ]));
    // The 111A gain is untouched; the long-term loss finds no long-term gain
    // to absorb it and survives as a residual (which the adapter blocks).
    expect(r.capitalLossSetOff?.absorbedAgainstLtcg).toBe(0);
    expect(r.capitalLossSetOff?.residual).toBe(100_000);
    expect(r.specialRateCapitalGains.value).toBe(400_000);
    expect(r.specialRateTax.value).toBe(80_000);
  });

  it("sets a short-term loss off against short-term gains", () => {
    const r = computeTax(capitalGainsInput([
      { id: "g", category: "stcg_111a", taxable_gain: 300_000 },
      { id: "l", category: "stcg_111a", taxable_gain: -100_000 },
    ]));
    expect(r.capitalLossSetOff?.absorbedAgainstStcg).toBe(100_000);
    expect(r.capitalLossSetOff?.residual).toBe(0);
    expect(r.specialRateCapitalGains.value).toBe(200_000);
    expect(r.specialRateTax.value).toBe(40_000);
  });

  it("never produces a negative gain figure — an excess loss becomes a residual, not a negative", () => {
    const r = computeTax(capitalGainsInput([
      { id: "g", category: "ltcg_112a", taxable_gain: 100_000 },
      { id: "l", category: "ltcg_112a", taxable_gain: -400_000 },
    ]));
    expect(r.specialRateCapitalGains.value).toBe(0);
    expect(r.specialRateTax.value).toBe(0);
    expect(r.capitalLossSetOff?.residual).toBe(300_000);
  });

  it("is independent of the order rows arrive in", () => {
    const rows = [
      { id: "a", category: "ltcg_112a" as const, taxable_gain: 300_000 },
      { id: "b", category: "ltcg_112a" as const, taxable_gain: -150_000 },
      { id: "c", category: "ltcg_112a" as const, taxable_gain: 200_000 },
    ];
    const forward = computeTax(capitalGainsInput(rows));
    const reversed = computeTax(capitalGainsInput([...rows].reverse()));
    expect(forward.specialRateCapitalGains.value).toBe(reversed.specialRateCapitalGains.value);
    expect(forward.specialRateTax.value).toBe(reversed.specialRateTax.value);
    expect(forward.specialRateCapitalGains.value).toBe(350_000);
  });

  it("leaves a case with no losses byte-identical to its pre-K4-09 behaviour", () => {
    const r = computeTax(capitalGainsInput([
      { id: "g1", category: "stcg_111a", taxable_gain: 100_000 },
      { id: "g2", category: "ltcg_112a", taxable_gain: 200_000 },
    ]));
    expect(r.capitalLossSetOff?.absorbedAgainstStcg).toBe(0);
    expect(r.capitalLossSetOff?.absorbedAgainstLtcg).toBe(0);
    expect(r.capitalLossSetOff?.residual).toBe(0);
    // 100,000 x 20% + max(0, 200,000 - 125,000) x 12.5% = 20,000 + 9,375.
    expect(r.specialRateTax.value).toBe(29_375);
    // The formula string must NOT mention a set-off when none occurred.
    expect(r.specialRateCapitalGains.formula).not.toContain("loss set off");
  });
});

// ---------------------------------------------------------------------------
// K4-14 — books-based business/profession income (Sections 28/29)
// ---------------------------------------------------------------------------

function booksEntry(overrides: Partial<BusinessBooksEntry> = {}): BusinessBooksEntry {
  return {
    id: "bk1",
    amount: 0,
    sourceType: "manual",
    revenue: 3_000_000,
    expenses: 2_400_000,
    isProfession: false,
    adjustments: "none_s30_43d",
    activityClassification: "ordinary_business_or_profession",
    ...overrides,
  };
}

describe("computeBusinessBooksIncome (K4-14)", () => {
  it("is declared revenue minus declared expenses, and nothing else", () => {
    const v = computeBusinessBooksIncome([booksEntry()]);
    expect(v.value).toBe(600_000);
    expect(v.sources).toEqual(["business_books:manual:bk1"]);
    expect(v.formula).toContain("Sections 28/29");
  });

  it("says plainly that it applies no Sections 30-43D provision of its own", () => {
    const [note] = computeBusinessBooksIncome([booksEntry()]).notes;
    expect(note).toContain("no Sections 30-43D adjustment");
    expect(note).toContain("It applies NO Sections 30-43D provision of its own");
  });

  it("no entries → ₹0 with no sources (the historically correct value)", () => {
    const v = computeBusinessBooksIncome([]);
    expect(v.value).toBe(0);
    expect(v.sources).toEqual([]);
    expect(v.notes).toEqual([]);
  });

  // Each refusal below is DEFENCE IN DEPTH — the adapter has normally excluded
  // such a row long before the engine sees it. They are asserted here because a
  // stored snapshot or a hand-built fixture could route around the adapter, and
  // every one of them must yield ₹0 WITH a stated reason, never a plausible
  // number and never a silent zero.
  it.each([
    ["depreciation_s32", "Section 32"],
    ["disallowance_s37_s40_s43b", "Sections 37(1), 40 and 43B"],
    ["presumptive_transition", "Sections 44AD(4)"],
  ] as const)("refuses a non-computable basis: %s", (adjustments, authorityFragment) => {
    const v = computeBusinessBooksIncome([booksEntry({ adjustments })]);
    expect(v.value).toBe(0);
    expect(v.sources).toEqual([]);
    expect(v.formula).toContain("not computed");
    expect(v.notes[0]).toContain(authorityFragment);
  });

  it("refuses a residual business-head LOSS rather than flooring it to ₹0 silently", () => {
    const v = computeBusinessBooksIncome([booksEntry({ revenue: 1_000_000, expenses: 1_400_000 })]);
    expect(v.value).toBe(0);
    expect(v.sources).toEqual([]);
    expect(v.formula).toContain("residual loss ₹400000");
    // The distinction that matters: the note must say the loss was NOT treated
    // as zero income, because a bare ₹0 is indistinguishable from "no business".
    expect(v.notes[0]).toContain("neither applied nor treated as ₹0");
    expect(v.notes[0]).toContain("Section 70(1)");
    expect(v.notes[0]).toContain("Section 71");
    expect(v.notes[0]).toContain("Section 72");
  });

  // K4-15 REPLACED the assertion that lived here ("refuses more than one
  // business rather than aggregating across them", asserting ₹0 and a note
  // containing "own Section 44AB threshold"). Section 28(i) charges the head on
  // the profits of ANY business carried on, so the aggregate IS the head, and
  // the replaced note stated a reason that misread Section 44AB. Recorded under
  // the programme's §4 replaced-assertion convention, the same way D243 was.
  it("AGGREGATES several businesses under the one Section 28 head", () => {
    const v = computeBusinessBooksIncome([booksEntry({ id: "bk1" }), booksEntry({ id: "bk2" })]);
    expect(v.value).toBe(1_200_000);
    expect(v.sources).toEqual(["business_books:manual:bk1", "business_books:manual:bk2"]);
    expect(v.formula).toContain("2 books-based businesses/professions");
    expect(v.notes.join(" ")).toContain("AGGREGATE of 2 separate businesses");
    // The aggregate must say that no set-off was engaged, not merely omit it.
    expect(v.notes.join(" ")).toContain("Section 70(1) was not engaged");
  });

  it("a single entry is NOT described as an aggregate and gains no extra note", () => {
    const one = computeBusinessBooksIncome([booksEntry()]);
    expect(one.notes).toHaveLength(1);
    expect(one.formula).toContain("books-based business (Sections 28/29)");
    expect(one.formula).not.toContain("businesses/professions");
  });

  it("ONE incomplete Section 32 claim refuses the WHOLE head — never a partial aggregate", () => {
    const v = computeBusinessBooksIncome([
      booksEntry({ id: "bk1" }),
      booksEntry({ id: "bk2", adjustments: "depreciation_s32" }),
    ]);
    expect(v.value).toBe(0);
    expect(v.sources).toEqual([]);
    expect(v.notes[0]).toContain("the whole head was excluded");
  });

  it("computes a complete standing-class Section 32(1)(ii) claim", () => {
    const v = computeBusinessBooksIncome([
      booksEntry({
        adjustments: ["depreciation_s32"],
        bookDepreciation: 80_000,
        claimsAdditionalDepreciation: false,
        depreciationBlocks: [
          {
            assetClass: "plant_machinery_general_iii1",
            wdv: 4_00_000,
            putToUse: "full_rate",
          },
        ],
      }),
    ]);
    // revenue 30L − expenses 24L + book dep 80,000 − 15% of 4L (60,000) = 6,20,000
    expect(v.value).toBe(6_20_000);
    expect(v.formula).toContain("Section 32(1)(ii)");
    expect(v.notes[0]).toContain("bounded Section 32(1)(ii)");
    expect(v.notes[0]).not.toContain("It applies NO Sections 30-43D provision of its own");
  });

  it("K4-17 nets a current-year loss against sibling profit when the aggregate stays non-negative", () => {
    const v = computeBusinessBooksIncome([
      booksEntry({ id: "bk1", revenue: 1_000_000, expenses: 400_000 }),
      booksEntry({ id: "bk2", revenue: 100_000, expenses: 500_000 }),
    ]);
    expect(v.value).toBe(200_000);
    expect(v.sources).toEqual(["business_books:manual:bk1", "business_books:manual:bk2"]);
    expect(v.notes.join(" ")).toContain("Section 70(1) current-year intra-head set-off absorbed");
    expect(v.notes.join(" ")).toContain("no residual was sent to cross-head set-off or carry-forward");
  });

  it("computes an exact-zero Section 70(1) aggregate as traced income", () => {
    const v = computeBusinessBooksIncome([
      booksEntry({ id: "bk1", revenue: 600_000, expenses: 100_000 }),
      booksEntry({ id: "bk2", revenue: 100_000, expenses: 600_000 }),
    ]);
    expect(v.value).toBe(0);
    expect(v.sources).toEqual(["business_books:manual:bk1", "business_books:manual:bk2"]);
    expect(v.notes.join(" ")).toContain("aggregate is non-negative");
  });

  it("a zero net profit is COMPUTED, not refused — equal revenue and expenses is a real answer", () => {
    const v = computeBusinessBooksIncome([booksEntry({ revenue: 500_000, expenses: 500_000 })]);
    expect(v.value).toBe(0);
    // The tell that separates this from every refusal above: it is traced.
    expect(v.sources).toEqual(["business_books:manual:bk1"]);
  });
});

describe("computeTax — books-based business income integration (K4-14)", () => {
  const input = makeInput({
    income: [{ id: "s1", category: "salary", amount: 500_000, sourceType: "Form16" }],
    businessBooksEntries: [booksEntry()],
  });

  it("flows into gross total income, taxable income and both regimes", () => {
    const r = computeTax(input);
    expect(r.grossTotalIncome.value).toBe(1_100_000);
    // new regime: 500,000 - 75,000 std + 600,000 = 1,025,000
    expect(r.newRegime.totalIncome.value).toBe(1_025_000);
    // old regime: 500,000 - 50,000 std + 600,000 = 1,050,000
    expect(r.oldRegime.totalIncome.value).toBe(1_050_000);
  });

  it("is REGIME-INDEPENDENT — equal value and equal sources on both regimes", () => {
    const r = computeTax(input);
    expect(r.oldRegime.businessBooksIncome.value).toBe(600_000);
    expect(r.newRegime.businessBooksIncome.value).toBe(600_000);
    expect(r.oldRegime.businessBooksIncome.sources).toEqual(r.newRegime.businessBooksIncome.sources);
  });

  it("compares an exact decimal zero in paise, independent of entry order", () => {
    const entries = [
      booksEntry({ id: "p", revenue: 0.03, expenses: 0 }),
      booksEntry({ id: "n1", revenue: 0, expenses: 0.02 }),
      booksEntry({ id: "n2", revenue: 0, expenses: 0.01 }),
    ];
    for (const ordered of [entries, [...entries].reverse()]) {
      const v = computeBusinessBooksIncome(ordered);
      expect(v.value).toBe(0);
      expect(v.sources).toHaveLength(3);
      expect(v.notes.join(" ")).toContain("Section 70(1)");
    }
  });

  it.each(["futures_and_options", "speculation_business_s73", "specified_business_s35ad"] as const)(
    "defensively refuses activity pool %s",
    (activityClassification) => {
      const v = computeBusinessBooksIncome([booksEntry({ activityClassification })]);
      expect(v.value).toBe(0);
      expect(v.sources).toEqual([]);
      expect(v.notes.join(" ")).toMatch(/Section 43\(5\)|Sections 73\/73A/);
    },
  );

  it("K4-17 carries an admitted intra-head set-off through GTI and both regimes", () => {
    const r = computeTax(
      makeInput({
        income: [{ id: "s1", category: "salary", amount: 500_000, sourceType: "Form16" }],
        businessBooksEntries: [
          booksEntry({ id: "profit", revenue: 1_000_000, expenses: 400_000 }),
          booksEntry({ id: "loss", revenue: 100_000, expenses: 500_000 }),
        ],
      }),
    );
    expect(r.oldRegime.businessBooksIncome.value).toBe(200_000);
    expect(r.newRegime.businessBooksIncome.value).toBe(200_000);
    expect(r.grossTotalIncome.value).toBe(700_000);
    expect(r.newRegime.totalIncome.value).toBe(625_000);
    expect(r.oldRegime.totalIncome.value).toBe(650_000);
  });

  it("a refused row contributes nothing to any total (no silent inclusion)", () => {
    const r = computeTax(
      makeInput({
        income: [{ id: "s1", category: "salary", amount: 500_000, sourceType: "Form16" }],
        businessBooksEntries: [booksEntry({ adjustments: "depreciation_s32" })],
      }),
    );
    expect(r.oldRegime.businessBooksIncome.value).toBe(0);
    expect(r.grossTotalIncome.value).toBe(500_000);
  });

  it("a case with no books row computes exactly what it computed before K4-14", () => {
    const before = computeTax(makeInput({ income: [{ id: "s1", category: "salary", amount: 900_000, sourceType: "Form16" }] }));
    const withEmptyArray = computeTax(
      makeInput({
        income: [{ id: "s1", category: "salary", amount: 900_000, sourceType: "Form16" }],
        businessBooksEntries: [],
      }),
    );
    expect(withEmptyArray.grossTotalIncome.value).toBe(before.grossTotalIncome.value);
    expect(withEmptyArray.newRegime.grossTaxLiability.value).toBe(before.newRegime.grossTaxLiability.value);
  });
});
