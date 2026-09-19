import React from "react";
import { Text, View } from "@react-pdf/renderer";
import { SignatureBlocks, PracticeDoc, s, type PdfBaseData } from "./layout";
import {
  buildFeeAgreementTerms,
  disclaimersFor,
  inr,
  type PendingDocsData,
} from "./pure";

/**
 * The six v1 PDF templates. Each component receives base meta plus
 * template-specific data loaded server-side (lib/pdf/data.ts).
 */

/* ------------------------------------------------------------- */
export interface ItrComputationData {
  ay: string;
  regime: string;
  incomeHeads: Array<{ label: string; amount: number | null }>;
  deductions: Array<{ label: string; amount: number | null }>;
  taxSummary: Array<{ label: string; amount: number | null }>;
  notes: string;
}

export function ItrComputationPdf({ base, data }: { base: PdfBaseData; data: ItrComputationData }) {
  const table = (title: string, rows: Array<{ label: string; amount: number | null }>) => (
    <View>
      <Text style={s.h2}>{title}</Text>
      <View style={s.table}>
        {rows.length === 0 ? (
          <View style={s.trLast}>
            <Text style={[s.td, s.cellGrow]}>To be filled during computation</Text>
          </View>
        ) : (
          rows.map((r, i) => (
            <View key={i} style={i === rows.length - 1 ? s.trLast : s.tr}>
              <Text style={[s.td, s.cellGrow]}>{r.label}</Text>
              <Text style={[s.td, s.cellNum]}>{r.amount != null ? inr(r.amount) : "—"}</Text>
            </View>
          ))
        )}
      </View>
    </View>
  );

  return (
    <PracticeDoc
      base={base}
      title={`Income Tax Computation Summary — AY ${data.ay}`}
      disclaimers={disclaimersFor("itr_computation")}
      watermark="DRAFT"
    >
      <Text style={s.p}>
        Assessment Year: {data.ay} · Regime preference: {data.regime || "undecided"}
      </Text>
      {table("Income heads", data.incomeHeads)}
      {table("Deductions", data.deductions)}
      {table("Tax summary", data.taxSummary)}
      {data.notes ? (
        <View>
          <Text style={s.h2}>Notes</Text>
          <Text style={s.p}>{data.notes}</Text>
        </View>
      ) : null}
      <Text style={[s.p, { marginTop: 10, fontFamily: "Helvetica-Bold" }]}>
        Please review this computation and confirm your approval so we can proceed with filing.
      </Text>
      <Text style={s.p}>
        Prepared by {base.generatedBy}, {base.company.name}. This is a draft summary prepared from
        documents provided by the client.
      </Text>
    </PracticeDoc>
  );
}

/* ------------------------------------------------------------- */
export interface ItrApprovalData {
  ay: string;
  summaryLine: string; // e.g. "Total income Rs. X; Tax payable Rs. Y"
  computationRef: string;
}

export function ItrApprovalPdf({ base, data }: { base: PdfBaseData; data: ItrApprovalData }) {
  return (
    <PracticeDoc
      base={base}
      title={`ITR Filing Approval Sheet — AY ${data.ay}`}
      disclaimers={disclaimersFor("itr_approval")}
    >
      <Text style={s.p}>Computation reference: {data.computationRef}</Text>
      <Text style={s.p}>{data.summaryLine}</Text>
      <Text style={s.h2}>Client declaration</Text>
      <Text style={s.p}>
        I, {base.clientName}, confirm that the information and documents provided by me for the
        preparation of my income tax return for AY {data.ay} are true and complete to the best of
        my knowledge. I have reviewed the computation summary referenced above.
      </Text>
      <Text style={[s.p, { fontFamily: "Helvetica-Bold" }]}>
        I approve filing of my income tax return based on the above computation.
      </Text>
      <SignatureBlocks left={`Client: ${base.clientName}`} right={`For ${base.company.name}`} />
    </PracticeDoc>
  );
}

