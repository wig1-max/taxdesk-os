/**
 * Canonical financial-outcome resolver (Phase K.2.8.6). PURE — no React/Next.
 *
 * ONE place decides whether a computed case is a refund, a payable, nil, or not
 * yet computed, so the TaxCaseShell, case Overview, Computation, Client Review,
 * and Filing Readiness can never disagree (the K.2.8.5 shell/overview inverted
 * the sign — this resolver fixes and centralizes it).
 *
 * Engine convention (see tax-engine/ay-2026-27/compute-tax.ts):
 *   netPayable = grossTaxLiability - taxPaid
 *     netPayable > 0  => TAX PAYABLE (client owes)
 *     netPayable < 0  => REFUND (client overpaid)
 *     netPayable === 0 => nil
 */

import { formatInr } from "@/lib/utils";
import type { Tone } from "@/lib/ui/status-tone";

export type FinancialOutcome =
  | { kind: "refund"; amount: number; label: "Expected refund"; tone: Tone }
  | { kind: "payable"; amount: number; label: "Tax payable"; tone: Tone }
  | { kind: "nil"; amount: 0; label: "Nil balance"; tone: Tone }
  | { kind: "incomplete"; amount: null; label: "Incomplete preview"; tone: Tone; unsupportedCount: number }
  | { kind: "unavailable"; amount: null; label: "Not computed"; tone: Tone };

/** Options for the completeness guard (K.2.8.7). */
export interface OutcomeCompleteness {
  /** Count of ledger entries the engine cannot represent (excluded from the
   *  computation). When > 0 the computed balance is unreliable, so NO refund /
   *  payable / nil is shown — an "Incomplete preview" is returned instead. */
  unsupportedCount?: number;
}

/**
 * Resolve an outcome from the engine's signed `refundOrPayable` value.
 * `available` is false when there is no complete/parseable snapshot, forcing
 * the "Not computed" state regardless of any stale number.
 *
 * Completeness guard (K.2.8.7): if `unsupportedCount > 0`, one or more entries
 * are excluded from the engine input, so the balance would be computed on a
 * partial input. In that case NO refund/payable/nil is ever shown — the guard
 * returns `incomplete` (a monetary "—" plus the count), regardless of the signed
 * value. This is a presentation guard only; it does NOT change the engine's sign
 * convention or the support-classification rules.
 */
export function resolveFinancialOutcome(
  netPayable: number | null | undefined,
  available = true,
  opts?: OutcomeCompleteness,
): FinancialOutcome {
  const unsupportedCount = opts?.unsupportedCount ?? 0;
  if (unsupportedCount > 0) {
    return { kind: "incomplete", amount: null, label: "Incomplete preview", tone: "warning", unsupportedCount };
  }
  if (!available || netPayable == null || !Number.isFinite(netPayable)) {
    return { kind: "unavailable", amount: null, label: "Not computed", tone: "neutral" };
  }
  const v = Math.round(netPayable);
  if (v > 0) return { kind: "payable", amount: v, label: "Tax payable", tone: "warning" };
  if (v < 0) return { kind: "refund", amount: -v, label: "Expected refund", tone: "success" };
  return { kind: "nil", amount: 0, label: "Nil balance", tone: "neutral" };
}

/** Two-line copy for an incomplete-preview anchor/hero (K.2.8.7). */
export function manualTreatmentNote(unsupportedCount: number): string {
  return `${unsupportedCount} ${unsupportedCount === 1 ? "entry needs" : "entries need"} manual treatment`;
}

/**
 * Recommendation completeness guard (K.2.8.7). A partial calculation (one or
 * more unsupported entries excluded from the engine input) cannot safely
 * recommend a regime or an ITR form, so both are withheld until every
 * manual-treatment entry is resolved. This suppresses the recommendation only —
 * it never changes the engine's regime/ITR logic, nor the selected ITR (a
 * factual user choice, surfaced separately by callers).
 */
export interface RecommendationDisplay {
  /** Recommended regime, or null when withheld (→ no REC badge / no highlight). */
  regime: "old" | "new" | null;
  /** Recommended ITR form, or null when withheld. */
  recommendedItr: string | null;
  /** False when a recommendation is withheld because the input is incomplete. */
  available: boolean;
}

