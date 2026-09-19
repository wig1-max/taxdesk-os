import { expect, test } from "@playwright/test";
import { ADMIN_STORAGE_STATE } from "./lib/auth-state";
import { RUN, createClient, waitForHydration } from "./helpers";

/**
 * `K3-ENV-4` — the New Case client picker is a searchable, server-backed
 * combobox.
 *
 * It replaced a `<select>` that rendered only the first 500 clients ordered by
 * name. That was a real correctness bug, not just a test nuisance: every client
 * outside the window was unselectable, with no indication anything had been
 * omitted — and an office with more than 500 clients hits it immediately. These
 * tests pin the behaviour that makes the cap irrelevant.
 */
test.use({ storageState: ADMIN_STORAGE_STATE });

const NAME = `E2E Picker ${RUN}`;

test.describe.serial("New Case client selector (K3-ENV-4)", () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage({ storageState: ADMIN_STORAGE_STATE });
    await createClient(page, { name: NAME, phone: `96${RUN}0099`.slice(0, 10) });
    await page.close();
  });

  test("finds a client by typing, and commits it with the mouse", async ({ page }) => {
    await page.goto("/cases/new");
    await waitForHydration(page, '[role="combobox"]');
    const input = page.getByRole("combobox", { name: "Client *" });

    await input.fill(NAME);
    const option = page.getByRole("option", { name: new RegExp(NAME) }).first();
    await expect(option).toBeVisible();
    await option.click();

    await expect(input).toHaveValue(new RegExp(NAME));
    // The form still submits a plain `client_id`, as it did with the <select>.
    await expect(page.locator('input[name="client_id"]')).toHaveValue(/[0-9a-f-]{36}/);
  });

  test("is keyboard-operable end to end and never submits the form on Enter", async ({ page }) => {
    await page.goto("/cases/new");
    await waitForHydration(page, '[role="combobox"]');
    const input = page.getByRole("combobox", { name: "Client *" });

    await input.fill(NAME);
    // Wait for the FILTERED list, not merely for "some option matches". The
    // popup opens on focus with an unfiltered first page, and every spec in a
    // run shares the same RUN suffix, so a weaker "an option matches NAME"
    // assertion can pass against the unfiltered list — and then ArrowDown lands
    // on whatever happens to sort first (observed: "E2E Aadhaar <RUN>").
    // Requiring the FIRST option to be ours proves the debounced search landed.
    await expect(page.getByRole("option").first()).toHaveText(new RegExp(NAME));
    await expect(input).toHaveAttribute("aria-expanded", "true");

    await page.keyboard.press("ArrowDown");
    // The active option is exposed to assistive tech, not just highlighted.
    const activeId = await input.getAttribute("aria-activedescendant");
    expect(activeId).toBeTruthy();
    // Attribute selector, not `#id`: React's generated ids are not guaranteed to
    // be valid CSS identifiers, and `CSS.escape` is a browser API unavailable
    // here in Node.
    await expect(page.locator(`[id="${activeId}"]`)).toHaveAttribute("role", "option");

    await page.keyboard.press("Enter");
    await expect(input).toHaveValue(new RegExp(NAME));
    await expect(input).toHaveAttribute("aria-expanded", "false");
    // Enter committed the option; it must NOT have submitted the case form.
    await expect(page).toHaveURL(/\/cases\/new/);
  });

  test("Escape closes the list without selecting", async ({ page }) => {
    await page.goto("/cases/new");
    await waitForHydration(page, '[role="combobox"]');
    const input = page.getByRole("combobox", { name: "Client *" });

    await input.fill(NAME);
    await expect(page.getByRole("option", { name: new RegExp(NAME) }).first()).toBeVisible();
    await page.keyboard.press("Escape");

    await expect(input).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator('input[name="client_id"]')).toHaveValue("");
  });

  test("says so plainly when nothing matches", async ({ page }) => {
    await page.goto("/cases/new");
    await waitForHydration(page, '[role="combobox"]');
    await page
      .getByRole("combobox", { name: "Client *" })
      .fill("zzz-no-such-client-zzz");
    await expect(page.getByText("No matching client.")).toBeVisible();
    await expect(page.locator('input[name="client_id"]')).toHaveValue("");
  });

  test("typing away from a committed choice clears the hidden id", async ({ page }) => {
    await page.goto("/cases/new");
    await waitForHydration(page, '[role="combobox"]');
    const input = page.getByRole("combobox", { name: "Client *" });
    const hidden = page.locator('input[name="client_id"]');

    await input.fill(NAME);
    await page.getByRole("option", { name: new RegExp(NAME) }).first().click();
    await expect(hidden).toHaveValue(/[0-9a-f-]{36}/);

    // The form must never submit an id that no longer matches what is shown.
    await input.fill("something else entirely");
    await expect(hidden).toHaveValue("");
  });

  test("a11y — labelled combobox, listbox semantics, and 44px option targets", async ({ page }) => {
    await page.goto("/cases/new");
    await waitForHydration(page, '[role="combobox"]');
    const input = page.getByRole("combobox", { name: "Client *" });
    await expect(input).toHaveAttribute("aria-autocomplete", "list");

    await input.fill(NAME);
    const listbox = page.getByRole("listbox", { name: "Client search results" });
    await expect(listbox).toBeVisible();

    const box = await page.getByRole("option").first().boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test("no horizontal overflow at 360px with the list open", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 720 });
    await page.goto("/cases/new");
    await waitForHydration(page, '[role="combobox"]');
    await page.getByRole("combobox", { name: "Client *" }).fill(NAME);
    await expect(page.getByRole("option").first()).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
