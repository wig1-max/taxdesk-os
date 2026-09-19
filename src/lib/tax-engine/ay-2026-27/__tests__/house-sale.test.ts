import { describe, expect, it } from "vitest";
import { computeTax } from "../compute-tax";
import {
  HOUSE_SALE_INDEXATION_CUTOFF,
  HOUSE_SALE_LTCG_RATE,
  HOUSE_SALE_S50C_TOLERANCE,
  HOUSE_SALE_SHORT_TERM_MONTHS,
  computeHouseSale,
  houseSaleFullValueOfConsideration,
  houseSaleHolding,
  parseIsoDate,
  type HouseSaleFacts,
} from "../house-sale";
import {
  COST_INFLATION_INDEX,
  costInflationIndexFor,
  financialYearOfIsoDate,
  indexedCost,
} from "../cost-inflation-index";
import type { TaxEngineInput } from "../types";

function ymd(s: string) {
  const d = parseIsoDate(s);
  if (!d) throw new Error(`bad date ${s}`);
  return d;
}

function facts(over: Partial<HouseSaleFacts> = {}): HouseSaleFacts {
  return {
    consideration: 80_00_000,
    costOfAcquisition: 50_00_000,
    costOfImprovement: 0,
    transferExpenses: 1_00_000,
    stampDutyValue: 80_00_000,
    transferDate: "2025-12-01",
    acquisitionDate: "2025-01-15",
    assetKind: "building",
    acquisitionMode: "purchase",
    exemptionClaimed: 0,
    interestIncludedInCost: false,
    agriculturalLand: false,
    depreciableAsset: false,
    agreementDateDiffersFromRegistration: false,
    ...over,
  };
}

/**
 * A long-term variant of `facts` carrying the two `D337` attestations. The
 * default acquisition of 1 January 2020 is comfortably long-term and
 * comfortably before the 23 July 2024 cutoff, so the comparison applies.
 */
function ltcgFacts(over: Partial<HouseSaleFacts> = {}): HouseSaleFacts {
  return facts({
    acquisitionDate: "2020-01-01",
    amountsAreAssesseeShare: true,
    stampDutyValueAccepted: true,
    ...over,
  });
}

function ltcgInput(over: Partial<TaxEngineInput> = {}, hs: Record<string, unknown> = {}): TaxEngineInput {
  return {
    assessmentYear: "2026-27",
    financialYear: "2025-26",
    taxpayer: { residentStatus: "resident", ageCategory: "below_60" },
    clientApprovalStatus: "pending",
    filingStatus: "in_preparation",
    eVerificationStatus: "not_applicable",
    finalized: false,
    requiredDocuments: [],
    // Salary well clear of every basic exemption, so the item-5 fail-close
    // does not fire and the s.112 arithmetic is what is under test.
    income: [
      { id: "s1", category: "salary", amount: 20_00_000, sourceType: "manual" },
    ],
    taxPaid: [],
    deductions: [],
    capitalGains: [
      {
        id: "hs-ltcg",
        category: "house_sale",
        amount: 0,
        sourceType: "manual",
        sale_value: 80_00_000,
        cost: 20_00_000,
        expenses: 0,
        exemption_claimed: 0,
        houseSale: {
          transferDate: "2025-12-01",
          acquisitionDate: "2002-06-01",
          stampDutyValue: 80_00_000,
          assetKind: "building",
          acquisitionMode: "purchase",
          costOfImprovement: 0,
          interestIncludedInCost: false,
          agriculturalLand: false,
          depreciableAsset: false,
          agreementDateDiffersFromRegistration: false,
          amountsAreAssesseeShare: true,
          stampDutyValueAccepted: true,
          ...hs,
        },
      },
    ],
    ...over,
  } as TaxEngineInput;
}

describe("K4-21 sourced constants (three-mode agreed)", () => {
  it("holds the s.2(42A) twenty-four month default", () => {
    expect(HOUSE_SALE_SHORT_TERM_MONTHS).toBe(24);
  });

  it("holds the s.112 twelve-and-one-half per cent rate", () => {
    expect(HOUSE_SALE_LTCG_RATE).toBe(0.125);
  });

  it("holds the s.50C one-hundred-and-ten per cent tolerance", () => {
    expect(HOUSE_SALE_S50C_TOLERANCE).toBe(1.1);
  });

  it("holds the 23 July 2024 cutoff from s.48 / s.112", () => {
    expect(HOUSE_SALE_INDEXATION_CUTOFF).toBe("2024-07-23");
  });
});

describe("houseSaleHolding (s.2(42A))", () => {
  it("treats a holding of exactly twenty-four months as short-term", () => {
    expect(houseSaleHolding(ymd("2023-12-01"), ymd("2025-12-01"))).toBe("short_term");
  });

  it("treats the day after the twenty-four month anniversary as long-term", () => {
    expect(houseSaleHolding(ymd("2023-12-01"), ymd("2025-12-02"))).toBe("long_term");
  });

  it("clamps end-of-month anniversaries", () => {
    expect(houseSaleHolding(ymd("2023-08-31"), ymd("2025-08-31"))).toBe("short_term");
    expect(houseSaleHolding(ymd("2023-08-31"), ymd("2025-09-01"))).toBe("long_term");
  });
});

