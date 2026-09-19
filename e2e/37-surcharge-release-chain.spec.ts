import { expect, test } from "@playwright/test";
import { SURCHARGE } from "../src/lib/tax-engine/ay-2026-27/rules";
import { ADMIN_STORAGE_STATE } from "./lib/auth-state";
import {
  readFinalizationState,
  seedEngineSnapshot,
  seedTaxCase,
  setRequiredDocs,
  setValidationRun,
} from "./lib/fixtures";
import { expectReconciled } from "./lib/reconcile";
import { warmTaxDeskOnce } from "./warm";

/** AUDIT-05-F5/F1: released surcharge window through finalization. */
test.use({ storageState: ADMIN_STORAGE_STATE });
test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await warmTaxDeskOnce(browser);
});

const THRESHOLD = 5_000_000;
const CEILING = SURCHARGE.supportedTotalIncomeCeiling;
const SALARY = 8_000_000;

test.describe.serial("Released surcharge window reaches manifest, approval and finalization", () => {
  let taxCaseId = "";
  let reviewUrl = "";
  let snapshotId = "";
  let surcharge = { old: 0, knew: 0 };

  test.beforeAll(async () => {
    const seededCase = await seedTaxCase({
      itrTypeSelected: "ITR-1",
      income: [{ income_head: "salary", amount: SALARY, source_type: "Form16" }],
      taxPaid: [{ tax_paid_type: "salary_tds", amount: 2_000_000, source_type: "Form16" }],
    });
    taxCaseId = seededCase.taxCaseId;
    reviewUrl = `/tax-desk/cases/${seededCase.taxCaseId}/review`;
    await setRequiredDocs(seededCase.caseId, "satisfied");
    const seeded = await seedEngineSnapshot(seededCase.taxCaseId);
    snapshotId = seeded.snapshotId;
    await setValidationRun(seededCase.taxCaseId);
    surcharge = {
      old: seeded.computation.oldRegime.surcharge.value,
      knew: seeded.computation.newRegime.surcharge.value,
    };
  });

  test("the stored engine snapshot carries non-zero computed surcharge", () => {
    expect(surcharge.old).toBeGreaterThan(100_000);
    expect(surcharge.knew).toBeGreaterThan(100_000);
  });

  test("the salary is inside the released surcharge window", () => {
    expect(SALARY).toBeGreaterThan(THRESHOLD);
    expect(SALARY).toBeLessThanOrEqual(CEILING);
  });

  test("Computation shows no reliance-blocked banner", async ({ page }) => {
    await page.goto(`/tax-desk/cases/${taxCaseId}/computation`);
    await expect(page.getByText("Provisional computation — reliance blocked")).toHaveCount(0);
  });

  test("review preparation succeeds", async ({ page }) => {
    await page.goto(reviewUrl);
    await page.getByRole("button", { name: "Prepare review pack" }).click();
    await expectReconciled(page, "Review pack prepared ✓");
    await page.reload();
    await expect(page.getByText("Review pack prepared and bound to the latest complete snapshot")).toBeVisible();
  });

  test("manifest generation succeeds (AUDIT-05-F1 regression)", async ({ page }) => {
    await page.goto(reviewUrl);
    await page.getByLabel("New regime").check();
    await page.getByRole("button", { name: "Generate manifest" }).click();
    await expectReconciled(page, "Evidence manifest generated ✓");
    await page.reload();
    await expect(page.getByTestId("evidence-manifest-summary")).toContainText("Bound to current snapshot");
  });

  test("client approval succeeds for the manifest", async ({ page }) => {
    await page.goto(reviewUrl);
    await page.getByRole("button", { name: "Capture client approval" }).click();
    await page.getByLabel("Approval reference").fill("Confirmed by WhatsApp for the AUDIT-05-F5 in-window case.");
    await page.getByRole("button", { name: "Save confirmation" }).click();
    await expectReconciled(page, "Client approval captured ✓");
    await page.reload();
    await expect(page.getByTestId("evidence-manifest-summary")).toContainText(
      "Client approval is current for this manifest",
    );
  });

  test("the approved in-window case can be finalized", async ({ page }) => {
    await page.goto(`/tax-desk/cases/${taxCaseId}/readiness`);
    const finalize = page.getByRole("button", { name: "Finalize internal preparation" });
    await expect(finalize).toBeEnabled();
    await finalize.click();
    await page.getByLabel("Finalization note").fill("Internal preparation complete for the in-window surcharge case.");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Finalize now" }).click();
    await expectReconciled(page, "Internally finalized ✓");
    const state = await readFinalizationState(taxCaseId);
    expect(state?.finalized_at).not.toBeNull();
    expect(state?.finalized_snapshot_id).toBe(snapshotId);
    expect(state?.filing_status).not.toBe("filed");
  });
});
