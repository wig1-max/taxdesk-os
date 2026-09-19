"use server";

import { getSessionUser } from "@/lib/auth";
import {
  buildErrorReport,
  formatErrorLine,
  type ClientErrorContext,
} from "@/lib/telemetry/report-error";

/**
 * Durable failure-telemetry seam (Phase K.2.9.7 remediation).
 *
 * The route/task `error.tsx` boundaries call this from a client effect when they
 * catch a thrown render/query error. It derives the actor SERVER-SIDE (never
 * trusting a client-sent role/id), shapes + redacts the record via the pure
 * `report-error.ts` core, and emits ONE structured server-side log line — the
 * durable record. This is the deliberate SINK SEAM: swap the `console.error`
 * for a real telemetry/alerting backend (Sentry, Logtail, an `error_events`
 * table, …) without touching the boundaries or the redaction contract.
 *
 * PII: only `{ route, digest }` are accepted from the client — never the error
 * message/stack — and every field is scrubbed again by `buildErrorReport`. Uses
 * `getSessionUser()` (not `requireUser()`) so a telemetry write never itself
 * redirects when the failing request was an auth problem.
 */
export async function reportClientError(input: {
  route: string;
  digest?: string | null;
}): Promise<void> {
  try {
    // Server-derived actor only — the client cannot spoof role/id.
    const user = await getSessionUser();
    const ctx: ClientErrorContext = {
      route: input.route,
      digest: input.digest ?? null,
      role: user?.role ?? null,
      userId: user?.id ?? null,
    };
    // Durable structured log. Replace with a real sink here (see docstring).
    console.error(formatErrorLine(buildErrorReport(ctx)));
  } catch {
    // Telemetry must never surface its own failure to the user or the boundary.
  }
}
