import { describe, expect, it } from "vitest";
import {
  assembleFilingReadiness,
  canonicalizeEngineInput,
  FILING_READINESS_DISCLAIMER,
  isApprovalCurrentForSnapshot,
  liveMatchesSnapshot,
  READINESS_RULES_VERSION,
  readinessStatusLine,
  type FilingReadinessInput,
  type ReadinessSnapshot,
} from "@/lib/tax-desk/filing-readiness";
import { finalizationNoteSchema, reopenReasonSchema } from "@/lib/validation/tax-case";
import type { TaxEngineInput } from "@/lib/tax-engine/ay-2026-27";

const ENGINE = "AY2026-27.v1";
const SNAP_AT = "2026-07-10T10:00:00.000Z";
const AFTER = "2026-07-10T12:00:00.000Z";
const BEFORE = "2026-07-10T08:00:00.000Z";

function engineInput(over: Partial<TaxEngineInput> = {}): TaxEngineInput {
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
    income: [
      { id: "i1", amount: 800000, sourceType: "Form16", category: "salary" },
      { id: "i2", amount: 12000, sourceType: "manual", category: "fd_interest" },
    ],
    taxPaid: [{ id: "t1", amount: 60000, sourceType: "Form16", category: "salary_tds" }],
    deductions: [{ id: "d1", amount: 150000, sourceType: "manual", section: "80C" }],
    capitalGains: [],
    ...over,
  };
}

function snapshot(over: Partial<ReadinessSnapshot> = {}): ReadinessSnapshot {
  return {
    id: "snap-1",
    createdAt: SNAP_AT,
    rulesVersion: ENGINE,
    complete: true,
    parseOk: true,
    selectedItrType: "ITR-1",
    createdByName: "Staff A",
    engineInput: engineInput(),
    ...over,
  };
}

function baseInput(over: Partial<FilingReadinessInput> = {}): FilingReadinessInput {
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
    latestCompleteSnapshot: snapshot(),
    live: { engineInput: engineInput(), complete: true, unsupportedEntryCount: 0, selectedItrType: "ITR-1" },
    documents: { requiredTotal: 3, requiredOutstanding: 0, requiredRejected: 0, receivedUnverified: 0 },
    validation: {
      runExists: true,
      lastRunAt: AFTER,
      rulesVersion: ENGINE,
      openError: 0,
      openBlocker: 0,
      openWarning: 0,
      openInfo: 0,
      latestLedgerChangeAt: BEFORE,
      openBlockerFindingIds: [],
    },
    review: { status: "approved", reviewSnapshotId: "snap-1", approvedAt: AFTER, approvalMethod: "whatsapp" },
    eligibility: { eligible: true, blockers: [] },
    capability: {
      totalIncome: 812000, // well below the surcharge risk threshold
      // K4-11: deliberately `undefined` (the fail-closed value) — this case is
      // below the threshold, so the readiness item must pass on the INCOME test
      // alone, without the engine's verdict rescuing it.
      surchargeTreatmentSupported: undefined,
      // K4-12: ₹8,12,000 is below the ₹12,00,000 section 87A ceiling too, so
      // the rebate-relief item must likewise pass on the INCOME test alone
      // with the fail-closed `undefined` verdict beside it.
      newRegimeTotalIncome: 812000,
      rebateReliefTreatmentSupported: undefined,
    // K4-23 review F1: no long-term house sale in this fixture, so the
    // verdict is absent and the gate must NOT fire — absence alone never
    // blocks, only absence WITH such a gain present.
    houseSaleLtcgTreatmentSupported: undefined,
    hasHouseSaleLtcg: false,
      seniorTreatment: { ageBand: "below_60", residentialStatus: "resident", selectedRegimeForLatestManifest: null },
    },
    engineRulesVersion: ENGINE,
    ...over,
  };
}

const itemByKey = (m: ReturnType<typeof assembleFilingReadiness>, key: string) =>
  m.items.find((i) => i.itemKey === key)!;

// --- canonical comparison --------------------------------------------------

