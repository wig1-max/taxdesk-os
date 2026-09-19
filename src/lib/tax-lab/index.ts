/**
 * TaxDesk OS — Synthetic Case Laboratory (Wave 2, K3-20).
 *
 * PURE TYPESCRIPT ONLY — no React, Next.js, Supabase, env/config or route
 * imports anywhere under `src/lib/tax-lab/*`.
 *
 * The laboratory is a TEST/DESIGN instrument, not a production surface. Nothing
 * in `src/app/*` or `src/components/*` imports it. It exists so a whole tax case
 * can be declared as versioned data, run deterministically **through a resolved
 * tax pack**, and checked with every material number traced to the versioned rule
 * and pack version that produced it.
 *
 * Design note: the k3-synthetic-case-laboratory design notes.
 */

export {
  TAX_LAB_FIXTURE_FORMAT_VERSION,
  assertSyntheticOnly,
  declaredLedgerFacts,
  makeExpectedOutput,
  makeSyntheticCaseFixture,
  type DeclaredLedgerFact,
  type ExpectedMaterialOutput,
  type ExpectedOutputTrace,
  type ExpectedUnsupportedFact,
  type ExpectedValidationFinding,
  type ExpectedWithheldFact,
  type SyntheticCaseFixture,
  type TaxLabFixtureFormatVersion,
} from "./fixture";

export {
  EVIDENCE_ACCEPTANCE_STATES,
  EVIDENCE_KINDS,
  LEDGER_FACT_KINDS,
  TAX_LAB_EVIDENCE_FORMAT_VERSION,
  describeEvidence,
  evidenceDocument,
  evidenceSourceType,
  isAcceptedEvidence,
  makeDocumentEvidence,
  makeStaffAttestedEvidence,
  type DocumentBackedEvidence,
  type EvidenceAcceptanceState,
  type EvidenceKind,
  type LedgerFactEvidence,
  type LedgerFactKind,
  type StaffAttestedEvidence,
  type SyntheticEvidenceDocument,
  type TaxLabEvidenceFormatVersion,
} from "./evidence";

export {
  MATERIAL_OUTPUT_IDS,
  isMaterialOutputId,
  materialOutputKind,
  materialOutputSourceTags,
  readMaterialOutput,
  type ComputedCaseOutputs,
  type MaterialOutputId,
  type MaterialOutputKind,
  type MaterialOutputValue,
} from "./material-outputs";

export {
  describeFixtureRun,
  runSyntheticCaseFixture,
  runSyntheticCaseFixtureWithDefaultRegistry,
  type BlockedFact,
  type ContributingFact,
  type ExpectationCheck,
  type FixtureFailure,
  type FixtureFailureKind,
  type FixtureRunOutcome,
  type FixtureRunResult,
  type ValidationFindingCheck,
  type WithheldFact,
} from "./harness";

export { SEEDED_CASE_FIXTURES } from "./fixtures/ay-2026-27-golden";

export {
  ENGINE_VALIDATION_CODES,
  RUNNER_VALIDATION_CODES,
  buildWave2CoverageReport,
  type Wave2CoverageReport,
} from "./coverage-report";
