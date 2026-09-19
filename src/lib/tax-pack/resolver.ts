/**
 * TaxDesk OS — Versioned Tax Pack: deterministic RESOLVER (Wave 1, K3-10).
 *
 * PURE TYPESCRIPT ONLY (see identity.ts for the boundary rules).
 *
 * Given a case's statutory selector `(law, periodKind, period)` — plus an
 * optional `computationRulesVersion` to pin an exact historical pack — the
 * resolver returns EXACTLY one typed outcome:
 *   - `resolved`     — a single matching pack;
 *   - `unsupported`  — no matching pack (safe: no guess, no throw-through);
 *   - `ambiguous`    — more than one matching pack (a registration error to fix).
 *
 * Resolution is pure and deterministic: it filters the registry's registration-
 * ordered list and reports candidates in that stable order. Reliance
 * (`resolveTaxPackForReliance`) additionally enforces the lifecycle rule that a
 * pack must be `ca_verified` before it may be relied upon — otherwise it returns
 * an explicit safe refusal, never a fallback to a `draft`/`retired` pack.
 *
 * Nothing in production consumes this resolver yet (K3-11 wires the engine).
 */

import {
  type Jurisdiction,
  type PeriodKind,
  type TaxLaw,
  type TaxPackIdentity,
} from "./identity";
import { isRelianceReady } from "./lifecycle";
import type { TaxPack } from "./pack";
import type { TaxPackRegistry } from "./registry";

/** The statutory coordinates a case resolves against. */
export interface TaxPackSelector {
  /** Defaults to "IN" when omitted. */
  jurisdiction?: Jurisdiction;
  law: TaxLaw;
  periodKind: PeriodKind;
  period: string;
  /** Optional exact pin — resolve a specific historical rules version. */
  computationRulesVersion?: string;
}

export type TaxPackResolution =
  | { outcome: "resolved"; pack: TaxPack }
  | { outcome: "unsupported"; selector: TaxPackSelector; reason: string }
  | { outcome: "ambiguous"; selector: TaxPackSelector; candidates: readonly TaxPackIdentity[] };

function matches(identity: TaxPackIdentity, selector: TaxPackSelector): boolean {
  const jurisdiction = selector.jurisdiction ?? "IN";
  if (identity.jurisdiction !== jurisdiction) return false;
  if (identity.law !== selector.law) return false;
  if (identity.periodKind !== selector.periodKind) return false;
  if (identity.period !== selector.period) return false;
  if (
    selector.computationRulesVersion !== undefined &&
    identity.computationRulesVersion !== selector.computationRulesVersion
  ) {
    return false;
  }
  return true;
}

/**
 * Resolve a selector to exactly one pack, or a typed unsupported/ambiguous
 * result. Pure + deterministic — depends only on the registry contents and the
 * selector, and preserves registration order in the ambiguous candidate list.
 */
export function resolveTaxPack(
  registry: TaxPackRegistry,
  selector: TaxPackSelector,
): TaxPackResolution {
  const candidates = registry.list().filter((p) => matches(p.identity, selector));
  const [first, second] = candidates;
  if (first === undefined) {
    return {
      outcome: "unsupported",
      selector,
      reason: `No tax pack supports ${selector.law} ${selector.periodKind} ${selector.period}`,
    };
  }
  if (second !== undefined) {
    return {
      outcome: "ambiguous",
      selector,
      candidates: Object.freeze(candidates.map((p) => p.identity)),
    };
  }
  return { outcome: "resolved", pack: first };
}

export type TaxPackReliance =
  | { outcome: "usable"; pack: TaxPack }
  | {
      outcome: "refused";
      /** Why reliance was refused — for a truthful, non-guessing blocker. */
      reason: string;
      /** How the underlying resolution turned out (for surfacing context). */
      resolution: "unsupported" | "ambiguous" | "unverified";
    };

/**
 * Resolve a pack for REAL-PREPARATION reliance. Refuses safely unless a single
 * matching pack exists AND it is `ca_verified`. An unsupported selector, an
 * ambiguous match, or a `draft`/`retired` match all yield an explicit refusal —
 * never a silent fallback and never a throw-through.
 */
export function resolveTaxPackForReliance(
  registry: TaxPackRegistry,
  selector: TaxPackSelector,
): TaxPackReliance {
  const resolution = resolveTaxPack(registry, selector);
  if (resolution.outcome === "unsupported") {
    return { outcome: "refused", reason: resolution.reason, resolution: "unsupported" };
  }
  if (resolution.outcome === "ambiguous") {
    return {
      outcome: "refused",
      reason: `Multiple tax packs match ${selector.law} ${selector.periodKind} ${selector.period}; resolution is ambiguous`,
      resolution: "ambiguous",
    };
  }
  if (!isRelianceReady(resolution.pack.identity)) {
    return {
      outcome: "refused",
      reason: `Tax pack ${resolution.pack.identity.computationRulesVersion} is ${resolution.pack.identity.status}, not ca_verified; cannot be relied upon for real preparation`,
      resolution: "unverified",
    };
  }
  return { outcome: "usable", pack: resolution.pack };
}
