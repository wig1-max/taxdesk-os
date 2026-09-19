import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChevronDown, Check } from "lucide-react";
import { ClientReviewActions } from "@/components/tax-desk/client-review-actions";
import { EvidenceManifestPanel } from "@/components/tax-desk/evidence-manifest-panel";
import { fieldsVersion } from "@/components/ui/reconcile-core";
import { Surface, SectionHeader } from "@/components/ui/section";
import { FinancialMetric, MetricGroup } from "@/components/ui/metric";
import { StatusPill } from "@/components/ui/status";
import { Callout } from "@/components/ui/alert";
import { EligibilityBanner } from "@/components/tax-desk/eligibility-banner";
import { requireUser } from "@/lib/auth";
import { getTaxCaseClientReviewView } from "@/lib/queries/tax-desk";
import { getEvidenceManifestWorkflowView } from "@/lib/queries/tax-evidence-manifest";
import { getTaxCaseEligibility } from "@/lib/queries/tax-eligibility";
import { computationWithheld } from "@/lib/tax-desk/eligibility";
import { reviewStatusBanner } from "@/lib/tax-desk/client-review-pack";
import { resolveFinancialOutcome } from "@/lib/tax-desk/financial-outcome";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/ui/status-tone";

export const metadata: Metadata = { title: "ITR Prep — Client Review" };

const inr = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `₹${Math.round(n).toLocaleString("en-IN")}`;
const dt = (s: string | null) => (s ? new Date(s).toLocaleString("en-IN") : "—");

const FRESHNESS: Record<string, { tone: Tone; label: string }> = {
  current: { tone: "success", label: "Approval current" },
  stale: { tone: "warning", label: "Approval out of date" },
  unavailable: { tone: "neutral", label: "No snapshot" },
  not_prepared: { tone: "neutral", label: "Not prepared" },
  blocked_partial: { tone: "danger", label: "Partial snapshot" },
  blocked_finalized: { tone: "neutral", label: "Finalized" },
};

const BANNER_TONE: Record<string, Tone> = { ok: "success", info: "info", warn: "warning", error: "danger" };

/** Lifecycle steps (linear happy path); branches shown as a note. */
const STEPS = [
  { key: "prepared", label: "Prepared" },
  { key: "sent", label: "Sent" },
  { key: "approved", label: "Approved" },
];
const STEP_INDEX: Record<string, number> = { not_started: -1, prepared: 0, sent: 1, approved: 2 };

