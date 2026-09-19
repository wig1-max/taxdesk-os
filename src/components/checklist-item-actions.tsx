"use client";

import { useState } from "react";
import { updateChecklistStatusAction } from "@/app/actions/documents";
import { useReconciledAction } from "@/components/ui/use-reconciled-action";
import { UnconfirmedNotice } from "@/components/ui/reconcile-unconfirmed";

const STATUSES = ["requested", "received", "verified", "rejected", "waived", "pending"] as const;

/**
 * Per-checklist-item status control (reconciled in K.2.9.2). The reason field
 * appears ONLY for Rejected/Waived (the only statuses that need one), and the
 * required-reason validation stays server-side so its message is the single
 * source of truth.
 *
 * Reconciliation: the write runs through {@link useReconciledAction} keyed on the
 * item's persisted `docStatus`, so the inline "Saved ✓" appears ONLY after the
 * new status is actually reflected in the page's props — not before. Re-applying
 * the SAME status (no observable change) parks briefly in `unconfirmed` with a
 * safe reload rather than a false confirmation.
 */
export function ChecklistItemActions({
  docId,
  docName,
  docStatus,
}: {
  docId: string;
  docName: string;
  /** The item's current persisted status — the reconciliation signal. */
  docStatus: string;
}) {
  const { run, busy, error, unconfirmed, reload, clearError } = useReconciledAction({ dataVersion: docStatus });
  const [status, setStatus] = useState("");
  const [reason, setReason] = useState("");
  const [saved, setSaved] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);

  const needsReason = status === "rejected" || status === "waived";

  function apply() {
    setSaved(false);
    setLocalErr(null);
    if (!status) {
      setLocalErr("Pick a status first.");
      return;
    }
    clearError();
    run(
      () => updateChecklistStatusAction({ caseDocumentId: docId, status, reason: reason.trim() || undefined }),
      () => {
        setSaved(true);
        setReason("");
        setStatus("");
      },
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1">
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setSaved(false);
            setLocalErr(null);
          }}
          aria-label={`Set status for ${docName}`}
          className="h-8 rounded-md border border-input bg-background px-1 text-xs"
        >
          <option value="" disabled>
            set…
          </option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={apply}
          disabled={busy || !status}
          aria-label={`Apply status to ${docName}`}
          title={status ? `Apply "${status}" to ${docName}` : "Choose a status first"}
          className="h-8 rounded bg-secondary px-2 text-xs disabled:opacity-50"
        >
          {busy ? "Saving…" : "Apply"}
        </button>
        {(localErr || error) && (
          <span className="text-xs text-red-700" role="status">
            {localErr ?? error}
          </span>
        )}
        {saved && !busy && !localErr && !error && (
          <span className="text-xs text-green-700" role="status">
            Saved ✓
          </span>
        )}
      </div>
      {unconfirmed && (
        <UnconfirmedNotice onReload={reload} testId="checklist-unconfirmed">
          Saved, but the page couldn&apos;t confirm the new status. Reload to verify.
        </UnconfirmedNotice>
      )}
      {needsReason && (
        <div>
          <label className="block text-[11px] text-muted-foreground">
            Reason for rejection/waiver (required)
          </label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Document not legible"
            className="h-8 w-56 rounded-md border border-input bg-background px-2 text-xs"
          />
        </div>
      )}
    </div>
  );
}
