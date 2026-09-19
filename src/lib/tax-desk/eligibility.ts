/**
 * Tax Desk → Computation Eligibility Gate (K.2.8.9A). PURE — no React/Next/
 * Supabase, no DB writes. Deterministic and unit-testable.
 *
 * ONE canonical eligibility evaluator. It answers a single question: is this tax
 * case allowed to be calculated, recommended, presented as ready, sent for
 * client review, or finalized by the current AY 2026-27 engine? No UI component
 * or server action may re-derive its own conflicting eligibility logic — they
 * all call {@link evaluateEligibility}.
 *
 * Eligibility is DERIVED from authoritative case/profile/ledger/validation data
 * every time it is needed — it is never a mutable stored boolean that can go
 * stale. A profile or ledger mutation therefore changes the result immediately.
 *
 * Three outcomes per condition:
 *   - blocker: computation / progression MUST stop.
 *   - warning: calculation may continue but professional attention is required.
 *   - eligible: all mandatory conditions are satisfied.
 *
 * This is a PREPARATION boundary, not tax advice. "Eligible" only means the
 * current engine can safely represent the case — it never asserts the return is
 * correct, complete, reviewed, or fileable.
 */

import { SUPPORTED_ASSESSMENT_YEAR } from "@/lib/validation/tax-case";

/** Bump when blocker codes, ordering, or trigger conditions change. */
export const ELIGIBILITY_RULES_VERSION = "K2.8.9A.eligibility.v1";

/** Residential statuses the profile can hold. Only `resident` is engine-supported. */
export const RESIDENTIAL_STATUSES = [
  "resident",
  "non_resident",
  "not_ordinarily_resident",
] as const;
export type ResidentialStatus = (typeof RESIDENTIAL_STATUSES)[number];

/** Taxpayer categories the profile can hold. Only `individual` is engine-supported. */
export const TAXPAYER_CATEGORIES = ["individual", "huf"] as const;
export type TaxpayerCategory = (typeof TAXPAYER_CATEGORIES)[number];

/**
 * Structured declarations of tax situations the AY 2026-27 engine does NOT
 * reliably support. Declaring any one routes the case to manual professional
 * review (a blocker). Order here is the canonical, deterministic blocker order.
 */
export const SPECIAL_SITUATIONS = [
  { code: "business_or_professional_income", label: "business or professional income" },
  { code: "foreign_income_or_assets", label: "foreign income or foreign assets" },
  { code: "virtual_digital_assets", label: "virtual digital assets / crypto" },
  { code: "futures_and_options", label: "F&O or speculative transactions" },
  { code: "clubbing_of_income", label: "clubbing of income" },
  { code: "brought_forward_losses", label: "brought-forward or carry-forward losses" },
  { code: "agricultural_special_rate", label: "agricultural income needing special-rate treatment" },
  { code: "nonresident_special_rate", label: "a non-resident special-rate situation" },
  { code: "surcharge_or_marginal_relief", label: "a surcharge or marginal-relief situation" },
  // K4-19: salary or pension received in ARREARS or in advance, where Section
  // 89(1) relief under Rule 21A may be due and Form 10E may be required.
  //
  // THIS ONE IS DIFFERENT FROM EVERY OTHER MEMBER ABOVE, and the difference is
  // why it has to be declarable at all. Each of the others describes something
  // the data can eventually reveal — a head of income, a loss, a residential
  // status, an income level. Arrears cannot: Rs. 8,00,000 of salary is byte-for-
  // byte identical whether or not Rs. 3,00,000 of it is arrears. So no
  // income-derived detector of the `tax-capability.ts` kind is possible here,
  // and a declaration is not a weaker substitute for one — it is the only
  // mechanism there is.
  //
  // Declaring it routes the case to manual professional preparation through the
  // existing K.2.8.9A gate. NOT declaring it is not caught by anything: that
  // case gets the universal Computation disclosure and nothing stronger.
  { code: "salary_arrears_section_89", label: "salary or pension arrears needing Section 89 relief (Form 10E)" },
  { code: "other_unsupported", label: "another situation the current engine does not support" },
] as const;

export type SpecialSituationCode = (typeof SPECIAL_SITUATIONS)[number]["code"];

const SPECIAL_SITUATION_ORDER = new Map(SPECIAL_SITUATIONS.map((s, i) => [s.code, i] as const));
const SPECIAL_SITUATION_LABEL = new Map(SPECIAL_SITUATIONS.map((s) => [s.code, s.label] as const));

