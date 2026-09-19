import { describe, expect, it } from "vitest";
import {
  CHECKLIST_STATUSES,
  DOC_SATISFIED_STATUSES,
  docStatusBadgeVariant,
  isDocMissing,
  isDocSatisfied,
} from "@/lib/documents/document-state";

describe("document-state — single authority", () => {
  it("exposes the canonical status vocabulary", () => {
    expect(CHECKLIST_STATUSES).toEqual([
      "pending",
      "requested",
      "received",
      "verified",
      "waived",
      "rejected",
    ]);
  });

  it("satisfied set is exactly received/verified/waived", () => {
    expect([...DOC_SATISFIED_STATUSES]).toEqual(["received", "verified", "waived"]);
    for (const s of DOC_SATISFIED_STATUSES) expect(isDocSatisfied(s)).toBe(true);
    for (const s of ["pending", "requested", "rejected", "unknown"]) {
      expect(isDocSatisfied(s)).toBe(false);
    }
  });

  it("missing = pending/requested only", () => {
    expect(isDocMissing("pending")).toBe(true);
    expect(isDocMissing("requested")).toBe(true);
    for (const s of ["received", "verified", "waived", "rejected"]) {
      expect(isDocMissing(s)).toBe(false);
    }
  });

  it("maps every status to a single badge variant", () => {
    expect(docStatusBadgeVariant("verified")).toBe("success");
    expect(docStatusBadgeVariant("received")).toBe("warning");
    expect(docStatusBadgeVariant("rejected")).toBe("destructive");
    expect(docStatusBadgeVariant("waived")).toBe("secondary");
    expect(docStatusBadgeVariant("pending")).toBe("secondary");
    expect(docStatusBadgeVariant("requested")).toBe("secondary");
    // unknown status degrades to a neutral badge, never throws
    expect(docStatusBadgeVariant("weird")).toBe("secondary");
  });
});
