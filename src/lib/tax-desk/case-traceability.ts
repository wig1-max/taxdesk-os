/**
 * TaxDesk OS — CASE TRACEABILITY read model (Wave 2, K3-22).
 *
 * PURE TYPESCRIPT ONLY. Like `src/lib/tax-engine/*`, the rest of
 * `src/lib/tax-desk/*`, `src/lib/tax-pack/*` and `src/lib/tax-lab/*`, this module
 * must NOT import React, Next.js, the Supabase client, UI components, server
 * actions, env/config, or app routes.
 *
 * WHAT THIS IS. `K3-20`/`K3-21` made the Wave-2 gate checkable inside the
 * synthetic case laboratory: source-tagged material outputs there name their
 * versioned rules and accepted contributing facts, while categorical exceptions
 * are explicit. None of that was visible to the preparer who actually uses the
 * product. This module is the production read model that answers, for a LIVE case:
 *
 *   - which versioned tax pack governs it, at which computation/validation rules
 *     versions, and what may truthfully be said about its verification state;
 *   - the authored and effective trace state of every inventoried material
 *     figure; for traced rule-derived figures, which pack rules and citations
 *     apply; for projections/categorical/limitations, the explicit boundary;
 *   - where available, which ledger facts / source documents contributed; and
 *   - whether the number is INCOMPLETE (the adapter excluded a declared fact).
 *
 * WHAT IT IS NOT. It computes nothing and it derives nothing an existing
 * authority already derives ("one authority per concept", program §2):
 *
 *   - the governing pack comes from `bindDefaultTaxPackToCase` (`case-pack.ts`);
 *   - verification state comes from `describeTaxPackVerification`
 *     (`verification-state.ts`) and reliance from `taxPackRelianceBlocker`;
 *   - rule metadata comes from the RESOLVED pack's own `provenance` — a rule id
 *     this module names that the pack does not declare is reported as an explicit
 *     `unknownRuleIds` gap, never silently rendered;
 *   - the facts behind a figure come from the ENGINE's own per-`ComputedValue`
 *     `sources` tags, matched against the adapter's engine input — this module
 *     never re-derives which rows fed a number;
 *   - exclusions come from the adapter's own `MappingWarning`s.
 *
 * It does NOT import `src/lib/tax-lab/*` (that boundary is asserted by
 * `tax-lab/__tests__/boundary.test.ts`). It reuses the laboratory's VOCABULARY —
 * rule-derived vs input-projection, unverified-rule marking, "a partial figure is
 * never presented as complete" — conceptually, over the product's own line ids.
 *
 * TRUTHFULNESS. Nothing here may state or imply that a rule, a number, or a pack
 * is CA-verified. TaxDesk OS ships no `ca_verified` pack; `rulesUnverified` is
 * DERIVED (any cited rule carries an unresolved caveat, or the pack is not
 * `ca_verified`) rather than declared, so it cannot be understated by editing a
 * literal.
 */

import type {
  AdapterResult,
  LedgerRows,
} from "./computation-adapter";
import { bindDefaultTaxPackToCase, type TaxCaseStatutoryContext } from "@/lib/tax-pack/case-pack";
import { taxPackProvenance } from "@/lib/tax-pack/pack";
import type { RuleProvenance } from "@/lib/tax-pack/provenance";
import {
  defaultTaxPackRelianceBlocker,
  describeTaxPackVerification,
  type TaxPackRelianceBlocker,
} from "@/lib/tax-pack/verification-state";
import type { TaxLaw, TaxPackStatus } from "@/lib/tax-pack/identity";
import { TAX_LAWS } from "@/lib/tax-pack/identity";
import type {
  ComputedValue,
  ItrFormRecommendation,
  RegimeComparison,
  SourceType,
  TaxComputation,
} from "@/lib/tax-engine/ay-2026-27/types";
import {
  COMPUTATION_FIGURE_IDS,
  type ComputationFigureId,
} from "./computation-figure-ids";
import type { ProposalFactKind } from "./source-proposals";

export {
  COMPUTATION_FIGURE_IDS,
  type ComputationFigureId,
} from "./computation-figure-ids";

// ---------------------------------------------------------------------------
// The closed vocabulary of material figures rendered by Computation
// ---------------------------------------------------------------------------

/**
 * Exact engine outputs used by both the Computation presentation and this read
 * model. Keeping the page on this object prevents its material vocabulary from
 * drifting away from the traceability inventory.
 */
export interface ComputationFigureOutputs {
  readonly computation: TaxComputation;
  readonly comparison: RegimeComparison;
  readonly itrRecommendation: ItrFormRecommendation;
}

export type ComputationFigureTraceabilityState =
  | "traced"
  | "not_source_tagged_by_construction"
  | "untraced_limitation";

/**
 * Runtime state after resolving the authored mapping against the governing
 * pack. The fourth state is deliberately not available to the static inventory:
 * it exists only when pack provenance has drifted from an authored line that
 * cites at least one rule id — `traced` lines AND the categorical
 * `not_source_tagged_by_construction` decisions alike (`K3-26`; both cite
 * governing-pack rule ids, so both must be checkable against drift, not only
 * the ones authored `traced`).
 */
export type EffectiveComputationFigureTraceabilityState =
  | ComputationFigureTraceabilityState
  | "untraced_rule_mapping_gap";

/**
 * How a line is produced. Same distinction the laboratory enforces: an
 * `input_projection` is arithmetic over declared ledger rows with no rate, cap,
 * threshold or eligibility applied; everything else is `rule_derived` and MUST
 * name at least one rule (a rule-derived line that names none is reported as an
 * explicit gap, never rendered as if it had been traced). When in doubt, a line
 * is `rule_derived`.
 */
export type TraceableLineKind = "input_projection" | "rule_derived";

export interface ComputationFigureSpec {
  readonly id: ComputationFigureId;
  readonly label: string;
  readonly kind: TraceableLineKind;
  readonly state: ComputationFigureTraceabilityState;
  readonly format: "amount" | "decision";
  /**
   * Rule ids from the governing pack's provenance. These map an engine output to
   * the pack's OWN declared rule groups (`slab_rates`, `rebate_87a`, …) — they
   * restate no rate, cap or threshold, and every id is checked against the
   * resolved pack rather than trusted.
   */
  readonly ruleIds: readonly string[];
  /** Required human-visible explanation for anything that is not traced. */
  readonly limitation: string | null;
}

/**
 * Figure→rule mapping keyed by statutory world (`K4-PORT-06` / `D317`).
 *
 * Rule ids are a stable contract (`K4-PORT-01`): both packs declare the same
 * set, and a later slice re-keys a pack onto this mapping rather than renaming
 * it. Today the two worlds cite the same ids. A family that must diverge
 * (slice 6 F&O is the reserved case) passes a `ty` override — it does not
 * rename the AY contract, and `parallel-worlds` still requires the cited id
 * to exist in both packs.
 */
export type WorldKeyedRuleIds = Readonly<Record<TaxLaw, readonly string[]>>;

function ruleIdsBothWorlds(
  ids: readonly string[],
  ty: readonly string[] = ids,
): WorldKeyedRuleIds {
  return Object.freeze({
    ITA_1961: Object.freeze([...ids]),
    ITA_2025: Object.freeze([...ty]),
  });
}

