/**
 * TaxDesk OS — Versioned Tax Pack: SCHEMA-PACKAGE core (Wave 1, K3-14).
 *
 * PURE TYPESCRIPT ONLY (see identity.ts for the boundary rules).
 *
 * A tax pack is assembled from three independently-versioned kinds of package:
 *
 *   1. **computation rules** — what the engine calculates (`computationRulesVersion`);
 *   2. **source schemas** — the external evidence formats the product may read
 *      (`source-schema.ts`);
 *   3. **output schemas** — the artifacts the product produces
 *      (`output-schema.ts`).
 *
 * This module holds ONLY what (2) and (3) share: an identity (key + version +
 * lifecycle status), an immutable catalog, and a deterministic resolution that
 * refuses explicitly. It defines no field, no format, and no artifact — those
 * vocabularies live in their own modules so a source format can never leak into
 * an output artifact's contract.
 *
 * **The boundary is the point (K3-14).** A schema package's version is
 * deliberately NOT part of a pack's coordinates: `sourceSchemaVersions` /
 * `outputSchemaVersions` are non-coordinate identity state, so a schema version
 * can move without changing the canonical pack key (and therefore without
 * changing which stored computation the pack reproduces), and the computation
 * rules can move without touching a schema. Nothing here is imported by the
 * resolver, the lifecycle, or provenance/verification — those contracts must not
 * start depending on schema internals.
 *
 * **No parser, importer, mapper, or renderer lives here or anywhere in K3-14.**
 * These are boundaries; ingestion is Wave 3.
 */

/**
 * Lifecycle of a schema package.
 *
 * - `planned`   — the boundary exists and is versioned, but nothing reads or
 *                 writes this format yet. Shipped source schemas are all planned.
 * - `supported` — the product genuinely produces/consumes this shape today.
 * - `retired`   — kept only to interpret historical data.
 *
 * `planned` is NOT a soft "supported": a `planned` package must never be treated
 * as usable, and there is no fallback that silently upgrades one.
 */
export const SCHEMA_PACKAGE_STATUSES = ["planned", "supported", "retired"] as const;
export type SchemaPackageStatus = (typeof SCHEMA_PACKAGE_STATUSES)[number];

/**
 * The identity of one schema package: WHAT it describes (`key`), WHICH revision
 * of that description this is (`schemaVersion`), and its lifecycle.
 *
 * `K` is the key's literal union, so a source package's identity is statically a
 * `SchemaPackageIdentity<SourceSchemaKind>` and an output package's a
 * `SchemaPackageIdentity<OutputArtifactKind>` — no assertion needed to narrow
 * one. It defaults to `string` for generic consumers (the catalog, the version
 * map), and because `key` is read-only, a narrowed identity is assignable to the
 * generic one.
 */
export interface SchemaPackageIdentity<K extends string = string> {
  /** Stable format/artifact key, e.g. "AIS" or "computation_snapshot". */
  readonly key: K;
  /** Version of the description itself — independent of any rules version. */
  readonly schemaVersion: string;
  readonly status: SchemaPackageStatus;
}

/** Anything the catalog can hold: a package that carries a schema identity. */
export interface SchemaPackageLike {
  readonly identity: SchemaPackageIdentity;
}

const VERSION_SEPARATOR = "@";