describe("canonicalizeEngineInput / liveMatchesSnapshot", () => {
  it("is stable despite ledger-row ordering", () => {
    const a = engineInput();
    const b = engineInput({ income: [a.income[1]!, a.income[0]!] }); // reversed
    expect(liveMatchesSnapshot(a, b)).toBe(true);
  });

  it("normalizes decimal string vs number", () => {
    const a = engineInput({ income: [{ id: "i1", amount: 800000, sourceType: "Form16", category: "salary" }] });
    // @ts-expect-error simulate a decimal string coming from the DB
    const b = engineInput({ income: [{ id: "i1", amount: "800000.00", sourceType: "Form16", category: "salary" }] });
    expect(liveMatchesSnapshot(a, b)).toBe(true);
  });

  it("detects a meaningful tax-input difference (amount change)", () => {
    const a = engineInput();
    const b = engineInput({ income: [{ id: "i1", amount: 900000, sourceType: "Form16", category: "salary" }, a.income[1]!] });
    expect(liveMatchesSnapshot(a, b)).toBe(false);
  });

  it("detects a removed row", () => {
    const a = engineInput();
    const b = engineInput({ income: [a.income[0]!] });
    expect(liveMatchesSnapshot(a, b)).toBe(false);
  });

  it("detects a selected-ITR change", () => {
    expect(liveMatchesSnapshot(engineInput(), engineInput({ selectedItrType: "ITR-2" }))).toBe(false);
  });

  it("detects a books-business loss-pool or amount change", () => {
    const books = {
      id: "books_1",
      amount: -100_000,
      revenue: 100_000,
      expenses: 200_000,
      isProfession: false,
      adjustments: "none_s30_43d" as const,
      activityClassification: "ordinary_business_or_profession" as const,
      sourceType: "manual" as const,
    };
    expect(
      liveMatchesSnapshot(
        engineInput({ businessBooksEntries: [books] }),
        engineInput({
          businessBooksEntries: [
            { ...books, activityClassification: "speculation_business_s73" },
          ],
        }),
      ),
    ).toBe(false);
    expect(
      liveMatchesSnapshot(
        engineInput({ businessBooksEntries: [books] }),
        engineInput({ businessBooksEntries: [{ ...books, expenses: 190_000 }] }),
      ),
    ).toBe(false);
  });

  it("detects taxpayer, house-property, carry-forward, and foreign-asset changes", () => {
    const base = engineInput({
      housePropertyEntries: [
        {
          id: "hp_1",
          amount: -150_000,
          usage: "self_occupied",
          annualRentReceived: 0,
          municipalTaxesPaid: 0,
          homeLoanInterest: 150_000,
          sourceType: "manual",
        },
      ],
      broughtForwardLosses: [
        {
          id: "loss_1",
          originatingAssessmentYear: "2025-26",
          lossType: "stcl",
          amount: 50_000,
          filingEligibility: "verified_timely",
          provenance: "staff_declared",
          sourceType: "manual",
        },
      ],
    });
    expect(liveMatchesSnapshot(base, engineInput({ ...base, taxpayer: { ...base.taxpayer, ageCategory: "senior" } }))).toBe(false);
    expect(liveMatchesSnapshot(base, engineInput({ ...base, housePropertyEntries: [] }))).toBe(false);
    expect(liveMatchesSnapshot(base, engineInput({ ...base, broughtForwardLosses: [] }))).toBe(false);
    expect(liveMatchesSnapshot(base, engineInput({ ...base, hasForeignAssets: true }))).toBe(false);
  });

  it("null snapshot never matches a real input", () => {
    expect(canonicalizeEngineInput(null)).toBe("null");
    expect(liveMatchesSnapshot(engineInput(), null)).toBe(false);
  });
});

// --- deterministic keys ----------------------------------------------------

describe("readiness item catalogue", () => {
  it("produces a stable, deterministic set of item keys", () => {
    const keys = assembleFilingReadiness(baseInput()).items.map((i) => i.itemKey);
    expect(keys).toEqual([
      "eligibility.case_eligible",
      "capability.surcharge_marginal_relief",
      "capability.rebate_marginal_relief",
      // K4-23 review F1 — the third capability gate.
      "capability.house_sale_ltcg",
      "capability.senior_treatment_comparison_reliability",
      "capability.senior_treatment_selected_regime",
      "computation.snapshot_complete",
      "computation.snapshot_engine_version",
      "computation.snapshot_matches_live_data",
      "validation.run_exists",
      "validation.is_current",
      "validation.no_open_blockers",
      "validation.open_warnings",
      "documents.required_items_satisfied",
      "documents.received_unverified",
      "client_review.current_approval",
      "itr.selected",
      "itr.recommendation_match",
    ]);
    // Repeated assembly is identical (deterministic).
    expect(JSON.stringify(assembleFilingReadiness(baseInput()))).toBe(JSON.stringify(assembleFilingReadiness(baseInput())));
  });

  it("every item carries the readiness rules version", () => {
    for (const i of assembleFilingReadiness(baseInput()).items) expect(i.rulesVersion).toBe(READINESS_RULES_VERSION);
  });

  it("an ineligible case produces a blocking eligibility item and cannot finalize", () => {
    const m = assembleFilingReadiness(
      baseInput({
        eligibility: {
          eligible: false,
          blockers: [{ code: "PROFILE_DOB_MISSING", message: "Add the taxpayer's date of birth." }],
        },
      }),
    );
    const item = itemByKey(m, "eligibility.case_eligible");
    expect(item.status).toBe("blocked");
    expect(item.isBlocking).toBe(true);
    expect(item.details.blockerCodes).toEqual(["PROFILE_DOB_MISSING"]);
    expect(m.capabilities.canFinalize).toBe(false);
    expect(m.overall).toBe("blocked");
  });
});

