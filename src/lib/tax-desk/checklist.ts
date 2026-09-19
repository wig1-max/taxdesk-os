/**
 * Tax Desk checklist helpers.
 *
 * Since Remediation Phase 8 the checklist status vocabulary + derived semantics
 * live in ONE authority — `@/lib/documents/document-state` — shared by the
 * General Case surface, the Tax Desk surface and ingestion. This module simply
 * re-exports that authority so the established `@/lib/tax-desk/checklist` import
 * path stays stable for existing readers.
 */

export {
  CHECKLIST_STATUSES,
  DOC_SATISFIED_STATUSES,
  isDocSatisfied,
  isDocMissing,
  docStatusBadgeVariant,
  summarizeChecklist,
  isChecklistComplete,
  type ChecklistStatus,
  type ChecklistDoc,
  type ChecklistSummary,
  type DocBadgeVariant,
} from "@/lib/documents/document-state";
