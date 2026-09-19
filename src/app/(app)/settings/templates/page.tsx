import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  togglePdfTemplateAction,
  updateMessageTemplateAction,
} from "@/app/actions/templates";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { requireAdmin } from "@/lib/auth";
import { SAMPLE_PREVIEW_VARS, renderTemplate } from "@/lib/messages/render";
import { createClient as createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Templates" };

export default async function TemplatesSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  await requireAdmin();
  const { error, saved } = await searchParams;

  const supabase = await createServerClient();
  const [{ data: messageTemplates }, { data: pdfTemplates }] = await Promise.all([
    supabase
      .from("message_templates")
      .select("id, code, name, body, variables, version, is_active, services(name)")
      .order("name"),
    supabase
      .from("pdf_templates")
      .select("id, code, name, version, is_active, body_config, services(name)")
      .order("code"),
  ]);

  async function saveTemplate(formData: FormData) {
    "use server";
    const res = await updateMessageTemplateAction(String(formData.get("template_id")), {
      body: String(formData.get("body") ?? ""),
      is_active: formData.get("is_active") === "on",
    });
    redirect(
      res.ok
        ? "/settings/templates?saved=1"
        : `/settings/templates?error=${encodeURIComponent(res.error ?? "")}`
    );
  }

  async function togglePdf(formData: FormData) {
    "use server";
    await togglePdfTemplateAction(
      String(formData.get("template_id")),
      formData.get("activate") === "true"
    );
    redirect("/settings/templates");
  }

  const msgTemplates = messageTemplates ?? [];
  const pdfs = pdfTemplates ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Templates (admin)"
        description={`${msgTemplates.length} WhatsApp · ${pdfs.length} PDF. Editing a message bumps its version; messages are copy/log only — nothing is auto-sent.`}
        help="WhatsApp templates are the ready-made Hinglish messages staff copy when contacting clients. Expand a template to edit its text (which bumps the version) and preview it with sample data; {{variables}} are filled in per case. PDF templates are code-defined layouts — you can enable/disable them and view their config, but the enforced disclaimers cannot be removed here."
      />

      {saved && (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">Template saved.</p>
      )}
      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {error}
        </p>
      )}

      <section className="space-y-3">
        <h2 className="text-base font-semibold">WhatsApp message templates</h2>
        <div className="space-y-2">
          {msgTemplates.map((t) => {
            const preview = renderTemplate(t.body, SAMPLE_PREVIEW_VARS);
            const service = (t.services as unknown as { name: string } | null)?.name ?? "generic";
            return (
              <Card key={t.id}>
                <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 py-3">
                  <CardTitle className="text-sm">
                    {t.name}{" "}
                    <span className="font-mono text-xs text-muted-foreground">({t.code})</span>
                  </CardTitle>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{service}</Badge>
                    <Badge variant={t.is_active ? "success" : "destructive"}>
                      {t.is_active ? `active · v${t.version}` : "disabled"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 pt-0 text-sm">
                  <div className="flex flex-wrap gap-1">
                    {(t.variables ?? []).length === 0 ? (
                      <span className="text-xs text-muted-foreground">no variables</span>
                    ) : (
                      (t.variables ?? []).map((v: string) => (
                        <code
                          key={v}
                          className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                        >
                          {`{{${v}}}`}
                        </code>
                      ))
                    )}
                  </div>

                  <details className="group rounded-md border">
                    <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-muted-foreground marker:content-none">
                      ▸ Edit &amp; preview
                    </summary>
                    <div className="space-y-3 border-t p-3">
                      <form action={saveTemplate} className="space-y-2">
                        <input type="hidden" name="template_id" value={t.id} />
                        <textarea
                          name="body"
                          defaultValue={t.body}
                          rows={4}
                          className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
                        />
                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-1 text-xs">
                            <input type="checkbox" name="is_active" defaultChecked={t.is_active} />
                            active
                          </label>
                          <button className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">
                            Save (bumps version)
                          </button>
                        </div>
                      </form>
                      <div className="rounded-md bg-muted/50 p-3">
                        <p className="mb-1 text-xs font-medium text-muted-foreground">
                          Preview with sample fake data{" "}
                          {preview.unresolved.length > 0 &&
                            `(unresolved: ${preview.unresolved.join(", ")})`}
                        </p>
                        <p className="whitespace-pre-wrap text-xs">{preview.text}</p>
                      </div>
                    </div>
                  </details>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">PDF templates</h2>
        <p className="text-sm text-muted-foreground">
          PDF layouts are code-defined for reliability (no visual designer in v1). Text blocks live
          in body_config; disclaimers are enforced in the shared layout and cannot be removed here.
        </p>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs">
              <tr>
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Service</th>
                <th className="px-3 py-2">Version</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Config</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {pdfs.map((t) => (
                <tr key={t.id} className="border-t align-top">
                  <td className="px-3 py-2 font-mono text-xs">{t.code}</td>
                  <td className="px-3 py-2">{t.name}</td>
                  <td className="px-3 py-2">
                    {(t.services as unknown as { name: string } | null)?.name ?? "generic"}
                  </td>
                  <td className="px-3 py-2">v{t.version}</td>
                  <td className="px-3 py-2">
                    <Badge variant={t.is_active ? "success" : "destructive"}>
                      {t.is_active ? "active" : "disabled"}
                    </Badge>
                  </td>
                  <td className="max-w-xs px-3 py-2">
                    <details>
                      <summary className="cursor-pointer text-xs text-muted-foreground">
                        view config
                      </summary>
                      <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted/50 p-2 text-[11px] leading-4">
                        {JSON.stringify(t.body_config, null, 2)}
                      </pre>
                    </details>
                  </td>
                  <td className="px-3 py-2">
                    <form action={togglePdf}>
                      <input type="hidden" name="template_id" value={t.id} />
                      <input type="hidden" name="activate" value={String(!t.is_active)} />
                      <button className="rounded bg-secondary px-2 py-1 text-xs">
                        {t.is_active ? "Disable" : "Enable"}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
