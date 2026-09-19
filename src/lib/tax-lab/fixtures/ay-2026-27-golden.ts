/**
 * TaxDesk OS — Synthetic Case Laboratory: the seeded AY 2026-27 fixtures
 * (Wave 2, K3-20).
 *
 * PURE TYPESCRIPT ONLY. Data only — nothing here computes.
 *
 * SYNTHETIC ONLY. No real person, PAN, Aadhaar, employer, bank or document
 * reference appears below; `makeSyntheticCaseFixture` refuses PAN/Aadhaar-shaped
 * strings outright. Ledger ids are opaque laboratory labels.
 *
 * **Where the expected numbers come from.** Every expected value was READ OFF the
 * AY 2026-27 engine's own current behaviour through the resolved pack binding —
 * none was hand-derived from tax knowledge, and none was copied from any
 * third-party product. The three golden-path cases mirror the ledger content of
 * the engine's own pre-existing fixtures (`tax-engine/ay-2026-27/fixtures.ts`)
 * closely enough that the pre-existing engine golden suites remain the
 * cross-check: if a rule moves, both this laboratory and those suites move.
 *
 * **None of these numbers is verified.** Every rule the AY 2026-27 pack declares
 * carries an unresolved `TODO(CA-verify)` caveat and the pack is truthfully
 * `draft`, so every expectation below is marked `rulesUnverified: true` — and the
 * harness re-derives that fact from the pack's provenance rather than trusting
 * the marking. A laboratory expectation records *what the engine does today*, not
 * *what the law requires*.
 */

import { AY_2026_27_PACK_IDENTITY } from "@/lib/tax-pack/packs/ay-2026-27";
import type { CaseMeta, LedgerRows } from "@/lib/tax-desk/computation-adapter";
import type { SourceType, ValidationArea, ValidationSeverity } from "@/lib/tax-engine/ay-2026-27/types";
import {
  makeExpectedOutput,
  makeSyntheticCaseFixture,
  type ExpectedOutputTrace,
  type ExpectedValidationFinding,
  type SyntheticCaseFixture,
} from "../fixture";
import {
  makeDocumentEvidence,
  makeStaffAttestedEvidence,
  type EvidenceAcceptanceState,
  type LedgerFactKind,
} from "../evidence";
import type { MaterialOutputId, MaterialOutputValue } from "../material-outputs";

/**
 * Every seeded fixture is authored against the version the governing PACK
 * declares — read from the pack identity, never from the engine's `RULES_VERSION`
 * constant. The two are the same string today (the identity derives from it,
 * decision D6), but the laboratory's boundary is "bind a pack, never import an
 * engine": a fixture must not know an engine module exists.
 */
const PACK_VERSION = AY_2026_27_PACK_IDENTITY.computationRulesVersion;

/** Every executable AY fixture is pinned to the exact immutable pack that
 * authored its expectations. The ITA-2025 refusal fixture declares its own
 * separate statutory context below. */
const CURRENT_AY_STATUTORY = Object.freeze({
  assessmentYear: "2026-27",
  computationRulesVersion: PACK_VERSION,
});

/** Shorthand: a trace under the shipped pack version, always unverified. */
function trace(ruleIds: readonly string[]): ExpectedOutputTrace {
  return {
    ruleIds,
    packComputationRulesVersion: PACK_VERSION,
    // The AY 2026-27 pack is `draft` and every declared rule carries a
    // TODO(CA-verify) caveat. Never flip this without real CA sign-off.
    rulesUnverified: true,
  };
}

/**
 * `outputId` is typed as `MaterialOutputId` so a typo here is a COMPILE error;
 * `makeExpectedOutput` re-validates at runtime for callers outside this module.
 */
function expect_(outputId: MaterialOutputId, expected: MaterialOutputValue, ruleIds: readonly string[]) {
  return makeExpectedOutput({ outputId, expected, trace: trace(ruleIds) });
}

/**
 * Every seeded validation finding is pinned under the version the governing pack
 * declares for VALIDATION rules — a separate axis from the computation rules
 * version, even where the two strings coincide today.
 */
const VALIDATION_VERSION = AY_2026_27_PACK_IDENTITY.validationRulesVersion;

function finding(code: string, severity: ValidationSeverity, area: ValidationArea): ExpectedValidationFinding {
  return { code, severity, area, packValidationRulesVersion: VALIDATION_VERSION };
}

/**
 * The synthetic documents the seeded cases are evidenced by. Invented labels —
 * no real employer, bank, broker or client document is referenced anywhere.
 */
const DOCS = {
  form16: { documentId: "lab_doc_form16", label: "Synthetic Form 16", sourceType: "Form16" as SourceType },
  bank: { documentId: "lab_doc_bank", label: "Synthetic bank interest certificate", sourceType: "bank_certificate" as SourceType },
  broker: { documentId: "lab_doc_broker", label: "Synthetic broker capital-gains statement", sourceType: "broker_report" as SourceType },
  proof80c: { documentId: "lab_doc_80c_proof", label: "Synthetic 80C investment proof", sourceType: "manual" as SourceType },
  proof80d: { documentId: "lab_doc_80d_proof", label: "Synthetic 80D premium receipt", sourceType: "manual" as SourceType },
  // K4-10: the prior-year filed return a brought-forward loss is read out
  // of. Synthetic and invented, like every other document here.
  priorReturn: {
    documentId: "lab_doc_prior_return",
    label: "Synthetic prior-year filed return (AY 2022-23)",
    sourceType: "prefilled_json" as SourceType,
  },
} as const;

/** Evidence read off a source document the case holds. */
function fromDocument(
  ledgerKind: LedgerFactKind,
  ledgerId: string,
  document: (typeof DOCS)[keyof typeof DOCS],
  acceptance: EvidenceAcceptanceState = "accepted",
  acceptanceReason?: string,
) {
  return makeDocumentEvidence({
    kind: "source_document",
    ledgerKind,
    ledgerId,
    document,
    acceptance,
    ...(acceptanceReason !== undefined ? { acceptanceReason } : {}),
  });
}

/** Evidence for a staff-entered claim backed by a proof document on file. */
function fromProof(ledgerId: string, document: (typeof DOCS)[keyof typeof DOCS]) {
  return makeDocumentEvidence({
    kind: "proof_document",
    ledgerKind: "deduction",
    ledgerId,
    document,
    acceptance: "accepted",
  });
}

/** Staff-entered with NO document at all — said plainly rather than dressed up. */
function attested(ledgerKind: LedgerFactKind, ledgerId: string) {
  return makeStaffAttestedEvidence({ ledgerKind, ledgerId, sourceType: "manual", acceptance: "accepted" });
}

const AY_META: CaseMeta = {
  assessmentYear: "2026-27",
  financialYear: "2025-26",
  selectedItrType: "ITR-1",
  finalized: false,
};

/**
 * A resident senior citizen (born 1960-01-01 — completed age 66 as of the
 * previous year's end, 2026-03-31) for the K4-02 basic-exemption-widening
 * fixture below. `dateOfBirth`/`residentialStatus` flow through
 * `buildEngineInput` exactly as they would for a live case (K4-01).
 */
const SENIOR_META: CaseMeta = {
  ...AY_META,
  dateOfBirth: "1960-01-01",
  residentialStatus: "resident",
};

/**
 * A resident below-60 taxpayer (born 1995-01-01 — completed age 31 as of the
 * previous year's end, 2026-03-31) with a CONFIRMED age band and residency,
 * for the K4-03 80TTA/80TTB fixture below. Distinct from bare `AY_META`
 * (which carries no date of birth at all, so its age band never resolves) —
 * this meta exists specifically to exercise the below-60 branch of
 * `deductionCapForSection` with a real, derived (not merely absent) age.
 */
const BELOW_60_RESIDENT_META: CaseMeta = {
  ...AY_META,
  dateOfBirth: "1995-01-01",
  residentialStatus: "resident",
};

const EMPTY_LEDGER: LedgerRows = { income: [], taxPaid: [], deductions: [], capitalGains: [] };

// ---------------------------------------------------------------------------
// 1. Salaried refund, new regime, nil tax after the 87A rebate
// ---------------------------------------------------------------------------

export const salariedRefundFixture: SyntheticCaseFixture = makeSyntheticCaseFixture({
  id: "ay2026-27/salaried-refund-new-regime",
  description:
    "Salary plus small interest income, salary TDS exceeding the liability. Slab tax is fully " +
    "extinguished by the section 87A rebate, so the whole TDS is a refund. No capital gains, " +
    "no Chapter VI-A claims — the simplest supported golden path.",
  statutory: CURRENT_AY_STATUTORY,
  caseMeta: AY_META,
  ledger: {
    ...EMPTY_LEDGER,
    income: [
      { id: "lab_inc_salary", income_head: "salary", amount: 800_000, source_type: "Form16", source_document_id: "lab_doc_form16" },
      { id: "lab_inc_savings", income_head: "savings_interest", amount: 5_000, source_type: "manual" },
      { id: "lab_inc_fd", income_head: "fd_interest", amount: 20_000, source_type: "manual" },
    ],
    taxPaid: [
      { id: "lab_tp_tds", tax_paid_type: "salary_tds", amount: 60_000, source_type: "Form16", source_document_id: "lab_doc_form16" },
    ],
  },
  evidence: [
    fromDocument("income", "lab_inc_salary", DOCS.form16),
    attested("income", "lab_inc_savings"),
    attested("income", "lab_inc_fd"),
    fromDocument("tax_paid", "lab_tp_tds", DOCS.form16),
  ],
  expectations: [
    expect_("computation.grossTotalIncome", 825_000, []),
    expect_("computation.deductionsAllowed", 75_000, ["standard_deduction"]),
    expect_("computation.totalIncome", 750_000, ["standard_deduction"]),
    expect_("computation.newRegimeTax", 0, ["slab_rates", "rebate_87a", "cess_rate"]),
    // The old-regime column is NOT nil: its 87A ceiling is far lower, so slab tax
    // survives the rebate there. Pinned to keep the two columns visibly distinct.
    expect_("computation.oldRegimeTax", 70_200, ["slab_rates", "rebate_87a", "cess_rate", "chapter_via_deduction_caps"]),
    expect_("computation.recommendedRegime", "new", ["slab_rates", "rebate_87a"]),
    expect_("computation.rebate", 17_500, ["rebate_87a", "slab_rates"]),
    expect_("computation.cess", 0, ["cess_rate"]),
    expect_("computation.grossTaxLiability", 0, ["slab_rates", "rebate_87a", "cess_rate"]),
    expect_("computation.taxPaid", 60_000, []),
    expect_("computation.refundOrPayable", -60_000, ["slab_rates", "rebate_87a", "cess_rate"]),
    expect_("itrForm.recommendedItrType", "ITR-1", ["itr1_income_ceiling"]),
  ],
});

// ---------------------------------------------------------------------------
// 2. Salary + special-rate capital gains (STCG 111A and LTCG 112A)
// ---------------------------------------------------------------------------

