/**
 * Load-bearing income fields consumed by `buildEngineInput`.
 *
 * Keep one projection authority for every live reader that computes adapter
 * completeness. A narrower copy made Computation accept an eligible
 * presumptive row while Eligibility and Filing Readiness reconstructed the
 * same row as undeclared (AUDIT-07-F2).
 */
export const TAX_INCOME_ENGINE_ROW_PROJECTION =
  "id, income_head, amount, source_type, source_document_id, " +
  "receipts_via_banking_channels, presumptive_activity_type";
