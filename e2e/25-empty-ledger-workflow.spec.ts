import { expect, test, type Page } from "@playwright/test";
import { warmTaxDeskOnce } from "./warm";
import { ADMIN_STORAGE_STATE } from "./lib/auth-state";
import { seedTaxCase, setRequiredDocs } from "./lib/fixtures";

/**
 * K3-00 readiness closeout — empty-ledger workflow correctness.
 *
 * An empty ledger has `liveComplete === true` only in the vacuous "no
 * unsupported rows" sense. Before this fix that made the data-entry stage read
 * green/complete and the next action recommend saving a computation snapshot as
 * though data existed. This spec proves the VISIBLE states:
 *   • an empty case is not visually complete and is told to enter data (never to
 *     compute); and
 *   • a populated, supported case still advances to computation.
 *
 * Required documents are satisfied in both cases so the surfaced next action
 * reflects the ledger/computation gate rather than the earlier documents gate.
 * "Save a computation snapshot" is the exact next-action phrase for a compute-
 * ready case; the empty case's blocking-issue list uses different wording
 * ("Save one in Computation first"), so asserting that exact phrase is absent is
 * unambiguous.
 */
test.use({ storageState: ADMIN_STORAGE_STATE });

// OPS-11 (ZCode): per-spec route warming. Compile this shard's own Tax Desk
// sub-routes here, in an untimed beforeAll, instead of every shard compiling
// all of them in setup. Static routes stay warmed in setup; see e2e/warm.ts.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await warmTaxDeskOnce(browser);
});

const rail = (page: Page) => page.getByRole("navigation", { name: "Tax Desk workbench" });

test.describe.serial("Empty-ledger workflow (K3-00)", () => {
  let emptyUrl = "";
  let populatedUrl = "";

  test.beforeAll(async () => {
    // Empty case: ITR selected + eligible profile, but ZERO ledger rows.
    const empty = await seedTaxCase({ itrTypeSelected: "ITR-1" });
    await setRequiredDocs(empty.caseId, "satisfied");
    emptyUrl = `/tax-desk/cases/${empty.taxCaseId}`;

    // Populated supported case: a real salary income + matching TDS.
    const populated = await seedTaxCase({
      itrTypeSelected: "ITR-1",
      income: [{ income_head: "salary", amount: 800000, source_type: "Form16" }],
      taxPaid: [{ tax_paid_type: "salary_tds", amount: 60000, source_type: "Form16" }],
    });
    await setRequiredDocs(populated.caseId, "satisfied");
    populatedUrl = `/tax-desk/cases/${populated.taxCaseId}`;
  });

  test("empty case is not visually complete and is told to enter data, never to compute", async ({ page }) => {
    await page.goto(emptyUrl);

    // Workflow rail: data-entry reads "No entries yet"; NOTHING reads as a
    // completion affirmative for entries.
    await expect(rail(page).getByText("No entries yet").first()).toBeVisible();
    await expect(rail(page).getByText("Entries complete")).toHaveCount(0);

    // The dominant next action routes to data entry…
    await expect(page.getByText("Enter income & tax data")).toBeVisible();
    // …and never recommends computing / saving a snapshot.
    await expect(page.getByText("Save a computation snapshot")).toHaveCount(0);
  });

  test("populated supported case advances: entries complete, next action = compute", async ({ page }) => {
    await page.goto(populatedUrl);

    // Data entry now reads a completion affirmative in the rail.
    await expect(rail(page).getByText("Entries complete").first()).toBeVisible();
    await expect(rail(page).getByText("No entries yet")).toHaveCount(0);

    // The next action now advances to computation.
    await expect(page.getByText("Save a computation snapshot")).toBeVisible();
    await expect(page.getByText("Enter income & tax data")).toHaveCount(0);
  });
});