export function isSpecialSituationCode(v: string): v is SpecialSituationCode {
  return SPECIAL_SITUATION_ORDER.has(v as SpecialSituationCode);
}

/** A single reason computation/progression is blocked, with remediation context. */
export interface EligibilityBlocker {
  code: string;
  message: string;
  /** Profile field the user should fix, when the blocker maps to one. */
  field?: string;
  /** Safe source reference (ledger id, situation code, etc.) — never sensitive text. */
  source?: string;
}

export interface EligibilityWarning {
  code: string;
  message: string;
  source?: string;
}

/** The one canonical eligibility result shape. */
export interface EligibilityResult {
  eligible: boolean;
  blockers: EligibilityBlocker[];
  warnings: EligibilityWarning[];
  evaluatedAt: string;
  version: string;
}

/** A live ledger entry the engine cannot represent (from ledger-support). */
export interface EligibilityUnsupportedEntry {
  ledgerId: string;
  entryType: string;
  code: string;
}

/**
 * Authoritative inputs to the evaluator. Every field must come from server-side
 * data (profile columns, live ledger rows, validation findings) — never from a
 * browser-supplied eligibility flag or blocker list.
 */
export interface EligibilityInput {
  profile: {
    /** ISO date string or null. Reused from clients.date_of_birth. */
    dateOfBirth: string | null;
    residentialStatus: string | null;
    taxpayerCategory: string | null;
    assessmentYear: string;
  };
  data: {
    /** True when there is at least one meaningful (non-placeholder) tax figure. */
    hasMeaningfulData: boolean;
    /** Live ledger entries the engine cannot represent (placeholder heads, losses). */
    unsupportedEntries: EligibilityUnsupportedEntry[];
  };
  /** Structured declared unsupported situations (from the profile). */
  declaredSpecialSituations: string[];
  validation: {
    /** Open findings at error/blocker severity (correctness failures). */
    openBlocking: number;
    /** Open findings at warning severity (professional attention, non-blocking). */
    openWarning: number;
  };
}

function blocker(code: string, message: string, extra?: { field?: string; source?: string }): EligibilityBlocker {
  return { code, message, ...extra };
}

/**
 * Evaluate computation eligibility. Pure + deterministic: blocker order is fixed
 * (profile → data presence → unsupported profile → unsupported ledger → declared
 * situations → validation), so the same inputs always produce the same ordered
 * result.
 *
 * @param now Injectable clock for deterministic tests. Defaults to `new Date()`.
 */
