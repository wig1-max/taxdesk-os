import { expect, test } from "@playwright/test";
import { SURCHARGE } from "../src/lib/tax-engine/ay-2026-27/rules";
import { ADMIN_STORAGE_STATE } from "./lib/auth-state";
import { seedEngineSnapshot, seedSnapshot, seedTaxCase } from "./lib/fixtures";
import { warmTaxDeskOnce } from "./warm";

/** TAX-SAFE-01: hard refusal boundaries and D126 ambiguity through the UI. */
test.use({ storageState: ADMIN_STORAGE_STATE });
test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await warmTaxDeskOnce(browser);
});

const CEILING = SURCHARGE.supportedTotalIncomeCeiling;

test.describe.serial("Surcharge / marginal-relief reliance blockers", () => {
  let highTaxCaseId = "";
  let mixedAmbiguousTaxCaseId = "";
  let mixedAmbiguousStates = { old: "", knew: "" };

  test.beforeAll(async () => {
    const high = await seedTaxCase({
      itrTypeSelected: "ITR-1",
      income: [{ income_head: "salary", amount: CEILING + 5_000_000, source_type: "Form16" }],
    });
    highTaxCaseId = high.taxCaseId;
    await seedSnapshot(high.taxCaseId, { salary: CEILING + 5_000_000 });

    // D126: ₹51L-ish total income composed of slab salary plus a substantial
    // 112A gain. Relief is real but the notional ₹50L reference can lawfully
    // contain different special-rate proportions, so no composition is guessed.
    const mixed = await seedTaxCase({
      itrTypeSelected: "ITR-2",
      income: [{ income_head: "salary", amount: 3_175_000, source_type: "Form16" }],
      capitalGains: [
        {
          gain_type: "ltcg_112a",
          sale_value: 2_100_000,
          cost: 100_000,
          taxable_gain: 2_000_000,
          source_type: "broker_report",
        },
      ],
    });
    mixedAmbiguousTaxCaseId = mixed.taxCaseId;
    const snapshot = await seedEngineSnapshot(mixed.taxCaseId);
    mixedAmbiguousStates = {
      old: snapshot.computation.oldRegime.surchargeTreatment.state,
      knew: snapshot.computation.newRegime.surchargeTreatment.state,
    };
  });

  // OPS-13: the old measured site was already single-navigation, so its three
  // independent visibility waits now own separate test budgets.
  test("high-risk Computation shows the reliance-blocked banner", async ({ page }) => {
    await page.goto(`/tax-desk/cases/${highTaxCaseId}/computation`);
    await expect(page.getByText("Provisional computation — reliance blocked")).toBeVisible();
  });

  test("high-risk Computation explains the unsupported surcharge treatment", async ({ page }) => {
    await page.goto(`/tax-desk/cases/${highTaxCaseId}/computation`);
    await expect(page.getByText(/surcharge and marginal relief could not be computed/i)).toBeVisible();
  });

  test("high-risk Computation refuses to present a final tax amount", async ({ page }) => {
    await page.goto(`/tax-desk/cases/${highTaxCaseId}/computation`);
    await expect(page.getByText(/NOT a final tax amount/i)).toBeVisible();
  });

  test("client-review preparation is rejected for the high-risk case", async ({ page }) => {
    await page.goto(`/tax-desk/cases/${highTaxCaseId}/review`);
    await page.getByRole("button", { name: "Prepare review pack" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /surcharge/i })).toContainText(/not approval-ready/i);
  });

  test("Filing Readiness blocks finalization for the high-risk case", async ({ page }) => {
    await page.goto(`/tax-desk/cases/${highTaxCaseId}/readiness`);
    await expect(page.getByText(/reliance is blocked until a professional prepares this case manually/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Finalize internal preparation" })).toBeDisabled();
  });

  test("D126 mixed-composition marginal relief is refused rather than guessed", async ({ page }) => {
    expect(mixedAmbiguousStates).toEqual({
      old: "unsupported_marginal_relief_reference_ambiguous",
      knew: "unsupported_marginal_relief_reference_ambiguous",
    });
    await page.goto(`/tax-desk/cases/${mixedAmbiguousTaxCaseId}/computation`);
    await expect(page.getByText("Provisional computation — reliance blocked")).toBeVisible();
    await expect(page.getByText(/surcharge and marginal relief could not be computed/i)).toBeVisible();
  });
});
