"use client";

import { type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useModalDialog } from "@/components/ui/use-modal-dialog";

/**
 * Accessible Drawer + ConfirmDialog (K.2.8.6). Focused, keyboard-usable panels
 * for add/edit/confirm flows so task screens don't render every form at once.
 *
 * - role="dialog" aria-modal, labelled by its title
 * - focus moves in on open, is trapped, and is restored on close
 * - Escape closes; backdrop click closes (guarded by `dirty` → confirm)
 * - motion is CSS-only and disabled under prefers-reduced-motion
 *
 * The focus/trap/Escape/restore/scroll-lock machinery lives in the shared
 * `useModalDialog` hook (extracted in K.2.9.5 and also used by the mobile nav
 * drawer in `app-shell.tsx`).
 */

export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  dirty,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** When true, a backdrop click asks before discarding unsaved changes. */
  dirty?: boolean;
}) {
  const panelRef = useModalDialog(open, onClose);
  if (!open || typeof document === "undefined") return null;

  const requestClose = () => {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <button aria-label="Close" className="absolute inset-0 bg-black/40 animate-fade-in" onClick={requestClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative flex h-full w-full max-w-md flex-col bg-elevated shadow-elev-3 animate-drawer-in focus:outline-none"
      >
        <div className="flex items-start justify-between gap-3 border-b px-5 py-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{title}</h2>
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close panel"
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t bg-elevated px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  children,
  confirmLabel = "Confirm",
  confirmTone = "danger",
  pending,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  children?: ReactNode;
  confirmLabel?: string;
  confirmTone?: "danger" | "primary";
  pending?: boolean;
}) {
  const panelRef = useModalDialog(open, onClose);
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button aria-label="Close" className="absolute inset-0 bg-black/40 animate-fade-in" onClick={onClose} />
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative w-full max-w-sm rounded-xl border bg-elevated p-5 shadow-elev-3 animate-panel-in focus:outline-none"
      >
        <h2 className="text-base font-semibold">{title}</h2>
        {children && <div className="mt-2 text-sm text-muted-foreground">{children}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-md border bg-background px-3 text-sm font-medium hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={cn(
              "h-9 rounded-md px-3 text-sm font-medium text-white disabled:opacity-50",
              confirmTone === "danger" ? "bg-danger hover:bg-danger/90" : "bg-primary hover:bg-primary/90",
            )}
          >
            {pending ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
