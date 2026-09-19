/**
 * TaxDesk OS — Senior / super-senior citizen safety boundary (K4-01; blocker
 * REASON corrected in K4-02, corrected again in K4-03. The blocker
 * CONDITION itself was narrowed in K4-05 — see below.)
 *
 * PURE TYPESCRIPT ONLY. Like the rest of `src/lib/tax-desk/*`,
 * `src/lib/tax-engine/*`, `src/lib/tax-pack/*` and `src/lib/tax-lab/*`, this
 * module must NOT import React, Next.js, the Supabase client, UI components,
 * server actions, env/config, or app routes. No system clock is read here —
 * tax age is derived from the case's assessment year, never `new Date()`.
 *
 * WHY THIS EXISTS. `K4-00`'s Wave-4 coverage audit found an ACTIVE, silent
 * reliance-safety gap (the k4-common-case-coverage-and-priorities design notes
 * §1.5): `computation-adapter.ts` hardcoded every taxpayer's age category to
 * "below_60" regardless of date of birth, and — unlike surcharge/marginal
 * relief (`TAX-SAFE-01`) — no automatic reliance blocker existed for a
 * senior/super-senior citizen's case. This module is that blocker's domain
 * logic: (1) a pure, DOB-driven age-band classifier, and (2) a context-aware
 * risk evaluator that distinguishes PRE-APPROVAL regime comparison (no
 * regime chosen yet) from a SNAPSHOT's explicitly SELECTED regime.
 *
 * WHAT THIS IS NOT. It does not compute anything itself — computation lives
 * in `compute-tax.ts`/`slabs.ts`/`rules.ts`. As of `K4-05`, the FULL
 * later-computation dossier is closed: the OLD-regime senior/super-senior
 * basic-exemption widening (`K4-02`), the Section 80D cap for BOTH the
 * taxpayer's own age band (`K4-03`) AND a premium paid on a senior/super-
 * senior PARENT's behalf (`K4-05`, the `"80D_PARENTS"` ledger section), the
 * Section 80TTA/80TTB mutual-exclusivity split (`K4-03`), and the Section
 * 207(2) advance-tax exemption disclosure (`K4-04`) are ALL implemented (see
 * the k4-senior-treatment-specification design notes §10.1-§10.4). **This
 * module's OLD-regime `snapshot_selected_regime` block
 * (`SENIOR_TREATMENT_UNSUPPORTED`) and the pre-approval
 * `REGIME_COMPARISON_UNRELIABLE` disclosure were BOTH REMOVED in `K4-05`**
 * (decision D79) — no known senior-specific computation gap remains for a
 * resident senior/super-senior TAXPAYER (the population this module gates).
 * A genuinely separate, still-open gap was noted during `K4-05`'s
 * re-sourcing — a below-60 taxpayer's self/family "80D" bucket does not yet
 * widen for a senior SPOUSE — but it affects a population this module never
 * gated in the first place (see `rules.ts`'s `DEDUCTION_CAPS` module doc).
 * It does not build a second residential-status determination engine:
 * residency is read exactly as `eligibility.ts`/the taxpayer profile already
 * store it, and a case whose residency is missing or non-resident is
 * ALREADY withheld entirely by `eligibility.ts`'s
 * `PROFILE_RESIDENTIAL_STATUS_MISSING` / `UNSUPPORTED_RESIDENTIAL_STATUS`
 * blockers before this evaluator's own result could ever matter in
 * production — this module's own residency handling (still enforced,
 * unchanged by K4-05 — `RESIDENTIAL_STATUS_UNRESOLVED` still fails closed)
 * is defense-in-depth (testable in isolation), not a second authority.
 */

import { AY_2026_27_PACK_PROVENANCE } from "@/lib/tax-pack/packs/ay-2026-27-provenance";
import { findRuleProvenance } from "@/lib/tax-pack/provenance";
import type { OfficialSourceReference } from "@/lib/tax-pack/provenance";
import type { Regime, TaxpayerProfile } from "@/lib/tax-engine/ay-2026-27/types";

export const SENIOR_TREATMENT_RULES_VERSION = "K4_01.senior_treatment.v1";

// ---------------------------------------------------------------------------
// Age-band vocabulary — reuses the engine's OWN placeholder enum
// (`TaxpayerProfile.ageCategory`) rather than inventing a second one.
// ---------------------------------------------------------------------------

