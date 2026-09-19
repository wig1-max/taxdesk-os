import type { Metadata } from "next";
import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { requireUser } from "@/lib/auth";
import { getDashboardData, type QueueCase } from "@/lib/queries/dashboard";

export const metadata: Metadata = { title: "Dashboard" };

function Queue({
  title,
  rows,
  tone,
  emptyText = "Nothing here. ✓",
}: {
  title: string;
  rows: QueueCase[];
  tone?: "red" | "amber";
  emptyText?: string;
}) {
  return (
    <Card className={tone === "red" ? "border-red-300" : tone === "amber" ? "border-amber-300" : ""}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          {title}
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${
              rows.length === 0
                ? "bg-green-100 text-green-800"
                : tone === "red"
                  ? "bg-red-100 text-red-800"
                  : "bg-amber-100 text-amber-800"
            }`}
          >
            {rows.length}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">{emptyText}</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {rows.slice(0, 6).map((r, i) => (
              <li key={`${r.id}-${i}`} className="flex flex-wrap items-center gap-x-2">
                <Link
                  href={`/cases/${r.id}`}
                  className="font-mono text-xs text-primary hover:underline"
                >
                  {r.display_code ?? "case"}
                </Link>
                <Link href={`/cases/${r.id}`} className="font-medium hover:underline">
                  {r.client_name}
                </Link>
                <StatusBadge code={r.status} />
                {r.extra && <span className="text-xs text-muted-foreground">{r.extra}</span>}
              </li>
            ))}
            {rows.length > 6 && (
              <li className="text-xs text-muted-foreground">…and {rows.length - 6} more</li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default async function DashboardPage() {
  const user = await requireUser();
  const d = await getDashboardData();

  return (
    <div className="space-y-4">
      <PageHeader
        title="What needs attention today?"
        description={`Namaste ${user.full_name.split(" ")[0]} — ${new Date().toLocaleDateString(
          "en-IN",
          { weekday: "long", day: "numeric", month: "long" }
        )}`}
        help="Each card is a work queue built from live case data — overdue actions, follow-ups due, uploads to review, documents pending from clients, fees due, and so on. The number badge is the count; green means the queue is clear. Click a case code or client name to jump straight to that case."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Queue title="Overdue next actions" rows={d.overdue} tone="red" />
        <Queue title="Follow-ups due today" rows={d.followupsDue} tone="red" />
        <Queue title="Uploads needing review" rows={d.filesNeedingReview} tone="amber" />
        <Queue title="Documents pending from clients" rows={d.pendingDocs} tone="amber" />
        <Queue title="Client approvals pending" rows={d.approvalsPending} tone="amber" />
        <Queue title="Balance fees pending" rows={d.balancesDue} tone="amber" />
        {/* IEPF dispatch/objection queues are deferred-service workflows —
            hidden from the default Tax Desk dashboard (K.1). The underlying
            cases stay reachable via the Cases Service filter / direct URL. */}
        {user.role === "admin" && (
          <div className="space-y-1">
            <Queue
              title="Aadhaar files — early purge queue"
              rows={d.aadhaarPurge}
              tone="red"
              emptyText="No Aadhaar-sensitive files awaiting purge."
            />
            {d.aadhaarPurge.length > 0 && (
              <Link href="/settings/purge" className="block text-xs text-red-700 underline">
                Open purge queue →
              </Link>
            )}
          </div>
        )}
        <Queue title="Physical originals in custody" rows={d.custody} tone="amber" />
        <Queue title="Recently updated" rows={d.recent} emptyText="No recent activity." />
      </div>
    </div>
  );
}
