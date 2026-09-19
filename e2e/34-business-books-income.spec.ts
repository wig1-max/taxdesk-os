import { expect, test } from "@playwright/test";
import { warmTaxDeskOnce } from "./warm";
import { ADMIN_STORAGE_STATE } from "./lib/auth-state";
import { seedTaxCase } from "./lib/fixtures";

/**
 * K4-14 — books-based business/professional income (Sections 28/29).
 *
 * Wave-4 slice #6, slice 1. Two live paths are asserted end to end because
 * they are the two the whole slice turns on:
 *
 *  1. the ADMITTED case — a declared-adjustment-free books row computes, is
 *     traced to its pack rule, and steers the return form to ITR-3;
 *  2. the REFUSED case — a row whose books need Sections 30-43D work is
 *     excluded with its own named reason, and the case is NOT computed.
 *
 * The second matters more. `K4-13` exists because a presumptive path failed
 * OPEN, and "revenue minus expenses" with an unasked depreciation question is
 * the same failure in different clothes. A test that only proved the happy
 * path would not notice that returning.
 */

const BOOKS_ADMITTED = {
  revenue: 3_000_000,
  expenses: 2_400_000,
  adjustments: "none_s30_43d",
  activity_classification: "ordinary_business_or_profession",
};

test.use({ storageState: ADMIN_STORAGE_STATE });

// OPS-11 (ZCode): per-spec route warming. Compile this shard's own Tax Desk
// sub-routes here, in an untimed beforeAll, instead of every shard compiling
// all of them in setup. Static routes stay warmed in setup; see e2e/warm.ts.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await warmTaxDeskOnce(browser);
});

