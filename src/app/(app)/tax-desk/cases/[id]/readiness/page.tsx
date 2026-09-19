import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { ReadinessActions } from "@/components/tax-desk/readiness-actions";
import { fieldsVersion } from "@/components/ui/reconcile-core";
import { Surface, SectionHeader } from "@/components/ui/section";
import { StatusPill, StatusDot } from "@/components/ui/status";
import { Callout } from "@/components/ui/alert";
import { requireUser } from "@/lib/auth";
import { getTaxCaseFilingReadinessView } from "@/lib/queries/tax-readiness";
import { readinessBanner, readinessStatusLine, type ReadinessItem } from "@/lib/tax-desk/filing-readiness";
import { formatStaffDateTime } from "@/lib/utils";
import type { Tone } from "@/lib/ui/status-tone";

export const metadata: Metadata = { title: "ITR Prep — Filing Readiness" };

const dt = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("en-IN") : "—");

const OVERALL: Record<string, { tone: Tone; label: string }> = {
  ready: { tone: "success", label: "Ready for internal finalization" },
  blocked: { tone: "danger", label: "Internal finalization blocked" },
  finalized: { tone: "success", label: "Internally finalized" },
  reopened_needs_review: { tone: "warning", label: "Reopened — fresh review required" },
};

const BANNER_TONE: Record<string, Tone> = { ok: "success", info: "info", warn: "warning", error: "danger" };

/** Category → contextual destinations for a blocking item. */
function itemLinks(item: ReadinessItem): { href: string; label: string }[] {
  switch (item.category) {
    case "computation":
      return item.itemKey === "computation.snapshot_matches_live_data"
        ? [
            { href: "ledgers", label: "Open Ledgers" },
            { href: "computation", label: "Open Computation" },
          ]
        : [{ href: "computation", label: "Open Computation" }];
    case "validation":
      return [{ href: "validation", label: "Open Validation" }];
    case "documents":
      return [{ href: "documents", label: "Open Documents" }];
    case "client_review":
      return [{ href: "review", label: "Open Client Review" }];
    case "itr":
      return [{ href: "computation", label: "Open Computation" }];
    case "case":
      return [{ href: "profile", label: "Open Taxpayer Profile" }];
    default:
      return [];
  }
}

