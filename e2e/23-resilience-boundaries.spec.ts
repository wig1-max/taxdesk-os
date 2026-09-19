import { expect, test, type Page } from "@playwright/test";
import { warmTaxDeskOnce } from "./warm";
import { ADMIN_STORAGE_STATE } from "./lib/auth-state";
import { seedTaxCase } from "./lib/fixtures";

/**
 * Phase K.2.9.7 — route/task resilience boundaries.
 *
 * Root cause closed here: a thrown error on a tax-desk route had NO recovery
 * boundary, so a single failing server component / query crashed the whole view
 * instead of degrading gracefully. These specs force a task screen (Ledgers) to
 * throw via the production-inert fault seam (`src/lib/telemetry/fault-injection.ts`)
 * and prove:
 *   - the task-level `error.tsx` boundary renders the recovery card,
 *   - the case shell ABOVE it (header/rail) survives — no full crash,
 *   - the retry control is a real ≥44×44 target and a safe "back" link exists,
 *   - NO error internals / synthetic PII leak into the recovery DOM,
 *   - the boundary fires a server action (durable telemetry seam), and
 *   - `reset()` recovers to the real screen once the fault clears.
 *
 * Fault triggers are dev/test-only and inert in production. Mirrors of the
 * server-only constants (can't import a `server-only` module into a node test):
 */
const FAULT_COOKIE = "taxdesk_e2e_fault"; // src/lib/telemetry/fault-injection.ts FAULT_COOKIE
const FAULT_SENTINEL = "TAXDESK_FAULT_INJECTION_SENTINEL"; // FAULT_SENTINEL
const SYNTHETIC_PAN = "ABCDE1234F"; // embedded in the injected error message
const MIN = 44;
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/** Remove the Next.js dev error overlay so the boundary card is interactable. */
async function dismissDevOverlay(page: Page) {
  await page.evaluate(() => {
    document.querySelectorAll("nextjs-portal").forEach((el) => el.remove());
  });
}

test.describe("Resilience boundaries (K.2.9.7)", () => {
  test.use({ storageState: ADMIN_STORAGE_STATE });

// OPS-11 (ZCode): per-spec route warming. Compile this shard's own Tax Desk
// sub-routes here, in an untimed beforeAll, instead of every shard compiling
// all of them in setup. Static routes stay warmed in setup; see e2e/warm.ts.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await warmTaxDeskOnce(browser);
});

  test("a thrown task screen degrades to a recovery card while the shell survives — no PII leak", async ({
    page,
  }) => {
    const seeded = await seedTaxCase({
      income: [{ income_head: "salary", amount: 800000, source_type: "Form16" }],
    });

    // A server action POST (the durable telemetry call) must fire from the
    // boundary's mount effect. Arm the wait BEFORE navigating.
    const telemetryCall = page
      .waitForRequest(
        (req) => req.method() === "POST" && req.headers()["next-action"] !== undefined,
        { timeout: 15_000 },
      )
      .catch(() => null);

    // Force the Ledgers task screen to throw via the search-param trigger.
    await page.goto(`/tax-desk/cases/${seeded.taxCaseId}/ledgers?__fault=throw`);
    await dismissDevOverlay(page);

    // The task-level boundary renders, with a real accessible name.
    const card = page.getByTestId("tax-case-task-error");
    await expect(card).toBeVisible();
    await expect(
      page.getByRole("alert", { name: "This task screen couldn't load" }),
    ).toBeVisible();

    // The case shell ABOVE the boundary survived — the header client name + the
    // finalized/outcome anchor are still on screen (no white-screen crash).
    await expect(page.getByRole("heading", { name: seeded.clientName })).toBeVisible();
    await expect(page.getByTestId("financial-outcome")).toBeVisible();

    // No error internals or synthetic PII leaked into the recovery DOM.
    const cardText = (await card.textContent()) ?? "";
    expect(cardText).not.toContain(FAULT_SENTINEL);
    expect(cardText).not.toContain(SYNTHETIC_PAN);
    expect(cardText).not.toMatch(/\bat\s+.+\(.+:\d+:\d+\)/); // no stack frame

    // Retry is a real ≥44×44 touch target; a safe "back" link exists.
    const retry = card.getByTestId("error-recovery-retry");
    await expect(retry).toBeVisible();
    const box = await retry.boundingBox();
    expect(box).not.toBeNull();
    expect.soft(box!.width, "retry width").toBeGreaterThanOrEqual(MIN);
    expect.soft(box!.height, "retry height").toBeGreaterThanOrEqual(MIN);
    const back = card.getByRole("link", { name: "Case overview" });
    await expect(back).toHaveAttribute("href", `/tax-desk/cases/${seeded.taxCaseId}`);

    // Proof artifact of the rendered recovery UI (stable path, not reporter-wiped).
    await card.screenshot({ path: "test-results/phase7-recovery-card.png" });

    // The boundary invoked the durable telemetry server action.
    expect(await telemetryCall, "boundary fired a telemetry server action").not.toBeNull();
  });

  test("reset() recovers to the real screen once the fault clears", async ({ page, context }) => {
    const seeded = await seedTaxCase({
      income: [{ income_head: "salary", amount: 500000, source_type: "Form16" }],
    });

    // Cookie-driven fault → deterministic transient recovery: set it, render
    // (throws → boundary), clear it, then reset() re-renders clean.
    await context.addCookies([{ name: FAULT_COOKIE, value: "1", url: BASE }]);
    await page.goto(`/tax-desk/cases/${seeded.taxCaseId}/ledgers`);
    await dismissDevOverlay(page);

    const card = page.getByTestId("tax-case-task-error");
    await expect(card).toBeVisible();

    // Clear the fault, then retry — reset() refetches the segment, the cookie is
    // gone, and the real Ledgers screen renders.
    await context.clearCookies({ name: FAULT_COOKIE });
    await card.getByTestId("error-recovery-retry").click();

    await expect(page.getByRole("heading", { name: /Ledgers —/ })).toBeVisible();
    await expect(page.getByTestId("tax-case-task-error")).toHaveCount(0);
  });

  test("the app shell stays navigable from a boundary — the safe back link works", async ({
    page,
  }) => {
    const seeded = await seedTaxCase();
    await page.goto(`/tax-desk/cases/${seeded.taxCaseId}/ledgers?__fault=throw`);
    await dismissDevOverlay(page);

    const card = page.getByTestId("tax-case-task-error");
    await expect(card).toBeVisible();

    // Following the safe path back reaches a working case route (shell intact).
    await card.getByRole("link", { name: "Case overview" }).click();
    await expect(page).toHaveURL(new RegExp(`/tax-desk/cases/${seeded.taxCaseId}$`));
    await expect(page.getByRole("heading", { name: seeded.clientName })).toBeVisible();
  });
});
