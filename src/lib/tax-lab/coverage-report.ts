/**
 * Wave-2 closeout coverage data (K3-23).
 *
 * This module does not compute tax and is not a production capability. It turns
 * the repository's closed vocabularies plus the seeded fixture declarations into
 * a deterministic coverage inventory. The guarding test cross-checks the two
 * validation-code lists below against the source literals that raise them.
 */

import { buildEngineInput, type CaseMeta, type LedgerRows } from "@/lib/tax-desk/computation-adapter";
import {
  DEDUCTION_TYPES,
  GAIN_TYPES,
  INCOME_HEADS,
  TAX_PAID_TYPES,
} from "@/lib/tax-desk/ledger";
import { AY_2026_27_PACK_PROVENANCE } from "@/lib/tax-pack/packs/ay-2026-27-provenance";
import { SEEDED_CASE_FIXTURES } from "./fixtures/ay-2026-27-golden";
import { MATERIAL_OUTPUT_IDS } from "./material-outputs";

/** Every finding code declared by `validate-case.ts`. */
export const ENGINE_VALIDATION_CODES = [
  "DOC_MISSING",
  "AIS_INTEREST_NOT_ENTERED",
  "AIS_INTEREST_MISMATCH",
  "TDS_26AS_UNMAPPED",
  "FORM16_SALARY_MISMATCH",
  "CG_REQUIRES_ITR2",
  "DEDUCTION_PROOF_MISSING",
  "DEDUCTION_SECTION_AGE_MISMATCH",
  "TAX_PAYABLE_NO_CHALLAN",
  "ADVANCE_TAX_EXEMPT_SENIOR_CITIZEN_207_2",
  // K4-06: house property (Sections 22-27, 71(3A)).
  "HOUSE_PROPERTY_LOSS_REQUIRES_ITR2",
  "HOUSE_PROPERTY_INTEREST_PROOF_MISSING",
  "HOUSE_PROPERTY_LOSS_SETOFF_CAPPED",
  // K4-07: presumptive professional income (Section 44ADA).
  "PRESUMPTIVE_44ADA_REQUIRES_ITR4",
  "PRESUMPTIVE_44ADA_DEEMED_PROFIT_APPLIED",
  // K4-08: presumptive business income (Section 44AD).
  "PRESUMPTIVE_44AD_REQUIRES_ITR4",
  "PRESUMPTIVE_44AD_DEEMED_PROFIT_APPLIED",
  // K4-14: books-based business/profession income (Sections 28/29).
  "BUSINESS_BOOKS_REQUIRES_ITR3",
  "BUSINESS_BOOKS_NET_PROFIT_APPLIED",
  "BUSINESS_INCOME_REGIME_OPTION_10IEA",
  // K4-09 — within-year capital-loss set-off disclosure.
  "CAPITAL_LOSS_SET_OFF_APPLIED",
  // K4-10 — brought-forward capital-loss set-off (Section 74). Nine codes,
  // because the reasons a carry-forward record cannot be used are NOT
  // interchangeable: expiry and filing-ineligibility are positive legal
  // conclusions (warnings), while unverified filing eligibility and an
  // unreadable originating year are absences of knowledge (blockers).
  "BROUGHT_FORWARD_LOSS_SET_OFF_APPLIED",
  "BROUGHT_FORWARD_LOSS_RESIDUAL_CARRIED",
  "BROUGHT_FORWARD_LOSS_FILING_UNVERIFIED",
  "BROUGHT_FORWARD_LOSS_EXPIRED",
  "BROUGHT_FORWARD_LOSS_FILING_INELIGIBLE",
  "BROUGHT_FORWARD_LOSS_RECORD_UNUSABLE",
  "BROUGHT_FORWARD_LOSS_ELECTION_DIVERGES",
  "BROUGHT_FORWARD_LOSS_ELECTION_REQUIRES_REVIEW",
  "BROUGHT_FORWARD_LOSS_STAFF_DECLARED",
  "PRESUMPTIVE_44AD_ENHANCED_CEILING_UNVERIFIED",
  "APPROVAL_MISSING",
  "EVERIFICATION_PENDING",
  "FINALIZED_EDIT_BLOCKED",
  "PORTAL_CREDENTIAL_TEXT",
] as const;