const LIABILITY_RULE_IDS = ruleIdsBothWorlds([
  "slab_rates",
  "standard_deduction",
  "chapter_via_deduction_caps",
  "capital_gains_stcg_111a",
  "capital_gains_ltcg_112a",
  "capital_gains_house_sale",
  "rebate_87a",
  "cess_rate",
  // K4-02: the OLD-regime senior/super-senior basic-exemption widening —
  // included here the same way `chapter_via_deduction_caps` already is: an
  // OLD-regime-only rule cited on both the old AND new regime's liability
  // figures, because this list names the FAMILY of rules that could explain a
  // liability figure, not which ones numerically fired for one case.
  "senior_super_senior_basic_exemption_widening",
  // K4-03: the age-aware Section 80D cap and Section 80TTA/80TTB mutual-
  // exclusivity correction — both refine `chapter_via_deduction_caps` (the
  // deduction total these liability figures are computed from), so both
  // belong in the same FAMILY-of-rules list `chapter_via_deduction_caps`
  // already sits in.
  "senior_80d_deduction_cap",
  // K4-05: the Section 80D "insured party" (parent-premium) sub-case — an
  // independent bucket refining the SAME `chapter_via_deduction_caps` total.
  "senior_80d_parents_deduction_cap",
  "senior_80tta_80ttb_mutual_exclusivity",
  // K4-06: house property flows into `normalTaxableIncome`/slab tax/gross
  // liability the same way other slab-income heads do — included here, but
  // deliberately NOT added to DEDUCTION_RULE_IDS below (shared with
  // `deductionsAllowed`, which house property never contributes to; see the
  // K4-06 decision-log entry, D80, for this under-citation-over-over-citation
  // choice).
  "house_property_computation",
  // K4-07: presumptive professional income (44ADA) flows into
  // `normalTaxableIncome`/slab tax/gross liability the same way house
  // property does — included here, deliberately NOT added to
  // DEDUCTION_RULE_IDS below (44ADA never contributes to `deductionsAllowed`
  // either), mirroring D80's under-citation-over-over-citation choice.
  "presumptive_44ada_computation",
  // AUDIT-04-F10 (K4-08 + K4-09), decided this session. `presumptive_44ad_
  // computation` flows into `normalTaxableIncome`/slab tax exactly as 44ADA
  // and house property do, and `capital_loss_within_year_set_off` changes the
  // net 111A/112A gains → special-rate tax → cess → gross liability chain. The
  // audit framed this as the third session diverging from two precedents; it
  // is actually TWO answers each way (K4-06/K4-07 cited, K4-08/K4-09 did not),
  // which is worse — the same question answered inconsistently. Both are now
  // cited, so all four K4-06…K4-09 rules are treated alike. D80's
  // under-citation-over-over-citation preference still governs genuinely
  // INDIRECT lineage; it was never a licence to omit a value that
  // demonstrably feeds the figure. Citations only — no figure is added, so the
  // closed inventory partition (40 = 34 + 2 + 4) is unchanged.
  "presumptive_44ad_computation",
  "capital_loss_within_year_set_off",
  // K4-10: the brought-forward leg changes the same net 111A/112A gains ->
  // special-rate tax -> cess -> gross-liability chain the within-year leg
  // does, so it is cited alongside it rather than left implicit. Same
  // AUDIT-04-F10 reasoning: a value that demonstrably feeds the figure is
  // cited; D80's under-citation preference governs genuinely INDIRECT lineage
  // only, and was never a licence to omit this.
  "capital_loss_brought_forward_set_off",
  // K4-11: surcharge is charged ON the liability these figures report and is
  // netted into gross liability, cess, the final outcome and the regime
  // difference — the most DIRECT lineage of anything in this list, not an
  // indirect one, so the same AUDIT-04-F10 reasoning applies a fortiori.
  // Marginal relief is cited alongside it because it changes the surcharge
  // actually charged, and a preparer reconciling a relieved figure who was
  // shown only the rate rule would be shown half the answer.
  "surcharge_rates",
  "surcharge_marginal_relief",
]);
/**
 * K4-11 — cess. `cess = 4% × (slab tax − rebate + special tax + surcharge)`, so
 * the surcharge rules are part of a cess figure's lineage exactly as they are
 * part of gross liability's. This is the same conclusion `D28` reached for the
 * SURCHARGE-DEPENDENCY caveat (which already listed the four cess figures);
 * citing the rate rule here makes the lineage a checked citation rather than a
 * caveat string.
 */
const CESS_RULE_IDS = ruleIdsBothWorlds(["cess_rate", "surcharge_rates", "surcharge_marginal_relief"]);
/** K4-11 — the surcharge/marginal-relief figures' own rules. */
const SURCHARGE_RULE_IDS = ruleIdsBothWorlds(["surcharge_rates", "surcharge_marginal_relief"]);
/**
 * K4-12 — the section 87A deduction's rules. `slab_rates` is cited because the
 * rebate is bounded by the slab tax under BOTH clause (a) (`min(slab tax,
 * ₹60,000)`) and clause (b) (the second proviso's cap), so the slab table
 * genuinely participates in the figure rather than merely preceding it.
 */
const REBATE_RULE_IDS = ruleIdsBothWorlds(["rebate_87a", "rebate_87a_marginal_relief", "slab_rates"]);
const DEDUCTION_RULE_IDS = ruleIdsBothWorlds([
  "standard_deduction",
  "chapter_via_deduction_caps",
  // K4-03/K4-05: see the LIABILITY_RULE_IDS comment above — same reasoning.
  "senior_80d_deduction_cap",
  "senior_80d_parents_deduction_cap",
  "senior_80tta_80ttb_mutual_exclusivity",
]);
const SLAB_TAX_RULE_IDS = ruleIdsBothWorlds(
  ["slab_rates", "senior_super_senior_basic_exemption_widening", ...DEDUCTION_RULE_IDS.ITA_1961],
  ["slab_rates", "senior_super_senior_basic_exemption_widening", ...DEDUCTION_RULE_IDS.ITA_2025],
);
// K4-09: the special-rate capital-gain figures are now NET of any within-year
// loss set-off, so that rule is part of their lineage — cited here rather than
// left implicit. This adds a citation to figures that already existed; it does
// NOT add a figure, so the closed inventory partition is unchanged.
const SPECIAL_RATE_RULE_IDS = ruleIdsBothWorlds([
  "capital_gains_stcg_111a",
  "capital_gains_ltcg_112a",
  "capital_loss_within_year_set_off",
  // K4-10: the special-rate figures are now net of the BROUGHT-FORWARD set-off
  // as well as the within-year one, and the Rs.1,25,000 Section 112A threshold
  // is applied to what survives BOTH.
  "capital_loss_brought_forward_set_off",
]);
/** K4-06: house property (Sections 22-27, 71(3A)/115BAC) — one bundled rule id. */
const HOUSE_PROPERTY_RULE_IDS = ruleIdsBothWorlds(["house_property_computation"]);
/** K4-07: presumptive professional income (Section 44ADA) — one bundled rule id. */
const PRESUMPTIVE_44ADA_RULE_IDS = ruleIdsBothWorlds(["presumptive_44ada_computation"]);
/** K4-08: presumptive business income (Section 44AD) — one bundled rule id. */
const PRESUMPTIVE_44AD_RULE_IDS = ruleIdsBothWorlds(["presumptive_44ad_computation"]);
/**
 * K4-14: books-based business/profession (Sections 28/29) — one bundled rule
 * id, following `house_property_computation`'s bundling precedent. The Section
 * 44AB threshold, the declared-basis gate and the loss refusal all live inside
 * that one rule's provenance rather than being split into separate ids, because
 * they are not independently citable computations: they are the boundary of the
 * single computation this rule performs.
 */
const BUSINESS_BOOKS_RULE_IDS = ruleIdsBothWorlds(["business_books_computation"]);
/**
 * K4-10: brought-forward capital-loss set-off (Section 74). Cites BOTH loss
 * rules, because the brought-forward figure is only computable on the gains
 * the WITHIN-YEAR rule left behind — the two are one pipeline, and citing only
 * the newer one would understate the lineage.
 */
const BROUGHT_FORWARD_LOSS_RULE_IDS = ruleIdsBothWorlds([
  "capital_loss_brought_forward_set_off",
  "capital_loss_within_year_set_off",
]);
const ITR_RECOMMENDATION_RULE_IDS = ruleIdsBothWorlds([
  "itr1_income_ceiling",
  "presumptive_44ada_computation",
]);
const EMPTY_RULE_IDS = ruleIdsBothWorlds([]);
const TAX_BEFORE_REBATE_LIMITATION =
  "Untraced display total: the screen adds slab tax and special-rate tax, but the engine exposes no ComputedValue or source tags for that combined figure.";
/**
 * K4-11 rewrote this caveat and RETIRED the `SURCHARGE_LIMITATION` it used to
 * sit beside. The old text said these values "incorporate the engine's
 * unimplemented surcharge ₹0 placeholder", which is no longer true for any case
 * at or below ₹2,00,00,000 — and saying it anyway would be the mirror of the
 * over-claim this caveat exists to prevent. The new text states the three
 * regimes of behaviour a reader actually needs to tell apart, WITHOUT needing
 * per-case state threaded into the read model: nil below the entry threshold,
 * computed inside the window, and NOT computed above the ceiling (where ₹0 is
 * not a nil and the case is reliance-blocked).
 */
