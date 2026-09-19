/**
 * TaxDesk OS — SOURCE + OUTPUT schema packages for the AY 2026-27 pack
 * (Wave 1, K3-14).
 *
 * PURE TYPESCRIPT ONLY. Data only — nothing here parses, maps, renders, or
 * validates anything, and no tax rule, rate, cap or slab is declared or touched.
 *
 * EVERY declaration below is transcribed from what the repository already does:
 *   - source facts  ← `src/lib/tax-desk/validation-runner.ts`
 *                     (`COMPARABLE_SOURCE_PAIRS` + the generic prefilled-vs-AIS
 *                     income-head comparison) and the ledger's `SOURCE_TYPES`;
 *   - output sections ← `src/app/actions/tax-computation.ts` (the stored
 *                     `input_snapshot` / `output_snapshot` payload) and
 *                     `src/lib/pdf/templates.tsx` (`ItrComputationData`).
 *
 * Where the repository models nothing, the package declares NOTHING and carries
 * a caveat. No government file layout has been inspected, so no source package
 * claims a field path, and every source package is `planned` — the product reads
 * none of these formats today (ingestion is Wave 3).
 */

import {
  makeOutputSchemaPackage,
  makeOutputSectionSpec,
  makeOutputSchemaCatalog,
  outputSchemaVersionMap,
  type OutputSchemaCatalog,
  type OutputSchemaPackage,
} from "../output-schema";
import {
  makeSourceFactSpec,
  makeSourceSchemaCatalog,
  makeSourceSchemaPackage,
  sourceSchemaVersionMap,
  type SourceSchemaCatalog,
  type SourceSchemaPackage,
} from "../source-schema";

/**
 * The blanket caveat on every source package: the boundary is versioned, but no
 * specimen of the real format has been inspected, so no field layout is claimed.
 */
const NO_SPECIMEN =
  "No specimen of the official format has been inspected; this package declares a versioned boundary only, never a field layout. Reading it is Wave 3.";

// --- Source (import) schema packages ---------------------------------------

const AIS_SCHEMA: SourceSchemaPackage = makeSourceSchemaPackage({
  kind: "AIS",
  schemaVersion: "AIS_V0_PLANNED",
  status: "planned",
  summary: "Annual Information Statement — third-party reported income and tax-deduction data",
  facts: [
    makeSourceFactSpec({ area: "income", factKey: "salary", label: "Salary (compared against Form 16)" }),
    makeSourceFactSpec({
      area: "tax_paid",
      factKey: "non_salary_tds",
      label: "Non-salary TDS (compared against Form 26AS)",
    }),
  ],
  caveat: `${NO_SPECIMEN} The validation runner additionally compares prefilled JSON against AIS across EVERY income head present on the ledger, so AIS may evidence income heads beyond salary; the repository does not enumerate them, so they are not declared here.`,
});

const FORM_26AS_SCHEMA: SourceSchemaPackage = makeSourceSchemaPackage({
  kind: "26AS",
  schemaVersion: "FORM_26AS_V0_PLANNED",
  status: "planned",
  summary: "Form 26AS — tax credit statement (TDS/TCS/advance and self-assessment tax)",
  facts: [
    makeSourceFactSpec({
      area: "tax_paid",
      factKey: "salary_tds",
      label: "Salary TDS (compared against Form 16)",
    }),
    makeSourceFactSpec({
      area: "tax_paid",
      factKey: "non_salary_tds",
      label: "Non-salary TDS (compared against AIS)",
    }),
  ],
  caveat: NO_SPECIMEN,
});

const FORM16_SCHEMA: SourceSchemaPackage = makeSourceSchemaPackage({
  kind: "Form16",
  schemaVersion: "FORM16_V0_PLANNED",
  status: "planned",
  summary: "Form 16 — employer salary certificate and salary TDS statement",
  facts: [
    makeSourceFactSpec({ area: "income", factKey: "salary", label: "Salary (compared against AIS)" }),
    makeSourceFactSpec({
      area: "tax_paid",
      factKey: "salary_tds",
      label: "Salary TDS (compared against Form 26AS)",
    }),
  ],
  caveat: NO_SPECIMEN,
});