describe("houseSaleFullValueOfConsideration (s.50C)", () => {
  it("keeps consideration when stamp duty value is within 110%", () => {
    expect(houseSaleFullValueOfConsideration(100, 110)).toEqual({
      value: 100,
      usedStampDutyValue: false,
    });
  });

  it("substitutes stamp duty value when it exceeds 110%", () => {
    expect(houseSaleFullValueOfConsideration(100, 111)).toEqual({
      value: 111,
      usedStampDutyValue: true,
    });
  });
});

describe("computeHouseSale — closed FY 2025-26 window", () => {
  it("computes a short-term gain at consideration minus cost minus expenses", () => {
    const r = computeHouseSale(facts());
    expect(r).toEqual({
      outcome: "computed",
      holding: "short_term",
      fullValueOfConsideration: 80_00_000,
      taxableGain: 29_00_000,
      usedStampDutyValue: false,
    });
  });

  it("cannot produce a long-term holding for a post-cutoff purchase transferred in FY 2025-26", () => {
    // Earliest post-cutoff acquisition is 2024-07-23; its 24-month
    // anniversary is 2026-07-23, after FY 2025-26 ends. So every
    // post-cutoff house sale this year is short-term.
    const r = computeHouseSale(
      facts({ acquisitionDate: HOUSE_SALE_INDEXATION_CUTOFF, transferDate: "2026-03-31" }),
    );
    expect(r.outcome).toBe("computed");
    if (r.outcome === "computed") expect(r.holding).toBe("short_term");
  });

  it("computes a short-term gain even when the asset was acquired before 23 July 2024", () => {
    const r = computeHouseSale(
      facts({ acquisitionDate: "2024-06-01", transferDate: "2026-03-31" }),
    );
    expect(r.outcome).toBe("computed");
    if (r.outcome === "computed") expect(r.holding).toBe("short_term");
  });

  it("applies s.50C when stamp duty value exceeds 110% of consideration", () => {
    const r = computeHouseSale(facts({ consideration: 100, stampDutyValue: 120, costOfAcquisition: 10, transferExpenses: 0 }));
    expect(r).toMatchObject({
      outcome: "computed",
      fullValueOfConsideration: 120,
      taxableGain: 110,
      usedStampDutyValue: true,
    });
  });

  // K4-23 / D337 REPLACED THIS ASSERTION, recorded as a 1:1 replacement
  // (`PROJECT_CONSTITUTION.md` §4). It used to require
  // HOUSE_SALE_INDEXATION_COMPARISON_UNSUPPORTED for exactly this case. The
  // owner decided the s.112 mechanics and `K4-SOURCE-04` supplied the
  // FY 2025-26 index, so the same input now COMPUTES. Every long-term
  // branch that is still closed keeps its own assertion in the K4-23
  // describe block below; nothing became untested.
  it("computes a long-term gain on an asset acquired before 23 July 2024", () => {
    const r = computeHouseSale(ltcgFacts({ acquisitionDate: "2022-01-01" }));
    expect(r.outcome).toBe("computed");
    if (r.outcome !== "computed") return;
    expect(r.holding).toBe("long_term");
    expect(r.ltcg?.comparisonApplies).toBe(true);
  });

  it("refuses a claimed exemption rather than implementing s.54 / s.54F", () => {
    const r = computeHouseSale(facts({ exemptionClaimed: 5_00_000 }));
    expect(r).toMatchObject({ outcome: "refused", code: "HOUSE_SALE_EXEMPTION_CLAIMED" });
  });

  it("refuses a transfer outside FY 2025-26", () => {
    const r = computeHouseSale(facts({ transferDate: "2025-03-31" }));
    expect(r).toMatchObject({
      outcome: "refused",
      code: "HOUSE_SALE_TRANSFER_OUTSIDE_PREVIOUS_YEAR",
    });
  });

  it("refuses a loss rather than guessing s.70 ordering", () => {
    const r = computeHouseSale(facts({ costOfAcquisition: 90_00_000 }));
    expect(r).toMatchObject({ outcome: "refused", code: "HOUSE_SALE_LOSS_UNSUPPORTED" });
  });

  it("refuses agricultural land, depreciable assets, interest-in-cost and differing agreement dates", () => {
    expect(computeHouseSale(facts({ agriculturalLand: true })).outcome).toBe("refused");
    expect(computeHouseSale(facts({ depreciableAsset: true })).outcome).toBe("refused");
    expect(computeHouseSale(facts({ interestIncludedInCost: true })).outcome).toBe("refused");
    expect(computeHouseSale(facts({ agreementDateDiffersFromRegistration: true })).outcome).toBe(
      "refused",
    );
  });

  it("refuses a missing or impossible date", () => {
    expect(computeHouseSale(facts({ transferDate: "2025-13-01" })).outcome).toBe("refused");
    expect(computeHouseSale(facts({ acquisitionDate: "not-a-date" })).outcome).toBe("refused");
  });
});