export const SURCHARGE_DEPENDENCY_CAVEAT =
  "Traceable lineage does not mean implementation completeness: these liability, outcome and difference values incorporate surcharge, which this engine computes only for a total income up to ₹2,00,00,000 (nil at or below ₹50,00,000, and charged at 10%/15% above it). Above ₹2,00,00,000 no surcharge is computed at all — the ₹0 there is not a verified nil, and such a case is reliance-blocked rather than relied on.";

/**
 * Every inventoried figure whose value incorporates the engine's surcharge
 * figure. Derived from the engine's own arithmetic (`compute-tax.ts`):
 * `taxAfterRebate = slabTax - rebate + specialRateTax + surcharge`, so cess
 * (`4% × taxAfterRebate`) carries the dependency exactly as gross liability, the
 * final outcome and the regime difference do — the engine's own cess note string
 * still reads `… + surcharge ₹N`.
 *
 * K4-11 kept the MEMBERSHIP at exactly the same twelve ids `D28` established,
 * and changed only what the caveat says about them. That is deliberate: the
 * arithmetic that put these twelve here and left the others out is unchanged —
 * surcharge still enters at exactly the same point. Figures computed BEFORE it
 * (gross total income, deductions, taxable income, slab tax, special-rate tax,
 * the 87A rebate and taxes paid) still carry no dependency. The two surcharge
 * figures and the two marginal-relief figures are likewise absent because they
 * ARE the surcharge treatment rather than dependents of it.
 *
 * `AUDIT-05-F2` added the THIRTEENTH id: `decision.recommendedRegime`. It is not
 * an amount, but it IS surcharge-dependent — `compute-tax.ts` picks the
 * recommended regime by comparing the two regimes' `refundOrPayable`, both of
 * which are already in this set, so surcharge can change which regime is
 * recommended. The inventory already cites `SURCHARGE_RULE_IDS` on that line
 * (via `LIABILITY_RULE_IDS`), so omitting it here had the read model asserting
 * the dependency in one place and denying it in another. Membership is about
 * whether surcharge can change the VALUE — not about whether the value is a
 * number, and not about whether the figure carries engine source tags (this one
 * is `not_source_tagged_by_construction`; see the guard in
 * `__tests__/case-traceability.test.ts`, which asserts both directions).
 */
export const SURCHARGE_DEPENDENT_FIGURE_IDS = Object.freeze([
  "outcome.refundOrPayable",
  "decision.recommendedRegime",
  "comparison.old.grossTaxLiability",
  "comparison.new.grossTaxLiability",
  "comparison.old.refundOrPayable",
  "comparison.new.refundOrPayable",
  "comparison.difference",
  "comparison.old.cess",
  "comparison.new.cess",
  "detail.old.grossTaxLiability",
  "detail.new.grossTaxLiability",
  "detail.old.cess",
  "detail.new.cess",
] as const satisfies readonly ComputationFigureId[]);

const SURCHARGE_DEPENDENT_FIGURE_ID_SET: ReadonlySet<ComputationFigureId> = new Set(
  SURCHARGE_DEPENDENT_FIGURE_IDS,
);

export function surchargeDependencyCaveatFor(
  id: ComputationFigureId,
): string | null {
  return SURCHARGE_DEPENDENT_FIGURE_ID_SET.has(id)
    ? SURCHARGE_DEPENDENCY_CAVEAT
    : null;
}

function spec(
  id: ComputationFigureId,
  label: string,
  kind: TraceableLineKind,
  state: ComputationFigureTraceabilityState,
  ruleIds: readonly string[],
  limitation: string | null = null,
  format: "amount" | "decision" = "amount",
): ComputationFigureSpec {
  return Object.freeze({ id, label, kind, state, format, ruleIds: Object.freeze([...ruleIds]), limitation });
}

/**
 * The closed figure inventory for one statutory world. Rule ids are the
 * stable contract; this function RE-KEYS them onto that world's lists.
 * It does not compute and does not require a computation binding.
 */
function buildFigureInventory(law: TaxLaw): readonly ComputationFigureSpec[] {
  return Object.freeze([
    spec("outcome.refundOrPayable", "Recommended result — refund / payable", "rule_derived", "traced", LIABILITY_RULE_IDS[law]),
    spec("outcome.taxPaid", "Recommended result — tax paid", "input_projection", "traced", EMPTY_RULE_IDS[law]),
    spec("decision.recommendedRegime", "Recommended regime", "rule_derived", "not_source_tagged_by_construction", LIABILITY_RULE_IDS[law], "Categorical case-level decision; the engine exposes no ComputedValue source tags for it.", "decision"),
    spec("decision.recommendedItrType", "Recommended ITR", "rule_derived", "not_source_tagged_by_construction", ITR_RECOMMENDATION_RULE_IDS[law], "Categorical case-level decision; the engine exposes no ComputedValue source tags for it.", "decision"),
    spec("comparison.old.grossTotalIncome", "Old regime — gross total income", "input_projection", "traced", EMPTY_RULE_IDS[law]),
    spec("comparison.new.grossTotalIncome", "New regime — gross total income", "input_projection", "traced", EMPTY_RULE_IDS[law]),
    spec("comparison.old.deductionsAllowed", "Old regime — deductions", "rule_derived", "traced", DEDUCTION_RULE_IDS[law]),
    spec("comparison.new.deductionsAllowed", "New regime — deductions", "rule_derived", "traced", DEDUCTION_RULE_IDS[law]),
    spec("comparison.old.totalIncome", "Old regime — taxable income", "rule_derived", "traced", DEDUCTION_RULE_IDS[law]),
    spec("comparison.new.totalIncome", "New regime — taxable income", "rule_derived", "traced", DEDUCTION_RULE_IDS[law]),
    spec("comparison.old.taxBeforeRebate", "Old regime — tax before rebate", "rule_derived", "untraced_limitation", EMPTY_RULE_IDS[law], TAX_BEFORE_REBATE_LIMITATION),
    spec("comparison.new.taxBeforeRebate", "New regime — tax before rebate", "rule_derived", "untraced_limitation", EMPTY_RULE_IDS[law], TAX_BEFORE_REBATE_LIMITATION),
    // K4-12: the rebate figure's VALUE can now be produced by clause (b) marginal
    // relief as well as clause (a), so the relief rule joins its citations. Citing
    // only `rebate_87a` would attribute a relieved figure to a rule that does not
    // fully explain it — the mis-attribution D22 exists to prevent.
    spec("comparison.old.rebate", "Old regime — 87A rebate", "rule_derived", "traced", REBATE_RULE_IDS[law]),
    spec("comparison.new.rebate", "New regime — 87A rebate", "rule_derived", "traced", REBATE_RULE_IDS[law]),
    spec("comparison.old.cess", "Old regime — cess", "rule_derived", "traced", CESS_RULE_IDS[law]),
    spec("comparison.new.cess", "New regime — cess", "rule_derived", "traced", CESS_RULE_IDS[law]),
    spec("comparison.old.grossTaxLiability", "Old regime — total liability", "rule_derived", "traced", LIABILITY_RULE_IDS[law]),
    spec("comparison.new.grossTaxLiability", "New regime — total liability", "rule_derived", "traced", LIABILITY_RULE_IDS[law]),
    spec("comparison.old.taxPaid", "Old regime — tax paid", "input_projection", "traced", EMPTY_RULE_IDS[law]),
    spec("comparison.new.taxPaid", "New regime — tax paid", "input_projection", "traced", EMPTY_RULE_IDS[law]),
    spec("comparison.old.refundOrPayable", "Old regime — final outcome", "rule_derived", "traced", LIABILITY_RULE_IDS[law]),
    spec("comparison.new.refundOrPayable", "New regime — final outcome", "rule_derived", "traced", LIABILITY_RULE_IDS[law]),
    spec("comparison.difference", "Difference in liability (old minus new)", "rule_derived", "traced", LIABILITY_RULE_IDS[law]),
    spec("summary.grossTotalIncome", "Input summary — gross total income", "input_projection", "traced", EMPTY_RULE_IDS[law]),
    spec("detail.old.slabTax", "Old regime — slab tax (pre-rebate)", "rule_derived", "traced", SLAB_TAX_RULE_IDS[law]),
    spec("detail.new.slabTax", "New regime — slab tax (pre-rebate)", "rule_derived", "traced", SLAB_TAX_RULE_IDS[law]),
    spec("detail.old.specialRateTax", "Old regime — special-rate tax", "rule_derived", "traced", SPECIAL_RATE_RULE_IDS[law]),
    spec("detail.new.specialRateTax", "New regime — special-rate tax", "rule_derived", "traced", SPECIAL_RATE_RULE_IDS[law]),
    // K4-11 RETIRED these two untraced limitations. They were the "unimplemented
    // zero placeholder" pair; surcharge is now computed from declared, cited pack
    // rules and the engine tags the figure with the same facts its slab and
    // special-rate tax carry, so both are ordinary traced figures. The other two
    // untraced limitations in this inventory (the old/new presentation-derived
    // `taxBeforeRebate` totals) are a SEPARATE, unrelated limitation and are
    // deliberately left in place — this session had no mandate over them and they
    // are not surcharge placeholders.
    spec("detail.old.surcharge", "Old regime — surcharge", "rule_derived", "traced", SURCHARGE_RULE_IDS[law]),
    spec("detail.new.surcharge", "New regime — surcharge", "rule_derived", "traced", SURCHARGE_RULE_IDS[law]),
    spec("detail.old.marginalRelief", "Old regime — marginal relief", "rule_derived", "traced", SURCHARGE_RULE_IDS[law]),
    spec("detail.new.marginalRelief", "New regime — marginal relief", "rule_derived", "traced", SURCHARGE_RULE_IDS[law]),
    spec("detail.old.rebateMarginalRelief", "Old regime — s.87A rebate-threshold relief", "rule_derived", "traced", REBATE_RULE_IDS[law]),
    spec("detail.new.rebateMarginalRelief", "New regime — s.87A rebate-threshold relief", "rule_derived", "traced", REBATE_RULE_IDS[law]),
    spec("detail.old.cess", "Old regime — cess (full calculation)", "rule_derived", "traced", CESS_RULE_IDS[law]),
    spec("detail.new.cess", "New regime — cess (full calculation)", "rule_derived", "traced", CESS_RULE_IDS[law]),
    spec("detail.old.grossTaxLiability", "Old regime — gross liability (full calculation)", "rule_derived", "traced", LIABILITY_RULE_IDS[law]),
    spec("detail.new.grossTaxLiability", "New regime — gross liability (full calculation)", "rule_derived", "traced", LIABILITY_RULE_IDS[law]),
    spec("detail.old.housePropertyIncome", "Old regime — house property net income", "rule_derived", "traced", HOUSE_PROPERTY_RULE_IDS[law]),
    spec("detail.new.housePropertyIncome", "New regime — house property net income", "rule_derived", "traced", HOUSE_PROPERTY_RULE_IDS[law]),
    spec("detail.old.presumptiveProfessionalIncome", "Old regime — presumptive professional income (44ADA)", "rule_derived", "traced", PRESUMPTIVE_44ADA_RULE_IDS[law]),
    spec("detail.new.presumptiveProfessionalIncome", "New regime — presumptive professional income (44ADA)", "rule_derived", "traced", PRESUMPTIVE_44ADA_RULE_IDS[law]),
    spec("detail.old.presumptiveBusinessIncome", "Old regime — presumptive business income (44AD)", "rule_derived", "traced", PRESUMPTIVE_44AD_RULE_IDS[law]),
    spec("detail.new.presumptiveBusinessIncome", "New regime — presumptive business income (44AD)", "rule_derived", "traced", PRESUMPTIVE_44AD_RULE_IDS[law]),
    spec("detail.old.businessBooksIncome", "Old regime — books-based business net profit (s.28/29)", "rule_derived", "traced", BUSINESS_BOOKS_RULE_IDS[law]),
    spec("detail.new.businessBooksIncome", "New regime — books-based business net profit (s.28/29)", "rule_derived", "traced", BUSINESS_BOOKS_RULE_IDS[law]),
    spec("detail.old.broughtForwardLossSetOff", "Old regime — brought-forward capital loss set off (s.74)", "rule_derived", "traced", BROUGHT_FORWARD_LOSS_RULE_IDS[law]),
    spec("detail.new.broughtForwardLossSetOff", "New regime — brought-forward capital loss set off (s.74)", "rule_derived", "traced", BROUGHT_FORWARD_LOSS_RULE_IDS[law]),
  ]);
}

