/**
 * Per-spec route warming (OPS-11 — conducted by ZCode, GLM-5.2).
 *
 * `next dev` compiles an App-Router route on first request. A cold first-hit
 * compile of a heavy Tax Desk route can exceed the 15s `expect` timeout, which
 * surfaced as the "the link did navigate but the destination was still
 * compiling" flake class (documented in `auth.setup.ts`; it cascaded at K4-02).
 * The old fix warmed ALL ~18 routes once per shard in the `setup` project — a
 * ~1,900 MB fixed "warming floor" paid by every shard, larger than the
 * test-carrying capacity it left behind.
 *
 * This module implements the per-spec replacement for the case-specific Tax
 * Desk sub-routes: each spec warms only the sub-routes IT visits, so a shard —
 * which Playwright partitions by FILE — compiles only its own sub-routes
 * instead of all of them. The static, non-case-specific routes (`/login`,
 * `/dashboard`, `/clients/new`, `/cases/new`, `/tax-desk`, `/tax-desk/cases`,
 * `/settings/reviewers`) stay in a slim setup blanket so the login-helper specs
 * keep their protection (see `auth.setup.ts`).
 *
 * Each call seeds its OWN throwaway warm-case rather than sharing one, so it is
 * unaffected by any spec that deletes cases mid-suite (the shell spec's
 * `deleteAllTaxCases()` runs before later Tax Desk specs in filename order).
 * Best-effort throughout: a warm navigation must never fail its phase.
 */
import type { Browser, Page } from "@playwright/test";

import { ADMIN_STORAGE_STATE } from "./lib/auth-state";
import { seedTaxCase } from "./lib/fixtures";
import { warmRoutes } from "./helpers";

/**
 * The Tax Desk sub-routes most specs visit. Warming this common set uniformly
 * is ~what a Tax Desk shard compiles anyway (compilation is per-shard, shared
 * across the shard's specs), so it costs little over precise per-spec sets and
 * keeps every Tax Desk spec's warming call identical.
 */
const COMMON_SUBS = [
  "ledgers",
  "computation",
  "validation",
  "review",
  "readiness",
  "documents",
] as const;

/**
 * Warm the Tax Desk workbench base (`/tax-desk/cases/{id}`) plus the given
 * sub-routes, in an UNTIMED phase. Call from a spec's `beforeAll`. Defaults to
 * {@link COMMON_SUBS}; pass an explicit list for specs that visit rarer
 * sub-routes (e.g. `profile`, `manual-review`). Seeds a throwaway case per call
 * so the dynamic segments resolve against real data (a `notFound` could skip
 * the page compile); the case's "E2E Seed" client is pruned at the next run.
 */
export async function warmTaxDeskRoutes(
  page: Page,
  subs: readonly string[] = COMMON_SUBS,
): Promise<void> {
  const warm = await seedTaxCase({
    itrTypeSelected: "ITR-1",
    income: [{ income_head: "salary", amount: 800_000, source_type: "Form16" }],
    taxPaid: [{ tax_paid_type: "salary_tds", amount: 60_000, source_type: "Form16" }],
  }).catch((err) => {
    console.warn("[warm] warm-case seed failed — skipping Tax Desk warming:", String(err));
    return null;
  });
  if (!warm) return;
  const base = `/tax-desk/cases/${warm.taxCaseId}`;
  await warmRoutes(page, [base, ...subs.map((s) => `${base}/${s}`)]);
}

/**
 * `beforeAll`-friendly warming. Playwright forbids the per-test `page`/
 * `context` fixtures in `beforeAll` (they are created per-test), but the
 * worker-scoped `browser` fixture IS allowed. This creates a throwaway context
 * on `browser` — authenticated via the admin storage state by default, or via
 * an explicit `login` for the login-helper specs (11/28) — warms, and closes
 * it. The routes compile server-side and stay warm for the spec's own test
 * pages, so the throwaway context's teardown does not undo the warming.
 */
export async function warmTaxDeskOnce(
  browser: Browser,
  subs: readonly string[] = COMMON_SUBS,
  opts: { login?: (page: Page) => Promise<unknown> } = {},
): Promise<void> {
  // Warming is an optimization, never a correctness requirement — so the whole
  // thing is best-effort. A throw here MUST NOT fail a spec's beforeAll (which
  // would fail every test in the file): if context creation, login or any hop
  // fails, swallow it and let the routes cold-compile on demand instead.
  try {
    const context = await browser.newContext(
      opts.login ? {} : { storageState: ADMIN_STORAGE_STATE },
    );
    const page = await context.newPage();
    try {
      if (opts.login) await opts.login(page);
      await warmTaxDeskRoutes(page, subs);
    } finally {
      await context.close().catch(() => {});
    }
  } catch (err) {
    console.warn("[warm] warmTaxDeskOnce failed (best-effort, ignored):", String(err));
  }
}
