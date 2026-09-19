/**
 * TaxDesk OS — Synthetic Case Laboratory: the MATERIAL OUTPUT vocabulary
 * (Wave 2, K3-20).
 *
 * PURE TYPESCRIPT ONLY. Like `src/lib/tax-engine/*`, `src/lib/tax-desk/*` and
 * `src/lib/tax-pack/*`, nothing in `src/lib/tax-lab/*` may import React, Next.js,
 * the Supabase client, UI components, server actions, env/config, or app routes.
 *
 * A **material output** is one number (or one categorical decision) a fixture may
 * pin an expectation to. The vocabulary is CLOSED and each id maps to exactly one
 * pure extractor over the engine's own output objects — so a fixture can never
 * name a field that does not exist, and the laboratory can never "read" a value
 * out of a shape the engine does not actually produce.
 *
 * Nothing here computes tax. Every extractor is a projection.
 */

import type {
  ItrFormRecommendation,
  TaxComputation,
} from "@/lib/tax-engine/ay-2026-27/types";

/** The outputs a computed case exposes to the laboratory. */
export const MATERIAL_OUTPUT_IDS = [
  "computation.grossTotalIncome",
  "computation.deductionsAllowed",
  "computation.totalIncome",
  "computation.oldRegimeTax",
  "computation.newRegimeTax",
  "computation.recommendedRegime",
  "computation.specialRateCapitalGains",
  "computation.specialRateTax",
  "computation.rebate",
  "computation.cess",
  "computation.grossTaxLiability",
  "computation.taxPaid",
  "computation.refundOrPayable",
  "itrForm.recommendedItrType",
] as const;

export type MaterialOutputId = (typeof MATERIAL_OUTPUT_IDS)[number];

/**
 * Whether an output is produced by a versioned RULE or is a pure projection of
 * declared input.
 *
 * This distinction is what makes traceability enforceable rather than voluntary:
 * a `rule_derived` output MUST cite at least one rule id, or the harness fails it
 * as `untraced_output`. Without it a fixture could pin a tax figure to an empty
 * `ruleIds` array and still pass, which would let the laboratory's central claim
 * — *every material number names the versioned rule behind it* — quietly rot.
 *
 * `input_projection` covers the two outputs that are arithmetic over declared
 * ledger rows with no rate, cap, threshold or eligibility applied: gross total
 * income (a sum of declared heads, taken BEFORE any deduction) and taxes paid (a
 * sum of declared payments). Adding a new id here needs a specific justification
 * — when in doubt, an output is `rule_derived`.
 */
export type MaterialOutputKind = "input_projection" | "rule_derived";

const OUTPUT_KINDS: Readonly<Record<MaterialOutputId, MaterialOutputKind>> = Object.freeze({
  "computation.grossTotalIncome": "input_projection",
  "computation.taxPaid": "input_projection",
  "computation.deductionsAllowed": "rule_derived",
  "computation.totalIncome": "rule_derived",
  "computation.oldRegimeTax": "rule_derived",
  "computation.newRegimeTax": "rule_derived",
  "computation.recommendedRegime": "rule_derived",
  "computation.specialRateCapitalGains": "rule_derived",
  "computation.specialRateTax": "rule_derived",
  "computation.rebate": "rule_derived",
  "computation.cess": "rule_derived",
  "computation.grossTaxLiability": "rule_derived",
  "computation.refundOrPayable": "rule_derived",
  "itrForm.recommendedItrType": "rule_derived",
});

/** How an output is produced — see `MaterialOutputKind`. */
export function materialOutputKind(id: MaterialOutputId): MaterialOutputKind {
  return OUTPUT_KINDS[id];
}

/** A material output's value: a rupee figure or a categorical decision. */
export type MaterialOutputValue = number | string;

/** What a computed case exposes. Assembled by the harness from ONE pack-routed run. */
export interface ComputedCaseOutputs {
  readonly computation: TaxComputation;
  readonly itrForm: ItrFormRecommendation;
}

type Extractor = (outputs: ComputedCaseOutputs) => MaterialOutputValue;

