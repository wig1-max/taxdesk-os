"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { extractVariables } from "@/lib/messages/render";
import { createClient as createServerClient } from "@/lib/supabase/server";

type Result = { ok: boolean; error?: string };

/** Admin-only: edit a message template body / toggle active. */
export async function updateMessageTemplateAction(
  templateId: string,
  input: { body?: string; is_active?: boolean }
): Promise<Result> {
  const user = await requireAdmin();

  const body = input.body?.trim();
  if (body !== undefined && (body.length === 0 || body.length > 2000)) {
    return { ok: false, error: "Template body must be 1–2000 characters." };
  }

  const supabase = await createServerClient();
  const { data: before } = await supabase
    .from("message_templates")
    .select("id, code, body, is_active, version")
    .eq("id", templateId)
    .maybeSingle();
  if (!before) return { ok: false, error: "Template not found." };

  const patch: Record<string, unknown> = {};
  if (body !== undefined && body !== before.body) {
    patch.body = body;
    patch.variables = extractVariables(body);
    patch.version = before.version + 1;
  }
  if (input.is_active !== undefined) patch.is_active = input.is_active;
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await supabase
    .from("message_templates")
    .update(patch)
    .eq("id", templateId);
  if (error) return { ok: false, error: "Update failed." };

  await audit({
    actor: user,
    action: "message_template.updated",
    entityType: "message_templates",
    entityId: templateId,
    before: { body: before.body, is_active: before.is_active, version: before.version },
    after: patch,
  });
  revalidatePath("/settings/templates");
  return { ok: true };
}

/** Admin-only: toggle a PDF template's active flag (no body editor in v1). */
export async function togglePdfTemplateAction(
  templateId: string,
  isActive: boolean
): Promise<Result> {
  const user = await requireAdmin();
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("pdf_templates")
    .update({ is_active: isActive })
    .eq("id", templateId)
    .select("id, code")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "Update failed." };
  await audit({
    actor: user,
    action: "pdf_template.toggled",
    entityType: "pdf_templates",
    entityId: templateId,
    after: { is_active: isActive, code: data.code },
  });
  revalidatePath("/settings/templates");
  return { ok: true };
}
