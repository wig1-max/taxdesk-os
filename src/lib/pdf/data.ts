import "server-only";

import { createClient as createServerClient } from "@/lib/supabase/server";
import type { PdfBaseData, PdfCompany } from "./layout";
import {
  buildFeeAgreementTerms,
  buildPendingDocsData,
  isTemplateEligible,
  sanitizeSnapshot,
  type PdfTemplateCode,
} from "./pure";

/**
 * Server-side data loader for PDF generation. Uses the SESSION
 * client throughout — RLS applies; nothing here touches
 * pan_encrypted (unreadable for authenticated anyway).
 */

export interface PdfPayload {
  base: PdfBaseData;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  snapshot: unknown;
  error?: never;
}

type LoadResult = PdfPayload | { error: string };

function displayDate(): string {
  return new Date().toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}


function rowsOf(x: unknown): Array<{ label: string; amount: number | null }> {
  if (!Array.isArray(x)) return [];
  return x
    .filter((r) => r && typeof r === "object" && "label" in r)
    .map((r) => ({
      label: String((r as { label: unknown }).label),
      amount:
        (r as { amount?: unknown }).amount != null
          ? Number((r as { amount?: unknown }).amount)
          : null,
    }));
}

export async function buildPdfPayload(
  caseId: string,
  templateCode: PdfTemplateCode,
  generatedByName: string
): Promise<LoadResult> {
  const supabase = await createServerClient();

  const { data: kase } = await supabase
    .from("cases")
    .select(
      "id, display_code, title, status, next_action, service_data, clients:client_id(full_name, display_code), services(code, name)"
    )
    .eq("id", caseId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!kase) return { error: "Case not found." };

  const client = kase.clients as unknown as { full_name: string; display_code: string | null };
  const service = kase.services as unknown as { code: string; name: string };
  if (!isTemplateEligible(templateCode, service.code)) {
    return { error: `Template ${templateCode} is not available for ${service.name}.` };
  }

  const { data: companySetting } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "company_profile")
    .maybeSingle();
  const cp = (companySetting?.value ?? {}) as Record<string, string>;
  const company: PdfCompany = {
    name: cp.name ?? "Demo Tax Practice",
    address: cp.address ?? "Gurugram, India",
    phone: cp.phone ?? "",
    email: cp.email ?? "",
  };

  const base: PdfBaseData = {
    company,
    clientName: client.full_name,
    clientCode: client.display_code ?? "—",
    caseCode: kase.display_code ?? "—",
    caseTitle: kase.title ?? "",
    serviceName: service.name,
    generatedAt: displayDate(),
    generatedBy: generatedByName,
  };

  const sd = (kase.service_data ?? {}) as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any = {};
  const snapshotExtras: Record<string, unknown> = {};

  switch (templateCode) {
    case "itr_computation": {
      const comp = (sd.computation ?? {}) as Record<string, unknown>;
      data = {
        ay: String(sd.ay ?? "—"),
        regime: String(sd.regime ?? "undecided"),
        incomeHeads: rowsOf(comp.income_heads),
        deductions: rowsOf(comp.deductions),
        taxSummary: rowsOf(comp.tax_summary),
        notes: String(comp.notes ?? sd.computation_notes ?? ""),
      };
      snapshotExtras.computation = comp;
      break;
    }
    case "itr_approval": {
      const comp = (sd.computation ?? {}) as Record<string, unknown>;
      const tax = rowsOf(comp.tax_summary);
      data = {
        ay: String(sd.ay ?? "—"),
        summaryLine:
          tax.length > 0
            ? tax.map((t) => `${t.label}: ${t.amount != null ? `Rs. ${t.amount.toLocaleString("en-IN")}` : "—"}`).join(" · ")
            : "As per the computation summary shared separately.",
        computationRef: `Computation summary for ${base.caseCode} dated ${base.generatedAt}`,
      };
      break;
    }
    case "iepf_visit_checklist": {
      const [{ data: docs }, { data: phys }] = await Promise.all([
        supabase
          .from("case_documents")
          .select("name, status, is_required")
          .eq("case_id", caseId)
          .is("deleted_at", null)
          .order("created_at"),
        supabase
          .from("physical_documents")
          .select("name, custody_status")
          .eq("case_id", caseId)
          .is("deleted_at", null),
      ]);
      data = {
        company: String(sd.company ?? "—"),
        folio: String(sd.folio ?? ""),
        estimatedClaim: sd.estimated_claim_value != null ? Number(sd.estimated_claim_value) : null,
        documents: (docs ?? []).map((d) => ({
          name: d.name,
          required: d.is_required,
          status: d.status,
        })),
        physicalDocs: phys ?? [],
        toSign: [
          "Authorization letter",
          "Fee agreement",
          "Advance stamped receipt",
          "Indemnity bond",
          "ISR-1 / ISR-2 / SH-13 or ISR-3 (as applicable)",
        ],
      };
      snapshotExtras.checklist = docs;
      snapshotExtras.physical_documents = phys;
      break;
    }
    case "iepf_authorization": {
      data = {
        company: String(sd.company ?? "—"),
        folio: String(sd.folio ?? ""),
        shares: sd.shares != null ? String(sd.shares) : "",
      };
      break;
    }
    case "iepf_fee_agreement": {
      const { data: fee } = await supabase
        .from("fees")
        .select("id, percent, upfront_amount, estimated_claim_value, expected_fee, override_total, override_reason")
        .eq("case_id", caseId)
        .eq("fee_type", "percent_of_recovery")
        .is("deleted_at", null)
        .order("created_at")
        .limit(1)
        .maybeSingle();
      if (!fee) return { error: "No percent-of-recovery fee exists on this case yet. Add it on the Fees tab first." };
      data = {
        company: String(sd.company ?? "—"),
        folio: String(sd.folio ?? ""),
        terms: buildFeeAgreementTerms({
          percent: fee.percent != null ? Number(fee.percent) : null,
          upfront_amount: fee.upfront_amount != null ? Number(fee.upfront_amount) : null,
          estimated_claim_value:
            fee.estimated_claim_value != null ? Number(fee.estimated_claim_value) : null,
          expected_fee: fee.expected_fee != null ? Number(fee.expected_fee) : null,
          override_total: fee.override_total != null ? Number(fee.override_total) : null,
          override_reason: fee.override_reason,
        }),
      };
      snapshotExtras.fee = fee;
      break;
    }
    case "pending_docs_letter": {
      const { data: docs } = await supabase
        .from("case_documents")
        .select("name, status, is_required, notes, waived_reason")
        .eq("case_id", caseId)
        .is("deleted_at", null)
        .order("created_at");
      const respondBy = new Date(Date.now() + 7 * 86400_000).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
      data = {
        ...buildPendingDocsData(docs ?? [], respondBy),
        nextAction: kase.next_action ?? "processing of your case",
      };
      snapshotExtras.checklist = docs;
      break;
    }
  }

  const snapshot = sanitizeSnapshot({
    template_code: templateCode,
    generated_at: new Date().toISOString(),
    generated_by: generatedByName,
    base,
    data,
    case_status: kase.status,
    ...snapshotExtras,
  });

  return { base, data, snapshot };
}
