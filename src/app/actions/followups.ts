"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { followupSchema } from "@/lib/validation";

type ActionResult = { ok: boolean; error?: string };

export async function createFollowupAction(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = followupSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("followups")
    .insert({
      case_id: d.case_id,
      due_date: d.due_date,
      note: d.note,
      assigned_to: d.assigned_to ?? user.id,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: "Could not add follow-up." };

  await audit({
    actor: user,
    action: "followup.created",
    entityType: "followups",
    entityId: data.id,
    caseId: d.case_id,
    after: d,
  });
  revalidatePath(`/cases/${d.case_id}`);
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function setFollowupStatusAction(
  followupId: string,
  status: "done" | "cancelled" | "open"
): Promise<ActionResult> {
  const user = await requireUser();
  const supabase = await createServerClient();
  const { data: before } = await supabase
    .from("followups")
    .select("id, case_id, status")
    .eq("id", followupId)
    .maybeSingle();
  if (!before) return { ok: false, error: "Follow-up not found." };

  const done = status === "done";
  const { error } = await supabase
    .from("followups")
    .update({
      status,
      completed_at: done ? new Date().toISOString() : null,
      completed_by: done ? user.id : null,
    })
    .eq("id", followupId);
  if (error) return { ok: false, error: "Update failed." };

  await audit({
    actor: user,
    action: "followup.status_changed",
    entityType: "followups",
    entityId: followupId,
    caseId: before.case_id,
    before: { status: before.status },
    after: { status },
  });
  revalidatePath(`/cases/${before.case_id}`);
  revalidatePath("/dashboard");
  return { ok: true };
}
