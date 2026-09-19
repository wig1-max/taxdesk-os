import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShieldCheck, History } from "lucide-react";
import { Surface, SectionHeader } from "@/components/ui/section";
import { Callout } from "@/components/ui/alert";
import { StatusPill } from "@/components/ui/status";
import { ManualReviewPanel } from "@/components/tax-desk/manual-review-panel";
import { fieldsVersion } from "@/components/ui/reconcile-core";
import { requireUser } from "@/lib/auth";
import { getManualReviewView } from "@/lib/queries/tax-reviewer";
import { manualReviewBanner, qualificationLabel, REVIEWER_DECISIONS } from "@/lib/tax-desk/reviewer";
import type { Tone } from "@/lib/ui/status-tone";

export const metadata: Metadata = { title: "ITR Prep — Manual Review" };

const dt = (s: string | null) => (s ? new Date(s).toLocaleString("en-IN") : "—");
const BANNER_TONE: Record<string, Tone> = { ok: "success", warn: "warning", danger: "danger", neutral: "neutral" };
const DECISION_LABEL: Record<string, string> = Object.fromEntries(
  REVIEWER_DECISIONS.map((d) => [d.code, d.label]),
);

export default async function ManualReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const view = await getManualReviewView(id, user);
  if (!view) notFound();

  const banner = manualReviewBanner(view.status);
  const base = `/tax-desk/cases/${id}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight">Manual professional review — {view.clientName}</h1>
        <StatusPill
          tone={BANNER_TONE[banner.tone] ?? "neutral"}
          label={view.status === "none" ? "Not started" : view.status.replace(/_/g, " ")}
        />
      </div>

      {!view.requiresReview ? (
        <Callout tone="success" title="No qualified-reviewer sign-off required">
          This case is a supported resident-individual case with no declared special situations. It follows the
          automatic computation workflow — no credentialed qualified-reviewer sign-off is needed. (Every return
          still receives independent professional review before filing.)
        </Callout>
      ) : (
        <>
          <Callout tone={BANNER_TONE[banner.tone] ?? "warning"} title="Why this case needs a reviewer">
            <p>
              The eligibility gate routed this case to <span className="font-medium">manual professional
              preparation</span> because it is outside the automatic engine&apos;s scope. Before it can
              progress, a <span className="font-medium">credentialed qualified reviewer</span> must record a
              sign-off decision below. Sign-off authorizes the manual handling; it does not enable automatic
              computation for an unsupported case.
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5" data-testid="review-reasons">
              {view.reviewBlockers.map((b) => (
                <li key={`${b.code}-${b.source ?? ""}`} data-blocker-code={b.code}>
                  {b.message}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs">
              Resolve the underlying declarations in the{" "}
              <a href={`${base}/profile`} className="font-medium text-primary hover:underline">
                taxpayer profile
              </a>{" "}
              if they were entered in error.
            </p>
          </Callout>

          <Surface className="p-4 sm:p-5">
            <SectionHeader
              title="Reviewer sign-off"
              description={
                view.assignedReviewerName
                  ? `Assigned to ${view.assignedReviewerName}${view.decidedAt ? ` · last decision ${dt(view.decidedAt)}` : ""}`
                  : "Assign a qualified reviewer, then record a decision."
              }
              icon={<ShieldCheck className="h-4 w-4" />}
            />
            <div className="mt-4">
              <ManualReviewPanel
                taxCaseId={id}
                reviewers={view.reviewers}
                assignedReviewerId={view.assignedReviewerId}
                canSignoff={view.canSignoff}
                signoffBlockedReason={view.signoffBlockedReason}
                // Reconciliation signal (K.2.9.2): flips on assign (reviewer id)
                // and on sign-off (status + decided-at + a new history row).
                dataVersion={fieldsVersion([
                  view.status,
                  view.assignedReviewerId,
                  view.decidedAt,
                  view.history.length,
                  view.history[0]?.id,
                ])}
                disabled={view.finalized}
              />
            </div>
          </Surface>
        </>
      )}

      {/* Immutable review history */}
      <Surface className="p-4 sm:p-5">
        <SectionHeader
          title="Review history"
          description="Immutable, append-only record of every reviewer decision on this case."
          icon={<History className="h-4 w-4" />}
        />
        {view.history.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground" data-testid="review-history-empty">
            No reviewer decisions recorded yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-2" data-testid="review-history">
            {view.history.map((h) => (
              <li key={h.id} className="rounded-md border p-3 text-sm" data-decision={h.decision}>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill
                    tone={h.decision === "approved_for_progression" ? "success" : "warning"}
                    label={DECISION_LABEL[h.decision] ?? h.decision}
                    dot={false}
                  />
                  <span className="font-medium">{h.reviewerName}</span>
                  <span className="text-xs text-muted-foreground">{qualificationLabel(h.qualification)}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{dt(h.createdAt)}</span>
                </div>
                {h.reason && <p className="mt-1.5 text-foreground/80">{h.reason}</p>}
              </li>
            ))}
          </ul>
        )}
      </Surface>
    </div>
  );
}
