/**
 * TaxDesk OS — Versioned Tax Pack: CA-VERIFICATION evidence (Wave 1, K3-13).
 *
 * PURE TYPESCRIPT ONLY (see identity.ts for the boundary rules).
 *
 * `lifecycle.ts` holds the deterministic `draft → ca_verified` state transition
 * and refuses to fabricate a verifier. This module supplies the missing half:
 * WHO verified WHAT, WHEN, and AGAINST WHICH official source — so a
 * `ca_verified` pack is an auditable evidence set, not a bare status flag.
 *
 * A pack becomes verifiable only when EVERY rule it declares in its provenance
 * carries a verification record that:
 *   - names a verifier and a timestamp (never defaulted, never "now");
 *   - cites every official source the rule declares (and no unknown source); and
 *   - explicitly resolves any documented caveat, so a known placeholder such as
 *     a `TODO(CA-verify)` value can never be rubber-stamped.
 *
 * A rule that cites no official source at all can never be verified — the gap is
 * reported, not waived. `assessTaxPackVerification` is total and never throws:
 * it is the one place a reader learns *what* is unverified and *why*.
 */

import type { TaxPackIdentity } from "./identity";
import { verifyTaxPack, type LifecycleTransition } from "./lifecycle";
import type { RuleProvenance, TaxPackProvenance } from "./provenance";

/**
 * One professional's verification of one rule against its declared sources.
 * `verifiedBy` is a professional identifier (name / membership id / user id) —
 * never client PII.
 */
export interface RuleVerificationRecord {
  readonly ruleId: string;
  /** The verifying professional. Caller-supplied — nothing here fabricates it. */
  readonly verifiedBy: string;
  /** ISO timestamp of the verification. Caller-supplied. */
  readonly verifiedAt: string;
  /** Ids of the rule's official sources actually checked. Must be non-empty. */
  readonly sourceIds: readonly string[];
  /** Required (true) when the rule carries a caveat. */
  readonly caveatResolved: boolean;
  /** Optional professional note. Never client PII. */
  readonly note?: string;
}