const FIGURE_INVENTORY_BY_LAW: Readonly<Record<TaxLaw, readonly ComputationFigureSpec[]>> = Object.freeze({
  ITA_1961: buildFigureInventory("ITA_1961"),
  ITA_2025: buildFigureInventory("ITA_2025"),
});

/**
 * The figure→rule mapping for one statutory world. Does not compute and does
 * not require a computation binding — an unbound pack still has rules.
 */
export function computationFigureInventoryFor(law: TaxLaw): readonly ComputationFigureSpec[] {
  return FIGURE_INVENTORY_BY_LAW[law];
}

/**
 * The AY 1961 inventory. The Computation page and existing coverage reports
 * consume this export; a TY case is still refused as `unbound` and never
 * reaches these specs. Prefer {@link computationFigureInventoryFor} when the
 * governing world's law is known.
 */
export const COMPUTATION_FIGURE_INVENTORY: readonly ComputationFigureSpec[] =
  FIGURE_INVENTORY_BY_LAW.ITA_1961;

/** Every rule-id family the inventory is keyed on — the plant/guard surface. */
export const FIGURE_RULE_ID_FAMILIES: readonly WorldKeyedRuleIds[] = Object.freeze([
  LIABILITY_RULE_IDS,
  CESS_RULE_IDS,
  SURCHARGE_RULE_IDS,
  REBATE_RULE_IDS,
  DEDUCTION_RULE_IDS,
  SLAB_TAX_RULE_IDS,
  SPECIAL_RATE_RULE_IDS,
  HOUSE_PROPERTY_RULE_IDS,
  PRESUMPTIVE_44ADA_RULE_IDS,
  PRESUMPTIVE_44AD_RULE_IDS,
  BUSINESS_BOOKS_RULE_IDS,
  BROUGHT_FORWARD_LOSS_RULE_IDS,
  ITR_RECOMMENDATION_RULE_IDS,
  EMPTY_RULE_IDS,
]);

/** Distinct pack rule ids cited by one world's inventory, sorted. */
export function citedFigureRuleIds(law: TaxLaw): readonly string[] {
  return Object.freeze(
    [...new Set(computationFigureInventoryFor(law).flatMap((figure) => [...figure.ruleIds]))].sort(),
  );
}

/** Runtime proof that every shipped law has a keyed inventory. */
export const FIGURE_INVENTORY_LAWS: readonly TaxLaw[] = TAX_LAWS;

interface FigureProjection {
  readonly value: number | string;
  readonly sources: readonly string[] | null;
}
const fromComputed = (value: ComputedValue): FigureProjection => ({ value: value.value, sources: value.sources });
/**
 * K4-06: `outputs.comparison`/`outputs.computation` can be a snapshot's OWN
 * immutable stored JSON (`resolveEvidenceManifestCandidate` reads
 * `snapshot.comparison` directly — never recomputed, per "snapshots are
 * immutable", `PROJECT_CONSTITUTION.md` §2 rule 8). A snapshot taken BEFORE
 * this session's `housePropertyIncome` field existed has no such property in
 * its stored JSON at all — `undefined`, not a zero `ComputedValue`. Treating
 * that as ₹0/no-sources is not a crash-avoidance guess: no house-property
 * ledger category existed when that snapshot was computed, so ₹0 is the
 * actual correct historical figure, never a fabricated one.
 */
const fromComputedOrAbsent = (value: ComputedValue | undefined): FigureProjection =>
  value ? fromComputed(value) : { value: 0, sources: [] };