const EXTRACTORS: Readonly<Record<MaterialOutputId, Extractor>> = Object.freeze({
  "computation.grossTotalIncome": (o) => o.computation.grossTotalIncome.value,
  "computation.deductionsAllowed": (o) => o.computation.deductionsAllowed.value,
  "computation.totalIncome": (o) => o.computation.totalIncome.value,
  "computation.oldRegimeTax": (o) => o.computation.oldRegimeTax.value,
  "computation.newRegimeTax": (o) => o.computation.newRegimeTax.value,
  "computation.recommendedRegime": (o) => o.computation.recommendedRegime,
  "computation.specialRateCapitalGains": (o) => o.computation.specialRateCapitalGains.value,
  "computation.specialRateTax": (o) => o.computation.specialRateTax.value,
  "computation.rebate": (o) => o.computation.rebate.value,
  "computation.cess": (o) => o.computation.cess.value,
  "computation.grossTaxLiability": (o) => o.computation.grossTaxLiability.value,
  "computation.taxPaid": (o) => o.computation.taxPaid.value,
  "computation.refundOrPayable": (o) => o.computation.refundOrPayable.value,
  "itrForm.recommendedItrType": (o) => o.itrForm.recommendedItrType,
});

/**
 * The engine's own per-`ComputedValue` `sources` tags for an output, or `null`
 * when the output is a categorical DECISION rather than a computed figure.
 *
 * This is the evidence half of traceability (`K3-21`): the harness resolves these
 * tags back to the declared, evidence-backed ledger facts that contributed to the
 * number. It reads the tags the ENGINE already emits — it never re-derives which
 * rows fed a figure, because that would be a second authority for the same
 * concept and the two would eventually disagree.
 *
 * `null` (rather than `[]`) is deliberate for `recommendedRegime` /
 * `recommendedItrType`: those are choices over the whole case, carry no
 * `ComputedValue` and therefore no source tags. Reporting them as "no
 * contributing facts" would be a lie of omission; the harness reports them as
 * not source-tagged. An empty array, by contrast, is a real answer — e.g. the
 * rebate, which is a function of totals rather than of specific rows.
 */
const SOURCE_TAGS: Readonly<Record<MaterialOutputId, (o: ComputedCaseOutputs) => readonly string[] | null>> =
  Object.freeze({
    "computation.grossTotalIncome": (o) => o.computation.grossTotalIncome.sources,
    "computation.deductionsAllowed": (o) => o.computation.deductionsAllowed.sources,
    "computation.totalIncome": (o) => o.computation.totalIncome.sources,
    "computation.oldRegimeTax": (o) => o.computation.oldRegimeTax.sources,
    "computation.newRegimeTax": (o) => o.computation.newRegimeTax.sources,
    "computation.recommendedRegime": () => null,
    "computation.specialRateCapitalGains": (o) => o.computation.specialRateCapitalGains.sources,
    "computation.specialRateTax": (o) => o.computation.specialRateTax.sources,
    "computation.rebate": (o) => o.computation.rebate.sources,
    "computation.cess": (o) => o.computation.cess.sources,
    "computation.grossTaxLiability": (o) => o.computation.grossTaxLiability.sources,
    "computation.taxPaid": (o) => o.computation.taxPaid.sources,
    "computation.refundOrPayable": (o) => o.computation.refundOrPayable.sources,
    "itrForm.recommendedItrType": () => null,
  });

/**
 * The engine source tags behind one material output, or `null` when the output
 * carries none by construction (a categorical decision). See `SOURCE_TAGS`.
 */
export function materialOutputSourceTags(
  outputs: ComputedCaseOutputs,
  id: MaterialOutputId,
): readonly string[] | null {
  const project = SOURCE_TAGS[id];
  if (project === undefined) {
    throw new Error(`Unknown material output id: ${JSON.stringify(id)}`);
  }
  return project(outputs);
}

/** True when `id` is part of the closed vocabulary. */
export function isMaterialOutputId(id: string): id is MaterialOutputId {
  return Object.prototype.hasOwnProperty.call(EXTRACTORS, id);
}

/**
 * Read one material output from a computed case. Throws for an unknown id —
 * construction (`makeExpectedOutput`) rejects those first, so reaching this is a
 * programming error, never fixture data.
 */
export function readMaterialOutput(
  outputs: ComputedCaseOutputs,
  id: MaterialOutputId,
): MaterialOutputValue {
  const extractor = EXTRACTORS[id];
  if (extractor === undefined) {
    throw new Error(`Unknown material output id: ${JSON.stringify(id)}`);
  }
  return extractor(outputs);
}
