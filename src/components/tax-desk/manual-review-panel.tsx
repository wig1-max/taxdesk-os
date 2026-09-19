"use client";

import { useState } from "react";
import { CheckCircle2, RotateCcw, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { useToast } from "@/components/ui/toast";
import { useReconciledAction } from "@/components/ui/use-reconciled-action";
import { UnconfirmedNotice } from "@/components/ui/reconcile-unconfirmed";
import { assignCaseReviewerAction, recordReviewerSignoffAction } from "@/app/actions/tax-reviewer";
import type { QualifiedReviewer } from "@/lib/queries/tax-reviewer";

/**
 * Manual-review sign-off controls (K.2.8.9B; reconciled in K.2.9.2). Assign a
 * qualified reviewer and record a decision (approve-for-progression /
 * return-for-changes). Sign-off controls are HIDDEN (with an explanatory note)
 * when the current user may not sign off — the server + RPC remain the authority.
 *
 * Reconciliation: both writes run through {@link useReconciledAction} keyed on
 * `dataVersion` (manual-review status + assigned reviewer + last-decision time +
 * review-history depth). The success toast + drawer close fire ONLY after that
 * flips, so "Sign-off recorded ✓" never appears while the status/history lag.
 */
export function ManualReviewPanel({
  taxCaseId,
  reviewers,
  assignedReviewerId,
  canSignoff,
  signoffBlockedReason,
  dataVersion,
  disabled = false,
}: {
  taxCaseId: string;
  reviewers: QualifiedReviewer[];
  assignedReviewerId: string | null;
  canSignoff: boolean;
  signoffBlockedReason: string | null;
  /** Fingerprint of the manual-review state (status + assignment + decision +
   *  history depth); flips on assign and on sign-off. */
  dataVersion: string;
  disabled?: boolean;
}) {
  const toast = useToast();
  const { run, busy, error, unconfirmed, reload, clearError } = useReconciledAction({ dataVersion });
  const [selected, setSelected] = useState(assignedReviewerId ?? "");
  const [drawer, setDrawer] = useState<null | "approve" | "return">(null);
  const [reason, setReason] = useState("");
  // Local pre-submit validation error (distinct from an action failure), so the
  // "select a reviewer" hint isn't cleared by the hook's action lifecycle.
  const [localErr, setLocalErr] = useState<string | null>(null);

  function assign() {
    setLocalErr(null);
    clearError();
    if (!selected) {
      setLocalErr("Select a qualified reviewer to assign.");
      return;
    }
    run(
      () => assignCaseReviewerAction({ taxCaseId, reviewerId: selected }),
      () => toast.success("Reviewer assigned ✓"),
    );
  }

  function signoff(decision: "approved_for_progression" | "returned_for_changes") {
    setLocalErr(null);
    clearError();
    run(
      () => recordReviewerSignoffAction({ taxCaseId, decision, reason: reason || undefined }),
      () => {
        toast.success(
          decision === "approved_for_progression" ? "Sign-off recorded ✓" : "Case returned ✓",
          "The decision is recorded in the immutable review history.",
        );
        setDrawer(null);
        setReason("");
      },
    );
  }

  const field = "h-10 w-full rounded-md border bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <div className="space-y-4" data-testid="manual-review-panel">
      {/* Assignment */}
      {!disabled && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[16rem] flex-1 space-y-1">
            <label htmlFor="mr-reviewer" className="block text-sm font-medium">
              Assign qualified reviewer
            </label>
            <select
              id="mr-reviewer"
              value={selected}
              disabled={busy}
              onChange={(e) => setSelected(e.target.value)}
              className={field}
              data-testid="reviewer-select"
            >
              <option value="">Select a reviewer…</option>
              {reviewers.map((r) => (
                <option key={r.userId} value={r.userId}>
                  {r.fullName} · {r.qualification.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
          <Button type="button" onClick={assign} disabled={busy} variant="secondary" className="h-10">
            <UserCheck className="mr-1.5 h-4 w-4" aria-hidden />
            {busy ? "Working…" : "Assign"}
          </Button>
        </div>
      )}

      {reviewers.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No active qualified reviewers exist yet. An admin can add reviewer credentials in Settings → Reviewers.
        </p>
      )}

      {/* Sign-off */}
      {canSignoff && !disabled ? (
        <div className="flex flex-wrap gap-2 border-t pt-4" data-testid="signoff-actions">
          <Button type="button" onClick={() => setDrawer("approve")} disabled={busy} className="h-9">
            <CheckCircle2 className="mr-1.5 h-4 w-4" aria-hidden />
            Approve for progression
          </Button>
          <Button type="button" onClick={() => setDrawer("return")} disabled={busy} variant="secondary" className="h-9">
            <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden />
            Return / request changes
          </Button>
        </div>
      ) : (
        signoffBlockedReason && (
          <p className="border-t pt-4 text-sm text-muted-foreground" data-testid="signoff-unavailable">
            {signoffBlockedReason}
          </p>
        )
      )}

      {(localErr || error) && (
        <p className="text-sm text-danger" role="alert">
          {localErr ?? error}
        </p>
      )}

      {unconfirmed && (
        <UnconfirmedNotice onReload={reload} testId="manual-review-unconfirmed">
          The decision was saved, but the page couldn&apos;t confirm the review status updated. Reload to verify.
        </UnconfirmedNotice>
      )}

      {/* Approve drawer */}
      <Drawer
        open={drawer === "approve"}
        onClose={() => setDrawer(null)}
        title="Approve for progression"
        description="Record that a qualified reviewer has reviewed this case and approves manual professional handling."
        footer={
          <>
            <button type="button" onClick={() => setDrawer(null)} className="h-9 rounded-md border bg-background px-3 text-sm font-medium hover:bg-accent">
              Cancel
            </button>
            <Button type="button" onClick={() => signoff("approved_for_progression")} disabled={busy} className="h-9">
              {busy ? "Recording…" : "Confirm sign-off"}
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <label htmlFor="mr-approve-reason" className="block text-sm font-medium">
            Reviewer note (optional)
          </label>
          <textarea
            id="mr-approve-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            className="w-full rounded-md border bg-background p-2 text-sm"
            placeholder="Context for the professional handling of this case…"
          />
          <p className="text-xs text-muted-foreground">
            This sign-off authorizes manual handling; it does not enable automatic computation for an unsupported case.
          </p>
        </div>
      </Drawer>

      {/* Return drawer */}
      <Drawer
        open={drawer === "return"}
        onClose={() => setDrawer(null)}
        title="Return / request changes"
        description="Send the case back to the preparer with a required reason."
        dirty={reason.length > 0}
        footer={
          <>
            <button type="button" onClick={() => setDrawer(null)} className="h-9 rounded-md border bg-background px-3 text-sm font-medium hover:bg-accent">
              Cancel
            </button>
            <Button type="button" onClick={() => signoff("returned_for_changes")} disabled={busy} variant="secondary" className="h-9">
              {busy ? "Recording…" : "Return case"}
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <label htmlFor="mr-return-reason" className="block text-sm font-medium">
            Reason <span className="text-danger">*</span>
          </label>
          <textarea
            id="mr-return-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            required
            className="w-full rounded-md border bg-background p-2 text-sm"
            placeholder="What must the preparer change before this can be signed off?"
            data-testid="return-reason"
          />
          <p className="text-xs text-muted-foreground">A reason is required and is recorded in the review history.</p>
        </div>
      </Drawer>
    </div>
  );
}
