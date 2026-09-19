import { expect, test, type Locator, type Page } from "@playwright/test";
import { warmTaxDeskOnce } from "./warm";
import { ADMIN_STORAGE_STATE } from "./lib/auth-state";
import { seedTaxCase } from "./lib/fixtures";

/**
 * Phase K.2.4 ledger CRUD, re-expressed for the K.2.8.6 Ledger Workspace.
 * OPS-13 splits this serial chain at an independently seeded boundary so
 * Playwright can distribute the file-granularity groups without weakening the
 * per-test budget or retry policy.
 */
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

async function selectOptionContaining(select: Locator, part: string) {
  const options = await select.locator("option").allTextContents();
  const hit = options.find((o) => o.includes(part));
  if (!hit) throw new Error(`No option containing "${part}"`);
  await select.selectOption({ label: hit });
}

let taxCaseUrl = "";
let ledgersUrl = "";

test.describe.serial("Tax Desk ledgers (K.2.4 · K.2.8.6 UI)", () => {
  test.beforeAll(async () => {
    const seeded = await seedTaxCase();
    taxCaseUrl = `/tax-desk/cases/${seeded.taxCaseId}`;
    ledgersUrl = `${taxCaseUrl}/ledgers`;
  });

  test("workbench links to the Ledgers page", async ({ page }) => {
    await page.goto(taxCaseUrl);
    const rail = page.getByRole("navigation", { name: "Tax Desk workbench" });
    await expect(rail.getByText("No entries yet").first()).toBeVisible();
    await expect(rail.getByText("Entries complete")).toHaveCount(0);
    await rail.getByRole("link", { name: "Ledgers" }).first().click();
    await expect(page).toHaveURL(/\/ledgers$/);
    await expect(page.getByRole("heading", { name: /Ledgers —/ })).toBeVisible();
    await expect(page.getByText(/No income entries yet/i)).toBeVisible();
  });

  test("add-entry drawer shows parent case checklist source options", async ({ page }) => {
    await page.goto(ledgersUrl);
    await page.getByRole("button", { name: "Add income entry" }).click();
    const sel = drawer(page).locator('[name="source_document_id"]');
    await expect(sel).toBeVisible();
    await expect(sel.locator("option").filter({ hasText: /AIS|Form 16|PAN card/ })).not.toHaveCount(0);
    expect((await sel.locator("option").allTextContents()).length).toBeGreaterThan(1);
    await page.keyboard.press("Escape");
  });

  test("add an income entry with a mapped source document", async ({ page }) => {
    await page.goto(ledgersUrl);
    await page.getByRole("button", { name: "Add income entry" }).click();
    await drawer(page).locator('[name="income_head"]').selectOption("salary");
    await drawer(page).locator('[name="amount"]').fill("800000");
    await selectOptionContaining(drawer(page).locator('[name="source_document_id"]'), "AIS");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(region(page, "Income").getByText("salary", { exact: true })).toBeVisible();
    await expect(page.getByText(/Total income:/)).toBeVisible();
    await expect(region(page, "Income").getByText("8,00,000").first()).toBeVisible();
  });

  test("add a tax-paid entry", async ({ page }) => {
    await page.goto(ledgersUrl);
    await openCategory(page, /Tax Paid/);
    await page.getByRole("button", { name: "Add tax-paid entry" }).click();
    await drawer(page).locator('[name="tax_paid_type"]').selectOption("salary_tds");
    await drawer(page).locator('[name="amount"]').fill("50000");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(region(page, "Tax Paid").getByText("salary_tds", { exact: true })).toBeVisible();
    await expect(region(page, "Tax Paid").getByText("50,000").first()).toBeVisible();
  });
});
