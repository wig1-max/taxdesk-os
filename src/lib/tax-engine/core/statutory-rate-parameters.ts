/**
 * TaxDesk OS — the SHARED, ACT-AGNOSTIC computation core: STATUTORY RATE
 * PARAMETERS (`K4-PORT-02`, decision `D299`).
 *
 * PURE TYPESCRIPT ONLY — no React/Next/Supabase/env/route imports, and
 * deliberately no import from any specific statutory world either. This module
 * knows the SHAPE of the figures an income-tax computation needs; it never
 * knows which Act supplies them.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS — the architectural decision this file implements (`D299`)
 * ---------------------------------------------------------------------------
 * `D297` decided to PORT the engine from the Income-tax Act, 1961 to the
 * Income-tax Act, 2025. The dominating design question was **a shared rule core
 * parameterised by pack, or a second independent engine.** `D299` chose the
 * shared core, and this module is its boundary.
 *
 * The decisive argument is NOT that the two Acts' rules are currently identical
 * (they are, per `k4-port-delta-assessment.md` §2 — A=26, B=1, C=0, D=0). It is
 * that **Wave-4 breadth is un-paused and sequenced behind the port** (`D297`),
 * so the 1961 engine keeps growing while the 2025 world is built. Under a
 * copied second engine every future breadth slice would have to be implemented
 * TWICE, and any divergence between the copies would be a silent wrong-number
 * risk in exactly the world the office files under for its first full season.
 * A copy is cheapest today and most expensive every session afterwards.
 *
 * **What is shared is ARITHMETIC, never a per-Act conditional.** There is no
 * `if (law === "ITA_2025")` anywhere in this design and none may be added: the
 * way slab tax is applied, the way cess compounds and the order of set-off are
 * Act-agnostic mechanics, while every FIGURE and its AVAILABILITY arrives as a
 * parameter from the governing pack. Where the two Acts genuinely diverge, that
 * is a different parameter — or an explicitly withheld one — not a branch.
 *
 * ---------------------------------------------------------------------------
 * WHY A PARAMETER CAN BE WITHHELD, AND WHY THAT IS THE POINT
 * ---------------------------------------------------------------------------
 * A second statutory world does not simply have different numbers; for tax year
 * 2026-27 it has **no numbers at all** for most of the rate chain. ITA 2025
 * s.4(1) charges income-tax at rates set by "any Central Act", so the rate
 * schedule for a tax year is a **Finance Act** matter — and the Finance Act,
 * 2026 is not held in this repository. Six rule groups in the TY 2026-27 pack
 * therefore cite NO source, deliberately (`D298`).
 *
 * Representing that as a first-class `withheld` state is what makes the refusal
 * STRUCTURAL rather than a matter of authoring care. A copied second engine
 * would have begun life by copying `NEW_REGIME_SLABS`, `SURCHARGE` and
 * `CESS_RATE` into a 2025 file — and that copy would have been a FABRICATION,
 * because those figures have no 2025 authority. The parameter boundary makes
 * "we do not hold this" a value the type system carries, so it cannot be
 * forgotten.
 *
 * ---------------------------------------------------------------------------
 * ALL-OR-NOTHING, DELIBERATELY
 * ---------------------------------------------------------------------------
 * `TaxPackComputation` is a FOUR-function surface. A pack binds an executable
 * surface only when EVERY entry point is servable — see `EngineCapability`
 * `complete`. Handing back three of four would let a caller destructure the
 * fourth and invoke it, which is precisely the accident the whole tax-pack
 * refusal architecture exists to prevent.
 *
 * This module computes CAPABILITY. It performs no tax arithmetic, holds no
 * figure of its own, and decides no tax question (`PROJECT_CONSTITUTION.md`
 * §2 rule 5).
 */

// ---------------------------------------------------------------------------
// Parameter identifiers
// ---------------------------------------------------------------------------

/**
 * The rate-bearing figures an income-tax computation cannot proceed without.
 *
 * These are exactly the figures whose authority is statutory-world-specific —
 * the ones a second world can neither inherit nor infer. Deliberately NOT a
 * catalogue of every engine constant: the head-level computation rules (house
 * property, presumptive, books) carry over as arithmetic and are the subject of
 * the later increments of this slice, not of this boundary.
 */
