/**
 * K3-12 — the per-case tax-pack resolution AUTHORITY.
 *
 * Proves: (1) a case resolves exactly one governing pack from its statutory
 * coordinates; (2) the versions it yields for the pack TaxDesk OS ships today are
 * BYTE-IDENTICAL to the engine constant that used to be stamped directly, so
 * nothing stored changes; (3) unsupported / ambiguous / unbound coordinates are
 * refused, never guessed; and (4) a snapshot produced under a DIFFERENT pack
 * version is detectably stale in the readiness reader.
 */

import { describe, expect, it } from "vitest";
import {
  bindDefaultTaxPackToCase,
  bindTaxPackToCase,
  createDefaultTaxPackRegistry,
  createTaxPackRegistry,
  makeTaxPack,
  makeTaxPackIdentity,
  periodKindForLaw,
  taxCaseStatutoryContext,
  storedTaxPackKeyForLaw,
  taxCasePackSelector,
  taxPackVersions,
  taxPackKey,
  AY_2026_27_PACK_IDENTITY,
  TY_2026_27_PACK_IDENTITY,
  TY_2026_27_PERIOD,
  TY_2026_27_RULES_VERSION,
} from "@/lib/tax-pack";
import { computeTax, compareRegimes, recommendItrForm, validateCase } from "@/lib/tax-engine/ay-2026-27";
import {
  RULES_VERSION,
  PRE_K4_17_RULES_VERSION,
  ASSESSMENT_YEAR,
} from "@/lib/tax-engine/ay-2026-27/rules";
import {
  assembleFilingReadiness,
  type FilingReadinessInput,
  type ReadinessSnapshot,
} from "@/lib/tax-desk/filing-readiness";
import type { TaxEngineInput } from "@/lib/tax-engine/ay-2026-27";

// --- selector --------------------------------------------------------------

describe("taxCasePackSelector", () => {
  it("defaults to IN / ITA_1961 / assessment_year", () => {
    expect(taxCasePackSelector({ assessmentYear: "2026-27" })).toEqual({
      jurisdiction: "IN",
      law: "ITA_1961",
      periodKind: "assessment_year",
      period: "2026-27",
    });
  });

  it("maps the 2025 Act to tax years", () => {
    expect(periodKindForLaw("ITA_1961")).toBe("assessment_year");
    expect(periodKindForLaw("ITA_2025")).toBe("tax_year");
    expect(taxCasePackSelector({ assessmentYear: "2026-27", law: "ITA_2025" }).periodKind).toBe("tax_year");
  });

  it("builds a stored-row context: omitted law is ITA_1961, ITA_2025 is passed through", () => {
    expect(taxCaseStatutoryContext("2026-27")).toEqual({ assessmentYear: "2026-27", law: "ITA_1961" });
    expect(taxCaseStatutoryContext("2026-27", null)).toEqual({ assessmentYear: "2026-27", law: "ITA_1961" });
    expect(taxCaseStatutoryContext("2026-27", "ITA_2025")).toEqual({
      assessmentYear: "2026-27",
      law: "ITA_2025",
    });
  });

  it("writes the shipped pack key for each law — never a retyped string", () => {
    expect(storedTaxPackKeyForLaw("ITA_1961")).toBe(taxPackKey(AY_2026_27_PACK_IDENTITY));
    expect(storedTaxPackKeyForLaw("ITA_2025")).toBe(taxPackKey(TY_2026_27_PACK_IDENTITY));
    expect(storedTaxPackKeyForLaw("ITA_2025")).toContain(TY_2026_27_RULES_VERSION);
    expect(storedTaxPackKeyForLaw("ITA_2025")).toContain(TY_2026_27_PERIOD);
  });

  it("passes an explicit version pin through and omits it otherwise", () => {
    expect(taxCasePackSelector({ assessmentYear: "2026-27", computationRulesVersion: "X" })).toMatchObject({
      computationRulesVersion: "X",
    });
    expect("computationRulesVersion" in taxCasePackSelector({ assessmentYear: "2026-27" })).toBe(false);
  });
});

// --- binding against the shipped registry ----------------------------------

