"use client";

import { useRouter } from "next/navigation";
import { createTaxComputationSnapshotAction } from "@/app/actions/tax-computation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useReconciledAction } from "@/components/ui/use-reconciled-action";
import { UnconfirmedNotice } from "@/components/ui/reconcile-unconfirmed";

/**
 * Read-only preview controls (reconciled in K.2.9.2). "Refresh preview" re-runs
 * the server component (no writes, so nothing to reconcile). "Save snapshot" is
 * the ONLY write: it runs through {@link useReconciledAction}, so the success
 * toast fires ONLY after `dataVersion` (the new snapshot id + count + created_at)
 * lands — the snapshot history/count never lags the "saved ✓" toast.
 */
export function SnapshotControls({
  taxCaseId,
  canSnapshot,
  blockedReason,
  dataVersion,
}: {
  taxCaseId: string;
  canSnapshot: boolean;
  blockedReason: string | null;
  /** Fingerprint of the snapshot set (latest id + count + created_at); flips
   *  when the new immutable snapshot lands. */
  dataVersion: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const { run, busy, error, unconfirmed, reload, clearError } = useReconciledAction({ dataVersion });

  function save() {
    clearError();
    run(
      () => createTaxComputationSnapshotAction({ taxCaseId }),
      () => toast.success("Snapshot saved ✓", "Immutable computation snapshot created."),
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => router.refresh()}
        disabled={busy}
        className="h-9 rounded-md bg-secondary px-3 text-sm disabled:opacity-50"
      >
        Refresh preview
      </button>
      <Button type="button" onClick={save} disabled={!canSnapshot || busy} className="h-9 px-3 text-sm">
        {unconfirmed ? "Unconfirmed" : busy ? "Saving…" : "Save snapshot"}
      </Button>
      {!canSnapshot && blockedReason && (
        <span className="text-xs text-amber-700" role="status">
          {blockedReason}
        </span>
      )}
      {error && (
        <span className="text-xs text-danger" role="alert">
          {error}
        </span>
      )}
      {unconfirmed && (
        <UnconfirmedNotice onReload={reload} testId="snapshot-unconfirmed" className="basis-full">
          The snapshot was saved, but the page couldn&apos;t confirm it appeared in history. Reload to verify before
          saving again.
        </UnconfirmedNotice>
      )}
    </div>
  );
}
