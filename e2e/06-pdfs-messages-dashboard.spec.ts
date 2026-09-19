import { expect, test } from "@playwright/test";
import { RUN, createCase, createClient, login } from "./helpers";

test.describe.serial("PDFs, messages & dashboard", () => {
  let caseId = "";

  test("setup: IEPF case with estimate", async ({ page }) => {
    await login(page);
    await createClient(page, { name: `E2E PdfMsg ${RUN}`, phone: `94${RUN}01` });
    caseId = await createCase(page, {
      clientLabelPart: `E2E PdfMsg ${RUN}`,
      service: "IEPF Claim Recovery",
      fill: async (p) => {
        await p.getByLabel("Company name *").fill("E2E PDF Industries Ltd");
        await p.getByLabel("Estimated claim value (Rs.)").fill("240000");
      },
    });
  });

  test("generate IEPF PDFs; fee agreement uses case fee data", async ({ page }) => {
    await login(page);
    await page.goto(`/cases/${caseId}/pdfs`);
    for (const name of [
      "IEPF Client Visit Checklist",
      "IEPF Authorization Letter",
      "IEPF Fee Agreement",
    ]) {
      await page.getByRole("button", { name }).click();
      await expect(page.getByText("PDF generated")).toBeVisible();
    }
    // ITR templates must NOT be offered on an IEPF case
    await expect(page.getByRole("button", { name: "ITR Computation Summary" })).toHaveCount(0);
    // History shows three rows with snapshot badges
    await expect(page.getByText(/v\d+ snapshot/).first()).toBeVisible();
  });

  test("download streams through the app route (never a signed/public URL)", async ({ page }) => {
    await login(page);
    await page.goto(`/cases/${caseId}/pdfs`);
    const href = await page.getByRole("link", { name: "Download" }).first().getAttribute("href");
    expect(href).toMatch(/^\/api\/pdfs\//); // app route, not a storage URL
    expect(href).not.toContain("supabase.co");

    const resp = await page.request.get(href!, { maxRedirects: 0 });
    expect(resp.status()).toBe(200); // streamed by the app, NOT a redirect
    expect(resp.headers()["location"]).toBeUndefined(); // no redirect to a signed URL
    expect(resp.headers()["content-type"]).toContain("application/pdf");

    const body = await resp.body();
    expect(body.subarray(0, 4).toString("latin1")).toBe("%PDF"); // real PDF bytes
  });

  test("message composer blocks copy while variables unresolved, then logs", async ({ page }) => {
    await login(page);
    await page.goto(`/cases/${caseId}/messages`);
    const options = await page.getByLabel("Template").locator("option").allTextContents();
    const upfront = options.find((o) => o.includes("Upfront fee request"));
    expect(upfront).toBeTruthy();
    await page.getByLabel("Template").selectOption({ label: upfront! });

    // 'amount' and 'payment_details' are intentionally not auto-filled
    await expect(page.getByText(/Unresolved variables/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Copy for WhatsApp/ })).toBeDisabled();

    await page.getByText("{{amount}}").locator("xpath=..").locator("input").fill("5,000");
    await page.getByText("{{payment_details}}").locator("xpath=..").locator("input").fill("UPI taxdesk@upi");
    await expect(page.getByRole("button", { name: /Copy for WhatsApp/ })).toBeEnabled();

    await page.getByRole("button", { name: /Copy for WhatsApp/ }).click();
    await expect(page.getByText("Copied to clipboard and logged.")).toBeVisible();
    await page.reload();
    await expect(page.getByText(/Message history/)).toBeVisible();
    await expect(page.locator("li", { hasText: "5,000" }).first()).toBeVisible();
  });

  test("audit log records pdf.generated, pdf.downloaded and message.copied", async ({ page }) => {
    await login(page);
    await page.goto("/audit-log?action=pdf");
    await expect(page.getByText("pdf.generated").first()).toBeVisible();
    await expect(page.getByText("pdf.downloaded").first()).toBeVisible();
    await page.goto("/audit-log?action=message.copied");
    await expect(page.getByText("message.copied").first()).toBeVisible();
  });

  test("dashboard queues reflect the run @mobile", async ({ page }) => {
    await login(page);
    await page.goto("/dashboard");
    await expect(page.getByText("What needs attention today?")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Documents pending from clients" })).toBeVisible();
    await expect(page.getByText("Recently updated")).toBeVisible();
  });
});
