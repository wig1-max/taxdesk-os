import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { UPLOAD_ALLOWED_MIME } from "@/lib/constants";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildStoragePath, decideUploadMime } from "@/lib/upload/ingest-core";
import { hashUploadToken, sniffMime, uploadLinkState } from "@/lib/upload-token";
import { publicUploadSchema } from "@/lib/validation/upload";

/**
 * Public client upload endpoint. NO auth session — access is gated
 * by the hashed upload token. Service role is used ONLY inside this
 * handler, after token validation. Uniform, information-poor errors.
 * Rate limiting: distributed via Upstash when configured (per IP,
 * per token hash, per route) — see lib/rate-limit.ts.
 */

export const runtime = "nodejs";

function deny(status = 400, message = "Upload not accepted.") {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ipHash = createHash("sha256").update(ip).digest("hex").slice(0, 32);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return deny();
  }

  const token = String(form.get("token") ?? "");
  const caseDocumentId = String(form.get("case_document_id") ?? "");
  const consent = String(form.get("consent") ?? "") === "true";
  const file = form.get("file");

  if (token.length < 32 || token.length > 128) return deny(404, "Link not found.");
  const [ipLimit, tokenLimit, routeLimit] = await Promise.all([
    checkRateLimit("public-upload:ip", ipHash, 20, 60),
    checkRateLimit("public-upload:token", hashUploadToken(token), 40, 60),
    checkRateLimit("public-upload:route", "global", 300, 60),
  ]);
  if (!ipLimit.allowed || !tokenLimit.allowed || !routeLimit.allowed) {
    return deny(429, "Too many requests. Please wait a minute and try again.");
  }
  // Reuses publicUploadSchema (the single validation authority — AUDIT-01-F8)
  // for consent/size instead of a second, hand-rolled copy of the same bounds.
  const consentCheck = publicUploadSchema.pick({ consent_given: true }).safeParse({ consent_given: consent });
  if (!consentCheck.success) return deny(400, "Consent is required to upload documents.");
  if (!(file instanceof File)) return deny(400, "No file received.");
  const sizeCheck = publicUploadSchema.pick({ size_bytes: true }).safeParse({ size_bytes: file.size });
  if (!sizeCheck.success) return deny(400, "File too large (max 15 MB).");

  const admin = createAdminClient();

  // 1. Token -> link (hashed lookup only).
  const { data: link } = await admin
    .from("upload_links")
    .select("id, case_id, allowed_document_ids, expires_at, revoked_at, max_uploads, uploads_used")
    .eq("token_hash", hashUploadToken(token))
    .maybeSingle();
  if (!link) return deny(404, "Link not found.");
  if (uploadLinkState(link) !== "valid") {
    return deny(410, "This upload link is no longer active. Please contact our office.");
  }

  // 2. Target checklist item must be allowed by this link.
  if (!caseDocumentId || !link.allowed_document_ids.includes(caseDocumentId)) {
    return deny(400, "This document is not part of your upload link.");
  }
  const { data: caseDoc } = await admin
    .from("case_documents")
    .select("id, case_id, name")
    .eq("id", caseDocumentId)
    .eq("case_id", link.case_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!caseDoc) return deny(400, "This document is not part of your upload link.");

  // 3. Aadhaar default-deny: even a crafted request cannot upload an
  // Aadhaar item unless the case flag (with reason) is set.
  const isAadhaarItem = /aadhaar/i.test(caseDoc.name);
  const { data: kase } = await admin
    .from("cases")
    .select("id, client_id, aadhaar_required")
    .eq("id", link.case_id)
    .maybeSingle();
  if (!kase) return deny(404, "Link not found.");
  if (isAadhaarItem && !kase.aadhaar_required) {
    return deny(400, "This document type is not enabled for upload. Please contact our office.");
  }

  // 4. Content validation: declared MIME AND magic bytes must agree.
  const buf = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffMime(buf);
  const mimeDecision = decideUploadMime(file.type, sniffed, UPLOAD_ALLOWED_MIME as readonly string[]);
  if (!mimeDecision.ok) {
    return deny(
      400,
      mimeDecision.reason === "mismatch"
        ? "File content does not match its type."
        : "Only PDF, JPG, PNG, WEBP or HEIC files are accepted.",
    );
  }
  const mime = mimeDecision.mime;

  // 5. Store in the PRIVATE bucket under the case path.
  const storagePath = buildStoragePath(link.case_id, randomUUID(), mime);
  const { error: storageError } = await admin.storage
    .from("case-files")
    .upload(storagePath, buf, { contentType: mime, upsert: false });
  if (storageError) return deny(500, "Upload failed. Please try again.");

  const sha256 = createHash("sha256").update(buf).digest("hex");

  const { data: consentVersions } = await admin
    .from("settings")
    .select("value")
    .eq("key", "consent_text_versions")
    .maybeSingle();
  const consentVersion = consentVersions
    ? Object.keys(consentVersions.value as object).sort().at(-1) ?? "v1"
    : "v1";

  // 6. ONE atomic guarded write: metadata + consent + quota + checklist + audit.
  // Any failure inside rolls the whole thing back — so on error we only have to
  // remove the storage object we just wrote. A duplicate (idempotent replay or
  // same-content re-upload) touches nothing server-side; discard the redundant
  // object so storage never accretes orphans either.
  const { data: rpcRows, error: rpcError } = await admin.rpc("ingest_client_upload", {
    p_upload_link_id: link.id,
    p_case_document_id: caseDocumentId,
    p_storage_path: storagePath,
    p_original_filename: file.name.slice(0, 255).replace(/[\r\n]/g, " "),
    p_mime_type: mime,
    p_size_bytes: file.size,
    p_sha256: sha256,
    p_contains_aadhaar: isAadhaarItem,
    p_consent_text_version: consentVersion,
    p_ip_hash: ipHash,
    p_event_id: randomUUID(),
  });

  const result = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
  if (rpcError || !result) {
    await admin.storage.from("case-files").remove([storagePath]);
    return deny(500, "Upload failed. Please try again.");
  }
  if (result.is_duplicate) {
    // The canonical file already exists — drop the redundant object.
    await admin.storage.from("case-files").remove([storagePath]);
  }

  return NextResponse.json({ ok: true, document: caseDoc.name, duplicate: !!result.is_duplicate });
}
