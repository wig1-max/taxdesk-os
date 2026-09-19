import { expect, test, type Locator } from "@playwright/test";
import { warmTaxDeskOnce } from "./warm";
import { ADMIN_STORAGE_STATE, STAFF_STORAGE_STATE } from "./lib/auth-state";
import {
  clearReviewerCredential,
  getUserIdByRole,
  seedReviewerCredential,
  seedTaxCase,
} from "./lib/fixtures";

/**
 * Phase K.2.9.6 — touch targets & accessible names.
 *
 * Root cause closed here (P2 from the QA verdict): several primary/destructive
 * controls rendered below the 44×44 CSS-px minimum touch target, a few
 * actionable controls had no real accessible name, and the Administration nav
 * omitted a Reviewers destination admins need.
 *
 * These specs MEASURE the rendered box of each named control via
 * `boundingBox()` and assert ≥44×44, confirm the accessible names via the a11y
 * tree (getByRole name), and pin the admin-only Reviewers nav link.
 *
 * Copy-and-a11y-attribute-only: no lifecycle/guard/reconciliation/DB behaviour
 * changed, so this file only reads the DOM (plus one seeded reviewer credential
 * that it cleans up).
 */

const MIN = 44;

/** Assert a locator's rendered box is at least the 44×44 CSS-px touch target. */
async function expectTouchTarget(locator: Locator, label: string) {
  await expect(locator, `${label} visible`).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} has a box`).not.toBeNull();
  expect.soft(box!.width, `${label} width`).toBeGreaterThanOrEqual(MIN);
  expect.soft(box!.height, `${label} height`).toBeGreaterThanOrEqual(MIN);
  return box!;
}

test.describe("Touch targets & accessible names (K.2.9.6)", () => {
  test.use({ storageState: ADMIN_STORAGE_STATE });

// OPS-11 (ZCode): per-spec route warming. Compile this shard's own Tax Desk
// sub-routes here, in an untimed beforeAll, instead of every shard compiling
// all of them in setup. Static routes stay warmed in setup; see e2e/warm.ts.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await warmTaxDeskOnce(browser);
});

  test("mobile nav trigger is a ≥44×44 touch target with an accessible name", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboard");

    // The accessible name is the a11y-tree proof; the box is the size proof.
    const trigger = page.getByRole("button", { name: "Open navigation" });
    const box = await expectTouchTarget(trigger, "Open navigation trigger");
    console.log(`nav trigger: ${box.width}×${box.height}`);

    // Phase-5 modal wiring must not be regressed by the resize.
    await expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    // No horizontal overflow reintroduced by the wider hit area.
    const noOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 2,
    );
    expect(noOverflow).toBe(true);
  });

  test("ledger edit/remove icon buttons are ≥44×44 with specific accessible names", async ({
    page,
  }) => {
    const seeded = await seedTaxCase({
      income: [{ income_head: "salary", amount: 800000, source_type: "Form16" }],
    });
    await page.goto(`/tax-desk/cases/${seeded.taxCaseId}/ledgers`);
    await expect(page.getByRole("heading", { name: /Ledgers —/ })).toBeVisible();

    // Names come from `aria-label={\`Edit/Remove ${title} entry\`}` — a real,
    // specific accessible name (not an icon alone).
    const edit = page.getByRole("button", { name: "Edit Income entry" });
    const remove = page.getByRole("button", { name: "Remove Income entry" });

    const editBox = await expectTouchTarget(edit, "ledger edit button");
    const removeBox = await expectTouchTarget(remove, "ledger remove button");
    console.log(
      `ledger edit: ${editBox.width}×${editBox.height} · remove: ${removeBox.width}×${removeBox.height}`,
    );
  });

  test("checklist status control exposes a real accessible name", async ({ page }) => {
    const seeded = await seedTaxCase();
    await page.goto(`/cases/${seeded.caseId}/documents`);

    // Previously the <select> had no accessible name at all. It now carries
    // `aria-label="Set status for <doc>"`, so it is reachable by name.
    const control = page.getByRole("combobox", { name: "Set status for PAN card" });
    await expect(control).toBeVisible();
  });

  test("Administration nav exposes Reviewers for an admin", async ({ page }) => {
    await page.goto("/dashboard");
    const nav = page.getByRole("navigation", { name: "Main navigation" }).first();
    const reviewers = nav.getByRole("link", { name: "Reviewers" });
    await expect(reviewers).toBeVisible();
    await expect(reviewers).toHaveAttribute("href", "/settings/reviewers");

    // The link actually reaches the existing admin reviewers route.
    await reviewers.click();
    await expect(page).toHaveURL(/\/settings\/reviewers$/);
    await expect(page.getByRole("heading", { name: /Qualified reviewers/i })).toBeVisible();
  });

  test("reviewer-admin row controls have specific accessible names", async ({ page }) => {
    const staffId = await getUserIdByRole("staff");
    await seedReviewerCredential(staffId); // active → Edit + Deactivate + Revoke render
    try {
      await page.goto("/settings/reviewers");
      const row = page.getByTestId("credential-row").first();
      await expect(row).toBeVisible();

      // Each per-row action is disambiguated by the reviewer's name, so a
      // screen reader hears "Edit <name>'s reviewer credential", not "Edit".
      await expect(
        row.getByRole("button", { name: /^Edit .+ reviewer credential$/ }),
      ).toBeVisible();
      await expect(
        row.getByRole("button", { name: /^(Deactivate|Activate) .+ reviewer credential$/ }),
      ).toBeVisible();
      await expect(
        row.getByRole("button", { name: /^Revoke .+ reviewer credential$/ }),
      ).toBeVisible();
    } finally {
      await clearReviewerCredential(staffId);
    }
  });
});

test.describe("Reviewers nav is admin-only (K.2.9.6)", () => {
  test.use({ storageState: STAFF_STORAGE_STATE });

  test("staff never see the Reviewers link or the Administration group", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("navigation", { name: "Main navigation" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Reviewers" })).toHaveCount(0);
    // The whole admin group is hidden for staff.
    await expect(page.getByText("Administration", { exact: true })).toHaveCount(0);
  });
});
