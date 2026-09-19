import "server-only";

/**
 * Absolute, externally reachable base URL of the deployed app.
 *
 * Used to build client upload links (/upload/[token]) and auth redirect
 * URLs (password reset / setup). In production this MUST be the public
 * origin (e.g. https://app.taxdesk.example) — never a localhost address,
 * or clients would receive unreachable links.
 *
 * Set APP_BASE_URL in the environment. Fails closed in production if it
 * is missing so a misconfigured deploy cannot silently hand out
 * localhost links; falls back to localhost only in dev.
 */
export function getAppBaseUrl(): string {
  const raw = process.env.APP_BASE_URL?.trim();
  if (raw) return raw.replace(/\/+$/, "");
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "APP_BASE_URL is not set. It is required in production to build upload links and auth redirect URLs."
    );
  }
  return "http://localhost:3000";
}
