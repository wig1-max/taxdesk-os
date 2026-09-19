import { describe, expect, it } from "vitest";
import {
  CONFIRMED_NON_SILENT_UNSUPPORTED_AREAS,
  SILENT_EXCLUSION_FINDINGS,
  buildCapabilityStateSummary,
  buildWave4LedgerCoverage,
} from "../wave-4-coverage-audit";
import { buildEngineInput, type CaseMeta } from "../computation-adapter";
import { TAX_CAPABILITY_MATRIX } from "../tax-capability";
import { PROPOSAL_FACT_KINDS } from "../source-proposals";

/**
 * K4-00 — pins the exact Wave-4 coverage-audit claims made in
 * the k4-common-case-coverage-and-priorities design notes. Same discipline
 * as the Wave-2 (`tax-lab/coverage-report.test.ts`) and Wave-3
 * (`wave-3-coverage-report.test.ts`) guards: if the underlying ledger,
 * capability, or proposal vocabularies change, THIS test fails until the
 * audit is consciously reassessed.
 */
describe("buildWave4LedgerCoverage", () => {
  it("marks every SLAB income head as computed, and both placeholder heads as excluded_unsupported", () => {
    const { income } = buildWave4LedgerCoverage();
    const find = (head: string) => income.find((row) => row.value === head)!;
    for (const head of ["salary", "savings_interest", "fd_interest", "dividend", "other_sources", "exempt_income"] as const) {
      expect(find(head).computationSupport).toBe("computed");
      expect(find(head).evidenceAssociationSupport).toBe(true);
      expect(find(head).manifestLineageSupport).toBe(true);
    }
    for (const head of ["house_property", "business_income"] as const) {
      expect(find(head).computationSupport).toBe("excluded_unsupported");
      expect(find(head).mappingWarningCodes).toEqual(["UNSUPPORTED_INCOME_HEAD"]);
      expect(find(head).evidenceAssociationSupport).toBe(false);
    }
  });

  it("marks ONLY income.salary / tax_paid.salary_tds as proposal-review-supported — every other category is source-association only", () => {
    const { income, taxPaid, deductions, capitalGains } = buildWave4LedgerCoverage();
    const proposalSupported = [
      ...income.filter((r) => r.proposalReviewSupport).map((r) => `income.${r.value}`),
      ...taxPaid.filter((r) => r.proposalReviewSupport).map((r) => `tax_paid.${r.value}`),
      ...deductions.filter((r) => r.proposalReviewSupport),
      ...capitalGains.filter((r) => r.proposalReviewSupport),
    ];
    expect(proposalSupported).toEqual(["income.salary", "tax_paid.salary_tds"]);
    expect(proposalSupported).toEqual([...PROPOSAL_FACT_KINDS]);
  });

  it("marks every tax-paid category and every deduction section as computed (no unsupported category in either closed vocabulary)", () => {
    const { taxPaid, deductions } = buildWave4LedgerCoverage();
    expect(taxPaid.every((r) => r.computationSupport === "computed")).toBe(true);
    expect(deductions.every((r) => r.computationSupport === "computed")).toBe(true);
  });

  it("marks stcg_111a / ltcg_112a as computed and other_stcg / other_ltcg as excluded_unsupported", () => {
    const { capitalGains } = buildWave4LedgerCoverage();
    const find = (gainType: string) => capitalGains.find((row) => row.value === gainType)!;
    expect(find("stcg_111a").computationSupport).toBe("computed");
    expect(find("ltcg_112a").computationSupport).toBe("computed");
    expect(find("house_sale").computationSupport).toBe("computed");
    expect(find("other_stcg").computationSupport).toBe("excluded_unsupported");
    expect(find("other_ltcg").computationSupport).toBe("excluded_unsupported");
  });

  it("marks a NEGATIVE stcg_111a/ltcg_112a (a loss) as excluded_loss_not_modelled", () => {
    const { capitalGainLosses } = buildWave4LedgerCoverage();
    expect(capitalGainLosses).toHaveLength(2);
    for (const row of capitalGainLosses) {
      expect(row.computationSupport).toBe("excluded_loss_not_modelled");
      expect(row.mappingWarningCodes).toEqual(["CAPITAL_LOSS_NOT_MODELLED"]);
    }
  });

  it("is frozen/immutable at every level", () => {
    const coverage = buildWave4LedgerCoverage();
    expect(Object.isFrozen(coverage)).toBe(true);
    expect(Object.isFrozen(coverage.income)).toBe(true);
    expect(Object.isFrozen(coverage.income[0])).toBe(true);
  });
});