const PREFILLED_JSON_SCHEMA: SourceSchemaPackage = makeSourceSchemaPackage({
  kind: "prefilled_json",
  schemaVersion: "PREFILLED_JSON_V0_PLANNED",
  status: "planned",
  summary: "Portal prefilled return JSON — the pre-populated figures offered at filing time",
  // The runner compares this against AIS across whichever income heads are
  // present; it names no specific head, so none is declared.
  facts: [],
  caveat: `${NO_SPECIMEN} The validation runner compares prefilled JSON against AIS across every income head present on the ledger, but names no specific head, so no fact is declared here rather than guessing one.`,
});

const BROKER_REPORT_SCHEMA: SourceSchemaPackage = makeSourceSchemaPackage({
  kind: "broker_report",
  schemaVersion: "BROKER_REPORT_V0_PLANNED",
  status: "planned",
  summary: "Broker capital-gains / transaction report",
  // Deliberately empty: the validation runner explicitly excludes broker reports
  // from automatic comparison (timing and cost-basis differences are legitimate).
  facts: [],
  caveat: `${NO_SPECIMEN} The validation runner deliberately does NOT auto-compare broker reports against third-party sources (timing and cost-basis differences are legitimate), so the repository models no fact for this format.`,
});

const BANK_CERTIFICATE_SCHEMA: SourceSchemaPackage = makeSourceSchemaPackage({
  kind: "bank_certificate",
  schemaVersion: "BANK_CERTIFICATE_V0_PLANNED",
  status: "planned",
  summary: "Bank interest / TDS certificate",
  facts: [],
  caveat: `${NO_SPECIMEN} The validation runner deliberately does NOT auto-compare bank certificates against third-party sources, so the repository models no fact for this format.`,
});

/** Every import-schema package the AY 2026-27 pack is assembled with. */
export const AY_2026_27_SOURCE_SCHEMAS: readonly SourceSchemaPackage[] = Object.freeze([
  AIS_SCHEMA,
  FORM_26AS_SCHEMA,
  FORM16_SCHEMA,
  PREFILLED_JSON_SCHEMA,
  BROKER_REPORT_SCHEMA,
  BANK_CERTIFICATE_SCHEMA,
]);

/** Catalog for resolving one of the above (with explicit refusal on an unknown one). */
export const AY_2026_27_SOURCE_SCHEMA_CATALOG: SourceSchemaCatalog =
  makeSourceSchemaCatalog(AY_2026_27_SOURCE_SCHEMAS);

// --- Output schema packages -------------------------------------------------

const SNAPSHOT_WRITER = "src/app/actions/tax-computation.ts";
const PDF_TEMPLATE = "src/lib/pdf/templates.tsx";

const COMPUTATION_SNAPSHOT_SCHEMA: OutputSchemaPackage = makeOutputSchemaPackage({
  artifact: "computation_snapshot",
  schemaVersion: "COMPUTATION_SNAPSHOT_V2",
  status: "supported",
  summary:
    "The immutable computation snapshot stored on tax_computation_snapshots (input_snapshot + output_snapshot)",
  sections: [
    makeOutputSectionSpec({
      key: "input_snapshot.eligibility",
      label: "Provable eligibility at snapshot creation (K.2.8.9A)",
      producedBy: SNAPSHOT_WRITER,
    }),
    makeOutputSectionSpec({
      key: "input_snapshot.summary",
      label: "Adapter summary totals by head",
      producedBy: SNAPSHOT_WRITER,
    }),
    makeOutputSectionSpec({
      key: "input_snapshot.sourceTrace",
      label: "Per-group source traceability (ledger ids, source types, document labels)",
      producedBy: SNAPSHOT_WRITER,
    }),
    makeOutputSectionSpec({
      key: "input_snapshot.warningCodes",
      label: "Distinct adapter mapping-warning codes",
      producedBy: SNAPSHOT_WRITER,
    }),
    makeOutputSectionSpec({
      key: "input_snapshot.excludedLedgerIds",
      label: "Ledger rows excluded from the engine input",
      producedBy: SNAPSHOT_WRITER,
    }),
    makeOutputSectionSpec({
      key: "input_snapshot.engineInputReplay",
      label: "Declared replay scope for the stored notes-free engine input",
      producedBy: SNAPSHOT_WRITER,
    }),
    makeOutputSectionSpec({
      key: "input_snapshot.engineInput",
      label: "Normalized, notes-free engine input",
      producedBy: SNAPSHOT_WRITER,
    }),
    makeOutputSectionSpec({
      key: "output_snapshot.computation",
      label: "Deterministic computation result",
      producedBy: SNAPSHOT_WRITER,
    }),
    makeOutputSectionSpec({
      key: "output_snapshot.comparison",
      label: "Old vs new regime comparison",
      producedBy: SNAPSHOT_WRITER,
    }),
    makeOutputSectionSpec({
      key: "output_snapshot.recommendation",
      label: "ITR-form recommendation",
      producedBy: SNAPSHOT_WRITER,
    }),
  ],
  caveat:
    "Describes the artifact's sections only. Nothing reads this description yet; the snapshot writer builds the payload directly and records its computation-replay scope.",
});

