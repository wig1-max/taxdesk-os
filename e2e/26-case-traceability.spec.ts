import { expect, test } from "@playwright/test";
import { warmTaxDeskOnce } from "./warm";
import { ADMIN_STORAGE_STATE } from "./lib/auth-state";
import { seedTaxCase } from "./lib/fixtures";
import { COMPUTATION_FIGURE_IDS } from "../src/lib/tax-desk/computation-figure-ids";
import { RULES_VERSION } from "../src/lib/tax-engine/ay-2026-27/rules";

/**
 * `K3-22` — case-intelligence SURFACING.
 *
 * The laboratory (`K3-20`/`K3-21`) made traceability checkable; this suite holds
 * the part a preparer actually sees: which versioned pack governs a case, the
 * traced/projection/categorical/limitation contract for its material figures,
 * what evidence is available, that the pack is NOT CA-verified, and that a
 * partial figure says so.
 */
test.use({ storageState: ADMIN_STORAGE_STATE });

// OPS-11 (ZCode): per-spec route warming. Compile this shard's own Tax Desk
// sub-routes here, in an untimed beforeAll, instead of every shard compiling
// all of them in setup. Static routes stay warmed in setup; see e2e/warm.ts.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await warmTaxDeskOnce(browser);
});

let compUrl = "";
let validationUrl = "";
let partialCompUrl = "";