export const TAXPAYER_AGE_BANDS = ["below_60", "senior", "super_senior"] as const;
export type TaxpayerAgeBand = NonNullable<TaxpayerProfile["ageCategory"]>;

// ---------------------------------------------------------------------------
// Sourced age-definition provenance
// ---------------------------------------------------------------------------

const SENIOR_AGE_DEFINITION_RULE_ID = "senior_super_senior_age_definition";

const seniorAgeDefinitionProvenance = findRuleProvenance(AY_2026_27_PACK_PROVENANCE, SENIOR_AGE_DEFINITION_RULE_ID);
if (!seniorAgeDefinitionProvenance) {
  // Fail loudly at import time rather than silently using an unsourced age
  // threshold — mirrors tax-capability.ts's surcharge-threshold guard.
  throw new Error(
    `senior-treatment.ts: the AY 2026-27 pack no longer declares provenance for ` +
      `"${SENIOR_AGE_DEFINITION_RULE_ID}" — the senior/super-senior age definition must stay a ` +
      `cited, versioned pack rule.`,
  );
}

/** The provenance record backing the age thresholds below — re-exported so
 *  callers can cite it without a second lookup or a restated definition. */
export const SENIOR_AGE_DEFINITION_PROVENANCE = seniorAgeDefinitionProvenance;

// ---------------------------------------------------------------------------
// Pure, timezone-independent calendar-date arithmetic (no system clock).
// ---------------------------------------------------------------------------

interface CalendarDate {
  readonly y: number;
  /** 1-12 */
  readonly m: number;
  readonly d: number;
}

/** Strictly parses "YYYY-MM-DD", rejecting malformed strings and non-existent
 *  calendar dates (e.g. 1997-02-29) via a UTC round-trip check. Never reads
 *  local time — every component is a plain integer. */
function parseIsoCalendarDate(value: string): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const epochMs = Date.UTC(y, m - 1, d);
  if (!Number.isFinite(epochMs)) return null;
  const roundTrip = new Date(epochMs);
  if (roundTrip.getUTCFullYear() !== y || roundTrip.getUTCMonth() !== m - 1 || roundTrip.getUTCDate() !== d) {
    return null;
  }
  return { y, m, d };
}

/**
 * The previous-year END date (March 31) for an assessment year string of the
 * form "YYYY-YY" (e.g. "2026-27" -> previous year FY 2025-26 -> March 31,
 * 2026). Derived generically from the AY string's first four digits — NOT
 * hardcoded to any one assessment year, so it rolls forward correctly for a
 * future AY without code changes.
 */
function previousYearEndForAssessmentYear(assessmentYear: string): CalendarDate | null {
  const match = /^(\d{4})-\d{2}$/.exec(assessmentYear.trim());
  if (!match) return null;
  const previousYearEndYear = Number(match[1]);
  return { y: previousYearEndYear, m: 3, d: 31 };
}

function compareCalendarDates(a: CalendarDate, b: CalendarDate): number {
  if (a.y !== b.y) return a.y - b.y;
  if (a.m !== b.m) return a.m - b.m;
  return a.d - b.d;
}

/**
 * Completed years of age as of `asOf`, given `dob`. A birthday landing
 * EXACTLY on `asOf` counts as reached (matches the official "at any time
 * during the previous year" wording — the previous-year-end date is itself
 * within the previous year).
 */
function completedAgeAsOf(dob: CalendarDate, asOf: CalendarDate): number {
  let age = asOf.y - dob.y;
  const birthdayReachedThisYear = asOf.m > dob.m || (asOf.m === dob.m && asOf.d >= dob.d);
  if (!birthdayReachedThisYear) age -= 1;
  return age;
}

// ---------------------------------------------------------------------------
// Objective A — canonical age-band derivation
// ---------------------------------------------------------------------------

export type AgeDerivationUnavailableReason =
  | "missing_dob"
  | "invalid_dob"
  | "future_dob"
  | "invalid_assessment_year";

