/**
 * Old vs new regime comparison for AY 2026-27. PURE — no external imports.
 * Delegates the heavy lifting to computeRegime so the two paths never drift.
 */

import type { ComputationRateFigures } from "@/lib/tax-engine/core/statutory-rate-parameters";
import {
  broughtForwardContextOf,
  computed,
  computeBothRegimes,
  deriveIncome,
  roundRupee,
} from "./compute-tax";
import { AY_2026_27_COMPUTATION_FIGURES } from "./rate-figures";
import type { RegimeComparison, TaxEngineInput } from "./types";

export function compareRegimes(
  input: TaxEngineInput,
  figures: ComputationRateFigures = AY_2026_27_COMPUTATION_FIGURES,
): RegimeComparison {
  const derived = deriveIncome(input.income, input.capitalGains, broughtForwardContextOf(input));
  const { oldRegime, newRegime } = computeBothRegimes(input, derived, figures);

  const oldTax = oldRegime.grossTaxLiability.value;
  const newTax = newRegime.grossTaxLiability.value;
  const recommendedRegime = newTax <= oldTax ? "new" : "old";

  // Positive difference = new regime saves this much vs old.
  const differenceValue = roundRupee(oldTax - newTax);
  const difference = computed(
    differenceValue,
    `old regime tax ₹${oldTax} - new regime tax ₹${newTax}`,
    [],
    [
      differenceValue > 0
        ? `New regime saves ₹${differenceValue}.`
        : differenceValue < 0
          ? `Old regime saves ₹${Math.abs(differenceValue)}.`
          : "Both regimes yield the same tax.",
    ],
  );

  const notes = [
    `Recommended regime: ${recommendedRegime}.`,
    "Comparison is on gross tax liability (before taxes already paid).",
    "Preparation-only — CA verification required before client reliance.",
  ];

  return { oldRegime, newRegime, recommendedRegime, difference, notes };
}
