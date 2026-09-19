import { describe, expect, it } from "vitest";
import { caseRowSegment, type CaseRowStatuses } from "@/lib/tax-desk/case-queue";

const base: CaseRowStatuses = {
  caseStatus: "data_entry_pending",
  clientReviewStatus: "not_started",
  filingStatus: "not_started",
  eVerificationStatus: "not_started",
  itrSelected: "ITR-1",
};

describe("caseRowSegment — derivable queue buckets", () => {
  it("closed cases → closed", () => {
    expect(caseRowSegment({ ...base, caseStatus: "closed" })).toBe("closed");
  });

  it("review sent → waiting on client", () => {
    expect(caseRowSegment({ ...base, clientReviewStatus: "sent" })).toBe("waiting_client");
  });

  it("filed + e-verification pending → waiting on client", () => {
    expect(
      caseRowSegment({ ...base, filingStatus: "filed", eVerificationStatus: "pending" }),
    ).toBe("waiting_client");
  });

  it("approved → approved bucket", () => {
    expect(caseRowSegment({ ...base, clientReviewStatus: "approved" })).toBe("approved");
  });

  it("computation ready or prepared → ready for review", () => {
    expect(caseRowSegment({ ...base, caseStatus: "computation_ready" })).toBe("ready_review");
    expect(caseRowSegment({ ...base, clientReviewStatus: "prepared" })).toBe("ready_review");
  });

  it("active preparation → needs attention", () => {
    expect(caseRowSegment(base)).toBe("attention");
    expect(caseRowSegment({ ...base, clientReviewStatus: "changes_requested" })).toBe("attention");
  });

  it("every row maps to exactly one known segment", () => {
    const seg = caseRowSegment(base);
    expect(["attention", "waiting_client", "ready_review", "approved", "closed"]).toContain(seg);
  });
});