/** Findings owned by `validation-runner.ts`, excluding `engine.<code>` pass-throughs. */
export const RUNNER_VALIDATION_CODES = [
  "coverage.unsupported_entry",
  "coverage.partial",
  "coverage.no_meaningful_income",
  "itr.missing_selected",
  "itr.mismatch",
  "documents.required_rejected",
  "documents.required_missing",
  "documents.required_requested",
  "documents.required_unverified",
  "ledger.source_ref_invalid",
  "ledger.source_rejected",
  "ledger.source_not_received",
  "ledger.non_manual_no_source",
  "ledger.zero_value",
  "ledger.deduction_no_proof",
  "ledger.cg_arithmetic",
  "ledger.duplicate",
  "reconciliation.source_mismatch",
] as const;

const META: CaseMeta = {
  assessmentYear: "2026-27",
  financialYear: "2025-26",
  selectedItrType: "ITR-1",
  finalized: false,
};

const EMPTY: LedgerRows = { income: [], taxPaid: [], deductions: [], capitalGains: [] };

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function fixtureIdsByValue<T extends string>(
  vocabulary: readonly T[],
  read: (fixture: (typeof SEEDED_CASE_FIXTURES)[number]) => readonly string[],
): Record<T, readonly string[]> {
  return Object.fromEntries(
    vocabulary.map((value) => [
      value,
      SEEDED_CASE_FIXTURES.filter((fixture) => read(fixture).includes(value)).map((fixture) => fixture.id),
    ]),
  ) as unknown as Record<T, readonly string[]>;
}

function deriveAdapterCoverage() {
  const income = INCOME_HEADS.map((head) => {
    const id = `coverage_income_${head}`;
    // K4-13 (D217): a presumptive row with no declared activity is now REFUSED
    // by the eligible-activity gate, so a bare probe row would report every
    // presumptive head as unmapped — which is false, and false in the
    // capability-UNDERSTATING direction this report exists to prevent
    // (AUDIT-04-F5). The probe therefore declares the activity each scheme is
    // eligible for, so `mapped` continues to answer "can this head reach the
    // engine at all". That the gate refuses an UNDECLARED activity is asserted
    // directly in coverage-report.test.ts, so this probe cannot quietly become
    // the reason nobody notices the gate was removed.
    const activity =
      head === "presumptive_professional_44ada"
        ? "specified_profession_44aa_1"
        : head === "presumptive_business_44ad_digital" || head === "presumptive_business_44ad_cash"
          ? "other_business"
          : undefined;
    const result = buildEngineInput(
      { ...EMPTY, income: [{ id, income_head: head, amount: 1, source_type: "manual", presumptive_activity_type: activity }] },
      META,
    );
    return {
      value: head,
      mapped: result.input.income.some((entry) => entry.id === id),
      blockerCodes: result.warnings.filter((warning) => warning.ledgerId === id).map((warning) => warning.code),
    };
  });

  const taxPaid = TAX_PAID_TYPES.map((category) => {
    const id = `coverage_tax_paid_${category}`;
    const result = buildEngineInput(
      { ...EMPTY, taxPaid: [{ id, tax_paid_type: category, amount: 1, source_type: "manual" }] },
      META,
    );
    return { value: category, mapped: result.input.taxPaid.some((entry) => entry.id === id) };
  });

  const deductions = DEDUCTION_TYPES.map((section) => {
    const id = `coverage_deduction_${section}`;
    const result = buildEngineInput(
      { ...EMPTY, deductions: [{ id, deduction_type: section, amount: 1, source_type: "manual" }] },
      META,
    );
    return {
      value: section,
      mappedAs: result.input.deductions.find((entry) => entry.id === id)?.section ?? null,
    };
  });

  const houseSaleFacts = {
    transfer_date: "2025-12-01",
    acquisition_date: "2025-01-15",
    stamp_duty_value: 2,
    asset_kind: "building" as const,
    acquisition_mode: "purchase" as const,
    cost_of_improvement: 0,
    house_sale_declarations: [
      "not_agricultural_land",
      "not_depreciable_asset",
      "interest_not_in_cost",
      "agreement_and_registration_same_date",
    ],
  };

  const capitalGains = GAIN_TYPES.map((gainType) => {
    const id = `coverage_gain_${gainType}`;
    const row = {
      id,
      gain_type: gainType,
      sale_value: 2,
      cost: 1,
      expenses: 0,
      exemption_claimed: 0,
      taxable_gain: 1,
      source_type: "manual",
      ...(gainType === "house_sale" ? houseSaleFacts : {}),
    };
    const result = buildEngineInput({ ...EMPTY, capitalGains: [row] }, META);
    return {
      value: gainType,
      mapped: result.input.capitalGains.some((entry) => entry.id === id),
      blockerCodes: result.warnings.filter((warning) => warning.ledgerId === id).map((warning) => warning.code),
    };
  });

  const lossBlockers = GAIN_TYPES.flatMap((gainType) => {
    const id = `coverage_loss_${gainType}`;
    const result = buildEngineInput(
      {
        ...EMPTY,
        capitalGains: [{
          id,
          gain_type: gainType,
          sale_value: 1,
          cost: 2,
          expenses: 0,
          exemption_claimed: 0,
          taxable_gain: -1,
          source_type: "manual",
        }],
      },
      META,
    );
    return result.warnings.filter((warning) => warning.ledgerId === id).map((warning) => ({
      value: gainType,
      blockerCode: warning.code,
    }));
  });

  return { income, taxPaid, deductions, capitalGains, lossBlockers };
}

