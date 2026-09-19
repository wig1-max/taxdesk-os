/**
 * TaxDesk OS — One-source propose → review → promote workflow (Wave 3, K3-30).
 *
 * PURE TYPESCRIPT ONLY — no React/Next/Supabase/env/route imports.
 *
 * This is the FIRST product surface where an imported fact can become
 * preparation truth, so it stays deliberately narrow (D17 stands): exactly one
 * synthetic Form-16-shaped source, exactly two facts (salary income + salary
 * TDS) — the same two facts `source-schema.ts`'s Form16 package already
 * declares (`income.salary`, `tax_paid.salary_tds`). Nothing here parses,
 * fetches, OCRs, or extracts a document; the "adapter" identity below names a
 * SYNTHETIC, hand-entered candidate — never a real parser — so it can never be
 * mistaken for a verified Form 16 reader.
 *
 * Rule 5 made structural: AI/OCR/staff may PROPOSE only. A proposal is never
 * preparation truth on its own — a human must explicitly accept it, and only
 * an accepted, still-current pair may promote into the ledgers (guarded RPC,
 * `supabase/migrations/20260721120000_source_proposal_workflow.sql`). This
 * module is the single canonical description of that lifecycle; the SQL guard
 * enforces it, and this file's `canTransitionProposalStatus` MUST stay in
 * lock-step with the SQL (proved by `__tests__/source-proposals.test.ts`
 * transcribing the same transition table the migration encodes).
 *
 * Reuses D17's already-declared Form16 facts rather than inventing a field
 * layout: this module names ledger categories (`income.salary`,
 * `tax_paid.salary_tds`), never a coordinate inside a government file.
 */

/** The proposal envelope's own contract version — separate from any tax pack or fixture format. */
export const PROPOSAL_FORMAT_VERSION = "TAX_SOURCE_PROPOSAL_V1";
export type ProposalFormatVersion = typeof PROPOSAL_FORMAT_VERSION;

/**
 * The one source-schema package this narrow slice supports, pinned to the
 * exact version `packs/ay-2026-27-schemas.ts` declares for Form16
 * (`FORM16_V0_PLANNED` — still `planned`; no field layout is claimed by
 * either module). A mismatch is a malformed-version refusal, never a guess.
 */
export const PROPOSAL_SOURCE_SCHEMA_KIND = "Form16" as const;
export const PROPOSAL_SOURCE_SCHEMA_VERSION = "FORM16_V0_PLANNED" as const;

/**
 * The synthetic, hand-entered candidate-fact identity. NOT a parser, NOT OCR,
 * NOT AI — a human declares these values while looking at a synthetic test
 * document, and that declaration only becomes a proposal (never ledger truth)
 * until a separate explicit accept step. A future real extractor would carry
 * its own, differently-named adapter version; this one may never be reused for
 * one.
 */
export const SYNTHETIC_PROPOSAL_ADAPTER_VERSION = "SYNTHETIC_FORM16_PROPOSAL_ADAPTER_V1" as const;

/**
 * The closed fact vocabulary — exactly the two facts `source-schema.ts`
 * declares for Form16 (`makeSourceFactSpec({area:"income",factKey:"salary"})`
 * and `{area:"tax_paid",factKey:"salary_tds"}`). A unit test cross-checks this
 * list against that module rather than importing it, so the tax-desk domain
 * stays free of a runtime dependency on tax-pack internals while the two
 * vocabularies cannot silently diverge.
 */
export const PROPOSAL_FACT_KINDS = ["income.salary", "tax_paid.salary_tds"] as const;
export type ProposalFactKind = (typeof PROPOSAL_FACT_KINDS)[number];

export interface ProposalFactSpec {
  readonly factKind: ProposalFactKind;
  readonly ledgerKind: "income" | "tax_paid";
  /** The ledger category the fact promotes into (matches the ledger's own enum). */
  readonly ledgerCategory: "salary" | "salary_tds";
  readonly label: string;
}

