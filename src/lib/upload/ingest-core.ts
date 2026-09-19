/**
 * Pure ingestion-decision helpers (Remediation Phase 8).
 *
 * React/Next/Supabase-free so the security-relevant decisions — MIME/content
 * agreement and storage-path derivation — are node-unit-testable in isolation
 * from the HTTP route and the DB. The public upload route composes these with
 * magic-byte sniffing (`sniffMime`) and the guarded `ingest_client_upload` RPC.
 */

/** File extension used for the stored object, keyed by the SNIFFED mime. */
export const EXT_BY_MIME: Readonly<Record<string, string>> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

export type MimeDecision =
  | { ok: true; mime: string }
  | { ok: false; reason: "unsupported" | "mismatch" };

/**
 * Decide the canonical content type for an upload from the SNIFFED bytes and
 * the browser-DECLARED type. The sniffed type is authoritative; the declared
 * type may only disagree in the benign `image/jpg` alias case.
 *
 *   - sniffed missing / not in the allow-list        → unsupported
 *   - declared present AND ≠ sniffed (not the alias)  → mismatch
 *   - otherwise                                        → ok(sniffed)
 */
export function decideUploadMime(
  declared: string | null | undefined,
  sniffed: string | null | undefined,
  allowed: readonly string[],
): MimeDecision {
  if (!sniffed || !allowed.includes(sniffed)) {
    return { ok: false, reason: "unsupported" };
  }
  if (declared && declared !== sniffed && !(declared === "image/jpg" && sniffed === "image/jpeg")) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true, mime: sniffed };
}

/**
 * Private-bucket object path for a stored upload. `unique` is a caller-supplied
 * random id (kept out of this pure function so it stays deterministic/testable).
 * Falls back to `bin` for an unknown mime so a path is always well-formed.
 */
export function buildStoragePath(caseId: string, unique: string, mime: string): string {
  const ext = EXT_BY_MIME[mime] ?? "bin";
  return `cases/${caseId}/${unique}.${ext}`;
}
