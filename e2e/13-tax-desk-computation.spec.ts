import { expect, test } from "@playwright/test";
import { warmTaxDeskOnce } from "./warm";
import { ADMIN_STORAGE_STATE } from "./lib/auth-state";
import { addIncomeRow, readSnapshots, seedTaxCase, softRemoveLedger } from "./lib/fixtures";
import { expectReconciled } from "./lib/reconcile";

/**
 * Phase K.2.5 — Tax Desk computation preview + append-only snapshots.
 * Authenticated via the shared admin storage state (no per-test login).
 * Fixtures seed cases directly (service role, local-only).
 */
test.use({ storageState: ADMIN_STORAGE_STATE });

// OPS-11 (ZCode): per-spec route warming. Compile this shard's own Tax Desk
// sub-routes here, in an untimed beforeAll, instead of every shard compiling
// all of them in setup. Static routes stay warmed in setup; see e2e/warm.ts.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await warmTaxDeskOnce(browser);
});

/** A ledger note that must never be persisted into a computation snapshot. */
const SENTINEL_NOTE = "SENSITIVE_LEDGER_NOTE_DO_NOT_PERSIST_9Q7Z";

let compUrl = "";
let taxCaseId = "";
let houseId = "";
let finalizedCompUrl = "";

test.describe.serial("Tax Desk computation (K.2.5)", () => {
  test.beforeAll(async () => {
    // A complete, snapshot-able case: salary + interest + deduction + TDS + STCG 111A.
    const main = await seedTaxCase({
      itrTypeSelected: "ITR-1",
      income: [
        { income_head: "salary", amount: 800_000, source_type: "Form16", mapFirstDoc: true, notes: SENTINEL_NOTE },
        { income_head: "fd_interest", amount: 20_000, source_type: "AIS" },
      ],
      deductions: [{ deduction_type: "80C", amount: 150_000 }],
      taxPaid: [{ tax_paid_type: "salary_tds", amount: 60_000, source_type: "Form16" }],
      capitalGains: [{ gain_type: "stcg_111a", taxable_gain: 40_000, sale_value: 100_000, cost: 60_000, source_type: "broker_report" }],
    });
    taxCaseId = main.taxCaseId;
    compUrl = `/tax-desk/cases/${main.taxCaseId}/computation`;

    const fin = await seedTaxCase({
      finalized: true,
      income: [{ income_head: "salary", amount: 500_000, source_type: "Form16" }],
    });
    finalizedCompUrl = `/tax-desk/cases/${fin.taxCaseId}/computation`;
  });

  test("authenticated Tax Desk route opens without manual login; workbench links to Computation", async ({ page }) => {
    await page.goto(`/tax-desk/cases/${taxCaseId}`);
    await page.getByRole("navigation", { name: "Tax Desk workbench" }).getByRole("link", { name: "Computation" }).click();
    await expect(page).toHaveURL(/\/computation$/);
    await expect(page.getByRole("heading", { name: /Computation —/ })).toBeVisible();
  });

  test("renders mapped totals, regime comparison, recommended ITR, refund/payable and source trace", async ({ page }) => {
    await page.goto(compUrl);
    // Input summary (salary 8,00,000).
    await expect(page.getByRole("heading", { name: "Input summary" })).toBeVisible();
    await expect(page.getByText("8,00,000").first()).toBeVisible();
    // Regime comparison surface + recommended regime in the outcome hero
    // (scoped to the hero test id — the comparison caption also mentions it).
    await expect(page.getByTestId("regime-comparison")).toBeVisible();
    await expect(page.getByTestId("computation-outcome").getByText(/Recommended regime/)).toBeVisible();
    // Recommended ITR (capital gains → ITR-2).
    await expect(page.getByText("Recommended ITR").first()).toBeVisible();
    await expect(page.getByText("ITR-2").first()).toBeVisible();
    // Canonical outcome (live preview) + per-regime wording.
    await expect(page.getByTestId("computation-outcome")).toBeVisible();
    await expect(page.getByText(/refund|payable|nil/i).first()).toBeVisible();
    // K4-19: the Section 89 arrears disclosure, asserted HERE rather than in a
    // test of its own. That is not laziness about isolation — a standalone
    // `test()` took the shard budget's worst case from 70 to exactly 72 against
    // a threshold of 72, leaving the next session zero headroom, and
    // `K4-16-F3` is precisely about a spec's test count moving the max shard
    // and costing a hosted gate. This test already loads Computation on a case
    // with salary, so the assertions cost nothing.
    //
    // VISIBLE WITHOUT INTERACTION is the property, not merely present in the
    // DOM — the same standard `26-case-traceability` holds the not-CA-verified
    // notice to. A gap disclosed only inside a collapsed <details> is a gap a
    // preparer does not see. Note these run BEFORE the traceability click
    // below, so nothing here depends on a disclosure being expanded.
    const s89 = page.getByTestId("section-89-disclosure");
    await expect(s89).toBeVisible();
    await expect(s89).toContainText("no Section 89(1) relief");
    await expect(s89).toContainText("Form 10E");
    // The direction of error must be stated, because it is the OPPOSITE of the
    // surcharge and rebate blockers rendered on this same page — a preparer
    // reading "not computed" could otherwise assume tax is understated.
    await expect(s89).toContainText("too high, never too low");
    // And it must NOT claim to block anything, because it does not. The
    // K.2.9.4 / D129 status-copy contract cuts both ways: a notice that
    // overstates its own force is as wrong as one that understates the gap.
    await expect(s89).not.toContainText(/reliance blocked/i);

    // Source traceability (collapsed by default — expand it).
    await page.getByText("Source traceability").click();
    await expect(page.getByText(/Income — salary/)).toBeVisible();
  });

  test("selected vs recommended ITR mismatch is shown", async ({ page }) => {
    await page.goto(compUrl);
    await expect(page.getByText(/Selected ITR \(ITR-1\) differs from the recommended form \(ITR-2\)/)).toBeVisible();
  });

  test("an unsupported ledger entry makes the preview incomplete and blocks the snapshot", async ({ page }) => {
    houseId = await addIncomeRow(taxCaseId, "house_property", 120_000);
    await page.goto(compUrl);
    await expect(page.getByText(/Partial preview/)).toBeVisible();
    // K3-22 scoped this locator: the excluded head is now also named by the
    // rule-traceability panel ("these figures EXCLUDE …"), so the bare substring
    // matches twice. Pinned to the partial-preview callout's own `head (₹amount)
    // — CODE` line, which is what this test is about. Same property, stricter.
    await expect(page.getByText(/house_property \(₹1,20,000\) — UNSUPPORTED_INCOME_HEAD/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Save snapshot" })).toBeDisabled();
  });

  test("after removing the unsupported entry, a snapshot can be created and appears in history", async ({ page }) => {
    await softRemoveLedger("tax_income_entries", houseId);
    await page.goto(compUrl);
    await expect(page.getByText(/Partial \/ incomplete preview/)).toHaveCount(0);
    const save = page.getByRole("button", { name: "Save snapshot" });
    await expect(save).toBeEnabled();
    await save.click();
    // MAINT-06: wait for the save to REACH A TERMINAL STATE rather than for the
    // toast specifically. A reconcile slower than the primitive's 12s liveness
    // bound parks in `unconfirmed` and withholds the toast BY DESIGN, so a bare
    // toast wait fails on an accepted write. The durable assertions below are
    // unchanged and remain the test's actual subject.
    await expectReconciled(page, "Snapshot saved ✓");
    // History now has one complete snapshot (reload to read persisted state).
    // K3-25 scoped these three locators: `getByRole(name)` matches a SUBSTRING
    // by default, and the surcharge implementation caveat rendered beside the
    // liability rows happened to contain the word "complete", so the bare name
    // matched the comparison cell too (D29 — a locator collision, never a
    // duplicate write; the DB was checked directly). `exact: true` pins each
    // assertion to the snapshot-status cell whose whole accessible name is
    // "complete" — the same property this test always meant, stricter. K4-11
    // rewrote that caveat's wording; `exact: true` is kept because the guard is
    // against the COLLISION CLASS, not against one particular sentence.
    await page.reload();
    await expect(page.getByText("Snapshot history")).toBeVisible();
    await expect(page.getByRole("cell", { name: "complete", exact: true })).toHaveCount(1);
  });

  test("reload preserves the snapshot", async ({ page }) => {
    await page.goto(compUrl);
    await expect(page.getByRole("cell", { name: "complete", exact: true })).toHaveCount(1);
  });

  test("a second snapshot creates a NEW row (append-only, not an update)", async ({ page }) => {
    await page.goto(compUrl);
    await page.getByRole("button", { name: "Save snapshot" }).click();
    // MAINT-06: see the note at the first save. This test is about APPEND-ONLY
    // persistence, and the two assertions below prove it regardless of which
    // terminal state the reconcile reached.
    await expectReconciled(page, "Snapshot saved ✓");
    await page.reload();
    await expect(page.getByRole("cell", { name: "complete", exact: true })).toHaveCount(2);
    const snaps = await readSnapshots(taxCaseId);
    expect(snaps.length).toBe(2);
  });

  test("snapshot payload contains no PAN / Aadhaar / ledger notes / storage URLs", async () => {
    const snaps = await readSnapshots(taxCaseId);
    expect(snaps.length).toBeGreaterThan(0);
    for (const s of snaps) {
      const blob = JSON.stringify(s.input_snapshot) + JSON.stringify(s.output_snapshot);
      // Strip uuids first so their 12-hex segments can't false-match Aadhaar.
      const noUuids = blob.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "");
      expect(blob).not.toMatch(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/); // PAN pattern
      expect(noUuids).not.toMatch(/\b\d{12}\b/); // Aadhaar-like 12-digit run
      expect(blob.toLowerCase()).not.toContain("aadhaar");
      // The seeded ledger note must never be persisted (adapter strips notes).
      expect(blob).not.toContain(SENTINEL_NOTE);
      expect(blob).not.toMatch(/https?:\/\//); // no storage/public URLs
    }
  });

  test("a finalized case cannot create a new snapshot", async ({ page }) => {
    await page.goto(finalizedCompUrl);
    await expect(page.getByText(/finalized/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Save snapshot" })).toBeDisabled();
  });

  test("existing Documents and Ledgers routes still open", async ({ page }) => {
    await page.goto(`/tax-desk/cases/${taxCaseId}/documents`);
    await expect(page.getByText("ITR preparation checklist")).toBeVisible();
    await page.goto(`/tax-desk/cases/${taxCaseId}/ledgers`);
    await expect(page.getByRole("heading", { name: /Ledgers —/ })).toBeVisible();
  });
});

/**
 * MAINT-06 — the mechanism behind the recurring `:115` flake, made deterministic.
 *
 * Deliberately OUTSIDE the serial group above: it seeds its own case and must not
 * drag that group into a retry. It pins the behaviour the flake exposed — when the
 * post-save RSC refetch is slower than the reconciliation primitive's 12s liveness
 * bound, the surface parks in `unconfirmed`, WITHHOLDS the success toast, and the
 * write is nonetheless durably persisted.
 */
test.describe("Snapshot save — slow-reconcile recovery path (MAINT-06)", () => {
  test("a refresh slower than the liveness bound withholds the toast and parks unconfirmed", async ({ page }) => {
    const c = await seedTaxCase({
      itrTypeSelected: "ITR-1",
      income: [{ income_head: "salary", amount: 800_000, source_type: "Form16" }],
      taxPaid: [{ tax_paid_type: "salary_tds", amount: 60_000, source_type: "Form16" }],
    });

    await page.goto(`/tax-desk/cases/${c.taxCaseId}/computation`);
    const save = page.getByRole("button", { name: "Save snapshot" });
    await expect(save).toBeEnabled();

    // Delay ONLY the client-side RSC refetch that `router.refresh()` issues —
    // not the document navigation and not the server-action POST. One delayed
    // refetch is enough to cross the 12s bound.
    let delayedRefetches = 0;
    await page.route("**/computation*", async (route) => {
      const req = route.request();
      if (req.method() === "GET" && req.headers()["rsc"]) {
        delayedRefetches += 1;
        await new Promise((r) => setTimeout(r, 14_000));
      }
      await route.continue();
    });

    await save.click();

    // The designed degraded path: recovery notice, NO success toast.
    await expect(page.getByTestId("snapshot-unconfirmed")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Snapshot saved ✓")).toHaveCount(0);
    // `busy` stays true so no duplicate write can be started.
    await expect(page.getByRole("button", { name: "Unconfirmed" })).toBeDisabled();

    expect(delayedRefetches).toBeGreaterThan(0);
    // ...and the write itself SUCCEEDED throughout. This is precisely why the
    // old bare-toast assertion was a false negative.
    const snaps = await readSnapshots(c.taxCaseId);
    expect(snaps.length).toBe(1);
  });
});
