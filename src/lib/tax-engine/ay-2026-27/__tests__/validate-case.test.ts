import { describe, expect, it } from "vitest";
import { validateCase } from "../validate-case";
import { reconciliationMismatchCase, salaryCapitalGainsCase } from "../fixtures";
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

const codes = (input: TaxEngineInput) => validateCase(input).findings.map((f) => f.code);

describe("validateCase — AY 2026-27", () => {
  it("flags missing required documents", () => {
    expect(codes(reconciliationMismatchCase)).toContain("DOC_MISSING");
  });

  it("flags AIS interest that was reported but not entered", () => {
    expect(codes(reconciliationMismatchCase)).toContain("AIS_INTEREST_NOT_ENTERED");
  });

  it("flags an AIS interest mismatch when entered is lower", () => {
    const input = makeInput({
      income: [
        { id: "fd_ais", category: "fd_interest", amount: 30_000, sourceType: "AIS" },
        { id: "fd_manual", category: "fd_interest", amount: 10_000, sourceType: "manual" },
      ],
    });
    const finding = validateCase(input).findings.find((f) => f.code === "AIS_INTEREST_MISMATCH");
    expect(finding).toBeDefined();
    expect(finding?.difference).toBe(20_000);
  });

  it("flags 26AS TDS with no mapped income", () => {
    expect(codes(reconciliationMismatchCase)).toContain("TDS_26AS_UNMAPPED");
  });

  it("flags a Form 16 vs entered salary mismatch", () => {
    const input = makeInput({
      income: [
        { id: "sal_f16", category: "salary", amount: 800_000, sourceType: "Form16" },
        { id: "sal_manual", category: "salary", amount: 750_000, sourceType: "manual" },
      ],
    });
    const finding = validateCase(input).findings.find((f) => f.code === "FORM16_SALARY_MISMATCH");
    expect(finding).toBeDefined();
    expect(finding?.difference).toBe(-50_000);
  });

  it("flags deductions claimed without proof", () => {
    const input = makeInput({
      income: [{ id: "s1", category: "salary", amount: 600_000, sourceType: "Form16" }],
      deductions: [{ id: "d1", section: "80C", amount: 100_000, sourceType: "manual" }],
    });
    expect(codes(input)).toContain("DEDUCTION_PROOF_MISSING");
  });

  it("flags an 80TTA claim by a resident senior citizen (K4-03)", () => {
    const input = makeInput({
      taxpayer: { residentStatus: "resident", ageCategory: "senior" },
      deductions: [{ id: "tta1", section: "80TTA", amount: 10_000, sourceType: "manual" }],
    });
    const finding = validateCase(input).findings.find((f) => f.code === "DEDUCTION_SECTION_AGE_MISMATCH");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("80TTA");
  });

  it("flags an 80TTA claim by a resident super-senior citizen (K4-03)", () => {
    const input = makeInput({
      taxpayer: { residentStatus: "resident", ageCategory: "super_senior" },
      deductions: [{ id: "tta1", section: "80TTA", amount: 10_000, sourceType: "manual" }],
    });
    expect(codes(input)).toContain("DEDUCTION_SECTION_AGE_MISMATCH");
  });

  it("flags an 80TTB claim by a resident below-60 taxpayer (K4-03 — closes the K4-02 dossier's second finding)", () => {
    const input = makeInput({
      taxpayer: { residentStatus: "resident", ageCategory: "below_60" },
      deductions: [{ id: "ttb1", section: "80TTB", amount: 50_000, sourceType: "manual" }],
    });
    const finding = validateCase(input).findings.find((f) => f.code === "DEDUCTION_SECTION_AGE_MISMATCH");
    expect(finding).toBeDefined();
    expect(finding?.message).toContain("80TTB");
  });

  it("does not flag a below-60 taxpayer's 80TTA claim, or a senior's 80TTB claim (correctly matched sections)", () => {
    const belowSixty = makeInput({
      taxpayer: { residentStatus: "resident", ageCategory: "below_60" },
      deductions: [{ id: "tta1", section: "80TTA", amount: 10_000, sourceType: "manual" }],
    });
    expect(codes(belowSixty)).not.toContain("DEDUCTION_SECTION_AGE_MISMATCH");

    const senior = makeInput({
      taxpayer: { residentStatus: "resident", ageCategory: "senior" },
      deductions: [{ id: "ttb1", section: "80TTB", amount: 50_000, sourceType: "manual" }],
    });
    expect(codes(senior)).not.toContain("DEDUCTION_SECTION_AGE_MISMATCH");
  });

  it("does not flag an 80TTB claim for a non-resident or unresolved-residency senior (mirrors compute-tax.ts's own residency gate)", () => {
    const nonResident = makeInput({
      taxpayer: { residentStatus: "non_resident", ageCategory: "senior" },
      deductions: [{ id: "ttb1", section: "80TTB", amount: 50_000, sourceType: "manual" }],
    });
    expect(codes(nonResident)).not.toContain("DEDUCTION_SECTION_AGE_MISMATCH");

    const unresolved = makeInput({
      taxpayer: { ageCategory: "senior" },
      deductions: [{ id: "ttb1", section: "80TTB", amount: 50_000, sourceType: "manual" }],
    });
    expect(codes(unresolved)).not.toContain("DEDUCTION_SECTION_AGE_MISMATCH");
  });

  it("blocks ITR-1 when capital gains are present", () => {
    const finding = validateCase(salaryCapitalGainsCase).findings.find(
      (f) => f.code === "CG_REQUIRES_ITR2",
    );
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("blocker");
  });

  it("blocks when client approval is missing before filing", () => {
    const input = makeInput({ filingStatus: "ready_to_file", clientApprovalStatus: "pending" });
    const finding = validateCase(input).findings.find((f) => f.code === "APPROVAL_MISSING");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("blocker");
  });

  it("warns when e-verification is pending after filing", () => {
    const input = makeInput({
      filingStatus: "filed",
      clientApprovalStatus: "approved",
      eVerificationStatus: "pending",
    });
    expect(codes(input)).toContain("EVERIFICATION_PENDING");
  });

  it("blocks an edit on a finalized case", () => {
    const input = makeInput({ finalized: true, editRequested: true });
    const finding = validateCase(input).findings.find((f) => f.code === "FINALIZED_EDIT_BLOCKED");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("blocker");
  });

  it("discloses the Section 207(2) advance-tax exemption for a resident senior citizen with tax payable and no business income (K4-04)", () => {
    const input = makeInput({
      taxpayer: { residentStatus: "resident", ageCategory: "senior" },
      income: [{ id: "s1", category: "salary", amount: 2_000_000, sourceType: "Form16" }],
    });
    const finding = validateCase(input).findings.find((f) => f.code === "ADVANCE_TAX_EXEMPT_SENIOR_CITIZEN_207_2");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("info");
    expect(finding?.area).toBe("payments");
  });

  it("discloses the Section 207(2) exemption for a resident super-senior citizen too (K4-04)", () => {
    const input = makeInput({
      taxpayer: { residentStatus: "resident", ageCategory: "super_senior" },
      income: [{ id: "s1", category: "salary", amount: 2_000_000, sourceType: "Form16" }],
    });
    expect(codes(input)).toContain("ADVANCE_TAX_EXEMPT_SENIOR_CITIZEN_207_2");
  });

  it("does not disclose the Section 207(2) exemption when the taxpayer has business/professional income (K4-04)", () => {
    const input = makeInput({
      taxpayer: { residentStatus: "resident", ageCategory: "senior" },
      income: [{ id: "s1", category: "salary", amount: 2_000_000, sourceType: "Form16" }],
      hasBusinessOrProfessionalIncome: true,
    });
    expect(codes(input)).not.toContain("ADVANCE_TAX_EXEMPT_SENIOR_CITIZEN_207_2");
  });

  it("does not disclose the Section 207(2) exemption for a below-60 taxpayer, a non-resident senior, or an unresolved-residency senior (K4-04)", () => {
    const belowSixty = makeInput({
      taxpayer: { residentStatus: "resident", ageCategory: "below_60" },
      income: [{ id: "s1", category: "salary", amount: 2_000_000, sourceType: "Form16" }],
    });
    expect(codes(belowSixty)).not.toContain("ADVANCE_TAX_EXEMPT_SENIOR_CITIZEN_207_2");

    const nonResident = makeInput({
      taxpayer: { residentStatus: "non_resident", ageCategory: "senior" },
      income: [{ id: "s1", category: "salary", amount: 2_000_000, sourceType: "Form16" }],
    });
    expect(codes(nonResident)).not.toContain("ADVANCE_TAX_EXEMPT_SENIOR_CITIZEN_207_2");

    const unresolved = makeInput({
      taxpayer: { ageCategory: "senior" },
      income: [{ id: "s1", category: "salary", amount: 2_000_000, sourceType: "Form16" }],
    });
    expect(codes(unresolved)).not.toContain("ADVANCE_TAX_EXEMPT_SENIOR_CITIZEN_207_2");
  });

  it("does not disclose the Section 207(2) exemption when there is no tax payable (refund position)", () => {
    const input = makeInput({
      taxpayer: { residentStatus: "resident", ageCategory: "senior" },
      income: [{ id: "s1", category: "salary", amount: 800_000, sourceType: "Form16" }],
      taxPaid: [{ id: "t1", category: "salary_tds", amount: 60_000, sourceType: "Form16" }],
    });
    expect(codes(input)).not.toContain("ADVANCE_TAX_EXEMPT_SENIOR_CITIZEN_207_2");
  });

  it("rejects portal credential-like text in free text", () => {
    const input = makeInput({ notes: "Client shared the e-filing portal password over the phone." });
    const finding = validateCase(input).findings.find((f) => f.code === "PORTAL_CREDENTIAL_TEXT");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("blocker");
    expect(validateCase(input).hasBlockers).toBe(true);
  });
});

