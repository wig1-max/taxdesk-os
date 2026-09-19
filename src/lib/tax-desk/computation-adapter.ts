/**
 * Tax Desk → K.2.0 engine adapter (K.2.5). PURE — imports only the engine's
 * types (not React/Next/Supabase). Converts live (non-deleted) ledger rows
 * into the exact `TaxEngineInput` the pure engine expects, and reports which
 * rows the current engine cannot represent (so nothing is silently ignored).
 *
 * The engine is NOT modified. Notes are never carried into the engine input.
 */

import {
  admitBroughtForwardRecord,
  BUSINESS_BOOKS,
  BUSINESS_BOOKS_ADJUSTMENTS,
  BUSINESS_BOOKS_ACTIVITY_CLASSIFICATIONS,
  CAPITAL_GAINS,
  computeBroughtForwardSetOff,
  computeHouseSale,
  computeSection32Allowance,
  HOUSE_SALE_ACQUISITION_MODES,
  HOUSE_SALE_ASSET_KINDS,
  HOUSE_SALE_REQUIRED_DECLARATIONS,
  DEPRECIATION_ASSET_CLASSES,
  DEPRECIATION_PUT_TO_USE,
  PRESUMPTIVE_44AD,
  PRESUMPTIVE_44ADA,
  PRESUMPTIVE_ACTIVITY_ELIGIBILITY,
  resolveLossAllocationPolicyId,
  type PresumptiveActivityType,
  type BroughtForwardLossEntry,
  type BusinessBooksAdjustment,
  type BusinessBooksActivityClassification,
  type BusinessBooksDepreciationBlock,
  type BusinessBooksEntry,
  type CapitalGainEntry,
  type DeductionEntry,
  type DeductionSection,
  type HousePropertyEntry,
  type HousePropertyUsage,
  type IncomeCategory,
  type IncomeEntry,
  type ItrType,
  type TaxEngineInput,
  type TaxPaidCategory,
  type TaxPaidEntry,
} from "@/lib/tax-engine/ay-2026-27";
import { deriveTaxpayerAgeBand, type AgeDerivationOutcome } from "./senior-treatment";

// --- DB row shapes (amounts may arrive as strings from PostgREST numeric) ---

type Num = number | string | null | undefined;

export interface IncomeLedgerRow {
  id: string;
  income_head: string;
  amount: Num;
  source_type: string;
  source_document_id?: string | null;
  source_document_name?: string | null;
  source_file_name?: string | null;
  /**
   * K4-07: meaningful ONLY when `income_head === "presumptive_professional_44ada"`
   * — whether gross receipts were predominantly (>=95%) via banking channels
   * (cash <=5%), which raises the Section 44ADA eligibility ceiling from
   * ₹50,00,000 to ₹75,00,000. `null`/`undefined`/`false` are all treated as
   * "not confirmed digital-predominant" (the conservative lower ceiling) —
   * never inferred true. Ignored for every other head.
   */
  receipts_via_banking_channels?: boolean | null;
  /**
   * K4-13 (D217): meaningful ONLY on the three presumptive heads — which
   * activity the turnover / gross receipts arise from, so the eligible-
   * activity test of Section 44AD(6) and the Explanation to Section 44AD
   * (and Section 44ADA(1)'s mirror-image requirement) can be applied.
   *
   * `null`/`undefined`/an unrecognised string are ALL treated as NOT
   * DECLARED, and not-declared BLOCKS the presumptive computation. This is
   * the opposite default from `receipts_via_banking_channels` above, and
   * deliberately so: that flag's absence selects a conservative ceiling and
   * the computation still proceeds, whereas an undeclared activity means the
   * engine cannot know the scheme applies at all, so it refuses. Ignored for
   * every other head.
   */
  presumptive_activity_type?: string | null;
}
export interface TaxPaidLedgerRow {
  id: string;
  tax_paid_type: string;
  amount: Num;
  source_type: string;
  source_document_id?: string | null;
  source_document_name?: string | null;
  source_file_name?: string | null;
}
export interface DeductionLedgerRow {
  id: string;
  deduction_type: string;
  section_code?: string | null;
  amount: Num;
  source_type: string;
  source_document_id?: string | null;
  proof_case_document_id?: string | null;
  source_document_name?: string | null;
  source_file_name?: string | null;
  /**
   * K4-05: meaningful ONLY when `deduction_type === "80D_PARENTS"` — whether
   * the insured PARENT (not the taxpayer) is senior/super-senior. `null`/
   * `undefined`/`false` are all treated identically as "not confirmed
   * senior" (the conservative ₹25,000 parents-bucket cap) — never inferred
   * true. Ignored for every other section.
   */
  insured_party_senior?: boolean | null;
}
export interface CapitalGainLedgerRow {
  id: string;
  gain_type: string;
  sale_value: Num;
  cost: Num;
  expenses: Num;
  exemption_claimed: Num;
  taxable_gain: Num;
  source_type: string;
  source_document_id?: string | null;
  source_document_name?: string | null;
  source_file_name?: string | null;
  transfer_date?: string | null;
  acquisition_date?: string | null;
  stamp_duty_value?: Num | null;
  asset_kind?: string | null;
  acquisition_mode?: string | null;
  cost_of_improvement?: Num | null;
  house_sale_declarations?: string[] | null;
}

export interface HousePropertyLedgerRow {
  id: string;
  usage: string;
  annual_rent_received: Num;
  municipal_taxes_paid: Num;
  home_loan_interest: Num;
  source_type: string;
  source_document_id?: string | null;
  proof_case_document_id?: string | null;
  source_document_name?: string | null;
  source_file_name?: string | null;
}

/**
 * K4-14: one BOOKS-BASED business or profession (Sections 28/29).
 *
 * `adjustments` carries the same default discipline as
 * `presumptive_activity_type` above, and for the same reason:
 * `null`/`undefined`/an unrecognised string are ALL treated as NOT DECLARED,
 * and not-declared REFUSES. There is no fallback to "presumably none" —
 * Section 29 makes book profit and taxable profit different numbers whenever
 * any of Sections 30-43D bites, so an unanswered adjustment question is an
 * unknown taxable figure, not a zero adjustment.
 */
export interface BusinessBooksLedgerRow {
  id: string;
  /** Declared gross revenue / turnover / gross receipts for the year. */
  revenue: Num;
  /** Declared total expenses charged in the books for the year. */
  expenses: Num;
  /** True → Section 44AB(b)'s ₹50L profession threshold; false/null → 44AB(a)'s ₹1cr. */
  is_profession?: boolean | null;
  /** K4-20: a SET of `BUSINESS_BOOKS_ADJUSTMENT_DECLARATIONS`. A lone string
   *  is the pre-K4-20 snapshot/row shape. Empty / unrecognised refuses. */
  adjustments?: string | readonly string[] | null;
  /** K4-17: affirmative ordinary/speculation/specified-business classification.
   *  Missing or unrecognised values refuse; absence is never ordinary. */
  activity_classification?: string | null;
  /** K4-18: preparer-declared Section 44AB turnover, for a classification whose
   *  books revenue is not that figure. Missing on such a row refuses. */
  declared_turnover?: Num | null;
  /** K4-20: book depreciation charged in the P&L. Required when the set
   *  contains `depreciation_s32`. */
  book_depreciation?: Num | null;
  /** K4-20: whether s.32(1)(iia) additional depreciation arises. Required
   *  when the set contains `depreciation_s32`. `true` refuses. */
  claims_additional_depreciation?: boolean | null;
  /** K4-20: Appendix I standing-class blocks. Required (non-empty) when
   *  the set contains `depreciation_s32`. */
  depreciation_blocks?: unknown;
  source_type: string;
  source_document_id?: string | null;
  proof_case_document_id?: string | null;
  source_document_name?: string | null;
  source_file_name?: string | null;
}

/** K4-10: one brought-forward carry-forward record (Section 74). */
export interface BroughtForwardLossLedgerRow {
  id: string;
  originating_assessment_year: string;
  loss_type: string;
  amount: Num;
  filing_eligibility: string;
  loss_provenance: string;
  prior_tax_case_id?: string | null;
  /** NULL = no election; the portal-default policy applies. */
  elected_set_off_target?: string | null;
  source_type: string;
  source_document_id?: string | null;
  proof_case_document_id?: string | null;
  source_document_name?: string | null;
  source_file_name?: string | null;
}

export interface LedgerRows {
  income: IncomeLedgerRow[];
  taxPaid: TaxPaidLedgerRow[];
  deductions: DeductionLedgerRow[];
  capitalGains: CapitalGainLedgerRow[];
  /**
   * K4-10: optional for the same reason `housePropertyEntries` is — every
   * pre-existing caller/fixture that never touches carry-forward keeps
   * compiling unchanged, and an absent array is treated identically to `[]`.
   */
  broughtForwardLosses?: BroughtForwardLossLedgerRow[];
  /**
   * K4-06: optional so every pre-existing caller/fixture that never touches
   * house property keeps compiling unchanged — treated identically to `[]`
   * when absent. Session scope is 0 or 1 LIVE rows per case; `buildEngineInput`
   * excludes ALL rows (never guesses which one) when more than one is present.
   */
  housePropertyEntries?: HousePropertyLedgerRow[];
  /**
   * K4-14: optional for exactly the reasons `housePropertyEntries` is —
   * absent is treated identically to `[]`, so every pre-existing caller and
   * fixture keeps compiling and computing unchanged. Session scope is 0 or 1
   * LIVE rows per case; `buildEngineInput` excludes ALL rows (never guesses
   * which business to compute) when more than one is present.
   */
  businessBooksEntries?: BusinessBooksLedgerRow[];
}

/**
 * Compile-time exhaustiveness boundary for production projections. LedgerRows
 * keeps optional categories for small tests and legacy callers, but the three
 * server projections that classify live support must name every current kind.
 * Adding a future LedgerRows key therefore breaks those call sites until they
 * deliberately project it instead of silently treating it as absent.
 */
export type CompleteLedgerRowsProjection = {
  [K in keyof Required<LedgerRows>]: unknown[];
};

export function assembleCompleteLedgerRows(rows: CompleteLedgerRowsProjection): LedgerRows {
  // Query/page read models intentionally expose a common LedgerRow shape. The
  // adapter remains the authority that validates each category's fields; this
  // one centralized cast changes only the projection's compile-time key check.
  return rows as unknown as LedgerRows;
}

export interface CaseMeta {
  assessmentYear: string;
  financialYear: string;
  selectedItrType: string | null;
  finalized: boolean;
  /** ISO date string or null — reused from clients.date_of_birth (K4-01). Drives
   *  {@link deriveTaxpayerAgeBand}; NEVER hardcoded to "below_60" from here on. */
  dateOfBirth?: string | null;
  /** Raw stored residential-status value (tax_cases.residential_status), or
   *  null (K4-01). Only "resident" is engine-supported — a non-resident/
   *  unresolved case is already withheld entirely by eligibility.ts before a
   *  snapshot can be created, so this is propagated for correctness/
   *  traceability, not as a second gate. */
  residentialStatus?: string | null;
}

