import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { EligibilityResult } from "@/lib/tax-desk/eligibility";

/**
 * Eligibility state callout (K.2.8.9A). Rendered above the protected actions on
 * Computation / Client Review / Filing Readiness. When ineligible it names the
 * concrete, actionable blockers and links to the Taxpayer Profile — it never
 * relies on a disabled button alone to explain WHY an action is unavailable.
 *
 * `field`-bearing blockers deep-link to the profile form; the rest render as a
 * plain actionable list. Pure/server component (no client JS).
 */
export function EligibilityBanner({
  result,
  profileHref,
  compact = false,
}: {
  result: EligibilityResult;
  profileHref: string;
  compact?: boolean;
}) {
  if (result.eligible) {
    if (compact) return null;
    return (
      <div
        data-testid="eligibility-banner"
        data-eligible="true"
        className="flex items-center gap-2 rounded-lg border border-success-border bg-success-soft px-3 py-2 text-sm text-success"
      >
        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
        <span>Eligible for computation. The supported workflow can continue.</span>
      </div>
    );
  }

  return (
    <div
      data-testid="eligibility-banner"
      data-eligible="false"
      role="alert"
      className="rounded-lg border border-danger-border bg-danger-soft p-4"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden />
        <div className="min-w-0 space-y-2">
          <div>
            <h2 className="text-sm font-semibold text-danger">Not eligible for computation yet</h2>
            <p className="text-xs text-danger/90">
              Computation, regime comparison, ITR recommendation, readiness, client review and
              finalization stay unavailable until every item below is resolved.
            </p>
          </div>
          <ul className="space-y-1.5" data-testid="eligibility-blockers">
            {result.blockers.map((b, idx) => (
              <li
                key={`${b.code}-${b.source ?? idx}`}
                data-blocker-code={b.code}
                className="flex items-start gap-2 text-sm text-foreground"
              >
                <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-danger" />
                <span className="min-w-0">
                  {b.message}
                  {b.field && (
                    <Link href={profileHref} className="ml-1 font-medium text-primary hover:underline">
                      Open taxpayer profile →
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {result.blockers.some((b) => !b.field) && (
            <p className="text-xs text-muted-foreground">
              Declared unsupported situations and engine-unsupported ledger entries route the case to{" "}
              <span className="font-medium">manual professional preparation</span>, outside the automatic
              computation.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
