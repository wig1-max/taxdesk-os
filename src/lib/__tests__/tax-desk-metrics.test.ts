import { describe, expect, it } from "vitest";
import {
  buildTaxDeskMetrics,
  COMPUTATION_PENDING_STATUSES,
  type TaxDeskCounts,
} from "@/lib/queries/tax-desk";

const zeroCounts: TaxDeskCounts = {
  total: 0,
  docsPending: 0,
  computationPending: 0,
  clientApprovalPending: 0,
  filingPending: 0,
  eVerificationPending: 0,
  closed: 0,
  blockerFindings: 0,
};

describe("buildTaxDeskMetrics", () => {
  it("returns the eight expected cards in order", () => {
    const m = buildTaxDeskMetrics(zeroCounts);
    expect(m.map((x) => x.key)).toEqual([
      "total",
      "docs_pending",
      "computation_pending",
      "client_approval_pending",
      "filing_pending",
      "everification_pending",
      "closed",
      "blocker_findings",
    ]);
  });

  it("maps raw counts onto the right cards", () => {
    const m = buildTaxDeskMetrics({
      ...zeroCounts,
      total: 5,
      docsPending: 2,
      blockerFindings: 1,
    });
    expect(m.find((x) => x.key === "total")?.count).toBe(5);
    expect(m.find((x) => x.key === "docs_pending")?.count).toBe(2);
    expect(m.find((x) => x.key === "blocker_findings")?.count).toBe(1);
  });

  it("flags blocker findings red and workflow queues amber", () => {
    const m = buildTaxDeskMetrics(zeroCounts);
    expect(m.find((x) => x.key === "blocker_findings")?.tone).toBe("red");
    expect(m.find((x) => x.key === "docs_pending")?.tone).toBe("amber");
    // Total and closed are neutral (no tone).
    expect(m.find((x) => x.key === "total")?.tone).toBeUndefined();
    expect(m.find((x) => x.key === "closed")?.tone).toBeUndefined();
  });

  it("computation-pending covers the pre-review statuses", () => {
    expect(COMPUTATION_PENDING_STATUSES).toContain("data_entry_pending");
    expect(COMPUTATION_PENDING_STATUSES).toContain("reconciliation_pending");
    expect(COMPUTATION_PENDING_STATUSES).toContain("computation_ready");
  });
});
