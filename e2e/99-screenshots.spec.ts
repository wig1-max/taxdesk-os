import { test, expect, type Page } from "@playwright/test";
import { warmTaxDeskOnce } from "./warm";
import { mkdirSync } from "node:fs";
import { ADMIN_STORAGE_STATE } from "./lib/auth-state";
import {
  seedTaxCase,
  seedSnapshot,
  seedReadinessCase,
  seedValidationCase,
  approveReview,
  forceFinalize,
  setReviewStatus,
} from "./lib/fixtures";

/**
 * K.2.8.6 visual-review capture. NOT part of the regression suites — gated on
 * SCREENSHOTS=1 so a normal `playwright test` skips it. Run with:
 *   $env:SCREENSHOTS="1"; npm.cmd run test:e2e -- 99-screenshots
 * Output: test-results/screenshots/*.png (gitignored).
 */
const CAPTURE = process.env.SCREENSHOTS === "1";
const DIR = "test-results/screenshots";
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

test.use({ storageState: ADMIN_STORAGE_STATE });

// OPS-11 (ZCode): per-spec route warming. Compile this shard's own Tax Desk
// sub-routes here, in an untimed beforeAll, instead of every shard compiling
// all of them in setup. Static routes stay warmed in setup; see e2e/warm.ts.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await warmTaxDeskOnce(browser);
});

