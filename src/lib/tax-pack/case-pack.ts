/**
 * TaxDesk OS — Versioned Tax Pack: the per-CASE resolution AUTHORITY
 * (Wave 1, K3-12).
 *
 * PURE TYPESCRIPT ONLY (see identity.ts for the boundary rules).
 *
 * THE single canonical way a tax case resolves the versioned pack that governs
 * it. Every writer that stamps a rules version onto stored evidence (computation
 * snapshots, the validation-run marker) and every freshness/readiness reader
 * that compares a stored version against "the supported version" consumes this
 * module — so the recorded version and the checked version can never be derived
 * by two divergent code paths ("one authority per concept", program §2).
 *
 * What it does NOT do: it never guesses. A case whose statutory coordinates
 * match no registered pack, match more than one, or match a pack with no
 * computation binding yields an explicit typed REFUSAL — never a fallback to the
 * engine, never a fabricated version string.
 *
 * Reliance vs binding: this resolver deliberately does NOT require
 * `ca_verified`. It answers *"which versioned pack describes this case's
 * computation?"* — which must work for the `draft` AY 2026-27 pack TaxDesk OS ships
 * today (the whole product runs on it in synthetic mode). The separate
 * `resolveTaxPackForReliance` remains the gate for REAL-preparation reliance and
 * still refuses every non-`ca_verified` pack (K3-13 supplies the evidence-backed
 * verification workflow). Binding is not authorisation.
 */

import type { Jurisdiction, PeriodKind, TaxLaw, TaxPackIdentity } from "./identity";
import { TAX_LAWS, taxPackKey } from "./identity";
import type { TaxPack, TaxPackComputation } from "./pack";
import { taxPackComputation, taxPackRateParameters } from "./pack";
import {
  describeWithheldParameters,
  resolveEngineCapability,
} from "@/lib/tax-engine/core/statutory-rate-parameters";
import type { TaxPackRegistry } from "./registry";
import { createDefaultTaxPackRegistry } from "./registry-default";
import { resolveTaxPack, type TaxPackSelector } from "./resolver";
import { RULES_VERSION } from "@/lib/tax-engine/ay-2026-27/rules";
import { AY_2026_27_PACK_IDENTITY } from "./packs/ay-2026-27";
import { TY_2026_27_PACK_IDENTITY } from "./packs/ty-2026-27";

/**
 * The statutory coordinates a tax case carries. `assessmentYear` is the
 * `tax_cases.assessment_year` column (the period string — '2026-27' in both
 * shipped worlds). `law` is now a stored column (`K4-PORT-05` / `D316`); it
 * still defaults to "ITA_1961" when omitted so every pre-migration caller
 * keeps its previous resolution.
 *
 * K3-15: the 2025 Act is a registered pack with no computation surface, so
 * passing `law: "ITA_2025"` reaches a real pack and refuses as `unbound`
 * rather than `unsupported`. `K4-PORT-05` made that reachable from a stored
 * row: `tax_cases.law` / `period_kind` / `tax_pack_key` exist, and production
 * callers that resolve a pack now pass the row's `law`. Binding is still not
 * computation — `bindTaxPackToCase` refuses `unbound` and no 2025-Act figure
 * is produced.
 */
export interface TaxCaseStatutoryContext {
  /** The case's statutory period, e.g. "2026-27". */
  assessmentYear: string;
  /** Defaults to "ITA_1961". */
  law?: TaxLaw;
  /** Defaults to "IN". */
  jurisdiction?: Jurisdiction;
  /** Optional exact pin — resolve a specific historical rules version. */
  computationRulesVersion?: string;
}

/**
 * Period-counting model per statutory basis. The 1961 Act counts assessment
 * years; the 2025 Act counts tax years. Declared once here so no caller has to
 * know the mapping.
 */
export function periodKindForLaw(law: TaxLaw): PeriodKind {
  return law === "ITA_2025" ? "tax_year" : "assessment_year";
}

/**
 * Build the per-case statutory context from a stored row. `law` is optional
 * so a caller that has not yet selected the new column still resolves as
 * ITA_1961. An unrecognised value is passed through — `bindTaxPackToCase`
 * refuses it rather than this helper guessing.
 */
export function taxCaseStatutoryContext(
  assessmentYear: string,
  law?: string | null,
): TaxCaseStatutoryContext {
  if (law == null || law === "") return { assessmentYear, law: "ITA_1961" };
  return { assessmentYear, law: law as TaxLaw };
}

/**
 * The canonical pack key written onto a NEW case for this law. Derived from
 * the shipped pack identity, never retyped, so the stored key cannot drift
 * from the registry. Not a live resolution pin this slice — callers still
 * resolve via {@link taxCaseStatutoryContext} + {@link bindDefaultTaxPackToCase}.
 */