export type MappingWarningCode =
  | "UNSUPPORTED_INCOME_HEAD"
  | "UNSUPPORTED_GAIN_TYPE"
  /** K4-09: RETAINED, but narrowed. A within-year capital-loss set-off IS now
   *  computed inside the provably unambiguous window (see `rules.ts`'s
   *  `CAPITAL_LOSS_SET_OFF`). This code now means the declared loss cannot be
   *  fully absorbed within the year, so the unabsorbed part would need Section
   *  74 carry-forward — which no multi-year state in this product can hold. */
  | "CAPITAL_LOSS_NOT_MODELLED"
  /** K4-09: a short-term capital loss is declared alongside BOTH 111A and
   *  112A gains. Which bucket absorbs it first is a taxpayer election that
   *  changes the tax (20% vs 12.5%), and no source reachable this session
   *  stated a mandatory order — so the election is refused, never guessed. */
  | "CAPITAL_LOSS_SETOFF_ORDER_ELECTIVE"
  /** K4-06: more than one live house-property row exists for this case —
   *  session scope is a single property, so ALL rows are excluded (never a
   *  guess at which one to compute) until multi-property support ships
   *  (Wave-4 priority #5). */
  | "MULTIPLE_HOUSE_PROPERTIES_NOT_MODELLED"
  /** K4-07: the AGGREGATE of every live `presumptive_professional_44ada`
   *  row exceeds the applicable Section 44ADA gross-receipts eligibility
   *  ceiling (₹50L, or ₹75L when every row confirms receipts are
   *  predominantly via banking channels) — the taxpayer is not eligible for
   *  presumptive taxation at all, so ALL such rows are excluded (never a
   *  guess, never a partial/wrong deemed-profit figure). */
  | "PRESUMPTIVE_44ADA_CEILING_EXCEEDED"
  | "PRESUMPTIVE_44AD_CEILING_EXCEEDED"
  /** K4-13 (D217): a live presumptive row does not declare WHICH activity the
   *  income arises from, so the eligible-activity test of Section 44AD(6) /
   *  the Explanation to Section 44AD / Section 44ADA(1) cannot be applied.
   *  FAILS CLOSED — an undeclared activity is refused, never presumed
   *  eligible, and ALL rows of that scheme are excluded. This is the gap
   *  K4-07 and K4-08 both recorded as not covered, and it failed OPEN until
   *  now: an ineligible activity computed a deemed profit anyway. */
  | "PRESUMPTIVE_44AD_ACTIVITY_TYPE_UNDECLARED"
  | "PRESUMPTIVE_44ADA_ACTIVITY_TYPE_UNDECLARED"
  /** K4-13 (D217): the declared activity is ineligible for the scheme —
   *  for Section 44AD a Section 44AA(1) profession, commission or brokerage,
   *  or agency business (Section 44AD(6)), or goods carriage (excluded from
   *  "eligible business" by the Explanation to Section 44AD); for Section
   *  44ADA anything that is NOT a Section 44AA(1) profession, which Section
   *  44ADA(1) requires. ALL rows of that scheme are excluded — never
   *  partially computed, matching the ceiling branches. */
  | "PRESUMPTIVE_44AD_INELIGIBLE_ACTIVITY"
  | "PRESUMPTIVE_44ADA_INELIGIBLE_ACTIVITY"
  /** TAX-SAFE-03: a stored presumptive snapshot has no valid, eligible,
   *  internally consistent activity contract. Snapshot rehydration fails
   *  closed rather than recreating an unconditional `complete: true`. */
  | "PRESUMPTIVE_ACTIVITY_SNAPSHOT_UNVERIFIED"
  /** K4-14: a live books-based business row does not declare what its accounts
   *  require under Sections 30-43D, so Section 29's computation cannot be
   *  performed. FAILS CLOSED — silence is never read as "no adjustment", which
   *  would be `K4-13`'s fail-open shape with different clothes on. */
  | "BUSINESS_BOOKS_ADJUSTMENTS_UNDECLARED"
  /** K4-17: the row has no recognised Section 70/73/73A activity
   * classification, so its loss pool cannot be inferred safely. */
  | "BUSINESS_BOOKS_ACTIVITY_UNDECLARED"
  /** K4-17/K4-18: F&O whose eligible-transaction status under Explanation 1 to
   *  Section 43(5) proviso (d) has NOT been affirmed. Proviso (d) is
   *  conditional, so unaffirmed derivative activity falls back to the main limb
   *  and is speculative — it is never admitted on silence. */
  | "BUSINESS_BOOKS_FNO_UNSUPPORTED"
  /** K4-18: intraday equity settled without delivery is speculative under the
   *  Section 43(5) main limb; Explanation 2 to Section 28 deems it a distinct
   *  and separate business and Section 73(1) quarantines its loss. No
   *  speculation pool is implemented. */
  | "BUSINESS_BOOKS_INTRADAY_SPECULATIVE_UNSUPPORTED"
  /** K4-18: a row whose classification cannot use books revenue as its Section
   *  44AB figure has declared no turnover. No statutory, CBDT or form source
   *  defines derivative turnover, so books revenue is NEVER substituted. */
  | "BUSINESS_BOOKS_TURNOVER_UNDECLARED"
  /** K4-17: Section 73 speculation-business treatment is outside the bounded
   * ordinary Section 70 pool. */
  | "BUSINESS_BOOKS_SPECULATION_UNSUPPORTED"
  /** K4-17: Sections 35AD/73A specified-business treatment is outside the
   * bounded ordinary Section 70 pool. */
  | "BUSINESS_BOOKS_SPECIFIED_BUSINESS_UNSUPPORTED"
  /** K4-14/K4-20: a Section 32 claim is declared but cannot be computed —
   *  missing blocks, missing book-depreciation add-back, unanswered
   *  additional-depreciation question, or a class outside the standing set.
   *  A complete standing-class claim COMPUTES; this code is no longer raised
   *  merely because depreciation is present (`D325`). */
  | "BUSINESS_BOOKS_DEPRECIATION_UNSUPPORTED"
  /** K4-20: additional depreciation under Section 32(1)(iia) is claimed.
   *  That limb is 20% of actual cost for new manufacturing plant and is
   *  not implemented. */
  | "BUSINESS_BOOKS_ADDITIONAL_DEPRECIATION_UNSUPPORTED"
  /** K4-21: a house-sale row is incomplete or out of the closed set
   *  (s.54 claimed, pre-cutoff LTCG, agricultural land, s.50, s.49, a
   *  loss, dates outside FY 2025-26, missing declarations). */
  | "HOUSE_SALE_UNSUPPORTED"
  /** K4-14: a Section 37 / 40 / 43B disallowance or add-back arises, so the
   *  declared expense total is not the allowable expense total. */
  | "BUSINESS_BOOKS_DISALLOWANCE_UNSUPPORTED"
  /** K4-14: the case moves to books FROM a presumptive scheme, engaging the
   *  Section 44AD(4)/(5) five-year lock-in and its Section 44AB(e) audit
   *  trigger. Needs multi-year state, which exists nowhere in this product. */
  | "BUSINESS_BOOKS_PRESUMPTIVE_TRANSITION_UNSUPPORTED"
  /** K4-14: declared turnover / gross receipts cross the Section 44AB audit
   *  threshold (₹1cr business under 44AB(a), ₹50L profession under 44AB(b)).
   *  An audited case needs a Section 44AB report this product neither holds
   *  nor produces. The 44AB(a) proviso's ₹10cr threshold is NOT used — its
   *  second limb is about cash PAYMENTS, which no ledger here captures.
   *
   *  K4-15: now raised on the AGGREGATE per limb, not per row. Section 44AB(a)
   *  tests "his TOTAL sales, turnover or gross receipts, as the case may be, IN
   *  BUSINESS", which is a question about the person, not about one business. */
  | "BUSINESS_BOOKS_AUDIT_THRESHOLD_EXCEEDED"
  /** K4-17: the aggregate of every otherwise-admissible current-year books
   *  business/profession row is negative. Section 70(1) intra-head set-off is
   *  now applied when positive siblings absorb a negative row in full and the
   *  aggregate is zero or positive. A negative aggregate would leave a
   *  residual business-head loss requiring Section 71 cross-head treatment or
   *  Section 72 carry-forward, neither of which is modelled, so every negative
   *  row keeps this code and the whole head is refused rather than floored. */
  | "BUSINESS_BOOKS_LOSS_NOT_MODELLED"
  /** K4-15: this books row passes every gate against the current data, but
   *  another books row in the same case is refused. Section 28 charges ONE head on every business
   *  carried on, so the head's figure is the aggregate — publishing the sum of
   *  the surviving rows would be a partial head total presented as the head.
   *  Every row counts or none does, and a row excluded for a sibling's reason
   *  says so rather than disappearing silently (the AUDIT-03-F9 / D86 class).
   *
   *  This REPLACED `MULTIPLE_BUSINESS_BOOKS_NOT_MODELLED`, which K4-15 deleted:
   *  more than one business is now computed, so a code meaning "more than one
   *  exists" no longer describes a refusal. */
  | "BUSINESS_BOOKS_SIBLING_ROW_REFUSED"
  /** K4-10: a brought-forward record's Section 139(3)/80 filing eligibility is
   *  UNVERIFIED. An unchecked condition is never treated as satisfied, so the
   *  case is refused rather than computed on the assumption that the loss
   *  return was filed on time. FAILS CLOSED. */
  | "BROUGHT_FORWARD_LOSS_FILING_UNVERIFIED"
  /** K4-10: the brought-forward allocation is NOT forced — two lawful
   *  allocation policies would produce different results for this case (a
   *  short-term loss that could reach either bucket, a long-term and a
   *  short-term loss competing for the same bucket, or two records of one type
   *  partially absorbed so which residual survives depends on order). No
   *  source makes any sequence mandatory (D113), so the choice is refused
   *  rather than taken. */
  | "BROUGHT_FORWARD_LOSS_ALLOCATION_ELECTIVE"
  /** K4-10: a taxpayer-elected allocation was recorded that either is not
   *  lawful under Section 74(1) or does not reproduce the portal default for
   *  the pinned artifact versions. It is neither silently replaced by the
   *  default nor silently accepted — the case stops for professional review. */
  | "BROUGHT_FORWARD_LOSS_ELECTION_DIVERGES"
  /** K4-10: a brought-forward record cannot be EVALUATED at all — its
   *  originating assessment year is unreadable, or it does not name a year
   *  earlier than the current one, so the Section 74(2) window cannot be
   *  applied to it. An absence of knowledge, so it fails closed rather than
   *  being quietly dropped. */
  | "BROUGHT_FORWARD_LOSS_RECORD_UNUSABLE";

export interface MappingWarning {
  code: MappingWarningCode;
  ledgerKind:
    | "income"
    | "capital_gain"
    | "house_property"
    | "brought_forward_loss"
    /** K4-14 */
    | "business_books";
  ledgerId: string;
  entryType: string;
  amount: number;
  message: string;
}

export interface SourceTraceGroup {
  key: string;
  label: string;
  ledgerKind:
    | "income"
    | "tax_paid"
    | "deduction"
    | "capital_gain"
    | "house_property"
    | "brought_forward_loss"
    /** K4-14 */
    | "business_books";
  ledgerIds: string[];
  sourceTypes: string[];
  documentLabels: string[];
  total: number;
}

export const PRESUMPTIVE_ACTIVITY_SNAPSHOT_VERSION =
  "TAX_SAFE_03.presumptive_activity_snapshot.v1" as const;

export interface PresumptiveActivitySnapshotRow {
  readonly ledgerId: string;
  readonly incomeHead:
    | "presumptive_professional_44ada"
    | "presumptive_business_44ad_digital"
    | "presumptive_business_44ad_cash";
  readonly amount: number;
  readonly activityType: PresumptiveActivityType | null;
  /** The exact boolean the 44ADA ceiling consumes: `true` only when the live
   *  row explicitly confirms banking-channel predominance; false otherwise. */
  readonly bankingChannelsConfirmed: boolean;
}

export interface PresumptiveActivityEligibilitySnapshot {
  readonly version: typeof PRESUMPTIVE_ACTIVITY_SNAPSHOT_VERSION;
  /** A server-derived verdict from the same rows `buildEngineInput` gated. */
  readonly eligible: boolean;
  readonly rows: readonly PresumptiveActivitySnapshotRow[];
}

export interface AdapterResult {
  input: TaxEngineInput;
  warnings: MappingWarning[];
  /** K4-01: the taxpayer's age-band derivation outcome (from
   *  `meta.dateOfBirth` + `meta.assessmentYear`) — exposed so callers (the
   *  senior-treatment evaluator, evidence manifests, traceability) can read
   *  the SAME derivation the adapter itself used to populate
   *  `input.taxpayer.ageCategory`, never a second one. */
  ageDerivation: AgeDerivationOutcome;
  /** True when there are no unsupported non-zero entries. */
  complete: boolean;
  /** TAX-SAFE-03: immutable activity provenance/verdict for snapshot storage.
   *  Derived from the exact live income rows that governed this adapter run. */
  presumptiveActivityEligibility: PresumptiveActivityEligibilitySnapshot;
  /** Ledger ids excluded from the engine input (unsupported non-zero rows). */
  excludedLedgerIds: string[];
  sourceTrace: SourceTraceGroup[];
  mappedEntryCount: number;
  unsupportedEntryCount: number;
  summary: {
    salary: number;
    interest: number;
    dividendOther: number;
    exempt: number;
    deductions: number;
    stcg111a: number;
    ltcg112a: number;
    totalTaxPaid: number;
    /** K4-06: raw (regime-independent) rent received minus interest — a
     *  meaningful-input signal only, never the actual computed figure
     *  (see {@link computeHouseProperty} for the real, regime-aware value). */
    houseProperty: number;
    /** K4-07: raw declared gross receipts for presumptive professional
     *  (44ADA) income that passed the eligibility-ceiling check — a
     *  meaningful-input signal only, never the deemed-profit figure itself
     *  (see `deriveIncome`'s `presumptiveProfessionalIncome` for that). */
    presumptiveProfessionalIncome: number;
    /** K4-08: raw declared aggregate turnover (both receipt-mode heads) for
     *  presumptive business (44AD) income that passed the eligibility-ceiling
     *  check — a meaningful-input signal only, never the deemed-profit figure
     *  itself (see `deriveIncome`'s `presumptiveBusinessIncome` for that). */
    presumptiveBusinessTurnover: number;
    /** K4-14: declared revenue minus declared expenses for the books-based
     *  business row that passed every gate — a meaningful-input signal, and
     *  here it happens to equal the computed figure because this slice applies
     *  no Sections 30-43D adjustment. Do not read that coincidence as a
     *  contract: the moment any adjustment is implemented, this stays the raw
     *  declared difference and `computeBusinessBooksIncome` becomes the only
     *  authority for the taxable figure. */
    businessBooksNetProfit: number;
    /** K4-10: raw declared brought-forward loss admitted into the engine input
     *  — a meaningful-input signal only, never the amount actually absorbed
     *  (see `deriveIncome`'s `broughtForwardLossSetOff` for that, which depends
     *  on the gains available and on the expiry/eligibility classification). */
    broughtForwardLoss: number;
  };
}

// --- helpers ---------------------------------------------------------------

/** Safe numeric normalization for DB decimal strings. */
export function toNum(v: Num): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Numeric(14,2) arithmetic in integer paise, avoiding order-dependent IEEE
 * sign errors at the exact-zero K4-17 boundary. */
function toPaise(n: number): number {
  return Math.round(n * 100);
}

function currencyDifference(revenue: number, expenses: number): number {
  return (toPaise(revenue) - toPaise(expenses)) / 100;
}

const SLAB_INCOME_HEADS: ReadonlySet<IncomeCategory> = new Set([
  "salary",
  "savings_interest",
  "fd_interest",
  "dividend",
  "other_sources",
  "exempt_income",
]);
const PLACEHOLDER_INCOME_HEADS = new Set(["house_property", "business_income"]);

/**
 * K4-14 — which refusal each non-computable Sections 30-43D basis reports.
 * Typed as a TOTAL record over the vocabulary rather than a partial lookup, so
 * a member added to `BUSINESS_BOOKS_ADJUSTMENTS` without deciding how it
 * refuses fails to compile instead of silently falling through to a generic
 * message (or, worse, to the computable branch).
 *
 * The computable member maps to a code that can only be reached if someone
 * later flips its `computable` flag without revisiting this table — it exists
 * to keep that mistake loud rather than to be used.
 */
const BUSINESS_BOOKS_REFUSAL_CODES: Record<BusinessBooksAdjustment, MappingWarningCode> = {
  none_s30_43d: "BUSINESS_BOOKS_ADJUSTMENTS_UNDECLARED",
  depreciation_s32: "BUSINESS_BOOKS_DEPRECIATION_UNSUPPORTED",
  disallowance_s37_s40_s43b: "BUSINESS_BOOKS_DISALLOWANCE_UNSUPPORTED",
  presumptive_transition: "BUSINESS_BOOKS_PRESUMPTIVE_TRANSITION_UNSUPPORTED",
};
const BUSINESS_BOOKS_ACTIVITY_REFUSAL_CODES: Record<
  BusinessBooksActivityClassification,
  MappingWarningCode