export type AgeDerivationOutcome =
  | {
      readonly outcome: "derived";
      readonly ageBand: TaxpayerAgeBand;
      /** Completed age as of the previous year's end (March 31) — the exact
       *  fact the age band was derived from, kept for disclosure/audit. */
      readonly completedAgeAtPreviousYearEnd: number;
    }
  | {
      readonly outcome: "unavailable";
      readonly reason: AgeDerivationUnavailableReason;
    };

/**
 * Derive a taxpayer's age band from date of birth + assessment year alone.
 * Pure, deterministic, and never reads the system clock — the "previous
 * year" window is derived from `assessmentYear`, so the SAME (dob,
 * assessmentYear) pair always produces the SAME result, this year or any
 * later year the AY string names.
 *
 * Official definition (Finance Act 2025, First Schedule Part III; ITD's own
 * AY 2026-27 guidance — see {@link SENIOR_AGE_DEFINITION_PROVENANCE}):
 * a RESIDENT individual is a senior citizen at 60 years or more but less than
 * 80, and a super-senior citizen at 80 years or more, "at any time during the
 * previous year" — i.e. as of the previous year's END date (March 31) at the
 * latest. This function derives ONLY the age band; residency is a SEPARATE
 * concern (see {@link evaluateSeniorTreatmentRisk}) and is never folded in
 * here, so a caller can never accidentally apply resident treatment based on
 * age alone.
 */
export function deriveTaxpayerAgeBand(
  dateOfBirth: string | null | undefined,
  assessmentYear: string,
): AgeDerivationOutcome {
  if (!dateOfBirth) {
    return { outcome: "unavailable", reason: "missing_dob" };
  }
  const dob = parseIsoCalendarDate(dateOfBirth);
  if (!dob) {
    return { outcome: "unavailable", reason: "invalid_dob" };
  }
  const previousYearEnd = previousYearEndForAssessmentYear(assessmentYear);
  if (!previousYearEnd) {
    return { outcome: "unavailable", reason: "invalid_assessment_year" };
  }
  if (compareCalendarDates(dob, previousYearEnd) > 0) {
    // A date of birth after the previous year's end is nonsensical for this
    // AY (the person was not yet born during the relevant previous year) —
    // judged purely against the AY's own date, never the system clock.
    return { outcome: "unavailable", reason: "future_dob" };
  }
  const age = completedAgeAsOf(dob, previousYearEnd);
  const ageBand: TaxpayerAgeBand = age >= 80 ? "super_senior" : age >= 60 ? "senior" : "below_60";
  return { outcome: "derived", ageBand, completedAgeAtPreviousYearEnd: age };
}

/** Convenience accessor: the age band only, or `null` when unavailable
 *  (missing/invalid/future DOB, or an unparseable assessment year). Callers
 *  that need the reason should call {@link deriveTaxpayerAgeBand} directly. */
export function taxpayerAgeBandOrNull(dateOfBirth: string | null | undefined, assessmentYear: string): TaxpayerAgeBand | null {
  const result = deriveTaxpayerAgeBand(dateOfBirth, assessmentYear);
  return result.outcome === "derived" ? result.ageBand : null;
}

// ---------------------------------------------------------------------------
// Objective C — context-aware senior-treatment risk evaluator
// ---------------------------------------------------------------------------

export const SENIOR_TREATMENT_EVALUATION_CONTEXTS = [
  "pre_approval_regime_comparison",
  "snapshot_selected_regime",
] as const;
export type SeniorTreatmentEvaluationContext = (typeof SENIOR_TREATMENT_EVALUATION_CONTEXTS)[number];

/** Stable blocker/disclosure codes — public contracts (server actions, guarded
 *  RPCs, E2E assertions, the capability matrix doc). Never renamed casually.
 *  Residency itself is NOT given a new code here: `eligibility.ts` already
 *  owns `PROFILE_RESIDENTIAL_STATUS_MISSING` / `UNSUPPORTED_RESIDENTIAL_STATUS`
 *  for a missing/non-resident case, and this module's own defense-in-depth
 *  residency check reuses those semantics rather than inventing a third. */
export const SENIOR_TREATMENT_UNSUPPORTED_CODE = "SENIOR_TREATMENT_UNSUPPORTED" as const;
export const REGIME_COMPARISON_UNRELIABLE_CODE = "REGIME_COMPARISON_UNRELIABLE" as const;
export const RESIDENTIAL_STATUS_UNRESOLVED_CODE = "RESIDENTIAL_STATUS_UNRESOLVED" as const;

