import { expect, test } from "@playwright/test";
import { warmTaxDeskOnce } from "./warm";
import { ADMIN_STORAGE_STATE } from "./lib/auth-state";
import {
  seedTaxCase,
  seedReviewerCredential,
  clearReviewerCredential,
  setCasePreparer,
  getUserIdByRole,
  readManualReviewState,
  readCaseReviews,
} from "./lib/fixtures";
import { expectReconciled, reconcileForFreshUi } from "./lib/reconcile";

/**
 * Phase K.2.8.9B — Qualified-reviewer sign-off workflow. Proves the manual-review
 * track is visible and actionable in the UI: admins manage reviewer credentials,
 * a case routed to manual review surfaces why, a qualified reviewer records a
 * decision, the history is immutable, self-review is prevented, and — crucially —
 * an approval does NOT weaken the K.2.8.9A computation eligibility gate.
 *
 * Authenticated via the shared admin storage state. Fixtures seed directly
 * (service role, local-only).
 */
test.use({ storageState: ADMIN_STORAGE_STATE });

// OPS-11 (ZCode): per-spec route warming. Compile this shard's own Tax Desk
// sub-routes here, in an untimed beforeAll, instead of every shard compiling
// all of them in setup. Static routes stay warmed in setup; see e2e/warm.ts.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await warmTaxDeskOnce(browser, ["computation","manual-review"]);
});

const MEANINGFUL_INCOME = [{ income_head: "salary", amount: 800_000, source_type: "Form16" }];
const REVIEW_PROFILE = { declaredSituations: ["foreign_income_or_assets"] };

