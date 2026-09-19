import { describe, expect, it } from "vitest";
import { describePhysicalCustody } from "@/lib/physical-custody";

describe("describePhysicalCustody (K.2.9.4 returned-doc labelling)", () => {
  it("a returned document reads as RETURNED, never 'return required'", () => {
    const v = describePhysicalCustody({
      custody_status: "returned_to_client",
      return_required: true,
      returned_to: "Ramesh Testwala",
      returned_date: "2026-07-03",
    });
    expect(v.badge).toBe("returned to client");
    expect(v.badge).not.toMatch(/return required/i);
    expect(v.returnOutstanding).toBe(false);
    expect(v.note?.tone).toBe("success");
    expect(v.note?.text).toMatch(/Returned to Ramesh Testwala on 2026-07-03/);
    expect(v.note?.text).toMatch(/no return outstanding/i);
  });

  it("an in-custody document with return required IS an outstanding return", () => {
    const v = describePhysicalCustody({ custody_status: "in_custody", return_required: true });
    expect(v.badge).toBe("in custody · return required");
    expect(v.returnOutstanding).toBe(true);
    expect(v.note).toEqual({ tone: "warning", text: "Return to client still required." });
  });

  it("in custody without return required carries no 'return required' label", () => {
    const v = describePhysicalCustody({ custody_status: "in_custody", return_required: false });
    expect(v.badge).toBe("in custody");
    expect(v.returnOutstanding).toBe(false);
    expect(v.note).toBeNull();
  });

  it("a dispatched (in-transit) doc is not labelled 'return required' even when return is required", () => {
    const v = describePhysicalCustody({ custody_status: "dispatched", return_required: true });
    expect(v.badge).toBe("dispatched");
    expect(v.returnOutstanding).toBe(false);
  });

  it("returned doc without a recorded returned_to falls back to 'client'", () => {
    const v = describePhysicalCustody({
      custody_status: "returned_to_client",
      return_required: true,
      returned_date: null,
      returned_to: null,
    });
    expect(v.note?.text).toBe("Returned to client — no return outstanding.");
  });
});