export default async function TaxDeskReadinessPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const view = await getTaxCaseFilingReadinessView(id);
  if (!view) notFound();

  const { model } = view;
  const banner = readinessBanner(model);
  const overall = OVERALL[model.overall] ?? { tone: "danger" as Tone, label: "Blocked" };
  const finalized = model.overall === "finalized";
  const basePath = `/tax-desk/cases/${view.taxCaseId}`;

  const blockers = model.items.filter((i) => i.status === "blocked");
  const warnings = model.items.filter((i) => i.status === "warning");
  const passed = model.items.filter((i) => i.status === "passed");
  const notApplicable = model.items.filter((i) => i.status === "not_applicable");

  // Reconciliation signal for ReadinessActions (K.2.9.2). These fields flip on
  // every readiness write: overall status + finalized/reopened timestamps on
  // finalize/reopen, and `hasRun` + the max persisted `last_checked_at` on a
  // readiness refresh (each refresh bumps last_checked_at), so an idempotent
  // re-refresh is still observed rather than parking in `unconfirmed`.
  const maxLastChecked = Object.values(view.persisted).reduce<string | null>(
    (max, it) => (it.last_checked_at && (!max || it.last_checked_at > max) ? it.last_checked_at : max),
    null,
  );
  const readinessVersion = fieldsVersion([
    model.overall,
    model.case.finalizedAt,
    model.case.reopenedAt,
    view.hasRun,
    maxLastChecked,
  ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight">Filing Readiness — {model.case.clientName}</h1>
        <StatusPill tone={overall.tone} label={overall.label} />
      </div>

      {/* 1. Overall status — live evaluation vs persisted checks vs finalized. */}
      <Callout tone={BANNER_TONE[banner.tone] ?? "info"} title={overall.label}>
        {readinessStatusLine({
          overall: model.overall,
          hasRun: view.hasRun,
          finalizedAtLabel: model.case.finalizedAt ? formatStaffDateTime(model.case.finalizedAt) : null,
          finalizedByName: model.case.finalizedByName,
        })}
      </Callout>

      {/* Counts + primary actions */}
      <Surface className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="flex items-center gap-1.5">
              <StatusDot tone={blockers.length > 0 ? "danger" : "neutral"} />
              <span className="tnum font-semibold">{blockers.length}</span> blocking
            </span>
            <span className="flex items-center gap-1.5">
              <StatusDot tone={warnings.length > 0 ? "warning" : "neutral"} />
              <span className="tnum font-semibold">{warnings.length}</span> warnings
            </span>
            <span className="flex items-center gap-1.5">
              <StatusDot tone="success" />
              <span className="tnum font-semibold">{passed.length}</span> passed
            </span>
          </div>
          <ReadinessActions
            taxCaseId={view.taxCaseId}
            hasRun={view.hasRun}
            finalized={finalized}
            canFinalize={model.capabilities.canFinalize}
            isAdmin={user.role === "admin"}
            dataVersion={readinessVersion}
          />
        </div>
      </Surface>

      {/* 2. Blockers — dominant, expanded */}
      {blockers.length > 0 && (
        <Surface className="border-danger-border p-4">
          <SectionHeader title="Blocking items" description="Resolve all of these before finalization" />
          <div className="mt-3 space-y-2">
            {blockers.map((item) => (
              <BlockerRow key={item.itemKey} item={item} basePath={basePath} lastChecked={view.persisted[item.itemKey]?.last_checked_at ?? null} />
            ))}
          </div>
        </Surface>
      )}

      {/* 3. Warnings — subordinate */}
      {warnings.length > 0 && (
        <Surface className="p-4">
          <SectionHeader title="Warnings" description="Do not block finalization, but review them" />
          <div className="mt-3 space-y-2">
            {warnings.map((item) => (
              <div key={item.itemKey} className="flex items-start gap-2 rounded-lg border border-warning-border bg-warning-soft/40 p-3 text-sm">
                <StatusDot tone="warning" className="mt-1.5" />
                <div>
                  <div className="font-medium">{item.title}</div>
                  <p className="text-xs text-muted-foreground">{item.message}</p>
                </div>
              </div>
            ))}
          </div>
        </Surface>
      )}

      {/* 4. Passed checks — collapsed by default */}
      {(passed.length > 0 || notApplicable.length > 0) && (
        <details className="group rounded-xl border bg-card shadow-elev-1">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold" data-testid="passed-checks">
            <span className="flex items-center gap-2">
              <StatusDot tone="success" />
              {passed.length} checks passed
              {notApplicable.length > 0 && (
                <span className="text-xs font-normal text-muted-foreground">· {notApplicable.length} n/a</span>
              )}
            </span>
            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <ul className="divide-y border-t">
            {[...passed, ...notApplicable].map((item) => (
              <li key={item.itemKey} className="flex items-start gap-2 px-4 py-2.5 text-sm">
                <StatusDot tone={item.status === "passed" ? "success" : "neutral"} className="mt-1.5" />
                <div className="min-w-0">
                  <span className="font-medium">{item.title}</span>
                  <p className="text-xs text-muted-foreground">{item.message}</p>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* 5. Finalization / reopen record */}
      <Surface className="p-4">
        <SectionHeader title="Finalization record" />
        <dl className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Finalized</dt>
            <dd>
              {model.case.finalizedAt
                ? `${formatStaffDateTime(model.case.finalizedAt)}${model.case.finalizedByName ? ` by ${model.case.finalizedByName}` : ""}`
                : "Not finalized"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Finalized snapshot</dt>
            <dd className="font-mono text-xs">{model.case.finalizedSnapshotId ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Reopened</dt>
            <dd>
              {model.case.reopenedAt
                ? `${formatStaffDateTime(model.case.reopenedAt)}${model.case.reopenedByName ? ` by ${model.case.reopenedByName}` : ""}`
                : "—"}
            </dd>
          </div>
        </dl>
        {model.overall === "reopened_needs_review" && (
          <Callout tone="warning" className="mt-3">
            This case was reopened. Prior client approval was superseded — obtain a fresh review/approval and a current
            snapshot before finalizing again.
          </Callout>
        )}
      </Surface>

      <p className="rounded-md border bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground">
        <span className="font-medium">Important disclaimer. </span>
        {model.disclaimer}
      </p>
    </div>
  );
}

function BlockerRow({
  item,
  basePath,
  lastChecked,
}: {
  item: ReadinessItem;
  basePath: string;
  lastChecked: string | null;
}) {
  const links = itemLinks(item);
  return (
    <div className="rounded-lg border border-danger-border bg-danger-soft/40 p-3" data-testid="readiness-blocker">
      <div className="flex items-start gap-2">
        <StatusDot tone="danger" className="mt-1.5" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{item.title}</span>
            <StatusPill tone="danger" label="blocking" dot={false} />
          </div>
          <p className="mt-0.5 text-sm text-foreground/80">{item.message}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {lastChecked ? `Last checked ${dt(lastChecked)}` : "Not yet persisted — save the readiness result"}
          </p>
          {links.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={`${basePath}/${l.href}`}
                  className="h-8 rounded-md border bg-background px-2.5 text-xs font-medium leading-8 hover:bg-accent"
                >
                  {l.label}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