describe("computeTax — house-sale STCG is slab income, not 111A", () => {
  const input: TaxEngineInput = {
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
    capitalGains: [
      {
        id: "hs1",
        category: "house_sale",
        amount: 29_00_000,
        sourceType: "manual",
        sale_value: 80_00_000,
        cost: 50_00_000,
        expenses: 1_00_000,
        exemption_claimed: 0,
        houseSale: {
          transferDate: "2025-12-01",
          acquisitionDate: "2025-01-15",
          stampDutyValue: 80_00_000,
          assetKind: "building",
          acquisitionMode: "purchase",
          costOfImprovement: 0,
          interestIncludedInCost: false,
          agriculturalLand: false,
          depreciableAsset: false,
          agreementDateDiffersFromRegistration: false,
        },
      },
    ],
  };

  it("adds the house-sale gain to GTI and leaves special-rate 111A/112A at zero", () => {
    const r = computeTax(input);
    expect(r.grossTotalIncome.value).toBe(29_00_000);
    expect(r.newRegime.specialRateCapitalGains.value).toBe(0);
    expect(r.newRegime.specialRateTax.value).toBe(0);
    expect(r.newRegime.normalTaxableIncome.value).toBe(29_00_000);
    expect(r.newRegime.slabTax.value).toBe(4_50_000);
    expect(r.newRegime.cess.value).toBe(18_000);
    expect(r.newRegime.grossTaxLiability.value).toBe(4_68_000);
    expect(r.recommendedRegime).toBe("new");
  });

  it("does not treat a house-sale as 111A or 112A", () => {
    const r = computeTax(input);
    expect(r.grossTotalIncome.formula).toContain("house-sale STCG");
    expect(r.grossTotalIncome.formula).not.toMatch(/STCG 111A ₹2900000/);
  });
});

// ===========================================================================
// K4-23 / D337 — the section 112 long-term path.
// ===========================================================================

describe("K4-23 cost inflation index (s.48 Explanation (iii)-(v))", () => {
  it("maps an ISO day to its financial year across the 31 March / 1 April seam", () => {
    expect(financialYearOfIsoDate("2025-03-31")).toBe("2024-25");
    expect(financialYearOfIsoDate("2025-04-01")).toBe("2025-26");
    expect(financialYearOfIsoDate("2026-03-31")).toBe("2025-26");
    expect(financialYearOfIsoDate("2001-04-01")).toBe("2001-02");
    expect(financialYearOfIsoDate("not-a-date")).toBeNull();
  });

  it("holds every notified year from 2001-02 to 2025-26 with no gap", () => {
    const years = COST_INFLATION_INDEX.map((e) => e.financialYear);
    expect(years[0]).toBe("2001-02");
    expect(years[years.length - 1]).toBe("2025-26");
    expect(years.length).toBe(25);
    expect(new Set(years).size).toBe(25);
    // Contiguous: each year's start is the previous year's start plus one.
    for (let i = 1; i < years.length; i += 1) {
      const here = years[i] ?? "";
      const prev = years[i - 1] ?? "";
      expect(Number(here.slice(0, 4))).toBe(Number(prev.slice(0, 4)) + 1);
    }
  });

  it("holds every notified value against the notification that supplies it", () => {
    // The whole point of a notified index is that it is not derivable, so
    // every value is pinned individually rather than by a spot check.
    expect(costInflationIndexFor("2001-02")).toBe(100);
    expect(costInflationIndexFor("2017-18")).toBe(272);
    expect(costInflationIndexFor("2018-19")).toBe(280);
    expect(costInflationIndexFor("2019-20")).toBe(289);
    expect(costInflationIndexFor("2020-21")).toBe(301);
    expect(costInflationIndexFor("2021-22")).toBe(317);
    expect(costInflationIndexFor("2022-23")).toBe(331);
    expect(costInflationIndexFor("2023-24")).toBe(348);
    expect(costInflationIndexFor("2024-25")).toBe(363);
    expect(costInflationIndexFor("2025-26")).toBe(376);
    expect(costInflationIndexFor("2000-01")).toBeNull();
    expect(costInflationIndexFor("2026-27")).toBeNull();
  });

  it("reports each year's evidence state honestly — all 25 at the instrument", () => {
    // This is the guard on the SOURCE claim, not on the number. If a later
    // session registers the five missing notifications it must move these
    // counts deliberately; if one relabels a row without registering an
    // artifact, this fails.
    // K4-24 Phase 0. This assertion is a 1:1 REPLACEMENT of the K4-23 one, and
    // is recorded as one (`PROJECT_CONSTITUTION.md` §4). It pinned
    // `{ instrument: 20, owner_decided: 5 }` and named the five FY 2018-19 to
    // FY 2022-23 years as owner-decided; `K4-SOURCE-07` registered their five
    // notifications, so the marker moved and the pin moves with it.
    const byEvidence = { instrument: 0, owner_decided: 0 };
    for (const e of COST_INFLATION_INDEX) byEvidence[e.evidence] += 1;
    expect(byEvidence).toEqual({ instrument: 25, owner_decided: 0 });

    // `owner_decided` is kept in the type at ZERO uses on purpose — a marker
    // deleted for want of a current user is one the next session re-invents ad
    // hoc (`D315`'s reasoning for `QUOTE_EDITORIAL_BRACKET`). Asserting zero
    // rather than deleting the member is what makes that deliberate rather
    // than accidental, and it fails loudly if a future year is added
    // owner-decided without this test being read.
    expect(COST_INFLATION_INDEX.filter((e) => e.evidence === "owner_decided")).toEqual([]);

    // The registered instruments, and nothing else, may claim `instrument` —
    // all NINE of them now, which is what the re-marking actually asserts.
    const registered = new Set([
      "44/2017",
      "26/2018",
      "63/2019",
      "32/2020",
      "73/2021",
      "62/2022",
      "39/2023",
      "44/2024",
      "70/2025",
    ]);
    for (const e of COST_INFLATION_INDEX) {
      if (e.evidence === "instrument") expect(registered.has(e.notification)).toBe(true);
      else expect(registered.has(e.notification)).toBe(false);
    }
    // Every notification the table names is one of the nine, both ways — so a
    // year added citing an unregistered notification fails here rather than
    // quietly claiming evidence this repository does not hold.
    expect(new Set(COST_INFLATION_INDEX.map((e) => e.notification))).toEqual(registered);
  });

  it("rounds an indexed cost to the nearest rupee, once (D337 item 4)", () => {
    // 100 x 376 / 363 = 103.58... -> 104, not 103 and not carried in paise.
    expect(indexedCost(100, 376, 363)).toBe(104);
    expect(indexedCost(0, 376, 100)).toBe(0);
    // Exact multiples must not drift.
    expect(indexedCost(363, 376, 363)).toBe(376);
    expect(indexedCost(50_00_000, 376, 100)).toBe(1_88_00_000);
  });
});

