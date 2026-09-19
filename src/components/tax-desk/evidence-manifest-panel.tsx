"use client";

import { useState } from "react";
import {
  createEvidenceManifestAction,
  generateInternalDraftOutputAction,
} from "@/app/actions/tax-evidence-manifest";
import type { EvidenceManifestWorkflowView } from "@/lib/queries/tax-evidence-manifest";
import { useReconciledAction } from "@/components/ui/use-reconciled-action";
import { UnconfirmedNotice } from "@/components/ui/reconcile-unconfirmed";
import { useToast } from "@/components/ui/toast";
import { Surface, SectionHeader } from "@/components/ui/section";
import { StatusPill } from "@/components/ui/status";
import { Callout } from "@/components/ui/alert";
import { cn, formatStaffDateTime } from "@/lib/utils";

const inr = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `₹${Math.round(n).toLocaleString("en-IN")}`;
const dt = (s: string | null) => formatStaffDateTime(s);
const shortHash = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;
/** K4-01 — a truthful label for the derived age band. Never claims senior
 *  treatment is COMPUTED, only which classification applies. */
const ageBandLabel = (band: string | null) => {
  switch (band) {
    case "below_60":
      return "Below 60";
    case "senior":
      return "Senior citizen (60–79)";
    case "super_senior":
      return "Super-senior citizen (80+)";
    default:
      return "Not resolved";
  }
};

/**
 * K3-32B — the smallest truthful staff workflow for generating an immutable
 * accepted-evidence manifest (bound to one explicitly selected regime) and,
 * once client approval is captured against it, an internal preparation-only
 * draft output. This is NOT a broad redesign: it is one self-contained panel
 * with its own reconciled mutations, reading a dedicated read model
 * (`getEvidenceManifestWorkflowView`) rather than touching the existing
 * `ReviewPackModel`/`ClientReviewActions` contract.
 */
