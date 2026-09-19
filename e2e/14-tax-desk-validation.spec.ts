import { expect, test } from "@playwright/test";
import { warmTaxDeskOnce } from "./warm";
import { ADMIN_STORAGE_STATE } from "./lib/auth-state";
import { readFindings, seedTaxCase, seedValidationCase, setRequiredDocs, softRemoveLedger } from "./lib/fixtures";

/**
 * Phase K.2.6 — Tax Desk validation & manual source reconciliation.
 * Authenticated via shared admin storage state; fixtures seed the rich case.
 */
test.use({ storageState: ADMIN_STORAGE_STATE });

// OPS-11 (ZCode): per-spec route warming. Compile this shard's own Tax Desk
// sub-routes here, in an untimed beforeAll, instead of every shard compiling
// all of them in setup. Static routes stay warmed in setup; see e2e/warm.ts.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await warmTaxDeskOnce(browser);
});

let valUrl = "";
let taxCaseId = "";
let houseIncomeId = "";
let finalizedValUrl = "";

test.describe.serial("Tax Desk validation (K.2.6)", () => {
  test.beforeAll(async () => {
    const seeded = await seedValidationCase();
    taxCaseId = seeded.taxCaseId;
    houseIncomeId = seeded.houseIncomeId;
    valUrl = `/tax-desk/cases/${taxCaseId}/validation`;

    const fin = await seedTaxCase({ finalized: true, income: [{ income_head: "salary", amount: 500000, source_type: "Form16" }] });
    finalizedValUrl = `/tax-desk/cases/${fin.taxCaseId}/validation`;
  });

  test("workbench links to Validation; empty state before first run", async ({ page }) => {
    await page.goto(`/tax-desk/cases/${taxCaseId}`);
    await page.getByRole("navigation", { name: "Tax Desk workbench" }).getByRole("link", { name: "Validation" }).click();
    await expect(page).toHaveURL(/\/validation$/);
    await expect(page.getByRole("heading", { name: /Validation —/ })).toBeVisible();
    await expect(page.getByText(/No validation run yet/)).toBeVisible();
  });

  test("Run validation persists findings and summary counts render", async ({ page }) => {
    await page.goto(valUrl);
    await page.getByRole("button", { name: "Run validation" }).click();
    await expect(page.getByText(/Validation saved:/)).toBeVisible();
    await page.reload();
    await expect(page.getByText("Errors", { exact: true })).toBeVisible();
    await expect(page.getByText(/Last run:/)).toBeVisible();
    // At least one error (unsupported entry) present.
    const findings = await readFindings(taxCaseId);
    expect(findings.some((f) => f.severity === "error")).toBe(true);
  });

  test("key findings render: missing doc, unsupported, cg-arithmetic, duplicate, Form16/AIS, Form16/26AS", async ({ page }) => {
    await page.goto(valUrl);
    await expect(page.getByText("Required document missing").first()).toBeVisible();
    await expect(page.getByText("Unsupported ledger entry").first()).toBeVisible();
    await expect(page.getByText("Capital-gain arithmetic mismatch").first()).toBeVisible();
    await expect(page.getByText("Possible duplicate ledger entries").first()).toBeVisible();
    await expect(page.getByText(/Salary — Form 16 vs AIS/).first()).toBeVisible();
    await expect(page.getByText(/Salary TDS — Form 16 vs 26AS/).first()).toBeVisible();
  });

  test("reconciliation source totals render", async ({ page }) => {
    await page.goto(valUrl);
    // Reconciliation is a secondary, collapsible section — expand it first.
    await page.getByText("Source reconciliation", { exact: true }).click();
    await expect(page.getByText(/Deltas shown for configured comparable pairs/i)).toBeVisible();
    await expect(page.getByText("income · salary").first()).toBeVisible();
    await expect(page.getByText("Form16").first()).toBeVisible();
  });

  test("resolve requires a note; rejects credential text; valid note resolves; reopen works", async ({ page }) => {
    await page.goto(valUrl);
    // Open the first finding's resolve control.
    await page.getByRole("button", { name: "Resolve" }).first().click();
    // Empty note → rejected.
    await page.getByRole("button", { name: "Save resolution" }).click();
    await expect(page.getByText(/resolution note of at least 3/i)).toBeVisible();
    // Credential-like note → rejected.
    await page.getByLabel("Resolution note").fill("client portal password is hunter2");
    await page.getByRole("button", { name: "Save resolution" }).click();
    await expect(page.getByText(/credential/i)).toBeVisible();
    // Valid note → resolves. Wait for the resolve to complete (the dialog closes
    // on success) BEFORE reloading, otherwise the reload races the async action.
    await page.getByLabel("Resolution note").fill("Reviewed with client; acceptable.");
    await page.getByRole("button", { name: "Save resolution" }).click();
    await expect(page.getByRole("alertdialog")).toBeHidden();
    await page.reload();
    const resolved = (await readFindings(taxCaseId)).filter((f) => f.status === "resolved" && f.resolution_note);
    expect(resolved.length).toBeGreaterThan(0);
    // Reopen the resolved one.
    await page.getByRole("button", { name: "Reopen" }).first().click();
    await page.reload();
    // manual resolution note cleared on reopen
    const stillManuallyResolved = (await readFindings(taxCaseId)).filter(
      (f) => f.status === "resolved" && f.resolution_note && !String(f.resolution_note).startsWith("Auto-resolved"),
    );
    expect(stillManuallyResolved.length).toBe(0);
  });

  test("removing the unsupported entry and refreshing auto-resolves it; refresh does not duplicate", async ({ page }) => {
    await softRemoveLedger("tax_income_entries", houseIncomeId);
    await page.goto(valUrl);
    await page.getByRole("button", { name: "Refresh validation" }).click();
    await expect(page.getByText(/Validation saved:/)).toBeVisible();

    const after = await readFindings(taxCaseId);
    const unsupported = after.filter((f) => f.code === "coverage.unsupported_entry");
    // exactly one (no duplicate) and auto-resolved
    expect(unsupported.length).toBe(1);
    expect(unsupported[0]?.status).toBe("resolved");

    // No duplicate finding_keys anywhere (unique lifecycle).
    const keys = after.filter((f) => f.finding_key).map((f) => f.finding_key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("no PAN / Aadhaar / notes / storage URLs in any finding", async () => {
    const findings = await readFindings(taxCaseId);
    const blob = JSON.stringify(findings);
    const noUuids = blob.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "");
    expect(blob).not.toMatch(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/);
    expect(noUuids).not.toMatch(/\b\d{12}\b/);
    expect(blob.toLowerCase()).not.toContain("aadhaar");
    expect(blob).not.toMatch(/https?:\/\//);
  });

  test("Documents, Ledgers and Computation routes still open", async ({ page }) => {
    await page.goto(`/tax-desk/cases/${taxCaseId}/documents`);
    await expect(page.getByText("ITR preparation checklist")).toBeVisible();
    await page.goto(`/tax-desk/cases/${taxCaseId}/ledgers`);
    await expect(page.getByRole("heading", { name: /Ledgers —/ })).toBeVisible();
    await page.goto(`/tax-desk/cases/${taxCaseId}/computation`);
    await expect(page.getByRole("heading", { name: /Computation —/ })).toBeVisible();
  });

  test("zero-finding run on a clean case registers everywhere without a reload (Phase 3)", async ({ page }) => {
    // A genuinely clean case: salary-only (manual source → no external-source /
    // reconciliation findings), refund position (large TDS → no payable-challan
    // finding), ITR-1 selected == recommended, all required docs satisfied. This
    // produces ZERO validation findings, which pre-Phase 3 left the run invisible
    // on the Validation page ("never") while the workbench read the marker.
    const clean = await seedTaxCase({
      itrTypeSelected: "ITR-1",
      income: [{ income_head: "salary", amount: 800000, source_type: "manual" }],
      taxPaid: [{ tax_paid_type: "salary_tds", amount: 200000, source_type: "manual" }],
    });
    await setRequiredDocs(clean.caseId, "satisfied");
    const cleanValUrl = `/tax-desk/cases/${clean.taxCaseId}/validation`;

    await page.goto(cleanValUrl);
    // Before the first run: no run marker anywhere.
    await expect(page.getByText(/No validation run yet/)).toBeVisible();
    await expect(page.getByText(/Last run:\s*never/i)).toBeVisible();

    // Prove reconciliation happens WITHOUT a full page reload.
    let loads = 0;
    page.on("load", () => (loads += 1));

    await page.getByRole("button", { name: "Run validation" }).click();
    // Success surfaces only after reconciliation (Phase 3: the run marker moves
    // even with zero findings, so this no longer parks in `unconfirmed`).
    await expect(page.getByText(/Validation saved:/)).toBeVisible();

    // The run is now visible on the Validation page — "never" is gone — without
    // any manual reload, and there is NO unconfirmed-park banner.
    await expect(page.getByText(/Last run:\s*never/i)).toBeHidden();
    await expect(page.getByText(/Last run:/)).toBeVisible();
    await expect(page.getByTestId("validation-unconfirmed")).toBeHidden();
    expect(loads).toBe(0);

    // It is genuinely a zero-finding run (proves the authoritative marker, not a
    // findings inference, drives the run state).
    const findings = await readFindings(clean.taxCaseId);
    expect(findings.length).toBe(0);

    // Agreement: the workbench overview reads the SAME marker, so its
    // "Validation last run" key date now shows a time too (page + rail agree).
    await page.goto(`/tax-desk/cases/${clean.taxCaseId}`);
    const runDate = page.locator("dt", { hasText: "Validation last run" }).locator("xpath=following-sibling::dd[1]");
    await expect(runDate).toBeVisible();
    await expect(runDate).not.toHaveText("—");
  });

  test("finalized case is read-only for validation actions", async ({ page }) => {
    await page.goto(finalizedValUrl);
    await expect(page.getByText(/finalized/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Run validation|Refresh validation/ })).toBeDisabled();
  });
});
