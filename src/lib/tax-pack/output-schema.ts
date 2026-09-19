/**
 * TaxDesk OS — Versioned Tax Pack: OUTPUT schema packages (Wave 1, K3-14).
 *
 * PURE TYPESCRIPT ONLY (see identity.ts for the boundary rules).
 *
 * An **output schema package** is the versioned description of ONE artifact
 * TaxDesk OS produces — the stored computation snapshot, the client computation
 * sheet, and (planned) a draft-return payload for the filing bridge. It answers
 * *"what shape does this artifact have, which revision of that shape is this,
 * and who produces it?"*
 *
 * It is NOT a renderer, a serializer, or a validator, and it does not define a
 * government file format. Nothing in K3-14 produces or consumes an artifact
 * through this module; it is the boundary a future writer must declare against.
 *
 * The sections below are TRANSCRIBED from what the repository already produces
 * (`src/app/actions/tax-computation.ts` for the snapshot payload,
 * `src/lib/pdf/templates.tsx` for the computation sheet). A planned artifact
 * that nothing produces yet declares NO sections and carries a caveat rather
 * than an invented shape.
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
 * The artifacts the product produces (or has an explicitly planned boundary
 * for). Keys are a stable contract — a pack identity names them.
 */
export const OUTPUT_ARTIFACT_KINDS = [
  /** `tax_computation_snapshots.input_snapshot` + `.output_snapshot`. */
  "computation_snapshot",
  /** The client-facing `itr_computation` PDF. */
  "computation_sheet",
  /** Planned: the filing-bridge draft-return payload (Wave 6). Nothing produces it. */
  "draft_return_payload",
] as const;
export type OutputArtifactKind = (typeof OUTPUT_ARTIFACT_KINDS)[number];

/**
 * One top-level section of an artifact. `producedBy` names the repository module
 * that writes it, so a description can be checked against the code rather than
 * believed.
 */
export interface OutputSectionSpec {
  readonly key: string;
  readonly label: string;
  readonly producedBy: string;
}

/** The versioned description of one produced artifact. */
export interface OutputSchemaPackage {
  readonly identity: SchemaPackageIdentity<OutputArtifactKind>;
  readonly summary: string;
  /** Sections the artifact carries. Empty for a planned artifact. */
  readonly sections: readonly OutputSectionSpec[];
  /** Documented reason the description is incomplete, or null. */
  readonly caveat: string | null;
}

/** Construct a validated, frozen output-section spec. */
export function makeOutputSectionSpec(fields: {
  key: string;
  label: string;
  producedBy: string;
}): OutputSectionSpec {
  return Object.freeze({
    key: assertSchemaNonEmpty(fields.key, "output section key"),
    label: assertSchemaNonEmpty(fields.label, "output section label"),
    producedBy: assertSchemaNonEmpty(fields.producedBy, "output section producedBy"),
  });
}

/** Construct a validated, frozen output schema package. Duplicate sections are refused. */
export function makeOutputSchemaPackage(fields: {
  artifact: OutputArtifactKind;
  schemaVersion: string;
  status: SchemaPackageStatus;
  summary: string;
  sections?: readonly OutputSectionSpec[];
  caveat?: string | null;
}): OutputSchemaPackage {
  const artifact = assertSchemaEnum(fields.artifact, OUTPUT_ARTIFACT_KINDS, "output artifact kind");
  // `artifact` is enum-validated above, so the identity comes back narrowed to
  // `SchemaPackageIdentity<OutputArtifactKind>` — no assertion required.
  const identity = makeSchemaPackageIdentity({
    key: artifact,
    schemaVersion: fields.schemaVersion,
    status: fields.status,
  });
  const sections = fields.sections ?? [];
  const seen = new Set<string>();
  for (const section of sections) {
    if (seen.has(section.key)) {
      throw new Error(
        `Output schema ${artifact} declares section ${JSON.stringify(section.key)} more than once`,
      );
    }
    seen.add(section.key);
  }
  const caveat = fields.caveat ?? null;
  if (caveat !== null) assertSchemaNonEmpty(caveat, "output schema caveat");
  return Object.freeze({
    identity,
    summary: assertSchemaNonEmpty(fields.summary, "output schema summary"),
    sections: Object.freeze([...sections]),
    caveat,
  });
}

export type OutputSchemaCatalog = SchemaCatalog<OutputSchemaPackage>;

/** Build an immutable catalog of output schema packages. */
export function makeOutputSchemaCatalog(
  packages: readonly OutputSchemaPackage[],
): OutputSchemaCatalog {
  return makeSchemaCatalog(packages, "output");
}

/**
 * Resolve an artifact (optionally pinned to a version) to exactly one versioned
 * description, or an explicit typed refusal. Never guessed at, never defaulted
 * to "the latest".
 */
export function resolveOutputSchema(
  catalog: OutputSchemaCatalog,
  artifact: string,
  schemaVersion?: string,
): SchemaResolution<OutputSchemaPackage> {
  return catalog.resolve(artifact, schemaVersion);
}

/**
 * The `{ artifact: schemaVersion }` map a pack identity carries for its output
 * schemas. Built from the packages — the pack never re-declares a version.
 */
export function outputSchemaVersionMap(
  packages: readonly OutputSchemaPackage[],
): Readonly<Record<string, string>> {
  return schemaVersionMap(packages, "output");
}