export type SeniorTreatmentRiskCode =
  | typeof SENIOR_TREATMENT_UNSUPPORTED_CODE
  | typeof REGIME_COMPARISON_UNRELIABLE_CODE
  | typeof RESIDENTIAL_STATUS_UNRESOLVED_CODE;

export interface SeniorTreatmentEvaluationInput {
  /** `null` when age could not be derived (see {@link AgeDerivationOutcome}) —
   *  this evaluator does not itself withhold for that; `eligibility.ts`'s
   *  `PROFILE_DOB_MISSING` blocker already owns that gate. */
  readonly ageBand: TaxpayerAgeBand | null;
  /** Raw stored residential-status value, exactly as the taxpayer profile
   *  carries it (`"resident" | "non_resident" | "not_ordinarily_resident"`),
   *  or `null` when unresolved. Never re-derived or guessed. */
  readonly residentialStatus: string | null;
  readonly context: SeniorTreatmentEvaluationContext;
  /** Required (non-null) only for `"snapshot_selected_regime"` — the regime
   *  an evidence manifest explicitly selected, never the engine's silent
   *  recommendation. `null` in `"pre_approval_regime_comparison"` context,
   *  where no regime has been explicitly selected yet by definition. */
  readonly selectedRegime: Regime | null;
}

export interface SeniorTreatmentResult {
  readonly ageBand: TaxpayerAgeBand | null;
  readonly residentialStatus: string | null;
  readonly evaluationContext: SeniorTreatmentEvaluationContext;
  readonly selectedRegime: Regime | null;
  readonly riskCode: SeniorTreatmentRiskCode | null;
  readonly isRelianceBlocked: boolean;
  readonly affectedCapability: "senior_citizen_treatment";
  readonly reason: string;
  readonly officialSourceReferences: readonly OfficialSourceReference[];
  readonly rulesVersion: string;
}

function result(
  input: SeniorTreatmentEvaluationInput,
  riskCode: SeniorTreatmentRiskCode | null,
  isRelianceBlocked: boolean,
  reason: string,
): SeniorTreatmentResult {
  return {
    ageBand: input.ageBand,
    residentialStatus: input.residentialStatus,
    evaluationContext: input.context,
    selectedRegime: input.selectedRegime,
    riskCode,
    isRelianceBlocked,
    affectedCapability: "senior_citizen_treatment",
    reason,
    officialSourceReferences: SENIOR_AGE_DEFINITION_PROVENANCE.sources,
    rulesVersion: SENIOR_TREATMENT_RULES_VERSION,
  };
}

/**
 * Evaluate the senior/super-senior reliance risk for one case at one
 * evaluation context. Pure, deterministic, no DB/engine call.
 *
 * Design (Objective C, as of K4-05 — decision D79):
 *  - `pre_approval_regime_comparison` (no regime explicitly selected yet):
 *    the FULL later-computation dossier (§10.1-§10.4) is now real for a
 *    resident senior/super-senior taxpayer, so the automatic old-vs-new
 *    comparison and recommendation are NO LONGER flagged unreliable —
 *    `REGIME_COMPARISON_UNRELIABLE` was REMOVED in K4-05.
 *  - `snapshot_selected_regime` (a regime has been explicitly selected, e.g.
 *    for an evidence manifest): selecting the OLD regime is NO LONGER
 *    blocked SOLELY for a resident senior/super-senior taxpayer's age —
 *    `SENIOR_TREATMENT_UNSUPPORTED` was REMOVED in K4-05 — matching how the
 *    NEW regime already behaved. Both regimes now receive identical
 *    treatment from this evaluator's own senior-specific mechanism.
 *
 * Residency (still enforced, UNCHANGED by K4-05 — defense-in-depth only, see
 * module doc): a `null` residential status still fails closed
 * (`RESIDENTIAL_STATUS_UNRESOLVED`); a non-resident value never receives
 * resident senior/super-senior treatment (this function returns
 * `isRelianceBlocked: false` for the SENIOR mechanism specifically — the
 * case is governed by ordinary non-resident capability, which
 * `eligibility.ts`'s own `UNSUPPORTED_RESIDENTIAL_STATUS` blocker already
 * withholds).
 */
