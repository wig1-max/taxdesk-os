/**
 * Pure Tax Desk ledger helpers (K.2.4). No React/Next/Supabase imports —
 * enum metadata, totals and the finalized-lock check, all unit-testable.
 */

export const INCOME_HEADS = [
  "salary",
  "savings_interest",
  "fd_interest",
  "dividend",
  "other_sources",
  "exempt_income",
  "house_property",
  "business_income",
  /** K4-07: presumptive professional income (Section 44ADA) — gross
   *  receipts, computed at a 50% deemed-profit rate. Distinct from the
   *  general `business_income` placeholder (still unsupported). */
  "presumptive_professional_44ada",
  /** K4-08: presumptive BUSINESS income (Section 44AD) — turnover received
   *  through banking / prescribed electronic modes, computed at a 6%
   *  deemed-profit rate. Split from the cash head below because 44AD applies
   *  two different rates to two portions of turnover (unlike 44ADA's single
   *  rate on the whole), which also lets the 5% cash-receipts eligibility
   *  test be DERIVED from declared amounts rather than staff-asserted. */
  "presumptive_business_44ad_digital",
  /** K4-08: presumptive BUSINESS income (Section 44AD) — the remaining
   *  (cash) portion of turnover, computed at an 8% deemed-profit rate. */
  "presumptive_business_44ad_cash",
] as const;
export type IncomeHead = (typeof INCOME_HEADS)[number];

/**
 * K4-13 (decision D217) — the declared ACTIVITY of a presumptive income row,
 * meaningful only on the three presumptive heads above. This is the ledger /
 * database vocabulary; the statutory rule saying which member is eligible for
 * which scheme is the engine's `PRESUMPTIVE_ACTIVITY_ELIGIBILITY`
 * (`tax-engine/ay-2026-27/rules.ts`), which is the single authority for that.
 *
 * Two parallel vocabularies rather than one import, following the existing
 * `INCOME_HEADS` / `IncomeCategory` and `HOUSE_PROPERTY_USAGES` /
 * `HousePropertyUsage` pattern — the engine may not import from `tax-desk`
 * and this module may not become a second authority on eligibility. They are
 * pinned identical in BOTH directions by `ledger.test.ts`, so a member added
 * to either side without the other fails the suite rather than silently
 * becoming an activity the gate cannot classify.
 *
 * ABSENCE IS NOT A MEMBER. A row with no declared activity is `null`, and
 * `null` BLOCKS the presumptive computation (the adapter excludes it and
 * sets `complete === false`). There is deliberately no "unknown" or "other"
 * member and no default: a default is exactly the presumption of eligibility
 * this vocabulary exists to remove.
 */
export const PRESUMPTIVE_ACTIVITY_TYPES = [
  "specified_profession_44aa_1",
  "commission_or_brokerage",
  "agency_business",
  "goods_carriage_44ae",
  "other_business",
] as const;
export type PresumptiveActivityType = (typeof PRESUMPTIVE_ACTIVITY_TYPES)[number];

/** The three income heads on which a declared activity is meaningful and required. */
export const PRESUMPTIVE_INCOME_HEADS = [
  "presumptive_professional_44ada",
  "presumptive_business_44ad_digital",
  "presumptive_business_44ad_cash",
] as const satisfies readonly IncomeHead[];

export const TAX_PAID_TYPES = [
  "salary_tds",
  "non_salary_tds",
  "tcs",
  "advance_tax",
  "self_assessment_tax",
] as const;
export type TaxPaidType = (typeof TAX_PAID_TYPES)[number];

export const DEDUCTION_TYPES = [
  "80C",
  "80D",
  "80D_PARENTS",
  "80TTA",
  "80TTB",
  "80CCD",
  "80G",
  "other_deductions",
] as const;
export type DeductionType = (typeof DEDUCTION_TYPES)[number];

export const GAIN_TYPES = ["stcg_111a", "ltcg_112a", "house_sale", "other_stcg", "other_ltcg"] as const;
export type GainType = (typeof GAIN_TYPES)[number];

