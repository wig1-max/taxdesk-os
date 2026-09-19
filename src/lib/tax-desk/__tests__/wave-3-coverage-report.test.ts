import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildWave3CoverageReport } from "../wave-3-coverage-report";

/**
 * K3-33 — pins the exact Wave-3 supported-scope claims made in
 * the k3-wave-3-coverage-and-limitations design notes. Same discipline as
 * `src/lib/tax-lab/__tests__/coverage-report.test.ts` (K3-23): if the
 * supported scope changes, THIS test fails until the coverage report is
 * consciously reassessed — the report can never silently drift from what the
 * code actually supports.
 */
describe("buildWave3CoverageReport", () => {
  it("pins the narrow supported source kind + facts", () => {
    const report = buildWave3CoverageReport();
    expect(report.supportedSourceKind).toBe("Form16");
    expect(report.supportedSourceSchemaVersion).toBe("FORM16_V0_PLANNED");
    expect(report.supportedProposalFacts).toEqual(["income.salary", "tax_paid.salary_tds"]);
  });

  it("pins the two regimes an evidence manifest may be bound to", () => {
    expect(buildWave3CoverageReport().supportedRegimes).toEqual(["old", "new"]);
  });

  it("pins the manifest / draft-output package schema identities", () => {
    const report = buildWave3CoverageReport();
    expect(report.manifestSchemaVersion).toBe("TAX_EVIDENCE_MANIFEST_V1");
    expect(report.draftOutputPackageSchemaVersion).toBe("TAX_DRAFT_OUTPUT_PACKAGE_V1");
    expect(report.draftOutputStatus).toBe("internal_draft");
  });

  it("reuses (never re-derives) the live Computation screen's 46 = 42 + 2 + 2 partition", () => {
    const { computationFigureInventory } = buildWave3CoverageReport();
    // K4-07: +2 traced figures (detail.old/new.presumptiveProfessionalIncome).
    // K4-08: +2 more (detail.old/new.presumptiveBusinessIncome).
    // K4-10: +2 more (detail.old/new.broughtForwardLossSetOff) — the
    // categorical/limitation counts are unchanged by all three.
    // K4-11: +2 more (detail.old/new.marginalRelief), AND the two surcharge
    // placeholders move from limitation to traced — so traced goes 36 -> 40
    // while the limitation count DROPS 4 -> 2 for the first time. The two that
    // remain are the presentation-derived tax-before-rebate totals.
    // K4-12: +2 more (detail.old/new.rebateMarginalRelief), both traced —
    // categorical and limitation counts unchanged again.
    // K4-14: +2 more (detail.old/new.businessBooksIncome), both traced —
    // categorical and limitation counts unchanged again.
    expect(computationFigureInventory.total).toBe(48);
    expect(computationFigureInventory.traced).toBe(44);
    expect(computationFigureInventory.categorical).toBe(2);
    expect(computationFigureInventory.untracedLimitations).toBe(2);
    expect(
      computationFigureInventory.traced + computationFigureInventory.categorical + computationFigureInventory.untracedLimitations,
    ).toBe(computationFigureInventory.total);
  });

  // MAINT-03 (while remediating AUDIT-03-F3): every assertion above compares
  // the live report against literals in THIS file, which each session updates
  // as it changes scope — so they all passed while the document itself sat at
  // the pre-K4-06 `34 = 28 + 2 + 4` partition. The doc was never read back.
  // This assertion reads it back.
  it("keeps k3-wave-3-coverage-and-limitations.md's stated counts in sync with the live report", () => {
    const doc = readFileSync(
      join(__dirname, "..", "..", "..", "..", "docs", "coverage", "k3-wave-3-coverage-and-limitations.md"),
      "utf8",
    );
    // `\r?\n` — see the note in tax-lab/__tests__/coverage-report.test.ts:
    // these docs check out CRLF on this host, and an LF-only marker regex made
    // the guard depend on `core.autocrlf` rather than on the document.
    const marker = doc.match(/<!-- WAVE3_COVERAGE_COUNTS\r?\n([\s\S]*?)-->/);
    expect(
      marker,
      "k3-wave-3-coverage-and-limitations.md is missing its WAVE3_COVERAGE_COUNTS marker",
    ).toBeTruthy();
    const statedCounts = Object.fromEntries(
      [...(marker?.[1] ?? "").matchAll(/(\w+)=(\d+)/g)].map(([, key, value]) => [key, Number(value)]),
    );

    const report = buildWave3CoverageReport();
    expect(statedCounts).toEqual({
      figureInventoryTotal: report.computationFigureInventory.total,
      figureInventoryTraced: report.computationFigureInventory.traced,
      figureInventoryCategorical: report.computationFigureInventory.categorical,
      figureInventoryUntracedLimitations: report.computationFigureInventory.untracedLimitations,
      supportedProposalFacts: report.supportedProposalFacts.length,
      supportedRegimes: report.supportedRegimes.length,
    });

    // The prose table in §1 states the partition inline as well — assert the
    // exact rendered string so correcting the marker alone cannot leave the
    // human-readable row stale (which is the drift that actually happened).
    expect(doc).toContain(
      `${report.computationFigureInventory.total} = ${report.computationFigureInventory.traced} traced + ` +
        `${report.computationFigureInventory.categorical} categorical + ` +
        `${report.computationFigureInventory.untracedLimitations} untraced limitations`,
    );
  });

  it("is frozen/immutable — a coverage report is a read, never a mutable global", () => {
    const report = buildWave3CoverageReport();
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.computationFigureInventory)).toBe(true);
  });
});