export function resolveRecommendationDisplay(args: {
  unsupportedCount: number;
  recommendedRegime: "old" | "new";
  recommendedItrType: string;
}): RecommendationDisplay {
  if (args.unsupportedCount > 0) {
    return { regime: null, recommendedItr: null, available: false };
  }
  return { regime: args.recommendedRegime, recommendedItr: args.recommendedItrType, available: true };
}

/** Copy shown in place of an ITR recommendation when it is withheld. */
export const ITR_RECOMMENDATION_UNAVAILABLE =
  "ITR recommendation unavailable until manual-treatment entries are resolved.";

/**
 * Convenience: resolve from gross liability + tax paid (engine convention).
 * Mirrors how the spec describes the rules ("tax paid greater than liability
 * => refund"). Any missing input yields "Not computed".
 */
export function outcomeFromLiabilityAndPaid(
  grossTaxLiability: number | null | undefined,
  taxPaid: number | null | undefined,
  available = true,
): FinancialOutcome {
  if (
    !available ||
    grossTaxLiability == null ||
    taxPaid == null ||
    !Number.isFinite(grossTaxLiability) ||
    !Number.isFinite(taxPaid)
  ) {
    return resolveFinancialOutcome(null, false);
  }
  return resolveFinancialOutcome(grossTaxLiability - taxPaid, true);
}

/** Display amount (₹, en-IN) or an em dash when there is no reliable amount
 *  (unavailable OR incomplete). */
export function formatOutcomeAmount(o: FinancialOutcome): string {
  return o.amount == null ? "—" : formatInr(o.amount);
}

/** Short compare label for a single regime column, e.g. "₹60,000 refund". */
export function outcomeCompareLabel(netPayable: number): string {
  const o = resolveFinancialOutcome(netPayable, true);
  if (o.kind === "refund") return `${formatInr(o.amount)} refund`;
  if (o.kind === "payable") return `${formatInr(o.amount)} payable`;
  return "Nil";
}

/**
 * Resolve what the persistent case-shell anchor should show, distinguishing a
 * SAVED snapshot outcome from a LIVE preview (K.2.8.6 polish):
 *   - a saved snapshot outcome wins and is shown plainly;
 *   - otherwise a live preview (from current ledger data) is shown, clearly
 *     tagged as a preview;
 *   - otherwise "No saved snapshot" (never "Not computed" when a preview
 *     exists). Still routes every amount through the one canonical resolver.
 */
export type AnchorSource = "saved" | "preview" | "none";

export interface ShellAnchor {
  outcome: FinancialOutcome;
  source: AnchorSource;
  /** Small eyebrow label above the amount. */
  eyebrow: string;
  isPreview: boolean;
}

export function resolveShellAnchor(args: {
  savedNetPayable: number | null | undefined;
  previewNetPayable: number | null | undefined;
  /** Unsupported-entry count for the LIVE preview input (K.2.8.7). A saved
   *  snapshot is always complete (snapshots are gated on completeness), so the
   *  guard applies only to the preview fallback. */
  previewUnsupportedCount?: number;
}): ShellAnchor {
  // A saved snapshot always wins and is inherently complete (snapshot creation
  // is blocked while any entry is unsupported), so it is never guarded here.
  const saved = resolveFinancialOutcome(args.savedNetPayable, args.savedNetPayable != null);
  if (saved.kind !== "unavailable") {
    return { outcome: saved, source: "saved", eyebrow: saved.label, isPreview: false };
  }
  // Live preview — apply the completeness guard.
  const preview = resolveFinancialOutcome(args.previewNetPayable, args.previewNetPayable != null, {
    unsupportedCount: args.previewUnsupportedCount,
  });
  if (preview.kind === "incomplete") {
    return { outcome: preview, source: "preview", eyebrow: "Incomplete", isPreview: true };
  }
  if (preview.kind !== "unavailable") {
    return { outcome: preview, source: "preview", eyebrow: preview.label, isPreview: true };
  }
  // No snapshot and no preview. Keep the canonical unavailable outcome (its
  // label stays "Not computed"); the DISPLAYED eyebrow says "No saved snapshot".
  return {
    outcome: resolveFinancialOutcome(null, false),
    source: "none",
    eyebrow: "No saved snapshot",
    isPreview: false,
  };
}
