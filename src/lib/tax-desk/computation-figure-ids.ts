/**
 * Test-safe, serializable vocabulary for every material current-computation
 * figure rendered by the Computation page. This module deliberately has no
 * imports so browser-boundary tests can compare the live DOM with the closed
 * inventory without loading server or production runtime code.
 */
export const COMPUTATION_FIGURE_IDS = [
  "outcome.refundOrPayable",
  "outcome.taxPaid",
  "decision.recommendedRegime",
  "decision.recommendedItrType",
  "comparison.old.grossTotalIncome",
  "comparison.new.grossTotalIncome",
  "comparison.old.deductionsAllowed",
  "comparison.new.deductionsAllowed",
  "comparison.old.totalIncome",
  "comparison.new.totalIncome",
  "comparison.old.taxBeforeRebate",
  "comparison.new.taxBeforeRebate",
  "comparison.old.rebate",
  "comparison.new.rebate",
  "comparison.old.cess",
  "comparison.new.cess",
  "comparison.old.grossTaxLiability",
  "comparison.new.grossTaxLiability",
  "comparison.old.taxPaid",
  "comparison.new.taxPaid",
  "comparison.old.refundOrPayable",
  "comparison.new.refundOrPayable",
  "comparison.difference",
  "summary.grossTotalIncome",
  "detail.old.slabTax",
  "detail.new.slabTax",
  "detail.old.specialRateTax",
  "detail.new.specialRateTax",
  "detail.old.surcharge",
  "detail.new.surcharge",
  // K4-11: marginal relief, per-regime like every other detail figure. It is
  // ALREADY netted into the surcharge figure above and is inventoried
  // separately only so a preparer can see the reduction itself.
  "detail.old.marginalRelief",
  "detail.new.marginalRelief",
  // K4-12: section 87A REBATE-threshold marginal relief — a SEPARATE relief
  // from the surcharge one above, sharing only the name. Inventoried for the
  // same reason: it is ALREADY inside the `rebate` figure, and a preparer
  // looking at a non-zero rebate ABOVE the ₹12,00,000 ceiling has to be able to
  // see what produced it.
  "detail.old.rebateMarginalRelief",
  "detail.new.rebateMarginalRelief",
  "detail.old.cess",
  "detail.new.cess",
  "detail.old.grossTaxLiability",
  "detail.new.grossTaxLiability",
  "detail.old.housePropertyIncome",
  "detail.new.housePropertyIncome",
  "detail.old.presumptiveProfessionalIncome",
  "detail.new.presumptiveProfessionalIncome",
  // K4-08: Section 44AD presumptive business income (per-regime ids kept
  // separate, matching every other detail figure — the recommended result is
  // never borrowed as old/new lineage).
  "detail.old.presumptiveBusinessIncome",
  "detail.new.presumptiveBusinessIncome",
  // K4-14: books-based business/profession net profit (Sections 28/29).
  // Per-regime ids kept separate like every other detail figure, even though
  // the value is regime-independent by construction — the recommended result
  // is never borrowed as old/new lineage.
  "detail.old.businessBooksIncome",
  "detail.new.businessBooksIncome",
  // K4-10: brought-forward capital-loss set-off (Section 74). Per-regime ids
  // kept separate like every other detail figure, even though the value is
  // regime-independent by construction — the recommended result is never
  // borrowed as old/new lineage.
  "detail.old.broughtForwardLossSetOff",
  "detail.new.broughtForwardLossSetOff",
] as const;

export type ComputationFigureId = (typeof COMPUTATION_FIGURE_IDS)[number];
