import { expect, test } from "@playwright/test";
import { FAKE_EXE, RUN, VALID_PNG, createCase, createClient, login } from "./helpers";

/**
 * Full upload-link lifecycle: staff creates link -> client (fresh
 * unauthenticated context) uploads with consent -> staff reviews.
 */
test.describe("upload links & public upload route", () => {
  let uploadUrl = "";
  let caseId = "";

  test("staff generates an upload link (raw token shown once)", async ({ page }) => {
    await login(page);
    await createClient(page, { name: `E2E Upload ${RUN}`, phone: `96${RUN}01` });
    caseId = await createCase(page, {
      clientLabelPart: `E2E Upload ${RUN}`,
      service: "ITR Filing",
      fill: async (p) => p.getByLabel("Assessment year *").fill("2026-27"),
    });
    await page.goto(`/cases/${caseId}/documents`);
    await page.getByRole("button", { name: "Generate upload link" }).click();
    await expect(page.getByText(/copy it NOW/i)).toBeVisible();
    uploadUrl = (await page.locator("code").first().textContent()) ?? "";
    expect(uploadUrl).toMatch(/\/upload\/[A-Za-z0-9_-]{40,}/);
  });

  test("public page in unauthenticated context: consent gates upload", async ({ browser }) => {
    const ctx = await browser.newContext(); // no session cookies
    const page = await ctx.newPage();
    await page.goto(uploadUrl);

    await expect(page.getByText("Secure document upload")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Demo Tax Practice" })).toBeVisible();
    // No internal details leak: no case status, no PAN, no staff names
    expect(await page.locator("body").innerText()).not.toMatch(/pan_last4|owner|status_flow/i);

    // Upload button disabled until consent + file
    const submit = page.getByRole("button", { name: "Upload document" });
    await expect(submit).toBeDisabled();

    await page.getByLabel(/File \(PDF, JPG/).setInputFiles({
      name: "pan.png",
      mimeType: "image/png",
      buffer: VALID_PNG,
    });
    await expect(submit).toBeDisabled(); // still no consent
    await page.getByRole("checkbox").check();
    await expect(submit).toBeEnabled();
    await ctx.close();
  });

  test("fake .pdf with executable bytes is rejected (magic sniffing)", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(uploadUrl);
    await page.getByLabel(/File \(PDF, JPG/).setInputFiles({
      name: "innocent.pdf",
      mimeType: "application/pdf",
      buffer: FAKE_EXE,
    });
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Upload document" }).click();
    await expect(page.getByText(/Only PDF, JPG, PNG, WEBP or HEIC/i)).toBeVisible();
    await ctx.close();
  });

  test("valid PNG under the size limit is accepted", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(uploadUrl);
    await page.getByLabel(/File \(PDF, JPG/).setInputFiles({
      name: "pan-card.png",
      mimeType: "image/png",
      buffer: VALID_PNG,
    });
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Upload document" }).click();
    await expect(page.getByText(/Uploaded:/)).toBeVisible();
    await ctx.close();
  });

  test("uploaded file appears in review queue; staff verifies it", async ({ page }) => {
    await login(page);
    // Dashboard queue shows it
    await page.goto("/dashboard");
    await expect(
      page.locator("div", { hasText: "Uploads needing review" }).first()
    ).toContainText(/[1-9]/);

    // Case documents tab: verify flips file + checklist item
    await page.goto(`/cases/${caseId}/documents`);
    const fileRow = page.locator("tr", { hasText: "pan-card.png" }).first();
    await expect(fileRow.locator("td").nth(1)).toContainText("uploaded");
    await fileRow.getByRole("button", { name: "Verify" }).click();
    await expect(page.locator("tr", { hasText: "pan-card.png" }).first().locator("td").nth(1)).toContainText("verified");
  });

  test("revoked link stays revoked for the public", async ({ page, browser }) => {
    await login(page);
    await page.goto(`/cases/${caseId}/documents`);
    let revokeButtons = page.getByRole("button", { name: "Revoke" });
    while ((await revokeButtons.count()) > 0) {
      const before = await revokeButtons.count();
      await revokeButtons.first().click();
      await expect(page.getByRole("button", { name: "Revoke" })).toHaveCount(before - 1);
      revokeButtons = page.getByRole("button", { name: "Revoke" });
    }

    const ctx = await browser.newContext();
    const pub = await ctx.newPage();
    await pub.goto(uploadUrl);
    await expect(pub.getByText(/not active/i)).toBeVisible();
    await ctx.close();
  });
});
