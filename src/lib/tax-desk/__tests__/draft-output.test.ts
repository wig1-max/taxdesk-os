/**
 * `K3-32` — snapshot-bound evidence lineage + the internal draft-output
 * package. These tests hold the claims this session adds: which promoted
 * facts fed a SNAPSHOT (not live data), that a draft output can only be
 * built from the case's exact currently-approved, non-reliance-blocked
 * snapshot, that it never recomputes (renders exactly the immutable
 * snapshot's own numbers), and that every figure in it is traceable through
 * the SAME `describeCaseTraceability` authority Computation/Validation use.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildAdapterResultFromSnapshot,
  buildDraftOutputPackage,
  buildLedgerRowsFromSnapshot,
  DRAFT_OUTPUT_FORMAT_VERSION,
  noCurrentApprovalRefusal,
  normalizeStoredEngineInputPayload,
  resolveSnapshotEvidenceLineage,
  type DraftOutputPackage,
  type DraftOutputReview,
  type StoredEngineInputPayload,
  type StoredSnapshotForDraftOutput,
} from "../draft-output";
import {
  COMPUTATION_FIGURE_INVENTORY,
  describeCaseTraceability,
  type PromotedProposalLineage,
} from "../case-traceability";
import { buildEngineInput, type AdapterResult, type CaseMeta, type LedgerRows } from "../computation-adapter";
import { SURCHARGE_MARGINAL_RELIEF_RISK_THRESHOLD_INR } from "../tax-capability";
import { compareRegimes, computeTax, recommendItrForm } from "@/lib/tax-engine/ay-2026-27";

const META: CaseMeta = {
  assessmentYear: "2026-27",
  financialYear: "2025-26",
  selectedItrType: "ITR-1",
  finalized: false,
};
const STATUTORY = { assessmentYear: "2026-27" };
const TAX_CASE_ID = "case_1";

const EMPTY: LedgerRows = { income: [], taxPaid: [], deductions: [], capitalGains: [] };

describe("K4-17 — stored V1 input normalization", () => {
  it("forwards every replay head and taxpayer profile without reducing V1 to the legacy four arrays", () => {
    const full = realSnapshot({
      ...EMPTY,
      businessBooksEntries: [{
        id: "books_1",
        revenue: 300_000,
        expenses: 100_000,
        is_profession: false,
        adjustments: "none_s30_43d",
        activity_classification: "ordinary_business_or_profession",
        source_type: "manual",
      }],
    }).snapshot.engineInput;
    const normalized = normalizeStoredEngineInputPayload(full, META);
    expect(normalized.taxpayer).toEqual(full.taxpayer);
    expect(normalized.housePropertyEntries).toEqual(full.housePropertyEntries);
    expect(normalized.businessBooksEntries).toEqual(full.businessBooksEntries);
    expect(normalized.broughtForwardLosses).toEqual(full.broughtForwardLosses);
  });

  it("keeps legacy rows explicit and empty instead of inventing later heads", () => {
    const normalized = normalizeStoredEngineInputPayload(
      { selectedItrType: null, income: [], taxPaid: [], deductions: [], capitalGains: [] },
      META,
    );
    expect(normalized.assessmentYear).toBe(META.assessmentYear);
    expect(normalized.housePropertyEntries).toEqual([]);
    expect(normalized.businessBooksEntries).toEqual([]);
    expect(normalized.broughtForwardLosses).toEqual([]);
  });
});

/** Build a real, engine-produced snapshot the way `tax-computation.ts` does. */
function realSnapshot(rows: LedgerRows, over: Partial<StoredSnapshotForDraftOutput> = {}): {
  snapshot: StoredSnapshotForDraftOutput;
  adapter: AdapterResult;
} {
  const adapter = buildEngineInput(rows, META);
  const computation = computeTax(adapter.input);
  const comparison = compareRegimes(adapter.input);
  const recommendation = recommendItrForm(adapter.input);
  const engineInput: StoredEngineInputPayload = {
    assessmentYear: adapter.input.assessmentYear,
    financialYear: adapter.input.financialYear,
    selectedItrType: adapter.input.selectedItrType ?? null,
    taxpayer: adapter.input.taxpayer,
    income: adapter.input.income,
    taxPaid: adapter.input.taxPaid,
    deductions: adapter.input.deductions,
    capitalGains: adapter.input.capitalGains,
    housePropertyEntries: adapter.input.housePropertyEntries,
    businessBooksEntries: adapter.input.businessBooksEntries,
    broughtForwardLosses: adapter.input.broughtForwardLosses,
  };
  return {
    adapter,
    snapshot: {
      id: "snap_1",
      createdAt: "2026-07-24T10:00:00Z",
      complete: true,
      assessmentYear: "2026-27",
      financialYear: "2025-26",
      selectedItrType: "ITR-1",
      recommendedItrType: recommendation.recommendedItrType,
      engineInput,
      computation,
      comparison,
      recommendation,
      ...over,
    },
  };
}

