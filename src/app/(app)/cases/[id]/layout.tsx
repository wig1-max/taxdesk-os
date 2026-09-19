import Link from "next/link";
import { notFound } from "next/navigation";
import { CaseTabs } from "@/components/layout/case-tabs";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { HelpBox } from "@/components/ui/page";
import { requireUser } from "@/lib/auth";
import { createClient as createServerClient } from "@/lib/supabase/server";
import type { StatusFlow } from "@/lib/db/types";
import { statusLabel } from "@/lib/status-flow";

export default async function CaseLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;

  const supabase = await createServerClient();
  const { data: kase } = await supabase
    .from("cases")
    .select(
      "id, display_code, title, status, next_action, next_action_due, priority, aadhaar_required, clients:client_id(id, full_name), services(name, code, status_flow), owner:owner_id(full_name)"
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!kase) notFound();

  const client = kase.clients as unknown as { id: string; full_name: string };
  const service = kase.services as unknown as { name: string; code: string; status_flow: StatusFlow };
  const owner = kase.owner as unknown as { full_name: string } | null;
  const overdue =
    kase.next_action_due && kase.next_action_due < new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">{kase.title}</h1>
          <span className="font-mono text-xs text-muted-foreground">{kase.display_code}</span>
          <StatusBadge code={kase.status} label={statusLabel(service.status_flow, kase.status)} />
          {kase.priority === "high" && <Badge variant="destructive">high priority</Badge>}
          {kase.aadhaar_required && <Badge variant="warning">Aadhaar enabled</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          <Link href={`/clients/${client.id}`} className="text-primary underline">
            {client.full_name}
          </Link>
          {" · "}
          {service.name}
          {" · Owner: "}
          {owner?.full_name ?? "—"}
        </p>
        <p className="text-sm">
          <span className="font-medium">Next action:</span> {kase.next_action ?? "—"}
          {kase.next_action_due && (
            <span className={overdue ? "ml-2 font-semibold text-red-700" : "ml-2 text-muted-foreground"}>
              due {kase.next_action_due}
              {overdue ? " (overdue)" : ""}
            </span>
          )}
        </p>
      </header>
      <HelpBox>
        This is one case. The tabs below move through its work: change status and manage follow-ups
        on Overview, request/verify files on Documents, track office-held originals on Physical Docs,
        {service.code === "iepf" ? " run the IEPF identity check," : ""} agree and record Fees,
        generate PDFs, and copy client Messages. Status changes are guarded by the service&apos;s
        rules and written to the audit log.
      </HelpBox>
      <CaseTabs caseId={id} serviceCode={service.code} />
      <div>{children}</div>
    </div>
  );
}
