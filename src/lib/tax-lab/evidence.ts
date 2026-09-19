/**
 * TaxDesk OS — Synthetic Case Laboratory: the EVIDENCE model
 * (Wave 2, K3-21).
 *
 * PURE TYPESCRIPT ONLY (see material-outputs.ts for the boundary rules).
 *
 * Wave 2's exit gate has two clauses. `K3-20` made the second checkable (*every
 * material output traces to a versioned deterministic rule*). This module exists
 * for the first: **each material output traces to ACCEPTED EVIDENCE.**
 *
 * A ledger row on its own is an assertion. What makes it preparation truth is the
 * evidence behind it plus a human decision to accept that evidence. So every
 * declared fact in a fixture carries a `LedgerFactEvidence` record naming:
 *
 *   - **what backs it** — a synthetic source document, a proof document on file,
 *     or an explicit staff attestation that there is no document at all;
 *   - **its `SourceType`** — the same vocabulary the engine reconciles against;
 *   - **its acceptance state** — `accepted` / `proposed` / `rejected`, with a
 *     mandatory reason whenever it is not accepted.
 *
 * Two properties are structural, not conventional:
 *
 * 1. **Evidence is a versioned concept of its own** (`TAX_LAB_EVIDENCE_V1`),
 *    versioned separately from the fixture format and from any tax pack — how a
 *    fact is evidenced can change without a rule changing, and vice versa.
 * 2. **An evidence record cannot contradict the row it backs.** The kind, source
 *    type and document id are cross-checked against the ledger row at
 *    construction (`fixture.ts`), so "Form 16 backed" can never be claimed for a
 *    row that carries no document.
 *
 * NOT ingestion. Evidence here is *declared* fixture data — no file is parsed,
 * fetched, OCR'd or extracted (Wave 3). Nothing in this module reads a document.
 */

import type { SourceType } from "@/lib/tax-engine/ay-2026-27/types";

/**
 * The evidence model's own contract version. Bump it when the SHAPE of an
 * evidence record changes incompatibly — not when a fixture's numbers move and
 * not when a pack's rules move.
 */
export const TAX_LAB_EVIDENCE_FORMAT_VERSION = "TAX_LAB_EVIDENCE_V1";
export type TaxLabEvidenceFormatVersion = typeof TAX_LAB_EVIDENCE_FORMAT_VERSION;

/** Which ledger a fact lives in. Mirrors the adapter's `SourceTraceGroup` kinds. */
export const LEDGER_FACT_KINDS = [
  "income",
  "tax_paid",
  "deduction",
  "capital_gain",
  "house_property",
  // K4-10: a brought-forward carry-forward record is a declared ledger fact
  // like any other and must carry evidence. Omitting it here would let a
  // fixture declare a prior-year loss with NO evidence record at all, which
  // would quietly hollow out the Wave-2 coverage-both-ways guarantee for
  // exactly the fact class whose provenance matters most.
  "brought_forward_loss",
  // K4-14: a books-based business record is a declared ledger fact like any
  // other and must carry evidence, for the same reason as the line above —
  // and with more force here, because the whole computation rests on the
  // preparer's declaration about the books rather than on anything the engine
  // can check.
  "business_books",
] as const;
export type LedgerFactKind = (typeof LEDGER_FACT_KINDS)[number];

/**
 * Whether the evidence behind a fact has been ACCEPTED by a preparer.
 *
 * - `accepted` — reviewed and taken as preparation truth.
 * - `proposed` — offered (by a document, an import, or an assistant) but not yet
 *   accepted by a human. Rule 5: AI/OCR may only propose.
 * - `rejected` — reviewed and refused.
 *
 * Only `accepted` may reach a computation. `proposed` and `rejected` are
 * withheld by the harness and reported as itemised work.
 */
export const EVIDENCE_ACCEPTANCE_STATES = ["accepted", "proposed", "rejected"] as const;
export type EvidenceAcceptanceState = (typeof EVIDENCE_ACCEPTANCE_STATES)[number];

/** True when this acceptance state may become preparation truth. */
export function isAcceptedEvidence(state: EvidenceAcceptanceState): boolean {
  return state === "accepted";
}

/**
 * How a fact is backed.
 *
 * - `source_document` — read off a source document the case holds (Form 16, AIS,
 *   a broker report…). The row must carry that document id and source type.
 * - `proof_document` — staff-entered, but a proof document is on file backing the
 *   claim (the deduction-proof case: `proof_case_document_id`).
 * - `staff_attested` — staff-entered with NO document at all. Honest by
 *   construction: a fact with nothing behind it says so, rather than borrowing
 *   the appearance of a document.
 */
