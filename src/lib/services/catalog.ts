/**
 * Tax Desk service catalog (Phase K.1).
 *
 * Config-only visibility layer — NO schema change. Historical services and
 * their cases are preserved; this just decides what the *normal* workflow
 * surfaces (New Case dropdown, default cases list, dashboard). Deferred
 * services remain fully reachable by direct URL and by picking them in the
 * cases Service filter, and admin settings still show everything.
 *
 * A service is "normal" when its code is in NORMAL_SERVICE_CODES. Everything
 * else that exists is "deferred" (hidden from the normal workflow, not
 * deleted). Business Registration / Udyam / MSME is intentionally deferred
 * for K.1 because it has no seeded checklist yet (see K.2 notes).
 */

/** Codes that are part of the normal Tax Desk workflow. */
export const NORMAL_SERVICE_CODES = ["itr", "gst"] as const;

export type NormalServiceCode = (typeof NORMAL_SERVICE_CODES)[number];

export function isNormalService(code: string | null | undefined): boolean {
  return code != null && (NORMAL_SERVICE_CODES as readonly string[]).includes(code);
}

/** Any existing service that is not in the normal workflow. */
export function isDeferredService(code: string | null | undefined): boolean {
  return !isNormalService(code);
}

/** Keep only normal-workflow services (e.g. for the New Case dropdown). */
export function filterNormalServices<T extends { code: string }>(services: T[]): T[] {
  return services.filter((s) => isNormalService(s.code));
}

/**
 * Templates visible for a case: the case's own service templates PLUS
 * generic templates (service_code null). Unrelated service templates are
 * removed at the data layer — not merely sorted last.
 */
export function filterTemplatesForService<T extends { service_code: string | null }>(
  templates: T[],
  serviceCode: string
): T[] {
  return templates.filter((t) => t.service_code === null || t.service_code === serviceCode);
}
