import { expect, test, type Locator, type Page } from "@playwright/test";
import { warmTaxDeskOnce } from "./warm";
import { ADMIN_STORAGE_STATE } from "./lib/auth-state";
import { seedTaxCase } from "./lib/fixtures";
import { reconcileForFreshUi } from "./lib/reconcile";

/**
 * K.2.8.7 — interaction & accessibility hardening. Covers:
 *   1. engine-derived unsupported count is consistent Ledgers ↔ Computation
 *   2. ledger tablist keyboard navigation (arrows / Home / End / roving tabindex)
 *   3. toast success feedback for a ledger mutation
 *   4. toast live-region semantics (role=status)
 *   5. no duplicate drawer error (field error stays inline, not also a toast)
 *   6. focus restoration after a drawer closes
 *   7. mobile toast placement (does not sit under the sticky header / off screen)
 */
test.use({ storageState: ADMIN_STORAGE_STATE });

// OPS-11 (ZCode): per-spec route warming. Compile this shard's own Tax Desk
// sub-routes here, in an untimed beforeAll, instead of every shard compiling
// all of them in setup. Static routes stay warmed in setup; see e2e/warm.ts.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await warmTaxDeskOnce(browser);
});

const tab = (page: Page, name: RegExp | string): Locator => page.getByRole("tab", { name });
const drawer = (page: Page): Locator => page.getByTestId("ledger-drawer");

// A case with two engine-unsupported income entries (house_property +
// business_income) plus a supported salary → unsupported count = 2.
async function seedUnsupportedCase() {
  return seedTaxCase({
    itrTypeSelected: "ITR-1",
    income: [
      { income_head: "salary", amount: 800000, source_type: "Form16" },
      { income_head: "house_property", amount: 120000, source_type: "manual" },
      { income_head: "business_income", amount: 300000, source_type: "manual" },
    ],
  });
}