const FIGURE_PROJECTORS: Readonly<Record<ComputationFigureId, (o: ComputationFigureOutputs) => FigureProjection>> = Object.freeze({
  "outcome.refundOrPayable": (o) => fromComputed(o.computation.refundOrPayable),
  "outcome.taxPaid": (o) => fromComputed(o.computation.taxPaid),
  "decision.recommendedRegime": (o) => ({ value: o.comparison.recommendedRegime, sources: null }),
  "decision.recommendedItrType": (o) => ({ value: o.itrRecommendation.recommendedItrType, sources: null }),
  "comparison.old.grossTotalIncome": (o) => fromComputed(o.computation.grossTotalIncome),
  "comparison.new.grossTotalIncome": (o) => fromComputed(o.computation.grossTotalIncome),
  "comparison.old.deductionsAllowed": (o) => fromComputed(o.comparison.oldRegime.deductionsAllowed),
  "comparison.new.deductionsAllowed": (o) => fromComputed(o.comparison.newRegime.deductionsAllowed),
  "comparison.old.totalIncome": (o) => fromComputed(o.comparison.oldRegime.totalIncome),
  "comparison.new.totalIncome": (o) => fromComputed(o.comparison.newRegime.totalIncome),
  "comparison.old.taxBeforeRebate": (o) => ({ value: o.comparison.oldRegime.slabTax.value + o.comparison.oldRegime.specialRateTax.value, sources: null }),
  "comparison.new.taxBeforeRebate": (o) => ({ value: o.comparison.newRegime.slabTax.value + o.comparison.newRegime.specialRateTax.value, sources: null }),
  "comparison.old.rebate": (o) => fromComputed(o.comparison.oldRegime.rebate),
  "comparison.new.rebate": (o) => fromComputed(o.comparison.newRegime.rebate),
  "comparison.old.cess": (o) => fromComputed(o.comparison.oldRegime.cess),
  "comparison.new.cess": (o) => fromComputed(o.comparison.newRegime.cess),
  "comparison.old.grossTaxLiability": (o) => fromComputed(o.comparison.oldRegime.grossTaxLiability),
  "comparison.new.grossTaxLiability": (o) => fromComputed(o.comparison.newRegime.grossTaxLiability),
  "comparison.old.taxPaid": (o) => fromComputed(o.comparison.oldRegime.taxPaid),
  "comparison.new.taxPaid": (o) => fromComputed(o.comparison.newRegime.taxPaid),
  "comparison.old.refundOrPayable": (o) => fromComputed(o.comparison.oldRegime.refundOrPayable),
  "comparison.new.refundOrPayable": (o) => fromComputed(o.comparison.newRegime.refundOrPayable),
  "comparison.difference": (o) => fromComputed(o.comparison.difference),
  "summary.grossTotalIncome": (o) => fromComputed(o.computation.grossTotalIncome),
  "detail.old.slabTax": (o) => fromComputed(o.comparison.oldRegime.slabTax),
  "detail.new.slabTax": (o) => fromComputed(o.comparison.newRegime.slabTax),
  "detail.old.specialRateTax": (o) => fromComputed(o.comparison.oldRegime.specialRateTax),
  "detail.new.specialRateTax": (o) => fromComputed(o.comparison.newRegime.specialRateTax),
  // K4-11: the surcharge figure now carries real source tags (the union of the
  // slab-tax and special-rate-tax facts it is a percentage of), so it is
  // projected like any other computed figure instead of being forced to
  // `sources: null`.
  "detail.old.surcharge": (o) => fromComputed(o.comparison.oldRegime.surcharge),
  "detail.new.surcharge": (o) => fromComputed(o.comparison.newRegime.surcharge),
  // `fromComputedOrAbsent` for the K4-06 reason: a snapshot's stored JSON
  // predating this session carries no `marginalRelief` property at all, and ₹0
  // is the historically CORRECT value for it (no surcharge was computed, so no
  // relief could arise), never a fabricated one.
  "detail.old.marginalRelief": (o) => fromComputedOrAbsent(o.comparison.oldRegime.marginalRelief),
  "detail.new.marginalRelief": (o) => fromComputedOrAbsent(o.comparison.newRegime.marginalRelief),
  // K4-12: `fromComputedOrAbsent` for the same K4-06 reason — a snapshot
  // predating this session carries no `rebateMarginalRelief` property, and ₹0 is
  // the historically CORRECT value (no such relief was computed), never a
  // fabricated one.
  "detail.old.rebateMarginalRelief": (o) => fromComputedOrAbsent(o.comparison.oldRegime.rebateMarginalRelief),
  "detail.new.rebateMarginalRelief": (o) => fromComputedOrAbsent(o.comparison.newRegime.rebateMarginalRelief),
  "detail.old.cess": (o) => fromComputed(o.comparison.oldRegime.cess),
  "detail.new.cess": (o) => fromComputed(o.comparison.newRegime.cess),
  "detail.old.grossTaxLiability": (o) => fromComputed(o.comparison.oldRegime.grossTaxLiability),
  "detail.new.grossTaxLiability": (o) => fromComputed(o.comparison.newRegime.grossTaxLiability),
  "detail.old.housePropertyIncome": (o) => fromComputedOrAbsent(o.comparison.oldRegime.housePropertyIncome),
  "detail.new.housePropertyIncome": (o) => fromComputedOrAbsent(o.comparison.newRegime.housePropertyIncome),
  // K4-07: same `fromComputedOrAbsent` discipline K4-06 established — a
  // snapshot's stored JSON predating this session's `presumptiveProfessional
  // Income` field has no such property at all (undefined, not a zero
  // ComputedValue); a missing field is treated as ₹0/no-sources, the
  // historically CORRECT value since this income category did not exist
  // before this session, never a fabricated one.
  "detail.old.presumptiveProfessionalIncome": (o) => fromComputedOrAbsent(o.comparison.oldRegime.presumptiveProfessionalIncome),
  "detail.new.presumptiveProfessionalIncome": (o) => fromComputedOrAbsent(o.comparison.newRegime.presumptiveProfessionalIncome),
  // K4-08 — `fromComputedOrAbsent` for the same K4-06 reason: a snapshot's
  // stored JSON predating this field is legitimately ₹0/no-sources (44AD did
  // not exist as a concept), never a fabricated value.
  "detail.old.presumptiveBusinessIncome": (o) => fromComputedOrAbsent(o.comparison.oldRegime.presumptiveBusinessIncome),
  "detail.new.presumptiveBusinessIncome": (o) => fromComputedOrAbsent(o.comparison.newRegime.presumptiveBusinessIncome),
  // K4-14 — `fromComputedOrAbsent` for the same K4-06 reason: a snapshot
  // predating this field carries no such property, and ₹0 is the historically
  // CORRECT value (no books-based row could exist before this session), never
  // a fabricated one.
  "detail.old.businessBooksIncome": (o) => fromComputedOrAbsent(o.comparison.oldRegime.businessBooksIncome),
  "detail.new.businessBooksIncome": (o) => fromComputedOrAbsent(o.comparison.newRegime.businessBooksIncome),
  // K4-10 — `fromComputedOrAbsent` for the same K4-06 reason: a snapshot's
  // stored JSON predating this field carries no such property, and ₹0 is the
  // historically CORRECT value (no carry-forward record could exist before
  // this session), never a fabricated one.
  "detail.old.broughtForwardLossSetOff": (o) => fromComputedOrAbsent(o.comparison.oldRegime.broughtForwardLossSetOff),
  "detail.new.broughtForwardLossSetOff": (o) => fromComputedOrAbsent(o.comparison.newRegime.broughtForwardLossSetOff),
});

export function buildComputationFigureValues(outputs: ComputationFigureOutputs): Readonly<Record<ComputationFigureId, number | string>> {
  return Object.freeze(Object.fromEntries(COMPUTATION_FIGURE_IDS.map((id) => [id, FIGURE_PROJECTORS[id](outputs).value])) as Record<ComputationFigureId, number | string>);
}

export interface ComputationFigurePairRow {
  readonly label: string;
  readonly oldId: ComputationFigureId;
  readonly newId: ComputationFigureId;
  readonly strong?: boolean;
}

export const REGIME_COMPARISON_FIGURE_ROWS: readonly ComputationFigurePairRow[] = Object.freeze([
  { label: "Total income (gross)", oldId: "comparison.old.grossTotalIncome", newId: "comparison.new.grossTotalIncome" },
  { label: "Deductions", oldId: "comparison.old.deductionsAllowed", newId: "comparison.new.deductionsAllowed" },
  { label: "Taxable income", oldId: "comparison.old.totalIncome", newId: "comparison.new.totalIncome" },
  { label: "Tax before rebate", oldId: "comparison.old.taxBeforeRebate", newId: "comparison.new.taxBeforeRebate" },
  { label: "87A rebate", oldId: "comparison.old.rebate", newId: "comparison.new.rebate" },
  { label: "Cess", oldId: "comparison.old.cess", newId: "comparison.new.cess" },
  { label: "Total liability", oldId: "comparison.old.grossTaxLiability", newId: "comparison.new.grossTaxLiability", strong: true },
  { label: "Tax paid", oldId: "comparison.old.taxPaid", newId: "comparison.new.taxPaid" },
] as const);

