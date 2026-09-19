import { describe, expect, it } from "vitest";
import type { CaseMeta, LedgerRows } from "@/lib/tax-desk/computation-adapter";
import {
  EVIDENCE_ACCEPTANCE_STATES,
  TAX_LAB_EVIDENCE_FORMAT_VERSION,
  describeEvidence,
  evidenceDocument,
  evidenceSourceType,
  isAcceptedEvidence,
  makeDocumentEvidence,
  makeStaffAttestedEvidence,
} from "../evidence";
import { declaredLedgerFacts, makeSyntheticCaseFixture } from "../fixture";

/**
 * K3-21 — the EVIDENCE model. The properties defended here:
 *  - evidence is a versioned concept of its own, separate from the fixture format;
 *  - an unaccepted state must always carry the reason it represents work;
 *  - an evidence record cannot contradict the ledger row it backs;
 *  - a fixture cannot leave a declared fact un-evidenced, or evidence a row that
 *    does not exist — the coverage is complete in BOTH directions.
 */

const META: CaseMeta = {
  assessmentYear: "2026-27",
  financialYear: "2025-26",
  selectedItrType: "ITR-1",
  finalized: false,
};

const FORM16 = {
  documentId: "lab_doc_form16",
  label: "Synthetic Form 16",
  sourceType: "Form16" as const,
};

const SALARY_ROW: LedgerRows = {
  income: [
    {
      id: "lab_inc_salary",
      income_head: "salary",
      amount: 500_000,
      source_type: "Form16",
      source_document_id: "lab_doc_form16",
    },
  ],
  taxPaid: [],
  deductions: [],
  capitalGains: [],
};

function salaryEvidence(overrides: Partial<Parameters<typeof makeDocumentEvidence>[0]> = {}) {
  return makeDocumentEvidence({
    kind: "source_document",
    ledgerKind: "income",
    ledgerId: "lab_inc_salary",
    document: FORM16,
    acceptance: "accepted",
    ...overrides,
  });
}

function fixtureWith(ledger: LedgerRows, evidence: Parameters<typeof makeSyntheticCaseFixture>[0]["evidence"], rest = {}) {
  return makeSyntheticCaseFixture({
    id: "test/evidence",
    description: "Evidence probe.",
    statutory: { assessmentYear: "2026-27" },
    ledger,
    caseMeta: META,
    evidence,
    ...rest,
  });
}

describe("evidence is its own versioned concept", () => {
  it("stamps the evidence format version on every record", () => {
    expect(TAX_LAB_EVIDENCE_FORMAT_VERSION).toBe("TAX_LAB_EVIDENCE_V1");
    expect(salaryEvidence().evidenceFormatVersion).toBe(TAX_LAB_EVIDENCE_FORMAT_VERSION);
    expect(
      makeStaffAttestedEvidence({
        ledgerKind: "income",
        ledgerId: "r1",
        sourceType: "manual",
        acceptance: "accepted",
      }).evidenceFormatVersion,
    ).toBe(TAX_LAB_EVIDENCE_FORMAT_VERSION);
  });

  it("freezes records and exposes document / source type uniformly", () => {
    const doc = salaryEvidence();
    expect(Object.isFrozen(doc)).toBe(true);
    expect(evidenceDocument(doc)?.documentId).toBe("lab_doc_form16");
    expect(evidenceSourceType(doc)).toBe("Form16");

    const attested = makeStaffAttestedEvidence({
      ledgerKind: "tax_paid",
      ledgerId: "r2",
      sourceType: "manual",
      acceptance: "accepted",
    });
    expect(evidenceDocument(attested)).toBeUndefined();
    expect(evidenceSourceType(attested)).toBe("manual");
  });

  it("treats only 'accepted' as usable, across the whole closed state set", () => {
    expect(EVIDENCE_ACCEPTANCE_STATES).toEqual(["accepted", "proposed", "rejected"]);
    expect(EVIDENCE_ACCEPTANCE_STATES.filter(isAcceptedEvidence)).toEqual(["accepted"]);
  });

  it("describes a record without leaking anything but synthetic labels", () => {
    const text = describeEvidence(salaryEvidence({ acceptance: "rejected", acceptanceReason: "Wrong year." }));
    expect(text).toContain("lab_inc_salary");
    expect(text).toContain("rejected");
    expect(text).toContain("Wrong year.");
  });
});

