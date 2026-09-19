"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

type Result = { ok: boolean; error?: string };

/**
 * Aadhaar early-purge: PERMANENTLY removes one storage object and
 * marks the row purged. Admin-only, one file at a time, requires the
 * literal confirmation text "PURGE". Audit logs and consent records
 * are NEVER touched — the metadata row itself also stays (purged_at
 * set) so history remains provable.
 */
export async function purgeAadhaarFileAction(
  fileId: string,
  confirmText: string
): Promise<Result> {
  const user = await requireAdmin();

  if (confirmText !== "PURGE") {
    return { ok: false, error: 'Type PURGE (all caps) to confirm permanent deletion.' };
  }

  // RLS-scoped read first — proves the admin can see this file.
  const supabase = await createServerClient();
  const { data: file } = await supabase
    .from("uploaded_files")
    .select("id, case_id, storage_path, original_filename, contains_aadhaar, purged_at, cases:case_id(completed_at)")
    .eq("id", fileId)
    .maybeSingle();
  if (!file) return { ok: false, error: "File not found." };
  if (!file.contains_aadhaar) {
    return { ok: false, error: "This file is not Aadhaar-flagged. Early purge applies only to Aadhaar-sensitive files." };
  }
  if (file.purged_at) return { ok: false, error: "Already purged." };

  const completedAt = (file.cases as unknown as { completed_at: string | null } | null)
    ?.completed_at;
  if (!completedAt) {
    return {
      ok: false,
      error: "Case is not completed yet. Early purge runs after case completion.",
    };
  }

  // Remove the object (service role — bucket has no client policies).
  const admin = createAdminClient();
  const { error: storageError } = await admin.storage
    .from("case-files")
    .remove([file.storage_path]);
  if (storageError) return { ok: false, error: "Storage removal failed. Nothing was marked purged." };

  // Mark purged (service role: bypasses the soft-delete trigger by
  // design; the action itself is the admin gate + audit).
  const { error: updateError } = await admin
    .from("uploaded_files")
    .update({ purged_at: new Date().toISOString(), deleted_at: new Date().toISOString() })
    .eq("id", fileId);
  if (updateError) {
    return { ok: false, error: "Object removed but row not marked — contact developer. Audit will show the purge." };
  }

  await audit({
    actor: user,
    action: "file.purged",
    entityType: "uploaded_files",
    entityId: fileId,
    caseId: file.case_id,
    after: {
      filename: file.original_filename,
      reason: "aadhaar_early_purge",
      case_completed_at: completedAt,
    },
  });

  revalidatePath("/settings/purge");
  revalidatePath("/dashboard");
  return { ok: true };
}
