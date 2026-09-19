/**
 * Pure PDF logic — no react-pdf imports, fully unit-tested:
 * template eligibility, snapshot sanitization, fee-agreement terms,
 * pending-documents letter data.
 */

export const PDF_TEMPLATE_CODES = [
  "itr_computation",
  "itr_approval",
  "iepf_visit_checklist",
  "iepf_authorization",
  "iepf_fee_agreement",
  "pending_docs_letter",
] as const;
export type PdfTemplateCode = (typeof PDF_TEMPLATE_CODES)[number];

/** Which templates a service's cases may generate. */
export function isTemplateEligible(templateCode: string, serviceCode: string): boolean {
  if (templateCode === "pending_docs_letter") return true;
  if (templateCode.startsWith("itr_")) return serviceCode === "itr";
  if (templateCode.startsWith("iepf_")) return serviceCode === "iepf";
  return false;
}

/**
 * Snapshot sanitizer. generated_pdfs.snapshot_data must NEVER carry
 * raw PAN, pan_encrypted, or Aadhaar-like data. Belt and suspenders:
 * strips sensitive keys recursively AND masks PAN-pattern strings.
 */
const SENSITIVE_SNAPSHOT_KEY = /pan_encrypted|(^|_)pan$|aadhaar_number|token|password|secret/i;
const PAN_IN_STRING = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g;
const LONG_DIGITS = /\d{12,}/g;

export function sanitizeSnapshot(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") {
    return value.replace(PAN_IN_STRING, "XXXXXX****").replace(LONG_DIGITS, "************");
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sanitizeSnapshot);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_SNAPSHOT_KEY.test(k)) continue; // drop entirely
    out[k] = sanitizeSnapshot(v);
  }
  return out;
}

/** Fee agreement terms built from real case fee data (no hardcoding). */
export interface FeeAgreementTerms {
  percentText: string;
  upfrontText: string;
  estimatedClaimText: string;
  expectedFeeText: string;
  overrideNote: string | null;
  balanceRule: string;
}

export function inr(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return "Rs. " + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

export function buildFeeAgreementTerms(fee: {
  percent: number | null;
  upfront_amount: number | null;
  estimated_claim_value: number | null;
  expected_fee: number | null;
  override_total: number | null;
  override_reason: string | null;
}): FeeAgreementTerms {
  const pct = fee.percent ?? 15;
  return {
    percentText: `${pct}% of the value successfully recovered and credited to the client's demat account / bank account`,
    upfrontText: `${inr(fee.upfront_amount ?? 5000)} payable in advance. The advance is non-refundable once work on the claim has started.`,
    estimatedClaimText:
      fee.estimated_claim_value != null
        ? `Estimated claim value (indicative only): ${inr(fee.estimated_claim_value)}`
        : "Estimated claim value: to be determined after document verification.",
    expectedFeeText:
      fee.expected_fee != null
        ? `Indicative success fee at current estimate: ${inr(fee.expected_fee)}`
        : "Indicative success fee: to be computed once the claim value is estimated.",
    overrideNote:
      fee.override_total != null
        ? `Specially agreed total fee for this engagement: ${inr(fee.override_total)}${
            fee.override_reason ? ` (${fee.override_reason})` : ""
          }`
        : null,
    balanceRule:
      "The balance fee becomes payable only after the recovered value is credited to the client's demat/bank account. " +
      "In case of partial recovery, the success fee applies only to the actually recovered value. " +
      "Applicable taxes/GST, if any, will be charged additionally as per law.",
  };
}

/** Pending documents letter data from checklist rows. */
export interface PendingDocsData {
  pending: string[];
  rejected: Array<{ name: string; reason: string }>;
  waived: string[];
  respondBy: string;
}

export function buildPendingDocsData(
  rows: Array<{ name: string; status: string; is_required: boolean; notes: string | null; waived_reason: string | null }>,
  respondBy: string
): PendingDocsData {
  return {
    pending: rows
      .filter((r) => (r.status === "pending" || r.status === "requested") && r.is_required)
      .map((r) => r.name),
    rejected: rows
      .filter((r) => r.status === "rejected")
      .map((r) => ({
        name: r.name,
        reason: (r.notes ?? "").replace(/^Rejected:\s*/i, "") || "needs re-submission",
      })),
    waived: rows.filter((r) => r.status === "waived").map((r) => r.name),
    respondBy,
  };
}

/** Shared disclaimer set. */
export const DISCLAIMER_BASE =
  "Draft for internal/client review. Final filing/submission is subject to verification, client approval, and applicable portal/company/RTA requirements. Demo Tax Practice does not provide investment advice.";
export const DISCLAIMER_ITR =
  "Tax computation is prepared from information/documents provided by the client and is subject to final verification before filing.";
export const DISCLAIMER_IEPF =
  "IEPF claim timelines depend on company/RTA/authority verification. Demo Tax Practice cannot guarantee approval or processing time.";

export function disclaimersFor(templateCode: string): string[] {
  const list = [DISCLAIMER_BASE];
  if (templateCode.startsWith("itr_")) list.push(DISCLAIMER_ITR);
  if (templateCode.startsWith("iepf_")) list.push(DISCLAIMER_IEPF);
  return list;
}
