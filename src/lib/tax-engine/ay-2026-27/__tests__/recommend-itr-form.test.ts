import { describe, expect, it } from "vitest";
import { recommendItrForm } from "../recommend-itr-form";
import { salaryCapitalGainsCase, simpleSalariedRefundCase } from "../fixtures";
import type { TaxEngineInput } from "../types";

describe("recommendItrForm — AY 2026-27", () => {
  it("allows ITR-1 for a simple salary / interest / dividend case", () => {
    const r = recommendItrForm(simpleSalariedRefundCase);
    expect(r.recommendedItrType).toBe("ITR-1");
    expect(r.blockers).toHaveLength(0);
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it("recommends ITR-2 when capital gains are present", () => {
    const r = recommendItrForm(salaryCapitalGainsCase);
    expect(r.recommendedItrType).toBe("ITR-2");
  });

  it("blocks ITR-1 when capital gains are present", () => {
    const r = recommendItrForm(salaryCapitalGainsCase);
    expect(r.blockers.length).toBeGreaterThan(0);
    expect(r.blockers.join(" ")).toContain("Capital gains");
  });

  it("blocks ITR-1 when foreign assets are flagged", () => {
    const r = recommendItrForm({ ...simpleSalariedRefundCase, hasForeignAssets: true });
    expect(r.recommendedItrType).toBe("ITR-2");
    expect(r.blockers.join(" ")).toContain("Foreign assets");
  });

  it("K4-06: allows ITR-1 (note only, no blocker) for a house property with no loss under the recommended regime", () => {
    const r = recommendItrForm({
      ...simpleSalariedRefundCase,
      housePropertyEntries: [
        {
          id: "hp1",
          amount: 0,
          sourceType: "manual",
          usage: "self_occupied",
          annualRentReceived: 0,
          municipalTaxesPaid: 0,
          homeLoanInterest: 150_000,
        },
      ],
    });
    // The new regime disallows self-occupied interest entirely (115BAC), so
    // its house-property figure is 0, never negative — no blocker. (A true
    // OLD-regime-recommended-with-a-loss case could not be constructed under
    // the current AY 2026-27 rate structure: the wider new-regime 87A rebate
    // makes the new regime win or tie in every income range tried, and a tie
    // recommends "new" — see compute-tax.test.ts for the underlying
    // Section 71(3A) cap, which IS directly unit-tested there.)
    expect(r.blockers).toHaveLength(0);
    expect(r.notes.join(" ")).toContain("House property present");
  });

  it("K4-07: positively recommends ITR-4 when presumptive-44ADA income is the ONLY blocker", () => {
    const r = recommendItrForm({
      ...simpleSalariedRefundCase,
      income: [
        ...simpleSalariedRefundCase.income,
        { id: "p1", category: "presumptive_professional_44ada", amount: 800_000, sourceType: "manual" },
      ],
    });
    expect(r.blockers).toHaveLength(1);
    expect(r.recommendedItrType).toBe("ITR-4");
    expect(r.reasons.join(" ")).toContain("Section 44ADA");
  });

  it("K4-07: falls back to ITR-2 with a CA-review note when presumptive-44ADA income is combined with capital gains", () => {
    const r = recommendItrForm({
      ...salaryCapitalGainsCase,
      income: [
        ...salaryCapitalGainsCase.income,
        { id: "p1", category: "presumptive_professional_44ada", amount: 800_000, sourceType: "manual" },
      ],
    });
    expect(r.blockers.length).toBeGreaterThan(1);
    expect(r.recommendedItrType).toBe("ITR-2");
    expect(r.notes.join(" ")).toContain("ITR-3 vs ITR-4 selection is out of K.2.0 scope");
  });

  it("K4-08: positively recommends ITR-4 when presumptive-44AD income is the ONLY blocker", () => {
    const r = recommendItrForm({
      ...simpleSalariedRefundCase,
      income: [
        ...simpleSalariedRefundCase.income,
        { id: "d1", category: "presumptive_business_44ad_digital", amount: 1_000_000, sourceType: "manual" },
        { id: "c1", category: "presumptive_business_44ad_cash", amount: 100_000, sourceType: "manual" },
      ],
    });
    expect(r.blockers).toHaveLength(1);
    expect(r.recommendedItrType).toBe("ITR-4");
    expect(r.reasons.join(" ")).toContain("Section 44AD");
  });

  // The generalisation that mattered: each scheme contributes its OWN ITR-1
  // blocker, so a naive `blockers.length === 1` test would have silently
  // dropped a legitimate presumptive-only case to the ITR-2 fallback.
  it("K4-08: still recommends ITR-4 when BOTH 44AD and 44ADA income are present and nothing else blocks", () => {
    const r = recommendItrForm({
      ...simpleSalariedRefundCase,
      income: [
        ...simpleSalariedRefundCase.income,
        { id: "p1", category: "presumptive_professional_44ada", amount: 800_000, sourceType: "manual" },
        { id: "d1", category: "presumptive_business_44ad_digital", amount: 1_000_000, sourceType: "manual" },
      ],
    });
    expect(r.blockers).toHaveLength(2);
    expect(r.recommendedItrType).toBe("ITR-4");
    expect(r.reasons.join(" ")).toContain("Section 44ADA");
    expect(r.reasons.join(" ")).toContain("Section 44AD");
  });

  it("K4-08: falls back to ITR-2 with a CA-review note when presumptive-44AD income is combined with capital gains", () => {
    const r = recommendItrForm({
      ...salaryCapitalGainsCase,
      income: [
        ...salaryCapitalGainsCase.income,
        { id: "d1", category: "presumptive_business_44ad_digital", amount: 1_000_000, sourceType: "manual" },
      ],
    });
    expect(r.blockers.length).toBeGreaterThan(1);
    expect(r.recommendedItrType).toBe("ITR-2");
    expect(r.notes.join(" ")).toContain("ITR-3 vs ITR-4 selection is out of K.2.0 scope");
  });
});

/** Minimal input builder for the K4-14 cases below. */
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

// ---------------------------------------------------------------------------
// K4-14 — books-based business/profession income resolves to ITR-3
// ---------------------------------------------------------------------------

describe("recommendItrForm — books-based business (K4-14)", () => {
  const books = {
    id: "bk1",
    amount: 600_000,
    sourceType: "manual" as const,
    revenue: 3_000_000,
    expenses: 2_400_000,
    isProfession: false,
    adjustments: "none_s30_43d" as const,
    activityClassification: "ordinary_business_or_profession" as const,
  };
  const salary = { id: "s1", category: "salary" as const, amount: 500_000, sourceType: "Form16" as const };

  it("resolves POSITIVELY to ITR-3, not the conservative ITR-2 fallback", () => {
    const r = recommendItrForm(makeInput({ income: [salary], businessBooksEntries: [books] }));
    expect(r.recommendedItrType).toBe("ITR-3");
    expect(r.blockers.some((b) => b.includes("Books-based business"))).toBe(true);
  });

  it("DOMINATES presumptive income — a mixed case is ITR-3, never ITR-4", () => {
    // ITR-4 admits presumptive income only, so it cannot carry the books
    // figure; this ordering is asserted rather than left to blocker counting.
    const r = recommendItrForm(
      makeInput({
        income: [
          salary,
          {
            id: "p1",
            category: "presumptive_professional_44ada",
            amount: 800_000,
            sourceType: "manual",
          },
        ],
        businessBooksEntries: [books],
      }),
    );
    expect(r.recommendedItrType).toBe("ITR-3");
  });

  it("DOMINATES capital gains too — ITR-2 carries no business income at all", () => {
    const r = recommendItrForm(
      makeInput({
        income: [salary],
        businessBooksEntries: [books],
        capitalGains: [
          { id: "cg1", category: "stcg_111a", sourceType: "broker_report", amount: 0, taxable_gain: 200_000 },
        ],
      }),
    );
    expect(r.recommendedItrType).toBe("ITR-3");
  });

  it("discloses the Section 115BAC(6) / Form 10-IEA regime-option condition", () => {
    const r = recommendItrForm(makeInput({ income: [salary], businessBooksEntries: [books] }));
    expect(r.notes.some((n) => n.includes("Form 10-IEA"))).toBe(true);
  });

  // AUDIT-08-F2 / decision D243 — this assertion is DELIBERATELY REPLACED, and
  // recorded rather than changed quietly (PROJECT_CONSTITUTION.md §4).
  //
  // `K4-14` asserted that a break-even books row yields **ITR-1**. That was an
  // intentional choice, not an oversight, which is why it is corrected by a
  // decision instead of a bug fix — but it is wrong, and ITR-1 is the clearest
  // possible proof: Sahaj admits NO business or professional income at all,
  // and this case carries ₹5,00,000 of books revenue alongside salary. The
  // adapter refuses only a NEGATIVE bottom line, so a break-even business
  // arrives as a fully ACCEPTED, computable entry — the taxpayer has business
  // income; it simply nets to zero.
  //
  // The old test also silently contradicted the two "DOMINATES" cases above
  // and `D241` itself, because both only ever exercised a POSITIVE net profit.
  // At the break-even boundary the dominance inverted: the same case resolved
  // to ITR-4 with presumptive income and ITR-2 with capital gains — both forms
  // this file's own comments say cannot carry books income — and the ITR-4
  // branch printed "with no ... books-based business income" about a case that
  // had some.
  it("D243: a break-even books row is still ITR-3 — form follows nature, not magnitude", () => {
    const breakEven = { ...books, amount: 0, revenue: 500_000, expenses: 500_000 };
    const r = recommendItrForm(makeInput({ income: [salary], businessBooksEntries: [breakEven] }));
    expect(r.recommendedItrType).toBe("ITR-3");
    expect(r.blockers.some((b) => b.includes("Books-based business"))).toBe(true);
  });

  it("D243: dominance holds at break-even too — over presumptive (was ITR-4)", () => {
    const breakEven = { ...books, amount: 0, revenue: 500_000, expenses: 500_000 };
    const r = recommendItrForm(
      makeInput({
        income: [
          salary,
          { id: "p1", category: "presumptive_professional_44ada", amount: 800_000, sourceType: "manual" },
        ],
        businessBooksEntries: [breakEven],
      }),
    );
    expect(r.recommendedItrType).toBe("ITR-3");
    // The ITR-4 branch's own reason text claims books income is absent; it must
    // not be reachable for a case that has some.
    expect(r.reasons.join(" ")).not.toContain("ITR-4 (Sugam) applies");
  });

  it("D243: dominance holds at break-even too — over capital gains (was ITR-2)", () => {
    const breakEven = { ...books, amount: 0, revenue: 500_000, expenses: 500_000 };
    const r = recommendItrForm(
      makeInput({
        income: [salary],
        businessBooksEntries: [breakEven],
        capitalGains: [
          { id: "cg1", category: "stcg_111a", sourceType: "broker_report", amount: 0, taxable_gain: 200_000 },
        ],
      }),
    );
    expect(r.recommendedItrType).toBe("ITR-3");
  });

  it("D243: a case with NO books row is unaffected — ITR-1 still reachable", () => {
    // Guards the guard: the fix must not make every case ITR-3.
    const r = recommendItrForm(makeInput({ income: [salary] }));
    expect(r.recommendedItrType).toBe("ITR-1");
  });

  it("K4-17: an admitted negative source still resolves the non-negative books head to ITR-3", () => {
    const loss = { ...books, id: "bk_loss", amount: -400_000, revenue: 100_000, expenses: 500_000 };
    const r = recommendItrForm(
      makeInput({ income: [salary], businessBooksEntries: [books, loss] }),
    );
    expect(r.recommendedItrType).toBe("ITR-3");
    expect(r.blockers.some((b) => b.includes("Books-based business"))).toBe(true);
  });
});
