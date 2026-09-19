import { describe, expect, it } from "vitest";
import {
  assembleClientReviewPack,
  computeApprovalFreshness,
  REVIEW_PACK_DISCLAIMER,
  STAFF_CONFIRMATION_WORDING,
  type AssembleReviewPackInput,
  type ReviewSnapshot,
} from "@/lib/tax-desk/client-review-pack";
import {
  APPROVAL_METHODS,
  approvalMethodSchema,
  approvalReferenceSchema,
  changesSummarySchema,
} from "@/lib/validation/tax-case";

// --- helpers ---------------------------------------------------------------

function snapshot(id: string, complete = true, overrides: Partial<ReviewSnapshot> = {}): ReviewSnapshot {
  return {
    id,
    createdAt: "2026-07-10T10:00:00.000Z",
    rulesVersion: "AY2026-27.v1",
    complete,
    selectedItrType: "ITR-1",
    recommendedItrType: "ITR-1",
    createdByName: "Staff A",
    summary: {
      salary: 800000,
      interest: 12000,
      dividendOther: 5000,
      exempt: 0,
      deductions: 150000,
      stcg111a: 40000,
      ltcg112a: 0,
      totalTaxPaid: 60000,
    },
    tax: {
      grossTotalIncome: 857000,
      totalIncome: 707000,
      specialRateCapitalGains: 40000,
      oldRegimeTax: 55000,
      newRegimeTax: 48000,
      recommendedRegime: "new",
      rebate: 0,
      cess: 1920,
      taxPaid: 60000,
      refundOrPayable: -12000,
    },
    ...overrides,
  };
}

function baseInput(overrides: Partial<AssembleReviewPackInput> = {}): AssembleReviewPackInput {
  const snap = snapshot("snap-1");
  return {
    case: {
      taxCaseId: "tc-1",
      caseId: "case-1",
      caseDisplayCode: "TDX-ITR-1",
      caseTitle: "ITR Filing",
      clientName: "Ravi Kumar",
      assessmentYear: "2026-27",
      financialYear: "2025-26",
      selectedItrType: "ITR-1",
      recommendedItrType: "ITR-1",
      finalized: false,
    },
    reviewSnapshot: snap,
    latestCompleteSnapshot: snap,
    documents: { requiredTotal: 4, missing: 1, received: 1, verified: 2, rejected: 0, requiredOutstanding: 1 },
    validation: { openError: 0, openWarning: 0, openInfo: 0, resolved: 3, openFindings: [] },
    reconciliation: { groups: [], pairs: [] },
    review: {
      status: "prepared",
      reviewSnapshotId: "snap-1",
      sentAt: null,
      sentByName: null,
      approvedAt: null,
      approvalCapturedByName: null,
      approvalMethod: null,
      approvalReference: null,
      changesRequestedAt: null,
      changesRequestedByName: null,
      changesSummary: null,
    },
    ...overrides,
  };
}

// --- assembly --------------------------------------------------------------

