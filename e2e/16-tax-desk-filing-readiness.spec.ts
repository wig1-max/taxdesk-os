import { expect, test, type Page } from "@playwright/test";
import { warmTaxDeskOnce } from "./warm";
import { ADMIN_STORAGE_STATE, STAFF_STORAGE_STATE } from "./lib/auth-state";
import {
  approveReview,
  countAudit,
  readFinalizationState,
  readReadinessItems,
  readReviewState,
  readSnapshots,
  seedOpenFinding,
  seedReadinessCase,
  serviceClient,
} from "./lib/fixtures";
import { expectReconciled, reconcileForFreshUi } from "./lib/reconcile";

/**
 * Phase K.2.8 — Tax Desk Filing Readiness: the audited finalize → reopen
 * LIFECYCLE, carried by one case seeded in `beforeAll`.
 *
 * These thirteen tests genuinely share ordered state and MUST stay
 * `test.describe.serial`: the case is finalized, read back, reopened and
 * re-finalized in sequence, and one pair is coupled tighter still — "finalize
 * is rejected server-side" ADDS an open error finding that "finalization
 * requires a note" then resolves.
 *
 * The eighteen tests that seeded their own case and read none of this state —
 * the per-blocker matrix and the finalized-case server-side mutation guards —
 * moved to `16b-tax-desk-readiness-blockers.spec.ts` at `K4-15-F6`. Assertions
 * were carried across unchanged, verified line-by-line.
 *
 * READ THIS BEFORE ASSUMING THE SPLIT BOUGHT SHARD HEADROOM — IT DID NOT.
 * `K4-15-F6` predicted the max shard would fall from 31 to ~16 because this
 * file "IS the max shard by itself" (measured: shard 5/11 did contain nothing
 * else). Re-measured after the split, the max shard is STILL 31 — shard 5 now
 * holds both halves, 13 + 18. Max FILE is a LOWER BOUND on max shard, not an
 * equality: Playwright partitions files by a sequential greedy over NAME order,
 * so removing a big file just lets its neighbours refill the shard. Placement
 * proved this — parked at `35-` the same 18 tests packed with the tail specs to
 * 32, WORSE than before.
 *
 * What the split did buy is retry blast radius, and that is the real budget
 * lever. A `describe.serial` group retries WHOLE on any failure, so one flake
 * here used to re-execute all 31 tests; now it re-executes 13 (this file) or 1
 * (the non-serial sibling).
 *
 * Portable local-only fixtures; shared admin auth state.
 */
test.use({ storageState: ADMIN_STORAGE_STATE });

// OPS-11 (ZCode): per-spec route warming. Compile this shard's own Tax Desk
// sub-routes here, in an untimed beforeAll, instead of every shard compiling
// all of them in setup. Static routes stay warmed in setup; see e2e/warm.ts.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await warmTaxDeskOnce(browser);
});

const readinessUrl = (id: string) => `/tax-desk/cases/${id}/readiness`;
const finalizeDisabled = (page: Page) =>
  expect(page.getByRole("button", { name: "Finalize internal preparation" })).toBeDisabled();
const finalizeEnabled = (page: Page) =>
  expect(page.getByRole("button", { name: "Finalize internal preparation" })).toBeEnabled();