test.describe("K4-14 books-based business income", () => {
  test("an adjustment-free books row computes, is traced, and steers to ITR-3", async ({ page }) => {
    const c = await seedTaxCase({
      itrTypeSelected: "ITR-1",
      income: [{ income_head: "salary", amount: 500_000, source_type: "Form16" }],
      businessBooks: [BOOKS_ADMITTED],
    });

    await page.goto(`/tax-desk/cases/${c.taxCaseId}/ledgers`);
    await expect(page.getByRole("tab", { name: /Business \(books\)/ })).toBeVisible();

    await page.goto(`/tax-desk/cases/${c.taxCaseId}/computation`);
    // Net profit 30,00,000 - 24,00,000 = 6,00,000, and gross total income
    // 5,00,000 salary + 6,00,000 = 11,00,000.
    // The books line lives in the progressive-disclosure "full calculation"
    // section, exactly like every other per-regime detail figure.
    await page.getByText("View full calculation").click();
    const booksFigure = page.locator('[data-material-figure-id="detail.new.businessBooksIncome"]');
    await expect(booksFigure).toBeVisible();
    await expect(booksFigure).toContainText("6,00,000");

    // The figure is TRACED, not merely displayed: it must carry its pack rule.
    const panel = page.getByTestId("rule-traceability");
    await panel.getByText("Rule & evidence traceability").click();
    await expect(panel).toContainText("business_books_computation");

    await page.goto(`/tax-desk/cases/${c.taxCaseId}/validation`);
    await page.getByRole("button", { name: /Run validation/i }).click();
    // Wait for the RUN to complete before asserting anything it produces. The
    // button is a `useReconciledAction` surface that stays "Working…" until
    // fresh props land, so asserting a finding directly races the reconcile —
    // which is how the K4-15 sibling below failed under full-suite load while
    // passing in isolation. `Validation saved:` is the completion signal spec
    // 14 already waits on; a timeout here now says "the run did not finish"
    // rather than the misleading "the finding is missing".
    await expect(page.getByText(/Validation saved:/)).toBeVisible();
    // ITR-1 was selected deliberately: books-based income has exactly one
    // permissible form, so this is a blocker, not a note.
    // `.first()` because each finding legitimately appears twice — once as the
    // "Engine: CODE" title and once in the `engine.CODE · area · seen` line.
    // Two different elements, not a duplicate write (the D29 distinction).
    await expect(page.getByText("BUSINESS_BOOKS_REQUIRES_ITR3").first()).toBeVisible();
    // And the two disclosures that keep the number honest.
    await expect(page.getByText("BUSINESS_BOOKS_NET_PROFIT_APPLIED").first()).toBeVisible();
    await expect(page.getByText("BUSINESS_INCOME_REGIME_OPTION_10IEA").first()).toBeVisible();
  });

  test("a row needing Sections 30-43D work is REFUSED, with its own named reason", async ({ page }) => {
    const c = await seedTaxCase({
      itrTypeSelected: "ITR-3",
      income: [{ income_head: "salary", amount: 500_000, source_type: "Form16" }],
      businessBooks: [{ ...BOOKS_ADMITTED, adjustments: "depreciation_s32" }],
    });

    await page.goto(`/tax-desk/cases/${c.taxCaseId}/computation`);
    // The refusal is VISIBLE and specific — not a generic "incomplete".
    await expect(page.getByText(/BUSINESS_BOOKS_DEPRECIATION_UNSUPPORTED/)).toBeVisible();
    // And the ₹6,00,000 the row would have contributed must appear nowhere as
    // a computed business figure. This is the fail-open regression guard.
    await page.getByText("View full calculation").click();
    const booksFigure = page.locator('[data-material-figure-id="detail.new.businessBooksIncome"]');
    await expect(booksFigure).toBeVisible();
    await expect(booksFigure).not.toContainText("6,00,000");
  });

  test("an UNDECLARED adjustment basis refuses too — silence is not 'no adjustment'", async ({ page }) => {
    // The DB column is NOT NULL, so an undeclared basis cannot be seeded as
    // null; an unrecognised value is the reachable equivalent and takes the
    // same branch. Seeding it through the service client deliberately bypasses
    // the form validator, which is the point: the adapter must refuse on its
    // own, not because a Zod enum happened to catch it first.
    const c = await seedTaxCase({
      itrTypeSelected: "ITR-3",
      income: [{ income_head: "salary", amount: 500_000, source_type: "Form16" }],
      businessBooks: [{ ...BOOKS_ADMITTED, adjustments: "presumptive_transition" }],
    });

    await page.goto(`/tax-desk/cases/${c.taxCaseId}/computation`);
    await expect(page.getByText(/BUSINESS_BOOKS_PRESUMPTIVE_TRANSITION_UNSUPPORTED/)).toBeVisible();
  });
});

/**
 * K4-15 — several undertakings aggregated under the one Section 28 head.
 *
 * The same two paths as above, at the aggregate: the admitted case must sum,
 * and one bad record must refuse the WHOLE head rather than publishing a
 * partial total. The second is the one worth having live: a partial aggregate
 * is a number that looks right and is not the taxpayer's.
 */
