import { describe, expect, it } from "vitest";
import { contentDisposition, sanitizeFilename } from "@/lib/http/download";

describe("sanitizeFilename", () => {
  it("keeps ordinary names", () => {
    expect(sanitizeFilename("PAN card.pdf")).toBe("PAN card.pdf");
  });
  it("strips quotes and backslashes", () => {
    expect(sanitizeFilename('a"b\\c.pdf')).toBe("abc.pdf");
  });
  it("strips CR/LF (header-injection safety)", () => {
    expect(sanitizeFilename("a\r\nb.pdf")).toBe("ab.pdf");
  });
  it("falls back when empty", () => {
    expect(sanitizeFilename("   ")).toBe("download");
  });
  it("keeps unicode (Indian names)", () => {
    expect(sanitizeFilename("स्कैन.pdf")).toBe("स्कैन.pdf");
  });
});

describe("contentDisposition", () => {
  it("defaults to inline with ascii fallback + RFC5987 filename*", () => {
    const v = contentDisposition("report.pdf");
    expect(v).toBe("inline; filename=\"report.pdf\"; filename*=UTF-8''report.pdf");
  });
  it("encodes unicode in filename* and underscores the ascii fallback", () => {
    const v = contentDisposition("स्कैन.pdf");
    expect(v).toMatch(/^inline; filename="_+\.pdf"; filename\*=UTF-8''/);
    expect(v).toContain(encodeURIComponent("स्कैन.pdf"));
  });
  it("supports attachment disposition", () => {
    expect(contentDisposition("x.pdf", "attachment")).toContain("attachment;");
  });
});
