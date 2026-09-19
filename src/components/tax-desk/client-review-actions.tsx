"use client";

import { useState } from "react";
import {
  captureClientApprovalAction,
  markClientReviewSentAction,
  prepareClientReviewAction,
  recordClientChangesRequestedAction,
} from "@/app/actions/tax-client-review";
import { APPROVAL_METHODS } from "@/lib/tax-desk/client-review-pack";
import { Drawer } from "@/components/ui/drawer";
import { useToast } from "@/components/ui/toast";
import { useReconciledAction } from "@/components/ui/use-reconciled-action";
import { UnconfirmedNotice } from "@/components/ui/reconcile-unconfirmed";
import { cn } from "@/lib/utils";

type Caps = {
  canPrepare: boolean;
  canMarkSent: boolean;
  canCaptureApproval: boolean;
  canRequestChanges: boolean;
  canReprepareStale: boolean;
};

const METHOD_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  email: "Email",
  phone: "Phone",
  in_person: "In person",
  signed_document: "Signed document",
  other: "Other",
};

const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Client-review lifecycle actions (K.2.8.6; reconciled in K.2.9.2). Renders ONE
 * dominant valid action for the current status; secondary actions stay
 * subordinate. Approval and changes-requested forms open in a focused drawer
 * (never all forms at once). Same server actions, capabilities, and
 * sensitive-text screening as before.
 *
 * Reconciliation (K.2.9.2): each lifecycle write (prepare / mark sent / capture
 * approval / record changes) runs through {@link useReconciledAction}; the
 * success toast + drawer close fire ONLY after `dataVersion` (review status +
 * freshness + the approval/sent/changes timestamps + review snapshot id) flips,
 * so the stepper never advances before the persisted state is visible.
 */
export function ClientReviewActions({
  taxCaseId,
  caps,
  disabled,
  dataVersion,
}: {
  taxCaseId: string;
  caps: Caps;
  disabled: boolean;
  /** Fingerprint of the review lifecycle fields that flip on each action. */
  dataVersion: string;
}) {
  const toast = useToast();
  const { run: runAction, busy, error, unconfirmed, reload, clearError } = useReconciledAction({ dataVersion });
  const [drawer, setDrawer] = useState<"approve" | "changes" | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okText: string, after?: () => void) {
    clearError();
    runAction(fn, () => {
      after?.();
      toast.success(okText);
    });
  }

  if (disabled) {
    return (
      <p className="rounded-md border border-warning-border bg-warning-soft px-3 py-2 text-sm text-warning">
        This tax case is finalized — client-review actions are read-only. The pack below remains viewable.
      </p>
    );
  }

  // Build the ordered list of valid actions; the first is dominant.
  const actions: { key: string; label: string; tone: "primary" | "warning" | "secondary"; run: () => void }[] = [];
  if (caps.canPrepare) {
    actions.push({
      key: "prepare",
      label: caps.canReprepareStale ? "Prepare latest snapshot again" : "Prepare review pack",
      tone: caps.canReprepareStale ? "warning" : "primary",
      run: () => run(() => prepareClientReviewAction({ taxCaseId }), "Review pack prepared ✓"),
    });
  }
  if (caps.canMarkSent) {
    actions.push({
      key: "sent",
      label: "Mark review sent",
      tone: "primary",
      run: () => run(() => markClientReviewSentAction({ taxCaseId }), "Marked as sent ✓"),
    });
  }
  if (caps.canCaptureApproval) {
    actions.push({ key: "approve", label: "Capture client approval", tone: "primary", run: () => setDrawer("approve") });
  }
  if (caps.canRequestChanges) {
    actions.push({ key: "changes", label: "Record changes requested", tone: "secondary", run: () => setDrawer("changes") });
  }

  const primary = actions[0];
  const secondary = actions.slice(1);

  return (
    <div className="space-y-3">
      {primary ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={primary.run}
            disabled={busy}
            className={cn(
              "h-9 rounded-md px-4 text-sm font-medium text-white disabled:opacity-50",
              primary.tone === "warning" ? "bg-warning hover:bg-warning/90" : "bg-primary hover:bg-primary/90",
            )}
          >
            {busy && !drawer ? "Working…" : primary.label}
          </button>
          {secondary.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={a.run}
              disabled={busy}
              className="h-9 rounded-md border bg-background px-3 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              {a.label}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No review action is available in the current state.</p>
      )}

      {/* While a drawer is open it owns its own inline error (avoid a duplicate
          message here); the body only surfaces errors for non-drawer actions. */}
      {error && !drawer && (
        <span className="text-xs text-danger" role="alert">
          {error}
        </span>
      )}

      {unconfirmed && !drawer && (
        <UnconfirmedNotice onReload={reload} testId="client-review-unconfirmed">
          This was saved, but the page couldn&apos;t confirm the review status updated. Reload to verify.
        </UnconfirmedNotice>
      )}

      <ApprovalDrawer
        open={drawer === "approve"}
        onClose={() => setDrawer(null)}
        pending={busy}
        error={error}
        unconfirmed={unconfirmed}
        onReload={reload}
        onSave={(payload) =>
          run(() => captureClientApprovalAction({ taxCaseId, ...payload }), "Client approval captured ✓", () => setDrawer(null))
        }
      />
      <ChangesDrawer
        open={drawer === "changes"}
        onClose={() => setDrawer(null)}
        pending={busy}
        error={error}
        unconfirmed={unconfirmed}
        onReload={reload}
        onSave={(payload) =>
          run(() => recordClientChangesRequestedAction({ taxCaseId, ...payload }), "Changes requested recorded ✓", () => setDrawer(null))
        }
      />
    </div>
  );
}