export const EVIDENCE_KINDS = ["source_document", "proof_document", "staff_attested"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/** A synthetic document. Never a real file, a real path, or a real client's paper. */
export interface SyntheticEvidenceDocument {
  /** The synthetic document id the ledger row points at. */
  readonly documentId: string;
  /** A human label, e.g. "Synthetic Form 16 (employer A)". */
  readonly label: string;
  /** The engine's own source vocabulary — what the document IS. */
  readonly sourceType: SourceType;
}

interface LedgerFactEvidenceBase {
  readonly evidenceFormatVersion: TaxLabEvidenceFormatVersion;
  readonly ledgerKind: LedgerFactKind;
  /** The ledger row this evidence backs. Unique within a fixture. */
  readonly ledgerId: string;
  readonly acceptance: EvidenceAcceptanceState;
  /**
   * Why the evidence is not accepted. REQUIRED for `proposed`/`rejected` and
   * forbidden for `accepted` — an unaccepted fact must always say what work it
   * represents, and an accepted one must not carry a stale excuse.
   */
  readonly acceptanceReason?: string;
}

export interface DocumentBackedEvidence extends LedgerFactEvidenceBase {
  readonly kind: "source_document" | "proof_document";
  readonly document: SyntheticEvidenceDocument;
}

export interface StaffAttestedEvidence extends LedgerFactEvidenceBase {
  readonly kind: "staff_attested";
  /** The engine source type the row declares — `manual` or `adjustment`. */
  readonly sourceType: Extract<SourceType, "manual" | "adjustment">;
}

/** The evidence backing exactly one declared ledger fact. */
export type LedgerFactEvidence = DocumentBackedEvidence | StaffAttestedEvidence;

/** The document behind a fact, or `undefined` when it is staff-attested. */
export function evidenceDocument(
  evidence: LedgerFactEvidence,
): SyntheticEvidenceDocument | undefined {
  return evidence.kind === "staff_attested" ? undefined : evidence.document;
}

/** The engine `SourceType` an evidence record declares, whatever its kind. */
export function evidenceSourceType(evidence: LedgerFactEvidence): SourceType {
  return evidence.kind === "staff_attested" ? evidence.sourceType : evidence.document.sourceType;
}

/** A one-line, PII-free description used in failure messages. */
export function describeEvidence(evidence: LedgerFactEvidence): string {
  const doc = evidenceDocument(evidence);
  const backing = doc ? `${evidence.kind} ${doc.label} (${doc.sourceType})` : `staff-attested (${evidenceSourceType(evidence)})`;
  const reason = evidence.acceptanceReason ? ` — ${evidence.acceptanceReason}` : "";
  return `${evidence.ledgerKind} row ${evidence.ledgerId}: ${backing}, ${evidence.acceptance}${reason}`;
}

// ---------------------------------------------------------------------------
// Constructors (validating + freezing)
// ---------------------------------------------------------------------------

function requireText(value: string | undefined, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Evidence ${field} must be a non-empty string`);
  }
  return value;
}

function validateShared(fields: {
  ledgerKind: LedgerFactKind;
  ledgerId: string;
  acceptance: EvidenceAcceptanceState;
  acceptanceReason?: string;
}): void {
  if (!LEDGER_FACT_KINDS.includes(fields.ledgerKind)) {
    throw new Error(`Evidence ledgerKind ${JSON.stringify(fields.ledgerKind)} is not a ledger kind`);
  }
  requireText(fields.ledgerId, "ledgerId");
  if (!EVIDENCE_ACCEPTANCE_STATES.includes(fields.acceptance)) {
    throw new Error(
      `Evidence acceptance ${JSON.stringify(fields.acceptance)} is not one of ${EVIDENCE_ACCEPTANCE_STATES.join(" / ")}`,
    );
  }
  if (isAcceptedEvidence(fields.acceptance)) {
    if (fields.acceptanceReason !== undefined) {
      throw new Error(
        `Evidence for ${fields.ledgerId} is accepted but carries an acceptanceReason; a reason records why evidence was NOT accepted`,
      );
    }
  } else {
    requireText(fields.acceptanceReason, `acceptanceReason for ${fields.acceptance} row ${fields.ledgerId}`);
  }
}

/** Construct validated, frozen document-backed evidence. */
export function makeDocumentEvidence(fields: {
  kind: "source_document" | "proof_document";
  ledgerKind: LedgerFactKind;
  ledgerId: string;
  document: SyntheticEvidenceDocument;
  acceptance: EvidenceAcceptanceState;
  acceptanceReason?: string;
}): DocumentBackedEvidence {
  validateShared(fields);
  if (fields.kind !== "source_document" && fields.kind !== "proof_document") {
    throw new Error(`Evidence kind ${JSON.stringify(fields.kind)} is not document-backed`);
  }
  requireText(fields.document?.documentId, "document.documentId");
  requireText(fields.document?.label, "document.label");
  requireText(fields.document?.sourceType, "document.sourceType");
  return Object.freeze({
    evidenceFormatVersion: TAX_LAB_EVIDENCE_FORMAT_VERSION,
    kind: fields.kind,
    ledgerKind: fields.ledgerKind,
    ledgerId: fields.ledgerId,
    document: Object.freeze({ ...fields.document }),
    acceptance: fields.acceptance,
    ...(fields.acceptanceReason !== undefined ? { acceptanceReason: fields.acceptanceReason } : {}),
  });
}

/** Construct validated, frozen staff-attested evidence (no document at all). */
export function makeStaffAttestedEvidence(fields: {
  ledgerKind: LedgerFactKind;
  ledgerId: string;
  sourceType: Extract<SourceType, "manual" | "adjustment">;
  acceptance: EvidenceAcceptanceState;
  acceptanceReason?: string;
}): StaffAttestedEvidence {
  validateShared(fields);
  if (fields.sourceType !== "manual" && fields.sourceType !== "adjustment") {
    throw new Error(
      `Staff-attested evidence for ${fields.ledgerId} declares sourceType ${JSON.stringify(fields.sourceType)}; only "manual" / "adjustment" have no document`,
    );
  }
  return Object.freeze({
    evidenceFormatVersion: TAX_LAB_EVIDENCE_FORMAT_VERSION,
    kind: "staff_attested" as const,
    ledgerKind: fields.ledgerKind,
    ledgerId: fields.ledgerId,
    sourceType: fields.sourceType,
    acceptance: fields.acceptance,
    ...(fields.acceptanceReason !== undefined ? { acceptanceReason: fields.acceptanceReason } : {}),
  });
}