describe("validateCase — house property (K4-06)", () => {
  it("blocks ITR-1 when the recommended regime shows a house-property loss", () => {
    const input = makeInput({
      selectedItrType: "ITR-1",
      income: [{ id: "s1", category: "salary", amount: 800_000, sourceType: "Form16" }],
      housePropertyEntries: [
        {
          id: "hp1",
          amount: 0,
          sourceType: "manual",
          usage: "self_occupied",
          annualRentReceived: 0,
          municipalTaxesPaid: 0,
          homeLoanInterest: 150_000,
          proofDocumentId: "proof1",
        },
      ],
    });
    // Recommended regime is "new" (no interest allowed there → no loss) —
    // so this is NOT expected to block; confirms the blocker reads the
    // RECOMMENDED regime's own treatment, not the old regime's unconditionally.
    expect(codes(input)).not.toContain("HOUSE_PROPERTY_LOSS_REQUIRES_ITR2");
  });

  it("flags missing proof for a claimed home-loan interest deduction", () => {
    const input = makeInput({
      housePropertyEntries: [
        {
          id: "hp1",
          amount: 0,
          sourceType: "manual",
          usage: "self_occupied",
          annualRentReceived: 0,
          municipalTaxesPaid: 0,
          homeLoanInterest: 100_000,
        },
      ],
    });
    const finding = validateCase(input).findings.find((f) => f.code === "HOUSE_PROPERTY_INTEREST_PROOF_MISSING");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
  });

  it("does not flag missing proof once a proof or source document is attached", () => {
    const input = makeInput({
      housePropertyEntries: [
        {
          id: "hp1",
          amount: 0,
          sourceType: "manual",
          usage: "self_occupied",
          annualRentReceived: 0,
          municipalTaxesPaid: 0,
          homeLoanInterest: 100_000,
          proofDocumentId: "proof1",
        },
      ],
    });
    expect(codes(input)).not.toContain("HOUSE_PROPERTY_INTEREST_PROOF_MISSING");
  });

  it("discloses the Section 71(3A) set-off cap when the old-regime loss exceeds ₹2,00,000", () => {
    const input = makeInput({
      housePropertyEntries: [
        {
          id: "hp1",
          amount: 0,
          sourceType: "manual",
          usage: "let_out",
          annualRentReceived: 0,
          municipalTaxesPaid: 0,
          homeLoanInterest: 300_000,
          proofDocumentId: "proof1",
        },
      ],
    });
    const finding = validateCase(input).findings.find((f) => f.code === "HOUSE_PROPERTY_LOSS_SETOFF_CAPPED");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("info");
  });

  it("no house-property findings fire when nothing is declared", () => {
    const input = makeInput({});
    expect(codes(input)).not.toContain("HOUSE_PROPERTY_LOSS_REQUIRES_ITR2");
    expect(codes(input)).not.toContain("HOUSE_PROPERTY_INTEREST_PROOF_MISSING");
    expect(codes(input)).not.toContain("HOUSE_PROPERTY_LOSS_SETOFF_CAPPED");
  });
});

