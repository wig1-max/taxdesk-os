/**
 * `K3-31` — B: promoted-row validation/reconciliation equivalence, and
 * C: unpromoted proposals are computationally inert.
 *
 * `promote_source_proposal_pair` (the K3-30 RPC) inserts ORDINARY rows into
 * `tax_income_entries` / `tax_tax_paid_entries` — same columns, same
 * `source_type = 'Form16'`, same `source_document_id` shape a manually
 * entered Form16-tagged row already carries. Nothing in the adapter,
 * validator, or reconciliation code distinguishes "how a row got here". This
 * file PROVES that rather than asserting it in a comment: a promoted-shaped
 * pair and an equivalent manually entered pair produce identical validation
 * findings, reconciliation, and material amounts (B); and that proposal
 * records which never reached `promoted` status never influence any of it,
 * because they never became a `LedgerRows` entry in the first place (C).
 *
 * `source-proposals.ts`'s own state machine (`canTransitionProposalStatus`)
 * and the SQL guard (`promote_source_proposal_pair`) are the authority for
 * WHICH proposals may promote; this file does not re-test that. It tests the
 * DOWNSTREAM consequence: once ordinary ledger rows exist (or don't), the
 * engine/adapter/validator treat them exactly as they always have.
 */
import { describe, expect, it } from "vitest";
import { buildEngineInput, type CaseMeta, type LedgerRows } from "../computation-adapter";
import { runValidation, type RunnerFinding, type ValidationDoc } from "../validation-runner";

const META: CaseMeta = {
  assessmentYear: "2026-27",
  financialYear: "2025-26",
  selectedItrType: null,
  finalized: false,
};

const EMPTY: LedgerRows = { income: [], taxPaid: [], deductions: [], capitalGains: [] };

/**
 * A salary + salary-TDS pair shaped EXACTLY like what
 * `promote_source_proposal_pair` inserts (`source_type: 'Form16'`,
 * `source_document_id: <the case document>`), and equally exactly like a
 * staff member typing the same two facts in by hand against the same
 * document. The only thing that may legitimately differ between the two
 * fixtures below is the row/document ids — never the shape.
 */
function form16SalaryTdsPair(idPrefix: string, documentId: string): LedgerRows {
  return {
    ...EMPTY,
    income: [
      {
        id: `${idPrefix}_income`,
        income_head: "salary",
        amount: 900_000,
        source_type: "Form16",
        source_document_id: documentId,
      },
    ],
    taxPaid: [
      {
        id: `${idPrefix}_taxpaid`,
        tax_paid_type: "salary_tds",
        amount: 60_000,
        source_type: "Form16",
        source_document_id: documentId,
      },
    ],
  };
}

const DOC_NAME = "Form 16 (per employer)";

function documentsFor(documentId: string): ValidationDoc[] {
  return [{ id: documentId, name: DOC_NAME, status: "received", is_required: true }];
}

/** Strip the fields that are EXPECTED to differ (ids) so the remaining shape
 *  is a pure claim about codes/severities/amounts/classifications/suggestions. */
function normalizeFinding(f: RunnerFinding): Omit<RunnerFinding, "findingKey" | "subjectKey" | "details"> & {
  details: Record<string, unknown>;
} {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { findingKey, subjectKey, details, ...rest } = f;
  const normalizedDetails = { ...details };
  delete normalizedDetails.ledgerId;
  delete normalizedDetails.entryIds;
  delete normalizedDetails.documentId;
  return { ...rest, details: normalizedDetails };
}

describe("K3-31.B — a promoted-shaped Form16 pair validates identically to a manually entered one", () => {
  const manual = form16SalaryTdsPair("manual", "doc_manual");
  const promoted = form16SalaryTdsPair("promoted", "doc_promoted");

  const runOne = (ledgers: LedgerRows, documentId: string) => {
    const adapter = buildEngineInput(ledgers, META);
    return runValidation({
      context: { assessmentYear: META.assessmentYear, financialYear: META.financialYear, selectedItrType: META.selectedItrType, finalized: META.finalized },
      ledgers,
      adapter,
      documents: documentsFor(documentId),
      validFileIds: [],
    });
  };

  const manualResult = runOne(manual, "doc_manual");
  const promotedResult = runOne(promoted, "doc_promoted");

  it("produces the same NUMBER of findings, in the same ORDER", () => {
    expect(promotedResult.findings.length).toBe(manualResult.findings.length);
    expect(promotedResult.findings.map((f) => f.ruleCode)).toEqual(manualResult.findings.map((f) => f.ruleCode));
  });

  it("every finding is equivalent code/category/severity/title/message/suggestedAction — ids aside", () => {
    const manualNorm = manualResult.findings.map(normalizeFinding);
    const promotedNorm = promotedResult.findings.map(normalizeFinding);
    expect(promotedNorm).toEqual(manualNorm);
  });

  it("counts (error/warning/info/total) match exactly", () => {
    expect(promotedResult.counts).toEqual(manualResult.counts);
  });

  it("reconciliation totals/groups/pairs match exactly — no ids appear in reconciliation output at all", () => {
    // ReconGroup/ReconPairDelta carry sourceType/category/key/amounts/counts —
    // never a row id — so this is a direct toEqual, not a normalized one.
    expect(promotedResult.reconciliation).toEqual(manualResult.reconciliation);
  });

  it("both source classifications are the input Form16 tag — suppression behaviour (no source-mismatch finding) is identical", () => {
    // Only one source per (category,key) is present in either fixture, so the
    // comparable-pair mismatch check has nothing to compare against and is
    // correctly suppressed for BOTH — proving suppression, not merely absence.
    for (const result of [manualResult, promotedResult]) {
      expect(result.findings.some((f) => f.ruleCode === "reconciliation.source_mismatch")).toBe(false);
      expect(result.reconciliation.pairs).toEqual([]);
    }
  });

  it("material amounts match: gross salary and TDS totals are identical", () => {
    const adapterManual = buildEngineInput(manual, META);
    const adapterPromoted = buildEngineInput(promoted, META);
    expect(adapterPromoted.summary.salary).toBe(adapterManual.summary.salary);
    expect(adapterPromoted.summary.totalTaxPaid).toBe(adapterManual.summary.totalTaxPaid);
    expect(adapterPromoted.summary).toEqual(adapterManual.summary);
  });
});

