import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

/**
 * Phase K.2.9.5 — the mobile navigation drawer is a real modal dialog.
 *
 * Root cause closed here: the drawer used to be a plain conditional <div> — no
 * role=dialog/aria-modal, no focus entry/trap, no Escape, no inert background,
 * no focus restoration. These specs pin the modal contract from the keyboard's
 * point of view at a phone viewport (390×844), and keep the (already clean)
 * no-horizontal-overflow invariant with the drawer both open and closed.
 *
 * Viewport is set explicitly per test so the assertions run deterministically
 * in the default chromium project (not only the @mobile project).
 */

const PHONE = { width: 390, height: 844 };

/** True when keyboard focus currently sits inside the open nav dialog. */
function focusInsideDialog(page: Page) {
  return page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
}

/**
 * Open the drawer with the keyboard, tolerating the pre-hydration window.
 * `useModalDialog` binds the trigger's handler through React, and
 * `page.keyboard.press` — unlike a locator click — has NO actionability wait, so
 * under a cold `next dev` an `Enter` can land before the handler is attached and
 * be silently lost (the same root cause as the `18-tax-desk-k287:100` flake).
 * Retry the press, but ONLY while the dialog is closed, so the trigger is never
 * touched while the background column is `inert`. This waits for real
 * interactivity and weakens no assertion — a genuinely broken open still fails
 * once the retries exhaust.
 */
async function openDrawerWithKeyboard(page: Page) {
  const trigger = page.getByRole("button", { name: "Open navigation" });
  const dialog = page.getByRole("dialog", { name: "Main navigation" });
  await expect(async () => {
    if (await dialog.isVisible()) return; // already open → handler is live
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

test.describe("Mobile nav drawer — modal a11y (K.2.9.5)", () => {
  test("opens as a labelled modal with focus moved inside, and the background is inert", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await login(page);

    const trigger = page.getByRole("button", { name: "Open navigation" });
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    // Open with the keyboard.
    await openDrawerWithKeyboard(page);

    const dialog = page.getByRole("dialog", { name: "Main navigation" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");

    // Focus moved into the dialog on open.
    await expect.poll(() => focusInsideDialog(page)).toBe(true);

    // Background content column is hidden from the a11y tree + non-focusable.
    const backgroundInert = await page.evaluate(
      () => document.querySelector("#main-content")?.closest("[inert]") !== null,
    );
    expect(backgroundInert).toBe(true);
  });

  test("traps Tab / Shift+Tab within the drawer (never reaches the page behind)", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await login(page);

    await openDrawerWithKeyboard(page);
    await expect(page.getByRole("dialog", { name: "Main navigation" })).toBeVisible();
    await expect.poll(() => focusInsideDialog(page)).toBe(true);

    // Forward cycle: many Tabs must never land outside the dialog.
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press("Tab");
      expect(await focusInsideDialog(page)).toBe(true);
    }
    // Reverse wrap from the first focusable stays inside too.
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Shift+Tab");
      expect(await focusInsideDialog(page)).toBe(true);
    }
  });

  test("Escape closes the drawer and restores focus to the trigger", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await login(page);

    const trigger = page.getByRole("button", { name: "Open navigation" });
    await openDrawerWithKeyboard(page);
    await expect(page.getByRole("dialog", { name: "Main navigation" })).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(page.getByRole("dialog", { name: "Main navigation" })).toBeHidden();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    // Focus is back on the trigger, so keyboard flow continues from where it began.
    await expect(trigger).toBeFocused();
    // Background is interactive again (inert removed).
    const stillInert = await page.evaluate(
      () => document.querySelector("#main-content")?.closest("[inert]") !== null,
    );
    expect(stillInert).toBe(false);
  });

  test("moving to desktop width closes an open mobile drawer", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await login(page);

    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByRole("dialog", { name: "Main navigation" })).toBeVisible();

    // `lg:hidden` would otherwise hide the panel while its focus trap, scroll
    // lock, and inert background remained active.
    await page.setViewportSize({ width: 1024, height: 844 });
    await expect(page.getByRole("dialog", { name: "Main navigation" })).toBeHidden();
    const stillInert = await page.evaluate(
      () => document.querySelector("#main-content")?.closest("[inert]") !== null,
    );
    expect(stillInert).toBe(false);
  });

  test("no horizontal overflow at 360 / 390 / 768 with the drawer closed or open", async ({
    page,
  }) => {
    await login(page);
    for (const width of [360, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/dashboard");
      await page.waitForLoadState("networkidle");

      // Closed.
      const closedOk = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 2,
      );
      expect(closedOk, `closed @${width}`).toBe(true);

      // Open.
      await page.getByRole("button", { name: "Open navigation" }).click();
      await expect(page.getByRole("dialog", { name: "Main navigation" })).toBeVisible();
      const openOk = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 2,
      );
      expect(openOk, `open @${width}`).toBe(true);

      await page.keyboard.press("Escape");
    }
  });
});
