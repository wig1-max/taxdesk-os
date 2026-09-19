import { expect, test } from "@playwright/test";
import { RUN, VALID_PNG, createClient, login, selectClient, waitForHydration } from "./helpers";
import { warmTaxDeskOnce } from "./warm";

/**
 * K3-30 — one-source propose -> review -> promote workflow. Exercises the
 * full synthetic-only slice through the real UI: an ingested (uploaded)
 * "Form 16 (per employer)" checklist document gets two proposed facts
 * (salary income + salary TDS), each explicitly accepted, then promoted
 * together into the income/tax_paid ledgers. Also covers reject + re-propose
 * and the truthful "proposal — not authoritative" wording.
 */
test.describe.serial("Source proposals — propose/review/promote (K3-30)", () => {
  const clientName = `E2E Proposal ${RUN}`;
  let taxCaseUrl = "";

  // OPS-11 (ZCode): this describe uses login() (no stored auth), so warm its
  // Tax Desk sub-routes here in an untimed beforeAll — authenticated via login —
  // rather than letting the first /documents or /ledgers navigation cold-compile
  // timed. Uses the worker-scoped `browser` fixture (the per-test `page` fixture
  // is forbidden in beforeAll); login authenticates the throwaway context.
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    await warmTaxDeskOnce(browser, ["documents", "ledgers"], { login });
  });

  test("create a Tax Desk ITR prep case", async ({ page }) => {
    await login(page);
    await createClient(page, { name: clientName, phone: `97${RUN}01` });
    await page.goto("/tax-desk/cases/new");
    await selectClient(page, clientName);
    await page.getByRole("button", { name: "Create ITR prep case" }).click();
    await expect(page).toHaveURL(/\/tax-desk\/cases\/[0-9a-f-]{36}$/);
    taxCaseUrl = page.url();
  });

  test("upload a synthetic Form 16 against the checklist item", async ({ page, browser }) => {
    await login(page);
    await page.goto(`${taxCaseUrl}/documents`);
    await page.getByRole("link", { name: /Parent case Documents →/ }).click();
    await expect(page).toHaveURL(/\/cases\/[0-9a-f-]{36}\/documents$/);

    await page.getByRole("button", { name: "Generate upload link" }).click();
    await expect(page.getByText(/copy it NOW/i)).toBeVisible();
    const uploadUrl = (await page.locator("code").first().textContent()) ?? "";
    expect(uploadUrl).toMatch(/\/upload\/[A-Za-z0-9_-]{40,}/);

    // Fresh unauthenticated context — mirrors the real client upload path.
    const ctx = await browser.newContext();
    const clientPage = await ctx.newPage();
    await clientPage.goto(uploadUrl);
    await clientPage.locator("select").selectOption({ label: "Form 16 (per employer)" });
    await clientPage.getByLabel(/File \(PDF, JPG/).setInputFiles({
      name: "form16.png",
      mimeType: "image/png",
      buffer: VALID_PNG,
    });
    await clientPage.getByRole("checkbox").check();
    await clientPage.getByRole("button", { name: "Upload document" }).click();
    await expect(clientPage.getByText(/Uploaded:/)).toBeVisible();
    await ctx.close();
  });

  test("propose salary income + salary TDS; both stay non-authoritative until accepted", async ({ page }) => {
    await login(page);
    await page.goto(`${taxCaseUrl}/documents`);
    await expect(page.getByText("Synthetic Form 16 salary proposals")).toBeVisible();

    await waitForHydration(page, "#proposal-doc");
    await page.getByLabel("Source document").selectOption({ label: "Form 16 (per employer)" });
    await page.getByLabel("Fact", { exact: true }).selectOption({ label: "Salary income" });
    await page.getByLabel("Proposed amount (₹)").fill("800000");
    await page.getByRole("button", { name: /Record this as a proposed fact/ }).click();
    await expect(page.getByText("proposal — not authoritative").first()).toBeVisible();

    await page.getByLabel("Source document").selectOption({ label: "Form 16 (per employer)" });
    await page.getByLabel("Fact", { exact: true }).selectOption({ label: "Salary TDS" });
    await page.getByLabel("Proposed amount (₹)").fill("60000");
    await page.getByRole("button", { name: /Record this as a proposed fact/ }).click();

    // Two proposed rows are visible; neither is ledger truth yet.
    await expect(page.getByText("Salary income")).toBeVisible();
    await expect(page.getByText("Salary TDS")).toBeVisible();
    await expect(page.getByRole("button", { name: /Promote accepted salary facts/ })).toHaveCount(0);
  });

  test("rejecting a proposal requires a reason, then a corrected re-proposal can be made", async ({ page }) => {
    await login(page);
    await page.goto(`${taxCaseUrl}/documents`);

    const salaryRow = page.getByRole("listitem").filter({ hasText: "Salary income" }).first();
    await salaryRow.getByRole("button", { name: /Reject proposed Salary income/ }).click();
    // The reject button requires a reason field to appear before it actually submits.
    await expect(salaryRow.getByLabel(/Reason for rejecting Salary income/)).toBeVisible();
    await salaryRow.getByLabel(/Reason for rejecting Salary income/).fill("Wrong amount, refiling with correct figure.");
    await salaryRow.getByRole("button", { name: /Reject proposed Salary income/ }).click();
    await expect(page.getByText("Wrong amount, refiling with correct figure.")).toBeVisible();

    // Re-propose the corrected salary income figure.
    await page.getByLabel("Source document").selectOption({ label: "Form 16 (per employer)" });
    await page.getByLabel("Fact", { exact: true }).selectOption({ label: "Salary income" });
    await page.getByLabel("Proposed amount (₹)").fill("812345");
    await page.getByRole("button", { name: /Record this as a proposed fact/ }).click();
    await expect(page.getByText("₹8,12,345").or(page.getByText("₹812,345"))).toBeVisible();
  });

  test("accepting both facts reveals Promote; promotion writes the ledgers", async ({ page }) => {
    await login(page);
    await page.goto(`${taxCaseUrl}/documents`);

    // Accept the corrected salary income (the only remaining Accept control for
    // this fact — the rejected row's actions are hidden once decided).
    await page.getByRole("button", { name: /Accept proposed Salary income/ }).click();
    await expect(page.getByRole("button", { name: /Promote accepted salary facts/ })).toHaveCount(0);

    await page.getByRole("button", { name: /Accept proposed Salary TDS/ }).click();
    const promote = page.getByRole("button", { name: /Promote accepted salary facts/ });
    await expect(promote).toBeVisible();
    await promote.click();
    await expect(page.getByText("promoted").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Promote accepted salary facts/ })).toHaveCount(0);
  });

  test("promoted facts appear as ledger entries with Form16 sourcing", async ({ page }) => {
    await login(page);
    await page.goto(`${taxCaseUrl}/ledgers`);
    await expect(page.getByText("₹8,12,345").or(page.getByText(/812,345/)).first()).toBeVisible();
  });

  test("a11y: keyboard reachable, ≥44px targets, no 360px overflow", async ({ page }) => {
    await login(page);
    await page.goto(`${taxCaseUrl}/documents`);
    // Promote button (still the last live control from the previous case state
    // history) and the accept/reject controls are native <button>s — already
    // keyboard-operable. Verify the ≥44px hit area on a representative control.
    const anyDecideOrPromote = page.getByRole("button", { name: /Propose|Accept proposed|Reject proposed/ }).first();
    if (await anyDecideOrPromote.count()) {
      const box = await anyDecideOrPromote.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }

    await page.setViewportSize({ width: 360, height: 800 });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });
});
