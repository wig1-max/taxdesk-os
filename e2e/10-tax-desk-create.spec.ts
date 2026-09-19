import { expect, test } from "@playwright/test";
import { RUN, createClient, login, selectClient } from "./helpers";

/**
 * Phase K.2.2 — Tax Desk ITR Prep case creation. Staff/admin create a
 * tax_cases child linked 1:1 to a normal ITR parent case. One prep case per
 * client + AY; scope notes reject portal-credential text.
 */
test.describe.serial("Tax Desk ITR Prep creation (K.2.2)", () => {
  const clientName = `E2E TaxPrep ${RUN}`;
  let taxCaseUrl = "";

  test("admin can open the new ITR prep case page", async ({ page }) => {
    await login(page);
    await page.goto("/tax-desk/cases");
    await page.getByRole("link", { name: "New ITR Prep Case" }).click();
    await expect(page).toHaveURL(/\/tax-desk\/cases\/new$/);
    await expect(page.getByRole("heading", { name: "New ITR Prep Case" })).toBeVisible();
    // K4-PORT-08: the create form names the second world and says it cannot
    // compute. A 1961-only selector would let a silent TY computation land
    // as a documentation-only edit.
    await expect(page.locator('select[name="law"] option[value="ITA_2025"]')).toHaveText(
      /Income-tax Act, 2025 \(tax year\) — no computation yet/,
    );
  });

  test("scope notes reject obvious portal credential text", async ({ page }) => {
    await login(page);
    await createClient(page, { name: clientName, phone: `94${RUN}01` });
    await page.goto("/tax-desk/cases/new");
    await selectClient(page, clientName);
    await page.getByLabel("Scope notes (optional)").fill("client portal password is hunter2");
    await page.getByRole("button", { name: "Create ITR prep case" }).click();
    await expect(page.locator('p[role="alert"]')).toContainText(/credential/i);
    await expect(page).toHaveURL(/\/tax-desk\/cases\/new$/);
  });

  test("admin creates an ITR prep case and is redirected to the workbench", async ({ page }) => {
    await login(page);
    await page.goto("/tax-desk/cases/new");
    await selectClient(page, clientName);
    await page.getByLabel("ITR type (optional)").selectOption("ITR-1");
    await page.getByLabel("Scope notes (optional)").fill("Salaried, two Form 16s, FD interest.");
    await page.getByRole("button", { name: "Create ITR prep case" }).click();
    await expect(page).toHaveURL(/\/tax-desk\/cases\/[0-9a-f-]{36}$/);
    taxCaseUrl = page.url();
    await expect(page.getByRole("heading", { name: new RegExp(clientName) })).toBeVisible();
  });

  test("created case appears in the ITR prep cases list", async ({ page }) => {
    await login(page);
    await page.goto("/tax-desk/cases");
    await expect(page.getByRole("row", { name: new RegExp(clientName) })).toHaveCount(1);
  });

  test("the parent case opens from the workbench link", async ({ page }) => {
    await login(page);
    await page.goto(taxCaseUrl);
    await page.getByRole("link", { name: /All ITR prep cases/ }); // sanity: page rendered
    // The "Parent case" field links to /cases/<uuid>.
    const parentLink = page.locator('a[href^="/cases/"]').first();
    await parentLink.click();
    await expect(page).toHaveURL(/\/cases\/[0-9a-f-]{36}/);
    await expect(page.getByRole("heading", { name: "ITR Filing" })).toBeVisible();
  });

  test("a duplicate ITR prep case for the same client + AY is blocked", async ({ page }) => {
    await login(page);
    await page.goto("/tax-desk/cases/new");
    await selectClient(page, clientName);
    await page.getByRole("button", { name: "Create ITR prep case" }).click();
    await expect(page.locator('p[role="alert"]')).toContainText(/already exists/i);
    await expect(page).toHaveURL(/\/tax-desk\/cases\/new$/);
  });
});
