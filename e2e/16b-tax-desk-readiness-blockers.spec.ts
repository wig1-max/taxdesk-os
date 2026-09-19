import { expect, test, type Page } from "@playwright/test";
import { warmTaxDeskOnce } from "./warm";
import { ADMIN_STORAGE_STATE } from "./lib/auth-state";
import {
  addIncomeRow,
  forceFinalize,
  readFinalizationState,
  seedMatchingSnapshot,
  seedOpenFinding,
  seedReadinessCase,
  seedTaxCase,
} from "./lib/fixtures";

/**
 * Phase K.2.8 — Tax Desk Filing Readiness: the per-blocker matrix and the
 * server-side finalized-case mutation guards.
 *
 * SPLIT OUT OF `16-tax-desk-filing-readiness.spec.ts` at `K4-15-F6`. That file
 * was 31 tests in one `test.describe.serial` group and was the maximum shard by
 * itself (measured: shard 5/11 contained nothing else). Every test below seeds
 * its own case and reads no shared state, so this half was separable without
 * touching a single assertion; spec 16 keeps the thirteen tests that genuinely
 * share the `beforeAll` lifecycle case.
 *
 * THE FILENAME ORDINAL IS LOAD-BEARING AND MEASURED. `16b-` keeps this file
 * adjacent to spec 16. Parked at `35-` instead, these same 18 tests packed with
 * the tail specs into a 32-test shard — WORSE than the 31 the split was meant
 * to relieve. Playwright partitions files by a sequential greedy over NAME
 * order, so a rename here changes CI cost. Re-measure with
 * `--list --shard=i/N` if you move it (`D177`); never adjust the sizing
 * arithmetically.
 *
 * NOT `test.describe.serial`, deliberately, and this is where the split's real
 * budget saving lives. A serial group retries WHOLE on any failure, so one
 * flake among these used to re-execute all 31 tests against a ~78-execution
 * per-dev-server budget; now it re-executes exactly one. `workers: 1` means
 * execution order and concurrency are unchanged either way — only the failure
 * and retry blast radius shrinks, and a cascade-skip after one failure would
 * have hidden the other seventeen results for no benefit.
 *
 * Portable local-only fixtures; shared admin auth state. FAKE DATA ONLY.
 */
test.use({ storageState: ADMIN_STORAGE_STATE });

// OPS-11 (ZCode): per-spec route warming. Compile this shard's own Tax Desk
// sub-routes here, in an untimed beforeAll, instead of every shard compiling
// all of them in setup. Static routes stay warmed in setup; see e2e/warm.ts.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await warmTaxDeskOnce(browser);
});

const readinessUrl = (id: string) => `/tax-desk/cases/${id}/readiness`;
const finalizeDisabled = (page: Page) =>
  expect(page.getByRole("button", { name: "Finalize internal preparation" })).toBeDisabled();
const finalizeEnabled = (page: Page) =>
  expect(page.getByRole("button", { name: "Finalize internal preparation" })).toBeEnabled();

