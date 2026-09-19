import { describe, expect, it } from "vitest";
import {
  computationWithheld,
  ELIGIBILITY_RULES_VERSION,
  evaluateEligibility,
  type EligibilityInput,
} from "@/lib/tax-desk/eligibility";

/** A fully-eligible baseline; each test perturbs one axis. */
function baseInput(overrides: Partial<EligibilityInput> = {}): EligibilityInput {
  return {
    profile: {
      dateOfBirth: "1990-04-01",
      residentialStatus: "resident",
      taxpayerCategory: "individual",
      assessmentYear: "2026-27",
      ...(overrides.profile ?? {}),
    },
    data: {
      hasMeaningfulData: true,
      unsupportedEntries: [],
      ...(overrides.data ?? {}),
    },
    declaredSpecialSituations: overrides.declaredSpecialSituations ?? [],
    validation: {
      openBlocking: 0,
      openWarning: 0,
      ...(overrides.validation ?? {}),
    },
  };
}

const FIXED = new Date("2026-07-13T00:00:00.000Z");
const codes = (i: EligibilityInput) => evaluateEligibility(i, FIXED).blockers.map((b) => b.code);

describe("evaluateEligibility", () => {
  it("1. a fully-populated supported case is eligible", () => {
    const r = evaluateEligibility(baseInput(), FIXED);
    expect(r.eligible).toBe(true);
    expect(r.blockers).toEqual([]);
    expect(r.version).toBe(ELIGIBILITY_RULES_VERSION);
    expect(r.evaluatedAt).toBe(FIXED.toISOString());
  });

  it("2. an empty case (no meaningful data + no profile) is ineligible", () => {
    const r = evaluateEligibility(
      baseInput({
        profile: {
          dateOfBirth: null,
          residentialStatus: null,
          taxpayerCategory: null,
          assessmentYear: "2026-27",
        },
        data: { hasMeaningfulData: false, unsupportedEntries: [] },
      }),
      FIXED,
    );
    expect(r.eligible).toBe(false);
    expect(r.blockers.map((b) => b.code)).toContain("NO_MEANINGFUL_DATA");
  });

  it("3. missing date of birth blocks", () => {
    expect(codes(baseInput({ profile: { dateOfBirth: null, residentialStatus: "resident", taxpayerCategory: "individual", assessmentYear: "2026-27" } })))
      .toContain("PROFILE_DOB_MISSING");
  });

  it("4. missing residential status blocks", () => {
    expect(codes(baseInput({ profile: { dateOfBirth: "1990-01-01", residentialStatus: null, taxpayerCategory: "individual", assessmentYear: "2026-27" } })))
      .toContain("PROFILE_RESIDENTIAL_STATUS_MISSING");
  });

  it("5. missing taxpayer category blocks", () => {
    expect(codes(baseInput({ profile: { dateOfBirth: "1990-01-01", residentialStatus: "resident", taxpayerCategory: null, assessmentYear: "2026-27" } })))
      .toContain("PROFILE_CATEGORY_MISSING");
  });

  it("6. an unsupported assessment year blocks", () => {
    expect(codes(baseInput({ profile: { dateOfBirth: "1990-01-01", residentialStatus: "resident", taxpayerCategory: "individual", assessmentYear: "2025-26" } })))
      .toContain("PROFILE_ASSESSMENT_YEAR_UNSUPPORTED");
  });

  it("7. meaningful supported ledger data satisfies the data-presence gate", () => {
    const r = evaluateEligibility(baseInput({ data: { hasMeaningfulData: true, unsupportedEntries: [] } }), FIXED);
    expect(r.blockers.map((b) => b.code)).not.toContain("NO_MEANINGFUL_DATA");
  });

  it("8. placeholder/default-only rows do NOT satisfy the gate", () => {
    // No meaningful figure even though rows may exist → still blocked.
    expect(codes(baseInput({ data: { hasMeaningfulData: false, unsupportedEntries: [] } })))
      .toContain("NO_MEANINGFUL_DATA");
  });

  it("9. a non-resident status routes to manual review", () => {
    const r = evaluateEligibility(baseInput({ profile: { dateOfBirth: "1990-01-01", residentialStatus: "non_resident", taxpayerCategory: "individual", assessmentYear: "2026-27" } }), FIXED);
    expect(r.eligible).toBe(false);
    expect(r.blockers.map((b) => b.code)).toContain("UNSUPPORTED_RESIDENTIAL_STATUS");
  });

  it("10. a non-individual category routes to manual review", () => {
    expect(codes(baseInput({ profile: { dateOfBirth: "1990-01-01", residentialStatus: "resident", taxpayerCategory: "huf", assessmentYear: "2026-27" } })))
      .toContain("UNSUPPORTED_TAXPAYER_CATEGORY");
  });

  it("11. an engine-unsupported ledger entry blocks", () => {
    const r = evaluateEligibility(
      baseInput({
        data: {
          hasMeaningfulData: true,
          unsupportedEntries: [{ ledgerId: "row-1", entryType: "business_income", code: "UNSUPPORTED_INCOME_HEAD" }],
        },
      }),
      FIXED,
    );
    const b = r.blockers.find((x) => x.code === "UNSUPPORTED_LEDGER_ENTRY");
    expect(b).toBeTruthy();
    expect(b!.source).toContain("row-1");
  });

  it("12. each declared unsupported situation creates a manual-review blocker", () => {
    const r = evaluateEligibility(
      baseInput({ declaredSpecialSituations: ["foreign_income_or_assets", "virtual_digital_assets"] }),
      FIXED,
    );
    const manual = r.blockers.filter((b) => b.code === "MANUAL_PROFESSIONAL_REVIEW_REQUIRED");
    expect(manual).toHaveLength(2);
    expect(manual.map((b) => b.source)).toEqual(["foreign_income_or_assets", "virtual_digital_assets"]);
  });

  it("13. unknown declared situation codes are ignored (no crash, no blocker)", () => {
    const r = evaluateEligibility(baseInput({ declaredSpecialSituations: ["totally_made_up"] }), FIXED);
    expect(r.eligible).toBe(true);
    expect(r.blockers.filter((b) => b.code === "MANUAL_PROFESSIONAL_REVIEW_REQUIRED")).toEqual([]);
  });

  it("14. open blocking validation findings prevent eligibility", () => {
    const r = evaluateEligibility(baseInput({ validation: { openBlocking: 2, openWarning: 0 } }), FIXED);
    expect(r.eligible).toBe(false);
    expect(r.blockers.map((b) => b.code)).toContain("OPEN_BLOCKING_FINDING");
  });

  it("15. non-blocking warnings do NOT fail eligibility (surfaced as warnings)", () => {
    const r = evaluateEligibility(baseInput({ validation: { openBlocking: 0, openWarning: 3 } }), FIXED);
    expect(r.eligible).toBe(true);
    expect(r.warnings.map((w) => w.code)).toContain("OPEN_VALIDATION_WARNING");
  });

  it("16. blocker ordering and codes are deterministic", () => {
    const worstCase = baseInput({
      profile: { dateOfBirth: null, residentialStatus: "non_resident", taxpayerCategory: "huf", assessmentYear: "2025-26" },
      data: {
        hasMeaningfulData: false,
        unsupportedEntries: [
          { ledgerId: "b", entryType: "business_income", code: "UNSUPPORTED_INCOME_HEAD" },
          { ledgerId: "a", entryType: "house_property", code: "UNSUPPORTED_INCOME_HEAD" },
        ],
      },
      declaredSpecialSituations: ["virtual_digital_assets", "foreign_income_or_assets"],
      validation: { openBlocking: 1, openWarning: 0 },
    });
    const order = codes(worstCase);
    // residential status IS present (non_resident) and category present (huf),
    // so the two "*_MISSING" profile blockers are skipped; the unsupported-value
    // blockers fire instead.
    expect(order).toEqual([
      "PROFILE_DOB_MISSING",
      "PROFILE_ASSESSMENT_YEAR_UNSUPPORTED",
      "NO_MEANINGFUL_DATA",
      "UNSUPPORTED_RESIDENTIAL_STATUS",
      "UNSUPPORTED_TAXPAYER_CATEGORY",
      "UNSUPPORTED_LEDGER_ENTRY",
      "MANUAL_PROFESSIONAL_REVIEW_REQUIRED",
      "MANUAL_PROFESSIONAL_REVIEW_REQUIRED",
      "OPEN_BLOCKING_FINDING",
    ]);
    // Two identical runs are byte-identical.
    expect(codes(worstCase)).toEqual(order);
    // Declared situations always sorted by canonical order (foreign before VDA).
    const declaredSources = evaluateEligibility(worstCase, FIXED)
      .blockers.filter((b) => b.code === "MANUAL_PROFESSIONAL_REVIEW_REQUIRED")
      .map((b) => b.source);
    expect(declaredSources).toEqual(["foreign_income_or_assets", "virtual_digital_assets"]);
  });

  it("17b. computationWithheld is true for profile/declared blockers only", () => {
    // Profile blocker → withhold.
    expect(computationWithheld(evaluateEligibility(baseInput({ profile: { dateOfBirth: null, residentialStatus: "resident", taxpayerCategory: "individual", assessmentYear: "2026-27" } }), FIXED))).toBe(true);
    // Declared situation → withhold.
    expect(computationWithheld(evaluateEligibility(baseInput({ declaredSpecialSituations: ["futures_and_options"] }), FIXED))).toBe(true);
    // Open finding ONLY → NOT withheld (existing finding mechanism handles it).
    expect(computationWithheld(evaluateEligibility(baseInput({ validation: { openBlocking: 1, openWarning: 0 } }), FIXED))).toBe(false);
    // Unsupported ledger entry ONLY → NOT withheld (K.2.8.7 partial preview handles it).
    expect(computationWithheld(evaluateEligibility(baseInput({ data: { hasMeaningfulData: true, unsupportedEntries: [{ ledgerId: "x", entryType: "house_property", code: "UNSUPPORTED_INCOME_HEAD" }] } }), FIXED))).toBe(false);
    // Eligible → not withheld.
    expect(computationWithheld(evaluateEligibility(baseInput(), FIXED))).toBe(false);
  });

  it("18. out-of-scope blockers are worded as concept-2 'manual professional preparation', never conflated (K.2.9.4)", () => {
    const r = evaluateEligibility(
      baseInput({
        profile: { dateOfBirth: "1990-01-01", residentialStatus: "non_resident", taxpayerCategory: "huf", assessmentYear: "2026-27" },
        declaredSpecialSituations: ["foreign_income_or_assets"],
      }),
      FIXED,
    );
    const msgFor = (code: string) => r.blockers.find((b) => b.code === code)!.message;
    for (const code of ["UNSUPPORTED_RESIDENTIAL_STATUS", "UNSUPPORTED_TAXPAYER_CATEGORY", "MANUAL_PROFESSIONAL_REVIEW_REQUIRED"]) {
      expect(msgFor(code).toLowerCase()).toContain("manual professional preparation");
      // Concept-2 must not reuse the universal-review / sign-off phrasing.
      expect(msgFor(code).toLowerCase()).not.toContain("manual professional review");
    }
    // The stable blocker CODE is unchanged (DB / e2e contract).
    expect(r.blockers.map((b) => b.code)).toContain("MANUAL_PROFESSIONAL_REVIEW_REQUIRED");
  });

  it("17. a profile mutation (adding DOB) flips a blocked case toward eligible", () => {
    const before = evaluateEligibility(baseInput({ profile: { dateOfBirth: null, residentialStatus: "resident", taxpayerCategory: "individual", assessmentYear: "2026-27" } }), FIXED);
    const after = evaluateEligibility(baseInput(), FIXED);
    expect(before.eligible).toBe(false);
    expect(after.eligible).toBe(true);
  });
});