const APPROVED_FOR_SNAP1: DraftOutputReview = { status: "approved", reviewSnapshotId: "snap_1" };

const SALARIED: LedgerRows = {
  ...EMPTY,
  income: [
    {
      id: "inc_salary",
      income_head: "salary",
      amount: 900_000,
      source_type: "Form16",
      source_document_id: "doc_form16",
    },
  ],
  taxPaid: [
    {
      id: "tp_tds",
      tax_paid_type: "salary_tds",
      amount: 60_000,
      source_type: "Form16",
      source_document_id: "doc_form16",
    },
  ],
};

const HIGH_INCOME: LedgerRows = {
  ...EMPTY,
  income: [
    { id: "inc_salary", income_head: "salary", amount: 60_00_000, source_type: "manual" },
  ],
  taxPaid: [{ id: "tp_tds", tax_paid_type: "salary_tds", amount: 15_00_000, source_type: "manual" }],
};

/**
 * K4-11 — above the ₹2,00,00,000 surcharge ceiling, where the 25%/37% tiers and
 * the then-binding 15% cap on dividend / 111A / 112 / 112A income are NOT
 * modelled. This is what reliably reliance-blocks now; `HIGH_INCOME` above no
 * longer does, because ₹60,00,000 of salary is inside the window the engine
 * genuinely computes.
 */
const ABOVE_SURCHARGE_CEILING: LedgerRows = {
  ...EMPTY,
  income: [
    { id: "inc_salary", income_head: "salary", amount: 3_00_00_000, source_type: "manual" },
  ],
  taxPaid: [{ id: "tp_tds", tax_paid_type: "salary_tds", amount: 90_00_000, source_type: "manual" }],
};

// ---------------------------------------------------------------------------
// Part A — resolveSnapshotEvidenceLineage
// ---------------------------------------------------------------------------

