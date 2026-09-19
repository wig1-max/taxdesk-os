import { describe, expect, it } from "vitest";
import { deriveWorkflow, type WorkflowInput } from "@/lib/tax-desk/workflow";
import { toneForStatus, labelForStatus } from "@/lib/ui/status-tone";
import { summarizeCaseRow } from "@/lib/tax-desk/case-queue";

const base: WorkflowInput = {
  finalized: false,
  reopened: false,
  overallReady: false,
  overallBlocked: true,
  hasCompleteSnapshot: false,
  snapshotFresh: false,
  validationRunExists: false,
  validationFresh: false,
  openBlockers: 0,
  openWarnings: 0,
  liveComplete: false,
  hasLiveData: false,
  unsupportedEntries: 0,
  docsRequiredOutstanding: 0,
  docsRequiredRejected: 0,
  docsReceivedUnverified: 0,
  reviewStatus: "not_started",
  approvalCurrent: false,
  itrSelected: true,
};

describe("deriveWorkflow — next action priority (pipeline order)", () => {
  it("rejected documents win over everything downstream", () => {
    const na = deriveWorkflow({ ...base, docsRequiredRejected: 2 }).nextAction;
    expect(na.tone).toBe("danger");
    expect(na.segment).toBe("documents");
    expect(na.title).toMatch(/2 rejected/);
  });

  it("outstanding documents come before data entry", () => {
    const na = deriveWorkflow({ ...base, docsRequiredOutstanding: 3 }).nextAction;
    expect(na.segment).toBe("documents");
  });

  it("missing ITR selection is surfaced early", () => {
    const na = deriveWorkflow({ ...base, itrSelected: false }).nextAction;
    expect(na.segment).toBe("computation");
    expect(na.title).toMatch(/ITR/);
  });

  it("with docs done but no data, asks for ledger entry", () => {
    const na = deriveWorkflow({ ...base, liveComplete: false }).nextAction;
    expect(na.segment).toBe("ledgers");
  });

  it("with live data ready but no snapshot, asks to compute", () => {
    // "Live data ready" means genuinely populated + supported — hasLiveData must
    // be true. An empty ledger (hasLiveData:false) is covered separately below.
    const na = deriveWorkflow({ ...base, liveComplete: true, hasLiveData: true }).nextAction;
    expect(na.segment).toBe("computation");
    expect(na.title).toMatch(/snapshot/i);
  });

  it("stale snapshot asks for a new snapshot", () => {
    const na = deriveWorkflow({ ...base, liveComplete: true, hasCompleteSnapshot: true, snapshotFresh: false }).nextAction;
    expect(na.tone).toBe("warning");
    expect(na.segment).toBe("computation");
  });

  it("open validation blockers route to validation as danger", () => {
    const na = deriveWorkflow({
      ...base,
      liveComplete: true,
      hasCompleteSnapshot: true,
      snapshotFresh: true,
      validationRunExists: true,
      openBlockers: 1,
    }).nextAction;
    expect(na.tone).toBe("danger");
    expect(na.segment).toBe("validation");
  });

  it("clean state pending approval routes to client review", () => {
    const na = deriveWorkflow({
      ...base,
      liveComplete: true,
      hasCompleteSnapshot: true,
      snapshotFresh: true,
      validationRunExists: true,
      validationFresh: true,
    }).nextAction;
    expect(na.segment).toBe("review");
  });

  it("sent review is a waiting-on-client state", () => {
    const na = deriveWorkflow({
      ...base,
      liveComplete: true,
      hasCompleteSnapshot: true,
      snapshotFresh: true,
      validationRunExists: true,
      validationFresh: true,
      reviewStatus: "sent",
    }).nextAction;
    expect(na.tone).toBe("warning");
    expect(na.title).toMatch(/Awaiting client/);
  });

  it("ready state offers finalization", () => {
    const na = deriveWorkflow({
      ...base,
      overallBlocked: false,
      overallReady: true,
      liveComplete: true,
      hasCompleteSnapshot: true,
      snapshotFresh: true,
      validationRunExists: true,
      validationFresh: true,
      approvalCurrent: true,
      reviewStatus: "approved",
    }).nextAction;
    expect(na.tone).toBe("success");
    expect(na.segment).toBe("readiness");
  });

  it("finalized is locked and read-only", () => {
    const w = deriveWorkflow({ ...base, finalized: true, overallBlocked: false });
    expect(w.nextAction.locked).toBe(true);
    expect(w.overall.label).toBe("Finalized");
    expect(w.stages.find((s) => s.key === "finalization")?.status).toBe("finalized");
  });
});