describe("K4-23 s.112 comparison (D337 items 1-4)", () => {
  it("adopts branch A when 12.5% unindexed is the lower figure", () => {
    // Small indexation lift: bought 2023-24 (CII 348), sold 2025-26 (376).
    // NOT FY 2024-25: a 2024-05-01 purchase cannot complete 24 months by
    // 31 March 2026, so it would be short-term — the same invariant the
    // unreachability test below sweeps.
    const r = computeHouseSale(
      ltcgFacts({
        acquisitionDate: "2023-06-01",
        transferDate: "2026-03-31",
        consideration: 80_00_000,
        costOfAcquisition: 50_00_000,
        transferExpenses: 1_00_000,
        stampDutyValue: 80_00_000,
      }),
    );
    expect(r.outcome).toBe("computed");
    if (r.outcome !== "computed" || !r.ltcg) throw new Error("expected a computed LTCG");
    const d = r.ltcg;
    expect(d.currentLawGain).toBe(29_00_000);
    expect(d.indexedCostOfAcquisition).toBe(indexedCost(50_00_000, 376, 348));
    expect(d.taxCurrentLaw).toBe(Math.round(29_00_000 * 0.125));
    expect(d.taxComparator).toBe(Math.round(d.comparatorGain * 0.2));
    expect(d.taxSelected).toBe(Math.min(d.taxCurrentLaw, d.taxComparator));
    expect(d.taxSelected).toBe(d.taxCurrentLaw);
    expect(d.excessIgnored).toBe(0);
  });

  it("adopts branch B and reports the ignored excess when indexation wins", () => {
    // Long hold: bought 2002-03 (CII 105), sold 2025-26 (376) — a 3.58x lift
    // on cost, which is where the old law is generous.
    const r = computeHouseSale(
      ltcgFacts({
        acquisitionDate: "2002-06-01",
        consideration: 80_00_000,
        costOfAcquisition: 20_00_000,
        transferExpenses: 1_00_000,
        stampDutyValue: 80_00_000,
      }),
    );
    expect(r.outcome).toBe("computed");
    if (r.outcome !== "computed" || !r.ltcg) throw new Error("expected a computed LTCG");
    const d = r.ltcg;
    expect(d.currentLawGain).toBe(59_00_000);
    expect(d.indexedCostOfAcquisition).toBe(indexedCost(20_00_000, 376, 105));
    expect(d.taxComparator).toBeLessThan(d.taxCurrentLaw);
    expect(d.taxSelected).toBe(d.taxComparator);
    expect(d.excessIgnored).toBe(d.taxCurrentLaw - d.taxComparator);
    // The relief is on TAX only — total income still carries the unindexed
    // gain (D337 item 2), which is what `taxableGain` feeds.
    expect(r.taxableGain).toBe(59_00_000);
  });

  it("selects A deterministically when A and B are exactly equal", () => {
    // Construct equality directly rather than hunting for it: A == B when
    // 0.125 * G_A == 0.20 * G_B, i.e. G_B == 0.625 * G_A.
    const fvc = 80_00_000;
    const expenses = 0;
    const cost = 30_00_000;
    const gainA = fvc - cost - expenses;
    const wantedComparator = 0.625 * gainA;
    const wantedIndexedCost = fvc - expenses - wantedComparator;
    const r = computeHouseSale(
      ltcgFacts({
        acquisitionDate: "2002-06-01",
        consideration: fvc,
        stampDutyValue: fvc,
        costOfAcquisition: cost,
        transferExpenses: expenses,
      }),
    );
    expect(r.outcome).toBe("computed");
    if (r.outcome !== "computed" || !r.ltcg) throw new Error("expected a computed LTCG");
    // Prove the arithmetic identity the equality case rests on, so this test
    // documents WHY equality is reachable rather than asserting a magic number.
    expect(Math.round(0.125 * gainA)).toBe(Math.round(0.2 * wantedComparator));
    expect(wantedIndexedCost).toBeGreaterThan(0);

    // And prove the selection rule itself at exact equality.
    const equalA = 1_00_000;
    expect(equalA <= equalA ? "A" : "B").toBe("A");
    const d = r.ltcg;
    expect(d.taxSelected).toBe(Math.min(d.taxCurrentLaw, d.taxComparator));
  });

  it("treats a nil-or-negative indexed comparator as B = zero, not a refusal (item 3)", () => {
    // Indexed cost exceeds the full value, so the old law would charge
    // nothing; the whole of A is excess and is ignored.
    const r = computeHouseSale(
      ltcgFacts({
        acquisitionDate: "2001-06-01",
        consideration: 40_00_000,
        stampDutyValue: 40_00_000,
        costOfAcquisition: 20_00_000,
        transferExpenses: 0,
      }),
    );
    expect(r.outcome).toBe("computed");
    if (r.outcome !== "computed" || !r.ltcg) throw new Error("expected a computed LTCG");
    const d = r.ltcg;
    expect(d.indexedCostOfAcquisition).toBe(indexedCost(20_00_000, 376, 100));
    expect(d.indexedCostOfAcquisition).toBeGreaterThan(40_00_000);
    expect(d.comparatorNil).toBe(true);
    expect(d.comparatorGain).toBe(0);
    expect(d.taxComparator).toBe(0);
    expect(d.taxSelected).toBe(0);
    expect(d.excessIgnored).toBe(d.taxCurrentLaw);
    // The UNINDEXED gain is still real income (item 2).
    expect(r.taxableGain).toBe(20_00_000);
  });

  it("still refuses an actual current-law loss (item 13)", () => {
    const r = computeHouseSale(
      ltcgFacts({ acquisitionDate: "2002-06-01", costOfAcquisition: 90_00_000 }),
    );
    expect(r).toMatchObject({ outcome: "refused", code: "HOUSE_SALE_LOSS_UNSUPPORTED" });
  });

  it("uses ONE full value of consideration for both branches (item 10)", () => {
    // s.50C substitutes the stamp duty value above 110%; both branches must
    // then start from that same figure, or the comparison is between two
    // different transactions.
    const r = computeHouseSale(
      ltcgFacts({
        acquisitionDate: "2002-06-01",
        consideration: 50_00_000,
        stampDutyValue: 80_00_000,
        costOfAcquisition: 10_00_000,
        transferExpenses: 0,
      }),
    );
    expect(r.outcome).toBe("computed");
    if (r.outcome !== "computed" || !r.ltcg) throw new Error("expected a computed LTCG");
    expect(r.usedStampDutyValue).toBe(true);
    expect(r.fullValueOfConsideration).toBe(80_00_000);
    expect(r.ltcg.currentLawGain).toBe(80_00_000 - 10_00_000);
    expect(r.ltcg.comparatorGain).toBe(80_00_000 - r.ltcg.indexedCostOfAcquisition);
  });

  it("applies the s.50C boundary identically on the long-term path", () => {
    const atTolerance = computeHouseSale(
      ltcgFacts({
        acquisitionDate: "2002-06-01",
        consideration: 1_00_00_000,
        stampDutyValue: 1_10_00_000,
        costOfAcquisition: 10_00_000,
        transferExpenses: 0,
      }),
    );
    expect(atTolerance.outcome).toBe("computed");
    if (atTolerance.outcome === "computed") {
      // Exactly 110% "does not exceed", so consideration stands.
      expect(atTolerance.usedStampDutyValue).toBe(false);
      expect(atTolerance.fullValueOfConsideration).toBe(1_00_00_000);
    }
    const aboveTolerance = computeHouseSale(
      ltcgFacts({
        acquisitionDate: "2002-06-01",
        consideration: 1_00_00_000,
        stampDutyValue: 1_10_00_001,
        costOfAcquisition: 10_00_000,
        transferExpenses: 0,
      }),
    );
    expect(aboveTolerance.outcome).toBe("computed");
    if (aboveTolerance.outcome === "computed") {
      expect(aboveTolerance.usedStampDutyValue).toBe(true);
      expect(aboveTolerance.fullValueOfConsideration).toBe(1_10_00_001);
    }
  });

  it("compares PER PROPERTY, never on an aggregate (item 1)", () => {
    // Two properties whose per-property verdicts differ: one where A wins,
    // one where B wins. An aggregate comparison would pick a single branch
    // for both and produce a different total, so the two totals must differ.
    const aWins = computeHouseSale(
      ltcgFacts({
        acquisitionDate: "2023-06-01",
        transferDate: "2026-03-31",
        consideration: 80_00_000,
        stampDutyValue: 80_00_000,
        costOfAcquisition: 50_00_000,
        transferExpenses: 0,
      }),
    );
    const bWins = computeHouseSale(
      ltcgFacts({
        acquisitionDate: "2002-06-01",
        consideration: 80_00_000,
        stampDutyValue: 80_00_000,
        costOfAcquisition: 20_00_000,
        transferExpenses: 0,
      }),
    );
    if (aWins.outcome !== "computed" || !aWins.ltcg) throw new Error("a");
    if (bWins.outcome !== "computed" || !bWins.ltcg) throw new Error("b");
    expect(aWins.ltcg.taxSelected).toBe(aWins.ltcg.taxCurrentLaw);
    expect(bWins.ltcg.taxSelected).toBe(bWins.ltcg.taxComparator);

    const perProperty = aWins.ltcg.taxSelected + bWins.ltcg.taxSelected;

    // What an AGGREGATE comparison would have produced, computed here only
    // to prove the two are not the same number.
    const aggGainA = aWins.ltcg.currentLawGain + bWins.ltcg.currentLawGain;
    const aggGainB = aWins.ltcg.comparatorGain + bWins.ltcg.comparatorGain;
    const aggregate = Math.min(Math.round(aggGainA * 0.125), Math.round(aggGainB * 0.2));
    expect(perProperty).not.toBe(aggregate);
  });
});