> = {
  ordinary_business_or_profession: "BUSINESS_BOOKS_ACTIVITY_UNDECLARED",
  fno_non_speculative_s43_5_d: "BUSINESS_BOOKS_ACTIVITY_UNDECLARED",
  futures_and_options: "BUSINESS_BOOKS_FNO_UNSUPPORTED",
  intraday_speculative_s43_5: "BUSINESS_BOOKS_INTRADAY_SPECULATIVE_UNSUPPORTED",
  speculation_business_s73: "BUSINESS_BOOKS_SPECULATION_UNSUPPORTED",
  specified_business_s35ad: "BUSINESS_BOOKS_SPECIFIED_BUSINESS_UNSUPPORTED",
};
const TAX_PAID_TYPES: ReadonlySet<TaxPaidCategory> = new Set([
  "salary_tds",
  "non_salary_tds",
  "tcs",
  "advance_tax",
  "self_assessment_tax",
]);
const DEDUCTION_SECTIONS: ReadonlySet<DeductionSection> = new Set([
  "80C",
  "80D",
  "80D_PARENTS",
  "80TTA",
  "80TTB",
  "80CCD",
  "80G",
]);
const SUPPORTED_GAINS = new Set(["stcg_111a", "ltcg_112a"]);
const HOUSE_SALE_GAIN = "house_sale";
const PLACEHOLDER_GAINS = new Set(["other_stcg", "other_ltcg"]);
const ITR_TYPES = new Set<ItrType>(["ITR-1", "ITR-2", "ITR-3", "ITR-4"]);
const ENGINE_RESIDENT_STATUSES = new Set(["resident", "non_resident", "not_ordinarily_resident"]);

function docLabel(row: { source_document_name?: string | null; source_file_name?: string | null }): string | null {
  return row.source_document_name ?? row.source_file_name ?? null;
}

/**
 * K4-13 (D217) — the eligible-ACTIVITY gate for both presumptive schemes.
 *
 * FAILS CLOSED, which is the entire point of this function. Before K4-13 a
 * presumptive row whose activity was ineligible (a commission agent, an
 * agency, a goods-carriage operator, a Section 44AA(1) professional entered
 * under 44AD) computed a deemed profit anyway, because no field recorded the
 * activity. An undeclared activity now REFUSES rather than presuming
 * eligibility: `null`, `undefined`, `""` and any string outside the closed
 * vocabulary are all "not declared", and all of them block.
 *
 * ALL-OR-NOTHING across the scheme's rows, deliberately, matching the
 * existing ceiling branches — which the `presumptive_44ad` capability row
 * already describes in writing as "excluded entirely, never partially
 * computed". Partially computing would emit a deemed profit over a subset of
 * turnover that nobody declared, and would leave the aggregate ceiling test
 * with an ambiguous denominator. Because the excluded rows set
 * `complete === false` either way, nothing can be snapshotted, approved or
 * finalized on either design; the difference is only whether the preview
 * shows a number that is not the taxpayer's.
 *
 * The eligible-ASSESSEE limbs of the Explanation to Section 44AD (resident
 * individual / HUF / firm-but-not-LLP; no 10A / 10AA / 10B / 10BA or Chapter
 * VI-A Part C deduction) are NOT tested here — they are properties of the
 * person, not the activity, and this product captures no data for the
 * deduction limb. Recorded as a remaining gap, never as a silent pass.
 */
export type PresumptiveScheme = "44AD" | "44ADA";

export type PresumptiveActivityGate =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: MappingWarningCode; readonly message: string };

export function gatePresumptiveActivity(
  scheme: PresumptiveScheme,
  rows: readonly { readonly presumptive_activity_type?: string | null }[],
): PresumptiveActivityGate {
  const section = scheme === "44AD" ? "Section 44AD" : "Section 44ADA";
  const declared: PresumptiveActivityType[] = [];
  let undeclared = 0;
  for (const r of rows) {
    const raw = r.presumptive_activity_type;
    // `hasOwnProperty`, NOT `in` — `"constructor" in obj` is true for every
    // object, so `in` would admit inherited keys as declared activities. The
    // DB check constraint and the Zod enum both prevent such a value from
    // being stored, but this gate is the fail-closed authority and must not
    // depend on either of them being correct.
    if (typeof raw === "string" && Object.prototype.hasOwnProperty.call(PRESUMPTIVE_ACTIVITY_ELIGIBILITY, raw)) {
      declared.push(raw as PresumptiveActivityType);
    } else {
      undeclared += 1;
    }
  }

  if (undeclared > 0) {
    return {
      ok: false,
      code:
        scheme === "44AD"
          ? "PRESUMPTIVE_44AD_ACTIVITY_TYPE_UNDECLARED"
          : "PRESUMPTIVE_44ADA_ACTIVITY_TYPE_UNDECLARED",
      message:
        `${undeclared} of ${rows.length} ${section} row(s) do not declare which activity the income arises ` +
        `from, so this engine cannot test whether the activity is eligible for ${section} presumptive ` +
        "taxation — Section 44AD(6) excludes a Section 44AA(1) profession, income in the nature of " +
        "commission or brokerage, and agency business, the Explanation to Section 44AD separately excludes " +
        "goods carriage referred to in Section 44AE, and Section 44ADA(1) applies only TO a Section " +
        "44AA(1) profession. An undeclared activity is refused rather than presumed eligible; no deemed " +
        "profit is computed and the rows are excluded from this preview. Declare the activity on every row.",
    };
  }

  const ineligible = declared.filter(
    (a) =>
      !(scheme === "44AD"
        ? PRESUMPTIVE_ACTIVITY_ELIGIBILITY[a].eligibleFor44AD
        : PRESUMPTIVE_ACTIVITY_ELIGIBILITY[a].eligibleFor44ADA),
  );
  if (ineligible.length > 0) {
    // Distinct activities, in first-declared order, so the message names each
    // ineligible activity once rather than repeating it per row.
    const distinct = [...new Set(ineligible)];
    const detail = distinct
      .map((a) => `"${PRESUMPTIVE_ACTIVITY_ELIGIBILITY[a].label}" (${PRESUMPTIVE_ACTIVITY_ELIGIBILITY[a].authority})`)
      .join("; ");
    return {
      ok: false,
      code:
        scheme === "44AD"
          ? "PRESUMPTIVE_44AD_INELIGIBLE_ACTIVITY"
          : "PRESUMPTIVE_44ADA_INELIGIBLE_ACTIVITY",
      message:
        `The declared activity is not eligible for ${section} presumptive taxation — ${detail}. No deemed ` +
        "profit is computed and every row of this scheme is excluded from this preview; this engine does " +
        "not compute the books-based alternative.",
    };
  }
  return { ok: true };
}

const PRESUMPTIVE_44AD_HEADS = new Set([
  "presumptive_business_44ad_digital",
  "presumptive_business_44ad_cash",
]);

function isPresumptiveHead(
  head: string,
): head is PresumptiveActivitySnapshotRow["incomeHead"] {
  return head === "presumptive_professional_44ada" || PRESUMPTIVE_44AD_HEADS.has(head);
}

/**
 * Build the immutable activity provenance/verdict carried by a snapshot.
 * Zero rows are excluded because the adapter excludes them from the engine
 * input and they govern no computed amount. A later zero/non-zero transition
 * still changes the exact live row set and is caught by the DB backstop.
 */
export function buildPresumptiveActivityEligibilitySnapshot(
  incomeRows: readonly IncomeLedgerRow[],
): PresumptiveActivityEligibilitySnapshot {
  const relevant = incomeRows.filter(
    (row) => isPresumptiveHead(row.income_head) && toNum(row.amount) !== 0,
  );
  const ad = relevant.filter((row) => PRESUMPTIVE_44AD_HEADS.has(row.income_head));
  const ada = relevant.filter((row) => row.income_head === "presumptive_professional_44ada");
  const adGate = ad.length === 0 ? ({ ok: true } as const) : gatePresumptiveActivity("44AD", ad);
  const adaGate = ada.length === 0 ? ({ ok: true } as const) : gatePresumptiveActivity("44ADA", ada);

  return Object.freeze({
    version: PRESUMPTIVE_ACTIVITY_SNAPSHOT_VERSION,
    eligible: adGate.ok && adaGate.ok,
    rows: Object.freeze(
      relevant.map((row) => {
        const raw = row.presumptive_activity_type;
        return Object.freeze({
          ledgerId: row.id,
          incomeHead: row.income_head as PresumptiveActivitySnapshotRow["incomeHead"],
          amount: toNum(row.amount),
          activityType:
            typeof raw === "string" &&
            Object.prototype.hasOwnProperty.call(PRESUMPTIVE_ACTIVITY_ELIGIBILITY, raw)
              ? (raw as PresumptiveActivityType)
              : null,
          bankingChannelsConfirmed:
            row.income_head === "presumptive_professional_44ada" &&
            row.receipts_via_banking_channels === true,
        });
      }),
    ),
  });
}

export type PresumptiveActivitySnapshotVerification =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/**
 * Verify the stored contract against the snapshot's own engine rows. This is
 * the pure/read-side half of TAX-SAFE-03; the database helper additionally
 * compares the same contract with current live rows at reliance time.
 */
export function verifyStoredPresumptiveActivityEligibility(
  income: readonly IncomeEntry[],
  contract: unknown,
): PresumptiveActivitySnapshotVerification {
  const presumptiveIncome = income.filter((entry) => isPresumptiveHead(entry.category));
  if (presumptiveIncome.length === 0) return { ok: true };
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    return { ok: false, reason: "missing activity eligibility contract" };
  }
  const value = contract as Record<string, unknown>;
  if (value.version !== PRESUMPTIVE_ACTIVITY_SNAPSHOT_VERSION) {
    return { ok: false, reason: "unknown activity eligibility contract version" };
  }
  if (value.eligible !== true || !Array.isArray(value.rows)) {
    return { ok: false, reason: "activity eligibility verdict is absent, malformed or false" };
  }

  const rows = value.rows as unknown[];
  if (rows.length !== presumptiveIncome.length) {
    return { ok: false, reason: "activity provenance row count differs from engine input" };
  }
  const byId = new Map(presumptiveIncome.map((entry) => [entry.id, entry]));
  const seen = new Set<string>();
  for (const raw of rows) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, reason: "activity provenance row is malformed" };
    }
    const row = raw as Record<string, unknown>;
    if (
      typeof row.ledgerId !== "string" ||
      typeof row.incomeHead !== "string" ||
      !isPresumptiveHead(row.incomeHead) ||
      typeof row.amount !== "number" ||
      !Number.isFinite(row.amount) ||
      typeof row.activityType !== "string" ||
      !Object.prototype.hasOwnProperty.call(PRESUMPTIVE_ACTIVITY_ELIGIBILITY, row.activityType) ||
      typeof row.bankingChannelsConfirmed !== "boolean" ||
      seen.has(row.ledgerId)
    ) {
      return { ok: false, reason: "activity provenance fields are malformed or duplicated" };
    }
    seen.add(row.ledgerId);
    const entry = byId.get(row.ledgerId);
    if (!entry || entry.category !== row.incomeHead || entry.amount !== row.amount) {
      return { ok: false, reason: "activity provenance does not match the snapshot engine input" };
    }
    const scheme: PresumptiveScheme =
      row.incomeHead === "presumptive_professional_44ada" ? "44ADA" : "44AD";
    if (!gatePresumptiveActivity(scheme, [{ presumptive_activity_type: row.activityType }]).ok) {
      return { ok: false, reason: "stored activity is not eligible for its presumptive scheme" };
    }
  }
  return { ok: true };
}

/**
 * Build the engine input + traceability + warnings from live ledger rows.
 * Pure and deterministic.
 */
export interface BroughtForwardWindowInput {
  readonly currentAssessmentYear: string;
  /** 111A gains SURVIVING within-year set-off. */
  readonly netStcg111a: number;
  /** 112A gains SURVIVING within-year set-off. */
  readonly netLtcg112a: number;
  /** Records that passed expiry / filing-eligibility admission. */
  readonly admitted: readonly BroughtForwardLossEntry[];
}

/**
 * K4-10 — THE RELEASE GATE, as one named predicate.
 *
 * True when the brought-forward allocation is FORCED: every lawful allocation
 * policy produces the identical result, so applying the versioned
 * `portal_default_ay2026_27` policy is not making a choice that a source would
 * have to justify. `D112`/`D113` forbid shipping a hard-coded "statutory
 * allocation order", and no source establishing one exists — so this predicate,
 * not a sequence, is what makes the feature safe to ship.
 *
 * TWO independent conditions, both required:
 *
 *   (W1) CROSS-TYPE. A brought-forward short-term loss may lawfully reach
 *        either bucket (s.74(1)(a)); a long-term one only the long-term bucket
 *        (s.74(1)(b)). The choice is live exactly when a short-term loss exists
 *        AND the long-term bucket has gains AND something competes for them —
 *        either short-term gains (the STCL could go either way) or a
 *        brought-forward LTCL (the two losses compete for one bucket).
 *   (W2) INTRA-TYPE. When two or more records of the SAME type are only PARTLY
 *        absorbed, which record's residual survives — and therefore when it
 *        expires under s.74(2) — depends on consumption order. No official
 *        artifact states an intra-type order (it is declared on the policy's
 *        own `unreproducedAspects`), so partial absorption across several
 *        records of one type is refused.
 *
 * Verified by brute force over all maximal lawful allocations, not asserted —
 * see `brought-forward-set-off.test.ts`, which also proves the window is a real
 * constraint by showing disagreements DO occur outside it.
 */