/**
 * Rule ids that exist in the pack's provenance but are never asserted by an
 * engine COMPUTATION, and therefore never citable in a tax-lab fixture's
 * `expectation.trace.ruleIds` (which trace what the engine computed, not a
 * reliance-blocking threshold or a validation-only disclosure). Excluded from
 * the Wave-2 fixture-exercise coverage check for that reason: this report's
 * job is "is every rule the engine computes traced by a fixture", not "is
 * every provenance record cited somewhere" — each entry below is a real,
 * versioned, sourced pack rule (see its own provenance docstring) but
 * categorically not a computation rule, so none belongs in this vocabulary
 * and adding another still requires no fixture reassessment.
 *
 * AUDIT-02-F5 / D75: the category taxonomy is DATA, not prose. The docstring
 * used to claim "two distinct categories so far" while the set already held
 * three kinds — its middle entry is a classification rule that had been filed
 * under the "reliance-blocking thresholds" header. A hand-maintained count in
 * a comment cannot be checked and had already drifted, so each id now names
 * its own category and adding one is impossible without classifying it. The
 * EXCLUSION BEHAVIOUR is unchanged: the `ReadonlySet` below is derived from
 * these keys.
 */
type NonComputedPackRuleCategory =
  /** Governs whether a case is BLOCKED from reliance, never a computed figure. */
  | "reliance_blocking"
  /** States a FACT/classification (e.g. an age band), not a slab/cap/rate. */
  | "classification"
  /** Drives a `validate-case.ts` finding, never a computed liability/refund. */
  | "validation_only"
  /**
   * K4-19. RECORDS A PROVISION THE ENGINE DOES NOT IMPLEMENT, so the gap is a
   * versioned, sourced, rendered fact instead of an absence nobody can see.
   * Never a computed figure, and — unlike `reliance_blocking` — not a block by
   * itself either: what holds such a case back is a declaration elsewhere, or
   * nothing at all.
   *
   * A FOURTH category rather than filing this under one of the three above,
   * which is `D75` applied rather than restated: that finding was a rule filed
   * under a header that did not describe it, and `reliance_blocking` is exactly
   * the header this rule would have been wrongly filed under.
   */
  | "declared_gap";

export const NON_COMPUTED_VALUE_PACK_RULES: Readonly<Record<string, NonComputedPackRuleCategory>> = {
  /** TAX-SAFE-01: the surcharge/marginal-relief reliance threshold. */
  surcharge_marginal_relief_safety_threshold: "reliance_blocking",
  /**
   * K4-01: the senior/super-senior age-band thresholds. A FACT rule — no
   * `ComputedValue.sources` tag ever cites it, so it does not belong in the
   * fixture-exercise vocabulary either. See `senior-treatment.ts` and the
   * provenance entry's own docstring.
   */
  senior_super_senior_age_definition: "classification",
  /**
   * K4-04: Section 207(2) advance-tax exemption — see
   * the k4-senior-treatment-specification design notes §10.4.
   */
  senior_citizen_advance_tax_exemption_207_2: "validation_only",
  /**
   * K4-19: Section 89(1) arrears relief. The engine computes NO part of it, so
   * no fixture can ever cite it in `expectation.trace.ruleIds` and its presence
   * in the fixture-exercise vocabulary would report a permanent, unclosable
   * coverage gap that no fixture could close. Excluding it is not hiding the
   * gap — the gap is the rule's entire content, and it is stated in the pack
   * provenance, the capability matrix, `NOT_IMPLEMENTED` and on Computation.
   */
  section_89_arrears_relief: "declared_gap",
};