describe("validateCase — presumptive professional income (44ADA, K4-07)", () => {
  it("blocks ITR-1 when presumptive-44ADA income is present", () => {
    const input = makeInput({
      selectedItrType: "ITR-1",
      income: [{ id: "p1", category: "presumptive_professional_44ada", amount: 800_000, sourceType: "manual" }],
    });
    const finding = validateCase(input).findings.find((f) => f.code === "PRESUMPTIVE_44ADA_REQUIRES_ITR4");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("blocker");
    expect(finding?.area).toBe("itr_form");
  });

  it("does not block when ITR-1 is not selected", () => {
    const input = makeInput({
      selectedItrType: "ITR-4",
      income: [{ id: "p1", category: "presumptive_professional_44ada", amount: 800_000, sourceType: "manual" }],
    });
    expect(codes(input)).not.toContain("PRESUMPTIVE_44ADA_REQUIRES_ITR4");
  });

  it("discloses the deemed-profit basis whenever presumptive-44ADA income is declared", () => {
    const input = makeInput({
      income: [{ id: "p1", category: "presumptive_professional_44ada", amount: 800_000, sourceType: "manual" }],
    });
    const finding = validateCase(input).findings.find((f) => f.code === "PRESUMPTIVE_44ADA_DEEMED_PROFIT_APPLIED");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("info");
    expect(finding?.area).toBe("deductions");
  });

  it("no presumptive-44ADA findings fire when nothing is declared", () => {
    const input = makeInput({});
    expect(codes(input)).not.toContain("PRESUMPTIVE_44ADA_REQUIRES_ITR4");
    expect(codes(input)).not.toContain("PRESUMPTIVE_44ADA_DEEMED_PROFIT_APPLIED");
  });

  it("no presumptive-44ADA findings fire for a zero-amount row", () => {
    const input = makeInput({
      selectedItrType: "ITR-1",
      income: [{ id: "p1", category: "presumptive_professional_44ada", amount: 0, sourceType: "manual" }],
    });
    expect(codes(input)).not.toContain("PRESUMPTIVE_44ADA_REQUIRES_ITR4");
    expect(codes(input)).not.toContain("PRESUMPTIVE_44ADA_DEEMED_PROFIT_APPLIED");
  });
});

