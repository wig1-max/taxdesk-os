/**
 * Snapshot-safe input for deterministic computation replay.
 *
 * A computation snapshot must retain every field consumed by `computeTax`,
 * `compareRegimes`, and `recommendItrForm`. Validation is deliberately outside
 * this replay scope because its credential scanner consumes notes/free text,
 * which snapshots must never persist.
 */

import type { TaxEngineInput } from "@/lib/tax-engine/ay-2026-27/types";

export const COMPUTATION_REPLAY_CONTRACT = Object.freeze({
  version: "TAX_COMPUTATION_REPLAY_V1",
  outputs: Object.freeze(["computation", "comparison", "recommendation"] as const),
  validationReplayComplete: false,
  omittedFields: Object.freeze(["notes", "freeTextFields"] as const),
});

export type StoredComputationReplayInput = Omit<
  TaxEngineInput,
  "notes" | "freeTextFields"
>;

function stripEntryNotes<T extends { notes?: string }>(entry: T): T {
  const copy = { ...entry };
  delete copy.notes;
  return copy;
}

/**
 * Copy an engine input for immutable storage while removing every notes field.
 * Optional computation arrays are materialized so the stored V1 shape is
 * complete and future replay never has to guess whether a head was absent.
 */
export function buildStoredComputationReplayInput(
  input: TaxEngineInput,
): StoredComputationReplayInput {
  const copy = { ...input };
  delete copy.notes;
  delete copy.freeTextFields;

  return {
    ...copy,
    taxpayer: { ...input.taxpayer },
    requiredDocuments: input.requiredDocuments.map((document) => ({ ...document })),
    income: input.income.map(stripEntryNotes),
    taxPaid: input.taxPaid.map(stripEntryNotes),
    deductions: input.deductions.map(stripEntryNotes),
    capitalGains: input.capitalGains.map(stripEntryNotes),
    housePropertyEntries: (input.housePropertyEntries ?? []).map(stripEntryNotes),
    businessBooksEntries: (input.businessBooksEntries ?? []).map(stripEntryNotes),
    broughtForwardLosses: (input.broughtForwardLosses ?? []).map((entry) => ({ ...entry })),
    sourceRecordIds: [...(input.sourceRecordIds ?? [])],
  };
}
