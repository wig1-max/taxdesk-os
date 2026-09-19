/**
 * TaxDesk OS — Versioned Tax Pack: PACK interface (Wave 1, K3-10/K3-11).
 *
 * PURE TYPESCRIPT ONLY (see identity.ts for the boundary rules). The only
 * imports here are `import type` declarations from the pure engine's type module
 * — no runtime engine code is pulled into the generic contracts.
 *
 * A registered pack exposes a stable identity (how it is resolved) and MAY carry
 * a computation binding. As of K3-11 the binding is CONCRETE: it names the bound
 * engine module AND exposes that engine's public preparation surface
 * (`computeTax` / `compareRegimes` / `recommendItrForm` / `validateCase`) so a
 * caller can compute *through a resolved pack identity* instead of importing an
 * engine directly.
 *
 * The binding is a pure indirection — a pack's functions ARE the engine's
 * functions, so pack-routed output is byte-identical to a direct engine call
 * (proved by `__tests__/pack-computation-golden.test.ts`). Binding a pack does
 * NOT make it relied-upon: reliance still requires a `ca_verified` pack
 * (`resolveTaxPackForReliance`), and the AY 2026-27 pack remains `draft`.
 */

import type { TaxPackIdentity } from "./identity";
import { taxPackKey } from "./identity";
import type { TaxPackProvenance } from "./provenance";
import type { StatutoryRateParameters } from "@/lib/tax-engine/core/statutory-rate-parameters";
import type {
  ItrFormRecommendation,
  RegimeComparison,
  TaxComputation,
  TaxEngineInput,
  ValidationResult,
} from "@/lib/tax-engine/ay-2026-27/types";

/**
 * The deterministic computation surface a bound pack serves. These are exactly
 * the engine's four public entry points; a pack never wraps, adapts, rounds, or
 * post-processes their results.
 */
export interface TaxPackComputation {
  /** Full computation (both regimes, refund/payable). */
  readonly computeTax: (input: TaxEngineInput) => TaxComputation;
  /** Old vs new regime side-by-side. */
  readonly compareRegimes: (input: TaxEngineInput) => RegimeComparison;
  /** ITR-form recommendation. */
  readonly recommendItrForm: (input: TaxEngineInput) => ItrFormRecommendation;
  /** Preparation-time validation findings / reconciliation. */
  readonly validateCase: (input: TaxEngineInput) => ValidationResult;
}

/** How a pack is wired to the deterministic engine that serves its computation. */
export interface TaxPackComputationBinding {
  /** The engine module this pack's computation is served by. */
  readonly boundEngineId: string;
  /**
   * The concrete engine surface (K3-11). Optional so a pack may be registered as
   * an identity-only stub (e.g. an unsupported/planned statutory world) without
   * pretending to compute.
   *
   * K4-PORT-02 (D299): a pack may now carry a binding WITHOUT this key — see
   * `rateParameters`. `"binding" in pack` therefore no longer implies the pack
   * can compute; `taxPackComputation(pack) !== undefined` is the only test that
   * does, and it is the one every caller and guard must use.
   */
  readonly computation?: TaxPackComputation;
  /**
   * The statutory rate parameters this pack supplies to the shared, Act-agnostic
   * core (K4-PORT-02, D299) — each figure either available with the provenance
   * that authorises it, or explicitly withheld with a reason.
   *
   * A world that withholds any parameter an entry point needs cannot serve that
   * entry point, so it carries no `computation` and `bindTaxPackToCase` refuses
   * — but the refusal can now name the missing statutory authority instead of
   * saying only that no binding exists.
   */
  readonly rateParameters?: StatutoryRateParameters;
}

/** The contract every registered pack satisfies. */
export interface TaxPack {
  /** Immutable identity — the pack's primary key and the basis for resolution. */
  readonly identity: TaxPackIdentity;
  /** Computation binding (see above). Absent for identity-only stubs. */
  readonly binding?: TaxPackComputationBinding;
  /**
   * Official-source provenance per rule (K3-13). Absent when a pack declares
   * none — which `verification.ts` reports as "not verifiable", never as "fine".
   */
  readonly provenance?: TaxPackProvenance;
}

/**
 * Build a frozen pack from a (already-validated, frozen) identity.
 *
 * An absent binding/provenance is OMITTED, never stored as a present-but-
 * `undefined` key: a pack with no binding at all (K3-15) must not answer `true`
 * to `"binding" in pack`.
 *
 * K4-PORT-02 (D299) adds ONE construction-time check: a binding's rate
 * parameters must name THIS pack. A parameter set silently attached to the
 * wrong statutory world would be the worst failure this boundary could have —
 * it would let one Act's rates price another Act's return — so the check fires
 * at module load, where it is impossible to miss, rather than in a test that
 * someone might not run.
 */
export function makeTaxPack(
  identity: TaxPackIdentity,
  binding?: TaxPackComputationBinding,
  provenance?: TaxPackProvenance,
): TaxPack {
  if (binding?.rateParameters !== undefined) {
    const expected = taxPackKey(identity);
    if (binding.rateParameters.packKey !== expected) {
      throw new Error(
        `tax pack ${expected}: rate parameters are declared for ${binding.rateParameters.packKey}; ` +
          `a parameter set may not be attached to a different statutory world`,
      );
    }
  }
  return Object.freeze({
    identity,
    ...(binding !== undefined ? { binding: Object.freeze({ ...binding }) } : {}),
    ...(provenance !== undefined ? { provenance } : {}),
  });
}

/**
 * The pack's computation surface, or `undefined` when the pack cannot compute.
 * Callers must handle `undefined` explicitly — there is no fallback engine and
 * no guessing.
 *
 * THIS, NOT `"binding" in pack`, IS THE TEST FOR "can this pack compute?"
 * (K4-PORT-02, D299). A pack may carry a binding that declares its statutory
 * rate parameters and still serve no computation, because those parameters
 * withhold what the engine would need.
 */
export function taxPackComputation(pack: TaxPack): TaxPackComputation | undefined {
  return pack.binding?.computation;
}

/**
 * The statutory rate parameters this pack supplies to the shared core, or
 * `undefined` when it declares none (K4-PORT-02, D299).
 */
export function taxPackRateParameters(pack: TaxPack): StatutoryRateParameters | undefined {
  return pack.binding?.rateParameters;
}

/**
 * The pack's official-source provenance, or `undefined` when it declares none.
 * A pack without provenance can never be evidence-verified (`verification.ts`).
 */
export function taxPackProvenance(pack: TaxPack): TaxPackProvenance | undefined {
  return pack.provenance;
}
