/**
 * `K3-32B` — the persisted internal draft-output artifact. Proves the package
 * is built entirely from an already-frozen manifest payload (no second
 * figure/evidence derivation, no live-ledger parameter anywhere in its
 * signature), its canonical hash is deterministic and change-sensitive the
 * same way the manifest's own hash is, and `checkDraftOutputEligibility`
 * refuses in every documented case before a network round trip is made.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildDraftOutputArtifactPackage,
  canonicalizeDraftOutputArtifactPayload,
  checkDraftOutputEligibility,
  computeDraftOutputArtifactContentHash,
  DRAFT_OUTPUT_ARTIFACT_DISCLAIMER,
  DRAFT_OUTPUT_ARTIFACT_STATUS,
  DRAFT_OUTPUT_PACKAGE_SCHEMA_VERSION,
  type DraftOutputArtifactPackage,
} from "../draft-output-artifact";
import { buildManifestPayload, resolveEvidenceManifestCandidate, type ManifestPayload } from "../evidence-manifest";
import { buildEngineInput, type CaseMeta, type LedgerRows } from "../computation-adapter";
import { compareRegimes, computeTax, recommendItrForm } from "@/lib/tax-engine/ay-2026-27";
import type { StoredEngineInputPayload, StoredSnapshotForDraftOutput } from "../draft-output";

const META: CaseMeta = { assessmentYear: "2026-27", financialYear: "2025-26", selectedItrType: "ITR-1", finalized: false };
const STATUTORY = { assessmentYear: "2026-27" };
const TAX_CASE_ID = "case_1";
const EMPTY: LedgerRows = { income: [], taxPaid: [], deductions: [], capitalGains: [] };
const SALARIED: LedgerRows = {
  ...EMPTY,
  income: [{ id: "inc_salary", income_head: "salary", amount: 900_000, source_type: "Form16", source_document_id: "doc_form16" }],
  taxPaid: [{ id: "tp_tds", tax_paid_type: "salary_tds", amount: 60_000, source_type: "Form16", source_document_id: "doc_form16" }],
};

function realSnapshot(rows: LedgerRows): StoredSnapshotForDraftOutput {
  const adapter = buildEngineInput(rows, META);
  const computation = computeTax(adapter.input);
  const comparison = compareRegimes(adapter.input);
  const recommendation = recommendItrForm(adapter.input);
  const engineInput: StoredEngineInputPayload = {
    assessmentYear: adapter.input.assessmentYear,
    financialYear: adapter.input.financialYear,
    selectedItrType: adapter.input.selectedItrType ?? null,
    income: adapter.input.income,
    taxPaid: adapter.input.taxPaid,
    deductions: adapter.input.deductions,
    capitalGains: adapter.input.capitalGains,
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
  };
}

function manifestPayload(): ManifestPayload {
  const snapshot = realSnapshot(SALARIED);
  const result = resolveEvidenceManifestCandidate({
    taxCaseId: TAX_CASE_ID,
    statutory: STATUTORY,
    snapshot,
    selectedRegime: "new",
    promotedProposals: [],
    ageBand: "below_60",
    residentialStatus: "resident",
  });
  if (result.outcome !== "candidate") throw new Error("expected candidate");
  return buildManifestPayload(result, { validationRulesVersion: "K2.8.readiness.v1", sourceTypeByLedgerId: new Map() });
}

function artifact(): DraftOutputArtifactPackage {
  const payload = manifestPayload();
  return buildDraftOutputArtifactPackage({
    manifestId: "manifest_1",
    manifestHash: "a".repeat(64),
    manifestPayload: payload,
    snapshot: {
      assessmentYear: "2026-27",
      financialYear: "2025-26",
      selectedItrType: "ITR-1",
      recommendedItrType: "ITR-1",
    },
  });
}

describe("K3-32B — buildDraftOutputArtifactPackage", () => {
  it("copies figures/evidence verbatim from the manifest payload — no second derivation", () => {
    const payload = manifestPayload();
    const pkg = artifact();
    expect(pkg.figures).toEqual(payload.figures);
    expect(pkg.evidenceFacts).toEqual(payload.evidenceFacts);
    expect(pkg.selectedRegime).toBe(payload.selectedRegime);
    expect(pkg.selectedRegimeTotalIncome).toBe(payload.selectedRegimeTotalIncome);
    expect(pkg.taxPackId).toBe(payload.taxPackId);
  });

  it("carries the source manifest id/hash and internal_draft status + disclaimer", () => {
    const pkg = artifact();
    expect(pkg.schemaVersion).toBe(DRAFT_OUTPUT_PACKAGE_SCHEMA_VERSION);
    expect(pkg.sourceManifestId).toBe("manifest_1");
    expect(pkg.sourceManifestHash).toBe("a".repeat(64));
    expect(pkg.status).toBe(DRAFT_OUTPUT_ARTIFACT_STATUS);
    expect(pkg.disclaimer).toBe(DRAFT_OUTPUT_ARTIFACT_DISCLAIMER);
    expect(pkg.disclaimer).toMatch(/not.*ITD JSON/i);
    expect(pkg.disclaimer).not.toMatch(/file the return|filed successfully|accepted by/i);
  });
});

describe("K3-32B — canonicalization / hash", () => {
  it("is deterministic regardless of array order", () => {
    const p1 = artifact();
    const p2: DraftOutputArtifactPackage = {
      ...p1,
      figures: [...p1.figures].reverse(),
      evidenceFacts: [...p1.evidenceFacts].reverse(),
    };
    expect(canonicalizeDraftOutputArtifactPayload(p1)).toBe(canonicalizeDraftOutputArtifactPayload(p2));
    expect(computeDraftOutputArtifactContentHash(p1)).toBe(computeDraftOutputArtifactContentHash(p2));
  });

  it("produces a 64-char lowercase hex sha256 digest", () => {
    expect(computeDraftOutputArtifactContentHash(artifact())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when a figure's value changes", () => {
    const p1 = artifact();
    const p2: DraftOutputArtifactPackage = {
      ...p1,
      figures: p1.figures.map((f, i) => (i === 0 ? { ...f, value: typeof f.value === "number" ? f.value + 1 : f.value } : f)),
    };
    expect(computeDraftOutputArtifactContentHash(p1)).not.toBe(computeDraftOutputArtifactContentHash(p2));
  });

  it("changes when the source manifest hash changes", () => {
    const p1 = artifact();
    const p2: DraftOutputArtifactPackage = { ...p1, sourceManifestHash: "b".repeat(64) };
    expect(computeDraftOutputArtifactContentHash(p1)).not.toBe(computeDraftOutputArtifactContentHash(p2));
  });
});

describe("K3-32B — checkDraftOutputEligibility", () => {
  const REVIEW_CURRENT = { status: "approved", reviewSnapshotId: "snap_1", reviewManifestId: "manifest_1" };
  const MANIFEST = { id: "manifest_1", snapshotId: "snap_1", activeBlockerCodes: [] as string[] };

  it("eligible when finalized=false, manifest exists, approval is current, no blockers, no open validation errors", () => {
    const r = checkDraftOutputEligibility({
      finalized: false,
      manifest: MANIFEST,
      review: REVIEW_CURRENT,
      openValidationBlockerCount: 0,
    });
    expect(r.eligible).toBe(true);
    expect(r.reason).toBeNull();
  });

  it("refuses case_finalized", () => {
    const r = checkDraftOutputEligibility({ finalized: true, manifest: MANIFEST, review: REVIEW_CURRENT, openValidationBlockerCount: 0 });
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("case_finalized");
  });

  it("refuses manifest_not_found when no manifest exists", () => {
    const r = checkDraftOutputEligibility({ finalized: false, manifest: null, review: REVIEW_CURRENT, openValidationBlockerCount: 0 });
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("manifest_not_found");
  });

  it("refuses not_approved (stale approval) when review.reviewManifestId is a DIFFERENT manifest", () => {
    const r = checkDraftOutputEligibility({
      finalized: false,
      manifest: MANIFEST,
      review: { status: "approved", reviewSnapshotId: "snap_1", reviewManifestId: "manifest_OLD" },
      openValidationBlockerCount: 0,
    });
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("not_approved");
  });

  it("refuses not_approved when status is not approved at all", () => {
    const r = checkDraftOutputEligibility({
      finalized: false,
      manifest: MANIFEST,
      review: { status: "sent", reviewSnapshotId: "snap_1", reviewManifestId: "manifest_1" },
      openValidationBlockerCount: 0,
    });
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("not_approved");
  });

  it("refuses reliance_blocked when the manifest carries an active blocker code", () => {
    const r = checkDraftOutputEligibility({
      finalized: false,
      manifest: { ...MANIFEST, activeBlockerCodes: ["SURCHARGE_MARGINAL_RELIEF_UNSUPPORTED"] },
      review: REVIEW_CURRENT,
      openValidationBlockerCount: 0,
    });
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("reliance_blocked");
  });

  it("refuses open_validation_blockers", () => {
    const r = checkDraftOutputEligibility({ finalized: false, manifest: MANIFEST, review: REVIEW_CURRENT, openValidationBlockerCount: 2 });
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("open_validation_blockers");
  });
});

describe("K3-32B — draft-output-artifact.ts purity boundary", () => {
  it("imports no React/Next/Supabase/queries/case-traceability (no second traceability derivation)", () => {
    const source = readFileSync(join(__dirname, "..", "draft-output-artifact.ts"), "utf8");
    const importLines = source.split("\n").filter((l) => /^import /.test(l.trim()));
    for (const line of importLines) {
      expect(line).not.toMatch(/from ["']react/);
      expect(line).not.toMatch(/from ["']next/);
      expect(line).not.toMatch(/@\/lib\/supabase/);
      expect(line).not.toMatch(/@\/lib\/queries/);
      expect(line).not.toMatch(/case-traceability/);
    }
  });

  it("buildDraftOutputArtifactPackage's signature has no live-ledger parameter", () => {
    const source = readFileSync(join(__dirname, "..", "draft-output-artifact.ts"), "utf8");
    const fnStart = source.indexOf("export function buildDraftOutputArtifactPackage(args: {");
    const fnEnd = source.indexOf("}): DraftOutputArtifactPackage {");
    // AUDIT-04-F3 guards the guard: a signature rename must not produce an empty slice.
    expect(fnStart).toBeGreaterThanOrEqual(0);
    expect(fnEnd).toBeGreaterThan(fnStart);
    const signature = source.slice(fnStart, fnEnd);
    expect(signature).not.toMatch(/LedgerRows/);
    expect(signature).not.toMatch(/\brows:/);
  });
});
