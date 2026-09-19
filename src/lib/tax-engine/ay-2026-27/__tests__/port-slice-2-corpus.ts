/**
 * `K4-PORT-03` — the BYTE-IDENTITY CORPUS for the port's slice 2.
 *
 * NOT a test file (the Vitest `include` glob is `src/**\/*.test.{ts,tsx}`, so
 * this module is only ever imported by one). It is the input half of the
 * acceptance criterion `D309` sets: slice 2 threads the six statutory rate
 * parameters through the arithmetic, and its acceptance is **byte-identical
 * output**, not a green suite.
 *
 * The corpus exists because the three exported `fixtures.ts` cases — which
 * `K3-11` used to prove the pack indirection was output-preserving — exercise
 * exactly one slab table, no surcharge band, no marginal relief of either kind,
 * and no ITR-1 ceiling breach. Proving byte-identity over them would prove
 * almost nothing about a change that moves precisely those figures' supply
 * route.
 *
 * SO EVERY CASE HERE EARNS ITS PLACE AGAINST ONE OF THE SIX PARAMETERS, and the
 * `coversParameters` field says which. `port-slice-2-golden.test.ts` asserts
 * that every one of the six is covered by at least one case, so a parameter
 * cannot be threaded without a case that would have noticed it moving.
 *
 * These are synthetic, illustrative preparation-only inputs. No real client
 * data, no PAN/Aadhaar-shaped value.
 */

import type { RateParameterId } from "@/lib/tax-engine/core/statutory-rate-parameters";
import type {
  BroughtForwardLossEntry,
  BusinessBooksEntry,
  CapitalGainEntry,
  DeductionEntry,
  HousePropertyEntry,
  IncomeEntry,
  TaxEngineInput,
  TaxpayerProfile,
} from "../types";

const AY = "2026-27";
const FY = "2025-26";

export interface GoldenCase {
  readonly name: string;
  /** Which of the six rate parameters this case is here to hold still. */
  readonly coversParameters: readonly RateParameterId[];
  /** One line on what makes it interesting — read this before deleting a case. */
  readonly why: string;
  readonly input: TaxEngineInput;
}

interface CaseSpec {
  readonly taxpayer?: TaxpayerProfile;
  readonly salary?: number;
  readonly fdInterest?: number;
  readonly dividend?: number;
  readonly stcg111a?: number;
  readonly ltcg112a?: number;
  readonly deductions?: readonly DeductionEntry[];
  readonly houseProperty?: readonly HousePropertyEntry[];
  readonly businessBooks?: readonly BusinessBooksEntry[];
  readonly broughtForward?: readonly BroughtForwardLossEntry[];
  readonly presumptive44ada?: number;
  readonly presumptive44adDigital?: number;
  readonly taxPaid?: number;
  readonly hasForeignAssets?: boolean;
}

const RESIDENT_BELOW_60: TaxpayerProfile = {
  residentStatus: "resident",
  ageCategory: "below_60",
};

function buildInput(spec: CaseSpec): TaxEngineInput {
  const income: IncomeEntry[] = [];
  if (spec.salary !== undefined) {
    income.push({ id: "inc_salary", category: "salary", amount: spec.salary, sourceType: "Form16", sourceDocumentId: "doc_form16" });
  }
  if (spec.fdInterest !== undefined) {
    income.push({ id: "inc_fd", category: "fd_interest", amount: spec.fdInterest, sourceType: "manual" });
  }
  if (spec.dividend !== undefined) {
    income.push({ id: "inc_div", category: "dividend", amount: spec.dividend, sourceType: "manual" });
  }
  if (spec.presumptive44ada !== undefined) {
    income.push({
      id: "inc_44ada",
      category: "presumptive_professional_44ada",
      amount: spec.presumptive44ada,
      sourceType: "manual",
    });
  }
  if (spec.presumptive44adDigital !== undefined) {
    income.push({
      id: "inc_44ad_digital",
      category: "presumptive_business_44ad_digital",
      amount: spec.presumptive44adDigital,
      sourceType: "manual",
    });
  }

  const capitalGains: CapitalGainEntry[] = [];
  if (spec.stcg111a !== undefined) {
    capitalGains.push({
      id: "cg_stcg",
      category: "stcg_111a",
      amount: spec.stcg111a,
      taxable_gain: spec.stcg111a,
      sourceType: "broker_report",
      source_document_id: "doc_broker",
    });
  }
  if (spec.ltcg112a !== undefined) {
    capitalGains.push({
      id: "cg_ltcg",
      category: "ltcg_112a",
      amount: spec.ltcg112a,
      taxable_gain: spec.ltcg112a,
      sourceType: "broker_report",
      source_document_id: "doc_broker",
    });
  }

  return {
    assessmentYear: AY,
    financialYear: FY,
    taxpayer: spec.taxpayer ?? RESIDENT_BELOW_60,
    selectedItrType: "ITR-1",
    clientApprovalStatus: "pending",
    filingStatus: "in_preparation",
    eVerificationStatus: "not_applicable",
    finalized: false,
    hasForeignAssets: spec.hasForeignAssets,
    requiredDocuments: [{ code: "form16", label: "Form 16", required: true, status: "received" }],
    income,
    taxPaid:
      spec.taxPaid === undefined
        ? []
        : [{ id: "tp_tds", category: "salary_tds", amount: spec.taxPaid, sourceType: "Form16", sourceDocumentId: "doc_form16" }],
    deductions: [...(spec.deductions ?? [])],
    capitalGains,
    housePropertyEntries: spec.houseProperty === undefined ? undefined : [...spec.houseProperty],
    businessBooksEntries: spec.businessBooks === undefined ? undefined : [...spec.businessBooks],
    broughtForwardLosses: spec.broughtForward === undefined ? undefined : [...spec.broughtForward],
    sourceRecordIds: ["ledger_row_1"],
  };
}

