import { describe, expect, it } from "vitest";
import { escapeLikePattern } from "../sql-like";

describe("escapeLikePattern", () => {
  it("leaves an ordinary term untouched", () => {
    expect(escapeLikePattern("Priya Sharma")).toBe("Priya Sharma");
    expect(escapeLikePattern("98765")).toBe("98765");
  });

  it("escapes the LIKE wildcards so a typed wildcard stays literal", () => {
    expect(escapeLikePattern("50%")).toBe("50\\%");
    expect(escapeLikePattern("a_b")).toBe("a\\_b");
    // A bare "%" would otherwise match every client.
    expect(escapeLikePattern("%")).toBe("\\%");
  });

  it("escapes the escape character itself, and does so before the wildcards", () => {
    expect(escapeLikePattern("\\")).toBe("\\\\");
    // Naive sequential replacement would turn "\%" into "\\\\%" (an escaped
    // backslash followed by a LIVE wildcard); each character is escaped once.
    expect(escapeLikePattern("\\%")).toBe("\\\\\\%");
  });

  it("handles the empty string", () => {
    expect(escapeLikePattern("")).toBe("");
  });
});
