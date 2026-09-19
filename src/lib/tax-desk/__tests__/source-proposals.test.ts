import { describe, expect, it } from "vitest";
import {
  PROPOSAL_FACT_KINDS,
  PROPOSAL_FORMAT_VERSION,
  PROPOSAL_SOURCE_SCHEMA_KIND,
  PROPOSAL_SOURCE_SCHEMA_VERSION,
  PROPOSAL_STATUSES,
  SYNTHETIC_PROPOSAL_ADAPTER_VERSION,
  assertNoRealIdentifierShape,
  assessPairReadiness,
  canTransitionProposalStatus,
  checkProposalEnvelope,
  isPromotable,
  isProposalFactKind,
  isTerminalProposalStatus,
  proposalFactSpec,
  requiredProposalPair,
  summarizeProposalWork,
  totalOutstandingProposalWork,
  type ProposalStatus,
} from "../source-proposals";
import {
  AY_2026_27_SOURCE_SCHEMAS,
} from "@/lib/tax-pack/packs/ay-2026-27-schemas";

describe("source-proposals — vocabulary matches the declared Form16 source schema", () => {
  it("PROPOSAL_FACT_KINDS is exactly the Form16 package's declared facts", () => {
    const form16 = AY_2026_27_SOURCE_SCHEMAS.find((p) => p.identity.key === "Form16");
    expect(form16).toBeTruthy();
    const declared = form16!.facts.map((f) => `${f.area}.${f.factKey}`).sort();
    expect([...PROPOSAL_FACT_KINDS].sort()).toEqual(declared);
  });

  it("pins the exact Form16 schema version this workflow supports", () => {
    const form16 = AY_2026_27_SOURCE_SCHEMAS.find((p) => p.identity.key === "Form16");
    expect(form16!.identity.schemaVersion).toBe(PROPOSAL_SOURCE_SCHEMA_VERSION);
    expect(PROPOSAL_SOURCE_SCHEMA_KIND).toBe("Form16");
  });

  it("format + adapter versions are non-empty and distinct from each other", () => {
    expect(PROPOSAL_FORMAT_VERSION).toBe("TAX_SOURCE_PROPOSAL_V1");
    expect(SYNTHETIC_PROPOSAL_ADAPTER_VERSION).not.toBe(PROPOSAL_FORMAT_VERSION);
  });

  it("isProposalFactKind is closed", () => {
    expect(isProposalFactKind("income.salary")).toBe(true);
    expect(isProposalFactKind("tax_paid.salary_tds")).toBe(true);
    expect(isProposalFactKind("income.house_property")).toBe(false);
    expect(isProposalFactKind("")).toBe(false);
  });

  it("proposalFactSpec maps each fact to its ledger kind + category", () => {
    expect(proposalFactSpec("income.salary")).toEqual({
      factKind: "income.salary",
      ledgerKind: "income",
      ledgerCategory: "salary",
      label: "Salary income",
    });
    expect(proposalFactSpec("tax_paid.salary_tds").ledgerKind).toBe("tax_paid");
  });

  it("requiredProposalPair is the same closed pair", () => {
    expect(requiredProposalPair()).toEqual(PROPOSAL_FACT_KINDS);
  });
});

describe("source-proposals — canonical state machine", () => {
  it("proposed -> accepted and proposed -> rejected are allowed", () => {
    expect(canTransitionProposalStatus("proposed", "accepted")).toBe(true);
    expect(canTransitionProposalStatus("proposed", "rejected")).toBe(true);
  });

  it("accepted -> promoted is allowed", () => {
    expect(canTransitionProposalStatus("accepted", "promoted")).toBe(true);
  });

  it("every other transition is refused, including all self-transitions and reversals", () => {
    const disallowed: Array<[ProposalStatus, ProposalStatus]> = [
      ["proposed", "proposed"],
      ["proposed", "promoted"],
      ["accepted", "accepted"],
      ["accepted", "proposed"],
      ["accepted", "rejected"],
      ["rejected", "proposed"],
      ["rejected", "accepted"],
      ["rejected", "rejected"],
      ["rejected", "promoted"],
      ["promoted", "proposed"],
      ["promoted", "accepted"],
      ["promoted", "rejected"],
      ["promoted", "promoted"],
    ];
    for (const [from, to] of disallowed) {
      expect(canTransitionProposalStatus(from, to), `${from} -> ${to}`).toBe(false);
    }
  });

  it("exhausts every ordered pair of the 4 statuses (16 total) so the table above cannot silently miss one", () => {
    let allowedCount = 0;
    for (const from of PROPOSAL_STATUSES) {
      for (const to of PROPOSAL_STATUSES) {
        if (canTransitionProposalStatus(from, to)) allowedCount++;
      }
    }
    expect(allowedCount).toBe(3); // proposed->accepted, proposed->rejected, accepted->promoted
  });

  it("rejected and promoted are terminal; proposed and accepted are not", () => {
    expect(isTerminalProposalStatus("rejected")).toBe(true);
    expect(isTerminalProposalStatus("promoted")).toBe(true);
    expect(isTerminalProposalStatus("proposed")).toBe(false);
    expect(isTerminalProposalStatus("accepted")).toBe(false);
  });

  it("only accepted is promotable", () => {
    expect(isPromotable("accepted")).toBe(true);
    expect(isPromotable("proposed")).toBe(false);
    expect(isPromotable("rejected")).toBe(false);
    expect(isPromotable("promoted")).toBe(false);
  });
});

