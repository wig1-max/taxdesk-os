import { describe, expect, it } from "vitest";
import {
  isChecklistComplete,
  summarizeChecklist,
  type ChecklistDoc,
} from "@/lib/tax-desk/checklist";

function doc(partial: Partial<ChecklistDoc> & { status: string; is_required: boolean }): ChecklistDoc {
  return { id: Math.random().toString(36).slice(2), name: "Doc", ...partial };
}

describe("summarizeChecklist", () => {
  it("returns all-zero for an empty checklist", () => {
    const s = summarizeChecklist([]);
    expect(s.total).toBe(0);
    expect(s.requiredOutstanding).toBe(0);
    expect(isChecklistComplete([])).toBe(true);
  });

  it("counts required vs optional and status buckets", () => {
    const docs = [
      doc({ status: "pending", is_required: true }),
      doc({ status: "requested", is_required: true }),
      doc({ status: "received", is_required: true }),
      doc({ status: "verified", is_required: true }),
      doc({ status: "waived", is_required: false }),
      doc({ status: "rejected", is_required: false }),
    ];
    const s = summarizeChecklist(docs);
    expect(s.total).toBe(6);
    expect(s.required).toBe(4);
    expect(s.optional).toBe(2);
    expect(s.missing).toBe(2); // pending + requested
    expect(s.received).toBe(1);
    expect(s.verified).toBe(1);
    expect(s.waived).toBe(1);
    expect(s.rejected).toBe(1);
  });

  it("treats received/verified/waived required items as satisfied", () => {
    const docs = [
      doc({ status: "received", is_required: true }),
      doc({ status: "verified", is_required: true }),
      doc({ status: "waived", is_required: true }),
    ];
    expect(summarizeChecklist(docs).requiredOutstanding).toBe(0);
    expect(isChecklistComplete(docs)).toBe(true);
  });

  it("flags required pending/requested/rejected items as outstanding", () => {
    const docs = [
      doc({ status: "pending", is_required: true }),
      doc({ status: "rejected", is_required: true }),
      doc({ status: "requested", is_required: true }),
      // optional outstanding items do NOT block
      doc({ status: "pending", is_required: false }),
    ];
    const s = summarizeChecklist(docs);
    expect(s.requiredOutstanding).toBe(3);
    expect(isChecklistComplete(docs)).toBe(false);
  });

  it("does not count optional outstanding items against completeness", () => {
    const docs = [
      doc({ status: "verified", is_required: true }),
      doc({ status: "pending", is_required: false }),
    ];
    expect(isChecklistComplete(docs)).toBe(true);
  });
});