describe("validateCase — presumptive business income (44AD, K4-08)", () => {
  const adRows = (digital: number, cash: number) => [
    ...(digital > 0
      ? [{ id: "d1", category: "presumptive_business_44ad_digital" as const, amount: digital, sourceType: "manual" as const }]
      : []),
    ...(cash > 0
      ? [{ id: "c1", category: "presumptive_business_44ad_cash" as const, amount: cash, sourceType: "manual" as const }]
      : []),
  ];

  it("blocks ITR-1 when presumptive-44AD income is present", () => {
    const input = makeInput({ selectedItrType: "ITR-1", income: adRows(1_000_000, 0) });
    const finding = validateCase(input).findings.find((f) => f.code === "PRESUMPTIVE_44AD_REQUIRES_ITR4");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("blocker");
    expect(finding?.area).toBe("itr_form");
  });

  it("does not block when ITR-1 is not selected", () => {
    const input = makeInput({ selectedItrType: "ITR-4", income: adRows(1_000_000, 0) });
    expect(codes(input)).not.toContain("PRESUMPTIVE_44AD_REQUIRES_ITR4");
  });

  it("discloses the deemed-profit basis whenever presumptive-44AD income is declared", () => {
    const input = makeInput({ income: adRows(1_000_000, 100_000) });
    const finding = validateCase(input).findings.find((f) => f.code === "PRESUMPTIVE_44AD_DEEMED_PROFIT_APPLIED");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("info");
    expect(finding?.area).toBe("deductions");
    // The disclosure must state what the engine does NOT verify, not merely
    // restate the rates — this is the honesty half of the finding.
    //
    // K4-13 (D219) DELIBERATELY REPLACED the previous assertion here, which
    // required the message to contain "does NOT test whether the business
    // itself is eligible". That sentence became FALSE the moment the
    // eligible-activity gate shipped: the engine now does test it, and a
    // declared-ineligible or undeclared activity never reaches this finding at
    // all. Recorded as a decision rather than edited silently
    // (PROJECT_CONSTITUTION.md §4). The finding's PURPOSE is unchanged and is
    // what these assertions still enforce — it must name what remains
    // unverified, and that list is now strictly shorter and accurate.
    expect(finding?.message).toContain("The declared ACTIVITY was tested");
    // The two conditions that genuinely remain untested must both be named.
    expect(finding?.message).toContain("eligible-ASSESSEE");
    expect(finding?.message).toContain("44AD(4)/(5)");
    // ...and the retired claim must not survive anywhere in the message.
    expect(finding?.message).not.toContain("does NOT test whether the business itself is eligible");
  });

  // Decision D91. The enhanced ₹3cr ceiling needs BOTH a cash-receipts test
  // (derivable) and a cash-PAYMENTS test (no payments data exists anywhere).
  // Fires ONLY where the enhanced ceiling is actually load-bearing.
  it("does NOT raise the enhanced-ceiling blocker below the ordinary ₹2cr ceiling", () => {
    const input = makeInput({ income: adRows(19_000_000, 100_000) });
    expect(codes(input)).not.toContain("PRESUMPTIVE_44AD_ENHANCED_CEILING_UNVERIFIED");
  });

  it("raises the enhanced-ceiling blocker above ₹2cr, where the unverifiable condition decides eligibility", () => {
    const input = makeInput({ income: adRows(24_900_000, 100_000) });
    const finding = validateCase(input).findings.find(
      (f) => f.code === "PRESUMPTIVE_44AD_ENHANCED_CEILING_UNVERIFIED",
    );
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("blocker");
    expect(finding?.enteredValue).toBe(25_000_000);
    expect(finding?.message).toContain("cash payments");
    expect(finding?.message).toContain("NOT verified");
  });

  it("treats exactly ₹2,00,00,000 as within the ordinary ceiling (strict >, not >=)", () => {
    const input = makeInput({ income: adRows(20_000_000, 0) });
    expect(codes(input)).not.toContain("PRESUMPTIVE_44AD_ENHANCED_CEILING_UNVERIFIED");
  });

  it("no presumptive-44AD findings fire when nothing is declared", () => {
    const input = makeInput({});
    expect(codes(input)).not.toContain("PRESUMPTIVE_44AD_REQUIRES_ITR4");
    expect(codes(input)).not.toContain("PRESUMPTIVE_44AD_DEEMED_PROFIT_APPLIED");
    expect(codes(input)).not.toContain("PRESUMPTIVE_44AD_ENHANCED_CEILING_UNVERIFIED");
  });

  it("no presumptive-44AD findings fire for zero-amount rows", () => {
    const input = makeInput({
      selectedItrType: "ITR-1",
      income: [
        { id: "d1", category: "presumptive_business_44ad_digital", amount: 0, sourceType: "manual" },
        { id: "c1", category: "presumptive_business_44ad_cash", amount: 0, sourceType: "manual" },
      ],
    });
    expect(codes(input)).not.toContain("PRESUMPTIVE_44AD_REQUIRES_ITR4");
    expect(codes(input)).not.toContain("PRESUMPTIVE_44AD_DEEMED_PROFIT_APPLIED");
  });

  it("does not fire the 44ADA findings, and vice versa — the two schemes stay distinct", () => {
    const adOnly = makeInput({ selectedItrType: "ITR-1", income: adRows(1_000_000, 0) });
    expect(codes(adOnly)).not.toContain("PRESUMPTIVE_44ADA_REQUIRES_ITR4");
    expect(codes(adOnly)).not.toContain("PRESUMPTIVE_44ADA_DEEMED_PROFIT_APPLIED");

    const adaOnly = makeInput({
      selectedItrType: "ITR-1",
      income: [{ id: "p1", category: "presumptive_professional_44ada", amount: 800_000, sourceType: "manual" }],
    });
    expect(codes(adaOnly)).not.toContain("PRESUMPTIVE_44AD_REQUIRES_ITR4");
    expect(codes(adaOnly)).not.toContain("PRESUMPTIVE_44AD_DEEMED_PROFIT_APPLIED");
  });
});