const COMPUTATION_SHEET_SCHEMA: OutputSchemaPackage = makeOutputSchemaPackage({
  artifact: "computation_sheet",
  schemaVersion: "COMPUTATION_SHEET_V1",
  status: "supported",
  summary: "The client-facing draft computation summary PDF (itr_computation template)",
  sections: [
    makeOutputSectionSpec({ key: "ay", label: "Assessment year", producedBy: PDF_TEMPLATE }),
    makeOutputSectionSpec({ key: "regime", label: "Regime preference", producedBy: PDF_TEMPLATE }),
    makeOutputSectionSpec({ key: "incomeHeads", label: "Income heads table", producedBy: PDF_TEMPLATE }),
    makeOutputSectionSpec({ key: "deductions", label: "Deductions table", producedBy: PDF_TEMPLATE }),
    makeOutputSectionSpec({ key: "taxSummary", label: "Tax summary table", producedBy: PDF_TEMPLATE }),
    makeOutputSectionSpec({ key: "notes", label: "Preparer notes", producedBy: PDF_TEMPLATE }),
  ],
  caveat:
    "The rendered document is watermarked DRAFT and carries the preparation-only disclaimers; this description covers its data sections, not its wording.",
});

const DRAFT_RETURN_PAYLOAD_SCHEMA: OutputSchemaPackage = makeOutputSchemaPackage({
  artifact: "draft_return_payload",
  schemaVersion: "DRAFT_RETURN_PAYLOAD_V0_PLANNED",
  status: "planned",
  summary: "Planned: the draft-return payload the validated filing bridge will export",
  // Nothing produces this today. Declaring an invented section map would be
  // fabricated schema — worse than an honest, reported gap.
  sections: [],
  caveat:
    "Nothing produces this artifact today. The section map stays empty until the filing bridge (Wave 6) defines it against a real round-trip fixture.",
});

/** Every output-schema package the AY 2026-27 pack is assembled with. */
export const AY_2026_27_OUTPUT_SCHEMAS: readonly OutputSchemaPackage[] = Object.freeze([
  COMPUTATION_SNAPSHOT_SCHEMA,
  COMPUTATION_SHEET_SCHEMA,
  DRAFT_RETURN_PAYLOAD_SCHEMA,
]);

/** Catalog for resolving one of the above (with explicit refusal on an unknown one). */
export const AY_2026_27_OUTPUT_SCHEMA_CATALOG: OutputSchemaCatalog =
  makeOutputSchemaCatalog(AY_2026_27_OUTPUT_SCHEMAS);

// --- The maps the pack identity carries ------------------------------------

/**
 * `{ kind: schemaVersion }` / `{ artifact: schemaVersion }` derived FROM the
 * packages above, so the pack identity never re-declares a version literal
 * (single source of truth — the same discipline as decision D6).
 */
export const AY_2026_27_SOURCE_SCHEMA_VERSIONS: Readonly<Record<string, string>> =
  sourceSchemaVersionMap(AY_2026_27_SOURCE_SCHEMAS);

export const AY_2026_27_OUTPUT_SCHEMA_VERSIONS: Readonly<Record<string, string>> =
  outputSchemaVersionMap(AY_2026_27_OUTPUT_SCHEMAS);
