/**
 * Ledger source-coverage classification (K.2.8.6). PURE.
 *
 * IMPORTANT: "source coverage" (linked vs unlinked) is a DIFFERENT concept from
 * engine "unsupported":
 *   - linked / unlinked  → whether an entry has a source document/file mapped
 *     (a data-provenance relationship). Computable from the ledger rows alone.
 *   - unsupported        → whether the AY 2026-27 tax engine can process the
 *     entry. Requires running the computation adapter; NOT available on the
 *     Ledgers screen, so it is intentionally NOT shown there.
 *
 * The Ledgers UI shows source coverage only. It must never label an unlinked
 * entry as "unsupported" (or vice-versa).
 */

export interface LedgerSourceRow {
  source_document_id?: unknown;
  source_file_id?: unknown;
  [key: string]: unknown;
}

export interface SourceCoverage {
  total: number;
  /** Entries with a source document OR file mapped. */
  linked: number;
  /** Entries with no source document/file mapped. */
  unlinked: number;
}

/** True when the row maps to at least one parent-case document or file. */
export function isSourceLinked(row: LedgerSourceRow): boolean {
  return !!(row.source_document_id || row.source_file_id);
}

export function sourceCoverage(rows: LedgerSourceRow[]): SourceCoverage {
  const linked = rows.reduce((n, r) => n + (isSourceLinked(r) ? 1 : 0), 0);
  return { total: rows.length, linked, unlinked: rows.length - linked };
}
