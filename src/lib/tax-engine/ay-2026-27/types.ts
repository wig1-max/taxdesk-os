/**
 * TaxDesk OS — Native Tax Desk / ITR Prep engine (AY 2026-27 / FY 2025-26).
 *
 * PURE TYPESCRIPT ONLY. This file (and every file in this folder) must not
 * import React, Next.js, the Supabase client, UI/PDF components, server
 * actions, env/config, or app routes. See README.md for the boundary rules.
 *
 * PREPARATION-ONLY. Nothing here files a return, touches the Income Tax
 * portal, or stores portal credentials. All numbers require CA verification
 * before real client reliance.
 */

import type { HouseSaleLtcgDetail } from "./house-sale";

import type {
  BusinessBooksActivityClassification,
  BusinessBooksAdjustment,
  DepreciationAssetClass,
  DepreciationPutToUse,
} from "./rules";
import type { Rebate87ATreatment } from "./rebate-relief";
import type { SurchargeTreatment } from "./surcharge";

/** Where a ledger figure came from. Drives source-aware traceability + reconciliation. */
export type SourceType =
  | "manual"
  | "AIS"
  | "26AS"
  | "Form16"
  | "prefilled_json"
  | "broker_report"
  | "bank_certificate"
  | "adjustment";

/** Sources the engine treats as authoritative/reported (vs taxpayer-entered "manual"). */
export type ReportedSourceType = Exclude<SourceType, "manual" | "adjustment">;

export type Regime = "old" | "new";

export type ItrType = "ITR-1" | "ITR-2" | "ITR-3" | "ITR-4";

/** Client sign-off state on the prepared computation. */
export type ApprovalStatus = "not_requested" | "pending" | "approved";

/** Where the case sits in the prep → file lifecycle. */
export type FilingStatus =
  | "not_started"
  | "in_preparation"
  | "ready_to_file"
  | "filed";

export type EVerificationStatus = "not_applicable" | "pending" | "verified";

export type DocumentStatus = "missing" | "received" | "verified";

/**
 * Every computed number returned by the engine carries its derivation so the
 * UI / PDF layer can show a working and trace figures back to source records.
 */
export interface ComputedValue {
  value: number;
  formula: string;
  /** Source tags, e.g. "salary:Form16:doc_123" or "advance_tax:manual:tp_9". */
  sources: string[];
  notes: string[];
}

// ---------------------------------------------------------------------------
// Ledger-like input entries
// ---------------------------------------------------------------------------

/** Fields shared by every ledger entry. Later assembled from DB ledger rows. */
export interface EntryBase {
  id: string;
  amount: number;
  sourceType: SourceType;
  sourceDocumentId?: string;
  notes?: string;
}

export type IncomeCategory =
  | "salary"
  | "savings_interest"
  | "fd_interest"
  | "dividend"
  | "other_sources"
  | "exempt_income"
  // Placeholders only in K.2.0 — NOT computed into tax yet.
  | "house_property"
  | "business_income"
  /**
   * K4-07: presumptive professional income (Section 44ADA) — gross
   * professional receipts. COMPUTED (unlike the two placeholders
   * above): the engine derives a deemed profit at 50% of the amount.
   * The adapter guarantees a row of this category is already within
   * the applicable gross-receipts ceiling (₹50L / ₹75L) before it ever
   * reaches the engine — see `computation-adapter.ts`'s
   * `PRESUMPTIVE_44ADA_CEILING_EXCEEDED` exclusion.
   */
  | "presumptive_professional_44ada"
  /**
   * K4-08: presumptive BUSINESS income (Section 44AD) — turnover, split by
   * receipt mode across these two categories because 44AD applies two
   * deemed-profit rates to two PORTIONS of turnover (6% digital / 8% cash),
   * unlike 44ADA's single 50% rate on the whole. COMPUTED. The adapter
   * guarantees rows of these categories are already within the applicable
   * aggregate turnover ceiling (₹2cr / ₹3cr) before they ever reach the
   * engine — see `computation-adapter.ts`'s
   * `PRESUMPTIVE_44AD_CEILING_EXCEEDED` exclusion.
   */
  | "presumptive_business_44ad_digital"
  | "presumptive_business_44ad_cash";

export interface IncomeEntry extends EntryBase {
  category: IncomeCategory;
}

export type TaxPaidCategory =
  | "salary_tds"
  | "non_salary_tds"
  | "tcs"
  | "advance_tax"
  | "self_assessment_tax";

