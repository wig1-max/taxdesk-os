import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared page primitives so headers, help text, and empty states look
 * the same everywhere. Server-safe (no client hooks); the help panel is
 * a native <details> so it needs no JavaScript.
 */

export function PageHeader({
  title,
  description,
  help,
  actions,
}: {
  title: string;
  description?: string;
  /** Optional "What is this page for?" help; rendered in a collapsible box. */
  help?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-0.5">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {help && (
        <details className="rounded-md border bg-muted/30">
          <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-muted-foreground">
            ? What is this page for?
          </summary>
          <div className="border-t px-3 py-2 text-xs leading-5 text-muted-foreground">{help}</div>
        </details>
      )}
    </div>
  );
}

export function HelpBox({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-md border bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground",
        className
      )}
    >
      {children}
    </div>
  );
}

export function EmptyState({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-dashed px-4 py-10 text-center text-sm text-muted-foreground",
        className
      )}
    >
      {children}
    </div>
  );
}
