/**
 * Failure telemetry — pure, framework-free core (Phase K.2.9.7 remediation).
 *
 * Route/task `error.tsx` boundaries (see `src/app/(app)/**​/error.tsx`) catch a
 * thrown render/query error and must record it DURABLY so a failure is
 * diagnosable after the fact — but TaxDesk OS's PII rules forbid ever storing or
 * logging PAN/Aadhaar/OTP/passwords/notes (CONTRIBUTING.md). This module is the single
 * place that shapes + redacts a failure record, kept React-free so the redaction
 * contract is unit-tested in the repo's node test env (matching
 * `reconcile-core.ts`). The server-action seam that actually emits it lives in
 * `src/app/actions/report-error.ts`.
 *
 * Design choice — the boundary forwards only OPAQUE, safe context: the route
 * (a pathname, which may embed internal UUIDs — those are not PII), the Next.js
 * `error.digest` (an opaque server-generated hash — never the message or stack),
 * and server-derived user role/id. The raw `Error.message`/`.stack` are NEVER
 * forwarded from the client, so a leaked value in an error string can never reach
 * the sink. Redaction here is a defence-in-depth backstop on every string field.
 */

/** PAN: 5 letters + 4 digits + 1 letter (e.g. ABCDE1234F). Matches `crypto/pan.ts`. */
const PAN_PATTERN = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g;
/** Aadhaar: a 12-digit number (optionally space/hyphen grouped 4-4-4). */
const AADHAAR_PATTERN = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g;
// Authenticated application paths only. Do not accept a generic slash-prefixed
// string: server actions are callable by a hostile client and a free-text path
// could otherwise become a logging channel.
const CASE_ID = "[0-9a-f-]{36}";
const SAFE_ROUTE = new RegExp(
  `^/(?:account|audit-log|dashboard|tax-desk(?:/cases(?:/${CASE_ID}(?:/(?:ledgers|computation|validation|review|readiness|manual-review|profile|documents)?)?)?)?|cases(?:/${CASE_ID}(?:/(?:documents|fees|identity-review|messages|pdfs|physical-documents)?)?)?|clients(?:/${CASE_ID})?|settings/(?:purge|reviewers|services|templates|users))$`,
);
const SAFE_DIGEST = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Defensive scrub of a single string: replace anything shaped like a PAN or an
 * Aadhaar number with a fixed sentinel. Never throws; passes through null/empty.
 * This is a backstop — the boundary already forwards only safe context.
 */
export function redactText(value: string | null | undefined): string | null {
  if (value == null) return null;
  return value.replace(PAN_PATTERN, "[REDACTED_PAN]").replace(AADHAAR_PATTERN, "[REDACTED_AADHAAR]");
}

/** Accept only a bounded pathname, never arbitrary client-supplied free text. */
export function normalizeTelemetryRoute(value: unknown): string {
  return typeof value === "string" && SAFE_ROUTE.test(value) ? value : "unknown";
}

/** Next's digest is opaque; retain only a bounded token-shaped value. */
export function normalizeTelemetryDigest(value: unknown): string | null {
  return typeof value === "string" && SAFE_DIGEST.test(value) ? value : null;
}

/** Safe context a boundary forwards. NO error message/stack, NO free-text notes. */
export interface ClientErrorContext {
  /** The pathname the failure occurred on (e.g. /tax-desk/cases/<uuid>/ledgers). */
  route: string;
  /** Next.js opaque `error.digest`, if present. Never the message/stack. */
  digest?: string | null;
  /** ISO timestamp; defaults to the emit time. */
  timestamp?: string | null;
  /** Server-derived role (enum) — safe. */
  role?: string | null;
  /** Server-derived user id (UUID) — safe, matches audit_logs actor_id. */
  userId?: string | null;
}

/** The durable, PII-safe failure record. Only these fields are ever emitted. */
export interface ErrorReport {
  kind: "client_error_boundary";
  route: string;
  digest: string | null;
  timestamp: string;
  role: string | null;
  userId: string | null;
}

/**
 * Shape + redact a {@link ClientErrorContext} into the canonical
 * {@link ErrorReport}. Every string field is passed through {@link redactText};
 * missing route falls back to "unknown"; missing timestamp defaults to `now`.
 * Pure — inject `now` for deterministic tests.
 */
export function buildErrorReport(ctx: ClientErrorContext, now: Date = new Date()): ErrorReport {
  return {
    kind: "client_error_boundary",
    route: normalizeTelemetryRoute(ctx.route),
    digest: normalizeTelemetryDigest(ctx.digest),
    timestamp: ctx.timestamp ?? now.toISOString(),
    role: redactText(ctx.role) ?? null,
    userId: redactText(ctx.userId) ?? null,
  };
}

/**
 * Stable single-line serialization for the structured server-side log (the
 * durable sink seam). Prefixed so it's greppable in aggregated logs. The record
 * is already redacted by {@link buildErrorReport}; this only serializes it.
 */
export function formatErrorLine(report: ErrorReport): string {
  return `[taxdesk.telemetry] ${JSON.stringify(report)}`;
}