export const FULL_CALCULATION_FIGURE_ROWS: readonly ComputationFigurePairRow[] = Object.freeze([
  { label: "House property net income", oldId: "detail.old.housePropertyIncome", newId: "detail.new.housePropertyIncome" },
  { label: "Presumptive professional income (44ADA)", oldId: "detail.old.presumptiveProfessionalIncome", newId: "detail.new.presumptiveProfessionalIncome" },
  { label: "Presumptive business income (44AD)", oldId: "detail.old.presumptiveBusinessIncome", newId: "detail.new.presumptiveBusinessIncome" },
  { label: "Books-based business net profit (s.28/29)", oldId: "detail.old.businessBooksIncome", newId: "detail.new.businessBooksIncome" },
  { label: "Brought-forward capital loss set off (s.74)", oldId: "detail.old.broughtForwardLossSetOff", newId: "detail.new.broughtForwardLossSetOff" },
  { label: "Slab tax (pre-rebate)", oldId: "detail.old.slabTax", newId: "detail.new.slabTax" },
  { label: "Special-rate tax", oldId: "detail.old.specialRateTax", newId: "detail.new.specialRateTax" },
  // K4-11: the label no longer says "unimplemented placeholder" — it is a
  // computed figure now. Marginal relief gets its own row rather than being
  // folded into the surcharge line, because a preparer reconciling a REDUCED
  // surcharge has to be able to see the reduction itself.
  { label: "Surcharge", oldId: "detail.old.surcharge", newId: "detail.new.surcharge" },
  { label: "Marginal relief (already netted off surcharge)", oldId: "detail.old.marginalRelief", newId: "detail.new.marginalRelief" },
  // K4-12: the SEPARATE section 87A relief, on its own row for the same reason
  // the surcharge relief has one — a preparer reconciling a rebate that exists
  // ABOVE the ₹12,00,000 ceiling has to be able to see what produced it. Already
  // inside the rebate figure; never subtracted twice.
  { label: "s.87A rebate-threshold relief (already inside the rebate)", oldId: "detail.old.rebateMarginalRelief", newId: "detail.new.rebateMarginalRelief" },
  { label: "Cess", oldId: "detail.old.cess", newId: "detail.new.cess" },
  { label: "Gross liability", oldId: "detail.old.grossTaxLiability", newId: "detail.new.grossTaxLiability", strong: true },
] as const);

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

/** One rule behind a line, as the governing pack itself declares it. */
export interface TracedRule {
  readonly ruleId: string;
  readonly summary: string;
  /** Human-readable citations the pack declares. Empty is an honest gap. */
  readonly citations: readonly string[];
  /** The pack's documented `TODO(CA-verify)` caveat, when it carries one. */
  readonly caveat: string | null;
}

/**
 * Immutable decision lineage for a ledger row that entered the ledgers through
 * the `K3-30` propose → review → promote workflow, resolved through the
 * promotion RPC's own immutable link (`promoted_ledger_kind` +
 * `promoted_ledger_entry_id`), never re-derived and never inferred from
 * `source_type = 'Form16'` alone (a manually entered Form16-tagged row carries
 * no such lineage — see `resolvePromotedProposalLineage`).
 */
export interface PromotedProposalLineage {
  readonly proposalId: string;
  readonly taxCaseId: string;
  readonly factKind: ProposalFactKind;
  readonly sourceDocumentId: string;
  readonly promotedLedgerKind: "income" | "tax_paid";
  readonly promotedLedgerEntryId: string;
  readonly decidedByName: string | null;
  readonly decidedAt: string | null;
  readonly promotedByName: string | null;
  readonly promotedAt: string | null;
}

/** One ledger fact that contributed to a line, resolved from the engine's tags. */
export interface ContributingLedgerFact {
  readonly ledgerId: string;
  /** K4-10 widened this union: the brought-forward set-off figures are derived
   *  from carry-forward records, so those records must be nameable as
   *  contributing facts — otherwise the figure would appear to rest only on the
   *  gain rows that absorbed the loss, which is half the answer. */
  readonly ledgerKind:
    | "income"
    | "tax_paid"
    | "deduction"
    | "capital_gain"
    | "house_property"
    | "brought_forward_loss"
    | "business_books";
  readonly sourceType: SourceType;
  /**
   * Label of the row's SOURCE document, or `null` when it points at none. A
   * deduction may still carry a separate *proof* document — the engine does not
   * tag by it, so this model cannot claim it either (see the note on
   * `documentLabelIndex`).
   */
  readonly documentLabel: string | null;
  /** Whether the engine's tag matched the row's document or the row itself. */
  readonly resolvedBy: "document" | "ledger_row";
  /**
   * `K3-31`: non-null ONLY when this exact ledger row was inserted by
   * `promote_source_proposal_pair` for an accepted proposal pair — never
   * inferred from `sourceType`/`documentLabel` alone. `null` for every other
   * row, including a manually entered row that happens to carry the same
   * `Form16` source tag.
   */
  readonly promotedProposal: PromotedProposalLineage | null;
}

export interface TraceableLine {
  readonly id: ComputationFigureId;
  readonly label: string;
  readonly kind: TraceableLineKind;
  /** Immutable review decision recorded by `COMPUTATION_FIGURE_INVENTORY`. */
  readonly authoredState: ComputationFigureTraceabilityState;
  /** Runtime state after checking cited ids against the governing pack. */
  readonly state: EffectiveComputationFigureTraceabilityState;
  readonly format: "amount" | "decision";
  readonly value: number | string;
  /** Human-visible reason for either explicit non-traced state. */
  readonly limitation: string | null;
  /** A traced lineage can still depend on an unimplemented engine component. */
  readonly implementationCaveat: string | null;
  /** Rules resolved against the governing pack's provenance, in spec order. */
  readonly rules: readonly TracedRule[];
  /**
   * Rule ids this model names that the governing pack does NOT declare. Non-empty
   * means the mapping has drifted from the pack — surfaced, never swallowed.
   */
  readonly unknownRuleIds: readonly string[];
  /**
   * DERIVED: any cited rule carries an unresolved caveat, or the governing pack
   * is not `ca_verified`. Never a literal.
   */
  readonly rulesUnverified: boolean;
  /**
   * Facts behind the number, from the engine's own source tags. EMPTY is a real
   * answer, not a gap: the 87A rebate and the cess, for instance, are functions
   * of totals rather than of specific rows, so the engine tags them with none.
   */
  readonly contributingFacts: readonly ContributingLedgerFact[];
  /** Engine source tags that matched no mapped ledger row. Surfaced, not hidden. */
  readonly unresolvedSourceTags: readonly string[];
}

/** What may truthfully be said about the pack governing a case. */
export interface GoverningPackState {
  readonly key: string;
  /** Statutory world the pack belongs to — the figure→rule mapping key. */
  readonly law: TaxLaw;
  readonly computationRulesVersion: string;
  readonly validationRulesVersion: string;
  readonly status: TaxPackStatus;
  /** True ONLY for a `ca_verified` pack with complete per-rule evidence. */
  readonly verified: boolean;
  /** One-line summary from the canonical verification reader. Never overstates. */
  readonly summary: string;
  readonly unverifiedRuleIds: readonly string[];
  readonly gaps: readonly string[];
}

/** One declared fact the adapter excluded from the computation. */
export interface ExcludedFact {
  readonly ledgerId: string;
  /** K4-10 widened this union: a brought-forward carry-forward record can be
   *  excluded too, and an exclusion the traceability model cannot name is
   *  indistinguishable from a silent drop. K4-14 widened it again for the
   *  books-based business kind, for exactly that reason — a refused books row
   *  is the single most important thing this slice has to be able to show. */
  readonly ledgerKind:
    | "income"
    | "capital_gain"
    | "house_property"
    | "brought_forward_loss"
    | "business_books";
  readonly code: string;
  readonly entryType: string;
  readonly amount: number;
}

