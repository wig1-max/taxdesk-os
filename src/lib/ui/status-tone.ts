/**
 * Pure status → semantic-tone resolver (Phase K.2.8.5).
 *
 * Every status code used anywhere in TaxDesk OS maps to ONE of six tones, so
 * the same colour + shape always means the same thing. No React / no imports —
 * trivially unit-testable and safe in server or client components.
 *
 * Tone is never the only signal: components that use it always pair it with a
 * label (and usually a dot/icon).
 */

export type Tone = "success" | "warning" | "danger" | "info" | "neutral" | "primary";

/** Explicit code → tone map. Unknown codes fall back to `neutral` (safe). */
const TONE_BY_CODE: Record<string, Tone> = {
  // Completed / verified / positive terminal
  approved: "success",
  verified: "success",
  received: "success",
  waived: "success",
  completed: "success",
  filed: "success",
  everified: "success",
  e_verified: "success",
  credited: "success",
  converted: "success",
  resolved: "success",
  acknowledgement_received: "success",
  passed: "success",
  ready: "success",
  finalized: "success",
  promoted: "success",

  // Active / in-flight / selected
  prepared: "info",
  sent: "info",
  in_progress: "info",
  computation_ready: "info",
  current: "info",
  selected: "info",
  accepted: "info",

  // Waiting / pending (something owed, non-error)
  pending: "warning",
  requested: "warning",
  proposed: "warning",
  not_started: "neutral",
  data_entry_pending: "warning",
  reconciliation_pending: "warning",
  review_pending: "warning",
  docs_pending: "warning",
  portal_filing_pending: "warning",
  on_hold: "warning",
  waiting: "warning",
  changes_requested: "warning",
  stale: "warning",

  // Blocking / negative
  rejected: "danger",
  blocker: "danger",
  blocked: "danger",
  error: "danger",
  objection_received: "danger",
  objection_reply_pending: "danger",
  lost: "danger",

  // Neutral / inactive / not-applicable
  superseded: "neutral",
  dismissed: "neutral",
  not_interested: "neutral",
  not_required: "neutral",
  not_applicable: "neutral",
  closed: "neutral",
  optional: "neutral",

  // Validation severities
  info: "info",
  warning: "warning",
};

export function toneForStatus(code: string | null | undefined): Tone {
  if (!code) return "neutral";
  return TONE_BY_CODE[code.toLowerCase()] ?? "neutral";
}

/** Human label from a snake_case code, with a few nicer overrides. */
const LABEL_OVERRIDES: Record<string, string> = {
  data_entry_pending: "Data entry",
  reconciliation_pending: "Reconciliation",
  computation_ready: "Computation ready",
  portal_filing_pending: "Filing pending",
  review_pending: "Review pending",
  docs_pending: "Docs pending",
  not_started: "Not started",
  changes_requested: "Changes requested",
  acknowledgement_received: "Ack. received",
  e_verified: "E-verified",
  everified: "E-verified",
  not_applicable: "N/A",
};

export function labelForStatus(code: string | null | undefined): string {
  if (!code) return "—";
  return LABEL_OVERRIDES[code.toLowerCase()] ?? code.replaceAll("_", " ");
}

/** Tailwind class bundles per tone for soft badges / dots / rails. */
export const TONE_CLASSES: Record<
  Tone,
  { soft: string; dot: string; text: string; ring: string; solid: string }
> = {
  success: {
    soft: "bg-success-soft text-success border-success-border",
    dot: "bg-success",
    text: "text-success",
    ring: "ring-success-border",
    solid: "bg-success text-white",
  },
  warning: {
    soft: "bg-warning-soft text-warning border-warning-border",
    dot: "bg-warning",
    text: "text-warning",
    ring: "ring-warning-border",
    solid: "bg-warning text-white",
  },
  danger: {
    soft: "bg-danger-soft text-danger border-danger-border",
    dot: "bg-danger",
    text: "text-danger",
    ring: "ring-danger-border",
    solid: "bg-danger text-white",
  },
  info: {
    soft: "bg-info-soft text-info border-info-border",
    dot: "bg-info",
    text: "text-info",
    ring: "ring-info-border",
    solid: "bg-info text-white",
  },
  neutral: {
    soft: "bg-neutral-soft text-neutral border-neutral-border",
    dot: "bg-neutral",
    text: "text-neutral",
    ring: "ring-neutral-border",
    solid: "bg-neutral text-white",
  },
  primary: {
    soft: "bg-accent text-primary border-border",
    dot: "bg-primary",
    text: "text-primary",
    ring: "ring-border",
    solid: "bg-primary text-primary-foreground",
  },
};