export const salaryCapitalGainsFixture: SyntheticCaseFixture = makeSyntheticCaseFixture({
  id: "ay2026-27/salary-capital-gains",
  description:
    "Salary and FD interest alongside listed-equity STCG under section 111A and LTCG under " +
    "section 112A. Exercises the design invariant that special-rate gains are never merged " +
    "into slab income, the 112A annual exemption, and the ITR-1 → ITR-2 form escalation.",
  statutory: CURRENT_AY_STATUTORY,
  caseMeta: AY_META,
  ledger: {
    ...EMPTY_LEDGER,
    income: [
      { id: "lab_inc_salary", income_head: "salary", amount: 1_200_000, source_type: "Form16", source_document_id: "lab_doc_form16" },
      { id: "lab_inc_fd", income_head: "fd_interest", amount: 40_000, source_type: "bank_certificate", source_document_id: "lab_doc_bank" },
    ],
    taxPaid: [
      { id: "lab_tp_tds", tax_paid_type: "salary_tds", amount: 90_000, source_type: "Form16", source_document_id: "lab_doc_form16" },
    ],
    capitalGains: [
      {
        id: "lab_cg_stcg",
        gain_type: "stcg_111a",
        sale_value: 400_000,
        cost: 300_000,
        expenses: 0,
        exemption_claimed: 0,
        taxable_gain: 100_000,
        source_type: "broker_report",
        source_document_id: "lab_doc_broker",
      },
      {
        id: "lab_cg_ltcg",
        gain_type: "ltcg_112a",
        sale_value: 700_000,
        cost: 500_000,
        expenses: 0,
        exemption_claimed: 0,
        taxable_gain: 200_000,
        source_type: "broker_report",
        source_document_id: "lab_doc_broker",
      },
    ],
  },
  evidence: [
    fromDocument("income", "lab_inc_salary", DOCS.form16),
    fromDocument("income", "lab_inc_fd", DOCS.bank),
    fromDocument("tax_paid", "lab_tp_tds", DOCS.form16),
    fromDocument("capital_gain", "lab_cg_stcg", DOCS.broker),
    fromDocument("capital_gain", "lab_cg_ltcg", DOCS.broker),
  ],
  // The bank-certificate interest has nothing preparer-entered to reconcile
  // against, and ITR-1 is selected while capital gains are present.
  expectedFindings: [
    finding("AIS_INTEREST_NOT_ENTERED", "warning", "reconciliation"),
    finding("CG_REQUIRES_ITR2", "blocker", "itr_form"),
  ],
  expectations: [
    expect_("computation.grossTotalIncome", 1_540_000, []),
    expect_("computation.specialRateCapitalGains", 300_000, ["capital_gains_stcg_111a", "capital_gains_ltcg_112a"]),
    expect_("computation.specialRateTax", 29_375, ["capital_gains_stcg_111a", "capital_gains_ltcg_112a"]),
    expect_("computation.recommendedRegime", "new", ["slab_rates", "rebate_87a"]),
    expect_("computation.rebate", 0, ["rebate_87a"]),
    expect_("computation.cess", 3_435, ["cess_rate"]),
    expect_("computation.grossTaxLiability", 89_310, ["slab_rates", "capital_gains_stcg_111a", "capital_gains_ltcg_112a", "cess_rate"]),
    expect_("computation.taxPaid", 90_000, []),
    expect_("computation.refundOrPayable", -690, ["slab_rates", "capital_gains_stcg_111a", "capital_gains_ltcg_112a", "cess_rate"]),
    expect_("itrForm.recommendedItrType", "ITR-2", ["itr1_income_ceiling"]),
  ],
});

// ---------------------------------------------------------------------------
// 2b. Within-year capital-loss set-off (K4-09, Wave-4 priority #5)
// ---------------------------------------------------------------------------

/**
 * K4-09 — a long-term capital LOSS set off against long-term capital gains
 * within the same year (Sections 70 / 74(1)(b)).
 *
 * Deliberately built on fixture 2's exact salary + FD interest + TDS rows, so
 * the slab-tax half of the computation is identical to a case already pinned
 * elsewhere in this file and the ONLY thing this fixture varies is the capital
 * gains half. That makes a movement in the expected numbers below attributable
 * to the set-off rather than to some unrelated slab/rebate change.
 *
 * The figures are inside the provably unambiguous window (see `rules.ts`'s
 * CAPITAL_LOSS_SET_OFF): the ₹2,00,000 long-term loss is at or below the
 * ₹3,75,000 of 112A gains sitting above the ₹1,25,000 exemption, so both
 * readings of the exemption-ordering question agree, and there is no
 * short-term loss for the bucket-ordering question to arise from.
 */
export const capitalLossWithinYearSetOffFixture: SyntheticCaseFixture = makeSyntheticCaseFixture({
  id: "ay2026-27/capital-loss-within-year-set-off",
  description:
    "Salary and FD interest alongside a section 112A long-term capital GAIN and a section 112A " +
    "long-term capital LOSS in the same year. Exercises the K4-09 within-year set-off: the loss " +
    "reduces the long-term gain before the ₹1,25,000 exemption and the 12.5% rate apply, and " +
    "nothing is carried forward because the loss is fully absorbed.",
  statutory: CURRENT_AY_STATUTORY,
  caseMeta: AY_META,
  ledger: {
    ...EMPTY_LEDGER,
    income: [
      { id: "lab_inc_salary", income_head: "salary", amount: 1_200_000, source_type: "Form16", source_document_id: "lab_doc_form16" },
      { id: "lab_inc_fd", income_head: "fd_interest", amount: 40_000, source_type: "bank_certificate", source_document_id: "lab_doc_bank" },
    ],
    taxPaid: [
      { id: "lab_tp_tds", tax_paid_type: "salary_tds", amount: 90_000, source_type: "Form16", source_document_id: "lab_doc_form16" },
    ],
    capitalGains: [
      {
        id: "lab_cg_ltcg_gain",
        gain_type: "ltcg_112a",
        sale_value: 900_000,
        cost: 400_000,
        expenses: 0,
        exemption_claimed: 0,
        taxable_gain: 500_000,
        source_type: "broker_report",
        source_document_id: "lab_doc_broker",
      },
      {
        id: "lab_cg_ltcg_loss",
        gain_type: "ltcg_112a",
        sale_value: 300_000,
        cost: 500_000,
        expenses: 0,
        exemption_claimed: 0,
        taxable_gain: -200_000,
        source_type: "broker_report",
        source_document_id: "lab_doc_broker",
      },
    ],
  },
  evidence: [
    fromDocument("income", "lab_inc_salary", DOCS.form16),
    fromDocument("income", "lab_inc_fd", DOCS.bank),
    fromDocument("tax_paid", "lab_tp_tds", DOCS.form16),
    fromDocument("capital_gain", "lab_cg_ltcg_gain", DOCS.broker),
    fromDocument("capital_gain", "lab_cg_ltcg_loss", DOCS.broker),
  ],
  // Same two findings as fixture 2, and for the same two reasons: the
  // bank-certificate interest has nothing preparer-entered to reconcile
  // against, and ITR-1 is selected while capital gains are present.
  expectedFindings: [
    finding("AIS_INTEREST_NOT_ENTERED", "warning", "reconciliation"),
    finding("CG_REQUIRES_ITR2", "blocker", "itr_form"),
    // The K4-09 disclosure itself — fires because a set-off actually occurred.
    finding("CAPITAL_LOSS_SET_OFF_APPLIED", "info", "deductions"),
  ],
  expectations: [
    // 1,200,000 salary + 40,000 FD + (500,000 - 200,000) net 112A = 1,540,000.
    expect_("computation.grossTotalIncome", 1_540_000, []),
    // NET of the set-off: 500,000 gain - 200,000 loss = 300,000.
    expect_("computation.specialRateCapitalGains", 300_000, ["capital_gains_ltcg_112a", "capital_loss_within_year_set_off"]),
    // max(0, 300,000 - 125,000) x 12.5% = 21,875. Note this is STRICTLY LESS
    // than the 37,500 the same gain would attract with the loss ignored —
    // the assertion that the set-off actually happened.
    expect_("computation.specialRateTax", 21_875, ["capital_gains_ltcg_112a", "capital_loss_within_year_set_off"]),
    expect_("computation.recommendedRegime", "new", ["slab_rates", "rebate_87a"]),
    expect_("computation.rebate", 0, ["rebate_87a"]),
    // 4% of (56,500 slab tax + 21,875 special-rate tax) = 3,135.
    expect_("computation.cess", 3_135, ["cess_rate"]),
    expect_("computation.grossTaxLiability", 81_510, ["slab_rates", "capital_gains_ltcg_112a", "capital_loss_within_year_set_off", "cess_rate"]),
    expect_("computation.taxPaid", 90_000, []),
    expect_("computation.refundOrPayable", -8_490, ["slab_rates", "capital_gains_ltcg_112a", "capital_loss_within_year_set_off", "cess_rate"]),
    expect_("itrForm.recommendedItrType", "ITR-2", ["itr1_income_ceiling"]),
  ],
});

// ---------------------------------------------------------------------------
// 3. Higher salary with Chapter VI-A claims — tax payable, no rebate
// ---------------------------------------------------------------------------

export const salariedPayableFixture: SyntheticCaseFixture = makeSyntheticCaseFixture({
  id: "ay2026-27/salaried-payable-with-deductions",
  description:
    "Salary above the 87A rebate ceiling with 80C and 80D claims and part-paid advance tax. " +
    "Exercises the Chapter VI-A caps in the old-regime column, the no-rebate branch, and a " +
    "net payable position rather than a refund.",
  statutory: CURRENT_AY_STATUTORY,
  caseMeta: AY_META,
  ledger: {
    ...EMPTY_LEDGER,
    income: [
      { id: "lab_inc_salary", income_head: "salary", amount: 2_500_000, source_type: "Form16", source_document_id: "lab_doc_form16" },
    ],
    taxPaid: [
      { id: "lab_tp_tds", tax_paid_type: "salary_tds", amount: 200_000, source_type: "Form16", source_document_id: "lab_doc_form16" },
      { id: "lab_tp_adv", tax_paid_type: "advance_tax", amount: 20_000, source_type: "manual" },
    ],
    deductions: [
      { id: "lab_ded_80c", deduction_type: "80C", amount: 180_000, source_type: "manual", proof_case_document_id: "lab_doc_80c_proof" },
      { id: "lab_ded_80d", deduction_type: "80D", amount: 25_000, source_type: "manual", proof_case_document_id: "lab_doc_80d_proof" },
    ],
  },
  evidence: [
    fromDocument("income", "lab_inc_salary", DOCS.form16),
    fromDocument("tax_paid", "lab_tp_tds", DOCS.form16),
    attested("tax_paid", "lab_tp_adv"),
    fromProof("lab_ded_80c", DOCS.proof80c),
    fromProof("lab_ded_80d", DOCS.proof80d),
  ],
  // Tax remains payable and no self-assessment challan is recorded.
  expectedFindings: [finding("TAX_PAYABLE_NO_CHALLAN", "warning", "payments")],
  expectations: [
    expect_("computation.grossTotalIncome", 2_500_000, []),
    expect_("computation.deductionsAllowed", 75_000, ["standard_deduction"]),
    expect_("computation.totalIncome", 2_425_000, ["standard_deduction"]),
    expect_("computation.newRegimeTax", 319_800, ["slab_rates", "cess_rate"]),
    // 80C is capped at ₹1,50,000 of the ₹1,80,000 claimed; 80D passes at ₹25,000.
    expect_("computation.oldRegimeTax", 514_800, ["slab_rates", "chapter_via_deduction_caps", "cess_rate"]),
    expect_("computation.recommendedRegime", "new", ["slab_rates"]),
    expect_("computation.rebate", 0, ["rebate_87a"]),
    expect_("computation.cess", 12_300, ["cess_rate"]),
    expect_("computation.grossTaxLiability", 319_800, ["slab_rates", "cess_rate"]),
    expect_("computation.taxPaid", 220_000, []),
    expect_("computation.refundOrPayable", 99_800, ["slab_rates", "cess_rate"]),
    // ₹25,00,000 is below the ITR-1 ceiling and there are no ITR-1 blockers here.
    expect_("itrForm.recommendedItrType", "ITR-1", ["itr1_income_ceiling"]),
  ],
});

// ---------------------------------------------------------------------------
// 4. Deliberately unsupported: facts the engine does not model
// ---------------------------------------------------------------------------

export const unsupportedFactsFixture: SyntheticCaseFixture = makeSyntheticCaseFixture({
  id: "ay2026-27/unsupported-house-property-and-other-ltcg",
  description:
    "Deliberately UNSUPPORTED. The ledger declares house-property income and a non-112A " +
    "long-term gain — heads the AY 2026-27 engine captures but does not compute. The harness " +
    "must itemise both as blockers and report the run as blocked; the numbers it still " +
    "produces exclude those facts and must never be relied upon.",
  statutory: CURRENT_AY_STATUTORY,
  caseMeta: AY_META,
  ledger: {
    ...EMPTY_LEDGER,
    income: [
      { id: "lab_inc_salary", income_head: "salary", amount: 600_000, source_type: "Form16", source_document_id: "lab_doc_form16" },
      { id: "lab_inc_hp", income_head: "house_property", amount: 240_000, source_type: "manual" },
    ],
    taxPaid: [
      { id: "lab_tp_tds", tax_paid_type: "salary_tds", amount: 10_000, source_type: "Form16", source_document_id: "lab_doc_form16" },
    ],
    capitalGains: [
      {
        id: "lab_cg_other_ltcg",
        gain_type: "other_ltcg",
        sale_value: 250_000,
        cost: 200_000,
        expenses: 0,
        exemption_claimed: 0,
        taxable_gain: 50_000,
        source_type: "manual",
      },
    ],
  },
  evidence: [
    fromDocument("income", "lab_inc_salary", DOCS.form16),
    attested("income", "lab_inc_hp"),
    fromDocument("tax_paid", "lab_tp_tds", DOCS.form16),
    attested("capital_gain", "lab_cg_other_ltcg"),
  ],
  expectedUnsupported: [
    { code: "UNSUPPORTED_INCOME_HEAD", ledgerId: "lab_inc_hp", entryType: "house_property" },
    { code: "UNSUPPORTED_GAIN_TYPE", ledgerId: "lab_cg_other_ltcg", entryType: "other_ltcg" },
  ],
  expectations: [
    // Pinned so the exclusion is VISIBLE: gross total income counts only the
    // salary, proving the unsupported heads were left out rather than guessed at.
    expect_("computation.grossTotalIncome", 600_000, []),
    expect_("computation.grossTaxLiability", 0, ["slab_rates", "rebate_87a", "cess_rate"]),
    expect_("computation.refundOrPayable", -10_000, ["slab_rates", "rebate_87a", "cess_rate"]),
  ],
});

