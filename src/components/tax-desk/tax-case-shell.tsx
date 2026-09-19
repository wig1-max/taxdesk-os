import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Lock, UserCog, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusPill } from "@/components/ui/status";
import { TaxWorkflowRail } from "@/components/tax-desk/workflow-rail";
import { resolveShellAnchor, formatOutcomeAmount, manualTreatmentNote } from "@/lib/tax-desk/financial-outcome";
import { TONE_CLASSES } from "@/lib/ui/status-tone";
import type { TaxCaseWorkspace } from "@/lib/queries/tax-workspace";

/**
 * TaxCaseShell (K.2.8.5) — the persistent workspace frame wrapping every Tax
 * Desk case route (overview, documents, ledgers, computation, validation,
 * review, readiness). Keeps the client, case, AY/FY, ITR, overall status,
 * refund/payable anchor, finalized lock, and the workflow rail on screen at all
 * times so the preparer never loses context or has to remember the pipeline.
 */
export function TaxCaseShell({
  workspace,
  children,
}: {
  workspace: TaxCaseWorkspace;
  children: ReactNode;
}) {
  const w = workspace;
  const basePath = `/tax-desk/cases/${w.taxCaseId}`;
  const finalized = !!w.finalizedAt;
  // Eligibility (K.2.8.9A) — read from the canonical readiness item so the shell
  // agrees with the Readiness page and Computation gate.
  const eligItem = w.readiness.items.find((i) => i.itemKey === "eligibility.case_eligible");
  const ineligible = eligItem?.status === "blocked";
  const money = w.money;
  // Saved snapshot outcome wins; else a live preview (tagged); else "No saved
  // snapshot". Every amount still flows through the one canonical resolver.
  const anchor = resolveShellAnchor({
    savedNetPayable: money?.refundOrPayable ?? null,
    previewNetPayable: w.preview?.refundOrPayable ?? null,
    previewUnsupportedCount: w.liveUnsupportedCount,
  });
  const outcome = anchor.outcome;
  const incomplete = outcome.kind === "incomplete";
  const anchorRegime =
    incomplete ? null : anchor.source === "saved" ? money?.regime : anchor.source === "preview" ? w.preview?.regime : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Link
          href="/tax-desk/cases"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          All ITR prep cases
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href={`${basePath}/profile`}
            className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <UserCog className="h-3.5 w-3.5" aria-hidden />
            Taxpayer profile
          </Link>
          {!finalized && ineligible && (
            <Link href={`${basePath}/profile`}>
              <StatusPill tone="danger" label="Not eligible yet" />
            </Link>
          )}
          {w.requiresManualReview && (
            <Link
              href={`${basePath}/manual-review`}
              className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              data-testid="manual-review-link"
            >
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
              {w.manualReviewStatus === "approved"
                ? "Reviewer approved"
                : w.manualReviewStatus === "changes_requested"
                  ? "Reviewer returned"
                  : "Manual review"}
            </Link>
          )}
          {finalized && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-neutral-border bg-neutral-soft px-2 py-1 text-xs font-medium text-neutral">
              <Lock className="h-3.5 w-3.5" aria-hidden />
              Finalized · read-only
            </span>
          )}
        </div>
      </div>

      {/* Context header */}
      <header className="rounded-xl border bg-card p-4 shadow-elev-1 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold tracking-tight">{w.clientName}</h1>
              <StatusPill tone={w.workflow.overall.tone} label={w.workflow.overall.label} />
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {w.caseDisplayCode && (
                <Link href={`/cases/${w.caseId}`} className="font-mono text-xs text-primary hover:underline">
                  {w.caseDisplayCode}
                </Link>
              )}
              <span>
                AY {w.assessmentYear} · FY {w.financialYear}
              </span>
              <span>
                ITR {w.itrSelected ?? "—"}
                {/* Recommendation guard (K.2.8.7): a partial input can't recommend
                    an ITR form, so the "(rec. …)" is hidden while the live input
                    has unsupported entries. The selected ITR (factual) stays. */}
                {!incomplete && w.itrRecommended && w.itrRecommended !== w.itrSelected && (
                  <span className="text-muted-foreground/70"> (rec. {w.itrRecommended})</span>
                )}
              </span>
            </div>
          </div>

          <div
            className="shrink-0 rounded-lg border bg-muted/30 px-4 py-2 text-right"
            data-testid="financial-outcome"
            data-outcome-kind={outcome.kind}
            data-outcome-source={anchor.source}
          >
            <div className="flex items-center justify-end gap-1.5 text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
              {anchor.isPreview && (
                <span className="rounded bg-info-soft px-1.5 py-0.5 text-[0.6rem] font-semibold text-info">Preview</span>
              )}
              {anchor.eyebrow}
            </div>
            <div
              className={cn(
                "tnum text-2xl font-semibold leading-tight",
                outcome.amount == null ? "text-muted-foreground" : TONE_CLASSES[outcome.tone].text,
              )}
            >
              {formatOutcomeAmount(outcome)}
            </div>
            {incomplete ? (
              <div className="text-[0.7rem] leading-tight text-warning">
                {manualTreatmentNote(outcome.unsupportedCount)}
                <span className="block text-muted-foreground">No reliable balance available</span>
              </div>
            ) : (
              anchorRegime && (
                <div className="text-[0.7rem] capitalize text-muted-foreground">
                  {anchorRegime} regime{anchor.isPreview ? " · live preview (not saved)" : ""}
                </div>
              )
            )}
          </div>
        </div>

        <div className="mt-4 border-t pt-4">
          <TaxWorkflowRail basePath={basePath} stages={w.workflow.stages} />
        </div>
      </header>

      <div className="animate-fade-in">{children}</div>
    </div>
  );
}
