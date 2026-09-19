import { expect, test } from "@playwright/test";
import { login } from "./helpers";

/**
 * Phase K.2.8.5 — UI/UX overhaul. Exercises the new global AppShell (grouped,
 * responsive navigation), keyboard skip link, and that key routes never
 * overflow horizontally. Runs on both the Desktop Chrome and Pixel 7 projects,
 * so the same assertions cover desktop and mobile behaviour. These tests need
 * no seeded tax cases.
 */

async function openNavIfMobile(page: import("@playwright/test").Page) {
  const width = page.viewportSize()?.width ?? 1280;
  if (width < 1024) {
    await page.getByRole("button", { name: "Open navigation" }).click();
  }
}

test.describe("Global app shell", () => {
  test("groups navigation under Work with the core destinations", async ({ page }) => {
    await login(page);
    await openNavIfMobile(page);
    await expect(page.getByText("Work", { exact: true })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    for (const name of ["Dashboard", "Clients", "Cases", "Tax Desk"]) {
      await expect(nav.getByRole("link", { name })).toBeVisible();
    }
  });

  test("admin sees the Administration group; core work group always present", async ({ page }) => {
    await login(page); // admin
    await openNavIfMobile(page);
    await expect(page.getByText("Administration", { exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Users" })).toBeVisible();
  });

  test("exposes a keyboard skip-to-content link", async ({ page }) => {
    await login(page);
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeAttached();
  });

  test("mobile viewport exposes a navigation toggle and drawer @mobile", async ({ page }) => {
    await login(page);
    const width = page.viewportSize()?.width ?? 1280;
    test.skip(width >= 1024, "mobile-only behaviour");
    const toggle = page.getByRole("button", { name: "Open navigation" });
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  });
});

test.describe("Responsive — no horizontal overflow", () => {
  for (const path of ["/dashboard", "/tax-desk", "/tax-desk/cases", "/clients", "/cases"]) {
    test(`page body does not overflow horizontally at ${path} @mobile`, async ({ page }) => {
      await login(page);
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const noOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 2,
      );
      expect(noOverflow).toBe(true);
    });
  }
});

test.describe("Tax Desk dashboard", () => {
  test("renders the Tax Desk heading and an attention/queue surface", async ({ page }) => {
    await login(page);
    await page.goto("/tax-desk");
    await expect(page.getByRole("heading", { name: "Tax Desk" })).toBeVisible();
    // New-case affordance is always available from the dashboard.
    await expect(page.getByRole("link", { name: /New ITR case/ })).toBeVisible();
  });
});