export interface CaseCompleteness {
  /** True when NOTHING declared was excluded from the numbers. */
  readonly complete: boolean;
  readonly excluded: readonly ExcludedFact[];
}

export type CaseTraceability =
  | {
      readonly outcome: "traced";
      readonly pack: GoverningPackState;
      /** `null` when the pack may be relied upon; today it never is. */
      readonly relianceBlocker: TaxPackRelianceBlocker | null;
      readonly completeness: CaseCompleteness;
      readonly lines: readonly TraceableLine[];
    }
  | {
      readonly outcome: "refused";
      /** Truthful, non-guessing reason from `bindDefaultTaxPackToCase`. */
      readonly reason: string;
      readonly resolution: "unsupported" | "ambiguous" | "unbound";
      readonly completeness: CaseCompleteness;
    };

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/**
 * Index the engine input's entries by the identifier the engine's own `sourceTag`
 * uses (`sourceDocumentId ?? id`). We index BY the engine's convention rather
 * than re-deriving which rows fed a figure; a tag that matches no entry is
 * reported as an unresolved tag, never dropped.
 */
interface IndexedFact {
  readonly ledgerId: string;
  readonly ledgerKind: ContributingLedgerFact["ledgerKind"];
  readonly sourceType: SourceType;
  readonly documentLabel: string | null;
  readonly identifier: string;
  /** The row's own `source_document_id`, or `null` when it has none. Distinct
   *  from `identifier` (which falls back to the ledger row id itself) — this
   *  field is used ONLY to cross-check promoted-proposal lineage. */
  readonly sourceDocumentId: string | null;
}

/**
 * Label of each row's SOURCE document, by ledger id.
 *
 * A deduction's separate *proof* document (`proof_case_document_id`) is
 * deliberately NOT folded in: the engine's `sourceTag` never uses it, so a
 * proof-only row is tagged by its ledger id and this model has no basis to claim
 * a document backed the figure. The surface therefore says "no source document"
 * — accurate — rather than "no document", which would understate a row that does
 * carry a proof. Naming the proof would need it to be joined into the read model
 * first (`queries/tax-desk.ts`), and is a deliberate follow-up, not a guess here.
 */
function documentLabelIndex(rows: LedgerRows): ReadonlyMap<string, string> {
  const labels = new Map<string, string>();
  const add = (r: { id: string; source_document_name?: string | null; source_file_name?: string | null }) => {
    const label = r.source_document_name ?? r.source_file_name ?? null;
    if (label) labels.set(r.id, label);
  };
  rows.income.forEach(add);
  rows.taxPaid.forEach(add);
  rows.deductions.forEach(add);
  rows.capitalGains.forEach(add);
  rows.housePropertyEntries?.forEach(add);
  rows.broughtForwardLosses?.forEach(add);
  rows.businessBooksEntries?.forEach(add);
  return labels;
}

function indexFacts(adapter: AdapterResult, rows: LedgerRows): readonly IndexedFact[] {
  const labels = documentLabelIndex(rows);
  const facts: IndexedFact[] = [];
  const push = (
    ledgerKind: ContributingLedgerFact["ledgerKind"],
    entry: {
      id: string;
      sourceType: SourceType;
      sourceDocumentId?: string;
      source_document_id?: string;
    },
  ) => {
    const documentId = entry.source_document_id ?? entry.sourceDocumentId;
    facts.push({
      ledgerId: entry.id,
      ledgerKind,
      sourceType: entry.sourceType,
      documentLabel: labels.get(entry.id) ?? null,
      identifier: documentId ?? entry.id,
      sourceDocumentId: documentId ?? null,
    });
  };
  for (const e of adapter.input.income) push("income", e);
  for (const e of adapter.input.taxPaid) push("tax_paid", e);
  for (const e of adapter.input.deductions) push("deduction", e);
  for (const e of adapter.input.capitalGains) push("capital_gain", e);
  for (const e of adapter.input.housePropertyEntries ?? []) push("house_property", e);
  for (const e of adapter.input.businessBooksEntries ?? []) push("business_books", e);
  // K4-10. `sourceType` is optional on a brought-forward engine entry (the
  // adapter always supplies it from the row); default conservatively rather
  // than assert, so a hand-built input cannot crash a preparer's screen.
  for (const e of adapter.input.broughtForwardLosses ?? []) {
    push("brought_forward_loss", { ...e, sourceType: e.sourceType ?? "manual" });
  }
  return facts;
}

/**
 * `K3-31`. Answers exactly one question about an already-identified
 * contributing ledger row (identified by the engine's OWN source tags — this
 * function derives nothing about WHICH rows contributed): was this row
 * inserted by an accepted, promoted source proposal, and if so what is its
 * decision lineage?
 *
 * Matches through the promotion RPC's own immutable link
 * (`promotedLedgerKind` + `promotedLedgerEntryId`), then cross-checks
 * consistency against `taxCaseId` and, when the fact's own source document id
 * is known, `sourceDocumentId` — defense in depth only: `promote_source_
 * proposal_pair` writes the ledger row and the proposal's lineage columns in
 * ONE transaction, so these should never disagree. If they ever did, this
 * treats it as NOT a match rather than risk mis-attributing lineage to the
 * wrong row. `source_type = 'Form16'` is never sufficient on its own — a
 * manually entered row can carry the identical tag and must render with no
 * lineage.
 */
export function resolvePromotedProposalLineage(
  fact: {
    readonly ledgerKind: ContributingLedgerFact["ledgerKind"];
    readonly ledgerId: string;
    readonly sourceDocumentId: string | null;
  },
  taxCaseId: string,
  promotedProposals: readonly PromotedProposalLineage[],
): PromotedProposalLineage | null {
  if (fact.ledgerKind !== "income" && fact.ledgerKind !== "tax_paid") return null;
  for (const proposal of promotedProposals) {
    if (proposal.promotedLedgerKind !== fact.ledgerKind) continue;
    if (proposal.promotedLedgerEntryId !== fact.ledgerId) continue;
    if (proposal.taxCaseId !== taxCaseId) continue;
    if (fact.sourceDocumentId !== null && proposal.sourceDocumentId !== fact.sourceDocumentId) continue;
    return proposal;
  }
  return null;
}

export interface ResolvedRuleTrace {
  readonly rules: readonly TracedRule[];
  readonly unknownRuleIds: readonly string[];
  readonly caveated: boolean;
  readonly effectiveState: EffectiveComputationFigureTraceabilityState;
}

/**
 * Resolve only through the supplied governing-pack declaration. This exported
 * seam lets drift be tested with controlled provenance without mutating the
 * default registry or inventing fallback rule metadata.
 *
 * `K3-26`: the downgrade to `untraced_rule_mapping_gap` applies to ANY authored
 * line that cites at least one rule id, not only lines authored `traced`. The
 * two categorical decisions (`decision.recommendedRegime`,
 * `decision.recommendedItrType`) also cite governing-pack rule ids — they are
 * `not_source_tagged_by_construction` because the engine attaches no per-value
 * source tag to a categorical decision, which is a SEPARATE fact from whether
 * their cited rule ids still resolve. Gating the downgrade on `spec.state ===
 * "traced"` alone let a categorical line's citation drift stay invisible in the
 * panel's effective counts, surfacing only as an inline `unknownRuleIds` note —
 * exactly the gap D22 was written to close for every line, not only traced
 * ones. Lines authored `untraced_limitation` are unaffected: they declare no
 * rule ids (`ruleIds: []`), so the loop below never runs for them and
 * `unknownRuleIds` stays empty.
 */
export function resolveRuleTrace(
  spec: ComputationFigureSpec,
  declared: readonly RuleProvenance[],
): ResolvedRuleTrace {
  const rules: TracedRule[] = [];
  const unknownRuleIds: string[] = [];
  let caveated = false;
  for (const ruleId of spec.ruleIds) {
    const rule = declared.find((r) => r.ruleId === ruleId);
    if (rule === undefined) {
      unknownRuleIds.push(ruleId);
      continue;
    }
    if (rule.caveat !== null) caveated = true;
    rules.push(
      Object.freeze({
        ruleId: rule.ruleId,
        summary: rule.summary,
        citations: Object.freeze(rule.sources.map((s) => s.citation)),
        caveat: rule.caveat,
      }),
    );
  }
  return Object.freeze({
    rules: Object.freeze(rules),
    unknownRuleIds: Object.freeze(unknownRuleIds),
    caveated,
    effectiveState:
      spec.ruleIds.length > 0 && unknownRuleIds.length > 0
        ? "untraced_rule_mapping_gap"
        : spec.state,
  });
}