// ---------------------------------------------------------------------------
// 5. Fails safe: a statutory world with no computation binding
// ---------------------------------------------------------------------------

/**
 * The TY 2026-27 / Income-tax Act 2025 stub is registered as an identity-only
 * pack with NO computation binding (`K3-15`). A fixture pointed at it must be
 * REFUSED, not computed — proving the laboratory inherits the pack layer's
 * fail-safe behaviour instead of falling back to an engine.
 */
export const unboundStatutoryWorldFixture: SyntheticCaseFixture = makeSyntheticCaseFixture({
  id: "ty2026-27/unbound-statutory-world",
  description:
    "Points at the TY 2026-27 / Income-tax Act 2025 identity-only stub, which declares no " +
    "computation binding. The harness must refuse to compute rather than fall back to the " +
    "1961-Act engine.",
  statutory: { assessmentYear: "2026-27", law: "ITA_2025" },
  caseMeta: AY_META,
  ledger: {
    ...EMPTY_LEDGER,
    income: [
      { id: "lab_inc_salary", income_head: "salary", amount: 800_000, source_type: "Form16", source_document_id: "lab_doc_form16" },
    ],
  },
  evidence: [fromDocument("income", "lab_inc_salary", DOCS.form16)],
  expectedBinding: "refused",
});

// ---------------------------------------------------------------------------
// 6. Unaccepted evidence: a declared fact that may NOT become preparation truth
// ---------------------------------------------------------------------------

/**
 * The broker statement is on file and the gain is declared, but nobody has
 * accepted it yet. The harness must withhold the row BEFORE the adapter runs, so
 * the computed numbers exclude it entirely — visible in the pinned gross total
 * income (salary only) and in the ITR form staying ITR-1, which it could not do
 * if a capital gain had been folded in.
 *
 * This is rule 5 made checkable: something proposed — by a document, an import,
 * or an assistant — is never authoritative until a human accepts it.
 */
export const unacceptedEvidenceFixture: SyntheticCaseFixture = makeSyntheticCaseFixture({
  id: "ay2026-27/unaccepted-broker-evidence",
  description:
    "A capital gain whose broker statement has NOT been accepted. The fact is declared but " +
    "withheld: it never reaches the engine input, the numbers exclude it, and it comes back as " +
    "itemised evidence work rather than a silently-computed guess.",
  statutory: CURRENT_AY_STATUTORY,
  caseMeta: AY_META,
  ledger: {
    ...EMPTY_LEDGER,
    income: [
      { id: "lab_inc_salary", income_head: "salary", amount: 800_000, source_type: "Form16", source_document_id: "lab_doc_form16" },
    ],
    taxPaid: [
      { id: "lab_tp_tds", tax_paid_type: "salary_tds", amount: 60_000, source_type: "Form16", source_document_id: "lab_doc_form16" },
    ],
    capitalGains: [
      {
        id: "lab_cg_stcg",
        gain_type: "stcg_111a",
        sale_value: 400_000,
        cost: 300_000,
        expenses: 0,
        exemption_claimed: 0,
        taxable_gain: 100_000,
        source_type: "broker_report",
        source_document_id: "lab_doc_broker",
      },
    ],
  },
  evidence: [
    fromDocument("income", "lab_inc_salary", DOCS.form16),
    fromDocument("tax_paid", "lab_tp_tds", DOCS.form16),
    fromDocument(
      "capital_gain",
      "lab_cg_stcg",
      DOCS.broker,
      "proposed",
      "Broker statement received but the gain has not been reviewed or accepted by a preparer.",
    ),
  ],
  expectedWithheld: [{ ledgerId: "lab_cg_stcg", ledgerKind: "capital_gain", acceptance: "proposed" }],
  expectations: [
    // Salary only — the unaccepted gain is absent, not merged and not guessed.
    expect_("computation.grossTotalIncome", 800_000, []),
    expect_("computation.specialRateCapitalGains", 0, ["capital_gains_stcg_111a", "capital_gains_ltcg_112a"]),
    expect_("computation.specialRateTax", 0, ["capital_gains_stcg_111a", "capital_gains_ltcg_112a"]),
    // ITR-1 survives only because no capital gain entered the computation.
    expect_("itrForm.recommendedItrType", "ITR-1", ["itr1_income_ceiling"]),
  ],
});

// ---------------------------------------------------------------------------
// 7. Unreconciled reported income: explicit WORK, not a silent adjustment
// ---------------------------------------------------------------------------

/**
 * Interest is reported by a bank certificate while the preparer entered none.
 * The engine must raise a reconciliation finding rather than quietly adopting
 * either figure — the validation half of *"unsupported facts create explicit
 * work, not guesses"*. Pinned by CODE and SEVERITY only; the message is prose.
 */
export const reconciliationFindingFixture: SyntheticCaseFixture = makeSyntheticCaseFixture({
  id: "ay2026-27/reported-interest-not-reconciled",
  description:
    "Salary plus bank-certificate interest with no preparer-entered interest to reconcile it " +
    "against. Pins the reconciliation finding the case must raise, proving unreconciled reported " +
    "income becomes visible work rather than an invisible adjustment.",
  statutory: CURRENT_AY_STATUTORY,
  caseMeta: AY_META,
  ledger: {
    ...EMPTY_LEDGER,
    income: [
      { id: "lab_inc_salary", income_head: "salary", amount: 900_000, source_type: "Form16", source_document_id: "lab_doc_form16" },
      { id: "lab_inc_fd", income_head: "fd_interest", amount: 60_000, source_type: "bank_certificate", source_document_id: "lab_doc_bank" },
    ],
    taxPaid: [
      { id: "lab_tp_tds", tax_paid_type: "salary_tds", amount: 40_000, source_type: "Form16", source_document_id: "lab_doc_form16" },
    ],
  },
  evidence: [
    fromDocument("income", "lab_inc_salary", DOCS.form16),
    fromDocument("income", "lab_inc_fd", DOCS.bank),
    fromDocument("tax_paid", "lab_tp_tds", DOCS.form16),
  ],
  expectedFindings: [finding("AIS_INTEREST_NOT_ENTERED", "warning", "reconciliation")],
  expectations: [expect_("computation.grossTotalIncome", 960_000, [])],
});

// ---------------------------------------------------------------------------
// 8. Resident senior citizen — OLD-regime basic-exemption widening (K4-02)
// ---------------------------------------------------------------------------

/**
 * A resident senior citizen with salary-only income. Exercises the K4-02
 * `senior_super_senior_basic_exemption_widening` rule: the OLD-regime slab
 * tax uses the widened ₹3,00,000 nil-rate threshold (₹60,000, not the
 * below-60 ₹62,500 a control case at the identical income would show — see
 * the engine's own `compute-tax.test.ts` for that control comparison). The
 * NEW regime stays recommended (nil tax) and is untouched by age, so this
 * fixture also proves the widening never leaks into the new-regime column.
 */
export const seniorOldRegimeBasicExemptionFixture: SyntheticCaseFixture = makeSyntheticCaseFixture({
  id: "ay2026-27/senior-old-regime-basic-exemption-widening",
  description:
    "Resident senior citizen, salary-only income. Proves the OLD-regime slab tax now uses the " +
    "widened ₹3,00,000 basic exemption (K4-02) rather than the below-60 ₹2,50,000 threshold, " +
    "while the NEW regime — recommended here — stays exactly as age-neutral as before.",
  statutory: CURRENT_AY_STATUTORY,
  caseMeta: SENIOR_META,
  ledger: {
    ...EMPTY_LEDGER,
    income: [
      { id: "lab_inc_salary", income_head: "salary", amount: 800_000, source_type: "Form16", source_document_id: "lab_doc_form16" },
    ],
    taxPaid: [
      { id: "lab_tp_tds", tax_paid_type: "salary_tds", amount: 60_000, source_type: "Form16", source_document_id: "lab_doc_form16" },
    ],
  },
  evidence: [
    fromDocument("income", "lab_inc_salary", DOCS.form16),
    fromDocument("tax_paid", "lab_tp_tds", DOCS.form16),
  ],
  expectations: [
    expect_("computation.grossTotalIncome", 800_000, []),
    expect_("computation.deductionsAllowed", 75_000, ["standard_deduction"]),
    expect_("computation.totalIncome", 725_000, ["standard_deduction"]),
    expect_("computation.newRegimeTax", 0, ["slab_rates", "rebate_87a", "cess_rate"]),
    // The widened senior exemption drops old-regime slab tax to ₹60,000 (vs
    // the below-60 ₹62,500 the engine's own unit tests pin as the control) —
    // gross liability ₹60,000 + 4% cess ₹2,400 = ₹62,400.
    expect_("computation.oldRegimeTax", 62_400, [
      "slab_rates",
      "chapter_via_deduction_caps",
      "cess_rate",
      "senior_super_senior_basic_exemption_widening",
    ]),
    expect_("computation.recommendedRegime", "new", ["slab_rates", "rebate_87a"]),
    expect_("computation.rebate", 16_250, ["rebate_87a", "slab_rates"]),
    expect_("computation.cess", 0, ["cess_rate"]),
    expect_("computation.grossTaxLiability", 0, ["slab_rates", "rebate_87a", "cess_rate"]),
    expect_("computation.taxPaid", 60_000, []),
    expect_("computation.refundOrPayable", -60_000, ["slab_rates", "rebate_87a", "cess_rate"]),
    expect_("itrForm.recommendedItrType", "ITR-1", ["itr1_income_ceiling"]),
  ],
});

// ---------------------------------------------------------------------------
// 9. Resident senior citizen — Section 80D cap + 80TTA/80TTB mutual
//    exclusivity (K4-03)
// ---------------------------------------------------------------------------

/**
 * A resident senior citizen with salary income and three deduction claims:
 * an 80D premium claim above the senior cap (widened to ₹50,000, K4-03), a
 * correctly-sectioned 80TTB interest claim (allowed at ₹50,000), and an
 * INCORRECTLY-sectioned 80TTA claim (a senior citizen cannot claim 80TTA —
 * excluded entirely, ₹0 cap, K4-03 `senior_80tta_80ttb_mutual_exclusivity`).
 * The mismatched 80TTA row also raises `DEDUCTION_SECTION_AGE_MISMATCH`
 * (K4-03), so this fixture proves the computation fix AND the validation
 * finding that explains it together. Old-regime slab tax also carries the
 * K4-02 basic-exemption widening — both K4-02 and K4-03 senior rules compose
 * in the same figure without either masking the other.
 */
