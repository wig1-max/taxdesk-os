import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { generatePdfAction } from "@/app/actions/pdfs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";
import { requireUser } from "@/lib/auth";
import { isTemplateEligible } from "@/lib/pdf/pure";
import { createClient as createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "PDFs" };

export default async function CasePdfsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; generated?: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const { error, generated } = await searchParams;

  const supabase = await createServerClient();
  const { data: kase } = await supabase
    .from("cases")
    .select("id, services(code)")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!kase) notFound();
  const serviceCode = (kase.services as unknown as { code: string }).code;

  const [{ data: templates }, { data: history }] = await Promise.all([
    supabase
      .from("pdf_templates")
      .select("id, code, name, version, is_active")
      .eq("is_active", true)
      .order("code"),
    supabase
      .from("generated_pdfs")
      .select("id, storage_path, created_at, snapshot_data, pdf_templates(code, name), users:generated_by(full_name)")
      .eq("case_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const eligible = (templates ?? []).filter((t) => isTemplateEligible(t.code, serviceCode));

  async function generate(formData: FormData) {
    "use server";
    const res = await generatePdfAction(id, String(formData.get("template_code")));
    redirect(
      res.ok
        ? `/cases/${id}/pdfs?generated=1`
        : `/cases/${id}/pdfs?error=${encodeURIComponent(res.error ?? "")}`
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-md border-2 border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900" role="alert">
          {error}
        </p>
      )}
      {generated && (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          PDF generated. Download it from the history below.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Generate a PDF</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {eligible.length === 0 && (
            <p className="text-sm text-muted-foreground">No templates for this service.</p>
          )}
          <div className="flex flex-wrap gap-2">
            {eligible.map((t) => (
              <form key={t.id} action={generate}>
                <input type="hidden" name="template_code" value={t.code} />
                <SubmitButton
                  pendingText="Generating…"
                  className="rounded-md border border-primary px-3 py-2 text-sm font-medium text-primary hover:bg-primary hover:text-primary-foreground"
                >
                  {t.name}
                </SubmitButton>
              </form>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Every PDF carries the review disclaimer and is stored privately with a data snapshot.
            Downloads are streamed through the app (no public links) and are audited.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Generated PDFs</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1">Document</th>
                <th className="py-1">Generated</th>
                <th className="py-1">By</th>
                <th className="py-1">Snapshot</th>
                <th className="py-1"></th>
              </tr>
            </thead>
            <tbody>
              {(history ?? []).map((h) => {
                const tpl = h.pdf_templates as unknown as { code: string; name: string } | null;
                const by = h.users as unknown as { full_name: string } | null;
                const version = (h.snapshot_data as { template_version?: number } | null)
                  ?.template_version;
                return (
                  <tr key={h.id} className="border-t">
                    <td className="py-2 pr-2">{tpl?.name ?? "—"}</td>
                    <td className="py-2 pr-2 text-xs">
                      {new Date(h.created_at).toLocaleString("en-IN")}
                    </td>
                    <td className="py-2 pr-2 text-xs">{by?.full_name ?? "—"}</td>
                    <td className="py-2 pr-2">
                      <Badge variant="secondary">v{version ?? "?"} snapshot</Badge>
                    </td>
                    <td className="py-2">
                      <a
                        href={`/api/pdfs/${h.id}`}
                        target="_blank"
                        className="rounded-md bg-secondary px-3 py-1.5 text-xs font-medium hover:bg-secondary/70"
                      >
                        Download
                      </a>
                    </td>
                  </tr>
                );
              })}
              {(history ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="py-3 text-muted-foreground">
                    No PDFs generated yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