describe("source-proposals — pair readiness", () => {
  it("ready only when BOTH facts are accepted", () => {
    const r = assessPairReadiness({ "income.salary": "accepted", "tax_paid.salary_tds": "accepted" });
    expect(r.ready).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.notAccepted).toEqual([]);
  });

  it("an already-promoted fact still counts as ready (idempotent re-check)", () => {
    const r = assessPairReadiness({ "income.salary": "promoted", "tax_paid.salary_tds": "promoted" });
    expect(r.ready).toBe(true);
  });

  it("missing facts are itemised", () => {
    const r = assessPairReadiness({ "income.salary": "accepted" });
    expect(r.ready).toBe(false);
    expect(r.missing).toEqual(["tax_paid.salary_tds"]);
    expect(r.notAccepted).toEqual([]);
  });

  it("proposed-but-not-decided facts are itemised as notAccepted, not missing", () => {
    const r = assessPairReadiness({ "income.salary": "accepted", "tax_paid.salary_tds": "proposed" });
    expect(r.ready).toBe(false);
    expect(r.missing).toEqual([]);
    expect(r.notAccepted).toEqual(["tax_paid.salary_tds"]);
  });

  it("a rejected fact blocks readiness and is itemised as notAccepted", () => {
    const r = assessPairReadiness({ "income.salary": "accepted", "tax_paid.salary_tds": "rejected" });
    expect(r.ready).toBe(false);
    expect(r.notAccepted).toEqual(["tax_paid.salary_tds"]);
  });
});

describe("source-proposals — synthetic-only guard", () => {
  it("refuses a PAN-shaped string", () => {
    expect(() => assertNoRealIdentifierShape("ABCDE1234F", "reason")).toThrow(/PAN-shaped/);
  });

  it("refuses an Aadhaar-shaped string", () => {
    expect(() => assertNoRealIdentifierShape("1234 5678 9012", "reason")).toThrow(/Aadhaar-shaped/);
  });

  it("accepts ordinary free text", () => {
    expect(() => assertNoRealIdentifierShape("Employer copy, page 2 of 2", "reason")).not.toThrow();
  });
});

describe("source-proposals — envelope pre-check (mirrors the DB's malformed-version refusal)", () => {
  const valid = {
    sourceSchemaKind: PROPOSAL_SOURCE_SCHEMA_KIND,
    sourceSchemaVersion: PROPOSAL_SOURCE_SCHEMA_VERSION,
    adapterVersion: SYNTHETIC_PROPOSAL_ADAPTER_VERSION,
    factKind: "income.salary",
    proposedValue: 800000,
  };

  it("accepts a well-formed envelope", () => {
    expect(checkProposalEnvelope(valid)).toEqual({ ok: true });
  });

  it("refuses an unsupported source-schema kind", () => {
    const r = checkProposalEnvelope({ ...valid, sourceSchemaKind: "26AS" });
    expect(r.ok).toBe(false);
  });

  it("refuses a mismatched source-schema version (malformed-version)", () => {
    const r = checkProposalEnvelope({ ...valid, sourceSchemaVersion: "FORM16_V1" });
    expect(r.ok).toBe(false);
  });

  it("refuses a mismatched adapter version", () => {
    const r = checkProposalEnvelope({ ...valid, adapterVersion: "SOME_OTHER_ADAPTER" });
    expect(r.ok).toBe(false);
  });

  it("refuses an unsupported fact kind", () => {
    const r = checkProposalEnvelope({ ...valid, factKind: "income.house_property" });
    expect(r.ok).toBe(false);
  });

  it("refuses a negative or non-finite proposed value", () => {
    expect(checkProposalEnvelope({ ...valid, proposedValue: -1 }).ok).toBe(false);
    expect(checkProposalEnvelope({ ...valid, proposedValue: Number.NaN }).ok).toBe(false);
    expect(checkProposalEnvelope({ ...valid, proposedValue: Number.POSITIVE_INFINITY }).ok).toBe(false);
  });

  it("accepts zero as a valid proposed value", () => {
    expect(checkProposalEnvelope({ ...valid, proposedValue: 0 })).toEqual({ ok: true });
  });
});

describe("K3-31 — summarizeProposalWork (outstanding-work summary)", () => {
  it("counts proposed/accepted/rejected CURRENT statuses into their own buckets", () => {
    const statuses: ProposalStatus[] = ["proposed", "proposed", "accepted", "rejected", "rejected", "rejected"];
    expect(summarizeProposalWork(statuses)).toEqual({
      awaitingDecision: 2,
      acceptedNotPromoted: 1,
      rejectedNeedsFreshProposal: 3,
    });
  });

  it("never counts `promoted` as outstanding work — it is resolved", () => {
    const statuses: ProposalStatus[] = ["promoted", "promoted", "proposed"];
    expect(summarizeProposalWork(statuses)).toEqual({
      awaitingDecision: 1,
      acceptedNotPromoted: 0,
      rejectedNeedsFreshProposal: 0,
    });
  });

  it("an empty list summarizes to all zeros", () => {
    expect(summarizeProposalWork([])).toEqual({
      awaitingDecision: 0,
      acceptedNotPromoted: 0,
      rejectedNeedsFreshProposal: 0,
    });
  });

  it("totalOutstandingProposalWork sums the three outstanding buckets", () => {
    const summary = summarizeProposalWork(["proposed", "accepted", "accepted", "rejected"]);
    expect(totalOutstandingProposalWork(summary)).toBe(4);
    expect(totalOutstandingProposalWork(summarizeProposalWork(["promoted"]))).toBe(0);
  });
});
