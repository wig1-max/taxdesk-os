/**
 * TaxDesk OS — Versioned Tax Pack: verification STATE + reliance BLOCKER
 * (Wave 1, K3-13).
 *
 * PURE TYPESCRIPT ONLY (see identity.ts for the boundary rules).
 *
 * THE canonical reader path for "is the pack governing this case verified, and
 * what is unverified about it?" — the counterpart to `case-pack.ts` (which owns
 * "which pack governs this case?"). No surface may re-derive verification state
 * from `identity.status` plus its own guesswork; they all call
 * {@link describeTaxPackVerification}.
 *
 * Truthful status only: a `draft` pack always reads as NOT verified, and the
 * summary never says "ready", "current", or "approved". Verification is reported
 * from the identity's lifecycle status AND the per-rule evidence, so a pack
 * cannot look verified because someone flipped a status.
 *
 * `resolveTaxPackForReliance` already refuses an unverified pack; this module
 * makes that refusal CONSUMABLE — a structured blocker (code + message +
 * details) shaped like the eligibility blockers the Tax Desk already renders.
 * Nothing consumes it yet, so no existing lifecycle/guard/eligibility behaviour
 * changes; it exists so the refusal can be surfaced rather than staying an
 * invisible internal state.
 */

import { taxCasePackSelector, type TaxCaseStatutoryContext } from "./case-pack";
import { taxPackKey, type TaxPackStatus } from "./identity";
import { taxPackProvenance, type TaxPack } from "./pack";
import { resolveTaxPack, resolveTaxPackForReliance } from "./resolver";
import type { TaxPackRegistry } from "./registry";
import { createDefaultTaxPackRegistry } from "./registry-default";
import { RULES_VERSION } from "@/lib/tax-engine/ay-2026-27/rules";
import {
  assessTaxPackVerification,
  type RuleVerificationRecord,
  type TaxPackVerificationAssessment,
} from "./verification";

/** What a reader may truthfully say about a pack's verification. */
export interface TaxPackVerificationState {
  /** Canonical pack key — the coordinates the state describes. */
  readonly key: string;
  readonly status: TaxPackStatus;
  /** True ONLY for a `ca_verified` pack whose per-rule evidence is complete. */
  readonly verified: boolean;
  readonly verifiedBy: string | null;
  readonly verifiedAt: string | null;
  readonly assessment: TaxPackVerificationAssessment;
  /** Rule ids without complete verification evidence. */
  readonly unverifiedRuleIds: readonly string[];
  /** Truthful, specific reasons the pack is not verified. Empty when verified. */
  readonly gaps: readonly string[];
  /** One-line summary that never overstates. */
  readonly summary: string;
}

/**
 * Describe a pack's verification state from its identity AND its per-rule
 * evidence. `records` are the verification records held for this pack (none
 * today — TaxDesk OS ships no `ca_verified` pack).
 */
export function describeTaxPackVerification(
  pack: TaxPack,
  records: readonly RuleVerificationRecord[] = [],
): TaxPackVerificationState {
  const { identity } = pack;
  const assessment = assessTaxPackVerification(taxPackProvenance(pack), records);
  const key = taxPackKey(identity);
  const gaps: string[] = [];

  if (identity.status !== "ca_verified") {
    gaps.push(`Pack lifecycle status is ${identity.status}, not ca_verified`);
  }
  gaps.push(...assessment.gaps);

  const verified = identity.status === "ca_verified" && assessment.evidenceComplete;
  const evidence =
    assessment.ruleCount === 0
      ? "no rules declare official-source provenance"
      : `${assessment.verifiedCount} of ${assessment.ruleCount} rules carry verification evidence`;
  const summary = verified
    ? `Tax pack ${identity.computationRulesVersion} is CA-verified by ${identity.verifiedBy} on ${identity.verifiedAt} (${evidence})`
    : `Tax pack ${identity.computationRulesVersion} is ${identity.status} — not CA-verified (${evidence})`;

  return Object.freeze({
    key,
    status: identity.status,
    verified,
    verifiedBy: identity.verifiedBy,
    verifiedAt: identity.verifiedAt,
    assessment,
    unverifiedRuleIds: assessment.unverifiedRuleIds,
    gaps: Object.freeze(gaps),
    summary,
  });
}

/** Blocker codes for a refused reliance. Stable contract for any future surface. */
export const TAX_PACK_BLOCKER_CODES = {
  unsupported: "tax_pack_unsupported",
  ambiguous: "tax_pack_ambiguous",
  unverified: "tax_pack_unverified",
} as const;

export type TaxPackBlockerCode = (typeof TAX_PACK_BLOCKER_CODES)[keyof typeof TAX_PACK_BLOCKER_CODES];

/**
 * A refused reliance, shaped for rendering next to the Tax Desk's existing
 * eligibility blockers (code + message + supporting detail lines).
 */
export interface TaxPackRelianceBlocker {
  readonly code: TaxPackBlockerCode;
  readonly message: string;
  /** Specific, truthful supporting reasons. Never sensitive text. */
  readonly details: readonly string[];
}

/**
 * The blocker that stops a case from RELYING on its governing pack for real
 * preparation, or `null` when a single `ca_verified` pack governs it.
 *
 * Reliance ≠ binding: `case-pack.ts` still binds the truthfully-`draft` pack so
 * the product computes in synthetic mode (decision D12). This function is the
 * separate, truthful answer to *"may this be relied upon for a real client?"*.
 */
export function taxPackRelianceBlocker(
  registry: TaxPackRegistry,
  context: TaxCaseStatutoryContext,
  records: readonly RuleVerificationRecord[] = [],
): TaxPackRelianceBlocker | null {
  const selector = taxCasePackSelector(context);
  const reliance = resolveTaxPackForReliance(registry, selector);
  if (reliance.outcome === "usable") return null;

  if (reliance.resolution === "unsupported") {
    return Object.freeze({
      code: TAX_PACK_BLOCKER_CODES.unsupported,
      message: "No versioned tax pack supports this case's statutory period",
      details: Object.freeze([reliance.reason]),
    });
  }
  if (reliance.resolution === "ambiguous") {
    return Object.freeze({
      code: TAX_PACK_BLOCKER_CODES.ambiguous,
      message: "More than one versioned tax pack matches this case",
      details: Object.freeze([reliance.reason]),
    });
  }

  // `unverified` — a single pack resolved but is not CA-verified. Report exactly
  // what is missing, sourced from the one canonical verification reader.
  const resolution = resolveTaxPack(registry, selector);
  const details =
    resolution.outcome === "resolved"
      ? describeTaxPackVerification(resolution.pack, records).gaps
      : [reliance.reason];
  return Object.freeze({
    code: TAX_PACK_BLOCKER_CODES.unverified,
    message: "The versioned tax pack governing this case is not CA-verified against official sources",
    details: Object.freeze([...details]),
  });
}

/** The reliance blocker against the registry TaxDesk OS ships. */
export function defaultTaxPackRelianceBlocker(
  context: TaxCaseStatutoryContext,
  records: readonly RuleVerificationRecord[] = [],
): TaxPackRelianceBlocker | null {
  return taxPackRelianceBlocker(
    createDefaultTaxPackRegistry(),
    {
      ...context,
      ...(context.computationRulesVersion !== undefined
        ? { computationRulesVersion: context.computationRulesVersion }
        : (context.law ?? "ITA_1961") === "ITA_1961"
          ? { computationRulesVersion: RULES_VERSION }
          : {}),
    },
    records,
  );
}
