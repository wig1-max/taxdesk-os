import { describe, expect, it } from "vitest";
import {
  resolveFinancialOutcome,
  outcomeFromLiabilityAndPaid,
  formatOutcomeAmount,
  outcomeCompareLabel,
  resolveShellAnchor,
} from "@/lib/tax-desk/financial-outcome";

describe("resolveFinancialOutcome — engine sign convention (netPayable = liability - taxPaid)", () => {
  it("tax paid greater than liability => refund", () => {
    // liability 0, paid 60000 => netPayable -60000
    const o = outcomeFromLiabilityAndPaid(0, 60000);
    expect(o.kind).toBe("refund");
    expect(o.amount).toBe(60000);
    expect(o.label).toBe("Expected refund");
  });

  it("liability greater than tax paid => payable", () => {
    const o = outcomeFromLiabilityAndPaid(36296, 12592);
    expect(o.kind).toBe("payable");
    expect(o.amount).toBe(23704);
    expect(o.label).toBe("Tax payable");
  });

  it("equal values => nil", () => {
    const o = outcomeFromLiabilityAndPaid(50000, 50000);
    expect(o.kind).toBe("nil");
    expect(o.amount).toBe(0);
    expect(o.label).toBe("Nil balance");
  });

  it("missing / partial snapshot => unavailable", () => {
    expect(resolveFinancialOutcome(-60000, false).kind).toBe("unavailable");
    expect(resolveFinancialOutcome(null).kind).toBe("unavailable");
    expect(resolveFinancialOutcome(undefined).kind).toBe("unavailable");
    expect(resolveFinancialOutcome(Number.NaN).kind).toBe("unavailable");
    expect(outcomeFromLiabilityAndPaid(null, 60000).kind).toBe("unavailable");
    expect(formatOutcomeAmount(resolveFinancialOutcome(null)).toString()).toBe("—");
  });

  it("signed value directly: negative=refund, positive=payable (matches the engine)", () => {
    expect(resolveFinancialOutcome(-60000).kind).toBe("refund");
    expect(resolveFinancialOutcome(60000).kind).toBe("payable");
    expect(resolveFinancialOutcome(0).kind).toBe("nil");
  });

  it("the K.2.8.5 seeded case (liability 0, paid 60000) resolves to a ₹60,000 refund", () => {
    // Regression: shell/overview previously showed 'Tax payable' for this case.
    const o = resolveFinancialOutcome(-60000, true);
    expect(o.kind).toBe("refund");
    expect(formatOutcomeAmount(o)).toContain("60,000");
  });

  it("tones: refund success, payable warning, nil/unavailable neutral", () => {
    expect(resolveFinancialOutcome(-1).tone).toBe("success");
    expect(resolveFinancialOutcome(1).tone).toBe("warning");
    expect(resolveFinancialOutcome(0).tone).toBe("neutral");
    expect(resolveFinancialOutcome(null).tone).toBe("neutral");
  });

  it("outcomeCompareLabel formats per-regime columns", () => {
    expect(outcomeCompareLabel(-60000)).toContain("refund");
    expect(outcomeCompareLabel(23704)).toContain("payable");
    expect(outcomeCompareLabel(0)).toBe("Nil");
  });

  it("rounds fractional rupees deterministically", () => {
    expect(resolveFinancialOutcome(-0.4).kind).toBe("nil");
    expect(resolveFinancialOutcome(-0.6).kind).toBe("refund");
  });
});

describe("resolveShellAnchor — saved snapshot vs live preview vs none", () => {
  it("saved snapshot exists → shows the saved outcome, not a preview", () => {
    const a = resolveShellAnchor({ savedNetPayable: -60000, previewNetPayable: 99999 });
    expect(a.source).toBe("saved");
    expect(a.isPreview).toBe(false);
    expect(a.outcome.kind).toBe("refund");
    expect(a.outcome.amount).toBe(60000);
    expect(a.eyebrow).toBe("Expected refund");
  });

  it("preview exists but no snapshot → shows the preview, tagged", () => {
    const a = resolveShellAnchor({ savedNetPayable: null, previewNetPayable: -60000 });
    expect(a.source).toBe("preview");
    expect(a.isPreview).toBe(true);
    expect(a.outcome.kind).toBe("refund");
    expect(a.eyebrow).toBe("Expected refund");
  });

  it("payable preview is tagged and correctly signed", () => {
    const a = resolveShellAnchor({ savedNetPayable: null, previewNetPayable: 23704 });
    expect(a.source).toBe("preview");
    expect(a.outcome.kind).toBe("payable");
    expect(a.outcome.amount).toBe(23704);
  });

  it("no snapshot and no preview → eyebrow 'No saved snapshot' (displayed, not 'Not computed')", () => {
    const a = resolveShellAnchor({ savedNetPayable: null, previewNetPayable: null });
    expect(a.source).toBe("none");
    expect(a.eyebrow).toBe("No saved snapshot"); // the displayed label
    expect(a.outcome.kind).toBe("unavailable");
    expect(formatOutcomeAmount(a.outcome)).toBe("—");
  });

  it("a nil saved snapshot (0) still counts as saved", () => {
    const a = resolveShellAnchor({ savedNetPayable: 0, previewNetPayable: -5000 });
    expect(a.source).toBe("saved");
    expect(a.outcome.kind).toBe("nil");
  });
});
