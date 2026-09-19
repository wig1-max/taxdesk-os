import { describe, expect, it } from "vitest";
import {
  buildEngineInput,
  hasMeaningfulInput,
  toNum,
  type BroughtForwardLossLedgerRow,
  type BusinessBooksLedgerRow,
  type CaseMeta,
  type LedgerRows,
} from "@/lib/tax-desk/computation-adapter";
import { recommendItrForm } from "@/lib/tax-engine/ay-2026-27";

const META: CaseMeta = {
  assessmentYear: "2026-27",
  financialYear: "2025-26",
  selectedItrType: null,
  finalized: false,
};

function rows(partial: Partial<LedgerRows>): LedgerRows {
  return { income: [], taxPaid: [], deductions: [], capitalGains: [], ...partial };
}

let n = 0;
const rid = () => `row_${++n}`;

describe("toNum", () => {
  it("normalizes DB decimal strings, nulls and garbage", () => {
    expect(toNum("800000.00")).toBe(800000);
    expect(toNum(1234.5)).toBe(1234.5);
    expect(toNum(null)).toBe(0);
    expect(toNum(undefined)).toBe(0);
    expect(toNum("not-a-number")).toBe(0);
  });
});

describe("buildEngineInput — income / tax-paid / deduction mapping", () => {
  it("maps slab income heads and computes the summary", () => {
    const r = buildEngineInput(
      rows({
        income: [
          { id: rid(), income_head: "salary", amount: "800000", source_type: "Form16" },
          { id: rid(), income_head: "savings_interest", amount: "5000", source_type: "manual" },
          { id: rid(), income_head: "fd_interest", amount: "15000", source_type: "AIS" },
          { id: rid(), income_head: "dividend", amount: "4000", source_type: "AIS" },
          { id: rid(), income_head: "other_sources", amount: "1000", source_type: "manual" },
          { id: rid(), income_head: "exempt_income", amount: "2000", source_type: "manual" },
        ],
      }),
      META,
    );
    expect(r.input.income).toHaveLength(6);
    expect(r.summary.salary).toBe(800000);
    expect(r.summary.interest).toBe(20000);
    expect(r.summary.dividendOther).toBe(5000);
    expect(r.summary.exempt).toBe(2000);
    expect(r.complete).toBe(true);
  });

  it("maps every tax-paid type", () => {
    const r = buildEngineInput(
      rows({
        taxPaid: [
          { id: rid(), tax_paid_type: "salary_tds", amount: "60000", source_type: "Form16" },
          { id: rid(), tax_paid_type: "non_salary_tds", amount: "2000", source_type: "26AS" },
          { id: rid(), tax_paid_type: "tcs", amount: "1000", source_type: "26AS" },
          { id: rid(), tax_paid_type: "advance_tax", amount: "5000", source_type: "manual" },
          { id: rid(), tax_paid_type: "self_assessment_tax", amount: "500", source_type: "manual" },
        ],
      }),
      META,
    );
    expect(r.input.taxPaid).toHaveLength(5);
    expect(r.summary.totalTaxPaid).toBe(68500);
  });

  it("maps deductions incl. other_deductions → engine 'other'", () => {
    const r = buildEngineInput(
      rows({
        deductions: [
          { id: rid(), deduction_type: "80C", amount: "150000", source_type: "manual" },
          { id: rid(), deduction_type: "80D", amount: "25000", source_type: "manual" },
          { id: rid(), deduction_type: "other_deductions", amount: "1000", source_type: "manual" },
        ],
      }),
      META,
    );
    expect(r.input.deductions.map((d) => d.section).sort()).toEqual(["80C", "80D", "other"]);
    expect(r.summary.deductions).toBe(176000);
    expect(r.complete).toBe(true);
  });

  // K4-05: the "80D_PARENTS" section + insured_party_senior propagation.
  it("maps '80D_PARENTS' as a supported section and propagates insured_party_senior", () => {
    const r = buildEngineInput(
      rows({
        deductions: [
          {
            id: rid(),
            deduction_type: "80D_PARENTS",
            amount: "60000",
            source_type: "manual",
            insured_party_senior: true,
          },
        ],
      }),
      META,
    );
    expect(r.input.deductions).toHaveLength(1);
    expect(r.input.deductions[0]?.section).toBe("80D_PARENTS");
    expect(r.input.deductions[0]?.insuredPartySenior).toBe(true);
    expect(r.complete).toBe(true);
  });

  it("insured_party_senior null/undefined/false all map to insuredPartySenior: false — never inferred senior", () => {
    const r = buildEngineInput(
      rows({
        deductions: [
          { id: rid(), deduction_type: "80D_PARENTS", amount: "10000", source_type: "manual", insured_party_senior: null },
          { id: rid(), deduction_type: "80D_PARENTS", amount: "10000", source_type: "manual" },
          { id: rid(), deduction_type: "80D_PARENTS", amount: "10000", source_type: "manual", insured_party_senior: false },
        ],
      }),
      META,
    );
    expect(r.input.deductions.every((d) => d.insuredPartySenior === false)).toBe(true);
  });

  it("insured_party_senior is ignored (still propagated but inert) for a non-'80D_PARENTS' section", () => {
    const r = buildEngineInput(
      rows({
        deductions: [
          { id: rid(), deduction_type: "80D", amount: "25000", source_type: "manual", insured_party_senior: true },
        ],
      }),
      META,
    );
    expect(r.input.deductions[0]?.section).toBe("80D");
    expect(r.input.deductions[0]?.insuredPartySenior).toBe(true);
  });
});

describe("buildEngineInput — capital gains", () => {
  it("maps STCG 111A and LTCG 112A (taxable_gain)", () => {
    const r = buildEngineInput(
      rows({
        capitalGains: [
          { id: rid(), gain_type: "stcg_111a", sale_value: "100000", cost: "60000", expenses: "0", exemption_claimed: "0", taxable_gain: "40000", source_type: "broker_report" },
          { id: rid(), gain_type: "ltcg_112a", sale_value: "300000", cost: "100000", expenses: "0", exemption_claimed: "0", taxable_gain: "200000", source_type: "broker_report" },
        ],
      }),
      META,
    );
    expect(r.summary.stcg111a).toBe(40000);
    expect(r.summary.ltcg112a).toBe(200000);
    expect(r.input.capitalGains).toHaveLength(2);
    expect(r.complete).toBe(true);
  });

  // K4-09 note: this case is a loss with NO gain to absorb it, so it still
  // excludes exactly as before. Its assertions are unchanged; only the title
  // is narrowed, because an ABSORBABLE loss is now computed rather than
  // excluded (see the K4-09 block below).
  it("excludes an UNABSORBABLE capital loss with a warning (not silently ignored)", () => {
    const lossId = rid();
    const r = buildEngineInput(
      rows({
        capitalGains: [
          { id: lossId, gain_type: "stcg_111a", sale_value: "50000", cost: "80000", expenses: "0", exemption_claimed: "0", taxable_gain: "-30000", source_type: "broker_report" },
        ],
      }),
      META,
    );
    expect(r.input.capitalGains).toHaveLength(0);
    expect(r.complete).toBe(false);
    expect(r.warnings[0]?.code).toBe("CAPITAL_LOSS_NOT_MODELLED");
    expect(r.excludedLedgerIds).toContain(lossId);
  });
});

describe("buildEngineInput — unsupported entries (no silent omission)", () => {
  it("warns + excludes house_property and business_income", () => {
    const hp = rid();
    const bi = rid();
    const r = buildEngineInput(
      rows({
        income: [
          { id: rid(), income_head: "salary", amount: "500000", source_type: "Form16" },
          { id: hp, income_head: "house_property", amount: "120000", source_type: "manual" },
          { id: bi, income_head: "business_income", amount: "300000", source_type: "manual" },
        ],
      }),
      META,
    );
    expect(r.input.income).toHaveLength(1); // only salary mapped
    expect(r.warnings.map((w) => w.code)).toEqual(["UNSUPPORTED_INCOME_HEAD", "UNSUPPORTED_INCOME_HEAD"]);
    expect(r.excludedLedgerIds).toEqual([hp, bi]);
    expect(r.complete).toBe(false);
    expect(r.unsupportedEntryCount).toBe(2);
  });

  it("sets hasBusinessOrProfessionalIncome only for a non-zero business_income row (K4-04)", () => {
    const withBusiness = buildEngineInput(
      rows({ income: [{ id: rid(), income_head: "business_income", amount: "300000", source_type: "manual" }] }),
      META,
    );
    expect(withBusiness.input.hasBusinessOrProfessionalIncome).toBe(true);

    const zeroBusiness = buildEngineInput(
      rows({ income: [{ id: rid(), income_head: "business_income", amount: "0", source_type: "manual" }] }),
      META,
    );
    expect(zeroBusiness.input.hasBusinessOrProfessionalIncome).toBe(false);

    const noBusinessRowAtAll = buildEngineInput(
      rows({ income: [{ id: rid(), income_head: "salary", amount: "500000", source_type: "Form16" }] }),
      META,
    );
    expect(noBusinessRowAtAll.input.hasBusinessOrProfessionalIncome).toBe(false);

    // house_property (the OTHER placeholder head) never sets the business flag.
    const houseOnly = buildEngineInput(
      rows({ income: [{ id: rid(), income_head: "house_property", amount: "120000", source_type: "manual" }] }),
      META,
    );
    expect(houseOnly.input.hasBusinessOrProfessionalIncome).toBe(false);

    // K4-07: a mapped (within-ceiling) presumptive-44ADA row ALSO sets the
    // flag — both are "profits and gains of business or profession" for
    // Section 207(2) purposes, even though 44ADA IS computed.
    const withPresumptive44ada = buildEngineInput(
      rows({ income: [{ id: rid(), income_head: "presumptive_professional_44ada", presumptive_activity_type: "specified_profession_44aa_1", amount: "800000", source_type: "manual" }] }),
      META,
    );
    expect(withPresumptive44ada.input.hasBusinessOrProfessionalIncome).toBe(true);
  });

  it("warns + excludes other_stcg / other_ltcg but ignores zero-amount ones", () => {
    const os = rid();
    const r = buildEngineInput(
      rows({
        capitalGains: [
          { id: os, gain_type: "other_stcg", sale_value: "0", cost: "0", expenses: "0", exemption_claimed: "0", taxable_gain: "70000", source_type: "manual" },
          { id: rid(), gain_type: "other_ltcg", sale_value: "0", cost: "0", expenses: "0", exemption_claimed: "0", taxable_gain: "0", source_type: "manual" },
        ],
      }),
      META,
    );
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]?.code).toBe("UNSUPPORTED_GAIN_TYPE");
    expect(r.excludedLedgerIds).toEqual([os]);
  });
});