/* ------------------------------------------------------------- */
export interface IepfChecklistData {
  company: string;
  folio: string;
  estimatedClaim: number | null;
  documents: Array<{ name: string; required: boolean; status: string }>;
  physicalDocs: Array<{ name: string; custody_status: string }>;
  toSign: string[];
}

export function IepfVisitChecklistPdf({ base, data }: { base: PdfBaseData; data: IepfChecklistData }) {
  return (
    <PracticeDoc
      base={base}
      title="IEPF Claim — Client Visit Checklist"
      disclaimers={disclaimersFor("iepf_visit_checklist")}
    >
      <Text style={s.p}>
        Company: {data.company} · Folio: {data.folio || "—"} · Estimated claim value:{" "}
        {data.estimatedClaim != null ? inr(data.estimatedClaim) : "to be assessed"}
      </Text>

      <Text style={s.h2}>Documents to bring / provide</Text>
      <View style={s.table}>
        <View style={s.tr}>
          <Text style={[s.th, s.cellGrow]}>Document</Text>
          <Text style={[s.th, s.cellStatus]}>Required</Text>
          <Text style={[s.th, s.cellStatus]}>Status</Text>
        </View>
        {data.documents.map((d, i) => (
          <View key={i} style={i === data.documents.length - 1 ? s.trLast : s.tr}>
            <Text style={[s.td, s.cellGrow]}>{d.name}</Text>
            <Text style={[s.td, s.cellStatus]}>{d.required ? "Yes" : "If applicable"}</Text>
            <Text style={[s.td, s.cellStatus]}>{d.status.replaceAll("_", " ")}</Text>
          </View>
        ))}
      </View>

      <Text style={s.h2}>Documents to sign at the office</Text>
      {data.toSign.map((t, i) => (
        <Text key={i} style={s.p}>
          {i + 1}. {t}
        </Text>
      ))}

      {data.physicalDocs.length > 0 && (
        <View>
          <Text style={s.h2}>Physical originals</Text>
          {data.physicalDocs.map((p, i) => (
            <Text key={i} style={s.p}>
              • {p.name} — {p.custody_status.replaceAll("_", " ")}
            </Text>
          ))}
        </View>
      )}

      <Text style={s.h2}>Acknowledgement</Text>
      <Text style={s.p}>
        Received the above information. I will arrange the pending documents at the earliest.
      </Text>
      <SignatureBlocks left={`Client: ${base.clientName}`} right={`For ${base.company.name}`} />
    </PracticeDoc>
  );
}

/* ------------------------------------------------------------- */
export interface IepfAuthorizationData {
  company: string;
  folio: string;
  shares: string;
}

export function IepfAuthorizationPdf({ base, data }: { base: PdfBaseData; data: IepfAuthorizationData }) {
  return (
    <PracticeDoc
      base={base}
      title="Authorization Letter — IEPF Claim Assistance"
      disclaimers={disclaimersFor("iepf_authorization")}
    >
      <Text style={s.p}>To whomsoever it may concern,</Text>
      <Text style={s.p}>
        I, {base.clientName}, holder of shares/entitlements of {data.company}
        {data.folio ? ` (Folio No. ${data.folio})` : ""}
        {data.shares ? `, approximately ${data.shares} shares/units` : ""}, hereby authorize{" "}
        {base.company.name}, {base.company.address}, to assist me in the recovery of my shares and
        unclaimed dividends transferred to the Investor Education and Protection Fund (IEPF).
      </Text>
      <Text style={s.p}>This authorization covers:</Text>
      <Text style={s.p}>
        1. Preparing and compiling documentation required for the IEPF-5 claim;{"\n"}
        2. Corresponding with the company, its Registrar and Transfer Agent (RTA), and other
        concerned parties on my behalf in connection with this claim;{"\n"}
        3. Coordinating dispatch, follow-up, and responses to queries/objections relating to the
        claim.
      </Text>
      <Text style={s.p}>
        This authorization does NOT permit {base.company.name} to log into any government portal
        using my personal credentials or to submit any filing without my review, unless separately
        and explicitly authorized in writing. All filings remain subject to my verification and
        signature where required.
      </Text>
      <Text style={s.p}>This authorization is valid until the claim concludes or I withdraw it in writing.</Text>
      <SignatureBlocks left={`Client: ${base.clientName}`} right="Witness" />
    </PracticeDoc>
  );
}

