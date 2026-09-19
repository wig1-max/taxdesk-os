/**
 * TaxDesk OS — Native Tax Desk / ITR Prep engine for AY 2026-27 / FY 2025-26.
 *
 * PREPARATION-ONLY, PURE TYPESCRIPT. This module never files a return, never
 * touches the Income Tax portal, and never stores portal credentials. See
 * README.md for the boundary and CA-verification requirements.
 *
 * Public API:
 *   - computeTax(input)       → full computation (both regimes, refund/payable)
 *   - compareRegimes(input)   → old vs new regime side-by-side
 *   - recommendItrForm(input) → basic ITR-1 vs ITR-2 recommendation
 *   - validateCase(input)     → preparation-time findings / reconciliation
 */

export {
  RULES_VERSION,
  PRE_K4_17_RULES_VERSION,
  PRE_K4_18_RULES_VERSION,
  PRE_K4_20_RULES_VERSION,
  asAdjustmentSet,
  isNoneOnlyAdjustments,
  BUSINESS_BOOKS,
  BUSINESS_BOOKS_ADJUSTMENTS,
  BUSINESS_BOOKS_ACTIVITY_CLASSIFICATIONS,
  DEPRECIATION_ASSET_CLASSES,
  DEPRECIATION_PUT_TO_USE,
  PRESUMPTIVE_44ADA,
  PRESUMPTIVE_44AD,
  PRESUMPTIVE_ACTIVITY_ELIGIBILITY,
  CAPITAL_GAINS,
  CAPITAL_LOSS_SET_OFF,
} from "./rules";
export type {
  BusinessBooksActivityClassification,
  BusinessBooksAdjustment,
  DepreciationAssetClass,
  DepreciationPutToUse,
  PresumptiveActivityType,
} from "./rules";
export { computeSection32Allowance, SECTION_32_APPENDIX_I_RATES } from "./section-32";
export {
  computeHouseSale,
  HOUSE_SALE_ACQUISITION_MODES,
  HOUSE_SALE_ASSET_KINDS,
  HOUSE_SALE_INDEXATION_CUTOFF,
  HOUSE_SALE_LTCG_RATE,
  HOUSE_SALE_REQUIRED_DECLARATIONS,
  HOUSE_SALE_S50C_TOLERANCE,
  HOUSE_SALE_SHORT_TERM_MONTHS,
} from "./house-sale";
export { computeBusinessBooksIncome } from "./compute-tax";
export { computeTax } from "./compute-tax";
export { compareRegimes } from "./compare-regimes";
export { recommendItrForm } from "./recommend-itr-form";
export { validateCase } from "./validate-case";

// K4-10 — brought-forward capital-loss set-off (Section 74) and the VERSIONED
// allocation policies it runs under. The policies are exported because the
// adapter, the traceability read model and the disclosures must all name the
// same policy — there is no unnamed "statutory order" to fall back on.
export {
  admitBroughtForwardRecord,
  assessmentYearFromStartYear,
  assessmentYearStartYear,
  computeBroughtForwardSetOff,
  finalEligibleAssessmentYear,
  lawfulTargetsFor,
  resolveLossAllocationPolicyId,
  totalBroughtForwardAbsorbed,
  totalBroughtForwardResidual,
} from "./brought-forward-set-off";
export {
  assertPortalDefaultArtifactsUnchanged,
  findLossAllocationPolicy,
  LOSS_ALLOCATION_POLICIES,
  LOSS_ALLOCATION_POLICY_IDS,
  PORTAL_DEFAULT_AY2026_27,
  PORTAL_DEFAULT_ARTIFACT_VERSIONS,
  portalDefaultArtifactDrift,
  TAXPAYER_ELECTED,
  type LossAllocationPolicy,
  type LossAllocationPolicyId,
  type PortalArtifactVersions,
} from "./loss-allocation-policy";

export {
  simpleSalariedRefundCase,
  salaryCapitalGainsCase,
  reconciliationMismatchCase,
} from "./fixtures";

export type {
  ApprovalStatus,
  BroughtForwardAllocation,
  BroughtForwardElectionDivergence,
  BroughtForwardExclusion,
  BroughtForwardFilingEligibility,
  BroughtForwardLossEntry,
  BroughtForwardLossProvenance,
  BroughtForwardLossSetOff,
  BroughtForwardLossType,
  BroughtForwardResidual,
  BroughtForwardSetOffTarget,
  BusinessBooksDepreciationBlock,
  BusinessBooksEntry,
  CapitalGainCategory,
  CapitalGainEntry,
  ComputedValue,
  DeductionEntry,
  DeductionSection,
  DocumentStatus,
  EntryBase,
  EVerificationStatus,
  FilingStatus,
  HousePropertyEntry,
  HousePropertyUsage,
  IncomeCategory,
  IncomeEntry,
  ItrFormRecommendation,
  ItrType,
  Regime,
  RegimeComparison,
  RegimeComputation,
  RequiredDocument,
  SourceType,
  TaxComputation,
  TaxEngineInput,
  TaxpayerProfile,
  TaxPaidCategory,
  TaxPaidEntry,
  ValidationArea,
  ValidationFinding,
  ValidationResult,
  ValidationSeverity,
} from "./types";
