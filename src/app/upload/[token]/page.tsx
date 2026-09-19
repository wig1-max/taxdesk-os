import type { Metadata } from "next";
import { UploadForm } from "@/components/upload-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { COMPANY_NAME } from "@/lib/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashUploadToken, uploadLinkState } from "@/lib/upload-token";

export const metadata: Metadata = { title: "Secure document upload" };

/**
 * Public, token-gated. Server-side validation only; the page reveals
 * nothing beyond the allowed pending document names. Uniform message
 * for invalid/expired/revoked/exhausted links.
 */
export default async function UploadPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let docs: Array<{ id: string; name: string; status: string }> = [];
  let purposeText =
    "I consent to Demo Tax Practice collecting and storing these documents solely for processing my case.";
  let valid = false;

  if (token.length >= 32 && token.length <= 128) {
    const admin = createAdminClient();
    const { data: link } = await admin
      .from("upload_links")
      .select("id, case_id, allowed_document_ids, expires_at, revoked_at, max_uploads, uploads_used")
      .eq("token_hash", hashUploadToken(token))
      .maybeSingle();

    if (link && uploadLinkState(link) === "valid") {
      valid = true;
      const { data } = await admin
        .from("case_documents")
        .select("id, name, status")
        .in("id", link.allowed_document_ids)
        .is("deleted_at", null)
        .order("created_at");
      docs = data ?? [];

      const { data: consentSetting } = await admin
        .from("settings")
        .select("value")
        .eq("key", "consent_text_versions")
        .maybeSingle();
      if (consentSetting?.value) {
        const versions = consentSetting.value as Record<string, string>;
        const latest = Object.keys(versions).sort().at(-1);
        if (latest) purposeText = versions[latest]!;
      }
    }
  }

  return (
    <div className="flex min-h-screen items-start justify-center bg-muted/40 p-4 pt-10">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-primary">{COMPANY_NAME}</CardTitle>
          <CardDescription>Secure document upload</CardDescription>
        </CardHeader>
        <CardContent>
          {valid ? (
            docs.length > 0 ? (
              <UploadForm token={token} docs={docs} purposeText={purposeText} />
            ) : (
              <p className="text-sm text-muted-foreground">
                No documents are pending on this link. Thank you!
              </p>
            )
          ) : (
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>This upload link is not active.</p>
              <p>
                It may have expired or already been used. Please contact our office for a fresh
                link.
              </p>
            </div>
          )}
          <p className="mt-4 text-xs text-muted-foreground">
            Your documents are stored privately, used only for processing your case, and are never
            made public.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