const FACT_SPECS: Readonly<Record<ProposalFactKind, ProposalFactSpec>> = Object.freeze({
  "income.salary": Object.freeze({
    factKind: "income.salary",
    ledgerKind: "income",
    ledgerCategory: "salary",
    label: "Salary income",
  }),
  "tax_paid.salary_tds": Object.freeze({
    factKind: "tax_paid.salary_tds",
    ledgerKind: "tax_paid",
    ledgerCategory: "salary_tds",
    label: "Salary TDS",
  }),
});

export function isProposalFactKind(value: string): value is ProposalFactKind {
  return (PROPOSAL_FACT_KINDS as readonly string[]).includes(value);
}

export function proposalFactSpec(factKind: ProposalFactKind): ProposalFactSpec {
  return FACT_SPECS[factKind];
}

/** The exact pair a document must carry before it may promote. Order-independent. */
export function requiredProposalPair(): readonly ProposalFactKind[] {
  return PROPOSAL_FACT_KINDS;
}

// ---------------------------------------------------------------------------
// Lifecycle — the ONE canonical evaluator (mirrored, not re-derived, in SQL)
// ---------------------------------------------------------------------------

export const PROPOSAL_STATUSES = ["proposed", "accepted", "rejected", "promoted"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export type ProposalDecision = "accept" | "reject";

/**
 * Forward-only transitions: `proposed` → `accepted` | `rejected`; `accepted` →
 * `promoted`. Every other pair (including any transition FROM `rejected` or
 * `promoted`, and any transition TO `proposed`) is refused — a rejected or
 * already-promoted proposal never becomes preparation truth again by mistake.
 * UI copy is not authority: this function is. The database RPCs
 * (`decide_source_proposal`, `promote_source_proposal_pair`) enforce the same
 * table under a row lock; this is the description both check against in
 * tests.
 */
export function canTransitionProposalStatus(from: ProposalStatus, to: ProposalStatus): boolean {
  if (from === "proposed" && (to === "accepted" || to === "rejected")) return true;
  if (from === "accepted" && to === "promoted") return true;
  return false;
}

/** True once a proposal has reached a state that can no longer change. */
export function isTerminalProposalStatus(status: ProposalStatus): boolean {
  return status === "rejected" || status === "promoted";
}

/** Only an `accepted` proposal may be promoted. */
export function isPromotable(status: ProposalStatus): boolean {
  return status === "accepted";
}

// ---------------------------------------------------------------------------
// Pair completeness — used by the read model to decide whether "Promote" shows
// ---------------------------------------------------------------------------

export interface PairReadiness {
  readonly ready: boolean;
  /** Fact kinds the pair is still missing (never proposed at all). */
  readonly missing: readonly ProposalFactKind[];
  /** Fact kinds present but not yet accepted (proposed or rejected). */
  readonly notAccepted: readonly ProposalFactKind[];
}

/** Given the current status of each fact for one document, is the pair ready to promote? */
export function assessPairReadiness(
  statusByFact: Partial<Record<ProposalFactKind, ProposalStatus>>,
): PairReadiness {
  const missing: ProposalFactKind[] = [];
  const notAccepted: ProposalFactKind[] = [];
  for (const kind of PROPOSAL_FACT_KINDS) {
    const status = statusByFact[kind];
    if (!status) {
      missing.push(kind);
    } else if (status !== "accepted" && status !== "promoted") {
      notAccepted.push(kind);
    }
  }
  return Object.freeze({
    ready: missing.length === 0 && notAccepted.length === 0,
    missing: Object.freeze(missing),
    notAccepted: Object.freeze(notAccepted),
  });
}

// ---------------------------------------------------------------------------
// K3-31 — outstanding-work summary. Pure counting over CURRENT per-fact
// statuses (the newest non-superseded row per fact per document — the same
// notion the read model and `assessPairReadiness` already use). Never
// `promoted`, which is not outstanding work.
// ---------------------------------------------------------------------------

export interface ProposalWorkSummary {
  /** Current status is `proposed` — nobody has decided it yet. */
  readonly awaitingDecision: number;
  /** Current status is `accepted` but the pair has not (yet) been promoted. */
  readonly acceptedNotPromoted: number;
  /** Current status is `rejected` — the fact needs a fresh, corrected proposal. */
  readonly rejectedNeedsFreshProposal: number;
}

/** Summarize outstanding proposal work from a flat list of CURRENT per-fact
 *  statuses (never pass `promoted` rows in — they are not outstanding work). */
export function summarizeProposalWork(currentStatuses: readonly ProposalStatus[]): ProposalWorkSummary {
  let awaitingDecision = 0;
  let acceptedNotPromoted = 0;
  let rejectedNeedsFreshProposal = 0;
  for (const status of currentStatuses) {
    if (status === "proposed") awaitingDecision++;
    else if (status === "accepted") acceptedNotPromoted++;
    else if (status === "rejected") rejectedNeedsFreshProposal++;
    // "promoted" is resolved work, not outstanding — deliberately not counted.
  }
  return Object.freeze({ awaitingDecision, acceptedNotPromoted, rejectedNeedsFreshProposal });
}

export function totalOutstandingProposalWork(summary: ProposalWorkSummary): number {
  return summary.awaitingDecision + summary.acceptedNotPromoted + summary.rejectedNeedsFreshProposal;
}

// ---------------------------------------------------------------------------
// Synthetic-only guard — same shapes tax-lab refuses, duplicated (not
// imported: production code may never import tax-lab) so this product surface
// enforces the identical discipline independently.
// ---------------------------------------------------------------------------

/** PAN shape: five letters, four digits, one letter. */
const PAN_SHAPE = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/;
/** Aadhaar shape: twelve digits, optionally grouped in fours. */
const AADHAAR_SHAPE = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/;

/** Refuse a free-text field (decision reason, document label) that looks like a real PAN/Aadhaar. */
export function assertNoRealIdentifierShape(value: string, field: string): void {
  if (PAN_SHAPE.test(value)) {
    throw new Error(`${field} contains a PAN-shaped string; this workflow is synthetic-only`);
  }
  if (AADHAAR_SHAPE.test(value)) {
    throw new Error(`${field} contains an Aadhaar-shaped string; this workflow is synthetic-only`);
  }
}

// ---------------------------------------------------------------------------
// Envelope validation — mirrors the DB's malformed-version / unsupported-fact
// refusals so the action layer can give a precise message before ever calling
// the RPC (the RPC re-validates independently; this is not the authority).
// ---------------------------------------------------------------------------

export interface ProposalEnvelopeInput {
  readonly sourceSchemaKind: string;
  readonly sourceSchemaVersion: string;
  readonly adapterVersion: string;
  readonly factKind: string;
  readonly proposedValue: number;
}

export type ProposalEnvelopeCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/** Pure pre-check of a proposal envelope before it reaches the guarded RPC. */
export function checkProposalEnvelope(input: ProposalEnvelopeInput): ProposalEnvelopeCheck {
  if (input.sourceSchemaKind !== PROPOSAL_SOURCE_SCHEMA_KIND) {
    return { ok: false, reason: `Only ${PROPOSAL_SOURCE_SCHEMA_KIND} sources are supported in this workflow.` };
  }
  if (input.sourceSchemaVersion !== PROPOSAL_SOURCE_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: `Source schema version ${JSON.stringify(input.sourceSchemaVersion)} does not match the supported ${PROPOSAL_SOURCE_SCHEMA_VERSION}.`,
    };
  }
  if (input.adapterVersion !== SYNTHETIC_PROPOSAL_ADAPTER_VERSION) {
    return {
      ok: false,
      reason: `Adapter version ${JSON.stringify(input.adapterVersion)} does not match the supported ${SYNTHETIC_PROPOSAL_ADAPTER_VERSION}.`,
    };
  }
  if (!isProposalFactKind(input.factKind)) {
    return { ok: false, reason: `Fact kind ${JSON.stringify(input.factKind)} is not supported by this workflow.` };
  }
  if (!Number.isFinite(input.proposedValue) || input.proposedValue < 0) {
    return { ok: false, reason: "Proposed value must be a non-negative number." };
  }
  return { ok: true };
}
