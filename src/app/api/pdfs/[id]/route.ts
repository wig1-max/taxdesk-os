import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { contentDisposition } from "@/lib/http/download";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Generated-PDF download. Session-authenticated + RLS-checked, then the
 * PDF is fetched privately (service role) and STREAMED back through this
 * route. Never a Supabase signed URL in the browser. Every download is
 * audited.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rl = await checkRateLimit("file-download:user", user.id, 120, 60);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many downloads, wait a minute" }, { status: 429 });
  }

  const { id } = await params;

  const supabase = await createServerClient();
  const { data: pdf } = await supabase
    .from("generated_pdfs")
    .select("id, case_id, storage_path, cases:case_id(display_code), pdf_templates:template_id(code)")
    .eq("id", id)
    .maybeSingle();
  if (!pdf) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const admin = createAdminClient();
  const { data: blob, error } = await admin.storage
    .from("generated-pdfs")
    .download(pdf.storage_path);
  if (error || !blob) {
    return NextResponse.json({ error: "PDF is unavailable" }, { status: 502 });
  }

  const caseCode = (pdf.cases as unknown as { display_code: string | null } | null)?.display_code;
  const tplCode = (pdf.pdf_templates as unknown as { code: string } | null)?.code;
  const filename = `${[caseCode, tplCode].filter(Boolean).join("-") || "document"}.pdf`;

  await audit({
    actor: user,
    action: "pdf.downloaded",
    entityType: "generated_pdfs",
    entityId: pdf.id,
    caseId: pdf.case_id,
    after: { filename },
  });

  return new NextResponse(blob.stream(), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition(filename),
      "Content-Length": String(blob.size),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