function makeCase(
  name: string,
  coversParameters: readonly RateParameterId[],
  why: string,
  spec: CaseSpec,
): GoldenCase {
  return { name, coversParameters, why, input: buildInput(spec) };
}

const SENIOR: TaxpayerProfile = { residentStatus: "resident", ageCategory: "senior" };
const SUPER_SENIOR: TaxpayerProfile = { residentStatus: "resident", ageCategory: "super_senior" };
const NON_RESIDENT: TaxpayerProfile = { residentStatus: "non_resident", ageCategory: "senior" };

/**
 * The corpus. Ordered by the parameter each group is aimed at, so a reader can
 * see the coverage without running anything.
 */
export const PORT_SLICE_2_GOLDEN_CASES: readonly GoldenCase[] = [
  // ── new-regime slab table: every band boundary, and both sides of each ────
  makeCase("empty-case", ["new_regime_slabs", "old_regime_slabs", "cess", "rebate", "itr_form_income_ceiling"],
    "no income at all — every figure is an honest zero, and a zero is the easiest thing to break silently",
    {}),
  makeCase("new-slab-nil-band", ["new_regime_slabs"],
    "inside the ₹4,00,000 nil band under the new regime",
    { salary: 3_50_000 }),
  makeCase("new-slab-boundary-400000", ["new_regime_slabs"],
    "exactly at the nil-band ceiling — the boundary `applySlabTax` treats as inclusive",
    { salary: 4_75_000 }),
  makeCase("new-slab-5pc-band", ["new_regime_slabs", "rebate"],
    "in the 5% band; 87A clause (a) still wipes the liability",
    { salary: 8_00_000 }),
  makeCase("new-slab-10pc-band", ["new_regime_slabs", "rebate"],
    "in the 10% band, at the ₹12,00,000 rebate ceiling exactly",
    { salary: 12_75_000 }),
  makeCase("new-slab-15pc-band", ["new_regime_slabs", "cess"],
    "in the 15% band — first case with a real cess figure under both regimes",
    { salary: 16_50_000, taxPaid: 1_50_000 }),
  makeCase("new-slab-20pc-band", ["new_regime_slabs"],
    "in the 20% band", { salary: 20_00_000 }),
  makeCase("new-slab-25pc-band", ["new_regime_slabs"],
    "in the 25% band", { salary: 24_00_000 }),
  makeCase("new-slab-30pc-band", ["new_regime_slabs"],
    "above ₹24,00,000 — the open-ended top band", { salary: 32_00_000 }),

  // ── old-regime slab family: all three age tables, and the residency gate ──
  makeCase("old-slab-below-60", ["old_regime_slabs"],
    "old regime wins on a heavily-deducted below-60 case, so the below-60 table drives the recommendation",
    {
      salary: 9_00_000,
      deductions: [
        { id: "d80c", section: "80C", amount: 1_50_000, sourceType: "manual" },
        { id: "d80d", section: "80D", amount: 25_000, sourceType: "manual" },
      ],
    }),
  makeCase("old-slab-senior", ["old_regime_slabs"],
    "resident senior — the ₹3,00,000 basic exemption band",
    {
      taxpayer: SENIOR,
      salary: 9_00_000,
      deductions: [
        { id: "d80c", section: "80C", amount: 1_50_000, sourceType: "manual" },
        { id: "d80ttb", section: "80TTB", amount: 50_000, sourceType: "manual" },
      ],
      fdInterest: 60_000,
    }),
  makeCase("old-slab-super-senior", ["old_regime_slabs"],
    "resident super-senior — the ₹5,00,000 exemption that absorbs the whole 5% band",
    {
      taxpayer: SUPER_SENIOR,
      salary: 11_00_000,
      deductions: [{ id: "d80c", section: "80C", amount: 1_50_000, sourceType: "manual" }],
    }),
  makeCase("old-slab-non-resident-senior", ["old_regime_slabs"],
    "non-resident senior — age alone must NOT widen the exemption, so this must land on the below-60 table",
    {
      taxpayer: NON_RESIDENT,
      salary: 9_00_000,
      deductions: [{ id: "d80c", section: "80C", amount: 1_50_000, sourceType: "manual" }],
    }),

  // ── section 87A rebate and its threshold marginal relief ─────────────────
  makeCase("rebate-new-at-ceiling", ["rebate"],
    "total income exactly ₹12,00,000 — clause (a) rebate at the ceiling",
    { salary: 12_75_000, deductions: [] }),
  makeCase("rebate-new-inside-relief-window", ["rebate", "new_regime_slabs"],
    "just above the ceiling, inside the clause (b) marginal-relief taper",
    { salary: 12_80_000 }),
  makeCase("rebate-new-mid-relief-window", ["rebate"],
    "mid-taper — relief is positive and strictly less than the tax",
    { salary: 13_20_000 }),
  makeCase("rebate-new-above-relief-window", ["rebate"],
    "past the ≈₹12,70,588 bound where relief tapers to nothing",
    { salary: 13_50_000 }),
  makeCase("rebate-old-cliff", ["rebate", "old_regime_slabs"],
    "old regime just above ₹5,00,000 — D170's genuine cliff, a computed nil rather than a gap",
    {
      salary: 5_80_000,
      deductions: [{ id: "d80c", section: "80C", amount: 25_000, sourceType: "manual" }],
    }),
  makeCase("rebate-relief-refused-special-rate", ["rebate"],
    "inside the relief window WITH 111A/112A income — the D171 refusal, relief nil and unsupported",
    { salary: 12_20_000, stcg111a: 30_000 }),

  // ── surcharge, its bands, and its marginal relief ────────────────────────
  makeCase("surcharge-below-entry", ["surcharge"],
    "just below ₹50,00,000 — nil surcharge as a matter of law",
    { salary: 49_00_000, taxPaid: 10_00_000 }),
  makeCase("surcharge-exactly-at-entry", ["surcharge"],
    "EXACTLY ₹50,00,000 — TAX-SAFE-01A's strict `>`; this must not be blocked",
    { salary: 50_75_000, taxPaid: 10_00_000 }),
  makeCase("surcharge-10pc-band-with-relief", ["surcharge", "cess"],
    "just above ₹50,00,000 — the 10% band with marginal relief actually biting",
    { salary: 50_80_000, taxPaid: 10_00_000 }),
  makeCase("surcharge-10pc-band-no-relief", ["surcharge"],
    "well inside the 10% band — relief computed and nil",
    { salary: 75_00_000, taxPaid: 20_00_000 }),
  makeCase("surcharge-exactly-at-one-crore", ["surcharge"],
    "EXACTLY ₹1,00,00,000 — the half-open band edge; still the 10% band, not the 15% one",
    { salary: 1_00_75_000, taxPaid: 30_00_000 }),
  makeCase("surcharge-15pc-band-with-relief", ["surcharge"],
    "just above ₹1,00,00,000 — the 15% band, where the reference itself carries surcharge",
    { salary: 1_00_80_000, taxPaid: 30_00_000 }),
  makeCase("surcharge-15pc-band-no-relief", ["surcharge"],
    "well inside the 15% band", { salary: 1_60_00_000, taxPaid: 50_00_000 }),
  makeCase("surcharge-at-supported-ceiling", ["surcharge"],
    "EXACTLY ₹2,00,00,000 — the last income the band table covers",
    { salary: 2_00_75_000, taxPaid: 60_00_000 }),
  makeCase("surcharge-above-supported-ceiling", ["surcharge"],
    "above ₹2,00,00,000 — refused, ₹0 is not a nil surcharge here",
    { salary: 2_50_00_000, taxPaid: 70_00_000 }),
  makeCase("surcharge-ambiguous-reference-refused", ["surcharge"],
    "mixed slab + special-rate income inside the window where relief could be non-zero — the D126 refusal",
    { salary: 50_60_000, stcg111a: 40_000, taxPaid: 10_00_000 }),
  makeCase("surcharge-ambiguous-proved-nil", ["surcharge"],
    "mixed composition where relief is provably nil under every reading — supported, unlike the case above",
    { salary: 70_00_000, ltcg112a: 5_00_000, taxPaid: 20_00_000 }),

  // ── ITR-1 income ceiling ─────────────────────────────────────────────────
  makeCase("itr1-just-below-ceiling", ["itr_form_income_ceiling"],
    "total income just under ₹50,00,000 — ITR-1 still permitted on the income test",
    { salary: 49_00_000 }),
  makeCase("itr1-above-ceiling", ["itr_form_income_ceiling"],
    "total income above ₹50,00,000 — the ceiling blocker fires with the figure in its message",
    { salary: 60_00_000 }),
  makeCase("itr1-blocked-by-foreign-assets", ["itr_form_income_ceiling"],
    "a non-income ITR-1 blocker, so the ceiling is not the only thing moving the recommendation",
    { salary: 9_00_000, hasForeignAssets: true }),

  // ── heads that reach the slab table by a different route ────────────────
  makeCase("house-property-let-out", ["old_regime_slabs", "new_regime_slabs"],
    "a let-out property — regime-dependent Section 24(b) treatment feeding both slab tables",
    {
      salary: 10_00_000,
      houseProperty: [
        {
          id: "hp_1",
          amount: 0,
          usage: "let_out",
          annualRentReceived: 3_60_000,
          municipalTaxesPaid: 12_000,
          homeLoanInterest: 1_80_000,
          sourceType: "manual",
        },
      ],
    }),
  makeCase("house-property-self-occupied-loss", ["old_regime_slabs"],
    "a self-occupied loss — capped at ₹2,00,000 old regime, disallowed new; the two regimes diverge",
    {
      salary: 14_00_000,
      houseProperty: [
        {
          id: "hp_1",
          amount: 0,
          usage: "self_occupied",
          annualRentReceived: 0,
          municipalTaxesPaid: 0,
          homeLoanInterest: 2_40_000,
          sourceType: "manual",
        },
      ],
    }),
  makeCase("presumptive-44ada", ["new_regime_slabs", "itr_form_income_ceiling"],
    "Section 44ADA deemed profit as ordinary slab income",
    { presumptive44ada: 30_00_000 }),
  makeCase("presumptive-44ad-digital", ["new_regime_slabs"],
    "Section 44AD digital-turnover deemed profit",
    { presumptive44adDigital: 80_00_000 }),
  makeCase("business-books", ["new_regime_slabs", "itr_form_income_ceiling"],
    "books-based business profit — reaches the slab table and dominates the ITR recommendation",
    {
      businessBooks: [
        {
          id: "bb_1",
          amount: 0,
          revenue: 40_00_000,
          expenses: 22_00_000,
          isProfession: false,
          adjustments: "none_s30_43d",
          activityClassification: "ordinary_business_or_profession",
          sourceType: "manual",
        },
      ],
    }),

  // ── capital-gain set-off paths that change what the slab/surcharge see ───
  makeCase("capital-loss-within-year", ["surcharge", "new_regime_slabs"],
    "a within-year 112A loss set-off, so the special-rate income the surcharge test sees is a NET figure",
    { salary: 55_00_000, ltcg112a: -3_00_000, taxPaid: 12_00_000 }),
  makeCase("brought-forward-loss", ["new_regime_slabs", "rebate"],
    "a Section 74 brought-forward set-off applied after the within-year leg",
    {
      salary: 11_00_000,
      ltcg112a: 4_00_000,
      broughtForward: [
        {
          id: "bf_1",
          lossType: "ltcl",
          amount: 1_00_000,
          originatingAssessmentYear: "2023-24",
          filingEligibility: "verified_timely",
          provenance: "staff_declared",
          sourceType: "manual",
        },
      ],
    }),
  makeCase("ltcg-under-exemption", ["new_regime_slabs", "cess"],
    "112A gain below the ₹1,25,000 threshold — special-rate tax is a computed zero",
    { salary: 7_00_000, ltcg112a: 1_00_000 }),
  makeCase("ltcg-over-exemption", ["new_regime_slabs", "cess"],
    "112A gain above the threshold, with 111A alongside",
    { salary: 7_00_000, ltcg112a: 4_00_000, stcg111a: 2_00_000, taxPaid: 50_000 }),
];
