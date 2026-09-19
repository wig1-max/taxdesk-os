import { expect, test } from "@playwright/test";
import { RUN, createCase, createClient, login } from "./helpers";

test.describe("cases & checklist engine", () => {
  test("ITR case: creation instantiates the checklist automatically", async ({ page }) => {
    await login(page);
    await createClient(page, { name: `E2E Itr ${RUN}`, phone: `97${RUN}01` });
    const caseId = await createCase(page, {
      clientLabelPart: `E2E Itr ${RUN}`,
      service: "ITR Filing",
      fill: async (p) => {
        await p.getByLabel("Assessment year *").fill("2026-27");
      },
    });
    await page.goto(`/cases/${caseId}/documents`);
    // exact: true targets the document-name cell only — the Apply button's
    // aria-label ("Apply status to <doc>") also contains the name, so a
    // non-exact match would hit two cells (Playwright strict-mode error).
    await expect(page.getByRole("cell", { name: "PAN card", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Form 16 (per employer)", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Client approval confirmation", exact: true })).toBeVisible();
  });

  test("IEPF case: checklist + identity review + default fee auto-created", async ({ page }) => {
    await login(page);
    await createClient(page, { name: `E2E Iepf ${RUN}`, phone: `97${RUN}02` });
    const caseId = await createCase(page, {
      clientLabelPart: `E2E Iepf ${RUN}`,
      service: "IEPF Claim Recovery",
      fill: async (p) => {
        await p.getByLabel("Company name *").fill("E2E Demo Industries Ltd");
        await p.getByLabel("Estimated claim value (Rs.)").fill("240000");
      },
    });
    await page.goto(`/cases/${caseId}/documents`);
    await expect(
      page.getByRole("cell", { name: "Latest Client Master List (CML)", exact: true })
    ).toBeVisible();
    await page.goto(`/cases/${caseId}/identity-review`);
    await expect(page.getByText("Incomplete — blocks IEPF-5 preparation")).toBeVisible();
    await page.goto(`/cases/${caseId}/fees`);
    await expect(page.getByText("IEPF recovery fee")).toBeVisible();
    await expect(page.getByText("Expected fee: ₹36,000")).toBeVisible(); // 15% of 2,40,000
  });

  test("checklist review: received/verified; reject requires reason", async ({ page }) => {
    await login(page);
    await createClient(page, { name: `E2E Docs ${RUN}`, phone: `97${RUN}03` });
    const caseId = await createCase(page, {
      clientLabelPart: `E2E Docs ${RUN}`,
      service: "ITR Filing",
      fill: async (p) => p.getByLabel("Assessment year *").fill("2026-27"),
    });
    await page.goto(`/cases/${caseId}/documents`);

    const panRow = page.locator("tr", { hasText: "PAN card" }).first();
    await panRow.locator("select").selectOption("received");
    await panRow.getByRole("button", { name: "Apply" }).click();
    await expect(page.locator("tr", { hasText: "PAN card" }).first()).toContainText("received");

    // Reject without reason -> blocked with error banner
    const aisRow = page.locator("tr", { hasText: "AIS" }).first();
    await aisRow.locator("select").selectOption("rejected");
    await aisRow.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText("A reason is required to mark an item rejected.")).toBeVisible();
  });

  test("Aadhaar is default-deny until the case flag is enabled with a reason", async ({ page }) => {
    await login(page);
    await createClient(page, { name: `E2E Aadhaar ${RUN}`, phone: `97${RUN}04` });
    const caseId = await createCase(page, {
      clientLabelPart: `E2E Aadhaar ${RUN}`,
      service: "IEPF Claim Recovery",
      fill: async (p) => p.getByLabel("Company name *").fill("E2E Aadhaar Test Ltd"),
    });
    await page.goto(`/cases/${caseId}/documents`);

    await expect(page.getByText("Aadhaar collection — default DENY")).toBeVisible();
    await expect(
      page.getByText(/cannot be requested or uploaded for this case/)
    ).toBeVisible();
    // Aadhaar item must NOT be offered in the upload-link picker yet
    await expect(
      page.getByRole("checkbox").locator("xpath=..").filter({ hasText: "Aadhaar card" })
    ).toHaveCount(0);

    await page.getByPlaceholder("Why is Aadhaar required for this case?").fill("IEPF KYC needs it");
    await page.getByRole("button", { name: "Enable Aadhaar (audited)" }).click();
    await expect(page.getByText(/Aadhaar upload is ENABLED/)).toBeVisible();
  });
});