describe("assembleClientReviewPack — from a complete snapshot", () => {
  it("builds case/income/tax/document sections and includes the disclaimer + wording", () => {
    const m = assembleClientReviewPack(baseInput());
    expect(m.case.clientName).toBe("Ravi Kumar");
    expect(m.case.snapshotAt).toBe("2026-07-10T10:00:00.000Z");
    expect(m.case.rulesVersion).toBe("AY2026-27.v1");
    expect(m.income?.salary).toBe(800000);
    expect(m.tax?.oldRegimeTax).toBe(55000);
    expect(m.tax?.recommendedRegime).toBe("new");
    expect(m.documents.requiredOutstanding).toBe(1);
    expect(m.disclaimer).toBe(REVIEW_PACK_DISCLAIMER);
    expect(m.confirmationWording).toBe(STAFF_CONFIRMATION_WORDING);
    // Disclaimer must not overclaim.
    expect(m.disclaimer.toLowerCase()).not.toContain("filing ready");
    expect(m.disclaimer.toLowerCase()).not.toContain("signed");
    // K.2.9.4: the recorded approval is a staff confirmation (not authorization),
    // and the universal review is worded distinctly as "independent professional
    // review" — never the conflated "manual professional review" phrase.
    expect(m.disclaimer.toLowerCase()).toContain("staff-entered client confirmation");
    expect(m.disclaimer.toLowerCase()).toContain("independent professional review");
    expect(m.disclaimer.toLowerCase()).not.toContain("manual professional review");
  });

  it("does not leak PAN / Aadhaar / notes / URLs (serialized model is clean)", () => {
    const m = assembleClientReviewPack(baseInput());
    const blob = JSON.stringify(m);
    expect(blob).not.toMatch(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/); // PAN
    const noUuids = blob.replace(/[0-9a-f-]{36}/gi, "");
    expect(noUuids).not.toMatch(/\b\d{12}\b/); // Aadhaar-like
    expect(blob).not.toMatch(/https?:\/\//);
    expect(blob.toLowerCase()).not.toContain("aadhaar");
    expect(blob.toLowerCase()).not.toContain("resolution_note");
  });
});

describe("blocking / no-snapshot / partial", () => {
  it("no complete snapshot → blocking + unavailable freshness", () => {
    const m = assembleClientReviewPack(
      baseInput({ reviewSnapshot: null, latestCompleteSnapshot: null, review: { ...baseInput().review, status: "not_started", reviewSnapshotId: null } }),
    );
    expect(m.approval.freshness).toBe("unavailable");
    expect(m.blocking.some((b) => /no complete computation snapshot/i.test(b))).toBe(true);
    expect(m.capabilities.canPrepare).toBe(false);
    expect(m.income).toBeNull();
  });

  it("bound snapshot is partial → blocked_partial + capture disabled", () => {
    const partial = snapshot("snap-partial", false);
    const latest = snapshot("snap-latest", true);
    const m = assembleClientReviewPack(
      baseInput({
        reviewSnapshot: partial,
        latestCompleteSnapshot: latest,
        review: { ...baseInput().review, reviewSnapshotId: "snap-partial" },
      }),
    );
    expect(m.approval.freshness).toBe("blocked_partial");
    expect(m.capabilities.canCaptureApproval).toBe(false);
  });
});

describe("approval freshness (snapshot-bound)", () => {
  it("current when bound snapshot id equals latest complete", () => {
    const snap = snapshot("s-1");
    expect(
      computeApprovalFreshness({ finalized: false, reviewSnapshot: snap, latestCompleteSnapshot: snap }),
    ).toBe("current");
  });

  it("stale when a newer complete snapshot exists", () => {
    const older = snapshot("s-old");
    const newer = snapshot("s-new");
    expect(
      computeApprovalFreshness({ finalized: false, reviewSnapshot: older, latestCompleteSnapshot: newer }),
    ).toBe("stale");
  });

  it("finalized always blocks (read-only)", () => {
    const snap = snapshot("s-1");
    expect(
      computeApprovalFreshness({ finalized: true, reviewSnapshot: snap, latestCompleteSnapshot: snap }),
    ).toBe("blocked_finalized");
  });

  it("stale approval keeps the old record but blocks + flags out-of-date", () => {
    const older = snapshot("s-old");
    const newer = snapshot("s-new");
    const m = assembleClientReviewPack(
      baseInput({
        reviewSnapshot: older,
        latestCompleteSnapshot: newer,
        review: {
          ...baseInput().review,
          status: "approved",
          reviewSnapshotId: "s-old",
          approvedAt: "2026-07-09T09:00:00.000Z",
          approvalMethod: "whatsapp",
          approvalReference: "Confirmed by WhatsApp",
        },
      }),
    );
    expect(m.approval.stale).toBe(true);
    expect(m.approval.approvalReference).toBe("Confirmed by WhatsApp"); // old record preserved
    expect(m.blocking.some((b) => /out of date/i.test(b))).toBe(true);
    expect(m.capabilities.canReprepareStale).toBe(true);
    expect(m.capabilities.canCaptureApproval).toBe(false);
  });
});

describe("validation gating", () => {
  it("open validation error blocks approval", () => {
    const m = assembleClientReviewPack(
      baseInput({
        validation: {
          openError: 1,
          openWarning: 0,
          openInfo: 0,
          resolved: 0,
          openFindings: [{ ruleCode: "coverage.unsupported_entry", category: "ledger", severity: "error", title: "Unsupported ledger entry" }],
        },
      }),
    );
    expect(m.capabilities.canCaptureApproval).toBe(false);
    expect(m.blocking.some((b) => /open validation error/i.test(b))).toBe(true);
  });

  it("open warnings do NOT block but stay visible (never silently dropped)", () => {
    const m = assembleClientReviewPack(
      baseInput({
        validation: {
          openError: 0,
          openWarning: 2,
          openInfo: 1,
          resolved: 0,
          openFindings: [{ ruleCode: "recon.pair", category: "reconciliation", severity: "warning", title: "Salary — Form 16 vs AIS" }],
        },
      }),
    );
    expect(m.capabilities.canCaptureApproval).toBe(true); // warnings don't block
    expect(m.warnings.some((w) => /warning/i.test(w))).toBe(true);
    expect(m.validation.openWarning).toBe(2);
    expect(m.validation.openInfo).toBe(1);
  });
});

describe("ITR mismatch + reconciliation", () => {
  it("selected/recommended ITR mismatch surfaces a warning", () => {
    const m = assembleClientReviewPack(
      baseInput({ case: { ...baseInput().case, selectedItrType: "ITR-1", recommendedItrType: "ITR-2" } }),
    );
    expect(m.returnSelection.mismatch).toBe(true);
    expect(m.warnings.some((w) => /differs from the recommended/i.test(w))).toBe(true);
  });

  it("reconciliation summary is carried through with a mismatch warning", () => {
    const m = assembleClientReviewPack(
      baseInput({
        reconciliation: {
          groups: [{ category: "income", key: "salary", total: 1550000, rows: [{ sourceType: "Form16", total: 800000, count: 1 }, { sourceType: "AIS", total: 750000, count: 1 }] }],
          pairs: [{ label: "Salary — Form 16 vs AIS", sourceA: "Form16", totalA: 800000, sourceB: "AIS", totalB: 750000, delta: 50000, mismatch: true }],
        },
      }),
    );
    expect(m.reconciliation.groups[0]?.key).toBe("salary");
    expect(m.warnings.some((w) => /do not reconcile/i.test(w))).toBe(true);
  });
});

describe("finalized-case action guard", () => {
  it("finalized blocks every mutating capability but keeps the pack readable", () => {
    const m = assembleClientReviewPack(baseInput({ case: { ...baseInput().case, finalized: true } }));
    expect(m.capabilities.canPrepare).toBe(false);
    expect(m.capabilities.canMarkSent).toBe(false);
    expect(m.capabilities.canCaptureApproval).toBe(false);
    expect(m.capabilities.canRequestChanges).toBe(false);
    expect(m.income?.salary).toBe(800000); // still readable
  });
});

describe("deterministic review status", () => {
  it("same input yields identical output", () => {
    const a = assembleClientReviewPack(baseInput());
    const b = assembleClientReviewPack(baseInput());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// --- validation schemas ----------------------------------------------------

describe("approval method validation", () => {
  it("accepts every allowed method and rejects unknown", () => {
    for (const m of APPROVAL_METHODS) expect(approvalMethodSchema.safeParse(m).success).toBe(true);
    expect(approvalMethodSchema.safeParse("carrier_pigeon").success).toBe(false);
  });
});

describe("sensitive approval-reference / changes rejection", () => {
  it("accepts a brief safe reference", () => {
    expect(approvalReferenceSchema.safeParse("Confirmed by WhatsApp on 10 Jul 2026.").success).toBe(true);
  });

  it("rejects credential / OTP / PAN / Aadhaar-like text", () => {
    expect(approvalReferenceSchema.safeParse("portal password is hunter2").success).toBe(false);
    expect(approvalReferenceSchema.safeParse("shared the OTP 449281").success).toBe(false);
    expect(approvalReferenceSchema.safeParse("PAN ABCDE1234F confirmed").success).toBe(false);
    expect(approvalReferenceSchema.safeParse("aadhaar 1234 5678 9012").success).toBe(false);
    expect(approvalReferenceSchema.safeParse("ok").success).toBe(false); // too short
    expect(approvalReferenceSchema.safeParse("x".repeat(400)).success).toBe(false); // too long
  });

  it("changes summary is screened the same way", () => {
    expect(changesSummarySchema.safeParse("Update salary from Form 16.").success).toBe(true);
    expect(changesSummarySchema.safeParse("client e-filing password changed").success).toBe(false);
  });
});
