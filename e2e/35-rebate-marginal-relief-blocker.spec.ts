import { expect, test } from "@playwright/test";
import { warmTaxDeskOnce } from "./warm";
import { ADMIN_STORAGE_STATE } from "./lib/auth-state";
import { seedSnapshot, seedTaxCase } from "./lib/fixtures";
import { REBATE_87A } from "../src/lib/tax-engine/ay-2026-27/rules";
import { REBATE_RELIEF_WINDOW_UPPER_INR } from "../src/lib/tax-engine/ay-2026-27/rebate-relief";

/**
 * K4-12 — Section 87A REBATE-threshold marginal relief, and its structural
 * reliance blocker.
 *
 * This is a DIFFERENT relief from the one `29-surcharge-marginal-relief-blocker`
 * covers, sharing only the name, and it operates about ₹37,00,000 lower. The
 * two specs must not be merged: a case here has a perfectly complete SURCHARGE
 * treatment (a computed nil), and the point of several assertions below is that
 * it is never described as a surcharge problem.
 *
 * Proves the real UI/RPC path (not just the pure and DB layers already covered
 * by `rebate-relief.test.ts` and `tests/security/surcharge-marginal-relief-
 * blocker.mjs` `[S12]`):
 *   1. A case in the relief window that ALSO carries special-rate 111A/112A
 *      income is reliance-blocked on Computation, under 87A language.
 *   2. …and is NOT described as a surcharge failure.
 *   3. A case in the relief window with NO special-rate income is NOT blocked —
 *      the relief is computed, which is the capability this session shipped.
 *   4. A control case far below the ceiling is unaffected.
 *   5. A STORED snapshot inside the window that carries no engine verdict (what
 *      every pre-K4-12 snapshot looks like) is refused at client-review
 *      preparation — the fail-closed path, end to end.
 *
 * The income arithmetic is derived from the engine's own constants rather than
 * restated (the AUDIT-05-F6 lesson): the Computation page runs the LIVE engine,
 * where new-regime total income is salary − the ₹75,000 new-regime standard
 * deduction, while `seedSnapshot`'s STORED mock uses its own salary − 93,000
 * formula. Each figure below is tuned against the formula that actually reads
 * it, and both are asserted to land inside the window.
 */
test.use({ storageState: ADMIN_STORAGE_STATE });

// OPS-11 (ZCode): per-spec route warming. Compile this shard's own Tax Desk
// sub-routes here, in an untimed beforeAll, instead of every shard compiling
// all of them in setup. Static routes stay warmed in setup; see e2e/warm.ts.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await warmTaxDeskOnce(browser);
});

const CEILING = REBATE_87A.new.incomeLimit; // ₹12,00,000
const NEW_STD = 75000;
/** Live-engine salary putting new-regime total income at ₹12,20,000. */
const LIVE_SALARY_IN_WINDOW = 1220000 + NEW_STD;
/** Stored-snapshot salary putting the stored new-regime total at ₹12,07,000. */
const STORED_SALARY_IN_WINDOW = 1207000 + 93000;