export interface TaxPaidEntry extends EntryBase {
  category: TaxPaidCategory;
}

export type DeductionSection =
  | "80C"
  | "80D"
  | "80D_PARENTS"
  | "80TTA"
  | "80TTB"
  | "80CCD"
  | "80G"
  | "other";

export interface DeductionEntry extends EntryBase {
  section: DeductionSection;
  /** Proof/document backing the claim. Absence drives a "proof missing" finding. */
  proofDocumentId?: string;
  /**
   * K4-05: meaningful ONLY when `section === "80D_PARENTS"` — whether the
   * INSURED PARENT (not the taxpayer) is senior/super-senior. `undefined`/
   * `false` is treated as "not confirmed senior" (the conservative ₹25,000
   * parents-bucket cap), never inferred true. Ignored for every other
   * section. See the k4-senior-treatment-specification design notes §10.2.
   */
  insuredPartySenior?: boolean;
}

export type CapitalGainCategory =
  | "stcg_111a"
  | "ltcg_112a"
  /** K4-21: land or building sale. STCG only this year; LTCG refuses. */
  | "house_sale"
  // Placeholders only in K.2.0 — NOT computed into tax yet. Never treated as 111A/112A.
  | "other_stcg"
  | "other_ltcg";

export interface HouseSaleEntryFacts {
  transferDate: string;
  acquisitionDate: string;
  stampDutyValue: number;
  assetKind: "land" | "building" | "both";
  acquisitionMode: "purchase";
  costOfImprovement: number;
  interestIncludedInCost: boolean;
  agriculturalLand: boolean;
  depreciableAsset: boolean;
  agreementDateDiffersFromRegistration: boolean;
  /**
   * K4-23 / D337 items 7 and 11. Optional because a stored snapshot
   * predating K4-23 carries neither, and a reader MUST treat absence as
   * NOT declared — which refuses, and so fails closed. Read only on the
   * long-term path; a short-term row is unaffected by either.
   */
  amountsAreAssesseeShare?: boolean;
  stampDutyValueAccepted?: boolean;
}

export interface CapitalGainEntry extends EntryBase {
  category: CapitalGainCategory;
  sale_value?: number;
  cost?: number;
  expenses?: number;
  exemption_claimed?: number;
  /** If present, used directly; otherwise derived from sale_value - cost - expenses - exemption. */
  taxable_gain?: number;
  source_document_id?: string;
  /** Required when `category === "house_sale"`. Ignored otherwise. */
  houseSale?: HouseSaleEntryFacts;
}

/** How a property is used — drives Section 22/23 annual-value treatment. */
export type HousePropertyUsage = "self_occupied" | "let_out";

/**
 * K4-06: one house property (Sections 22-27, Income-tax Act 1961). Session
 * scope is ONE property per case — the ADAPTER (not this type) refuses to
 * map more than one live row (`MULTIPLE_HOUSE_PROPERTIES_NOT_MODELLED`), so
 * `TaxEngineInput.housePropertyEntries` is guaranteed by every production
 * caller to hold 0 or 1 entries; `computeHouseProperty` sums across
 * whatever it is given (untested/unverified for N>1 — see its own doc).
 */
export interface HousePropertyEntry extends EntryBase {
  usage: HousePropertyUsage;
  /** Meaningful only when `usage === "let_out"` — actual rent received/receivable. */
  annualRentReceived: number;
  /** Deductible from GAV only when ACTUALLY PAID during the year (Section 23(1)). */
  municipalTaxesPaid: number;
  /** Section 24(b) home-loan interest — regime/usage-aware caps applied by the engine. */
  homeLoanInterest: number;
  proofDocumentId?: string;
}

