/**
 * TaxDesk OS — Versioned Tax Pack: IDENTITY contract (Wave 1, K3-10).
 *
 * PURE TYPESCRIPT ONLY. Like `src/lib/tax-engine/*` and `src/lib/tax-desk/*`
 * this module must NOT import React, Next.js, the Supabase client, UI/PDF
 * components, server actions, env/config, or app routes. Its only runtime
 * dependency is the language itself (plus pure constants from the AY 2026-27
 * engine so the first registered pack's identity stays byte-for-byte in sync
 * with the engine's `RULES_VERSION`). See the k3-tax-pack-contracts design notes.
 *
 * A **tax pack** is the immutable, versioned package a computation resolves
 * through: a specific statutory world (jurisdiction + law + period) bound to
 * exact computation/validation/source/output rule versions, plus its lifecycle
 * and CA-verification state. This file defines the identity value object and its
 * canonical, lossless string key — nothing computes here.
 *
 * SCOPE (K3-10): identity + registry + resolver + lifecycle scaffolding only.
 * Nothing in production routes computation through a pack yet — that migration
 * is K3-11. No pack is marked `ca_verified` here (that workflow/data is K3-13).
 */

/** Jurisdiction — only India is modelled today. */
export type Jurisdiction = "IN";

/**
 * Statutory basis. The two parallel worlds the architecture must support:
 * the Income-tax Act, 1961 (AY 2026-27 / AIS) and the Income-tax Act, 2025
 * (TY 2026-27 / SAHAJ (ITR-1) under the Income-tax Rules, 2026 rule 164 — NOT
 * "Form 168", which is the Annual Information Statement; corrected by `D301`).
 * ITA_2025 is representable and citeable (packs, provenance, capability
 * `ruleAuthority`); it still has no computation surface. Identities must
 * stay representable so the second world cannot be mistaken for a typo.
 */
export type TaxLaw = "ITA_1961" | "ITA_2025";

/** Period counting model — the 1961 Act uses assessment years; the 2025 Act uses tax years. */
export type PeriodKind = "assessment_year" | "tax_year";

/**
 * Pack lifecycle. A pack must be `ca_verified` before it may be relied upon for
 * real preparation; `draft` packs exist and resolve but never satisfy reliance;
 * `retired` packs are kept for reproducing historical calculations only.
 */
export type TaxPackStatus = "draft" | "ca_verified" | "retired";

export const JURISDICTIONS: readonly Jurisdiction[] = ["IN"] as const;
export const TAX_LAWS: readonly TaxLaw[] = ["ITA_1961", "ITA_2025"] as const;
export const PERIOD_KINDS: readonly PeriodKind[] = ["assessment_year", "tax_year"] as const;
export const TAX_PACK_STATUSES: readonly TaxPackStatus[] = ["draft", "ca_verified", "retired"] as const;

/**
 * The immutable COORDINATES that uniquely identify a pack for resolution. These
 * five fields are the pack's primary key — two identities with the same
 * coordinates are the same pack and the registry rejects a second registration.
 * The lifecycle/verification/effective-from fields deliberately sit OUTSIDE the
 * coordinates so a pack can move `draft → ca_verified → retired` without
 * changing its identity (and therefore without changing which stored
 * computation it reproduces).
 */
export interface TaxPackCoordinates {
  jurisdiction: Jurisdiction;
  law: TaxLaw;
  periodKind: PeriodKind;
  period: string;
  computationRulesVersion: string;
}

/**
 * Full pack identity. Mirrors the pack-identity design * and is designed to
 * represent the current engine's `AY_2026_27_V5_PREP_ONLY` rules string
 * losslessly.
 */
export interface TaxPackIdentity extends TaxPackCoordinates {
  /** Rules version stamped by a validation run (`tax_cases.validation_rules_version`). */
  validationRulesVersion: string;
  /**
   * Versioned import-schema package versions, keyed by source format (K3-14).
   * Derived from `source-schema.ts` packages — NON-coordinate state, so a schema
   * version may move without changing the pack key.
   */
  sourceSchemaVersions: Readonly<Record<string, string>>;
  /**
   * Versioned output-schema package versions, keyed by artifact (K3-14).
   * Derived from `output-schema.ts` packages — likewise non-coordinate state.
   */
  outputSchemaVersions: Readonly<Record<string, string>>;
  status: TaxPackStatus;
  /** ISO date the statutory world takes effect (e.g. FY start), for audit/ordering. */
  effectiveFrom: string;
  /** Set ONLY by CA verification (K3-13). Null until then. */
  verifiedBy: string | null;
  /** ISO timestamp of CA verification (K3-13). Null until then. */
  verifiedAt: string | null;
}

const KEY_SEPARATOR = ":";

function assertEnum<T extends string>(value: string | undefined, allowed: readonly T[], field: string): T {
  if (value === undefined || !(allowed as readonly string[]).includes(value)) {
    throw new Error(
      `Invalid tax-pack ${field}: ${JSON.stringify(value)} (expected one of ${allowed.join(", ")})`,
    );
  }
  return value as T;
}

