import { expect, test } from "@playwright/test";
import { warmTaxDeskOnce } from "./warm";
import { ADMIN_STORAGE_STATE } from "./lib/auth-state";
import { readReviewState, readSnapshots, seedTaxCase } from "./lib/fixtures";
import { expectReconciled } from "./lib/reconcile";

test.use({ storageState: ADMIN_STORAGE_STATE });

// OPS-11 (ZCode): per-spec route warming. Compile this shard's own Tax Desk
// sub-routes here, in an untimed beforeAll, instead of every shard compiling
// all of them in setup. Static routes stay warmed in setup; see e2e/warm.ts.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await warmTaxDeskOnce(browser);
});

const CONTRACT_VERSION = "TAX_SAFE_03.presumptive_activity_snapshot.v1";

let eligibleTaxCaseId = "";

test.describe.serial("TAX-SAFE-03 presumptive activity snapshot authority", () => {
  test.beforeAll(async () => {
    const eligible = await seedTaxCase({ itrTypeSelected: "ITR-4" });
    eligibleTaxCaseId = eligible.taxCaseId;
  });

  test("normal product path records eligible 44AD activity through the ledger UI", async ({ page }) => {
    await page.goto(`/tax-desk/cases/${eligibleTaxCaseId}/ledgers`);
    await page.getByRole("button", { name: "Add income entry" }).click();

    const drawer = page.getByTestId("ledger-drawer");
    await drawer.getByLabel("Income head").selectOption("presumptive_business_44ad_digital");
    await drawer.getByLabel("Amount").fill("1000000");
    await drawer.getByLabel("Activity this income arises from").selectOption("other_business");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await expect(page.getByText("Income entry added")).toBeVisible();
    await expect(drawer).toHaveCount(0);
    await expect(page.getByText("presumptive_business_44ad_digital").first()).toBeVisible();
  });

  test("normal product path saves the eligibility verdict and exact activity inputs in the snapshot", async ({
    page,
  }) => {
    await page.goto(`/tax-desk/cases/${eligibleTaxCaseId}/computation`);
    await expect(page.getByText(/Partial preview|Partial \/ incomplete preview/)).toHaveCount(0);

    const save = page.getByRole("button", { name: "Save snapshot" });
    await expect(save).toBeEnabled();
    await save.click();
    await expectReconciled(page, "Snapshot saved ✓");

    const snapshots = await readSnapshots(eligibleTaxCaseId);
    expect(snapshots).toHaveLength(1);
    const input = snapshots[0]!.input_snapshot as {
      engineInput?: {
        presumptiveActivityEligibility?: {
          version?: unknown;
          eligible?: unknown;
          rows?: Array<Record<string, unknown>>;
        };
      };
    };
    expect(input.engineInput?.presumptiveActivityEligibility).toEqual({
      version: CONTRACT_VERSION,
      eligible: true,
      rows: [
        expect.objectContaining({
          incomeHead: "presumptive_business_44ad_digital",
          amount: 1_000_000,
          activityType: "other_business",
          bankingChannelsConfirmed: false,
        }),
      ],
    });
  });

  test("the guarded review boundary accepts and binds the product-created snapshot", async ({ page }) => {
    await page.goto(`/tax-desk/cases/${eligibleTaxCaseId}/review`);
    await page.getByRole("button", { name: "Prepare review pack" }).click();
    await expectReconciled(page, "Review pack prepared ✓");

    const snapshots = await readSnapshots(eligibleTaxCaseId);
    const review = await readReviewState(eligibleTaxCaseId);
    expect(review?.client_review_status).toBe("prepared");
    expect(review?.client_review_snapshot_id).toBe(snapshots[0]!.id);
  });
});

test("an ineligible presumptive activity is refused before snapshot creation", async ({ page }) => {
  const refused = await seedTaxCase({
    itrTypeSelected: "ITR-4",
    income: [
      {
        income_head: "presumptive_business_44ad_digital",
        amount: 1_000_000,
        presumptive_activity_type: "commission_or_brokerage",
      },
    ],
  });

  await page.goto(`/tax-desk/cases/${refused.taxCaseId}/computation`);
  await expect(page.getByText(/Partial preview/)).toBeVisible();
  await expect(page.getByText(/PRESUMPTIVE_44AD_INELIGIBLE_ACTIVITY/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Save snapshot" })).toBeDisabled();
  const snapshots = await readSnapshots(refused.taxCaseId);
  expect(snapshots).toHaveLength(0);
});