/**
 * K4-14: one BOOKS-BASED business or profession (Sections 28/29).
 *
 * K4-15 REMOVED the one-row cap. Section 28(i) charges "the profits and gains
 * of ANY business or profession which was carried on by the assessee at any
 * time during the previous year", so where several are carried on, the head
 * carries the AGGREGATE — `TaxEngineInput.businessBooksEntries` may now hold
 * any number of entries and `computeBusinessBooksIncome` sums them.
 *
 * K4-17 admits a negative current-year entry when Section 70(1) set-off against
 * positive current-year siblings leaves the whole books-business/profession
 * aggregate zero or positive. A negative aggregate remains refused because
 * its residual would require Section 71 cross-head set-off or Section 72
 * carry-forward. Every entry must still be individually adjustment-free. See
 * `BUSINESS_BOOKS_ADJUSTMENTS` and `BUSINESS_BOOKS` in `rules.ts`.
 *
 * `revenue` and `expenses` are the DECLARED P&L totals. Their difference is
 * the taxable figure when `adjustments` is exactly `none_s30_43d`. K4-20
 * also admits a complete standing-class Section 32(1)(ii) set: taxable
 * then is revenue − expenses + book depreciation − s.32 allowance.
 * Every other basis, and an incomplete depreciation claim, means Sections
 * 30-43D work is owed that this engine does not do, and
 * `computeBusinessBooksIncome` refuses it rather than subtracting anyway. The
 * adapter has normally refused such a row long before it reaches the engine —
 * the engine's own check is DEFENCE IN DEPTH reading the SAME authority
 * (`BUSINESS_BOOKS_ADJUSTMENTS`), never a second, independently-derived rule.
 */
export interface BusinessBooksDepreciationBlock {
  assetClass: DepreciationAssetClass;
  wdv: number;
  putToUse: DepreciationPutToUse;
}

export interface BusinessBooksEntry extends EntryBase {
  /** Declared gross revenue / turnover / gross receipts for the year. */
  revenue: number;
  /** Declared total expenses charged in the books for the year. */
  expenses: number;
  /** True when this is a PROFESSION rather than a business — selects which
   *  Section 44AB threshold applies (44AB(b) ₹50L vs 44AB(a) ₹1cr). */
  isProfession: boolean;
  /**
   * K4-20: what the books require under Sections 30-43D, as a SET
   * (`D237` replaced the single-select). A lone string is the pre-K4-20
   * snapshot shape and is treated as a one-member set. Empty is undeclared.
   * `none_s30_43d` is exclusive of every other member.
   */
  adjustments: BusinessBooksAdjustment | readonly BusinessBooksAdjustment[];
  /** Which statutory loss pool this undertaking belongs to. K4-17 admitted the
   *  ordinary Section 70 pool; K4-18 adds eligible exchange-traded derivatives
   *  (Section 43(5) proviso (d)). Sections 73/73A remain refused. */
  activityClassification: BusinessBooksActivityClassification;
  /**
   * K4-18 — the Section 44AB "total sales, turnover or gross receipts" figure,
   * as DECLARED by the preparer, for a classification whose books revenue is
   * not that figure (`turnoverFromBooksRevenue: false`).
   *
   * Required for such a row and meaningless for any other. It exists because no
   * statutory, CBDT or form source defines derivative turnover: the engine
   * applies Section 44AB's threshold, while the figure itself is the preparer's
   * professional judgement (ICAI Guidance Note territory). Absent on a row that
   * needs it, the adapter REFUSES — books revenue is never substituted.
   */
  declaredTurnover?: number;
  /**
   * K4-20 — book depreciation charged in the P&L, to be added back before
   * the Section 32(1)(ii) allowance is deducted. Required on a
   * `depreciation_s32` row (the adapter refuses a missing declaration).
   * Meaningless on a `none_s30_43d` row.
   */
  bookDepreciation?: number;
  /**
   * K4-20 — whether additional depreciation under Section 32(1)(iia)
   * arises. Required on a `depreciation_s32` row. `true` REFUSES: this
   * engine does not implement the 20%-of-actual-cost limb.
   */
  claimsAdditionalDepreciation?: boolean;
  /**
   * K4-20 — the Appendix I blocks the Section 32(1)(ii) multiplier runs
   * on. Required (and non-empty) on a `depreciation_s32` row.
   */
  depreciationBlocks?: readonly BusinessBooksDepreciationBlock[];
  proofDocumentId?: string;
}

// ---------------------------------------------------------------------------
// Taxpayer + case metadata
// ---------------------------------------------------------------------------

/**
 * Taxpayer profile. `residentStatus` NR-specific rules remain unimplemented
 * (placeholder). `ageCategory`: the OLD-regime basic-exemption widening for a
 * resident senior/super-senior is implemented (K4-02, slabs.ts) — the senior
 * 80D cap, 80TTB-vs-80TTA and Section 207(2) advance-tax exemption remain
 * unimplemented placeholders (see the k4-senior-treatment-specification design notes §10).
 */
