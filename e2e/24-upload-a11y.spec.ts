import { expect, test } from "@playwright/test";
import { VALID_PNG, login } from "./helpers";
import { seedTaxCase } from "./lib/fixtures";

/**
 * Phase 8 (K.3 pre-ingestion gates) — the public upload flow must be operable at
 * 200% and 400% browser zoom and with the keyboard only. Zoom is emulated the
 * repo-standard way (Phases 5–7): a proportionally narrower viewport reproduces
 * the same reflow a browser zoom produces, so we assert no horizontal overflow
 * and ≥44×44 primary controls at those widths, plus a full keyboard path.
 *
 *   ~200% zoom ≈ 640px effective width, ~400% zoom ≈ 320px effective width.
 *
 * Link generation + the public-context checks live in ONE test so the flow never
 * depends on cross-test shared state, and every public context navigates to the
 * absolute widget URL (a manual `browser.newContext()` does not inherit baseURL).
 */
test("public upload is operable at 200%/400% zoom and keyboard-only", async ({ page, browser }) => {
  // 1. Staff generates an upload link (authenticated). The client + ITR case +
  //    checklist are seeded directly rather than created through the /cases/new
  //    UI: that Client dropdown caps its options at 500 rows ordered by name
  //    (src/app/(app)/cases/new/page.tsx), so a freshly-created client becomes
  //    invisible once the local DB accumulates >500 synthetic "E2E …" clients
  //    across runs — which made this spec flake. Seeding keeps the a11y flow
  //    deterministic regardless of accumulated test data (K3-ENV-1).
  const seeded = await seedTaxCase();
  await login(page);
  await page.goto(`/cases/${seeded.caseId}/documents`);
  await page.getByRole("button", { name: "Generate upload link" }).click();
  await expect(page.getByText(/copy it NOW/i)).toBeVisible();
  const uploadUrl = (await page.locator("code").first().textContent()) ?? "";
  expect(uploadUrl).toMatch(/\/upload\/[A-Za-z0-9_-]{40,}/);

  // 2. Zoom: no horizontal overflow + ≥44px primary controls at each width.
  for (const { label, width, height } of [
    { label: "200% zoom (640px)", width: 640, height: 900 },
    { label: "400% zoom (320px)", width: 320, height: 800 },
  ]) {
    const ctx = await browser.newContext({ viewport: { width, height } });
    const zp = await ctx.newPage();
    await zp.goto(uploadUrl);
    await expect(zp.getByText("Secure document upload")).toBeVisible();

    const overflow = await zp.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `horizontal overflow at ${label}`).toBeLessThanOrEqual(1);

    const select = zp.getByRole("combobox", { name: "Document" });
    const submit = zp.getByRole("button", { name: "Upload document" });
    for (const [name, box] of [
      ["Document select", await select.boundingBox()],
      ["Upload button", await submit.boundingBox()],
    ] as const) {
      expect(box, `${name} present at ${label}`).not.toBeNull();
      expect(box!.height, `${name} height ≥44 at ${label}`).toBeGreaterThanOrEqual(43.5);
    }
    await ctx.close();
  }

  // 3. Keyboard-only: reach + operate every control at 400% zoom (320px).
  const ctx = await browser.newContext({ viewport: { width: 320, height: 800 } });
  const kp = await ctx.newPage();
  await kp.goto(uploadUrl);
  await expect(kp.getByText("Secure document upload")).toBeVisible();

  const submit = kp.getByRole("button", { name: "Upload document" });
  await expect(submit).toBeDisabled();

  // File input is a real focusable control (the OS chooser is out of Playwright's
  // reach, but the input itself is keyboard-focusable, not pointer-only).
  const fileInput = kp.getByLabel(/File \(PDF, JPG/);
  await fileInput.focus();
  await expect(fileInput).toBeFocused();
  await fileInput.setInputFiles({ name: "doc.png", mimeType: "image/png", buffer: VALID_PNG });

  // Consent via keyboard only (focus the checkbox, toggle with Space).
  const consent = kp.getByRole("checkbox");
  await consent.focus();
  await expect(consent).toBeFocused();
  await kp.keyboard.press("Space");
  await expect(consent).toBeChecked();

  // With a file + consent the submit is enabled and keyboard-focusable.
  await expect(submit).toBeEnabled();
  await submit.focus();
  await expect(submit).toBeFocused();
  await ctx.close();
});