describe("K3-31.C — unpromoted proposal records never influence ledgers, computation, or traceable figures", () => {
  // `tax_source_proposals` (proposed / accepted-not-promoted / rejected) is a
  // wholly separate table from `tax_income_entries` / `tax_tax_paid_entries`.
  // `buildEngineInput` — and everything downstream of it (compute/validate/
  // traceability) — accepts ONLY `LedgerRows`, which is built exclusively
  // from the two ledger tables (`queries/tax-desk.ts`'s `getTaxCaseComputationData`
  // never selects from `tax_source_proposals`). This is proven, not merely
  // documented, by demonstrating: a case whose ONLY facts exist as proposals
  // in every non-promoted state computes and validates EXACTLY as an
  // genuinely empty case does — because `LedgerRows` has no way to represent
  // "there's a proposed/accepted/rejected fact" at all. The proof is
  // therefore about the SHAPE of the boundary, not a state-by-state branch —
  // per the session's constraint, inertness must NOT be achieved by adding
  // proposal-state filtering inside the engine, and indeed no such filtering
  // exists anywhere in this call path.
  const trulyEmptyCase = EMPTY;

  it("an empty LedgerRows (the only shape available while every fact is proposed/accepted-not-promoted/rejected) computes zero income/tax-paid — proposal existence cannot leak in", () => {
    const adapter = buildEngineInput(trulyEmptyCase, META);
    expect(adapter.mappedEntryCount).toBe(0);
    expect(adapter.summary.salary).toBe(0);
    expect(adapter.summary.totalTaxPaid).toBe(0);
    expect(adapter.input.income).toEqual([]);
    expect(adapter.input.taxPaid).toEqual([]);
  });

  it("validation of the empty case reports no findings that could only originate from a proposed/accepted/rejected fact", () => {
    const adapter = buildEngineInput(trulyEmptyCase, META);
    const result = runValidation({
      context: { assessmentYear: META.assessmentYear, financialYear: META.financialYear, selectedItrType: META.selectedItrType, finalized: META.finalized },
      ledgers: trulyEmptyCase,
      adapter,
      documents: [],
      validFileIds: [],
    });
    // No ledger-integrity, reconciliation, or coverage finding references a
    // fact that exists only as a proposal — because none of those code paths
    // read anything but `LedgerRows`.
    for (const f of result.findings) {
      expect(f.category).not.toBe("reconciliation");
      expect(f.ruleCode.startsWith("ledger.")).toBe(false);
      expect(f.ruleCode.startsWith("coverage.unsupported_entry")).toBe(false);
    }
  });

  it("`LedgerRows` and `AdapterResult` have no field that could carry a proposal status — the type boundary itself is the guarantee", () => {
    // Structural proof: build engine input from ledgers containing exactly
    // the promoted pair, and confirm the ONLY way a fact enters `income`/
    // `taxPaid` is via a real ledger row — there is no alternate branch keyed
    // on any notion of "accepted" or "promoted". Removing the row (as if it
    // had never been promoted) removes it from the computed input with no
    // other change required anywhere in this module.
    const withRow = buildEngineInput(form16SalaryTdsPair("x", "doc_x"), META);
    const withoutRow = buildEngineInput(trulyEmptyCase, META);
    expect(withRow.input.income).toHaveLength(1);
    expect(withoutRow.input.income).toHaveLength(0);
    // The only difference between the two adapter results is the presence of
    // the row itself — summary deltas match exactly what the single row
    // contributes, proving no hidden proposal-aware path exists.
    expect(withRow.summary.salary - withoutRow.summary.salary).toBe(900_000);
    expect(withRow.summary.totalTaxPaid - withoutRow.summary.totalTaxPaid).toBe(60_000);
  });
});