export interface TaxpayerProfile {
  id?: string;
  /** Placeholder — residency-specific rules not implemented in K.2.0. */
  residentStatus?: "resident" | "non_resident" | "not_ordinarily_resident";
  /** Drives the OLD-regime basic-exemption widening for a resident taxpayer
   *  (K4-02, slabs.ts). Senior 80D cap / 80TTB-vs-80TTA / Section 207(2) are
   *  NOT yet driven by this field — see the K4 senior-treatment spec §10. */
  ageCategory?: "below_60" | "senior" | "super_senior";
}

export interface RequiredDocument {
  code: string;
  label: string;
  required: boolean;
  status: DocumentStatus;
}

/** The full engine input. Designed to be assembled from DB ledger rows later. */
export interface TaxEngineInput {
  assessmentYear: string;
  financialYear: string;
  taxpayer: TaxpayerProfile;
  selectedItrType?: ItrType;
  selectedRegime?: Regime;
  clientApprovalStatus: ApprovalStatus;
  filingStatus: FilingStatus;
  eVerificationStatus: EVerificationStatus;
  finalized: boolean;
  /** True when an edit is being attempted; combined with `finalized` to block edits. */
  editRequested?: boolean;
  requiredDocuments: RequiredDocument[];
  income: IncomeEntry[];
  taxPaid: TaxPaidEntry[];
  deductions: DeductionEntry[];
  capitalGains: CapitalGainEntry[];
  /**
   * K4-06: house-property records (Sections 22-27). Optional so every
   * pre-existing caller that never touches house property (fixtures, other
   * ledger kinds' own tests) keeps compiling unchanged — `computeHouseProperty`
   * treats a missing array identically to an empty one. The adapter guarantees
   * 0 or 1 entries in production (session scope; see `HousePropertyEntry`'s doc).
   */
  housePropertyEntries?: HousePropertyEntry[];
  /**
   * K4-14: books-based business/profession records (Sections 28/29). Optional
   * for exactly the reason `housePropertyEntries` is — every pre-existing
   * caller that never touches this head keeps compiling unchanged, and
   * `computeBusinessBooksIncome` treats a missing array identically to an
   * empty one, so a case with no books row computes what it computed before
   * this session, rupee for rupee. The adapter guarantees 0 or 1 entries.
   */
  businessBooksEntries?: BusinessBooksEntry[];
  /**
   * K4-10: prior-year capital losses brought forward under Section 74.
   * Optional so every pre-existing caller that never touches carry-forward
   * keeps compiling unchanged — an absent array is treated identically to an
   * empty one, and a case with no brought-forward record computes exactly what
   * `K4-09` computed, byte for byte.
   */
  broughtForwardLosses?: BroughtForwardLossEntry[];
  /** Free-form pointers to originating records (ledger row ids, etc.). */
  sourceRecordIds?: string[];
  /** Free text — scanned by validateCase only, never used in computation. */
  notes?: string;
  /** Additional free-text fields — scanned by validateCase only. */
  freeTextFields?: string[];
  /** Placeholder flag — foreign assets block ITR-1 but are NOT otherwise computed. */
  hasForeignAssets?: boolean;
  /**
   * True when the case has any non-zero `business_income` ledger row (K4-04,
   * spec §10.4) OR any non-zero `presumptive_professional_44ada` ledger row
   * (K4-07) OR any non-zero `presumptive_business_44ad_*` ledger row (K4-08)
   * — all are "profits and gains of business or profession" for
   * Section 207(2) purposes, even though the latter two ARE computed (unlike
   * `business_income`). Set on BOTH the accepted and the ceiling-excluded
   * branch for each presumptive head: exclusion from the engine input does
   * not retract the underlying declared fact (AUDIT-03-F9 / decision D86).
   * Populated by `computation-adapter.ts`'s
   * `buildEngineInput`, never a second, independently-derived signal.
   * Consumed ONLY by `validateCase` (the Section 207(2) advance-tax-
   * exemption disclosure); the computation never reads it.
   */
  hasBusinessOrProfessionalIncome?: boolean;
}

// ---------------------------------------------------------------------------
// computeTax output
// ---------------------------------------------------------------------------