test.describe.serial("Section 87A rebate-threshold marginal relief (K4-12)", () => {
  let ambiguousTaxCaseId = "";
  let reliefComputedTaxCaseId = "";
  let controlTaxCaseId = "";
  let storedNoVerdictTaxCaseId = "";

  test.beforeAll(async () => {
    // The window itself must be what this spec thinks it is.
    expect(1220000).toBeGreaterThan(CEILING);
    expect(1220000).toBeLessThanOrEqual(REBATE_RELIEF_WINDOW_UPPER_INR);
    expect(1207000).toBeGreaterThan(CEILING);
    expect(1207000).toBeLessThanOrEqual(REBATE_RELIEF_WINDOW_UPPER_INR);

    // BLOCKED: inside the window AND carrying special-rate 112A income, so the
    // engine refuses rather than picking between two lawful readings. Salary is
    // reduced by the gain so the TOTAL still lands at ₹12,20,000.
    const ambiguous = await seedTaxCase({
      itrTypeSelected: "ITR-2",
      income: [{ income_head: "salary", amount: 1100000 + NEW_STD, source_type: "Form16" }],
      capitalGains: [{ gain_type: "ltcg_112a", taxable_gain: 120000, source_type: "broker_report" }],
    });
    ambiguousTaxCaseId = ambiguous.taxCaseId;

    // NOT blocked: inside the window, no special-rate income — relief computed.
    const reliefComputed = await seedTaxCase({
      itrTypeSelected: "ITR-1",
      income: [{ income_head: "salary", amount: LIVE_SALARY_IN_WINDOW, source_type: "Form16" }],
    });
    reliefComputedTaxCaseId = reliefComputed.taxCaseId;

    // Control: far below the ceiling.
    const control = await seedTaxCase({
      itrTypeSelected: "ITR-1",
      income: [{ income_head: "salary", amount: 800000, source_type: "Form16" }],
    });
    controlTaxCaseId = control.taxCaseId;

    // Fail-closed: a STORED snapshot in the window with no 87A verdict.
    const storedNoVerdict = await seedTaxCase({
      itrTypeSelected: "ITR-1",
      income: [{ income_head: "salary", amount: STORED_SALARY_IN_WINDOW, source_type: "Form16" }],
    });
    storedNoVerdictTaxCaseId = storedNoVerdict.taxCaseId;
    await seedSnapshot(storedNoVerdict.taxCaseId, { salary: STORED_SALARY_IN_WINDOW });
  });

  test("a case in the relief window carrying special-rate income is reliance-blocked on Computation", async ({
    page,
  }) => {
    await page.goto(`/tax-desk/cases/${ambiguousTaxCaseId}/computation`);
    await expect(page.getByText("Provisional computation — reliance blocked")).toBeVisible();
    await expect(page.getByText(/Section 87A marginal relief could not be computed/i)).toBeVisible();
    // The safety DIRECTION is stated, not just the refusal: this relief being
    // withheld overstates tax, and a preparer must be told which way it errs.
    await expect(page.getByText(/NOT understated/i)).toBeVisible();
  });

  test("…and it is not described as a surcharge failure — the two reliefs share only the name", async ({ page }) => {
    await page.goto(`/tax-desk/cases/${ambiguousTaxCaseId}/computation`);
    await expect(page.getByText(/Surcharge and marginal relief could not be computed/i)).toHaveCount(0);
  });

  test("a case in the relief window with NO special-rate income is NOT blocked — the relief is computed", async ({
    page,
  }) => {
    await page.goto(`/tax-desk/cases/${reliefComputedTaxCaseId}/computation`);
    await expect(page.getByText("Provisional computation — reliance blocked")).toHaveCount(0);
  });

  test("a control case far below the rebate ceiling is unaffected", async ({ page }) => {
    await page.goto(`/tax-desk/cases/${controlTaxCaseId}/computation`);
    await expect(page.getByText("Provisional computation — reliance blocked")).toHaveCount(0);
  });

  test("a pre-K4-12 stored snapshot inside the window fails CLOSED at client-review preparation", async ({ page }) => {
    await page.goto(`/tax-desk/cases/${storedNoVerdictTaxCaseId}/review`);
    await page.getByRole("button", { name: "Prepare review pack" }).click();
    const alert = page.getByRole("alert").filter({ hasText: /section 87A/i });
    await expect(alert).toContainText(/not approval-ready/i);
    // The SAFETY DIRECTION, which is the part a preparer must not be left to
    // guess: withholding this relief overstates tax, it does not understate it.
    await expect(alert).toContainText(/NOT understated/i);
    // The blocker CODE is deliberately NOT asserted here. It is surfaced by the
    // guarded RPC, and the TypeScript gate short-circuits first — correct
    // defense-in-depth ordering, so the code never reaches this alert. The code
    // itself is pinned at the layer that does emit it, in
    // `tests/security/surcharge-marginal-relief-blocker.mjs` `[S12a]`.
  });
});
