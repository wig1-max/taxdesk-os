import { expect, test } from "@playwright/test";
import { warmTaxDeskOnce } from "./warm";
import { ADMIN_STORAGE_STATE } from "./lib/auth-state";
import {
  countAudit,
  readReviewState,
  resolveFindingDirect,
  seedOpenFinding,
  seedSnapshot,
  seedTaxCase,
  setReviewStatus,
} from "./lib/fixtures";
import { expectReconciled, reconcileForFreshUi } from "./lib/reconcile";

/**
 * Phase K.2.7 — Tax Desk Client Review Pack. Snapshot-bound staff review /
 * approval. Authenticated via shared admin storage state; portable fixtures
 * seed cases, snapshots and findings directly (no UI prerequisite creation).
 */
test.use({ storageState: ADMIN_STORAGE_STATE });

// OPS-11 (ZCode): per-spec route warming. Compile this shard's own Tax Desk
// sub-routes here, in an untimed beforeAll, instead of every shard compiling
// all of them in setup. Static routes stay warmed in setup; see e2e/warm.ts.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await warmTaxDeskOnce(browser);
});

// Primary happy-path case (prepare → sent → approve → stale → re-prepare → changes).
let primaryTaxCaseId = "";
let primaryCaseId = "";
let primaryReviewUrl = "";
let snapshotAId = "";

// Auxiliary cases for isolated concerns.
let noSnapUrl = "";
let errUrl = "";
let errTaxCaseId = "";
let errFindingId = "";