export function EvidenceManifestPanel({
  taxCaseId,
  view,
  disabled,
  dataVersion,
}: {
  taxCaseId: string;
  view: EvidenceManifestWorkflowView;
  disabled: boolean;
  dataVersion: string;
}) {
  const toast = useToast();
  const { run, busy, error, unconfirmed, reload, clearError } = useReconciledAction({ dataVersion });
  const [regime, setRegime] = useState<"" | "old" | "new">("");

  function runAction(fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) {
    clearError();
    run(fn, () => toast.success(okText));
  }

  if (!view.reviewSnapshotId) {
    return (
      <Surface className="p-4">
        <SectionHeader title="Accepted-evidence manifest" description="Prepare the review pack first" />
        <p className="mt-3 text-sm text-muted-foreground">
          Prepare the review pack above before generating an accepted-evidence manifest.
        </p>
      </Surface>
    );
  }

  const latest = view.latestManifest;
  const latestForCurrentSnapshot = latest?.computationSnapshotId === view.reviewSnapshotId ? latest : null;
  const manifestCurrent = view.approvalCurrentForLatestManifest;

  return (
    <Surface className="p-4">
      <SectionHeader
        title="Accepted-evidence manifest"
        description="Immutable evidence + regime freeze that client approval binds to"
      />

      {disabled ? (
        <p className="mt-3 rounded-md border border-warning-border bg-warning-soft px-3 py-2 text-sm text-warning">
          This tax case is finalized — the manifest below remains viewable, read-only.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          {/* Regime selection + generation */}
          <div className="rounded-lg border p-3">
            <p className="text-xs font-medium text-muted-foreground">
              Select the regime this manifest freezes — never defaulted to the recommended regime.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name={`regime-${taxCaseId}`}
                  checked={regime === "old"}
                  onChange={() => setRegime("old")}
                  aria-label="Old regime"
                />
                Old regime{" "}
                <span className="tnum text-muted-foreground">
                  ({inr(view.latestCompleteSnapshot?.oldRegimeTotalIncome)})
                </span>
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name={`regime-${taxCaseId}`}
                  checked={regime === "new"}
                  onChange={() => setRegime("new")}
                  aria-label="New regime"
                />
                New regime{" "}
                <span className="tnum text-muted-foreground">
                  ({inr(view.latestCompleteSnapshot?.newRegimeTotalIncome)})
                </span>
              </label>
              <button
                type="button"
                disabled={busy || !regime}
                onClick={() =>
                  runAction(
                    () => createEvidenceManifestAction({ taxCaseId, selectedRegime: regime }),
                    "Evidence manifest generated ✓",
                  )
                }
                className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {busy ? "Working…" : "Generate manifest"}
              </button>
            </div>
          </div>

          {error && (
            <span className="block text-xs text-danger" role="alert">
              {error}
            </span>
          )}
          {unconfirmed && (
            <UnconfirmedNotice onReload={reload} testId="evidence-manifest-unconfirmed">
              This was saved, but the page couldn&apos;t confirm it updated. Reload to verify.
            </UnconfirmedNotice>
          )}
        </div>
      )}

      {/* Latest manifest summary — scoped to the CURRENT review snapshot.
          A manifest generated for a since-superseded snapshot is a different
          state (visible in history below, never mistaken for "current"). */}
      {latestForCurrentSnapshot ? (
        <div className="mt-4 rounded-lg border p-3" data-testid="evidence-manifest-summary">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold">
              Latest manifest — {latestForCurrentSnapshot.selectedRegime.toUpperCase()} regime
            </span>
            <StatusPill tone="success" label="Bound to current snapshot" dot={false} />
          </div>
          <dl className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3 text-xs">
            <Fact label="Manifest hash" value={<span className="font-mono">{shortHash(latestForCurrentSnapshot.manifestContentHash)}</span>} />
            <Fact label="Regime total income" value={inr(latestForCurrentSnapshot.selectedRegimeTotalIncome)} />
            <Fact label="Conservative (prep-stage) total income" value={inr(latestForCurrentSnapshot.preApprovalConservativeTotalIncome)} />
            <Fact label="Tax pack" value={`${latestForCurrentSnapshot.taxPackId} · ${latestForCurrentSnapshot.taxPackVersion} · ${latestForCurrentSnapshot.taxPackLifecycleStatus}`} />
            <Fact
              label="Taxpayer age band"
              value={ageBandLabel(latestForCurrentSnapshot.seniorTreatmentAgeBand)}
            />
            <Fact
              label="Residential status"
              value={latestForCurrentSnapshot.seniorTreatmentResidentialStatus ?? "Not resolved"}
            />
            <Fact
              label="Blockers"
              value={
                latestForCurrentSnapshot.activeBlockerCodes.length === 0 ? (
                  <span className="text-success">none</span>
                ) : (
                  <span className="text-danger">{latestForCurrentSnapshot.activeBlockerCodes.join(", ")}</span>
                )
              }
            />
            <Fact label="Generated" value={`${dt(latestForCurrentSnapshot.createdAt)}${latestForCurrentSnapshot.createdByName ? ` by ${latestForCurrentSnapshot.createdByName}` : ""}`} />
          </dl>

          {latestForCurrentSnapshot.seniorTreatmentComparisonUnreliable && (
            <p className="mt-3 rounded-md border border-warning-border bg-warning-soft px-3 py-2 text-xs text-warning">
              This taxpayer is a resident senior/super-senior citizen — the automatic old-vs-new regime
              comparison was not reliable (the engine does not apply senior/super-senior age treatment to
              the old regime). This selected regime is not blocked solely for age, but the alternative
              comparison must not be treated as a confirmed recommendation.
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <StatusPill
              tone={manifestCurrent ? "success" : "neutral"}
              label={manifestCurrent ? "Client approval is current for this manifest" : "Approval not yet bound to this manifest"}
              dot={false}
            />
          </div>

          {!disabled && (
            <div className="mt-3 border-t pt-3">
              <button
                type="button"
                disabled={busy || !view.draftOutputEligibility.eligible}
                onClick={() =>
                  runAction(
                    () => generateInternalDraftOutputAction({ taxCaseId }),
                    "Internal draft output generated ✓",
                  )
                }
                className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {busy ? "Working…" : "Generate internal draft output"}
              </button>
              {!view.draftOutputEligibility.eligible && view.draftOutputEligibility.message && (
                <p className="mt-1.5 text-xs text-muted-foreground">{view.draftOutputEligibility.message}</p>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          No evidence manifest has been generated yet
          {latest ? " for the current snapshot — the last one generated belongs to a superseded snapshot." : "."}
        </p>
      )}

      {/* Draft-output history */}
      <div className="mt-4">
        <h3 className="mb-2 text-sm font-semibold">Internal draft outputs</h3>
        <Callout tone="info" className="mb-2">
          Internal / preparation-only. Not an ITD JSON payload, not an e-filing upload package, not a filing action.
        </Callout>
        {view.draftOutputs.length === 0 ? (
          <p className="text-xs text-muted-foreground">No internal draft output has been generated yet.</p>
        ) : (
          <ul className="space-y-2" data-testid="draft-output-history">
            {view.draftOutputs.map((d) => (
              <DraftOutputRow key={d.id} draftOutput={d} />
            ))}
          </ul>
        )}
      </div>
    </Surface>
  );
}

function DraftOutputRow({ draftOutput }: { draftOutput: EvidenceManifestWorkflowView["draftOutputs"][number] }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-md border p-2 text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn("flex w-full flex-wrap items-center justify-between gap-2 text-left")}
      >
        <span>
          <span className="font-mono">{shortHash(draftOutput.packageContentHash)}</span> ·{" "}
          {draftOutput.package.selectedRegime.toUpperCase()} regime · {dt(draftOutput.createdAt)}
          {draftOutput.createdByName ? ` by ${draftOutput.createdByName}` : ""}
        </span>
        <StatusPill tone="info" label={draftOutput.status} dot={false} />
      </button>
      {open && (
        <dl className="mt-2 grid gap-2 border-t pt-2 sm:grid-cols-2">
          <Fact label="Source manifest hash" value={<span className="font-mono">{shortHash(draftOutput.sourceManifestHash)}</span>} />
          <Fact label="Selected regime total income" value={inr(draftOutput.package.selectedRegimeTotalIncome)} />
          <Fact label="ITR" value={`${draftOutput.package.selectedItrType ?? "—"} (recommended ${draftOutput.package.recommendedItrType})`} />
          <Fact label="Figures / evidence facts" value={`${draftOutput.package.figures.length} / ${draftOutput.package.evidenceFacts.length}`} />
        </dl>
      )}
    </li>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
