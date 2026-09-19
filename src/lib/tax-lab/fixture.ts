/**
 * TaxDesk OS — Synthetic Case Laboratory: the FIXTURE contract
 * (Wave 2, K3-20).
 *
 * PURE TYPESCRIPT ONLY (see material-outputs.ts for the boundary rules).
 *
 * A **synthetic case fixture** is a declarative, versioned description of a whole
 * tax case: the statutory coordinates it resolves against (so it binds a versioned
 * PACK, never an engine import), the ledger rows and case metadata in exactly the
 * shapes `computation-adapter.ts` already consumes, and the material outputs it
 * expects.
 *
 * Four properties are structural, not conventional:
 *
 * 0. **Every declared fact carries its evidence** (`K3-21`). A fixture declares
 *    exactly one `LedgerFactEvidence` record per ledger row — no row may be
 *    un-evidenced and no record may name a row that does not exist — and the
 *    record is cross-checked against the row it backs, so it cannot claim a
 *    document the row does not carry. Only `accepted` evidence reaches a
 *    computation; the harness withholds the rest.
 * 1. **Traceability is data, not prose.** Every expectation names the pack rule
 *    ids it derives from and the pack `computationRulesVersion` that produced it.
 *    The harness validates those ids against the resolved pack's own provenance,
 *    so a failure says *which rule under which pack version moved*.
 * 2. **Unverified values are marked.** Every rule the AY 2026-27 pack declares
 *    carries a `TODO(CA-verify)` caveat, so every expected number here is derived
 *    from an UNVERIFIED rule. A fixture must say so (`rulesUnverified`), and the
 *    harness cross-checks the claim against the pack's provenance + lifecycle
 *    status — nobody can quietly present a laboratory number as verified.
 * 3. **Synthetic identities only.** Construction scans every string in the
 *    fixture and refuses PAN- or Aadhaar-shaped values. The laboratory never
 *    holds anything that could be real-client PII.
 *
 * Fixtures declare EXPECTATIONS. They never declare tax outcomes as truth: every
 * seeded value is transcribed from the engine's own current behaviour and is
 * cross-checked against the pre-existing engine golden suites.
 */

import type { CaseMeta, LedgerRows } from "@/lib/tax-desk/computation-adapter";
import type { TaxCaseStatutoryContext } from "@/lib/tax-pack/case-pack";
import type { MappingWarningCode } from "@/lib/tax-desk/computation-adapter";
import type { ValidationArea, ValidationSeverity } from "@/lib/tax-engine/ay-2026-27/types";
import {
  evidenceDocument,
  evidenceSourceType,
  isAcceptedEvidence,
  type EvidenceAcceptanceState,
  type LedgerFactEvidence,
  type LedgerFactKind,
} from "./evidence";
import {
  isMaterialOutputId,
  type MaterialOutputId,
  type MaterialOutputValue,
} from "./material-outputs";

/**
 * The fixture FORMAT version — the laboratory's own contract version, versioned
 * separately from any tax pack (a fixture's shape may change without a rule
 * changing, and vice versa).
 *
 * **V1 → V2 (`K3-21`).** A deliberate, incompatible bump: `evidence` became a
 * required part of the contract (one record per ledger row, complete both ways),
 * so no V1 fixture with a non-empty ledger is a valid V2 fixture. Expectable
 * validation findings (`expectedFindings`) and declared withheld facts
 * (`expectedWithheld`) arrived in the same bump.
 */
export const TAX_LAB_FIXTURE_FORMAT_VERSION = "TAX_LAB_FIXTURE_V2";
export type TaxLabFixtureFormatVersion = typeof TAX_LAB_FIXTURE_FORMAT_VERSION;

/**
 * Where an expected value comes from: the versioned rules that produce it and
 * the pack version under which it was recorded.
 */
