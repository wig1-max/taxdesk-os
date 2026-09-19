import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildEngineInput, type IncomeLedgerRow } from "@/lib/tax-desk/computation-adapter";
import { TAX_INCOME_ENGINE_ROW_PROJECTION } from "@/lib/queries/tax-income-projection";

const META = {
  assessmentYear: "2026-27",
  financialYear: "2025-26",
  selectedItrType: null,
  finalized: false,
};

const readerPaths = [
  join(process.cwd(), "src", "lib", "queries", "tax-desk.ts"),
  join(process.cwd(), "src", "lib", "queries", "tax-eligibility.ts"),
  join(process.cwd(), "src", "lib", "queries", "tax-readiness.ts"),
];

function throughEveryReader(row: IncomeLedgerRow) {
  const projectedFields = TAX_INCOME_ENGINE_ROW_PROJECTION.split(/,\s*/);
  const projected = Object.fromEntries(
    projectedFields.map((field) => [field, row[field as keyof IncomeLedgerRow]]),
  ) as unknown as IncomeLedgerRow;
  return readerPaths.map(() =>
    buildEngineInput(
      { income: [projected], taxPaid: [], deductions: [], capitalGains: [] },
      META,
    ),
  );
}

describe("TAX-SAFE-03 shared live income projection", () => {
  it("contains both load-bearing presumptive fields", () => {
    expect(TAX_INCOME_ENGINE_ROW_PROJECTION.split(/,\s*/)).toEqual([
      "id",
      "income_head",
      "amount",
      "source_type",
      "source_document_id",
      "receipts_via_banking_channels",
      "presumptive_activity_type",
    ]);
  });

  it("is consumed by every production live reader that feeds buildEngineInput", () => {
    for (const path of readerPaths) {
      const source = readFileSync(path, "utf8");
      expect(source, path).toContain("TAX_INCOME_ENGINE_ROW_PROJECTION");
      expect(source, path).not.toMatch(
        /"id, income_head, amount, source_type, source_document_id(?:"|,)/,
      );
    }
  });

  it.each([
    ["44AD", "presumptive_business_44ad_digital", "other_business"],
    ["44ADA", "presumptive_professional_44ada", "specified_profession_44aa_1"],
  ])("keeps eligible %s rows complete in Computation, Eligibility and Filing Readiness", (_scheme, head, activity) => {
    const results = throughEveryReader({
      id: `eligible-${_scheme}`,
      income_head: head,
      amount: 1_000_000,
      source_type: "manual",
      source_document_id: null,
      receipts_via_banking_channels: true,
      presumptive_activity_type: activity,
    });
    expect(results.map((result) => result.complete)).toEqual([true, true, true]);
    expect(results.map((result) => result.presumptiveActivityEligibility.eligible)).toEqual([
      true,
      true,
      true,
    ]);
  });

  it.each([
    ["undeclared 44AD", "presumptive_business_44ad_cash", null],
    ["ineligible 44AD", "presumptive_business_44ad_cash", "commission_or_brokerage"],
    ["undeclared 44ADA", "presumptive_professional_44ada", null],
    ["ineligible 44ADA", "presumptive_professional_44ada", "other_business"],
  ])("refuses %s in all three readers", (_label, head, activity) => {
    const results = throughEveryReader({
      id: `refused-${_label}`,
      income_head: head,
      amount: 1_000_000,
      source_type: "manual",
      source_document_id: null,
      receipts_via_banking_channels: false,
      presumptive_activity_type: activity,
    });
    expect(results.map((result) => result.complete)).toEqual([false, false, false]);
    expect(results.map((result) => result.presumptiveActivityEligibility.eligible)).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("guards the snapshot action against contradictory adapter/eligibility metadata", () => {
    const source = readFileSync(
      join(process.cwd(), "src", "app", "actions", "tax-computation.ts"),
      "utf8",
    );
    expect(source).toContain("eligibility.adapter.complete !== adapter.complete");
    expect(source).toContain("eligibility.adapter.presumptiveActivityEligibility");
    expect(source.indexOf("eligibility.adapter.complete !== adapter.complete")).toBeLessThan(
      source.indexOf("eligibility: {"),
    );
    expect(source).toContain(
      "presumptiveActivityEligibility: adapter.presumptiveActivityEligibility",
    );
  });

  it("threads the stored contract into every snapshot-reliant reader", () => {
    const readinessPath = join(process.cwd(), "src", "lib", "queries", "tax-readiness.ts");
    expect(readFileSync(readinessPath, "utf8"), readinessPath).toContain(
      "presumptiveActivityEligibility",
    );
    const manifestPath = join(process.cwd(), "src", "lib", "queries", "tax-evidence-manifest.ts");
    expect(readFileSync(manifestPath, "utf8"), manifestPath).toContain(
      "normalizeStoredEngineInputPayload(",
    );
  });

  it("keeps evidence manifests on the snapshot's complete V1 input and exact rules coordinate", () => {
    const path = join(process.cwd(), "src", "lib", "queries", "tax-evidence-manifest.ts");
    const source = readFileSync(path, "utf8");
    expect(source).toContain("normalizeStoredEngineInputPayload(");
    expect(source).toContain('.select("id, rules_version, created_at, input_snapshot, output_snapshot")');
    expect(source).toContain("manifestStatutoryContextForSnapshot(");
    expect(source).toContain("snap.rules_version");
  });
});