/** Per-regime breakdown. Capital gains are kept OUT of ordinary slab income. */
export interface RegimeComputation {
  regime: Regime;
  /**
   * K4-23 / D337 item 5 — FALSE when this regime refused the s.112 house-sale
   * long-term treatment because the first proviso's basic-exemption
   * absorption could change the figure. `computeBothRegimes` propagates a
   * refusal in EITHER regime to BOTH, so the two are always equal on a
   * computation this engine actually returns.
   */
  houseSaleLtcgTreatmentSupported: boolean;
  /** K4-23 — per-property s.112 comparison detail. Disclosure only. */
  houseSaleLtcgDetails: HouseSaleLtcgDetail[];
  /** K4-23 — total s.112 excess ignored under the second proviso. */
  houseSaleLtcgExcessIgnored: number;
  standardDeduction: ComputedValue;
  chapterVIADeductions: ComputedValue;
  deductionsAllowed: ComputedValue;
  /**
   * K4-06: net income (or loss) from house property — Section 24(a) 30%
   * standard deduction and Section 24(b) home-loan interest already applied,
   * and (for a loss) the Section 71(3A) ₹2,00,000-per-year other-head
   * set-off cap (old regime) / the new-regime no-set-off rule already
   * applied. Included IN `normalTaxableIncome` below (house property is
   * ordinary slab-rate income, never a special-rate head) — kept as its own
   * figure only for traceability/display, never summed twice.
   */
  housePropertyIncome: ComputedValue;
  /**
   * K4-07: deemed profit from Section 44ADA presumptive professional income
   * (50% of declared gross receipts). REGIME-INDEPENDENT (unlike
   * `housePropertyIncome`) — the same `ComputedValue` object is reused on
   * both `oldRegime` and `newRegime` (mirrors how `computeTax`'s top-level
   * `grossTotalIncome` is one shared figure) since Section 44ADA's deemed-
   * profit rate does not vary by regime. Included IN `normalTaxableIncome`
   * below, kept as its own figure only for traceability/display.
   */
  presumptiveProfessionalIncome: ComputedValue;
  /**
   * K4-08: deemed profit from Section 44AD presumptive business income
   * (6% × banking/electronic-mode turnover + 8% × cash turnover). Like
   * `presumptiveProfessionalIncome` above this is REGIME-INDEPENDENT — the
   * same `ComputedValue` object is reused on both regimes, since Section
   * 44AD's deemed-profit rates do not vary by regime. Included IN
   * `normalTaxableIncome` below, kept as its own figure only for
   * traceability/display, never summed twice.
   */
  presumptiveBusinessIncome: ComputedValue;
  /**
   * K4-14: net profit from a BOOKS-BASED business or profession (declared
   * revenue less declared expenses, Sections 28/29). REGIME-INDEPENDENT: the
   * rule takes no regime argument, so both regimes carry an equal figure with
   * equal sources. (Unlike the two presumptive figures, which live on the
   * shared `DerivedIncome`, this one is computed per regime alongside
   * `housePropertyIncome` — equal by construction rather than by object
   * identity, which `compute-tax.test.ts` asserts rather than assumes.)
   *
   * That regime-independence is a CONSEQUENCE of the slice's narrowness, not
   * an assumption about business income generally: Section 115BAC(2) disallows
   * particular business deductions (additional depreciation, Section 35AD and
   * others) in the new regime, so a books figure that carried ANY Sections
   * 30-43D adjustment would differ between the regimes. This slice refuses
   * every such case, so the only figure that can reach here — revenue less
   * declared allowable expenses with no adjustment — is genuinely the same
   * number under both. A future slice that computes depreciation MUST revisit
   * this and make the figure regime-dependent.
   *
   * Included IN `normalTaxableIncome` below (business income is ordinary
   * slab-rate income), kept as its own figure only for traceability/display,
   * never summed twice.
   */
  businessBooksIncome: ComputedValue;
  /**
   * K4-10: total brought-forward capital loss (Section 74) absorbed against
   * this year's surviving gains. REGIME-INDEPENDENT — the same
   * `ComputedValue` is reused on both regimes, since Section 74 set-off does
   * not vary by regime. Already reflected IN `specialRateCapitalGains` below;
   * kept as its own figure only for traceability/display, never subtracted
   * twice.
   */
  broughtForwardLossSetOff: ComputedValue;
  /** Slab-rate income after standard deduction + Chapter VI-A (excludes capital gains). */
  normalTaxableIncome: ComputedValue;
  specialRateCapitalGains: ComputedValue;
  totalIncome: ComputedValue;
  slabTax: ComputedValue;
  specialRateTax: ComputedValue;
  rebate: ComputedValue;
  /**
   * K4-12 — section 87A rebate-threshold marginal relief (clause (b) of the
   * s.115BAC(1A) proviso). ALREADY inside `rebate` above; kept as its own
   * figure only for traceability/display, never added twice. Nil at or below
   * the ceiling, and nil under the old regime, where the relief does not reach.
   */
  rebateMarginalRelief: ComputedValue;
  /**
   * K4-12 — whether this regime's section 87A deduction is a complete
   * treatment, and why not when it is not. The authority for that judgement;
   * nothing re-derives it from the income (see `rebate-relief.ts`).
   */
  rebateTreatment: Rebate87ATreatment;
  /**
   * K4-11 — surcharge, NET of marginal relief. No longer a placeholder: ₹0 for
   * a total income at or below ₹50,00,000 is a computed nil, and a real figure
   * is charged inside the implemented window. ₹0 ABOVE the window's ceiling is
   * still not a nil — read {@link surchargeTreatment} to tell the three apart,
   * never the number alone.
   */
  surcharge: ComputedValue;
  /**
   * K4-11 — marginal relief applied at the ₹50,00,000 / ₹1,00,00,000 surcharge
   * thresholds. ALREADY netted inside `surcharge` above; kept as its own figure
   * only for traceability/display, never subtracted twice.
   */
  marginalRelief: ComputedValue;
  /**
   * K4-11 — whether this regime's surcharge figure is a complete treatment, and
   * why not when it is not. The authority for that judgement; nothing
   * re-derives it from the income (see `surcharge.ts`).
   */
  surchargeTreatment: SurchargeTreatment;
  cess: ComputedValue;
  grossTaxLiability: ComputedValue;
  taxPaid: ComputedValue;
  /** Positive = tax payable, negative = refund. */
  refundOrPayable: ComputedValue;
  notes: string[];
}