test.describe.serial("Tax Desk client review (K.2.7)", () => {
  test.beforeAll(async () => {
    const primary = await seedTaxCase({
      itrTypeSelected: "ITR-1",
      income: [{ income_head: "salary", amount: 800000, source_type: "Form16" }],
    });
    primaryTaxCaseId = primary.taxCaseId;
    primaryCaseId = primary.caseId;
    primaryReviewUrl = `/tax-desk/cases/${primary.taxCaseId}/review`;
    // Older complete snapshot bound at prepare time.
    snapshotAId = await seedSnapshot(primary.taxCaseId, {
      complete: true,
      createdAt: new Date(Date.now() - 3_600_000).toISOString(),
    });

    const noSnap = await seedTaxCase({ itrTypeSelected: "ITR-1", income: [{ income_head: "salary", amount: 500000 }] });
    noSnapUrl = `/tax-desk/cases/${noSnap.taxCaseId}/review`;

    const err = await seedTaxCase({ itrTypeSelected: "ITR-1", income: [{ income_head: "salary", amount: 600000 }] });
    errTaxCaseId = err.taxCaseId;
    errUrl = `/tax-desk/cases/${err.taxCaseId}/review`;
    await seedSnapshot(err.taxCaseId, { complete: true });
    errFindingId = await seedOpenFinding(err.taxCaseId, { severity: "error" });

  });

  // Item 2, 17: authenticated route opens; disclaimer renders.
  test("authenticated Client Review route opens with the mandatory disclaimer", async ({ page }) => {
    await page.goto(primaryReviewUrl);
    await expect(page.getByRole("heading", { name: /Client Review —/ })).toBeVisible();
    await expect(
      page.getByText(/It is not proof of filing, tax authority acceptance, or professional certification/i),
    ).toBeVisible();
    // K.2.9.4 status-copy: the disclaimer names the recorded approval as a
    // staff-entered confirmation (not authorization) and the universal quality
    // policy as "independent professional review" — the four review concepts are
    // never conflated, so the ambiguous "manual professional review" phrase is
    // absent from this preparation surface.
    await expect(page.getByText(/staff-entered client confirmation only/i)).toBeVisible();
    await expect(page.getByText(/independent professional review before filing/i)).toBeVisible();
    await expect(page.getByText(/manual professional review/i)).toHaveCount(0);
  });

  // Item 3: workbench links to Client Review.
  test("workbench nav links to Client Review", async ({ page }) => {
    await page.goto(`/tax-desk/cases/${primaryTaxCaseId}`);
    await page
      .getByRole("navigation", { name: "Tax Desk workbench" })
      .getByRole("link", { name: "Client Review" })
      .click();
    await expect(page).toHaveURL(/\/review$/);
  });

  // Item 4: no-snapshot state blocks preparation.
  test("no complete snapshot blocks preparation", async ({ page }) => {
    await page.goto(noSnapUrl);
    await expect(page.getByText(/No complete computation snapshot/i).first()).toBeVisible();
    // The redesign shows only valid actions — with no snapshot, Prepare is not offered.
    await expect(page.getByRole("button", { name: "Prepare review pack" })).toHaveCount(0);
  });

  // Item 5, 6: complete snapshot enables Prepare; prepared review shows the bound snapshot.
  test("complete snapshot enables Prepare; prepared review binds the snapshot", async ({ page }) => {
    await page.goto(primaryReviewUrl);
    await page.getByRole("button", { name: "Prepare review pack" }).click();
    await expectReconciled(page, "Review pack prepared ✓");
    await page.reload();
    await expect(page.getByText("Review pack prepared and bound to the latest complete snapshot")).toBeVisible();
    // Bound snapshot id is shown in the record (also equals latest complete → 2 cells).
    await expect(page.getByText(snapshotAId, { exact: false }).first()).toBeVisible();
    const state = await readReviewState(primaryTaxCaseId);
    expect(state?.client_review_status).toBe("prepared");
    expect(state?.client_review_snapshot_id).toBe(snapshotAId);
  });

  // Item 7: Mark as Sent works.
  test("Mark as sent records sent state", async ({ page }) => {
    await page.goto(primaryReviewUrl);
    await page.getByRole("button", { name: "Mark review sent" }).click();
    await expectReconciled(page, "Marked as sent ✓");
    const state = await readReviewState(primaryTaxCaseId);
    expect(state?.client_review_status).toBe("sent");
    expect(state?.client_review_sent_at).not.toBeNull();
  });

  // Item 8, 9: approval requires method + reference; credential/PAN-like rejected.
  test("approval requires a reference and rejects sensitive text", async ({ page }) => {
    await page.goto(primaryReviewUrl);
    await page.getByRole("button", { name: "Capture client approval" }).click();
    // Empty reference → rejected.
    await page.getByRole("button", { name: "Save confirmation" }).click();
    await expect(page.getByText(/at least 3 characters/i)).toBeVisible();
    // Credential-like → rejected.
    await page.getByLabel("Approval reference").fill("client portal password is hunter2");
    await page.getByRole("button", { name: "Save confirmation" }).click();
    await expect(page.getByText(/credential/i)).toBeVisible();
    // PAN-like → rejected.
    await page.getByLabel("Approval reference").fill("PAN ABCDE1234F confirmed");
    await page.getByRole("button", { name: "Save confirmation" }).click();
    await expect(page.getByText(/PAN/i).first()).toBeVisible();
  });

  // Item 12, 13: approval captured for current snapshot; confirmation wording shows.
  // K3-32B: approval now binds to an accepted-evidence manifest — generate one
  // (explicit regime selection, never defaulted) before capturing approval.
  test("valid approval is captured for the current snapshot", async ({ page }) => {
    await page.goto(primaryReviewUrl);
    await page.getByLabel("New regime").check();
    await page.getByRole("button", { name: "Generate manifest" }).click();
    await reconcileForFreshUi(page, "Evidence manifest generated ✓");
    await page.getByRole("button", { name: "Capture client approval" }).click();
    await page.getByLabel("Approval method").selectOption("whatsapp");
    await page.getByLabel("Approval reference").fill("Confirmed by WhatsApp on 10 Jul 2026.");
    await page.getByRole("button", { name: "Save confirmation" }).click();
    await expectReconciled(page, "Client approval captured ✓");
    await page.reload();
    await expect(page.getByText("Staff-recorded client confirmation").first()).toBeVisible();
    await expect(page.getByText("Confirmed by WhatsApp on 10 Jul 2026.")).toBeVisible();
    const state = await readReviewState(primaryTaxCaseId);
    expect(state?.client_review_status).toBe("approved");
    expect(state?.client_approval_method).toBe("whatsapp");
    expect(state?.client_review_snapshot_id).toBe(snapshotAId);
  });

  // Item 18: no PAN / Aadhaar / notes / storage URLs render on the review page.
  test("no PAN / Aadhaar / storage URLs render", async ({ page }) => {
    await page.goto(primaryReviewUrl);
    const body = (await page.locator("body").innerText()).replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      "",
    );
    expect(body).not.toMatch(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/); // PAN
    expect(body).not.toMatch(/\b\d{12}\b/); // Aadhaar-like
    expect(body.toLowerCase()).not.toContain("aadhaar");
    expect(body).not.toMatch(/https?:\/\/[^\s]*\/storage\//);
  });

  // Item 14: a newer snapshot makes the old approval stale.
  test("a newer complete snapshot makes approval out of date", async ({ page }) => {
    await seedSnapshot(primaryTaxCaseId, { complete: true, createdAt: new Date().toISOString() });
    await page.goto(primaryReviewUrl);
    await expect(page.getByText(/out of date/i).first()).toBeVisible();
    // Approval record still preserved (old reference visible).
    await expect(page.getByText("Confirmed by WhatsApp on 10 Jul 2026.")).toBeVisible();
  });

  // Item 15: preparing the latest snapshot again preserves old audit history.
  test("re-preparing the latest snapshot keeps prior audit history", async ({ page }) => {
    const approvedBefore = await countAudit(primaryCaseId, "tax_client_review.approved");
    expect(approvedBefore).toBeGreaterThanOrEqual(1);
    await page.goto(primaryReviewUrl);
    await page.getByRole("button", { name: "Prepare latest snapshot again" }).click();
    await expectReconciled(page, "Review pack prepared ✓");
    // The earlier approval audit event is NOT deleted.
    expect(await countAudit(primaryCaseId, "tax_client_review.approved")).toBe(approvedBefore);
    expect(await countAudit(primaryCaseId, "tax_client_review.prepared")).toBeGreaterThanOrEqual(2);
  });

  // Item 16: changes-requested status works.
  test("record changes requested sets the changes_requested status", async ({ page }) => {
    await page.goto(primaryReviewUrl);
    await page.getByRole("button", { name: "Record changes requested" }).click();
    await page.getByLabel("Changes summary").fill("Update salary from the revised Form 16.");
    await page.getByRole("button", { name: "Save requested changes" }).click();
    await expectReconciled(page, "Changes requested recorded ✓");
    const state = await readReviewState(primaryTaxCaseId);
    expect(state?.client_review_status).toBe("changes_requested");
  });

  // Item 10: open validation error blocks approval.
  test("open validation error blocks approval", async ({ page }) => {
    await page.goto(errUrl);
    await page.getByRole("button", { name: "Prepare review pack" }).click();
    await expectReconciled(page, "Review pack prepared ✓");
    await page.reload();
    await expect(page.getByText(/Open validation errors prevent approval/i).first()).toBeVisible();
    // Blocked → the approval action is not offered.
    await expect(page.getByRole("button", { name: "Capture client approval" })).toHaveCount(0);
  });

  // Item 11: resolving the error allows approval.
  test("resolving the error allows approval", async ({ page }) => {
    await resolveFindingDirect(errFindingId);
    await page.goto(errUrl);
    await page.getByLabel("New regime").check();
    await page.getByRole("button", { name: "Generate manifest" }).click();
    await reconcileForFreshUi(page, "Evidence manifest generated ✓");
    await page.getByRole("button", { name: "Capture client approval" }).click();
    await page.getByLabel("Approval reference").fill("Confirmed by phone after fixing the finding.");
    await page.getByRole("button", { name: "Save confirmation" }).click();
    await expectReconciled(page, "Client approval captured ✓");
    const state = await readReviewState(errTaxCaseId);
    expect(state?.client_review_status).toBe("approved");
  });

  // Item 20, OPS-13: each route owns one test budget. The old four-navigation
  // chain was a measured 45-second cliff even though every route was healthy.
  test("Documents route still opens", async ({ page }) => {
    await page.goto(`/tax-desk/cases/${primaryTaxCaseId}/documents`);
    await expect(page.getByText("ITR preparation checklist")).toBeVisible();
  });

  test("Ledgers route still opens", async ({ page }) => {
    await page.goto(`/tax-desk/cases/${primaryTaxCaseId}/ledgers`);
    await expect(page.getByRole("heading", { name: /Ledgers —/ })).toBeVisible();
  });

  test("Computation route still opens", async ({ page }) => {
    await page.goto(`/tax-desk/cases/${primaryTaxCaseId}/computation`);
    await expect(page.getByRole("heading", { name: /Computation —/ })).toBeVisible();
  });

  test("Validation route still opens", async ({ page }) => {
    await page.goto(`/tax-desk/cases/${primaryTaxCaseId}/validation`);
    await expect(page.getByRole("heading", { name: /Validation —/ })).toBeVisible();
  });

  // Single authoritative field: detail, cases list, dashboard metric and the
  // Client Review page all reflect client_review_status (legacy field stays
  // 'not_sent'), across prepared / sent / approved / changes_requested.
  // MAINT-06: this was ONE test doing eleven full page navigations inside the
  // suite's 45s per-test budget. It measured 18.4s locally and 33-46s hosted —
  // 74-102% of budget — so ordinary hosted latency, with no dev-server restart,
  // tipped it over and reported `page.goto: Test timeout` (the TEST budget
  // expiring with a navigation in flight, NOT a 45s navigation). It is split by
  // subject; every assertion is preserved and the budget is untouched.
  // Each review status drives a distinct derived next-action in the queue row AND
  // a humanized status on the review page — both from client_review_status. Split
  // BY SURFACE so each test makes four navigations rather than eight: a two-way
  // split still projected to 45.1s hosted worst case (16.0s local x the 2.82x
  // ratio measured against run 31198885514), i.e. straight back onto the cliff.
  const REVIEW_STATUS_CASES: [string, RegExp, RegExp][] = [
    ["prepared", /prepared/i, /Send review to client/i],
    ["sent", /sent/i, /Awaiting client response/i],
    ["approved", /approved/i, /Check filing readiness/i],
    ["changes_requested", /changes requested/i, /Apply requested changes/i],
  ];

  test("client_review_status drives the cases-list derived next action", async ({ page }) => {
    const c = await seedTaxCase({ itrTypeSelected: "ITR-1", income: [{ income_head: "salary", amount: 750000 }] });
    const snap = await seedSnapshot(c.taxCaseId, { complete: true });

    for (const [status, , listRx] of REVIEW_STATUS_CASES) {
      await setReviewStatus(c.taxCaseId, status, snap);
      await page.goto("/tax-desk/cases");
      const row = page.locator("tr", { hasText: c.clientName });
      await expect(row).toContainText(listRx);
    }
  });

  test("client_review_status drives the Client Review page status", async ({ page }) => {
    const c = await seedTaxCase({ itrTypeSelected: "ITR-1", income: [{ income_head: "salary", amount: 750000 }] });
    const snap = await seedSnapshot(c.taxCaseId, { complete: true });

    for (const [status, pageRx] of REVIEW_STATUS_CASES) {
      await setReviewStatus(c.taxCaseId, status, snap);
      await page.goto(`/tax-desk/cases/${c.taxCaseId}/review`);
      await expect(page.getByText(pageRx).first()).toBeVisible();
    }
  });

  test("dashboard 'Awaiting client' metric tracks client_review_status='sent'", async ({ page }) => {
    const c = await seedTaxCase({ itrTypeSelected: "ITR-1", income: [{ income_head: "salary", amount: 750000 }] });
    const snap = await seedSnapshot(c.taxCaseId, { complete: true });

    const readMetric = async (): Promise<number> => {
      await page.goto("/tax-desk");
      // K.2.8.5 dashboard: the "Awaiting client" attention tile tracks
      // client_review_status='sent' (same underlying count as the old
      // "Client approval pending" card).
      const tile = page.getByRole("link").filter({ hasText: "Awaiting client" });
      const txt = await tile.locator(".tnum").first().innerText();
      return parseInt(txt.trim(), 10);
    };

    // Dashboard "Client approval pending" tracks client_review_status='sent'
    // transitions (delta is caused solely by this case; workers=1 serial).
    await setReviewStatus(c.taxCaseId, "approved", snap);
    const base = await readMetric();
    await setReviewStatus(c.taxCaseId, "sent", snap);
    expect(await readMetric()).toBe(base + 1);
    await setReviewStatus(c.taxCaseId, "approved", snap);
    expect(await readMetric()).toBe(base);
  });
});
