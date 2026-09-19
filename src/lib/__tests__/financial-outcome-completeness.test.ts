import { describe, expect, it } from "vitest";
import {
  resolveFinancialOutcome,
  resolveShellAnchor,
  formatOutcomeAmount,
  manualTreatmentNote,
} from "@/lib/tax-desk/financial-outcome";
import { buildEngineInput, type CaseMeta, type LedgerRows } from "@/lib/tax-desk/computation-adapter";
import { classifyLedgerSupport } from "@/lib/tax-desk/ledger-support";
import { isSourceLinked } from "@/lib/tax-desk/ledger-source";

/**
 * K.2.8.7 completeness guard — when the engine input excludes one or more
 * unsupported entries, NO refund/payable/nil balance is shown; an
 * "Incomplete preview" (monetary "—" + count) is shown instead. Presentation
 * guard only: the engine sign convention and support rules are untouched.
 */

describe("resolveFinancialOutcome — completeness guard", () => {
  it("unsupportedCount > 0 suppresses a ₹0 NIL-balance outcome", () => {
    const o = resolveFinancialOutcome(0, true, { unsupportedCount: 3 });
    expect(o.kind).toBe("incomplete");
    expect(o.kind === "incomplete" && o.unsupportedCount).toBe(3);
    expect(formatOutcomeAmount(o)).toBe("—");
    expect(o.label).toBe("Incomplete preview");
  });

  it("unsupportedCount > 0 suppresses a REFUND outcome", () => {
    const o = resolveFinancialOutcome(-60000, true, { unsupportedCount: 1 });
    expect(o.kind).toBe("incomplete");
    expect(formatOutcomeAmount(o)).toBe("—");
  });

  it("unsupportedCount > 0 suppresses a PAYABLE outcome", () => {
    const o = resolveFinancialOutcome(23704, true, { unsupportedCount: 2 });
    expect(o.kind).toBe("incomplete");
    expect(formatOutcomeAmount(o)).toBe("—");
  });

  it("zero unsupported entries still shows a REFUND correctly", () => {
    const o = resolveFinancialOutcome(-60000, true, { unsupportedCount: 0 });
    expect(o.kind).toBe("refund");
    expect(o.amount).toBe(60000);
    expect(o.label).toBe("Expected refund");
  });

  it("zero unsupported entries still shows a PAYABLE correctly", () => {
    const o = resolveFinancialOutcome(23704, true, { unsupportedCount: 0 });
    expect(o.kind).toBe("payable");
    expect(o.amount).toBe(23704);
    expect(o.label).toBe("Tax payable");
  });

  it("zero unsupported entries still shows NIL correctly", () => {
    const o = resolveFinancialOutcome(0, true, { unsupportedCount: 0 });
    expect(o.kind).toBe("nil");
  });

  it("defaults to no guard when opts is omitted (back-compat)", () => {
    expect(resolveFinancialOutcome(-60000, true).kind).toBe("refund");
    expect(resolveFinancialOutcome(0, true).kind).toBe("nil");
  });

  it("incomplete takes precedence even with no computable value (only unsupported entries)", () => {
    const o = resolveFinancialOutcome(null, false, { unsupportedCount: 1 });
    expect(o.kind).toBe("incomplete");
  });

  it("manualTreatmentNote pluralises correctly", () => {
    expect(manualTreatmentNote(1)).toBe("1 entry needs manual treatment");
    expect(manualTreatmentNote(3)).toBe("3 entries need manual treatment");
  });
});

describe("resolveShellAnchor — preview guard vs saved snapshot", () => {
  it("a live preview with unsupported entries shows an Incomplete anchor (never a balance)", () => {
    const a = resolveShellAnchor({
      savedNetPayable: null,
      previewNetPayable: 0,
      previewUnsupportedCount: 3,
    });
    expect(a.source).toBe("preview");
    expect(a.isPreview).toBe(true);
    expect(a.outcome.kind).toBe("incomplete");
    expect(a.eyebrow).toBe("Incomplete");
    expect(formatOutcomeAmount(a.outcome)).toBe("—");
  });

  it("a complete live preview still shows the balance", () => {
    const a = resolveShellAnchor({ savedNetPayable: null, previewNetPayable: -60000, previewUnsupportedCount: 0 });
    expect(a.source).toBe("preview");
    expect(a.outcome.kind).toBe("refund");
  });

  it("a SAVED snapshot always wins and is never guarded (snapshots are gated complete)", () => {
    const a = resolveShellAnchor({ savedNetPayable: -60000, previewNetPayable: 0, previewUnsupportedCount: 5 });
    expect(a.source).toBe("saved");
    expect(a.outcome.kind).toBe("refund");
  });

  it("no snapshot, no preview, no unsupported → No saved snapshot", () => {
    const a = resolveShellAnchor({ savedNetPayable: null, previewNetPayable: null, previewUnsupportedCount: 0 });
    expect(a.source).toBe("none");
    expect(a.eyebrow).toBe("No saved snapshot");
  });
});

describe("completeness derives from engine support, NOT source links", () => {
  const META: CaseMeta = { assessmentYear: "2026-27", financialYear: "2025-26", selectedItrType: null, finalized: false };
  const rows = (p: Partial<LedgerRows>): LedgerRows => ({ income: [], taxPaid: [], deductions: [], capitalGains: [], ...p });

  it("a SOURCE-LINKED unsupported entry still makes the outcome incomplete", () => {
    const r = rows({
      income: [
        { id: "a", income_head: "salary", amount: "800000", source_type: "Form16" },
        // linked to a document, but engine-unsupported → still counts.
        { id: "b", income_head: "house_property", amount: "120000", source_type: "manual", source_document_id: "doc-1" },
      ],
    });
    const adapter = buildEngineInput(r, META);
    const support = classifyLedgerSupport(r, META);
    expect(support.unsupported).toBe(1);
    // The linked row is genuinely source-linked, yet completeness is unaffected by that.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(isSourceLinked(r.income[1] as any)).toBe(true);

    const outcome = resolveFinancialOutcome(0, true, { unsupportedCount: adapter.unsupportedEntryCount });
    expect(outcome.kind).toBe("incomplete");
  });

  it("a NO-SOURCE but fully-supported case shows a normal balance", () => {
    const r = rows({ income: [{ id: "a", income_head: "salary", amount: "800000", source_type: "manual" }] });
    const adapter = buildEngineInput(r, META);
    expect(adapter.unsupportedEntryCount).toBe(0);
    const outcome = resolveFinancialOutcome(-60000, true, { unsupportedCount: adapter.unsupportedEntryCount });
    expect(outcome.kind).toBe("refund");
  });
});