test.describe.serial("Case traceability surfacing (K3-22)", () => {
  test.beforeAll(async () => {
    const complete = await seedTaxCase({
      itrTypeSelected: "ITR-1",
      income: [
        { income_head: "salary", amount: 900_000, source_type: "Form16", mapFirstDoc: true },
        { income_head: "fd_interest", amount: 20_000, source_type: "manual" },
      ],
      deductions: [{ deduction_type: "80C", amount: 150_000 }],
      taxPaid: [{ tax_paid_type: "salary_tds", amount: 60_000, source_type: "Form16" }],
    });
    compUrl = `/tax-desk/cases/${complete.taxCaseId}/computation`;
    validationUrl = `/tax-desk/cases/${complete.taxCaseId}/validation`;

    // A case carrying a head the engine cannot represent — its figures are partial.
    const partial = await seedTaxCase({
      income: [
        { income_head: "salary", amount: 600_000, source_type: "Form16" },
        { income_head: "house_property", amount: 120_000 },
      ],
    });
    partialCompUrl = `/tax-desk/cases/${partial.taxCaseId}/computation`;
  });

  test("the computation caption names the GOVERNING PACK and its unverified state", async ({ page }) => {
    await page.goto(compUrl);
    // A version string never appears alone — it always carries its status
    // (`D23`). THAT is what this test guards, so the version is DERIVED from
    // the engine rather than hardcoded: `K4-18` bumped V1 -> V2 and this line
    // was the one place outside `src/` still carrying the old literal, which
    // cost a hosted gate. The literal is still pinned deliberately, in
    // `tax-pack/__tests__/ay-2026-27-pack.test.ts` — one place asserts WHICH
    // version, everywhere else derives it, so a legitimate bump touches exactly
    // one line.
    await expect(
      page.getByText(new RegExp(`tax pack ${RULES_VERSION} · draft — not CA-verified`)).first(),
    ).toBeVisible();
  });

  test("the not-CA-verified notice is visible WITHOUT opening any disclosure", async ({ page }) => {
    await page.goto(compUrl);
    const notice = page.getByTestId("pack-verification-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("not CA-verified");
    await expect(notice).toContainText("tax_pack_unverified");
    await expect(notice).toContainText("not a basis for real-client reliance");
    await expect(notice).toContainText("Traced rule-derived figures");
    await expect(notice).toContainText("Input projections apply no tax rule");
    await expect(notice).toContainText("categorical decisions have no engine source tags");
    await expect(notice).toContainText("limitations claim no complete trace");
    // Nothing may claim verification.
    await expect(page.getByText(/is CA-verified/)).toHaveCount(0);
  });

  test("the closed figure inventory surfaces its effective rule and evidence state", async ({ page }) => {
    await page.goto(compUrl);
    const panel = page.getByTestId("rule-traceability");
    await expect(panel).toBeVisible();
    await panel.getByText("Rule & evidence traceability").click();

    // K4-11: 42 -> 44 = 40 traced + 2 categorical + 2 limitations. The two
    // per-regime marginal-relief figures are new, and the two surcharge
    // placeholders moved from limitation to traced — the first session in which
    // the limitation count DROPS. Fixed proactively, before the first full E2E
    // run, per the K4-08/K4-09/K4-10 convention.
    // K4-14: 46 -> 48 = 44 traced + 2 categorical + 2 limitations. The two
    // per-regime books-based business net-profit figures are new and traced;
    // neither other count moves. Fixed proactively, before the first full E2E
    // run, per the K4-08/K4-09/K4-10/K4-11 convention.
    await expect(panel.locator("tbody tr")).toHaveCount(48);
    await expect(panel).toContainText("Closed authored material-figure inventory: 44 traced");
    await expect(panel).toContainText("2 categorical");
    await expect(panel).toContainText("2 explicit untraced limitations");
    await expect(panel).toContainText("Effective for this governing pack: 44 traced");
    await expect(panel).toContainText("0 untraced rule-mapping gaps");

    const renderedIds = await page
      .locator("[data-material-figure-id]")
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("data-material-figure-id")),
      );
    expect(renderedIds.every((id): id is string => id !== null)).toBe(true);
    expect([...new Set(renderedIds as string[])].sort()).toEqual(
      [...COMPUTATION_FIGURE_IDS].sort(),
    );

    const rebate = page.getByTestId("traceability-line-comparison.new.rebate");
    await expect(rebate).toContainText("rebate_87a");
    await expect(rebate).toContainText("Section 87A, Income-tax Act, 1961");
    await expect(rebate).toContainText("TODO(CA-verify)");
    await expect(rebate).toContainText("Unverified");

    // Gross total income is a projection of declared entries, and says so rather
    // than borrowing the appearance of a rule.
    const gti = page.getByTestId("traceability-line-summary.grossTotalIncome");
    await expect(gti).toContainText("Sum of declared entries");
    // The Form 16 behind the salary row is named as the evidence.
    await expect(gti).toContainText("matched by document");

    // Old/new are separate trace lines; the recommended result is never reused
    // as the alternative regime's lineage.
    const oldLiability = page.getByTestId("traceability-line-comparison.old.grossTaxLiability");
    const newLiability = page.getByTestId("traceability-line-comparison.new.grossTaxLiability");
    await expect(oldLiability).toBeVisible();
    await expect(newLiability).toBeVisible();
    expect(await oldLiability.locator("td").nth(1).textContent()).not.toBe(
      await newLiability.locator("td").nth(1).textContent(),
    );

    for (const id of ["decision.recommendedRegime", "decision.recommendedItrType"]) {
      const categorical = page.getByTestId(`traceability-line-${id}`);
      await expect(categorical).toContainText("No engine source tags by construction");
      await expect(categorical).toContainText("Not source-tagged");
    }
  });

  // K4-11 rewrote this test rather than re-pointing one assertion, because its
  // subject changed: surcharge is no longer an untraced limitation but an
  // ordinary traced figure citing real pack rules. The two limitations that
  // remain are the presentation-derived `taxBeforeRebate` totals — a SEPARATE
  // limitation this session had no mandate over (D129) — so the test now
  // asserts the surviving limitation directly instead of via surcharge.
  test("derived totals stay explicit limitations; surcharge is now a traced figure", async ({ page }) => {
    await page.goto(compUrl);
    const dependencyCaveats = page.getByTestId("surcharge-dependency-caveat");
    await expect(dependencyCaveats).toHaveCount(2);
    await expect(dependencyCaveats.first()).toContainText(
      "Traceable lineage does not mean implementation completeness",
    );
    await expect(dependencyCaveats.first()).toContainText("up to ₹2,00,00,000");
    await expect(dependencyCaveats.first()).toContainText("not a verified nil");
    await expect(dependencyCaveats.first()).toContainText("reliance-blocked");
    // The retired placeholder copy must not reappear anywhere on the screen.
    await expect(page.getByText(/unimplemented surcharge/i)).toHaveCount(0);

    const comparison = page.getByTestId("regime-comparison");
    await expect(comparison.getByText("Tax before rebate").locator("..")).toContainText(
      "Untraced display total",
    );

    await page.getByText("View full calculation").click();
    const surchargeRow = page
      .locator('[data-material-figure-id="detail.old.surcharge"]')
      .locator("..");
    await expect(surchargeRow).toContainText("Surcharge");
    await expect(surchargeRow).not.toContainText(/placeholder/i);
    // Marginal relief has its own row, so a REDUCED surcharge is reconcilable.
    await expect(
      page.locator('[data-material-figure-id="detail.old.marginalRelief"]'),
    ).toBeVisible();

    await page.getByTestId("rule-traceability").getByText("Rule & evidence traceability").click();
    const tracedSurcharge = page.getByTestId("traceability-line-detail.old.surcharge");
    await expect(tracedSurcharge).not.toContainText("Untraced limitation");
    await expect(tracedSurcharge).toContainText("Unverified");
    // The limitation contract is still asserted — on the two figures that are
    // still limitations, rather than on the two that stopped being them.
    const tracedBeforeRebate = page.getByTestId(
      "traceability-line-comparison.old.taxBeforeRebate",
    );
    await expect(tracedBeforeRebate).toContainText("Untraced limitation");
    const tracedLiability = page.getByTestId(
      "traceability-line-comparison.old.grossTaxLiability",
    );
    await expect(tracedLiability).toContainText("Unverified");
    await expect(tracedLiability).toContainText(
      "Traceable lineage does not mean implementation completeness",
    );
  });

  test("a partial figure is presented as partial, never as final", async ({ page }) => {
    await page.goto(partialCompUrl);
    const panel = page.getByTestId("rule-traceability");
    await panel.getByText("Rule & evidence traceability").click();
    const incomplete = page.getByTestId("traceability-incomplete");
    await expect(incomplete).toBeVisible();
    await expect(incomplete).toContainText("EXCLUDE");
    await expect(incomplete).toContainText("house_property");
    await expect(incomplete).toContainText("partial, not final");
  });

  // K4-PORT-08: the 1961 tests above still name only that world. This one
  // names ITA_2025 and asserts it cannot compute — no 1961 figures, no
  // regime table, no material ids.
  test("an ITA_2025 case is named and refused unbound — no 1961 figures", async ({ page }) => {
    const ty = await seedTaxCase({
      law: "ITA_2025",
      itrTypeSelected: "ITR-1",
      income: [{ income_head: "salary", amount: 900_000, source_type: "Form16", mapFirstDoc: true }],
    });
    await page.goto(`/tax-desk/cases/${ty.taxCaseId}/computation`);
    await expect(page.getByText("ITA_2025")).toBeVisible();
    await expect(page.getByText(/no governing tax pack \(unbound\)/)).toBeVisible();
    const notice = page.getByTestId("pack-refused-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("unbound");
    await expect(notice).toContainText("no computation binding");
    await expect(page.locator("[data-material-figure-id]")).toHaveCount(0);
    await expect(page.getByTestId("regime-comparison")).toHaveCount(0);
    await expect(page.getByTestId("computation-outcome")).toHaveCount(0);
    await expect(page.getByText("Section 87A, Income-tax Act, 1961")).toHaveCount(0);
  });

  test("the validation screen names its validation-rules version and unverified pack", async ({ page }) => {
    await page.goto(validationUrl);
    await expect(page.getByText(/validation rules .* \(draft\)/)).toBeVisible();
    const notice = page.getByTestId("pack-verification-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("an absent finding is not assurance");
  });

  test("a11y — the traceability disclosure is keyboard-operable with an adequate target", async ({ page }) => {
    await page.goto(compUrl);
    const summary = page.getByTestId("rule-traceability").locator("summary");
    const box = await summary.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

    await summary.focus();
    await expect(summary).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("traceability-line-comparison.new.rebate")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("traceability-line-comparison.new.rebate")).toBeHidden();
  });

  test("no horizontal overflow at 360px with the traceability table open", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(compUrl);
    await page.getByTestId("rule-traceability").getByText("Rule & evidence traceability").click();
    await expect(page.getByTestId("traceability-line-comparison.new.rebate")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflow).toBe(false);
  });
});