describe("bindDefaultTaxPackToCase", () => {
  it("binds the AY 2026-27 case to the registered pack", () => {
    const b = bindDefaultTaxPackToCase({ assessmentYear: ASSESSMENT_YEAR });
    expect(b.outcome).toBe("bound");
    if (b.outcome !== "bound") return;
    expect(b.identity).toBe(AY_2026_27_PACK_IDENTITY);
  });

  it("yields versions byte-identical to the engine constant previously stamped", () => {
    const b = bindDefaultTaxPackToCase({ assessmentYear: ASSESSMENT_YEAR });
    if (b.outcome !== "bound") throw new Error("expected bound");
    // This is the zero-behaviour-change proof for K3-12: what a snapshot and a
    // validation run record is unchanged; only the DERIVATION moved.
    expect(b.versions.computationRulesVersion).toBe(RULES_VERSION);
    expect(b.versions.validationRulesVersion).toBe(RULES_VERSION);
    expect(taxPackVersions(AY_2026_27_PACK_IDENTITY)).toEqual({
      computationRulesVersion: RULES_VERSION,
      validationRulesVersion: RULES_VERSION,
    });
  });

  it("exposes the engine's own functions by reference (the version describes the code that ran)", () => {
    const b = bindDefaultTaxPackToCase({ assessmentYear: ASSESSMENT_YEAR });
    if (b.outcome !== "bound") throw new Error("expected bound");
    expect(b.computation.computeTax).toBe(computeTax);
    expect(b.computation.compareRegimes).toBe(compareRegimes);
    expect(b.computation.recommendItrForm).toBe(recommendItrForm);
    expect(b.computation.validateCase).toBe(validateCase);
  });

  it("is deterministic across calls", () => {
    const a = bindDefaultTaxPackToCase({ assessmentYear: ASSESSMENT_YEAR });
    const b = bindDefaultTaxPackToCase({ assessmentYear: ASSESSMENT_YEAR });
    expect(a).toEqual(b);
  });

  it("refuses an unsupported period instead of falling back", () => {
    const b = bindDefaultTaxPackToCase({ assessmentYear: "2030-31" });
    expect(b.outcome).toBe("refused");
    if (b.outcome !== "refused") return;
    expect(b.resolution).toBe("unsupported");
    expect(b.reason).toContain("2030-31");
  });

  // K3-15 replaced this assertion's expectation (decision D18): the 2025-Act
  // world is now a registered identity-only stub, so the refusal is `unbound`
  // (a pack resolved but carries no computation) rather than `unsupported`. It
  // still refuses, and still hands back no engine.
  it("refuses the unimplemented 2025-Act statutory world", () => {
    const b = bindDefaultTaxPackToCase({ assessmentYear: "2026-27", law: "ITA_2025" });
    expect(b).toMatchObject({ outcome: "refused", resolution: "unbound" });
  });

  it("a stored ITA_2025 row resolves to the TY pack and is still unbound — not a computation", () => {
    const ctx = taxCaseStatutoryContext("2026-27", "ITA_2025");
    const b = bindDefaultTaxPackToCase(ctx);
    expect(b.outcome).toBe("refused");
    if (b.outcome !== "refused") return;
    expect(b.resolution).toBe("unbound");
    expect(taxCasePackSelector(ctx)).toMatchObject({
      law: "ITA_2025",
      periodKind: "tax_year",
      period: TY_2026_27_PERIOD,
    });
  });

  it("refuses a version pin that matches no registered pack", () => {
    const b = bindDefaultTaxPackToCase({
      assessmentYear: ASSESSMENT_YEAR,
      computationRulesVersion: "AY_2026_27_V9_NOT_REGISTERED",
    });
    expect(b).toMatchObject({ outcome: "refused", resolution: "unsupported" });
  });
});

// --- refusal branches needing a purpose-built registry ---------------------

function identityFor(period: string, version: string) {
  return makeTaxPackIdentity({
    jurisdiction: "IN",
    law: "ITA_1961",
    periodKind: "assessment_year",
    period,
    computationRulesVersion: version,
    validationRulesVersion: version,
    status: "draft",
    effectiveFrom: "2026-04-01",
  });
}