/** K4-21: land / building / both. Pinned to the engine's HOUSE_SALE_ASSET_KINDS. */
export const HOUSE_SALE_ASSET_KIND_DECLARATIONS = ["land", "building", "both"] as const;
export type HouseSaleAssetKindDeclaration = (typeof HOUSE_SALE_ASSET_KIND_DECLARATIONS)[number];

/** K4-21: purchase only. Gift / inheritance / partition are s.49 and refuse. */
export const HOUSE_SALE_ACQUISITION_MODE_DECLARATIONS = ["purchase"] as const;
export type HouseSaleAcquisitionModeDeclaration =
  (typeof HOUSE_SALE_ACQUISITION_MODE_DECLARATIONS)[number];

/**
 * K4-21: closed "not this out-of-set fact" declarations. All four are
 * required before a house-sale row computes. Silence is incomplete, never
 * "no".
 */
export const HOUSE_SALE_REQUIRED_DECLARATIONS = [
  "not_agricultural_land",
  "not_depreciable_asset",
  "interest_not_in_cost",
  "agreement_and_registration_same_date",
] as const;
export type HouseSaleRequiredDeclaration = (typeof HOUSE_SALE_REQUIRED_DECLARATIONS)[number];

/**
 * K4-23 / D337 items 7 and 11: two further attestations required ONLY when
 * the holding is long-term. A short-term row is complete with the four
 * above, which is why `K4-21`'s behaviour is unchanged.
 */
export const HOUSE_SALE_LTCG_REQUIRED_DECLARATIONS = [
  "amounts_are_assessee_share",
  "stamp_duty_value_accepted",
] as const;
export type HouseSaleLtcgRequiredDeclaration =
  (typeof HOUSE_SALE_LTCG_REQUIRED_DECLARATIONS)[number];

/**
 * Every value the ledger may store. This is the vocabulary the DB CHECK
 * constraint on `tax_capital_gain_entries.house_sale_declarations` carries,
 * and migration `20260821120000` widened it to exactly this set.
 */
export const HOUSE_SALE_ALL_DECLARATIONS = [
  ...HOUSE_SALE_REQUIRED_DECLARATIONS,
  ...HOUSE_SALE_LTCG_REQUIRED_DECLARATIONS,
] as const;
export type HouseSaleDeclaration = (typeof HOUSE_SALE_ALL_DECLARATIONS)[number];

/** K4-06: how a house property is used — drives Section 22/23 GAV treatment. */
export const HOUSE_PROPERTY_USAGES = ["self_occupied", "let_out"] as const;
export type HousePropertyUsage = (typeof HOUSE_PROPERTY_USAGES)[number];

/**
 * K4-14 — what, if anything, a BOOKS-BASED business row's accounts require
 * under Sections 30-43D. This is the ledger / database vocabulary; the
 * statutory verdict on which member can actually be computed is the engine's
 * `BUSINESS_BOOKS_ADJUSTMENTS` (`tax-engine/ay-2026-27/rules.ts`), which is
 * the single authority for that.
 *
 * Two parallel vocabularies rather than one import, exactly as
 * `PRESUMPTIVE_ACTIVITY_TYPES` above does and for the same boundary reason —
 * the engine may not import from `tax-desk`, and this module may not become a
 * second authority on what is computable. They are pinned identical in BOTH
 * directions by `ledger.test.ts`.
 *
 * ABSENCE IS NOT A MEMBER, and this is the safety property of the whole
 * slice. A row with no declared basis is `null`, and `null` REFUSES the
 * computation. Section 29 computes business income "in accordance with the
 * provisions contained in sections 30 to 43D"; this engine implements none of
 * them, so an unanswered adjustment question means an unknown taxable figure.
 * Treating silence as "no adjustment" is precisely the fail-open shape `K4-13`
 * was created to remove from the presumptive path.
 */
