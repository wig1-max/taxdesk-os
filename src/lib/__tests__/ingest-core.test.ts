import { describe, expect, it } from "vitest";
import { buildStoragePath, decideUploadMime, EXT_BY_MIME } from "@/lib/upload/ingest-core";

const ALLOWED = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"] as const;

describe("decideUploadMime — MIME/content agreement", () => {
  it("accepts when sniffed is allowed and declared agrees", () => {
    expect(decideUploadMime("application/pdf", "application/pdf", ALLOWED)).toEqual({
      ok: true,
      mime: "application/pdf",
    });
  });

  it("accepts when declared is empty (trust the sniffed bytes)", () => {
    expect(decideUploadMime("", "image/png", ALLOWED)).toEqual({ ok: true, mime: "image/png" });
    expect(decideUploadMime(null, "image/png", ALLOWED)).toEqual({ ok: true, mime: "image/png" });
  });

  it("tolerates the image/jpg → image/jpeg alias", () => {
    expect(decideUploadMime("image/jpg", "image/jpeg", ALLOWED)).toEqual({
      ok: true,
      mime: "image/jpeg",
    });
  });

  it("rejects a declared/sniffed mismatch (spoofed extension)", () => {
    // a .pdf-named file whose bytes are actually a PNG
    expect(decideUploadMime("application/pdf", "image/png", ALLOWED)).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("rejects unsniffable / disallowed content (e.g. an exe, or nothing)", () => {
    expect(decideUploadMime("application/pdf", null, ALLOWED)).toEqual({
      ok: false,
      reason: "unsupported",
    });
    expect(decideUploadMime("application/x-msdownload", "application/x-msdownload", ALLOWED)).toEqual({
      ok: false,
      reason: "unsupported",
    });
  });
});

describe("buildStoragePath", () => {
  it("builds a case-scoped path with the mime's extension", () => {
    expect(buildStoragePath("case-1", "abc", "application/pdf")).toBe("cases/case-1/abc.pdf");
    expect(buildStoragePath("case-1", "abc", "image/jpeg")).toBe("cases/case-1/abc.jpg");
  });

  it("falls back to .bin for an unknown mime rather than producing 'undefined'", () => {
    expect(buildStoragePath("case-1", "abc", "application/zip")).toBe("cases/case-1/abc.bin");
  });

  it("covers every allowed mime", () => {
    for (const mime of ALLOWED) {
      expect(EXT_BY_MIME[mime]).toBeTruthy();
    }
  });
});