export const seniorDeductionCapsFixture: SyntheticCaseFixture = makeSyntheticCaseFixture({
  id: "ay2026-27/senior-old-regime-deduction-caps",
  description:
    "Resident senior citizen. Proves the Section 80D cap widens to ₹50,000 (K4-03), a correctly-" +
    "sectioned 80TTB claim is allowed at ₹50,000, and an incorrectly-sectioned 80TTA claim is " +
    "excluded entirely (₹0 cap) with an explanatory DEDUCTION_SECTION_AGE_MISMATCH finding — " +
    "closing the K4-02 dossier's over-claim-shaped silent-exclusion finding from the OTHER " +
    "direction (a senior wrongly claiming the non-senior section, rather than the reverse).",
  statutory: CURRENT_AY_STATUTORY,
  caseMeta: SENIOR_META,
  ledger: {
    ...EMPTY_LEDGER,
    income: [
      { id: "lab_inc_salary", income_head: "salary", amount: 800_000, source_type: "Form16", source_document_id: "lab_doc_form16" },
    ],
    taxPaid: [
      { id: "lab_tp_tds", tax_paid_type: "salary_tds", amount: 60_000, source_type: "Form16", source_document_id: "lab_doc_form16" },
    ],
    deductions: [
      { id: "lab_ded_80d_senior", deduction_type: "80D", amount: 60_000, source_type: "manual", proof_case_document_id: "lab_doc_80d_proof" },
      { id: "lab_ded_80ttb_senior", deduction_type: "80TTB", amount: 50_000, source_type: "bank_certificate", proof_case_document_id: "lab_doc_bank" },
      { id: "lab_ded_80tta_senior_mismatch", deduction_type: "80TTA", amount: 10_000, source_type: "bank_certificate", proof_case_document_id: "lab_doc_bank" },
    ],
  },
  evidence: [
    fromDocument("income", "lab_inc_salary", DOCS.form16),
    fromDocument("tax_paid", "lab_tp_tds", DOCS.form16),
    fromProof("lab_ded_80d_senior", DOCS.proof80d),
    fromProof("lab_ded_80ttb_senior", DOCS.bank),
    fromProof("lab_ded_80tta_senior_mismatch", DOCS.bank),
  ],
  expectedFindings: [finding("DEDUCTION_SECTION_AGE_MISMATCH", "warning", "deductions")],
  expectations: [
    expect_("computation.grossTotalIncome", 800_000, []),
    expect_("computation.deductionsAllowed", 75_000, ["standard_deduction"]),
    expect_("computation.totalIncome", 725_000, ["standard_deduction"]),
    expect_("computation.newRegimeTax", 0, ["slab_rates", "rebate_87a", "cess_rate"]),
    // Chapter VI-A (old regime) = 80D min(60,000, senior cap 50,000) +
    // 80TTB min(50,000, senior cap 50,000) + 80TTA min(10,000, cap 0) =
    // 50,000 + 50,000 + 0 = 100,000. Taxable = 750,000 - 100,000 = 650,000.
    // Senior slabs (K4-02): 0-300k nil, 300k-500k@5%=10,000, 500k-650k@20%=
    // 30,000 → slab tax 40,000; no 87A rebate above ₹5L old-regime ceiling;
    // +4% cess 1,600 = gross liability ₹41,600.
    expect_("computation.oldRegimeTax", 41_600, [
      "slab_rates",
      "chapter_via_deduction_caps",
      "cess_rate",
      "senior_super_senior_basic_exemption_widening",
      "senior_80d_deduction_cap",
      "senior_80tta_80ttb_mutual_exclusivity",
    ]),
    expect_("computation.recommendedRegime", "new", ["slab_rates", "rebate_87a"]),
    expect_("computation.rebate", 16_250, ["rebate_87a", "slab_rates"]),
    expect_("computation.cess", 0, ["cess_rate"]),
    expect_("computation.grossTaxLiability", 0, ["slab_rates", "rebate_87a", "cess_rate"]),
    expect_("computation.taxPaid", 60_000, []),
    expect_("computation.refundOrPayable", -60_000, ["slab_rates", "rebate_87a", "cess_rate"]),
    expect_("itrForm.recommendedItrType", "ITR-1", ["itr1_income_ceiling"]),
  ],
});

// ---------------------------------------------------------------------------
// 10. Resident below-60 taxpayer — 80TTB over-claim closed (K4-02 dossier's
//     SECOND finding, closed by K4-03)
// ---------------------------------------------------------------------------

/**
 * A resident below-60 taxpayer with a correctly-sectioned 80TTA claim
 * (control — allowed at ₹10,000) and an 80TTB claim they are NOT entitled to
 * (80TTB is senior-only). Before K4-03, this below-60 taxpayer's "80TTB" row
 * was silently accepted at the full ₹50,000 SENIOR cap regardless of actual
 * entitlement — the exact over-claim-shaped silent-exclusion finding the
 * K4-02 dossier (spec §10.3) flagged but did not fix. This fixture is the
 * direct golden-fixture proof that the gap is now closed: the 80TTB claim is
 * excluded entirely (₹0 cap), with an explanatory finding.
 */
export const belowSixty80ttbExclusionFixture: SyntheticCaseFixture = makeSyntheticCaseFixture({
  id: "ay2026-27/below-60-80ttb-exclusion",
  description:
    "Resident below-60 taxpayer wrongly claims Section 80TTB (senior-only). Proves the K4-02 " +
    "dossier's second finding is closed: the claim is excluded entirely (₹0 cap), not silently " +
    "accepted at the ₹50,000 senior cap. A correctly-sectioned 80TTA claim in the same case " +
    "(control) is allowed normally, proving the fix is section-specific, not a blanket exclusion.",
  statutory: CURRENT_AY_STATUTORY,
  caseMeta: BELOW_60_RESIDENT_META,
  ledger: {
    ...EMPTY_LEDGER,
    income: [
      { id: "lab_inc_salary", income_head: "salary", amount: 800_000, source_type: "Form16", source_document_id: "lab_doc_form16" },
    ],
    taxPaid: [
      { id: "lab_tp_tds", tax_paid_type: "salary_tds", amount: 60_000, source_type: "Form16", source_document_id: "lab_doc_form16" },
    ],
    deductions: [
      { id: "lab_ded_80tta_below60", deduction_type: "80TTA", amount: 10_000, source_type: "bank_certificate", proof_case_document_id: "lab_doc_bank" },
      { id: "lab_ded_80ttb_below60_mismatch", deduction_type: "80TTB", amount: 50_000, source_type: "bank_certificate", proof_case_document_id: "lab_doc_bank" },
    ],
  },
  evidence: [
    fromDocument("income", "lab_inc_salary", DOCS.form16),
    fromDocument("tax_paid", "lab_tp_tds", DOCS.form16),
    fromProof("lab_ded_80tta_below60", DOCS.bank),
    fromProof("lab_ded_80ttb_below60_mismatch", DOCS.bank),
  ],
  expectedFindings: [finding("DEDUCTION_SECTION_AGE_MISMATCH", "warning", "deductions")],
  expectations: [
    expect_("computation.grossTotalIncome", 800_000, []),
    expect_("computation.deductionsAllowed", 75_000, ["standard_deduction"]),
    expect_("computation.totalIncome", 725_000, ["standard_deduction"]),
    expect_("computation.newRegimeTax", 0, ["slab_rates", "rebate_87a", "cess_rate"]),
    // Chapter VI-A (old regime) = 80TTA min(10,000, 10,000) + 80TTB
    // min(50,000, cap 0) = 10,000 + 0 = 10,000. Taxable = 750,000 - 10,000 =
    // 740,000. Below-60 slabs (UNCHANGED — no K4-02 widening for this
    // taxpayer): 0-250k nil, 250k-500k@5%=12,500, 500k-740k@20%=48,000 →
    // slab tax 60,500; no 87A rebate above ₹5L old-regime ceiling; +4% cess
    // 2,420 = gross liability ₹62,920.
    expect_("computation.oldRegimeTax", 62_920, [
      "slab_rates",
      "chapter_via_deduction_caps",
      "cess_rate",
      "senior_80tta_80ttb_mutual_exclusivity",
    ]),
    expect_("computation.recommendedRegime", "new", ["slab_rates", "rebate_87a"]),
    expect_("computation.rebate", 16_250, ["rebate_87a", "slab_rates"]),
    expect_("computation.cess", 0, ["cess_rate"]),
    expect_("computation.grossTaxLiability", 0, ["slab_rates", "rebate_87a", "cess_rate"]),
    expect_("computation.taxPaid", 60_000, []),
    expect_("computation.refundOrPayable", -60_000, ["slab_rates", "rebate_87a", "cess_rate"]),
    expect_("itrForm.recommendedItrType", "ITR-1", ["itr1_income_ceiling"]),
  ],
});

// ---------------------------------------------------------------------------
// 10b. Below-60 resident taxpayer, confirmed-senior PARENT — Section 80D
//      "insured party" sub-case (K4-05, spec §10.2's residual gap)
// ---------------------------------------------------------------------------

/**
 * A resident BELOW-60 taxpayer (deliberately NOT senior themselves) pays
 * premium on behalf of two parents via the `"80D_PARENTS"` bucket — one
 * confirmed senior (`insuredPartySenior: true`), one NOT confirmed senior
 * (the field omitted, per the ledger's own conservative default). Proves two
 * things at once: (1) the parents-bucket cap is driven by the INSURED
 * PARENT's own status, entirely independent of the taxpayer's own age band
 * (this taxpayer is below-60, so `SENIOR_TREATMENT_UNSUPPORTED` never
 * applies to them in the first place — the parent-premium gap this fixture
 * closes affects a below-60 taxpayer just as much as a senior one); and (2)
 * the whole bucket's cap widens to ₹50,000 once ANY row in it confirms a
 * senior parent (matching the ITD's own "₹50,000 if ANY person is a Senior
 * Citizen" wording for the bucket, not a per-row cap) — the combined ₹55,000
 * claim is capped at ₹50,000, not silently allowed in full.
 */
export const seniorParentsDeductionCapFixture: SyntheticCaseFixture = makeSyntheticCaseFixture({
  id: "ay2026-27/senior-80d-parents-deduction-cap",
  description:
    "Below-60 resident taxpayer pays 80D premium for two parents, one confirmed senior. Proves the " +
    "K4-05 parents-bucket cap (₹50,000, independent of the taxpayer's own age) widens correctly and " +
    "caps the combined claim, closing spec §10.2's residual 'insured party' gap.",
  statutory: CURRENT_AY_STATUTORY,
  caseMeta: BELOW_60_RESIDENT_META,
  ledger: {
    ...EMPTY_LEDGER,
    income: [
      { id: "lab_inc_salary", income_head: "salary", amount: 800_000, source_type: "Form16", source_document_id: "lab_doc_form16" },
    ],
    taxPaid: [
      { id: "lab_tp_tds", tax_paid_type: "salary_tds", amount: 60_000, source_type: "Form16", source_document_id: "lab_doc_form16" },
    ],
    deductions: [
      { id: "lab_ded_80d_parents_father", deduction_type: "80D_PARENTS", amount: 30_000, source_type: "manual", proof_case_document_id: "lab_doc_80d_proof", insured_party_senior: true },
      { id: "lab_ded_80d_parents_mother", deduction_type: "80D_PARENTS", amount: 25_000, source_type: "manual", proof_case_document_id: "lab_doc_80d_proof" },
    ],
  },
  evidence: [
    fromDocument("income", "lab_inc_salary", DOCS.form16),
    fromDocument("tax_paid", "lab_tp_tds", DOCS.form16),
    fromProof("lab_ded_80d_parents_father", DOCS.proof80d),
    fromProof("lab_ded_80d_parents_mother", DOCS.proof80d),
  ],
  expectedFindings: [],
  expectations: [
    expect_("computation.grossTotalIncome", 800_000, []),
    expect_("computation.deductionsAllowed", 75_000, ["standard_deduction"]),
    expect_("computation.totalIncome", 725_000, ["standard_deduction"]),
    expect_("computation.newRegimeTax", 0, ["slab_rates", "rebate_87a", "cess_rate"]),
    // Chapter VI-A (old regime) = 80D_PARENTS min(₹30,000 + ₹25,000 = ₹55,000,
    // bucket cap ₹50,000 — widened because the father row confirms senior) =
    // ₹50,000. Taxable = 800,000 - 50,000 (std) - 50,000 (80D_PARENTS) =
    // 700,000. Below-60 slabs (UNCHANGED — this taxpayer is not senior): 0-
    // 250k nil, 250k-500k@5%=12,500, 500k-700k@20%=40,000 → slab tax 52,500;
    // no 87A rebate above ₹5L old-regime ceiling; +4% cess 2,100 = gross
    // liability ₹54,600.
    expect_("computation.oldRegimeTax", 54_600, [
      "slab_rates",
      "chapter_via_deduction_caps",
      "cess_rate",
      "senior_80d_parents_deduction_cap",
    ]),
    expect_("computation.recommendedRegime", "new", ["slab_rates", "rebate_87a"]),
    expect_("computation.rebate", 16_250, ["rebate_87a", "slab_rates"]),
    expect_("computation.cess", 0, ["cess_rate"]),
    expect_("computation.grossTaxLiability", 0, ["slab_rates", "rebate_87a", "cess_rate"]),
    expect_("computation.taxPaid", 60_000, []),
    expect_("computation.refundOrPayable", -60_000, ["slab_rates", "rebate_87a", "cess_rate"]),
    expect_("itrForm.recommendedItrType", "ITR-1", ["itr1_income_ceiling"]),
  ],
});