export interface TaxComputation {
  assessmentYear: string;
  financialYear: string;
  rulesVersion: string;
  grossTotalIncome: ComputedValue;
  ordinaryIncome: ComputedValue;
  specialRateCapitalGains: ComputedValue;
  deductionsAllowed: ComputedValue;
  totalIncome: ComputedValue;
  oldRegimeTax: ComputedValue;
  newRegimeTax: ComputedValue;
  recommendedRegime: Regime;
  specialRateTax: ComputedValue;
  rebate: ComputedValue;
  cess: ComputedValue;
  grossTaxLiability: ComputedValue;
  taxPaid: ComputedValue;
  refundOrPayable: ComputedValue;
  /** Full per-regime detail for the recommended and alternative regimes. */
  oldRegime: RegimeComputation;
  newRegime: RegimeComputation;
  /**
   * K4-09 — the within-year capital-loss set-off behind the net 111A/112A
   * figures above. REGIME-INDEPENDENT (a capital loss set-off does not differ
   * by regime), so it sits at the top level rather than inside either
   * `RegimeComputation`.
   *
   * Exposed so `validate-case.ts` can disclose what was absorbed WITHOUT
   * deriving it a second time. Optional because a snapshot's stored JSON
   * predating K4-09 will not carry it — readers must treat absence as "no
   * set-off was computed", which is the historically correct value (the
   * concept did not exist), never a fabricated one. Same discipline as
   * `K4-06`'s `fromComputedOrAbsent` fix.
   */
  capitalLossSetOff?: CapitalLossSetOff;
  /**
   * K4-10 — the BROUGHT-FORWARD (Section 74) set-off, kept as its own figure
   * rather than merged into `capitalLossSetOff`. The two are governed by
   * different sections, run at different points in the pipeline, and have
   * different residual behaviour: a within-year residual is refused outright
   * (`CAPITAL_LOSS_NOT_MODELLED`), while a brought-forward residual is a first-
   * class recorded output that continues to carry forward.
   *
   * Optional for the same reason `capitalLossSetOff` is: a stored snapshot
   * predating K4-10 will not carry it, and readers must treat absence as "no
   * brought-forward set-off was computed" — the historically correct value,
   * never a fabricated one (`K4-06`'s `fromComputedOrAbsent` discipline).
   */
  broughtForwardLossSetOff?: BroughtForwardLossSetOff;
  /**
   * K4-11 — TRUE only when BOTH regimes' surcharge treatment is complete. This
   * is the single marker the UI banner, filing readiness, the client-review
   * action and the three guarded RPCs all read, rather than each re-deriving
   * the income test (the generalisation of D44 from a number to a judgement).
   *
   * Optional for the same reason `capitalLossSetOff` is: a snapshot's stored
   * JSON predating K4-11 carries no such property. Readers MUST treat absence
   * as NOT supported — which reproduces exactly the pre-K4-11 behaviour (every
   * case above ₹50,00,000 blocked) and fails closed, never open.
   */
  surchargeTreatmentSupported?: boolean;
  /**
   * K4-12 — TRUE only when BOTH regimes' section 87A treatment is complete.
   * The single marker every enforcement layer reads for the REBATE-threshold
   * relief, which is a different question from `surchargeTreatmentSupported`
   * above and must never be conflated with it.
   *
   * Optional for the same reason: a snapshot's stored JSON predating K4-12
   * carries no such property. Readers MUST treat absence as NOT supported —
   * but the blocker that consumes it is gated on an income window first, so
   * absence only blocks the narrow band where the relief could actually have
   * been due, never every historical snapshot.
   */
  rebateReliefTreatmentSupported?: boolean;
  /**
   * K4-23 — TRUE only when BOTH regimes computed the s.112 house-sale
   * long-term treatment. Optional for the same reason as the two above: a
   * snapshot predating K4-23 carries no such property, and a reader MUST
   * treat absence as NOT supported. Absence only bites a case that actually
   * carries a long-term house sale, which no pre-K4-23 snapshot can, because
   * every such case refused.
   */
  houseSaleLtcgTreatmentSupported?: boolean;
  notes: string[];
}