export const RATE_PARAMETER_IDS = [
  "new_regime_slabs",
  "old_regime_slabs",
  "surcharge",
  "cess",
  "rebate",
  "itr_form_income_ceiling",
] as const;

export type RateParameterId = (typeof RATE_PARAMETER_IDS)[number];

// ---------------------------------------------------------------------------
// Parameter value shapes
//
// Structural shapes the existing engine constants already satisfy. They are
// declared here rather than imported from `ay-2026-27/slabs.ts` so the core
// does not depend on one Act's module — but the AY parameter set supplies the
// engine's OWN objects BY REFERENCE, and a test asserts that identity, so no
// number is ever retyped (the `D6` single-source-of-truth convention).
// ---------------------------------------------------------------------------

/** One slab band. `to` is inclusive; `Infinity` for the top band. */
export interface SlabBandShape {
  readonly from: number;
  readonly to: number;
  readonly rate: number;
}

/**
 * The old-regime slab family. Age-banded because the 1961-Act old regime
 * widens the basic exemption for a resident senior / super-senior; a world
 * whose Act carries no such widening withholds the whole family rather than
 * supplying a partial one.
 */
export interface OldRegimeSlabTables {
  readonly below60: readonly SlabBandShape[];
  readonly senior: readonly SlabBandShape[];
  readonly superSenior: readonly SlabBandShape[];
}

export interface SurchargeBandShape {
  /** Surcharge applies only where total income EXCEEDS this (strict `>`). */
  readonly exceeding: number;
  readonly upTo: number;
  readonly rate: number;
}

export interface SurchargeSchedule {
  readonly bands: readonly SurchargeBandShape[];
  readonly entryThreshold: number;
  readonly supportedTotalIncomeCeiling: number;
  /**
   * The cap the statute puts on the surcharge rate borne by dividend / 111A /
   * 112 / 112A income.
   *
   * `K4-PORT-03` ADDED THIS FIELD, and it is worth saying why rather than
   * leaving it to look like an oversight being tidied. `K4-PORT-02` declared
   * this shape from the outside — reading what an income-tax computation
   * conceptually needs — while the arithmetic still imported the AY world's
   * `SURCHARGE` object directly and so could reach every field on it. Slice 2
   * is the session that makes the arithmetic read the shape instead, and the
   * first thing that does is prove the shape was one field short: `surcharge.ts`
   * refuses outright when the applicable band rate exceeds this cap, because
   * above it income-tax would have to be apportioned between the capped and
   * uncapped parts and that is not modelled. A schedule that cannot express the
   * cap cannot express that refusal, and a refusal that cannot be expressed is a
   * figure that gets computed anyway.
   *
   * It is a statutory rate like every other member here, so it belongs to the
   * world that supplies it, never to the shared arithmetic.
   */
  readonly specialRateSurchargeRateCap: number;
}

export interface RebateLimb {
  readonly incomeLimit: number;
  readonly maxRebate: number;
  readonly marginalReliefAvailable: boolean;
}

export interface RebateSchedule {
  readonly new: RebateLimb;
  readonly old: RebateLimb;
}

// ---------------------------------------------------------------------------
// The parameter wrapper
// ---------------------------------------------------------------------------

/**
 * A single statutory rate parameter: either supplied with the authority that
 * backs it, or explicitly WITHHELD with a truthful reason.
 *
 * `withheld` (not "missing" / "unavailable") is the repository's existing word
 * for a fact deliberately kept out of a computation — see the `tax-lab`
 * `WithheldFact` vocabulary (`K3-21`, `D21`). It means "we will not supply
 * this", never "we forgot".
 */
export type StatutoryRateParameter<T> =
  | {
      readonly state: "available";
      readonly value: T;
      /** The pack provenance rule group(s) that authorise this figure. */
      readonly packRuleIds: readonly string[];
      /** The official-source ids those rule groups cite. */
      readonly sourceIds: readonly string[];
    }
  | {
      readonly state: "withheld";
      /** The pack provenance rule group(s) this figure would have come from. */
      readonly packRuleIds: readonly string[];
      /** Truthful, non-guessing reason — safe to surface in a refusal. */
      readonly reason: string;
    };