// --- snapshot rules --------------------------------------------------------

describe("computation snapshot rules", () => {
  it("no complete snapshot blocks", () => {
    const m = assembleFilingReadiness(baseInput({ latestCompleteSnapshot: null }));
    expect(itemByKey(m, "computation.snapshot_complete").status).toBe("blocked");
    expect(m.overall).toBe("blocked");
  });

  it("partial snapshot blocks and is not treated as complete", () => {
    const m = assembleFilingReadiness(baseInput({ latestCompleteSnapshot: snapshot({ complete: false }) }));
    expect(itemByKey(m, "computation.snapshot_complete").status).toBe("blocked");
  });

  it("unparseable snapshot blocks", () => {
    const m = assembleFilingReadiness(baseInput({ latestCompleteSnapshot: snapshot({ parseOk: false, engineInput: null }) }));
    expect(itemByKey(m, "computation.snapshot_complete").status).toBe("blocked");
  });

  it("complete snapshot passes", () => {
    const m = assembleFilingReadiness(baseInput());
    expect(itemByKey(m, "computation.snapshot_complete").status).toBe("passed");
  });

  it("unsupported engine version blocks", () => {
    const m = assembleFilingReadiness(baseInput({ latestCompleteSnapshot: snapshot({ rulesVersion: "AY2025-26.v9" }) }));
    expect(itemByKey(m, "computation.snapshot_engine_version").status).toBe("blocked");
  });

  it("live equals snapshot → snapshot_matches_live_data passes", () => {
    expect(itemByKey(assembleFilingReadiness(baseInput()), "computation.snapshot_matches_live_data").status).toBe("passed");
    expect(assembleFilingReadiness(baseInput()).snapshotFresh).toBe(true);
  });

  it("live differs from snapshot → blocks with the mandated message", () => {
    const m = assembleFilingReadiness(
      baseInput({ live: { engineInput: engineInput({ income: [{ id: "i1", amount: 999999, sourceType: "Form16", category: "salary" }] }), complete: true, unsupportedEntryCount: 0, selectedItrType: "ITR-1" } }),
    );
    const item = itemByKey(m, "computation.snapshot_matches_live_data");
    expect(item.status).toBe("blocked");
    expect(item.message).toMatch(/Live Tax Desk data has changed/i);
    expect(m.snapshotFresh).toBe(false);
  });

  it("an active unsupported ledger row blocks (live incomplete)", () => {
    const m = assembleFilingReadiness(
      baseInput({ live: { engineInput: engineInput(), complete: false, unsupportedEntryCount: 1, selectedItrType: "ITR-1" } }),
    );
    expect(itemByKey(m, "computation.snapshot_matches_live_data").status).toBe("blocked");
  });
});

// --- validation rules ------------------------------------------------------