export interface ExpectedOutputTrace {
  /**
   * Rule ids from the governing pack's provenance (e.g. "slab_rates").
   * Validated by the harness against the resolved pack — an unknown id is a
   * typed failure, not a silently-ignored label.
   *
   * May be empty ONLY for an `input_projection` output (see
   * `material-outputs.ts`). A `rule_derived` output citing nothing is refused as
   * `untraced_output` — this is ENFORCED by the harness, not a convention.
   */
  readonly ruleIds: readonly string[];
  /** The pack `computationRulesVersion` this value was recorded under. */
  readonly packComputationRulesVersion: string;
  /**
   * TRUE when the value derives from a rule carrying an unresolved
   * `TODO(CA-verify)` caveat, or from a pack that is not `ca_verified`.
   * Cross-checked by the harness — a fixture cannot understate it.
   */
  readonly rulesUnverified: boolean;
}

/** One pinned material output. */
export interface ExpectedMaterialOutput {
  readonly outputId: MaterialOutputId;
  readonly expected: MaterialOutputValue;
  readonly trace: ExpectedOutputTrace;
}

/**
 * A fact the fixture deliberately declares that the engine does NOT support.
 * Declared per ledger row so the harness can itemise them rather than reporting
 * a bare count.
 */
export interface ExpectedUnsupportedFact {
  readonly code: MappingWarningCode;
  readonly ledgerId: string;
  readonly entryType: string;
}

/**
 * A fact the fixture deliberately declares WITHOUT accepted evidence. The engine
 * may well support it — it is withheld because nobody accepted what backs it.
 * Declared per ledger row so the harness itemises the work rather than reporting
 * a count.
 */
export interface ExpectedWithheldFact {
  readonly ledgerId: string;
  readonly ledgerKind: LedgerFactKind;
  readonly acceptance: Exclude<EvidenceAcceptanceState, "accepted">;
}

/**
 * A validation finding the fixture requires the case to raise, pinned by CODE
 * and SEVERITY — never by message text, which is prose and may be reworded
 * without any rule moving.
 */
export interface ExpectedValidationFinding {
  readonly code: string;
  readonly severity: ValidationSeverity;
  readonly area: ValidationArea;
  /** The pack `validationRulesVersion` this finding was recorded under. */
  readonly packValidationRulesVersion: string;
}

/** A declarative, versioned synthetic tax case. */
export interface SyntheticCaseFixture {
  readonly formatVersion: TaxLabFixtureFormatVersion;
  /** Stable id, unique within a suite. Used in every failure message. */
  readonly id: string;
  /** What the case is and why it exists. Human-readable, never a rule restatement. */
  readonly description: string;
  /** The statutory coordinates the case resolves a PACK against. */
  readonly statutory: TaxCaseStatutoryContext;
  /** Ledger rows in the shapes `buildEngineInput` consumes. */
  readonly ledger: LedgerRows;
  /** Case metadata in the shape `buildEngineInput` consumes. */
  readonly caseMeta: CaseMeta;
  /**
   * The evidence behind every declared ledger row — exactly one record per row,
   * complete in both directions (enforced at construction). This is what makes
   * "every material output traces to accepted evidence" checkable rather than
   * asserted: there is no row the laboratory cannot answer for.
   */
  readonly evidence: readonly LedgerFactEvidence[];
  /** Pinned material outputs. May be empty for a fixture that only pins refusal. */
  readonly expectations: readonly ExpectedMaterialOutput[];
  /** Facts the fixture deliberately declares as unsupported. Empty for a golden-path case. */
  readonly expectedUnsupported: readonly ExpectedUnsupportedFact[];
  /** Facts the fixture deliberately declares as lacking accepted evidence. */
  readonly expectedWithheld: readonly ExpectedWithheldFact[];
  /**
   * Validation findings the case must raise. Matched by code EXACTLY both ways —
   * an undeclared finding is a surprise, and a declared-but-absent one means the
   * fixture no longer proves the work it claims to prove.
   */
  readonly expectedFindings: readonly ExpectedValidationFinding[];
  /**
   * The pack binding the fixture expects. `"bound"` means a governing pack with
   * a computation surface must resolve; `"refused"` means the fixture exists to
   * prove the statutory world fails safe.
   */
  readonly expectedBinding: "bound" | "refused";
}

