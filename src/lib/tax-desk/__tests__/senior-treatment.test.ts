import { describe, it, expect } from "vitest";
import {
  deriveTaxpayerAgeBand,
  taxpayerAgeBandOrNull,
  evaluateSeniorTreatmentRisk,
  SENIOR_TREATMENT_UNSUPPORTED_CODE,
  REGIME_COMPARISON_UNRELIABLE_CODE,
  RESIDENTIAL_STATUS_UNRESOLVED_CODE,
  SENIOR_AGE_DEFINITION_PROVENANCE,
} from "../senior-treatment";

const AY = "2026-27"; // previous year end: 2026-03-31

describe("deriveTaxpayerAgeBand — required boundary tests (AY 2026-27)", () => {
  it("DOB 1966-04-01 remains below 60 throughout the previous year", () => {
    const r = deriveTaxpayerAgeBand("1966-04-01", AY);
    expect(r).toEqual({ outcome: "derived", ageBand: "below_60", completedAgeAtPreviousYearEnd: 59 });
  });

  it("DOB 1966-03-31 turns 60 during the previous year -> senior", () => {
    const r = deriveTaxpayerAgeBand("1966-03-31", AY);
    expect(r).toEqual({ outcome: "derived", ageBand: "senior", completedAgeAtPreviousYearEnd: 60 });
  });

  it("DOB 1946-04-01 remains below 80 throughout the previous year (senior, not super-senior)", () => {
    const r = deriveTaxpayerAgeBand("1946-04-01", AY);
    expect(r).toEqual({ outcome: "derived", ageBand: "senior", completedAgeAtPreviousYearEnd: 79 });
  });

  it("DOB 1946-03-31 turns 80 during the previous year -> super-senior", () => {
    const r = deriveTaxpayerAgeBand("1946-03-31", AY);
    expect(r).toEqual({ outcome: "derived", ageBand: "super_senior", completedAgeAtPreviousYearEnd: 80 });
  });

  it("missing date of birth is unavailable (missing_dob)", () => {
    expect(deriveTaxpayerAgeBand(null, AY)).toEqual({ outcome: "unavailable", reason: "missing_dob" });
    expect(deriveTaxpayerAgeBand(undefined, AY)).toEqual({ outcome: "unavailable", reason: "missing_dob" });
    expect(deriveTaxpayerAgeBand("", AY)).toEqual({ outcome: "unavailable", reason: "missing_dob" });
  });

  it("invalid dates are unavailable (invalid_dob)", () => {
    expect(deriveTaxpayerAgeBand("not-a-date", AY)).toEqual({ outcome: "unavailable", reason: "invalid_dob" });
    expect(deriveTaxpayerAgeBand("1990-13-01", AY)).toEqual({ outcome: "unavailable", reason: "invalid_dob" });
    expect(deriveTaxpayerAgeBand("1990-02-30", AY)).toEqual({ outcome: "unavailable", reason: "invalid_dob" });
    expect(deriveTaxpayerAgeBand("1997-02-29", AY)).toEqual({ outcome: "unavailable", reason: "invalid_dob" }); // 1997 not leap
    expect(deriveTaxpayerAgeBand("1990-04-31", AY)).toEqual({ outcome: "unavailable", reason: "invalid_dob" }); // April has 30 days
  });

  it("future dates (relative to the AY's own previous-year end, never the system clock) are unavailable", () => {
    expect(deriveTaxpayerAgeBand("2026-04-01", AY)).toEqual({ outcome: "unavailable", reason: "future_dob" });
    expect(deriveTaxpayerAgeBand("2099-01-01", AY)).toEqual({ outcome: "unavailable", reason: "future_dob" });
  });

  it("a DOB exactly on the previous-year end is valid (age 0), not future", () => {
    expect(deriveTaxpayerAgeBand("2026-03-31", AY)).toEqual({
      outcome: "derived",
      ageBand: "below_60",
      completedAgeAtPreviousYearEnd: 0,
    });
  });

  it("leap-day birth dates are handled correctly", () => {
    // 1964 is a leap year: Feb 29, 1964 is valid.
    const r = deriveTaxpayerAgeBand("1964-02-29", AY);
    expect(r).toEqual({ outcome: "derived", ageBand: "senior", completedAgeAtPreviousYearEnd: 62 });
  });

  it("assessment-year rollover: the SAME DOB produces a different age band under a later AY (not hardcoded)", () => {
    // 1966-04-01 is below_60 for AY 2026-27 (age 59) but senior for AY 2027-28 (age 60).
    expect(deriveTaxpayerAgeBand("1966-04-01", AY)).toMatchObject({ ageBand: "below_60" });
    expect(deriveTaxpayerAgeBand("1966-04-01", "2027-28")).toMatchObject({ ageBand: "senior", completedAgeAtPreviousYearEnd: 60 });
  });

  it("turns 60 on April 1 the year after the previous year ends -> still below 60 this AY", () => {
    // DOB such that 60th birthday is 2026-04-01 (just after PY end 2026-03-31).
    expect(deriveTaxpayerAgeBand("1966-04-01", AY)).toMatchObject({ ageBand: "below_60" });
  });

  it("turns 80 on April 1 the year after the previous year ends -> senior (79), not super-senior", () => {
    expect(deriveTaxpayerAgeBand("1946-04-01", AY)).toMatchObject({ ageBand: "senior", completedAgeAtPreviousYearEnd: 79 });
  });

  it("an unparseable assessment year is unavailable (invalid_assessment_year), defensively", () => {
    expect(deriveTaxpayerAgeBand("1960-01-01", "not-an-ay")).toEqual({
      outcome: "unavailable",
      reason: "invalid_assessment_year",
    });
  });

  it("timezone independence: date-only strings never shift across a UTC/local boundary", () => {
    // If this function ever went through Date's LOCAL getters on a UTC-midnight
    // Date, a negative-UTC-offset host could read 1966-03-31 back as 03-30.
    // Running the exact boundary case is the regression guard.
    const r = deriveTaxpayerAgeBand("1966-03-31", AY);
    expect(r).toEqual({ outcome: "derived", ageBand: "senior", completedAgeAtPreviousYearEnd: 60 });
  });
});