export function broughtForwardAllocationIsForced(input: BroughtForwardWindowInput): boolean {
  const { admitted, netStcg111a, netLtcg112a } = input;
  const totalOf = (type: BroughtForwardLossEntry["lossType"]) =>
    admitted.filter((e) => e.lossType === type).reduce((sum, e) => sum + e.amount, 0);
  const countOf = (type: BroughtForwardLossEntry["lossType"]) =>
    admitted.filter((e) => e.lossType === type && e.amount > 0).length;

  const ltclTotal = totalOf("ltcl");
  const stclTotal = totalOf("stcl");

  const crossTypeForced =
    stclTotal === 0 || netLtcg112a === 0 || (netStcg111a === 0 && ltclTotal === 0);
  if (!crossTypeForced) return false;

  // The forced result, computed by the ENGINE rather than re-derived here.
  // Inside W1 every lawful policy agrees, so the portal-default run IS the
  // forced allocation and reading W2 off it introduces no second authority.
  const forced = computeBroughtForwardSetOff({
    currentAssessmentYear: input.currentAssessmentYear,
    netStcg111a,
    netLtcg112a,
    entries: admitted,
    policyId: "portal_default_ay2026_27",
  });
  const absorbedOf = (type: BroughtForwardLossEntry["lossType"]) =>
    forced.allocations.filter((a) => a.lossType === type).reduce((sum, a) => sum + a.amount, 0);

  const intraTypeForcedFor = (type: BroughtForwardLossEntry["lossType"]) => {
    const absorbed = absorbedOf(type);
    return countOf(type) <= 1 || absorbed === totalOf(type) || absorbed === 0;
  };
  return intraTypeForcedFor("ltcl") && intraTypeForcedFor("stcl");
}

