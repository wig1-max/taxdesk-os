"use client";

import { useParams } from "next/navigation";
import { ErrorRecovery } from "@/components/ui/error-recovery";

/**
 * Task-level resilience boundary (Phase K.2.9.7). Sits INSIDE the case shell
 * (`[id]/layout.tsx` → TaxCaseShell), so a thrown error in any task screen
 * (ledgers, computation, validation, review, readiness, manual-review, profile,
 * documents, overview) renders the recovery card while the case header + workflow
 * rail ABOVE it stay on screen — one failing task no longer crashes the whole
 * workspace. Errors in the shell layout itself bubble to `tax-desk/error.tsx`.
 */
export default function TaxCaseTaskError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  return (
    <div className="py-6">
      <ErrorRecovery
        error={error}
        reset={reset}
        title="This task screen couldn't load"
        description="Something went wrong loading this part of the case. The case header and the rest of the app are unaffected — try again, or return to the case overview."
        back={id ? { href: `/tax-desk/cases/${id}`, label: "Case overview" } : undefined}
        testId="tax-case-task-error"
      />
    </div>
  );
}
