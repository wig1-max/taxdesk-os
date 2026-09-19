import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import {
  addChecklistItemAction,
  reviewUploadedFileAction,
  setAadhaarRequiredAction,
} from "@/app/actions/documents";
import { revokeUploadLinkAction } from "@/app/actions/upload-links";
import { ChecklistItemActions } from "@/components/checklist-item-actions";
import { UploadLinkWidget } from "@/components/upload-link-widget";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { docStatusBadgeVariant } from "@/lib/documents/document-state";
import { createClient as createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Documents" };

export default async function CaseDocumentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const { error } = await searchParams;

  const supabase = await createServerClient();
  const { data: kase } = await supabase
    .from("cases")
    .select("id, aadhaar_required, aadhaar_required_reason")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!kase) notFound();

  const [{ data: docs }, { data: files }, { data: links }] = await Promise.all([
    supabase
      .from("case_documents")
      .select("id, name, status, is_required, waived_reason, notes")
      .eq("case_id", id)
      .is("deleted_at", null)
      // Stable order: many items share a created_at (instantiated together),
      // so add id as a tiebreaker to keep rows from reshuffling after edits.
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
    supabase
      .from("uploaded_files")
      .select("id, original_filename, mime_type, size_bytes, review_status, uploaded_via, contains_aadhaar, created_at, case_document_id")
      .eq("case_id", id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("upload_links")
      .select("id, expires_at, max_uploads, uploads_used, revoked_at, created_at")
      .eq("case_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const aadhaarDocs = (docs ?? []).filter((d) => /aadhaar/i.test(d.name));
  const linkableDocs = (docs ?? []).filter(
    (d) => !/aadhaar/i.test(d.name) || kase.aadhaar_required
  );

  async function addItem(formData: FormData) {
    "use server";
    const res = await addChecklistItemAction(
      id,
      String(formData.get("name") ?? ""),
      formData.get("required") === "on"
    );
    redirect(
      res.ok
        ? `/cases/${id}/documents`
        : `/cases/${id}/documents?error=${encodeURIComponent(res.error ?? "")}`
    );
  }

  async function reviewFile(formData: FormData) {
    "use server";
    const res = await reviewUploadedFileAction({
      fileId: String(formData.get("file_id")),
      decision: String(formData.get("decision")),
      reason: String(formData.get("reason") ?? "") || undefined,
    });
    redirect(
      res.ok
        ? `/cases/${id}/documents`
        : `/cases/${id}/documents?error=${encodeURIComponent(res.error ?? "")}`
    );
  }

  async function aadhaarGate(formData: FormData) {
    "use server";
    const enable = formData.get("enable") === "true";
    const res = await setAadhaarRequiredAction(id, enable, String(formData.get("reason") ?? ""));
    redirect(
      res.ok
        ? `/cases/${id}/documents`
        : `/cases/${id}/documents?error=${encodeURIComponent(res.error ?? "")}`
    );
  }

  async function revokeLink(formData: FormData) {
    "use server";
    await revokeUploadLinkAction(String(formData.get("link_id")));
    redirect(`/cases/${id}/documents`);
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-md border-2 border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900" role="alert">
          {error}
        </p>
      )}

      {aadhaarDocs.length > 0 && (
        <Card className={kase.aadhaar_required ? "border-amber-400" : ""}>
          <CardHeader>
            <CardTitle>Aadhaar collection — default DENY</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {kase.aadhaar_required ? (
              <>
                <p className="text-amber-800">
                  Aadhaar upload is ENABLED for this case. Reason: {kase.aadhaar_required_reason}.
                  Files will be flagged Aadhaar-sensitive and queued for early purge after
                  completion. Never store an Aadhaar number as text anywhere.
                </p>
                <form action={aadhaarGate}>
                  <input type="hidden" name="enable" value="false" />
                  <button className="rounded bg-secondary px-3 py-1.5 text-sm">
                    Disable Aadhaar collection
                  </button>
                </form>
              </>
            ) : (
              <>
                <p className="text-muted-foreground">
                  Aadhaar documents cannot be requested or uploaded for this case. Enable only when
                  Aadhaar collection is operationally required for this case, with a reason — this is
                  audited.
                </p>
                <form action={aadhaarGate} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="enable" value="true" />
                  <input
                    name="reason"
                    required
                    placeholder="Why is Aadhaar required for this case?"
                    className="h-9 w-72 rounded-md border border-input bg-background px-2 text-sm"
                  />
                  <button className="h-9 rounded-md bg-amber-600 px-3 text-sm font-medium text-white">
                    Enable Aadhaar (audited)
                  </button>
                </form>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Checklist</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1">Document</th>
                <th className="py-1">Status</th>
                <th className="py-1">Action</th>
              </tr>
            </thead>
            <tbody>
              {(docs ?? []).map((d) => (
                <tr key={d.id} className="border-t align-top">
                  <td className="py-2 pr-2">
                    <span>{d.name}</span>
                    {!d.is_required && (
                      <span className="ml-1 text-xs text-muted-foreground">(optional)</span>
                    )}
                    {d.waived_reason && (
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        Waiver reason: {d.waived_reason}
                      </span>
                    )}
                    {d.notes && (
                      <span className="mt-0.5 block text-xs text-red-700">{d.notes}</span>
                    )}
                  </td>
                  <td className="py-2 pr-2">
                    <Badge variant={docStatusBadgeVariant(d.status)}>{d.status}</Badge>
                  </td>
                  <td className="py-2">
                    {/aadhaar/i.test(d.name) && !kase.aadhaar_required ? (
                      <span className="text-xs text-muted-foreground">
                        Controls off — Aadhaar collection is disabled for this case.
                      </span>
                    ) : (
                      <ChecklistItemActions docId={d.id} docName={d.name} docStatus={d.status} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <form action={addItem} className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3 text-sm">
            <input name="name" required placeholder="Ad-hoc checklist item" className="h-9 w-64 rounded-md border border-input bg-background px-2" />
            <label className="flex items-center gap-1">
              <input type="checkbox" name="required" defaultChecked /> required
            </label>
            <button className="h-9 rounded-md bg-secondary px-3">Add item</button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Uploaded files</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <tbody>
              {(files ?? []).map((f) => (
                <tr key={f.id} className="border-t align-top">
                  <td className="py-2 pr-2">
                    <a href={`/api/files/${f.id}`} className="text-primary hover:underline" target="_blank">
                      {f.original_filename}
                    </a>
                    <span className="block text-xs text-muted-foreground">
                      {f.mime_type} · {(f.size_bytes / 1024).toFixed(0)} KB · via {f.uploaded_via} ·{" "}
                      {new Date(f.created_at).toLocaleString("en-IN")}
                    </span>
                    {f.contains_aadhaar && <Badge variant="warning">Aadhaar-sensitive</Badge>}
                  </td>
                  <td className="py-2 pr-2">
                    <Badge variant={f.review_status === "verified" ? "success" : f.review_status === "rejected" ? "destructive" : "warning"}>
                      {f.review_status}
                    </Badge>
                  </td>
                  <td className="py-2">
                    {f.review_status === "uploaded" && (
                      <form action={reviewFile} className="flex flex-wrap items-center gap-1">
                        <input type="hidden" name="file_id" value={f.id} />
                        <button name="decision" value="verified" className="h-8 rounded bg-green-100 px-2 text-xs text-green-900">
                          Verify
                        </button>
                        <input name="reason" placeholder="reject reason" className="h-8 w-32 rounded-md border border-input bg-background px-1 text-xs" />
                        <button name="decision" value="rejected" className="h-8 rounded bg-red-100 px-2 text-xs text-red-900">
                          Reject
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
              {(files ?? []).length === 0 && (
                <tr>
                  <td className="py-3 text-muted-foreground">No files uploaded yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Client upload link</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <UploadLinkWidget
            caseId={id}
            docs={linkableDocs.map((d) => ({ id: d.id, name: d.name, status: d.status }))}
          />
          {(links ?? []).length > 0 && (
            <div className="border-t pt-3 text-sm">
              <p className="mb-1 font-medium">Existing links</p>
              <p className="mb-2 text-xs text-muted-foreground">
                These show each link&apos;s status and expiry only — the link address (with its
                secret) is shown once at creation and can&apos;t be retrieved. Revoke and generate a
                new one if it&apos;s lost.
              </p>
              <ul className="space-y-1">
                {(links ?? []).map((l) => {
                  const state = l.revoked_at
                    ? "revoked"
                    : new Date(l.expires_at) <= new Date()
                      ? "expired"
                      : l.uploads_used >= l.max_uploads
                        ? "exhausted"
                        : "active";
                  return (
                    <li key={l.id} className="flex items-center gap-2">
                      <Badge variant={state === "active" ? "success" : "secondary"}>{state}</Badge>
                      <span className="text-xs text-muted-foreground">
                        expires {new Date(l.expires_at).toLocaleString("en-IN")} · {l.uploads_used}/{l.max_uploads} used
                      </span>
                      {state === "active" && (
                        <form action={revokeLink}>
                          <input type="hidden" name="link_id" value={l.id} />
                          <button className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-900">Revoke</button>
                        </form>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
