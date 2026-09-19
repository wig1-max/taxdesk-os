import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { requireAdmin } from "@/lib/auth";
import { createClient as createServerClient } from "@/lib/supabase/server";
import type { StatusFlow } from "@/lib/db/types";

export const metadata: Metadata = { title: "Services" };

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

export default async function ServicesSettingsPage() {
  await requireAdmin();

  const supabase = await createServerClient();
  const [{ data: services }, { data: requirements }] = await Promise.all([
    supabase
      .from("services")
      .select("id, code, name, workflow_type, status_flow, default_fee_config, is_active")
      .order("name"),
    supabase
      .from("document_requirements")
      .select("service_id, code, name, is_required, condition_note, is_active, sort_order")
      .order("sort_order"),
  ]);

  const reqsByService = new Map<string, NonNullable<typeof requirements>>();
  for (const r of requirements ?? []) {
    const list = reqsByService.get(r.service_id) ?? [];
    list.push(r);
    reqsByService.set(r.service_id, list);
  }

  const svcList = services ?? [];
  const counts = {
    active: svcList.filter((s) => s.is_active).length,
    full: svcList.filter((s) => s.workflow_type === "full").length,
    lead: svcList.filter((s) => s.workflow_type === "lead").length,
    checklist: (requirements ?? []).length,
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Services (admin)"
        description="Read-only view in v1. Checklist items and status flows are seeded via migration so history stays reproducible (editable checklists are a v2 item)."
        help="A service is a type of work you offer (ITR, IEPF, GST, …). Each defines the status flow a case moves through and the document checklist clients must provide. This screen is read-only for now — to change a flow or checklist, update the seed migration and reset/redeploy, which keeps every environment identical."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Active services" value={counts.active} />
        <Stat label="Full-workflow services" value={counts.full} />
        <Stat label="Lead services" value={counts.lead} />
        <Stat label="Total checklist items" value={counts.checklist} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {svcList.map((svc) => {
          const flow = svc.status_flow as StatusFlow;
          const reqs = reqsByService.get(svc.id) ?? [];
          const feeCfg = svc.default_fee_config ?? {};
          return (
            <Card key={svc.id}>
              <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
                <CardTitle className="text-sm">
                  {svc.name}{" "}
                  <span className="font-mono text-xs text-muted-foreground">({svc.code})</span>
                </CardTitle>
                <div className="flex gap-2">
                  <Badge variant="outline">{svc.workflow_type}</Badge>
                  <Badge variant={svc.is_active ? "success" : "destructive"}>
                    {svc.is_active ? "active" : "disabled"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div>
                  <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
                    Status flow ({flow.statuses?.length ?? 0} steps)
                  </p>
                  <div className="flex flex-wrap items-center gap-1">
                    {(flow.statuses ?? []).map((s, i) => (
                      <span key={s.code} className="flex items-center gap-1">
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">
                          {s.label}
                        </span>
                        {i < (flow.statuses ?? []).length - 1 && (
                          <span className="text-muted-foreground">→</span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
                    Checklist ({reqs.length} items)
                  </p>
                  {reqs.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No checklist.</p>
                  ) : (
                    <ul className="grid gap-0.5 text-xs sm:grid-cols-2">
                      {reqs.map((r) => (
                        <li key={r.code} className="flex gap-1">
                          <span className="text-muted-foreground">•</span>
                          <span>
                            {r.name}
                            {!r.is_required && (
                              <span className="text-muted-foreground"> (optional)</span>
                            )}
                            {r.condition_note && (
                              <span className="text-muted-foreground"> — {r.condition_note}</span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {Object.keys(feeCfg).length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Fee config: <code className="text-[11px]">{JSON.stringify(feeCfg)}</code>
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