describe("deriveWorkflow — stage states", () => {
  it("marks documents blocked when rejected", () => {
    const w = deriveWorkflow({ ...base, docsRequiredRejected: 1 });
    expect(w.stages.find((s) => s.key === "documents")?.status).toBe("blocked");
  });
  it("marks computation stale when snapshot no longer matches live", () => {
    const w = deriveWorkflow({ ...base, liveComplete: true, hasCompleteSnapshot: true, snapshotFresh: false });
    expect(w.stages.find((s) => s.key === "computation")?.status).toBe("stale");
  });
  it("returns exactly seven stages", () => {
    expect(deriveWorkflow(base).stages).toHaveLength(7);
  });

  // K.2.9.4 status-copy: an empty ledger must never read "Entries complete".
  const dataEntryHint = (i: WorkflowInput) =>
    deriveWorkflow(i).stages.find((s) => s.key === "data_entry")?.hint;

  it("empty ledger (no live data, no snapshot) reads 'No entries yet', not a completion affirmative", () => {
    const hint = dataEntryHint({ ...base, hasLiveData: false, liveComplete: true });
    expect(hint).toBe("No entries yet");
    expect(hint).not.toMatch(/complete/i);
  });

  it("populated supported ledger reads 'Entries complete'", () => {
    expect(dataEntryHint({ ...base, hasLiveData: true, liveComplete: true })).toBe("Entries complete");
  });

  it("a complete snapshot always reads 'Entries complete' regardless of hasLiveData", () => {
    expect(dataEntryHint({ ...base, hasLiveData: false, hasCompleteSnapshot: true })).toBe("Entries complete");
  });

  it("unsupported entries still win over the empty-state hint", () => {
    expect(dataEntryHint({ ...base, hasLiveData: true, unsupportedEntries: 2 })).toBe("2 unsupported");
  });
});

// K3-00 readiness closeout: an empty ledger has liveComplete === true only in
// the vacuous "no unsupported rows" sense. It must NEVER derive a complete/green
// data-entry stage, a "computation is current" beckon, or a next action that
// recommends computing a return as though data exists. hasLiveData is the
// deciding signal; a fresh complete snapshot still wins regardless of it.
describe("deriveWorkflow — empty-ledger derivation (decision table)", () => {
  const dataEntry = (i: WorkflowInput) => deriveWorkflow(i).stages.find((s) => s.key === "data_entry")!;
  const computation = (i: WorkflowInput) => deriveWorkflow(i).stages.find((s) => s.key === "computation")!;

  // itrSelected:true so the next action reflects the ledger/computation state,
  // not the earlier ITR-selection gate.
  const empty: WorkflowInput = { ...base, itrSelected: true, hasLiveData: false, liveComplete: true };
  const meaningful: WorkflowInput = { ...base, itrSelected: true, hasLiveData: true, liveComplete: true };

  it("empty ledger derives data-entry as 'current' (incomplete), never 'complete'", () => {
    expect(dataEntry(empty).status).toBe("current");
  });

  it("empty ledger keeps computation 'upcoming', not 'current'", () => {
    expect(computation(empty).status).toBe("upcoming");
  });

  it("empty ledger next action routes to data entry, never to compute", () => {
    const na = deriveWorkflow(empty).nextAction;
    expect(na.segment).toBe("ledgers");
    expect(na.title).toMatch(/Enter income/i);
    expect(na.title).not.toMatch(/snapshot|compute/i);
  });

  it("meaningful supported ledger advances: data-entry complete, computation current, next action = compute", () => {
    expect(dataEntry(meaningful).status).toBe("complete");
    expect(computation(meaningful).status).toBe("current");
    const na = deriveWorkflow(meaningful).nextAction;
    expect(na.segment).toBe("computation");
    expect(na.title).toMatch(/snapshot/i);
  });

  it("unsupported entries warn the data-entry stage and route to ledgers", () => {
    const unsupported = { ...meaningful, unsupportedEntries: 2 };
    expect(dataEntry(unsupported).status).toBe("warning");
    const na = deriveWorkflow(unsupported).nextAction;
    expect(na.segment).toBe("ledgers");
    expect(na.title).toMatch(/unsupported/i);
  });

  it("a fresh complete snapshot keeps data-entry complete even when live rows are no longer meaningful", () => {
    const snapshotted = { ...base, itrSelected: true, hasLiveData: false, liveComplete: true, hasCompleteSnapshot: true, snapshotFresh: true };
    expect(dataEntry(snapshotted).status).toBe("complete");
    expect(computation(snapshotted).status).toBe("complete");
  });

  it("a stale snapshot over emptied live data still asks for a new snapshot (not fresh)", () => {
    const stale = { ...base, itrSelected: true, hasLiveData: false, liveComplete: true, hasCompleteSnapshot: true, snapshotFresh: false };
    expect(computation(stale).status).toBe("stale");
    const na = deriveWorkflow(stale).nextAction;
    expect(na.segment).toBe("computation");
    expect(na.title).toMatch(/new snapshot/i);
  });

  it("omitted hasLiveData preserves legacy behaviour (liveComplete alone drives readiness)", () => {
    const legacy: WorkflowInput = { ...base, itrSelected: true, liveComplete: true };
    delete (legacy as { hasLiveData?: boolean }).hasLiveData;
    expect(dataEntry(legacy).status).toBe("complete");
    expect(deriveWorkflow(legacy).nextAction.segment).toBe("computation");
  });
});

