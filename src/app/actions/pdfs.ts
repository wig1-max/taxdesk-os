"use server";

import { randomUUID } from "node:crypto";
import React from "react";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { buildPdfPayload } from "@/lib/pdf/data";
import { PDF_TEMPLATE_CODES, type PdfTemplateCode } from "@/lib/pdf/pure";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

type Result = { ok: boolean; pdfId?: string; error?: string };

export async function generatePdfAction(caseId: string, templateCode: string): Promise<Result> {
  const user = await requireUser();

  if (!(PDF_TEMPLATE_CODES as readonly string[]).includes(templateCode)) {
    return { ok: false, error: "Unknown PDF template." };
  }
  const code = templateCode as PdfTemplateCode;

  // Template row must exist and be active (session client, RLS).
  const supabase = await createServerClient();
  const { data: template } = await supabase
    .from("pdf_templates")
    .select("id, code, version, is_active")
    .eq("code", code)
    .maybeSingle();
  if (!template || !template.is_active) {
    return { ok: false, error: "This PDF template is not active." };
  }

  // Load data (validates case access via RLS + service eligibility).
  const payload = await buildPdfPayload(caseId, code, user.full_name);
  if ("error" in payload) return { ok: false, error: payload.error };

  // Render server-side. Dynamic imports keep react-pdf out of every
  // other server bundle.
  let buffer: Buffer;
  try {
    const [{ renderToBuffer }, templates] = await Promise.all([
      import("@react-pdf/renderer"),
      import("@/lib/pdf/templates"),
    ]);
    const componentByCode = {
      itr_computation: templates.ItrComputationPdf,
      itr_approval: templates.ItrApprovalPdf,
      iepf_visit_checklist: templates.IepfVisitChecklistPdf,
      iepf_authorization: templates.IepfAuthorizationPdf,
      iepf_fee_agreement: templates.IepfFeeAgreementPdf,
      pending_docs_letter: templates.PendingDocsLetterPdf,
    } as const;
    const Component = componentByCode[code] as React.ComponentType<{
      base: typeof payload.base;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: any;
    }>;
    buffer = await renderToBuffer(
      React.createElement(Component, {
        base: payload.base,
        data: payload.data,
      }) as React.ReactElement<import("@react-pdf/renderer").DocumentProps>
    );
  } catch (e) {
    console.error("[pdf] render failed:", e);
    return { ok: false, error: "PDF rendering failed. Please try again." };
  }

  // Store in the PRIVATE generated-pdfs bucket (service role — the
  // bucket has no client policies at all).
  const storagePath = `cases/${caseId}/${code}-${Date.now()}-${randomUUID().slice(0, 8)}.pdf`;
  const admin = createAdminClient();
  const { error: storageError } = await admin.storage
    .from("generated-pdfs")
    .upload(storagePath, buffer, { contentType: "application/pdf", upsert: false });
  if (storageError) return { ok: false, error: "Could not store the PDF." };

  // History row via the session client (staff insert allowed by RLS).
  const { data: row, error: insertError } = await supabase
    .from("generated_pdfs")
    .insert({
      case_id: caseId,
      template_id: template.id,
      storage_path: storagePath,
      snapshot_data: { ...(payload.snapshot as object), template_version: template.version },
      generated_by: user.id,
    })
    .select("id")
    .single();
  if (insertError || !row) {
    await admin.storage.from("generated-pdfs").remove([storagePath]);
    return { ok: false, error: "Could not record the PDF." };
  }

  await audit({
    actor: user,
    action: "pdf.generated",
    entityType: "generated_pdfs",
    entityId: row.id,
    caseId,
    after: { template: code, template_version: template.version, storage_path: storagePath },
  });

  revalidatePath(`/cases/${caseId}/pdfs`);
  return { ok: true, pdfId: row.id };
}
