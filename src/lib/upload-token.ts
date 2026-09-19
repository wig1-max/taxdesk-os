import { createHash, randomBytes } from "node:crypto";

/** 256-bit random token, URL-safe. Shown once; never stored raw. */
export function generateUploadToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashUploadToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type UploadLinkState = "valid" | "revoked" | "expired" | "exhausted";

export function uploadLinkState(
  link: {
    revoked_at: string | null;
    expires_at: string;
    uploads_used: number;
    max_uploads: number;
  },
  now: Date = new Date()
): UploadLinkState {
  if (link.revoked_at) return "revoked";
  if (new Date(link.expires_at).getTime() <= now.getTime()) return "expired";
  if (link.uploads_used >= link.max_uploads) return "exhausted";
  return "valid";
}

/** Magic-byte sniffing — extension/mime headers are not trusted. */
export function sniffMime(bytes: Uint8Array): string | null {
  const startsWith = (sig: number[], offset = 0) =>
    sig.every((b, i) => bytes[offset + i] === b);
  if (startsWith([0x25, 0x50, 0x44, 0x46])) return "application/pdf"; // %PDF
  if (startsWith([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith([0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (
    startsWith([0x52, 0x49, 0x46, 0x46]) && // RIFF
    startsWith([0x57, 0x45, 0x42, 0x50], 8) // WEBP
  )
    return "image/webp";
  // HEIC: ....ftyp with heic/heix/mif1 brand
  if (startsWith([0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = String.fromCharCode(...bytes.slice(8, 12));
    if (["heic", "heix", "mif1", "msf1", "heim", "heis"].includes(brand)) {
      return "image/heic";
    }
  }
  return null;
}
