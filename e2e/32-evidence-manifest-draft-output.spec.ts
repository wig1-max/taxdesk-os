import { expect, test } from "@playwright/test";
import { warmTaxDeskOnce } from "./warm";
import { ADMIN_STORAGE_STATE } from "./lib/auth-state";
import { seedSnapshot, seedTaxCase } from "./lib/fixtures";
import { expectReconciled } from "./lib/reconcile";

/**
 * K3-32B — accepted-evidence manifest + persisted internal draft-output
 * workflow. Covers the real UI path this session added to the Client Review
 * page: explicit regime selection (never defaulted), manifest generation,
 * client approval binding to the exact manifest, guarded internal
 * draft-output generation, and historical-artifact inspection. The pure
 * regime-selective boundary logic and every guarded-RPC refusal are already
 * proven by `evidence-manifest.test.ts` / `draft-output-artifact.test.ts`
 * and `tests/security/evidence-manifest-workflow.mjs` — this spec proves the
 * LIVE UI path renders and reacts to that logic correctly, not the logic
 * itself.
 */
test.use({ storageState: ADMIN_STORAGE_STATE });

// OPS-11 (ZCode): per-spec route warming. Compile this shard's own Tax Desk
// sub-routes here, in an untimed beforeAll, instead of every shard compiling
// all of them in setup. Static routes stay warmed in setup; see e2e/warm.ts.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await warmTaxDeskOnce(browser);
});

const THRESHOLD = 5000000; // Rs 50,00,000 — src/lib/tax-desk/tax-capability.ts

test.describe.serial("Accepted-evidence manifest + internal draft output (K3-32B)", () => {
  let taxCaseId = "";
  let reviewUrl = "";

  test.beforeAll(async () => {
    const c = await seedTaxCase({
      itrTypeSelected: "ITR-1",
      income: [{ income_head: "salary", amount: 800000, source_type: "Form16" }],
    });
    taxCaseId = c.taxCaseId;
    reviewUrl = `/tax-desk/cases/${c.taxCaseId}/review`;
    await seedSnapshot(c.taxCaseId, { salary: 800000 });
  });

  test("no regime is pre-selected — staff must explicitly choose one", async ({ page }) => {
    await page.goto(reviewUrl);
    await page.getByRole("button", { name: "Prepare review pack" }).click();
    await expectReconciled(page, "Review pack prepared ✓");
    await page.reload();
    await expect(page.getByLabel("Old regime")).not.toBeChecked();
    await expect(page.getByLabel("New regime")).not.toBeChecked();
    // The generate button is disabled until a regime is explicitly chosen.
    await expect(page.getByRole("button", { name: "Generate manifest" })).toBeDisabled();
  });

  test("full chain: generate manifest → capture approval → generate internal draft output → inspect lineage", async ({ page }) => {
    await page.goto(reviewUrl);
    await page.getByLabel("New regime").check();
    await page.getByRole("button", { name: "Generate manifest" }).click();
    await expectReconciled(page, "Evidence manifest generated ✓");
    await page.reload();

    const summary = page.getByTestId("evidence-manifest-summary");
    await expect(summary).toContainText("NEW regime");
    await expect(summary).toContainText("Bound to current snapshot");
    await expect(summary).toContainText("none"); // no active blockers

    await page.getByRole("button", { name: "Capture client approval" }).click();
    await page.getByLabel("Approval reference").fill("Confirmed by WhatsApp for K3-32B E2E.");
    await page.getByRole("button", { name: "Save confirmation" }).click();
    await expectReconciled(page, "Client approval captured ✓");
    await page.reload();
    await expect(summary).toContainText("Client approval is current for this manifest");

    await page.getByRole("button", { name: "Generate internal draft output" }).click();
    await expectReconciled(page, "Internal draft output generated ✓");
    await page.reload();

    const history = page.getByTestId("draft-output-history");
    await expect(history).toBeVisible();
    await expect(history).toContainText("internal_draft");
    await expect(history).toContainText("NEW regime");

    // Internal/preparation-only disclosure — never ITD JSON or filing language.
    await expect(page.getByText(/Internal \/ preparation-only/i)).toBeVisible();
    await expect(page.getByText(/not an ITD JSON payload/i)).toBeVisible();
    await expect(page.getByText(/not an e-filing upload package/i)).toBeVisible();
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/filed successfully|accepted by the (income tax|IT) department|e-verified/i);

    // Expand the history row to inspect lineage detail.
    await history.getByRole("button").first().click();
    await expect(history).toContainText("Source manifest hash");
    await expect(history).toContainText("Figures / evidence facts");
  });

  test("a fresh snapshot makes the manifest panel require a new manifest again", async ({ page }) => {
    await seedSnapshot(taxCaseId, { salary: 850000, createdAt: new Date().toISOString() });
    await page.goto(reviewUrl);
    await page.getByRole("button", { name: "Prepare latest snapshot again" }).click();
    await expectReconciled(page, "Review pack prepared ✓");
    await page.reload();
    // The new snapshot has no manifest of its own yet — the prior approval's
    // manifest belonged to the SUPERSEDED snapshot, named as such (never
    // shown as if it were current).
    await expect(page.getByText(/No evidence manifest has been generated yet/)).toBeVisible();
    await expect(page.getByText(/belongs to a superseded snapshot/)).toBeVisible();
  });
});

test.describe("Evidence-manifest regime boundary (D44 strict `>`, mirrored for the selected-regime gate)", () => {
  test.use({ storageState: ADMIN_STORAGE_STATE });

  // A case whose CONSERVATIVE (higher-of-both-regimes) total income exceeds
  // the threshold is already rejected at `prepare_client_review` — before
  // the manifest layer is even reachable — so that boundary (and the fully
  // regime-DIVERGENT case where the unselected regime alone exceeds it) is
  // proven at the RPC layer by `tests/security/evidence-manifest-workflow.mjs`
  // (M8-M10, which seeds genuinely different old/new regime figures — the
  // `seedSnapshot` fixture used across this UI suite always seeds identical
  // old/new figures, so it cannot express that divergence). This test proves
  // only that the manifest layer's OWN exact-boundary case (reachable live,
  // since it does NOT trip the existing conservative gate) renders correctly.
  test("EXACT Rs 50,00,000 total income reaches the manifest step and succeeds", async ({ page }) => {
    const atThreshold = await seedTaxCase({
      itrTypeSelected: "ITR-1",
      income: [{ income_head: "salary", amount: THRESHOLD + 93000, source_type: "Form16" }],
    });
    await seedSnapshot(atThreshold.taxCaseId, { salary: THRESHOLD + 93000 });
    const atUrl = `/tax-desk/cases/${atThreshold.taxCaseId}/review`;
    await page.goto(atUrl);
    await page.getByRole("button", { name: "Prepare review pack" }).click();
    await expectReconciled(page, "Review pack prepared ✓");
    await page.reload();
    await page.getByLabel("Old regime").check();
    await page.getByRole("button", { name: "Generate manifest" }).click();
    await expectReconciled(page, "Evidence manifest generated ✓");
  });
});
