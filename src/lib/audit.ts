import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Append-only audit writer. Uses the service role because
 * audit_logs has no authenticated INSERT policy (by design).
 *
 * MASKING GUARANTEE: before/after payloads are deep-masked here,
 * unconditionally. Raw PAN, Aadhaar-like numbers, tokens and
 * secrets never reach the audit table even if a caller passes
 * them by mistake.
 */

const SENSITIVE_KEY = /pan_encrypted|(^|_)pan($|_number)|aadhaar_number|token|password|secret|authorization/i;
const PAN_PATTERN = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g; // full PAN in a string
const LONG_DIGITS = /\d{12,}/g; // Aadhaar-like / account-like digit runs

function maskString(value: string): string {
  return value.replace(PAN_PATTERN, "XXXXXX****").replace(LONG_DIGITS, "************");
}

export function maskDeep(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return maskString(value);
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(maskDeep);
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(key)) {
      out[key] = "***MASKED***";
    } else {
      out[key] = maskDeep(v);
    }
  }
  return out;
}

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  caseId?: string | null;
  before?: unknown;
  after?: unknown;
  /** Session user, or "system" for the public upload route. */
  actor: { id: string; role: string } | "system";
  ipHash?: string | null;
}

export async function audit(entry: AuditEntry): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("audit_logs").insert({
    actor_id: entry.actor === "system" ? null : entry.actor.id,
    actor_role: entry.actor === "system" ? "system" : entry.actor.role,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId,
    case_id: entry.caseId ?? null,
    before: entry.before === undefined ? null : maskDeep(entry.before),
    after: entry.after === undefined ? null : maskDeep(entry.after),
    ip_hash: entry.ipHash ?? null,
  });
  if (error) {
    // Never break the business operation because auditing hiccuped,
    // but make it loud in server logs.
    console.error("[audit] FAILED to write audit log:", entry.action, error.message);
  }
}
