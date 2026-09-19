/**
 * Deterministic, plain-text-only message template renderer.
 * No HTML is ever interpreted — templates and variables are treated
 * strictly as text. Unknown variables stay literal ({{name}}) and are
 * reported so the UI can highlight them.
 */

const VAR_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function extractVariables(body: string): string[] {
  const found = new Set<string>();
  for (const m of body.matchAll(VAR_PATTERN)) {
    found.add(m[1]!);
  }
  return [...found];
}

export interface RenderResult {
  text: string;
  unresolved: string[];
}

export function renderTemplate(
  body: string,
  vars: Record<string, string | number | null | undefined>
): RenderResult {
  const unresolved = new Set<string>();
  const text = body.replace(VAR_PATTERN, (whole, name: string) => {
    const v = vars[name];
    if (v === undefined || v === null || String(v).trim() === "") {
      unresolved.add(name);
      return whole; // leave {{name}} literal so it is visibly unresolved
    }
    return String(v);
  });
  return { text, unresolved: [...unresolved] };
}

/** Sample data for admin template previews — obviously fake. */
export const SAMPLE_PREVIEW_VARS: Record<string, string> = {
  client_name: "Ramesh Testwala",
  service_name: "IEPF Claim Recovery",
  case_code: "TDX-IEPF-0001",
  document_list: "PAN card, Cancelled cheque, CML copy",
  pending_list: "Cancelled cheque, CML copy",
  expiry_hours: "72",
  upload_link: "https://taxdesk.example/upload/SAMPLE-LINK",
  amount: "5,000",
  payment_details: "UPI: practice@upi-sample",
  reference: "SAMPLE-REF-123",
  next_step: "e-verification",
  srn: "T12345678",
  objection_summary: "signature mismatch with bank records",
  required_from_client: "Please visit the office to re-sign ISR-2.",
  recovered_value: "2,40,000",
  balance_amount: "31,000",
};
