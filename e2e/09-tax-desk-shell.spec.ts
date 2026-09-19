import { expect, test } from "@playwright/test";
import { login } from "./helpers";
import { deleteAllTaxCases } from "./lib/fixtures";

/**
 * Phase K.2.1 — Tax Desk foundation shell. The module's nav + two read-only
 * pages render, and with no tax_cases in the DB both show an empty state.
 * (K.2.2 added case creation; the empty-state copy now points to it.)
 *
 * The empty state only renders when zero tax_cases exist. Rather than rely on
 * running against a freshly reset DB (later specs seed tax_cases and never tear
 * them down, so re-runs accumulate hundreds of leftover rows), this spec
 * establishes its own precondition: clear the Tax Desk overlay first. That
 * makes it reliable both alone and inside the full serial suite — it runs
 * before every spec that seeds a tax_case, and each of those seeds its own
 * fresh data, so nothing later depends on rows cleared here.
 */
test.describe.serial("Tax Desk foundation shell (K.2.1)", () => {
  test.beforeAll(async () => {
    await deleteAllTaxCases();
  });

  test("sidebar contains a Tax Desk nav item", async ({ page }) => {
    await login(page);
    await expect(page.getByRole("link", { name: "Tax Desk" })).toBeVisible();
  });

  test("admin can open the Tax Desk dashboard (empty state)", async ({ page }) => {
    await login(page);
    await page.getByRole("link", { name: "Tax Desk" }).click();
    await expect(page).toHaveURL(/\/tax-desk$/);
    await expect(page.getByRole("heading", { name: "Tax Desk" })).toBeVisible();
    await expect(page.getByText(/AY 2026-27 ITR preparation/)).toBeVisible();
    await expect(page.getByText("No ITR prep cases yet")).toBeVisible();
  });

  test("admin can open the Tax Desk cases list (empty state)", async ({ page }) => {
    await login(page);
    await page.goto("/tax-desk/cases");
    await expect(page.getByRole("heading", { name: "ITR Prep Cases" })).toBeVisible();
    await expect(page.getByText("No ITR prep cases yet")).toBeVisible();
  });
});
