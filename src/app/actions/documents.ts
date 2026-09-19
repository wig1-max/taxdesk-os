"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { CHECKLIST_STATUSES } from "@/lib/documents/document-state";
import { createClient as createServerClient } from "@/lib/supabase/server";

type ActionResult = { ok: boolean; error?: string };

export async function addChecklistItemAction(
  caseId: string,
  name: string,
  isRequired: boolean
): Promise<ActionResult> {
  const user = await requireUser();
  const cleanName = name.trim();
  if (!cleanName) return { ok: false, error: "Item name required." };
  if (/aadhaar/i.test(cleanName)) {
    return {
      ok: false,
      error:
        "Aadhaar items cannot be added ad-hoc. Enable 'Aadhaar operationally required' on the case instead (default deny policy).",
    };
  }
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("case_documents")
    .insert({ case_id: caseId, name: cleanName, is_required: isRequired, requirement_id: null })
    .select("id")
    .single();
  if (error) return { ok: false, error: "Could not add item." };
  await audit({
    actor: user,
    action: "case_document.added",
    entityType: "case_documents",
    entityId: data.id,
    caseId,
    after: { name: cleanName, is_required: isRequired },
  });
  revalidatePath(`/cases/${caseId}/documents`);
  return { ok: true };
}

const checklistStatusSchema = z.object({
  caseDocumentId: z.string().uuid(),
  status: z.enum(CHECKLIST_STATUSES),
  reason: z.string().trim().max(500).optional(),
});

export async function updateChecklistStatusAction(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = checklistStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const { caseDocumentId, status, reason } = parsed.data;

  if ((status === "rejected" || status === "waived") && !reason?.trim()) {
    return { ok: false, error: `A reason is required to mark an item ${status}.` };
  }

  const supabase = await createServerClient();
  const { data: before } = await supabase
    .from("case_documents")
    .select("id, case_id, name, status")
    .eq("id", caseDocumentId)
    .maybeSingle();
  if (!before) return { ok: false, error: "Checklist item not found." };

  const patch: Record<string, unknown> = { status };
  if (status === "verified") {
    patch.reviewed_by = user.id;
    patch.reviewed_at = new Date().toISOString();
  }
  if (status === "waived") patch.waived_reason = reason?.trim();
  if (status === "rejected") patch.notes = `Rejected: ${reason?.trim()}`;

  const { error } = await supabase.from("case_documents").update(patch).eq("id", caseDocumentId);
  if (error) return { ok: false, error: "Update failed." };

  await audit({
    actor: user,
    action: "case_document.status_changed",
    entityType: "case_documents",
    entityId: caseDocumentId,
    caseId: before.case_id,
    before: { status: before.status, name: before.name },
    after: { status, reason: reason?.trim() || null },
  });
  revalidatePath(`/cases/${before.case_id}/documents`);
  return { ok: true };
}

/** File review: verify or reject an uploaded file. */
const fileReviewSchema = z.object({
  fileId: z.string().uuid(),
  decision: z.enum(["verified", "rejected"]),
  reason: z.string().trim().max(500).optional(),
});

export async function reviewUploadedFileAction(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = fileReviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const { fileId, decision, reason } = parsed.data;
  if (decision === "rejected" && !reason?.trim()) {
    return { ok: false, error: "A reason is required to reject a file." };
  }

  const supabase = await createServerClient();
  const { data: file } = await supabase
    .from("uploaded_files")
    .select("id, case_id, case_document_id, review_status, original_filename")
    .eq("id", fileId)
    .maybeSingle();
  if (!file) return { ok: false, error: "File not found." };

  const { error } = await supabase
    .from("uploaded_files")
    .update({
      review_status: decision,
      rejected_reason: decision === "rejected" ? reason?.trim() : null,
    })
    .eq("id", fileId);
  if (error) return { ok: false, error: "Review failed." };

  // Verified file satisfies its checklist item.
  if (decision === "verified" && file.case_document_id) {
    await supabase
      .from("case_documents")
      .update({ status: "verified", reviewed_by: user.id, reviewed_at: new Date().toISOString() })
      .eq("id", file.case_document_id);
  }

  await audit({
    actor: user,
    action: decision === "verified" ? "file.verified" : "file.rejected",
    entityType: "uploaded_files",
    entityId: fileId,
    caseId: file.case_id,
    before: { review_status: file.review_status, filename: file.original_filename },
    after: { review_status: decision, reason: reason?.trim() || null },
  });
  revalidatePath(`/cases/${file.case_id}/documents`);
  return { ok: true };
}

/** Aadhaar default-deny gate: flag must be set with a reason first. */
export async function setAadhaarRequiredAction(
  caseId: string,
  required: boolean,
  reason: string
): Promise<ActionResult> {
  const user = await requireUser();
  if (required && !reason.trim()) {
    return { ok: false, error: "A reason is required to enable Aadhaar collection." };
  }
  const supabase = await createServerClient();
  const { error } = await supabase
    .from("cases")
    .update({
      aadhaar_required: required,
      aadhaar_required_reason: required ? reason.trim() : null,
    })
    .eq("id", caseId);
  if (error) return { ok: false, error: "Update failed." };
  await audit({
    actor: user,
    action: required ? "case.aadhaar_enabled" : "case.aadhaar_disabled",
    entityType: "cases",
    entityId: caseId,
    caseId,
    after: { aadhaar_required: required, reason: required ? reason.trim() : null },
  });
  revalidatePath(`/cases/${caseId}/documents`);
  return { ok: true };
}