const NON_COMPUTED_VALUE_PACK_RULE_IDS: ReadonlySet<string> = new Set(
  Object.keys(NON_COMPUTED_VALUE_PACK_RULES),
);

/** Build the machine-readable inventory summarized in the K3-23 closeout note. */
export function buildWave2CoverageReport() {
  const materialOutputFixtures = fixtureIdsByValue(MATERIAL_OUTPUT_IDS, (fixture) =>
    fixture.expectations.map((expectation) => expectation.outputId));
  const packRuleIds = AY_2026_27_PACK_PROVENANCE.rules
    .map((rule) => rule.ruleId)
    .filter((id) => !NON_COMPUTED_VALUE_PACK_RULE_IDS.has(id));
  const packRuleFixtures = fixtureIdsByValue(packRuleIds, (fixture) =>
    fixture.expectations.flatMap((expectation) => expectation.trace.ruleIds));
  const engineFindingFixtures = fixtureIdsByValue(ENGINE_VALIDATION_CODES, (fixture) =>
    fixture.expectedFindings.map((finding) => finding.code));

  const fixtureLedgerCoverage = {
    income: fixtureIdsByValue(INCOME_HEADS, (fixture) => fixture.ledger.income.map((row) => row.income_head)),
    taxPaid: fixtureIdsByValue(TAX_PAID_TYPES, (fixture) => fixture.ledger.taxPaid.map((row) => row.tax_paid_type)),
    deductions: fixtureIdsByValue(DEDUCTION_TYPES, (fixture) => fixture.ledger.deductions.map((row) => row.deduction_type)),
    capitalGains: fixtureIdsByValue(GAIN_TYPES, (fixture) => fixture.ledger.capitalGains.map((row) => row.gain_type)),
  };

  return {
    adapter: deriveAdapterCoverage(),
    materialOutputs: {
      declared: [...MATERIAL_OUTPUT_IDS],
      byFixture: materialOutputFixtures,
      exercised: MATERIAL_OUTPUT_IDS.filter((id) => materialOutputFixtures[id].length > 0),
      unexercised: MATERIAL_OUTPUT_IDS.filter((id) => materialOutputFixtures[id].length === 0),
    },
    packRules: {
      declared: packRuleIds,
      byFixture: packRuleFixtures,
      exercised: packRuleIds.filter((id) => (packRuleFixtures[id]?.length ?? 0) > 0),
      unexercised: packRuleIds.filter((id) => (packRuleFixtures[id]?.length ?? 0) === 0),
    },
    validation: {
      engineCodes: [...ENGINE_VALIDATION_CODES],
      runnerOwnedCodes: [...RUNNER_VALIDATION_CODES],
      runnerEnginePassThroughCodes: ENGINE_VALIDATION_CODES.map((code) => `engine.${code}`),
      engineByFixture: engineFindingFixtures,
      exercisedEngineCodes: ENGINE_VALIDATION_CODES.filter((code) => engineFindingFixtures[code].length > 0),
      unexercisedEngineCodes: ENGINE_VALIDATION_CODES.filter((code) => engineFindingFixtures[code].length === 0),
    },
    fixtures: {
      ids: SEEDED_CASE_FIXTURES.map((fixture) => fixture.id),
      supported: SEEDED_CASE_FIXTURES.filter((fixture) =>
        fixture.expectedBinding === "bound" &&
        fixture.expectedUnsupported.length === 0 &&
        fixture.expectedWithheld.length === 0).map((fixture) => fixture.id),
      blocked: SEEDED_CASE_FIXTURES.filter((fixture) =>
        fixture.expectedUnsupported.length > 0 || fixture.expectedWithheld.length > 0).map((fixture) => fixture.id),
      refused: SEEDED_CASE_FIXTURES.filter((fixture) => fixture.expectedBinding === "refused").map((fixture) => fixture.id),
      ledgerCoverage: fixtureLedgerCoverage,
      evidenceStates: uniqueSorted(SEEDED_CASE_FIXTURES.flatMap((fixture) =>
        fixture.evidence.map((evidence) => evidence.acceptance))),
    },
  };
}

export type Wave2CoverageReport = ReturnType<typeof buildWave2CoverageReport>;