// ---------------------------------------------------------------------------
// 11. Resident senior citizen, tax payable, no business income — Section
//     207(2) advance-tax exemption disclosure (K4-04)
// ---------------------------------------------------------------------------

/**
 * A resident senior citizen with salary income large enough (recommended new
 * regime, above the ₹12,00,000 87A rebate ceiling) that tax remains payable
 * after a deliberately understated TDS credit, with NO advance tax paid at
 * all. Proves the new `ADVANCE_TAX_EXEMPT_SENIOR_CITIZEN_207_2` disclosure
 * fires alongside the pre-existing `TAX_PAYABLE_NO_CHALLAN` finding — the two
 * together explain both that a challan is needed AND that this taxpayer was
 * never required to have paid the shortfall as advance tax during the year.
 */
export const seniorAdvanceTaxExemptionFixture: SyntheticCaseFixture = makeSyntheticCaseFixture({
  id: "ay2026-27/senior-advance-tax-exemption-207-2",
  description:
    "Resident senior citizen, salary-only income, tax payable, no advance tax paid at all. Proves " +
    "the Section 207(2) advance-tax-exemption disclosure (K4-04) fires alongside " +
    "TAX_PAYABLE_NO_CHALLAN — informational only, no liability/refund figure changes.",
  statutory: CURRENT_AY_STATUTORY,
  caseMeta: SENIOR_META,
  ledger: {
    ...EMPTY_LEDGER,
    income: [
      { id: "lab_inc_salary", income_head: "salary", amount: 2_000_000, source_type: "Form16", source_document_id: "lab_doc_form16" },
    ],
    taxPaid: [
      { id: "lab_tp_tds", tax_paid_type: "salary_tds", amount: 50_000, source_type: "Form16", source_document_id: "lab_doc_form16" },
    ],
  },
  evidence: [
    fromDocument("income", "lab_inc_salary", DOCS.form16),
    fromDocument("tax_paid", "lab_tp_tds", DOCS.form16),
  ],
  expectedFindings: [
    finding("TAX_PAYABLE_NO_CHALLAN", "warning", "payments"),
    finding("ADVANCE_TAX_EXEMPT_SENIOR_CITIZEN_207_2", "info", "payments"),
  ],
  expectations: [
    expect_("computation.grossTotalIncome", 2_000_000, []),
    expect_("computation.deductionsAllowed", 75_000, ["standard_deduction"]),
    expect_("computation.totalIncome", 1_925_000, ["standard_deduction"]),
    // New regime (recommended): 1,925,000 > ₹12,00,000 87A ceiling, no rebate.
    // Slab tax = 20,000(400-800k@5) + 40,000(800-1200k@10) + 60,000(1200-1600k@15)
    // + 65,000(1600-1925k@20) = 185,000; +4% cess 7,400 = 192,400.
    expect_("computation.newRegimeTax", 192_400, ["slab_rates", "cess_rate"]),
    // Old regime (senior slabs, K4-02): totalIncome 1,950,000 (std deduction
    // 50,000 only, no Chapter VI-A claims). Slab tax = 10,000(300-500k@5) +
    // 100,000(500-1000k@20) + 285,000(1000-1950k@30) = 395,000; old-regime
    // 87A ceiling ₹5,00,000 exceeded, no rebate; +4% cess 15,800 = 410,800.
    expect_("computation.oldRegimeTax", 410_800, [
      "slab_rates",
      "chapter_via_deduction_caps",
      "cess_rate",
      "senior_super_senior_basic_exemption_widening",
    ]),
    expect_("computation.recommendedRegime", "new", ["slab_rates"]),
    expect_("computation.rebate", 0, ["rebate_87a"]),
    expect_("computation.cess", 7_400, ["cess_rate"]),
    expect_("computation.grossTaxLiability", 192_400, ["slab_rates", "cess_rate"]),
    expect_("computation.taxPaid", 50_000, []),
    expect_("computation.refundOrPayable", 142_400, ["slab_rates", "cess_rate"]),
    expect_("itrForm.recommendedItrType", "ITR-1", ["itr1_income_ceiling"]),
  ],
});

// ---------------------------------------------------------------------------
// 13. House property (K4-06) — self-occupied, home-loan interest present.
//     Proves the regime split: OLD regime allows the ₹2,00,000-capped
//     self-occupied interest (a loss under the head), NEW regime disallows
//     it entirely (Section 115BAC) — and that the NEW regime is still
//     recommended here (its wider 87A rebate outweighs losing the interest
//     deduction). Expected values READ OFF the engine's own current
//     behaviour (see this file's own header) via a direct computeTax() run
//     against this exact input, not hand-derived from tax knowledge.
// ---------------------------------------------------------------------------

export const houseSelfOccupiedInterestFixture: SyntheticCaseFixture = makeSyntheticCaseFixture({
  id: "ay2026-27/house-property-self-occupied-interest",
  description:
    "Salaried taxpayer with one self-occupied property carrying ₹1,50,000 home-loan interest. Proves " +
    "the K4-06 regime split: OLD regime allows the (capped) Section 24(b) self-occupied interest " +
    "deduction, producing a ₹1,50,000 house-property loss; NEW regime disallows it entirely (Section " +
    "115BAC), producing ₹0. The NEW regime is still recommended (₹0 gross liability after the wider " +
    "87A rebate, vs ₹33,800 under the OLD regime).",
  statutory: CURRENT_AY_STATUTORY,
  caseMeta: AY_META,
  ledger: {
    ...EMPTY_LEDGER,
    income: [
      { id: "lab_inc_salary_hp", income_head: "salary", amount: 800_000, source_type: "Form16", source_document_id: "lab_doc_form16" },
    ],
    housePropertyEntries: [
      {
        id: "lab_hp_self_occupied",
        usage: "self_occupied",
        annual_rent_received: 0,
        municipal_taxes_paid: 0,
        home_loan_interest: 150_000,
        source_type: "manual",
      },
    ],
  },
  evidence: [
    fromDocument("income", "lab_inc_salary_hp", DOCS.form16),
    attested("house_property", "lab_hp_self_occupied"),
  ],
  // No proof document is attached for the home-loan interest claim —
  // deliberately, to exercise HOUSE_PROPERTY_INTEREST_PROOF_MISSING.
  expectedFindings: [
    finding("HOUSE_PROPERTY_INTEREST_PROOF_MISSING", "warning", "deductions"),
  ],
  expectations: [
    // GTI's single top-line figure uses the OLD-regime house-property
    // treatment (compute-tax.ts's own documented choice): 800,000 salary +
    // (-150,000) house property = 650,000.
    expect_("computation.grossTotalIncome", 650_000, ["house_property_computation"]),
    expect_("computation.deductionsAllowed", 75_000, ["standard_deduction"]),
    // Recommended (new) regime: 800,000 - 75,000 std deduction + 0 house
    // property = 725,000.
    expect_("computation.totalIncome", 725_000, ["standard_deduction", "house_property_computation"]),
    // New regime: 725,000 taxable, slab tax 16,250 fully offset by the 87A
    // rebate (total income ≤ ₹12,00,000 ceiling) → 0 + 0 cess = 0.
    expect_("computation.newRegimeTax", 0, ["slab_rates", "rebate_87a", "cess_rate", "house_property_computation"]),
    // Old regime: 800,000 - 50,000 std deduction - 150,000 house-property
    // loss = 600,000 taxable. Slab tax 32,500; total income > ₹5,00,000 87A
    // ceiling, no rebate; +4% cess 1,300 = 33,800.
    expect_("computation.oldRegimeTax", 33_800, ["slab_rates", "cess_rate", "house_property_computation"]),
    expect_("computation.recommendedRegime", "new", ["slab_rates", "house_property_computation"]),
    expect_("computation.rebate", 16_250, ["rebate_87a", "slab_rates"]),
    expect_("computation.cess", 0, ["cess_rate"]),
    expect_("computation.grossTaxLiability", 0, ["slab_rates", "rebate_87a", "cess_rate", "house_property_computation"]),
    expect_("computation.taxPaid", 0, []),
    expect_("computation.refundOrPayable", 0, ["slab_rates", "rebate_87a", "cess_rate", "house_property_computation"]),
    // No blockers (no capital gains, foreign assets, business income, or
    // house-property LOSS under the recommended new regime) — ITR-1 stands.
    expect_("itrForm.recommendedItrType", "ITR-1", ["itr1_income_ceiling"]),
  ],
});

// ---------------------------------------------------------------------------
// 14. Presumptive professional income (44ADA, K4-07). ITR-1 deliberately
//     selected to exercise BOTH the ITR-4 blocker and the deemed-profit
//     disclosure in one fixture. Proves: deemed profit = 50% of gross
//     receipts flows into BOTH regimes identically (regime-independent),
//     the aggregate stays within the ₹50L conservative ceiling (no
//     `receipts_via_banking_channels` confirmed), and the recommender
//     positively resolves ITR-4 (Sugam) — the only blocker present is the
//     44ADA one itself, no capital gains/foreign assets/other business
//     income/house-property loss. Expected values READ OFF the engine's
//     own current behaviour (see this file's own header), not hand-derived
//     from tax knowledge.
// ---------------------------------------------------------------------------

export const presumptive44adaFixture: SyntheticCaseFixture = makeSyntheticCaseFixture({
  id: "ay2026-27/presumptive-professional-44ada",
  description:
    "Salaried taxpayer with ₹8,00,000 gross professional receipts declared under Section 44ADA " +
    "(ITR-1 deliberately selected). Proves the 50% deemed-profit computation (K4-07), that it is " +
    "identical under both regimes, that the aggregate stays within the conservative ₹50L ceiling " +
    "(no digital-receipts confirmation given), and that the recommender resolves ITR-4 (Sugam) — " +
    "the sole blocker being the presumptive income itself.",
  statutory: CURRENT_AY_STATUTORY,
  caseMeta: { ...AY_META, selectedItrType: "ITR-1" },
  ledger: {
    ...EMPTY_LEDGER,
    income: [
      { id: "lab_inc_salary_44ada", income_head: "salary", amount: 500_000, source_type: "Form16", source_document_id: "lab_doc_form16" },
      { id: "lab_inc_presumptive_44ada", income_head: "presumptive_professional_44ada", amount: 800_000, source_type: "manual", presumptive_activity_type: "specified_profession_44aa_1" },
    ],
  },
  evidence: [
    fromDocument("income", "lab_inc_salary_44ada", DOCS.form16),
    attested("income", "lab_inc_presumptive_44ada"),
  ],
  expectedFindings: [
    finding("PRESUMPTIVE_44ADA_REQUIRES_ITR4", "blocker", "itr_form"),
    finding("PRESUMPTIVE_44ADA_DEEMED_PROFIT_APPLIED", "info", "deductions"),
  ],
  expectations: [
    // 500,000 salary + 0 house property (old-regime reference) + 400,000
    // deemed profit (50% of ₹8,00,000 gross receipts) = 900,000.
    expect_("computation.grossTotalIncome", 900_000, ["presumptive_44ada_computation"]),
    expect_("computation.deductionsAllowed", 75_000, ["standard_deduction"]),
    // New regime (recommended): 500,000 - 75,000 std + 400,000 deemed profit = 825,000.
    expect_("computation.totalIncome", 825_000, ["standard_deduction", "presumptive_44ada_computation"]),
    // New regime slab tax: 400k-800k@5%=20,000 + 800k-825k@10%=2,500 = 22,500;
    // total income 825,000 <= ₹12,00,000 ceiling → rebate = min(22,500, 60,000) = 22,500 → 0 tax.
    expect_("computation.newRegimeTax", 0, ["slab_rates", "rebate_87a", "cess_rate", "presumptive_44ada_computation"]),
    // Old regime: 500,000 - 50,000 std + 400,000 deemed profit = 850,000 taxable.
    // Slab tax: 250k-500k@5%=12,500 + 500k-850k@20%=70,000 = 82,500; total income
    // 850,000 > ₹5,00,000 old-regime 87A ceiling, no rebate; +4% cess 3,300 = 85,800.
    expect_("computation.oldRegimeTax", 85_800, ["slab_rates", "chapter_via_deduction_caps", "cess_rate", "presumptive_44ada_computation"]),
    expect_("computation.recommendedRegime", "new", ["slab_rates", "rebate_87a"]),
    expect_("computation.rebate", 22_500, ["rebate_87a", "slab_rates"]),
    expect_("computation.cess", 0, ["cess_rate"]),
    expect_("computation.grossTaxLiability", 0, ["slab_rates", "rebate_87a", "cess_rate", "presumptive_44ada_computation"]),
    expect_("computation.taxPaid", 0, []),
    expect_("computation.refundOrPayable", 0, ["slab_rates", "rebate_87a", "cess_rate", "presumptive_44ada_computation"]),
    // The ONLY ITR-1 blocker is the presumptive income itself (no capital
    // gains, foreign assets, business income, or house-property loss) —
    // resolves positively to ITR-4 (Sugam), not the conservative ITR-2 fallback.
    expect_("itrForm.recommendedItrType", "ITR-4", ["itr1_income_ceiling", "presumptive_44ada_computation"]),
  ],
});

