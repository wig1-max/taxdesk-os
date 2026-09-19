/**
 * TaxDesk OS — Versioned Tax Pack: the DEFAULT registry factory (Wave 1).
 *
 * PURE TYPESCRIPT ONLY (see identity.ts for the boundary rules).
 *
 * Extracted from `index.ts` in K3-12 so `case-pack.ts` (the per-case resolution
 * authority) can compose the shipped registry without importing the public
 * barrel — which would create an import cycle. `index.ts` re-exports this, so
 * the public entry point is unchanged.
 */

import { createTaxPackRegistry, type TaxPackRegistry } from "./registry";
import { AY_2026_27_PACK } from "./packs/ay-2026-27";
import { AY_2026_27_V0_PACK } from "./packs/ay-2026-27-v0";
import { TY_2026_27_STUB_PACK } from "./packs/ty-2026-27";

/**
 * Build a registry pre-loaded with the packs TaxDesk OS ships today. A factory (not
 * a shared singleton) so tests and callers each get an isolated, deterministic
 * registry.
 *
 * Three packs across two statutory worlds (K3-15, K4-17):
 *  - **AY 2026-27 V0 / Income-tax Act, 1961** — `draft`, IDENTITY-ONLY. The
 *    pre-K4-17 rules coordinate (`AY_2026_27_V0_PREP_ONLY`) is still resolvable
 *    so historical snapshots remain identifiable and the freshness check stays
 *    honest, but there is NO in-tree computation binding: the frozen engine was
 *    removed (`D277`) and is recoverable at git tag `tax-pack-AY-2026-27-V0`
 *    (`b2a7406`). Legacy DB snapshots are stored-output evidence, not
 *    replay-complete inputs (see the pack comment).
 *  - **AY 2026-27 V1 / Income-tax Act, 1961** — `draft`, bound to the current
 *    deterministic engine. Live case binding explicitly selects this version.
 *  - **TY 2026-27 / Income-tax Act, 2025** — `draft`, IDENTITY-ONLY. No
 *    computation binding, no rules, no return-form logic. It exists so the second
 *    statutory world is a modelled, explicitly-unimplemented fact instead of an
 *    absence, and it refuses through the existing paths (`unbound` for binding,
 *    `unverified` for reliance).
 *
 * The statutory worlds differ in BOTH `law` and `periodKind`; V0/V1 differ in
 * their immutable rules coordinate. A version-pinned selector reaches exactly
 * one AY pack and neither statutory world can shadow the other (proved in
 * `__tests__/parallel-worlds.test.ts`).
 */
export function createDefaultTaxPackRegistry(): TaxPackRegistry {
  const registry = createTaxPackRegistry();
  registry.register(AY_2026_27_V0_PACK);
  registry.register(AY_2026_27_PACK);
  registry.register(TY_2026_27_STUB_PACK);
  return registry;
}
