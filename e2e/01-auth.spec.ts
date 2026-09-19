import { expect, test } from "@playwright/test";
import { ADMIN_EMAIL, STAFF_EMAIL, STAFF_PASSWORD, login } from "./helpers";

test.describe("auth & roles", () => {
  test("unauthenticated visitor is redirected to /login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("wrong password shows an error, no session", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(ADMIN_EMAIL);
    await page.getByLabel("Password").fill("definitely-wrong");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Invalid email or password.")).toBeVisible();
  });

  test("admin can sign in and reach the dashboard", async ({ page }) => {
    await login(page);
    await expect(page.getByText("What needs attention today?")).toBeVisible();
  });

  test("admin sees settings & audit log nav; sign out works", async ({ page }) => {
    await login(page);
    await expect(page.getByRole("link", { name: "Audit Log" })).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  // Always-run: the setup project bootstraps an active staff@e2e.test user, so
  // this proves staff authenticates AND receives staff (not admin) permissions.
  test("staff signs in with staff permissions, cannot open /settings or /audit-log", async ({ page }) => {
    await login(page, STAFF_EMAIL, STAFF_PASSWORD);
    // Staff dashboard has no admin-only nav.
    await expect(page.getByRole("link", { name: "Audit Log" })).toHaveCount(0);
    // requireAdmin redirects staff away from admin routes.
    await page.goto("/settings/templates");
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto("/audit-log");
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
