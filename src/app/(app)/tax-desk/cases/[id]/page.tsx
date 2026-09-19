import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CircleCheck,
  FileText,
  ListChecks,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getTaxCaseWorkspace } from "@/lib/queries/tax-workspace";
import { NextActionPanel } from "@/components/ui/next-action";
import { Surface, SectionHeader } from "@/components/ui/section";
import { FinancialMetric, MetricGroup } from "@/components/ui/metric";
import { LockBanner } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { TONE_CLASSES } from "@/lib/ui/status-tone";
import { resolveFinancialOutcome } from "@/lib/tax-desk/financial-outcome";
import type { ReadinessItem } from "@/lib/tax-desk/filing-readiness";

export const metadata: Metadata = { title: "ITR Prep — Overview" };

export default async function TaxPrepCasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const w = await getTaxCaseWorkspace(id);
  if (!w) notFound();

  const base = `/tax-desk/cases/${w.taxCaseId}`;
  const na = w.workflow.nextAction;
  const model = w.readiness;
  const blocking = model.items.filter((i) => i.status === "blocked");
  const warnings = model.items.filter((i) => i.status === "warning");
  const money = w.money;
  // Overview's balance comes only from the latest COMPLETE snapshot, so the
  // completeness guard (K.2.8.7) is a no-op here in practice — passed explicitly
  // so the same invariant is visibly applied at every outcome surface.
  const outcome = resolveFinancialOutcome(money?.refundOrPayable ?? null, !!money, {
    unsupportedCount: money?.unsupportedCount ?? 0,
  });
  const detail = (key: string, field: string): string | null => {
    const v = model.items.find((i) => i.itemKey === key)?.details?.[field];
    return typeof v === "string" ? v : null;
  };
  const validationLastRun = detail("validation.run_exists", "lastRunAt");
  const approvedAt = detail("client_review.current_approval", "approvedAt");

  return (
    <div className="space-y-4">
      {w.finalizedAt && (
        <LockBanner>
          Finalized {new Date(w.finalizedAt).toLocaleString("en-IN")}
          {w.finalizedByName ? ` by ${w.finalizedByName}` : ""}. Mutations are blocked server-side;
          an admin can reopen from Filing Readiness (this supersedes prior approval).
        </LockBanner>
      )}

      {/* Dominant next action */}
      <NextActionPanel
        tone={na.tone}
        title={na.title}
        description={na.description}
        href={`${base}/${na.segment}`.replace(/\/$/, "")}
        cta={na.cta}
        done={na.done}
        locked={na.locked}
      />

      {/* Financial summary + blocking issues */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Surface className="p-4 lg:col-span-2">
          <SectionHeader
            title="Financial summary"
            description={
              w.snapshotAt
                ? `Latest complete snapshot · ${new Date(w.snapshotAt).toLocaleString("en-IN")}`
                : "No complete computation snapshot yet"
            }
            icon={<CircleCheck className="h-4 w-4" />}
          />
          {money ? (
            <MetricGroup cols={4} className="mt-4">
              <FinancialMetric label="Total income" value={money.totalIncome} />
              <FinancialMetric label="Tax paid" value={money.taxPaid} />
              <FinancialMetric
                label={outcome.label}
                value={outcome.amount == null ? "—" : outcome.amount}
                tone={outcome.tone}
              />
              <FinancialMetric
                label="Regime"
                // Recommendation guard (K.2.8.7): `money` comes only from the
                // latest COMPLETE snapshot, so this is a no-op in practice —
                // applied for a consistent, defensive invariant.
                value={
                  money.unsupportedCount > 0
                    ? "—"
                    : money.regime
                      ? money.regime.charAt(0).toUpperCase() + money.regime.slice(1)
                      : "—"
                }
                size="sm"
              />
            </MetricGroup>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              Save a complete computation snapshot to see the refund/payable summary.{" "}
              <Link href={`${base}/computation`} className="text-primary hover:underline">
                Open computation →
              </Link>
            </p>
          )}
        </Surface>

        <Surface className="p-4">
          <SectionHeader
            title="Attention"
            description={`${blocking.length} blocking · ${warnings.length} warning`}
            icon={<ListChecks className="h-4 w-4" />}
          />
          <div className="mt-3 space-y-2">
            {blocking.length === 0 && warnings.length === 0 ? (
              <p className="text-sm text-success">No blocking issues or warnings.</p>
            ) : (
              <>
                {blocking.slice(0, 4).map((item) => (
                  <IssueRow key={item.itemKey} item={item} base={base} />
                ))}
                {warnings.slice(0, 3).map((item) => (
                  <IssueRow key={item.itemKey} item={item} base={base} />
                ))}
              </>
            )}
          </div>
        </Surface>
      </div>

      {/* Key dates — the workflow rail already shows per-stage state, so the
          overview shows the case's real timeline instead of duplicating it. */}
      <Surface className="p-4">
        <SectionHeader title="Key dates" description="Recent meaningful activity on this case" />
        <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <KeyDate label="Latest snapshot" at={w.snapshotAt} />
          <KeyDate label="Validation last run" at={validationLastRun} />
          <KeyDate label="Client approval" at={approvedAt} />
          <KeyDate label="Finalized" at={w.finalizedAt} by={w.finalizedByName} />
          {w.reopenedAt && <KeyDate label="Reopened" at={w.reopenedAt} />}
        </dl>
      </Surface>

      {/* Cross-links to the parent case */}
      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
        <Link href={`/cases/${w.caseId}`} className="inline-flex items-center gap-1.5 hover:text-foreground">
          <FileText className="h-4 w-4" /> Parent case
        </Link>
        <Link href={`${base}/review`} className="inline-flex items-center gap-1.5 hover:text-foreground">
          <UserCheck className="h-4 w-4" /> Client review
        </Link>
        <Link href={`${base}/readiness`} className="inline-flex items-center gap-1.5 hover:text-foreground">
          <ShieldCheck className="h-4 w-4" /> Filing readiness
        </Link>
      </div>
    </div>
  );
}

function KeyDate({ label, at, by }: { label: string; at: string | null; by?: string | null }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">
        {at ? (
          <>
            {new Date(at).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            {by ? <span className="text-muted-foreground"> · {by}</span> : null}
          </>
        ) : (
          <span className="text-muted-foreground/60">—</span>
        )}
      </dd>
    </div>
  );
}

function IssueRow({ item, base }: { item: ReadinessItem; base: string }) {
  const tone = item.status === "blocked" ? "danger" : "warning";
  const segment =
    item.category === "documents"
      ? "documents"
      : item.category === "computation"
        ? "computation"
        : item.category === "validation"
          ? "validation"
          : item.category === "client_review"
            ? "review"
            : item.category === "itr"
              ? "computation"
              : "readiness";
  return (
    <Link
      href={`${base}/${segment}`}
      className="flex items-start gap-2 rounded-md border border-transparent p-1.5 text-sm transition-colors hover:border-border hover:bg-muted/40"
    >
      <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", TONE_CLASSES[tone].dot)} aria-hidden />
      <span className="min-w-0">
        <span className="block font-medium leading-tight">{item.title}</span>
        <span className="block text-xs text-muted-foreground">{item.message}</span>
      </span>
    </Link>
  );
}