describe("buildCapabilityStateSummary", () => {
  // K4-19: 3/9/3 -> 2/10/3. `income_salary_pension` moved `supported` ->
  // `partially_supported` because Section 89(1) arrears relief is inside that
  // head and is not computed. The area count is unchanged at 15 — no row was
  // added or removed, one moved.
  it("pins the current 15-area matrix partition (2 supported, 10 partial, 3 unsupported, 0 dynamically blocked at rest)", () => {
    // K4-06: house_property moved unsupported → partially_supported (single-
    // property scope) alongside the pre-existing senior_citizen_treatment row.
    // K4-07: presumptive_44ada moved unsupported → partially_supported
    // (deemed-profit computation).
    // K4-08: presumptive_44ad moved unsupported → partially_supported
    // (dual-rate deemed-profit computation).
    const summary = buildCapabilityStateSummary();
    expect(summary.totalAreas).toBe(16);
    // K4-19: 3 -> 2. income_salary_pension moved out of `supported` because
    // Section 89(1) arrears relief sits INSIDE the salary/pension head and is
    // not computed. No area was added or removed — totalAreas is unchanged.
    expect(summary.byState.supported).toBe(2);
    // K4-09: 4 -> 5 (loss_set_off_carry_forward), 8 -> 7 correspondingly.
    // K4-11: 5 -> 7 (surcharge AND marginal_relief both moved), 7 -> 5
    // correspondingly — the first session to move TWO rows at once.
    // K4-14: 7 -> 8 (business_professional_income moved on its books slice),
    // 5 -> 4 correspondingly.
    // K4-18: 8 -> 9 (fno moved on its bounded Section 43(5) proviso (d) slice),
    // 4 -> 3 correspondingly. The three still unsupported are vda,
    // foreign_assets and tax_audit — and tax_audit staying unsupported is
    // load-bearing next to this move, not an oversight: K4-18 admits the F&O
    // COMPUTATION while the audit determination still rests on a turnover
    // figure the preparer declares, so nothing here supports an audited return
    // or Form 3CD.
    // K4-19: 9 -> 10 (income_salary_pension moved DOWN into this state from
    // `supported`, the first row to move in that direction). The unsupported
    // count is unchanged at 3 — this move came out of `supported`, not into
    // or out of `unsupported`.
    expect(summary.byState.partially_supported).toBe(11);
    expect(summary.byState.unsupported).toBe(3);
    expect(summary.byState.reliance_blocked).toBe(0);
    expect(
      summary.byState.supported + summary.byState.partially_supported + summary.byState.unsupported + summary.byState.reliance_blocked,
    ).toBe(summary.totalAreas);
    // K4-19: 12 -> 13. This is the count of areas that are NOT fully
    // supported, so a row leaving `supported` necessarily joins it.
    expect(summary.unsupportedOrPartialAreas).toHaveLength(14);
  });

  it("cross-checks the static area count against the live TAX_CAPABILITY_MATRIX (fails if a row is added/removed without reassessment)", () => {
    expect(TAX_CAPABILITY_MATRIX.length).toBe(buildCapabilityStateSummary().totalAreas);
  });
});