describe("status tone resolver", () => {
  it("maps completion codes to success", () => {
    for (const c of ["approved", "verified", "filed", "e_verified"]) expect(toneForStatus(c)).toBe("success");
  });
  it("maps blockers to danger", () => {
    for (const c of ["rejected", "blocker", "error"]) expect(toneForStatus(c)).toBe("danger");
  });
  it("unknown codes fall back to neutral", () => {
    expect(toneForStatus("something_new")).toBe("neutral");
    expect(toneForStatus(null)).toBe("neutral");
  });
  it("humanizes labels", () => {
    expect(labelForStatus("data_entry_pending")).toBe("Data entry");
    expect(labelForStatus("changes_requested")).toBe("Changes requested");
  });
});

describe("summarizeCaseRow", () => {
  const b = {
    caseStatus: "data_entry_pending",
    clientReviewStatus: "not_started",
    filingStatus: "not_started",
    eVerificationStatus: "not_started",
    itrSelected: null,
  };
  it("sent review waits on client", () => {
    expect(summarizeCaseRow({ ...b, clientReviewStatus: "sent" }).waitingOn).toBe("Client");
  });
  it("closed case is terminal", () => {
    expect(summarizeCaseRow({ ...b, caseStatus: "closed" }).stage).toBe("Closed");
  });
  it("data entry pending prompts ledger entry", () => {
    expect(summarizeCaseRow(b).stage).toBe("Data entry");
  });
});

describe("deriveWorkflow — readiness stage subtitle (live vs persisted)", () => {
  const ready: WorkflowInput = {
    ...base,
    overallReady: true,
    overallBlocked: false,
    hasCompleteSnapshot: true,
    snapshotFresh: true,
    validationRunExists: true,
    validationFresh: true,
    liveComplete: true,
    approvalCurrent: true,
  };
  const readinessStage = (i: WorkflowInput) =>
    deriveWorkflow(i).stages.find((s) => s.key === "filing_readiness");

  it("live-ready but not persisted → 'Live checks pass'", () => {
    expect(readinessStage({ ...ready, readinessPersisted: false })?.hint).toBe("Live checks pass");
  });
  it("persisted-ready → 'Checks saved'", () => {
    expect(readinessStage({ ...ready, readinessPersisted: true })?.hint).toBe("Checks saved");
  });
  it("defaults to live (not persisted) when the flag is omitted", () => {
    expect(readinessStage(ready)?.hint).toBe("Live checks pass");
  });
});