/**
 * Everything one statutory world supplies to the shared core.
 *
 * `packKey` is the canonical pack key these parameters were declared for, so a
 * parameter set can never be silently attached to the wrong world.
 */
export interface StatutoryRateParameters {
  /** The arithmetic core these parameters feed. */
  readonly engineId: string;
  /** The canonical pack key (`jurisdiction:law:periodKind:period:version`). */
  readonly packKey: string;
  readonly newRegimeSlabs: StatutoryRateParameter<readonly SlabBandShape[]>;
  readonly oldRegimeSlabs: StatutoryRateParameter<OldRegimeSlabTables>;
  readonly surcharge: StatutoryRateParameter<SurchargeSchedule>;
  readonly cess: StatutoryRateParameter<number>;
  readonly rebate: StatutoryRateParameter<RebateSchedule>;
  readonly itrFormIncomeCeiling: StatutoryRateParameter<number>;
}

/**
 * The parameter carried under an id. Exhaustive by construction — adding a
 * member to `RATE_PARAMETER_IDS` without adding its field fails to compile.
 */
export function rateParameter(
  parameters: StatutoryRateParameters,
  id: RateParameterId,
): StatutoryRateParameter<unknown> {
  switch (id) {
    case "new_regime_slabs":
      return parameters.newRegimeSlabs;
    case "old_regime_slabs":
      return parameters.oldRegimeSlabs;
    case "surcharge":
      return parameters.surcharge;
    case "cess":
      return parameters.cess;
    case "rebate":
      return parameters.rebate;
    case "itr_form_income_ceiling":
      return parameters.itrFormIncomeCeiling;
  }
}

// ---------------------------------------------------------------------------
// Entry-point capability
// ---------------------------------------------------------------------------

/** The engine's four public entry points — exactly `TaxPackComputation`'s keys. */
export const ENGINE_ENTRY_POINTS = [
  "computeTax",
  "compareRegimes",
  "recommendItrForm",
  "validateCase",
] as const;

export type EngineEntryPoint = (typeof ENGINE_ENTRY_POINTS)[number];

/**
 * What each entry point needs before it can produce a number.
 *
 * `validateCase`, `compareRegimes` AND `recommendItrForm` all require the FULL
 * computation set, because all three reach `computeTax` — `validate-case.ts`
 * imports it directly, `compare-regimes.ts` runs it per regime, and
 * `recommend-itr-form.ts` calls it to obtain the total income its ceiling test
 * compares against. That is not an assumption: a structural test reads all
 * three modules and fails if any stops importing `compute-tax`, so this table
 * cannot quietly become a lie.
 *
 * **`recommendItrForm`'S ROW WAS WRONG UNTIL `K4-PORT-03`, and the correction
 * is recorded rather than made silently (`PROJECT_CONSTITUTION.md` §4).**
 * `K4-PORT-02` declared it as `["itr_form_income_ceiling"]` alone, reasoning
 * that the entry point selects a form and does not price anything. The reasoning
 * is sound about what the function is FOR and wrong about what it DOES: it calls
 * `computeTax(input)` at `recommend-itr-form.ts` and reads
 * `computation.totalIncome.value`, so a world supplying the ceiling and nothing
 * else would have been reported able to serve an entry point that cannot run.
 *
 * **The error was latent, not live, and this is the load-bearing detail**: the
 * only world that withholds anything — TY 2026-27 — also withholds the ceiling,
 * so `recommendItrForm` was unservable there under the old row and is unservable
 * under the new one. `servableEntryPoints` is unchanged for BOTH shipped worlds
 * and no computed figure moves. It was invisible because the structural test
 * that keeps this table honest scanned `compare-regimes.ts` and
 * `validate-case.ts` and not `recommend-itr-form.ts` — a guard checking a proxy
 * for the property it claims, the `AUDIT-11` class exactly. The scan is now
 * derived from this table rather than from a hand-written pair.
 */
const COMPUTATION_PARAMETERS: readonly RateParameterId[] = [
  "new_regime_slabs",
  "old_regime_slabs",
  "surcharge",
  "cess",
  "rebate",
];

