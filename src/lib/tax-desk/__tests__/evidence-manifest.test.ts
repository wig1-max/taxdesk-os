/**
 * `K3-32B` — immutable accepted-evidence manifest. Proves: a manifest can
 * only be built when a regime has been EXPLICITLY selected (never silently
 * defaulted to the recommended regime); the manifest-creation gate uses the
 * SELECTED regime's own total income (not the conservative higher-of-both
 * figure preparation-stage checks use); the canonical serialization and
 * sha256 hash are deterministic for identical semantic payloads and change
 * for any material difference; and `isApprovalCurrentForManifest` builds on
 * (never re-derives) `isApprovalCurrentForSnapshot`.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildManifestPayload,
  canonicalizeManifestPayload,
  computeManifestContentHash,
  EVIDENCE_MANIFEST_DISCLAIMER,
  isApprovalCurrentForManifest,
  isRegime,
  MANIFEST_SCHEMA_VERSION,
  manifestStatutoryContextForSnapshot,
  resolveEvidenceManifestCandidate,
  type EvidenceManifestCandidate,
  type ManifestPayload,
} from "../evidence-manifest";
import { buildEngineInput, type CaseMeta, type LedgerRows } from "../computation-adapter";
import { compareRegimes, computeTax, recommendItrForm } from "@/lib/tax-engine/ay-2026-27";
import { SURCHARGE_MARGINAL_RELIEF_RISK_THRESHOLD_INR } from "../tax-capability";
import { PRE_K4_17_RULES_VERSION } from "@/lib/tax-engine/ay-2026-27/rules";
import type { PromotedProposalLineage } from "../case-traceability";
import type { StoredEngineInputPayload, StoredSnapshotForDraftOutput } from "../draft-output";

const META: CaseMeta = {
  assessmentYear: "2026-27",
  financialYear: "2025-26",
  selectedItrType: "ITR-1",
  finalized: false,
};
const STATUTORY = { assessmentYear: "2026-27" };
const TAX_CASE_ID = "case_1";

const EMPTY: LedgerRows = { income: [], taxPaid: [], deductions: [], capitalGains: [] };

const SALARIED: LedgerRows = {
  ...EMPTY,
  income: [
    { id: "inc_salary", income_head: "salary", amount: 900_000, source_type: "Form16", source_document_id: "doc_form16" },
  ],
  taxPaid: [
    { id: "tp_tds", tax_paid_type: "salary_tds", amount: 60_000, source_type: "Form16", source_document_id: "doc_form16" },
  ],
};

const MANUAL_SALARIED: LedgerRows = {
  ...EMPTY,
  income: [{ id: "inc_salary_manual", income_head: "salary", amount: 700_000, source_type: "manual" }],
  taxPaid: [{ id: "tp_tds_manual", tax_paid_type: "salary_tds", amount: 40_000, source_type: "manual" }],
};

function realSnapshot(rows: LedgerRows, over: Partial<StoredSnapshotForDraftOutput> = {}): StoredSnapshotForDraftOutput {
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
  };
}

const PROMOTED: PromotedProposalLineage = {
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

describe("K3-32B — isRegime", () => {
  it("accepts only 'old'/'new'", () => {
    expect(isRegime("old")).toBe(true);
    expect(isRegime("new")).toBe(true);
    expect(isRegime("recommended")).toBe(false);
    expect(isRegime(null)).toBe(false);
    expect(isRegime(undefined)).toBe(false);
  });
});

describe("K4-17 — manifest snapshot pack binding", () => {
  it("pins the exact historical computation version stamped on the snapshot", () => {
    expect(manifestStatutoryContextForSnapshot("2026-27", PRE_K4_17_RULES_VERSION)).toEqual({
      assessmentYear: "2026-27",
      computationRulesVersion: PRE_K4_17_RULES_VERSION,
    });
  });
});

describe("K3-32B — resolveEvidenceManifestCandidate refusals", () => {
  it("refuses regime_not_selected when no regime is explicitly chosen — never silently uses the recommended regime", () => {
    const snapshot = realSnapshot(SALARIED);
    const result = resolveEvidenceManifestCandidate({
      taxCaseId: TAX_CASE_ID,
      statutory: STATUTORY,
      snapshot,
      selectedRegime: null,
      promotedProposals: [],
      ageBand: "below_60",
      residentialStatus: "resident",
    });
    expect(result.outcome).toBe("refused");
    if (result.outcome === "refused") expect(result.reason).toBe("regime_not_selected");
  });

  it("refuses snapshot_incomplete defensively", () => {
    const snapshot = realSnapshot(SALARIED, { complete: false });
    const result = resolveEvidenceManifestCandidate({
      taxCaseId: TAX_CASE_ID,
      statutory: STATUTORY,
      snapshot,
      selectedRegime: "new",
      promotedProposals: [],
      ageBand: "below_60",
      residentialStatus: "resident",
    });
    expect(result.outcome).toBe("refused");
    if (result.outcome === "refused") expect(result.reason).toBe("snapshot_incomplete");
  });

  it("refuses pack_refused for a statutory world with no bound pack", () => {
    const snapshot = realSnapshot(SALARIED);
    const result = resolveEvidenceManifestCandidate({
      taxCaseId: TAX_CASE_ID,
      statutory: { assessmentYear: "2026-27", law: "ITA_2025" },
      snapshot,
      selectedRegime: "new",
      promotedProposals: [],
      ageBand: "below_60",
      residentialStatus: "resident",
    });
    expect(result.outcome).toBe("refused");
    if (result.outcome === "refused") expect(result.reason).toBe("pack_refused");
  });

  it("EXACT ₹50,00,000 selected-regime income is NOT blocked solely by surcharge (strict `>`, D44 boundary)", () => {
    const base = realSnapshot(SALARIED);
    const snapshot: StoredSnapshotForDraftOutput = {
      ...base,
      computation: {
        ...base.computation,
        oldRegime: { ...base.computation.oldRegime, totalIncome: { ...base.computation.oldRegime.totalIncome, value: SURCHARGE_MARGINAL_RELIEF_RISK_THRESHOLD_INR } },
      },
    };
    const result = resolveEvidenceManifestCandidate({
      taxCaseId: TAX_CASE_ID,
      statutory: STATUTORY,
      snapshot,
      selectedRegime: "old",
      promotedProposals: [],
      ageBand: "below_60",
      residentialStatus: "resident",
    });
    expect(result.outcome).toBe("candidate");
  });

  // K4-11 REPLACED this assertion deliberately (the D123 convention). It used
  // to assert that ₹50,00,001 IS blocked, which was right while no surcharge
  // was implemented. It is now the narrowing's own boundary case: the block
  // depends on the engine's verdict, not on the income alone. Both directions
  // are pinned below, on the SAME income, so the change is visible rather than
  // merely absent.
  it("₹50,00,001 selected-regime income is blocked ONLY when the engine could not treat it (K4-11 narrowing)", () => {
    const base = realSnapshot(SALARIED);
    const build = (surchargeTreatmentSupported: boolean | undefined): StoredSnapshotForDraftOutput => ({
      ...base,
      computation: {
        ...base.computation,
        surchargeTreatmentSupported,
        oldRegime: { ...base.computation.oldRegime, totalIncome: { ...base.computation.oldRegime.totalIncome, value: SURCHARGE_MARGINAL_RELIEF_RISK_THRESHOLD_INR + 1 } },
      },
    });
    const resolve = (snapshot: StoredSnapshotForDraftOutput) =>
      resolveEvidenceManifestCandidate({
        taxCaseId: TAX_CASE_ID,
        statutory: STATUTORY,
        snapshot,
        selectedRegime: "old",
        promotedProposals: [],
        ageBand: "below_60",
        residentialStatus: "resident",
      });

    // Engine could NOT treat it (above the ₹2,00,00,000 ceiling, or an
    // ambiguous marginal-relief reference) → still blocked, same stable code.
    const blocked = resolve(build(false));
    expect(blocked.outcome).toBe("refused");
    if (blocked.outcome === "refused") {
      expect(blocked.reason).toBe("reliance_blocked");
      expect(blocked.blocker?.code).toBe("SURCHARGE_MARGINAL_RELIEF_UNSUPPORTED");
    }

    // A pre-K4-11 snapshot carries no verdict → fails closed, still blocked.
    expect(resolve(build(undefined)).outcome).toBe("refused");

    // Engine DID treat it → released. This is the narrowing.
    expect(resolve(build(true)).outcome).toBe("candidate");
  });

  it("an UNSELECTED alternative regime above ₹50L does NOT block a below-threshold SELECTED regime — this is the regime-selective gate, not the conservative one", () => {
    const base = realSnapshot(SALARIED);
    const snapshot: StoredSnapshotForDraftOutput = {
      ...base,
      computation: {
        ...base.computation,
        // K4-11: the engine could NOT treat this case's surcharge. Set
        // explicitly so the assertion below still isolates the REGIME-SELECTIVE
        // behaviour under test — with a supported verdict neither capability
        // result would carry a blocker and the two would no longer differ,
        // which would quietly turn this into a test of nothing.
        surchargeTreatmentSupported: false,
        oldRegime: { ...base.computation.oldRegime, totalIncome: { ...base.computation.oldRegime.totalIncome, value: 52_00_000 } },
        newRegime: { ...base.computation.newRegime, totalIncome: { ...base.computation.newRegime.totalIncome, value: 40_00_000 } },
      },
    };
    const result = resolveEvidenceManifestCandidate({
      taxCaseId: TAX_CASE_ID,
      statutory: STATUTORY,
      snapshot,
      selectedRegime: "new",
      promotedProposals: [],
      ageBand: "below_60",
      residentialStatus: "resident",
    });
    expect(result.outcome).toBe("candidate");
    if (result.outcome === "candidate") {
      expect(result.selectedRegimeTotalIncome).toBe(40_00_000);
      // The conservative figure (used only for disclosure, never as this
      // module's own gate) is still the higher of the two, and DOES carry a
      // blocker — proving the two capability results genuinely differ.
      expect(result.preApprovalConservativeTotalIncome).toBe(52_00_000);
      expect(result.snapshotCapabilityResult.blockers).toHaveLength(0);
      expect(result.preApprovalCapabilityResult.blockers).toHaveLength(1);
    }
  });

  it("the SAME alternative-above-threshold snapshot IS blocked when the ABOVE-threshold regime is the one selected", () => {
    const base = realSnapshot(SALARIED);
    const snapshot: StoredSnapshotForDraftOutput = {
      ...base,
      // K4-11: same reason as the sibling test above — the engine's verdict is
      // pinned to `false` so this stays a test of the regime-selective gate.
      computation: {
        ...base.computation,
        surchargeTreatmentSupported: false,
        oldRegime: { ...base.computation.oldRegime, totalIncome: { ...base.computation.oldRegime.totalIncome, value: 52_00_000 } },
        newRegime: { ...base.computation.newRegime, totalIncome: { ...base.computation.newRegime.totalIncome, value: 40_00_000 } },
      },
    };
    const result = resolveEvidenceManifestCandidate({
      taxCaseId: TAX_CASE_ID,
      statutory: STATUTORY,
      snapshot,
      selectedRegime: "old",
      promotedProposals: [],
      ageBand: "below_60",
      residentialStatus: "resident",
    });
    expect(result.outcome).toBe("refused");
    if (result.outcome === "refused") expect(result.reason).toBe("reliance_blocked");
  });
});

describe("K4-01 — resolveEvidenceManifestCandidate senior-treatment gate", () => {
  // K4-05 (decision D79): the full later-computation dossier (§10.1-§10.4)
  // is now closed, so a resident senior/super-senior taxpayer selecting the
  // OLD regime is no longer refused by this gate — it produces a candidate,
  // exactly like the below-60/NEW-regime cases already did.
  it("does NOT block a resident senior selecting the OLD regime (K4-05)", () => {
    const snapshot = realSnapshot(SALARIED);
    const result = resolveEvidenceManifestCandidate({
      taxCaseId: TAX_CASE_ID,
      statutory: STATUTORY,
      snapshot,
      selectedRegime: "old",
      promotedProposals: [],
      ageBand: "senior",
      residentialStatus: "resident",
    });
    expect(result.outcome).toBe("candidate");
    if (result.outcome === "candidate") {
      expect(result.seniorTreatmentSelectedRegimeResult.riskCode).toBeNull();
      expect(result.seniorTreatmentSelectedRegimeResult.isRelianceBlocked).toBe(false);
    }
  });

  it("does NOT block a resident super-senior selecting the OLD regime (K4-05)", () => {
    const snapshot = realSnapshot(SALARIED);
    const result = resolveEvidenceManifestCandidate({
      taxCaseId: TAX_CASE_ID,
      statutory: STATUTORY,
      snapshot,
      selectedRegime: "old",
      promotedProposals: [],
      ageBand: "super_senior",
      residentialStatus: "resident",
    });
    expect(result.outcome).toBe("candidate");
  });

  it("does NOT block a resident senior selecting the NEW regime solely for age, and no longer discloses comparison unreliability (K4-05)", () => {
    const snapshot = realSnapshot(SALARIED);
    const result = resolveEvidenceManifestCandidate({
      taxCaseId: TAX_CASE_ID,
      statutory: STATUTORY,
      snapshot,
      selectedRegime: "new",
      promotedProposals: [],
      ageBand: "senior",
      residentialStatus: "resident",
    });
    expect(result.outcome).toBe("candidate");
    if (result.outcome === "candidate") {
      expect(result.seniorTreatmentSelectedRegimeResult.riskCode).toBeNull();
      expect(result.seniorTreatmentSelectedRegimeResult.isRelianceBlocked).toBe(false);
      expect(result.seniorTreatmentPreApprovalResult.riskCode).toBeNull();
    }
  });

  it("does not block a below-60 resident regardless of selected regime", () => {
    const snapshot = realSnapshot(SALARIED);
    for (const regime of ["old", "new"] as const) {
      const result = resolveEvidenceManifestCandidate({
        taxCaseId: TAX_CASE_ID,
        statutory: STATUTORY,
        snapshot,
        selectedRegime: regime,
        promotedProposals: [],
        ageBand: "below_60",
        residentialStatus: "resident",
      });
      expect(result.outcome).toBe("candidate");
    }
  });

  it("does not apply resident senior treatment to a non-resident taxpayer (no senior-specific block)", () => {
    const snapshot = realSnapshot(SALARIED);
    const result = resolveEvidenceManifestCandidate({
      taxCaseId: TAX_CASE_ID,
      statutory: STATUTORY,
      snapshot,
      selectedRegime: "old",
      promotedProposals: [],
      ageBand: "senior",
      residentialStatus: "non_resident",
    });
    expect(result.outcome).toBe("candidate");
  });

  it("fails closed on unresolved residential status", () => {
    const snapshot = realSnapshot(SALARIED);
    const result = resolveEvidenceManifestCandidate({
      taxCaseId: TAX_CASE_ID,
      statutory: STATUTORY,
      snapshot,
      selectedRegime: "old",
      promotedProposals: [],
      ageBand: "senior",
      residentialStatus: null,
    });
    expect(result.outcome).toBe("refused");
    if (result.outcome === "refused") {
      expect(result.reason).toBe("senior_treatment_blocked");
      expect(result.seniorTreatmentResult?.riskCode).toBe("RESIDENTIAL_STATUS_UNRESOLVED");
    }
  });

  it("carries ageBand/residentialStatus and the senior risk codes onto the manifest payload (K4-05: comparison no longer flagged unreliable)", () => {
    const snapshot = realSnapshot(SALARIED);
    const result = resolveEvidenceManifestCandidate({
      taxCaseId: TAX_CASE_ID,
      statutory: STATUTORY,
      snapshot,
      selectedRegime: "new",
      promotedProposals: [],
      ageBand: "senior",
      residentialStatus: "resident",
    });
    if (result.outcome !== "candidate") throw new Error("expected candidate");
    const payload = buildManifestPayload(result, { validationRulesVersion: "v1", sourceTypeByLedgerId: new Map() });
    expect(payload.seniorTreatmentAgeBand).toBe("senior");
    expect(payload.seniorTreatmentResidentialStatus).toBe("resident");
    expect(payload.seniorTreatmentSelectedRegimeRiskCode).toBeNull();
    expect(payload.seniorTreatmentComparisonUnreliable).toBe(false);
  });

  it("a co-occurring surcharge risk still blocks a resident senior on the OLD regime — via the SURCHARGE gate now, not the (K4-05-removed) senior gate", () => {
    const base = realSnapshot(SALARIED);
    const highIncomeSnapshot: StoredSnapshotForDraftOutput = {
      ...base,
      computation: {
        ...base.computation,
        // K4-11: the surcharge gate only fires when the engine could not treat
        // the case, so the verdict is pinned false — otherwise this test would
        // silently stop exercising the surcharge gate it is named for, and pass
        // for the wrong reason.
        surchargeTreatmentSupported: false,
        oldRegime: {
          ...base.computation.oldRegime,
          totalIncome: { ...base.computation.oldRegime.totalIncome, value: SURCHARGE_MARGINAL_RELIEF_RISK_THRESHOLD_INR + 1 },
        },
      },
    };
    // K4-05: the senior gate no longer refuses this case (the OLD-regime
    // block was removed) — the surcharge/marginal-relief gate, an entirely
    // SEPARATE reliance blocker, is reached next and refuses on its own
    // terms, proving the two gates are independent (neither masks the
    // other's absence or presence).
    const result = resolveEvidenceManifestCandidate({
      taxCaseId: TAX_CASE_ID,
      statutory: STATUTORY,
      snapshot: highIncomeSnapshot,
      selectedRegime: "old",
      promotedProposals: [],
      ageBand: "senior",
      residentialStatus: "resident",
    });
    expect(result.outcome).toBe("refused");
    if (result.outcome === "refused") expect(result.reason).toBe("reliance_blocked");
  });
});

describe("K3-32B — resolveEvidenceManifestCandidate happy path + evidence", () => {
  function candidate(rows: LedgerRows = SALARIED, promoted: readonly PromotedProposalLineage[] = [PROMOTED]): EvidenceManifestCandidate {
    const snapshot = realSnapshot(rows);
    const result = resolveEvidenceManifestCandidate({
      taxCaseId: TAX_CASE_ID,
      statutory: STATUTORY,
      snapshot,
      selectedRegime: "new",
      promotedProposals: promoted,
      ageBand: "below_60",
      residentialStatus: "resident",
    });
    if (result.outcome !== "candidate") throw new Error("expected candidate");
    return result;
  }

  it("produces a candidate carrying every material figure, mirroring draft-output.ts's own traceability inventory", () => {
    const c = candidate();
    expect(c.figures.length).toBeGreaterThan(0);
    expect(c.pack.verified).toBe(false);
  });

  it("evidence facts distinguish a promoted (proposal-accepted) row from a manually entered one", () => {
    const c = candidate();
    const salaryFact = c.evidence.facts.find((f) => f.ledgerId === "inc_salary");
    expect(salaryFact?.promotedProposal?.proposalId).toBe("prop_income");
    const tdsFact = c.evidence.facts.find((f) => f.ledgerId === "tp_tds");
    expect(tdsFact?.promotedProposal).toBeNull();
  });

  it("a MANUALLY entered Form16-shaped fact is never described as proposal-accepted, even with unrelated promoted proposals in scope", () => {
    const c = candidate(MANUAL_SALARIED, [PROMOTED]);
    const manualFact = c.evidence.facts.find((f) => f.ledgerId === "inc_salary_manual");
    expect(manualFact?.promotedProposal).toBeNull();
  });

  it("retains books-business contributing facts from a V1 stored snapshot", () => {
    const c = candidate({
      ...EMPTY,
      businessBooksEntries: [{
        id: "books_profit",
        revenue: 300_000,
        expenses: 100_000,
        is_profession: false,
        adjustments: "none_s30_43d",
        activity_classification: "ordinary_business_or_profession",
        source_type: "manual",
      }],
    }, []);
    const booksLine = c.figures.find((line) => line.id === "detail.new.businessBooksIncome");
    expect(booksLine?.unresolvedSourceTags).toEqual([]);
    expect(booksLine?.contributingFacts.map((fact) => fact.ledgerId)).toEqual(["books_profit"]);
  });
});

describe("K3-32B — buildManifestPayload / canonicalization / hash", () => {
  function payload(): ManifestPayload {
    const snapshot = realSnapshot(SALARIED);
    const result = resolveEvidenceManifestCandidate({
      taxCaseId: TAX_CASE_ID,
      statutory: STATUTORY,
      snapshot,
      selectedRegime: "new",
      promotedProposals: [PROMOTED],
      ageBand: "below_60",
      residentialStatus: "resident",
    });
    if (result.outcome !== "candidate") throw new Error("expected candidate");
    return buildManifestPayload(result, {
      validationRulesVersion: "K2.8.readiness.v1",
      sourceTypeByLedgerId: new Map([
        ["inc_salary", "Form16"],
        ["tp_tds", "Form16"],
      ]),
    });
  }

  it("carries the schema version, selected regime, and disclaimer", () => {
    const p = payload();
    expect(p.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION);
    expect(p.selectedRegime).toBe("new");
    expect(p.disclaimer).toBe(EVIDENCE_MANIFEST_DISCLAIMER);
    expect(p.disclaimer).toMatch(/not.*ITD JSON/i);
    expect(p.disclaimer).toMatch(/not.*e-filing upload package/i);
    expect(p.disclaimer).not.toMatch(/file the return|filed successfully|accepted by/i);
  });

  it("enriches evidence facts with their stored sourceType", () => {
    const p = payload();
    expect(p.evidenceFacts.find((f) => f.ledgerId === "inc_salary")?.sourceType).toBe("Form16");
  });

  it("canonicalization is deterministic for identical semantic payloads regardless of array order", () => {
    const p1 = payload();
    const p2: ManifestPayload = {
      ...p1,
      figures: [...p1.figures].reverse(),
      evidenceFacts: [...p1.evidenceFacts].reverse(),
      activeBlockerCodes: [...p1.activeBlockerCodes].reverse(),
    };
    expect(canonicalizeManifestPayload(p1)).toBe(canonicalizeManifestPayload(p2));
    expect(computeManifestContentHash(p1)).toBe(computeManifestContentHash(p2));
  });

  it("the hash is a 64-character lowercase hex sha256 digest", () => {
    const hash = computeManifestContentHash(payload());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a material change (one figure's value) changes the hash", () => {
    const p1 = payload();
    const p2: ManifestPayload = {
      ...p1,
      figures: p1.figures.map((f, i) => (i === 0 ? { ...f, value: typeof f.value === "number" ? f.value + 1 : f.value } : f)),
    };
    expect(computeManifestContentHash(p1)).not.toBe(computeManifestContentHash(p2));
  });

  it("a material change (selected regime) changes the hash", () => {
    const p1 = payload();
    const p2: ManifestPayload = { ...p1, selectedRegime: "old" };
    expect(computeManifestContentHash(p1)).not.toBe(computeManifestContentHash(p2));
  });
});

describe("K3-32B — isApprovalCurrentForManifest", () => {
  it("true only when status is approved AND both snapshot id and manifest id match", () => {
    expect(
      isApprovalCurrentForManifest(
        { status: "approved", reviewSnapshotId: "snap_1", reviewManifestId: "manifest_1" },
        "snap_1",
        "manifest_1",
      ),
    ).toBe(true);
  });

  it("false when the manifest id disagrees, even with a matching snapshot id and approved status", () => {
    expect(
      isApprovalCurrentForManifest(
        { status: "approved", reviewSnapshotId: "snap_1", reviewManifestId: "manifest_OLD" },
        "snap_1",
        "manifest_NEW",
      ),
    ).toBe(false);
  });

  it("false when the snapshot half fails (delegates to isApprovalCurrentForSnapshot, not re-derived)", () => {
    expect(
      isApprovalCurrentForManifest(
        { status: "approved", reviewSnapshotId: "snap_OLD", reviewManifestId: "manifest_1" },
        "snap_NEW",
        "manifest_1",
      ),
    ).toBe(false);
  });

  it("false when status is not approved", () => {
    expect(
      isApprovalCurrentForManifest(
        { status: "sent", reviewSnapshotId: "snap_1", reviewManifestId: "manifest_1" },
        "snap_1",
        "manifest_1",
      ),
    ).toBe(false);
  });
});

describe("K3-32B — evidence-manifest.ts purity boundary", () => {
  it("imports no React/Next/Supabase/queries", () => {
    const source = readFileSync(join(__dirname, "..", "evidence-manifest.ts"), "utf8");
    const importLines = source.split("\n").filter((l) => /^import /.test(l.trim()));
    for (const line of importLines) {
      expect(line).not.toMatch(/from ["']react/);
      expect(line).not.toMatch(/from ["']next/);
      expect(line).not.toMatch(/@\/lib\/supabase/);
      expect(line).not.toMatch(/@\/lib\/queries/);
    }
  });

  it("resolveEvidenceManifestCandidate's signature has no live-ledger parameter", () => {
    const source = readFileSync(join(__dirname, "..", "evidence-manifest.ts"), "utf8");
    const fnStart = source.indexOf("export function resolveEvidenceManifestCandidate(args: {");
    const fnEnd = source.indexOf("}): EvidenceManifestResult {");
    // AUDIT-04-F3 guards the guard: a signature rename must not produce an empty slice.
    expect(fnStart).toBeGreaterThanOrEqual(0);
    expect(fnEnd).toBeGreaterThan(fnStart);
    const signature = source.slice(fnStart, fnEnd);
    expect(signature).not.toMatch(/LedgerRows/);
    expect(signature).not.toMatch(/\brows:/);
  });
});
