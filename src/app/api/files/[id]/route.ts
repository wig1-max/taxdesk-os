import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { contentDisposition } from "@/lib/http/download";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Staff file download. Session-authenticated + RLS-checked, then the
 * object is fetched privately (service role) and STREAMED back through
 * this route. The browser only ever sees an app URL — never a Supabase
 * signed URL. Every download is audited.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // 1. Session + active staff/admin (getSessionUser returns null unless
  //    the profile exists, is_active and not soft-deleted).
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // 2. Abuse brake on download volume.
  const rl = await checkRateLimit("file-download:user", user.id, 120, 60);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many downloads, wait a minute" }, { status: 429 });
  }

  const { id } = await params;

  // 3. RLS-scoped lookup proves this user may see this file.
  const supabase = await createServerClient();
  const { data: file } = await supabase
    .from("uploaded_files")
    .select("id, case_id, storage_path, original_filename, mime_type, purged_at")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!file || file.purged_at) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // 4. Fetch bytes privately (service role). Never redirect the browser.
  const admin = createAdminClient();
  const { data: blob, error } = await admin.storage
    .from("case-files")
    .download(file.storage_path);
  if (error || !blob) {
    return NextResponse.json({ error: "File is unavailable" }, { status: 502 });
  }

  await audit({
    actor: user,
    action: "file.downloaded",
    entityType: "uploaded_files",
    entityId: file.id,
    caseId: file.case_id,
    after: { filename: file.original_filename },
  });

  // 5. Stream it back with correct content-type + filename.
  return new NextResponse(blob.stream(), {
    status: 200,
    headers: {
      "Content-Type": file.mime_type || "application/octet-stream",
      "Content-Disposition": contentDisposition(file.original_filename ?? "file"),
      "Content-Length": String(blob.size),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
