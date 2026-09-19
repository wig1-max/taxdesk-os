import { expect, test, type Locator, type Page } from "@playwright/test";
import { warmTaxDeskOnce } from "./warm";
import { ADMIN_STORAGE_STATE } from "./lib/auth-state";
import { seedTaxCase } from "./lib/fixtures";

test.use({ storageState: ADMIN_STORAGE_STATE });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await warmTaxDeskOnce(browser);
});

const tab = (page: Page, name: RegExp | string): Locator => page.getByRole("tab", { name });
const region = (page: Page, name: string): Locator => page.getByRole("region", { name });
const drawer = (page: Page): Locator => page.getByTestId("ledger-drawer");

async function openCategory(page: Page, name: RegExp | string) {
  await tab(page, name).click();
}

let ledgersUrl = "";

test.describe.serial("Tax Desk ledger mutation boundaries (K.2.4 · K.2.8.6 UI)", () => {
  test.beforeAll(async () => {
    const seeded = await seedTaxCase({
      income: [{ income_head: "salary", amount: 800000, source_type: "Form16" }],
      taxPaid: [{ tax_paid_type: "salary_tds", amount: 50000, source_type: "Form16" }],
    });
    ledgersUrl = `/tax-desk/cases/${seeded.taxCaseId}/ledgers`;
  });

  test("add a deduction entry", async ({ page }) => {
    await page.goto(ledgersUrl);
    await openCategory(page, /Deductions/);
    await page.getByRole("button", { name: "Add deduction entry" }).click();
    await drawer(page).locator('[name="deduction_type"]').selectOption("80C");
    await drawer(page).locator('[name="amount"]').fill("150000");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(region(page, "Deductions").getByText("80C", { exact: true })).toBeVisible();
    await expect(page.getByText(/Total deductions:/)).toBeVisible();
  });

  test("add a capital-gain entry", async ({ page }) => {
    await page.goto(ledgersUrl);
    await openCategory(page, /Capital Gains/);
    await page.getByRole("button", { name: "Add capital-gain entry" }).click();
    await drawer(page).locator('[name="gain_type"]').selectOption("stcg_111a");
    await drawer(page).locator('[name="sale_value"]').fill("100000");
    await drawer(page).locator('[name="cost"]').fill("60000");
    await drawer(page).locator('[name="taxable_gain"]').fill("40000");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(region(page, "Capital Gains").getByText("stcg_111a", { exact: true })).toBeVisible();
    await expect(region(page, "Capital Gains").getByText("40,000").first()).toBeVisible();
  });

  test("edit an income entry updates the total", async ({ page }) => {
    await page.goto(ledgersUrl);
    await region(page, "Income").getByRole("button", { name: "Edit Income entry" }).first().click();
    await drawer(page).locator('[name="amount"]').fill("900000");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(region(page, "Income").getByText("9,00,000").first()).toBeVisible();
  });

  test("remove the tax-paid entry (soft-remove) via confirm dialog", async ({ page }) => {
    await page.goto(ledgersUrl);
    await openCategory(page, /Tax Paid/);
    await region(page, "Tax Paid").getByRole("button", { name: "Remove Tax Paid entry" }).first().click();
    const dialog = page.getByRole("alertdialog");
    await dialog.getByLabel("Reason for removal").fill("entered twice");
    await dialog.getByRole("button", { name: "Remove" }).click();
    await expect(region(page, "Tax Paid").getByText("salary_tds", { exact: true })).toHaveCount(0);
    await expect(region(page, "Tax Paid").getByText(/No tax paid entries yet/i)).toBeVisible();
  });

  test("while the create POST is pending the UI shows no premature success, then reconciles without a reload", async ({
    page,
  }) => {
    const loads: string[] = [];
    page.on("load", () => loads.push("load"));
    await page.goto(ledgersUrl);
    const baseline = loads.length;

    let releaseCreate: () => void = () => {};
    const createHeld = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    let held = false;
    await page.route("**/tax-desk/cases/**/ledgers", async (route) => {
      if (route.request().method() === "POST" && !held) {
        held = true;
        await createHeld;
      }
      await route.continue();
    });

    await openCategory(page, /Deductions/);
    await page.getByRole("button", { name: "Add deduction entry" }).click();
    await drawer(page).locator('[name="deduction_type"]').selectOption("80D");
    await drawer(page).locator('[name="amount"]').fill("25000");

    const save = page.getByRole("button", { name: /^Sav(e|ing…)$/ });
    const notifications = page.getByRole("region", { name: "Notifications" });
    await save.click();
    await expect(save).toBeDisabled();
    await expect(save).toHaveText("Saving…");
    await expect(page.getByTestId("ledger-drawer")).toBeVisible();
    await expect(notifications).not.toContainText(/entry added/i);
    await expect(region(page, "Deductions").getByText("80D", { exact: true })).toHaveCount(0);

    releaseCreate();
    await expect(region(page, "Deductions").getByText("80D", { exact: true })).toBeVisible();
    await expect(region(page, "Deductions").getByText("25,000").first()).toBeVisible();
    await expect(page.getByTestId("ledger-drawer")).toHaveCount(0);
    await expect(notifications).toContainText(/entry added/i);
    expect(loads.length).toBe(baseline);
    await page.unroute("**/tax-desk/cases/**/ledgers");
  });

  test("notes reject portal credential text", async ({ page }) => {
    await page.goto(ledgersUrl);
    await page.getByRole("button", { name: "Add income entry" }).click();
    await drawer(page).locator('[name="amount"]').fill("1000");
    await drawer(page).locator('[name="notes"]').fill("client e-filing password is hunter2");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(drawer(page).getByRole("alert")).toContainText(/credential/i);
    await page.keyboard.press("Escape");
  });

  test("notes reject PAN-like text", async ({ page }) => {
    await page.goto(ledgersUrl);
    await page.getByRole("button", { name: "Add income entry" }).click();
    await drawer(page).locator('[name="amount"]').fill("1000");
    await drawer(page).locator('[name="notes"]').fill("PAN ABCDE1234F");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(drawer(page).getByRole("alert")).toContainText(/PAN/i);
  });
});