// ---------------------------------------------------------------------------
// 15. Presumptive BUSINESS income (44AD, K4-08). ITR-1 deliberately selected
//     to exercise BOTH the ITR-4 blocker and the deemed-profit disclosure in
//     one fixture, mirroring fixture 14. Proves what makes 44AD structurally
//     DIFFERENT from 44ADA: two deemed rates applied to two PORTIONS of
//     turnover (6% digital + 8% cash), not one rate on the whole. Also proves
//     the 5%-cash eligibility test is DERIVED from the declared split —
//     ₹1,00,000 cash of ₹41,00,000 total is 2.44%, at or below 5%, so the
//     enhanced ₹3cr ceiling applies and the aggregate is comfortably within
//     it. Turnover stays below the ordinary ₹2cr ceiling, so the
//     ENHANCED_CEILING_UNVERIFIED blocker deliberately does NOT fire here
//     (it is exercised by its own unit test) — this fixture pins the clean
//     path. Expected values READ OFF the engine's own current behaviour (see
//     this file's own header), not hand-derived from tax knowledge.
// ---------------------------------------------------------------------------

export const presumptive44adFixture: SyntheticCaseFixture = makeSyntheticCaseFixture({
  id: "ay2026-27/presumptive-business-44ad",
  description:
    "Salaried taxpayer also running a small business declared under Section 44AD: ₹40,00,000 turnover " +
    "received through banking channels plus ₹1,00,000 in cash (ITR-1 deliberately selected). Proves the " +
    "DUAL-rate deemed-profit computation (K4-08 — 6% on the digital portion, 8% on the cash portion, " +
    "unlike 44ADA's single rate on the whole), that it is identical under both regimes, that the derived " +
    "2.44% cash share admits the enhanced ₹3,00,00,000 ceiling, and that the recommender resolves " +
    "ITR-4 (Sugam) — the sole blocker being the presumptive income itself.",
  statutory: CURRENT_AY_STATUTORY,
  caseMeta: { ...AY_META, selectedItrType: "ITR-1" },
  ledger: {
    ...EMPTY_LEDGER,
    income: [
      { id: "lab_inc_salary_44ad", income_head: "salary", amount: 500_000, source_type: "Form16", source_document_id: "lab_doc_form16" },
      { id: "lab_inc_44ad_digital", income_head: "presumptive_business_44ad_digital", amount: 4_000_000, source_type: "manual", presumptive_activity_type: "other_business" },
      { id: "lab_inc_44ad_cash", income_head: "presumptive_business_44ad_cash", amount: 100_000, source_type: "manual", presumptive_activity_type: "other_business" },
    ],
  },
  evidence: [
    fromDocument("income", "lab_inc_salary_44ad", DOCS.form16),
    attested("income", "lab_inc_44ad_digital"),
    attested("income", "lab_inc_44ad_cash"),
  ],
  expectedFindings: [
    finding("PRESUMPTIVE_44AD_REQUIRES_ITR4", "blocker", "itr_form"),
    finding("PRESUMPTIVE_44AD_DEEMED_PROFIT_APPLIED", "info", "deductions"),
  ],
  expectations: [
    // 500,000 salary + 0 house property (old-regime reference) + deemed profit
    // of 6% x 4,000,000 = 240,000 plus 8% x 100,000 = 8,000, i.e. 248,000
    // → 748,000. Note this is NOT 6% of the whole 4,100,000 (246,000) nor 8%
    // of it (328,000): the two portions carry their own rates.
    expect_("computation.grossTotalIncome", 748_000, ["presumptive_44ad_computation"]),
    expect_("computation.deductionsAllowed", 75_000, ["standard_deduction"]),
    // New regime (recommended): 500,000 - 75,000 std + 248,000 = 673,000.
    expect_("computation.totalIncome", 673_000, ["standard_deduction", "presumptive_44ad_computation"]),
    // New regime slab tax: 400k-673k@5% = 13,650; total income 673,000 <=
    // ₹12,00,000 ceiling → rebate = min(13,650, 60,000) = 13,650 → 0 tax.
    expect_("computation.newRegimeTax", 0, ["slab_rates", "rebate_87a", "cess_rate", "presumptive_44ad_computation"]),
    // Old regime: 500,000 - 50,000 std + 248,000 = 698,000 taxable.
    // Slab tax: 250k-500k@5% = 12,500 + 500k-698k@20% = 39,600 → 52,100;
    // total income 698,000 > ₹5,00,000 old-regime 87A ceiling, no rebate;
    // +4% cess 2,084 = 54,184.
    expect_("computation.oldRegimeTax", 54_184, ["slab_rates", "chapter_via_deduction_caps", "cess_rate", "presumptive_44ad_computation"]),
    expect_("computation.recommendedRegime", "new", ["slab_rates", "rebate_87a"]),
    expect_("computation.rebate", 13_650, ["rebate_87a", "slab_rates"]),
    expect_("computation.cess", 0, ["cess_rate"]),
    expect_("computation.grossTaxLiability", 0, ["slab_rates", "rebate_87a", "cess_rate", "presumptive_44ad_computation"]),
    expect_("computation.taxPaid", 0, []),
    expect_("computation.refundOrPayable", 0, ["slab_rates", "rebate_87a", "cess_rate", "presumptive_44ad_computation"]),
    // The ONLY ITR-1 blocker is the presumptive income itself — resolves
    // positively to ITR-4 (Sugam), not the conservative ITR-2 fallback.
    expect_("itrForm.recommendedItrType", "ITR-4", ["itr1_income_ceiling", "presumptive_44ad_computation"]),
  ],
});

// ---------------------------------------------------------------------------
// 16b. Books-based business income, Sections 28/29 (K4-14)
// ---------------------------------------------------------------------------

/**
 * K4-14 — the BOOKS-based counterpart to the two presumptive fixtures above.
 * Deliberately built INSIDE the only window the adapter admits:
 *
 *   - the preparer declares `none_s30_43d`, so no Sections 30-43D adjustment is
 *     owed and the declared subtraction is the taxable figure;
 *   - turnover ₹30,00,000 sits well below the Section 44AB(a) ₹1,00,00,000
 *     audit threshold;
 *   - revenue exceeds expenses, so no business loss arises (set-off and
 *     carry-forward under Sections 70/71/72 are unimplemented);
 *   - exactly ONE business. K4-15 removed that as a REQUIREMENT — several are
 *     now aggregated — but this fixture deliberately keeps one, so the
 *     single-business path stays pinned independently of the aggregate.
 *     `businessBooksMultiFixture` below pins the aggregate against it.
 *
 * Every one of those boundaries is the subject of its own refusal code and is
 * covered by unit tests rather than by a seeded fixture — a REFUSED case
 * produces no computation to pin, which is the point of refusing it.
 *
 * ITR-1 is deliberately selected so the case exercises all three new findings
 * and the positive ITR-3 resolution at once (the same trick the 44ADA and 44AD
 * fixtures use for ITR-4). Arithmetic, hand-derived against `slabs.ts` and then
 * confirmed against the engine — never read off it alone:
 *   GTI  = 5,00,000 salary + (30,00,000 - 24,00,000) = 11,00,000.
 *   New  = 5,00,000 - 75,000 std + 6,00,000 = 10,25,000 taxable;
 *          4-8L @5% = 20,000 + 8-10.25L @10% = 22,500 → 42,500;
 *          10,25,000 <= 12,00,000 so the full 87A rebate applies → nil tax.
 *   Old  = 5,00,000 - 50,000 std + 6,00,000 = 10,50,000 taxable;
 *          2.5-5L @5% = 12,500 + 5-10L @20% = 1,00,000 + 10-10.5L @30% = 15,000
 *          → 1,27,500; no 87A rebate above ₹5,00,000; +4% cess 5,100 = 1,32,600.
 * Both figures sit clear of BOTH marginal-relief bands and of surcharge, so
 * this fixture pins the books computation and nothing else.
 */
export const businessBooksFixture: SyntheticCaseFixture = makeSyntheticCaseFixture({
  id: "ay2026-27/business-books-net-profit",
  description:
    "Salaried taxpayer also running a small trading business kept on books rather than declared " +
    "presumptively: ₹30,00,000 revenue against ₹24,00,000 expenses, with the preparer declaring that no " +
    "Sections 30-43D adjustment arises (ITR-1 deliberately selected). Proves the K4-14 books computation " +
    "— net profit taken as declared revenue minus declared expenses, identical under both regimes — that " +
    "turnover below the Section 44AB(a) threshold is admitted, and that the recommender resolves ITR-3 " +
    "rather than the ITR-4 the presumptive fixtures resolve to.",
  statutory: CURRENT_AY_STATUTORY,
  caseMeta: { ...AY_META, selectedItrType: "ITR-1" },
  ledger: {
    ...EMPTY_LEDGER,
    income: [
      { id: "lab_inc_salary_books", income_head: "salary", amount: 500_000, source_type: "Form16", source_document_id: "lab_doc_form16" },
    ],
    businessBooksEntries: [
      {
        id: "lab_books_trading",
        revenue: 3_000_000,
        expenses: 2_400_000,
        is_profession: false,
        adjustments: "none_s30_43d",
        activity_classification: "ordinary_business_or_profession",
        source_type: "manual",
      },
    ],
  },
  evidence: [
    fromDocument("income", "lab_inc_salary_books", DOCS.form16),
    attested("business_books", "lab_books_trading"),
  ],
  expectedFindings: [
    finding("BUSINESS_BOOKS_REQUIRES_ITR3", "blocker", "itr_form"),
    finding("BUSINESS_BOOKS_NET_PROFIT_APPLIED", "info", "deductions"),
    finding("BUSINESS_INCOME_REGIME_OPTION_10IEA", "info", "itr_form"),
  ],
  expectations: [
    expect_("computation.grossTotalIncome", 1_100_000, ["business_books_computation"]),
    expect_("computation.deductionsAllowed", 75_000, ["standard_deduction"]),
    expect_("computation.totalIncome", 1_025_000, ["standard_deduction", "business_books_computation"]),
    expect_("computation.newRegimeTax", 0, ["slab_rates", "rebate_87a", "cess_rate", "business_books_computation"]),
    expect_("computation.oldRegimeTax", 132_600, ["slab_rates", "chapter_via_deduction_caps", "cess_rate", "business_books_computation"]),
    expect_("computation.recommendedRegime", "new", ["slab_rates", "rebate_87a"]),
    expect_("computation.rebate", 42_500, ["rebate_87a", "slab_rates"]),
    expect_("computation.cess", 0, ["cess_rate"]),
    expect_("computation.grossTaxLiability", 0, ["slab_rates", "rebate_87a", "cess_rate", "business_books_computation"]),
    expect_("computation.taxPaid", 0, []),
    expect_("computation.refundOrPayable", 0, ["slab_rates", "rebate_87a", "cess_rate", "business_books_computation"]),
    // Resolves POSITIVELY to ITR-3, not to the conservative ITR-2 fallback the
    // uncomputed `business_income` placeholder still routes to: books-based
    // business income has exactly one permissible form.
    expect_("itrForm.recommendedItrType", "ITR-3", ["itr1_income_ceiling", "presumptive_44ada_computation"]),
  ],
});

