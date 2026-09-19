/**
 * Engine-derived ledger support classification (K.2.8.7). PURE.
 *
 * "Support" answers ONE question: can the AY 2026-27 tax engine represent this
 * ledger entry? It is NOT re-implemented here — it is derived from the exact
 * same authority Computation uses: the computation adapter's `warnings`
 * (`buildEngineInput`, computation-adapter.ts). An entry is "unsupported" iff the
 * adapter raised a mapping warning for it (a non-zero placeholder income head /
 * capital-gain type, or an un-modelled capital loss). Zero-amount placeholder
 * rows need no manual treatment and are never counted.
 *
 * This is a DIFFERENT axis from source coverage (linked/unlinked,
 * `ledger-source.ts`) and the two must never be conflated:
 *   - a source-linked row can still be engine-unsupported (a linked
 *     house_property entry) → it stays UNSUPPORTED;
 *   - a no-source row can still be engine-supported (a manual salary entry) →
 *     it stays SUPPORTED.
 *
 * Because both Ledgers and Computation reshape the SAME `buildEngineInput`
 * output, the unsupported count is identical on both surfaces by construction.
 */

import {
  buildEngineInput,
  type AdapterResult,
  type CaseMeta,
  type LedgerRows,
} from "./computation-adapter";

/** UI-facing category keys — match the Ledger Workspace category `key`s. */
export type LedgerCategoryKey =
  | "income"
  | "taxPaid"
  | "deductions"
  | "capitalGains"
  | "houseProperty"
  /** K4-10: brought-forward capital losses (Section 74). */
  | "broughtForwardLosses"
  /** K4-14: books-based business or profession (Sections 28/29). */
  | "businessBooks";

/** Adapter ledger-kind → UI category key. */
const KIND_TO_CATEGORY: Record<string, LedgerCategoryKey> = {
  income: "income",
  tax_paid: "taxPaid",
  deduction: "deductions",
  capital_gain: "capitalGains",
  house_property: "houseProperty",
  brought_forward_loss: "broughtForwardLosses",
  business_books: "businessBooks",
};

export interface CategorySupport {
  /** Entries in this category needing manual tax treatment (engine-derived). */
  unsupported: number;
  /** Ledger row ids of those entries. */
  unsupportedIds: string[];
}

export interface UnsupportedEntry {
  ledgerId: string;
  category: LedgerCategoryKey;
  entryType: string;
  amount: number;
  code: string;
}

export interface LedgerSupport {
  /** Total entries needing manual tax treatment (engine-derived). */
  unsupported: number;
  /** Supported mapped entries the engine can represent. */
  supported: number;
  /** Affected ledger row ids across all categories. */
  unsupportedIds: string[];
  /** Full descriptors for the affected entries. */
  entries: UnsupportedEntry[];
  /** Per-category breakdown, keyed by the UI category key. */
  byCategory: Record<LedgerCategoryKey, CategorySupport>;
}

function emptyByCategory(): Record<LedgerCategoryKey, CategorySupport> {
  return {
    income: { unsupported: 0, unsupportedIds: [] },
    taxPaid: { unsupported: 0, unsupportedIds: [] },
    deductions: { unsupported: 0, unsupportedIds: [] },
    capitalGains: { unsupported: 0, unsupportedIds: [] },
    houseProperty: { unsupported: 0, unsupportedIds: [] },
    broughtForwardLosses: { unsupported: 0, unsupportedIds: [] },
    businessBooks: { unsupported: 0, unsupportedIds: [] },
  };
}

/**
 * Reshape an already-computed adapter result's engine warnings into per-category
 * support. Use this on any surface that already holds an `AdapterResult` (e.g.
 * Computation) so both surfaces read the one authority.
 */
export function ledgerSupportFromAdapter(
  result: Pick<AdapterResult, "warnings" | "mappedEntryCount">,
): LedgerSupport {
  const byCategory = emptyByCategory();
  const entries: UnsupportedEntry[] = [];
  const unsupportedIds: string[] = [];

  for (const w of result.warnings) {
    const category = KIND_TO_CATEGORY[w.ledgerKind];
    if (!category) continue;
    byCategory[category].unsupported += 1;
    byCategory[category].unsupportedIds.push(w.ledgerId);
    unsupportedIds.push(w.ledgerId);
    entries.push({
      ledgerId: w.ledgerId,
      category,
      entryType: w.entryType,
      amount: w.amount,
      code: w.code,
    });
  }

  return {
    unsupported: unsupportedIds.length,
    supported: result.mappedEntryCount,
    unsupportedIds,
    entries,
    byCategory,
  };
}

/** A row carrying a truthy `deleted_at` is archived / soft-removed. */
function isLive(row: unknown): boolean {
  return !(row as { deleted_at?: unknown }).deleted_at;
}

/**
 * Classify engine support straight from live ledger rows. Runs the SAME
 * `buildEngineInput` the Computation page uses, then reshapes its warnings.
 *
 * Defense-in-depth: any archived/soft-removed row (truthy `deleted_at`) is
 * dropped before classification. The Ledgers query already filters
 * `deleted_at IS NULL`, but this guarantees a stray archived row can never
 * inflate the unsupported count regardless of caller.
 *
 * Pure and cheap — operates only on already-loaded rows, adds no DB requests.
 */
export function classifyLedgerSupport(rows: LedgerRows, meta: CaseMeta): LedgerSupport {
  // AUDIT-08-F4 (decision D245): forwarded GENERICALLY, by key, rather than by
  // naming each field. The previous version listed the fields one by one and
  // carried a comment warning that a new ledger kind could be dropped here —
  // but a comment cannot fail a build. It was not a hypothetical risk: of the
  // three optional kinds added to `LedgerRows`, TWO were missed on the way in
  // (`broughtForwardLosses` at `K4-10` and `businessBooksEntries` at `K4-14`,
  // both repaired at `K4-14F`). The type checker is structurally unable to
  // catch it — every optional field absent is treated exactly like `[]` by
  // `buildEngineInput`, so an omission compiles cleanly and silently zeroes
  // that category's badge while Computation/eligibility/readiness, which pass
  // the rows straight through, still refuse the case.
  //
  // Iterating the keys removes the drop point instead of documenting it: a
  // ledger kind added to `LedgerRows` is forwarded here with no edit to this
  // function at all. Non-array values are passed through untouched, so this
  // stays correct if the interface ever gains a non-array member.
  const live = Object.fromEntries(
    Object.entries(rows).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.filter(isLive) : value,
    ]),
  ) as LedgerRows;
  return ledgerSupportFromAdapter(buildEngineInput(live, meta));
}

/**
 * Human phrasing for a support count. Deliberately avoids "unsupported data" /
 * "incomplete" — it names the concrete action (manual tax treatment).
 */
export function describeLedgerSupport(unsupported: number): string {
  if (unsupported <= 0) return "All entries are supported by the current tax engine";
  return `${unsupported} ${unsupported === 1 ? "entry needs" : "entries need"} manual tax treatment`;
}