test.describe.serial("Tax Desk filing readiness (K.2.8)", () => {
  let lcId = ""; // lifecycle case (eligible → finalize → reopen)
  let lcCaseId = "";
  let lcSnapshotId = "";

  test.beforeAll(async () => {
    const lc = await seedReadinessCase({ approve: true, validationRun: true, docs: "satisfied" });
    lcId = lc.taxCaseId;
    lcCaseId = lc.caseId;
    lcSnapshotId = lc.snapshotId!;
  });

  // 2, 3: route opens + workbench link.
  test("authenticated readiness route opens; workbench links to it", async ({ page }) => {
    await page.goto(`/tax-desk/cases/${lcId}`);
    await page
      .getByRole("navigation", { name: "Tax Desk workbench" })
      .getByRole("link", { name: "Filing Readiness" })
      .click();
    await expect(page).toHaveURL(/\/readiness$/);
    await expect(page.getByRole("heading", { name: /Filing Readiness —/ })).toBeVisible();
    await expect(page.getByText(/It does not file the return, authorize e-filing/i)).toBeVisible();
  });

  // 16: eligible case is ready.
  test("fully eligible case is ready for internal finalization", async ({ page }) => {
    await page.goto(readinessUrl(lcId));
    await expect(page.getByText("Ready for internal finalization").first()).toBeVisible();
    await finalizeEnabled(page);
  });

  // 17: repeated refresh does not duplicate readiness items.
  test("repeated readiness refresh does not duplicate items", async ({ page }) => {
    await page.goto(readinessUrl(lcId));
    await page.getByRole("button", { name: "Save readiness result" }).click();
    await reconcileForFreshUi(page, "Readiness checks saved ✓");
    const first = await readReadinessItems(lcId);
    await page.getByRole("button", { name: "Refresh readiness" }).click();
    await expectReconciled(page, "Readiness checks saved ✓");
    const second = await readReadinessItems(lcId);
    expect(second.length).toBe(first.length);
    expect(new Set(second.map((i) => i.code)).size).toBe(second.length); // no dupes
    // 18 = the 12 K.2.8 readiness items + the K.2.8.9A eligibility.case_eligible
    // item + the TAX-SAFE-01 capability.surcharge_marginal_relief item + the
    // two K4-01 capability.senior_treatment_* items + K4-12's
    // capability.rebate_marginal_relief item (the SEPARATE section 87A
    // rebate-threshold relief, which is deliberately its own item rather than a
    // second reason folded into the surcharge one), plus K4-23's
    // capability.house_sale_ltcg item.
    expect(second.length).toBe(18);
  });

  // 19: finalize rejected server-side while blockers exist (button was enabled).
  test("finalize is rejected server-side when a blocker appears after load", async ({ page }) => {
    await page.goto(readinessUrl(lcId));
    await page.getByRole("button", { name: "Finalize internal preparation" }).click();
    await page.getByLabel("Finalization note").fill("Attempting to finalize this eligible case.");
    await page.getByRole("checkbox").check();
    // Introduce a blocker AFTER the form is open (server must recompute + reject).
    await seedOpenFinding(lcId, { severity: "error", findingKey: `race-${Date.now()}` });
    await page.getByRole("button", { name: "Finalize now" }).click();
    await expect(page.getByText(/Cannot finalize/i)).toBeVisible();
    const st = await readFinalizationState(lcId);
    expect(st?.finalized_at).toBeNull();
  });

  // 20, 21: note required + sensitive note rejected.
  test("finalization requires a note and rejects sensitive text", async ({ page }) => {
    // Remove the blocker added in the previous test so the case is eligible again.
    await serviceClient().from("tax_validation_findings").update({ status: "resolved" }).eq("tax_case_id", lcId).eq("severity", "error");

    await page.goto(readinessUrl(lcId));
    await page.getByRole("button", { name: "Finalize internal preparation" }).click();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Finalize now" }).click();
    await expect(page.getByText(/at least 10 characters/i)).toBeVisible();

    await page.getByLabel("Finalization note").fill("finalize; portal password is hunter2 secret");
    await page.getByRole("button", { name: "Finalize now" }).click();
    await expect(page.getByText(/credential/i)).toBeVisible();
  });

  // 22, 23, 24: eligible case finalizes; state persisted; filing_status unchanged.
  test("eligible case finalizes successfully and persists finalization state", async ({ page }) => {
    await page.goto(readinessUrl(lcId));
    await page.getByRole("button", { name: "Finalize internal preparation" }).click();
    await page.getByLabel("Finalization note").fill("Reviewed and internally finalized after client approval.");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Finalize now" }).click();
    await expectReconciled(page, "Internally finalized ✓");

    const st = await readFinalizationState(lcId);
    expect(st?.finalized_at).not.toBeNull();
    expect(st?.finalized_by).not.toBeNull();
    expect(st?.finalized_snapshot_id).toBe(lcSnapshotId);
    // filing_status is NOT set to filed.
    expect(st?.filing_status).not.toBe("filed");
    expect(st?.filing_status).toBe("not_started");
    // Audit event recorded.
    expect(await countAudit(lcCaseId, "tax_case.finalized")).toBeGreaterThanOrEqual(1);
  });

  // 25: finalized readiness page remains readable.
  test("finalized readiness page remains readable", async ({ page }) => {
    await page.goto(readinessUrl(lcId));
    await expect(page.getByText("Internally finalized").first()).toBeVisible();
    // Passed checks are collapsed by default — expand to read them.
    await page.getByTestId("passed-checks").click();
    await expect(page.getByText("Complete computation snapshot").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Finalize internal preparation" })).toHaveCount(0);
  });

  // 30, 31: reopen requires a reason + rejects sensitive reason.
  test("reopen requires a reason and rejects sensitive text", async ({ page }) => {
    await page.goto(readinessUrl(lcId));
    await page.getByRole("button", { name: "Reopen case" }).click();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Reopen now" }).click();
    await expect(page.getByText(/at least 10 characters/i)).toBeVisible();

    await page.getByLabel("Reopen reason").fill("reopen because client e-filing password changed");
    await page.getByRole("button", { name: "Reopen now" }).click();
    await expect(page.getByText(/credential/i)).toBeVisible();
  });

  // 32: unauthorized (staff) reopen is rejected at the server-action boundary —
  // reopen is admin-only. The Reopen control is HIDDEN from staff in the UI, so
  // we capture the real reopen server-action request from an admin session
  // (aborting it so nothing changes) and REPLAY it with a genuine bootstrapped
  // staff session's cookies. The server must reject it and leave state
  // unchanged. Uses real active users, no skip.
  test("staff cannot reopen — server rejects at the action boundary, no state change", async ({ browser }) => {
    const before = await readFinalizationState(lcId);
    const reopenAuditBefore = await countAudit(lcCaseId, "tax_case.reopened");
    expect(before?.finalized_at).not.toBeNull(); // lc is finalized at this point

    // Staff genuinely gets staff (not admin) permissions: the Reopen control is
    // not rendered for staff.
    const staffCtx = await browser.newContext({ storageState: STAFF_STORAGE_STATE });
    const staffPage = await staffCtx.newPage();
    await staffPage.goto(readinessUrl(lcId));
    await expect(staffPage.getByRole("heading", { name: /Filing Readiness —/ })).toBeVisible();
    await expect(staffPage.getByText(/Only an admin can reopen/i)).toBeVisible();
    await expect(staffPage.getByRole("button", { name: "Reopen case" })).toHaveCount(0);

    // Capture the real reopen action request from an ADMIN session, then abort
    // it (so the admin does NOT actually reopen).
    const adminCtx = await browser.newContext({ storageState: ADMIN_STORAGE_STATE });
    const adminPage = await adminCtx.newPage();
    await adminPage.goto(readinessUrl(lcId));
    await adminPage.getByRole("button", { name: "Reopen case" }).click();
    await adminPage.getByLabel("Reopen reason").fill("Boundary capture — must never apply.");
    await adminPage.getByRole("checkbox").check();

    let captured: { url: string; headers: Record<string, string>; body: string | null } | null = null;
    await adminPage.route("**/*", async (route) => {
      const req = route.request();
      if (req.method() === "POST" && req.headers()["next-action"]) {
        captured = { url: req.url(), headers: req.headers(), body: req.postData() };
        await route.abort();
      } else {
        await route.continue();
      }
    });
    await adminPage.getByRole("button", { name: "Reopen now" }).click();
    await expect.poll(() => captured !== null, { timeout: 15000 }).toBe(true);
    await adminCtx.close();
    // Admin's attempt was aborted → still finalized.
    expect((await readFinalizationState(lcId))?.finalized_at).toBe(before?.finalized_at);

    // Replay the SAME server-action request with the STAFF session's cookies.
    const cap = captured as unknown as { url: string; headers: Record<string, string>; body: string | null };
    const replayHeaders: Record<string, string> = { ...cap.headers };
    delete replayHeaders["cookie"]; // use the staff context cookie jar instead
    delete replayHeaders["content-length"];
    delete replayHeaders["host"];
    const res = await staffCtx.request.post(cap.url, { headers: replayHeaders, data: cap.body ?? "" });
    expect(await res.text()).toMatch(/Only an admin can reopen/i);
    await staffCtx.close();

    // Server rejected: finalized lock + review status intact, no audit event.
    const after = await readFinalizationState(lcId);
    expect(after?.finalized_at).toBe(before?.finalized_at);
    expect(after?.finalized_at).not.toBeNull();
    expect(after?.client_review_status).toBe(before?.client_review_status);
    expect(await countAudit(lcCaseId, "tax_case.reopened")).toBe(reopenAuditBefore);
  });

  // 33, 34, 35: valid reopen succeeds; approval superseded; history preserved.
  test("valid reopen succeeds, supersedes approval, preserves history", async ({ page }) => {
    const snapsBefore = (await readSnapshots(lcId)).length;
    const finalizedAudit = await countAudit(lcCaseId, "tax_case.finalized");

    await page.goto(readinessUrl(lcId));
    await page.getByRole("button", { name: "Reopen case" }).click();
    await page.getByLabel("Reopen reason").fill("Client sent a revised Form 16; reopening to update the return.");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Reopen now" }).click();
    await expectReconciled(page, "Case reopened ✓");

    const st = await readReviewState(lcId);
    expect(st?.client_review_status).toBe("superseded"); // approval superseded
    expect(st?.client_review_snapshot_id).toBe(lcSnapshotId); // binding retained
    expect(st?.client_approved_at).not.toBeNull(); // approval timestamp retained

    const fin = await readFinalizationState(lcId);
    expect(fin?.finalized_at).toBeNull(); // lock cleared
    expect(fin?.reopened_at).not.toBeNull();

    // History preserved: snapshots kept, prior finalize audit event intact.
    expect((await readSnapshots(lcId)).length).toBe(snapsBefore);
    expect(await countAudit(lcCaseId, "tax_case.finalized")).toBe(finalizedAudit);
    expect(await countAudit(lcCaseId, "tax_case.reopened")).toBeGreaterThanOrEqual(1);
  });

  // 36, 37: reopened case is not immediately ready; fresh approval required.
  test("reopened case is not ready until fresh approval; then re-finalizable", async ({ page }) => {
    await page.goto(readinessUrl(lcId));
    await expect(page.getByText(/Reopened — fresh/i).first()).toBeVisible();
    await finalizeDisabled(page);

    // Provide a fresh approval bound to the current latest complete snapshot.
    await approveReview(lcId, lcSnapshotId);
    await page.goto(readinessUrl(lcId));
    await finalizeEnabled(page);
  });

  // 38: no PAN / Aadhaar / storage URLs render on the readiness page.
  test("no PAN / Aadhaar / storage URLs render", async ({ page }) => {
    await page.goto(readinessUrl(lcId));
    const body = (await page.locator("body").innerText()).replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      "",
    );
    expect(body).not.toMatch(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/);
    expect(body).not.toMatch(/\b\d{12}\b/);
    expect(body.toLowerCase()).not.toContain("aadhaar");
    expect(body).not.toMatch(/https?:\/\/[^\s]*\/storage\//);
  });

  // 39: sibling routes still open.
  test("Documents, Ledgers, Computation, Validation and Client Review still open", async ({ page }) => {
    await page.goto(`/tax-desk/cases/${lcId}/documents`);
    await expect(page.getByText("ITR preparation checklist")).toBeVisible();
    await page.goto(`/tax-desk/cases/${lcId}/ledgers`);
    await expect(page.getByRole("heading", { name: /Ledgers —/ })).toBeVisible();
    await page.goto(`/tax-desk/cases/${lcId}/computation`);
    await expect(page.getByRole("heading", { name: /Computation —/ })).toBeVisible();
    await page.goto(`/tax-desk/cases/${lcId}/validation`);
    await expect(page.getByRole("heading", { name: /Validation —/ })).toBeVisible();
    await page.goto(`/tax-desk/cases/${lcId}/review`);
    await expect(page.getByRole("heading", { name: /Client Review —/ })).toBeVisible();
  });
});
