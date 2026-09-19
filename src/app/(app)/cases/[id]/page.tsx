import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { transitionCaseAction } from "@/app/actions/cases";
import { createFollowupAction, setFollowupStatusAction } from "@/app/actions/followups";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";
import { requireUser } from "@/lib/auth";
import { createClient as createServerClient } from "@/lib/supabase/server";
import type { StatusFlow } from "@/lib/db/types";

export const metadata: Metadata = { title: "Case overview" };

export default async function CaseOverviewPage({
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
    .select("id, status, on_hold_reason, service_data, services(code, status_flow)")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!kase) notFound();

  const flow = (kase.services as unknown as { status_flow: StatusFlow }).status_flow;
  const filingStatuses = flow.filing_confirmation_required ?? [];

  const [{ data: history }, { data: followups }, { data: users }] = await Promise.all([
    supabase
      .from("case_status_history")
      .select("id, from_status, to_status, reason, created_at, users:changed_by(full_name)")
      .eq("case_id", id)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("followups")
      .select("id, due_date, note, status, users:assigned_to(full_name)")
      .eq("case_id", id)
      .is("deleted_at", null)
      .order("due_date"),
    supabase.from("users").select("id, full_name").eq("is_active", true),
  ]);

  async function doTransition(formData: FormData) {
    "use server";
    const res = await transitionCaseAction({
      caseId: id,
      toStatus: String(formData.get("to_status") ?? ""),
      reason: String(formData.get("reason") ?? "") || undefined,
      confirmedManualAction: formData.get("confirmed_manual_action") === "on",
      nextActionOverride: String(formData.get("next_action") ?? "") || undefined,
      nextActionDue: String(formData.get("next_action_due") ?? "") || undefined,
    });
    redirect(res.ok ? `/cases/${id}` : `/cases/${id}?error=${encodeURIComponent(res.error ?? "")}`);
  }

  async function addFollowup(formData: FormData) {
    "use server";
    const res = await createFollowupAction({
      case_id: id,
      due_date: String(formData.get("due_date") ?? ""),
      note: String(formData.get("note") ?? ""),
      assigned_to: String(formData.get("assigned_to") ?? "") || undefined,
    });
    redirect(res.ok ? `/cases/${id}` : `/cases/${id}?error=${encodeURIComponent(res.error ?? "")}`);
  }

  async function markFollowup(formData: FormData) {
    "use server";
    await setFollowupStatusAction(
      String(formData.get("followup_id")),
      String(formData.get("status")) as "done" | "cancelled"
    );
    redirect(`/cases/${id}`);
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-md border-2 border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900" role="alert">
          {error}
        </p>
      )}
      {kase.status === "on_hold" && kase.on_hold_reason && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          On hold: {kase.on_hold_reason}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Change status</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={doTransition} className="space-y-3 text-sm">
              <label className="block">
                New status
                <select
                  name="to_status"
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2"
                  defaultValue=""
                  required
                >
                  <option value="" disabled>
                    Select status…
                  </option>
                  {flow.statuses
                    .filter((s) => s.code !== kase.status)
                    .map((s) => (
                      <option key={s.code} value={s.code}>
                        {s.label}
                      </option>
                    ))}
                </select>
              </label>
              <label className="block">
                Reason (needed for hold / backward / overrides)
                <input
                  name="reason"
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2"
                />
              </label>
              <label className="block">
                Next action override (optional)
                <input
                  name="next_action"
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2"
                />
              </label>
              <label className="block">
                Next action due
                <input
                  type="date"
                  name="next_action_due"
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2"
                />
              </label>
              <label className="flex items-start gap-2 rounded-md bg-amber-50 p-2 text-amber-900">
                <input type="checkbox" name="confirmed_manual_action" className="mt-0.5" />
                <span>
                  Required for {filingStatuses.join(", ") || "filing statuses"}: I confirm this
                  filing/submission was done manually by an authorized person after review. TaxDesk OS
                  OS never files anything itself.
                </span>
              </label>
              <SubmitButton
                pendingText="Applying…"
                className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
              >
                Apply transition
              </SubmitButton>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Follow-ups</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ul className="space-y-2">
              {(followups ?? []).map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-2 border-b pb-2">
                  <span>
                    <span className={f.status === "open" ? "font-medium" : "text-muted-foreground line-through"}>
                      {f.due_date}: {f.note}
                    </span>{" "}
                    <span className="text-xs text-muted-foreground">
                      ({(f.users as unknown as { full_name: string } | null)?.full_name ?? "—"} · {f.status})
                    </span>
                  </span>
                  {f.status === "open" && (
                    <form action={markFollowup} className="flex gap-1">
                      <input type="hidden" name="followup_id" value={f.id} />
                      <button name="status" value="done" className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-900">
                        Done
                      </button>
                      <button name="status" value="cancelled" className="rounded bg-gray-100 px-2 py-0.5 text-xs">
                        Cancel
                      </button>
                    </form>
                  )}
                </li>
              ))}
              {(followups ?? []).length === 0 && (
                <li className="text-muted-foreground">No follow-ups.</li>
              )}
            </ul>
            <form action={addFollowup} className="flex flex-wrap items-end gap-2 border-t pt-3">
              <input type="date" name="due_date" required aria-label="Follow-up due date" className="h-9 rounded-md border border-input bg-background px-2" />
              <input name="note" required placeholder="Follow-up note" aria-label="Follow-up note" className="h-9 flex-1 rounded-md border border-input bg-background px-2" />
              <select name="assigned_to" aria-label="Assign follow-up to" className="h-9 rounded-md border border-input bg-background px-2">
                {(users ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name}
                  </option>
                ))}
              </select>
              <button className="h-9 rounded-md bg-secondary px-3">Add</button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Status history</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <tbody>
              {(history ?? []).map((h) => (
                <tr key={h.id} className="border-t">
                  <td className="py-1.5 pr-3 text-xs text-muted-foreground">
                    {new Date(h.created_at).toLocaleString("en-IN")}
                  </td>
                  <td className="py-1.5 pr-3">
                    {h.from_status ? `${h.from_status} → ` : ""}
                    <span className="font-medium">{h.to_status}</span>
                  </td>
                  <td className="py-1.5 pr-3 text-muted-foreground">{h.reason ?? ""}</td>
                  <td className="py-1.5 text-xs">
                    {(h.users as unknown as { full_name: string } | null)?.full_name ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
