import "server-only";

import { cookies } from "next/headers";

/**
 * TEST-ONLY fault injection for the Phase K.2.9.7 resilience boundaries.
 *
 * There is no other way to prove a route/task `error.tsx` boundary catches a
 * thrown render error without a route that can be MADE to throw on demand. This
 * helper is that seam — and it is COMPLETELY INERT in production: the very first
 * line returns when `NODE_ENV === "production"`, so a `next build` output can
 * never throw here regardless of query string or cookie.
 *
 * Two deterministic triggers (dev/test only):
 *   - `?__fault=throw`         → always throws while the param is present
 *     (used to screenshot the recovery UI and assert no leak).
 *   - cookie `taxdesk_e2e_fault=1` → throws while the cookie is set; clearing it
 *     between the initial render and a `reset()` proves a WORKING recovery
 *     (reset re-renders → cookie gone → the real screen loads).
 *
 * The thrown message deliberately embeds a synthetic PAN and note-like text so
 * tests can assert those NEVER reach the recovery DOM or the telemetry record —
 * the boundary shows a generic message and telemetry forwards only the opaque
 * digest + route.
 */
export const FAULT_COOKIE = "taxdesk_e2e_fault";
export const FAULT_SENTINEL = "TAXDESK_FAULT_INJECTION_SENTINEL";

const FAULT_MESSAGE =
  `${FAULT_SENTINEL}: forced task-screen fault for resilience testing. ` +
  `Synthetic PAN ABCDE1234F and private note text must never surface in the UI or telemetry.`;

/** Throw the injected fault if the (dev/test-only) trigger is present. */
export async function maybeInjectFault(searchParamFault?: string | string[]): Promise<void> {
  if (process.env.NODE_ENV === "production") return; // hard inert in prod
  const sp = Array.isArray(searchParamFault) ? searchParamFault[0] : searchParamFault;
  if (sp === "throw") throw new Error(FAULT_MESSAGE);
  const jar = await cookies();
  if (jar.get(FAULT_COOKIE)?.value === "1") throw new Error(FAULT_MESSAGE);
}
