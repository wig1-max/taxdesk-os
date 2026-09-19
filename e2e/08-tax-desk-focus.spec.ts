import { expect, test } from "@playwright/test";
import { RUN, createCase, createClient, login } from "./helpers";

/**
 * Phase K.1 / K.1.1 — Tax Desk focus. The normal workflow surfaces only tax
 * services (ITR/GST); deferred services (IEPF, etc.) are hidden from normal
 * New Case, the default cases list, and the default dashboard, but remain
 * reachable by admins and by direct URL — with no duplicate-create risk.
 */
test.describe.serial("Tax Desk focus (K.1)", () => {
  let itrId = "";
  const deferClient = `E2E Defer ${RUN}`;

  test("New Case dropdown shows only normal tax services", async ({ page }) => {
    await login(page);
    await page.goto("/cases/new");
    const opts = await page.getByLabel("Service *").locator("option").allTextContents();
    expect(opts.some((o) => o.includes("ITR Filing"))).toBeTruthy();
    expect(opts.some((o) => o.includes("GST"))).toBeTruthy();
    expect(opts.some((o) => /IEPF/i.test(o))).toBeFalsy();
    expect(opts.some((o) => /Insurance|Mutual Fund|Loan DSA|Government Form/i.test(o))).toBeFalsy();
  });

  test("normal ITR create redirects to the created case", async ({ page }) => {
    await login(page);
    await createClient(page, { name: `E2E ItrNav ${RUN}`, phone: `93${RUN}04` });
    // createCase clicks "Create case" and asserts the post-success redirect to
    // /cases/<uuid>. ITR uses the normal (non-deferred) New Case path.
    const id = await createCase(page, {
      clientLabelPart: `E2E ItrNav ${RUN}`,
      service: "ITR Filing",
      fill: async (p) => p.getByLabel("Assessment year *").fill("2026-27"),
    });
    await page.goto(`/cases/${id}`);
    await expect(page.getByRole("heading", { name: "ITR Filing" })).toBeVisible();
  });

  test("normal GST create redirects to the created case", async ({ page }) => {
    await login(page);
    await createClient(page, { name: `E2E Gst ${RUN}`, phone: `93${RUN}03` });
    // GST goes through the normal (non-deferred) New Case path; a successful
    // create must land on /cases/<uuid>, not stay stuck on /cases/new.
    const gstId = await createCase(page, {
      clientLabelPart: `E2E Gst ${RUN}`,
      service: "GST Registration/Filing",
    });
    await page.goto(`/cases/${gstId}`);
    await expect(page.getByRole("heading", { name: "GST Registration/Filing" })).toBeVisible();
  });

  test("deferred IEPF create redirects after success, does not duplicate, stays reachable by URL", async ({
    page,
  }) => {
    await login(page);
    await createClient(page, { name: deferClient, phone: `93${RUN}01` });
    // createCase clicks "Create case" and asserts the post-success redirect to
    // /cases/<uuid> (via the admin ?includeDeferred=1 path for IEPF).
    const iepfId = await createCase(page, {
      clientLabelPart: deferClient,
      service: "IEPF Claim Recovery",
      fill: async (p) => p.getByLabel("Company name *").fill("E2E Deferred Ltd"),
    });
    await page.goto(`/cases/${iepfId}`);
    await expect(page.getByRole("heading", { name: "IEPF Claim Recovery" })).toBeVisible();

    // Exactly ONE IEPF case exists for this client — the create didn't leave a
    // retryable form that produced a duplicate on submit/retry.
    await page.goto("/cases?service=iepf");
    await expect(page.getByRole("row", { name: new RegExp(deferClient) })).toHaveCount(1);
  });

  test("default dashboard excludes deferred IEPF cases and IEPF cards", async ({ page }) => {
    await login(page);
    await page.goto("/dashboard");
    await expect(page.getByText("What needs attention today?")).toBeVisible();
    // The fresh IEPF case would otherwise surface in Recently updated /
    // Documents pending; it must not appear on the Tax Desk dashboard.
    await expect(page.getByText(new RegExp(deferClient))).toHaveCount(0);
    await expect(page.getByText("IEPF dispatch pending")).toHaveCount(0);
    await expect(page.getByText("IEPF objections to answer")).toHaveCount(0);
  });

  test("ITR case has no IEPF identity-review tab or default-fee hint", async ({ page }) => {
    await login(page);
    await createClient(page, { name: `E2E Tax ${RUN}`, phone: `93${RUN}02` });
    itrId = await createCase(page, {
      clientLabelPart: `E2E Tax ${RUN}`,
      service: "ITR Filing",
      fill: async (p) => p.getByLabel("Assessment year *").fill("2026-27"),
    });
    await page.goto(`/cases/${itrId}`);
    await expect(page.getByRole("link", { name: "Identity Review" })).toHaveCount(0);
    await page.goto(`/cases/${itrId}/fees`);
    await expect(page.getByText(/IEPF cases get a default/i)).toHaveCount(0);
  });

  test("ITR documents page helper copy contains no IEPF reference", async ({ page }) => {
    await login(page);
    await page.goto(`/cases/${itrId}/documents`);
    await expect(page.getByText("Checklist")).toBeVisible();
    await expect(page.getByText(/IEPF/)).toHaveCount(0);
  });

  test("messages show current-service + generic templates only (no IEPF)", async ({ page }) => {
    await login(page);
    await page.goto(`/cases/${itrId}/messages`);
    const tmpl = await page.getByLabel("Template").locator("option").allTextContents();
    expect(tmpl.length).toBeGreaterThan(0);
    expect(tmpl.some((o) => /IEPF/i.test(o))).toBeFalsy();
    expect(tmpl.some((o) => /welcome|checklist|Computation/i.test(o))).toBeTruthy();
  });
});
