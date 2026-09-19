import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { purgeAadhaarFileAction } from "@/app/actions/purge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth";
import { createClient as createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Aadhaar purge queue" };

export default async function PurgeQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; purged?: string }>;
}) {
  await requireAdmin();
  const { error, purged } = await searchParams;

  const supabase = await createServerClient();
  const { data: files } = await supabase
    .from("uploaded_files")
    .select(
      "id, original_filename, created_at, contains_aadhaar, early_purge_recommended_at, purged_at, cases:case_id(id, display_code, completed_at, clients:client_id(full_name))"
    )
    .eq("contains_aadhaar", true)
    .is("purged_at", null)
    .is("deleted_at", null)
    .order("created_at");

  const queue = (files ?? []).filter((f) => {
    const kase = f.cases as unknown as { completed_at: string | null } | null;
    return kase?.completed_at != null;
  });
  const notYet = (files ?? []).length - queue.length;

  async function doPurge(formData: FormData) {
    "use server";
    const res = await purgeAadhaarFileAction(
      String(formData.get("file_id")),
      String(formData.get("confirm") ?? "")
    );
    redirect(
      res.ok
        ? "/settings/purge?purged=1"
        : `/settings/purge?error=${encodeURIComponent(res.error ?? "")}`
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Aadhaar early-purge queue (admin)</h1>
      <p className="max-w-2xl text-sm text-muted-foreground">
        Aadhaar-sensitive files whose case is completed. Purging permanently deletes the storage
        object; the metadata row stays with <code>purged_at</code> set, and audit/consent records
        are never touched. One file at a time, with typed confirmation — no blind bulk purge.
      </p>

      {purged && (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          File purged and audited.
        </p>
      )}
      {error && (
        <p className="rounded-md border-2 border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900" role="alert">
          {error}
        </p>
      )}

      {queue.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Queue is empty.{" "}
            {notYet > 0 &&
              `${notYet} Aadhaar-flagged file(s) exist on cases still in progress — they appear here once those cases complete.`}
          </CardContent>
        </Card>
      ) : (
        queue.map((f) => {
          const kase = f.cases as unknown as {
            id: string;
            display_code: string | null;
            completed_at: string | null;
            clients: { full_name: string } | null;
          };
          return (
            <Card key={f.id} className="border-red-200">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm">{f.original_filename}</CardTitle>
                <Badge variant="destructive">Aadhaar-sensitive</Badge>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-xs text-muted-foreground">
                  Client: {kase.clients?.full_name ?? "—"} · Case:{" "}
                  <Link href={`/cases/${kase.id}`} className="text-primary hover:underline">
                    {kase.display_code}
                  </Link>{" "}
                  · Uploaded {new Date(f.created_at).toLocaleDateString("en-IN")} · Case completed{" "}
                  {kase.completed_at
                    ? new Date(kase.completed_at).toLocaleDateString("en-IN")
                    : "—"}
                  {f.early_purge_recommended_at &&
                    ` · Recommended ${new Date(f.early_purge_recommended_at).toLocaleDateString("en-IN")}`}
                </p>
                <form action={doPurge} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="file_id" value={f.id} />
                  <label className="block text-xs">
                    Type <strong>PURGE</strong> to permanently delete this file
                    <input
                      name="confirm"
                      autoComplete="off"
                      className="mt-1 block h-9 w-40 rounded-md border border-input bg-background px-2"
                    />
                  </label>
                  <button className="h-9 rounded-md bg-red-700 px-4 text-sm font-medium text-white hover:bg-red-800">
                    Purge permanently
                  </button>
                </form>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
