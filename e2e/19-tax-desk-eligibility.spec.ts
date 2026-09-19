import { expect, test, type Page } from "@playwright/test";
import { warmTaxDeskOnce } from "./warm";
import { ADMIN_STORAGE_STATE } from "./lib/auth-state";
import { seedTaxCase, readReadinessItems } from "./lib/fixtures";
import { expectReconciled, reconcileForFreshUi } from "./lib/reconcile";

/**
 * Phase K.2.8.9A — Computation eligibility gate. Proves the gate is visible and
 * actionable in the UI, that protected actions are withheld while ineligible,
 * that completing the profile flips the state, that a declared unsupported
 * situation routes to manual review, that the state survives a refresh, and that
 * the existing eligible simple-case workflow still works.
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
  await warmTaxDeskOnce(browser, ["computation","profile","readiness","review"]);
});

const MEANINGFUL_INCOME = [
  { income_head: "salary", amount: 800_000, source_type: "Form16" },
];

/**
 * Wait until React has actually HYDRATED the given element — not merely until
 * the page loaded.
 *
 * React attaches `__reactFiber$…` / `__reactProps$…` keys to every DOM node it
 * owns, so their presence is a precise "this node's handlers are live" signal.
 * Weaker markers were measured and rejected: `load` fires, and even
 * `next-route-announcer` appears, while the profile input still has no React
 * props attached. This reads a React internal deliberately — it is the only
 * accurate signal available, it is confined to test infrastructure, and if the
 * internal ever changes the gate fails loudly on timeout rather than silently
 * passing.
 */
async function waitForHydration(page: Page, selector: string) {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      return !!el && Object.keys(el).some((k) => k.startsWith("__reactFiber$"));
    },
    selector,
    { timeout: 15_000 },
  );
}

/**
 * Fill the taxpayer profile, tolerating the pre-hydration window (`K3-ENV-3`).
 *
 * `TaxpayerProfileForm` uses CONTROLLED inputs (`value={dob}` + `onChange`).
 * Under a cold `next dev`, `fill()` can land before React attaches its handler:
 * the DOM value is set, React state stays `""`, and the next re-render resets
 * the field to `""`. The save then legitimately persists an incomplete profile,
 * so `Profile saved ✓` fires (the reconciliation primitive is working — fresh
 * props really did land) while `profile-completeness` correctly stays `false`.
 * That is the exact signature that failed intermittently in the `K3-22` and
 * `K3-25` full-suite runs; it was reproduced deterministically by delaying the
 * JS chunks, and the product was confirmed CORRECT — the badge was telling the
 * truth about a profile whose date of birth never reached the server.
 *
 * Two layers, because either alone is insufficient: the hydration wait ensures
 * React owns the fields before anything is typed (a DOM-value re-read cannot
 * prove this — pre-hydration the DOM already holds the filled value), and the
 * retry re-asserts after the last field so a value discarded by a mid-sequence
 * re-render is re-entered. It waits for real interactivity and weakens no
 * assertion — a form that genuinely cannot hold its values still fails once the
 * retries exhaust. Same convention as `openDrawerWithKeyboard` in
 * `21-mobile-nav-a11y` (decision D7 / `K3-ENV-2`).
 */
