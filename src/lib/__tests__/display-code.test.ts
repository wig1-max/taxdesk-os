import { describe, expect, it } from "vitest";
import { nextNumericSuffix } from "@/lib/display-code";

describe("display code allocation", () => {
  it("ignores seeded demo suffixes when finding the next numeric client code", () => {
    expect(
      nextNumericSuffix(["TDX-C-DEMO3", "TDX-C-DEMO2", "TDX-C-0001"], "TDX-C-")
    ).toBe(2);
  });

  it("uses the highest numeric suffix even when codes are unsorted", () => {
    expect(nextNumericSuffix(["TDX-C-0009", "TDX-C-0012", "TDX-C-0004"], "TDX-C-")).toBe(
      13
    );
  });
});