export interface TraceabilityStateSummary {
  readonly authoredTraced: number;
  readonly authoredCategorical: number;
  readonly authoredLimitations: number;
  readonly effectiveTraced: number;
  readonly effectiveCategorical: number;
  readonly effectiveLimitations: number;
  readonly effectiveRuleMappingGaps: number;
}

/** The one count authority consumed by the traceability panel. */
export function summarizeTraceabilityStates(
  lines: readonly Pick<TraceableLine, "authoredState" | "state">[],
): TraceabilityStateSummary {
  return Object.freeze({
    authoredTraced: lines.filter((line) => line.authoredState === "traced").length,
    authoredCategorical: lines.filter(
      (line) => line.authoredState === "not_source_tagged_by_construction",
    ).length,
    authoredLimitations: lines.filter(
      (line) => line.authoredState === "untraced_limitation",
    ).length,
    effectiveTraced: lines.filter((line) => line.state === "traced").length,
    effectiveCategorical: lines.filter(
      (line) => line.state === "not_source_tagged_by_construction",
    ).length,
    effectiveLimitations: lines.filter(
      (line) => line.state === "untraced_limitation",
    ).length,
    effectiveRuleMappingGaps: lines.filter(
      (line) => line.state === "untraced_rule_mapping_gap",
    ).length,
  });
}

function completenessOf(adapter: AdapterResult): CaseCompleteness {
  return Object.freeze({
    complete: adapter.complete,
    excluded: Object.freeze(
      adapter.warnings.map((w) =>
        Object.freeze({
          ledgerId: w.ledgerId,
          ledgerKind: w.ledgerKind,
          code: w.code,
          entryType: w.entryType,
          amount: w.amount,
        }),
      ),
    ),
  });
}

/** The governing pack, or the resolver's own refusal. */
export type GoverningPackResolution =
  | {
      readonly outcome: "bound";
      readonly pack: GoverningPackState;
      /** The pack's declared rules — the only rule metadata any caller may show. */
      readonly declared: readonly RuleProvenance[];
      readonly relianceBlocker: TaxPackRelianceBlocker | null;
    }
  | {
      readonly outcome: "refused";
      readonly reason: string;
      readonly resolution: "unsupported" | "ambiguous" | "unbound";
    };

/**
 * Which versioned pack governs this case, and what may truthfully be said about
 * it. The single entry point for any surface that wants to print a pack version
 * — so a screen can never show a rules-version string sourced from an engine
 * constant that nothing checked against the case's actual governing pack.
 */
export function describeGoverningPack(statutory: TaxCaseStatutoryContext): GoverningPackResolution {
  const binding = bindDefaultTaxPackToCase(statutory);
  if (binding.outcome === "refused") {
    return Object.freeze({
      outcome: "refused",
      reason: binding.reason,
      resolution: binding.resolution,
    });
  }
  const verification = describeTaxPackVerification(binding.pack);
  return Object.freeze({
    outcome: "bound",
    pack: Object.freeze({
      key: verification.key,
      law: binding.pack.identity.law,
      computationRulesVersion: binding.versions.computationRulesVersion,
      validationRulesVersion: binding.versions.validationRulesVersion,
      status: verification.status,
      verified: verification.verified,
      summary: verification.summary,
      unverifiedRuleIds: verification.unverifiedRuleIds,
      gaps: verification.gaps,
    }),
    declared: taxPackProvenance(binding.pack)?.rules ?? [],
    relianceBlocker: defaultTaxPackRelianceBlocker(statutory),
  });
}

/**
 * Describe a live case's traceability. Pure, total, and deterministic — it never
 * throws and never guesses: a case whose statutory coordinates resolve to no
 * bound pack yields an explicit `refused` outcome carrying the resolver's own
 * reason, with the adapter's exclusions still reported (they are true regardless
 * of which pack governs).
 *
 * `outputs` may be `null` (no computation produced — e.g. withheld by the
 * eligibility gate); the pack and completeness are still described, with no lines.
 */
export function describeCaseTraceability(args: {
  statutory: TaxCaseStatutoryContext;
  adapter: AdapterResult;
  rows: LedgerRows;
  outputs: ComputationFigureOutputs | null;
  /**
   * `K3-31`: the case's own id, used ONLY to cross-check promoted-proposal
   * lineage consistency (defense in depth — see `resolvePromotedProposalLineage`).
   * Omit to skip lineage attachment entirely (existing callers are unaffected).
   */
  taxCaseId?: string;
  /** `K3-31`: promoted proposals for this case (`status = 'promoted'` only —
   *  proposed/accepted-not-promoted/rejected rows never belong here because
   *  they never produced a ledger row to attach lineage to). Defaults to none. */
  promotedProposals?: readonly PromotedProposalLineage[];
}): CaseTraceability {
  const completeness = completenessOf(args.adapter);
  const taxCaseId = args.taxCaseId ?? null;
  const promotedProposals = args.promotedProposals ?? [];
  const governing = describeGoverningPack(args.statutory);
  if (governing.outcome === "refused") {
    return Object.freeze({
      outcome: "refused",
      reason: governing.reason,
      resolution: governing.resolution,
      completeness,
    });
  }
  const { pack, declared } = governing;

  const lines: TraceableLine[] = [];
  if (args.outputs !== null) {
    const facts = indexFacts(args.adapter, args.rows);
    for (const spec of computationFigureInventoryFor(pack.law)) {
      const id = spec.id;
      const projected = FIGURE_PROJECTORS[id](args.outputs);
      const { rules, unknownRuleIds, caveated, effectiveState } = resolveRuleTrace(
        spec,
        declared,
      );

      const contributingFacts: ContributingLedgerFact[] = [];
      const unresolvedSourceTags: string[] = [];
      const seen = new Set<string>();
      for (const tag of projected.sources ?? []) {
        let resolved = false;
        for (const fact of facts) {
          if (!tag.endsWith(`:${fact.identifier}`)) continue;
          resolved = true;
          if (seen.has(fact.ledgerId)) continue;
          seen.add(fact.ledgerId);
          contributingFacts.push(
            Object.freeze({
              ledgerId: fact.ledgerId,
              ledgerKind: fact.ledgerKind,
              sourceType: fact.sourceType,
              documentLabel: fact.documentLabel,
              resolvedBy: fact.identifier === fact.ledgerId ? "ledger_row" : "document",
              promotedProposal:
                taxCaseId === null
                  ? null
                  : resolvePromotedProposalLineage(
                      { ledgerKind: fact.ledgerKind, ledgerId: fact.ledgerId, sourceDocumentId: fact.sourceDocumentId },
                      taxCaseId,
                      promotedProposals,
                    ),
            }),
          );
        }
        if (!resolved && !unresolvedSourceTags.includes(tag)) unresolvedSourceTags.push(tag);
      }

      lines.push(
        Object.freeze({
          id,
          label: spec.label,
          kind: spec.kind,
          authoredState: spec.state,
          state: effectiveState,
          format: spec.format,
          value: projected.value,
          limitation: spec.limitation,
          implementationCaveat: surchargeDependencyCaveatFor(id),
          rules,
          unknownRuleIds,
          // A number is unverified when any rule behind it carries an unresolved
          // caveat OR the governing pack is not CA-verified. Derived, never declared.
          rulesUnverified: caveated || !pack.verified,
          contributingFacts: Object.freeze(contributingFacts),
          unresolvedSourceTags: Object.freeze(unresolvedSourceTags),
        }),
      );
    }
  }

  return Object.freeze({
    outcome: "traced",
    pack,
    relianceBlocker: governing.relianceBlocker,
    completeness,
    lines: Object.freeze(lines),
  });
}

/**
 * The one-line caption a screen may print about the pack governing a case. Always
 * names the pack version AND its verification state, so a version string can
 * never appear on its own and read as an endorsement.
 */
export function packCaptionText(pack: GoverningPackState): string {
  return pack.verified
    ? `tax pack ${pack.computationRulesVersion} · CA-verified`
    : `tax pack ${pack.computationRulesVersion} · ${pack.status} — not CA-verified`;
}