// ---------------------------------------------------------------------------
// 16c. TWO books-based businesses aggregated under one head (K4-15)
// ---------------------------------------------------------------------------

/**
 * K4-15 — the aggregate counterpart to `businessBooksFixture`.
 *
 * The arithmetic is deliberately IDENTICAL to that fixture's, the same device
 * `broughtForwardCapitalLossFixture` uses against the within-year one. There,
 * ₹6,00,000 of books profit arises from ONE business (₹30,00,000 - ₹24,00,000);
 * here the SAME ₹6,00,000 arises from TWO — a business at
 * ₹18,00,000 - ₹14,00,000 = ₹4,00,000 and a profession at
 * ₹12,00,000 - ₹10,00,000 = ₹2,00,000. Every expected figure below is
 * therefore the one `K4-14` already hand-derived and verified, unchanged.
 *
 * That equality IS the property being pinned. Section 28(i) charges the head on
 * "the profits and gains of any business or profession which was carried on",
 * so how the same total profit is split across businesses must not move the
 * tax. If a future change makes these two fixtures disagree, the aggregation is
 * wrong — and the test reports it as a difference from an independently
 * established result rather than from fresh arithmetic.
 *
 * It also exercises BOTH Section 44AB limbs at once: ₹18,00,000 against the
 * 44AB(a) ₹1,00,00,000 business threshold, and ₹12,00,000 against the 44AB(b)
 * ₹50,00,000 profession threshold, each tested on its own limb's sum. The case
 * where pooling the two limbs WOULD change the verdict is a refusal, so it has
 * no computation to pin and is covered by unit tests instead.
 */
export const businessBooksMultiFixture: SyntheticCaseFixture = makeSyntheticCaseFixture({
  id: "ay2026-27/business-books-aggregated",
  description:
    "The same salaried taxpayer as the single-business books fixture, but running TWO undertakings kept " +
    "on books — a trading business (₹18,00,000 revenue against ₹14,00,000 expenses) and a consultancy " +
    "profession (₹12,00,000 against ₹10,00,000) — each declaring that no Sections 30-43D adjustment " +
    "arises. Proves the K4-15 Section 28 aggregate: the same ₹6,00,000 of books profit produces the " +
    "same tax whether it arises in one undertaking or two, and each Section 44AB limb is tested on its " +
    "own sum.",
  statutory: CURRENT_AY_STATUTORY,
  caseMeta: { ...AY_META, selectedItrType: "ITR-1" },
  ledger: {
    ...EMPTY_LEDGER,
    income: [
      { id: "lab_inc_salary_books2", income_head: "salary", amount: 500_000, source_type: "Form16", source_document_id: "lab_doc_form16" },
    ],
    businessBooksEntries: [
      {
        id: "lab_books_trading_a",
        revenue: 1_800_000,
        expenses: 1_400_000,
        is_profession: false,
        adjustments: "none_s30_43d",
        activity_classification: "ordinary_business_or_profession",
        source_type: "manual",
      },
      {
        id: "lab_books_consultancy_b",
        revenue: 1_200_000,
        expenses: 1_000_000,
        is_profession: true,
        adjustments: "none_s30_43d",
        activity_classification: "ordinary_business_or_profession",
        source_type: "manual",
      },
    ],
  },
  evidence: [
    fromDocument("income", "lab_inc_salary_books2", DOCS.form16),
    attested("business_books", "lab_books_trading_a"),
    attested("business_books", "lab_books_consultancy_b"),
  ],
  // One set of findings for the HEAD, not one per record.
  expectedFindings: [
    finding("BUSINESS_BOOKS_REQUIRES_ITR3", "blocker", "itr_form"),
    finding("BUSINESS_BOOKS_NET_PROFIT_APPLIED", "info", "deductions"),
    finding("BUSINESS_INCOME_REGIME_OPTION_10IEA", "info", "itr_form"),
  ],
  expectations: [
    expect_("computation.grossTotalIncome", 1_100_000, ["business_books_computation"]),
    expect_("computation.deductionsAllowed", 75_000, ["standard_deduction"]),
    expect_("computation.totalIncome", 1_025_000, ["standard_deduction", "business_books_computation"]),
    expect_("computation.newRegimeTax", 0, ["slab_rates", "rebate_87a", "cess_rate", "business_books_computation"]),
    expect_("computation.oldRegimeTax", 132_600, ["slab_rates", "chapter_via_deduction_caps", "cess_rate", "business_books_computation"]),
    expect_("computation.recommendedRegime", "new", ["slab_rates", "rebate_87a"]),
    expect_("computation.rebate", 42_500, ["rebate_87a", "slab_rates"]),
    expect_("computation.cess", 0, ["cess_rate"]),
    expect_("computation.grossTaxLiability", 0, ["slab_rates", "rebate_87a", "cess_rate", "business_books_computation"]),
    expect_("computation.taxPaid", 0, []),
    expect_("computation.refundOrPayable", 0, ["slab_rates", "rebate_87a", "cess_rate", "business_books_computation"]),
    expect_("itrForm.recommendedItrType", "ITR-3", ["itr1_income_ceiling", "presumptive_44ada_computation"]),
  ],
});

/** Every seeded fixture, in declaration order. */

// ---------------------------------------------------------------------------
// 17. Brought-forward long-term capital loss set off under Section 74 (K4-10)
// ---------------------------------------------------------------------------

/**
 * K4-10 — the MULTI-YEAR half of loss set-off. Deliberately built INSIDE the
 * forced-allocation window the adapter admits:
 *
 *   - only a brought-forward LONG-TERM loss, which under Section 74(1)(b) has
 *     exactly ONE lawful destination, so no cross-type allocation choice can
 *     arise;
 *   - exactly ONE carry-forward record, so no intra-type consumption order can
 *     change which residual survives;
 *   - no taxpayer election, so the versioned `portal_default_ay2026_27` policy
 *     applies without any human allocation decision to review.
 *
 * The arithmetic is deliberately IDENTICAL to the within-year fixture's
 * (`capitalLossWithinYearSetOffFixture`): a Rs.5,00,000 section 112A gain
 * reduced by a Rs.2,00,000 loss. That is the point. The same net position
 * reached through Section 74 rather than Sections 70/71 must produce the SAME
 * tax, and the expected figures below are the ones `K4-09` already hand-derived
 * and verified — so this asserts the new pipeline stage against an
 * independently established result rather than against fresh arithmetic.
 *
 * What differs is the ROUTE and therefore the DISCLOSURES: the within-year
 * disclosure does not fire (there is no current-year loss), the brought-forward
 * one does, no residual is carried (the loss is fully absorbed), and no
 * staff-declared provenance warning appears because the loss comes out of a
 * finalized prior-year case.
 */
export const broughtForwardCapitalLossFixture: SyntheticCaseFixture = makeSyntheticCaseFixture({
  id: "ay2026-27/brought-forward-capital-loss-set-off",
  description:
    "Salary and FD interest alongside a section 112A long-term capital GAIN, plus a Rs.2,00,000 " +
    "long-term capital loss brought forward from AY 2022-23 whose loss return is recorded as filed " +
    "by the due date. Exercises the K4-10 Section 74 set-off inside the forced-allocation window: " +
    "the brought-forward loss reduces the surviving long-term gain before the Rs.1,25,000 exemption " +
    "and the 12.5% rate apply, and nothing remains to carry forward.",
  statutory: CURRENT_AY_STATUTORY,
  caseMeta: AY_META,
  ledger: {
    ...EMPTY_LEDGER,
    income: [
      { id: "lab_inc_salary", income_head: "salary", amount: 1_200_000, source_type: "Form16", source_document_id: "lab_doc_form16" },
      { id: "lab_inc_fd", income_head: "fd_interest", amount: 40_000, source_type: "bank_certificate", source_document_id: "lab_doc_bank" },
    ],
    taxPaid: [
      { id: "lab_tp_tds", tax_paid_type: "salary_tds", amount: 90_000, source_type: "Form16", source_document_id: "lab_doc_form16" },
    ],
    capitalGains: [
      {
        id: "lab_cg_ltcg_gain",
        gain_type: "ltcg_112a",
        sale_value: 900_000,
        cost: 400_000,
        expenses: 0,
        exemption_claimed: 0,
        taxable_gain: 500_000,
        source_type: "broker_report",
        source_document_id: "lab_doc_broker",
      },
    ],
    broughtForwardLosses: [
      {
        id: "lab_bf_ltcl_2022_23",
        originating_assessment_year: "2022-23",
        loss_type: "ltcl",
        amount: 200_000,
        // Section 139(3)/80 CONFIRMED — not left at the conservative default,
        // because this fixture asserts the ADMITTED path. The refused paths
        // (unverified filing, expiry, elective allocation, diverging election)
        // are asserted by the unit tests, which is where a case that must NOT
        // compute belongs.
        filing_eligibility: "verified_timely",
        loss_provenance: "prior_finalized_case_in_system",
        elected_set_off_target: null,
        source_type: "prefilled_json",
        source_document_id: "lab_doc_prior_return",
      },
    ],
  },
  evidence: [
    fromDocument("income", "lab_inc_salary", DOCS.form16),
    fromDocument("income", "lab_inc_fd", DOCS.bank),
    fromDocument("tax_paid", "lab_tp_tds", DOCS.form16),
    fromDocument("capital_gain", "lab_cg_ltcg_gain", DOCS.broker),
    fromDocument("brought_forward_loss", "lab_bf_ltcl_2022_23", DOCS.priorReturn),
  ],
  expectedFindings: [
    finding("AIS_INTEREST_NOT_ENTERED", "warning", "reconciliation"),
    finding("CG_REQUIRES_ITR2", "blocker", "itr_form"),
    // The K4-10 disclosure. The K4-09 `CAPITAL_LOSS_SET_OFF_APPLIED` is
    // deliberately ABSENT: there is no current-year loss, and findings are
    // checked both ways, so this pins that the two disclosures are genuinely
    // distinct rather than one firing for the other's situation.
    finding("BROUGHT_FORWARD_LOSS_SET_OFF_APPLIED", "info", "deductions"),
  ],
  expectations: [
    // 1,200,000 salary + 40,000 FD + (500,000 - 200,000) net 112A = 1,540,000.
    expect_("computation.grossTotalIncome", 1_540_000, []),
    // NET of the BROUGHT-FORWARD set-off: 500,000 gain - 200,000 s.74 loss.
    expect_("computation.specialRateCapitalGains", 300_000, ["capital_gains_ltcg_112a", "capital_loss_brought_forward_set_off"]),
    // max(0, 300,000 - 125,000) x 12.5% = 21,875 — the Rs.1,25,000 threshold
    // applied to the income SURVIVING set-off, never to the gross 112A gain
    // (D93 Q1, reproduced by TAX-SAFE-02A as portal conformance, not statute).
    // Strictly less than the 46,875 the same gain attracts with the
    // brought-forward loss ignored: the assertion that s.74 actually ran.
    expect_("computation.specialRateTax", 21_875, ["capital_gains_ltcg_112a", "capital_loss_brought_forward_set_off"]),
    expect_("computation.recommendedRegime", "new", ["slab_rates", "rebate_87a"]),
    expect_("computation.rebate", 0, ["rebate_87a"]),
    expect_("computation.cess", 3_135, ["cess_rate"]),
    expect_("computation.grossTaxLiability", 81_510, ["slab_rates", "capital_gains_ltcg_112a", "capital_loss_brought_forward_set_off", "cess_rate"]),
    expect_("computation.taxPaid", 90_000, []),
    expect_("computation.refundOrPayable", -8_490, ["slab_rates", "capital_gains_ltcg_112a", "capital_loss_brought_forward_set_off", "cess_rate"]),
    expect_("itrForm.recommendedItrType", "ITR-2", ["itr1_income_ceiling"]),
  ],
});

// ---------------------------------------------------------------------------
// 18. Surcharge at the 10% tier, with marginal relief (K4-11)
// ---------------------------------------------------------------------------