export function storedTaxPackKeyForLaw(law: TaxLaw): string {
  if (!(TAX_LAWS as readonly string[]).includes(law)) {
    throw new Error(`storedTaxPackKeyForLaw: unrecognised law ${JSON.stringify(law)}`);
  }
  return taxPackKey(law === "ITA_2025" ? TY_2026_27_PACK_IDENTITY : AY_2026_27_PACK_IDENTITY);
}

/** The pack selector a case resolves against. Pure + total. */
export function taxCasePackSelector(context: TaxCaseStatutoryContext): TaxPackSelector {
  const law = context.law ?? "ITA_1961";
  return {
    jurisdiction: context.jurisdiction ?? "IN",
    law,
    periodKind: periodKindForLaw(law),
    period: context.assessmentYear,
    ...(context.computationRulesVersion !== undefined
      ? { computationRulesVersion: context.computationRulesVersion }
      : {}),
  };
}

/**
 * The rules versions a resolved pack stamps onto stored evidence. These are the
 * pack identity's own fields — NOT an ad-hoc constant imported from an engine.
 */
export interface TaxCasePackVersions {
  /** Stamped on `tax_computation_snapshots.rules_version`. */
  computationRulesVersion: string;
  /** Stamped on `tax_cases.validation_rules_version`. */
  validationRulesVersion: string;
}

export type TaxCasePackBinding =
  | {
      outcome: "bound";
      pack: TaxPack;
      identity: TaxPackIdentity;
      /** The deterministic surface the bound pack serves. */
      computation: TaxPackComputation;
      versions: TaxCasePackVersions;
    }
  | {
      outcome: "refused";
      /** Truthful, non-guessing reason — safe to surface as a blocker. */
      reason: string;
      resolution: "unsupported" | "ambiguous" | "unbound";
    };

/** The rules versions carried by a pack identity. */
export function taxPackVersions(identity: TaxPackIdentity): TaxCasePackVersions {
  return {
    computationRulesVersion: identity.computationRulesVersion,
    validationRulesVersion: identity.validationRulesVersion,
  };
}

/**
 * Why a pack that declares statutory rate parameters still cannot compute, or
 * `null` when it declares none (K4-PORT-02, D299).
 *
 * Pure derivation — it reads the pack's own parameters and asks the shared core
 * what they can serve. It never states a reason of its own, so this text cannot
 * drift away from what the pack actually supplies.
 */
function describeUnservableReason(pack: TaxPack): string | null {
  const parameters = taxPackRateParameters(pack);
  if (!parameters) return null;
  return describeWithheldParameters(resolveEngineCapability(parameters));
}

/**
 * Resolve the versioned pack that governs a case, from an explicit registry.
 * Returns `bound` only for a single matching pack that actually carries a
 * computation binding; otherwise an explicit refusal.
 */
export function bindTaxPackToCase(
  registry: TaxPackRegistry,
  context: TaxCaseStatutoryContext,
): TaxCasePackBinding {
  const selector = taxCasePackSelector(context);
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
  const computation = taxPackComputation(resolution.pack);
  if (!computation) {
    // K4-PORT-02 (D299): the OUTCOME is unchanged — still `unbound`, still a
    // refusal, still no computation surface handed back. Only the REASON got
    // better. Where the pack declares statutory rate parameters, the refusal
    // names the authority that is missing, so a preparer (and the next session)
    // is told what has to change rather than only that something is absent.
    const withheld = describeUnservableReason(resolution.pack);
    return {
      outcome: "refused",
      reason:
        `Tax pack ${resolution.pack.identity.computationRulesVersion} has no computation binding; ` +
        `it cannot govern a computation` +
        (withheld === null ? "" : `. ${withheld}`),
      resolution: "unbound",
    };
  }
  return {
    outcome: "bound",
    pack: resolution.pack,
    identity: resolution.pack.identity,
    computation,
    versions: taxPackVersions(resolution.pack.identity),
  };
}

/**
 * Resolve the governing pack from the registry TaxDesk OS ships. This is the entry
 * point production writers/readers use; tests use `bindTaxPackToCase` with a
 * purpose-built registry.
 */
export function bindDefaultTaxPackToCase(context: TaxCaseStatutoryContext): TaxCasePackBinding {
  // The shipped registry retains historical executable packs. A live caller
  // without an explicit snapshot pin always selects the current coordinate;
  // a historical caller can still pin V0 and receive its frozen implementation.
  // This resolves code identity; legacy stored engineInput payloads remain
  // incomplete and cannot by themselves reconstruct the original call.
  return bindTaxPackToCase(createDefaultTaxPackRegistry(), {
    ...context,
    ...(context.computationRulesVersion !== undefined
      ? { computationRulesVersion: context.computationRulesVersion }
      : (context.law ?? "ITA_1961") === "ITA_1961"
        ? { computationRulesVersion: RULES_VERSION }
        : {}),
  });
}
