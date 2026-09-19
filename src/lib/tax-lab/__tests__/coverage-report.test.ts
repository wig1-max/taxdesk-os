import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildEngineInput } from "@/lib/tax-desk/computation-adapter";
import { DEDUCTION_TYPES, GAIN_TYPES, INCOME_HEADS, TAX_PAID_TYPES } from "@/lib/tax-desk/ledger";
import { MATERIAL_OUTPUT_IDS } from "../material-outputs";
import { AY_2026_27_PACK_PROVENANCE } from "@/lib/tax-pack/packs/ay-2026-27-provenance";
import {
  ENGINE_VALIDATION_CODES,
  NON_COMPUTED_VALUE_PACK_RULES,
  RUNNER_VALIDATION_CODES,
  buildWave2CoverageReport,
} from "../coverage-report";

const report = buildWave2CoverageReport();
const ROOT = join(__dirname, "..", "..", "..", "..");

function stringLiterals(source: string, pattern: RegExp): string[] {
  const values: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) values.push(match[1]!);
  return [...new Set(values)].sort();
}

describe("K3-23 coverage report guards the closed vocabularies", () => {
  it("classifies every Tax Desk ledger value through the actual adapter", () => {
    expect(report.adapter.income.map((item) => item.value)).toEqual([...INCOME_HEADS]);
    expect(report.adapter.taxPaid.map((item) => item.value)).toEqual([...TAX_PAID_TYPES]);
    expect(report.adapter.deductions.map((item) => item.value)).toEqual([...DEDUCTION_TYPES]);
    expect(report.adapter.capitalGains.map((item) => item.value)).toEqual([...GAIN_TYPES]);

    expect(report.adapter.income.filter((item) => item.mapped).map((item) => item.value)).toEqual([
      "salary", "savings_interest", "fd_interest", "dividend", "other_sources", "exempt_income",
      "presumptive_professional_44ada",
      // K4-08: both Section 44AD receipt-mode heads are computed (6% / 8%).
      "presumptive_business_44ad_digital", "presumptive_business_44ad_cash",
    ]);
    expect(report.adapter.income.filter((item) => item.blockerCodes.length > 0).map((item) => item.value)).toEqual([
      "house_property", "business_income",
    ]);
    // K4-13 (D217): the three presumptive heads above are `mapped` only
    // BECAUSE the probe declares an eligible activity. Asserted here so that
    // probe cannot silently become the reason a removed gate goes unnoticed —
    // an undeclared activity must still refuse.
    for (const [head, id] of [
      ["presumptive_professional_44ada", "undeclared_44ada"],
      ["presumptive_business_44ad_digital", "undeclared_44ad"],
    ] as const) {
      const bare = buildEngineInput(
        {
          income: [{ id, income_head: head, amount: 1, source_type: "manual" }],
          taxPaid: [], deductions: [], capitalGains: [],
        },
        { assessmentYear: "2026-27", financialYear: "2025-26", selectedItrType: null, finalized: false },
      );
      expect(bare.input.income, head).toEqual([]);
      expect(bare.complete, head).toBe(false);
      expect(bare.warnings.map((w) => w.code), head).toContain(
        head === "presumptive_professional_44ada"
          ? "PRESUMPTIVE_44ADA_ACTIVITY_TYPE_UNDECLARED"
          : "PRESUMPTIVE_44AD_ACTIVITY_TYPE_UNDECLARED",
      );
    }
    expect(report.adapter.taxPaid.every((item) => item.mapped)).toBe(true);
    expect(report.adapter.deductions.map((item) => [item.value, item.mappedAs])).toEqual([
      ["80C", "80C"], ["80D", "80D"], ["80D_PARENTS", "80D_PARENTS"], ["80TTA", "80TTA"], ["80TTB", "80TTB"],
      ["80CCD", "80CCD"], ["80G", "80G"], ["other_deductions", "other"],
    ]);
    expect(report.adapter.capitalGains.filter((item) => item.mapped).map((item) => item.value)).toEqual([
      "stcg_111a", "ltcg_112a", "house_sale",
    ]);
    expect(report.adapter.capitalGains.filter((item) => item.blockerCodes.length > 0).map((item) => item.value)).toEqual([
      "other_stcg", "other_ltcg",
    ]);
    expect(report.adapter.lossBlockers).toEqual([
      { value: "stcg_111a", blockerCode: "CAPITAL_LOSS_NOT_MODELLED" },
      { value: "ltcg_112a", blockerCode: "CAPITAL_LOSS_NOT_MODELLED" },
      { value: "house_sale", blockerCode: "HOUSE_SALE_UNSUPPORTED" },
      { value: "other_stcg", blockerCode: "UNSUPPORTED_GAIN_TYPE" },
      { value: "other_ltcg", blockerCode: "UNSUPPORTED_GAIN_TYPE" },
    ]);
  });

  it("fails when material outputs or pack rule groups grow without coverage", () => {
    expect(report.materialOutputs.declared).toEqual([...MATERIAL_OUTPUT_IDS]);
    expect(report.materialOutputs.unexercised).toEqual([]);
    expect(report.materialOutputs.exercised).toHaveLength(14);

    expect(report.packRules.declared).toEqual([
      // K4-12: `rebate_87a_marginal_relief` is declared immediately after
      // `rebate_87a` in the pack, so it appears here in that same order.
      "slab_rates", "standard_deduction", "rebate_87a", "rebate_87a_marginal_relief", "capital_gains_stcg_111a",
      "capital_gains_ltcg_112a", "capital_gains_house_sale", "cess_rate", "chapter_via_deduction_caps", "itr1_income_ceiling",
      // K4-11: the surcharge rate tiers and the marginal relief that caps them
      // — both real computation rules, both exercised by
      // surchargeMarginalReliefFixture. Declaration order, which is why they
      // sit here rather than at the end. The pre-existing
      // `surcharge_marginal_relief_safety_threshold` is deliberately ABSENT: it
      // stays classified `reliance_blocking` in NON_COMPUTED_VALUE_PACK_RULES
      // because it still governs only where the blocker triggers, never a
      // computed figure — two neighbouring rule ids, two different jobs.
      "surcharge_rates",
      "surcharge_marginal_relief",
      "senior_super_senior_basic_exemption_widening",
      // K4-03: the Section 80D senior cap and Section 80TTA/80TTB mutual-
      // exclusivity correction — both exercised by the two new seeded
      // fixtures below.
      "senior_80d_deduction_cap",
      // K4-05: the Section 80D "insured party" (parent-premium) sub-case —
      // an independent cap, exercised by seniorParentsDeductionCapFixture.
      "senior_80d_parents_deduction_cap",
      "senior_80tta_80ttb_mutual_exclusivity",
      // K4-04: Section 207(2) advance-tax exemption — validation-only, so it
      // is filtered out of `declared` by NON_COMPUTED_VALUE_PACK_RULE_IDS and
      // never appears here despite existing in provenance. (Left unlisted
      // intentionally — see the assertion below this block for confirmation.)
      // K4-06: house property (Sections 22-27, 71(3A)) — exercised by the
      // new houseProperty fixture(s) below.
      "house_property_computation",
      // K4-07: presumptive professional income (Section 44ADA) — exercised
      // by the new presumptive44adaFixture below.
      "presumptive_44ada_computation",
      // K4-08: presumptive business income (Section 44AD) — exercised by the
      // new presumptive44adFixture below.
      "presumptive_44ad_computation",
      // K4-14: books-based business/profession income (Sections 28/29) —
      // exercised by the new businessBooksFixture below.
      "business_books_computation",
      // K4-09: within-year capital-loss set-off (Sections 70/71(3)/74) —
      // exercised by the new capitalLossWithinYearSetOffFixture below.
      "capital_loss_within_year_set_off",
      // K4-10: brought-forward set-off across assessment years (Section 74).
      "capital_loss_brought_forward_set_off",
    ]);
    expect(report.packRules.unexercised).toEqual([]);
  });

  it("pins the exact seeded fixture exercise gaps", () => {
    // K4-03: +2 — seniorDeductionCapsFixture, belowSixty80ttbExclusionFixture.
    // K4-04: +1 — seniorAdvanceTaxExemptionFixture.
    // K4-05: +1 — seniorParentsDeductionCapFixture.
    // K4-06: +1 — houseSelfOccupiedInterestFixture.
    // K4-07: +1 — presumptive44adaFixture.
    // K4-08: +1 — presumptive44adFixture.
    // K4-09: +1 — capitalLossWithinYearSetOffFixture.
    // K4-10: +1 seeded fixture (the brought-forward Section 74 set-off).
    // K4-11: +1 — surchargeMarginalReliefFixture, the first fixture whose
    // total income attracts surcharge at all.
    // K4-12: +1 — rebateMarginalReliefFixture, the first fixture landing in the
    // narrow band just above the ₹12,00,000 section 87A rebate ceiling.
    // K4-15: +1 — businessBooksMultiFixture, the first fixture carrying more
    // than one row in ANY per-undertaking ledger. It deliberately reuses
    // businessBooksFixture's arithmetic, so the pair pins that splitting the
    // same profit across two undertakings does not move the tax.
    expect(report.fixtures.ids).toHaveLength(22);
    expect(report.fixtures.ledgerCoverage.income.business_income).toEqual([]);
    expect(report.fixtures.ledgerCoverage.income.dividend).toEqual([]);
    expect(report.fixtures.ledgerCoverage.income.other_sources).toEqual([]);
    expect(report.fixtures.ledgerCoverage.income.exempt_income).toEqual([]);
    // K4-07: now exercised by presumptive44adaFixture.
    expect(report.fixtures.ledgerCoverage.income.presumptive_professional_44ada).toEqual([
      "ay2026-27/presumptive-professional-44ada",
    ]);
    // K4-08: both Section 44AD receipt-mode heads exercised by one fixture —
    // the split IS the rule, so a fixture covering only one would not
    // exercise the dual-rate computation at all.
    expect(report.fixtures.ledgerCoverage.income.presumptive_business_44ad_digital).toEqual([
      "ay2026-27/presumptive-business-44ad",
    ]);
    expect(report.fixtures.ledgerCoverage.income.presumptive_business_44ad_cash).toEqual([
      "ay2026-27/presumptive-business-44ad",
    ]);
    expect(report.fixtures.ledgerCoverage.taxPaid.non_salary_tds).toEqual([]);
    expect(report.fixtures.ledgerCoverage.taxPaid.tcs).toEqual([]);
    expect(report.fixtures.ledgerCoverage.taxPaid.self_assessment_tax).toEqual([]);
    // K4-03: 80TTA/80TTB are now exercised (were both [] before this session).
    expect(report.fixtures.ledgerCoverage.deductions["80TTA"]).toEqual([
      "ay2026-27/senior-old-regime-deduction-caps",
      "ay2026-27/below-60-80ttb-exclusion",
    ]);
    expect(report.fixtures.ledgerCoverage.deductions["80TTB"]).toEqual([
      "ay2026-27/senior-old-regime-deduction-caps",
      "ay2026-27/below-60-80ttb-exclusion",
    ]);
    expect(report.fixtures.ledgerCoverage.deductions["80CCD"]).toEqual([]);
    expect(report.fixtures.ledgerCoverage.deductions["80G"]).toEqual([]);
    expect(report.fixtures.ledgerCoverage.deductions.other_deductions).toEqual([]);
    expect(report.fixtures.ledgerCoverage.capitalGains.other_stcg).toEqual([]);
    expect(report.fixtures.evidenceStates).toEqual(["accepted", "proposed"]);
  });

  // AUDIT-02-F5 / D75: the excluded-rule taxonomy is data, so it can be
  // checked. The old prose ("two distinct categories so far") could not be,
  // and had already drifted to three kinds.
  it("classifies every non-computed pack rule, and each one is a real pack rule (AUDIT-02-F5)", () => {
    const declaredPackRuleIds = new Set(AY_2026_27_PACK_PROVENANCE.rules.map((rule) => rule.ruleId));
    const entries = Object.entries(NON_COMPUTED_VALUE_PACK_RULES);
    expect(entries.length).toBeGreaterThan(0);

    for (const [ruleId, category] of entries) {
      // An excluded id that no longer exists in the pack would silently
      // exclude nothing — a stale exclusion is as wrong as a missing one.
      expect(declaredPackRuleIds, `${ruleId} must be a declared pack rule`).toContain(ruleId);
      expect(
        // K4-19 added `declared_gap` — a rule recording a provision the engine
        // does NOT implement. This list is hand-written on purpose: adding a
        // category must be a conscious act, which is `D75`'s whole point.
        ["reliance_blocking", "classification", "validation_only", "declared_gap"],
        `${ruleId} must carry a known category`,
      ).toContain(category);
    }

    // All three categories are genuinely in use — this is what the docstring
    // used to assert in prose, and got wrong.
    expect(new Set(Object.values(NON_COMPUTED_VALUE_PACK_RULES))).toEqual(
      new Set(["reliance_blocking", "classification", "validation_only", "declared_gap"]),
    );
  });

  // AUDIT-03-F3. Lives here, not in `tax-desk/__tests__/wave-4-coverage-audit
  // .test.ts` where the rest of that document's guard sits, because it must
  // compare against ENGINE_VALIDATION_CODES / RUNNER_VALIDATION_CODES — and
  // `src/lib/tax-desk` may not import `tax-lab` (boundary.test.ts). This file
  // may import from both trees and already owns this exact pattern for Wave 2.
  it("keeps k4-common-case-coverage-and-priorities.md's stated counts in sync with the live vocabularies (AUDIT-03-F3)", () => {
    // The wave-4 guard pins BEHAVIOUR (which head is computed, which excluded)
    // and goes green as soon as the code and its test file agree. It says
    // nothing about whether the PROSE was updated — AUDIT-03 found four drifts
    // that accumulated exactly that way across K4-05/06/07, including §1.3's
    // claim that house property and 44ADA have zero validation coverage, which
    // a future Wave-4 session reads to decide whether it must define its own
    // findings. Everything below is derived from the LIVE vocabularies, never
    // from a hand-maintained literal here (which would just move the drift).
    const doc = readFileSync(
      join(ROOT, "docs", "coverage", "k4-common-case-coverage-and-priorities.md"),
      "utf8",
    );
    // `\r?\n`, not `\n`: these docs are stored LF but check out CRLF on a
    // Windows host with `core.autocrlf=true` (this repo has no .gitattributes).
    // A marker is a marker either way — matching only LF made the guard pass
    // or fail on checkout config rather than on content.
    const marker = doc.match(/<!-- WAVE4_COVERAGE_COUNTS\r?\n([\s\S]*?)-->/);
    expect(
      marker,
      "k4-common-case-coverage-and-priorities.md is missing its WAVE4_COVERAGE_COUNTS marker",
    ).toBeTruthy();
    const statedCounts = Object.fromEntries(
      [...(marker?.[1] ?? "").matchAll(/(\w+)=(\d+)/g)].map(([, key, value]) => [key, Number(value)]),
    );

    expect(statedCounts).toEqual({
      incomeHeads: INCOME_HEADS.length,
      taxPaidTypes: TAX_PAID_TYPES.length,
      deductionTypes: DEDUCTION_TYPES.length,
      gainTypes: GAIN_TYPES.length,
      engineValidationCodes: ENGINE_VALIDATION_CODES.length,
      runnerValidationCodes: RUNNER_VALIDATION_CODES.length,
      // §1.3's per-area validation coverage — the claim that actually went
      // stale. Counting from the live code stops it rotting again.
      housePropertyValidationCodes: ENGINE_VALIDATION_CODES.filter((c) => c.startsWith("HOUSE_PROPERTY_")).length,
      presumptive44adaValidationCodes: ENGINE_VALIDATION_CODES.filter((c) => c.startsWith("PRESUMPTIVE_44ADA_")).length,
      // K4-08. Disjoint from the 44ADA filter above by construction: no
      // "PRESUMPTIVE_44ADA_*" code starts with "PRESUMPTIVE_44AD_" (the
      // character after "44AD" is "A", not "_") and vice versa.
      presumptive44adValidationCodes: ENGINE_VALIDATION_CODES.filter((c) => c.startsWith("PRESUMPTIVE_44AD_")).length,
    });
  });

  it("guards the validation finding inventories against the source that raises them", () => {
    const engineSource = readFileSync(join(ROOT, "src", "lib", "tax-engine", "ay-2026-27", "validate-case.ts"), "utf8");
    const runnerSource = readFileSync(join(ROOT, "src", "lib", "tax-desk", "validation-runner.ts"), "utf8");

    expect(stringLiterals(engineSource, /\bcode:\s*"([A-Z][A-Z0-9_]+)"/g)).toEqual(
      [...ENGINE_VALIDATION_CODES].sort(),
    );

    const direct = stringLiterals(runnerSource, /\bruleCode:\s*"([a-z][a-z0-9_.]+)"/g);
    const builders = stringLiterals(runnerSource, /\b(?:docFinding|refFinding)\(\s*"([a-z][a-z0-9_.]+)"/g);
    expect([...new Set([...direct, ...builders])].sort()).toEqual([...RUNNER_VALIDATION_CODES].sort());
  });

  it("records exactly which engine findings the laboratory pins", () => {
    // K4-03: DEDUCTION_SECTION_AGE_MISMATCH is now exercised by both new fixtures.
    // K4-04: ADVANCE_TAX_EXEMPT_SENIOR_CITIZEN_207_2 exercised by the new fixture.
    // K4-06: HOUSE_PROPERTY_INTEREST_PROOF_MISSING exercised by the new fixture.
    // K4-07: PRESUMPTIVE_44ADA_REQUIRES_ITR4 / PRESUMPTIVE_44ADA_DEEMED_PROFIT_APPLIED
    // both exercised by the new fixture.
    const exercised = [
      "AIS_INTEREST_NOT_ENTERED", "CG_REQUIRES_ITR2", "DEDUCTION_SECTION_AGE_MISMATCH", "TAX_PAYABLE_NO_CHALLAN",
      "ADVANCE_TAX_EXEMPT_SENIOR_CITIZEN_207_2", "HOUSE_PROPERTY_INTEREST_PROOF_MISSING",
      "PRESUMPTIVE_44ADA_REQUIRES_ITR4", "PRESUMPTIVE_44ADA_DEEMED_PROFIT_APPLIED",
      // K4-08: PRESUMPTIVE_44AD_REQUIRES_ITR4 / PRESUMPTIVE_44AD_DEEMED_PROFIT_APPLIED
      // exercised by the new fixture. PRESUMPTIVE_44AD_ENHANCED_CEILING_UNVERIFIED
      // is deliberately NOT seeded — it needs turnover above ₹2cr, which would
      // push the fixture past the ITR-1 income ceiling and add a second,
      // unrelated blocker; it has its own unit test in validate-case.test.ts.
      "PRESUMPTIVE_44AD_REQUIRES_ITR4", "PRESUMPTIVE_44AD_DEEMED_PROFIT_APPLIED",
      // K4-14. All THREE books-based codes are pinned by businessBooksFixture,
      // which is possible only because all three describe the ADMITTED path.
      // The seven refusal codes are adapter mapping warnings, not validation
      // findings, so they never appear in this vocabulary at all — a refused
      // books row produces no computation to validate, which is the point.
      "BUSINESS_BOOKS_REQUIRES_ITR3",
      "BUSINESS_BOOKS_NET_PROFIT_APPLIED",
      "BUSINESS_INCOME_REGIME_OPTION_10IEA",
      // K4-09: exercised by the new capitalLossWithinYearSetOffFixture, whose
      // long-term loss is fully absorbed within the year.
      "CAPITAL_LOSS_SET_OFF_APPLIED",
      // K4-10. Exactly ONE of the nine brought-forward codes is pinned by a
      // seeded fixture — the ADMITTED path. The other eight describe cases the
      // adapter refuses outright (unverified filing eligibility, expiry,
      // elective allocation, a diverging election), which a seeded golden
      // fixture is the wrong instrument for: those belong in unit tests that
      // assert nothing is computed. Recorded here rather than papered over.
      "BROUGHT_FORWARD_LOSS_SET_OFF_APPLIED",
    ];
    expect(report.validation.exercisedEngineCodes).toEqual(exercised);
    expect(report.validation.unexercisedEngineCodes).toEqual(
      ENGINE_VALIDATION_CODES.filter((code) => !exercised.includes(code)),
    );
    expect(report.validation.runnerOwnedCodes).toEqual([...RUNNER_VALIDATION_CODES]);
  });

  it("keeps k3-wave-2-coverage-and-limitations.md's stated counts in sync with the live report (AUDIT-02-F2)", () => {
    // The test-file expected lists above are updated by every K4-0x session
    // that adds a rule/finding/fixture, and they go green as soon as they
    // match the code. That says nothing about whether the prose in
    // the k3-wave-2-coverage-and-limitations design notes was also updated —
    // AUDIT-02 found six drifts that accumulated exactly this way. This
    // assertion reads the doc's own machine-checkable marker and compares it
    // against the SAME live report the assertions above already checked, so
    // the document — not merely this test file — is forced to stay current.
    const doc = readFileSync(
      join(ROOT, "docs", "coverage", "k3-wave-2-coverage-and-limitations.md"),
      "utf8",
    );
    const marker = doc.match(/<!-- WAVE2_COVERAGE_COUNTS\r?\n([\s\S]*?)-->/);
    expect(marker, "k3-wave-2-coverage-and-limitations.md is missing its WAVE2_COVERAGE_COUNTS marker").toBeTruthy();
    const markerBody = marker?.[1] ?? "";
    const statedCounts = Object.fromEntries(
      [...markerBody.matchAll(/(\w+)=(\d+)/g)].map(([, key, value]) => [key, Number(value)]),
    );

    const deductionCategoriesNotSeeded = DEDUCTION_TYPES.filter(
      (type) => report.fixtures.ledgerCoverage.deductions[type].length === 0,
    ).length;

    expect(statedCounts).toEqual({
      materialOutputsDeclared: report.materialOutputs.declared.length,
      packRulesDeclared: report.packRules.declared.length,
      engineCodesDeclared: report.validation.engineCodes.length,
      exercisedEngineCodes: report.validation.exercisedEngineCodes.length,
      fixtureIds: report.fixtures.ids.length,
      deductionCategoriesNotSeeded,
    });
  });
});
