import { test as setup, expect } from "@playwright/test";
import { ADMIN_STORAGE_STATE, STAFF_STORAGE_STATE } from "./lib/auth-state";
import {
  bootstrapE2EAdmin,
  bootstrapE2EStaff,
  DEFAULT_STAFF_EMAIL,
  DEFAULT_STAFF_PASSWORD,
} from "../scripts/e2e-bootstrap.mjs";
import { ADMIN_EMAIL, ADMIN_PASSWORD, warmRoutes } from "./helpers";
import {
  pruneAccumulatedDeferredServiceCases,
  pruneSeedTaxCaseClients,
  softDeleteAccumulatedE2eClients,
} from "./lib/fixtures";

/**
 * Bound test-data growth before the suite runs. `seedTaxCase` creates a new
 * "E2E Seed …" client on every call and nothing ever removes them, so across
 * runs they accumulate into the hundreds and fill the 500-row `/cases/new`
 * Client dropdown — hiding freshly-created clients and failing every
 * `createCase`-via-UI spec ("No option containing … in Client *"). Pruning prior
 * runs' seed clients here keeps the dropdown able to show newly-created ones
 * (K3-ENV-1). Local-only + idempotent.
 */
setup("prune accumulated synthetic seed clients", async () => {
  const pruned = await pruneSeedTaxCaseClients();

  console.log(`[e2e] pruned ${pruned} accumulated 'E2E Seed …' clients from prior runs`);
  // K3-ENV-4: "E2E Seed %" alone was too narrow — every other spec-created
  // prefix accumulated until it refilled the 500-row window.
  const softDeleted = await softDeleteAccumulatedE2eClients();

  console.log(`[e2e] soft-deleted ${softDeleted} other accumulated 'E2E …' clients`);
  // K3-ENV-5: deferred-service (e.g. IEPF) cases accumulate forever — no
  // client prune above removes the cases those clients own.
  const prunedDeferredCases = await pruneAccumulatedDeferredServiceCases();

  console.log(`[e2e] soft-deleted ${prunedDeferredCases} accumulated deferred-service cases from prior runs`);
});

/**
 * Setup project (runs before every other project). Two jobs:
 *  1. Ensure the local Auth admin exists (self-heals after `supabase db reset`).
 *  2. Log in once via the UI and persist the session so authenticated specs
 *     can reuse it via `test.use({ storageState: ADMIN_STORAGE_STATE })`
 *     instead of logging in on every test.
 *
 * 01-auth.spec.ts still exercises real UI login (no stored state there).
 */
setup("bootstrap local admin and save auth state", async ({ page }) => {
  // Idempotent, local-only. Throws on a non-local Supabase URL.
  const { email } = await bootstrapE2EAdmin();
  expect(email).toBe(ADMIN_EMAIL.toLowerCase());

  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.context().storageState({ path: ADMIN_STORAGE_STATE });
});

/**
 * Warm the STATIC App-Router routes under `next dev` — the ones no case id is
 * needed for — so their on-demand compile happens ONCE here, in the setup
 * project (untimed), rather than inside a spec's first navigation. Best-effort:
 * every hop is guarded; a redirect/404 still compiles the route module.
 *
 * OPS-11 (ZCode): the case-specific Tax Desk sub-routes
 * (`/tax-desk/cases/[id]/*`) are NO LONGER warmed here. Each Tax Desk spec now
 * warms only its own sub-routes via `warmTaxDeskRoutes` (`./warm`), so a shard
 * compiles only the routes its own specs visit — that is the move that shrinks
 * the per-shard ~1,900 MB "warming floor" (it was larger than the test-carrying
 * capacity it left behind). The static routes below stay in this blanket
 * because the login-helper specs (02-08, 21, 24, 28) are not authenticated in a
 * beforeAll and rely on it for their `/clients/new` / `/cases/new` cold hits
 * (the K4-02 cascade). Runs authenticated via the admin storage state above.
 */
setup.describe("static route warming", () => {
  // Reuse the admin session saved by the step above (declared earlier, so it has
  // already run under `workers: 1`).
  setup.use({ storageState: ADMIN_STORAGE_STATE });

  setup("warm static routes so `next dev` compiles once", async ({ page }) => {
    // Cold-compiling several App-Router routes takes well over the global 45s
    // per-test timeout, so this step gets its own generous budget. It is
    // deliberately SEPARATE from the auth bootstrap above, which keeps the
    // default 45s and so still fails fast on a genuine login problem.
    setup.setTimeout(300_000);
    await warmRoutes(page, [
      "/login",
      "/dashboard",
      "/clients/new",
      "/cases/new",
      "/tax-desk",
      "/tax-desk/cases",
      "/settings/reviewers",
    ]);
  });
});

/**
 * Ensure an active STAFF user exists and persist its authenticated session, so
 * the K.2.8 admin-only reopen guard can be proven with a real staff login
 * (no skip). Local-only + idempotent.
 */
setup("bootstrap local staff and save staff auth state", async ({ page }) => {
  const { email } = await bootstrapE2EStaff();
  expect(email).toBe(DEFAULT_STAFF_EMAIL.toLowerCase());

  await page.goto("/login");
  await page.getByLabel("Email").fill(DEFAULT_STAFF_EMAIL);
  await page.getByLabel("Password").fill(DEFAULT_STAFF_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.context().storageState({ path: STAFF_STORAGE_STATE });
});