/* ------------------------------------------------------------- */
export interface IepfFeeAgreementData {
  company: string;
  folio: string;
  terms: ReturnType<typeof buildFeeAgreementTerms>;
}

export function IepfFeeAgreementPdf({ base, data }: { base: PdfBaseData; data: IepfFeeAgreementData }) {
  const t = data.terms;
  return (
    <PracticeDoc
      base={base}
      title="Fee Agreement — IEPF Claim Recovery"
      disclaimers={disclaimersFor("iepf_fee_agreement")}
    >
      <Text style={s.p}>
        This fee agreement is between {base.clientName} ("Client") and {base.company.name}{" "}
        ("Service Provider") for professional assistance in recovering the Client's shares and
        dividends from the IEPF Authority in respect of {data.company}
        {data.folio ? ` (Folio No. ${data.folio})` : ""}.
      </Text>
      <Text style={s.h2}>Fee terms</Text>
      <Text style={s.p}>1. Advance fee: {t.upfrontText}</Text>
      <Text style={s.p}>2. Success fee: {t.percentText}.</Text>
      <Text style={s.p}>3. {t.estimatedClaimText}</Text>
      <Text style={s.p}>4. {t.expectedFeeText}</Text>
      {t.overrideNote && <Text style={s.p}>5. {t.overrideNote}</Text>}
      <Text style={s.h2}>Payment of balance</Text>
      <Text style={s.p}>{t.balanceRule}</Text>
      <Text style={s.h2}>General</Text>
      <Text style={s.p}>
        The Service Provider will make best efforts to pursue the claim diligently. Timelines
        depend on the company, RTA, and IEPF Authority. The Client agrees to provide correct
        documents and information promptly.
      </Text>
      <SignatureBlocks left={`Client: ${base.clientName}`} right={`For ${base.company.name}`} />
    </PracticeDoc>
  );
}

/* ------------------------------------------------------------- */
export function PendingDocsLetterPdf({
  base,
  data,
}: {
  base: PdfBaseData;
  data: PendingDocsData & { nextAction: string };
}) {
  return (
    <PracticeDoc
      base={base}
      title="Pending Documents — Request Letter"
      disclaimers={disclaimersFor("pending_docs_letter")}
    >
      <Text style={s.p}>Dear {base.clientName},</Text>
      <Text style={s.p}>
        To proceed with your case {base.caseCode} ({base.serviceName}), we require the following
        documents from you:
      </Text>

      {data.pending.length > 0 && (
        <View>
          <Text style={s.h2}>Pending documents</Text>
          {data.pending.map((p, i) => (
            <Text key={i} style={s.p}>
              {i + 1}. {p}
            </Text>
          ))}
        </View>
      )}

      {data.rejected.length > 0 && (
        <View>
          <Text style={s.h2}>Documents needing re-submission</Text>
          {data.rejected.map((r, i) => (
            <Text key={i} style={s.p}>
              {i + 1}. {r.name} — {r.reason}
            </Text>
          ))}
        </View>
      )}

      {data.waived.length > 0 && (
        <View>
          <Text style={s.h2}>Not required (waived)</Text>
          {data.waived.map((w, i) => (
            <Text key={i} style={s.p}>
              • {w}
            </Text>
          ))}
        </View>
      )}

      <Text style={[s.p, { fontFamily: "Helvetica-Bold", marginTop: 8 }]}>
        Kindly provide these by {data.respondBy} so your work is not delayed.
      </Text>
      <Text style={s.p}>
        You may submit documents at our office or through the secure upload link shared with you on
        WhatsApp. Next step after receipt: {data.nextAction}.
      </Text>
      <Text style={s.p}>Warm regards,{"\n"}{base.company.name}</Text>
    </PracticeDoc>
  );
}
