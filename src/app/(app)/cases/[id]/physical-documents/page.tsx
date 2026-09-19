import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  createPhysicalDocumentAction,
  updatePhysicalDocumentAction,
} from "@/app/actions/physical-documents";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { describePhysicalCustody } from "@/lib/physical-custody";
import { createClient as createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Physical documents" };

const CUSTODY_BADGE: Record<string, "success" | "warning" | "destructive" | "secondary"> = {
  in_custody: "warning",
  expected: "secondary",
  dispatched: "secondary",
  returned_to_client: "success",
  lost: "destructive",
};

function fromForm(f: FormData, caseId: string) {
  const s = (k: string) => String(f.get(k) ?? "").trim();
  return {
    case_id: caseId,
    name: s("name"),
    description: s("description") || undefined,
    received_date: s("received_date") || undefined,
    received_by: s("received_by"),
    storage_location: s("storage_location") || "—",
    custody_status: s("custody_status") as never,
    return_required: f.get("return_required") === "on",
    returned_date: s("returned_date") || undefined,
    returned_to: s("returned_to") || undefined,
    courier_name: s("courier_name") || undefined,
    tracking_number: s("tracking_number") || undefined,
    dispatched_date: s("dispatched_date") || undefined,
    notes: s("notes") || undefined,
  };
}

export default async function PhysicalDocumentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const { error } = await searchParams;

  const supabase = await createServerClient();
  const [{ data: docs }, { data: users }] = await Promise.all([
    supabase
      .from("physical_documents")
      .select("*")
      .eq("case_id", id)
      .is("deleted_at", null)
      .order("created_at"),
    supabase.from("users").select("id, full_name").eq("is_active", true),
  ]);

  async function addDoc(formData: FormData) {
    "use server";
    const res = await createPhysicalDocumentAction(fromForm(formData, id));
    redirect(
      res.ok
        ? `/cases/${id}/physical-documents`
        : `/cases/${id}/physical-documents?error=${encodeURIComponent(res.error ?? "")}`
    );
  }

  async function updateDoc(formData: FormData) {
    "use server";
    const res = await updatePhysicalDocumentAction(String(formData.get("doc_id")), fromForm(formData, id));
    redirect(
      res.ok
        ? `/cases/${id}/physical-documents`
        : `/cases/${id}/physical-documents?error=${encodeURIComponent(res.error ?? "")}`
    );
  }

  const userSelect = (name: string, defaultValue?: string | null) => (
    <select name={name} defaultValue={defaultValue ?? user.id} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
      {(users ?? []).map((u) => (
        <option key={u.id} value={u.id}>{u.full_name}</option>
      ))}
    </select>
  );

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-md border-2 border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900" role="alert">
          {error}
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        Original paper documents in the practice's custody. Dispatch needs courier + tracking + date;
        return needs date + returned-to. All custody changes are audited.
      </p>

      {(docs ?? []).map((d) => {
        const custody = describePhysicalCustody(d);
        return (
        <Card key={d.id}>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm">{d.name}</CardTitle>
            {/* Badge carries "return required" ONLY while a return is genuinely
                outstanding — a returned doc reads as returned (K.2.9.4). */}
            <Badge variant={CUSTODY_BADGE[d.custody_status] ?? "secondary"}>{custody.badge}</Badge>
          </CardHeader>
          <CardContent>
            {/* Affirmative custody state so a returned doc reads as RETURNED,
                never as an outstanding "return required" action (K.2.9.4). */}
            {custody.note && (
              <p className={`mb-3 text-xs ${custody.note.tone === "success" ? "text-success" : "text-warning"}`}>
                {custody.note.text}
              </p>
            )}
            <form action={updateDoc} className="grid gap-2 text-sm sm:grid-cols-3">
              <input type="hidden" name="doc_id" value={d.id} />
              <input type="hidden" name="name" value={d.name} />
              <input type="hidden" name="received_date" value={d.received_date ?? ""} />
              <input type="hidden" name="received_by" value={d.received_by ?? user.id} />
              <label className="block">
                Status
                <select name="custody_status" defaultValue={d.custody_status} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2">
                  {["expected", "in_custody", "dispatched", "returned_to_client", "lost"].map((s) => (
                    <option key={s} value={s}>{s.replaceAll("_", " ")}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                Storage location
                <input name="storage_location" defaultValue={d.storage_location ?? ""} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2" />
              </label>
              <label className="mt-6 flex items-center gap-2">
                <input type="checkbox" name="return_required" defaultChecked={d.return_required} />
                Return to client required
              </label>
              <label className="block">
                Courier
                <input name="courier_name" defaultValue={d.courier_name ?? ""} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2" />
              </label>
              <label className="block">
                Tracking no.
                <input name="tracking_number" defaultValue={d.tracking_number ?? ""} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2" />
              </label>
              <label className="block">
                Dispatched date
                <input type="date" name="dispatched_date" defaultValue={d.dispatched_date ?? ""} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2" />
              </label>
              <label className="block">
                Returned date
                <input type="date" name="returned_date" defaultValue={d.returned_date ?? ""} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2" />
              </label>
              <label className="block">
                Returned to
                <input name="returned_to" defaultValue={d.returned_to ?? ""} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2" />
              </label>
              <label className="block">
                Notes
                <input name="notes" defaultValue={d.notes ?? ""} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2" />
              </label>
              <div className="sm:col-span-3">
                <button className="h-9 rounded-md bg-secondary px-3">Save changes</button>
              </div>
            </form>
          </CardContent>
        </Card>
        );
      })}

      <Card>
        <CardHeader>
          <CardTitle>Register a physical document</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={addDoc} className="grid gap-2 text-sm sm:grid-cols-3">
            <label className="block sm:col-span-2">
              Document name *
              <input name="name" required placeholder="e.g. Original share certificate — XYZ Ltd" className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2" />
            </label>
            <label className="block">
              Status
              <select name="custody_status" defaultValue="expected" className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2">
                <option value="expected">expected</option>
                <option value="in_custody">in custody</option>
              </select>
            </label>
            <label className="block">
              Received date
              <input type="date" name="received_date" className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2" />
            </label>
            <label className="block">
              Received by
              {userSelect("received_by")}
            </label>
            <label className="block">
              Storage location
              <input name="storage_location" placeholder="Almirah 2 / File 14" className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2" />
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="return_required" defaultChecked />
              Return to client required
            </label>
            <label className="block sm:col-span-2">
              Description / notes
              <input name="description" className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2" />
            </label>
            <div className="sm:col-span-3">
              <button className="h-9 rounded-md bg-primary px-4 font-medium text-primary-foreground">Register</button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
