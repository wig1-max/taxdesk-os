import { describe, expect, it } from "vitest";
import {
  buildFeeAgreementTerms,
  buildPendingDocsData,
  disclaimersFor,
  isTemplateEligible,
  sanitizeSnapshot,
} from "@/lib/pdf/pure";

describe("PDF template eligibility by service", () => {
  it("ITR templates only for itr", () => {
    expect(isTemplateEligible("itr_computation", "itr")).toBe(true);
    expect(isTemplateEligible("itr_approval", "itr")).toBe(true);
    expect(isTemplateEligible("itr_computation", "iepf")).toBe(false);
    expect(isTemplateEligible("itr_computation", "gst")).toBe(false);
  });
  it("IEPF templates only for iepf", () => {
    expect(isTemplateEligible("iepf_fee_agreement", "iepf")).toBe(true);
    expect(isTemplateEligible("iepf_authorization", "itr")).toBe(false);
  });
  it("pending docs letter is generic", () => {
    for (const svc of ["itr", "iepf", "gst", "mutual_fund"]) {
      expect(isTemplateEligible("pending_docs_letter", svc)).toBe(true);
    }
  });
  it("unknown template codes are never eligible", () => {
    expect(isTemplateEligible("mystery_pdf", "itr")).toBe(false);
  });
});

describe("snapshot sanitizer (no PAN/Aadhaar ever)", () => {
  it("drops sensitive keys and masks PAN-like strings", () => {
    const out = sanitizeSnapshot({
      client: { name: "Ramesh", pan: "ABCDE1234F", pan_encrypted: "x", pan_last4: "234F" },
      note: "client PAN ABCDE1234F, acct 123456789012",
      nested: [{ upload_token: "secret", ok: 1 }],
    }) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const json = JSON.stringify(out);
    expect(json).not.toContain("ABCDE1234F");
    expect(json).not.toContain("123456789012");
    expect(out.client.pan).toBeUndefined(); // key dropped
    expect(out.client.pan_encrypted).toBeUndefined();
    expect(out.client.pan_last4).toBe("234F"); // masked form allowed
    expect(out.nested[0].upload_token).toBeUndefined();
    expect(out.nested[0].ok).toBe(1);
  });
});

describe("fee agreement terms from case fee data", () => {
  it("uses actual fee record values, no hardcoding", () => {
    const t = buildFeeAgreementTerms({
      percent: 12.5,
      upfront_amount: 7500,
      estimated_claim_value: 240000,
      expected_fee: 30000,
      override_total: null,
      override_reason: null,
    });
    expect(t.percentText).toContain("12.5%");
    expect(t.upfrontText).toContain("7,500");
    expect(t.estimatedClaimText).toContain("2,40,000");
    expect(t.expectedFeeText).toContain("30,000");
    expect(t.overrideNote).toBeNull();
    expect(t.balanceRule).toMatch(/partial recovery/i);
  });

  it("includes override note when an admin override exists", () => {
    const t = buildFeeAgreementTerms({
      percent: 15,
      upfront_amount: 5000,
      estimated_claim_value: null,
      expected_fee: null,
      override_total: 20000,
      override_reason: "family settlement",
    });
    expect(t.overrideNote).toContain("20,000");
    expect(t.overrideNote).toContain("family settlement");
    expect(t.estimatedClaimText).toMatch(/to be determined/i);
  });

  it("defaults sensibly when fields are null (15% / 5000)", () => {
    const t = buildFeeAgreementTerms({
      percent: null,
      upfront_amount: null,
      estimated_claim_value: null,
      expected_fee: null,
      override_total: null,
      override_reason: null,
    });
    expect(t.percentText).toContain("15%");
    expect(t.upfrontText).toContain("5,000");
  });
});

describe("pending documents letter builder", () => {
  const rows = [
    { name: "PAN card", status: "verified", is_required: true, notes: null, waived_reason: null },
    { name: "CML copy", status: "pending", is_required: true, notes: null, waived_reason: null },
    { name: "Old ITR", status: "pending", is_required: false, notes: null, waived_reason: null },
    { name: "Cheque", status: "rejected", is_required: true, notes: "Rejected: image blurry", waived_reason: null },
    { name: "Entitlement letter", status: "waived", is_required: false, notes: null, waived_reason: "not applicable" },
  ];

  it("splits pending/rejected/waived correctly (optional pending excluded)", () => {
    const d = buildPendingDocsData(rows, "10 Jul 2026");
    expect(d.pending).toEqual(["CML copy"]);
    expect(d.rejected).toEqual([{ name: "Cheque", reason: "image blurry" }]);
    expect(d.waived).toEqual(["Entitlement letter"]);
    expect(d.respondBy).toBe("10 Jul 2026");
  });
});

describe("disclaimers", () => {
  it("base disclaimer on everything; ITR/IEPF get their extra line", () => {
    expect(disclaimersFor("pending_docs_letter")).toHaveLength(1);
    expect(disclaimersFor("itr_computation").join(" ")).toMatch(/tax computation/i);
    expect(disclaimersFor("iepf_fee_agreement").join(" ")).toMatch(/cannot guarantee/i);
    for (const code of ["itr_approval", "iepf_authorization"]) {
      expect(disclaimersFor(code)[0]).toMatch(/does not provide investment advice/i);
    }
  });
});
