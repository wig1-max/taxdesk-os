import { expect, test } from "@playwright/test";
import { FAKE_PAN, RUN, createClient, login } from "./helpers";

test.describe("clients & the PAN contract", () => {
  test("create client without PAN — profile shows PAN pending badge", async ({ page }) => {
    await login(page);
    await createClient(page, { name: `E2E NoPan ${RUN}`, phone: `98${RUN}01` });
    await expect(page.getByText("PAN pending — not on file")).toBeVisible();
  });

  test("create client WITH PAN — full PAN never appears anywhere in the UI", async ({ page }) => {
    await login(page);
    const id = await createClient(page, {
      name: `E2E WithPan ${RUN}`,
      phone: `98${RUN}02`,
      pan: FAKE_PAN,
    });

    // Profile: masked only
    await expect(page.getByText(`XXXXXX${FAKE_PAN.slice(-4)}`)).toBeVisible();
    expect(await page.content()).not.toContain(FAKE_PAN);

    // List: masked only
    await page.goto(`/clients?q=E2E WithPan ${RUN}`);
    expect(await page.content()).not.toContain(FAKE_PAN);
    await expect(page.getByText(`XXXXXX${FAKE_PAN.slice(-4)}`)).toBeVisible();

    // Search by PAN last 4 works
    await page.goto(`/clients?q=${FAKE_PAN.slice(-4)}`);
    await expect(page.getByRole("link", { name: `E2E WithPan ${RUN}` })).toBeVisible();

    // Set/replace PAN via dedicated action still shows masked only
    await page.goto(`/clients/${id}`);
    await page.getByPlaceholder("ABCDE1234F").first().fill("ZZTES5678Z");
    await page.getByRole("button", { name: "Save PAN" }).click();
    await expect(page.getByText(/PAN saved/)).toBeVisible();
    expect(await page.content()).not.toContain("ZZTES5678Z");
  });

  test("admin PAN reveal requires a reason and shows the value once", async ({ page }) => {
    await login(page);
    const id = await createClient(page, {
      name: `E2E Reveal ${RUN}`,
      phone: `98${RUN}03`,
      pan: FAKE_PAN,
    });
    await page.goto(`/clients/${id}`);
    await page.getByRole("button", { name: "Reveal once" }).click();
    await expect(page.getByText("Enter a reason for the reveal")).toBeVisible(); // blocked without reason
    await page.getByPlaceholder("e.g. Verifying PAN before ITR filing").fill("E2E verification test");
    await page.getByRole("button", { name: "Reveal once" }).click();
    await expect(page.getByText(FAKE_PAN)).toBeVisible(); // shown once, deliberately
    await page.getByRole("button", { name: "hide" }).click();
    expect(await page.content()).not.toContain(FAKE_PAN);
  });
});