export function buildEngineInput(rows: LedgerRows, meta: CaseMeta): AdapterResult {
  const income: IncomeEntry[] = [];
  const taxPaid: TaxPaidEntry[] = [];
  const deductions: DeductionEntry[] = [];
  const capitalGains: CapitalGainEntry[] = [];
  const warnings: MappingWarning[] = [];
  const excludedLedgerIds: string[] = [];
  const sourceRecordIds: string[] = [];
  // K4-04: true when any non-zero business_income row is seen below — the SAME
  // nonzero check that already excludes such rows via UNSUPPORTED_INCOME_HEAD.
  let hasBusinessOrProfessionalIncome = false;

  // Source-trace accumulation keyed by group.
  const traceMap = new Map<string, SourceTraceGroup>();
  const addTrace = (
    key: string,
    label: string,
    ledgerKind: SourceTraceGroup["ledgerKind"],
    id: string,
    sourceType: string,
    label2: string | null,
    amount: number,
  ) => {
    let g = traceMap.get(key);
    if (!g) {
      g = { key, label, ledgerKind, ledgerIds: [], sourceTypes: [], documentLabels: [], total: 0 };
      traceMap.set(key, g);
    }
    g.ledgerIds.push(id);
    if (!g.sourceTypes.includes(sourceType)) g.sourceTypes.push(sourceType);
    if (label2 && !g.documentLabels.includes(label2)) g.documentLabels.push(label2);
    // Every traced amount originates in numeric(14,2). Keep the presentation
    // aggregate on the same integer-paise boundary as admission and engine
    // totals so exact cancellations cannot surface as an order-dependent -₹0.
    g.total = (toPaise(g.total) + toPaise(amount)) / 100;
  };

  // --- Income ---
  // K4-07: presumptive professional (44ADA) rows need an AGGREGATE
  // eligibility-ceiling check (the ₹50L/₹75L ceiling applies to the whole
  // profession's gross receipts, not any one engagement) — collected here,
  // decided once every income row has been seen below.
  const presumptive44adaRows: IncomeLedgerRow[] = [];
  // K4-08: both Section 44AD heads collected together — the eligibility
  // ceiling and the 5%-cash test are both properties of the AGGREGATE, so
  // neither can be decided until every income row has been seen.
  const presumptive44adRows: IncomeLedgerRow[] = [];
  for (const r of rows.income) {
    const amount = toNum(r.amount);
    const head = r.income_head;
    if (SLAB_INCOME_HEADS.has(head as IncomeCategory)) {
      income.push({
        id: r.id,
        amount,
        sourceType: r.source_type as IncomeEntry["sourceType"],
        sourceDocumentId: r.source_document_id ?? undefined,
        category: head as IncomeCategory,
      });
      sourceRecordIds.push(r.id);
      addTrace(`income:${head}`, `Income — ${head}`, "income", r.id, r.source_type, docLabel(r), amount);
    } else if (PLACEHOLDER_INCOME_HEADS.has(head)) {
      if (amount !== 0) {
        warnings.push({
          code: "UNSUPPORTED_INCOME_HEAD",
          ledgerKind: "income",
          ledgerId: r.id,
          entryType: head,
          amount,
          message: `${head} (₹${amount}) is not computed by the AY 2026-27 engine yet — excluded from this preview.`,
        });
        excludedLedgerIds.push(r.id);
        if (head === "business_income") hasBusinessOrProfessionalIncome = true;
      }
    } else if (head === "presumptive_professional_44ada") {
      if (amount !== 0) presumptive44adaRows.push(r);
    } else if (
      head === "presumptive_business_44ad_digital" ||
      head === "presumptive_business_44ad_cash"
    ) {
      if (amount !== 0) presumptive44adRows.push(r);
    }
  }

  // K4-07: decide once, for every live presumptive-44ADA row together. The
  // higher ₹75L ceiling applies only when EVERY row confirms receipts are
  // predominantly via banking channels — a single row that does not confirm
  // it (false/null) conservatively caps the WHOLE aggregate at ₹50L, never
  // guessed from a per-row split the ledger does not capture.
  if (presumptive44adaRows.length > 0) {
    const totalReceipts = presumptive44adaRows.reduce((sum, r) => sum + toNum(r.amount), 0);
    const allDigital = presumptive44adaRows.every((r) => r.receipts_via_banking_channels === true);
    const ceiling = allDigital
      ? PRESUMPTIVE_44ADA.grossReceiptsCeilingDigital
      : PRESUMPTIVE_44ADA.grossReceiptsCeiling;
    // K4-13 (D217): the eligible-ACTIVITY test runs BEFORE the ceiling test.
    // Section 44ADA(1) applies only to a Section 44AA(1) profession, so if the
    // scheme is not available to this activity at all, how much was received
    // under it is not a question worth answering — and reporting the ceiling
    // instead would tell a preparer to reduce receipts when the real defect is
    // that the scheme does not apply.
    const activityGate = gatePresumptiveActivity("44ADA", presumptive44adaRows);
    if (!activityGate.ok) {
      // Same AUDIT-03-F9 / D86 rule as both ceiling branches: the taxpayer HAS
      // professional income; this branch only means the engine will not compute
      // it presumptively. Excluding the rows must never be read as "no
      // business/professional income exists", which is what validate-case.ts's
      // Section 207(2) disclosure would otherwise state in writing.
      hasBusinessOrProfessionalIncome = true;
      for (const r of presumptive44adaRows) {
        warnings.push({
          code: activityGate.code,
          ledgerKind: "income",
          ledgerId: r.id,
          entryType: r.income_head,
          amount: toNum(r.amount),
          message: activityGate.message,
        });
        excludedLedgerIds.push(r.id);
      }
    } else if (totalReceipts > ceiling) {
      // AUDIT-03-F9: the taxpayer HAS professional income — this branch only
      // means the engine cannot compute it presumptively. Excluding the rows
      // from the computation must never be read as "no business/professional
      // income exists", which is what `validate-case.ts`'s Section 207(2)
      // disclosure would otherwise state in writing to a resident senior with
      // gross receipts above the ceiling. Same precedent as the excluded
      // `business_income` row above: exclusion from the engine input does not
      // retract the underlying declared fact.
      hasBusinessOrProfessionalIncome = true;
      for (const r of presumptive44adaRows) {
        const amount = toNum(r.amount);
        warnings.push({
          code: "PRESUMPTIVE_44ADA_CEILING_EXCEEDED",
          ledgerKind: "income",
          ledgerId: r.id,
          entryType: r.income_head,
          amount,
          message:
            `Aggregate presumptive professional (44ADA) gross receipts of ₹${totalReceipts} exceed the ` +
            `applicable eligibility ceiling of ₹${ceiling} — this taxpayer is not eligible for Section 44ADA ` +
            "presumptive taxation and this engine does not compute the books-based alternative; excluded from " +
            "this preview.",
        });
        excludedLedgerIds.push(r.id);
      }
    } else {
      for (const r of presumptive44adaRows) {
        const amount = toNum(r.amount);
        income.push({
          id: r.id,
          amount,
          sourceType: r.source_type as IncomeEntry["sourceType"],
          sourceDocumentId: r.source_document_id ?? undefined,
          category: "presumptive_professional_44ada",
        });
        sourceRecordIds.push(r.id);
        addTrace(
          "income:presumptive_professional_44ada",
          "Income — presumptive professional (44ADA)",
          "income",
          r.id,
          r.source_type,
          docLabel(r),
          amount,
        );
        hasBusinessOrProfessionalIncome = true;
      }
    }
  }

  // K4-08: decide once, for every live Section 44AD row together. Unlike
  // 44ADA's staff-asserted `receipts_via_banking_channels` boolean, the
  // enhanced-ceiling condition here is DERIVED from the declared split —
  // the enhanced ₹3cr ceiling applies only when cash turnover is at most 5%
  // of aggregate turnover, a share no one can assert against the numbers.
  if (presumptive44adRows.length > 0) {
    const cashTurnover = presumptive44adRows
      .filter((r) => r.income_head === "presumptive_business_44ad_cash")
      .reduce((sum, r) => sum + toNum(r.amount), 0);
    const totalTurnover = presumptive44adRows.reduce((sum, r) => sum + toNum(r.amount), 0);
    const lowCash =
      totalTurnover > 0 &&
      cashTurnover <= totalTurnover * PRESUMPTIVE_44AD.lowCashReceiptsShare;
    const ceiling = lowCash
      ? PRESUMPTIVE_44AD.turnoverCeilingLowCash
      : PRESUMPTIVE_44AD.turnoverCeiling;
    // K4-13 (D217): eligible-ACTIVITY test first, for the same reason as the
    // 44ADA branch above — Section 44AD(6) and the "eligible business"
    // definition decide whether the scheme is available at all, which is prior
    // to how much turnover it could have covered.
    const activityGate = gatePresumptiveActivity("44AD", presumptive44adRows);
    if (!activityGate.ok) {
      // AUDIT-03-F9 / D86 again: the declared business income is not retracted
      // by being excluded from the engine input.
      hasBusinessOrProfessionalIncome = true;
      for (const r of presumptive44adRows) {
        warnings.push({
          code: activityGate.code,
          ledgerKind: "income",
          ledgerId: r.id,
          entryType: r.income_head,
          amount: toNum(r.amount),
          message: activityGate.message,
        });
        excludedLedgerIds.push(r.id);
      }
    } else if (totalTurnover > ceiling) {
      // Same AUDIT-03-F9 / D86 reasoning as the 44ADA branch above: the
      // taxpayer HAS business income — this branch only means the engine
      // cannot compute it presumptively. Set on BOTH branches, and pinned
      // together by one test, so the Section 207(2) disclosure can never
      // tell a resident senior above the ceiling that they have no
      // business income.
      hasBusinessOrProfessionalIncome = true;
      for (const r of presumptive44adRows) {
        const amount = toNum(r.amount);
        warnings.push({
          code: "PRESUMPTIVE_44AD_CEILING_EXCEEDED",
          ledgerKind: "income",
          ledgerId: r.id,
          entryType: r.income_head,
          amount,
          message:
            `Aggregate presumptive business (44AD) turnover of ₹${totalTurnover} exceeds the applicable ` +
            `eligibility ceiling of ₹${ceiling} — this taxpayer is not eligible for Section 44AD ` +
            "presumptive taxation and this engine does not compute the books-based alternative; excluded " +
            "from this preview.",
        });
        excludedLedgerIds.push(r.id);
      }
    } else {
      for (const r of presumptive44adRows) {
        const amount = toNum(r.amount);
        const category = r.income_head as "presumptive_business_44ad_digital" | "presumptive_business_44ad_cash";
        income.push({
          id: r.id,
          amount,
          sourceType: r.source_type as IncomeEntry["sourceType"],
          sourceDocumentId: r.source_document_id ?? undefined,
          category,
        });
        sourceRecordIds.push(r.id);
        addTrace(
          `income:${category}`,
          category === "presumptive_business_44ad_digital"
            ? "Income — presumptive business (44AD), banking/electronic-mode turnover"
            : "Income — presumptive business (44AD), cash turnover",
          "income",
          r.id,
          r.source_type,
          docLabel(r),
          amount,
        );
        hasBusinessOrProfessionalIncome = true;
      }
    }
  }

  // --- Tax paid ---
  for (const r of rows.taxPaid) {
    const amount = toNum(r.amount);
    if (TAX_PAID_TYPES.has(r.tax_paid_type as TaxPaidCategory)) {
      taxPaid.push({
        id: r.id,
        amount,
        sourceType: r.source_type as TaxPaidEntry["sourceType"],
        sourceDocumentId: r.source_document_id ?? undefined,
        category: r.tax_paid_type as TaxPaidCategory,
      });
      sourceRecordIds.push(r.id);
      addTrace(`tax_paid:${r.tax_paid_type}`, `Tax paid — ${r.tax_paid_type}`, "tax_paid", r.id, r.source_type, docLabel(r), amount);
    }
  }

  // --- Deductions --- (other_deductions → engine "other")
  for (const r of rows.deductions) {
    const amount = toNum(r.amount);
    const section: DeductionSection | null = DEDUCTION_SECTIONS.has(r.deduction_type as DeductionSection)
      ? (r.deduction_type as DeductionSection)
      : r.deduction_type === "other_deductions"
        ? "other"
        : null;
    if (section) {
      deductions.push({
        id: r.id,
        amount,
        sourceType: r.source_type as DeductionEntry["sourceType"],
        sourceDocumentId: r.source_document_id ?? undefined,
        proofDocumentId: r.proof_case_document_id ?? undefined,
        section,
        insuredPartySenior: r.insured_party_senior === true,
      });
      sourceRecordIds.push(r.id);
      addTrace(`deduction:${section}`, `Deduction — ${section}`, "deduction", r.id, r.source_type, docLabel(r), amount);
    }
  }

  // --- Capital gains (K4-09: within-year loss set-off) ---
  // This is a CASE-LEVEL decision, so it needs the aggregates before any row
  // can be admitted — a loss row is only computable in the context of the
  // gains available to absorb it. Hence two passes rather than the previous
  // single row-by-row loop.
  //
  // See `rules.ts`'s CAPITAL_LOSS_SET_OFF doc for the sourcing and for WHY the
  // supported window is shaped this way. In short: two ordering questions
  // (loss-vs-₹1,25,000-exemption, and short-term-loss-to-which-bucket) could
  // not be resolved from any source reachable this session, so this adapter
  // admits only the cases in which BOTH are provably immaterial and excludes
  // every other loss case IN FULL — never a partial or guessed set-off.
  const supportedGainRows = rows.capitalGains.filter((r) => SUPPORTED_GAINS.has(r.gain_type));
  let grossStcg111a = 0;
  let grossLtcg112a = 0;
  let stcl111a = 0;
  let ltcl112a = 0;
  for (const r of supportedGainRows) {
    const gain = toNum(r.taxable_gain);
    if (r.gain_type === "stcg_111a") {
      if (gain < 0) stcl111a += -gain;
      else grossStcg111a += gain;
    } else {
      if (gain < 0) ltcl112a += -gain;
      else grossLtcg112a += gain;
    }
  }

  const lossDeclared = stcl111a > 0 || ltcl112a > 0;
  // Q2 (elective ordering) is material exactly when a short-term loss could
  // lawfully be absorbed by EITHER bucket — i.e. a 112A gain also exists.
  const electiveOrdering = stcl111a > 0 && grossLtcg112a > 0;
  // Q1 (the ₹1,25,000 threshold) is material exactly when a long-term loss
  // exceeds the 112A gains ABOVE that threshold; at or below that cap both
  // readings agree on the taxable amount AND on a zero residual.
  const ltclWindow = Math.max(0, grossLtcg112a - CAPITAL_GAINS.ltcg112aExemption);
  const longTermLossOutsideWindow = ltcl112a > ltclWindow;
  const shortTermLossOutsideWindow = stcl111a > grossStcg111a;
  const lossUnsupported =
    lossDeclared && (electiveOrdering || longTermLossOutsideWindow || shortTermLossOutsideWindow);

  // --- Brought-forward capital losses (K4-10, Section 74) ---
  //
  // Same CASE-LEVEL shape as the within-year decision above, and for the same
  // reason: whether a brought-forward record can be admitted depends on the
  // gains available to absorb it, which is not knowable row by row.
  //
  // THE WINDOW. `D112`/`D113` forbid shipping a hard-coded "statutory
  // allocation order", because none was found: no CBDT circular or rule makes
  // any intra-head rate-bucket sequence mandatory, and the official utility
  // itself treats its sequence as a default over a taxpayer-supplied
  // allocation. So this adapter admits ONLY cases in which the allocation is
  // FORCED — where every lawful policy produces the identical result, and the
  // named `portal_default_ay2026_27` policy is therefore not making a choice.
  // Two independent conditions have to hold:
  //
  //   (W1) CROSS-TYPE. A brought-forward short-term loss may lawfully reach
  //        either bucket (s.74(1)(a)), and a long-term one only the long-term
  //        bucket (s.74(1)(b)). The choice is live exactly when a short-term
  //        loss exists AND the long-term bucket has gains AND something else
  //        competes for them — either short-term gains (so the STCL could go
  //        either way) or a brought-forward LTCL (so the two losses compete).
  //   (W2) INTRA-TYPE. When two or more records of the SAME type are only
  //        PARTLY absorbed, which record's residual survives — and therefore
  //        when it expires under s.74(2) — depends on the order they are
  //        consumed in. No artifact states an intra-type order, so a partial
  //        absorption across several records of one type is refused too.
  //
  // Outside the window every capital-gain row AND every brought-forward row is
  // excluded TOGETHER, never the loss alone: dropping only the loss would
  // silently overstate taxable gains, which is the `K4-00` silent-exclusion
  // class this whole discipline exists to prevent.
  const bfRows = rows.broughtForwardLosses ?? [];
  const bfEntries: BroughtForwardLossEntry[] = bfRows.map((r) => ({
    id: r.id,
    originatingAssessmentYear: r.originating_assessment_year,
    lossType: r.loss_type as BroughtForwardLossEntry["lossType"],
    amount: toNum(r.amount),
    filingEligibility: r.filing_eligibility as BroughtForwardLossEntry["filingEligibility"],
    provenance: r.loss_provenance as BroughtForwardLossEntry["provenance"],
    priorTaxCaseId: r.prior_tax_case_id ?? null,
    electedSetOffTarget: (r.elected_set_off_target ??
      null) as BroughtForwardLossEntry["electedSetOffTarget"],
    sourceType: r.source_type as BroughtForwardLossEntry["sourceType"],
    sourceDocumentId: r.source_document_id ?? undefined,
  }));

  // Classification uses the ENGINE's own admission rule — never a second copy
  // of the s.74(2) expiry or s.139(3)/80 eligibility test living here.
  const bfAdmissions = bfEntries.map((entry) => ({
    entry,
    decision: admitBroughtForwardRecord(entry, meta.assessmentYear),
  }));
  const bfAdmitted = bfAdmissions.filter((a) => a.decision.admitted).map((a) => a.entry);
  // The FAIL-CLOSED exclusion reasons — an ABSENCE of knowledge, as opposed to
  // expiry or a known-ineligible filing, which are positive legal conclusions
  // with a known correct treatment and are merely disclosed. All three of these
  // mean the record cannot be evaluated at all, so the case is refused rather
  // than computed with the record quietly dropped.
  const BF_FAIL_CLOSED_REASONS = new Set([
    "filing_eligibility_unverified",
    "unparseable_originating_assessment_year",
    "not_a_prior_assessment_year",
  ]);
  const bfFilingUnverified = bfAdmissions.filter(
    (a) => !a.decision.admitted && BF_FAIL_CLOSED_REASONS.has(a.decision.exclusion.reason),
  );

  // Gains SURVIVING the within-year set-off — what s.74 actually reaches.
  const netStcgAfterWithinYear = grossStcg111a - Math.min(stcl111a, grossStcg111a);
  const netLtcgAfterWithinYear = grossLtcg112a - Math.min(ltcl112a, grossLtcg112a);

  const bfAllocationElective =
    bfAdmitted.length > 0 &&
    !broughtForwardAllocationIsForced({
      currentAssessmentYear: meta.assessmentYear,
      netStcg111a: netStcgAfterWithinYear,
      netLtcg112a: netLtcgAfterWithinYear,
      admitted: bfAdmitted,
    });

  // A recorded election is checked against what the portal default produces on
  // the identical figures. Divergence stops the case for review — it is never
  // silently replaced by the default and never silently accepted.
  const bfPolicyId = resolveLossAllocationPolicyId(bfAdmitted);
  const bfElected =
    bfPolicyId === "taxpayer_elected"
      ? computeBroughtForwardSetOff({
          currentAssessmentYear: meta.assessmentYear,
          netStcg111a: netStcgAfterWithinYear,
          netLtcg112a: netLtcgAfterWithinYear,
          entries: bfAdmitted,
          policyId: "taxpayer_elected",
        })
      : null;
  const bfElectionDiverges = (bfElected?.electionDivergences.length ?? 0) > 0;

  // Split the fail-closed set by REASON so the refusal names what actually
  // happened. "Filing eligibility unverified" and "this year cannot be read"
  // are different problems with different fixes, and telling a preparer the
  // wrong one wastes their time.
  const bfUnverifiedFiling = bfFilingUnverified.filter(
    (a) => !a.decision.admitted && a.decision.exclusion.reason === "filing_eligibility_unverified",
  );
  const bfRefusalCode: MappingWarningCode | null = bfUnverifiedFiling.length
    ? "BROUGHT_FORWARD_LOSS_FILING_UNVERIFIED"
    : bfFilingUnverified.length
      ? "BROUGHT_FORWARD_LOSS_RECORD_UNUSABLE"
      : bfElectionDiverges
        ? "BROUGHT_FORWARD_LOSS_ELECTION_DIVERGES"
        : bfAllocationElective
          ? "BROUGHT_FORWARD_LOSS_ALLOCATION_ELECTIVE"
          : null;

  const bfRefusalMessage = bfUnverifiedFiling.length
    ? "This case holds a brought-forward capital loss whose Section 139(3)/80 filing eligibility is " +
      `UNVERIFIED (${bfUnverifiedFiling
        .map((a) => `AY ${a.entry.originatingAssessmentYear}`)
        .join(", ")}). A loss is carryable only if that year's loss return was filed by the due ` +
      "date, and an unverified condition is never treated as satisfied — all capital-gain and " +
      "brought-forward rows are excluded from this preview until it is confirmed."
    : bfFilingUnverified.length
      ? "This case holds a brought-forward capital loss whose originating assessment year cannot be " +
        `evaluated (${bfFilingUnverified
          .map((a) => JSON.stringify(a.entry.originatingAssessmentYear))
          .join(", ")}). It is either not a well-formed YYYY-YY assessment year or not EARLIER than ` +
        "the current one, so the Section 74(2) eight-year window cannot be applied to it. No year " +
        "was assumed — all capital-gain and brought-forward rows are excluded until it is corrected."
    : bfElectionDiverges
      ? "This case records a taxpayer-elected set-off allocation that is either not lawful under " +
        "Section 74(1) or does not reproduce the portal default for ITR-2 utility v1.2 / JSON " +
        "schema v1.1 / validation rules v1.0. It has NOT been replaced by the default and has NOT " +
        "been accepted — all capital-gain and brought-forward rows are excluded pending " +
        "independent professional review."
      : "This case's brought-forward capital-loss allocation is not forced: two lawful allocations " +
        "would give different results (which gains absorb a brought-forward short-term loss, or " +
        "which of several same-type records is consumed first and therefore which residual " +
        "survives). No source makes any allocation sequence mandatory, so this engine does not " +
        "choose one — all capital-gain and brought-forward rows are excluded from this preview.";

  // ONE refusal flag for the whole capital-gains computation, within-year and
  // brought-forward alike. They are one indivisible calculation.
  /**
   * K4-23 review F3 + F5 (P1) — a declared OR carried-forward capital loss
   * refuses a house-sale row.
   *
   * F3 (current year): the `lossUnsupported` aggregation above walks
   * `SUPPORTED_GAINS`, which is `stcg_111a` and `ltcg_112a` only. A
   * house-sale gain is invisible to every test in it, so a 112A gain with a
   * small in-window LTCL left the gate open and the loss was quietly fixed
   * against the 112A bucket.
   *
   * F5 (brought forward): `lossDeclared` sees only CURRENT-YEAR negative
   * rows. A case with an admitted brought-forward loss, a 112A gain and a
   * house-sale LTCG has `lossDeclared === false`, and `bfRefusalCode` can be
   * null too, because it tests allocation across the 111A/112A buckets only.
   * That case computed. `k4-23-phase-a-decision-packet.md` §5 requires
   * adapter exclusion for ANY carry-forward interaction with this head.
   *
   * Both legs ask one question: does a loss exist that COULD lawfully have
   * been allocated to the house-sale head instead? Not whether the 111A/112A
   * ordering happened to be immaterial. A long-term house-sale gain is taxed
   * through a PER-PROPERTY s.112 comparator rather than at a flat rate, so
   * the two allocations are not equivalent and nothing here chooses between
   * them.
   *
   * `bfAdmitted` is the right input rather than `bfRows`: a rejected or
   * unusable carry-forward record cannot be allocated anywhere, so it raises
   * no ambiguity for this head. Its own refusal path is `bfRefusalCode`.
   */
  const houseSaleLossInteractionRefused = lossDeclared || bfAdmitted.length > 0;
  const capitalComputationRefused = lossUnsupported || bfRefusalCode !== null;

  for (const r of rows.capitalGains) {
    const gain = toNum(r.taxable_gain);
    const type = r.gain_type;
    if (SUPPORTED_GAINS.has(type)) {
      if (capitalComputationRefused) {
        // Every supported-gain row is excluded TOGETHER — a loss and the gains
        // that would have absorbed it are one indivisible computation, so
        // excluding only the loss row would silently OVERSTATE taxable gains.
        // K4-10 widens the same rule to brought-forward records below.
        warnings.push({
          code: lossUnsupported
            ? electiveOrdering
              ? "CAPITAL_LOSS_SETOFF_ORDER_ELECTIVE"
              : "CAPITAL_LOSS_NOT_MODELLED"
            : (bfRefusalCode as MappingWarningCode),
          ledgerKind: "capital_gain",
          ledgerId: r.id,
          entryType: type,
          amount: gain,
          message: !lossUnsupported
            ? bfRefusalMessage
            : electiveOrdering
              ? `This case declares a short-term capital loss (₹${stcl111a}) alongside both 111A and 112A ` +
                "gains. Which gains absorb it first is a taxpayer election that changes the tax (111A is " +
                "taxed at 20%, 112A at 12.5%), and this engine does not make that election — all " +
                "capital-gain rows are excluded from this preview."
              : "This case's declared capital loss cannot be fully set off within the year (short-term " +
                `₹${stcl111a} against ₹${grossStcg111a}; long-term ₹${ltcl112a} against ₹${ltclWindow} of ` +
                `112A gains above the ₹${CAPITAL_GAINS.ltcg112aExemption} exemption). The unabsorbed part ` +
                "would have to be carried forward under Section 74, which is not modelled — all " +
                "capital-gain rows are excluded from this preview.",
        });
        excludedLedgerIds.push(r.id);
        continue;
      }
      capitalGains.push({
        id: r.id,
        amount: gain,
        sourceType: r.source_type as CapitalGainEntry["sourceType"],
        category: type as CapitalGainEntry["category"],
        sale_value: toNum(r.sale_value),
        cost: toNum(r.cost),
        expenses: toNum(r.expenses),
        exemption_claimed: toNum(r.exemption_claimed),
        taxable_gain: gain,
        source_document_id: r.source_document_id ?? undefined,
      });
      sourceRecordIds.push(r.id);
      addTrace(`capital_gain:${type}`, `Capital gain — ${type}`, "capital_gain", r.id, r.source_type, docLabel(r), gain);
    } else if (type === HOUSE_SALE_GAIN) {
      const declared = Array.isArray(r.house_sale_declarations) ? r.house_sale_declarations : [];
      const missing = HOUSE_SALE_REQUIRED_DECLARATIONS.filter((d) => !declared.includes(d));
      const assetOk = (HOUSE_SALE_ASSET_KINDS as readonly string[]).includes(String(r.asset_kind ?? ""));
      const modeOk = (HOUSE_SALE_ACQUISITION_MODES as readonly string[]).includes(
        String(r.acquisition_mode ?? ""),
      );
      const computed = computeHouseSale({
        consideration: toNum(r.sale_value),
        costOfAcquisition: toNum(r.cost),
        costOfImprovement: toNum(r.cost_of_improvement),
        transferExpenses: toNum(r.expenses),
        stampDutyValue: toNum(r.stamp_duty_value),
        transferDate: String(r.transfer_date ?? ""),
        acquisitionDate: String(r.acquisition_date ?? ""),
        assetKind: assetOk ? (r.asset_kind as "land" | "building" | "both") : "building",
        acquisitionMode: modeOk ? "purchase" : "purchase",
        exemptionClaimed: toNum(r.exemption_claimed),
        interestIncludedInCost: !declared.includes("interest_not_in_cost"),
        agriculturalLand: !declared.includes("not_agricultural_land"),
        depreciableAsset: !declared.includes("not_depreciable_asset"),
        agreementDateDiffersFromRegistration: !declared.includes(
          "agreement_and_registration_same_date",
        ),
        // K4-23 / D337 items 7 and 11 — read only on the long-term path.
        // Positive attestations, so absence is `false` and refuses; silence
        // is never read as "yes" (the K4-21 convention, unchanged).
        amountsAreAssesseeShare: declared.includes("amounts_are_assessee_share"),
        stampDutyValueAccepted: declared.includes("stamp_duty_value_accepted"),
      });
      const refuse =
        missing.length > 0 ||
        !assetOk ||
        !modeOk ||
        !r.transfer_date ||
        !r.acquisition_date ||
        r.stamp_duty_value == null ||
        r.stamp_duty_value === "" ||
        computed.outcome === "refused" ||
        capitalComputationRefused ||
        // K4-23 review F3 (P1) — see `houseSaleLossInteractionRefused`.
        houseSaleLossInteractionRefused;
      if (refuse) {
        const reason =
          computed.outcome === "refused"
            ? computed.reason
            : missing.length > 0
              ? `House-sale declarations are incomplete (missing ${missing.join(", ")}). Silence is never read as "no".`
              : capitalComputationRefused || houseSaleLossInteractionRefused
                ? "A capital loss is also declared. A house sale is a lawful s.70 destination — for a long-term sale the loss could be allocated against a gain taxed through the s.112 per-property comparator rather than at a flat rate, so the two allocations are not equivalent. The K4-09 set-off window cannot stay closed and the house-sale row is excluded."
                : "House-sale facts are incomplete (dates, stamp duty value, asset kind or acquisition mode).";
        warnings.push({
          code: "HOUSE_SALE_UNSUPPORTED",
          ledgerKind: "capital_gain",
          ledgerId: r.id,
          entryType: type,
          amount: computed.outcome === "computed" ? computed.taxableGain : gain,
          message: reason,
        });
        excludedLedgerIds.push(r.id);
      } else if (computed.outcome === "computed") {
        capitalGains.push({
          id: r.id,
          amount: computed.taxableGain,
          sourceType: r.source_type as CapitalGainEntry["sourceType"],
          category: "house_sale",
          sale_value: toNum(r.sale_value),
          cost: toNum(r.cost),
          expenses: toNum(r.expenses),
          exemption_claimed: toNum(r.exemption_claimed),
          taxable_gain: computed.taxableGain,
          source_document_id: r.source_document_id ?? undefined,
          houseSale: {
            transferDate: String(r.transfer_date),
            acquisitionDate: String(r.acquisition_date),
            stampDutyValue: toNum(r.stamp_duty_value),
            assetKind: r.asset_kind as "land" | "building" | "both",
            acquisitionMode: "purchase",
            costOfImprovement: toNum(r.cost_of_improvement),
            interestIncludedInCost: false,
            agriculturalLand: false,
            depreciableAsset: false,
            agreementDateDiffersFromRegistration: false,
            // K4-23: carried so the engine's defence-in-depth re-computation
            // reaches the SAME verdict as the adapter's. Passing `false` here
            // would make a row the adapter admitted refuse inside the engine.
            amountsAreAssesseeShare: declared.includes("amounts_are_assessee_share"),
            stampDutyValueAccepted: declared.includes("stamp_duty_value_accepted"),
          },
        });
        sourceRecordIds.push(r.id);
        addTrace(
          "capital_gain:house_sale",
          "Capital gain — house_sale",
          "capital_gain",
          r.id,
          r.source_type,
          docLabel(r),
          computed.taxableGain,
        );
      }
    } else if (PLACEHOLDER_GAINS.has(type)) {
      if (gain !== 0) {
        warnings.push({
          code: "UNSUPPORTED_GAIN_TYPE",
          ledgerKind: "capital_gain",
          ledgerId: r.id,
          entryType: type,
          amount: gain,
          message: `${type} (₹${gain}) is not computed by the AY 2026-27 engine yet — excluded from this preview.`,
        });
        excludedLedgerIds.push(r.id);
      }
    }
  }

  // --- Brought-forward loss rows: admit or exclude, always together ---
  //
  // When the capital computation is refused, EVERY brought-forward row is
  // excluded alongside every capital-gain row. When it is admitted, every
  // brought-forward row is passed to the engine — INCLUDING the expired and
  // filing-ineligible ones. That is deliberate: those are positive legal
  // conclusions with a known correct treatment, and the engine excludes them
  // itself with a disclosure naming the originating assessment year. Filtering
  // them out here instead would make the exclusion invisible, which is exactly
  // what "an expired loss is not silently dropped" forbids.
  const broughtForwardLosses: BroughtForwardLossEntry[] = [];
  for (const r of bfRows) {
    const amount = toNum(r.amount);
    if (capitalComputationRefused) {
      warnings.push({
        code: lossUnsupported
          ? electiveOrdering
            ? "CAPITAL_LOSS_SETOFF_ORDER_ELECTIVE"
            : "CAPITAL_LOSS_NOT_MODELLED"
          : (bfRefusalCode as MappingWarningCode),
        ledgerKind: "brought_forward_loss",
        ledgerId: r.id,
        entryType: `${r.loss_type}:${r.originating_assessment_year}`,
        amount,
        message: lossUnsupported
          ? "This case's CURRENT-YEAR capital-loss set-off is outside the supported window, so the " +
            "brought-forward records that would have been applied after it are excluded together " +
            "with the capital-gain rows — a brought-forward loss cannot be computed against gains " +
            "that are themselves excluded."
          : bfRefusalMessage,
      });
      excludedLedgerIds.push(r.id);
      continue;
    }
    const entry = bfEntries.find((e) => e.id === r.id);
    if (entry) broughtForwardLosses.push(entry);
    sourceRecordIds.push(r.id);
    addTrace(
      `brought_forward_loss:${r.loss_type}`,
      `Brought-forward loss — ${r.loss_type === "ltcl" ? "long-term" : "short-term"}`,
      "brought_forward_loss",
      r.id,
      r.source_type,
      docLabel(r),
      amount,
    );
  }

  // --- House property (K4-06) ---
  // Session scope: 0 or 1 live rows. More than one live row is safely
  // excluded entirely (never a guessed combination) — mirrors the existing
  // "safely blocked, not silently wrong" pattern for other unsupported
  // shapes above (K4-00's silent-exclusion audit standard).
  const housePropertyRows = rows.housePropertyEntries ?? [];
  const housePropertyEntries: HousePropertyEntry[] = [];
  if (housePropertyRows.length > 1) {
    for (const r of housePropertyRows) {
      const amount = toNum(r.annual_rent_received) - toNum(r.home_loan_interest);
      warnings.push({
        code: "MULTIPLE_HOUSE_PROPERTIES_NOT_MODELLED",
        ledgerKind: "house_property",
        ledgerId: r.id,
        entryType: r.usage,
        amount,
        message:
          "More than one house-property record exists for this case — multi-property computation is not " +
          "modelled yet (Wave-4 priority #5), so all house-property records are excluded from this preview.",
      });
      excludedLedgerIds.push(r.id);
    }
  } else if (housePropertyRows.length === 1) {
    const r = housePropertyRows[0] as HousePropertyLedgerRow;
    const usage: HousePropertyUsage = r.usage === "let_out" ? "let_out" : "self_occupied";
    housePropertyEntries.push({
      id: r.id,
      amount: toNum(r.annual_rent_received),
      sourceType: r.source_type as HousePropertyEntry["sourceType"],
      sourceDocumentId: r.source_document_id ?? undefined,
      usage,
      annualRentReceived: toNum(r.annual_rent_received),
      municipalTaxesPaid: toNum(r.municipal_taxes_paid),
      homeLoanInterest: toNum(r.home_loan_interest),
      proofDocumentId: r.proof_case_document_id ?? undefined,
    });
    sourceRecordIds.push(r.id);
    addTrace(
      "house_property",
      "Income — house property",
      "house_property",
      r.id,
      r.source_type,
      docLabel(r),
      toNum(r.annual_rent_received) - toNum(r.home_loan_interest),
    );
  }

  // --- Books-based business / profession (K4-14, aggregated by K4-15) ---
  //
  // K4-14 capped this at 0 or 1 live rows, justified by the claim that "each
  // business carries its own Section 44AB threshold, so an aggregate could not
  // be tested against one threshold". THAT REASONING WAS WRONG, and K4-15
  // replaced it after reading the section. Section 44AB(a), verbatim:
  //
  //   "carrying on business shall, if his total sales, turnover or gross receipts, as"
  //   "the case may be, in business exceed or exceeds one crore rupees in any"
  //   "previous year"
  //
  // "his TOTAL ... IN BUSINESS" is a question about the PERSON's aggregate, not
  // about one business, and Section 44AB(b) asks the same of "his gross
  // receipts in profession". So there is exactly ONE threshold test per limb,
  // applied to the sum — which is both testable and the correct test. The old
  // per-row test happened to agree with it whenever a case had one row, which
  // is why nothing caught the reasoning.
  //
  // Section 28(i) supplies the aggregation itself, verbatim: "the profits and
  // gains of ANY business or profession which was carried on by the assessee at
  // any time during the previous year". One head, every business.
  //
  // ALL-OR-NOTHING. If any live row refuses, every row is excluded. The head is
  // an aggregate, so summing the survivors would publish a figure corresponding
  // to no statutory quantity — and the Section 44AB question is asked of the
  // person's total turnover, including turnover this engine cannot compute on.
  // A row excluded for a SIBLING's reason is told so explicitly
  // (`BUSINESS_BOOKS_SIBLING_ROW_REFUSED`) rather than vanishing without a
  // reason, which is the AUDIT-03-F9 / D86 silent-exclusion class.
  //
  // Order matters and is deliberate, mirroring `K4-13`'s activity-before-
  // ceiling ordering: the DECLARED-BASIS gate runs BEFORE the audit-threshold
  // and loss checks. If the accounts need Sections 30-43D work this engine
  // does not do, then how large the turnover is, or whether the bottom line is
  // positive, are not the questions worth answering — and reporting a turnover
  // problem would send a preparer to fix the wrong thing. For a single row this
  // ordering, and every message, is unchanged from K4-14.
  const businessBooksRows = rows.businessBooksEntries ?? [];
  const businessBooksEntries: BusinessBooksEntry[] = [];
  if (businessBooksRows.length > 0) {
    // AUDIT-03-F9 / decision D86, applied here as it is on every presumptive
    // branch: the taxpayer HAS business/professional income. Every branch
    // below only decides whether this engine can COMPUTE it. Exclusion from
    // the engine input must never be read as "no business income exists",
    // which is what `validate-case.ts`'s Section 207(2) disclosure would
    // otherwise state in writing.
    hasBusinessOrProfessionalIncome = true;
  }
  if (businessBooksRows.length > 0) {
    /** One live books row, with every derived fact the gates below need. */
    type BooksCandidate = {
      row: BusinessBooksLedgerRow;
      revenue: number;
      expenses: number;
      isProfession: boolean;
      kind: "business" | "profession";
      /** Empty when the row declares no recognised member of the vocabulary. */
      adjustmentSet: BusinessBooksAdjustment[];
      /** `null` when no recognised Section 70/73/73A pool is declared. */
      activityClassification: BusinessBooksActivityClassification | null;
      /**
       * K4-18 — the figure this row contributes to the Section 44AB aggregate,
       * or `null` when the row cannot supply one.
       *
       * For a classification with `turnoverFromBooksRevenue: true` this is the
       * books revenue, exactly as before K4-18. For one with `false` it is the
       * preparer's DECLARED turnover, and `null` when they declared none — the
       * engine never falls back to revenue there, because no official source
       * equates derivative books revenue with Section 44AB turnover.
       *
       * `null` when the classification itself is unrecognised: an unclassified
       * row cannot be known to be one whose revenue is its turnover.
       */
      auditTurnover: number | null;
      bookDepreciation: number | null;
      claimsAdditionalDepreciation: boolean | null;
      depreciationBlocks: BusinessBooksDepreciationBlock[] | null;
      /** Exact numeric(14,2) difference, normalized through integer paise. */
      net: number;
    };

    const candidates: BooksCandidate[] = (businessBooksRows as BusinessBooksLedgerRow[]).map((r) => {
      const declared = r.adjustments;
      // AUDIT-08-F3 (decision D244): `hasOwnProperty`, NOT `in`. K4-20 accepts
      // a lone string (pre-K4-20 rows / snapshots) or a set. An unrecognised
      // member empties the set so gate 1 refuses as undeclared.
      const rawMembers = declared == null ? [] : Array.isArray(declared) ? declared : [declared];
      const adjustmentSet: BusinessBooksAdjustment[] = [];
      let adjustmentUnrecognised = rawMembers.length === 0;
      for (const item of rawMembers) {
        if (
          typeof item === "string" &&
          Object.prototype.hasOwnProperty.call(BUSINESS_BOOKS_ADJUSTMENTS, item)
        ) {
          adjustmentSet.push(item as BusinessBooksAdjustment);
        } else {
          adjustmentUnrecognised = true;
        }
      }
      if (adjustmentUnrecognised) adjustmentSet.length = 0;
      const declaredActivity = r.activity_classification;
      const activityClassification =
        typeof declaredActivity === "string" &&
        Object.prototype.hasOwnProperty.call(
          BUSINESS_BOOKS_ACTIVITY_CLASSIFICATIONS,
          declaredActivity,
        )
          ? (declaredActivity as BusinessBooksActivityClassification)
          : null;
      const isProfession = r.is_profession === true;
      const revenue = toNum(r.revenue);
      const expenses = toNum(r.expenses);
      // K4-18 — which figure this row may contribute to the Section 44AB
      // aggregate. Read from the classification's own `turnoverFromBooksRevenue`
      // rather than re-deciding per member here, so the engine vocabulary stays
      // the single authority and a future member cannot inherit the ordinary
      // answer by omission. An unrecognised classification contributes nothing:
      // it is already refused by gate 2, and guessing its basis would be the
      // fail-open shape this whole gate chain exists to prevent.
      const declaredTurnoverRaw = r.declared_turnover;
      const declaredTurnover =
        declaredTurnoverRaw === null || declaredTurnoverRaw === undefined
          ? null
          : toNum(declaredTurnoverRaw);
      const auditTurnover =
        activityClassification === null
          ? null
          : BUSINESS_BOOKS_ACTIVITY_CLASSIFICATIONS[activityClassification]
                .turnoverFromBooksRevenue
            ? revenue
            : declaredTurnover;
      const bookDepRaw = r.book_depreciation;
      const bookDepreciation =
        bookDepRaw === null || bookDepRaw === undefined ? null : toNum(bookDepRaw);
      const additionalRaw = r.claims_additional_depreciation;
      const claimsAdditionalDepreciation =
        additionalRaw === true ? true : additionalRaw === false ? false : null;
      const rawBlocks = r.depreciation_blocks;
      let depreciationBlocks: BusinessBooksDepreciationBlock[] | null = null;
      if (Array.isArray(rawBlocks)) {
        const parsed: BusinessBooksDepreciationBlock[] = [];
        let blocksOk = true;
        for (const item of rawBlocks) {
          if (!item || typeof item !== "object") {
            blocksOk = false;
            break;
          }
          const rec = item as { asset_class?: unknown; wdv?: unknown; put_to_use?: unknown };
          const asset = rec.asset_class;
          const put = rec.put_to_use;
          const wdv =
            rec.wdv === null || rec.wdv === undefined
              ? NaN
              : typeof rec.wdv === "number" || typeof rec.wdv === "string"
                ? toNum(rec.wdv)
                : NaN;
          if (
            typeof asset !== "string" ||
            !Object.prototype.hasOwnProperty.call(DEPRECIATION_ASSET_CLASSES, asset) ||
            typeof put !== "string" ||
            !Object.prototype.hasOwnProperty.call(DEPRECIATION_PUT_TO_USE, put) ||
            !Number.isFinite(wdv) ||
            wdv < 0
          ) {
            blocksOk = false;
            break;
          }
          parsed.push({
            assetClass: asset as BusinessBooksDepreciationBlock["assetClass"],
            wdv,
            putToUse: put as BusinessBooksDepreciationBlock["putToUse"],
          });
        }
        depreciationBlocks = blocksOk ? parsed : null;
      }
      return {
        row: r,
        revenue,
        expenses,
        isProfession,
        kind: isProfession ? "profession" : "business",
        adjustmentSet,
        activityClassification,
        auditTurnover,
        bookDepreciation,
        claimsAdditionalDepreciation,
        depreciationBlocks,
        net: currencyDifference(revenue, expenses),
      };
    });

    const refuse = (c: BooksCandidate, code: MappingWarningCode, message: string) => {
      warnings.push({
        code,
        ledgerKind: "business_books",
        ledgerId: c.row.id,
        entryType: c.kind,
        amount: c.net,
        message,
      });
      excludedLedgerIds.push(c.row.id);
    };

    /** A row's OWN reason for failing a gate — kept per row, never merged. */
    type BooksFailure = { code: MappingWarningCode; message: string };

    /**
     * Each row's OWN first applicable refusal. EVERY gate is evaluated for
     * EVERY row before anything is emitted, and the first one a row fails wins
     * — so the reported code and message are identical to what a single-row
     * case would have reported.
     *
     * The gates are NOT short-circuited on "some earlier gate already refused
     * the head", and that is load-bearing rather than tidy. `BUSINESS_BOOKS_-
     * SIBLING_ROW_REFUSED` claims that the row passes every gate against the
     * current data. A row may only be told that after it has been checked
     * against every gate. The whole head is re-evaluated after another record
     * changes; the code does not promise that remediation will preserve this
     * row's result. An earlier version stopped at the first gate
     * that fired, so an undeclared-basis row sitting next to a valid-basis ₹2
     * crore business told that business it was computable and would compute
     * once the sibling was fixed — both false, since it exceeds the Section
     * 44AB threshold on its own. Nothing was mis-COMPUTED (the head refuses
     * either way), but it would send a preparer to fix the wrong record, which
     * is the same harm the gate ORDERING comment above exists to avoid.
     */
    const ownFailure = new Map<BooksCandidate, BooksFailure>();
    const recordFailure = (c: BooksCandidate, f: BooksFailure) => {
      if (!ownFailure.has(c)) ownFailure.set(c, f);
    };

    // Gate 1 — DECLARED BASIS, per row. Runs first: if the accounts need
    // Sections 30-43D work, turnover size and sign are the wrong questions.
    // An undeclared basis and a declared-but-non-computable one fail the SAME
    // gate under DIFFERENT codes, so each row keeps its own.
    for (const c of candidates) {
      if (c.adjustmentSet.length === 0) {
        recordFailure(c, {
          code: "BUSINESS_BOOKS_ADJUSTMENTS_UNDECLARED",
          message:
            "This books-based record does not declare what its accounts require under Sections 30-43D " +
            "(depreciation, disallowances, or a move from a presumptive scheme). Section 29 computes " +
            "business income by applying those provisions, so without that declaration the taxable figure " +
            "is unknown — it is NOT assumed to be revenue minus expenses. Excluded from this preview.",
        });
        continue;
      }
      if (c.adjustmentSet.includes("none_s30_43d") && c.adjustmentSet.length > 1) {
        recordFailure(c, {
          code: "BUSINESS_BOOKS_ADJUSTMENTS_UNDECLARED",
          message:
            "This books-based record declares both that no Sections 30-43D adjustment arises and that " +
            "one does. Those answers cannot stand together. Excluded from this preview.",
        });
        continue;
      }
      const uncomputable = c.adjustmentSet.find(
        (member) => !BUSINESS_BOOKS_ADJUSTMENTS[member].computable,
      );
      if (uncomputable) {
        recordFailure(c, {
          code: BUSINESS_BOOKS_REFUSAL_CODES[uncomputable],
          message:
            `This books-based ${c.kind} declares "${BUSINESS_BOOKS_ADJUSTMENTS[uncomputable].label}" ` +
            `(${BUSINESS_BOOKS_ADJUSTMENTS[uncomputable].authority}). This engine does not compute that ` +
            "adjustment, so the declared net profit is not the taxable figure and is excluded from this " +
            "preview rather than used as though no adjustment were owed.",
        });
        continue;
      }
      if (c.adjustmentSet.includes("depreciation_s32")) {
        if (c.claimsAdditionalDepreciation === true) {
          recordFailure(c, {
            code: "BUSINESS_BOOKS_ADDITIONAL_DEPRECIATION_UNSUPPORTED",
            message:
              "This books-based record claims additional depreciation under Section 32(1)(iia). That " +
              "limb is twenty per cent of the actual cost of new manufacturing plant and is not " +
              "implemented. Excluded from this preview rather than guessed.",
          });
        } else if (c.claimsAdditionalDepreciation !== false) {
          recordFailure(c, {
            code: "BUSINESS_BOOKS_DEPRECIATION_UNSUPPORTED",
            message:
              "This books-based record declares a Section 32 claim but does not say whether additional " +
              "depreciation under Section 32(1)(iia) arises. Silence is not read as 'no'. Excluded " +
              "from this preview.",
          });
        } else if (c.bookDepreciation === null || !Number.isFinite(c.bookDepreciation)) {
          recordFailure(c, {
            code: "BUSINESS_BOOKS_DEPRECIATION_UNSUPPORTED",
            message:
              "This books-based record declares a Section 32 claim but does not declare the book " +
              "depreciation charged in the P&L. The book charge must be added back before the " +
              "Section 32(1)(ii) allowance is deducted (Explanation 5). Excluded from this preview.",
          });
        } else if (!c.depreciationBlocks || c.depreciationBlocks.length === 0) {
          recordFailure(c, {
            code: "BUSINESS_BOOKS_DEPRECIATION_UNSUPPORTED",
            message:
              "This books-based record declares a Section 32 claim but names no Appendix I standing " +
              "class with a written-down value. An undeclared or unreadable class refuses; no rate " +
              "is guessed. Excluded from this preview.",
          });
        }
      }
    }

    // Gate 2 — DECLARED ACTIVITY / LOSS POOL, per row. Section 70(1) begins
    // "Save as otherwise provided"; Sections 73 and 73A restrict losses from
    // speculation and specified businesses. Silence is therefore not an
    // ordinary activity, and neither restricted pool is netted by this slice
    // even when a case-level special-situation box was omitted.
    for (const c of candidates) {
      if (c.activityClassification === null) {
        recordFailure(c, {
          code: "BUSINESS_BOOKS_ACTIVITY_UNDECLARED",
          message:
            "This books-based record does not declare whether the undertaking is an ordinary business/profession, " +
            "F&O under Section 43(5), a speculation business under Section 73, or a specified business under Sections 35AD/73A. " +
            "Section 70(1) is subject to those restricted loss pools, so the classification is required and " +
            "is never inferred from an unchecked case-level declaration. Excluded from this preview.",
        });
      } else if (!BUSINESS_BOOKS_ACTIVITY_CLASSIFICATIONS[c.activityClassification].computable) {
        recordFailure(c, {
          code: BUSINESS_BOOKS_ACTIVITY_REFUSAL_CODES[c.activityClassification],
          message:
            `This books-based ${c.kind} declares "${BUSINESS_BOOKS_ACTIVITY_CLASSIFICATIONS[c.activityClassification].label}" ` +
            `(${BUSINESS_BOOKS_ACTIVITY_CLASSIFICATIONS[c.activityClassification].authority}). Its activity-specific ` +
            "computation and loss treatment are outside K4-17's ordinary Section 70 pool, so the whole books-business " +
            "head is excluded rather than netted under the wrong rule.",
        });
      }
    }

    // Gate 2b — DECLARED SECTION 44AB TURNOVER, per row (K4-18).
    //
    // A classification with `turnoverFromBooksRevenue: false` cannot supply its
    // Section 44AB figure from its books revenue, and NO official source
    // supplies a formula: not the 1961 Act (s.44AB's own Explanation defines
    // only "accountant" and "specified date"), not the Income-tax Act 2025, not
    // the CBDT-notified Income-tax Rules 2026, no CBDT circular/notification/
    // instruction, and neither the ITR-3 instructions nor Form 3CD. The method
    // in professional use is the ICAI Guidance Note's, which is professional
    // judgement, not law (`PROJECT_CONSTITUTION.md` §2 rule 5).
    //
    // So the preparer declares the figure and this engine applies the statutory
    // threshold to it. Declaring nothing REFUSES the row. Substituting books
    // revenue here would be inventing a turnover formula — precisely what the
    // absence of authority forbids — and it would understate the aggregate for
    // a derivatives desk, whose gross turnover typically dwarfs the net result
    // it books as revenue. Understating the Section 44AB aggregate is the
    // dangerous direction: it silently converts an audit case into a
    // no-audit-required one.
    //
    // Only rows that got this far matter, but the gate runs for EVERY row for
    // the same reason the others do — see the `ownFailure` note above.
    for (const c of candidates) {
      if (c.activityClassification === null) continue;
      const classification = BUSINESS_BOOKS_ACTIVITY_CLASSIFICATIONS[c.activityClassification];
      if (classification.turnoverFromBooksRevenue) continue;
      if (!classification.computable) continue;
      if (c.auditTurnover === null) {
        recordFailure(c, {
          code: "BUSINESS_BOOKS_TURNOVER_UNDECLARED",
          message:
            `This books-based ${c.kind} declares "${classification.label}", whose books revenue is not its ` +
            "Section 44AB turnover. No statutory, CBDT or return-form source defines turnover for derivatives, " +
            "so this product cannot derive it and will not treat declared revenue as though it were turnover. " +
            "Declare the Section 44AB turnover figure for this undertaking (the ICAI Guidance Note method is the " +
            "professional standard, and the figure remains the preparer's judgement). Excluded from this preview.",
        });
      } else if (c.auditTurnover < 0) {
        recordFailure(c, {
          code: "BUSINESS_BOOKS_TURNOVER_UNDECLARED",
          message:
            `The declared Section 44AB turnover for this books-based ${c.kind} is negative ` +
            `(₹${c.auditTurnover}). Turnover is a gross measure and cannot be negative under any recognised ` +
            "method, so the figure is not used. Excluded from this preview.",
        });
      }
    }

    // Gate 3 — SECTION 44AB, on the AGGREGATE, once per limb. 44AB(a) tests
    // "his total sales, turnover or gross receipts ... in business" and 44AB(b)
    // "his gross receipts in profession", so the two limbs are summed and
    // tested separately, never pooled together and never row by row. The
    // aggregate spans EVERY live record, including ones gate 1 already refused:
    // Section 44AB asks about the taxpayer's total turnover, which does not
    // shrink because this engine cannot compute on part of it.
    {
      const limbs = [
        {
          isProfession: false,
          threshold: BUSINESS_BOOKS.auditThresholdBusinessTurnover,
          clause: "(a)",
          noun: "turnover",
        },
        {
          isProfession: true,
          threshold: BUSINESS_BOOKS.auditThresholdProfessionGrossReceipts,
          clause: "(b)",
          noun: "gross receipts",
        },
      ] as const;
      for (const limb of limbs) {
        const inLimb = candidates.filter((c) => c.isProfession === limb.isProfession);
        if (inLimb.length === 0) continue;
        // K4-18 — sum the per-row Section 44AB figure, which is books revenue
        // only for a classification whose `turnoverFromBooksRevenue` says so.
        //
        // INTEGER PAISE, for the same reason K4-17 needed it on the net
        // aggregate: the threshold test is strictly `>` ("exceed or exceeds"),
        // so a case sitting exactly ON ₹1,00,00,000 must not be refused. Binary
        // floating-point addition of currency can land a legitimate exact-
        // threshold total a fraction above it, and the result would depend on
        // row ORDER. Paise arithmetic makes the boundary exact and makes the
        // aggregate invariant to row order and undertaking count.
        const aggregatePaise = inLimb.reduce((sum, c) => sum + toPaise(c.auditTurnover ?? 0), 0);
        const thresholdPaise = toPaise(limb.threshold);
        // `?? 0` treats a row that cannot state its turnover as contributing
        // nothing, and THIS GATE DOES NOT CARRY the property that such a limb
        // is never read as "under the threshold" on a total it could not
        // measure. The HEAD REFUSAL below carries it (`ownFailure.size > 0`):
        // `auditTurnover` is null in exactly three cases — an unclassified row
        // and a non-computable classification, both refused by gate 2, and a
        // computable `turnoverFromBooksRevenue: false` row that declared
        // nothing, refused by gate 2b — so every such row already holds an
        // `ownFailure`, and the head publishes no figure at all.
        //
        // AUDIT-10-F5 removed a guard here that read as though it enforced that
        // property locally but could never change control flow, because the
        // unconditional under-threshold `continue` below subsumed it. Do not
        // reintroduce it: the all-or-nothing head makes it redundant rather
        // than defensive, and it would attach a second refusal reason to rows
        // that already state their own.
        //
        // The other direction stays conclusive, and that is why `?? 0` is safe
        // here rather than merely convenient: turnover is a gross measure and
        // cannot be negative under any recognised method (gate 2b refuses a
        // declared figure claiming otherwise), so an unmeasured contribution is
        // non-negative and could only push the total higher — never pull a
        // genuinely-exceeding total back under the threshold.
        if (aggregatePaise <= thresholdPaise) continue;
        const aggregate = aggregatePaise / 100;
        for (const c of inLimb) {
          recordFailure(c, {
            code: "BUSINESS_BOOKS_AUDIT_THRESHOLD_EXCEEDED",
            message:
              `Declared ${limb.noun} of ₹${aggregate}` +
              (inLimb.length > 1 ? ` aggregated across ${inLimb.length} records` : "") +
              ` exceed the Section 44AB${limb.clause} audit threshold of ₹${limb.threshold}, so this case ` +
              "requires a tax audit. Section 44AB asks about the taxpayer's TOTAL " +
              `${limb.isProfession ? "gross receipts in profession" : "sales, turnover or gross receipts in business"}, ` +
              "not about one record, so every record in that limb is excluded. Tax-audit cases are not " +
              "handled by this product, and the higher ₹10,00,00,000 threshold in the proviso to Section " +
              "44AB(a) is not applied because its cash-PAYMENTS limb cannot be verified from any ledger " +
              "held here. Excluded from this preview.",
          });
        }
      }
    }

    // Gate 4 — the WHOLE-HEAD bottom line (K4-17). Section 70(1) entitles a
    // current-year loss from one source to be set off against income from
    // another source under this same head. We can therefore admit negative
    // rows only when the sum of every otherwise-admissible ordinary
    // books-business/profession row is zero or positive: then the current-year intra-head set-off absorbs the loss in
    // full and no residual reaches cross-head set-off or carry-forward.
    //
    // When the aggregate is negative, every negative row keeps the historical
    // BUSINESS_BOOKS_LOSS_NOT_MODELLED code and non-negative rows receive the
    // sibling code below. That preserves the one-bad-row policy and avoids
    // either publishing a partial head or inventing Section 71/72 treatment.
    {
      const admissibleCandidates = candidates.filter((c) => !ownFailure.has(c));
      const aggregateNet =
        admissibleCandidates.reduce((sum, c) => sum + toPaise(c.net), 0) / 100;
      if (aggregateNet < 0) {
        for (const c of admissibleCandidates) {
          if (c.net >= 0) continue;
          recordFailure(c, {
            code: "BUSINESS_BOOKS_LOSS_NOT_MODELLED",
            message:
              `Declared expenses ₹${c.expenses} exceed declared revenue ₹${c.revenue}, a business loss of ` +
              `₹${Math.abs(c.net)}. Section 70(1) intra-head set-off has been applied across the ` +
              `current-year books rows, but the whole head still has a residual loss of ₹${Math.abs(aggregateNet)}. ` +
              "Using that residual against another head under Section 71 or carrying it forward under Section 72 " +
              "is not modelled, so the whole books-business head is excluded rather than treated as ₹0 income " +
              "or partially reported.",
          });
        }
      }
    }

    if (ownFailure.size > 0) {
      // ALL-OR-NOTHING. The head is a Section 28 aggregate, so a partial total
      // would state a figure that is not the taxpayer's. Each row reports its
      // OWN first applicable reason; a row with none is told plainly that a
      // sibling is why, which it has now EARNED the right to be told — every
      // gate was evaluated for it above.
      for (const c of candidates) {
        const own = ownFailure.get(c);
        if (own !== undefined) {
          refuse(c, own.code, own.message);
          continue;
        }
        const others = ownFailure.size;
        refuse(
          c,
          "BUSINESS_BOOKS_SIBLING_ROW_REFUSED",
          `This books-based ${c.kind} passes every check this engine applies, but ${others} other ` +
            `books-based record${others === 1 ? "" : "s"} in this case ${others === 1 ? "does" : "do"} ` +
            "not — each states its own reason. Section 28 charges ONE head on every business or " +
            "profession carried on, so this head's figure is the aggregate of all of them; computing it " +
            "from only some records would state a total that is not the taxpayer's. All books records " +
            "are excluded from this preview together. After the other record(s) are corrected or " +
            "classified into a supported pool, the whole head must be re-evaluated.",
        );
      }
    } else {
      for (const c of candidates) {
        // Narrowing only: gate 1 proved every candidate has a computable set.
        if (c.adjustmentSet.length === 0) continue;
        const hasDepreciation = c.adjustmentSet.includes("depreciation_s32");
        const adjustedNet = hasDepreciation
          ? (toPaise(c.revenue) -
              toPaise(c.expenses) +
              toPaise(c.bookDepreciation ?? 0) -
              toPaise(computeSection32Allowance(c.depreciationBlocks ?? []))) /
            100
          : c.net;
        businessBooksEntries.push({
          id: c.row.id,
          amount: adjustedNet,
          sourceType: c.row.source_type as BusinessBooksEntry["sourceType"],
          sourceDocumentId: c.row.source_document_id ?? undefined,
          revenue: c.revenue,
          expenses: c.expenses,
          isProfession: c.isProfession,
          adjustments: c.adjustmentSet,
          activityClassification: c.activityClassification!,
          bookDepreciation: hasDepreciation ? (c.bookDepreciation ?? 0) : undefined,
          claimsAdditionalDepreciation: hasDepreciation ? false : undefined,
          depreciationBlocks: hasDepreciation ? (c.depreciationBlocks ?? []) : undefined,
          // K4-18 — carried only when the row's own classification says books
          // revenue is NOT its Section 44AB figure. For an ordinary undertaking
          // it stays absent rather than being set to `revenue`: duplicating the
          // figure would create a second place the turnover could be stated,
          // and the two could then disagree.
          declaredTurnover:
            c.activityClassification !== null &&
            !BUSINESS_BOOKS_ACTIVITY_CLASSIFICATIONS[c.activityClassification]
              .turnoverFromBooksRevenue &&
            c.auditTurnover !== null
              ? c.auditTurnover
              : undefined,
          proofDocumentId: c.row.proof_case_document_id ?? undefined,
        });
        sourceRecordIds.push(c.row.id);
        addTrace(
          "business_books",
          `Income — books-based ${c.kind}${c.net < 0 ? " (current-year loss)" : ""}`,
          "business_books",
          c.row.id,
          c.row.source_type,
          docLabel(c.row),
          c.net,
        );
      }
    }
  }

  const selectedItrType = meta.selectedItrType && ITR_TYPES.has(meta.selectedItrType as ItrType)
    ? (meta.selectedItrType as ItrType)
    : undefined;

  // K4-01: derive the real age band from the taxpayer's date of birth (never
  // hardcoded "below_60"), and propagate the real stored residential status
  // (never hardcoded "resident"). Neither value changes any computed number —
  // the engine does not yet consume ageCategory/residentStatus
  // (NOT_IMPLEMENTED.seniorSlabs) — this only stops the adapter from silently
  // MISREPRESENTING the taxpayer's facts in the snapshot / manifest / trace.
  const ageDerivation = deriveTaxpayerAgeBand(meta.dateOfBirth ?? null, meta.assessmentYear);
  const ageCategory = ageDerivation.outcome === "derived" ? ageDerivation.ageBand : undefined;
  const residentStatus =
    meta.residentialStatus && ENGINE_RESIDENT_STATUSES.has(meta.residentialStatus)
      ? (meta.residentialStatus as TaxEngineInput["taxpayer"]["residentStatus"])
      : undefined;

  const input: TaxEngineInput = {
    assessmentYear: meta.assessmentYear,
    financialYear: meta.financialYear,
    taxpayer: { residentStatus, ageCategory },
    selectedItrType,
    clientApprovalStatus: "not_requested",
    filingStatus: "in_preparation",
    eVerificationStatus: "not_applicable",
    finalized: meta.finalized,
    requiredDocuments: [],
    income,
    taxPaid,
    deductions,
    capitalGains,
    housePropertyEntries,
    businessBooksEntries,
    broughtForwardLosses,
    sourceRecordIds,
    hasBusinessOrProfessionalIncome,
    // notes intentionally omitted — never carry ledger notes into the engine.
  };

  const sum = (arr: { amount: number }[]) => arr.reduce((a, e) => a + e.amount, 0);
  const byHead = (h: IncomeCategory) => sum(income.filter((e) => e.category === h));

  return {
    input,
    warnings,
    ageDerivation,
    complete: warnings.length === 0,
    presumptiveActivityEligibility: buildPresumptiveActivityEligibilitySnapshot(rows.income),
    excludedLedgerIds,
    sourceTrace: [...traceMap.values()],
    mappedEntryCount:
      income.length +
      taxPaid.length +
      deductions.length +
      capitalGains.length +
      housePropertyEntries.length +
      businessBooksEntries.length +
      broughtForwardLosses.length,
    unsupportedEntryCount: warnings.length,
    summary: {
      salary: byHead("salary"),
      interest: byHead("savings_interest") + byHead("fd_interest"),
      dividendOther: byHead("dividend") + byHead("other_sources"),
      exempt: byHead("exempt_income"),
      deductions: sum(deductions),
      stcg111a: sum(capitalGains.filter((c) => c.category === "stcg_111a")),
      ltcg112a: sum(capitalGains.filter((c) => c.category === "ltcg_112a")),
      totalTaxPaid: sum(taxPaid),
      houseProperty: sum(housePropertyEntries.map((e) => ({ amount: e.annualRentReceived - e.homeLoanInterest }))),
      presumptiveProfessionalIncome: byHead("presumptive_professional_44ada"),
      presumptiveBusinessTurnover:
        byHead("presumptive_business_44ad_digital") + byHead("presumptive_business_44ad_cash"),
      businessBooksNetProfit:
        businessBooksEntries.reduce((total, e) => total + toPaise(e.amount), 0) / 100,
      broughtForwardLoss: broughtForwardLosses.reduce((total, e) => total + e.amount, 0),
    },
  };
}

