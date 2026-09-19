// Type declarations for the plain-ESM bootstrap script (so TS specs/config that
// import it typecheck under allowJs:false). Runtime lives in e2e-bootstrap.mjs.

/** Throws unless `url` points at a local Supabase (localhost/127.0.0.1/::1). */
export function assertLocalSupabase(url: string): void;

/** Idempotently ensure the local E2E admin exists. Returns its ids. */
export function bootstrapE2EAdmin(
  env?: Record<string, string | undefined>,
): Promise<{ userId: string; email: string }>;

/** Idempotently ensure an active staff (role=staff) user exists. Returns its ids. */
export function bootstrapE2EStaff(
  env?: Record<string, string | undefined>,
): Promise<{ userId: string; email: string }>;

/** Default staff credentials created by bootstrapE2EStaff. */
export const DEFAULT_STAFF_EMAIL: string;
export const DEFAULT_STAFF_PASSWORD: string;