test.describe.serial("K.2.8.6 screenshots", () => {
  test.skip(!CAPTURE, "screenshot capture only (set SCREENSHOTS=1)");
  test.beforeAll(() => mkdirSync(DIR, { recursive: true }));

  const shot = async (page: Page, name: string, full = true) => {
    // Disable the Next.js dev indicator for capture only (it overlaps controls).
    await page
      .addStyleTag({
        content:
          "nextjs-portal,[data-next-badge-root],[data-nextjs-dev-tools-button],#__next-build-watcher{display:none !important}",
      })
      .catch(() => {});
    await page.waitForTimeout(350); // let entrance motion settle
    await page.screenshot({ path: `${DIR}/${name}.png`, fullPage: full });
  };

  test("ledgers — overview + add + edit drawers", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    const c = await seedTaxCase({
      itrTypeSelected: "ITR-2",
      income: [
        { income_head: "salary", amount: 1200000, source_type: "Form16" },
        { income_head: "fd_interest", amount: 18000, source_type: "AIS" },
      ],
      taxPaid: [{ tax_paid_type: "salary_tds", amount: 90000, source_type: "Form16" }],
      deductions: [{ deduction_type: "80C", amount: 150000, source_type: "manual" }],
      capitalGains: [{ gain_type: "stcg_111a", taxable_gain: 40000, sale_value: 100000, cost: 60000, source_type: "broker_report" }],
    });
    const url = `/tax-desk/cases/${c.taxCaseId}/ledgers`;
    await page.goto(url);
    await expect(page.getByRole("heading", { name: /Ledgers —/ })).toBeVisible();
    await shot(page, "01-ledger-overview");

    // Income add drawer (Income has rows → header CTA).
    await page.getByRole("button", { name: "Add income entry" }).click();
    await expect(page.getByTestId("ledger-drawer")).toBeVisible();
    await shot(page, "02-ledger-income-add-drawer", false);
    await page.keyboard.press("Escape");

    // Capital-gain edit drawer.
    await page.getByRole("tab", { name: /Capital Gains/ }).click();
    await page.getByRole("region", { name: "Capital Gains" }).getByRole("button", { name: "Edit Capital Gains entry" }).first().click();
    await expect(page.getByTestId("ledger-drawer")).toBeVisible();
    await shot(page, "03-ledger-cg-edit-drawer", false);
    await page.keyboard.press("Escape");

    // Mobile ledger.
    await page.setViewportSize(MOBILE);
    await page.goto(url);
    await expect(page.getByRole("heading", { name: /Ledgers —/ })).toBeVisible();
    await shot(page, "14-mobile-ledger");
  });

  test("computation — refund and payable outcomes", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    // Refund: tax paid (60k) > liability.
    const refund = await seedTaxCase({
      itrTypeSelected: "ITR-1",
      income: [{ income_head: "salary", amount: 800000, source_type: "Form16" }],
      deductions: [{ deduction_type: "80C", amount: 150000, source_type: "manual" }],
      taxPaid: [{ tax_paid_type: "salary_tds", amount: 60000, source_type: "Form16" }],
    });
    await page.goto(`/tax-desk/cases/${refund.taxCaseId}/computation`);
    await expect(page.getByRole("heading", { name: /Computation —/ })).toBeVisible();
    await expect(page.getByTestId("computation-outcome")).toContainText(/Expected refund/i);
    await shot(page, "04-computation-refund");

    // Payable: high liability, low tax paid.
    const payable = await seedTaxCase({
      itrTypeSelected: "ITR-1",
      income: [{ income_head: "salary", amount: 1500000, source_type: "Form16" }],
      taxPaid: [{ tax_paid_type: "salary_tds", amount: 50000, source_type: "Form16" }],
    });
    await page.goto(`/tax-desk/cases/${payable.taxCaseId}/computation`);
    await expect(page.getByTestId("computation-outcome")).toContainText(/Tax payable/i);
    await shot(page, "05-computation-payable");
  });

  test("validation — open, reconciliation, resolved", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    const c = await seedValidationCase();
    const url = `/tax-desk/cases/${c.taxCaseId}/validation`;
    await page.goto(url);
    await page.getByRole("button", { name: "Run validation" }).click();
    await expect(page.getByText(/Validation saved:/)).toBeVisible();
    await page.reload();
    await expect(page.getByText("Blocking errors")).toBeVisible();
    await shot(page, "06-validation-open");

    // Reconciliation (expand secondary section).
    await page.getByText("Source reconciliation", { exact: true }).click();
    await expect(page.getByText(/Deltas shown for configured comparable pairs/i)).toBeVisible();
    await shot(page, "07-validation-reconciliation");

    // Resolve the first finding → Resolved section.
    await page.getByRole("button", { name: "Resolve" }).first().click();
    await page.getByLabel("Resolution note").fill("Reviewed with client; acceptable.");
    await page.getByRole("button", { name: "Save resolution" }).click();
    await expect(page.getByRole("alertdialog")).toBeHidden();
    await page.reload();
    await expect(page.getByText("Resolved").first()).toBeVisible();
    await shot(page, "08-validation-resolved");
  });

  test("client review — prepared, approved, stale, approval drawer", async ({ page }) => {
    await page.setViewportSize(DESKTOP);

    const prep = await seedTaxCase({ itrTypeSelected: "ITR-1", income: [{ income_head: "salary", amount: 800000, source_type: "Form16" }] });
    const prepSnap = await seedSnapshot(prep.taxCaseId, { complete: true });
    await setReviewStatus(prep.taxCaseId, "prepared", prepSnap);
    await page.goto(`/tax-desk/cases/${prep.taxCaseId}/review`);
    await expect(page.getByRole("heading", { name: /Client Review —/ })).toBeVisible();
    await shot(page, "09-review-prepared");

    const appr = await seedTaxCase({ itrTypeSelected: "ITR-1", income: [{ income_head: "salary", amount: 800000, source_type: "Form16" }] });
    const apprSnap = await seedSnapshot(appr.taxCaseId, { complete: true });
    await approveReview(appr.taxCaseId, apprSnap);
    await page.goto(`/tax-desk/cases/${appr.taxCaseId}/review`);
    await expect(page.getByText(/Approval current/i)).toBeVisible();
    await shot(page, "10-review-approved");

    // Stale: approve, then a newer snapshot supersedes.
    const stale = await seedTaxCase({ itrTypeSelected: "ITR-1", income: [{ income_head: "salary", amount: 800000, source_type: "Form16" }] });
    const staleSnap = await seedSnapshot(stale.taxCaseId, { complete: true, createdAt: new Date(Date.now() - 3_600_000).toISOString() });
    await approveReview(stale.taxCaseId, staleSnap);
    await seedSnapshot(stale.taxCaseId, { complete: true, createdAt: new Date().toISOString() });
    await page.goto(`/tax-desk/cases/${stale.taxCaseId}/review`);
    await expect(page.getByText(/out of date/i).first()).toBeVisible();
    await shot(page, "11-review-stale");

    // Approval drawer (sent state).
    const sent = await seedTaxCase({ itrTypeSelected: "ITR-1", income: [{ income_head: "salary", amount: 800000, source_type: "Form16" }] });
    const sentSnap = await seedSnapshot(sent.taxCaseId, { complete: true });
    await setReviewStatus(sent.taxCaseId, "sent", sentSnap);
    await page.goto(`/tax-desk/cases/${sent.taxCaseId}/review`);
    await page.getByRole("button", { name: "Capture client approval" }).click();
    await expect(page.getByRole("dialog", { name: "Capture client approval" })).toBeVisible();
    await shot(page, "12-review-approval-drawer", false);
  });

  test("readiness — blocked, ready, finalized, reopen drawer", async ({ page }) => {
    await page.setViewportSize(DESKTOP);

    const blocked = await seedReadinessCase({ approve: true, validationRun: true, openError: true });
    await page.goto(`/tax-desk/cases/${blocked.taxCaseId}/readiness`);
    await expect(page.getByText(/Internal finalization blocked/i).first()).toBeVisible();
    await shot(page, "13a-readiness-blocked");
    // Mobile readiness (blocked case).
    await page.setViewportSize(MOBILE);
    await page.goto(`/tax-desk/cases/${blocked.taxCaseId}/readiness`);
    await expect(page.getByRole("heading", { name: /Filing Readiness —/ })).toBeVisible();
    await shot(page, "15-mobile-readiness");
    await page.setViewportSize(DESKTOP);

    const ready = await seedReadinessCase({ approve: true, validationRun: true, docs: "satisfied" });
    await page.goto(`/tax-desk/cases/${ready.taxCaseId}/readiness`);
    await expect(page.getByText("Ready for internal finalization").first()).toBeVisible();
    await shot(page, "13b-readiness-ready");

    // Finalized.
    const fin = await seedReadinessCase({ approve: true, validationRun: true, docs: "satisfied" });
    await forceFinalize(fin.taxCaseId, fin.snapshotId ?? undefined);
    await page.goto(`/tax-desk/cases/${fin.taxCaseId}/readiness`);
    await expect(page.getByText("Internally finalized").first()).toBeVisible();
    await shot(page, "13c-readiness-finalized");

    // Reopen drawer (admin).
    await page.getByRole("button", { name: "Reopen case" }).click();
    await expect(page.getByRole("dialog", { name: "Reopen case" })).toBeVisible();
    await shot(page, "13d-readiness-reopen-drawer", false);
  });

  // --- K.2.8.7 additions: engine support states + toasts ---

  test("ledgers — engine support states + category badges + toast", async ({ page }) => {
    await page.setViewportSize(DESKTOP);

    // Zero-unsupported (all engine-supported) state.
    const clean = await seedTaxCase({
      itrTypeSelected: "ITR-1",
      income: [{ income_head: "salary", amount: 800000, source_type: "Form16" }],
      taxPaid: [{ tax_paid_type: "salary_tds", amount: 60000, source_type: "Form16" }],
    });
    await page.goto(`/tax-desk/cases/${clean.taxCaseId}/ledgers`);
    await expect(page.getByTestId("ledger-support-summary")).toHaveAttribute("data-unsupported-count", "0");
    await shot(page, "16-ledger-support-zero");

    // Multiple-unsupported state + per-tab "N manual" badges.
    const dirty = await seedTaxCase({
      itrTypeSelected: "ITR-1",
      income: [
        { income_head: "salary", amount: 800000, source_type: "Form16" },
        { income_head: "house_property", amount: 120000, source_type: "manual" },
        { income_head: "business_income", amount: 300000, source_type: "manual" },
      ],
      capitalGains: [{ gain_type: "other_ltcg", taxable_gain: 70000, source_type: "manual" }],
    });
    const dirtyUrl = `/tax-desk/cases/${dirty.taxCaseId}/ledgers`;
    await page.goto(dirtyUrl);
    await expect(page.getByTestId("ledger-support-summary")).toContainText(/need manual tax treatment/i);
    // Shell anchor is guarded to an incomplete-preview state (no ₹0 balance).
    await expect(page.getByTestId("financial-outcome")).toHaveAttribute("data-outcome-kind", "incomplete");
    await shot(page, "17-ledger-support-unsupported");

    // Incomplete Computation preview (hero shows "—", not refund/payable/nil).
    await page.goto(`/tax-desk/cases/${dirty.taxCaseId}/computation`);
    await expect(page.getByTestId("computation-outcome")).toHaveAttribute("data-outcome-kind", "incomplete");
    await shot(page, "27-computation-incomplete");
    await page.goto(dirtyUrl);

    // Keyboard-focused tab state (roving focus ring).
    await page.getByRole("tab", { name: /Income/ }).focus();
    await page.keyboard.press("ArrowRight");
    await shot(page, "18-ledger-tab-focus", false);

    // Ledger success toast (viewport shot so the fixed toast is in frame).
    await page.goto(dirtyUrl);
    await page.getByRole("button", { name: "Add income entry" }).click();
    await page.getByTestId("ledger-drawer").locator('[name="income_head"]').selectOption("dividend");
    await page.getByTestId("ledger-drawer").locator('[name="amount"]').fill("4000");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Income entry added/i })).toBeVisible();
    await shot(page, "19-ledger-toast", false);

    // Stacked toasts: add a second entry within the dismissal window.
    await page.getByRole("tab", { name: /Tax Paid/ }).click();
    await page.getByRole("button", { name: "Add tax-paid entry" }).click();
    await page.getByTestId("ledger-drawer").locator('[name="tax_paid_type"]').selectOption("advance_tax");
    await page.getByTestId("ledger-drawer").locator('[name="amount"]').fill("5000");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Tax Paid entry added/i })).toBeVisible();
    await shot(page, "26-stacked-toasts", false);

    // Mobile ledger with a toast visible.
    await page.setViewportSize(MOBILE);
    await page.goto(dirtyUrl);
    await page.getByRole("button", { name: "Add income entry" }).click();
    await page.getByTestId("ledger-drawer").locator('[name="income_head"]').selectOption("dividend");
    await page.getByTestId("ledger-drawer").locator('[name="amount"]').fill("2500");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Income entry added/i })).toBeVisible();
    await shot(page, "24-mobile-ledger-toast", false);
  });

  test("computation — snapshot-created toast", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    const c = await seedTaxCase({
      itrTypeSelected: "ITR-1",
      income: [{ income_head: "salary", amount: 800000, source_type: "Form16" }],
      taxPaid: [{ tax_paid_type: "salary_tds", amount: 60000, source_type: "Form16" }],
    });
    await page.goto(`/tax-desk/cases/${c.taxCaseId}/computation`);
    await page.getByRole("button", { name: "Save snapshot" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Snapshot saved/i })).toBeVisible();
    await shot(page, "21-snapshot-toast", false);
  });

  test("validation — resolve success toast", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    const c = await seedValidationCase();
    await page.goto(`/tax-desk/cases/${c.taxCaseId}/validation`);
    await page.getByRole("button", { name: "Run validation" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Validation saved/i })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Resolve" }).first().click();
    await page.getByLabel("Resolution note").fill("Reviewed with client; acceptable.");
    await page.getByRole("button", { name: "Save resolution" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Finding resolved/i })).toBeVisible();
    await shot(page, "20-validation-resolve-toast", false);
  });

  test("readiness — saved + finalized toasts (desktop + mobile)", async ({ page }) => {
    await page.setViewportSize(DESKTOP);

    const ready = await seedReadinessCase({ approve: true, validationRun: true, docs: "satisfied" });
    const readyUrl = `/tax-desk/cases/${ready.taxCaseId}/readiness`;
    await page.goto(readyUrl);
    await page.getByRole("button", { name: /readiness/i }).first().click();
    await expect(page.getByRole("status").filter({ hasText: /Readiness checks saved/i })).toBeVisible();
    await shot(page, "22-readiness-saved-toast", false);

    // Finalized toast.
    await page.getByRole("button", { name: "Finalize internal preparation" }).click();
    await expect(page.getByRole("dialog", { name: "Finalize internal preparation" })).toBeVisible();
    await page.getByLabel("Finalization note").fill("Reviewed and finalized for E2E screenshot.");
    await page.getByLabel(/I understand the case will become read-only/).check();
    await page.getByRole("button", { name: "Finalize now" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Internally finalized/i })).toBeVisible();
    await shot(page, "23-finalized-toast", false);

    // Mobile readiness with a toast visible (fresh ready case).
    const ready2 = await seedReadinessCase({ approve: true, validationRun: true, docs: "satisfied" });
    await page.setViewportSize(MOBILE);
    await page.goto(`/tax-desk/cases/${ready2.taxCaseId}/readiness`);
    await page.getByRole("button", { name: /readiness/i }).first().click();
    await expect(page.getByRole("status").filter({ hasText: /Readiness checks saved/i })).toBeVisible();
    await shot(page, "25-mobile-readiness-toast", false);
  });
});