describe("bindTaxPackToCase refusals", () => {
  it("refuses an identity-only stub (no computation binding)", () => {
    const registry = createTaxPackRegistry();
    registry.register(makeTaxPack(identityFor("2027-28", "AY_2027_28_STUB")));
    const b = bindTaxPackToCase(registry, { assessmentYear: "2027-28" });
    expect(b).toMatchObject({ outcome: "refused", resolution: "unbound" });
  });

  it("refuses an ambiguous registration (two packs, same period, different versions)", () => {
    const registry = createTaxPackRegistry();
    const binding = { boundEngineId: "test", computation: { computeTax, compareRegimes, recommendItrForm, validateCase } };
    registry.register(makeTaxPack(identityFor("2027-28", "V1"), binding));
    registry.register(makeTaxPack(identityFor("2027-28", "V2"), binding));
    const b = bindTaxPackToCase(registry, { assessmentYear: "2027-28" });
    expect(b).toMatchObject({ outcome: "refused", resolution: "ambiguous" });
  });

  it("disambiguates the same registry with an explicit version pin", () => {
    const registry = createTaxPackRegistry();
    const binding = { boundEngineId: "test", computation: { computeTax, compareRegimes, recommendItrForm, validateCase } };
    registry.register(makeTaxPack(identityFor("2027-28", "V1"), binding));
    registry.register(makeTaxPack(identityFor("2027-28", "V2"), binding));
    const b = bindTaxPackToCase(registry, { assessmentYear: "2027-28", computationRulesVersion: "V2" });
    expect(b.outcome).toBe("bound");
    if (b.outcome !== "bound") return;
    expect(b.versions.computationRulesVersion).toBe("V2");
  });

  it("binding is not authorisation — the shipped pack is still draft", () => {
    const b = bindDefaultTaxPackToCase({ assessmentYear: ASSESSMENT_YEAR });
    if (b.outcome !== "bound") throw new Error("expected bound");
    expect(b.identity.status).toBe("draft");
    expect(b.identity.verifiedBy).toBeNull();
    expect(b.identity.verifiedAt).toBeNull();
  });
});

// --- staleness against a differing pack version ----------------------------

function engineInput(): TaxEngineInput {
  return {
    assessmentYear: "2026-27",
    financialYear: "2025-26",
    taxpayer: { residentStatus: "resident", ageCategory: "below_60" },
    selectedItrType: "ITR-1",
    clientApprovalStatus: "not_requested",
    filingStatus: "in_preparation",
    eVerificationStatus: "not_applicable",
    finalized: false,
    requiredDocuments: [],
    income: [{ id: "i1", amount: 800000, sourceType: "Form16", category: "salary" }],
    taxPaid: [{ id: "t1", amount: 60000, sourceType: "Form16", category: "salary_tds" }],
    deductions: [],
    capitalGains: [],
  };
}

function readinessInput(snapshotVersion: string, supportedVersion: string): FilingReadinessInput {
  const snap: ReadinessSnapshot = {
    id: "snap-1",
    createdAt: "2026-07-10T10:00:00.000Z",
    rulesVersion: snapshotVersion,
    complete: true,
    parseOk: true,
    selectedItrType: "ITR-1",
    createdByName: "Staff A",
    engineInput: engineInput(),
  };
  return {
    case: {
      clientName: "Ravi Kumar",
      caseDisplayCode: "TDX-ITR-1",
      caseTitle: "ITR Filing",
      assessmentYear: "2026-27",
      financialYear: "2025-26",
      selectedItrType: "ITR-1",
      recommendedItrType: "ITR-1",
      finalizedAt: null,
      finalizedByName: null,
      finalizedSnapshotId: null,
      reopenedAt: null,
      reopenedByName: null,
    },
    latestCompleteSnapshot: snap,
    live: { engineInput: engineInput(), complete: true, unsupportedEntryCount: 0, selectedItrType: "ITR-1" },
    documents: { requiredTotal: 0, requiredOutstanding: 0, requiredRejected: 0, receivedUnverified: 0 },
    validation: {
      runExists: true,
      lastRunAt: "2026-07-10T12:00:00.000Z",
      rulesVersion: snapshotVersion,
      openError: 0,
      openBlocker: 0,
      openWarning: 0,
      openInfo: 0,
      latestLedgerChangeAt: "2026-07-10T08:00:00.000Z",
      openBlockerFindingIds: [],
    },
    review: { status: "approved", reviewSnapshotId: "snap-1", approvedAt: "2026-07-10T12:00:00.000Z", approvalMethod: "whatsapp" },
    eligibility: { eligible: true, blockers: [] },
    capability: {
      totalIncome: 860000, // well below the surcharge risk threshold
      // K4-11: fail-closed value — this case passes on the income test alone.
      surchargeTreatmentSupported: undefined,
      // K4-12: likewise below the ₹12,00,000 section 87A ceiling.
      newRegimeTotalIncome: 860000,
      rebateReliefTreatmentSupported: undefined,
    // K4-23 review F1: no long-term house sale in this fixture, so the
    // verdict is absent and the gate must NOT fire — absence alone never
    // blocks, only absence WITH such a gain present.
    houseSaleLtcgTreatmentSupported: undefined,
    hasHouseSaleLtcg: false,
      seniorTreatment: { ageBand: "below_60", residentialStatus: "resident", selectedRegimeForLatestManifest: null },
    },
    engineRulesVersion: supportedVersion,
  };
}

