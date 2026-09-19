import { expect, test } from "@playwright/test";
import { warmTaxDeskOnce } from "./warm";
import { ADMIN_STORAGE_STATE } from "./lib/auth-state";
import { seedSnapshot, seedTaxCase } from "./lib/fixtures";
import { reconcileForFreshUi } from "./lib/reconcile";

/**
 * K4-01 — senior / super-senior citizen safety boundary. CONDITION NARROWED
 * in K4-05 (decision D79) — see below.
 *
 * Proves the real UI path (not just the pure/DB layers already covered by
 * unit tests and tests/security/senior-treatment-blocker.mjs):
 *   1. A below-60 resident control case is completely unaffected end to end.
 *   2. K4-05: a resident senior citizen selecting the OLD regime now
 *      SUCCEEDS generating an accepted-evidence manifest — the full
 *      later-computation dossier (§10.1-§10.4) is closed, so this session
 *      removed the block, mirroring the below-60 control.
 *   3. The SAME senior citizen selecting the NEW regime is (still) NOT
 *      blocked solely for age, and the manifest panel no longer discloses a
 *      comparison-unreliability caveat (K4-05 — that disclosure was removed
 *      too, since the underlying reason for it no longer holds).
 *   4. K4-05: a resident super-senior citizen ALSO succeeds for the OLD
 *      regime, same as the senior case.
 *   5. Filing Readiness no longer shows the pre-approval comparison-
 *      reliability caveat for a resident senior/super-senior taxpayer
 *      (K4-05 — the disclosure was removed) and the selected-regime item
 *      reads passed for BOTH the OLD and NEW regime now.
 *
 * Unresolved-residency and non-resident-senior-by-age cases are NOT
 * reachable via this UI path: `eligibility.ts`'s existing
 * `PROFILE_RESIDENTIAL_STATUS_MISSING` / `UNSUPPORTED_RESIDENTIAL_STATUS`
 * blockers withhold computation entirely BEFORE a case ever reaches Client
 * Review — those two golden cases are covered at the pure/DB layer only
 * (senior-treatment.test.ts, evidence-manifest.test.ts,
 * tests/security/senior-treatment-blocker.mjs assertions 6/7).
 */
test.use({ storageState: ADMIN_STORAGE_STATE });

// OPS-11 (ZCode): per-spec route warming. Compile this shard's own Tax Desk
// sub-routes here, in an untimed beforeAll, instead of every shard compiling
// all of them in setup. Static routes stay warmed in setup; see e2e/warm.ts.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await warmTaxDeskOnce(browser);
});