export function evaluateEligibility(input: EligibilityInput, now: Date = new Date()): EligibilityResult {
  const blockers: EligibilityBlocker[] = [];
  const warnings: EligibilityWarning[] = [];
  const p = input.profile;

  // --- A. Taxpayer profile completeness -------------------------------------
  if (!p.dateOfBirth) {
    blockers.push(
      blocker("PROFILE_DOB_MISSING", "Add the taxpayer's date of birth.", { field: "dateOfBirth" }),
    );
  }
  if (!p.residentialStatus) {
    blockers.push(
      blocker("PROFILE_RESIDENTIAL_STATUS_MISSING", "Select the taxpayer's residential status.", {
        field: "residentialStatus",
      }),
    );
  }
  if (!p.taxpayerCategory) {
    blockers.push(
      blocker("PROFILE_CATEGORY_MISSING", "Select the taxpayer category.", { field: "taxpayerCategory" }),
    );
  }
  if (p.assessmentYear !== SUPPORTED_ASSESSMENT_YEAR) {
    blockers.push(
      blocker(
        "PROFILE_ASSESSMENT_YEAR_UNSUPPORTED",
        `Assessment year ${p.assessmentYear} is not supported by the current engine (only AY ${SUPPORTED_ASSESSMENT_YEAR}).`,
        { field: "assessmentYear" },
      ),
    );
  }

  // --- B. Meaningful tax data present ---------------------------------------
  if (!input.data.hasMeaningfulData) {
    blockers.push(
      blocker(
        "NO_MEANINGFUL_DATA",
        "Add at least one meaningful income or tax-paid entry before computing.",
      ),
    );
  }

  // --- C1. Unsupported profile (residency / category) -----------------------
  if (p.residentialStatus && p.residentialStatus !== "resident") {
    blockers.push(
      blocker(
        "UNSUPPORTED_RESIDENTIAL_STATUS",
        "Outside the automatic engine's scope (it supports resident individuals only) — this case needs manual professional preparation.",
        { field: "residentialStatus", source: p.residentialStatus },
      ),
    );
  }
  if (p.taxpayerCategory && p.taxpayerCategory !== "individual") {
    blockers.push(
      blocker(
        "UNSUPPORTED_TAXPAYER_CATEGORY",
        `Outside the automatic engine's scope (it supports the "individual" category only) — this case needs manual professional preparation.`,
        { field: "taxpayerCategory", source: p.taxpayerCategory },
      ),
    );
  }

  // --- C2. Unsupported ledger entries (engine-derived) ----------------------
  const unsupported = [...input.data.unsupportedEntries].sort((a, b) =>
    a.ledgerId < b.ledgerId ? -1 : a.ledgerId > b.ledgerId ? 1 : 0,
  );
  if (unsupported.length > 0) {
    blockers.push(
      blocker(
        "UNSUPPORTED_LEDGER_ENTRY",
        `${unsupported.length} ledger entr${unsupported.length === 1 ? "y is" : "ies are"} not supported by the current engine and need manual tax treatment. Remove or reclassify them in Ledgers.`,
        { source: unsupported.map((u) => u.ledgerId).join(",") },
      ),
    );
  }

  // --- C3. Declared unsupported situations → manual review ------------------
  const declared = [...new Set(input.declaredSpecialSituations)]
    .filter(isSpecialSituationCode)
    .sort((a, b) => (SPECIAL_SITUATION_ORDER.get(a)! - SPECIAL_SITUATION_ORDER.get(b)!));
  for (const code of declared) {
    blockers.push(
      // Blocker CODE is a stable contract (DB / e2e); only the message wording
      // is disambiguated to concept-2 ("manual professional preparation").
      blocker(
        "MANUAL_PROFESSIONAL_REVIEW_REQUIRED",
        `This case includes ${SPECIAL_SITUATION_LABEL.get(code)}, which the automatic engine does not support — it needs manual professional preparation.`,
        { source: code },
      ),
    );
  }

  // --- D. Open blocking validation findings ---------------------------------
  if (input.validation.openBlocking > 0) {
    blockers.push(
      blocker(
        "OPEN_BLOCKING_FINDING",
        `Resolve ${input.validation.openBlocking} open blocking validation finding${input.validation.openBlocking === 1 ? "" : "s"} before progressing.`,
      ),
    );
  }

  // --- Warnings (non-blocking; must never flip eligibility) -----------------
  if (input.validation.openWarning > 0) {
    warnings.push({
      code: "OPEN_VALIDATION_WARNING",
      message: `${input.validation.openWarning} open validation warning${input.validation.openWarning === 1 ? "" : "s"} — review, but they do not block computation.`,
    });
  }

  return {
    eligible: blockers.length === 0,
    blockers,
    warnings,
    evaluatedAt: now.toISOString(),
    version: ELIGIBILITY_RULES_VERSION,
  };
}

/**
 * Blocker codes that mean the case cannot even produce a supported-entries
 * preview — the taxpayer profile is incomplete/unsupported, or the case is
 * declared out of the engine's scope. When any of these is present the
 * Computation / Client Review surfaces WITHHOLD their output entirely.
 *
 * The remaining blockers (NO_MEANINGFUL_DATA, UNSUPPORTED_LEDGER_ENTRY,
 * OPEN_BLOCKING_FINDING) are already surfaced by the pre-existing K.2.8.7
 * partial/empty-preview and K.2.6/K.2.7 validation-finding mechanisms, so they
 * do not trigger the hard withhold — they still block the snapshot / approval /
 * finalize downstream and appear in the eligibility banner.
 */
export const WITHHOLDING_BLOCKER_CODES: ReadonlySet<string> = new Set([
  "PROFILE_DOB_MISSING",
  "PROFILE_RESIDENTIAL_STATUS_MISSING",
  "PROFILE_CATEGORY_MISSING",
  "PROFILE_ASSESSMENT_YEAR_UNSUPPORTED",
  "UNSUPPORTED_RESIDENTIAL_STATUS",
  "UNSUPPORTED_TAXPAYER_CATEGORY",
  "MANUAL_PROFESSIONAL_REVIEW_REQUIRED",
]);

/** True when a taxpayer-profile / declared-situation blocker means computation
 *  output must be fully withheld (not just blocked from being snapshotted). */
export function computationWithheld(result: EligibilityResult): boolean {
  return result.blockers.some((b) => WITHHOLDING_BLOCKER_CODES.has(b.code));
}