function assertNonEmpty(value: string | undefined, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Tax-pack ${field} must be a non-empty string`);
  }
  return value;
}

/**
 * Construct a validated, deeply-frozen `TaxPackIdentity`. Validates the enum
 * fields and non-empty strings, and enforces the lifecycle invariant that a
 * `ca_verified` pack must carry `verifiedBy` + `verifiedAt` (and a non-verified
 * pack must not). The returned object and its schema-version records are frozen
 * so a registered identity can never be mutated in place.
 */
export function makeTaxPackIdentity(fields: {
  jurisdiction: Jurisdiction;
  law: TaxLaw;
  periodKind: PeriodKind;
  period: string;
  computationRulesVersion: string;
  validationRulesVersion: string;
  // Accepted as read-only so a caller may pass the frozen map a schema-package
  // catalog derives (K3-14) without copying it first; it is spread below anyway.
  sourceSchemaVersions?: Readonly<Record<string, string>>;
  outputSchemaVersions?: Readonly<Record<string, string>>;
  status: TaxPackStatus;
  effectiveFrom: string;
  verifiedBy?: string | null;
  verifiedAt?: string | null;
}): TaxPackIdentity {
  const jurisdiction = assertEnum(fields.jurisdiction, JURISDICTIONS, "jurisdiction");
  const law = assertEnum(fields.law, TAX_LAWS, "law");
  const periodKind = assertEnum(fields.periodKind, PERIOD_KINDS, "periodKind");
  const status = assertEnum(fields.status, TAX_PACK_STATUSES, "status");
  const period = assertNonEmpty(fields.period, "period");
  const computationRulesVersion = assertNonEmpty(
    fields.computationRulesVersion,
    "computationRulesVersion",
  );
  const validationRulesVersion = assertNonEmpty(
    fields.validationRulesVersion,
    "validationRulesVersion",
  );
  const effectiveFrom = assertNonEmpty(fields.effectiveFrom, "effectiveFrom");

  // A key must never contain the separator, or it would not round-trip.
  for (const [name, value] of [
    ["period", period],
    ["computationRulesVersion", computationRulesVersion],
  ] as const) {
    if (value.includes(KEY_SEPARATOR)) {
      throw new Error(`Tax-pack ${name} must not contain "${KEY_SEPARATOR}": ${JSON.stringify(value)}`);
    }
  }

  const verifiedBy = fields.verifiedBy ?? null;
  const verifiedAt = fields.verifiedAt ?? null;
  if (status === "ca_verified") {
    if (!verifiedBy || !verifiedAt) {
      throw new Error("A ca_verified tax pack must carry verifiedBy and verifiedAt");
    }
  } else if (verifiedBy !== null || verifiedAt !== null) {
    throw new Error(`A ${status} tax pack must not carry verifiedBy/verifiedAt`);
  }

  return Object.freeze({
    jurisdiction,
    law,
    periodKind,
    period,
    computationRulesVersion,
    validationRulesVersion,
    sourceSchemaVersions: Object.freeze({ ...(fields.sourceSchemaVersions ?? {}) }),
    outputSchemaVersions: Object.freeze({ ...(fields.outputSchemaVersions ?? {}) }),
    status,
    effectiveFrom,
    verifiedBy,
    verifiedAt,
  });
}

/** Extract just the immutable resolution coordinates from a full identity. */
export function taxPackCoordinates(identity: TaxPackCoordinates): TaxPackCoordinates {
  return {
    jurisdiction: identity.jurisdiction,
    law: identity.law,
    periodKind: identity.periodKind,
    period: identity.period,
    computationRulesVersion: identity.computationRulesVersion,
  };
}

/**
 * Canonical, lossless string key for a pack's coordinates:
 * `jurisdiction:law:periodKind:period:computationRulesVersion`
 * e.g. `IN:ITA_1961:assessment_year:2026-27:AY_2026_27_V5_PREP_ONLY`.
 */
export function formatTaxPackKey(coords: TaxPackCoordinates): string {
  return [
    coords.jurisdiction,
    coords.law,
    coords.periodKind,
    coords.period,
    coords.computationRulesVersion,
  ].join(KEY_SEPARATOR);
}

/** Parse a canonical key back into validated coordinates. Throws on malformed input. */
export function parseTaxPackKey(key: string): TaxPackCoordinates {
  const parts = key.split(KEY_SEPARATOR);
  if (parts.length < 5) {
    throw new Error(`Malformed tax-pack key (expected 5 ${KEY_SEPARATOR}-separated fields): ${JSON.stringify(key)}`);
  }
  const [jurisdiction, law, periodKind, period, ...rest] = parts;
  return {
    jurisdiction: assertEnum(jurisdiction, JURISDICTIONS, "jurisdiction"),
    law: assertEnum(law, TAX_LAWS, "law"),
    periodKind: assertEnum(periodKind, PERIOD_KINDS, "periodKind"),
    period: assertNonEmpty(period, "period"),
    // Rejoin defensively in case a future rules version ever contained the
    // separator (construction forbids it today, but parsing stays total).
    computationRulesVersion: assertNonEmpty(rest.join(KEY_SEPARATOR), "computationRulesVersion"),
  };
}

/** Convenience: the canonical key of a full identity. */
export function taxPackKey(identity: TaxPackCoordinates): string {
  return formatTaxPackKey(identity);
}

/** True when two coordinates identify the same pack. */
export function sameTaxPackCoordinates(a: TaxPackCoordinates, b: TaxPackCoordinates): boolean {
  return formatTaxPackKey(a) === formatTaxPackKey(b);
}