describe("an unaccepted state must say what work it represents", () => {
  it("requires a reason for proposed / rejected evidence", () => {
    for (const acceptance of ["proposed", "rejected"] as const) {
      expect(() => salaryEvidence({ acceptance })).toThrow(/acceptanceReason/);
    }
  });

  it("refuses a stale reason on accepted evidence", () => {
    expect(() => salaryEvidence({ acceptanceReason: "was queried once" })).toThrow(
      /accepted but carries an acceptanceReason/,
    );
  });

  it("refuses an acceptance state outside the closed set", () => {
    expect(() => salaryEvidence({ acceptance: "maybe" as never })).toThrow(/is not one of/);
  });

  it("refuses staff attestation for a reported source type", () => {
    expect(() =>
      makeStaffAttestedEvidence({
        ledgerKind: "income",
        ledgerId: "r1",
        sourceType: "Form16" as never,
        acceptance: "accepted",
      }),
    ).toThrow(/only "manual" \/ "adjustment" have no document/);
  });
});

describe("evidence cannot contradict the row it backs", () => {
  it("refuses a document id the row does not carry", () => {
    expect(() =>
      fixtureWith(SALARY_ROW, [
        salaryEvidence({ document: { ...FORM16, documentId: "lab_doc_something_else" } }),
      ]),
    ).toThrow(/claims source document .* but the row's source_document_id/);
  });

  it("refuses a source type the row does not declare", () => {
    expect(() =>
      fixtureWith(SALARY_ROW, [salaryEvidence({ document: { ...FORM16, sourceType: "AIS" } })]),
    ).toThrow(/declares sourceType "AIS", but the row declares "Form16"/);
  });

  it("refuses the wrong ledger kind", () => {
    expect(() => fixtureWith(SALARY_ROW, [salaryEvidence({ ledgerKind: "deduction" })])).toThrow(
      /declares ledgerKind deduction, but that row is a income row/,
    );
  });

  it("refuses staff attestation for a row that points at a document", () => {
    expect(() =>
      fixtureWith(SALARY_ROW, [
        makeStaffAttestedEvidence({
          ledgerKind: "income",
          ledgerId: "lab_inc_salary",
          // The row is Form16-sourced, so this also fails the source-type check;
          // the document check is what this case is about.
          sourceType: "manual",
          acceptance: "accepted",
        }),
      ]),
    ).toThrow(/declares sourceType "manual", but the row declares "Form16"/);
  });

  it("accepts proof-document evidence for a deduction backed by a proof on file", () => {
    const ledger: LedgerRows = {
      income: [],
      taxPaid: [],
      capitalGains: [],
      deductions: [
        {
          id: "lab_ded_80c",
          deduction_type: "80C",
          amount: 100_000,
          source_type: "manual",
          proof_case_document_id: "lab_doc_proof",
        },
      ],
    };
    const evidence = makeDocumentEvidence({
      kind: "proof_document",
      ledgerKind: "deduction",
      ledgerId: "lab_ded_80c",
      document: { documentId: "lab_doc_proof", label: "Synthetic 80C proof", sourceType: "manual" },
      acceptance: "accepted",
    });
    expect(() => fixtureWith(ledger, [evidence])).not.toThrow();
    const wrongProof = makeDocumentEvidence({
      kind: "proof_document",
      ledgerKind: "deduction",
      ledgerId: "lab_ded_80c",
      document: { documentId: "lab_doc_other", label: "Synthetic other proof", sourceType: "manual" },
      acceptance: "accepted",
    });
    expect(() => fixtureWith(ledger, [wrongProof])).toThrow(/claims proof document/);
  });
});

describe("evidence coverage is complete in both directions", () => {
  it("refuses a declared fact with no evidence", () => {
    expect(() => fixtureWith(SALARY_ROW, [])).toThrow(
      /declares income row "lab_inc_salary" with no evidence/,
    );
  });

  it("refuses evidence for a row the fixture never declared", () => {
    expect(() =>
      fixtureWith(SALARY_ROW, [
        salaryEvidence(),
        salaryEvidence({ ledgerId: "lab_inc_ghost" }),
      ]),
    ).toThrow(/which is not a declared ledger row/);
  });

  it("refuses duplicate evidence for one row", () => {
    expect(() => fixtureWith(SALARY_ROW, [salaryEvidence(), salaryEvidence()])).toThrow(
      /declares evidence for "lab_inc_salary" twice/,
    );
  });

  it("refuses a ledger id reused across two ledgers", () => {
    const ledger: LedgerRows = {
      ...SALARY_ROW,
      taxPaid: [{ id: "lab_inc_salary", tax_paid_type: "salary_tds", amount: 1, source_type: "manual" }],
    };
    expect(() => fixtureWith(ledger, [salaryEvidence()])).toThrow(/more than once/);
  });

  it("flattens every ledger into declared facts with the ids evidence is keyed by", () => {
    const facts = declaredLedgerFacts({
      income: [{ id: "i1", income_head: "salary", amount: 1, source_type: "manual" }],
      taxPaid: [{ id: "t1", tax_paid_type: "salary_tds", amount: 1, source_type: "manual" }],
      deductions: [{ id: "d1", deduction_type: "80C", amount: 1, source_type: "manual", proof_case_document_id: "p1" }],
      capitalGains: [
        {
          id: "c1",
          gain_type: "stcg_111a",
          sale_value: 2,
          cost: 1,
          expenses: 0,
          exemption_claimed: 0,
          taxable_gain: 1,
          source_type: "manual",
        },
      ],
    });
    expect(facts.map((f) => [f.ledgerId, f.ledgerKind])).toEqual([
      ["i1", "income"],
      ["t1", "tax_paid"],
      ["d1", "deduction"],
      ["c1", "capital_gain"],
    ]);
    expect(facts.find((f) => f.ledgerId === "d1")?.proofDocumentId).toBe("p1");
  });
});

describe("an unaccepted fact must be declared as explicit work", () => {
  it("refuses unaccepted evidence that the fixture does not declare withheld", () => {
    expect(() =>
      fixtureWith(SALARY_ROW, [salaryEvidence({ acceptance: "proposed", acceptanceReason: "Not reviewed." })]),
    ).toThrow(/without declaring it withheld/);
  });

  it("refuses a withheld declaration that disagrees with the evidence state", () => {
    expect(() =>
      fixtureWith(
        SALARY_ROW,
        [salaryEvidence({ acceptance: "proposed", acceptanceReason: "Not reviewed." })],
        { expectedWithheld: [{ ledgerId: "lab_inc_salary", ledgerKind: "income", acceptance: "rejected" }] },
      ),
    ).toThrow(/withheld as rejected, but its evidence is proposed/);
  });

  it("refuses a withheld declaration naming the wrong ledger kind", () => {
    expect(() =>
      fixtureWith(
        SALARY_ROW,
        [salaryEvidence({ acceptance: "proposed", acceptanceReason: "Not reviewed." })],
        { expectedWithheld: [{ ledgerId: "lab_inc_salary", ledgerKind: "deduction", acceptance: "proposed" }] },
      ),
    ).toThrow(/withheld as a deduction row, but it is a income row/);
  });

  it("refuses a withheld declaration for a row that does not exist", () => {
    expect(() =>
      fixtureWith(SALARY_ROW, [salaryEvidence()], {
        expectedWithheld: [{ ledgerId: "lab_inc_ghost", ledgerKind: "income", acceptance: "proposed" }],
      }),
    ).toThrow(/no such ledger row exists/);
  });

  it("accepts a correctly declared withheld fact", () => {
    const fixture = fixtureWith(
      SALARY_ROW,
      [salaryEvidence({ acceptance: "proposed", acceptanceReason: "Awaiting preparer review." })],
      { expectedWithheld: [{ ledgerId: "lab_inc_salary", ledgerKind: "income", acceptance: "proposed" }] },
    );
    expect(fixture.expectedWithheld).toHaveLength(1);
    expect(fixture.evidence[0]?.acceptance).toBe("proposed");
  });
});

describe("validation-finding pins are validated at construction", () => {
  it("refuses the same finding code twice", () => {
    expect(() =>
      fixtureWith(SALARY_ROW, [salaryEvidence()], {
        expectedFindings: [
          { code: "DOC_MISSING", severity: "warning", area: "documents", packValidationRulesVersion: "v" },
          { code: "DOC_MISSING", severity: "blocker", area: "documents", packValidationRulesVersion: "v" },
        ],
      }),
    ).toThrow(/pins validation finding DOC_MISSING twice/);
  });

  it("requires a code and a validation rules version", () => {
    expect(() =>
      fixtureWith(SALARY_ROW, [salaryEvidence()], {
        expectedFindings: [{ code: "  ", severity: "warning", area: "documents", packValidationRulesVersion: "v" }],
      }),
    ).toThrow(/expectedFindings\[\].code/);
    expect(() =>
      fixtureWith(SALARY_ROW, [salaryEvidence()], {
        expectedFindings: [{ code: "X", severity: "warning", area: "documents", packValidationRulesVersion: "" }],
      }),
    ).toThrow(/packValidationRulesVersion/);
  });
});