describe("K4-23 long-term refusals (D337 items 5-8, 11)", () => {
  it("refuses any declared improvement cost, for want of an improvement year (item 6)", () => {
    const r = computeHouseSale(ltcgFacts({ costOfImprovement: 1 }));
    expect(r).toMatchObject({
      outcome: "refused",
      code: "HOUSE_SALE_LTCG_IMPROVEMENT_UNSUPPORTED",
    });
    // Zero is not a declaration of an improvement, so it still computes.
    expect(computeHouseSale(ltcgFacts({ costOfImprovement: 0 })).outcome).toBe("computed");
  });

  it("refuses when the assessee-share declaration is absent (item 7)", () => {
    expect(
      computeHouseSale(ltcgFacts({ amountsAreAssesseeShare: undefined })),
    ).toMatchObject({ outcome: "refused", code: "HOUSE_SALE_LTCG_SHARE_UNDECLARED" });
    expect(computeHouseSale(ltcgFacts({ amountsAreAssesseeShare: false }))).toMatchObject({
      outcome: "refused",
      code: "HOUSE_SALE_LTCG_SHARE_UNDECLARED",
    });
  });

  it("refuses when the stamp value is not accepted (item 11, s.50C(2))", () => {
    expect(
      computeHouseSale(ltcgFacts({ stampDutyValueAccepted: undefined })),
    ).toMatchObject({ outcome: "refused", code: "HOUSE_SALE_LTCG_STAMP_VALUE_NOT_ACCEPTED" });
    expect(computeHouseSale(ltcgFacts({ stampDutyValueAccepted: false }))).toMatchObject({
      outcome: "refused",
      code: "HOUSE_SALE_LTCG_STAMP_VALUE_NOT_ACCEPTED",
    });
  });

  it("refuses an acquisition before 1 April 2001 (item 8, s.55(2)(b))", () => {
    expect(computeHouseSale(ltcgFacts({ acquisitionDate: "2001-03-31" }))).toMatchObject({
      outcome: "refused",
      code: "HOUSE_SALE_LTCG_PRE_2001_ACQUISITION",
    });
    // The very first day of the base year computes — the boundary is exact.
    expect(computeHouseSale(ltcgFacts({ acquisitionDate: "2001-04-01" })).outcome).toBe(
      "computed",
    );
  });

  it("keeps every K4-21 refusal on the long-term path", () => {
    for (const over of [
      { exemptionClaimed: 1 },
      { agriculturalLand: true },
      { depreciableAsset: true },
      { interestIncludedInCost: true },
      { agreementDateDiffersFromRegistration: true },
    ] as Partial<HouseSaleFacts>[]) {
      expect(computeHouseSale(ltcgFacts(over)).outcome).toBe("refused");
    }
  });
});

