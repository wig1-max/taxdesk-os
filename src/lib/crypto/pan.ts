import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * PAN field encryption.
 *
 * - Standard library only (node:crypto), AES-256-GCM. No custom cryptography.
 * - Key: 32 bytes, base64, in PAN_ENCRYPTION_KEY (server-side env only).
 * - Random 96-bit IV per value; GCM auth tag stored alongside ciphertext.
 * - Wire format (base64): iv(12) || authTag(16) || ciphertext.
 *
 * UI must only ever show maskedPan(pan_last4). Decryption is reserved for
 * an admin-gated server action that writes an audit entry.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

function getKey(): Buffer {
  const b64 = process.env.PAN_ENCRYPTION_KEY;
  if (!b64) {
    throw new Error("PAN_ENCRYPTION_KEY is not set.");
  }
  const key = Buffer.from(b64, "base64");
  if (key.length !== KEY_LENGTH) {
    throw new Error("PAN_ENCRYPTION_KEY must be 32 bytes (base64-encoded).");
  }
  return key;
}

export function isValidPan(pan: string): boolean {
  return PAN_REGEX.test(pan);
}

export function panLast4(pan: string): string {
  return pan.slice(-4);
}

export function encryptPan(pan: string): string {
  const normalized = pan.trim().toUpperCase();
  if (!isValidPan(normalized)) {
    throw new Error("Invalid PAN format.");
  }
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(normalized, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decryptPan(payload: string): string {
  const raw = Buffer.from(payload, "base64");
  if (raw.length <= IV_LENGTH + TAG_LENGTH) {
    throw new Error("Invalid encrypted PAN payload.");
  }
  const iv = raw.subarray(0, IV_LENGTH);
  const tag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    "utf8"
  );
}