async function fillTaxpayerProfile(
  page: Page,
  { dob, residential, category }: { dob: string; residential: string; category: string },
) {
  await waitForHydration(page, "#tp-dob");
  const dobField = page.getByLabel("Date of birth");
  const residentialField = page.getByLabel("Residential status");
  const categoryField = page.getByLabel("Taxpayer category");

  await expect(async () => {
    await dobField.fill(dob);
    await residentialField.selectOption(residential);
    await categoryField.selectOption(category);
    // Re-read AFTER the last re-render: this is what catches a lost value.
    await expect(dobField).toHaveValue(dob, { timeout: 1_000 });
    await expect(residentialField).toHaveValue(residential, { timeout: 1_000 });
    await expect(categoryField).toHaveValue(category, { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

test.describe.serial("Tax Desk computation eligibility gate (K.2.8.9A)", () => {
  test("an ineligible case shows 'Not eligible' and withholds computation", async ({ page }) => {
    // Meaningful data present, but NO taxpayer profile → ineligible.
    const c = await seedTaxCase({ itrTypeSelected: "ITR-1", income: MEANINGFUL_INCOME, profile: null });

    await page.goto(`/tax-desk/cases/${c.taxCaseId}/computation`);
    await expect(page.getByText("Not eligible for computation yet")).toBeVisible();
    await expect(page.getByTestId("computation-withheld")).toBeVisible();

    // Blockers visible + actionable (profile fields).
    const blockers = page.getByTestId("eligibility-blockers");
    await expect(blockers).toBeVisible();
    await expect(blockers.locator('[data-blocker-code="PROFILE_DOB_MISSING"]')).toBeVisible();
    await expect(blockers.locator('[data-blocker-code="PROFILE_RESIDENTIAL_STATUS_MISSING"]')).toBeVisible();
    await expect(blockers.locator('[data-blocker-code="PROFILE_CATEGORY_MISSING"]')).toBeVisible();

    // The snapshot action is withheld entirely (no Save snapshot control).
    await expect(page.getByRole("button", { name: "Save snapshot" })).toHaveCount(0);

    // The withheld state survives a page refresh (derived from persisted data).
    await page.reload();
    await expect(page.getByTestId("computation-withheld")).toBeVisible();
  });

  test("completing the profile flips the case to eligible and enables computation", async ({ page }) => {
    const c = await seedTaxCase({ itrTypeSelected: "ITR-1", income: MEANINGFUL_INCOME, profile: null });

    await page.goto(`/tax-desk/cases/${c.taxCaseId}/profile`);
    await expect(page.getByTestId("profile-completeness")).toHaveAttribute("data-complete", "false");

    await fillTaxpayerProfile(page, {
      dob: "1990-05-05",
      residential: "resident",
      category: "individual",
    });
    await page.getByRole("button", { name: "Save profile" }).click();
    await reconcileForFreshUi(page, "Profile saved ✓");
    await expect(page.getByTestId("profile-completeness")).toHaveAttribute("data-complete", "true");

    // Computation is now available.
    await page.goto(`/tax-desk/cases/${c.taxCaseId}/computation`);
    await expect(page.getByTestId("computation-withheld")).toHaveCount(0);
    await expect(page.getByTestId("computation-outcome")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save snapshot" })).toBeEnabled();
  });

  test("profile with no meaningful ledger data is still ineligible (data-presence gate)", async ({ page }) => {
    // Full eligible profile, but NO income/tax entries → NO_MEANINGFUL_DATA.
    const c = await seedTaxCase({ itrTypeSelected: "ITR-1" });

    await page.goto(`/tax-desk/cases/${c.taxCaseId}/computation`);
    await expect(page.getByText("Not eligible for computation yet")).toBeVisible();
    await expect(
      page.getByTestId("eligibility-blockers").locator('[data-blocker-code="NO_MEANINGFUL_DATA"]'),
    ).toBeVisible();
  });

  test("declaring an unsupported situation routes the case to manual professional review", async ({ page }) => {
    const c = await seedTaxCase({ itrTypeSelected: "ITR-1", income: MEANINGFUL_INCOME });

    // Eligible to start.
    await page.goto(`/tax-desk/cases/${c.taxCaseId}/computation`);
    await expect(page.getByTestId("computation-outcome")).toBeVisible();

    // Declare foreign income/assets on the profile.
    await page.goto(`/tax-desk/cases/${c.taxCaseId}/profile`);
    // Same controlled-input exposure as `fillTaxpayerProfile` (`K3-ENV-3`):
    // `checked={situations.has(code)}` is React state, so a pre-hydration check
    // is discarded on the next re-render and the save would persist nothing.
    await waitForHydration(page, "#tp-dob");
    const foreign = page.getByRole("checkbox", { name: /foreign income or foreign assets/i });
    await expect(async () => {
      await foreign.check();
      await expect(foreign).toBeChecked({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await page.getByRole("button", { name: "Save profile" }).click();
    await expectReconciled(page, "Profile saved ✓");

    // Computation is now withheld with a manual-review blocker.
    await page.goto(`/tax-desk/cases/${c.taxCaseId}/computation`);
    await expect(page.getByTestId("computation-withheld")).toBeVisible();
    const situationBlocker = page
      .getByTestId("eligibility-blockers")
      .locator('[data-blocker-code="MANUAL_PROFESSIONAL_REVIEW_REQUIRED"]');
    await expect(situationBlocker).toBeVisible();
    // K.2.9.4 status-copy: the eligibility gate (concept 2) is worded as "manual
    // professional preparation" (out-of-scope routing) — distinct from the
    // universal review policy and the credentialed reviewer sign-off.
    await expect(situationBlocker).toContainText(/manual professional preparation/i);
    await expect(situationBlocker).not.toContainText(/manual professional review/i);

    // Readiness reflects the eligibility blocker and cannot finalize (the
    // finalize control is present but disabled). Persist the checks, then confirm
    // the eligibility item is a stored blocking row.
    await page.goto(`/tax-desk/cases/${c.taxCaseId}/readiness`);
    await expect(page.getByRole("button", { name: "Finalize internal preparation" })).toBeDisabled();
    await expect(
      page.getByTestId("readiness-blocker").filter({ hasText: "Eligible for computation" }),
    ).toBeVisible();
    await page.getByRole("button", { name: /readiness/i }).first().click();
    await expectReconciled(page, "Readiness checks saved ✓");
    const items = await readReadinessItems(c.taxCaseId);
    const elig = items.find((i) => i.code === "eligibility.case_eligible");
    expect(elig?.status).toBe("blocked");
  });

  test("client review is withheld while ineligible", async ({ page }) => {
    const c = await seedTaxCase({ itrTypeSelected: "ITR-1", income: MEANINGFUL_INCOME, profile: null });
    await page.goto(`/tax-desk/cases/${c.taxCaseId}/review`);
    await expect(page.getByTestId("review-ineligible")).toBeVisible();
    await expect(page.getByText("Not eligible for computation yet")).toBeVisible();
  });

  test("an eligible simple case still renders the full computation workflow (regression)", async ({ page }) => {
    const c = await seedTaxCase({
      itrTypeSelected: "ITR-1",
      income: [
        { income_head: "salary", amount: 800_000, source_type: "Form16" },
        { income_head: "fd_interest", amount: 20_000, source_type: "AIS" },
      ],
      taxPaid: [{ tax_paid_type: "salary_tds", amount: 60_000, source_type: "Form16" }],
      deductions: [{ deduction_type: "80C", amount: 150_000 }],
    });

    await page.goto(`/tax-desk/cases/${c.taxCaseId}/computation`);
    await expect(page.getByTestId("computation-withheld")).toHaveCount(0);
    await expect(page.getByTestId("computation-outcome")).toBeVisible();
    await expect(page.getByTestId("regime-comparison")).toBeVisible();
    // The compact eligible banner does not shout on an eligible case.
    await expect(page.getByText("Not eligible for computation yet")).toHaveCount(0);
  });
});