describe("K3-32 — resolveSnapshotEvidenceLineage", () => {
  const LINEAGE: PromotedProposalLineage = {
    proposalId: "prop_income",
    taxCaseId: TAX_CASE_ID,
    factKind: "income.salary",
    sourceDocumentId: "doc_form16",
    promotedLedgerKind: "income",
    promotedLedgerEntryId: "inc_salary",
    decidedByName: "Priya CA",
    decidedAt: "2026-07-20T10:00:00Z",
    promotedByName: "Priya CA",
    promotedAt: "2026-07-20T10:05:00Z",
  };

  it("attaches promoted-proposal lineage to a snapshot fact that was promoted", () => {
    const lineage = resolveSnapshotEvidenceLineage(
      {
        income: [{ id: "inc_salary", sourceType: "Form16", sourceDocumentId: "doc_form16" }],
        taxPaid: [],
      },
      TAX_CASE_ID,
      [LINEAGE],
    );
    expect(lineage.facts).toHaveLength(1);
    expect(lineage.facts[0]).toEqual({
      ledgerId: "inc_salary",
      ledgerKind: "income",
      sourceDocumentId: "doc_form16",
      promotedProposal: LINEAGE,
    });
  });

  it("a manually entered fact (same shape, no promotion) carries no lineage", () => {
    const lineage = resolveSnapshotEvidenceLineage(
      { income: [{ id: "inc_manual", sourceType: "manual" }], taxPaid: [] },
      TAX_CASE_ID,
      [LINEAGE],
    );
    expect(lineage.facts[0]?.promotedProposal).toBeNull();
  });

  it("never matches when the tax case id disagrees — defense in depth, same discipline as resolvePromotedProposalLineage", () => {
    const lineage = resolveSnapshotEvidenceLineage(
      { income: [{ id: "inc_salary", sourceType: "Form16", sourceDocumentId: "doc_form16" }], taxPaid: [] },
      "some_other_case",
      [LINEAGE],
    );
    expect(lineage.facts[0]?.promotedProposal).toBeNull();
  });

  it("covers both income and tax_paid facts", () => {
    const tdsLineage: PromotedProposalLineage = {
      ...LINEAGE,
      proposalId: "prop_tds",
      factKind: "tax_paid.salary_tds",
      promotedLedgerKind: "tax_paid",
      promotedLedgerEntryId: "tp_tds",
    };
    const lineage = resolveSnapshotEvidenceLineage(
      {
        income: [{ id: "inc_salary", sourceType: "Form16", sourceDocumentId: "doc_form16" }],
        taxPaid: [{ id: "tp_tds", sourceType: "Form16", sourceDocumentId: "doc_form16" }],
      },
      TAX_CASE_ID,
      [LINEAGE, tdsLineage],
    );
    expect(lineage.facts).toHaveLength(2);
    expect(lineage.facts.find((f) => f.ledgerKind === "tax_paid")?.promotedProposal).toEqual(tdsLineage);
  });
});

// ---------------------------------------------------------------------------
// Reconstruction helpers — inertness proof
// ---------------------------------------------------------------------------