const ITR_FORM_PARAMETERS: readonly RateParameterId[] = [
  ...COMPUTATION_PARAMETERS,
  "itr_form_income_ceiling",
];

export const ENTRY_POINT_REQUIREMENTS: Readonly<
  Record<EngineEntryPoint, readonly RateParameterId[]>
> = Object.freeze({
  computeTax: COMPUTATION_PARAMETERS,
  compareRegimes: COMPUTATION_PARAMETERS,
  recommendItrForm: ITR_FORM_PARAMETERS,
  validateCase: COMPUTATION_PARAMETERS,
});

export interface WithheldParameter {
  readonly id: RateParameterId;
  readonly packRuleIds: readonly string[];
  readonly reason: string;
}

export interface EntryPointCapability {
  readonly entryPoint: EngineEntryPoint;
  readonly servable: boolean;
  /** Empty exactly when `servable` is true. */
  readonly withheld: readonly WithheldParameter[];
}

export interface EngineCapability {
  readonly engineId: string;
  readonly packKey: string;
  readonly entryPoints: readonly EntryPointCapability[];
  readonly servableEntryPoints: readonly EngineEntryPoint[];
  /** Every withheld parameter, in `RATE_PARAMETER_IDS` order. */
  readonly withheld: readonly WithheldParameter[];
  /**
   * True only when EVERY entry point is servable. A pack may bind an executable
   * computation surface only on `true` — see the all-or-nothing note above.
   */
  readonly complete: boolean;
}

/**
 * Derive what a statutory world can actually serve from what it supplies.
 *
 * Pure and total. The capability is DERIVED, never declared: a pack cannot
 * claim to compute something its own parameters do not support, which is the
 * property that makes the second world's refusal structural.
 */
export function resolveEngineCapability(
  parameters: StatutoryRateParameters,
): EngineCapability {
  const withheld: WithheldParameter[] = [];
  for (const id of RATE_PARAMETER_IDS) {
    const parameter = rateParameter(parameters, id);
    if (parameter.state === "withheld") {
      withheld.push({ id, packRuleIds: parameter.packRuleIds, reason: parameter.reason });
    }
  }
  const withheldById = new Map(withheld.map((w) => [w.id, w]));

  const entryPoints: EntryPointCapability[] = ENGINE_ENTRY_POINTS.map((entryPoint) => {
    const missing = ENTRY_POINT_REQUIREMENTS[entryPoint]
      .map((id) => withheldById.get(id))
      .filter((w): w is WithheldParameter => w !== undefined);
    return { entryPoint, servable: missing.length === 0, withheld: missing };
  });

  const servableEntryPoints = entryPoints.filter((e) => e.servable).map((e) => e.entryPoint);

  return {
    engineId: parameters.engineId,
    packKey: parameters.packKey,
    entryPoints,
    servableEntryPoints,
    withheld,
    complete: servableEntryPoints.length === ENGINE_ENTRY_POINTS.length,
  };
}

// ---------------------------------------------------------------------------
// Resolved figures — the boundary the ARITHMETIC actually reads (`K4-PORT-03`)
//
// `K4-PORT-02` shipped everything above: the parameters, their availability,
// and the capability derived from them. What it deliberately did NOT do is make
// the arithmetic read any of it — the engine still imported `NEW_REGIME_SLABS`,
// `SURCHARGE`, `CESS_RATE` and `REBATE_87A` as module constants, so the
// boundary described the world without governing it. Slice 2 closes that, and
// these two resolvers are the join: a parameter set goes in, and either the
// figures the arithmetic needs come out, or the withheld parameters that stop
// it do.
//
// A resolver NEVER partially resolves. Handing back four of five figures would
// let a caller destructure the fifth and compute with `undefined`, which is the
// all-or-nothing accident the whole refusal architecture exists to prevent —
// stated for the four-function surface above, and true one level down for the
// figures too.
// ---------------------------------------------------------------------------

/** The five figures the tax computation itself cannot proceed without. */
export interface ComputationRateFigures {
  readonly newRegimeSlabs: readonly SlabBandShape[];
  readonly oldRegimeSlabs: OldRegimeSlabTables;
  readonly surcharge: SurchargeSchedule;
  readonly cess: number;
  readonly rebate: RebateSchedule;
}