export function assertSchemaNonEmpty(value: string | undefined, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Schema package ${field} must be a non-empty string`);
  }
  return value;
}

export function assertSchemaEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  field: string,
): T {
  if (value === undefined || !(allowed as readonly string[]).includes(value)) {
    throw new Error(
      `Invalid schema package ${field}: ${JSON.stringify(value)} (expected one of ${allowed.join(", ")})`,
    );
  }
  return value as T;
}

/**
 * Construct a validated, frozen schema-package identity. The key's literal type
 * is preserved in the result, so a caller that passes an enum-validated key gets
 * a correspondingly narrowed identity back without casting.
 */
export function makeSchemaPackageIdentity<K extends string>(fields: {
  key: K;
  schemaVersion: string;
  status: SchemaPackageStatus;
}): SchemaPackageIdentity<K> {
  assertSchemaNonEmpty(fields.key, "key");
  const key: K = fields.key;
  const schemaVersion = assertSchemaNonEmpty(fields.schemaVersion, "schemaVersion");
  const status = assertSchemaEnum(fields.status, SCHEMA_PACKAGE_STATUSES, "status");
  for (const [name, value] of [
    ["key", key],
    ["schemaVersion", schemaVersion],
  ] as const) {
    if (value.includes(VERSION_SEPARATOR)) {
      throw new Error(
        `Schema package ${name} must not contain "${VERSION_SEPARATOR}": ${JSON.stringify(value)}`,
      );
    }
  }
  return Object.freeze({ key, schemaVersion, status });
}

/** Canonical catalog key: `key@schemaVersion`, e.g. `AIS@AIS_V0_PLANNED`. */
export function formatSchemaPackageKey(identity: SchemaPackageIdentity): string {
  return `${identity.key}${VERSION_SEPARATOR}${identity.schemaVersion}`;
}

/**
 * The outcome of asking a catalog for a schema. Mirrors `resolver.ts`
 * deliberately: an unknown key or an unknown version is an explicit typed
 * refusal — never a guess, never a "closest" match, never a throw-through.
 */
export type SchemaResolution<T extends SchemaPackageLike> =
  | { outcome: "resolved"; schema: T }
  | { outcome: "unsupported"; key: string; schemaVersion?: string; reason: string }
  | { outcome: "ambiguous"; key: string; candidates: readonly SchemaPackageIdentity[] };

export interface SchemaCatalog<T extends SchemaPackageLike> {
  /** All packages, in declaration order. */
  list(): readonly T[];
  /** Exact lookup by `key@schemaVersion`, or undefined. */
  get(catalogKey: string): T | undefined;
  /**
   * Resolve a format/artifact key, optionally pinned to an exact version.
   * Unpinned and more than one version registered ⇒ `ambiguous` (the caller must
   * say which version it means, rather than being handed "the latest").
   */
  resolve(key: string, schemaVersion?: string): SchemaResolution<T>;
}

/**
 * Build an immutable catalog. Refuses duplicate `key@schemaVersion` entries —
 * two descriptions of the same revision of the same format would make
 * resolution non-deterministic.
 */
export function makeSchemaCatalog<T extends SchemaPackageLike>(
  packages: readonly T[],
  label: string,
): SchemaCatalog<T> {
  const byKey = new Map<string, T>();
  for (const pkg of packages) {
    const catalogKey = formatSchemaPackageKey(pkg.identity);
    if (byKey.has(catalogKey)) {
      throw new Error(`Duplicate ${label} schema package: ${catalogKey}`);
    }
    byKey.set(catalogKey, pkg);
  }
  const ordered = Object.freeze([...byKey.values()]);

  return {
    list: () => ordered,
    get: (catalogKey: string) => byKey.get(catalogKey),
    resolve(key: string, schemaVersion?: string): SchemaResolution<T> {
      const candidates = ordered.filter(
        (p) =>
          p.identity.key === key &&
          (schemaVersion === undefined || p.identity.schemaVersion === schemaVersion),
      );
      const [first, second] = candidates;
      if (first === undefined) {
        return {
          outcome: "unsupported",
          key,
          ...(schemaVersion !== undefined ? { schemaVersion } : {}),
          reason:
            schemaVersion === undefined
              ? `No ${label} schema package describes ${JSON.stringify(key)}`
              : `No ${label} schema package describes ${JSON.stringify(key)} at version ${JSON.stringify(schemaVersion)}`,
        };
      }
      if (second !== undefined) {
        return {
          outcome: "ambiguous",
          key,
          candidates: Object.freeze(candidates.map((p) => p.identity)),
        };
      }
      return { outcome: "resolved", schema: first };
    },
  };
}

/**
 * The `{ key: schemaVersion }` map a pack identity carries. Built FROM the
 * packages so the pack never re-declares a version literal (the same
 * single-source-of-truth discipline as decision D6). Refuses a catalog holding
 * two versions of one key — a pack identity can name exactly one.
 */
export function schemaVersionMap(
  packages: readonly SchemaPackageLike[],
  label: string,
): Readonly<Record<string, string>> {
  // Accumulated in a Map, not by bracket-assigning onto `{}`: a key of
  // `__proto__` hits Object.prototype's setter there and would be silently
  // DROPPED rather than stored — exactly the kind of quiet data loss this
  // package refuses everywhere else. `Object.fromEntries` defines own
  // properties, so every key round-trips.
  const versions = new Map<string, string>();
  for (const { identity } of packages) {
    const existing = versions.get(identity.key);
    if (existing !== undefined && existing !== identity.schemaVersion) {
      throw new Error(
        `Cannot build a ${label} schema-version map: ${JSON.stringify(identity.key)} has versions ${JSON.stringify(existing)} and ${JSON.stringify(identity.schemaVersion)}`,
      );
    }
    versions.set(identity.key, identity.schemaVersion);
  }
  return Object.freeze(Object.fromEntries(versions));
}