test.describe("K4-15 aggregation across businesses", () => {
  test("two undertakings sum to the same figure one would have produced", async ({ page }) => {
    // Deliberately the SAME ₹6,00,000 as the single-business test above, split
    // 4,00,000 + 2,00,000. How the profit is split must not move the tax.
    const c = await seedTaxCase({
      itrTypeSelected: "ITR-1",
      income: [{ income_head: "salary", amount: 500_000, source_type: "Form16" }],
      businessBooks: [
        { revenue: 1_800_000, expenses: 1_400_000, adjustments: "none_s30_43d", activity_classification: "ordinary_business_or_profession", is_profession: false },
        { revenue: 1_200_000, expenses: 1_000_000, adjustments: "none_s30_43d", activity_classification: "ordinary_business_or_profession", is_profession: true },
      ],
    });

    await page.goto(`/tax-desk/cases/${c.taxCaseId}/computation`);
    await page.getByText("View full calculation").click();
    const booksFigure = page.locator('[data-material-figure-id="detail.new.businessBooksIncome"]');
    await expect(booksFigure).toBeVisible();
    await expect(booksFigure).toContainText("6,00,000");

    // Still traced to the same pack rule — aggregation introduced no new one.
    const panel = page.getByTestId("rule-traceability");
    await panel.getByText("Rule & evidence traceability").click();
    await expect(panel).toContainText("business_books_computation");

    // DELIBERATELY STOPS HERE — no second navigation to Validation.
    //
    // The first version of this test appended `goto(validation)` + "Run
    // validation" + a findings assertion, copying the single-business test
    // above. It passed in isolation and FAILED in the full suite: the page
    // showed `button "Working…" [disabled]` and "Last run: never" when the 15s
    // expect timeout fired — the reconciled action had not finished, not a
    // wrong result. That is the `D225` / `AUDIT-07-F6` latency class, whose
    // recorded prescription is to SPLIT THE CHAINS rather than raise the
    // timeout or add retries.
    //
    // The dropped assertion also duplicated coverage: the single-business test
    // already proves the three findings render end to end, and the property
    // that is SPECIFIC to several businesses — one set of findings for the
    // head, citing every row — is a pure-logic claim pinned far more precisely
    // by `validate-case.test.ts` ("several businesses raise ONE set of
    // findings, citing every row") than by a DOM substring. So this is a
    // shorter chain at no real loss, not coverage traded for a green run.
  });

  test("ONE refused record excludes the whole head — never a partial aggregate", async ({ page }) => {
    const c = await seedTaxCase({
      itrTypeSelected: "ITR-3",
      income: [{ income_head: "salary", amount: 500_000, source_type: "Form16" }],
      businessBooks: [
        { revenue: 1_800_000, expenses: 1_400_000, adjustments: "none_s30_43d", activity_classification: "ordinary_business_or_profession", is_profession: false },
        { revenue: 1_200_000, expenses: 1_000_000, adjustments: "depreciation_s32", activity_classification: "ordinary_business_or_profession", is_profession: false },
      ],
    });

    await page.goto(`/tax-desk/cases/${c.taxCaseId}/computation`);
    // The offending record reports its OWN reason...
    await expect(page.getByText(/BUSINESS_BOOKS_DEPRECIATION_UNSUPPORTED/)).toBeVisible();
    // ...and the clean sibling is told why it went too, rather than vanishing.
    await expect(page.getByText(/BUSINESS_BOOKS_SIBLING_ROW_REFUSED/)).toBeVisible();

    // The fail-open regression guard, at the aggregate: neither the good
    // record's ₹4,00,000 nor any partial total may appear as business income.
    await page.getByText("View full calculation").click();
    const booksFigure = page.locator('[data-material-figure-id="detail.new.businessBooksIncome"]');
    await expect(booksFigure).toBeVisible();
    await expect(booksFigure).not.toContainText("4,00,000");
    await expect(booksFigure).not.toContainText("6,00,000");
  });
});

/**
 * K4-17 — current-year Section 70(1) intra-head set-off. This is one focused
 * browser path through all three staff-facing surfaces named by the brief. It
 * keeps the repository-wide 45-second test timeout and existing CI retry
 * policy unchanged.
 */