describe("buildEngineInput — traceability, notes safety, ITR", () => {
  it("groups source trace by mapped group with ids, source types, doc label and total", () => {
    const id1 = rid();
    const id2 = rid();
    const r = buildEngineInput(
      rows({
        income: [
          { id: id1, income_head: "salary", amount: "500000", source_type: "Form16", source_document_name: "Form 16 (per employer)" },
          { id: id2, income_head: "salary", amount: "300000", source_type: "manual" },
        ],
      }),
      META,
    );
    const g = r.sourceTrace.find((x) => x.key === "income:salary");
    expect(g?.ledgerIds.sort()).toEqual([id1, id2].sort());
    expect(g?.sourceTypes.sort()).toEqual(["Form16", "manual"]);
    expect(g?.documentLabels).toEqual(["Form 16 (per employer)"]);
    expect(g?.total).toBe(800000);
  });

  it("never carries ledger notes into the engine input", () => {
    const r = buildEngineInput(
      rows({
        // extra `notes` on the row must not leak into the mapped entry
        income: [{ id: rid(), income_head: "salary", amount: "1", source_type: "manual", notes: "secret" } as never],
      }),
      META,
    );
    expect(r.input.income[0]).not.toHaveProperty("notes");
  });

  it("passes selectedItrType through and recommends ITR-2 when capital gains exist (mismatch case)", () => {
    const r = buildEngineInput(
      rows({
        income: [{ id: rid(), income_head: "salary", amount: "800000", source_type: "Form16" }],
        capitalGains: [
          { id: rid(), gain_type: "stcg_111a", sale_value: "0", cost: "0", expenses: "0", exemption_claimed: "0", taxable_gain: "50000", source_type: "broker_report" },
        ],
      }),
      { ...META, selectedItrType: "ITR-1" },
    );
    expect(r.input.selectedItrType).toBe("ITR-1");
    const rec = recommendItrForm(r.input);
    expect(rec.recommendedItrType).toBe("ITR-2"); // mismatch vs selected ITR-1
  });
});

describe("hasMeaningfulInput", () => {
  it("is false with no figures, true once income/gains/tax exist", () => {
    expect(hasMeaningfulInput(buildEngineInput(rows({}), META))).toBe(false);
    const r = buildEngineInput(rows({ income: [{ id: rid(), income_head: "salary", amount: "1", source_type: "manual" }] }), META);
    expect(hasMeaningfulInput(r)).toBe(true);
  });

  it("is true for a declared house property even when its raw figure nets to 0 (K4-06)", () => {
    const r = buildEngineInput(
      rows({
        housePropertyEntries: [
          {
            id: rid(),
            usage: "self_occupied",
            annual_rent_received: 0,
            municipal_taxes_paid: 0,
            home_loan_interest: 0,
            source_type: "manual",
          },
        ],
      }),
      META,
    );
    expect(hasMeaningfulInput(r)).toBe(true);
  });

  it("is true for a mapped presumptive-44ADA row (K4-07)", () => {
    const r = buildEngineInput(
      rows({ income: [{ id: rid(), income_head: "presumptive_professional_44ada", presumptive_activity_type: "specified_profession_44aa_1", amount: "500000", source_type: "manual" }] }),
      META,
    );
    expect(hasMeaningfulInput(r)).toBe(true);
  });
});

describe("buildEngineInput — house property (K4-06)", () => {
  it("maps a single live house-property row into the engine input", () => {
    const id = rid();
    const r = buildEngineInput(
      rows({
        housePropertyEntries: [
          {
            id,
            usage: "let_out",
            annual_rent_received: "300000",
            municipal_taxes_paid: "20000",
            home_loan_interest: "50000",
            source_type: "manual",
          },
        ],
      }),
      META,
    );
    expect(r.warnings).toEqual([]);
    expect(r.complete).toBe(true);
    expect(r.input.housePropertyEntries).toHaveLength(1);
    expect(r.input.housePropertyEntries?.[0]).toMatchObject({
      id,
      usage: "let_out",
      annualRentReceived: 300000,
      municipalTaxesPaid: 20000,
      homeLoanInterest: 50000,
    });
    expect(r.sourceTrace.some((g) => g.ledgerKind === "house_property")).toBe(true);
  });

  it("defaults to self_occupied for any usage value other than 'let_out'", () => {
    const r = buildEngineInput(
      rows({
        housePropertyEntries: [
          { id: rid(), usage: "self_occupied", annual_rent_received: 0, municipal_taxes_paid: 0, home_loan_interest: 100000, source_type: "manual" },
        ],
      }),
      META,
    );
    expect(r.input.housePropertyEntries?.[0]?.usage).toBe("self_occupied");
  });

  it("excludes ALL rows (never guesses) when more than one live house-property row exists", () => {
    const r = buildEngineInput(
      rows({
        housePropertyEntries: [
          { id: rid(), usage: "self_occupied", annual_rent_received: 0, municipal_taxes_paid: 0, home_loan_interest: 100000, source_type: "manual" },
          { id: rid(), usage: "let_out", annual_rent_received: 200000, municipal_taxes_paid: 0, home_loan_interest: 0, source_type: "manual" },
        ],
      }),
      META,
    );
    expect(r.input.housePropertyEntries).toEqual([]);
    expect(r.complete).toBe(false);
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings.every((w) => w.code === "MULTIPLE_HOUSE_PROPERTIES_NOT_MODELLED")).toBe(true);
    expect(r.excludedLedgerIds).toHaveLength(2);
  });

  it("zero house-property rows leave input.housePropertyEntries as an empty array", () => {
    const r = buildEngineInput(rows({}), META);
    expect(r.input.housePropertyEntries).toEqual([]);
  });
});

