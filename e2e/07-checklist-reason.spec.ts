import { expect, test } from "@playwright/test";
import { RUN, createCase, createClient, login } from "./helpers";
import { reconcileForFreshUi } from "./lib/reconcile";

test.describe("checklist rejection/waiver reason UX", () => {
  test("reject with reason shows Saved and the reason survives a reload", async ({ page }) => {
    await login(page);
    await createClient(page, { name: `E2E Reason ${RUN}`, phone: `97${RUN}07` });
    const caseId = await createCase(page, {
      clientLabelPart: `E2E Reason ${RUN}`,
      service: "ITR Filing",
      fill: async (p) => p.getByLabel("Assessment year *").fill("2026-27"),
    });
    await page.goto(`/cases/${caseId}/documents`);

    const panRow = page.locator("tr", { hasText: "PAN card" }).first();

    // Reason field is hidden until Rejected/Waived is chosen.
    await expect(panRow.getByPlaceholder("e.g. Document not legible")).toHaveCount(0);

    await panRow.locator("select").selectOption("rejected");
    await panRow.getByPlaceholder("e.g. Document not legible").fill("PAN scan blurry (E2E)");
    await panRow.getByRole("button", { name: "Apply" }).click();

    // Clear "Saved" confirmation.
    await reconcileForFreshUi(page, "Saved ✓");

    // Reason is visible under the item.
    await expect(page.locator("tr", { hasText: "PAN card" }).first()).toContainText(
      "PAN scan blurry (E2E)"
    );

    // And it persists across a full reload.
    await page.reload();
    const reloaded = page.locator("tr", { hasText: "PAN card" }).first();
    await expect(reloaded).toContainText("PAN scan blurry (E2E)");
    await expect(reloaded).toContainText("rejected");
  });
});
