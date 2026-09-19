"use client";

import { startTransition, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportClientError } from "@/app/actions/report-error";

/**
 * Shared recovery UI for the route/task `error.tsx` boundaries (Phase
 * K.2.9.7 remediation). A thrown render/query error is caught by an `error.tsx`
 * boundary; instead of a full white-screen crash, this renders a calm, generic
 * recovery card with a `reset()` retry and a safe way back — while the shell
 * ABOVE the boundary (app nav, or the Tax Desk case header/rail) stays intact.
 *
 * PII / internals: the visible UI shows a GENERIC message only — never
 * `error.message`, never `error.stack`, never a digest. The opaque
 * `error.digest` + the route go to durable telemetry (`reportClientError`) via a
 * fire-once effect, so a failure is diagnosable without leaking anything into
 * the DOM. The retry control honors the Phase-6 ≥44×44 touch-target contract.
 */
export function ErrorRecovery({
  error,
  reset,
  title = "Something went wrong",
  description,
  back,
  testId = "error-recovery",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
  description?: string;
  back?: { href: string; label: string };
  testId?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();

  // Fire-once durable, PII-safe telemetry. Only the opaque digest + route leave
  // the client; the server derives the actor and redacts. Never throws upward.
  useEffect(() => {
    void reportClientError({ route: pathname ?? "unknown", digest: error.digest ?? null });
  }, [pathname, error.digest]);

  // Retry that actually recovers a SERVER-thrown error. `reset()` alone only
  // re-renders the (still-errored) cached RSC. Wrapping BOTH `router.refresh()`
  // (re-fetch the server components) and `reset()` (clear the boundary) in ONE
  // transition makes React hold the reset until the refreshed tree is ready, so
  // the boundary commits the fresh render instead of the stale error.
  function retry() {
    startTransition(() => {
      router.refresh();
      reset();
    });
  }

  return (
    <section
      role="alert"
      aria-label={title}
      data-testid={testId}
      className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-xl border bg-card p-6 text-center shadow-elev-1 sm:p-8"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-danger-soft text-danger">
        <AlertTriangle className="h-5 w-5" aria-hidden />
      </span>
      <div className="space-y-1.5">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">
          {description ??
            "This screen couldn't load. The rest of your workspace is unaffected — try again, and if it keeps happening, note the time and let an administrator know."}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          type="button"
          onClick={retry}
          className="h-11 min-w-[7rem] px-5"
          data-testid="error-recovery-retry"
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
          Try again
        </Button>
        {back && (
          // Button has no `asChild`/Slot; render an equivalently-sized link so
          // the "safe path back" is a real navigation and also a ≥44px target.
          <Link
            href={back.href}
            className="inline-flex h-11 min-w-[7rem] items-center justify-center gap-2 rounded-md border border-input bg-background px-5 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            {back.label}
          </Link>
        )}
      </div>
    </section>
  );
}