/** K4-11 — see `surcharge.ts`. Re-exported from the engine's type surface so
 *  readers outside the engine consume ONE definition. */
export type { SurchargeSupportState, SurchargeTreatment } from "./surcharge";

/** K4-12 — see `rebate-relief.ts`. Re-exported from the engine's type surface
 *  so readers outside the engine consume ONE definition. */
export type { Rebate87ASupportState, Rebate87ATreatment } from "./rebate-relief";

/** K4-09 — see `compute-tax.ts`'s `computeCapitalLossSetOff`. */
export interface CapitalLossSetOff {
  grossStcg111a: number;
  grossLtcg112a: number;
  stcl111a: number;
  ltcl112a: number;
  absorbedAgainstStcg: number;
  absorbedAgainstLtcg: number;
  residual: number;
}

// ---------------------------------------------------------------------------
// K4-10 — brought-forward capital losses (Section 74)
// ---------------------------------------------------------------------------

/**
 * K4-10 — the type of a prior-year capital loss brought forward.
 *
 * Kept DISTINCT from {@link CapitalGainCategory} on purpose. A brought-forward
 * loss is governed by Section 74 and carries an originating assessment year
 * and an expiry; a current-year gain row is governed by Sections 111A/112A and
 * carries neither. Sharing one vocabulary would erase exactly the
 * current-year-vs-brought-forward distinction that must stay explicit in
 * storage, in the engine input, in the computed output and on screen.
 */
export type BroughtForwardLossType = "stcl" | "ltcl";

/** The gain buckets this engine computes, as set-off destinations. */
export type BroughtForwardSetOffTarget = "stcg_111a" | "ltcg_112a";

/**
 * Section 139(3)/80: a loss is carryable at all only if the loss return for
 * the originating year was filed by the due date. `"unverified"` FAILS CLOSED
 * — it is never treated as eligible.
 */
export type BroughtForwardFilingEligibility = "verified_timely" | "unverified" | "not_eligible";

/**
 * How much assurance the recorded figure carries. A loss carried out of a
 * FINALIZED prior case in this system is not the same kind of fact as a
 * staff-declared figure, and the preparer must see which one is in play.
 */
export type BroughtForwardLossProvenance = "prior_finalized_case_in_system" | "staff_declared";

/**
 * ONE brought-forward carry-forward record. The originating assessment year
 * and the loss type together are its IDENTITY — a bare amount is not a
 * carry-forward record, because the Section 74(2) expiry test needs the year
 * and the Section 74(1) destination test needs the type.
 */
