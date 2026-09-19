"use server";

import { revalidatePath } from "next/cache";
import { getAppBaseUrl } from "@/lib/app-url";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { generateUploadToken, hashUploadToken } from "@/lib/upload-token";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { uploadLinkCreateSchema } from "@/lib/validation";

export interface UploadLinkResult {
  ok: boolean;
  /** Raw link — shown ONCE, never stored, never logged. */
  url?: string;
  expiresAt?: string;
  error?: string;
}

export async function createUploadLinkAction(input: unknown): Promise<UploadLinkResult> {
  const user = await requireUser();
  const parsed = uploadLinkCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;

  // Resolve the public base URL BEFORE any DB write so a misconfigured
  // deploy fails cleanly instead of creating a link that points nowhere.
  let base: string;
  try {
    base = getAppBaseUrl();
  } catch {
    return {
      ok: false,
      error: "Server not configured: APP_BASE_URL is missing. Ask an admin to set it before sharing upload links.",
    };
  }

  const token = generateUploadToken();
  const expiresAt = new Date(Date.now() + d.expires_in_hours * 3600_000).toISOString();

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("upload_links")
    .insert({
      case_id: d.case_id,
      token_hash: hashUploadToken(token),
      allowed_document_ids: d.allowed_document_ids,
      expires_at: expiresAt,
      max_uploads: d.max_uploads,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: "Could not create upload link." };

  await audit({
    actor: user,
    action: "upload_link.created",
    entityType: "upload_links",
    entityId: data.id,
    caseId: d.case_id,
    after: {
      expires_at: expiresAt,
      max_uploads: d.max_uploads,
      allowed_document_count: d.allowed_document_ids.length,
      // deliberately no token / token_hash here
    },
  });

  revalidatePath(`/cases/${d.case_id}/documents`);
  return { ok: true, url: `${base}/upload/${token}`, expiresAt };
}

export async function revokeUploadLinkAction(linkId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("upload_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", linkId)
    .is("revoked_at", null)
    .select("id, case_id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "Could not revoke link." };
  await audit({
    actor: user,
    action: "upload_link.revoked",
    entityType: "upload_links",
    entityId: linkId,
    caseId: data.case_id,
  });
  revalidatePath(`/cases/${data.case_id}/documents`);
  return { ok: true };
}