// ---------------------------------------------------------------------------
// K4-10 — brought-forward capital-loss disclosures (Section 74)
// ---------------------------------------------------------------------------

describe("validateCase — brought-forward capital losses (K4-10)", () => {
  const gain = (amount: number) => ({
    id: "cg_ltcg",
    category: "ltcg_112a" as const,
    amount,
    sourceType: "broker_report" as const,
    taxable_gain: amount,
  });

  const bf = (over: Partial<TaxEngineInput["broughtForwardLosses"] extends (infer T)[] | undefined ? T : never> = {}) => ({
    id: "bf1",
    originatingAssessmentYear: "2022-23",
    lossType: "ltcl" as const,
    amount: 100_000,
    filingEligibility: "verified_timely" as const,
    provenance: "prior_finalized_case_in_system" as const,
    electedSetOffTarget: null,
    ...over,
  });

  it("discloses a brought-forward set-off that actually happened, naming the policy", () => {
    const input = makeInput({ capitalGains: [gain(500_000)], broughtForwardLosses: [bf()] });
    const finding = validateCase(input).findings.find(
      (f) => f.code === "BROUGHT_FORWARD_LOSS_SET_OFF_APPLIED",
    );
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("info");
    // The disclosure must name the ORIGINATING year, the policy, and say
    // plainly that the sequence is not statute (D113).
    expect(finding?.message).toContain("2022-23");
    expect(finding?.message).toContain("portal_default_ay2026_27");
    expect(finding?.message).toMatch(/NOT a statutory ordering rule/);
  });

  it("does NOT raise the within-year disclosure when only a brought-forward loss exists", () => {
    const input = makeInput({ capitalGains: [gain(500_000)], broughtForwardLosses: [bf()] });
    expect(codes(input)).not.toContain("CAPITAL_LOSS_SET_OFF_APPLIED");
  });

  it("records an unabsorbed residual, and escalates it in its final year", () => {
    const ordinary = validateCase(
      makeInput({ capitalGains: [gain(10_000)], broughtForwardLosses: [bf()] }),
    ).findings.find((f) => f.code === "BROUGHT_FORWARD_LOSS_RESIDUAL_CARRIED");
    expect(ordinary?.severity).toBe("info");
    expect(ordinary?.message).toContain("2030-31");

    const lastYear = validateCase(
      makeInput({
        capitalGains: [gain(10_000)],
        broughtForwardLosses: [bf({ originatingAssessmentYear: "2018-19" })],
      }),
    ).findings.find((f) => f.code === "BROUGHT_FORWARD_LOSS_RESIDUAL_CARRIED");
    expect(lastYear?.severity).toBe("warning");
    expect(lastYear?.message).toMatch(/FINAL YEAR/);
  });

  it("discloses an EXPIRED loss as a warning naming its originating year", () => {
    const input = makeInput({
      capitalGains: [gain(500_000)],
      broughtForwardLosses: [bf({ originatingAssessmentYear: "2016-17" })],
    });
    const finding = validateCase(input).findings.find((f) => f.code === "BROUGHT_FORWARD_LOSS_EXPIRED");
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("2016-17");
  });

  it("BLOCKS on unverified filing eligibility but only WARNS on a known-ineligible loss", () => {
    // The asymmetry is the point: one is an absence of knowledge, the other a
    // positive legal conclusion with a known correct treatment.
    const unverified = validateCase(
      makeInput({
        capitalGains: [gain(500_000)],
        broughtForwardLosses: [bf({ filingEligibility: "unverified" })],
      }),
    ).findings.find((f) => f.code === "BROUGHT_FORWARD_LOSS_FILING_UNVERIFIED");
    expect(unverified?.severity).toBe("blocker");

    const ineligible = validateCase(
      makeInput({
        capitalGains: [gain(500_000)],
        broughtForwardLosses: [bf({ filingEligibility: "not_eligible" })],
      }),
    ).findings.find((f) => f.code === "BROUGHT_FORWARD_LOSS_FILING_INELIGIBLE");
    expect(ineligible?.severity).toBe("warning");
  });

  it("blocks on a record whose originating year cannot be read", () => {
    const input = makeInput({
      capitalGains: [gain(500_000)],
      broughtForwardLosses: [bf({ originatingAssessmentYear: "2022-24" })],
    });
    const finding = validateCase(input).findings.find(
      (f) => f.code === "BROUGHT_FORWARD_LOSS_RECORD_UNUSABLE",
    );
    expect(finding?.severity).toBe("blocker");
  });

  it("blocks on a diverging election and on any election at all", () => {
    const input = makeInput({
      capitalGains: [gain(500_000)],
      broughtForwardLosses: [bf({ electedSetOffTarget: "stcg_111a" })],
    });
    const found = codes(input);
    expect(found).toContain("BROUGHT_FORWARD_LOSS_ELECTION_DIVERGES");
    expect(found).toContain("BROUGHT_FORWARD_LOSS_ELECTION_REQUIRES_REVIEW");
    for (const code of ["BROUGHT_FORWARD_LOSS_ELECTION_DIVERGES", "BROUGHT_FORWARD_LOSS_ELECTION_REQUIRES_REVIEW"]) {
      expect(validateCase(input).findings.find((f) => f.code === code)?.severity).toBe("blocker");
    }
  });

  it("requires review for a CONFORMING election too — a human still chose", () => {
    const input = makeInput({
      capitalGains: [gain(500_000)],
      broughtForwardLosses: [bf({ electedSetOffTarget: "ltcg_112a" })],
    });
    expect(codes(input)).toContain("BROUGHT_FORWARD_LOSS_ELECTION_REQUIRES_REVIEW");
    expect(codes(input)).not.toContain("BROUGHT_FORWARD_LOSS_ELECTION_DIVERGES");
  });

  it("distinguishes a staff-declared figure from one carried out of a finalized case", () => {
    const declared = makeInput({
      capitalGains: [gain(500_000)],
      broughtForwardLosses: [bf({ provenance: "staff_declared" })],
    });
    const finding = validateCase(declared).findings.find(
      (f) => f.code === "BROUGHT_FORWARD_LOSS_STAFF_DECLARED",
    );
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("2022-23");

    const carried = makeInput({ capitalGains: [gain(500_000)], broughtForwardLosses: [bf()] });
    expect(codes(carried)).not.toContain("BROUGHT_FORWARD_LOSS_STAFF_DECLARED");
  });

  it("raises no brought-forward finding at all for a case with no carry-forward record", () => {
    const input = makeInput({ capitalGains: [gain(500_000)] });
    expect(codes(input).filter((c) => c.startsWith("BROUGHT_FORWARD_LOSS_"))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// K4-14 — books-based business/profession findings (Sections 28/29)
// ---------------------------------------------------------------------------

describe("validateCase — books-based business (K4-14)", () => {
  const booksEntry = {
    id: "bk1",
    amount: 600_000,
    sourceType: "manual" as const,
    revenue: 3_000_000,
    expenses: 2_400_000,
    isProfession: false,
    adjustments: "none_s30_43d" as const,
    activityClassification: "ordinary_business_or_profession" as const,
  };
  const codesFor = (overrides: Parameters<typeof makeInput>[0] = {}) =>
    validateCase(makeInput(overrides)).findings.map((f) => f.code);

  it("raises all three books findings on an admitted row with ITR-1 selected", () => {
    const codes = codesFor({ businessBooksEntries: [booksEntry], selectedItrType: "ITR-1" });
    expect(codes).toContain("BUSINESS_BOOKS_REQUIRES_ITR3");
    expect(codes).toContain("BUSINESS_BOOKS_NET_PROFIT_APPLIED");
    expect(codes).toContain("BUSINESS_INCOME_REGIME_OPTION_10IEA");
  });

  it("ITR-2 and ITR-4 are blocked too — only ITR-3 carries books-based income", () => {
    for (const form of ["ITR-2", "ITR-4"] as const) {
      expect(codesFor({ businessBooksEntries: [booksEntry], selectedItrType: form })).toContain(
        "BUSINESS_BOOKS_REQUIRES_ITR3",
      );
    }
  });

  it("ITR-3 clears the form blocker but KEEPS both disclosures", () => {
    const codes = codesFor({ businessBooksEntries: [booksEntry], selectedItrType: "ITR-3" });
    expect(codes).not.toContain("BUSINESS_BOOKS_REQUIRES_ITR3");
    // The disclosures are about the BASIS of the number and the regime option,
    // neither of which the form selection resolves.
    expect(codes).toContain("BUSINESS_BOOKS_NET_PROFIT_APPLIED");
    expect(codes).toContain("BUSINESS_INCOME_REGIME_OPTION_10IEA");
  });

  it("the disclosure states that NONE of Sections 30-43D is applied", () => {
    const finding = validateCase(
      makeInput({ businessBooksEntries: [booksEntry], selectedItrType: "ITR-3" }),
    ).findings.find((f) => f.code === "BUSINESS_BOOKS_NET_PROFIT_APPLIED");
    expect(finding?.severity).toBe("info");
    expect(finding?.message).toContain("bounded");
    expect(finding?.message).toContain("Section 32(1)(ii)");
    expect(finding?.message).toContain("Section 32");
  });

  it("the regime-option disclosure names Form 10-IEA and its irreversibility", () => {
    const finding = validateCase(
      makeInput({ businessBooksEntries: [booksEntry], selectedItrType: "ITR-3" }),
    ).findings.find((f) => f.code === "BUSINESS_INCOME_REGIME_OPTION_10IEA");
    expect(finding?.severity).toBe("info");
    expect(finding?.message).toContain("Form 10-IEA");
    expect(finding?.message).toContain("cannot be exercised again");
  });

  it("does not fire when there is NO books row at all", () => {
    expect(codesFor({ selectedItrType: "ITR-1" })).not.toContain("BUSINESS_BOOKS_REQUIRES_ITR3");
    expect(codesFor({ selectedItrType: "ITR-1" })).not.toContain("BUSINESS_BOOKS_NET_PROFIT_APPLIED");
  });

  // K4-15-F1 REPLACED the second half of the assertion that used to live here,
  // which required a zero-profit row to disclose NOTHING "because there is no
  // business income figure to explain". That is the `AUDIT-08-F2` / `D243`
  // reasoning error in a second file: the adapter ADMITS a break-even row, so
  // the case genuinely has books income, and which form it needs turns on the
  // nature of that income, not its size. `recommendItrForm` was corrected at
  // `AUDIT-08`; this sibling was missed, leaving the recommender saying ITR-3
  // while validation raised no objection to ITR-1.
  it("a BREAK-EVEN books row still requires ITR-3 and still discloses", () => {
    const codes = codesFor({
      businessBooksEntries: [{ ...booksEntry, amount: 0, revenue: 500_000, expenses: 500_000 }],
      selectedItrType: "ITR-1",
    });
    expect(codes).toContain("BUSINESS_BOOKS_REQUIRES_ITR3");
    expect(codes).toContain("BUSINESS_BOOKS_NET_PROFIT_APPLIED");
    expect(codes).toContain("BUSINESS_INCOME_REGIME_OPTION_10IEA");
  });

  // K4-15: the findings are per-HEAD, not per-row, so several businesses
  // produce one of each — and every row is cited as a source.
  it("several businesses raise ONE set of findings, citing every row", () => {
    const findings = validateCase(
      makeInput({
        businessBooksEntries: [booksEntry, { ...booksEntry, id: "bk2" }],
        selectedItrType: "ITR-1",
      }),
    ).findings;
    const itr3 = findings.filter((f) => f.code === "BUSINESS_BOOKS_REQUIRES_ITR3");
    expect(itr3).toHaveLength(1);
    expect(itr3[0]?.sources).toEqual([
      "business_books:manual:bk1",
      "business_books:manual:bk2",
    ]);
  });

  it("K4-17 discloses bounded Section 70(1) treatment for an admitted negative row", () => {
    const negative = { ...booksEntry, id: "bk_loss", amount: -400_000, revenue: 100_000, expenses: 500_000 };
    const finding = validateCase(
      makeInput({ businessBooksEntries: [booksEntry, negative], selectedItrType: "ITR-3" }),
    ).findings.find((f) => f.code === "BUSINESS_BOOKS_NET_PROFIT_APPLIED");
    expect(finding?.message).toContain("Section 70(1) intra-head set-off");
    expect(finding?.message).toContain("aggregate remains zero or positive");
    expect(finding?.message).toContain("no residual cross-head set-off or carry-forward");
    expect(finding?.sources).toEqual([
      "business_books:manual:bk1",
      "business_books:manual:bk_loss",
    ]);
  });
});
