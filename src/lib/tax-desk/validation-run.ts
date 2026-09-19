/**
 * Authoritative validation-run marker (remediation Phase 3, K.2.9.3). PURE — no
 * React/Next/Supabase, no DB, no writes. Node-unit-testable.
 *
 * A validation refresh writes a case-level run marker on `tax_cases`
 * (`validation_last_run_at` + `validation_rules_version`) on EVERY run — even a
 * zero-finding run that touches no `tax_validation_findings` row. This helper is
 * the SINGLE place that turns those columns into the `{ runExists, lastRunAt,
 * rulesVersion }` shape every reader consumes. Routing both the Validation page
 * (`getTaxCaseValidationView`) and the workbench readiness model
 * (`computeTaxCaseReadiness` → `filing-readiness.ts`) through it makes it
 * structurally impossible for the two surfaces to disagree about whether a run
 * happened.
 *
 * Before Phase 3 the Validation view inferred a run from `max(last_seen_at)`
 * over findings, so a zero-finding run left no trace: the page said "never"
 * while the readiness rail (which already read the marker) said "Passed".
 */

/** The two `tax_cases` columns the run marker is derived from. */
export interface ValidationRunMarkerRow {
  validation_last_run_at?: string | null;
  validation_rules_version?: string | null;
}

export interface ValidationRunMarker {
  /** True once validation has been run at least once (the marker is set). */
  runExists: boolean;
  /** ISO timestamp of the latest validation run, or null if never run. */
  lastRunAt: string | null;
  /** Engine rules version stamped by the latest run, or null if never run. */
  rulesVersion: string | null;
}

/**
 * Derive the authoritative validation-run marker from a `tax_cases` row.
 * `runExists` is driven solely by the presence of `validation_last_run_at` —
 * never by finding rows — so a zero-finding run still reads as a real run.
 */
export function deriveValidationRun(
  row: ValidationRunMarkerRow | null | undefined,
): ValidationRunMarker {
  const lastRunAt = row?.validation_last_run_at ?? null;
  return {
    runExists: lastRunAt !== null,
    lastRunAt,
    rulesVersion: row?.validation_rules_version ?? null,
  };
}