export interface BroughtForwardLossEntry {
  id: string;
  /** The assessment year the loss was FIRST COMPUTED in, as `YYYY-YY`. */
  originatingAssessmentYear: string;
  lossType: BroughtForwardLossType;
  /** Unabsorbed loss brought forward, as a POSITIVE magnitude. */
  amount: number;
  filingEligibility: BroughtForwardFilingEligibility;
  provenance: BroughtForwardLossProvenance;
  /** Set only for `prior_finalized_case_in_system`; informational. */
  priorTaxCaseId?: string | null;
  /** Absent/null = no election; the portal-default policy applies. */
  electedSetOffTarget?: BroughtForwardSetOffTarget | null;
  sourceType?: SourceType;
  sourceDocumentId?: string;
}

/** One recorded application of one loss record against one gain bucket. */
export interface BroughtForwardAllocation {
  recordId: string;
  originatingAssessmentYear: string;
  lossType: BroughtForwardLossType;
  target: BroughtForwardSetOffTarget;
  amount: number;
  policyId: string;
}

/**
 * What is left of one loss record after this year, and how long it survives.
 * A carry-forward residual that is computed but not recorded is the defect
 * this shape exists to prevent.
 */
export interface BroughtForwardResidual {
  recordId: string;
  originatingAssessmentYear: string;
  lossType: BroughtForwardLossType;
  amount: number;
  /** The last assessment year this residual may still be set off in (s.74(2)). */
  finalEligibleAssessmentYear: string;
  /** True when this is the final year — the residual lapses after it. */
  expiresAfterThisYear: boolean;
}

/** A record that could NOT be used, and exactly why. Never a silent drop. */
export interface BroughtForwardExclusion {
  recordId: string;
  originatingAssessmentYear: string;
  lossType: BroughtForwardLossType;
  amount: number;
  reason:
    | "expired_8_assessment_years"
    | "filing_not_eligible"
    | "filing_eligibility_unverified"
    | "unparseable_originating_assessment_year"
    | "not_a_prior_assessment_year";
  message: string;
}

/** A taxpayer election the engine refused to apply silently. */
export interface BroughtForwardElectionDivergence {
  recordId: string;
  originatingAssessmentYear: string;
  lossType: BroughtForwardLossType;
  electedTarget: BroughtForwardSetOffTarget;
  kind: "unlawful_target" | "diverges_from_portal_default";
  message: string;
}

/** K4-10 — see `brought-forward-set-off.ts`'s `computeBroughtForwardSetOff`. */
export interface BroughtForwardLossSetOff {
  /** The NAMED, VERSIONED allocation policy applied — never "the statutory order". */
  policyId: string;
  policyVersion: string;
  requiresProfessionalReview: boolean;
  auditFlagged: boolean;
  /** Gains surviving WITHIN-YEAR set-off, i.e. what was available to absorb. */
  availableStcg111a: number;
  availableLtcg112a: number;
  absorbedAgainstStcg: number;
  absorbedAgainstLtcg: number;
  allocations: BroughtForwardAllocation[];
  residuals: BroughtForwardResidual[];
  excluded: BroughtForwardExclusion[];
  electionDivergences: BroughtForwardElectionDivergence[];
}

// ---------------------------------------------------------------------------
// compareRegimes output
// ---------------------------------------------------------------------------

export interface RegimeComparison {
  oldRegime: RegimeComputation;
  newRegime: RegimeComputation;
  recommendedRegime: Regime;
  /** oldRegimeTax - newRegimeTax (positive = new regime saves this much). */
  difference: ComputedValue;
  notes: string[];
}

// ---------------------------------------------------------------------------
// recommendItrForm output
// ---------------------------------------------------------------------------

export interface ItrFormRecommendation {
  recommendedItrType: ItrType;
  /** Reasons ITR-1 is NOT allowed (e.g. capital gains present). */
  blockers: string[];
  reasons: string[];
  notes: string[];
}

// ---------------------------------------------------------------------------
// validateCase output
// ---------------------------------------------------------------------------

export type ValidationSeverity = "info" | "warning" | "blocker";

export type ValidationArea =
  | "documents"
  | "reconciliation"
  | "itr_form"
  | "deductions"
  | "payments"
  | "workflow"
  | "security";

export interface ValidationFinding {
  code: string;
  severity: ValidationSeverity;
  area: ValidationArea;
  message: string;
  sourceValue?: number;
  enteredValue?: number;
  difference?: number;
  suggestedAction: string;
  sources: string[];
}

export interface ValidationResult {
  findings: ValidationFinding[];
  hasBlockers: boolean;
}