function ApprovalDrawer({
  open,
  onClose,
  onSave,
  pending,
  error,
  unconfirmed,
  onReload,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (p: { method: string; reference: string; approvedAt?: string }) => void;
  pending: boolean;
  error?: string | null;
  unconfirmed?: boolean;
  onReload?: () => void;
}) {
  const [method, setMethod] = useState("whatsapp");
  const [reference, setReference] = useState("");
  const [approvedAt, setApprovedAt] = useState("");
  return (
    <Drawer
      open={open}
      onClose={onClose}
      dirty={!!reference || !!approvedAt}
      title="Capture client approval"
      description="Staff-recorded client confirmation"
      footer={
        <>
          <button type="button" onClick={onClose} className="h-9 rounded-md border bg-background px-3 text-sm font-medium hover:bg-accent">
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => onSave({ method, reference: reference.trim(), approvedAt: approvedAt ? new Date(approvedAt).toISOString() : undefined })}
            className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save confirmation"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Records that a client confirmed this specific snapshot. This is <strong>not</strong> a digital signature,
          electronic consent, or filing authorization. Do not paste passwords, OTPs, PAN or Aadhaar.
        </p>
        <label className="block space-y-1">
          <span className="text-xs font-medium">Method</span>
          <select value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Approval method" className={inputCls}>
            {APPROVAL_METHODS.map((m) => (
              <option key={m} value={m}>
                {METHOD_LABEL[m] ?? m}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium">Approval date/time (optional)</span>
          <input type="datetime-local" value={approvedAt} onChange={(e) => setApprovedAt(e.target.value)} aria-label="Approval date and time" className={inputCls} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium">Reference</span>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder='e.g. "Confirmed by WhatsApp on 10 Jul 2026"'
            aria-label="Approval reference"
            className={inputCls}
          />
        </label>
        {error && (
          <p className="text-xs text-danger" role="alert">
            {error}
          </p>
        )}
        {unconfirmed && onReload && (
          <UnconfirmedNotice onReload={onReload} testId="client-review-unconfirmed">
            Approval was saved, but the page couldn&apos;t confirm it. Reload to verify before re-capturing.
          </UnconfirmedNotice>
        )}
      </div>
    </Drawer>
  );
}

function ChangesDrawer({
  open,
  onClose,
  onSave,
  pending,
  error,
  unconfirmed,
  onReload,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (p: { summary: string; method?: string }) => void;
  pending: boolean;
  error?: string | null;
  unconfirmed?: boolean;
  onReload?: () => void;
}) {
  const [summary, setSummary] = useState("");
  const [method, setMethod] = useState("");
  return (
    <Drawer
      open={open}
      onClose={onClose}
      dirty={!!summary || !!method}
      title="Record changes requested"
      description="Client asked for changes to this computation"
      footer={
        <>
          <button type="button" onClick={onClose} className="h-9 rounded-md border bg-background px-3 text-sm font-medium hover:bg-accent">
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => onSave({ summary: summary.trim(), method: method || undefined })}
            className="h-9 rounded-md bg-warning px-4 text-sm font-medium text-white hover:bg-warning/90 disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save requested changes"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block space-y-1">
          <span className="text-xs font-medium">Method (optional)</span>
          <select value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Changes method" className={inputCls}>
            <option value="">—</option>
            {APPROVAL_METHODS.map((m) => (
              <option key={m} value={m}>
                {METHOD_LABEL[m] ?? m}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium">Summary of requested changes</span>
          <input
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Brief summary of the changes the client asked for"
            aria-label="Changes summary"
            className={inputCls}
          />
        </label>
        {error && (
          <p className="text-xs text-danger" role="alert">
            {error}
          </p>
        )}
        {unconfirmed && onReload && (
          <UnconfirmedNotice onReload={onReload} testId="client-review-unconfirmed">
            This was saved, but the page couldn&apos;t confirm the review status updated. Reload to verify.
          </UnconfirmedNotice>
        )}
      </div>
    </Drawer>
  );
}
