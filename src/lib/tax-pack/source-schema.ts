/**
 * TaxDesk OS — Versioned Tax Pack: SOURCE (import) schema packages
 * (Wave 1, K3-14).
 *
 * PURE TYPESCRIPT ONLY (see identity.ts for the boundary rules).
 *
 * A **source schema package** is the versioned description of ONE external
 * evidence format the product may later read — an AIS statement, a Form 26AS, a
 * Form 16, a portal prefilled JSON, a broker report, a bank interest
 * certificate. It answers *"what does this format claim to evidence, and which
 * revision of that description are we talking about?"* — nothing more.
 *
 * It is emphatically NOT a parser, a mapper, an extractor, or a field-level
 * specification of a government file layout. Ingestion is Wave 3; K3-14 defines
 * only the boundary so that when a reader is eventually written it must declare
 * which versioned description it implements.
 *
 * **Nothing here may be invented.** The facts a package declares are transcribed
 * from what the repository ALREADY models — the ledger's `SOURCE_TYPES`
 * (`src/lib/tax-desk/ledger.ts`) and the reconciliation pairs the deterministic
 * validation runner already computes (`src/lib/tax-desk/validation-runner.ts`).
 * Where the repository models nothing for a format, the package declares NO
 * facts and carries a caveat — an explicit, reported gap, never a guessed field
 * map (the same discipline as decision D15 for provenance).
 */

import {
  assertSchemaEnum,
  assertSchemaNonEmpty,
  makeSchemaCatalog,
  makeSchemaPackageIdentity,
  schemaVersionMap,
  type SchemaCatalog,
  type SchemaPackageIdentity,
  type SchemaPackageStatus,
  type SchemaResolution,
} from "./schema-package";

/**
 * The external evidence formats the product models today. These are exactly the
 * non-manual members of the ledger's `SOURCE_TYPES` vocabulary — `manual` and
 * `adjustment` are professional actions, not external formats, and so have no
 * import schema. (A unit test cross-checks this list against `SOURCE_TYPES`
 * rather than importing it, keeping the tax-pack package free of a runtime
 * dependency on the Tax Desk domain.)
 */
export const SOURCE_SCHEMA_KINDS = [
  "AIS",
  "26AS",
  "Form16",
  "prefilled_json",
  "broker_report",
  "bank_certificate",
] as const;
export type SourceSchemaKind = (typeof SOURCE_SCHEMA_KINDS)[number];

/**
 * The ledger areas a source format can evidence. Mirrors the Tax Desk's
 * `LedgerKind` vocabulary; declared here so the schema boundary carries no
 * runtime dependency on the ledger module.
 */
export const SOURCE_FACT_AREAS = ["income", "tax_paid", "deduction", "capital_gain"] as const;
export type SourceFactArea = (typeof SOURCE_FACT_AREAS)[number];

/**
 * One fact a source format is already modelled as evidencing. `factKey` is the
 * ledger category the repository reconciles against (e.g. `salary`,
 * `salary_tds`) — NOT a field path inside the government file, which nobody here
 * has inspected.
 */
export interface SourceFactSpec {
  readonly area: SourceFactArea;
  readonly factKey: string;
  readonly label: string;
}

/** The versioned description of one external evidence format. */
export interface SourceSchemaPackage {
  readonly identity: SchemaPackageIdentity<SourceSchemaKind>;
  /** What the format is. Descriptive — never a restatement of values. */
  readonly summary: string;
  /** Facts the repository already models this format as evidencing. May be empty. */
  readonly facts: readonly SourceFactSpec[];
  /** Documented reason the description is incomplete, or null. */
  readonly caveat: string | null;
}

/** Construct a validated, frozen source-fact spec. */
export function makeSourceFactSpec(fields: {
  area: SourceFactArea;
  factKey: string;
  label: string;
}): SourceFactSpec {
  return Object.freeze({
    area: assertSchemaEnum(fields.area, SOURCE_FACT_AREAS, "source fact area"),
    factKey: assertSchemaNonEmpty(fields.factKey, "source factKey"),
    label: assertSchemaNonEmpty(fields.label, "source fact label"),
  });
}

/** Construct a validated, frozen source schema package. Duplicate facts are refused. */
export function makeSourceSchemaPackage(fields: {
  kind: SourceSchemaKind;
  schemaVersion: string;
  status: SchemaPackageStatus;
  summary: string;
  facts?: readonly SourceFactSpec[];
  caveat?: string | null;
}): SourceSchemaPackage {
  const kind = assertSchemaEnum(fields.kind, SOURCE_SCHEMA_KINDS, "source schema kind");
  // `kind` is enum-validated above, so the identity comes back narrowed to
  // `SchemaPackageIdentity<SourceSchemaKind>` — no assertion required.
  const identity = makeSchemaPackageIdentity({
    key: kind,
    schemaVersion: fields.schemaVersion,
    status: fields.status,
  });
  const facts = fields.facts ?? [];
  const seen = new Set<string>();
  for (const fact of facts) {
    const id = `${fact.area}.${fact.factKey}`;
    if (seen.has(id)) {
      throw new Error(`Source schema ${kind} declares fact ${JSON.stringify(id)} more than once`);
    }
    seen.add(id);
  }
  const caveat = fields.caveat ?? null;
  if (caveat !== null) assertSchemaNonEmpty(caveat, "source schema caveat");
  return Object.freeze({
    identity,
    summary: assertSchemaNonEmpty(fields.summary, "source schema summary"),
    facts: Object.freeze([...facts]),
    caveat,
  });
}

export type SourceSchemaCatalog = SchemaCatalog<SourceSchemaPackage>;

/** Build an immutable catalog of source schema packages. */
export function makeSourceSchemaCatalog(
  packages: readonly SourceSchemaPackage[],
): SourceSchemaCatalog {
  return makeSchemaCatalog(packages, "source");
}

/**
 * Resolve a source format (optionally pinned to a version) to exactly one
 * versioned description, or an explicit typed refusal. An unknown format or an
 * unknown version is NEVER guessed at.
 */
export function resolveSourceSchema(
  catalog: SourceSchemaCatalog,
  kind: string,
  schemaVersion?: string,
): SchemaResolution<SourceSchemaPackage> {
  return catalog.resolve(kind, schemaVersion);
}

/**
 * The `{ kind: schemaVersion }` map a pack identity carries for its import
 * schemas. Built from the packages — the pack never re-declares a version.
 */
export function sourceSchemaVersionMap(
  packages: readonly SourceSchemaPackage[],
): Readonly<Record<string, string>> {
  return schemaVersionMap(packages, "source");
}
