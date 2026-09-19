"use client";

import { useState } from "react";
import {
  finalizeTaxCaseAction,
  refreshTaxReadinessAction,
  reopenTaxCaseAction,
} from "@/app/actions/tax-readiness";
import { Drawer } from "@/components/ui/drawer";
import { useToast } from "@/components/ui/toast";
import { useReconciledAction } from "@/components/ui/use-reconciled-action";
import { UnconfirmedNotice } from "@/components/ui/reconcile-unconfirmed";

const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Filing-readiness actions (K.2.8.6; reconciled in K.2.9.2). Refresh is inline;
 * the deliberate Finalize and Reopen flows open in a focused drawer with a
 * required note and an explicit confirmation checkbox. The server re-verifies
 * everything — these controls only send the action intent, never blocker
 * counts/statuses.
 *
 * Reconciliation (K.2.9.2): reopen was the worst stale-after-success offender —
 * it toasted "Case reopened ✓" while the page stayed finalized/read-only. Every
 * write now runs through {@link useReconciledAction}: the success toast + drawer
 * close fire ONLY after `dataVersion` (derived from the readiness fields that
 * flip — overall status / finalizedAt / reopenedAt / hasRun / last-checked)
 * changes, i.e. after the read-only→editable transition is actually visible.
 */
export function ReadinessActions({
  taxCaseId,
  hasRun,
  finalized,
  canFinalize,
  isAdmin,
  dataVersion,
}: {
  taxCaseId: string;
  hasRun: boolean;
  finalized: boolean;
  canFinalize: boolean;
  isAdmin: boolean;
  /** Fingerprint of the readiness lifecycle fields that flip on finalize/reopen/
   *  refresh (see the readiness page). Keeps `busy` true until the write lands. */
  dataVersion: string;
}) {
  const toast = useToast();
  const { run: runAction, busy, error, unconfirmed, reload, clearError } = useReconciledAction({ dataVersion });
  const [drawer, setDrawer] = useState<"finalize" | "reopen" | null>(null);
  const [note, setNote] = useState("");
  const [noteConfirm, setNoteConfirm] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonConfirm, setReasonConfirm] = useState(false);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okText: string, after?: () => void) {
    clearError();
    // `runAction` keeps `busy` true until fresh props land; the drawer close +
    // success toast fire only then — never before the page reflects the write.
    runAction(fn, () => {
      after?.();
      toast.success(okText);
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {!finalized && (
          <button
            type="button"
            onClick={() => run(() => refreshTaxReadinessAction({ taxCaseId }), "Readiness checks saved ✓")}
            disabled={busy}
            className="h-9 rounded-md border bg-background px-3 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            {busy ? "Saving…" : hasRun ? "Refresh readiness" : "Save readiness result"}
          </button>
        )}
        {!finalized && (
          <button
            type="button"
            onClick={() => setDrawer("finalize")}
            disabled={busy || !canFinalize}
            className="h-9 rounded-md bg-success px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            Finalize internal preparation
          </button>
        )}
        {finalized && isAdmin && (
          <button
            type="button"
            onClick={() => setDrawer("reopen")}
            disabled={busy}
            className="h-9 rounded-md border bg-background px-3 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            Reopen case
          </button>
        )}
        {finalized && !isAdmin && (
          <span className="text-xs text-muted-foreground">Only an admin can reopen a finalized case.</span>
        )}
      </div>

      {/* While a drawer is open it owns its own inline error (avoid a duplicate
          message here); the body only surfaces errors for non-drawer actions. */}
      {error && !drawer && (
        <span className="text-xs text-danger" role="alert">
          {error}
        </span>
      )}

      {/* Reconcile timed out (refresh never confirmed) — offer a safe reload
          rather than a false "done" while the page may still contradict it. */}
      {unconfirmed && !drawer && (
        <UnconfirmedNotice onReload={reload} testId="readiness-unconfirmed">
          This action was saved, but the page couldn&apos;t confirm the case status updated. Reload to verify.
        </UnconfirmedNotice>
      )}

      {/* Finalize drawer */}
      <Drawer
        open={drawer === "finalize"}
        onClose={() => setDrawer(null)}
        dirty={!!note}
        title="Finalize internal preparation"
        description="This locks the preparation record"
        footer={
          <>
            <button type="button" onClick={() => setDrawer(null)} className="h-9 rounded-md border bg-background px-3 text-sm font-medium hover:bg-accent">
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || !noteConfirm}
              onClick={() =>
                run(() => finalizeTaxCaseAction({ taxCaseId, note: note.trim(), confirm: noteConfirm }), "Internally finalized ✓", () => {
                  setDrawer(null);
                  setNote("");
                  setNoteConfirm(false);
                })
              }
              className="h-9 rounded-md bg-success px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Finalizing…" : "Finalize now"}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            This locks the Tax Desk preparation record and makes it read-only. It does <strong>not</strong> file the
            return, authorize e-filing, or confirm tax-authority acceptance.
          </p>
          <label className="block space-y-1">
            <span className="text-xs font-medium">Finalization note (required)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} aria-label="Finalization note" className={inputCls} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={noteConfirm} onChange={(e) => setNoteConfirm(e.target.checked)} />
            I understand the case will become read-only.
          </label>
          {error && (
            <p className="text-xs text-danger" role="alert">
              {error}
            </p>
          )}
          {unconfirmed && (
            <UnconfirmedNotice onReload={reload} testId="readiness-unconfirmed">
              Finalize was saved, but the page couldn&apos;t confirm the case is now read-only. Reload to verify.
            </UnconfirmedNotice>
          )}
        </div>
      </Drawer>

      {/* Reopen drawer */}
      <Drawer
        open={drawer === "reopen"}
        onClose={() => setDrawer(null)}
        dirty={!!reason}
        title="Reopen case"
        description="Supersedes the current client approval"
        footer={
          <>
            <button type="button" onClick={() => setDrawer(null)} className="h-9 rounded-md border bg-background px-3 text-sm font-medium hover:bg-accent">
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || !reasonConfirm}
              onClick={() =>
                run(() => reopenTaxCaseAction({ taxCaseId, reason: reason.trim(), confirm: reasonConfirm }), "Case reopened ✓", () => {
                  setDrawer(null);
                  setReason("");
                  setReasonConfirm(false);
                })
              }
              className="h-9 rounded-md bg-warning px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Reopening…" : "Reopen now"}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">
            Reopening unlocks the case for editing and <strong>supersedes the current client approval</strong> — a fresh
            review/approval and a current snapshot will be required before it can be finalized again.
          </p>
          <label className="block space-y-1">
            <span className="text-xs font-medium">Reopen reason (required)</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reopen reason" className={inputCls} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={reasonConfirm} onChange={(e) => setReasonConfirm(e.target.checked)} />
            I understand prior client approval will be superseded.
          </label>
          {error && (
            <p className="text-xs text-danger" role="alert">
              {error}
            </p>
          )}
          {unconfirmed && (
            <UnconfirmedNotice onReload={reload} testId="readiness-unconfirmed">
              Reopen was saved, but the page couldn&apos;t confirm the case is editable again. Reload to verify before
              making changes.
            </UnconfirmedNotice>
          )}
        </div>
      </Drawer>
    </div>
  );
}
