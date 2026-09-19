import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileCheck2 } from "lucide-react";
import { ChecklistItemActions } from "@/components/checklist-item-actions";
import { PageHeader } from "@/components/ui/page";
import { Surface, SectionHeader } from "@/components/ui/section";
import { StatusPill } from "@/components/ui/status";
import { WarningAlert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/states";
import { requireUser } from "@/lib/auth";
import { getTaxCaseDocumentsView, type TaxCaseDocsView } from "@/lib/queries/tax-desk";
import { getSourceProposalsView } from "@/lib/queries/tax-source-proposals";
import { SourceProposalsPanel } from "@/components/tax-desk/source-proposals-panel";
import { isDocSatisfied } from "@/lib/documents/document-state";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "ITR Prep — Documents" };

export default async function TaxDeskDocumentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const [view, proposalsView] = await Promise.all([
    getTaxCaseDocumentsView(id),
    getSourceProposalsView(id),
  ]);
  if (!view) notFound();

  const filesByDoc = new Map<string, typeof view.files>();
  for (const f of view.files) {
    if (!f.case_document_id) continue;
    const list = filesByDoc.get(f.case_document_id) ?? [];
    list.push(f);
    filesByDoc.set(f.case_document_id, list);
  }
  const s = view.summary;
  const collected = s.required - s.requiredOutstanding;
  const pct = s.required > 0 ? Math.round((collected / s.required) * 100) : 100;

  const outstanding = view.docs.filter((d) => d.is_required && !isDocSatisfied(d.status));
  const rest = view.docs.filter((d) => !(d.is_required && !isDocSatisfied(d.status)));

  // Required vs optional accounting — never label optional items as "missing".
  const isMissing = (st: string) => st === "pending" || st === "requested";
  const requiredComplete = s.required - s.requiredOutstanding;
  const requiredRejected = view.docs.filter((d) => d.is_required && d.status === "rejected").length;
  const optionalNotProvided = view.docs.filter((d) => !d.is_required && isMissing(d.status)).length;
  const optionalProvided = s.optional - optionalNotProvided;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Documents — ${view.clientName}`}
        description="Reads the same documents as the parent case — no duplicate document state"
        actions={
          <div className="flex flex-wrap gap-3 text-sm">
            <Link href={`/tax-desk/cases/${view.taxCaseId}`} className="text-primary hover:underline">
              ← Back to Tax Desk case
            </Link>
            <Link href={`/cases/${view.caseId}/documents`} className="text-primary hover:underline">
              Parent case Documents →
            </Link>
          </div>
        }
      />

      {/* Collection progress + stats */}
      <Surface className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionHeader
            title="ITR preparation checklist"
            description={`${collected} of ${s.required} required items collected`}
            icon={<FileCheck2 className="h-4 w-4" />}
          />
          <span className="tnum text-2xl font-semibold">{pct}%</span>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full transition-all", pct === 100 ? "bg-success" : "bg-warning")}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="Required complete" value={`${requiredComplete} / ${s.required}`} tone={requiredComplete === s.required ? "success" : undefined} />
          <Stat label="Required outstanding" value={s.requiredOutstanding} tone={s.requiredOutstanding > 0 ? "danger" : undefined} />
          <Stat label="Rejected" value={requiredRejected} tone={requiredRejected > 0 ? "danger" : undefined} />
          <Stat label="Optional provided" value={optionalProvided} />
          <Stat label="Optional not provided" value={optionalNotProvided} />
        </div>
      </Surface>

      {outstanding.length > 0 && (
        <WarningAlert title={`${outstanding.length} required document${outstanding.length === 1 ? "" : "s"} outstanding`}>
          These block computation and finalization until received, verified or waived.
        </WarningAlert>
      )}

      {view.docs.length === 0 ? (
        <EmptyState title="No checklist items yet" description="The parent case has no checklist items." />
      ) : (
        <div className="space-y-4">
          {outstanding.length > 0 && (
            <DocSection title="Outstanding required" docs={outstanding} view={view} filesByDoc={filesByDoc} />
          )}
          <DocSection title="All documents" docs={rest} view={view} filesByDoc={filesByDoc} />
        </div>
      )}

      {proposalsView && (
        <SourceProposalsPanel
          taxCaseId={proposalsView.taxCaseId}
          finalized={proposalsView.finalized}
          groups={proposalsView.groups}
          eligibleDocuments={proposalsView.eligibleDocuments}
        />
      )}

      <p className="text-xs text-muted-foreground">
        Uploads, client upload links, file verification and the Aadhaar gate live on the{" "}
        <Link href={`/cases/${view.caseId}/documents`} className="text-primary hover:underline">
          parent case Documents page
        </Link>
        .
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: "success" | "warning" | "danger";
}) {
  const active = typeof value === "number" ? value > 0 : true;
  const color =
    active && tone === "danger"
      ? "text-danger"
      : active && tone === "warning"
        ? "text-warning"
        : active && tone === "success"
          ? "text-success"
          : "text-foreground";
  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("tnum text-lg font-semibold", color)}>{value}</div>
    </div>
  );
}

function DocSection({
  title,
  docs,
  view,
  filesByDoc,
}: {
  title: string;
  docs: TaxCaseDocsView["docs"];
  view: TaxCaseDocsView;
  filesByDoc: Map<string, TaxCaseDocsView["files"]>;
}) {
  if (docs.length === 0) return null;
  return (
    <Surface>
      <div className="border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <ul className="divide-y">
        {docs.map((d) => {
          const isAadhaar = /aadhaar/i.test(d.name);
          const files = filesByDoc.get(d.id) ?? [];
          return (
            <li key={d.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{d.name}</span>
                  <StatusPill code={d.status} />
                  <span className="text-[0.7rem] uppercase tracking-wide text-muted-foreground">
                    {d.is_required ? "required" : "optional"}
                  </span>
                </div>
                {d.waived_reason && <p className="text-xs text-muted-foreground">Waiver: {d.waived_reason}</p>}
                {d.notes && <p className="text-xs text-danger">{d.notes}</p>}
                {files.length > 0 && (
                  <ul className="flex flex-wrap gap-x-3 gap-y-1 pt-0.5">
                    {files.map((f) => (
                      <li key={f.id} className="text-xs">
                        <a href={`/api/files/${f.id}`} target="_blank" className="text-primary hover:underline">
                          {f.original_filename}
                        </a>
                        {f.contains_aadhaar && (
                          <span className="ml-1 rounded bg-warning-soft px-1 text-[0.65rem] text-warning">
                            Aadhaar-sensitive
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="shrink-0">
                {isAadhaar && !view.aadhaarRequired ? (
                  <span className="text-xs text-muted-foreground">Aadhaar collection disabled</span>
                ) : (
                  <ChecklistItemActions docId={d.id} docName={d.name} docStatus={d.status} />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Surface>
  );
}
