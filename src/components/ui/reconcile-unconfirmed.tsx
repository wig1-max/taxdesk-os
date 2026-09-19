"use client";

import { cn } from "@/lib/utils";

/**
 * Shared recovery notice for the reconciliation `unconfirmed` state (Phase
 * K.2.9.2). When a mutation was accepted by the server but the page could not
 * confirm the fresh data landed (the background refresh timed out), we must NOT
 * report success — instead we tell the user plainly and offer a reliable hard
 * reload so they can verify BEFORE retrying, avoiding a duplicate write. The
 * calling surface keeps its submit/retry control disabled (`busy`) until the user
 * reloads (or the data lands late and self-heals into a real success).
 *
 * `ledger-workspace.tsx` keeps its own copy of this banner (its established
 * `ledger-unconfirmed` testid + wording); every OTHER converted surface uses this.
 */
export function UnconfirmedNotice({
  onReload,
  className,
  testId,
  children,
}: {
  onReload: () => void;
  className?: string;
  testId?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      role="alert"
      data-testid={testId}
      className={cn(
        "flex flex-col gap-2 rounded-md border border-warning-border bg-warning-soft px-3 py-2 text-xs text-warning",
        className,
      )}
    >
      <span>
        {children ??
          "This was saved, but the page couldn't confirm it updated. Reload to verify before trying again."}
      </span>
      <button
        type="button"
        onClick={onReload}
        className="inline-flex h-8 w-fit items-center rounded-md border border-warning-border bg-background px-3 font-medium text-foreground hover:bg-accent"
      >
        Reload page
      </button>
    </div>
  );
}