describe("K3-32 — buildAdapterResultFromSnapshot / buildLedgerRowsFromSnapshot", () => {
  it("round-trips a snapshot's stored engine input into an AdapterResult usable by describeCaseTraceability", () => {
    const { adapter, snapshot } = realSnapshot(SALARIED);
    const reconstructed = buildAdapterResultFromSnapshot(snapshot.engineInput);
    expect(reconstructed.input.income).toEqual(adapter.input.income);
    expect(reconstructed.input.taxPaid).toEqual(adapter.input.taxPaid);
    expect(reconstructed.complete).toBe(true);
    expect(reconstructed.warnings).toEqual([]);
  });

  it("K3-32: placeholder taxpayer/status fields required only by TaxEngineInput's type are INERT to traceability output — proved, not assumed", () => {
    const { snapshot } = realSnapshot(SALARIED);
    const a = buildAdapterResultFromSnapshot(snapshot.engineInput);
    const rows = buildLedgerRowsFromSnapshot(snapshot.engineInput);
    const outputs = {
      computation: snapshot.computation,
      comparison: snapshot.comparison,
      itrRecommendation: snapshot.recommendation,
    };
    const traceA = describeCaseTraceability({ statutory: STATUTORY, adapter: a, rows, outputs });

    // Deliberately different, "wrong" placeholder values for the fields
    // describeCaseTraceability's indexFacts/completenessOf never read.
    const b: AdapterResult = {
      ...a,
      input: {
        ...a.input,
        taxpayer: { residentStatus: "non_resident", ageCategory: "senior" },
        clientApprovalStatus: "approved",
        filingStatus: "filed",
        eVerificationStatus: "verified",
        finalized: true,
        requiredDocuments: [{ code: "form16", label: "Form 16", status: "received" } as never],
      },
    };
    const traceB = describeCaseTraceability({ statutory: STATUTORY, adapter: b, rows, outputs });
    expect(traceB).toEqual(traceA);
  });

  it("document labels are honestly null — the snapshot never stored per-row labels", () => {
    const { snapshot } = realSnapshot(SALARIED);
    const rows = buildLedgerRowsFromSnapshot(snapshot.engineInput);
    expect(rows.income[0]?.source_document_name).toBeNull();
    expect(rows.income[0]?.source_file_name).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Part C/D — buildDraftOutputPackage
// ---------------------------------------------------------------------------

describe("K3-32 — buildDraftOutputPackage refusals", () => {
  it("refuses not_approved when review.status is not approved", () => {
    const { snapshot } = realSnapshot(SALARIED);
    const result = buildDraftOutputPackage({
      taxCaseId: TAX_CASE_ID,
      statutory: STATUTORY,
      snapshot,
      review: { status: "sent", reviewSnapshotId: "snap_1" },
      promotedProposals: [],
    });
    expect(result.outcome).toBe("refused");
    if (result.outcome === "refused") expect(result.reason).toBe("not_approved");
  });

  it("refuses not_approved when approval is bound to a DIFFERENT snapshot", () => {
    const { snapshot } = realSnapshot(SALARIED);
    const result = buildDraftOutputPackage({
      taxCaseId: TAX_CASE_ID,
      statutory: STATUTORY,
      snapshot,
      review: { status: "approved", reviewSnapshotId: "some_other_snapshot" },
      promotedProposals: [],
    });
    expect(result.outcome).toBe("refused");
    if (result.outcome === "refused") expect(result.reason).toBe("not_approved");
  });

  it("refuses snapshot_incomplete for a defensively-supplied incomplete snapshot", () => {
    const { snapshot } = realSnapshot(SALARIED, { complete: false });
    const result = buildDraftOutputPackage({
      taxCaseId: TAX_CASE_ID,
      statutory: STATUTORY,
      snapshot,
      review: APPROVED_FOR_SNAP1,
      promotedProposals: [],
    });
    expect(result.outcome).toBe("refused");
    if (result.outcome === "refused") expect(result.reason).toBe("snapshot_incomplete");
  });

  // K4-11 REPLACED this assertion deliberately (the D123 convention). It used
  // to run on HIGH_INCOME (₹60,00,000 salary) and assert a refusal, which was
  // right while NO surcharge was implemented. That case is now genuinely
  // computed — 10% band, exact marginal relief — so asserting a refusal on it
  // would pin the old behaviour rather than the guard. The refusal it exists to
  // prove is now demonstrated at the real boundary: above ₹2,00,00,000.
  it("refuses reliance_blocked when the snapshot's own total income is above the ₹2,00,00,000 surcharge ceiling", () => {
    const { snapshot } = realSnapshot(ABOVE_SURCHARGE_CEILING);
    const result = buildDraftOutputPackage({
      taxCaseId: TAX_CASE_ID,
      statutory: STATUTORY,
      snapshot,
      review: APPROVED_FOR_SNAP1,
      promotedProposals: [],
    });
    expect(result.outcome).toBe("refused");
    if (result.outcome === "refused") {
      expect(result.reason).toBe("reliance_blocked");
      expect(result.blocker?.code).toBe("SURCHARGE_MARGINAL_RELIEF_UNSUPPORTED");
    }
  });

  // The other half of the same change, asserted rather than assumed: the
  // narrowing genuinely releases a case it used to block.
  it("K4-11: a ₹60,00,000 salary case — above the ₹50,00,000 threshold but inside the surcharge window — is NO LONGER blocked", () => {
    const { snapshot } = realSnapshot(HIGH_INCOME);
    expect(snapshot.computation.surchargeTreatmentSupported).toBe(true);
    const result = buildDraftOutputPackage({
      taxCaseId: TAX_CASE_ID,
      statutory: STATUTORY,
      snapshot,
      review: APPROVED_FOR_SNAP1,
      promotedProposals: [],
    });
    expect(result.outcome).not.toBe("refused");
  });

  // …and a snapshot computed BEFORE K4-11 carries no verdict at all, so it must
  // keep its original treatment rather than be released retroactively.
  it("K4-11: a pre-K4-11 snapshot (no surcharge verdict stored) above the threshold STILL blocks — fails closed", () => {
    const { snapshot } = realSnapshot(HIGH_INCOME);
    const legacy = {
      ...snapshot,
      computation: { ...snapshot.computation, surchargeTreatmentSupported: undefined },
    };
    const result = buildDraftOutputPackage({
      taxCaseId: TAX_CASE_ID,
      statutory: STATUTORY,
      snapshot: legacy,
      review: APPROVED_FOR_SNAP1,
      promotedProposals: [],
    });
    expect(result.outcome).toBe("refused");
    if (result.outcome === "refused") {
      expect(result.blocker?.code).toBe("SURCHARGE_MARGINAL_RELIEF_UNSUPPORTED");
    }
  });

  it("does not block a case comfortably below the threshold (SALARIED — the exact boundary is unit-proved in tax-capability.test.ts, D44)", () => {
    expect(9_00_000).toBeLessThan(SURCHARGE_MARGINAL_RELIEF_RISK_THRESHOLD_INR);
    const { snapshot } = realSnapshot(SALARIED);
    const result = buildDraftOutputPackage({
      taxCaseId: TAX_CASE_ID,
      statutory: STATUTORY,
      snapshot,
      review: APPROVED_FOR_SNAP1,
      promotedProposals: [],
    });
    expect(result.outcome).toBe("produced");
  });

  it("refuses pack_refused for a statutory world with no bound pack", () => {
    const { snapshot } = realSnapshot(SALARIED);
    const result = buildDraftOutputPackage({
      taxCaseId: TAX_CASE_ID,
      statutory: { assessmentYear: "2026-27", law: "ITA_2025" },
      snapshot,
      review: APPROVED_FOR_SNAP1,
      promotedProposals: [],
    });
    expect(result.outcome).toBe("refused");
    if (result.outcome === "refused") expect(result.reason).toBe("pack_refused");
  });

  it("noCurrentApprovalRefusal matches the reason a missing snapshot binding would produce", () => {
    expect(noCurrentApprovalRefusal().reason).toBe("not_approved");
  });
});

describe("K3-32 — buildDraftOutputPackage happy path", () => {
  function producedPackage(): DraftOutputPackage {
    const { snapshot } = realSnapshot(SALARIED);
    const result = buildDraftOutputPackage({
      taxCaseId: TAX_CASE_ID,
      statutory: STATUTORY,
      snapshot,
      review: APPROVED_FOR_SNAP1,
      promotedProposals: [
        {
          proposalId: "prop_income",
          taxCaseId: TAX_CASE_ID,
          factKind: "income.salary",
          sourceDocumentId: "doc_form16",
          promotedLedgerKind: "income",
          promotedLedgerEntryId: "inc_salary",
          decidedByName: "Priya CA",
          decidedAt: "2026-07-20T10:00:00Z",
          promotedByName: "Priya CA",
          promotedAt: "2026-07-20T10:05:00Z",
        },
      ],
    });
    if (result.outcome !== "produced") throw new Error("expected produced");
    return result;
  }

  it("produces a package for an approved, non-reliance-blocked snapshot", () => {
    const pkg = producedPackage();
    expect(pkg.formatVersion).toBe(DRAFT_OUTPUT_FORMAT_VERSION);
    expect(pkg.snapshotId).toBe("snap_1");
    expect(pkg.taxCaseId).toBe(TAX_CASE_ID);
    expect(pkg.disclaimer).toMatch(/not.*ITD JSON/i);
  });

  it("discloses (never hides) the pack's not-CA-verified status", () => {
    const pkg = producedPackage();
    expect(pkg.pack.verified).toBe(false);
    expect(pkg.pack.status).toBe("draft");
  });

  it("carries every material figure, traceable through the SAME describeCaseTraceability inventory Computation/Validation use", () => {
    const pkg = producedPackage();
    expect(pkg.figures).toHaveLength(COMPUTATION_FIGURE_INVENTORY.length);
    const refund = pkg.figures.find((f) => f.id === "outcome.refundOrPayable");
    expect(refund).toBeDefined();
    expect(refund?.kind).toBe("rule_derived");
  });

  it("evidence lineage names the promoted proposal behind the salary fact", () => {
    const pkg = producedPackage();
    const salaryFact = pkg.evidence.facts.find((f) => f.ledgerId === "inc_salary");
    expect(salaryFact?.promotedProposal?.proposalId).toBe("prop_income");
    const tdsFact = pkg.evidence.facts.find((f) => f.ledgerId === "tp_tds");
    expect(tdsFact?.promotedProposal).toBeNull();
  });

  it("is deterministic — identical inputs always yield an identical package", () => {
    const a = producedPackage();
    const b = producedPackage();
    expect(b).toEqual(a);
  });

  it("renders EXACTLY the immutable snapshot's own stored numbers, never recomputing from engine input", () => {
    const { snapshot } = realSnapshot(SALARIED);
    // Deliberately corrupt the stored output so it disagrees with what
    // re-running the engine on `engineInput` would produce — a
    // draft-output builder that (incorrectly) recomputed would show the
    // ORIGINAL number; one that only reads the snapshot shows this one.
    const mutated: StoredSnapshotForDraftOutput = {
      ...snapshot,
      computation: {
        ...snapshot.computation,
        refundOrPayable: { ...snapshot.computation.refundOrPayable, value: 999_999 },
      },
    };
    const result = buildDraftOutputPackage({
      taxCaseId: TAX_CASE_ID,
      statutory: STATUTORY,
      snapshot: mutated,
      review: APPROVED_FOR_SNAP1,
      promotedProposals: [],
    });
    if (result.outcome !== "produced") throw new Error("expected produced");
    const refund = result.figures.find((f) => f.id === "outcome.refundOrPayable");
    expect(refund?.value).toBe(999_999);
  });
});

// ---------------------------------------------------------------------------
// Purity boundary — never reads live ledgers or DB/React/Next.
// ---------------------------------------------------------------------------

describe("K3-32 — draft-output.ts purity boundary", () => {
  it("imports no React/Next/Supabase — the same PURE TYPESCRIPT ONLY discipline as the rest of tax-desk", () => {
    const source = readFileSync(join(__dirname, "..", "draft-output.ts"), "utf8");
    const importLines = source.split("\n").filter((l) => /^import /.test(l.trim()));
    for (const line of importLines) {
      expect(line).not.toMatch(/from ["']react/);
      expect(line).not.toMatch(/from ["']next/);
      expect(line).not.toMatch(/@\/lib\/supabase/);
      expect(line).not.toMatch(/@\/lib\/queries/);
    }
  });

  it("buildDraftOutputPackage's signature has no live-ledger parameter — it structurally cannot read live data", () => {
    const source = readFileSync(join(__dirname, "..", "draft-output.ts"), "utf8");
    const fnStart = source.indexOf("export function buildDraftOutputPackage(args: {");
    const fnEnd = source.indexOf("}): DraftOutputResult {");
    // AUDIT-04-F3 guards the guard: a signature rename must not produce an empty slice.
    expect(fnStart).toBeGreaterThanOrEqual(0);
    expect(fnEnd).toBeGreaterThan(fnStart);
    const signature = source.slice(fnStart, fnEnd);
    expect(signature).not.toMatch(/LedgerRows/);
    expect(signature).not.toMatch(/rows:/);
  });
});
