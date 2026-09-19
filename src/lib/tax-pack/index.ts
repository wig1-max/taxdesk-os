/**
 * TaxDesk OS — Versioned Tax Pack foundation (Wave 1, K3-10).
 *
 * PURE TYPESCRIPT ONLY. Public barrel for the tax-pack contracts, in-memory
 * registry, deterministic resolver, lifecycle, and (K3-12) the per-case
 * resolution authority. As of K3-11 the AY 2026-27 pack carries a concrete
 * engine binding; as of K3-12 the snapshot / validation-run rules versions
 * stored on a case are derived from the pack that `case-pack.ts` resolves for
 * it, and the readiness freshness reader compares against that same version.
 * The engine's compute/validate FUNCTIONS are still called directly by those
 * callers (decision D8 stands) — K3-12 binds versions, not call sites.
 *
 * K3-13 adds official-source PROVENANCE per rule, the evidence-backed
 * CA-VERIFICATION workflow, one canonical verification-state reader, and a
 * consumable reliance blocker. No pack is `ca_verified`: the shipped AY pack
 * declares its sources and its `TODO(CA-verify)` caveats truthfully and stays
 * `draft`.
 *
 * K3-14 adds the SOURCE- and OUTPUT-SCHEMA package boundaries — versioned,
 * identity-bearing descriptions of the external evidence formats the product may
 * later read and of the artifacts it produces, each versioned independently of
 * the computation rules. The AY pack's `sourceSchemaVersions` /
 * `outputSchemaVersions` are derived from those packages. No parser, importer or
 * renderer exists — these are boundaries, not ingestion (Wave 3).
 *
 * K3-15 registers the SECOND statutory world as an explicit identity-only stub
 * (`TY_2026_27_STUB_PACK` — Income-tax Act, 2025 / tax years / SAHAJ (ITR-1)
 * under Income-tax Rules, 2026 rule 164; this line read "Form 168" until
 * `D301` found that is the Annual Information Statement form). It
 * implements no 2025-Act rule and carries no computation binding, so it refuses
 * through the existing paths: `unbound` from `bindTaxPackToCase` and
 * `unverified` from `resolveTaxPackForReliance`. Both worlds now coexist in the
 * default registry and resolve deterministically to exactly one pack each.
 *
 * See the k3-tax-pack-contracts design notes for the contract overview.
 */

export {
  type Jurisdiction,
  type TaxLaw,
  type PeriodKind,
  type TaxPackStatus,
  type TaxPackCoordinates,
  type TaxPackIdentity,
  JURISDICTIONS,
  TAX_LAWS,
  PERIOD_KINDS,
  TAX_PACK_STATUSES,
  makeTaxPackIdentity,
  taxPackCoordinates,
  formatTaxPackKey,
  parseTaxPackKey,
  taxPackKey,
  sameTaxPackCoordinates,
} from "./identity";

export {
  type TaxPack,
  type TaxPackComputation,
  type TaxPackComputationBinding,
  makeTaxPack,
  taxPackComputation,
  taxPackProvenance,
  taxPackRateParameters,
} from "./pack";

export {
  availableFrom,
  withheldBecause,
  uncitedAvailableParameterIds,
} from "./packs/rate-parameters";
export { AY_2026_27_RATE_PARAMETERS } from "./packs/ay-2026-27-rate-parameters";
export { TY_2026_27_RATE_PARAMETERS } from "./packs/ty-2026-27-rate-parameters";

export {
  type OfficialSourceKind,
  type IssuingAuthority,
  type OfficialSourceReference,
  type RuleProvenance,
  type TaxPackProvenance,
  OFFICIAL_SOURCE_KINDS,
  ISSUING_AUTHORITIES,
  makeOfficialSourceReference,
  makeRuleProvenance,
  makeTaxPackProvenance,
  findRuleProvenance,
  taxPackSourceIds,
} from "./provenance";

