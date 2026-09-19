"use client";

import { ErrorRecovery } from "@/components/ui/error-recovery";

/**
 * Tax Desk section boundary (Phase K.2.9.7). Catches thrown errors that the
 * deeper task-level boundary (`cases/[id]/error.tsx`) cannot — notably the case
 * shell layout itself failing to load the workspace (`getTaxCaseWorkspace`), or
 * the ITR-prep case list. Renders within the authenticated app shell, so the
 * primary navigation stays intact and the user can recover.
 */
export default function TaxDeskError({
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
        title="The Tax Desk couldn't load"
        description="Something went wrong loading this case workspace. Your other tools are unaffected — try again, or return to the dashboard."
        back={{ href: "/dashboard", label: "Go to dashboard" }}
        testId="tax-desk-error"
      />
    </div>
  );
}