// ---------------------------------------------------------------------------
// Synthetic-identity guard
// ---------------------------------------------------------------------------

/** PAN shape: five letters, four digits, one letter. */
const PAN_SHAPE = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/;
/** Aadhaar shape: twelve digits, optionally grouped in fours. */
const AADHAAR_SHAPE = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/;

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, out);
  }
}

/**
 * Refuse any fixture carrying a PAN- or Aadhaar-shaped string. The laboratory is
 * synthetic-only; a real identifier must never reach it, not even as a "sample".
 */
export function assertSyntheticOnly(fixture: unknown, fixtureId: string): void {
  const strings: string[] = [];
  collectStrings(fixture, strings);
  for (const s of strings) {
    if (PAN_SHAPE.test(s)) {
      throw new Error(
        `Fixture ${JSON.stringify(fixtureId)} contains a PAN-shaped string; the case laboratory is synthetic-only`,
      );
    }
    if (AADHAAR_SHAPE.test(s)) {
      throw new Error(
        `Fixture ${JSON.stringify(fixtureId)} contains an Aadhaar-shaped string; the case laboratory is synthetic-only`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Constructors (validating + freezing)
// ---------------------------------------------------------------------------

function assertNonEmpty(value: string | undefined, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Fixture ${field} must be a non-empty string`);
  }
  return value;
}

/** Construct a validated, frozen expectation. Rejects an unknown output id. */
export function makeExpectedOutput(fields: {
  outputId: string;
  expected: MaterialOutputValue;
  trace: ExpectedOutputTrace;
}): ExpectedMaterialOutput {
  if (!isMaterialOutputId(fields.outputId)) {
    throw new Error(
      `Unknown material output id: ${JSON.stringify(fields.outputId)} (see MATERIAL_OUTPUT_IDS)`,
    );
  }
  const { ruleIds, packComputationRulesVersion, rulesUnverified } = fields.trace;
  assertNonEmpty(packComputationRulesVersion, "trace.packComputationRulesVersion");
  if (typeof rulesUnverified !== "boolean") {
    throw new Error("Fixture trace.rulesUnverified must be an explicit boolean");
  }
  const seen = new Set<string>();
  for (const ruleId of ruleIds) {
    assertNonEmpty(ruleId, "trace.ruleIds entry");
    if (seen.has(ruleId)) {
      throw new Error(`Expectation ${fields.outputId} cites rule ${JSON.stringify(ruleId)} twice`);
    }
    seen.add(ruleId);
  }
  return Object.freeze({
    outputId: fields.outputId,
    expected: fields.expected,
    trace: Object.freeze({
      ruleIds: Object.freeze([...ruleIds]),
      packComputationRulesVersion,
      rulesUnverified,
    }),
  });
}

/**
 * Every declared ledger row, flattened with the kind and the identifiers an
 * evidence record is cross-checked against. Pure projection — reads the row
 * shapes `computation-adapter.ts` already defines and derives nothing.
 */
export interface DeclaredLedgerFact {
  readonly ledgerId: string;
  readonly ledgerKind: LedgerFactKind;
  readonly sourceType: string;
  readonly sourceDocumentId: string | null;
  readonly proofDocumentId: string | null;
}

export function declaredLedgerFacts(ledger: LedgerRows): DeclaredLedgerFact[] {
  const facts: DeclaredLedgerFact[] = [];
  for (const r of ledger.income) {
    facts.push({
      ledgerId: r.id,
      ledgerKind: "income",
      sourceType: r.source_type,
      sourceDocumentId: r.source_document_id ?? null,
      proofDocumentId: null,
    });
  }
  for (const r of ledger.taxPaid) {
    facts.push({
      ledgerId: r.id,
      ledgerKind: "tax_paid",
      sourceType: r.source_type,
      sourceDocumentId: r.source_document_id ?? null,
      proofDocumentId: null,
    });
  }
  for (const r of ledger.deductions) {
    facts.push({
      ledgerId: r.id,
      ledgerKind: "deduction",
      sourceType: r.source_type,
      sourceDocumentId: r.source_document_id ?? null,
      proofDocumentId: r.proof_case_document_id ?? null,
    });
  }
  for (const r of ledger.capitalGains) {
    facts.push({
      ledgerId: r.id,
      ledgerKind: "capital_gain",
      sourceType: r.source_type,
      sourceDocumentId: r.source_document_id ?? null,
      proofDocumentId: null,
    });
  }
  // K4-06: house property — optional on `LedgerRows` (default `[]`), so a
  // fixture predating this category keeps working unchanged.
  for (const r of ledger.housePropertyEntries ?? []) {
    facts.push({
      ledgerId: r.id,
      ledgerKind: "house_property",
      sourceType: r.source_type,
      sourceDocumentId: r.source_document_id ?? null,
      proofDocumentId: r.proof_case_document_id ?? null,
    });
  }
  // K4-14: books-based business/profession — optional on `LedgerRows` (default
  // `[]`). Enumerated EXPLICITLY, like every kind above it: this function lists
  // its fields rather than iterating them, which is exactly how K4-06's new
  // house-property field was once silently dropped here. Adding the kind in the
  // same change as the ledger category is the whole remedy.
  for (const r of ledger.businessBooksEntries ?? []) {
    facts.push({
      ledgerId: r.id,
      ledgerKind: "business_books",
      sourceType: r.source_type,
      sourceDocumentId: r.source_document_id ?? null,
      proofDocumentId: r.proof_case_document_id ?? null,
    });
  }
  // K4-10: brought-forward capital losses — optional on `LedgerRows` (default
  // `[]`), so every fixture predating this category keeps working unchanged.
  for (const r of ledger.broughtForwardLosses ?? []) {
    facts.push({
      ledgerId: r.id,
      ledgerKind: "brought_forward_loss",
      sourceType: r.source_type,
      sourceDocumentId: r.source_document_id ?? null,
      proofDocumentId: r.proof_case_document_id ?? null,
    });
  }
  return facts;
}

/**
 * Refuse an evidence record that contradicts the row it backs. Without this the
 * evidence model would be decoration: a fixture could claim "backed by Form 16"
 * for a row that carries no document at all, and the laboratory's central
 * `K3-21` claim would hold only by convention.
 */
function assertEvidenceMatchesRow(
  fixtureId: string,
  evidence: LedgerFactEvidence,
  fact: DeclaredLedgerFact,
): void {
  const where = `Fixture ${JSON.stringify(fixtureId)} evidence for ${JSON.stringify(evidence.ledgerId)}`;
  if (evidence.ledgerKind !== fact.ledgerKind) {
    throw new Error(
      `${where} declares ledgerKind ${evidence.ledgerKind}, but that row is a ${fact.ledgerKind} row`,
    );
  }
  if (evidenceSourceType(evidence) !== fact.sourceType) {
    throw new Error(
      `${where} declares sourceType ${JSON.stringify(evidenceSourceType(evidence))}, but the row declares ${JSON.stringify(fact.sourceType)}`,
    );
  }
  const doc = evidenceDocument(evidence);
  if (evidence.kind === "source_document") {
    if (fact.sourceDocumentId !== doc?.documentId) {
      throw new Error(
        `${where} claims source document ${JSON.stringify(doc?.documentId)}, but the row's source_document_id is ${JSON.stringify(fact.sourceDocumentId)}`,
      );
    }
  } else if (evidence.kind === "proof_document") {
    if (fact.proofDocumentId !== doc?.documentId) {
      throw new Error(
        `${where} claims proof document ${JSON.stringify(doc?.documentId)}, but the row's proof document id is ${JSON.stringify(fact.proofDocumentId)}`,
      );
    }
  } else if (fact.sourceDocumentId !== null || fact.proofDocumentId !== null) {
    throw new Error(
      `${where} is staff-attested (no document), but the row points at a document; use source_document / proof_document evidence instead`,
    );
  }
}

/** Construct a validated, frozen synthetic case fixture. */
export function makeSyntheticCaseFixture(fields: {
  id: string;
  description: string;
  statutory: TaxCaseStatutoryContext;
  ledger: LedgerRows;
  caseMeta: CaseMeta;
  evidence?: readonly LedgerFactEvidence[];
  expectations?: readonly ExpectedMaterialOutput[];
  expectedUnsupported?: readonly ExpectedUnsupportedFact[];
  expectedWithheld?: readonly ExpectedWithheldFact[];
  expectedFindings?: readonly ExpectedValidationFinding[];
  expectedBinding?: "bound" | "refused";
}): SyntheticCaseFixture {
  const id = assertNonEmpty(fields.id, "id");
  // Scan for PAN/Aadhaar shapes BEFORE any structural work: a real identifier
  // must be refused on the way in, whatever else is wrong with the fixture.
  assertSyntheticOnly(fields, id);
  const description = assertNonEmpty(fields.description, "description");
  const evidence = fields.evidence ?? [];
  const expectations = fields.expectations ?? [];
  const expectedUnsupported = fields.expectedUnsupported ?? [];
  const expectedWithheld = fields.expectedWithheld ?? [];
  const expectedFindings = fields.expectedFindings ?? [];

  // --- Evidence must cover every declared row, exactly once, both ways ------
  const facts = declaredLedgerFacts(fields.ledger);
  const factsById = new Map<string, DeclaredLedgerFact>();
  for (const fact of facts) {
    if (factsById.has(fact.ledgerId)) {
      throw new Error(
        `Fixture ${JSON.stringify(id)} declares ledger row id ${JSON.stringify(fact.ledgerId)} more than once; laboratory ledger ids must be unique across all four ledgers`,
      );
    }
    factsById.set(fact.ledgerId, fact);
  }

  const evidenceById = new Map<string, LedgerFactEvidence>();
  for (const record of evidence) {
    if (evidenceById.has(record.ledgerId)) {
      throw new Error(
        `Fixture ${JSON.stringify(id)} declares evidence for ${JSON.stringify(record.ledgerId)} twice`,
      );
    }
    const fact = factsById.get(record.ledgerId);
    if (fact === undefined) {
      throw new Error(
        `Fixture ${JSON.stringify(id)} declares evidence for ${JSON.stringify(record.ledgerId)}, which is not a declared ledger row`,
      );
    }
    assertEvidenceMatchesRow(id, record, fact);
    evidenceById.set(record.ledgerId, record);
  }
  for (const fact of facts) {
    if (!evidenceById.has(fact.ledgerId)) {
      throw new Error(
        `Fixture ${JSON.stringify(id)} declares ${fact.ledgerKind} row ${JSON.stringify(fact.ledgerId)} with no evidence; every declared fact must name the evidence behind it`,
      );
    }
  }

  // A declared-withheld fact must actually be unaccepted in the evidence, and
  // vice versa — otherwise the declaration drifts away from what it describes.
  const seenWithheld = new Set<string>();
  for (const declared of expectedWithheld) {
    if (seenWithheld.has(declared.ledgerId)) {
      throw new Error(`Fixture ${JSON.stringify(id)} declares withheld fact ${declared.ledgerId} twice`);
    }
    seenWithheld.add(declared.ledgerId);
    const record = evidenceById.get(declared.ledgerId);
    if (record === undefined) {
      throw new Error(
        `Fixture ${JSON.stringify(id)} declares ${JSON.stringify(declared.ledgerId)} withheld, but no such ledger row exists`,
      );
    }
    if (record.acceptance !== declared.acceptance) {
      throw new Error(
        `Fixture ${JSON.stringify(id)} declares ${JSON.stringify(declared.ledgerId)} withheld as ${declared.acceptance}, but its evidence is ${record.acceptance}`,
      );
    }
    if (declared.ledgerKind !== record.ledgerKind) {
      throw new Error(
        `Fixture ${JSON.stringify(id)} declares ${JSON.stringify(declared.ledgerId)} withheld as a ${declared.ledgerKind} row, but it is a ${record.ledgerKind} row`,
      );
    }
  }
  for (const record of evidence) {
    if (!isAcceptedEvidence(record.acceptance) && !seenWithheld.has(record.ledgerId)) {
      throw new Error(
        `Fixture ${JSON.stringify(id)} carries ${record.acceptance} evidence for ${JSON.stringify(record.ledgerId)} without declaring it withheld; an unaccepted fact must be explicit work`,
      );
    }
  }

  const seenFindings = new Set<string>();
  for (const finding of expectedFindings) {
    assertNonEmpty(finding.code, "expectedFindings[].code");
    assertNonEmpty(finding.packValidationRulesVersion, "expectedFindings[].packValidationRulesVersion");
    if (seenFindings.has(finding.code)) {
      throw new Error(`Fixture ${JSON.stringify(id)} pins validation finding ${finding.code} twice`);
    }
    seenFindings.add(finding.code);
  }

  const seenOutputs = new Set<string>();
  for (const expectation of expectations) {
    if (seenOutputs.has(expectation.outputId)) {
      throw new Error(`Fixture ${JSON.stringify(id)} pins ${expectation.outputId} more than once`);
    }
    seenOutputs.add(expectation.outputId);
  }

  const seenUnsupported = new Set<string>();
  for (const fact of expectedUnsupported) {
    const key = `${fact.code}:${fact.ledgerId}`;
    if (seenUnsupported.has(key)) {
      throw new Error(`Fixture ${JSON.stringify(id)} declares unsupported fact ${key} twice`);
    }
    seenUnsupported.add(key);
  }

  const fixture: SyntheticCaseFixture = Object.freeze({
    formatVersion: TAX_LAB_FIXTURE_FORMAT_VERSION,
    id,
    description,
    statutory: Object.freeze({ ...fields.statutory }),
    // Copied (not deep-frozen): `LedgerRows` declares mutable arrays because
    // that is the shape `buildEngineInput` consumes. Copying is enough to stop a
    // fixture and a caller sharing one array.
    ledger: Object.freeze({
      income: [...fields.ledger.income],
      taxPaid: [...fields.ledger.taxPaid],
      deductions: [...fields.ledger.deductions],
      capitalGains: [...fields.ledger.capitalGains],
      // K4-06: optional on `LedgerRows` — copy only when the fixture declares it.
      ...(fields.ledger.housePropertyEntries
        ? { housePropertyEntries: [...fields.ledger.housePropertyEntries] }
        : {}),
      // K4-14: same optional treatment.
      ...(fields.ledger.businessBooksEntries
        ? { businessBooksEntries: [...fields.ledger.businessBooksEntries] }
        : {}),
      // K4-10: same optional treatment.
      ...(fields.ledger.broughtForwardLosses
        ? { broughtForwardLosses: [...fields.ledger.broughtForwardLosses] }
        : {}),
    }),
    caseMeta: Object.freeze({ ...fields.caseMeta }),
    evidence: Object.freeze([...evidence]),
    expectations: Object.freeze([...expectations]),
    expectedUnsupported: Object.freeze([...expectedUnsupported]),
    expectedWithheld: Object.freeze([...expectedWithheld]),
    expectedFindings: Object.freeze(expectedFindings.map((f) => Object.freeze({ ...f }))),
    expectedBinding: fields.expectedBinding ?? "bound",
  });

  return fixture;
}