export {
  type RuleVerificationRecord,
  type RuleVerificationState,
  type TaxPackVerificationAssessment,
  makeRuleVerificationRecord,
  assessTaxPackVerification,
  verifyTaxPackWithEvidence,
} from "./verification";

export {
  type TaxPackVerificationState,
  type TaxPackBlockerCode,
  type TaxPackRelianceBlocker,
  TAX_PACK_BLOCKER_CODES,
  describeTaxPackVerification,
  taxPackRelianceBlocker,
  defaultTaxPackRelianceBlocker,
} from "./verification-state";

export {
  type SchemaPackageStatus,
  type SchemaPackageIdentity,
  type SchemaPackageLike,
  type SchemaResolution,
  type SchemaCatalog,
  SCHEMA_PACKAGE_STATUSES,
  makeSchemaPackageIdentity,
  formatSchemaPackageKey,
  makeSchemaCatalog,
  schemaVersionMap,
} from "./schema-package";

export {
  type SourceSchemaKind,
  type SourceFactArea,
  type SourceFactSpec,
  type SourceSchemaPackage,
  type SourceSchemaCatalog,
  SOURCE_SCHEMA_KINDS,
  SOURCE_FACT_AREAS,
  makeSourceFactSpec,
  makeSourceSchemaPackage,
  makeSourceSchemaCatalog,
  resolveSourceSchema,
  sourceSchemaVersionMap,
} from "./source-schema";

export {
  type OutputArtifactKind,
  type OutputSectionSpec,
  type OutputSchemaPackage,
  type OutputSchemaCatalog,
  OUTPUT_ARTIFACT_KINDS,
  makeOutputSectionSpec,
  makeOutputSchemaPackage,
  makeOutputSchemaCatalog,
  resolveOutputSchema,
  outputSchemaVersionMap,
} from "./output-schema";

export { type TaxPackRegistry, createTaxPackRegistry } from "./registry";

export {
  type TaxPackSelector,
  type TaxPackResolution,
  type TaxPackReliance,
  resolveTaxPack,
  resolveTaxPackForReliance,
} from "./resolver";

export {
  type LifecycleTransition,
  canTransition,
  verifyTaxPack,
  retireTaxPack,
  isRelianceReady,
} from "./lifecycle";

export {
  type TaxCaseStatutoryContext,
  type TaxCasePackVersions,
  type TaxCasePackBinding,
  periodKindForLaw,
  taxCaseStatutoryContext,
  storedTaxPackKeyForLaw,
  taxCasePackSelector,
  taxPackVersions,
  bindTaxPackToCase,
  bindDefaultTaxPackToCase,
} from "./case-pack";

export { AY_2026_27_PACK, AY_2026_27_PACK_IDENTITY } from "./packs/ay-2026-27";
export {
  AY_2026_27_V0_PACK,
  AY_2026_27_V0_PACK_IDENTITY,
} from "./packs/ay-2026-27-v0";
export {
  TY_2026_27_STUB_PACK,
  TY_2026_27_PACK_IDENTITY,
  TY_2026_27_PERIOD,
  TY_2026_27_RULES_VERSION,
} from "./packs/ty-2026-27";
export { AY_2026_27_PACK_PROVENANCE } from "./packs/ay-2026-27-provenance";
export { TY_2026_27_PACK_PROVENANCE } from "./packs/ty-2026-27-provenance";
export {
  AY_2026_27_SOURCE_SCHEMAS,
  AY_2026_27_OUTPUT_SCHEMAS,
  AY_2026_27_SOURCE_SCHEMA_CATALOG,
  AY_2026_27_OUTPUT_SCHEMA_CATALOG,
  AY_2026_27_SOURCE_SCHEMA_VERSIONS,
  AY_2026_27_OUTPUT_SCHEMA_VERSIONS,
} from "./packs/ay-2026-27-schemas";

export { createDefaultTaxPackRegistry } from "./registry-default";
