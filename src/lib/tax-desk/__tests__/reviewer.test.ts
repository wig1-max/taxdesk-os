import { describe, it, expect } from "vitest";
import { evaluateEligibility, type EligibilityInput, type EligibilityResult } from "@/lib/tax-desk/eligibility";
import {
  requiresManualReview,
  manualReviewBlockers,
  canRecordSignoff,
  signoffDecisionBlockedReason,
  manualReviewBanner,
  isReviewerQualification,
  isReviewerDecision,
  isCredentialStatus,
  qualificationLabel,
  MANUAL_REVIEW_BLOCKER_CODES,
  REVIEWER_REASON_MAX,
} from "@/lib/tax-desk/reviewer";

const NOW = new Date("2026-07-17T00:00:00.000Z");

function baseInput(overrides: Partial<EligibilityInput> = {}): EligibilityInput {
  return {
    profile: {
      dateOfBirth: "1990-05-05",
      residentialStatus: "resident",
      taxpayerCategory: "individual",
      assessmentYear: "2026-27",
    },
    data: { hasMeaningfulData: true, unsupportedEntries: [] },
    declaredSpecialSituations: [],
    validation: { openBlocking: 0, openWarning: 0 },
    ...overrides,
  };
}

const evalWith = (o: Partial<EligibilityInput> = {}): EligibilityResult => evaluateEligibility(baseInput(o), NOW);

describe("requiresManualReview", () => {
  it("is false for a supported resident-individual case", () => {
    expect(requiresManualReview(evalWith())).toBe(false);
  });

  it("is true when residential status is unsupported", () => {
    const r = evalWith({ profile: { ...baseInput().profile, residentialStatus: "non_resident" } });
    expect(requiresManualReview(r)).toBe(true);
    expect(manualReviewBlockers(r).map((b) => b.code)).toContain("UNSUPPORTED_RESIDENTIAL_STATUS");
  });

  it("is true when taxpayer category is unsupported", () => {
    const r = evalWith({ profile: { ...baseInput().profile, taxpayerCategory: "huf" } });
    expect(requiresManualReview(r)).toBe(true);
    expect(manualReviewBlockers(r).map((b) => b.code)).toContain("UNSUPPORTED_TAXPAYER_CATEGORY");
  });

  it("is true when a special situation is declared", () => {
    const r = evalWith({ declaredSpecialSituations: ["foreign_income_or_assets"] });
    expect(requiresManualReview(r)).toBe(true);
    expect(manualReviewBlockers(r).map((b) => b.code)).toContain("MANUAL_PROFESSIONAL_REVIEW_REQUIRED");
  });

  it("is FALSE for mere profile incompleteness (not a manual-review trigger)", () => {
    const r = evalWith({ profile: { ...baseInput().profile, dateOfBirth: null } });
    expect(r.eligible).toBe(false); // still blocked by 9A
    expect(requiresManualReview(r)).toBe(false); // but not a sign-off case
  });

  it("is FALSE for an engine-unsupported ledger entry (resolved in Ledgers, not sign-off)", () => {
    const r = evalWith({
      data: { hasMeaningfulData: true, unsupportedEntries: [{ ledgerId: "a", entryType: "income", code: "x" }] },
    });
    expect(requiresManualReview(r)).toBe(false);
  });

  it("the manual-review code set is exactly the unsupported/declared subset", () => {
    expect([...MANUAL_REVIEW_BLOCKER_CODES].sort()).toEqual(
      ["MANUAL_PROFESSIONAL_REVIEW_REQUIRED", "UNSUPPORTED_RESIDENTIAL_STATUS", "UNSUPPORTED_TAXPAYER_CATEGORY"].sort(),
    );
  });
});

describe("canRecordSignoff / transitions", () => {
  it("allows a decision from none / pending / changes_requested", () => {
    expect(canRecordSignoff("none")).toBe(true);
    expect(canRecordSignoff("pending")).toBe(true);
    expect(canRecordSignoff("changes_requested")).toBe(true);
  });
  it("forbids re-deciding an approved case (terminal)", () => {
    expect(canRecordSignoff("approved")).toBe(false);
  });
});

describe("signoffDecisionBlockedReason", () => {
  const ok = {
    requiresReview: true,
    finalized: false,
    status: "pending" as const,
    isActiveReviewer: true,
    isPreparer: false,
  };
  it("returns null when everything is satisfied", () => {
    expect(signoffDecisionBlockedReason(ok)).toBeNull();
  });
  it("blocks a finalized case first", () => {
    expect(signoffDecisionBlockedReason({ ...ok, finalized: true })).toMatch(/finalized/i);
  });
  it("blocks when review is not required", () => {
    expect(signoffDecisionBlockedReason({ ...ok, requiresReview: false })).toMatch(/does not require/i);
  });
  it("blocks an already-approved case", () => {
    expect(signoffDecisionBlockedReason({ ...ok, status: "approved" })).toMatch(/already/i);
  });
  it("blocks a non-qualified reviewer", () => {
    expect(signoffDecisionBlockedReason({ ...ok, isActiveReviewer: false })).toMatch(/not an active qualified/i);
  });
  it("blocks self-review (preparer)", () => {
    expect(signoffDecisionBlockedReason({ ...ok, isPreparer: true })).toMatch(/separation of duties/i);
  });
});

describe("banner + type guards + labels", () => {
  it("banner reflects each status", () => {
    expect(manualReviewBanner("approved").tone).toBe("ok");
    expect(manualReviewBanner("changes_requested").tone).toBe("danger");
    expect(manualReviewBanner("pending").tone).toBe("warn");
    expect(manualReviewBanner("none").tone).toBe("warn");
  });
  it("type guards", () => {
    expect(isReviewerQualification("chartered_accountant")).toBe(true);
    expect(isReviewerQualification("nope")).toBe(false);
    expect(isReviewerDecision("approved_for_progression")).toBe(true);
    expect(isReviewerDecision("nope")).toBe(false);
    expect(isCredentialStatus("revoked")).toBe(true);
    expect(isCredentialStatus("nope")).toBe(false);
  });
  it("qualificationLabel falls back to the raw code", () => {
    expect(qualificationLabel("advocate")).toMatch(/Advocate/);
    expect(qualificationLabel("unknown_code")).toBe("unknown_code");
    expect(qualificationLabel(null)).toBe("—");
  });
  it("reason cap is exported", () => {
    expect(REVIEWER_REASON_MAX).toBe(1000);
  });
});