/** Does the input have any tax-relevant figure worth snapshotting? */
export function hasMeaningfulInput(r: AdapterResult): boolean {
  const s = r.summary;
  return (
    s.salary +
      s.interest +
      s.dividendOther +
      s.stcg111a +
      s.ltcg112a +
      s.totalTaxPaid +
      s.presumptiveProfessionalIncome +
      s.presumptiveBusinessTurnover +
      s.businessBooksNetProfit >
      0 ||
    // K4-06: a declared house-property record is meaningful even when its raw
    // rent-minus-interest figure nets to 0 (e.g. a self-occupied property with
    // no home loan) — presence, not just a nonzero sum, drives this signal.
    (r.input.housePropertyEntries?.length ?? 0) > 0 ||
    // K4-10: same precedent. A declared carry-forward record is meaningful even
    // when this year absorbs none of it — the computation still produces a real
    // output (the residual, and the assessment year it may last be used in),
    // and a case holding one is not an empty case. Only reachable for a case
    // with NO income at all, since any income already satisfies the sum above.
    (r.input.broughtForwardLosses?.length ?? 0) > 0 ||
    // K4-14: same precedent again. A declared books-based business is
    // meaningful even when revenue exactly equals expenses and the net profit
    // is ₹0 — presence, not a nonzero sum, drives this signal.
    (r.input.businessBooksEntries?.length ?? 0) > 0
  );
}