// AUDIT-03-F3's WAVE4_COVERAGE_COUNTS marker assertion deliberately does NOT
// live here. It must compare the doc against the live ENGINE_VALIDATION_CODES /
// RUNNER_VALIDATION_CODES vocabularies, which are declared in
// `src/lib/tax-lab/coverage-report.ts` — and `src/lib/tax-desk` may not import
// `tax-lab` (the machine-enforced boundary in `tax-lab/__tests__/boundary.test.ts`,
// which caught exactly that import while this was being written). The assertion
// therefore sits in `src/lib/tax-lab/__tests__/coverage-report.test.ts`
// alongside the Wave-2 marker check, which is the file that already owns the
// "read a doc's marker back and compare it against live vocabularies" pattern
// and may legitimately import from both trees.

describe("SILENT_EXCLUSION_FINDINGS", () => {
  it("records exactly one finding (historical): taxpayer age used to be hardcoded to below_60 — RESOLVED in K4-01", () => {
    expect(SILENT_EXCLUSION_FINDINGS).toHaveLength(1);
    const finding = SILENT_EXCLUSION_FINDINGS[0]!;
    expect(finding.code).toBe("AGE_CATEGORY_HARDCODED_BELOW_60");
    expect(finding.relianceRisk).toBe("active");
    expect(finding.relatedCapabilityArea).toBe("senior_citizen_treatment");
    expect(finding.resolvedInSession).toBe("K4-01");
  });

  it("proves the finding is actually resolved: buildEngineInput now derives ageCategory from CaseMeta.dateOfBirth, never a hardcoded literal", () => {
    const below60Meta: CaseMeta = {
      assessmentYear: "2026-27",
      financialYear: "2025-26",
      selectedItrType: "ITR-1",
      finalized: false,
      dateOfBirth: "1990-01-01",
      residentialStatus: "resident",
    };
    const seniorMeta: CaseMeta = { ...below60Meta, dateOfBirth: "1960-01-01" };
    const superSeniorMeta: CaseMeta = { ...below60Meta, dateOfBirth: "1940-01-01" };
    const noDobMeta: CaseMeta = { ...below60Meta, dateOfBirth: null };

    const below60Result = buildEngineInput({ income: [], taxPaid: [], deductions: [], capitalGains: [] }, below60Meta);
    const seniorResult = buildEngineInput({ income: [], taxPaid: [], deductions: [], capitalGains: [] }, seniorMeta);
    const superSeniorResult = buildEngineInput({ income: [], taxPaid: [], deductions: [], capitalGains: [] }, superSeniorMeta);
    const noDobResult = buildEngineInput({ income: [], taxPaid: [], deductions: [], capitalGains: [] }, noDobMeta);

    expect(below60Result.input.taxpayer.ageCategory).toBe("below_60");
    expect(seniorResult.input.taxpayer.ageCategory).toBe("senior");
    expect(superSeniorResult.input.taxpayer.ageCategory).toBe("super_senior");
    // A missing DOB never fabricates "below_60" — the field is left undefined
    // (eligibility.ts's PROFILE_DOB_MISSING blocker owns withholding the case).
    expect(noDobResult.input.taxpayer.ageCategory).toBeUndefined();
    expect(below60Result.input.taxpayer.residentStatus).toBe("resident");
  });

  it("distinguishes the silent finding from confirmed NON-silent unsupported areas (which DO raise an explicit blocking warning)", () => {
    expect(CONFIRMED_NON_SILENT_UNSUPPORTED_AREAS).toEqual([
      "house_property",
      "business_professional_income",
      "loss_set_off_carry_forward",
    ]);
    // None of the confirmed non-silent areas may also appear as a silent-exclusion finding.
    const silentAreas = SILENT_EXCLUSION_FINDINGS.map((f) => f.relatedCapabilityArea);
    for (const area of CONFIRMED_NON_SILENT_UNSUPPORTED_AREAS) {
      expect(silentAreas).not.toContain(area);
    }
  });
});
