import { describe, expect, it } from "vitest";
import {
  resolveRecommendationDisplay,
  ITR_RECOMMENDATION_UNAVAILABLE,
} from "@/lib/tax-desk/financial-outcome";
import { buildEngineInput, type CaseMeta, type LedgerRows } from "@/lib/tax-desk/computation-adapter";
import { compareRegimes, recommendItrForm } from "@/lib/tax-engine/ay-2026-27";
import { isSourceLinked } from "@/lib/tax-desk/ledger-source";

/**
 * K.2.8.7 recommendation completeness guard — a partial calculation (unsupported
 * entries excluded) must not recommend a regime or an ITR form, nor highlight a
 * REC column. The selected ITR (a user fact) is always preserved. Presentation
 * guard only — engine regime/ITR logic is untouched.
 */

const META: CaseMeta = { assessmentYear: "2026-27", financialYear: "2025-26", selectedItrType: "ITR-1", finalized: false };
const rows = (p: Partial<LedgerRows>): LedgerRows => ({ income: [], taxPaid: [], deductions: [], capitalGains: [], ...p });

/** Mirror how the Computation page derives the guarded recommendation display. */
function displayFor(r: LedgerRows) {
  const adapter = buildEngineInput(r, META);
  return resolveRecommendationDisplay({
    unsupportedCount: adapter.unsupportedEntryCount,
    recommendedRegime: compareRegimes(adapter.input).recommendedRegime,
    recommendedItrType: recommendItrForm(adapter.input).recommendedItrType,
  });
}

describe("resolveRecommendationDisplay — unit", () => {
  it("unsupportedCount > 0 suppresses the regime recommendation (no REC column)", () => {
    const d = resolveRecommendationDisplay({ unsupportedCount: 2, recommendedRegime: "new", recommendedItrType: "ITR-2" });
    expect(d.available).toBe(false);
    expect(d.regime).toBeNull(); // → no REC badge / no highlight
    expect(d.recommendedItr).toBeNull();
  });

  it("unsupportedCount === 0 exposes the regime + ITR recommendation", () => {
    const d = resolveRecommendationDisplay({ unsupportedCount: 0, recommendedRegime: "old", recommendedItrType: "ITR-1" });
    expect(d.available).toBe(true);
    expect(d.regime).toBe("old");
    expect(d.recommendedItr).toBe("ITR-1");
  });

  it("has a fixed unavailable message", () => {
    expect(ITR_RECOMMENDATION_UNAVAILABLE).toMatch(/unavailable until manual-treatment entries are resolved/i);
  });
});

describe("recommendation guard over live ledger input", () => {
  it("unsupported entries suppress regime + ITR recommendation (REC highlight withheld)", () => {
    const d = displayFor(
      rows({
        income: [
          { id: "a", income_head: "salary", amount: "800000", source_type: "Form16" },
          { id: "b", income_head: "house_property", amount: "120000", source_type: "manual" },
          { id: "c", income_head: "business_income", amount: "300000", source_type: "manual" },
        ],
        capitalGains: [{ id: "d", gain_type: "other_ltcg", sale_value: "0", cost: "0", expenses: "0", exemption_claimed: "0", taxable_gain: "70000", source_type: "manual" }],
      }),
    );
    expect(d.available).toBe(false);
    expect(d.regime).toBeNull();
    expect(d.recommendedItr).toBeNull();
    // The selected ITR is a separate user fact and is NOT part of this guard —
    // callers keep displaying META.selectedItrType regardless.
    expect(META.selectedItrType).toBe("ITR-1");
  });

  it("a fully supported case restores the regime + ITR recommendation", () => {
    const d = displayFor(
      rows({
        income: [{ id: "a", income_head: "salary", amount: "800000", source_type: "Form16" }],
        capitalGains: [{ id: "b", gain_type: "stcg_111a", sale_value: "0", cost: "0", expenses: "0", exemption_claimed: "0", taxable_gain: "50000", source_type: "broker_report" }],
      }),
    );
    expect(d.available).toBe(true);
    expect(d.regime === "old" || d.regime === "new").toBe(true);
    expect(d.recommendedItr).toBe("ITR-2"); // capital gains → ITR-2
  });

  it("a SOURCE-LINKED unsupported entry is still recommendation-incomplete", () => {
    const r = rows({
      income: [
        { id: "a", income_head: "salary", amount: "800000", source_type: "Form16" },
        { id: "b", income_head: "house_property", amount: "120000", source_type: "manual", source_document_id: "doc-1" },
      ],
    });
    // The row is genuinely source-linked, yet still withholds the recommendation.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(isSourceLinked(r.income[1] as any)).toBe(true);
    expect(displayFor(r).available).toBe(false);
  });

  it("a NO-SOURCE but supported entry can still produce recommendations", () => {
    const r = rows({ income: [{ id: "a", income_head: "salary", amount: "800000", source_type: "manual" }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(isSourceLinked(r.income[0] as any)).toBe(false);
    const d = displayFor(r);
    expect(d.available).toBe(true);
    expect(d.recommendedItr).not.toBeNull();
  });
});