function assertNonEmpty(value: string | undefined, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Verification ${field} must be a non-empty string`);
  }
  return value;
}

/** Construct a validated, frozen verification record. */
export function makeRuleVerificationRecord(fields: {
  ruleId: string;
  verifiedBy: string;
  verifiedAt: string;
  sourceIds: readonly string[];
  caveatResolved?: boolean;
  note?: string;
}): RuleVerificationRecord {
  const ruleId = assertNonEmpty(fields.ruleId, "ruleId");
  const verifiedBy = assertNonEmpty(fields.verifiedBy, "verifiedBy");
  const verifiedAt = assertNonEmpty(fields.verifiedAt, "verifiedAt");
  if (fields.sourceIds.length === 0) {
    throw new Error(`Verification of rule ${ruleId} must cite at least one official source`);
  }
  const sourceIds: string[] = [];
  for (const id of fields.sourceIds) {
    assertNonEmpty(id, "sourceId");
    if (sourceIds.includes(id)) {
      throw new Error(`Verification of rule ${ruleId} cites source ${JSON.stringify(id)} more than once`);
    }
    sourceIds.push(id);
  }
  return Object.freeze({
    ruleId,
    verifiedBy,
    verifiedAt,
    sourceIds: Object.freeze(sourceIds),
    caveatResolved: fields.caveatResolved ?? false,
    ...(fields.note !== undefined ? { note: assertNonEmpty(fields.note, "note") } : {}),
  });
}

/** Per-rule outcome. `unverified` always carries a truthful, specific reason. */
export type RuleVerificationState =
  | {
      readonly ruleId: string;
      readonly state: "verified";
      readonly verifiedBy: string;
      readonly verifiedAt: string;
      readonly sourceIds: readonly string[];
    }
  | { readonly ruleId: string; readonly state: "unverified"; readonly reason: string };

export interface TaxPackVerificationAssessment {
  readonly ruleCount: number;
  readonly verifiedCount: number;
  /** One entry per declared rule, in declaration order. */
  readonly rules: readonly RuleVerificationState[];
  /** Rule ids that are not verified, in declaration order. */
  readonly unverifiedRuleIds: readonly string[];
  /** Human-readable gaps, in declaration order. Empty when evidence is complete. */
  readonly gaps: readonly string[];
  /** True ONLY when at least one rule is declared and every rule is verified. */
  readonly evidenceComplete: boolean;
}

function assessRule(
  rule: RuleProvenance,
  records: readonly RuleVerificationRecord[],
): RuleVerificationState {
  const matching = records.filter((r) => r.ruleId === rule.ruleId);
  if (matching.length > 1) {
    return {
      ruleId: rule.ruleId,
      state: "unverified",
      reason: `${matching.length} conflicting verification records exist for this rule`,
    };
  }
  if (rule.sources.length === 0) {
    return {
      ruleId: rule.ruleId,
      state: "unverified",
      reason: "No official source is cited for this rule",
    };
  }
  const record = matching[0];
  if (record === undefined) {
    return { ruleId: rule.ruleId, state: "unverified", reason: "No CA verification record" };
  }

  const declared = rule.sources.map((s) => s.id);
  const unknown = record.sourceIds.filter((id) => !declared.includes(id));
  if (unknown.length > 0) {
    return {
      ruleId: rule.ruleId,
      state: "unverified",
      reason: `Verification cites source(s) this rule does not declare: ${unknown.join(", ")}`,
    };
  }
  const unchecked = declared.filter((id) => !record.sourceIds.includes(id));
  if (unchecked.length > 0) {
    return {
      ruleId: rule.ruleId,
      state: "unverified",
      reason: `Declared source(s) not checked: ${unchecked.join(", ")}`,
    };
  }
  if (rule.caveat !== null && !record.caveatResolved) {
    return {
      ruleId: rule.ruleId,
      state: "unverified",
      reason: `Unresolved caveat: ${rule.caveat}`,
    };
  }
  return {
    ruleId: rule.ruleId,
    state: "verified",
    verifiedBy: record.verifiedBy,
    verifiedAt: record.verifiedAt,
    sourceIds: record.sourceIds,
  };
}

/**
 * Assess a pack's verification evidence. Pure, deterministic, and total — it
 * never throws and never guesses; an undeclared or unevidenced rule is reported
 * as an explicit gap.
 */
export function assessTaxPackVerification(
  provenance: TaxPackProvenance | undefined,
  records: readonly RuleVerificationRecord[] = [],
): TaxPackVerificationAssessment {
  const rules = provenance?.rules ?? [];
  const states = rules.map((rule) => assessRule(rule, records));
  const unverified = states.filter(
    (s): s is Extract<RuleVerificationState, { state: "unverified" }> => s.state === "unverified",
  );
  return Object.freeze({
    ruleCount: rules.length,
    verifiedCount: states.length - unverified.length,
    rules: Object.freeze(states),
    unverifiedRuleIds: Object.freeze(unverified.map((s) => s.ruleId)),
    gaps: Object.freeze(unverified.map((s) => `${s.ruleId}: ${s.reason}`)),
    evidenceComplete: rules.length > 0 && unverified.length === 0,
  });
}

/**
 * Move a pack to `ca_verified` ONLY when the evidence supports it. Refuses when
 * the pack declares no provenance, or when any declared rule is unverified —
 * listing exactly what is missing. On success it delegates to the lifecycle
 * transition, so the `ca_verified ⇒ verifiedBy + verifiedAt` identity invariant
 * still holds and the coordinates are unchanged.
 *
 * This never invents a verifier or a timestamp: both are caller-supplied, and
 * the per-rule records must already exist.
 */
export function verifyTaxPackWithEvidence(
  identity: TaxPackIdentity,
  args: {
    provenance: TaxPackProvenance | undefined;
    records: readonly RuleVerificationRecord[];
    verifiedBy: string;
    verifiedAt: string;
  },
): LifecycleTransition {
  const assessment = assessTaxPackVerification(args.provenance, args.records);
  if (assessment.ruleCount === 0) {
    return {
      ok: false,
      reason: "Cannot verify a pack that declares no official-source provenance",
    };
  }
  if (!assessment.evidenceComplete) {
    return {
      ok: false,
      reason: `Cannot verify: ${assessment.unverifiedRuleIds.length} of ${assessment.ruleCount} rules lack verification evidence (${assessment.gaps.join("; ")})`,
    };
  }
  return verifyTaxPack(identity, { verifiedBy: args.verifiedBy, verifiedAt: args.verifiedAt });
}