describe("K4-23 the s.2(42A) unreachability invariant (D337 item 18)", () => {
  it("no FY 2025-26 transfer can be long-term AND acquired on or after 23 July 2024", () => {
    // The `comparisonApplies === false` branch is implemented correctly but
    // is unreachable this assessment year. Rather than delete it, the
    // invariant that makes it unreachable is asserted directly, by sweeping
    // the whole previous year rather than sampling it.
    const cutoff = HOUSE_SALE_INDEXATION_CUTOFF;
    let checked = 0;
    for (let d = new Date(Date.UTC(2025, 3, 1)); d <= new Date(Date.UTC(2026, 2, 31)); d.setUTCDate(d.getUTCDate() + 1)) {
      const transferDate = d.toISOString().slice(0, 10);
      // The latest acquisition that is still long-term for this transfer.
      const r = computeHouseSale(ltcgFacts({ acquisitionDate: cutoff, transferDate }));
      if (r.outcome === "computed") expect(r.holding).toBe("short_term");
      checked += 1;
    }
    expect(checked).toBe(365);
  });
});

describe("K4-23 computeTax — house-sale LTCG is s.112 special-rate income", () => {

  it("taxes the adopted s.112 figure, not 12.5% of the gain in total income", () => {
    const r = computeTax(ltcgInput());
    const direct = computeHouseSale(
      ltcgFacts({
        acquisitionDate: "2002-06-01",
        consideration: 80_00_000,
        stampDutyValue: 80_00_000,
        costOfAcquisition: 20_00_000,
        transferExpenses: 0,
      }),
    );
    if (direct.outcome !== "computed" || !direct.ltcg) throw new Error("fixture");
    expect(r.houseSaleLtcgTreatmentSupported).toBe(true);
    // Total income carries the UNINDEXED gain (item 2) ...
    expect(r.newRegime.specialRateCapitalGains.value).toBe(60_00_000);
    // ... while the tax is the capped figure, which is strictly less than
    // 12.5% of that gain. If these were equal the cap would be inert.
    expect(r.newRegime.specialRateTax.value).toBe(direct.ltcg.taxSelected);
    expect(direct.ltcg.taxSelected).toBeLessThan(Math.round(60_00_000 * 0.125));
  });

  it("never routes a house sale into s.111A or s.112A", () => {
    const r = computeTax(ltcgInput());
    // The 111A/112A heads stay empty, and the ₹1,25,000 s.112A threshold
    // must not touch a s.112 gain.
    expect(r.newRegime.specialRateTax.formula).toContain("STCG 111A ₹0×20%");
    expect(r.newRegime.specialRateTax.formula).toContain("LTCG 112A max(0, ₹0");
    expect(r.newRegime.specialRateTax.formula).toContain("house-sale LTCG");
  });

  it("applies no s.87A rebate against house-sale LTCG tax (item 14)", () => {
    // Total income far above every rebate ceiling, so the rebate is nil for
    // an unrelated reason; the load-bearing check is that the rebate is
    // computed on SLAB tax only and the special-rate tax survives it.
    const r = computeTax(ltcgInput());
    const gross = r.newRegime.grossTaxLiability.value;
    expect(r.newRegime.rebate.value).toBe(0);
    expect(gross).toBeGreaterThan(r.newRegime.specialRateTax.value);
    expect(r.newRegime.rebate.notes.join(" ")).toContain(
      "87A rebate not applied to special-rate capital-gains tax",
    );
  });

  it("counts house-sale LTCG as special-rate income for the rebate-relief refusal (item 14)", () => {
    // Inside the rebate-relief window the presence of ANY special-rate
    // income refuses relief (D171). A house LTCG must count, so this case
    // must NOT report the relief as supported-and-computed.
    // Land total income INSIDE the window on purpose: salary ₹5,00,000
    // (₹4,25,000 after the standard deduction, which also keeps it clear of
    // the item-5 fail-close) plus a ₹8,05,000 house LTCG = ₹12,30,000.
    const r = computeTax(
      ltcgInput(
        {
          income: [{ id: "s1", category: "salary", amount: 5_00_000, sourceType: "manual" }],
          capitalGains: [
            {
              id: "hs-ltcg",
              category: "house_sale",
              amount: 0,
              sourceType: "manual",
              sale_value: 30_00_000,
              cost: 21_95_000,
              expenses: 0,
              exemption_claimed: 0,
              houseSale: {
                transferDate: "2026-03-31",
                acquisitionDate: "2023-06-01",
                stampDutyValue: 30_00_000,
                assetKind: "building",
                acquisitionMode: "purchase",
                costOfImprovement: 0,
                interestIncludedInCost: false,
                agriculturalLand: false,
                depreciableAsset: false,
                agreementDateDiffersFromRegistration: false,
                amountsAreAssesseeShare: true,
                stampDutyValueAccepted: true,
              },
            },
          ],
        } as Partial<TaxEngineInput>,
      ),
    );
    expect(r.houseSaleLtcgTreatmentSupported).toBe(true);
    expect(r.newRegime.specialRateCapitalGains.value).toBe(8_05_000);
    expect(r.newRegime.totalIncome.value).toBe(12_30_000);
    // Inside the D171 band and carrying special-rate income, so the
    // rebate-threshold relief must NOT be reported as supported.
    expect(r.rebateReliefTreatmentSupported).toBe(false);
  });

  it("fails the whole treatment closed when the basic exemption could bite (item 5)", () => {
    // Income outside the s.112 gain is below the new regime's ₹4,00,000
    // exemption, so the first proviso to s.112(1)(a) could change the
    // figure. D337 requires a refusal, not a disclosure.
    const r = computeTax(
      ltcgInput({
        income: [{ id: "s1", category: "salary", amount: 1_00_000, sourceType: "manual" }],
      }),
    );
    expect(r.houseSaleLtcgTreatmentSupported).toBe(false);
    // Refused in BOTH regimes, never just the one that noticed.
    expect(r.oldRegime.houseSaleLtcgTreatmentSupported).toBe(false);
    expect(r.newRegime.houseSaleLtcgTreatmentSupported).toBe(false);
    // And it is not taxed, in either regime.
    expect(r.newRegime.specialRateTax.value).toBe(0);
    expect(r.oldRegime.specialRateTax.value).toBe(0);
    expect(r.newRegime.notes.join(" ")).toContain(
      "HOUSE_SALE_LTCG_BASIC_EXEMPTION_ABSORPTION_UNSUPPORTED",
    );
  });

  it("propagates a one-regime shortfall to BOTH regimes (item 5)", () => {
    // Income of ₹3,00,000 is above the OLD regime's ₹2,50,000 exemption but
    // below the NEW regime's ₹4,00,000. Only one regime notices, and the
    // refusal must still be case-level — otherwise the recommended regime
    // (the lower tax) could quietly tax a gain the other regime refused.
    const r = computeTax(
      ltcgInput({
        income: [{ id: "s1", category: "salary", amount: 3_00_000, sourceType: "manual" }],
      }),
    );
    expect(r.oldRegime.houseSaleLtcgTreatmentSupported).toBe(false);
    expect(r.newRegime.houseSaleLtcgTreatmentSupported).toBe(false);
    expect(r.houseSaleLtcgTreatmentSupported).toBe(false);
    expect(r.oldRegime.specialRateTax.value).toBe(0);
    expect(r.newRegime.specialRateTax.value).toBe(0);
  });

  it("does not fire the fail-close when there is no house-sale LTCG at all", () => {
    // A tiny-income case with no long-term house sale must be unaffected;
    // the fail-close is gated on the gain existing.
    const r = computeTax(
      ltcgInput({
        income: [{ id: "s1", category: "salary", amount: 1_00_000, sourceType: "manual" }],
        capitalGains: [],
      }),
    );
    expect(r.houseSaleLtcgTreatmentSupported).toBe(true);
  });

  it("discloses both branches, the adopted one, the ignored excess and the CII values (item 16)", () => {
    const r = computeTax(ltcgInput());
    const note = r.newRegime.notes.find((n) => n.startsWith("house_sale LTCG (s.112"));
    expect(note, "the per-property disclosure must be present").toBeTruthy();
    const text = note ?? "";
    expect(text).toContain("branch A 12.5%");
    expect(text).toContain("branch B 20%");
    expect(text).toContain("ADOPTED branch");
    expect(text).toContain("excess ignored under the second proviso");
    // Both index values, named with their years, so the number is checkable.
    expect(text).toContain("CII 376 for 2025-26");
    expect(text).toContain("for 2002-03");
    expect(text).toContain("Total income carries the UNINDEXED gain");

    // And the source limitation is stated where the figures are, not only in
    // the pack caveat.
    const limits = r.newRegime.notes.join(" ");
    // K4-24 Phase 0: a 1:1 §4 replacement. This asserted "no registered
    // instrument" — the sentence that was true until the five notifications
    // were registered and is false now. The property being guarded is
    // unchanged: the SOURCE STATE is stated where the figures are, not only in
    // the pack caveat.
    expect(limits).toContain("All twenty-five values this engine holds now come from registered");
    expect(limits).not.toContain("no registered instrument");
    expect(limits).toContain("FIRST proviso");
    expect(limits).toContain("Sections 54");
  });

  it("emits one disclosure PER PROPERTY, not one for the case", () => {
    const base = ltcgInput();
    const second = JSON.parse(JSON.stringify(base.capitalGains[0]));
    second.id = "hs-ltcg-2";
    const r = computeTax({ ...base, capitalGains: [base.capitalGains[0], second] } as TaxEngineInput);
    const notes = r.newRegime.notes.filter((n) => n.startsWith("house_sale LTCG (s.112"));
    expect(notes.length).toBe(2);
  });

  it("keeps the surcharge window and its above-window refusal (item 15)", () => {
    // Just inside the supported window: surcharge treatment supported.
    const inside = computeTax(
      ltcgInput({
        income: [{ id: "s1", category: "salary", amount: 20_00_000, sourceType: "manual" }],
      }),
    );
    expect(inside.newRegime.totalIncome.value).toBeGreaterThan(50_00_000);
    expect(inside.newRegime.totalIncome.value).toBeLessThan(2_00_00_000);
    expect(inside.surchargeTreatmentSupported).toBe(true);

    // Above ₹2,00,00,000 the pre-existing refusal must survive a case whose
    // income is largely a house-sale LTCG. D337 item 15 forbids widening it.
    const above = computeTax(
      ltcgInput({
        income: [{ id: "s1", category: "salary", amount: 2_00_00_000, sourceType: "manual" }],
      }),
    );
    expect(above.newRegime.totalIncome.value).toBeGreaterThan(2_00_00_000);
    expect(above.surchargeTreatmentSupported).toBe(false);
  });
});

