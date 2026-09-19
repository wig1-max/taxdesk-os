"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { physicalDocumentSchema } from "@/lib/validation";

type ActionResult = { ok: boolean; error?: string };

function toRow(d: ReturnType<typeof physicalDocumentSchema.parse>) {
  return {
    case_id: d.case_id,
    name: d.name,
    description: d.description || null,
    received_date: d.received_date || null,
    received_by: d.received_by,
    storage_location: d.storage_location || null,
    custody_status: d.custody_status,
    return_required: d.return_required,
    returned_date: d.returned_date || null,
    returned_to: d.returned_to || null,
    courier_name: d.courier_name || null,
    tracking_number: d.tracking_number || null,
    dispatched_date: d.dispatched_date || null,
    notes: d.notes || null,
  };
}

export async function createPhysicalDocumentAction(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = physicalDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const row = toRow(parsed.data);

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("physical_documents")
    .insert({ ...row, created_by: user.id })
    .select("id")
    .single();
  if (error) return { ok: false, error: "Could not save physical document." };

  await audit({
    actor: user,
    action: "physical_document.created",
    entityType: "physical_documents",
    entityId: data.id,
    caseId: row.case_id,
    after: row,
  });
  revalidatePath(`/cases/${row.case_id}/physical-documents`);
  return { ok: true };
}

export async function updatePhysicalDocumentAction(
  id: string,
  input: unknown
): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = physicalDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const row = toRow(parsed.data);

  const supabase = await createServerClient();
  const { data: before } = await supabase
    .from("physical_documents")
    .select("id, case_id, custody_status, storage_location, name")
    .eq("id", id)
    .maybeSingle();
  if (!before) return { ok: false, error: "Physical document not found." };

  const { error } = await supabase.from("physical_documents").update(row).eq("id", id);
  if (error) return { ok: false, error: "Update failed. Check required dispatch/return fields." };

  await audit({
    actor: user,
    action:
      before.custody_status === row.custody_status
        ? "physical_document.updated"
        : "physical_document.custody_changed",
    entityType: "physical_documents",
    entityId: id,
    caseId: before.case_id,
    before: { custody_status: before.custody_status, storage_location: before.storage_location },
    after: {
      custody_status: row.custody_status,
      storage_location: row.storage_location,
      courier_name: row.courier_name,
      tracking_number: row.tracking_number,
      returned_to: row.returned_to,
    },
  });
  revalidatePath(`/cases/${before.case_id}/physical-documents`);
  return { ok: true };
}
