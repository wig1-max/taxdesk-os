import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page";
import { requireAdmin } from "@/lib/auth";
import { createClient as createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; case?: string }>;
}) {
  await requireAdmin();
  const { action, case: caseId } = await searchParams;

  // RLS: only admins can read audit_logs (session client enforces it).
  const supabase = await createServerClient();
  let builder = supabase
    .from("audit_logs")
    .select("id, actor_role, action, entity_type, entity_id, case_id, before, after, created_at, users:actor_id(full_name)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (action) builder = builder.ilike("action", `%${action}%`);
  if (caseId) builder = builder.eq("case_id", caseId);
  const { data: logs } = await builder;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Audit log (admin)"
        description="Append-only record of sensitive actions. Values are masked at write time — raw PAN/Aadhaar never appears here."
        help="Every important action — client and case create/update, PAN reveals, user invites and role changes, uploads via client links — is recorded here with who, what, and when. Rows can never be edited or deleted (corrections are new entries). Filter by action text (e.g. 'pan', 'user.', 'fee') to narrow it down."
      />

      <form className="flex flex-wrap gap-2 text-sm" action="/audit-log">
        <input
          name="action"
          defaultValue={action ?? ""}
          placeholder="Filter action (e.g. pan, fee.override)"
          className="h-9 w-64 rounded-md border border-input bg-background px-2"
        />
        <button className="h-9 rounded-md bg-secondary px-3">Filter</button>
      </form>

      {/* Keyboard-focusable + named so the horizontally-scrollable region is
          reachable by keyboard and announced as a region by screen readers
          (axe `scrollable-region-focusable`; WCAG 2.1.1). */}
      <div
        className="overflow-x-auto rounded-md border"
        role="region"
        aria-label="Audit log"
        tabIndex={0}
      >
        <table className="w-full text-xs">
          <thead className="bg-muted/60 text-left">
            <tr>
              <th className="px-2 py-2">When</th>
              <th className="px-2 py-2">Actor</th>
              <th className="px-2 py-2">Action</th>
              <th className="px-2 py-2">Entity</th>
              <th className="px-2 py-2">Change</th>
            </tr>
          </thead>
          <tbody>
            {(logs ?? []).map((l) => (
              <tr key={l.id} className="border-t align-top">
                <td className="whitespace-nowrap px-2 py-1.5">
                  {new Date(l.created_at).toLocaleString("en-IN")}
                </td>
                <td className="px-2 py-1.5">
                  {(l.users as unknown as { full_name: string } | null)?.full_name ?? l.actor_role}
                </td>
                <td className="px-2 py-1.5 font-mono">{l.action}</td>
                <td className="px-2 py-1.5">
                  {l.entity_type}
                  <span className="block text-muted-foreground">{l.entity_id.slice(0, 8)}…</span>
                </td>
                <td className="max-w-md px-2 py-1.5">
                  {l.after != null && (
                    <code className="block truncate text-[11px] text-muted-foreground">
                      {JSON.stringify(l.after).slice(0, 160)}
                    </code>
                  )}
                </td>
              </tr>
            ))}
            {(logs ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                  No audit entries match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
