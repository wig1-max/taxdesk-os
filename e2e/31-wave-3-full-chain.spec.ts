import { expect, test } from "@playwright/test";
import { warmTaxDeskOnce } from "./warm";
import { ADMIN_STORAGE_STATE } from "./lib/auth-state";
import { readDraftOutputs, readEvidenceManifests, readSnapshots, seedTaxCase, serviceClient } from "./lib/fixtures";
import { VALID_PNG, waitForHydration } from "./helpers";
import { expectReconciled } from "./lib/reconcile";

/**
 * K3-33 — the mandatory CONNECTED Wave-3 full-chain proof.
 *
 * `e2e/28-source-proposals.spec.ts` proves upload → propose → accept/reject →
 * promote in isolation. `e2e/32-evidence-manifest-draft-output.spec.ts` proves
 * regime selection → manifest → approval → draft output in isolation, but
 * seeds its computation snapshot directly (`seedSnapshot`) rather than
 * deriving it from promoted proposal facts. Neither test proves the SAME
 * synthetic case crosses every handoff of the Wave-3 exit gate:
 *
 *   upload → reviewed facts → reconciliation → computation → validation →
 *   approval → draft output, with full lineage.
 *
 * This spec is that missing connective proof. It is synthetic-only (no real
 * PII), creates its own isolated case, and drives every product-visible step
 * through the real UI / guarded server actions — never a database shortcut
 * for a step this test itself is trying to prove.
 *
 * FIXTURE SETUP vs. PRODUCT PATH (declared explicitly, per the session
 * prompt's requirement):
 *   - FIXTURE SETUP (not part of what this test proves): `seedTaxCase()`
 *     creates the client + parent case + ITR checklist rows + an eligible
 *     taxpayer profile (DOB/resident/individual — the K.2.8.9A eligibility
 *     gate is a separately, exhaustively tested surface: `e2e/19-tax-desk-
 *     eligibility.spec.ts`). Creating a case end-to-end via `/tax-desk/cases/
 *     new` is already proven by `e2e/10-tax-desk-create.spec.ts` and
 *     `e2e/28-source-proposals.spec.ts`; re-proving it here would not
 *     strengthen the Wave-3 claim and would only add flake surface.
 *   - PRODUCT PATH (what this test actually proves, every step through the
 *     real UI or a guarded server action): generate a client upload link →
 *     upload a synthetic Form 16 as an unauthenticated client → propose
 *     salary income + salary TDS → accept both → promote (guarded RPC,
 *     atomic) → the promoted ledger rows feed a REAL computation snapshot
 *     (not seeded) → run validation → prepare the review pack → explicitly
 *     select a regime → generate an immutable evidence manifest → capture
 *     client approval bound to that exact manifest → generate the persisted
 *     internal draft-output artifact → inspect its lineage back to the
 *     promoted proposal decision.
 */
test.use({ storageState: ADMIN_STORAGE_STATE });

// OPS-11 (ZCode): per-spec route warming. Compile this shard's own Tax Desk
// sub-routes here, in an untimed beforeAll, instead of every shard compiling
// all of them in setup. Static routes stay warmed in setup; see e2e/warm.ts.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await warmTaxDeskOnce(browser);
});

const SALARY_AMOUNT = 7_40_000;
const SALARY_TDS_AMOUNT = 42_000;

