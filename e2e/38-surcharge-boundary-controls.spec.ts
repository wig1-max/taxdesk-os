import { expect, test } from "@playwright/test";
import { ADMIN_STORAGE_STATE } from "./lib/auth-state";
import { seedSnapshot, seedTaxCase } from "./lib/fixtures";
import { expectReconciled } from "./lib/reconcile";
import { warmTaxDeskOnce } from "./warm";

/** TAX-SAFE-01A/K4-11: below, exact-threshold and released-window controls. */
test.use({ storageState: ADMIN_STORAGE_STATE });
test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await warmTaxDeskOnce(browser);
});

const THRESHOLD = 5_000_000;

test.describe.serial("Surcharge boundary controls", () => {
  let lowTaxCaseId = "";
  let atThresholdTaxCaseId = "";
  let insideWindowTaxCaseId = "";

  test.beforeAll(async () => {
    const low = await seedTaxCase({
      itrTypeSelected: "ITR-1",
      income: [{ income_head: "salary", amount: 800_000, source_type: "Form16" }],
    });
    lowTaxCaseId = low.taxCaseId;
    await seedSnapshot(low.taxCaseId, { salary: 800_000 });

    // Live old-regime income subtracts ₹50k, while seedSnapshot subtracts
    // ₹93k; tune each path independently so both land exactly at the threshold.
    const exact = await seedTaxCase({
      itrTypeSelected: "ITR-1",
      income: [{ income_head: "salary", amount: THRESHOLD + 50_000, source_type: "Form16" }],
    });
    atThresholdTaxCaseId = exact.taxCaseId;
    await seedSnapshot(exact.taxCaseId, { salary: THRESHOLD + 93_000 });

    const inside = await seedTaxCase({
      itrTypeSelected: "ITR-1",
      income: [{ income_head: "salary", amount: THRESHOLD + 2_000_000, source_type: "Form16" }],
    });
    insideWindowTaxCaseId = inside.taxCaseId;
    await seedSnapshot(inside.taxCaseId, { salary: THRESHOLD + 2_000_000 });
  });

  for (const [label, getId] of [
    ["low-risk", () => lowTaxCaseId],
    ["exactly-at-threshold", () => atThresholdTaxCaseId],
    ["inside-window", () => insideWindowTaxCaseId],
  ] as const) {
    test(`${label} case has no Computation reliance blocker`, async ({ page }) => {
      await page.goto(`/tax-desk/cases/${getId()}/computation`);
      await expect(page.getByText("Provisional computation — reliance blocked")).toHaveCount(0);
    });

    test(`${label} case can prepare Client Review`, async ({ page }) => {
      await page.goto(`/tax-desk/cases/${getId()}/review`);
      await page.getByRole("button", { name: "Prepare review pack" }).click();
      await expectReconciled(page, "Review pack prepared ✓");
    });

    test(`${label} case is not surcharge-blocked on Filing Readiness`, async ({ page }) => {
      await page.goto(`/tax-desk/cases/${getId()}/readiness`);
      await expect(page.getByText(/reliance is blocked until a professional prepares this case manually/i)).toHaveCount(0);
    });
  }
});
