import { expect, test } from "@playwright/test";
import { RUN, createClient, login, selectClient } from "./helpers";
import { reconcileForFreshUi } from "./lib/reconcile";
import { warmTaxDeskOnce } from "./warm";

/**
 * Phase K.2.3 — Tax Desk documents/checklist integration. The workbench
 * Documents page reads the SAME parent-case checklist (no duplicate state),
 * shows counts + app-routed file links, and allows inline status changes.
 */
test.describe.serial("Tax Desk documents (K.2.3)", () => {
  const clientName = `E2E TaxDocs ${RUN}`;
  let taxCaseUrl = "";

  // OPS-11 (ZCode): this describe uses login() (no stored auth), so warm its
  // Tax Desk sub-route here in an untimed beforeAll — authenticated via login —
  // rather than letting the first /documents navigation cold-compile timed.
  // Uses the worker-scoped `browser` fixture (the per-test `page` fixture is
  // forbidden in beforeAll); login authenticates the throwaway context.
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    await warmTaxDeskOnce(browser, ["documents"], { login });
  });

  test("create a Tax Desk ITR prep case", async ({ page }) => {
    await login(page);
    await createClient(page, { name: clientName, phone: `95${RUN}01` });
    await page.goto("/tax-desk/cases/new");
    await selectClient(page, clientName);
    await page.getByRole("button", { name: "Create ITR prep case" }).click();
    await expect(page).toHaveURL(/\/tax-desk\/cases\/[0-9a-f-]{36}$/);
    taxCaseUrl = page.url();
  });

  test("workbench links to the Documents page", async ({ page }) => {
    await login(page);
    await page.goto(taxCaseUrl);
    await page.getByRole("navigation", { name: "Tax Desk workbench" }).getByRole("link", { name: "Documents" }).click();
    await expect(page).toHaveURL(/\/tax-desk\/cases\/[0-9a-f-]{36}\/documents$/);
  });

  test("documents page shows the ITR prep checklist with key items", async ({ page }) => {
    await login(page);
    await page.goto(`${taxCaseUrl}/documents`);
    await expect(page.getByText("ITR preparation checklist")).toBeVisible();
    // Core AY 2026-27 prep items must appear. The K.2.8.5 redesign renders the
    // checklist as a grouped list (not a table); document names are exact-text
    // labels, so match on text rather than table cells.
    await expect(page.getByText("AIS", { exact: true })).toBeVisible();
    await expect(page.getByText("Form 26AS", { exact: true })).toBeVisible();
    await expect(page.getByText("Form 16 (per employer)", { exact: true })).toBeVisible();
    // Items added by the K.2.3 checklist top-up.
    await expect(page.getByText("Prefilled JSON (e-filing portal)", { exact: true })).toBeVisible();
    await expect(page.getByText("Home loan interest certificate", { exact: true })).toBeVisible();
  });

  test("required/optional document counts render (K.2.8.6 language)", async ({ page }) => {
    await login(page);
    await page.goto(`${taxCaseUrl}/documents`);
    // K.2.8.6 Part G: optional items are never labelled "missing" — the summary
    // separates Required vs Optional accounting.
    await expect(page.getByText("Required complete", { exact: true })).toBeVisible();
    await expect(page.getByText("Required outstanding", { exact: true })).toBeVisible();
    await expect(page.getByText("Rejected", { exact: true })).toBeVisible();
    await expect(page.getByText("Optional not provided", { exact: true })).toBeVisible();
  });

  test("page links back to the Tax Desk case and to the parent case documents", async ({ page }) => {
    await login(page);
    await page.goto(`${taxCaseUrl}/documents`);
    // Back to Tax Desk case → the workbench overview.
    await page.getByRole("link", { name: /Back to Tax Desk case/ }).click();
    await expect(page).toHaveURL(taxCaseUrl);

    // Parent case Documents (header link with the arrow) opens the existing
    // /cases/[id]/documents page. Anchor the URL after the host so it does NOT
    // also match the /tax-desk/cases/.../documents path.
    await page.goto(`${taxCaseUrl}/documents`);
    await page.getByRole("link", { name: /Parent case Documents →/ }).click();
    await expect(page).toHaveURL(/:\d+\/cases\/[0-9a-f-]{36}\/documents$/);
    await expect(page.getByRole("heading", { name: "Checklist", exact: true })).toBeVisible();
  });

  test("a checklist item can be marked received from the Tax Desk page", async ({ page }) => {
    await login(page);
    await page.goto(`${taxCaseUrl}/documents`);
    // K.2.8.5: the checklist is a grouped list; each item is a <li>.
    const row = page.getByRole("listitem").filter({ hasText: /Previous year ITR/ });
    await row.locator("select").selectOption("received");
    await row.getByRole("button", { name: /Apply/ }).click();
    // "Saved ✓" only renders when the server action persisted the change.
    await reconcileForFreshUi(page, row.getByText("Saved ✓"));
    // After router.refresh the item's status badge reads "received".
    await expect(row).toContainText("received");
  });
});