/**
 * What `recommendItrForm` needs: the computation set (it calls `computeTax` for
 * the total income it tests) PLUS the return-form ceiling it tests against.
 */
export interface ItrFormRateFigures extends ComputationRateFigures {
  readonly itrFormIncomeCeiling: number;
}

export type RateFigureResolution<T> =
  | { readonly state: "resolved"; readonly figures: T }
  | { readonly state: "withheld"; readonly withheld: readonly WithheldParameter[] };

/**
 * The withheld members of a required set, in `RATE_PARAMETER_IDS` order.
 *
 * Read from `ENTRY_POINT_REQUIREMENTS` rather than from a second hand-written
 * list, so a resolver and `resolveEngineCapability` can never disagree about
 * what an entry point needs — the same one-authority-per-concept rule
 * `PROJECT_CONSTITUTION.md` §3 applies to eligibility and document state.
 */
function withheldForEntryPoint(
  parameters: StatutoryRateParameters,
  entryPoint: EngineEntryPoint,
): readonly WithheldParameter[] {
  const required = new Set(ENTRY_POINT_REQUIREMENTS[entryPoint]);
  const withheld: WithheldParameter[] = [];
  for (const id of RATE_PARAMETER_IDS) {
    if (!required.has(id)) continue;
    const parameter = rateParameter(parameters, id);
    if (parameter.state === "withheld") {
      withheld.push({ id, packRuleIds: parameter.packRuleIds, reason: parameter.reason });
    }
  }
  return withheld;
}

/**
 * Resolve the figures `computeTax` / `compareRegimes` / `validateCase` need.
 *
 * The casts below are the one unavoidable seam in this module. `rateParameter`
 * is deliberately typed `StatutoryRateParameter<unknown>` so the id→field map
 * can be exhaustive over a union of differently-typed parameters; the fields
 * are read back here from `StatutoryRateParameters`, whose per-field types ARE
 * precise, so nothing is being asserted that the interface does not already
 * state. Every read is guarded by the `withheld.length === 0` check above it.
 */
export function resolveComputationRateFigures(
  parameters: StatutoryRateParameters,
): RateFigureResolution<ComputationRateFigures> {
  const withheld = withheldForEntryPoint(parameters, "computeTax");
  if (withheld.length > 0) return { state: "withheld", withheld };
  return {
    state: "resolved",
    figures: {
      newRegimeSlabs: (parameters.newRegimeSlabs as { value: readonly SlabBandShape[] }).value,
      oldRegimeSlabs: (parameters.oldRegimeSlabs as { value: OldRegimeSlabTables }).value,
      surcharge: (parameters.surcharge as { value: SurchargeSchedule }).value,
      cess: (parameters.cess as { value: number }).value,
      rebate: (parameters.rebate as { value: RebateSchedule }).value,
    },
  };
}

/** Resolve the figures `recommendItrForm` needs — the computation set plus the ceiling. */
export function resolveItrFormRateFigures(
  parameters: StatutoryRateParameters,
): RateFigureResolution<ItrFormRateFigures> {
  const withheld = withheldForEntryPoint(parameters, "recommendItrForm");
  if (withheld.length > 0) return { state: "withheld", withheld };
  const computation = resolveComputationRateFigures(parameters);
  /* c8 ignore next -- unreachable: recommendItrForm's requirement set is a superset of computeTax's */
  if (computation.state !== "resolved") return computation;
  return {
    state: "resolved",
    figures: {
      ...computation.figures,
      itrFormIncomeCeiling: (parameters.itrFormIncomeCeiling as { value: number }).value,
    },
  };
}

/**
 * A one-line, human-readable statement of why a world cannot compute — used as
 * the binding refusal reason, so a preparer is told WHICH statutory authority
 * is missing rather than the blunt "no computation binding".
 *
 * Returns `null` when nothing is withheld.
 */
export function describeWithheldParameters(capability: EngineCapability): string | null {
  if (capability.withheld.length === 0) return null;
  const items = capability.withheld.map((w) => `${w.id} (${w.reason})`).join("; ");
  return `${capability.packKey} withholds ${capability.withheld.length} statutory rate parameter(s): ${items}`;
}
