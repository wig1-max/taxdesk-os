import { describe, expect, it } from "vitest";
import {
  generateUploadToken,
  hashUploadToken,
  sniffMime,
  uploadLinkState,
} from "@/lib/upload-token";

describe("upload tokens", () => {
  it("generates 256-bit URL-safe tokens, unique per call", () => {
    const a = generateUploadToken();
    const b = generateUploadToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43); // 32 bytes base64url
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("hash is deterministic sha256 hex and never equals the token", () => {
    const t = generateUploadToken();
    expect(hashUploadToken(t)).toBe(hashUploadToken(t));
    expect(hashUploadToken(t)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashUploadToken(t)).not.toContain(t);
  });
});

describe("upload link state", () => {
  const future = new Date(Date.now() + 3600_000).toISOString();
  const past = new Date(Date.now() - 3600_000).toISOString();
  const base = { revoked_at: null, expires_at: future, uploads_used: 0, max_uploads: 10 };

  it("valid link", () => expect(uploadLinkState(base)).toBe("valid"));
  it("revoked wins", () =>
    expect(uploadLinkState({ ...base, revoked_at: past })).toBe("revoked"));
  it("expired", () => expect(uploadLinkState({ ...base, expires_at: past })).toBe("expired"));
  it("exhausted", () =>
    expect(uploadLinkState({ ...base, uploads_used: 10 })).toBe("exhausted"));
});

describe("magic-byte sniffing", () => {
  it("detects pdf / jpeg / png", () => {
    expect(sniffMime(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe("application/pdf");
    expect(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe("image/png");
  });
  it("detects webp and heic", () => {
    const webp = new Uint8Array(16);
    webp.set([0x52, 0x49, 0x46, 0x46], 0);
    webp.set([0x57, 0x45, 0x42, 0x50], 8);
    expect(sniffMime(webp)).toBe("image/webp");

    const heic = new Uint8Array(16);
    heic.set([0x00, 0x00, 0x00, 0x18], 0);
    heic.set([0x66, 0x74, 0x79, 0x70], 4); // ftyp
    heic.set([0x68, 0x65, 0x69, 0x63], 8); // heic
    expect(sniffMime(heic)).toBe("image/heic");
  });
  it("rejects executables and unknown content", () => {
    expect(sniffMime(new Uint8Array([0x4d, 0x5a, 0x90, 0x00]))).toBeNull(); // MZ (exe)
    expect(sniffMime(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBeNull();
  });
});