export const BUSINESS_BOOKS_ADJUSTMENT_DECLARATIONS = [
  /** Computable: the preparer declares no Sections 30-43D adjustment arises. Exclusive of every other member. */
  "none_s30_43d",
  /** K4-20: computable when standing-class blocks, book-depreciation add-back and a no-s.32(1)(iia) answer are all present. */
  "depreciation_s32",
  "disallowance_s37_s40_s43b",
  "presumptive_transition",
] as const;
export type BusinessBooksAdjustmentDeclaration =
  (typeof BUSINESS_BOOKS_ADJUSTMENT_DECLARATIONS)[number];

/**
 * K4-20 — ledger/database vocabulary for the Appendix I standing classes
 * this slice multiplies. Pinned both ways to the engine's
 * `DEPRECIATION_ASSET_CLASSES`. An asset that is not a member refuses.
 */
export const DEPRECIATION_ASSET_CLASS_DECLARATIONS = [
  "building_residential_i1",
  "building_other_i2",
  "building_temporary_i4",
  "furniture_fittings_ii",
  "plant_machinery_general_iii1",
  "motor_car_not_hire_iii2i",
  "motor_hire_iii3iia",
  "computers_iii5",
  "intangibles_part_b",
] as const;
export type DepreciationAssetClassDeclaration =
  (typeof DEPRECIATION_ASSET_CLASS_DECLARATIONS)[number];

export const DEPRECIATION_PUT_TO_USE_DECLARATIONS = [
  "full_rate",
  "half_rate_acquired_under_180_days",
] as const;
export type DepreciationPutToUseDeclaration =
  (typeof DEPRECIATION_PUT_TO_USE_DECLARATIONS)[number];

/**
 * Declared nature of a books undertaking for loss-set-off purposes.
 *
 * Section 70(1) begins "Save as otherwise provided". Section 43(5) treats
 * eligible exchange-traded derivatives as non-speculative, while Sections
 * 73/73A restrict speculation-business and specified-business losses. Absence
 * is not a member: without an affirmative classification the adapter cannot
 * know whether an apparent loss may enter the bounded ordinary Section 70 pool.
 *
 * `K4-18` adds two members and keeps `futures_and_options` refusing:
 * `fno_non_speculative_s43_5_d` is the preparer's affirmation that EVERY
 * transaction meets Explanation 1 to Section 43(5) proviso (d), and
 * `intraday_speculative_s43_5` names intraday equity explicitly so it can be
 * declared rather than mistaken for an ordinary business. Kept as a parallel
 * vocabulary to the engine's (the engine may not import from `tax-desk`), and
 * pinned in BOTH directions by `business-books-vocabulary.test.ts`.
 */
export const BUSINESS_BOOKS_ACTIVITY_CLASSIFICATIONS = [
  "ordinary_business_or_profession",
  "fno_non_speculative_s43_5_d",
  "futures_and_options",
  "intraday_speculative_s43_5",
  "speculation_business_s73",
  "specified_business_s35ad",
] as const;
export type BusinessBooksActivityClassification =
  (typeof BUSINESS_BOOKS_ACTIVITY_CLASSIFICATIONS)[number];

/**
 * K4-10 — the type of a BROUGHT-FORWARD capital loss. Half of a
 * carry-forward record's identity (the other half is its originating
 * assessment year): Section 74(1)(a) and 74(1)(b) give a short-term and a
 * long-term loss different lawful destinations, so a bare amount cannot say
 * where the loss may go.
 *
 * Deliberately a SEPARATE vocabulary from `GAIN_TYPES`, not a reuse of it:
 * these are prior-year losses governed by Section 74, not this year's gain
 * rows governed by Sections 111A/112A, and conflating the two vocabularies
 * would erase exactly the current-year-vs-brought-forward distinction this
 * session exists to make explicit.
 */
export const BROUGHT_FORWARD_LOSS_TYPES = ["stcl", "ltcl"] as const;
export type BroughtForwardLossType = (typeof BROUGHT_FORWARD_LOSS_TYPES)[number];