describe("buildEngineInput — presumptive professional income (44ADA, K4-07)", () => {
  it("maps a within-ceiling row into the engine input and sets hasBusinessOrProfessionalIncome", () => {
    const id = rid();
    const r = buildEngineInput(
      rows({
        income: [{ id, income_head: "presumptive_professional_44ada", presumptive_activity_type: "specified_profession_44aa_1", amount: "800000", source_type: "manual" }],
      }),
      META,
    );
    expect(r.warnings).toEqual([]);
    expect(r.complete).toBe(true);
    expect(r.input.income).toHaveLength(1);
    expect(r.input.income[0]).toMatchObject({ id, amount: 800000, category: "presumptive_professional_44ada" });
    expect(r.input.hasBusinessOrProfessionalIncome).toBe(true);
    expect(r.summary.presumptiveProfessionalIncome).toBe(800000);
    expect(r.sourceTrace.some((g) => g.key === "income:presumptive_professional_44ada")).toBe(true);
  });

  it("excludes ALL rows (never guesses) when the AGGREGATE exceeds the ₹50L conservative ceiling", () => {
    const id1 = rid();
    const id2 = rid();
    const r = buildEngineInput(
      rows({
        income: [
          { id: id1, income_head: "presumptive_professional_44ada", presumptive_activity_type: "specified_profession_44aa_1", amount: "3000000", source_type: "manual" },
          { id: id2, income_head: "presumptive_professional_44ada", presumptive_activity_type: "specified_profession_44aa_1", amount: "2500000", source_type: "manual" },
        ],
      }),
      META,
    );
    expect(r.input.income).toEqual([]);
    expect(r.complete).toBe(false);
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings.every((w) => w.code === "PRESUMPTIVE_44ADA_CEILING_EXCEEDED")).toBe(true);
    expect(r.excludedLedgerIds).toEqual([id1, id2]);
  });

  // AUDIT-03-F9 regression. The two 44ADA paths are asserted TOGETHER, in one
  // test, precisely so they cannot silently diverge again: the accepted branch
  // set the flag while the ceiling-exceeded branch did not, so a resident
  // senior with ₹80,00,000 of declared gross receipts was told in writing (via
  // `ADVANCE_TAX_EXEMPT_SENIOR_CITIZEN_207_2`) that they had "no business/
  // professional income" and were "not liable to pay advance tax" — the only
  // over-claim in the AUDIT-03 queue. Exclusion from the engine input means
  // "cannot be computed", never "does not exist".
  it("sets hasBusinessOrProfessionalIncome on BOTH 44ADA paths — accepted AND ceiling-excluded (AUDIT-03-F9)", () => {
    const accepted = buildEngineInput(
      rows({
        income: [{ id: rid(), income_head: "presumptive_professional_44ada", presumptive_activity_type: "specified_profession_44aa_1", amount: "800000", source_type: "manual" }],
      }),
      META,
    );
    expect(accepted.complete).toBe(true);
    expect(accepted.input.income).toHaveLength(1);
    expect(accepted.input.hasBusinessOrProfessionalIncome).toBe(true);

    // ₹80,00,000 — above BOTH the ₹50L conservative and ₹75L digital ceilings,
    // so every row is excluded and nothing reaches the engine input.
    const ceilingExcluded = buildEngineInput(
      rows({
        income: [{
          id: rid(), income_head: "presumptive_professional_44ada", presumptive_activity_type: "specified_profession_44aa_1", amount: "8000000",
          source_type: "manual", receipts_via_banking_channels: true,
        }],
      }),
      META,
    );
    expect(ceilingExcluded.complete).toBe(false);
    expect(ceilingExcluded.input.income).toEqual([]);
    expect(ceilingExcluded.warnings.every((w) => w.code === "PRESUMPTIVE_44ADA_CEILING_EXCEEDED")).toBe(true);
    // The flag must survive the exclusion — this is the assertion that failed
    // before the fix.
    expect(ceilingExcluded.input.hasBusinessOrProfessionalIncome).toBe(true);

    // Both paths agree, stated as an equality so a future divergence fails
    // here even if one branch's own expectation is edited.
    expect(ceilingExcluded.input.hasBusinessOrProfessionalIncome).toBe(
      accepted.input.hasBusinessOrProfessionalIncome,
    );
  });

  it("applies the ₹75L ceiling only when EVERY row confirms receipts via banking channels", () => {
    // 60L aggregate: exceeds the 50L conservative ceiling but is within 75L.
    const allDigital = buildEngineInput(
      rows({
        income: [
          { id: rid(), income_head: "presumptive_professional_44ada", presumptive_activity_type: "specified_profession_44aa_1", amount: "6000000", source_type: "manual", receipts_via_banking_channels: true },
        ],
      }),
      META,
    );
    expect(allDigital.warnings).toEqual([]);
    expect(allDigital.input.income).toHaveLength(1);

    // Same aggregate, but ONE row does not confirm digital receipts — conservative 50L applies.
    const mixed = buildEngineInput(
      rows({
        income: [
          { id: rid(), income_head: "presumptive_professional_44ada", presumptive_activity_type: "specified_profession_44aa_1", amount: "4000000", source_type: "manual", receipts_via_banking_channels: true },
          { id: rid(), income_head: "presumptive_professional_44ada", presumptive_activity_type: "specified_profession_44aa_1", amount: "2000000", source_type: "manual" },
        ],
      }),
      META,
    );
    expect(mixed.warnings.every((w) => w.code === "PRESUMPTIVE_44ADA_CEILING_EXCEEDED")).toBe(true);
    expect(mixed.input.income).toEqual([]);
  });

  it("sums multiple within-ceiling rows into the engine input (multiplicity IS in scope, K4-07)", () => {
    const r = buildEngineInput(
      rows({
        income: [
          { id: rid(), income_head: "presumptive_professional_44ada", presumptive_activity_type: "specified_profession_44aa_1", amount: "300000", source_type: "manual" },
          { id: rid(), income_head: "presumptive_professional_44ada", presumptive_activity_type: "specified_profession_44aa_1", amount: "200000", source_type: "manual" },
        ],
      }),
      META,
    );
    expect(r.input.income).toHaveLength(2);
    expect(r.summary.presumptiveProfessionalIncome).toBe(500000);
  });

  it("ignores a zero-amount row (no warning, not mapped)", () => {
    const r = buildEngineInput(
      rows({ income: [{ id: rid(), income_head: "presumptive_professional_44ada", presumptive_activity_type: "specified_profession_44aa_1", amount: "0", source_type: "manual" }] }),
      META,
    );
    expect(r.warnings).toEqual([]);
    expect(r.input.income).toEqual([]);
  });
});

describe("buildEngineInput — presumptive business income (44AD, K4-08)", () => {
  function ad(digital: string, cash: string) {
    return rows({
      income: [
        { id: rid(), income_head: "presumptive_business_44ad_digital", presumptive_activity_type: "other_business", amount: digital, source_type: "manual" },
        { id: rid(), income_head: "presumptive_business_44ad_cash", presumptive_activity_type: "other_business", amount: cash, source_type: "manual" },
      ],
    });
  }

  it("maps both receipt-mode heads into the engine input and sets hasBusinessOrProfessionalIncome", () => {
    const r = buildEngineInput(ad("4000000", "100000"), META);
    expect(r.warnings).toEqual([]);
    expect(r.complete).toBe(true);
    expect(r.input.income).toHaveLength(2);
    expect(r.input.income.map((e) => e.category)).toEqual([
      "presumptive_business_44ad_digital",
      "presumptive_business_44ad_cash",
    ]);
    expect(r.input.hasBusinessOrProfessionalIncome).toBe(true);
    expect(r.summary.presumptiveBusinessTurnover).toBe(4100000);
    expect(r.sourceTrace.some((g) => g.key === "income:presumptive_business_44ad_digital")).toBe(true);
    expect(r.sourceTrace.some((g) => g.key === "income:presumptive_business_44ad_cash")).toBe(true);
  });

  // The enhanced-ceiling condition is DERIVED from the declared split, not
  // asserted by a staff checkbox — this is the structural improvement over
  // 44ADA's `receipts_via_banking_channels` boolean.
  it("derives the 5% cash-receipts test from the declared split — enhanced ₹3cr ceiling", () => {
    // 1,00,000 cash of 2,50,00,000 total = 0.4% <= 5% → ₹3cr ceiling → accepted.
    const r = buildEngineInput(ad("24900000", "100000"), META);
    expect(r.warnings).toEqual([]);
    expect(r.input.income).toHaveLength(2);
  });

  it("falls back to the ordinary ₹2cr ceiling when the derived cash share exceeds 5%", () => {
    // 25,00,000 cash of 2,50,00,000 total = 10% > 5% → ₹2cr ceiling →
    // 2.5cr exceeds it → ALL rows excluded, never partially computed.
    const r = buildEngineInput(ad("22500000", "2500000"), META);
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings.every((w) => w.code === "PRESUMPTIVE_44AD_CEILING_EXCEEDED")).toBe(true);
    expect(r.input.income).toEqual([]);
    expect(r.excludedLedgerIds).toHaveLength(2);
    expect(r.complete).toBe(false);
  });

  it("treats a cash share of exactly 5% as within the enhanced ceiling (boundary, not >)", () => {
    // 1,00,000 cash of 20,00,000 total = exactly 5% → enhanced ceiling applies.
    const r = buildEngineInput(ad("1900000", "100000"), META);
    expect(r.warnings).toEqual([]);
    expect(r.input.income).toHaveLength(2);
  });

  it("excludes ALL rows together when the AGGREGATE exceeds even the enhanced ceiling", () => {
    // All-digital (0% cash) → ₹3cr ceiling; 3.1cr exceeds it.
    const r = buildEngineInput(ad("31000000", "0"), META);
    expect(r.warnings.every((w) => w.code === "PRESUMPTIVE_44AD_CEILING_EXCEEDED")).toBe(true);
    expect(r.input.income).toEqual([]);
  });

  // AUDIT-03-F9 / decision D86 — pinned BOTH ways in ONE test, exactly as
  // MAINT-03 did for 44ADA. Excluding rows from the computation must never be
  // read as "no business income exists", which is what validate-case.ts's
  // Section 207(2) disclosure would otherwise state in writing.
  it("sets hasBusinessOrProfessionalIncome on BOTH 44AD paths — accepted AND ceiling-excluded (D86)", () => {
    const accepted = buildEngineInput(ad("4000000", "100000"), META);
    expect(accepted.warnings).toEqual([]);
    expect(accepted.input.hasBusinessOrProfessionalIncome).toBe(true);

    const ceilingExcluded = buildEngineInput(ad("31000000", "0"), META);
    expect(ceilingExcluded.warnings.every((w) => w.code === "PRESUMPTIVE_44AD_CEILING_EXCEEDED")).toBe(true);
    expect(ceilingExcluded.input.income).toEqual([]);
    expect(ceilingExcluded.input.hasBusinessOrProfessionalIncome).toBe(true);

    // The two paths must AGREE — the assertion that actually fails if a future
    // session sets the flag on only one branch again.
    expect(ceilingExcluded.input.hasBusinessOrProfessionalIncome).toBe(
      accepted.input.hasBusinessOrProfessionalIncome,
    );
  });

  it("accepts a digital-only or cash-only case (neither head is required)", () => {
    const digitalOnly = buildEngineInput(
      rows({ income: [{ id: rid(), income_head: "presumptive_business_44ad_digital", presumptive_activity_type: "other_business", amount: "1000000", source_type: "manual" }] }),
      META,
    );
    expect(digitalOnly.warnings).toEqual([]);
    expect(digitalOnly.input.income).toHaveLength(1);

    // Cash-only is 100% cash → ordinary ₹2cr ceiling; 10L is within it.
    const cashOnly = buildEngineInput(
      rows({ income: [{ id: rid(), income_head: "presumptive_business_44ad_cash", presumptive_activity_type: "other_business", amount: "1000000", source_type: "manual" }] }),
      META,
    );
    expect(cashOnly.warnings).toEqual([]);
    expect(cashOnly.input.income).toHaveLength(1);
  });

  it("ignores zero-amount rows (no warning, not mapped, no false turnover)", () => {
    const r = buildEngineInput(ad("0", "0"), META);
    expect(r.warnings).toEqual([]);
    expect(r.input.income).toEqual([]);
    expect(r.summary.presumptiveBusinessTurnover).toBe(0);
    expect(r.input.hasBusinessOrProfessionalIncome).toBe(false);
  });

  it("counts 44AD turnover toward hasMeaningfulInput", () => {
    expect(hasMeaningfulInput(buildEngineInput(ad("1000000", "0"), META))).toBe(true);
    expect(hasMeaningfulInput(buildEngineInput(ad("0", "0"), META))).toBe(false);
  });
});