test.describe.serial("Senior / super-senior citizen safety boundary (K4-01, narrowed K4-05)", () => {
  let controlTaxCaseId = "";
  let seniorTaxCaseId = "";
  let superSeniorTaxCaseId = "";

  test.beforeAll(async () => {
    // Below-60 resident control (DOB well after the previous-year end for a
    // 60th birthday — same fixture shape as senior-treatment.test.ts).
    const control = await seedTaxCase({
      itrTypeSelected: "ITR-1",
      income: [{ income_head: "salary", amount: 800000, source_type: "Form16" }],
      profile: { dateOfBirth: "1966-04-01", residentialStatus: "resident" },
    });
    controlTaxCaseId = control.taxCaseId;
    await seedSnapshot(control.taxCaseId, { salary: 800000 });

    // Resident senior citizen (turns 60 exactly at the AY 2026-27 previous
    // year end, 2026-03-31 — the same boundary fixture the unit tests use).
    const senior = await seedTaxCase({
      itrTypeSelected: "ITR-1",
      income: [{ income_head: "salary", amount: 800000, source_type: "Form16" }],
      profile: { dateOfBirth: "1966-03-31", residentialStatus: "resident" },
    });
    seniorTaxCaseId = senior.taxCaseId;
    await seedSnapshot(senior.taxCaseId, { salary: 800000 });

    // Resident super-senior citizen (turns 80 exactly at the previous year end).
    const superSenior = await seedTaxCase({
      itrTypeSelected: "ITR-1",
      income: [{ income_head: "salary", amount: 800000, source_type: "Form16" }],
      profile: { dateOfBirth: "1946-03-31", residentialStatus: "resident" },
    });
    superSeniorTaxCaseId = superSenior.taxCaseId;
    await seedSnapshot(superSenior.taxCaseId, { salary: 800000 });
  });

  test("below-60 control: prepare review pack, generate an OLD-regime manifest, capture approval, finalize — all succeed", async ({
    page,
  }) => {
    await page.goto(`/tax-desk/cases/${controlTaxCaseId}/review`);
    await page.getByRole("button", { name: "Prepare review pack" }).click();
    await reconcileForFreshUi(page, "Review pack prepared ✓");

    await page.getByLabel("Old regime").check();
    await page.getByRole("button", { name: "Generate manifest" }).click();
    await reconcileForFreshUi(page, "Evidence manifest generated ✓");
    await expect(page.getByTestId("evidence-manifest-summary")).toContainText("OLD regime");
    await expect(page.getByTestId("evidence-manifest-summary")).not.toContainText(
      "resident senior/super-senior citizen",
    );
  });

  test("K4-05: resident senior selecting the OLD regime NOW SUCCEEDS (no longer rejected)", async ({ page }) => {
    await page.goto(`/tax-desk/cases/${seniorTaxCaseId}/review`);
    await page.getByRole("button", { name: "Prepare review pack" }).click();
    await reconcileForFreshUi(page, "Review pack prepared ✓");

    const oldRadio = page.getByLabel("Old regime");
    await expect(oldRadio).toBeEnabled();
    await oldRadio.check();
    const generateButton = page.getByRole("button", { name: "Generate manifest" });
    await expect(generateButton).toBeEnabled();
    await generateButton.click();

    await reconcileForFreshUi(page, "Evidence manifest generated ✓");
    const summary = page.getByTestId("evidence-manifest-summary");
    await expect(summary).toContainText("OLD regime");
    await expect(summary).toContainText("Senior citizen (60–79)");
    // K4-05: no comparison-unreliability caveat any more — the full
    // later-computation dossier is closed, so the underlying reason for it
    // no longer holds.
    await expect(summary).not.toContainText(/comparison was not reliable/i);
  });

  test("the SAME resident senior selecting the NEW regime is NOT blocked solely for age, and no longer discloses comparison unreliability (K4-05)", async ({
    page,
  }) => {
    await page.goto(`/tax-desk/cases/${seniorTaxCaseId}/review`);
    await page.getByLabel("New regime").check();
    await page.getByRole("button", { name: "Generate manifest" }).click();
    await reconcileForFreshUi(page, "Evidence manifest generated ✓");

    const summary = page.getByTestId("evidence-manifest-summary");
    await expect(summary).toContainText("NEW regime");
    await expect(summary).toContainText("Senior citizen (60–79)");
    await expect(summary).not.toContainText(/comparison was not reliable/i);
    await expect(summary).not.toContainText(/not blocked solely for age/i);
  });

  test("K4-05: resident super-senior selecting the OLD regime ALSO succeeds now", async ({ page }) => {
    await page.goto(`/tax-desk/cases/${superSeniorTaxCaseId}/review`);
    await page.getByRole("button", { name: "Prepare review pack" }).click();
    await reconcileForFreshUi(page, "Review pack prepared ✓");

    await page.getByLabel("Old regime").check();
    await page.getByRole("button", { name: "Generate manifest" }).click();
    await reconcileForFreshUi(page, "Evidence manifest generated ✓");
    await expect(page.getByTestId("evidence-manifest-summary")).toContainText("OLD regime");
  });

  test("Filing Readiness no longer shows the pre-approval comparison-reliability caveat for the resident senior (K4-05)", async ({
    page,
  }) => {
    await page.goto(`/tax-desk/cases/${seniorTaxCaseId}/readiness`);
    await expect(page.getByText(/automatic old-vs-new regime comparison.*cannot be relied upon/i)).toHaveCount(0);
  });

  test("Filing Readiness shows the selected-regime item passed for the senior's NEW-regime manifest", async ({
    page,
  }) => {
    await page.goto(`/tax-desk/cases/${seniorTaxCaseId}/readiness`);
    // Passed items are collapsed behind a <details>/<summary> disclosure.
    await page.getByTestId("passed-checks").click();
    await expect(page.getByText("Selected-regime senior/super-senior treatment supported")).toBeVisible();
    await expect(page.getByText(/selected regime is not blocked by senior\/super-senior treatment/i)).toBeVisible();
  });

  test("Filing Readiness shows the selected-regime item passed for the super-senior's OLD-regime manifest too (K4-05)", async ({
    page,
  }) => {
    await page.goto(`/tax-desk/cases/${superSeniorTaxCaseId}/readiness`);
    await page.getByTestId("passed-checks").click();
    await expect(page.getByText("Selected-regime senior/super-senior treatment supported")).toBeVisible();
    await expect(page.getByText(/selected regime is not blocked by senior\/super-senior treatment/i)).toBeVisible();
  });

  test("Filing Readiness does not show the senior comparison caveat for the below-60 control", async ({ page }) => {
    await page.goto(`/tax-desk/cases/${controlTaxCaseId}/readiness`);
    await expect(page.getByText(/automatic old-vs-new regime comparison.*cannot be relied upon/i)).toHaveCount(0);
  });
});
