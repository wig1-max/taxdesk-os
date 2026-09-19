import { expect, test } from "@playwright/test";
import { RUN, createCase, createClient, login } from "./helpers";

/**
 * The IEPF gauntlet: guardrails must block IEPF-5 preparation until
 * identity review + verified agreements + Rs. 5,000 upfront exist.
 * Plus ITR filing guardrails.
 */
test.describe.serial("fees, identity review & transition guardrails", () => {
  let iepfCaseId = "";

  test("setup IEPF case; record upfront payment", async ({ page }) => {
    await login(page);
    await createClient(page, { name: `E2E Guard ${RUN}`, phone: `95${RUN}01` });
    iepfCaseId = await createCase(page, {
      clientLabelPart: `E2E Guard ${RUN}`,
      service: "IEPF Claim Recovery",
      fill: async (p) => {
        await p.getByLabel("Company name *").fill("E2E Guardrail Ltd");
        await p.getByLabel("Estimated claim value (Rs.)").fill("240000");
      },
    });

    await page.goto(`/cases/${iepfCaseId}/fees`);
    await page.getByRole("spinbutton", { name: "Amount", exact: true }).fill("5000");
    await page.getByLabel("Date").fill(new Date().toISOString().slice(0, 10));
    await page.getByRole("button", { name: "Record payment" }).click();
    await expect(page.getByText("5,000").first()).toBeVisible();
  });

  test("IEPF-5 preparation blocked before identity review", async ({ page }) => {
    await login(page);
    await page.goto(`/cases/${iepfCaseId}`);
    await page.getByLabel("New status").selectOption({ label: "IEPF-5 preparation" });
    await page.getByLabel(/Reason/).fill("e2e attempt");
    await page.getByRole("button", { name: "Apply transition" }).click();
    await expect(page.getByText(/Identity review must be complete/i)).toBeVisible();
  });

  test("complete identity review; still blocked until agreements verified", async ({ page }) => {
    await login(page);
    await page.goto(`/cases/${iepfCaseId}/identity-review`);
    for (const field of [
      "PAN name match",
      "Demat CML name match",
      "Share certificate / folio name match",
      "Bank name match",
    ]) {
      await page.getByLabel(field).selectOption("match");
    }
    await page.getByLabel("Address mismatch").selectOption("no");
    await page.getByLabel("Signature mismatch risk").selectOption("low");
    await page.getByRole("button", { name: /Save review/ }).click();
    await expect(page.getByText("Review complete")).toBeVisible();

    await page.goto(`/cases/${iepfCaseId}`);
    await page.getByLabel("New status").selectOption({ label: "IEPF-5 preparation" });
    await page.getByLabel(/Reason/).fill("e2e attempt 2");
    await page.getByRole("button", { name: "Apply transition" }).click();
    await expect(page.getByText(/authorization letter/i)).toBeVisible();
  });

  test("verify agreements; transition now passes (admin skip w/ reason)", async ({ page }) => {
    await login(page);
    await page.goto(`/cases/${iepfCaseId}/documents`);
    for (const doc of ["Authorization letter (signed)", "Fee agreement (signed)"]) {
      const row = page.locator("tr", { hasText: doc }).first();
      await row.locator("select").selectOption("verified");
      await row.getByRole("button", { name: "Apply" }).click();
      // Assert on the Status column badge (col 1 in the 3-col checklist
      // table), which only reads "verified" once the write is committed
      // and the page refreshes — this waits for the verify to persist
      // before the guarded transition below relies on it.
      await expect(
        page.locator("tr", { hasText: doc }).first().locator("td").nth(1)
      ).toContainText("verified");
    }

    await page.goto(`/cases/${iepfCaseId}`);
    await page.getByLabel("New status").selectOption({ label: "IEPF-5 preparation" });
    await page.getByLabel(/Reason/).fill("e2e admin skip after all guards satisfied");
    await page.getByRole("button", { name: "Apply transition" }).click();
    await expect(page.getByRole("row", { name: /iepf5_preparation/i })).toBeVisible();
  });

  test("IEPF-5 uploaded requires the manual-filing confirmation", async ({ page }) => {
    await login(page);
    await page.goto(`/cases/${iepfCaseId}`);
    await page.getByLabel("New status").selectOption({ label: "IEPF-5 uploaded" });
    await page.getByRole("button", { name: "Apply transition" }).click();
    await expect(page.getByText(/manually by an authorized person/i)).toBeVisible();

    // Re-open the case fresh so the confirmed submit doesn't race the
    // blocked attempt's redirect (a real user re-submits on a settled
    // page). Guardrail coverage is unchanged: blocked above without the
    // confirmation, allowed below only with it ticked.
    await page.goto(`/cases/${iepfCaseId}`);
    await page.getByLabel("New status").selectOption({ label: "IEPF-5 uploaded" });
    const confirm = page.getByRole("checkbox", { name: /I confirm this filing/ });
    await confirm.check();
    await expect(confirm).toBeChecked(); // ensure it stuck before submitting
    await page.getByRole("button", { name: "Apply transition" }).click();
    await expect(page.getByRole("row", { name: /iepf5_uploaded/i })).toBeVisible();
  });

  test("ITR cannot be Filed before client approval", async ({ page }) => {
    await login(page);
    await createClient(page, { name: `E2E ItrGuard ${RUN}`, phone: `95${RUN}02` });
    const itrId = await createCase(page, {
      clientLabelPart: `E2E ItrGuard ${RUN}`,
      service: "ITR Filing",
      fill: async (p) => p.getByLabel("Assessment year *").fill("2026-27"),
    });
    await page.goto(`/cases/${itrId}`);
    await page.getByLabel("New status").selectOption({ label: "Filed" });
    await page.getByLabel(/Reason/).fill("e2e premature filing attempt");
    await page.getByRole("checkbox", { name: /I confirm this filing/ }).check();
    await page.getByRole("button", { name: "Apply transition" }).click();
    await expect(page.getByText(/before the client has approved/i)).toBeVisible();
  });
});