test.describe.serial("K.2.8.7 interaction & accessibility", () => {
  test("unsupported count is engine-derived and consistent across Ledgers and Computation", async ({ page }) => {
    const c = await seedUnsupportedCase();
    const base = `/tax-desk/cases/${c.taxCaseId}`;

    // Ledgers: the shared classifier reports 2 needing manual tax treatment.
    await page.goto(`${base}/ledgers`);
    const summary = page.getByTestId("ledger-support-summary");
    await expect(summary).toBeVisible();
    await expect(summary).toHaveAttribute("data-unsupported-count", "2");
    await expect(summary).toContainText(/2 entries need manual tax treatment/i);
    // The Income tab badge shows the per-category count (both live under Income).
    await expect(tab(page, /Income/)).toContainText(/2 manual/i);

    // Completeness guard: the shell anchor must NOT show a balance — it shows an
    // incomplete-preview state with the count and "No reliable balance available".
    const anchor = page.getByTestId("financial-outcome");
    await expect(anchor).toHaveAttribute("data-outcome-kind", "incomplete");
    await expect(anchor).toContainText("—");
    await expect(anchor).toContainText(/entries need manual treatment/i);
    await expect(anchor).toContainText(/No reliable balance available/i);

    // Computation: the SAME authority (buildEngineInput) → same wording/count,
    // and the outcome hero is likewise incomplete (no refund/payable/nil).
    await page.goto(`${base}/computation`);
    await expect(page.getByText(/2 entries need manual tax treatment/i).first()).toBeVisible();
    const hero = page.getByTestId("computation-outcome");
    await expect(hero).toHaveAttribute("data-outcome-kind", "incomplete");
    await expect(hero).toContainText(/Incomplete preview/i);
    await expect(hero).toContainText("—");
    await expect(hero).not.toContainText(/Expected refund|Tax payable|Nil balance/i);

    // Recommendation guard: no regime recommendation, no REC badge/highlight, no
    // recommended ITR — but the SELECTED ITR (a user fact) stays visible.
    await expect(page.getByText(/Partial regime comparison — supported entries only/i)).toBeVisible();
    await expect(page.getByText(/No regime recommendation is available until all manual-treatment entries/i)).toBeVisible();
    await expect(page.getByTestId("regime-comparison").getByText("Rec", { exact: true })).toHaveCount(0);
    await expect(hero).toContainText(/ITR recommendation unavailable until manual-treatment entries are resolved/i);
    await expect(hero).toContainText(/Selected ITR ITR-1/);
    await expect(hero).not.toContainText(/recommended ITR-/i);
    await expect(page.getByText(/ITR recommendation unavailable until manual-treatment entries are resolved/i).first()).toBeVisible();
  });

  test("a fully-supported case shows the positive engine-support state", async ({ page }) => {
    const c = await seedTaxCase({
      itrTypeSelected: "ITR-1",
      income: [{ income_head: "salary", amount: 800000, source_type: "Form16" }],
      taxPaid: [{ tax_paid_type: "salary_tds", amount: 60000, source_type: "Form16" }],
    });
    await page.goto(`/tax-desk/cases/${c.taxCaseId}/ledgers`);
    const summary = page.getByTestId("ledger-support-summary");
    await expect(summary).toHaveAttribute("data-unsupported-count", "0");
    await expect(summary).toContainText(/All entries are supported by the current tax engine/i);
    // No per-tab manual badge anywhere.
    await expect(page.getByText(/manual$/i)).toHaveCount(0);

    // A complete case shows a real balance in the shell anchor (not incomplete).
    await expect(page.getByTestId("financial-outcome")).not.toHaveAttribute("data-outcome-kind", "incomplete");

    // …and Computation restores the regime + ITR recommendation (REC badge shown).
    await page.goto(`/tax-desk/cases/${c.taxCaseId}/computation`);
    await expect(page.getByText("Regime comparison", { exact: true })).toBeVisible();
    await expect(page.getByText(/Partial regime comparison/i)).toHaveCount(0);
    await expect(page.getByTestId("regime-comparison").getByText("Rec", { exact: true })).not.toHaveCount(0);
    await expect(page.getByTestId("computation-outcome")).toContainText(/recommended ITR-1/i);
  });

  test("ledger category tablist is keyboard-navigable with a roving tabindex", async ({ page }) => {
    const c = await seedTaxCase({ itrTypeSelected: "ITR-1", income: [{ income_head: "salary", amount: 800000, source_type: "Form16" }] });
    await page.goto(`/tax-desk/cases/${c.taxCaseId}/ledgers`);

    const income = tab(page, /Income/);
    const taxPaid = tab(page, /Tax Paid/);
    // The LAST tab is DERIVED from the tablist, never named.
    //
    // This assertion has now been broken twice by a session simply appending a
    // ledger category: `K4-06` added House Property (and re-pointed these
    // assertions from Capital Gains), and `K4-10` added Brought-forward Losses.
    // Naming the last tab encodes the length of a list this spec does not own,
    // so the third occurrence was going to happen too. Deriving it asserts the
    // real contract — wrap/Home/End reach the tablist's own last tab — and is
    // indifferent to how many categories exist.
    const lastTab = page.getByRole("tablist", { name: "Ledger category" }).getByRole("tab").last();

    // Hydration gate: `useRovingTabList` attaches its `onKeyDown` in React, so
    // under cold `next dev` the SSR HTML can render the tabs (correct static
    // tabindex/aria-selected) a beat before the key handler is live. A one-shot
    // `keyboard.press` in that window is silently lost (unlike a click, it has
    // no actionability wait), which is the `18:100` flake. Probe with an
    // idempotent End→Home round-trip (short inner timeouts so it retries fast)
    // until the selection model responds, THEN run the deterministic sequence.
    // This waits for real interactivity — it weakens no assertion; a genuinely
    // broken handler still fails after the retries exhaust.
    await expect(async () => {
      await income.focus();
      await page.keyboard.press("End");
      await expect(lastTab).toHaveAttribute("aria-selected", "true", { timeout: 1_000 });
      await page.keyboard.press("Home");
      await expect(income).toHaveAttribute("aria-selected", "true", { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });

    // Focus the active (Income) tab; only it is in the Tab order (tabindex 0).
    await income.focus();
    await expect(income).toHaveAttribute("tabindex", "0");
    await expect(taxPaid).toHaveAttribute("tabindex", "-1");
    await expect(income).toHaveAttribute("aria-selected", "true");

    // ArrowRight → Tax Paid becomes selected + focused; roving tabindex moves.
    await page.keyboard.press("ArrowRight");
    await expect(taxPaid).toHaveAttribute("aria-selected", "true");
    await expect(taxPaid).toBeFocused();
    await expect(taxPaid).toHaveAttribute("tabindex", "0");
    await expect(income).toHaveAttribute("tabindex", "-1");

    // ArrowLeft wraps/returns to Income.
    await page.keyboard.press("ArrowLeft");
    await expect(income).toHaveAttribute("aria-selected", "true");
    await expect(income).toBeFocused();

    // ArrowLeft from the first tab wraps to the last, whichever that is.
    await page.keyboard.press("ArrowLeft");
    await expect(lastTab).toHaveAttribute("aria-selected", "true");
    await expect(lastTab).toBeFocused();

    // Home → first, End → last.
    await page.keyboard.press("Home");
    await expect(income).toBeFocused();
    await page.keyboard.press("End");
    await expect(lastTab).toBeFocused();

    // The active tab controls the visible panel — asserted through the tab's
    // OWN `aria-controls`, which is the actual contract, rather than through a
    // hard-coded region name that changes whenever the last category does.
    const controlledPanelId = await lastTab.getAttribute("aria-controls");
    expect(controlledPanelId).toBeTruthy();
    await expect(page.locator(`#${controlledPanelId}`)).toBeVisible();
  });

  test("mouse activation still switches categories", async ({ page }) => {
    const c = await seedTaxCase({ itrTypeSelected: "ITR-1", income: [{ income_head: "salary", amount: 800000, source_type: "Form16" }] });
    await page.goto(`/tax-desk/cases/${c.taxCaseId}/ledgers`);
    await tab(page, /Deductions/).click();
    await expect(tab(page, /Deductions/)).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("region", { name: "Deductions" })).toBeVisible();
  });

  test("adding a ledger entry raises a success toast (role=status), then persists", async ({ page }) => {
    const c = await seedTaxCase({ itrTypeSelected: "ITR-1", income: [{ income_head: "salary", amount: 800000, source_type: "Form16" }] });
    await page.goto(`/tax-desk/cases/${c.taxCaseId}/ledgers`);
    await tab(page, /Tax Paid/).click();
    await page.getByRole("button", { name: "Add tax-paid entry" }).click();
    await drawer(page).locator('[name="tax_paid_type"]').selectOption("advance_tax");
    await drawer(page).locator('[name="amount"]').fill("5000");
    await page.getByRole("button", { name: "Save" }).click();

    const toast = page.getByRole("status").filter({ hasText: /Tax Paid entry added/i });
    await reconcileForFreshUi(page, toast);
    // The mutation actually landed.
    await expect(page.getByRole("region", { name: "Tax Paid" }).getByText("advance_tax", { exact: true })).toBeVisible();
  });

  test("a field-validation error stays inline in the drawer and is NOT duplicated as a toast", async ({ page }) => {
    const c = await seedTaxCase({ itrTypeSelected: "ITR-1", income: [{ income_head: "salary", amount: 800000, source_type: "Form16" }] });
    await page.goto(`/tax-desk/cases/${c.taxCaseId}/ledgers`);
    await page.getByRole("button", { name: "Add income entry" }).click();
    await drawer(page).locator('[name="amount"]').fill("1000");
    await drawer(page).locator('[name="notes"]').fill("client e-filing password is hunter2");
    await page.getByRole("button", { name: "Save" }).click();

    // The credential-screening error renders exactly once, in the drawer alert.
    await expect(drawer(page).getByRole("alert")).toContainText(/credential/i);
    await expect(page.getByText(/credential/i)).toHaveCount(1);
    // No success/error toast for a field error.
    await expect(page.getByRole("status")).toHaveCount(0);
  });

  test("focus returns to the trigger after the drawer closes", async ({ page }) => {
    const c = await seedTaxCase({ itrTypeSelected: "ITR-1", income: [{ income_head: "salary", amount: 800000, source_type: "Form16" }] });
    await page.goto(`/tax-desk/cases/${c.taxCaseId}/ledgers`);
    const addBtn = page.getByRole("button", { name: "Add income entry" });
    await addBtn.click();
    await expect(drawer(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer(page)).toBeHidden();
    await expect(addBtn).toBeFocused();
  });

  test("mobile: success toast is placed at the bottom, clear of the sticky header", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const c = await seedTaxCase({ itrTypeSelected: "ITR-1", income: [{ income_head: "salary", amount: 800000, source_type: "Form16" }] });
    await page.goto(`/tax-desk/cases/${c.taxCaseId}/ledgers`);
    await page.getByRole("button", { name: "Add income entry" }).click();
    await drawer(page).locator('[name="income_head"]').selectOption("dividend");
    await drawer(page).locator('[name="amount"]').fill("4000");
    await page.getByRole("button", { name: "Save" }).click();

    // STRUCTURALLY EXCLUDED from `D191`'s reconcile conversion (`MAINT-08`).
    // This test's SUBJECT is the toast's own geometry, so it cannot settle on
    // "toast OR unconfirmed notice" — the unconfirmed branch has no toast to
    // measure, and accepting it would leave the placement assertion unrun while
    // still reporting green. It therefore keeps the bare wait and keeps the
    // residual `MAINT-06` §8.2 exposure, deliberately and visibly.
    const toast = page.getByRole("status").filter({ hasText: /Income entry added/i });
    await expect(toast).toBeVisible();
    const box = await toast.boundingBox();
    expect(box).not.toBeNull();
    // Sits in the lower half of the viewport (not under the top sticky header).
    expect(box!.y).toBeGreaterThan(844 / 2);
    // Fully on-screen.
    expect(box!.y + box!.height).toBeLessThanOrEqual(844);
  });
});