/**
 * K4-11 — the FIRST fixture whose total income attracts surcharge at all.
 * Deliberately built inside the implemented window AND inside the exactly-
 * computable half of it:
 *
 *   - salary only, with NO special-rate 111A/112A gains, so the notional
 *     "total income of Rs.50,00,000" that marginal relief is measured against
 *     has exactly one lawful composition and the relief is computed EXACTLY
 *     rather than proved nil. The refused (ambiguous-reference) path and the
 *     above-ceiling path both belong in unit tests, which is where a case that
 *     must NOT produce a supported figure belongs;
 *   - total income under BOTH regimes lands in the 10% band and inside the
 *     marginal-relief zone, so relief is genuinely non-zero in both columns —
 *     a fixture where relief happened to be nil would pin nothing.
 *
 * Hand-derived, then checked against the engine (both agree):
 *
 *   NEW regime — taxable 52,00,000 - 75,000 std = 51,25,000; slab tax
 *   11,17,500; surcharge 10% = 1,11,750; reference tax on 50,00,000 =
 *   10,80,000 with NIL reference surcharge (the statute's Rs.50,00,000 limb
 *   carries no surcharge term); excess 1,25,000; relief = 11,17,500 + 1,11,750
 *   - (10,80,000 + 1,25,000) = 24,250; surcharge after relief 87,500. Tax plus
 *   surcharge is then exactly 12,05,000 = 10,80,000 + 1,25,000 — the cap
 *   binding exactly, which is what marginal relief means. Cess 4% = 48,200;
 *   gross liability 12,53,200.
 *
 *   OLD regime — taxable 51,50,000; slab tax 13,57,500; surcharge 1,35,750;
 *   reference tax on 50,00,000 = 13,12,500; excess 1,50,000; relief 30,750;
 *   surcharge after relief 1,05,000; cess 58,500; gross liability 15,21,000.
 *
 * The new regime is recommended, as it is for every salary-only case at this
 * income. TDS is set above the liability so the outcome is a clean refund and
 * no payment-related finding is added on top of the surcharge behaviour under
 * test.
 */
export const surchargeMarginalReliefFixture: SyntheticCaseFixture = makeSyntheticCaseFixture({
  id: "ay2026-27/surcharge-marginal-relief",
  description:
    "Salary of Rs.52,00,000 with no other income, no deductions and no capital gains — total " +
    "income crosses the Rs.50,00,000 surcharge entry threshold under BOTH regimes and lands in " +
    "the 10% band. Exercises the K4-11 surcharge computation and the marginal relief that caps " +
    "tax-plus-surcharge at (tax on Rs.50,00,000) + (income exceeding it), and pins that cess " +
    "follows the RELIEVED surcharge rather than the gross one.",
  statutory: CURRENT_AY_STATUTORY,
  caseMeta: AY_META,
  ledger: {
    ...EMPTY_LEDGER,
    income: [
      { id: "lab_inc_salary", income_head: "salary", amount: 5_200_000, source_type: "Form16", source_document_id: "lab_doc_form16" },
    ],
    taxPaid: [
      { id: "lab_tp_tds", tax_paid_type: "salary_tds", amount: 1_300_000, source_type: "Form16", source_document_id: "lab_doc_form16" },
    ],
  },
  evidence: [
    fromDocument("income", "lab_inc_salary", DOCS.form16),
    fromDocument("tax_paid", "lab_tp_tds", DOCS.form16),
  ],
  expectations: [
    expect_("computation.grossTotalIncome", 5_200_000, []),
    expect_("computation.deductionsAllowed", 75_000, ["standard_deduction"]),
    expect_("computation.totalIncome", 5_125_000, ["standard_deduction"]),
    // The whole point of the fixture: both columns carry a real, relieved
    // surcharge. Pinned as the two regime totals so a change to either the
    // rate or the relief moves a checked number.
    expect_("computation.newRegimeTax", 1_253_200, ["slab_rates", "surcharge_rates", "surcharge_marginal_relief", "cess_rate"]),
    expect_("computation.oldRegimeTax", 1_521_000, ["slab_rates", "surcharge_rates", "surcharge_marginal_relief", "cess_rate", "chapter_via_deduction_caps"]),
    expect_("computation.recommendedRegime", "new", ["slab_rates", "rebate_87a"]),
    expect_("computation.rebate", 0, ["rebate_87a"]),
    // 4% x (11,17,500 slab tax + 87,500 RELIEVED surcharge) = 48,200. With the
    // gross 1,11,750 surcharge it would be 49,170 — so this number is itself
    // the assertion that relief lands before cess, not after it.
    expect_("computation.cess", 48_200, ["cess_rate"]),
    expect_("computation.grossTaxLiability", 1_253_200, ["slab_rates", "surcharge_rates", "surcharge_marginal_relief", "cess_rate"]),
    expect_("computation.taxPaid", 1_300_000, []),
    expect_("computation.refundOrPayable", -46_800, ["slab_rates", "surcharge_rates", "surcharge_marginal_relief", "cess_rate"]),
    // Total income is far above the ITR-1 ceiling.
    expect_("itrForm.recommendedItrType", "ITR-2", ["itr1_income_ceiling"]),
  ],
});

/**
 * K4-12 — Section 87A marginal relief at the REBATE threshold. A genuinely
 * separate relief from the one `surchargeMarginalReliefFixture` above
 * exercises, operating ~Rs.37,00,000 lower and on a far more common
 * population.
 *
 * Hand-derived, then checked against the engine (both agree):
 *
 *   NEW regime — taxable 12,95,000 - 75,000 std = 12,20,000; slab tax
 *   0 + 20,000 (4-8L @5%) + 40,000 (8-12L @10%) + 3,000 (12-12.2L @15%) =
 *   63,000. Total income exceeds the Rs.12,00,000 ceiling by 20,000, and the
 *   tax on it (63,000) exceeds that excess, so clause (b) gives a deduction of
 *   63,000 - 20,000 = 43,000. Income-tax after the rebate is therefore exactly
 *   20,000 — the excess itself, which is what this relief MEANS. Cess 4% =
 *   800; gross liability 20,800.
 *
 *   OLD regime — taxable 12,45,000; slab tax 12,500 + 1,00,000 + 73,500 =
 *   1,86,000; NO rebate and NO relief (12,45,000 is above the Rs.5,00,000
 *   ceiling, and clause (b) does not reach the old regime at all); cess 7,440;
 *   gross liability 1,93,440.
 *
 * The gap between the two columns here is enormous precisely because the
 * relief exists on one side and not the other — so this fixture also pins the
 * regime asymmetry, not just the arithmetic. TDS is set above the new-regime
 * liability so the outcome is a clean refund.
 */
export const rebateMarginalReliefFixture: SyntheticCaseFixture = makeSyntheticCaseFixture({
  id: "ay2026-27/rebate-marginal-relief",
  description:
    "Salary of Rs.12,95,000 with no other income, no deductions and no capital gains — new-regime " +
    "total income lands just above the Rs.12,00,000 section 87A rebate ceiling, inside the narrow " +
    "band where clause (b) marginal relief is due. Exercises the K4-12 rebate-threshold relief, " +
    "pins that income-tax after the rebate equals exactly the income exceeding the ceiling, and " +
    "pins that the OLD regime gets no such relief.",
  statutory: CURRENT_AY_STATUTORY,
  caseMeta: AY_META,
  ledger: {
    ...EMPTY_LEDGER,
    income: [
      { id: "lab_inc_salary", income_head: "salary", amount: 1_295_000, source_type: "Form16", source_document_id: "lab_doc_form16" },
    ],
    taxPaid: [
      { id: "lab_tp_tds", tax_paid_type: "salary_tds", amount: 25_000, source_type: "Form16", source_document_id: "lab_doc_form16" },
    ],
  },
  evidence: [
    fromDocument("income", "lab_inc_salary", DOCS.form16),
    fromDocument("tax_paid", "lab_tp_tds", DOCS.form16),
  ],
  expectations: [
    expect_("computation.grossTotalIncome", 1_295_000, []),
    expect_("computation.deductionsAllowed", 75_000, ["standard_deduction"]),
    expect_("computation.totalIncome", 1_220_000, ["standard_deduction"]),
    // THE assertion: a non-zero 87A deduction ABOVE the Rs.12,00,000 ceiling.
    // Before K4-12 this figure was 0 for any income above the ceiling.
    expect_("computation.rebate", 43_000, ["rebate_87a", "rebate_87a_marginal_relief"]),
    expect_("computation.newRegimeTax", 20_800, ["slab_rates", "rebate_87a", "rebate_87a_marginal_relief", "cess_rate"]),
    // The old column carries NO relief — the ceiling there is a cliff.
    expect_("computation.oldRegimeTax", 193_440, ["slab_rates", "rebate_87a", "cess_rate", "chapter_via_deduction_caps"]),
    expect_("computation.recommendedRegime", "new", ["slab_rates", "rebate_87a", "rebate_87a_marginal_relief"]),
    // 4% x 20,000 relieved income-tax = 800. Against the unrelieved 63,000 it
    // would be 2,520 — so this number is itself the assertion that the relief
    // lands before cess.
    expect_("computation.cess", 800, ["cess_rate"]),
    expect_("computation.grossTaxLiability", 20_800, ["slab_rates", "rebate_87a", "rebate_87a_marginal_relief", "cess_rate"]),
    expect_("computation.taxPaid", 25_000, []),
    expect_("computation.refundOrPayable", -4_200, ["slab_rates", "rebate_87a", "rebate_87a_marginal_relief", "cess_rate"]),
    expect_("itrForm.recommendedItrType", "ITR-1", ["itr1_income_ceiling"]),
  ],
});

export const houseSaleStcgFixture: SyntheticCaseFixture = makeSyntheticCaseFixture({
  id: "ay2026-27/house-sale-stcg",
  description:
    "K4-21: a purchase of a building transferred in FY 2025-26 after being held less than " +
    "twenty-four months. House-sale STCG is slab-rate income (s.45/s.48), not s.111A. " +
    "Long-term house sales refuse this year.",
  statutory: CURRENT_AY_STATUTORY,
  caseMeta: { ...AY_META, selectedItrType: "ITR-2" },
  ledger: {
    ...EMPTY_LEDGER,
    capitalGains: [
      {
        id: "lab_cg_house",
        gain_type: "house_sale",
        sale_value: 80_00_000,
        cost: 50_00_000,
        expenses: 1_00_000,
        exemption_claimed: 0,
        taxable_gain: 29_00_000,
        source_type: "manual",
        transfer_date: "2025-12-01",
        acquisition_date: "2025-01-15",
        stamp_duty_value: 80_00_000,
        asset_kind: "building",
        acquisition_mode: "purchase",
        cost_of_improvement: 0,
        house_sale_declarations: [
          "not_agricultural_land",
          "not_depreciable_asset",
          "interest_not_in_cost",
          "agreement_and_registration_same_date",
        ],
      },
    ],
  },
  evidence: [attested("capital_gain", "lab_cg_house")],
  expectedFindings: [finding("TAX_PAYABLE_NO_CHALLAN", "warning", "payments")],
  expectations: [
    expect_("computation.grossTotalIncome", 29_00_000, ["capital_gains_house_sale"]),
    expect_("computation.totalIncome", 29_00_000, ["capital_gains_house_sale", "slab_rates"]),
    expect_("computation.newRegimeTax", 4_68_000, ["slab_rates", "capital_gains_house_sale", "cess_rate"]),
    expect_("computation.cess", 18_000, ["cess_rate"]),
    expect_("computation.grossTaxLiability", 4_68_000, ["slab_rates", "capital_gains_house_sale", "cess_rate"]),
    expect_("itrForm.recommendedItrType", "ITR-2", ["itr1_income_ceiling"]),
  ],
});

export const SEEDED_CASE_FIXTURES: readonly SyntheticCaseFixture[] = Object.freeze([
  salariedRefundFixture,
  salaryCapitalGainsFixture,
  salariedPayableFixture,
  unsupportedFactsFixture,
  unboundStatutoryWorldFixture,
  unacceptedEvidenceFixture,
  reconciliationFindingFixture,
  seniorOldRegimeBasicExemptionFixture,
  seniorDeductionCapsFixture,
  belowSixty80ttbExclusionFixture,
  seniorAdvanceTaxExemptionFixture,
  seniorParentsDeductionCapFixture,
  houseSelfOccupiedInterestFixture,
  presumptive44adaFixture,
  presumptive44adFixture,
  businessBooksFixture,
  businessBooksMultiFixture,
  capitalLossWithinYearSetOffFixture,
  broughtForwardCapitalLossFixture,
  surchargeMarginalReliefFixture,
  rebateMarginalReliefFixture,
  houseSaleStcgFixture,
]);
