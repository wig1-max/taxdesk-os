"use client";

import { ErrorRecovery } from "@/components/ui/error-recovery";

/**
 * App-wide resilience fallback (Phase K.2.9.7). The broadest boundary inside the
 * authenticated shell (`(app)/layout.tsx` → AppShell): it catches any thrown
 * render/query error in an authenticated route that a nearer boundary did not,
 * so the primary navigation survives and the user is never left on a blank crash
 * screen. Tax Desk routes are additionally covered by their own nearer
 * boundaries (`tax-desk/error.tsx`, `tax-desk/cases/[id]/error.tsx`).
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="py-8">
      <ErrorRecovery
        error={error}
        reset={reset}
        back={{ href: "/dashboard", label: "Go to dashboard" }}
        testId="app-error"
      />
    </div>
  );
}