describe("taxpayerAgeBandOrNull", () => {
  it("returns the age band when derivable", () => {
    expect(taxpayerAgeBandOrNull("1946-03-31", AY)).toBe("super_senior");
  });
  it("returns null when unavailable", () => {
    expect(taxpayerAgeBandOrNull(null, AY)).toBeNull();
    expect(taxpayerAgeBandOrNull("garbage", AY)).toBeNull();
  });
});

describe("evaluateSeniorTreatmentRisk — golden specification cases (§14)", () => {
  it("Control: resident, below-60, preparation comparison -> no senior blocker", () => {
    const r = evaluateSeniorTreatmentRisk({
      ageBand: "below_60",
      residentialStatus: "resident",
      context: "pre_approval_regime_comparison",
      selectedRegime: null,
    });
    expect(r.riskCode).toBeNull();
    expect(r.isRelianceBlocked).toBe(false);
  });

  // K4-05 (decision D79): the full later-computation dossier (§10.1-§10.4)
  // is now closed, so neither REGIME_COMPARISON_UNRELIABLE nor
  // SENIOR_TREATMENT_UNSUPPORTED fires any longer for a resident senior/
  // super-senior taxpayer at EITHER regime — the codes stay exported (a
  // stable contract) but are no longer returned by this evaluator.
  it("Senior comparison: resident senior, preparation comparison -> no longer flagged unreliable (K4-05)", () => {
    const r = evaluateSeniorTreatmentRisk({
      ageBand: "senior",
      residentialStatus: "resident",
      context: "pre_approval_regime_comparison",
      selectedRegime: null,
    });
    expect(r.riskCode).toBeNull();
    expect(r.isRelianceBlocked).toBe(false);
  });

  it("Super-senior comparison: resident super-senior, preparation comparison -> no longer flagged unreliable (K4-05)", () => {
    const r = evaluateSeniorTreatmentRisk({
      ageBand: "super_senior",
      residentialStatus: "resident",
      context: "pre_approval_regime_comparison",
      selectedRegime: null,
    });
    expect(r.riskCode).toBeNull();
    expect(r.isRelianceBlocked).toBe(false);
  });

  it("Senior old regime: resident senior, selected snapshot, old regime -> no longer blocked (K4-05)", () => {
    const r = evaluateSeniorTreatmentRisk({
      ageBand: "senior",
      residentialStatus: "resident",
      context: "snapshot_selected_regime",
      selectedRegime: "old",
    });
    expect(r.riskCode).toBeNull();
    expect(r.isRelianceBlocked).toBe(false);
  });

  it("Super-senior old regime: resident super-senior, selected snapshot, old regime -> no longer blocked (K4-05)", () => {
    const r = evaluateSeniorTreatmentRisk({
      ageBand: "super_senior",
      residentialStatus: "resident",
      context: "snapshot_selected_regime",
      selectedRegime: "old",
    });
    expect(r.riskCode).toBeNull();
    expect(r.isRelianceBlocked).toBe(false);
  });

  it("Senior new regime: resident senior, selected snapshot, new regime -> not blocked solely for age", () => {
    const r = evaluateSeniorTreatmentRisk({
      ageBand: "senior",
      residentialStatus: "resident",
      context: "snapshot_selected_regime",
      selectedRegime: "new",
    });
    expect(r.riskCode).toBeNull();
    expect(r.isRelianceBlocked).toBe(false);
  });

  it("Non-resident senior by age: does not apply resident senior slab treatment (no senior-specific block)", () => {
    const r = evaluateSeniorTreatmentRisk({
      ageBand: "senior",
      residentialStatus: "non_resident",
      context: "snapshot_selected_regime",
      selectedRegime: "old",
    });
    expect(r.riskCode).toBeNull();
    expect(r.isRelianceBlocked).toBe(false);
  });

  it("Unknown residency: fails closed", () => {
    const r = evaluateSeniorTreatmentRisk({
      ageBand: "senior",
      residentialStatus: null,
      context: "snapshot_selected_regime",
      selectedRegime: "old",
    });
    expect(r.riskCode).toBe(RESIDENTIAL_STATUS_UNRESOLVED_CODE);
    expect(r.isRelianceBlocked).toBe(true);
  });

  it("Turns 60 on March 31 (resident, selected old regime) -> no longer blocked (K4-05)", () => {
    const ageBand = taxpayerAgeBandOrNull("1966-03-31", AY);
    const r = evaluateSeniorTreatmentRisk({
      ageBand,
      residentialStatus: "resident",
      context: "snapshot_selected_regime",
      selectedRegime: "old",
    });
    expect(ageBand).toBe("senior");
    expect(r.riskCode).toBeNull();
    expect(r.isRelianceBlocked).toBe(false);
  });

  it("Turns 60 on April 1 after the previous year (resident, selected old regime) -> no senior blocker", () => {
    const ageBand = taxpayerAgeBandOrNull("1966-04-01", AY);
    const r = evaluateSeniorTreatmentRisk({
      ageBand,
      residentialStatus: "resident",
      context: "snapshot_selected_regime",
      selectedRegime: "old",
    });
    expect(ageBand).toBe("below_60");
    expect(r.riskCode).toBeNull();
    expect(r.isRelianceBlocked).toBe(false);
  });

  it("Turns 80 on March 31 (resident, selected old regime) -> no longer blocked (super-senior, K4-05)", () => {
    const ageBand = taxpayerAgeBandOrNull("1946-03-31", AY);
    const r = evaluateSeniorTreatmentRisk({
      ageBand,
      residentialStatus: "resident",
      context: "snapshot_selected_regime",
      selectedRegime: "old",
    });
    expect(ageBand).toBe("super_senior");
    expect(r.riskCode).toBeNull();
    expect(r.isRelianceBlocked).toBe(false);
  });

  it("Turns 80 on April 1 after the previous year (resident, selected old regime) -> no longer blocked (senior, not super-senior classification, K4-05)", () => {
    const ageBand = taxpayerAgeBandOrNull("1946-04-01", AY);
    const r = evaluateSeniorTreatmentRisk({
      ageBand,
      residentialStatus: "resident",
      context: "snapshot_selected_regime",
      selectedRegime: "old",
    });
    expect(ageBand).toBe("senior");
    expect(r.riskCode).toBeNull();
    expect(r.isRelianceBlocked).toBe(false);
  });

  it("age band unavailable (missing/invalid DOB) does not itself withhold — eligibility.ts owns that", () => {
    const r = evaluateSeniorTreatmentRisk({
      ageBand: null,
      residentialStatus: "resident",
      context: "snapshot_selected_regime",
      selectedRegime: "old",
    });
    expect(r.riskCode).toBeNull();
    expect(r.isRelianceBlocked).toBe(false);
  });

  it("no regime selected yet in the selected-regime context is not itself a block (defensive)", () => {
    const r = evaluateSeniorTreatmentRisk({
      ageBand: "senior",
      residentialStatus: "resident",
      context: "snapshot_selected_regime",
      selectedRegime: null,
    });
    expect(r.riskCode).toBeNull();
    expect(r.isRelianceBlocked).toBe(false);
  });

  it("carries the sourced official-source references on every result", () => {
    const r = evaluateSeniorTreatmentRisk({
      ageBand: "senior",
      residentialStatus: "resident",
      context: "snapshot_selected_regime",
      selectedRegime: "old",
    });
    expect(r.officialSourceReferences).toBe(SENIOR_AGE_DEFINITION_PROVENANCE.sources);
    expect(r.officialSourceReferences.length).toBeGreaterThan(0);
  });

  // K4-05 (decision D79): SENIOR_TREATMENT_UNSUPPORTED_CODE and
  // REGIME_COMPARISON_UNRELIABLE_CODE remain exported (a stable contract —
  // never renamed casually) but are dead as return values of this evaluator
  // as of this session. Proven exhaustively across every age band, regime,
  // and context this function accepts, rather than trusted from the
  // individual cases above alone.
  it("SENIOR_TREATMENT_UNSUPPORTED_CODE and REGIME_COMPARISON_UNRELIABLE_CODE are never returned, for any resident senior/super-senior input", () => {
    const ageBands = ["senior", "super_senior"] as const;
    const contexts = ["pre_approval_regime_comparison", "snapshot_selected_regime"] as const;
    const regimes = ["old", "new", null] as const;
    for (const ageBand of ageBands) {
      for (const context of contexts) {
        for (const selectedRegime of regimes) {
          const r = evaluateSeniorTreatmentRisk({ ageBand, residentialStatus: "resident", context, selectedRegime });
          expect(r.riskCode).not.toBe(SENIOR_TREATMENT_UNSUPPORTED_CODE);
          expect(r.riskCode).not.toBe(REGIME_COMPARISON_UNRELIABLE_CODE);
          expect(r.isRelianceBlocked).toBe(false);
        }
      }
    }
  });
});
