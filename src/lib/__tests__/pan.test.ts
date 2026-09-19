import { beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";

// Key must exist BEFORE the module's functions run.
process.env.PAN_ENCRYPTION_KEY = randomBytes(32).toString("base64");


let pan: typeof import("@/lib/crypto/pan");

beforeAll(async () => {
  pan = await import("@/lib/crypto/pan");
});

describe("PAN crypto helper (AES-256-GCM, node:crypto)", () => {
  it("round-trips a valid PAN", () => {
    const cipher = pan.encryptPan("ABCDE1234F");
    expect(pan.decryptPan(cipher)).toBe("ABCDE1234F");
  });

  it("normalizes case and whitespace before encrypting", () => {
    const cipher = pan.encryptPan("  abcde1234f ");
    expect(pan.decryptPan(cipher)).toBe("ABCDE1234F");
  });

  it("ciphertext never contains the plaintext and differs per call (random IV)", () => {
    const a = pan.encryptPan("ABCDE1234F");
    const b = pan.encryptPan("ABCDE1234F");
    expect(a).not.toBe(b);
    expect(a).not.toContain("ABCDE1234F");
  });

  it("rejects invalid PAN formats", () => {
    expect(() => pan.encryptPan("ABC1234567")).toThrow();
    expect(() => pan.encryptPan("ABCDE12345")).toThrow();
    expect(() => pan.encryptPan("")).toThrow();
  });

  it("tampered ciphertext fails authentication (GCM)", () => {
    const cipher = pan.encryptPan("ABCDE1234F");
    const buf = Buffer.from(cipher, "base64");
    buf[buf.length - 1] = buf[buf.length - 1]! ^ 0xff;
    expect(() => pan.decryptPan(buf.toString("base64"))).toThrow();
  });

  it("panLast4 extracts the display suffix", () => {
    expect(pan.panLast4("ABCDE1234F")).toBe("234F");
  });
});

describe("PAN masking (UI helper)", () => {
  it("masks to XXXXXX + last4 and handles missing values", async () => {
    const { maskedPan } = await import("@/lib/utils");
    expect(maskedPan("234F")).toBe("XXXXXX234F");
    expect(maskedPan(null)).toBe("—");
    expect(maskedPan(undefined)).toBe("—");
  });
});

describe("audit deep-masking", () => {
  it("strips PAN-like strings, sensitive keys, and long digit runs", async () => {
    const { maskDeep } = await import("@/lib/audit");
    const masked = maskDeep({
      note: "PAN ABCDE1234F shared, acct 123456789012",
      pan: "ABCDE1234F",
      pan_encrypted: "deadbeef",
      nested: { some_token: "abc", pan_last4: "234F" },
    }) as Record<string, unknown>;
    expect(JSON.stringify(masked)).not.toContain("ABCDE1234F");
    expect(JSON.stringify(masked)).not.toContain("123456789012");
    expect(masked.pan).toBe("***MASKED***");
    expect(masked.pan_encrypted).toBe("***MASKED***");
    expect((masked.nested as Record<string, unknown>).some_token).toBe("***MASKED***");
    // pan_last4 is NOT sensitive — it must survive for audit usefulness
    expect((masked.nested as Record<string, unknown>).pan_last4).toBe("234F");
  });
});
