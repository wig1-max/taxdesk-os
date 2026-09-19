import { expect, test } from "@playwright/test";
import { ADMIN_STORAGE_STATE } from "./lib/auth-state";
import { readFindings, seedTaxCase } from "./lib/fixtures";
import { warmTaxDeskOnce } from "./warm";

/** OPS-13: seeded UI path for the K4-10 Section 74 computation. */
test.use({ storageState: ADMIN_STORAGE_STATE });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await warmTaxDeskOnce(browser);
});

test.describe.serial("Brought-forward capital-loss path", () => {
  let taxCaseId = "";

  test.beforeAll(async () => {
    const seeded = await seedTaxCase({
      itrTypeSelected: "ITR-2",
      capitalGains: [
        {
          gain_type: "ltcg_112a",
          sale_value: 600_000,
          cost: 100_000,
          taxable_gain: 500_000,
          source_type: "broker_report",
        },
      ],
      broughtForwardLosses: [
        {
          originating_assessment_year: "2022-23",
          loss_type: "ltcl",
          amount: 200_000,
          filing_eligibility: "verified_timely",
          loss_provenance: "staff_declared",
          source_type: "manual",
          mapFirstDoc: true,
          mapProofDoc: true,
        },
      ],
    });
    taxCaseId = seeded.taxCaseId;
  });

  test("seeded brought-forward loss is visible in the live ledger", async ({ page }) => {
    await page.goto(`/tax-desk/cases/${taxCaseId}/ledgers`);
    await page.getByRole("tab", { name: /Brought-forward Losses/ }).click();
    const row = page.getByRole("region", { name: "Brought-forward Losses" }).getByRole("listitem");
    await expect(row).toContainText("ltcl");
    await expect(row).toContainText("₹2,00,000");
  });

  test("Computation applies the seeded loss against the long-term gain", async ({ page }) => {
    await page.goto(`/tax-desk/cases/${taxCaseId}/computation`);
    await expect(page.getByText("Provisional computation — reliance blocked")).toHaveCount(0);
    await page.getByText("View full calculation").click();
    const oldRegimeSetOff = page
      .locator('[data-material-figure-id="detail.old.broughtForwardLossSetOff"]')
      .locator("..");
    await expect(oldRegimeSetOff).toContainText("Brought-forward capital loss set off (s.74)");
    await expect(oldRegimeSetOff).toContainText("2,00,000");
  });

  test("Validation persists the engine's Section 74 disclosure", async ({ page }) => {
    await page.goto(`/tax-desk/cases/${taxCaseId}/validation`);
    await page.getByRole("button", { name: "Run validation" }).click();
    await expect(page.getByText(/Validation saved:/)).toBeVisible();
    await expect(page.getByText("Engine: BROUGHT_FORWARD_LOSS_SET_OFF_APPLIED")).toBeVisible();
    expect(
      (await readFindings(taxCaseId)).some(
        (finding) => finding.code === "engine.BROUGHT_FORWARD_LOSS_SET_OFF_APPLIED",
      ),
    ).toBe(true);
  });
});