export function evaluateSeniorTreatmentRisk(input: SeniorTreatmentEvaluationInput): SeniorTreatmentResult {
  const { ageBand, residentialStatus, context, selectedRegime } = input;

  if (residentialStatus === null || residentialStatus === undefined) {
    return result(
      input,
      RESIDENTIAL_STATUS_UNRESOLVED_CODE,
      true,
      "Residential status is required to determine whether resident senior/super-senior treatment " +
        "applies, and is not resolved for this case. (In production this case is already withheld " +
        "entirely by the computation eligibility gate's PROFILE_RESIDENTIAL_STATUS_MISSING blocker " +
        "before this evaluator's result could matter — this is a defense-in-depth check.)",
    );
  }

  if (residentialStatus !== "resident") {
    return result(
      input,
      null,
      false,
      "Resident senior/super-senior slab treatment does not apply to a non-resident taxpayer merely " +
        "because of age. This case is governed by ordinary non-resident capability, not this " +
        "evaluator (in production, eligibility.ts's UNSUPPORTED_RESIDENTIAL_STATUS blocker already " +
        "withholds a non-resident case entirely).",
    );
  }

  if (ageBand === null) {
    return result(
      input,
      null,
      false,
      "Age band could not be derived for this taxpayer (missing/invalid date of birth or " +
        "assessment year). This evaluator does not itself withhold the case — a missing or invalid " +
        "date of birth is the computation eligibility gate's own PROFILE_DOB_MISSING blocker.",
    );
  }

  if (ageBand === "below_60") {
    return result(input, null, false, "Taxpayer is below 60 — senior/super-senior treatment does not apply.");
  }

  // Resident senior or super-senior citizen from here on.
  if (context === "pre_approval_regime_comparison") {
    return result(
      input,
      null,
      false,
      "This taxpayer is a resident senior/super-senior citizen. The engine now applies the " +
        "senior/super-senior OLD-regime basic-exemption widening (K4-02), age-gates the Section " +
        "80D cap and the Section 80TTA/80TTB mutual-exclusivity split for the taxpayer's OWN age " +
        "band (K4-03), applies Section 80D's independent parents-bucket cap for a premium paid on " +
        "a senior/super-senior PARENT's behalf (K4-05), and discloses the Section 207(2) advance-" +
        "tax exemption (K4-04) — the full later-computation dossier is closed, so the automatic " +
        "old-vs-new regime comparison and recommendation are no longer flagged unreliable for this " +
        "case (K4-05, decision D79). This is not a claim of CA verification — every tax pack " +
        "remains draft.",
    );
  }

  // context === "snapshot_selected_regime"
  if (selectedRegime === "old") {
    return result(
      input,
      null,
      false,
      "This case selected the OLD regime for a resident senior/super-senior taxpayer. The engine " +
        "now applies the senior/super-senior OLD-regime basic-exemption widening (K4-02), age-gates " +
        "the Section 80D cap and the Section 80TTA/80TTB mutual-exclusivity split for the " +
        "taxpayer's OWN age band (K4-03), and applies Section 80D's independent parents-bucket cap " +
        "for a premium paid on a senior/super-senior PARENT's behalf (K4-05) — no known senior-" +
        "specific computation gap remains, so reliance on the OLD regime is no longer blocked " +
        "solely for this taxpayer's age (K4-05, decision D79). This is not a claim of CA " +
        "verification — every tax pack remains draft, and reliance still requires the pack layer's " +
        "own separate gate to clear.",
    );
  }
  if (selectedRegime === "new") {
    return result(
      input,
      null,
      false,
      "This case selected the NEW regime, whose slab rates are age-neutral for a resident " +
        "senior/super-senior taxpayer under the current AY 2026-27 rules — not blocked solely for " +
        "age. As of K4-05, the OLD-regime comparison is no longer flagged unreliable for this " +
        "taxpayer either (the full later-computation dossier is closed).",
    );
  }
  // selectedRegime === null in this context: defensive only — every current
  // caller (the evidence-manifest gate) supplies a selected regime before
  // reaching this context.
  return result(
    input,
    null,
    false,
    "No regime has been explicitly selected yet for this snapshot; senior-treatment risk at the " +
      "selected-regime layer cannot be evaluated until one is chosen.",
  );
}