test.describe("Tax Desk filing readiness — blockers and finalized-case guards (K.2.8)", () => {
  // 4: no snapshot blocks.
  test("no complete snapshot is blocked", async ({ page }) => {
    const c = await seedReadinessCase({ withSnapshot: false });
    await page.goto(readinessUrl(c.taxCaseId));
    await expect(page.getByText(/No complete computation snapshot/i).first()).toBeVisible();
    await finalizeDisabled(page);
  });

  // 5: snapshot without approval blocks.
  test("complete snapshot without approval is blocked", async ({ page }) => {
    const c = await seedReadinessCase({ approve: false, validationRun: true });
    await page.goto(readinessUrl(c.taxCaseId));
    await expect(page.getByText(/No current client approval/i)).toBeVisible();
    // K.2.9.4 status-copy: with no approval yet, nothing may read as an affirmative
    // "Approval current" / "Client approval is current". The blocker title is the
    // neutral category "Client approval".
    const approvalBlocker = page
      .getByTestId("readiness-blocker")
      .filter({ hasText: /No current client approval/i });
    await expect(approvalBlocker).toBeVisible();
    await expect(approvalBlocker.getByText("Client approval", { exact: true })).toBeVisible();
    await expect(page.getByText(/Approval current/i)).toHaveCount(0);
    // The readiness disclaimer keeps the preparation-only and universal-review
    // concepts distinct (never the conflated "manual professional review").
    await expect(page.getByText(/independent professional review before filing/i)).toBeVisible();
    await expect(page.getByText(/manual professional review/i)).toHaveCount(0);
    await finalizeDisabled(page);
  });

  // 6: stale approval blocks.
  test("stale approval (older snapshot) is blocked", async ({ page }) => {
    const c = await seedReadinessCase({ approve: true, validationRun: true });
    await seedMatchingSnapshot(c.taxCaseId); // newer snapshot → bound approval is stale
    await page.goto(readinessUrl(c.taxCaseId));
    await expect(page.getByText(/applies to an older snapshot/i)).toBeVisible();
    await finalizeDisabled(page);
  });

  // 7: changes_requested blocks.
  test("client changes_requested is blocked", async ({ page }) => {
    const c = await seedReadinessCase({ reviewStatus: "changes_requested", validationRun: true });
    await page.goto(readinessUrl(c.taxCaseId));
    await expect(page.getByText(/Client requested changes/i)).toBeVisible();
    await finalizeDisabled(page);
  });

  // 8: missing required document blocks.
  test("missing required document is blocked", async ({ page }) => {
    const c = await seedReadinessCase({ approve: true, validationRun: true, docs: "missing" });
    await page.goto(readinessUrl(c.taxCaseId));
    await expect(page.getByText(/required document\(s\) are still outstanding/i)).toBeVisible();
    await finalizeDisabled(page);
  });

  // 9: rejected required document blocks.
  test("rejected required document is blocked", async ({ page }) => {
    const c = await seedReadinessCase({ approve: true, validationRun: true, docs: "rejected" });
    await page.goto(readinessUrl(c.taxCaseId));
    await expect(page.getByText(/required document\(s\) are rejected/i)).toBeVisible();
    await finalizeDisabled(page);
  });

  // 10: open validation error blocks.
  test("open validation error is blocked", async ({ page }) => {
    const c = await seedReadinessCase({ approve: true, validationRun: true, openError: true });
    await page.goto(readinessUrl(c.taxCaseId));
    await expect(page.getByText(/open validation error\/blocker/i)).toBeVisible();
    await finalizeDisabled(page);
  });

  // 11: warning-only validation does not block.
  test("warning-only validation does not block (stays ready)", async ({ page }) => {
    const c = await seedReadinessCase({ approve: true, validationRun: true });
    await seedOpenFinding(c.taxCaseId, { severity: "warning", findingKey: `w-${Date.now()}` });
    await page.goto(readinessUrl(c.taxCaseId));
    await expect(page.getByText("Ready for internal finalization").first()).toBeVisible();
    await finalizeEnabled(page);
  });

  // 12: validation never run blocks.
  test("validation never run is blocked", async ({ page }) => {
    const c = await seedReadinessCase({ approve: true, validationRun: false });
    await page.goto(readinessUrl(c.taxCaseId));
    await expect(page.getByText(/Validation has never been run/i)).toBeVisible();
    await finalizeDisabled(page);
  });

  // 13: stale validation run blocks.
  test("stale validation run is blocked", async ({ page }) => {
    const c = await seedReadinessCase({ approve: true, validationStale: true });
    await page.goto(readinessUrl(c.taxCaseId));
    await expect(page.getByText(/Validation is stale/i)).toBeVisible();
    await finalizeDisabled(page);
  });

  // 14: no selected ITR blocks.
  test("missing selected ITR is blocked", async ({ page }) => {
    const c = await seedReadinessCase({ itrSelected: null, approve: true, validationRun: true });
    await page.goto(readinessUrl(c.taxCaseId));
    await expect(page.getByText(/No ITR form is selected/i)).toBeVisible();
    await finalizeDisabled(page);
  });

  // 15: selected/recommended mismatch shown as warning but still ready.
  test("ITR mismatch is a warning, case stays ready", async ({ page }) => {
    const c = await seedReadinessCase({ approve: true, validationRun: true, itrRecommended: "ITR-2" });
    await page.goto(readinessUrl(c.taxCaseId));
    await expect(page.getByText(/differs from the recommended form/i)).toBeVisible();
    await finalizeEnabled(page);
  });

  // 18: live ledger change after snapshot creates a snapshot-stale blocker.
  test("live ledger change after snapshot blocks (snapshot stale)", async ({ page }) => {
    const c = await seedReadinessCase({ approve: true, validationRun: true });
    await addIncomeRow(c.taxCaseId, "salary", 25000); // change live data after the snapshot
    await page.goto(readinessUrl(c.taxCaseId));
    await expect(page.getByText(/Live Tax Desk data has changed since the latest computation snapshot/i)).toBeVisible();
    await finalizeDisabled(page);
  });

  // 26-29: server-side finalized-case mutation guards (page loaded while editable).
  test("finalized ledger mutation is rejected server-side", async ({ page }) => {
    const c = await seedTaxCase({ income: [{ income_head: "salary", amount: 500000 }] });
    await page.goto(`/tax-desk/cases/${c.taxCaseId}/ledgers`);
    // Open the add drawer and fill it while the case is still editable.
    await page.getByRole("button", { name: "Add income entry" }).click();
    const drawer = page.getByTestId("ledger-drawer");
    await drawer.locator('[name="income_head"]').selectOption("salary");
    await drawer.locator('[name="amount"]').fill("12345");
    // Finalize server-side (no reload), then attempt to save → server rejects.
    await forceFinalize(c.taxCaseId);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(drawer.getByRole("alert")).toContainText(/finalized/i);
  });

  test("finalized snapshot creation is rejected server-side", async ({ page }) => {
    const c = await seedReadinessCase({ approve: false });
    await page.goto(`/tax-desk/cases/${c.taxCaseId}/computation`);
    await forceFinalize(c.taxCaseId);
    await page.getByRole("button", { name: "Save snapshot" }).click();
    await expect(page.getByText(/finalized/i).first()).toBeVisible();
  });

  test("finalized validation refresh is rejected server-side", async ({ page }) => {
    const c = await seedReadinessCase({ approve: false });
    await page.goto(`/tax-desk/cases/${c.taxCaseId}/validation`);
    await forceFinalize(c.taxCaseId);
    await page.getByRole("button", { name: /Run validation|Refresh validation/ }).click();
    await expect(page.getByText(/finalized/i).first()).toBeVisible();
  });

  test("finalized client-review mutation is rejected server-side", async ({ page }) => {
    const c = await seedReadinessCase({ approve: false });
    await page.goto(`/tax-desk/cases/${c.taxCaseId}/review`);
    await forceFinalize(c.taxCaseId);
    await page.getByRole("button", { name: "Prepare review pack" }).click();
    await expect(page.getByText(/finalized/i).first()).toBeVisible();
  });

  // 37b (K.2.9.2 reconciliation): a reopen reconciles the read-only→editable flip
  // BEFORE reporting success — the reopened banner appears WITHOUT a manual reload,
  // and the confirm button stays disabled while the write reconciles. This is the
  // exact stale-after-success window the primitive closes (reopen was the worst
  // offender: it used to toast "Case reopened ✓" while the page stayed finalized).
  test("reopen reconciles the read-only→editable flip without a reload", async ({ page }) => {
    const c = await seedReadinessCase({ approve: true, validationRun: true, docs: "satisfied" });
    await forceFinalize(c.taxCaseId);

    await page.goto(readinessUrl(c.taxCaseId));
    // Finalized (read-only): Reopen is offered, Finalize is not.
    await expect(page.getByRole("button", { name: "Reopen case" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Finalize internal preparation" })).toHaveCount(0);

    // Count full-page loads so we can prove the transition happens with none.
    let loads = 0;
    page.on("load", () => (loads += 1));

    await page.getByRole("button", { name: "Reopen case" }).click();
    await page.getByLabel("Reopen reason").fill("Client sent a revised Form 16; reopening to update the return.");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Reopen now" }).click();

    // The reopened lifecycle banner appears without a manual reload — proof the
    // flip is reconciled before success is surfaced.
    //
    // STRUCTURALLY EXCLUDED from `D191`'s reconcile conversion (`MAINT-08`).
    // Everywhere else the confirmed/unconfirmed distinction is incidental and a
    // tolerant settle is strictly better. Here it IS the subject: this test
    // exists to prove the CONFIRMED path — that reconciliation lands the flip
    // with no navigation (`expect(loads).toBe(0)` below). Accepting the
    // unconfirmed branch, or reloading on it, would delete exactly what is being
    // proven and leave a test that passes when the primitive regresses.
    await expect(page.getByText(/Reopened — fresh/i).first()).toBeVisible();
    await expect(page.getByText("Case reopened ✓")).toBeVisible();
    // The finalized read-only affordance is gone (case is editable again).
    await expect(page.getByRole("button", { name: "Reopen case" })).toHaveCount(0);
    expect(loads).toBe(0); // no full navigation drove the transition

    const fin = await readFinalizationState(c.taxCaseId);
    expect(fin?.finalized_at).toBeNull();
    expect(fin?.reopened_at).not.toBeNull();
  });
});