const engineItem = (m: ReturnType<typeof assembleFilingReadiness>) =>
  m.items.find((i) => i.itemKey === "computation.snapshot_engine_version")!;

describe("pack-version staleness in the readiness reader", () => {
  it("passes when the snapshot carries the governing pack's version", () => {
    const b = bindDefaultTaxPackToCase({ assessmentYear: ASSESSMENT_YEAR });
    if (b.outcome !== "bound") throw new Error("expected bound");
    const v = b.versions.computationRulesVersion;
    expect(engineItem(assembleFilingReadiness(readinessInput(v, v))).status).toBe("passed");
  });

  it("blocks a historical pre-K4-17 snapshot under the new immutable rules version", () => {
    // The append-only snapshot keeps the pre-K4-17 marker; the live pack has a
    // new coordinate, so readiness blocks until a fresh snapshot is saved.
    const current = bindDefaultTaxPackToCase({ assessmentYear: ASSESSMENT_YEAR });
    if (current.outcome !== "bound") throw new Error("expected bound");
    expect(current.versions.computationRulesVersion).toBe(RULES_VERSION);
    expect(PRE_K4_17_RULES_VERSION).not.toBe(current.versions.computationRulesVersion);

    const item = engineItem(
      assembleFilingReadiness(
        readinessInput(PRE_K4_17_RULES_VERSION, current.versions.computationRulesVersion),
      ),
    );
    expect(item.status).toBe("blocked");
    expect(item.isBlocking).toBe(true);
    expect(item.details).toMatchObject({
      snapshotEngine: PRE_K4_17_RULES_VERSION,
      supportedEngine: current.versions.computationRulesVersion,
    });
  });

  it("fails closed when no pack governs the case (the reader's sentinel never matches)", () => {
    const stored = bindDefaultTaxPackToCase({ assessmentYear: ASSESSMENT_YEAR });
    if (stored.outcome !== "bound") throw new Error("expected bound");
    // Mirrors `computeTaxCaseReadiness`'s refusal branch.
    const item = engineItem(
      assembleFilingReadiness(readinessInput(stored.versions.computationRulesVersion, "unresolved")),
    );
    expect(item.status).toBe("blocked");
  });

  // K3-15 replaced the "exactly one pack" count (decision D18): the shipped
  // registry now holds both AY versions and the TY statutory world. The point
  // of the assertion —
  // that no synthetic test pack leaks into the shipped registry — is preserved
  // by pinning the exact three packs, which is stricter than the old count.
  it("the default registry holds exactly the three shipped packs (no synthetic pack leaked in)", () => {
    const packs = createDefaultTaxPackRegistry().list();
    expect(packs).toHaveLength(3);
    expect(packs.map((p) => taxPackKey(p.identity))).toEqual([
      `IN:ITA_1961:assessment_year:${ASSESSMENT_YEAR}:${PRE_K4_17_RULES_VERSION}`,
      `IN:ITA_1961:assessment_year:${ASSESSMENT_YEAR}:${RULES_VERSION}`,
      // K4-PORT-02 (D299) renamed this coordinate from
      // `TY_2026_27_UNSUPPORTED_STUB`: the pack is no longer a bare stub (it
      // carries provenance and a binding), and the new name states the actual
      // blocker — no rate authority is held for tax year 2026-27. Read from the
      // constant rather than re-typed, so the next rename cannot leave a stale
      // literal here.
      `IN:ITA_2025:tax_year:${TY_2026_27_PERIOD}:${TY_2026_27_RULES_VERSION}`,
    ]);
  });
});
