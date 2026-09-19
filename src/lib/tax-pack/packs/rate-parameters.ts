/**
 * TaxDesk OS — builders that bind a statutory rate parameter to the PACK'S OWN
 * declared provenance (`K4-PORT-02`, decision `D299`).
 *
 * PURE TYPESCRIPT ONLY.
 *
 * WHY THESE EXIST RATHER THAN HAND-WRITTEN LITERALS. A parameter that says
 * "authorised by s.202(1)" while the pack's provenance says something else is a
 * second, divergent authority for the same concept — exactly what
 * `PROJECT_CONSTITUTION.md` §3 ("one authority per concept") forbids. So a
 * parameter never states its own source ids: it names the pack rule group(s) it
 * comes from, and the source ids are READ OUT of that pack's provenance.
 *
 * Both builders THROW on an unknown rule id. That is deliberate and is the
 * cheap half of the guarantee: renaming or dropping a provenance rule breaks
 * the parameter set loudly at module load, instead of leaving a parameter
 * quietly citing a rule that no longer exists.
 *
 * ---------------------------------------------------------------------------
 * THE TWO EXCEPTIONS, BOTH OPT-IN AND BOTH NAMED
 * ---------------------------------------------------------------------------
 * The default rule is simple: a supplied figure cites a source, and a withheld
 * figure does not. Reality departs from that in two specific ways, and each
 * departure must be stated at the call site rather than assumed.
 *
 * **`allowUncited` — a figure this engine COMPUTES that cites no source.**
 * `K4-PORT-02` found, by applying this contract to the working 1961-Act world,
 * that the AY 2026-27 pack cites **no official source at all** for `cess_rate`
 * or `itr1_income_ceiling`, while the engine computes both — the 4% cess is
 * applied to every case and the ceiling drives every ITR-form recommendation.
 * That gap is PRE-EXISTING and truthfully recorded in that pack's own
 * provenance ("the engine documents the rate but names no statutory source");
 * this boundary did not create it, it made it legible. Marking such a figure
 * `withheld` would be worse, not better — it would stop the live engine dead
 * over a citation gap rather than a computation gap. So it is supplied, with
 * an EMPTY `sourceIds`, which `uncitedAvailableParameterIds` can enumerate.
 *
 * **`allowSourcedRules` — a figure that IS cited and is still withheld.**
 * See `withheldBecause`.
 */

import type {
  RateParameterId,
  StatutoryRateParameter,
  StatutoryRateParameters,
} from "@/lib/tax-engine/core/statutory-rate-parameters";
import {
  RATE_PARAMETER_IDS,
  rateParameter,
} from "@/lib/tax-engine/core/statutory-rate-parameters";
import { findRuleProvenance, type TaxPackProvenance } from "../provenance";

function resolveRules(
  provenance: TaxPackProvenance,
  packRuleIds: readonly string[],
  parameterId: RateParameterId,
) {
  if (packRuleIds.length === 0) {
    throw new Error(
      `rate parameter ${parameterId}: at least one pack rule id must be named — a parameter with no provenance rule has no stated authority`,
    );
  }
  return packRuleIds.map((ruleId) => {
    const rule = findRuleProvenance(provenance, ruleId);
    if (!rule) {
      throw new Error(
        `rate parameter ${parameterId}: pack provenance declares no rule "${ruleId}"`,
      );
    }
    return rule;
  });
}

/**
 * A parameter this world DOES supply. `value` must be the governing module's
 * own object passed BY REFERENCE — never a retyped copy — so the parameter and
 * the constant can never drift apart.
 */
export function availableFrom<T>(
  provenance: TaxPackProvenance,
  parameterId: RateParameterId,
  packRuleIds: readonly string[],
  value: T,
  options: { readonly allowUncited?: boolean } = {},
): StatutoryRateParameter<T> {
  const rules = resolveRules(provenance, packRuleIds, parameterId);
  const sourceIds = [...new Set(rules.flatMap((rule) => rule.sources.map((s) => s.id)))];
  if (sourceIds.length === 0 && options.allowUncited !== true) {
    throw new Error(
      `rate parameter ${parameterId}: rule(s) ${packRuleIds.join(", ")} cite no official source; ` +
        `supplying an uncited figure needs the explicit allowUncited exception`,
    );
  }
  // K4-SOURCE-02: and the exception must still be NEEDED. An `allowUncited`
  // left behind after its rule gains a citation is a false statement in code
  // that nothing would otherwise catch — the exception would sit there reading
  // "this figure rests on no source" about a figure that now does. Both of this
  // pack's original `allowUncited` call sites were retired this session when
  // `cess_rate` and `itr1_income_ceiling` were cited, which is exactly the
  // moment such a flag would have gone stale.
  if (sourceIds.length > 0 && options.allowUncited === true) {
    throw new Error(
      `rate parameter ${parameterId}: rule(s) ${packRuleIds.join(", ")} DO cite an official source, ` +
        `so the allowUncited exception is stale and must be removed`,
    );
  }
  return Object.freeze({
    state: "available" as const,
    value,
    packRuleIds: Object.freeze([...packRuleIds]),
    sourceIds: Object.freeze(sourceIds),
  });
}

/**
 * A parameter this world does NOT supply.
 *
 * `allowSourcedRules` is the narrow exception: a rule group may cite a source
 * and still be withheld when the CITED text is not by itself sufficient
 * authority for the period being computed. The only such case today is the TY
 * 2026-27 new-regime slab table — the rates ARE printed in ITA 2025 s.202(1),
 * but s.4(1) charges income-tax at rates set by "any Central Act", so whether
 * s.202(1) alone fixes the tax year 2026-27 rates without the Finance Act, 2026
 * is a TAX QUESTION, and `PROJECT_CONSTITUTION.md` §2 rule 5 puts that outside
 * a session's authority. Withholding is the safe answer to a question a session
 * may not decide. Passing this flag REQUIRES stating that reasoning in `reason`.
 */
export function withheldBecause(
  provenance: TaxPackProvenance,
  parameterId: RateParameterId,
  packRuleIds: readonly string[],
  reason: string,
  options: { readonly allowSourcedRules?: boolean } = {},
): StatutoryRateParameter<never> {
  const rules = resolveRules(provenance, packRuleIds, parameterId);
  if (options.allowSourcedRules !== true) {
    const sourced = rules.filter((rule) => rule.sources.length > 0).map((rule) => rule.ruleId);
    if (sourced.length > 0) {
      throw new Error(
        `rate parameter ${parameterId}: rule(s) ${sourced.join(", ")} DO cite an official source; ` +
          `withholding a sourced figure needs the explicit allowSourcedRules exception and a reason that says why`,
      );
    }
  }
  if (reason.trim().length === 0) {
    throw new Error(`rate parameter ${parameterId}: a withheld parameter must state a reason`);
  }
  return Object.freeze({
    state: "withheld" as const,
    packRuleIds: Object.freeze([...packRuleIds]),
    reason,
  });
}

/**
 * The supplied parameters that rest on NO cited official source — the
 * `allowUncited` set, enumerated rather than buried at a call site.
 *
 * This is a visible honesty gap, not a defect of this module: these are figures
 * the engine computes today whose pack provenance names no statutory source.
 * A session closing one of them removes it from this list by CITING it, never
 * by suppressing the enumeration.
 */
export function uncitedAvailableParameterIds(
  parameters: StatutoryRateParameters,
): readonly RateParameterId[] {
  return RATE_PARAMETER_IDS.filter((id) => {
    const parameter = rateParameter(parameters, id);
    return parameter.state === "available" && parameter.sourceIds.length === 0;
  });
}
