import { describe, expect, it } from "vitest";
import {
  resolveFinancialOutcome,
  outcomeCompareLabel,
  formatOutcomeAmount,
  type FinancialOutcome,
} from "@/lib/tax-desk/financial-outcome";

/**
 * Cross-surface consistency: every surface derives its refund/payable outcome
 * from the SAME snapshot `refundOrPayable` value via the canonical resolver, so
 * the kind + amount + label must be identical everywhere. These helpers mirror
 * exactly how each surface calls the resolver.
 */
const shell = (netPayable: number | null, hasSnapshot: boolean) =>
  resolveFinancialOutcome(netPayable, hasSnapshot); // TaxCaseShell anchor
const overview = (netPayable: number | null, hasSnapshot: boolean) =>
  resolveFinancialOutcome(netPayable, hasSnapshot); // case Overview metric
const computationHero = (netPayable: number, meaningful: boolean) =>
  resolveFinancialOutcome(netPayable, meaningful); // Computation outcome hero
const reviewSummary = (netPayable: number | null, hasTax: boolean) =>
  resolveFinancialOutcome(netPayable, hasTax); // Client Review summary

const sameOutcome = (a: FinancialOutcome, b: FinancialOutcome) => {
  expect(a.kind).toBe(b.kind);
  expect(a.amount).toBe(b.amount);
  expect(a.label).toBe(b.label);
  expect(formatOutcomeAmount(a)).toBe(formatOutcomeAmount(b));
};

describe("financial-outcome consistency across surfaces", () => {
  it.each([
    ["refund", -60000],
    ["payable", 23704],
    ["nil", 0],
  ])("a %s snapshot resolves identically on shell / overview / computation / review", (_kind, value) => {
    const s = shell(value, true);
    sameOutcome(s, overview(value, true));
    sameOutcome(s, computationHero(value, true));
    sameOutcome(s, reviewSummary(value, true));
    // The computation regime-column label agrees with the resolved kind.
    if (s.kind === "refund") expect(outcomeCompareLabel(value)).toContain("refund");
    if (s.kind === "payable") expect(outcomeCompareLabel(value)).toContain("payable");
    if (s.kind === "nil") expect(outcomeCompareLabel(value)).toBe("Nil");
  });

  it("with no snapshot, every surface shows 'Not computed'", () => {
    sameOutcome(shell(null, false), overview(null, false));
    sameOutcome(shell(null, false), reviewSummary(null, false));
    expect(computationHero(-60000, false).kind).toBe("unavailable");
    expect(shell(-60000, false).kind).toBe("unavailable");
  });

  it("the K.2.8.5 regression case (−60000) is a refund everywhere, never payable", () => {
    for (const o of [shell(-60000, true), overview(-60000, true), computationHero(-60000, true), reviewSummary(-60000, true)]) {
      expect(o.kind).toBe("refund");
      expect(o.label).toBe("Expected refund");
    }
  });
});

/**
 * K.2.8.7 completeness guard consistency: every surface passes an
 * `unsupportedCount` to the SAME resolver, so an incomplete engine input can
 * never render as a refund/payable/nil on one surface while showing a balance on
 * another. These helpers mirror how each surface calls the guarded resolver.
 */
const shellGuard = (v: number, count: number) => resolveFinancialOutcome(v, true, { unsupportedCount: count }); // shell preview
const overviewGuard = (v: number, count: number) => resolveFinancialOutcome(v, true, { unsupportedCount: count }); // overview metric
const computationGuard = (v: number, count: number) => resolveFinancialOutcome(v, true, { unsupportedCount: count }); // computation hero
const reviewGuard = (v: number, count: number) => resolveFinancialOutcome(v, true, { unsupportedCount: count }); // review summary

describe("completeness guard consistency across surfaces", () => {
  it.each([
    ["refund", -60000],
    ["payable", 23704],
    ["nil", 0],
  ])("with unsupported entries, a %s value is suppressed identically on all four surfaces", (_k, value) => {
    const s = shellGuard(value, 2);
    for (const o of [s, overviewGuard(value, 2), computationGuard(value, 2), reviewGuard(value, 2)]) {
      expect(o.kind).toBe("incomplete");
      expect(formatOutcomeAmount(o)).toBe("—");
      expect(o.label).toBe("Incomplete preview");
    }
  });

  it.each([
    ["refund", -60000, "refund"],
    ["payable", 23704, "payable"],
  ])("with zero unsupported entries, a %s value still shows identically on all four surfaces", (_k, value, kind) => {
    const s = shellGuard(value, 0);
    for (const o of [s, overviewGuard(value, 0), computationGuard(value, 0), reviewGuard(value, 0)]) {
      expect(o.kind).toBe(kind);
    }
    sameOutcome(s, overviewGuard(value, 0));
    sameOutcome(s, computationGuard(value, 0));
    sameOutcome(s, reviewGuard(value, 0));
  });
});
