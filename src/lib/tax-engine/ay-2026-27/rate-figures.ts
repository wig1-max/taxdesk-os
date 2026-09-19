/**
 * The AY 2026-27 / Income-tax Act, 1961 world's rate figures, in the shared
 * core's shape (`K4-PORT-03`, decision `D299`).
 *
 * PURE — no imports beyond this engine's own rules/slabs and the Act-agnostic
 * core's types.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS AT ALL, AND WHY IT IS NOT THE PACK'S PARAMETER SET
 * ---------------------------------------------------------------------------
 * Slice 2 makes the arithmetic RECEIVE its statutory figures instead of
 * importing them. The four public entry points still have to be callable as
 * `computeTax(input)` — they are bound BY REFERENCE into `TaxPackComputation`
 * (`K3-11`), and wrapping them would give up the property that computing
 * through the pack is byte-identical to calling the engine — so each takes its
 * figures as an OPTIONAL trailing argument defaulting to this world's set.
 *
 * That default cannot be the pack's own `AY_2026_27_RATE_PARAMETERS`: that
 * module lives in `src/lib/tax-pack/packs/` and already imports this engine, so
 * depending on it here would be a cycle. It is assembled here instead, from the
 * same constants, **by reference** — and
 * `src/lib/tax-pack/__tests__/rate-parameter-threading.test.ts` asserts member
 * by member (`toBe`, not `toEqual`) that resolving the pack's declared
 * parameters yields THESE OBJECTS. That assertion is the load-bearing join: it
 * is what makes "the pack governs the arithmetic" a checked fact rather than a
 * claim, and it is what would fail if this file ever became a second, drifting
 * copy of the rules (`D6`).
 *
 * ---------------------------------------------------------------------------
 * WHAT THE DEFAULT DOES AND DOES NOT MEAN
 * ---------------------------------------------------------------------------
 * A defaulted argument is a weaker form of parameterisation than a required
 * one, and that is stated rather than glossed. What it buys today: every
 * internal arithmetic function — `computeRegime`, `slabsForRegime`,
 * `computeSurcharge`, `computeRebate87A` — now takes its figures with NO
 * default, so nothing inside the engine can reach a statutory constant
 * implicitly. What it defers: binding a per-world computation surface, so a
 * second world's pack can hand these same functions ITS figures. That is slice
 * 3's work, and it needs the `D19` `law`/`period_kind` migration to have any
 * case to bind to.
 */

import type {
  ComputationRateFigures,
  ItrFormRateFigures,
} from "@/lib/tax-engine/core/statutory-rate-parameters";
import { CESS_RATE, ITR1_INCOME_CEILING, REBATE_87A, SURCHARGE } from "./rules";
import { AY_2026_27_OLD_REGIME_SLAB_TABLES, NEW_REGIME_SLABS } from "./slabs";

/**
 * The five figures the computation needs. Every member is the engine's OWN
 * object passed BY REFERENCE — no number is retyped and no table is copied.
 */
export const AY_2026_27_COMPUTATION_FIGURES: ComputationRateFigures = Object.freeze({
  newRegimeSlabs: NEW_REGIME_SLABS,
  oldRegimeSlabs: AY_2026_27_OLD_REGIME_SLAB_TABLES,
  surcharge: SURCHARGE,
  cess: CESS_RATE,
  rebate: REBATE_87A,
});

/**
 * What `recommendItrForm` needs: the computation set plus the return-form
 * ceiling. It is a SUPERSET because that entry point calls `computeTax` for the
 * total income its ceiling test compares against — see the correction recorded
 * on `ENTRY_POINT_REQUIREMENTS`.
 */
export const AY_2026_27_ITR_FORM_FIGURES: ItrFormRateFigures = Object.freeze({
  ...AY_2026_27_COMPUTATION_FIGURES,
  itrFormIncomeCeiling: ITR1_INCOME_CEILING,
});
