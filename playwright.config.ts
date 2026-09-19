import { existsSync, readFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

/**
 * E2E suite. Local dev is now self-contained after `supabase db reset`:
 *   1. supabase db reset          (migrations + seed)
 *   2. npm run test:e2e:bootstrap (recreate the local Auth admin) — optional;
 *      the `setup` project below also bootstraps the admin automatically.
 *   3. npm run test:e2e:k25 / :smoke / :full
 *
 * FAKE DATA ONLY — the suite creates clients named "E2E ..." with synthetic
 * PANs. Never point this at a project with real data.
 */

// Load .env.local into process.env (no dotenv dependency). Existing env wins.
function loadEnvLocal(file: string) {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnvLocal(".env.local");


export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  // Assertions/navigations get 15s (default 5s). The single-process
  // `next start` server can have brief GC/latency spikes during a long serial
  // run; 15s absorbs those without masking real failures — the assertions
  // here (a row appearing, "Saved ✓", an empty-state message) render in well
  // under a second normally, so a genuine logic bug still fails fast.
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  workers: 1, // office-sized app; serial keeps data deterministic
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    // Bootstraps the local admin + saves an authenticated storage state.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
      // 01-auth exercises real login; auth.setup is the setup project.
      testIgnore: /auth\.setup\.ts/,
    },
    // Mobile sanity for the public upload page + dashboard.
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
      grep: /@mobile/,
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.ts/,
    },
  ],
  // Dev server (`next dev`). We deliberately do NOT use `next start` here:
  // the production client-side Router Cache serves stale RSC after a
  // server-action `redirect()` to the same route (e.g. the Aadhaar-enable and
  // upload-review flows), which fails assertions even though the action
  // succeeded. `next dev` does not cache that way, so form-action → redirect →
  // fresh-render works. First-hit compilation is absorbed by the generous
  // test/expect timeouts.
  //
  // AUDIT-08-P4 (decision D247): `reuseExistingServer` is OPT-IN, and defaults
  // to false. It was unconditionally `true`, which made Playwright adopt
  // whatever was already answering on port 3000 WITHOUT SAYING SO. During a
  // concurrent session that silently adopted a DIFFERENT WORKTREE's dev
  // server: two E2E runs were invalidated and the other session's seed data
  // was disturbed. Because both checkouts serve the same application, no
  // content probe can tell them apart — and this machine's worktrees share one
  // local Supabase instance (`D49`), so they collide in the database even when
  // their files never touch.
  //
  // With reuse off, an occupied port is an explicit Playwright error instead
  // of a silent wrong-server adoption, which is the whole point: this is the
  // same failure class as the orphaned-`next dev` trap that cost `K4-14` three
  // full runs, except that one at least announced itself through weird
  // symptoms. Recovery is unchanged — `netstat -ano | grep :300` to find the
  // port owner (NOT `tasklist`; the runner does not appear under `node.exe`
  // here), `taskkill` it, then `rm -rf .next`.
  //
  // The deliberate "bring your own server" workflow is UNCHANGED and was never
  // this flag's job: `E2E_NO_SERVER=1` drops `webServer` entirely, so
  // `reuseExistingServer` is not even consulted on that path. Set
  // `E2E_REUSE_SERVER=1` to opt back into adoption for a single run when you
  // know the server on 3000 is this checkout's. A mechanical advisory lock
  // over the shared Supabase instance remains the larger, deliberately
  // deferred idea (`D107`) — do not half-build it here.
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000/login",
        reuseExistingServer: !!process.env.E2E_REUSE_SERVER,
        timeout: 120_000,
      },
});
