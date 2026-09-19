/**
 * Helpers for streaming private files back through the app (never a
 * redirect to a storage signed URL). Pure + unit-tested.
 *
 * Implemented with numeric char-code checks (no regex control ranges)
 * so the intent is unambiguous.
 */

/** Drop control chars and quote/backslash that are unsafe in a header. */
export function sanitizeFilename(name: string, fallback = "download"): string {
  let out = "";
  for (const ch of name) {
    const code = ch.charCodeAt(0);
    if (code < 32) continue; // control characters
    if (ch === '"' || ch === "\\") continue;
    out += ch;
  }
  out = out.trim();
  return out || fallback;
}

/**
 * Build a Content-Disposition value that is safe for non-ASCII names
 * (e.g. Indian client names) using both an ASCII fallback and the
 * RFC 5987 `filename*` form.
 */
export function contentDisposition(
  filename: string,
  disposition: "inline" | "attachment" = "inline"
): string {
  const safe = sanitizeFilename(filename);
  let ascii = "";
  for (const ch of safe) {
    const code = ch.charCodeAt(0);
    ascii += code >= 32 && code <= 126 ? ch : "_";
  }
  const encoded = encodeURIComponent(safe);
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