describe("validation rules", () => {
  it("validation never run blocks", () => {
    const m = assembleFilingReadiness(baseInput({ validation: { ...baseInput().validation, runExists: false, lastRunAt: null } }));
    expect(itemByKey(m, "validation.run_exists").status).toBe("blocked");
  });

  it("stale validation (older than snapshot) blocks", () => {
    const m = assembleFilingReadiness(baseInput({ validation: { ...baseInput().validation, lastRunAt: BEFORE } }));
    expect(itemByKey(m, "validation.is_current").status).toBe("blocked");
    expect(m.validationFresh).toBe(false);
  });

  it("stale validation (older than latest ledger change) blocks", () => {
    const m = assembleFilingReadiness(baseInput({ validation: { ...baseInput().validation, lastRunAt: SNAP_AT, latestLedgerChangeAt: AFTER } }));
    expect(itemByKey(m, "validation.is_current").status).toBe("blocked");
  });

  it("open error blocks; open warnings do not", () => {
    const err = assembleFilingReadiness(baseInput({ validation: { ...baseInput().validation, openError: 1, openBlockerFindingIds: ["f1"] } }));
    expect(itemByKey(err, "validation.no_open_blockers").status).toBe("blocked");
    expect(err.capabilities.canFinalize).toBe(false);

    const warn = assembleFilingReadiness(baseInput({ validation: { ...baseInput().validation, openWarning: 2 } }));
    expect(itemByKey(warn, "validation.no_open_blockers").status).toBe("passed");
    expect(itemByKey(warn, "validation.open_warnings").status).toBe("warning");
    expect(itemByKey(warn, "validation.open_warnings").isBlocking).toBe(false);
    expect(warn.capabilities.canFinalize).toBe(true);
  });
});

// --- documents -------------------------------------------------------------

describe("document rules", () => {
  it("missing required document blocks", () => {
    const m = assembleFilingReadiness(baseInput({ documents: { requiredTotal: 3, requiredOutstanding: 1, requiredRejected: 0, receivedUnverified: 0 } }));
    expect(itemByKey(m, "documents.required_items_satisfied").status).toBe("blocked");
  });

  it("rejected required document blocks", () => {
    const m = assembleFilingReadiness(baseInput({ documents: { requiredTotal: 3, requiredOutstanding: 0, requiredRejected: 1, receivedUnverified: 0 } }));
    expect(itemByKey(m, "documents.required_items_satisfied").status).toBe("blocked");
  });

  it("received-unverified is a warning, not a blocker", () => {
    const m = assembleFilingReadiness(baseInput({ documents: { requiredTotal: 3, requiredOutstanding: 0, requiredRejected: 0, receivedUnverified: 2 } }));
    expect(itemByKey(m, "documents.required_items_satisfied").status).toBe("passed");
    expect(itemByKey(m, "documents.received_unverified").status).toBe("warning");
    expect(m.capabilities.canFinalize).toBe(true);
  });
});

// --- approval --------------------------------------------------------------