test.describe("K4-17 current-year books-business intra-head set-off", () => {
  test("an absorbed negative row reaches ledger, computation and validation surfaces", async ({ page }) => {
    const c = await seedTaxCase({
      itrTypeSelected: "ITR-1",
      income: [{ income_head: "salary", amount: 500_000, source_type: "Form16" }],
      businessBooks: [
        { revenue: 1_000_000, expenses: 400_000, adjustments: "none_s30_43d", activity_classification: "ordinary_business_or_profession", is_profession: false },
        { revenue: 100_000, expenses: 500_000, adjustments: "none_s30_43d", activity_classification: "ordinary_business_or_profession", is_profession: true },
      ],
    });

    await page.goto(`/tax-desk/cases/${c.taxCaseId}/ledgers`);
    await page.getByRole("tab", { name: /Business \(books\)/ }).click();
    const ledger = page.getByRole("region", { name: "Business (books)" });
    await expect(ledger).toContainText("Current-year books-business aggregate");
    await expect(ledger).toContainText("₹2,00,000");
    // Individual `net_estimate` rows use the ledger's established raw-number
    // display contract; the category aggregate above uses formatted INR.
    await expect(ledger).toContainText("-400000");
    await expect(page.getByTestId("ledger-support-summary")).toContainText(
      "every entry maps to a figure the AY 2026-27 engine computes",
    );

    await page.goto(`/tax-desk/cases/${c.taxCaseId}/computation`);
    await page.getByText("View full calculation").click();
    const booksFigure = page.locator('[data-material-figure-id="detail.new.businessBooksIncome"]');
    await expect(booksFigure).toContainText("2,00,000");
    const panel = page.getByTestId("rule-traceability");
    await panel.getByText("Rule & evidence traceability").click();
    await expect(panel).toContainText("business_books_computation");

    await page.goto(`/tax-desk/cases/${c.taxCaseId}/validation`);
    await page.getByRole("button", { name: /Run validation/i }).click();
    await expect(page.getByText(/Validation saved:/)).toBeVisible();
    await expect(page.getByText("BUSINESS_BOOKS_REQUIRES_ITR3").first()).toBeVisible();
    await expect(page.getByText("BUSINESS_BOOKS_NET_PROFIT_APPLIED").first()).toBeVisible();
    await expect(page.getByText(/Section 70\(1\) intra-head set-off/).first()).toBeVisible();
  });
});

/**
 * K4-18 — the F&O / intraday slice, in the browser.
 *
 * Kept in THIS file rather than a new spec deliberately. `K4-16-F3` established
 * that filename ordinals are load-bearing for CI cost — Playwright partitions
 * shards by a sequential greedy over filename order, so a new spec can move the
 * max shard and cost a hosted gate. This coverage belongs with its siblings
 * anyway: it is the same books head, the same gate chain, one classification on.
 *
 * Three paths, and the middle one matters most:
 *
 *  1. AFFIRMED F&O with a declared Section 44AB turnover computes and joins the
 *     ordinary Section 70(1) pool;
 *  2. the same row with NO declared turnover is REFUSED — books revenue is
 *     never substituted, because no official source defines derivative
 *     turnover. This is the fail-open guard for the whole slice;
 *  3. intraday equity is refused and quarantined under the Section 43(5) main
 *     limb, never netted into the ordinary pool.
 */

/** Affirmed F&O with NO turnover declared — the refusal case. */
const FNO_WITHOUT_TURNOVER = {
  revenue: 3_000_000,
  expenses: 2_400_000,
  adjustments: "none_s30_43d",
  activity_classification: "fno_non_speculative_s43_5_d",
};

/**
 * The same row WITH a declared turnover — the admitted case. The two differ by
 * exactly one field, which is what makes the pair meaningful.
 *
 * The figure is deliberately far above books revenue and far below the Section
 * 44AB threshold: a derivatives desk's turnover routinely dwarfs the net result
 * it books, which is precisely why revenue cannot stand in for it.
 */
const FNO_AFFIRMED = { ...FNO_WITHOUT_TURNOVER, declared_turnover: 8_000_000 };

