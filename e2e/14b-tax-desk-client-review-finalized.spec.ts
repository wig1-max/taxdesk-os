import { expect, test } from "@playwright/test";
import { warmTaxDeskOnce } from "./warm";
import { ADMIN_STORAGE_STATE } from "./lib/auth-state";
import { seedSnapshot, seedTaxCase } from "./lib/fixtures";

test.use({ storageState: ADMIN_STORAGE_STATE });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await warmTaxDeskOnce(browser);
});

test("a finalized case blocks review actions but remains readable", async ({ page }) => {
  const seeded = await seedTaxCase({
    finalized: true,
    itrTypeSelected: "ITR-1",
    income: [{ income_head: "salary", amount: 700000 }],
  });
  await seedSnapshot(seeded.taxCaseId, { complete: true });

  await page.goto(`/tax-desk/cases/${seeded.taxCaseId}/review`);
  await expect(page.getByRole("heading", { name: /Client Review —/ })).toBeVisible();
  await expect(page.getByText(/finalized — client review actions are read-only/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Prepare review pack" })).toHaveCount(0);
  await page.getByText("Full review pack").click();
  await expect(page.getByText("Income & deduction summary")).toBeVisible();
});