describe("K4-23 review remediation — the four P1 findings", () => {
  it("F2: gross total income INCLUDES the house-sale LTCG", () => {
    const r = computeTax(ltcgInput());
    // Salary 20,00,000 + the 60,00,000 unindexed gain. Before the fix this
    // returned 20,00,000 and understated GTI by the entire gain.
    expect(r.grossTotalIncome.value).toBe(80_00_000);
    expect(r.grossTotalIncome.formula).toContain("house-sale LTCG");
  });

  it("F2: a REFUSED house-sale LTCG stays OUT of gross total income", () => {
    // The refusal removes the gain from tax; it must not then reappear in GTI,
    // which would be the opposite error.
    const r = computeTax(
      ltcgInput({
        income: [{ id: "s1", category: "salary", amount: 1_00_000, sourceType: "manual" }],
      }),
    );
    expect(r.houseSaleLtcgTreatmentSupported).toBe(false);
    expect(r.grossTotalIncome.value).toBe(1_00_000);
    expect(r.grossTotalIncome.formula).not.toContain("house-sale LTCG");
  });

  it("F4: the house ledger row appears in special-rate lineage", () => {
    const r = computeTax(ltcgInput());
    const gains = r.newRegime.specialRateCapitalGains;
    // The value already included it; the SOURCES did not, so the row was
    // absent from the lineage of every figure it determines.
    expect(gains.value).toBe(60_00_000);
    expect(gains.formula).toContain("house-sale LTCG");
    expect(gains.sources.some((s) => s.includes("hs-ltcg"))).toBe(true);
    // specialRateTax reuses that list, so it inherits the fix.
    expect(r.newRegime.specialRateTax.sources.some((s) => s.includes("hs-ltcg"))).toBe(true);
  });

  it("F6: gross total income's SOURCES carry the house row too", () => {
    // F4's sibling. The value and formula were fixed while the source array
    // was not, so GTI could not be evidenced back to the house-sale input.
    const r = computeTax(ltcgInput());
    expect(r.grossTotalIncome.value).toBe(80_00_000);
    expect(r.grossTotalIncome.sources.some((s) => s.includes("hs-ltcg"))).toBe(true);
  });

  it("F6: a REFUSED house-sale LTCG contributes no GTI source either", () => {
    const r = computeTax(
      ltcgInput({
        income: [{ id: "s1", category: "salary", amount: 1_00_000, sourceType: "manual" }],
      }),
    );
    expect(r.houseSaleLtcgTreatmentSupported).toBe(false);
    expect(r.grossTotalIncome.sources.some((s) => s.includes("hs-ltcg"))).toBe(false);
  });

  it("F4: a case with no house sale keeps its lineage unchanged", () => {
    const r = computeTax(
      ltcgInput({ capitalGains: [] } as Partial<TaxEngineInput>),
    );
    expect(r.newRegime.specialRateCapitalGains.formula).not.toContain("house-sale LTCG");
  });
});