describe("client review / approval rules", () => {
  it("approved + current snapshot passes", () => {
    const m = assembleFilingReadiness(baseInput());
    expect(itemByKey(m, "client_review.current_approval").status).toBe("passed");
    expect(m.approvalCurrent).toBe(true);
  });

  it("the approval item title is a neutral category, never an 'approval current' affirmative (K.2.9.4)", () => {
    const m = assembleFilingReadiness(baseInput());
    const item = itemByKey(m, "client_review.current_approval");
    // Title must not read as if an approval exists — the state lives in the message.
    expect(item.title).toBe("Client approval");
    expect(item.title.toLowerCase()).not.toContain("current");
  });

  it("with no approval yet the copy says 'No current client approval' (never an affirmative)", () => {
    const m = assembleFilingReadiness(
      baseInput({ review: { status: "not_started", reviewSnapshotId: null, approvedAt: null, approvalMethod: null } }),
    );
    const item = itemByKey(m, "client_review.current_approval");
    expect(item.status).toBe("blocked");
    expect(item.message).toMatch(/No current client approval/i);
    expect(m.approvalCurrent).toBe(false);
  });

  it("approval bound to an older snapshot is stale and blocks", () => {
    const m = assembleFilingReadiness(baseInput({ review: { status: "approved", reviewSnapshotId: "old-snap", approvedAt: BEFORE, approvalMethod: "email" } }));
    expect(itemByKey(m, "client_review.current_approval").status).toBe("blocked");
    expect(m.approvalCurrent).toBe(false);
  });

  it.each(["not_started", "prepared", "sent", "changes_requested", "superseded"])("%s review status blocks", (status) => {
    const m = assembleFilingReadiness(baseInput({ review: { status, reviewSnapshotId: "snap-1", approvedAt: null, approvalMethod: null } }));
    expect(itemByKey(m, "client_review.current_approval").status).toBe("blocked");
  });

  // K3-32 Part B — isApprovalCurrentForSnapshot is the single derivation of
  // "is this exact snapshot the one approval currently points to"; the
  // draft-output package builder (`draft-output.ts`) reuses it rather than
  // re-deriving the condition.
  describe("isApprovalCurrentForSnapshot", () => {
    it("true only when status is approved AND the snapshot id matches exactly", () => {
      expect(isApprovalCurrentForSnapshot({ status: "approved", reviewSnapshotId: "snap-1" }, "snap-1")).toBe(true);
    });
    it("false for a non-approved status even with a matching id", () => {
      expect(isApprovalCurrentForSnapshot({ status: "prepared", reviewSnapshotId: "snap-1" }, "snap-1")).toBe(false);
    });
    it("false when approved but bound to a different snapshot id", () => {
      expect(isApprovalCurrentForSnapshot({ status: "approved", reviewSnapshotId: "snap-1" }, "snap-2")).toBe(false);
    });
    it("false when reviewSnapshotId is null", () => {
      expect(isApprovalCurrentForSnapshot({ status: "approved", reviewSnapshotId: null }, "snap-1")).toBe(false);
    });
  });

  // K3-32 Part B — proves (rather than assumes) that the EXISTING staleness
  // mechanism already catches a promoted/any ledger row being edited after
  // approval: approval remains a true historical fact about the snapshot it
  // was captured against (`approvalCurrent` stays true — approval is never
  // silently invalidated), but `computation.snapshot_matches_live_data`
  // blocks finalization the moment live data diverges from that snapshot. No
  // new staleness signal is needed or added.
  it("K3-32: approval stays bound to its snapshot after live data diverges, but finalization is blocked by the EXISTING snapshot-freshness check", () => {
    const m = assembleFilingReadiness(
      baseInput({
        live: {
          engineInput: engineInput({ income: [{ id: "i1", amount: 999999, sourceType: "Form16", category: "salary" }] }),
          complete: true,
          unsupportedEntryCount: 0,
          selectedItrType: "ITR-1",
        },
      }),
    );
    // Approval is still current for the (now-stale) snapshot it was captured against.
    expect(m.approvalCurrent).toBe(true);
    expect(itemByKey(m, "client_review.current_approval").status).toBe("passed");
    // But live no longer matches that snapshot, so finalization is blocked.
    expect(m.snapshotFresh).toBe(false);
    expect(itemByKey(m, "computation.snapshot_matches_live_data").status).toBe("blocked");
    expect(m.capabilities.canFinalize).toBe(false);
    expect(m.overall).toBe("blocked");
  });
});

// --- ITR -------------------------------------------------------------------

describe("ITR rules", () => {
  it("no selected ITR blocks", () => {
    const m = assembleFilingReadiness(baseInput({ case: { ...baseInput().case, selectedItrType: null } }));
    expect(itemByKey(m, "itr.selected").status).toBe("blocked");
  });

  it("selected != recommended is a warning, not a blocker", () => {
    const m = assembleFilingReadiness(baseInput({ case: { ...baseInput().case, selectedItrType: "ITR-1", recommendedItrType: "ITR-2" } }));
    expect(itemByKey(m, "itr.recommendation_match").status).toBe("warning");
    expect(itemByKey(m, "itr.recommendation_match").isBlocking).toBe(false);
  });
});

// --- overall / lifecycle ---------------------------------------------------

