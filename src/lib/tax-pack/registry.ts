/**
 * TaxDesk OS — Versioned Tax Pack: in-memory REGISTRY (Wave 1, K3-10).
 *
 * PURE TYPESCRIPT ONLY (see identity.ts for the boundary rules).
 *
 * A registry holds registered packs keyed by their canonical coordinate key.
 * Registered identities are immutable: registering a second pack with the same
 * coordinates is refused, and `list()`/`get()` return the frozen packs. The
 * registry keeps insertion order so resolution (and its ambiguity reporting) is
 * deterministic.
 */

import { formatTaxPackKey, type TaxPackCoordinates } from "./identity";
import type { TaxPack } from "./pack";

export interface TaxPackRegistry {
  /**
   * Register a pack. Throws if a pack with the same coordinates is already
   * registered (identities are immutable — replace by constructing a new
   * coordinate, never by re-registering the same key).
   */
  register(pack: TaxPack): void;
  /** Get a pack by its coordinates (or key), or undefined if absent. */
  get(coordsOrKey: TaxPackCoordinates | string): TaxPack | undefined;
  /** True when a pack with these coordinates is registered. */
  has(coordsOrKey: TaxPackCoordinates | string): boolean;
  /** All registered packs, in registration order. */
  list(): readonly TaxPack[];
}

function toKey(coordsOrKey: TaxPackCoordinates | string): string {
  return typeof coordsOrKey === "string" ? coordsOrKey : formatTaxPackKey(coordsOrKey);
}

/** Create a fresh, empty registry. */
export function createTaxPackRegistry(): TaxPackRegistry {
  // Map preserves insertion order → deterministic list()/resolution.
  const packs = new Map<string, TaxPack>();

  return {
    register(pack: TaxPack): void {
      const key = formatTaxPackKey(pack.identity);
      if (packs.has(key)) {
        throw new Error(`Tax pack already registered: ${key}`);
      }
      packs.set(key, pack);
    },
    get(coordsOrKey: TaxPackCoordinates | string): TaxPack | undefined {
      return packs.get(toKey(coordsOrKey));
    },
    has(coordsOrKey: TaxPackCoordinates | string): boolean {
      return packs.has(toKey(coordsOrKey));
    },
    list(): readonly TaxPack[] {
      return Object.freeze([...packs.values()]);
    },
  };
}