describe("buildEngineInput — K4-09 within-year capital-loss set-off window", () => {
  const cg = (gain_type: string, taxable_gain: number, id = rid()) => ({
    id,
    gain_type,
    sale_value: "0",
    cost: "0",
    expenses: "0",
    exemption_claimed: "0",
    taxable_gain: String(taxable_gain),
    source_type: "broker_report",
  });

  it("ADMITS a long-term loss inside the window (loss <= 112A gains above the exemption)", () => {
    // 500,000 gain leaves 375,000 above the 125,000 exemption; a 200,000 loss fits.
    const r = buildEngineInput(
      rows({ capitalGains: [cg("ltcg_112a", 500_000), cg("ltcg_112a", -200_000)] }),
      META,
    );
    expect(r.complete).toBe(true);
    expect(r.warnings).toHaveLength(0);
    expect(r.input.capitalGains).toHaveLength(2);
    expect(r.excludedLedgerIds).toHaveLength(0);
  });

  it("REFUSES a long-term loss at the window boundary + 1, excluding every gain row too", () => {
    const gainId = rid();
    const lossId = rid();
    const r = buildEngineInput(
      rows({
        capitalGains: [cg("ltcg_112a", 500_000, gainId), cg("ltcg_112a", -375_001, lossId)],
      }),
      META,
    );
    expect(r.complete).toBe(false);
    expect(r.input.capitalGains).toHaveLength(0);
    // BOTH rows excluded — dropping only the loss would overstate taxable gains.
    expect(r.excludedLedgerIds).toContain(gainId);
    expect(r.excludedLedgerIds).toContain(lossId);
    expect(r.warnings.every((w) => w.code === "CAPITAL_LOSS_NOT_MODELLED")).toBe(true);
  });

  it("ADMITS exactly at the window boundary (loss == gains above the exemption)", () => {
    const r = buildEngineInput(
      rows({ capitalGains: [cg("ltcg_112a", 500_000), cg("ltcg_112a", -375_000)] }),
      META,
    );
    expect(r.complete).toBe(true);
    expect(r.input.capitalGains).toHaveLength(2);
  });

  it("REFUSES a short-term loss when BOTH gain buckets exist (elective ordering)", () => {
    const r = buildEngineInput(
      rows({
        capitalGains: [
          cg("stcg_111a", 100_000),
          cg("ltcg_112a", 500_000),
          cg("stcg_111a", -50_000),
        ],
      }),
      META,
    );
    expect(r.complete).toBe(false);
    expect(r.input.capitalGains).toHaveLength(0);
    expect(r.warnings.every((w) => w.code === "CAPITAL_LOSS_SETOFF_ORDER_ELECTIVE")).toBe(true);
  });

  it("ADMITS a short-term loss when there is no 112A gain (no election possible)", () => {
    const r = buildEngineInput(
      rows({ capitalGains: [cg("stcg_111a", 300_000), cg("stcg_111a", -100_000)] }),
      META,
    );
    expect(r.complete).toBe(true);
    expect(r.input.capitalGains).toHaveLength(2);
  });

  it("leaves a gains-only case completely unaffected", () => {
    const r = buildEngineInput(
      rows({ capitalGains: [cg("stcg_111a", 100_000), cg("ltcg_112a", 200_000)] }),
      META,
    );
    expect(r.complete).toBe(true);
    expect(r.warnings).toHaveLength(0);
    expect(r.input.capitalGains).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// K4-10 — brought-forward capital losses (Section 74)
// ---------------------------------------------------------------------------

/** A brought-forward ledger row with sane defaults; override what matters. */
function bfRow(over: Partial<BroughtForwardLossLedgerRow> = {}): BroughtForwardLossLedgerRow {
  return {
    id: rid(),
    originating_assessment_year: "2022-23",
    loss_type: "ltcl",
    amount: "100000",
    filing_eligibility: "verified_timely",
    loss_provenance: "prior_finalized_case_in_system",
    elected_set_off_target: null,
    source_type: "prefilled_json",
    ...over,
  };
}

/** A single 112A gain row of `amount`. */
function ltcgRow(amount: number) {
  return {
    id: rid(),
    gain_type: "ltcg_112a",
    sale_value: String(amount),
    cost: "0",
    expenses: "0",
    exemption_claimed: "0",
    taxable_gain: String(amount),
    source_type: "broker_report",
  };
}

function stcgRow(amount: number) {
  return {
    id: rid(),
    gain_type: "stcg_111a",
    sale_value: String(amount),
    cost: "0",
    expenses: "0",
    exemption_claimed: "0",
    taxable_gain: String(amount),
    source_type: "broker_report",
  };
}

describe("buildEngineInput — brought-forward capital losses (K4-10)", () => {
  it("admits a forced allocation: one long-term loss against long-term gains", () => {
    const r = buildEngineInput(
      rows({ capitalGains: [ltcgRow(500_000)], broughtForwardLosses: [bfRow({ amount: "200000" })] }),
      META,
    );
    expect(r.warnings).toEqual([]);
    expect(r.complete).toBe(true);
    expect(r.input.broughtForwardLosses).toHaveLength(1);
    expect(r.summary.broughtForwardLoss).toBe(200_000);
  });

  it("passes EXPIRED and filing-ineligible records through so the engine can disclose them", () => {
    // These are positive legal conclusions with a known correct treatment.
    // Filtering them out at the adapter would make the exclusion invisible,
    // which is what "an expired loss is not silently dropped" forbids.
    const r = buildEngineInput(
      rows({
        capitalGains: [ltcgRow(500_000)],
        broughtForwardLosses: [
          bfRow({ originating_assessment_year: "2016-17" }),
          bfRow({ filing_eligibility: "not_eligible" }),
        ],
      }),
      META,
    );
    expect(r.warnings).toEqual([]);
    expect(r.complete).toBe(true);
    expect(r.input.broughtForwardLosses).toHaveLength(2);
  });

  it("REFUSES the whole capital computation when filing eligibility is unverified", () => {
    const r = buildEngineInput(
      rows({
        capitalGains: [ltcgRow(500_000)],
        broughtForwardLosses: [bfRow({ filing_eligibility: "unverified" })],
      }),
      META,
    );
    expect(r.complete).toBe(false);
    expect(new Set(r.warnings.map((w) => w.code))).toEqual(
      new Set(["BROUGHT_FORWARD_LOSS_FILING_UNVERIFIED"]),
    );
    // BOTH the gain row and the loss row are excluded — never the loss alone,
    // which would silently overstate taxable gains.
    expect(new Set(r.warnings.map((w) => w.ledgerKind))).toEqual(
      new Set(["capital_gain", "brought_forward_loss"]),
    );
    expect(r.input.capitalGains).toEqual([]);
    expect(r.input.broughtForwardLosses).toEqual([]);
    expect(r.excludedLedgerIds).toHaveLength(2);
  });

  it("REFUSES a record whose originating year cannot be evaluated", () => {
    // An absence of knowledge, like unverified filing eligibility — not a
    // positive legal conclusion — so it fails closed rather than being dropped.
    for (const year of ["2022-24", "2026-27", "2027-28"]) {
      const r = buildEngineInput(
        rows({
          capitalGains: [ltcgRow(500_000)],
          broughtForwardLosses: [bfRow({ originating_assessment_year: year })],
        }),
        META,
      );
      expect(r.complete).toBe(false);
      expect(r.warnings.every((w) => w.code === "BROUGHT_FORWARD_LOSS_RECORD_UNUSABLE")).toBe(true);
      expect(r.input.capitalGains).toEqual([]);
      expect(r.input.broughtForwardLosses).toEqual([]);
    }
  });

  it("REFUSES an elective cross-type allocation (short-term loss, both buckets present)", () => {
    const r = buildEngineInput(
      rows({
        capitalGains: [stcgRow(300_000), ltcgRow(500_000)],
        broughtForwardLosses: [bfRow({ loss_type: "stcl" })],
      }),
      META,
    );
    expect(r.complete).toBe(false);
    expect(r.warnings.every((w) => w.code === "BROUGHT_FORWARD_LOSS_ALLOCATION_ELECTIVE")).toBe(true);
    expect(r.input.capitalGains).toEqual([]);
    expect(r.input.broughtForwardLosses).toEqual([]);
  });

  it("ADMITS the same short-term loss when only one bucket exists", () => {
    const r = buildEngineInput(
      rows({ capitalGains: [stcgRow(300_000)], broughtForwardLosses: [bfRow({ loss_type: "stcl" })] }),
      META,
    );
    expect(r.warnings).toEqual([]);
    expect(r.complete).toBe(true);
  });

  it("REFUSES an intra-type partial absorption across two same-type records", () => {
    // Which record's residual survives — and therefore when it expires under
    // s.74(2) — would depend on consumption order, which no artifact states.
    const r = buildEngineInput(
      rows({
        capitalGains: [ltcgRow(150_000)],
        broughtForwardLosses: [
          bfRow({ amount: "100000", originating_assessment_year: "2020-21" }),
          bfRow({ amount: "100000", originating_assessment_year: "2021-22" }),
        ],
      }),
      META,
    );
    expect(r.complete).toBe(false);
    expect(r.warnings.every((w) => w.code === "BROUGHT_FORWARD_LOSS_ALLOCATION_ELECTIVE")).toBe(true);
  });

  it("ADMITS two same-type records when BOTH are fully absorbed", () => {
    const r = buildEngineInput(
      rows({
        capitalGains: [ltcgRow(500_000)],
        broughtForwardLosses: [
          bfRow({ amount: "100000", originating_assessment_year: "2020-21" }),
          bfRow({ amount: "100000", originating_assessment_year: "2021-22" }),
        ],
      }),
      META,
    );
    expect(r.warnings).toEqual([]);
    expect(r.complete).toBe(true);
  });

  it("REFUSES a taxpayer election that diverges from the portal default", () => {
    const r = buildEngineInput(
      rows({
        capitalGains: [ltcgRow(500_000)],
        broughtForwardLosses: [bfRow({ loss_type: "ltcl", elected_set_off_target: "stcg_111a" })],
      }),
      META,
    );
    expect(r.complete).toBe(false);
    expect(r.warnings.every((w) => w.code === "BROUGHT_FORWARD_LOSS_ELECTION_DIVERGES")).toBe(true);
    expect(r.input.capitalGains).toEqual([]);
    expect(r.input.broughtForwardLosses).toEqual([]);
  });

  it("ADMITS a taxpayer election that reproduces the portal default", () => {
    const r = buildEngineInput(
      rows({
        capitalGains: [ltcgRow(500_000)],
        broughtForwardLosses: [bfRow({ loss_type: "ltcl", elected_set_off_target: "ltcg_112a" })],
      }),
      META,
    );
    expect(r.warnings).toEqual([]);
    expect(r.complete).toBe(true);
  });

  it("excludes brought-forward rows TOGETHER with a refused within-year set-off", () => {
    // The K4-09 window is untouched by this session. When it refuses, the
    // brought-forward records that would have been applied AFTER it cannot be
    // computed either — and they are excluded with the gains, not on their own.
    const r = buildEngineInput(
      rows({
        capitalGains: [
          ltcgRow(100_000),
          { ...ltcgRow(0), taxable_gain: "-900000" },
        ],
        broughtForwardLosses: [bfRow()],
      }),
      META,
    );
    expect(r.complete).toBe(false);
    expect(r.warnings.some((w) => w.code === "CAPITAL_LOSS_NOT_MODELLED")).toBe(true);
    expect(r.warnings.some((w) => w.ledgerKind === "brought_forward_loss")).toBe(true);
    expect(r.input.broughtForwardLosses).toEqual([]);
  });

  it("treats a declared carry-forward record as meaningful input on its own", () => {
    // The K4-06 precedent: presence, not a nonzero sum. A case holding only a
    // brought-forward record still produces a real output — the residual and
    // the assessment year it may last be used in.
    const empty = buildEngineInput(rows({}), META);
    expect(hasMeaningfulInput(empty)).toBe(false);
    const withRecord = buildEngineInput(rows({ broughtForwardLosses: [bfRow()] }), META);
    expect(hasMeaningfulInput(withRecord)).toBe(true);
  });

  it("is byte-identical to the pre-K4-10 shape for a case with no carry-forward record", () => {
    const gains = [ltcgRow(500_000)];
    const withAbsent = buildEngineInput(rows({ capitalGains: gains }), META);
    const withEmpty = buildEngineInput(rows({ capitalGains: gains, broughtForwardLosses: [] }), META);
    expect(withAbsent.input.broughtForwardLosses).toEqual([]);
    expect(withEmpty.input).toEqual(withAbsent.input);
    expect(withAbsent.warnings).toEqual([]);
    expect(withAbsent.summary.broughtForwardLoss).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// K4-14 — books-based business/profession (Sections 28/29)
// ---------------------------------------------------------------------------

function booksRow(overrides: Partial<BusinessBooksLedgerRow> = {}): BusinessBooksLedgerRow {
  return {
    id: "books_1",
    revenue: "3000000",
    expenses: "2400000",
    is_profession: false,
    adjustments: "none_s30_43d",
    activity_classification: "ordinary_business_or_profession",
    source_type: "manual",
    ...overrides,
  };
}

describe("buildEngineInput — books-based business (K4-14)", () => {
  it("maps a declared-adjustment-free row and reports its raw net profit", () => {
    const r = buildEngineInput(rows({ businessBooksEntries: [booksRow()] }), META);
    expect(r.complete).toBe(true);
    expect(r.input.businessBooksEntries).toHaveLength(1);
    expect(r.input.businessBooksEntries?.[0]?.revenue).toBe(3_000_000);
    expect(r.input.businessBooksEntries?.[0]?.expenses).toBe(2_400_000);
    expect(r.summary.businessBooksNetProfit).toBe(600_000);
    expect(r.input.hasBusinessOrProfessionalIncome).toBe(true);
  });

  it("maps a complete standing-class Section 32 claim and adjusts the net", () => {
    const r = buildEngineInput(
      rows({
        businessBooksEntries: [
          booksRow({
            adjustments: ["depreciation_s32"],
            book_depreciation: "80000",
            claims_additional_depreciation: false,
            depreciation_blocks: [
              {
                asset_class: "plant_machinery_general_iii1",
                wdv: "400000",
                put_to_use: "full_rate",
              },
            ],
          }),
        ],
      }),
      META,
    );
    expect(r.complete).toBe(true);
    expect(r.warnings).toEqual([]);
    expect(r.input.businessBooksEntries).toHaveLength(1);
    expect(r.input.businessBooksEntries?.[0]?.adjustments).toEqual(["depreciation_s32"]);
    expect(r.summary.businessBooksNetProfit).toBe(6_20_000);
  });

  // The safety property of the whole slice: silence is never read as
  // "no adjustment". Each unusable value must refuse, not fall through.
  //
  // AUDIT-08-F3 / decision D244 added the four INHERITED-PROPERTY cases. The
  // gate used `declared in BUSINESS_BOOKS_ADJUSTMENTS`, and `in` walks the
  // prototype chain, so `"constructor"` was accepted as a declared basis;
  // `BUSINESS_BOOKS_REFUSAL_CODES["constructor"]` then resolved to the
  // `Object` CONSTRUCTOR and the emitted warning's `code` was a FUNCTION, not
  // a string. The row was still excluded and `complete` was still false, so no
  // figure was ever computed from it — but a non-string code flows on into
  // `ledger-support.ts` and the UI. `gatePresumptiveActivity` in the same file
  // already used `hasOwnProperty` and said in a comment exactly why `in` is
  // wrong; this pins that rule for the sibling gate. The DB check constraint
  // and the Zod enum both block such a value — this gate must not depend on
  // either being correct.
  it.each([
    null,
    undefined,
    "",
    "none",
    "unknown",
    "NONE_S30_43D",
    "constructor",
    "toString",
    "valueOf",
    "__proto__",
  ])(
    "refuses an undeclared/unrecognised basis (%s) rather than assuming none",
    (adjustments) => {
      const r = buildEngineInput(
        rows({ businessBooksEntries: [booksRow({ adjustments: adjustments as string | null })] }),
        META,
      );
      expect(r.complete).toBe(false);
      expect(r.input.businessBooksEntries).toEqual([]);
      expect(r.warnings.map((w) => w.code)).toEqual(["BUSINESS_BOOKS_ADJUSTMENTS_UNDECLARED"]);
      expect(r.excludedLedgerIds).toEqual(["books_1"]);
      expect(r.summary.businessBooksNetProfit).toBe(0);
    },
  );

  it.each([
    ["depreciation_s32", "BUSINESS_BOOKS_DEPRECIATION_UNSUPPORTED"],
    ["disallowance_s37_s40_s43b", "BUSINESS_BOOKS_DISALLOWANCE_UNSUPPORTED"],
    ["presumptive_transition", "BUSINESS_BOOKS_PRESUMPTIVE_TRANSITION_UNSUPPORTED"],
  ] as const)("refuses %s under its OWN code, never a shared one", (adjustments, code) => {
    const r = buildEngineInput(rows({ businessBooksEntries: [booksRow({ adjustments })] }), META);
    expect(r.complete).toBe(false);
    expect(r.warnings.map((w) => w.code)).toEqual([code]);
    expect(r.input.businessBooksEntries).toEqual([]);
  });

  it("refuses turnover above the Section 44AB(a) business threshold", () => {
    const r = buildEngineInput(
      rows({ businessBooksEntries: [booksRow({ revenue: "10000001", expenses: "1000" })] }),
      META,
    );
    expect(r.warnings.map((w) => w.code)).toEqual(["BUSINESS_BOOKS_AUDIT_THRESHOLD_EXCEEDED"]);
    expect(r.warnings[0]?.message).toContain("44AB(a)");
    // The proviso's higher threshold must NOT be the one applied — its
    // cash-payments limb is unverifiable from any ledger held here.
    expect(r.warnings[0]?.message).toContain("proviso to Section 44AB(a)");
  });

  it("EXACTLY at the threshold is admitted — the statute says exceed", () => {
    const r = buildEngineInput(
      rows({ businessBooksEntries: [booksRow({ revenue: "10000000", expenses: "1000" })] }),
      META,
    );
    expect(r.complete).toBe(true);
    expect(r.input.businessBooksEntries).toHaveLength(1);
  });

  it("applies the LOWER profession threshold under Section 44AB(b)", () => {
    const overThreshold = { revenue: "5000001", expenses: "1000" };
    const asProfession = buildEngineInput(
      rows({ businessBooksEntries: [booksRow({ ...overThreshold, is_profession: true })] }),
      META,
    );
    expect(asProfession.warnings.map((w) => w.code)).toEqual(["BUSINESS_BOOKS_AUDIT_THRESHOLD_EXCEEDED"]);
    expect(asProfession.warnings[0]?.message).toContain("44AB(b)");
    // The SAME turnover as a business is fine — the flag is load-bearing.
    const asBusiness = buildEngineInput(
      rows({ businessBooksEntries: [booksRow({ ...overThreshold, is_profession: false })] }),
      META,
    );
    expect(asBusiness.complete).toBe(true);
  });

  it("refuses a one-row business loss because the head aggregate remains negative", () => {
    const r = buildEngineInput(
      rows({ businessBooksEntries: [booksRow({ revenue: "1000000", expenses: "1400000" })] }),
      META,
    );
    expect(r.warnings.map((w) => w.code)).toEqual(["BUSINESS_BOOKS_LOSS_NOT_MODELLED"]);
    expect(r.warnings[0]?.message).toContain("residual loss of ₹400000");
    expect(r.warnings[0]?.message).toContain("Section 71");
    expect(r.warnings[0]?.message).toContain("Section 72");
    expect(r.input.businessBooksEntries).toEqual([]);
  });

  // ---- K4-15: several businesses in one case -------------------------------
  //
  // The assertion REPLACED here ("refuses ALL rows when more than one business
  // is declared", expecting two `MULTIPLE_BUSINESS_BOOKS_NOT_MODELLED`
  // warnings) encoded K4-14's misreading of Section 44AB. Recorded under the
  // programme's §4 replaced-assertion convention, as D243 was.

  it("MAPS several businesses and lets the engine aggregate them", () => {
    const r = buildEngineInput(
      rows({ businessBooksEntries: [booksRow({ id: "b1" }), booksRow({ id: "b2" })] }),
      META,
    );
    expect(r.warnings.map((w) => w.code)).toEqual([]);
    expect(r.excludedLedgerIds).toEqual([]);
    expect(r.input.businessBooksEntries?.map((e) => e.id)).toEqual(["b1", "b2"]);
    expect(r.complete).toBe(true);
  });

  it("tests Section 44AB on the AGGREGATE, not row by row", () => {
    // Neither row exceeds ₹1,00,00,000 alone; together they do — a taxpayer
    // who requires a tax audit. K4-14 did NOT compute this case wrongly: the
    // multiplicity refusal fired before the per-row threshold test was ever
    // reached, so the wrong test was latent, not live. It would have become
    // live the moment multiplicity was allowed, which is this change — so the
    // aggregate test ships WITH it rather than after it.
    const r = buildEngineInput(
      rows({
        businessBooksEntries: [
          booksRow({ id: "b1", revenue: "6000000" }),
          booksRow({ id: "b2", revenue: "6000000" }),
        ],
      }),
      META,
    );
    expect(r.warnings.map((w) => w.code)).toEqual([
      "BUSINESS_BOOKS_AUDIT_THRESHOLD_EXCEEDED",
      "BUSINESS_BOOKS_AUDIT_THRESHOLD_EXCEEDED",
    ]);
    expect(r.warnings[0]?.message).toContain("₹12000000");
    expect(r.warnings[0]?.message).toContain("aggregated across 2 records");
    expect(r.input.businessBooksEntries).toEqual([]);
    expect(r.complete).toBe(false);
  });

  it("sums the 44AB(a) and 44AB(b) limbs SEPARATELY, never pooled", () => {
    // ₹90L business + ₹40L profession. Pooled that is ₹1.3cr and would look
    // like a breach; per limb neither clears its own threshold, and the two
    // clauses ask different questions. Both must compute.
    const r = buildEngineInput(
      rows({
        businessBooksEntries: [
          booksRow({ id: "b1", revenue: "9000000", expenses: "1000000", is_profession: false }),
          booksRow({ id: "p1", revenue: "4000000", expenses: "1000000", is_profession: true }),
        ],
      }),
      META,
    );
    expect(r.warnings.map((w) => w.code)).toEqual([]);
    expect(r.input.businessBooksEntries?.map((e) => e.id)).toEqual(["b1", "p1"]);
  });

  it("a breach in ONE limb still excludes the other limb's rows, with a reason", () => {
    const r = buildEngineInput(
      rows({
        businessBooksEntries: [
          booksRow({ id: "p1", revenue: "6000000", is_profession: true }), // > ₹50L
          // Genuinely clean: profitable, in-threshold, declared basis. It must
          // be, or it would fail a gate of its own — the earlier version of
          // this fixture left `expenses` at the ₹24,00,000 default against
          // ₹10,00,000 revenue, so it was a LOSS wearing a sibling's code.
          booksRow({ id: "b1", revenue: "1000000", expenses: "400000", is_profession: false }),
        ],
      }),
      META,
    );
    expect(r.warnings.map((w) => w.code)).toEqual([
      "BUSINESS_BOOKS_AUDIT_THRESHOLD_EXCEEDED",
      "BUSINESS_BOOKS_SIBLING_ROW_REFUSED",
    ]);
    // The surviving row is told WHY it went — never silently dropped (D86).
    expect(r.warnings[1]?.ledgerId).toBe("b1");
    expect(r.warnings[1]?.message).toContain("passes every check this engine applies");
    expect(r.excludedLedgerIds).toEqual(["p1", "b1"]);
    expect(r.input.businessBooksEntries).toEqual([]);
  });

  it("one refused row excludes the whole head, each under its OWN code", () => {
    const r = buildEngineInput(
      rows({
        businessBooksEntries: [
          booksRow({ id: "b1" }),
          booksRow({ id: "b2", adjustments: "depreciation_s32" }),
          booksRow({ id: "b3", adjustments: null }),
        ],
      }),
      META,
    );
    // b1 is fine, b2 declares depreciation, b3 declares nothing — three rows,
    // three DIFFERENT codes. A shared gate must not collapse them into one.
    expect(r.warnings.map((w) => [w.ledgerId, w.code])).toEqual([
      ["b1", "BUSINESS_BOOKS_SIBLING_ROW_REFUSED"],
      ["b2", "BUSINESS_BOOKS_DEPRECIATION_UNSUPPORTED"],
      ["b3", "BUSINESS_BOOKS_ADJUSTMENTS_UNDECLARED"],
    ]);
    expect(r.input.businessBooksEntries).toEqual([]);
    expect(r.complete).toBe(false);
  });

  // The sibling code claims the row passes EVERY gate against the current
  // data. A row may only receive it if it has been checked against every gate,
  // not just the one that happened to fire first. The head is re-evaluated
  // after remediation; the message makes no promise about that future result.
  it("a row that would fail a LATER gate never receives the sibling code", () => {
    const r = buildEngineInput(
      rows({
        businessBooksEntries: [
          booksRow({ id: "b_undeclared", adjustments: null }),
          // Valid basis, but ₹2cr on its own — over the 44AB(a) threshold, and
          // over it again on the aggregate. Under a first-gate-wins design this
          // row was told it was computable and would compute once the sibling
          // was fixed. Both statements were false.
          booksRow({ id: "b_big", revenue: "20000000" }),
        ],
      }),
      META,
    );
    expect(r.warnings.map((w) => [w.ledgerId, w.code])).toEqual([
      ["b_undeclared", "BUSINESS_BOOKS_ADJUSTMENTS_UNDECLARED"],
      ["b_big", "BUSINESS_BOOKS_AUDIT_THRESHOLD_EXCEEDED"],
    ]);
    expect(r.warnings.map((w) => w.message).join(" ")).not.toContain("is itself computable");
  });

  it("K4-17 admits a current-year loss fully absorbed by a sibling profit under Section 70(1)", () => {
    const r = buildEngineInput(
      rows({
        businessBooksEntries: [
          booksRow({ id: "b1", revenue: "1000000", expenses: "400000" }),
          booksRow({ id: "b2", revenue: "100000", expenses: "500000" }),
        ],
      }),
      META,
    );
    expect(r.warnings).toEqual([]);
    expect(r.input.businessBooksEntries?.map((e) => [e.id, e.revenue - e.expenses])).toEqual([
      ["b1", 600_000],
      ["b2", -400_000],
    ]);
    expect(r.summary.businessBooksNetProfit).toBe(200_000);
    expect(r.sourceTrace.find((g) => g.key === "business_books")?.total).toBe(200_000);
  });

  it.each([
    [null, "BUSINESS_BOOKS_ACTIVITY_UNDECLARED"],
    ["futures_and_options", "BUSINESS_BOOKS_FNO_UNSUPPORTED"],
    ["speculation_business_s73", "BUSINESS_BOOKS_SPECULATION_UNSUPPORTED"],
    ["specified_business_s35ad", "BUSINESS_BOOKS_SPECIFIED_BUSINESS_UNSUPPORTED"],
  ] as const)("refuses the excluded or undeclared activity pool %s", (classification, code) => {
    const r = buildEngineInput(
      rows({
        businessBooksEntries: [
          booksRow({
            revenue: "100000",
            expenses: "200000",
            activity_classification: classification,
          }),
          booksRow({ id: "profit", revenue: "500000", expenses: "100000" }),
        ],
      }),
      META,
    );
    expect(r.warnings.map((warning) => [warning.ledgerId, warning.code])).toContainEqual([
      "books_1",
      code,
    ]);
    expect(r.input.businessBooksEntries).toEqual([]);
  });

  it("does not let a refused restricted-pool profit mask an ordinary residual loss", () => {
    const r = buildEngineInput(
      rows({
        businessBooksEntries: [
          booksRow({ id: "ordinary_loss", revenue: "0", expenses: "100" }),
          booksRow({
            id: "speculation_profit",
            revenue: "200",
            expenses: "0",
            activity_classification: "speculation_business_s73",
          }),
        ],
      }),
      META,
    );
    expect(r.warnings.map((warning) => [warning.ledgerId, warning.code])).toEqual([
      ["ordinary_loss", "BUSINESS_BOOKS_LOSS_NOT_MODELLED"],
      ["speculation_profit", "BUSINESS_BOOKS_SPECULATION_UNSUPPORTED"],
    ]);
    expect(r.input.businessBooksEntries).toEqual([]);
  });

  it("uses exact paise at zero and stays invariant to decimal-row order", () => {
    const decimalRows = [
      booksRow({ id: "p", revenue: "0.03", expenses: "0.00" }),
      booksRow({ id: "n1", revenue: "0.00", expenses: "0.02" }),
      booksRow({ id: "n2", revenue: "0.00", expenses: "0.01" }),
    ];
    for (const entries of [decimalRows, [...decimalRows].reverse()]) {
      const r = buildEngineInput(rows({ businessBooksEntries: entries }), META);
      expect(r.complete).toBe(true);
      expect(r.warnings).toEqual([]);
      expect(r.summary.businessBooksNetProfit).toBe(0);
      expect(r.sourceTrace.find((group) => group.key === "business_books")?.total).toBe(0);
    }
  });

  it("admits multiple positive and negative rows at an exact-zero aggregate", () => {
    const r = buildEngineInput(
      rows({
        businessBooksEntries: [
          booksRow({ id: "p1", revenue: "900000", expenses: "300000" }),
          booksRow({ id: "n1", revenue: "100000", expenses: "500000" }),
          booksRow({ id: "p2", revenue: "400000", expenses: "200000" }),
          booksRow({ id: "n2", revenue: "0", expenses: "400000" }),
        ],
      }),
      META,
    );
    expect(r.complete).toBe(true);
    expect(r.warnings).toEqual([]);
    expect(r.input.businessBooksEntries).toHaveLength(4);
    expect(r.summary.businessBooksNetProfit).toBe(0);
    expect(hasMeaningfulInput(r)).toBe(true);
  });

  it("refuses a negative aggregate in full while each negative row keeps its own code", () => {
    const r = buildEngineInput(
      rows({
        businessBooksEntries: [
          booksRow({ id: "p1", revenue: "500000", expenses: "100000" }),
          booksRow({ id: "n1", revenue: "0", expenses: "300000" }),
          booksRow({ id: "n2", revenue: "0", expenses: "200000" }),
        ],
      }),
      META,
    );
    expect(r.warnings.map((w) => [w.ledgerId, w.code])).toEqual([
      ["p1", "BUSINESS_BOOKS_SIBLING_ROW_REFUSED"],
      ["n1", "BUSINESS_BOOKS_LOSS_NOT_MODELLED"],
      ["n2", "BUSINESS_BOOKS_LOSS_NOT_MODELLED"],
    ]);
    expect(r.warnings[1]?.message).toContain("residual loss of ₹100000");
    expect(r.input.businessBooksEntries).toEqual([]);
    expect(r.summary.businessBooksNetProfit).toBe(0);
  });

  it("is invariant to row order and undertaking count throughout the admitted window", () => {
    const base = [
      booksRow({ id: "p1", revenue: "800000", expenses: "200000" }),
      booksRow({ id: "n1", revenue: "100000", expenses: "300000" }),
      booksRow({ id: "p2", revenue: "300000", expenses: "200000", is_profession: true }),
      booksRow({ id: "n2", revenue: "0", expenses: "100000", is_profession: true }),
    ];
    const permutations = [
      base,
      [...base].reverse(),
      [base[1]!, base[3]!, base[0]!, base[2]!],
      [base[2]!, base[0]!, base[3]!, base[1]!],
    ];
    for (const entries of permutations) {
      const r = buildEngineInput(rows({ businessBooksEntries: entries }), META);
      expect(r.complete).toBe(true);
      expect(r.warnings).toEqual([]);
      expect(r.summary.businessBooksNetProfit).toBe(400_000);
      expect(new Set(r.input.businessBooksEntries?.map((e) => e.id))).toEqual(
        new Set(["p1", "n1", "p2", "n2"]),
      );
    }

    for (let undertakingCount = 2; undertakingCount <= 8; undertakingCount += 1) {
      const entries = Array.from({ length: undertakingCount }, (_, index) =>
        booksRow({
          id: `u${index}`,
          revenue: index === undertakingCount - 1 ? "0" : "200000",
          expenses: index === undertakingCount - 1 ? String((undertakingCount - 1) * 100_000) : "100000",
        }),
      );
      const r = buildEngineInput(rows({ businessBooksEntries: entries }), META);
      expect(r.complete).toBe(true);
      expect(r.summary.businessBooksNetProfit).toBe(0);
      expect(r.input.businessBooksEntries).toHaveLength(undertakingCount);
    }
  });

  it("preserves one-bad-row refusal when a negative sibling would otherwise be admissible", () => {
    const r = buildEngineInput(
      rows({
        businessBooksEntries: [
          booksRow({ id: "profit", revenue: "900000", expenses: "200000" }),
          booksRow({ id: "loss", revenue: "100000", expenses: "400000" }),
          booksRow({ id: "bad", revenue: "100000", expenses: "50000", adjustments: "depreciation_s32" }),
        ],
      }),
      META,
    );
    expect(r.warnings.map((w) => [w.ledgerId, w.code])).toEqual([
      ["profit", "BUSINESS_BOOKS_SIBLING_ROW_REFUSED"],
      ["loss", "BUSINESS_BOOKS_SIBLING_ROW_REFUSED"],
      ["bad", "BUSINESS_BOOKS_DEPRECIATION_UNSUPPORTED"],
    ]);
    expect(r.input.businessBooksEntries).toEqual([]);
  });

  // `MULTIPLE_BUSINESS_BOOKS_NOT_MODELLED` was DELETED from `MappingWarningCode`
  // rather than deprecated. No test guards that, deliberately: the union is the
  // guard — re-emitting the retired code no longer compiles. A source-scanning
  // assertion here would be a weaker duplicate of the type checker.

  // AUDIT-03-F9 / D86, applied to this head: excluding the rows must never be
  // read as "no business income exists", which is exactly what the Section
  // 207(2) disclosure would otherwise state in writing to a resident senior.
  it.each([
    "depreciation_s32",
    "disallowance_s37_s40_s43b",
    "presumptive_transition",
  ] as const)("keeps hasBusinessOrProfessionalIncome true even when refusing (%s)", (adjustments) => {
    const r = buildEngineInput(rows({ businessBooksEntries: [booksRow({ adjustments })] }), META);
    expect(r.complete).toBe(false);
    expect(r.input.hasBusinessOrProfessionalIncome).toBe(true);
  });

  it("the declared-basis gate runs BEFORE the threshold and loss gates", () => {
    // A row wrong in three ways at once must report the ADJUSTMENT problem:
    // telling a preparer to reduce turnover, when the real defect is that the
    // accounts need Sections 30-43D work, sends them to fix the wrong thing
    // (K4-13's activity-before-ceiling ordering, reapplied).
    const r = buildEngineInput(
      rows({
        businessBooksEntries: [
          booksRow({ adjustments: "depreciation_s32", revenue: "90000000", expenses: "99000000" }),
        ],
      }),
      META,
    );
    expect(r.warnings.map((w) => w.code)).toEqual(["BUSINESS_BOOKS_DEPRECIATION_UNSUPPORTED"]);
  });

  it("a declared books row is meaningful input even at zero net profit", () => {
    const r = buildEngineInput(
      rows({ businessBooksEntries: [booksRow({ revenue: "500000", expenses: "500000" })] }),
      META,
    );
    expect(r.summary.businessBooksNetProfit).toBe(0);
    expect(hasMeaningfulInput(r)).toBe(true);
  });

  it("a case with no books rows matches one with an empty array", () => {
    const income = [{ id: "i1", income_head: "salary", amount: "900000", source_type: "Form16" }];
    const absent = buildEngineInput(rows({ income }), META);
    const empty = buildEngineInput(rows({ income, businessBooksEntries: [] }), META);
    expect(empty.summary).toEqual(absent.summary);
    expect(empty.complete).toBe(absent.complete);
    expect(empty.input.businessBooksEntries).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// K4-18 — source-first F&O / intraday slice
//
// The statutory chain these tests pin, established in
// the k4-18-fno-source-research design notes from primary text:
//
//   s.43(5) main limb          -> intraday equity settled without delivery is a
//                                 speculative transaction
//   s.43(5) proviso (d)        -> an ELIGIBLE transaction in exchange-traded
//     with Explanation 1          derivatives is NOT speculative (conjunctive,
//                                 per-transaction, and unverifiable by this
//                                 product — hence a declaration)
//   Explanation 2 to s.28      -> a speculation business is deemed distinct and
//                                 separate from any other business
//   s.70 ("Save as otherwise   -> so its loss never enters the ordinary pool
//     provided") with s.73(1)
//
// and the negative that shapes the turnover half: NO statutory, CBDT or
// return-form source defines turnover for derivatives, so the preparer declares
// it and the engine applies only the statutory threshold.
// ---------------------------------------------------------------------------

/** An F&O undertaking whose eligible-transaction status IS affirmed. */
function fnoRow(overrides: Partial<BusinessBooksLedgerRow> = {}): BusinessBooksLedgerRow {
  return booksRow({
    id: "books_fno",
    activity_classification: "fno_non_speculative_s43_5_d",
    declared_turnover: "4000000",
    ...overrides,
  });
}

describe("buildEngineInput — F&O and intraday classification (K4-18)", () => {
  it("computes an affirmed non-speculative F&O undertaking inside the ordinary Section 70 pool", () => {
    const r = buildEngineInput(rows({ businessBooksEntries: [fnoRow()] }), META);
    expect(r.warnings).toEqual([]);
    expect(r.complete).toBe(true);
    expect(r.input.businessBooksEntries).toHaveLength(1);
    expect(r.input.businessBooksEntries?.[0]?.activityClassification).toBe(
      "fno_non_speculative_s43_5_d",
    );
    // The DECLARED turnover is carried; books revenue is not silently reused.
    expect(r.input.businessBooksEntries?.[0]?.declaredTurnover).toBe(4_000_000);
    expect(r.summary.businessBooksNetProfit).toBe(600_000);
  });

  it("REFUSES affirmed F&O that declares no turnover — revenue is never substituted", () => {
    const r = buildEngineInput(
      rows({ businessBooksEntries: [fnoRow({ declared_turnover: null })] }),
      META,
    );
    expect(r.warnings.map((w) => w.code)).toEqual(["BUSINESS_BOOKS_TURNOVER_UNDECLARED"]);
    expect(r.complete).toBe(false);
    expect(r.input.businessBooksEntries).toEqual([]);
    // The refusal must say WHY no formula exists, not merely that a field is
    // missing — otherwise the next session "helpfully" derives one.
    expect(r.warnings[0]?.message).toContain("No statutory, CBDT or return-form source");
  });

  it("REFUSES an undefined declared turnover exactly as it refuses null", () => {
    const r = buildEngineInput(
      rows({ businessBooksEntries: [fnoRow({ declared_turnover: undefined })] }),
      META,
    );
    expect(r.warnings.map((w) => w.code)).toEqual(["BUSINESS_BOOKS_TURNOVER_UNDECLARED"]);
    expect(r.complete).toBe(false);
  });

  it("REFUSES a negative declared turnover — turnover is a gross measure", () => {
    const r = buildEngineInput(
      rows({ businessBooksEntries: [fnoRow({ declared_turnover: "-1" })] }),
      META,
    );
    expect(r.warnings.map((w) => w.code)).toEqual(["BUSINESS_BOOKS_TURNOVER_UNDECLARED"]);
    expect(r.complete).toBe(false);
  });

  it("still REFUSES F&O whose eligible-transaction status is NOT affirmed", () => {
    // Proviso (d) is conditional. Unaffirmed derivative activity falls back to
    // the main limb, so this member must never become computable by proximity
    // to the affirmed one.
    const r = buildEngineInput(
      rows({ businessBooksEntries: [booksRow({ activity_classification: "futures_and_options" })] }),
      META,
    );
    expect(r.warnings.map((w) => w.code)).toEqual(["BUSINESS_BOOKS_FNO_UNSUPPORTED"]);
    expect(r.complete).toBe(false);
  });

  it("REFUSES intraday equity under the Section 43(5) main limb, citing the quarantine", () => {
    const r = buildEngineInput(
      rows({
        businessBooksEntries: [booksRow({ activity_classification: "intraday_speculative_s43_5" })],
      }),
      META,
    );
    expect(r.warnings.map((w) => w.code)).toEqual([
      "BUSINESS_BOOKS_INTRADAY_SPECULATIVE_UNSUPPORTED",
    ]);
    expect(r.complete).toBe(false);
    expect(r.warnings[0]?.message).toContain("Explanation 2 to Section 28");
  });

  it("never lets a refused speculative row leak into the ordinary pool beside a clean one", () => {
    // The head is a Section 28 aggregate and is all-or-nothing, so an intraday
    // row must take the whole head with it rather than being netted or dropped.
    const r = buildEngineInput(
      rows({
        businessBooksEntries: [
          booksRow({ id: "ordinary", revenue: "3000000", expenses: "2400000" }),
          booksRow({
            id: "intraday",
            activity_classification: "intraday_speculative_s43_5",
            revenue: "900000",
            expenses: "100000",
          }),
        ],
      }),
      META,
    );
    expect(r.complete).toBe(false);
    expect(r.input.businessBooksEntries).toEqual([]);
    expect(r.summary.businessBooksNetProfit).toBe(0);
    expect(r.warnings.map((w) => w.code).sort()).toEqual([
      "BUSINESS_BOOKS_INTRADAY_SPECULATIVE_UNSUPPORTED",
      "BUSINESS_BOOKS_SIBLING_ROW_REFUSED",
    ]);
  });
});

describe("buildEngineInput — Section 44AB on a declared F&O turnover (K4-18)", () => {
  it("tests the DECLARED turnover against 44AB(a), not the books revenue", () => {
    // Revenue is trivial; the declared turnover is what exceeds the threshold.
    // Before K4-18 such a row could only have been tested on revenue.
    const r = buildEngineInput(
      rows({
        businessBooksEntries: [
          fnoRow({ revenue: "500000", expenses: "100000", declared_turnover: "10000001" }),
        ],
      }),
      META,
    );
    expect(r.warnings.map((w) => w.code)).toEqual(["BUSINESS_BOOKS_AUDIT_THRESHOLD_EXCEEDED"]);
    expect(r.warnings[0]?.message).toContain("44AB(a)");
  });

  it("EXACTLY at the threshold is admitted — the statute says exceed", () => {
    const r = buildEngineInput(
      rows({
        businessBooksEntries: [
          fnoRow({ revenue: "500000", expenses: "100000", declared_turnover: "10000000" }),
        ],
      }),
      META,
    );
    expect(r.complete).toBe(true);
    expect(r.input.businessBooksEntries).toHaveLength(1);
  });

  it("one paise over the threshold is refused — the boundary is exact, not approximate", () => {
    const r = buildEngineInput(
      rows({
        businessBooksEntries: [
          fnoRow({ revenue: "500000", expenses: "100000", declared_turnover: "10000000.01" }),
        ],
      }),
      META,
    );
    expect(r.warnings.map((w) => w.code)).toEqual(["BUSINESS_BOOKS_AUDIT_THRESHOLD_EXCEEDED"]);
  });

  it("sums an ordinary row's REVENUE with an F&O row's DECLARED turnover in one 44AB(a) limb", () => {
    // 60,00,000 revenue + 40,00,000 declared = exactly 1,00,00,000 -> admitted.
    const atThreshold = buildEngineInput(
      rows({
        businessBooksEntries: [
          booksRow({ id: "ordinary", revenue: "6000000", expenses: "100000" }),
          fnoRow({ revenue: "50000", expenses: "10000", declared_turnover: "4000000" }),
        ],
      }),
      META,
    );
    expect(atThreshold.complete).toBe(true);

    // One paise more, contributed by the DECLARED side, tips the aggregate.
    const overThreshold = buildEngineInput(
      rows({
        businessBooksEntries: [
          booksRow({ id: "ordinary", revenue: "6000000", expenses: "100000" }),
          fnoRow({ revenue: "50000", expenses: "10000", declared_turnover: "4000000.01" }),
        ],
      }),
      META,
    );
    expect(overThreshold.warnings.map((w) => w.code)).toContain(
      "BUSINESS_BOOKS_AUDIT_THRESHOLD_EXCEEDED",
    );
  });

  it("keeps the 44AB limbs separate — an F&O profession uses the 44AB(b) threshold", () => {
    const r = buildEngineInput(
      rows({
        businessBooksEntries: [
          fnoRow({
            is_profession: true,
            revenue: "10000",
            expenses: "1000",
            declared_turnover: "5000001",
          }),
        ],
      }),
      META,
    );
    expect(r.warnings.map((w) => w.code)).toEqual(["BUSINESS_BOOKS_AUDIT_THRESHOLD_EXCEEDED"]);
    expect(r.warnings[0]?.message).toContain("44AB(b)");
  });

  it("is invariant to row ORDER and to undertaking COUNT at the exact boundary", () => {
    // These three values are chosen, not decorative. They sum to EXACTLY
    // ₹1,00,00,000 in paise, so the case must be admitted in every ordering
    // ("exceed or exceeds" is strictly `>`). In binary floating point they do
    // not: 4 of the 6 permutations evaluate to 10000000.000000001863, which is
    // ABOVE the threshold. Summed as `sum + c.revenue` — the pre-K4-18 code —
    // those four orderings would each have refused this case with
    // BUSINESS_BOOKS_AUDIT_THRESHOLD_EXCEEDED while the other two admitted it,
    // making the verdict depend on the order rows came back from PostgREST.
    // Integer-paise arithmetic returns exactly 1000000000 in all six.
    const parts = [
      booksRow({ id: "a", revenue: "0.05", expenses: "0" }),
      booksRow({ id: "b", revenue: "1.07", expenses: "0" }),
      booksRow({ id: "c", revenue: "9999998.88", expenses: "0" }),
    ];
    const [a, b, c] = [parts[0]!, parts[1]!, parts[2]!];
    for (const businessBooksEntries of [
      [a, b, c],
      [c, b, a],
      [b, c, a],
      [a, c, b],
      [c, a, b],
      [b, a, c],
    ]) {
      const r = buildEngineInput(rows({ businessBooksEntries }), META);
      expect(
        r.warnings.map((w) => w.code),
        `order ${businessBooksEntries.map((e) => e.id).join(",")} must not refuse`,
      ).toEqual([]);
      expect(r.complete).toBe(true);
    }

    // And the same total expressed as ONE undertaking behaves identically —
    // the boundary cannot move with undertaking count either.
    const single = buildEngineInput(
      rows({ businessBooksEntries: [booksRow({ revenue: "10000000", expenses: "0" })] }),
      META,
    );
    expect(single.complete).toBe(true);
  });

  it("does not read a limb as under-threshold when a row could not state its turnover", () => {
    // The unstated row is refused in its own right, and the head is
    // all-or-nothing — but the limb must never be CONCLUDED safe on a total it
    // could not measure. Asserted directly so the property does not depend on
    // some other gate happening to fire first.
    const r = buildEngineInput(
      rows({
        businessBooksEntries: [
          booksRow({ id: "ordinary", revenue: "100000", expenses: "10000" }),
          fnoRow({ id: "unstated", declared_turnover: null }),
        ],
      }),
      META,
    );
    expect(r.complete).toBe(false);
    expect(r.warnings.map((w) => w.code)).toContain("BUSINESS_BOOKS_TURNOVER_UNDECLARED");
  });
});