describe("overall readiness + capabilities", () => {
  it("ready only with zero blockers and not finalized", () => {
    const m = assembleFilingReadiness(baseInput());
    expect(m.overall).toBe("ready");
    expect(m.capabilities.canFinalize).toBe(true);
    expect(m.capabilities.canReopen).toBe(false);
  });

  it("finalized status is read-only (no finalize, reopen offered)", () => {
    const m = assembleFilingReadiness(baseInput({ case: { ...baseInput().case, finalizedAt: AFTER, finalizedByName: "Admin", finalizedSnapshotId: "snap-1" } }));
    expect(m.overall).toBe("finalized");
    expect(m.capabilities.canFinalize).toBe(false);
    expect(m.capabilities.canReopen).toBe(true);
  });

  it("reopened + superseded review yields reopened_needs_review and is not ready", () => {
    const m = assembleFilingReadiness(
      baseInput({
        case: { ...baseInput().case, reopenedAt: AFTER },
        review: { status: "superseded", reviewSnapshotId: "snap-1", approvedAt: BEFORE, approvalMethod: "whatsapp" },
      }),
    );
    expect(m.overall).toBe("reopened_needs_review");
    expect(m.capabilities.canFinalize).toBe(false);
  });

  it("disclaimer keeps preparation-only and universal-review concepts distinct (K.2.9.4)", () => {
    const d = FILING_READINESS_DISCLAIMER.toLowerCase();
    // Concept 4 — preparation-only boundary.
    expect(d).toContain("does not");
    expect(d).toContain("not tax advice");
    // Concept 1 — universal quality policy, worded distinctly.
    expect(d).toContain("independent professional review");
    // Must NOT reuse the conflated phrase (that names the eligibility gate /
    // credentialed sign-off concepts) in this universal-policy sentence.
    expect(d).not.toContain("manual professional review");
  });

  it("includes the mandatory disclaimer and no sensitive data", () => {
    const m = assembleFilingReadiness(baseInput());
    expect(m.disclaimer).toBe(FILING_READINESS_DISCLAIMER);
    const blob = JSON.stringify(m);
    expect(blob).not.toMatch(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/); // PAN
    expect(blob.replace(/[0-9a-f-]{36}/gi, "")).not.toMatch(/\b\d{12}\b/); // Aadhaar-like
    expect(blob).not.toMatch(/https?:\/\//);
    expect(blob.toLowerCase()).not.toContain("aadhaar");
    expect(blob.toLowerCase()).not.toContain("notes");
  });
});

// --- note/reason schemas ---------------------------------------------------

describe("finalization / reopen note screening", () => {
  it("accepts a reasonable note/reason", () => {
    expect(finalizationNoteSchema.safeParse("Reviewed and internally finalized after client approval.").success).toBe(true);
    expect(reopenReasonSchema.safeParse("Client sent a revised Form 16; reopening to update salary.").success).toBe(true);
  });

  it("rejects too-short and too-long text", () => {
    expect(finalizationNoteSchema.safeParse("ok").success).toBe(false);
    expect(reopenReasonSchema.safeParse("short").success).toBe(false);
    expect(finalizationNoteSchema.safeParse("x".repeat(400)).success).toBe(false);
  });

  it("rejects credential / PAN / Aadhaar-like text", () => {
    expect(finalizationNoteSchema.safeParse("finalized; portal password is hunter2").success).toBe(false);
    expect(finalizationNoteSchema.safeParse("finalized for PAN ABCDE1234F").success).toBe(false);
    expect(reopenReasonSchema.safeParse("reopen for aadhaar 1234 5678 9012").success).toBe(false);
    expect(reopenReasonSchema.safeParse("please share the OTP 449281 to reopen").success).toBe(false);
  });
});

describe("readinessStatusLine — live evaluation vs persisted vs finalized (K.2.8.6 copy)", () => {
  it("live-ready but not persisted → finalization re-runs/saves; does NOT imply saving is a prerequisite", () => {
    const line = readinessStatusLine({ overall: "ready", hasRun: false, finalizedAtLabel: null, finalizedByName: null });
    expect(line).toBe(
      "Current live checks pass. Finalization will re-run and save these checks before locking the case.",
    );
    expect(line).not.toMatch(/have not been run/i);
    expect(line).not.toMatch(/before finalization/i); // no "must save first" framing
  });

  it("persisted-ready → checks are saved and current", () => {
    expect(readinessStatusLine({ overall: "ready", hasRun: true, finalizedAtLabel: null, finalizedByName: null })).toBe(
      "Readiness checks are saved and current.",
    );
  });

  it("blocked → plain blocked copy regardless of persistence", () => {
    for (const hasRun of [false, true]) {
      const line = readinessStatusLine({ overall: "blocked", hasRun, finalizedAtLabel: null, finalizedByName: null });
      expect(line).toBe("Internal finalization is blocked. Resolve the blocking items below.");
    }
  });

  it("finalized → finalized-specific message with date + person, and NO pre-run guidance", () => {
    const line = readinessStatusLine({
      overall: "finalized",
      hasRun: false,
      finalizedAtLabel: "12 Jul 2026, 3:10 pm",
      finalizedByName: "E2E Admin",
    });
    expect(line).toMatch(/Internally finalized on 12 Jul 2026, 3:10 pm by E2E Admin/);
    expect(line).toMatch(/locked and read-only/i);
    expect(line).toMatch(/admin can reopen/i);
    expect(line).not.toMatch(/Run readiness checks/i);
    expect(line).not.toMatch(/have not been run/i);
  });

  it("reopened → fresh-review copy", () => {
    const line = readinessStatusLine({ overall: "reopened_needs_review", hasRun: false, finalizedAtLabel: null, finalizedByName: null });
    expect(line).toMatch(/Reopened — fresh client review/i);
  });
});