export default async function TaxDeskClientReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const view = await getTaxCaseClientReviewView(id);
  if (!view) notFound();
  const manifestView = await getEvidenceManifestWorkflowView(id);
  const eligibility = await getTaxCaseEligibility(id);
  // Only profile / declared-situation blockers withhold the review actions; open
  // findings keep the existing K.2.7 approval-blocking flow.
  const ineligible = !!eligibility && computationWithheld(eligibility.result);

  const { model } = view;
  const banner = reviewStatusBanner(model);
  const fresh = FRESHNESS[model.approval.freshness] ?? { tone: "neutral" as Tone, label: "Not prepared" };
  const finalized = model.approval.freshness === "blocked_finalized";
  const inc = model.income;
  const tax = model.tax;
  const status = model.approval.status;
  const activeStep = STEP_INDEX[status] ?? -1;
  const branch =
    status === "changes_requested" ? "Changes requested" : status === "superseded" ? "Superseded" : null;
  // Client Review binds only complete snapshots (partial snapshots are blocked
  // from review), so the completeness guard (K.2.8.7) is a no-op in the normal
  // flow — passed explicitly so the invariant is applied at every outcome surface.
  const outcome = resolveFinancialOutcome(tax?.refundOrPayable ?? null, !!tax, {
    unsupportedCount: tax?.unsupportedCount ?? 0,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight">Client Review — {model.case.clientName}</h1>
        <StatusPill tone={fresh.tone} label={fresh.label} />
      </div>

      {/* Lifecycle stepper */}
      <Surface className="p-4">
        <ol className="flex flex-wrap items-center gap-2" aria-label="Review lifecycle">
          {STEPS.map((step, i) => {
            const done = i < activeStep;
            const current = i === activeStep;
            const tone: Tone = branch && current ? "warning" : done || current ? (done ? "success" : "info") : "neutral";
            return (
              <li key={step.key} className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
                    tone === "success" ? "bg-success text-white" : tone === "info" ? "bg-info text-white" : tone === "warning" ? "bg-warning text-white" : "bg-muted text-muted-foreground",
                  )}
                >
                  {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span className={cn("text-sm", current ? "font-semibold" : "text-muted-foreground")}>
                  {step.label}
                </span>
                {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-border" aria-hidden />}
              </li>
            );
          })}
          {branch && (
            <li className="ml-2">
              <StatusPill tone="warning" label={branch} />
            </li>
          )}
        </ol>
      </Surface>

      {eligibility && !finalized && (
        <EligibilityBanner result={eligibility.result} profileHref={`/tax-desk/cases/${view.taxCaseId}/profile`} compact />
      )}

      {/* Status banner */}
      <Callout tone={BANNER_TONE[banner.tone] ?? "info"}>{banner.text}</Callout>

      {model.blocking.length > 0 && (
        <Callout tone="danger" title="Approval is blocked">
          <ul className="mt-1 list-disc pl-5 text-xs">
            {model.blocking.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </Callout>
      )}
      {model.warnings.length > 0 && (
        <Callout tone="warning" title="Review before approving">
          <ul className="mt-1 list-disc pl-5 text-xs">
            {model.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Callout>
      )}

      {/* Lead summary + dominant action */}
      <Surface className="p-4">
        <SectionHeader
          title="Review summary"
          description={model.case.snapshotAt ? `Snapshot ${dt(model.case.snapshotAt)} · engine ${model.case.rulesVersion ?? "—"}` : "No snapshot"}
        />
        {tax ? (
          <MetricGroup cols={4} className="mt-4">
            <FinancialMetric label={outcome.label} value={outcome.amount == null ? "—" : outcome.amount} tone={outcome.tone} />
            <FinancialMetric label="Tax paid" value={tax.taxPaid} size="sm" />
            <FinancialMetric
              label="Regime"
              // Recommendation guard (K.2.8.7): a bound review snapshot is always
              // complete (partial snapshots are blocked), so this is a no-op in
              // practice — applied for a consistent, defensive invariant.
              value={(tax.unsupportedCount ?? 0) > 0 ? "—" : tax.recommendedRegime ? tax.recommendedRegime.toUpperCase() : "—"}
              size="sm"
            />
            <FinancialMetric label="Total income" value={tax.totalIncome} size="sm" />
          </MetricGroup>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No complete snapshot to summarize yet.</p>
        )}

        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <StatusPill tone={model.documents.requiredOutstanding > 0 ? "warning" : "success"} label={`Docs: ${model.documents.requiredTotal - model.documents.requiredOutstanding}/${model.documents.requiredTotal} required`} dot={false} />
          <StatusPill tone={model.validation.openError > 0 ? "danger" : model.validation.openWarning > 0 ? "warning" : "success"} label={`${model.validation.openError} err · ${model.validation.openWarning} warn`} dot={false} />
          <StatusPill tone={model.returnSelection.mismatch ? "warning" : "neutral"} label={`ITR ${model.returnSelection.selectedItrType ?? "—"}${model.returnSelection.mismatch ? " (mismatch)" : ""}`} dot={false} />
        </div>

        <div className="mt-4 border-t pt-4" data-testid="review-lifecycle">
          {ineligible ? (
            <p className="text-sm text-danger" data-testid="review-ineligible">
              Client review is unavailable until the case is eligible for computation. Resolve the eligibility
              blockers above first.
            </p>
          ) : (
            <ClientReviewActions
              taxCaseId={view.taxCaseId}
              caps={model.capabilities}
              disabled={finalized}
              // Reconciliation signal (K.2.9.2): flips on every lifecycle write —
              // status + freshness change on prepare/sent/approve/changes, and the
              // captured timestamps + review snapshot id bump alongside them.
              dataVersion={fieldsVersion([
                model.approval.status,
                model.approval.freshness,
                model.approval.sentAt,
                model.approval.approvedAt,
                model.approval.changesRequestedAt,
                model.approval.reviewSnapshotId,
              ])}
            />
          )}
        </div>
      </Surface>

      {manifestView && !ineligible && (
        <EvidenceManifestPanel
          taxCaseId={view.taxCaseId}
          view={manifestView}
          disabled={finalized}
          dataVersion={fieldsVersion([
            manifestView.latestManifest?.id ?? null,
            manifestView.latestManifest?.createdAt ?? null,
            manifestView.review.reviewManifestId,
            manifestView.review.status,
            manifestView.draftOutputs.length,
            manifestView.draftOutputs[0]?.id ?? null,
          ])}
        />
      )}

      {/* Full review pack — progressive disclosure */}
      <details className="group rounded-xl border bg-card shadow-elev-1">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold">
          <span>Full review pack</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="space-y-4 border-t p-4">
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Income & deduction summary */}
            <div>
              <h3 className="mb-2 text-sm font-semibold">Income &amp; deduction summary</h3>
              {inc ? (
                <table className="w-full text-sm">
                  <tbody>
                    {[
                      ["Salary", inc.salary],
                      ["Interest (savings + FD)", inc.interest],
                      ["Dividend / other sources", inc.dividendOther],
                      ["Exempt income", inc.exempt],
                      ["Deductions", inc.deductions],
                      ["STCG 111A", inc.stcg111a],
                      ["LTCG 112A", inc.ltcg112a],
                    ].map(([label, val]) => (
                      <tr key={label as string} className="border-t">
                        <td className="py-1 pr-2 text-muted-foreground">{label}</td>
                        <td className="py-1 text-right tnum">{inr(val as number)}</td>
                      </tr>
                    ))}
                    <tr className="border-t font-medium">
                      <td className="py-1 pr-2">Gross total income</td>
                      <td className="py-1 text-right tnum">{inr(tax?.grossTotalIncome)}</td>
                    </tr>
                    <tr className="border-t font-medium">
                      <td className="py-1 pr-2">Total income (after deductions)</td>
                      <td className="py-1 text-right tnum">{inr(tax?.totalIncome)}</td>
                    </tr>
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-muted-foreground">No snapshot to summarize yet.</p>
              )}
            </div>

            {/* Tax breakdown */}
            <div>
              <h3 className="mb-2 text-sm font-semibold">Regime &amp; tax breakdown</h3>
              {tax ? (
                <table className="w-full text-sm">
                  <tbody>
                    <tr className="border-t">
                      <td className="py-1 pr-2 text-muted-foreground">Old-regime liability</td>
                      <td className="py-1 text-right tnum">{inr(tax.oldRegimeTax)}</td>
                    </tr>
                    <tr className="border-t">
                      <td className="py-1 pr-2 text-muted-foreground">New-regime liability</td>
                      <td className="py-1 text-right tnum">{inr(tax.newRegimeTax)}</td>
                    </tr>
                    <tr className="border-t">
                      <td className="py-1 pr-2 text-muted-foreground">87A rebate</td>
                      <td className="py-1 text-right tnum">{inr(tax.rebate)}</td>
                    </tr>
                    <tr className="border-t">
                      <td className="py-1 pr-2 text-muted-foreground">Cess</td>
                      <td className="py-1 text-right tnum">{inr(tax.cess)}</td>
                    </tr>
                    <tr className="border-t">
                      <td className="py-1 pr-2 text-muted-foreground">Total tax paid</td>
                      <td className="py-1 text-right tnum">{inr(tax.taxPaid)}</td>
                    </tr>
                    <tr className="border-t font-semibold">
                      <td className="py-1 pr-2">Lower-liability regime</td>
                      <td className="py-1 text-right uppercase">{tax.recommendedRegime ?? "—"}</td>
                    </tr>
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-muted-foreground">No snapshot to compare yet.</p>
              )}
            </div>
          </div>

          {/* Documents summary */}
          <div>
            <h3 className="mb-2 text-sm font-semibold">Documents summary</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5 text-sm">
              {[
                ["Required complete", `${model.documents.requiredTotal - model.documents.requiredOutstanding} / ${model.documents.requiredTotal}`],
                ["Required outstanding", model.documents.requiredOutstanding],
                ["Received", model.documents.received],
                ["Verified", model.documents.verified],
                ["Rejected", model.documents.rejected],
              ].map(([label, val]) => (
                <div key={label as string} className="rounded-lg border p-2">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-lg font-semibold tnum">{val as string | number}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Open validation findings */}
          <div>
            <h3 className="mb-2 text-sm font-semibold">
              Open validation findings{" "}
              <span className="text-xs font-normal text-muted-foreground">
                ({model.validation.openError} error · {model.validation.openWarning} warning · {model.validation.openInfo} info)
              </span>
            </h3>
            {model.validation.openFindings.length === 0 ? (
              <p className="text-xs text-muted-foreground">No open findings from the latest validation run.</p>
            ) : (
              <ul className="space-y-1">
                {model.validation.openFindings.map((f) => (
                  <li key={f.ruleCode + f.title} className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm">
                    <StatusPill tone={f.severity === "error" ? "danger" : f.severity === "warning" ? "warning" : "info"} label={f.severity} dot={false} />
                    <span className="text-xs text-muted-foreground">{f.category}</span>
                    <span>{f.title}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </details>

      {/* Staff-recorded confirmation record */}
      <Surface className="p-4">
        <SectionHeader title="Staff-recorded client confirmation" />
        <dl className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 text-sm">
          <Fact label="Review status" value={<span className="capitalize">{model.approval.status.replace(/_/g, " ")}</span>} />
          <Fact label="Reviewed snapshot" value={<span className="font-mono text-xs">{model.approval.reviewSnapshotId ?? "—"}</span>} />
          <Fact label="Latest complete snapshot" value={<span className="font-mono text-xs">{model.approval.latestCompleteSnapshotId ?? "—"}</span>} />
          <Fact label="Recorded as sent" value={`${dt(model.approval.sentAt)}${model.approval.sentByName ? ` by ${model.approval.sentByName}` : ""}`} />
          <Fact label="Approval captured" value={`${dt(model.approval.approvedAt)}${model.approval.approvalCapturedByName ? ` by ${model.approval.approvalCapturedByName}` : ""}`} />
          <Fact label="Approval method" value={<span className="capitalize">{model.approval.approvalMethod?.replace(/_/g, " ") ?? "—"}</span>} />
          <div className="sm:col-span-2 xl:col-span-3">
            <dt className="text-xs text-muted-foreground">Approval reference</dt>
            <dd className="text-sm">{model.approval.approvalReference ?? "—"}</dd>
          </div>
          {model.approval.changesSummary && (
            <div className="sm:col-span-2 xl:col-span-3">
              <dt className="text-xs text-muted-foreground">
                Changes requested {dt(model.approval.changesRequestedAt)}
                {model.approval.changesRequestedByName ? ` by ${model.approval.changesRequestedByName}` : ""}
              </dt>
              <dd className="text-sm">{model.approval.changesSummary}</dd>
            </div>
          )}
        </dl>
        {model.approval.stale && (
          <Callout tone="warning" className="mt-3">
            This confirmation applies to an OLDER snapshot. Client approval is out of date — prepare the latest snapshot
            again and re-capture confirmation.
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

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}
