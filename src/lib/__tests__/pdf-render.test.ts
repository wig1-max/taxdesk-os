import { describe, expect, it } from "vitest";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import type { PdfBaseData } from "@/lib/pdf/layout";
import { buildFeeAgreementTerms } from "@/lib/pdf/pure";
import {
  IepfFeeAgreementPdf,
  ItrComputationPdf,
  PendingDocsLetterPdf,
} from "@/lib/pdf/templates";

const base: PdfBaseData = {
  company: {
    name: "Demo Tax Practice",
    address: "Test Street, Gurugram",
    phone: "0000000000",
    email: "office@example.com",
  },
  clientName: "Ramesh Testwala",
  clientCode: "TDX-C-DEMO1",
  caseCode: "TDX-IEPF-DEMO1",
  caseTitle: "IEPF claim (demo)",
  serviceName: "IEPF Claim Recovery",
  generatedAt: "03 Jul 2026",
  generatedBy: "Test Admin",
};

async function expectPdf(el: React.ReactElement) {
  const buf = await renderToBuffer(
    el as React.ReactElement<import("@react-pdf/renderer").DocumentProps>
  );
  expect(buf.length).toBeGreaterThan(1000);
  expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  return buf;
}

describe("react-pdf render smoke (real renderer, fake data)", () => {
  it("renders the ITR computation summary with sparse data", async () => {
    await expectPdf(
      React.createElement(ItrComputationPdf, {
        base: { ...base, serviceName: "ITR Filing", caseCode: "TDX-ITR-2627-0001" },
        data: {
          ay: "2026-27",
          regime: "new",
          incomeHeads: [{ label: "Salary", amount: 1200000 }],
          deductions: [],
          taxSummary: [{ label: "Tax payable", amount: 54000 }],
          notes: "Draft only",
        },
      })
    );
  });

  it("renders the IEPF fee agreement from fee-derived terms", async () => {
    const buf = await expectPdf(
      React.createElement(IepfFeeAgreementPdf, {
        base,
        data: {
          company: "Demo Industries Ltd",
          folio: "DEMO0042",
          terms: buildFeeAgreementTerms({
            percent: 15,
            upfront_amount: 5000,
            estimated_claim_value: 240000,
            expected_fee: 36000,
            override_total: null,
            override_reason: null,
          }),
        },
      })
    );
    expect(buf.length).toBeGreaterThan(2000);
  });

  it("renders the pending documents letter", async () => {
    await expectPdf(
      React.createElement(PendingDocsLetterPdf, {
        base,
        data: {
          pending: ["CML copy", "Cancelled cheque"],
          rejected: [{ name: "PAN card", reason: "image blurry" }],
          waived: [],
          respondBy: "10 Jul 2026",
          nextAction: "document verification",
        },
      })
    );
  });
});
