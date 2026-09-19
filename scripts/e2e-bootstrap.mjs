// @ts-check
/**
 * Local E2E bootstrap — makes `supabase db reset` self-healing for E2E.
 *
 * Creates/updates the local Auth admin (admin@e2e.test) and its matching
 * public.users row so tests can log in without opening Supabase Studio.
 *
 * SAFETY: refuses to run against anything but a local Supabase URL
 * (localhost / 127.0.0.1 / ::1). Never prints the service-role key.
 *
 * Run standalone (loads .env.local via Node's --env-file):
 *   node --env-file=.env.local scripts/e2e-bootstrap.mjs
 * Or import { bootstrapE2EAdmin } from Playwright global setup.
 */
import { createClient } from "@supabase/supabase-js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

/** Throws unless `url` points at a local Supabase. */
export function assertLocalSupabase(url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`Invalid Supabase URL: ${url}`);
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Refusing to bootstrap E2E admin against a NON-LOCAL Supabase URL (${host}). ` +
        "This script only runs against local Supabase (localhost/127.0.0.1).",
    );
  }
}

/** Default staff account created for role-authorization E2E (admin-only guards). */
export const DEFAULT_STAFF_EMAIL = "staff@e2e.test";
export const DEFAULT_STAFF_PASSWORD = "e2e-staff-password";

/** Build a validated local admin (service-role) client from env. */
function localAdminClient(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. " +
        "Run via `node --env-file=.env.local scripts/e2e-bootstrap.mjs`.",
    );
  }
  assertLocalSupabase(url);
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

/**
 * Idempotently ensure an Auth user + matching public.users row exists with the
 * given role. Local-only. Returns { userId, email }.
 */
async function ensureUser(admin, { email, password, fullName, role }) {
  const lower = email.toLowerCase();

  const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listErr) {
    throw new Error(
      `Auth listUsers failed (${listErr.message}). Is local Supabase running? Try \`supabase start\`.`,
    );
  }
  const existing = list.users.find((u) => (u.email ?? "").toLowerCase() === lower);

  let userId;
  if (existing) {
    userId = existing.id;
    const { error } = await admin.auth.admin.updateUserById(userId, { password, email_confirm: true });
    if (error) throw new Error(`Auth updateUserById failed: ${error.message}`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({ email: lower, password, email_confirm: true });
    if (error || !data.user) throw new Error(`Auth createUser failed: ${error?.message ?? "no user"}`);
    userId = data.user.id;
  }

  const { error: upErr } = await admin
    .from("users")
    .upsert(
      { id: userId, full_name: fullName, email: lower, role, is_active: true, deleted_at: null },
      { onConflict: "id" },
    );
  if (upErr) throw new Error(`public.users upsert failed: ${upErr.message}`);

  return { userId, email: lower };
}

/**
 * Idempotently ensure the local E2E admin exists (Auth user + public.users).
 * Reads config from `env` (defaults to process.env). Returns { userId, email }.
 */
export async function bootstrapE2EAdmin(env = process.env) {
  const admin = localAdminClient(env);
  return ensureUser(admin, {
    email: (env.E2E_ADMIN_EMAIL ?? "admin@e2e.test").toLowerCase(),
    password: env.E2E_ADMIN_PASSWORD ?? "e2e-password",
    fullName: "E2E Admin",
    role: "admin",
  });
}

/**
 * Idempotently ensure an active STAFF (role=staff) user exists — used to prove
 * admin-only server guards (e.g. reopen). Local-only. Returns { userId, email }.
 */
export async function bootstrapE2EStaff(env = process.env) {
  const admin = localAdminClient(env);
  return ensureUser(admin, {
    email: (env.E2E_STAFF_BOOTSTRAP_EMAIL ?? DEFAULT_STAFF_EMAIL).toLowerCase(),
    password: env.E2E_STAFF_BOOTSTRAP_PASSWORD ?? DEFAULT_STAFF_PASSWORD,
    fullName: "E2E Staff",
    role: "staff",
  });
}

// Run as a CLI when invoked directly (not when imported).
if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("scripts/e2e-bootstrap.mjs")) {
  Promise.all([bootstrapE2EAdmin(), bootstrapE2EStaff()])
    .then(([admin, staff]) => {
      console.log(`✓ E2E users ready: ${admin.email} (admin) + ${staff.email} (staff). Idempotent — safe to re-run.`);
      process.exit(0);
    })
    .catch((e) => {
      console.error(`✗ E2E bootstrap failed: ${e.message}`);
      process.exit(1);
    });
}
