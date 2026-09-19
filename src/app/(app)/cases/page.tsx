import type { Metadata } from "next";
import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page";
import { requireUser } from "@/lib/auth";
import { isNormalService } from "@/lib/services/catalog";
import { createClient as createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Cases" };

export default async function CasesPage({
  searchParams,
}: {
  searchParams: Promise<{ service?: string; status?: string; overdue?: string }>;
}) {
  await requireUser();
  const { service, status, overdue } = await searchParams;

  const supabase = await createServerClient();
  const { data: services } = await supabase
    .from("services")
    .select("id, code, name")
    .order("name");

  let builder = supabase
    .from("cases")
    .select(
      "id, display_code, title, status, next_action, next_action_due, priority, services(code, name), clients:client_id(full_name), owner:owner_id(full_name)"
    )
    .is("deleted_at", null)
    .order("next_action_due", { ascending: true, nullsFirst: false })
    // Tiebreaker for the (common) null-due-date group, which Postgres would
    // otherwise return in an unspecified order: newest-first, so a
    // freshly-created case is never pushed past the cap below it by an
    // arbitrary tie among older null-due rows.
    .order("created_at", { ascending: false })
    .limit(200);

  if (service) {
    // Explicit Service filter — reaches any service, including deferred ones.
    const svc = services?.find((s) => s.code === service);
    if (svc) builder = builder.eq("service_id", svc.id);
  } else {
    // Default view focuses on the normal Tax Desk services. Deferred-service
    // cases stay reachable via the Service filter and by direct URL.
    const normalIds = (services ?? []).filter((s) => isNormalService(s.code)).map((s) => s.id);
    if (normalIds.length > 0) builder = builder.in("service_id", normalIds);
  }
  if (status) builder = builder.eq("status", status);
  if (overdue === "1") {
    builder = builder
      .lt("next_action_due", new Date().toISOString().slice(0, 10))
      .is("completed_at", null);
  }
  const { data: cases } = await builder;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Cases"
        description="Tax Desk cases by default — use the Service filter for other services."
        help="A case is one job for one client — e.g. an ITR filing or a GST task. Each case moves through a status flow and has its own documents, fees, and messages. This list shows Tax Desk services by default; pick a specific service (including deferred ones like IEPF) in the Service filter to view those cases. Existing cases always stay reachable by their direct link. The due date turns red when the next action is overdue."
        actions={
          <Link href="/cases/new" className={buttonVariants()}>
            New case
          </Link>
        }
      />

      <form className="flex flex-wrap items-end gap-2" action="/cases">
        <label className="text-sm">
          Service
          <select
            name="service"
            defaultValue={service ?? ""}
            className="ml-2 h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">All</option>
            {(services ?? []).map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Status code
          <input
            name="status"
            defaultValue={status ?? ""}
            placeholder="e.g. documents_pending"
            className="ml-2 h-9 rounded-md border border-input bg-background px-2 text-sm"
          />
        </label>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" name="overdue" value="1" defaultChecked={overdue === "1"} />
          Overdue only
        </label>
        <button className="h-9 rounded-md bg-secondary px-3 text-sm">Filter</button>
      </form>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left">
            <tr>
              <th className="px-3 py-2">Code</th>
              <th className="px-3 py-2">Client</th>
              <th className="px-3 py-2">Service</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Next action</th>
              <th className="px-3 py-2">Due</th>
              <th className="px-3 py-2">Owner</th>
            </tr>
          </thead>
          <tbody>
            {(cases ?? []).map((k) => {
              const svc = k.services as unknown as { name: string } | null;
              const client = k.clients as unknown as { full_name: string } | null;
              const owner = k.owner as unknown as { full_name: string } | null;
              const isOverdue =
                k.next_action_due && k.next_action_due < new Date().toISOString().slice(0, 10);
              return (
                <tr key={k.id} className="border-t hover:bg-accent/50">
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link href={`/cases/${k.id}`} className="text-primary hover:underline">
                      {k.display_code}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{client?.full_name ?? "—"}</td>
                  <td className="px-3 py-2">{svc?.name ?? "—"}</td>
                  <td className="px-3 py-2">
                    <StatusBadge code={k.status} />
                  </td>
                  <td className="px-3 py-2">{k.next_action ?? "—"}</td>
                  <td className={`px-3 py-2 ${isOverdue ? "font-semibold text-red-700" : ""}`}>
                    {k.next_action_due ?? "—"}
                  </td>
                  <td className="px-3 py-2">{owner?.full_name ?? "—"}</td>
                </tr>
              );
            })}
            {(cases ?? []).length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  No cases found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