test.describe.serial("Tax Desk reviewer sign-off (K.2.8.9B)", () => {
  test("admin can grant a qualified-reviewer credential in Settings", async ({ page }) => {
    const staffId = await getUserIdByRole("staff");
    await clearReviewerCredential(staffId);

    await page.goto("/settings/reviewers");
    await expect(page.getByRole("heading", { name: /Qualified reviewers/i })).toBeVisible();
    await page.getByRole("button", { name: "Add reviewer" }).click();
    await page.getByTestId("credential-user-select").selectOption({ label: "E2E Staff · staff" });
    await page.getByRole("button", { name: "Save credential" }).click();

    const row = page.getByTestId("credential-row").filter({ hasText: "E2E Staff" });
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute("data-status", "active");

    await clearReviewerCredential(staffId);
  });

  test("a manual-review case surfaces the reason + a shell affordance", async ({ page }) => {
    const c = await seedTaxCase({ itrTypeSelected: "ITR-1", income: MEANINGFUL_INCOME, profile: REVIEW_PROFILE });

    // The shell shows a manual-review link on every case route.
    await page.goto(`/tax-desk/cases/${c.taxCaseId}/computation`);
    await expect(page.getByTestId("manual-review-link")).toBeVisible();

    await page.goto(`/tax-desk/cases/${c.taxCaseId}/manual-review`);
    await expect(page.getByRole("heading", { name: /Manual professional review/i })).toBeVisible();
    await expect(
      page.getByTestId("review-reasons").locator('[data-blocker-code="MANUAL_PROFESSIONAL_REVIEW_REQUIRED"]'),
    ).toBeVisible();
    await expect(page.getByTestId("manual-review-panel")).toBeVisible();
    // K.2.9.4 status-copy: the "why" callout distinguishes concept 2 (routed to
    // manual professional PREPARATION, out of engine scope) from concept 3 (a
    // credentialed qualified reviewer must record a sign-off decision). The
    // concept-2 wording appears in both the callout and the blocker list.
    await expect(page.getByText(/manual professional preparation/i).first()).toBeVisible();
    await expect(page.getByText(/credentialed qualified reviewer/i)).toBeVisible();
    await expect(page.getByText(/sign-off decision/i)).toBeVisible();
  });

  test("a qualified reviewer approves for progression; history is immutable; 9A is NOT weakened", async ({ page }) => {
    const adminId = await getUserIdByRole("admin");
    await seedReviewerCredential(adminId); // admin becomes an active reviewer
    // No preparer attribution on this case, so the admin reviewer is not the preparer.
    const c = await seedTaxCase({ itrTypeSelected: "ITR-1", income: MEANINGFUL_INCOME, profile: REVIEW_PROFILE });

    await page.goto(`/tax-desk/cases/${c.taxCaseId}/manual-review`);
    await expect(page.getByTestId("signoff-actions")).toBeVisible();
    await page.getByRole("button", { name: "Approve for progression" }).click();
    await page.getByRole("button", { name: "Confirm sign-off" }).click();
    await reconcileForFreshUi(page, "Sign-off recorded ✓");

    // History shows the approved decision.
    const historyRow = page.getByTestId("review-history").locator('[data-decision="approved_for_progression"]');
    await expect(historyRow).toBeVisible();

    const state = await readManualReviewState(c.taxCaseId);
    expect(state?.manual_review_status).toBe("approved");
    const reviews = await readCaseReviews(c.taxCaseId);
    expect(reviews[0]?.decision).toBe("approved_for_progression");
    expect(reviews[0]?.reviewer_qualification_snapshot).toBe("chartered_accountant");

    // 9A is NOT weakened: the computation gate still withholds output for the
    // unsupported case even after the reviewer approved manual handling.
    await page.goto(`/tax-desk/cases/${c.taxCaseId}/computation`);
    await expect(page.getByTestId("computation-withheld")).toBeVisible();
  });

  test("returning for changes requires a reason", async ({ page }) => {
    const adminId = await getUserIdByRole("admin");
    await seedReviewerCredential(adminId);
    const c = await seedTaxCase({ itrTypeSelected: "ITR-1", income: MEANINGFUL_INCOME, profile: REVIEW_PROFILE });

    await page.goto(`/tax-desk/cases/${c.taxCaseId}/manual-review`);
    await page.getByRole("button", { name: "Return / request changes" }).click();
    // Submitting with no reason is rejected server-side (button not disabled).
    await page.getByRole("button", { name: "Return case" }).click();
    await expect(page.getByText(/reason is required/i)).toBeVisible();

    await page.getByTestId("return-reason").fill("Confirm the foreign-asset schedule with the client.");
    await page.getByRole("button", { name: "Return case" }).click();
    await expectReconciled(page, "Case returned ✓");

    const state = await readManualReviewState(c.taxCaseId);
    expect(state?.manual_review_status).toBe("changes_requested");
  });

  test("self-review is prevented in the UI", async ({ page }) => {
    const adminId = await getUserIdByRole("admin");
    await seedReviewerCredential(adminId);
    const c = await seedTaxCase({ itrTypeSelected: "ITR-1", income: MEANINGFUL_INCOME, profile: REVIEW_PROFILE });
    await setCasePreparer(c.taxCaseId, adminId); // admin prepared it → cannot self-review

    await page.goto(`/tax-desk/cases/${c.taxCaseId}/manual-review`);
    await expect(page.getByTestId("signoff-actions")).toHaveCount(0);
    await expect(page.getByTestId("signoff-unavailable")).toContainText(/separation of duties/i);
  });

  test("a supported case shows no manual-review requirement", async ({ page }) => {
    const c = await seedTaxCase({ itrTypeSelected: "ITR-1", income: MEANINGFUL_INCOME });
    await page.goto(`/tax-desk/cases/${c.taxCaseId}/manual-review`);
    // K.2.9.4 status-copy: concept-3 wording — a supported case needs no
    // credentialed qualified-reviewer sign-off.
    await expect(page.getByText("No qualified-reviewer sign-off required")).toBeVisible();
    await expect(page.getByTestId("manual-review-panel")).toHaveCount(0);
  });
});