/**
 * K4-10 — the Section 139(3)/80 condition: a loss is carryable at all only if
 * the loss return was filed by the due date. `K4-09` left this unmodelled.
 *
 * `"unverified"` is the DEFAULT and FAILS CLOSED — a record in that state is
 * never treated as eligible and the case is refused rather than computed on
 * an assumption. There is deliberately no bare `"eligible"` member: the only
 * affirmative state names what was actually checked.
 */
export const BROUGHT_FORWARD_FILING_ELIGIBILITIES = [
  "verified_timely",
  "unverified",
  "not_eligible",
] as const;
export type BroughtForwardFilingEligibility =
  (typeof BROUGHT_FORWARD_FILING_ELIGIBILITIES)[number];

/**
 * K4-10 — how much assurance the recorded figure carries. A loss carried out
 * of a FINALIZED prior case in this system is a different kind of fact from a
 * figure a staff member typed from a client's recollection, and the preparer
 * must be able to see which one they are relying on.
 */
export const BROUGHT_FORWARD_LOSS_PROVENANCES = [
  "prior_finalized_case_in_system",
  "staff_declared",
] as const;
export type BroughtForwardLossProvenance =
  (typeof BROUGHT_FORWARD_LOSS_PROVENANCES)[number];

/**
 * K4-10 — the taxpayer's ELECTED destination for a brought-forward loss, when
 * one is recorded. Absent (`null`) means no election: the versioned
 * `portal_default_ay2026_27` allocation policy applies.
 *
 * This exists because the official ITR-2 utility itself offers one:
 * `CG_Calc.doSetoff` branches on `CG_TableE_Checkbox` into a user-entered
 * Schedule CG Table E allocation (D114), so the utility treats its own
 * sequence as a DEFAULT over a taxpayer-supplied allocation — not as the only
 * expressible result.
 */
export const ELECTED_SET_OFF_TARGETS = ["stcg_111a", "ltcg_112a"] as const;
export type ElectedSetOffTarget = (typeof ELECTED_SET_OFF_TARGETS)[number];

export const SOURCE_TYPES = [
  "manual",
  "AIS",
  "26AS",
  "Form16",
  "prefilled_json",
  "broker_report",
  "bank_certificate",
  "adjustment",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export type LedgerKind =
  | "income"
  | "tax_paid"
  | "deduction"
  | "capital_gain"
  | "house_property"
  /** K4-10: prior-year capital losses brought forward under Section 74. */
  | "brought_forward_loss"
  /** K4-14: a books-based business or profession (Sections 28/29). */
  | "business_books";

/** DB table name for each ledger kind. */
export const LEDGER_TABLE: Record<LedgerKind, string> = {
  income: "tax_income_entries",
  tax_paid: "tax_tax_paid_entries",
  deduction: "tax_deduction_entries",
  capital_gain: "tax_capital_gain_entries",
  house_property: "tax_house_property_entries",
  brought_forward_loss: "tax_brought_forward_loss_entries",
  business_books: "tax_business_books_entries",
};

/** Audit action prefix for each ledger kind. */
export const LEDGER_AUDIT_PREFIX: Record<LedgerKind, string> = {
  income: "tax_ledger.income",
  tax_paid: "tax_ledger.tax_paid",
  deduction: "tax_ledger.deduction",
  capital_gain: "tax_ledger.capital_gain",
  house_property: "tax_ledger.house_property",
  brought_forward_loss: "tax_ledger.brought_forward_loss",
  business_books: "tax_ledger.business_books",
};

/** A tax case is locked for editing once it has been finalized. */
export function isTaxCaseLocked(finalizedAt: string | null | undefined): boolean {
  return !!finalizedAt;
}

/** Sum a numeric field across rows (missing/NaN treated as 0). */
export function sumField<T>(rows: T[], pick: (row: T) => number | null | undefined): number {
  return rows.reduce((acc, r) => {
    const v = Number(pick(r));
    return acc + (Number.isFinite(v) ? v : 0);
  }, 0);
}
