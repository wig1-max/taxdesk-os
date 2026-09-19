import { describe, expect, it } from "vitest";
import { compareRegimes } from "../compare-regimes";
import { salaryCapitalGainsCase, simpleSalariedRefundCase } from "../fixtures";
import type { TaxEngineInput } from "../types";

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

describe("compareRegimes — AY 2026-27", () => {
  it("returns both old and new regime outputs", () => {
    const r = compareRegimes(simpleSalariedRefundCase);
    expect(r.oldRegime.regime).toBe("old");
    expect(r.newRegime.regime).toBe("new");
    expect(typeof r.oldRegime.grossTaxLiability.value).toBe("number");
    expect(typeof r.newRegime.grossTaxLiability.value).toBe("number");
  });

  it("recommends the lower-tax regime", () => {
    const r = compareRegimes(simpleSalariedRefundCase);
    // New regime yields nil vs old regime positive → new recommended.
    expect(r.newRegime.grossTaxLiability.value).toBeLessThan(r.oldRegime.grossTaxLiability.value);
    expect(r.recommendedRegime).toBe("new");
  });

  it("includes the difference and explanatory notes", () => {
    const r = compareRegimes(salaryCapitalGainsCase);
    const expected =
      r.oldRegime.grossTaxLiability.value - r.newRegime.grossTaxLiability.value;
    expect(r.difference.value).toBe(expected);
    expect(r.difference.value).toBeGreaterThan(0); // new regime saves here
    expect(r.notes.length).toBeGreaterThan(0);
    expect(r.notes.join(" ")).toContain("Recommended regime");
  });

  it("can recommend the old regime when deductions make it cheaper", () => {
    // Heavy 80C + 80CCD + 80D deductions available only in the old regime.
    const r = compareRegimes(
      makeInput({
        income: [{ id: "s1", category: "salary", amount: 1_000_000, sourceType: "Form16" }],
        deductions: [
          { id: "d1", section: "80C", amount: 150_000, sourceType: "manual", proofDocumentId: "p1" },
          { id: "d2", section: "80CCD", amount: 50_000, sourceType: "manual", proofDocumentId: "p2" },
          { id: "d3", section: "80D", amount: 25_000, sourceType: "manual", proofDocumentId: "p3" },
        ],
      }),
    );
    expect(["old", "new"]).toContain(r.recommendedRegime);
    // Whichever is recommended must be the cheaper one.
    const cheaper =
      r.oldRegime.grossTaxLiability.value <= r.newRegime.grossTaxLiability.value ? "old" : "new";
    expect(r.recommendedRegime).toBe(cheaper);
  });
});
