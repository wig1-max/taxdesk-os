/**
 * SINGLE authoritative document state (Remediation Phase 8).
 *
 * PURE — no React/Next/Supabase imports, so it is trivially unit-testable.
 *
 * This module is the ONE source of truth for the parent-case `case_documents`
 * status vocabulary and its derived semantics (what counts as "satisfied", the
 * checklist summary math, and the status → badge mapping). It is consumed by:
 *   - the General Case documents page (`app/(app)/cases/[id]/documents`),
 *   - the Tax Desk documents task screen (`.../tax-desk/cases/[id]/documents`),
 *   - the Tax Desk read models (`lib/queries/tax-desk.ts`),
 *   - the checklist status server action (`app/actions/documents.ts`), and
 *   - ingestion (the guarded `ingest_client_upload` RPC mirrors
 *     `DOC_SATISFIED_STATUSES` — see the Phase 8 migration).
 *
 * Before Phase 8 the "satisfied" set was re-declared in four places and the two
 * document surfaces mapped status → badge with two divergent maps, so a
 * document's derived state could drift between surfaces. Everything now derives
 * from this file; there is no second definition to fall out of sync.
 */

/** The canonical, ordered checklist status vocabulary. */
export const CHECKLIST_STATUSES = [
  "pending",
  "requested",
  "received",
  "verified",
  "waived",
  "rejected",
] as const;

export type ChecklistStatus = (typeof CHECKLIST_STATUSES)[number];

/**
 * The statuses that mean a required item is satisfactorily handled (no longer
 * blocking computation/finalization). THE authority — every reader imports this
 * rather than re-declaring `["received","verified","waived"]`.
 */
export const DOC_SATISFIED_STATUSES = ["received", "verified", "waived"] as const;

const SATISFIED_SET: ReadonlySet<string> = new Set(DOC_SATISFIED_STATUSES);

/** True when a checklist status counts as satisfied (received/verified/waived). */
export function isDocSatisfied(status: string): boolean {
  return SATISFIED_SET.has(status);
}

/** Statuses that mean an item has not been collected yet. */
export function isDocMissing(status: string): boolean {
  return status === "pending" || status === "requested";
}

export type DocBadgeVariant =
  | "success"
  | "warning"
  | "destructive"
  | "secondary";

/**
 * The ONE status → badge-variant mapping shared by both document surfaces.
 * (The Tax Desk page renders these via `StatusPill`, the General Case page via
 * `Badge`; both now map from this single table instead of a local one.)
 */
export function docStatusBadgeVariant(status: string): DocBadgeVariant {
  switch (status) {
    case "verified":
      return "success";
    case "received":
      return "warning";
    case "rejected":
      return "destructive";
    case "waived":
    case "pending":
    case "requested":
    default:
      return "secondary";
  }
}

export interface ChecklistDoc {
  id: string;
  name: string;
  status: string;
  is_required: boolean;
  waived_reason?: string | null;
  notes?: string | null;
}

export interface ChecklistSummary {
  total: number;
  required: number;
  optional: number;
  /** Not yet collected: pending or requested. */
  missing: number;
  received: number;
  verified: number;
  waived: number;
  rejected: number;
  /** Required items not yet received/verified/waived (i.e. still blocking). */
  requiredOutstanding: number;
}

export function summarizeChecklist(docs: ChecklistDoc[]): ChecklistSummary {
  const summary: ChecklistSummary = {
    total: docs.length,
    required: 0,
    optional: 0,
    missing: 0,
    received: 0,
    verified: 0,
    waived: 0,
    rejected: 0,
    requiredOutstanding: 0,
  };

  for (const d of docs) {
    if (d.is_required) summary.required += 1;
    else summary.optional += 1;

    switch (d.status) {
      case "pending":
      case "requested":
        summary.missing += 1;
        break;
      case "received":
        summary.received += 1;
        break;
      case "verified":
        summary.verified += 1;
        break;
      case "waived":
        summary.waived += 1;
        break;
      case "rejected":
        summary.rejected += 1;
        break;
    }

    if (d.is_required && !isDocSatisfied(d.status)) {
      summary.requiredOutstanding += 1;
    }
  }

  return summary;
}

/** True when every required checklist item is received/verified/waived. */
export function isChecklistComplete(docs: ChecklistDoc[]): boolean {
  return summarizeChecklist(docs).requiredOutstanding === 0;
}