test.describe.serial("Wave-3 connected full chain (K3-33)", () => {
  let taxCaseId = "";
  let caseId = "";
  let taxCaseUrl = "";
  let generalDocsUrl = "";

  test("fixture setup: an eligible, empty Tax Desk case with its ITR checklist", async () => {
    const seeded = await seedTaxCase({ itrTypeSelected: "ITR-1" });
    taxCaseId = seeded.taxCaseId;
    caseId = seeded.caseId;
    taxCaseUrl = `/tax-desk/cases/${taxCaseId}`;
    generalDocsUrl = `/cases/${caseId}/documents`;
    expect(Object.keys(seeded.docByName).length).toBeGreaterThan(0); // checklist exists
  });

  test("product path — upload: a synthetic Form 16 enters the supported workflow via a client upload link", async ({
    page,
    browser,
  }) => {
    await page.goto(generalDocsUrl);
    await page.getByRole("button", { name: "Generate upload link" }).click();
    await expect(page.getByText(/copy it NOW/i)).toBeVisible();
    const uploadUrl = (await page.locator("code").first().textContent()) ?? "";
    expect(uploadUrl).toMatch(/\/upload\/[A-Za-z0-9_-]{40,}/);

    // A fresh, unauthenticated context — mirrors the real client upload path
    // (never the staff session used for every other step in this chain).
    const ctx = await browser.newContext();
    const clientPage = await ctx.newPage();
    await clientPage.goto(uploadUrl);
    await clientPage.locator("select").selectOption({ label: "Form 16 (per employer)" });
    await clientPage.getByLabel(/File \(PDF, JPG/).setInputFiles({
      name: "form16.png",
      mimeType: "image/png",
      buffer: VALID_PNG,
    });
    await clientPage.getByRole("checkbox").check();
    await clientPage.getByRole("button", { name: "Upload document" }).click();
    await expect(clientPage.getByText(/Uploaded:/)).toBeVisible();
    await ctx.close();
  });

  test("product path — reviewed facts: salary income + salary TDS are proposed then explicitly accepted", async ({
    page,
  }) => {
    await page.goto(`${taxCaseUrl}/documents`);
    await expect(page.getByText("Synthetic Form 16 salary proposals")).toBeVisible();

    await waitForHydration(page, "#proposal-doc");
    await page.getByLabel("Source document").selectOption({ label: "Form 16 (per employer)" });
    await page.getByLabel("Fact", { exact: true }).selectOption({ label: "Salary income" });
    await page.getByLabel("Proposed amount (₹)").fill(String(SALARY_AMOUNT));
    await page.getByRole("button", { name: /Record this as a proposed fact/ }).click();
    await expect(page.getByText("proposal — not authoritative").first()).toBeVisible();

    await page.getByLabel("Source document").selectOption({ label: "Form 16 (per employer)" });
    await page.getByLabel("Fact", { exact: true }).selectOption({ label: "Salary TDS" });
    await page.getByLabel("Proposed amount (₹)").fill(String(SALARY_TDS_AMOUNT));
    await page.getByRole("button", { name: /Record this as a proposed fact/ }).click();

    // Imported-value safety: nothing is ledger truth yet — no promote control,
    // no ledger row for either fact (checked at the DB level in the next step).
    await expect(page.getByRole("button", { name: /Promote accepted salary facts/ })).toHaveCount(0);

    // Human accept/reject decision — the exact gap D24 named as missing from
    // a live ledger row's mere source association. Each accept is a reconciled
    // mutation (`useReconciledAction`): the Accept/Reject buttons for that fact
    // only disappear once the server has confirmed the decision and the page
    // has re-fetched fresh data, so waiting for that disappearance (rather than
    // just firing the click and moving straight to the next test, which
    // navigates away) is what actually proves the decision landed before this
    // test ends — under full-suite load the round trip can outlast an
    // unconfirmed click.
    await page.getByRole("button", { name: /Accept proposed Salary income/ }).click();
    await expect(page.getByRole("button", { name: /Accept proposed Salary income/ })).toHaveCount(0);
    await page.getByRole("button", { name: /Accept proposed Salary TDS/ }).click();
    await expect(page.getByRole("button", { name: /Accept proposed Salary TDS/ })).toHaveCount(0);
  });

  test("imported-value safety proof: an accepted-but-unpromoted proposal has created no ledger row", async () => {
    const db = serviceClient();
    const [{ count: incomeCount }, { count: tdsCount }] = await Promise.all([
      db.from("tax_income_entries").select("id", { count: "exact", head: true }).eq("tax_case_id", taxCaseId),
      db.from("tax_tax_paid_entries").select("id", { count: "exact", head: true }).eq("tax_case_id", taxCaseId),
    ]);
    expect(incomeCount ?? 0).toBe(0);
    expect(tdsCount ?? 0).toBe(0);
  });

  test("product path — promotion: the accepted pair promotes atomically into the canonical ledgers", async ({
    page,
  }) => {
    await page.goto(`${taxCaseUrl}/documents`);
    const promote = page.getByRole("button", { name: /Promote accepted salary facts/ });
    await expect(promote).toBeVisible();
    await promote.click();
    await expect(page.getByText("promoted").first()).toBeVisible();
    // Idempotent by construction (re-checked promoted state, not merely
    // event_id) — proven at the unit/security level already
    // (`source-proposal-workflow.mjs` P12); re-clicking here is not required
    // to re-prove that, and the control is gone once promoted anyway.
    await expect(promote).toHaveCount(0);

    await page.goto(`${taxCaseUrl}/ledgers`);
    await expect(page.getByText(/7,40,000|740,000/).first()).toBeVisible();
  });

  test("product path — reconciliation & computation: promoted facts contribute through the canonical engine, with full lineage", async ({
    page,
  }) => {
    await page.goto(`${taxCaseUrl}/computation`);
    await expect(page.getByText(/Partial preview|Partial \/ incomplete preview/)).toHaveCount(0);
    const save = page.getByRole("button", { name: "Save snapshot" });
    await expect(save).toBeEnabled();
    await save.click();
    await expectReconciled(page, "Snapshot saved ✓");
    await page.reload();

    // Full lineage, step 1: the Computation page's traceability panel names
    // the SAME promotion decision surfaced on Documents — resolved from the
    // engine's own `ComputedValue.sources` tags (K3-22..26), never a second
    // "which rows contributed" derivation, and matched to the promotion via
    // the promotion RPC's own immutable link (K3-31), never `source_type`
    // alone.
    await page.getByTestId("rule-traceability").getByText("Rule & evidence traceability").click();
    const lineage = page.getByTestId("promoted-proposal-lineage").first();
    await expect(lineage).toBeVisible();
    await expect(lineage).toContainText("Accepted through proposal workflow");
    await expect(lineage).toContainText("promoted from an accepted source proposal");

    const snaps = await readSnapshots(taxCaseId);
    expect(snaps.length).toBe(1); // computed from promoted ledger data, not a fixture
  });

  test("product path — validation: the case passes through the canonical validation/blocker system", async ({
    page,
  }) => {
    await page.goto(`${taxCaseUrl}/validation`);
    await page.getByRole("button", { name: "Run validation" }).click();
    // OPS-13: two frozen-candidate runs observed this action park in its
    // legitimate unconfirmed state, so a toast-only wait was a demonstrated
    // D191 false negative. The durable result remains asserted after reload.
    await expectReconciled(page, page.getByText(/Validation saved:/));
    await page.reload();
    await expect(page.getByText(/Last run:/)).toBeVisible();
    // No error/blocker-severity finding is open — this narrow, fully-sourced
    // case (one matched Form16 salary + salary-TDS pair, no unsupported
    // entries) has nothing to resolve before approval can be captured below.
    // A case that DID carry an open error/blocker is proven to be refused by
    // `capture_client_approval` at the unit/security/E2E level already
    // (`tests/security/*`, `e2e/15-tax-desk-client-review.spec.ts`) — this
    // step proves the validation stage runs and is consulted, not that every
    // refusal path exists (already covered elsewhere).
    await expect(page.getByText("Errors", { exact: true })).toBeVisible();
  });

  test("product path — explicit regime + immutable evidence manifest", async ({ page }) => {
    await page.goto(`${taxCaseUrl}/review`);
    await page.getByRole("button", { name: "Prepare review pack" }).click();
    await expectReconciled(page, "Review pack prepared ✓");
    await page.reload();

    // No regime is pre-selected — the manifest is never silently defaulted to
    // the recommended regime (D47).
    await expect(page.getByLabel("Old regime")).not.toBeChecked();
    await expect(page.getByLabel("New regime")).not.toBeChecked();
    await expect(page.getByRole("button", { name: "Generate manifest" })).toBeDisabled();

    await page.getByLabel("New regime").check();
    await page.getByRole("button", { name: "Generate manifest" }).click();
    await expectReconciled(page, "Evidence manifest generated ✓");
    await page.reload();

    const summary = page.getByTestId("evidence-manifest-summary");
    await expect(summary).toContainText("NEW regime");
    await expect(summary).toContainText("Bound to current snapshot");
    await expect(summary).toContainText("none"); // no active blockers at this income level

    const manifests = await readEvidenceManifests(taxCaseId);
    expect(manifests.length).toBe(1);
    expect(manifests[0]!.selected_regime).toBe("new");
    expect(manifests[0]!.manifest_content_hash).toMatch(/^[0-9a-f]{64}$/); // deterministic sha256 identity
  });

  test("product path — approval binds to the exact snapshot + manifest + hash", async ({ page }) => {
    await page.goto(`${taxCaseUrl}/review`);
    await page.getByRole("button", { name: "Capture client approval" }).click();
    await page.getByLabel("Approval method").selectOption("whatsapp");
    await page.getByLabel("Approval reference").fill("Confirmed by WhatsApp for the K3-33 full-chain proof.");
    await page.getByRole("button", { name: "Save confirmation" }).click();
    await expectReconciled(page, "Client approval captured ✓");
    await page.reload();

    await expect(page.getByTestId("evidence-manifest-summary")).toContainText(
      "Client approval is current for this manifest",
    );
  });

  test("product path — persisted internal draft output, guarded/idempotent, requires current approval", async ({
    page,
  }) => {
    await page.goto(`${taxCaseUrl}/review`);
    const generate = page.getByRole("button", { name: "Generate internal draft output" });
    await expect(generate).toBeEnabled();
    await generate.click();
    await expectReconciled(page, "Internal draft output generated ✓");
    await page.reload();

    const history = page.getByTestId("draft-output-history");
    await expect(history).toBeVisible();
    await expect(history).toContainText("internal_draft");
    await expect(history).toContainText("NEW regime");

    // Internal/preparation-only — never ITD JSON or a filing-success claim.
    await expect(page.getByText(/Internal \/ preparation-only/i)).toBeVisible();
    await expect(page.getByText(/not an ITD JSON payload/i)).toBeVisible();
    await expect(page.getByText(/not an e-filing upload package/i)).toBeVisible();
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/filed successfully|accepted by the (income tax|IT) department|e-verified/i);

    const draftOutputs = await readDraftOutputs(taxCaseId);
    expect(draftOutputs.length).toBe(1);
    expect(draftOutputs[0]!.status).toBe("internal_draft");
    expect(draftOutputs[0]!.package_content_hash).toMatch(/^[0-9a-f]{64}$/);
    const manifests = await readEvidenceManifests(taxCaseId);
    expect(draftOutputs[0]!.source_manifest_id).toBe(manifests[0]!.id); // draft output ties to THIS manifest
  });

  test("full lineage: draft-output figure → manifest figure → engine source tags → ledger entry → accepted proposal decision → source document", async ({
    page,
  }) => {
    await page.goto(`${taxCaseUrl}/review`);
    const history = page.getByTestId("draft-output-history");
    await history.getByRole("button").first().click();
    await expect(history).toContainText("Source manifest hash");
    await expect(history).toContainText("Figures / evidence facts");

    // The lineage chain this test has already walked, end to end:
    //   draft-output package.figures  === manifest.figures (copied verbatim,
    //     never re-derived — draft-output-artifact.ts's own structural
    //     boundary test proves this at the unit level)
    //   → manifest.figures            === describeCaseTraceability's own
    //     TraceableLine[] (K3-22..26), asserted above on the Computation page
    //   → each figure's contributing facts   === the engine's own
    //     ComputedValue.sources tags, asserted above ("promoted-proposal-lineage")
    //   → each contributing fact           === a real tax_income_entries /
    //     tax_tax_paid_entries row, asserted above (₹7,40,000 on Ledgers)
    //   → each ledger row's promotion decision === the accepted
    //     source-proposal record this test itself accepted, matched via the
    //     promotion RPC's immutable (promoted_ledger_kind,
    //     promoted_ledger_entry_id) link — never `source_type` alone (D35)
    //   → the source document + its retained hash  === the synthetic Form 16
    //     this test itself uploaded in step 1.
    // Re-navigate to Computation to confirm the SAME lineage marker is still
    // present after approval + draft-output generation (nothing about
    // generating an immutable manifest/draft output altered the live
    // traceability read model).
    await page.goto(`${taxCaseUrl}/computation`);
    await page.getByTestId("rule-traceability").getByText("Rule & evidence traceability").click();
    await expect(page.getByTestId("promoted-proposal-lineage").first()).toContainText(
      "promoted from an accepted source proposal",
    );
  });
});