test.describe("K4-18 F&O and intraday classification", () => {
  test("affirmed exchange-traded F&O with a declared turnover computes into the ordinary pool", async ({
    page,
  }) => {
    // ITR-1 is selected deliberately, exactly as the K4-14 admitted case does:
    // it is what makes the ITR-3 requirement below an assertion rather than a
    // tautology. An F&O undertaking is business income, so it forces ITR-3 on
    // presence alone — the disclosure consequence this slice had to establish.
    const c = await seedTaxCase({
      itrTypeSelected: "ITR-1",
      income: [{ income_head: "salary", amount: 500_000, source_type: "Form16" }],
      businessBooks: [FNO_AFFIRMED],
    });

    await page.goto(`/tax-desk/cases/${c.taxCaseId}/ledgers`);
    await expect(page.getByRole("tab", { name: /Business \(books\)/ })).toBeVisible();

    await page.goto(`/tax-desk/cases/${c.taxCaseId}/computation`);
    // Same arithmetic as an ordinary undertaking: 30,00,000 - 24,00,000.
    // Section 43(5) proviso (d) makes this an ORDINARY business, so it lands in
    // the ordinary books line rather than anywhere speculative.
    await page.getByText("View full calculation").click();
    const booksFigure = page.locator('[data-material-figure-id="detail.new.businessBooksIncome"]');
    await expect(booksFigure).toBeVisible();
    await expect(booksFigure).toContainText("6,00,000");
    // No refusal anywhere on the page for this case.
    await expect(page.getByText(/BUSINESS_BOOKS_FNO_UNSUPPORTED/)).toHaveCount(0);
    await expect(page.getByText(/BUSINESS_BOOKS_TURNOVER_UNDECLARED/)).toHaveCount(0);

    await page.goto(`/tax-desk/cases/${c.taxCaseId}/validation`);
    await page.getByRole("button", { name: /Run validation/i }).click();
    await expect(page.getByText(/Validation saved:/)).toBeVisible();
    // Business income is present, so ITR-3 is still forced.
    await expect(page.getByText("BUSINESS_BOOKS_REQUIRES_ITR3").first()).toBeVisible();
  });

  test("the SAME row without a declared turnover is REFUSED — revenue is never substituted", async ({
    page,
  }) => {
    // The only difference from the admitted case above is the missing turnover.
    // If this ever computes, the engine has invented a Section 44AB figure.
    const c = await seedTaxCase({
      itrTypeSelected: "ITR-3",
      income: [{ income_head: "salary", amount: 500_000, source_type: "Form16" }],
      businessBooks: [FNO_WITHOUT_TURNOVER],
    });

    await page.goto(`/tax-desk/cases/${c.taxCaseId}/computation`);
    await expect(page.getByText(/BUSINESS_BOOKS_TURNOVER_UNDECLARED/)).toBeVisible();
    // And the ₹6,00,000 it would have contributed appears nowhere.
    await page.getByText("View full calculation").click();
    const booksFigure = page.locator('[data-material-figure-id="detail.new.businessBooksIncome"]');
    await expect(booksFigure).toBeVisible();
    await expect(booksFigure).not.toContainText("6,00,000");
  });

  test("intraday equity is refused and never netted into the ordinary pool", async ({ page }) => {
    // A profitable intraday row beside a clean ordinary one. Explanation 2 to
    // Section 28 deems the speculation business distinct and separate, so the
    // head is all-or-nothing — the ordinary row must NOT be published alone,
    // and the intraday profit must not be added to it.
    const c = await seedTaxCase({
      itrTypeSelected: "ITR-3",
      income: [{ income_head: "salary", amount: 500_000, source_type: "Form16" }],
      businessBooks: [
        BOOKS_ADMITTED,
        {
          revenue: 900_000,
          expenses: 100_000,
          adjustments: "none_s30_43d",
          activity_classification: "intraday_speculative_s43_5",
        },
      ],
    });

    await page.goto(`/tax-desk/cases/${c.taxCaseId}/computation`);
    await expect(page.getByText(/BUSINESS_BOOKS_INTRADAY_SPECULATIVE_UNSUPPORTED/)).toBeVisible();
    await page.getByText("View full calculation").click();
    const booksFigure = page.locator('[data-material-figure-id="detail.new.businessBooksIncome"]');
    await expect(booksFigure).toBeVisible();
    // Neither the ordinary row alone (6,00,000) nor the netted total
    // (6,00,000 + 8,00,000 = 14,00,000) may appear.
    await expect(booksFigure).not.toContainText("6,00,000");
    await expect(booksFigure).not.toContainText("14,00,000");
  });
});
