/**
 * K4-10 — brought-forward capital-loss set-off (Section 74).
 *
 * The centre of gravity here is the LAST describe block: a brute-force proof
 * that the window the adapter admits is exactly the region where the allocation
 * is forced, and — just as important — that disagreements really do occur
 * outside it, so the window is a genuine constraint rather than a vacuous one.
 * That is the `D95` discipline `K4-09` established, applied to the harder
 * multi-year case.
 */

import { describe, expect, it } from "vitest";
import {
  admitBroughtForwardRecord,
  assessmentYearFromStartYear,
  assessmentYearStartYear,
  computeBroughtForwardSetOff,
  finalEligibleAssessmentYear,
  lawfulTargetsFor,
  resolveLossAllocationPolicyId,
  totalBroughtForwardAbsorbed,
  totalBroughtForwardResidual,
} from "../brought-forward-set-off";
import {
  assertPortalDefaultArtifactsUnchanged,
  PORTAL_DEFAULT_ARTIFACT_VERSIONS,
  portalDefaultArtifactDrift,
  LOSS_ALLOCATION_POLICIES,
} from "../loss-allocation-policy";
import { broughtForwardAllocationIsForced } from "@/lib/tax-desk/computation-adapter";
import type { BroughtForwardLossEntry, BroughtForwardSetOffTarget } from "../types";

const AY = "2026-27";

function record(
  over: Partial<BroughtForwardLossEntry> & Pick<BroughtForwardLossEntry, "id" | "lossType" | "amount">,
): BroughtForwardLossEntry {
  return {
    originatingAssessmentYear: "2022-23",
    filingEligibility: "verified_timely",
    provenance: "prior_finalized_case_in_system",
    electedSetOffTarget: null,
    ...over,
  };
}

const run = (
  netStcg: number,
  netLtcg: number,
  entries: readonly BroughtForwardLossEntry[],
  policyId: "portal_default_ay2026_27" | "taxpayer_elected" = "portal_default_ay2026_27",
) =>
  computeBroughtForwardSetOff({
    currentAssessmentYear: AY,
    netStcg111a: netStcg,
    netLtcg112a: netLtcg,
    entries,
    policyId,
  });

// ---------------------------------------------------------------------------

describe("assessment-year arithmetic (Section 74(2))", () => {
  it("parses a well-formed assessment year and round-trips it", () => {
    expect(assessmentYearStartYear("2026-27")).toBe(2026);
    expect(assessmentYearStartYear("  2018-19 ")).toBe(2018);
    expect(assessmentYearFromStartYear(2026)).toBe("2026-27");
    expect(assessmentYearFromStartYear(2099)).toBe("2099-00");
    expect(assessmentYearStartYear(assessmentYearFromStartYear(2033))).toBe(2033);
  });

  it("refuses a malformed year, and one whose halves are not consecutive", () => {
    // The second case matters more than the first: "2026-28" LOOKS like an
    // assessment year and would otherwise be silently read as 2026.
    expect(assessmentYearStartYear("2026-28")).toBeNull();
    expect(assessmentYearStartYear("2026")).toBeNull();
    expect(assessmentYearStartYear("26-27")).toBeNull();
    expect(assessmentYearStartYear("")).toBeNull();
  });

  it("puts the eight-year boundary where s.74(2) puts it", () => {
    // Eight assessment years IMMEDIATELY SUCCEEDING the year of first
    // computation: a loss first computed in AY 2018-19 survives through
    // AY 2026-27 and lapses from AY 2027-28.
    expect(finalEligibleAssessmentYear(2018)).toBe("2026-27");
    expect(finalEligibleAssessmentYear(2022)).toBe("2030-31");
  });
});

describe("admitBroughtForwardRecord", () => {
  it("admits a record inside the eight-year window and at its exact boundary", () => {
    expect(admitBroughtForwardRecord(record({ id: "a", lossType: "ltcl", amount: 1 }), AY).admitted).toBe(true);
    // 2018 + 8 = 2026 — the LAST admissible year, not the first excluded one.
    const boundary = record({ id: "b", lossType: "ltcl", amount: 1, originatingAssessmentYear: "2018-19" });
    expect(admitBroughtForwardRecord(boundary, AY).admitted).toBe(true);
  });

  it("excludes a record one year past the boundary, naming the originating year", () => {
    const expired = record({ id: "c", lossType: "ltcl", amount: 5000, originatingAssessmentYear: "2017-18" });
    const decision = admitBroughtForwardRecord(expired, AY);
    expect(decision.admitted).toBe(false);
    if (decision.admitted) throw new Error("unreachable");
    expect(decision.exclusion.reason).toBe("expired_8_assessment_years");
    // The disclosure must ATTRIBUTE the exclusion — an exclusion a preparer
    // cannot trace to a specific record is indistinguishable from a silent drop.
    expect(decision.exclusion.message).toContain("2017-18");
    expect(decision.exclusion.message).toContain("2025-26");
  });

  it("FAILS CLOSED on unverified filing eligibility rather than assuming it", () => {
    const unverified = record({ id: "d", lossType: "ltcl", amount: 1000, filingEligibility: "unverified" });
    const decision = admitBroughtForwardRecord(unverified, AY);
    expect(decision.admitted).toBe(false);
    if (decision.admitted) throw new Error("unreachable");
    expect(decision.exclusion.reason).toBe("filing_eligibility_unverified");
    expect(decision.exclusion.message).toContain("139(3)");
  });

  it("excludes a record recorded as not eligible under s.139(3)/80", () => {
    const ineligible = record({ id: "e", lossType: "stcl", amount: 1000, filingEligibility: "not_eligible" });
    const decision = admitBroughtForwardRecord(ineligible, AY);
    expect(decision.admitted).toBe(false);
    if (decision.admitted) throw new Error("unreachable");
    expect(decision.exclusion.reason).toBe("filing_not_eligible");
  });

  it("refuses a current-year or future originating year instead of guessing", () => {
    for (const year of ["2026-27", "2027-28"]) {
      const decision = admitBroughtForwardRecord(
        record({ id: "f", lossType: "ltcl", amount: 1, originatingAssessmentYear: year }),
        AY,
      );
      expect(decision.admitted).toBe(false);
      if (decision.admitted) throw new Error("unreachable");
      expect(decision.exclusion.reason).toBe("not_a_prior_assessment_year");
    }
  });

  it("refuses an unreadable originating year rather than assuming one", () => {
    const decision = admitBroughtForwardRecord(
      record({ id: "g", lossType: "ltcl", amount: 1, originatingAssessmentYear: "2022-24" }),
      AY,
    );
    expect(decision.admitted).toBe(false);
    if (decision.admitted) throw new Error("unreachable");
    expect(decision.exclusion.reason).toBe("unparseable_originating_assessment_year");
  });
});

describe("lawful destinations (Section 74(1))", () => {
  it("gives a long-term loss exactly one destination and a short-term loss two", () => {
    expect(lawfulTargetsFor("ltcl")).toEqual(["ltcg_112a"]);
    expect(lawfulTargetsFor("stcl")).toEqual(["stcg_111a", "ltcg_112a"]);
  });

  it("never routes a long-term loss to short-term gains, even with no LTCG at all", () => {
    const result = run(500_000, 0, [record({ id: "l", lossType: "ltcl", amount: 200_000 })]);
    expect(result.absorbedAgainstStcg).toBe(0);
    expect(result.absorbedAgainstLtcg).toBe(0);
    expect(totalBroughtForwardResidual(result)).toBe(200_000);
  });
});

describe("computeBroughtForwardSetOff — allocation and residuals", () => {
  it("absorbs a long-term loss against long-term gains and records the allocation", () => {
    const result = run(0, 500_000, [record({ id: "l", lossType: "ltcl", amount: 200_000 })]);
    expect(result.absorbedAgainstLtcg).toBe(200_000);
    expect(result.allocations).toEqual([
      {
        recordId: "l",
        originatingAssessmentYear: "2022-23",
        lossType: "ltcl",
        target: "ltcg_112a",
        amount: 200_000,
        policyId: "portal_default_ay2026_27",
      },
    ]);
    expect(result.residuals).toEqual([]);
  });

  it("records an unabsorbed residual with the year it may last be used in", () => {
    const result = run(0, 50_000, [record({ id: "l", lossType: "ltcl", amount: 200_000 })]);
    expect(result.absorbedAgainstLtcg).toBe(50_000);
    expect(result.residuals).toEqual([
      {
        recordId: "l",
        originatingAssessmentYear: "2022-23",
        lossType: "ltcl",
        amount: 150_000,
        finalEligibleAssessmentYear: "2030-31",
        expiresAfterThisYear: false,
      },
    ]);
  });

  it("flags a residual in its FINAL year as lapsing", () => {
    const result = run(0, 0, [
      record({ id: "l", lossType: "ltcl", amount: 10_000, originatingAssessmentYear: "2018-19" }),
    ]);
    expect(result.residuals[0]?.expiresAfterThisYear).toBe(true);
    expect(result.residuals[0]?.finalEligibleAssessmentYear).toBe("2026-27");
  });

  it("routes a short-term loss to short-term gains first under the portal default", () => {
    // The utility's own observed order (`SchCG.bas:7787 setOffPctg20Loss_STCG`),
    // carrying the residual between steps. Named as a DEFAULT, not statute.
    const result = run(100_000, 100_000, [record({ id: "s", lossType: "stcl", amount: 150_000 })]);
    expect(result.absorbedAgainstStcg).toBe(100_000);
    expect(result.absorbedAgainstLtcg).toBe(50_000);
    expect(result.allocations.map((a) => a.target)).toEqual(["stcg_111a", "ltcg_112a"]);
    expect(totalBroughtForwardAbsorbed(result)).toBe(150_000);
  });

  it("consumes brought-forward LTCL before brought-forward STCL under the portal default", () => {
    const result = run(0, 100_000, [
      record({ id: "s", lossType: "stcl", amount: 100_000 }),
      record({ id: "l", lossType: "ltcl", amount: 100_000 }),
    ]);
    // Declared STCL-first, consumed LTCL-first — so this pins the POLICY's
    // ordering, not the order the records happened to arrive in.
    expect(result.allocations.map((a) => a.recordId)).toEqual(["l"]);
    expect(result.residuals.map((r) => r.recordId)).toEqual(["s"]);
  });

  it("does not depend on the order records arrive in", () => {
    const a = record({ id: "a", lossType: "ltcl", amount: 60_000, originatingAssessmentYear: "2020-21" });
    const b = record({ id: "b", lossType: "ltcl", amount: 40_000, originatingAssessmentYear: "2021-22" });
    expect(run(0, 70_000, [a, b])).toEqual(run(0, 70_000, [b, a]));
  });

  it("excludes an expired or unverified record from the computation but reports it", () => {
    const result = run(0, 500_000, [
      record({ id: "ok", lossType: "ltcl", amount: 100_000 }),
      record({ id: "old", lossType: "ltcl", amount: 100_000, originatingAssessmentYear: "2016-17" }),
      record({ id: "unk", lossType: "ltcl", amount: 100_000, filingEligibility: "unverified" }),
    ]);
    expect(result.absorbedAgainstLtcg).toBe(100_000);
    expect(result.excluded.map((x) => x.recordId).sort()).toEqual(["old", "unk"]);
    expect(result.excluded.map((x) => x.reason).sort()).toEqual([
      "expired_8_assessment_years",
      "filing_eligibility_unverified",
    ]);
  });

  it("computes nothing at all from an empty record set", () => {
    const result = run(500_000, 500_000, []);
    expect(result.absorbedAgainstStcg).toBe(0);
    expect(result.absorbedAgainstLtcg).toBe(0);
    expect(result.allocations).toEqual([]);
    expect(result.residuals).toEqual([]);
    expect(result.excluded).toEqual([]);
  });
});

describe("allocation policies (D112 / D113)", () => {
  it("derives the governing policy from the records, with one authority", () => {
    expect(resolveLossAllocationPolicyId([record({ id: "a", lossType: "ltcl", amount: 1 })])).toBe(
      "portal_default_ay2026_27",
    );
    expect(
      resolveLossAllocationPolicyId([
        record({ id: "a", lossType: "ltcl", amount: 1 }),
        record({ id: "b", lossType: "stcl", amount: 1, electedSetOffTarget: "stcg_111a" }),
      ]),
    ).toBe("taxpayer_elected");
  });

  it("never describes any policy as mandatory statute", () => {
    // Deliberately matches AFFIRMATIVE claims only. An earlier version of this
    // guard matched the substring "statutory order", which fired on the portal
    // default's own DENIAL ("It is NOT a statutory ordering rule") — a guard
    // that rejects the very disclaimer D113 requires is worse than no guard.
    const AFFIRMATIVE_STATUTE_CLAIMS = [
      /\bis the statutory\b/i,
      /\bthe statutorily required\b/i,
      /\bmandatory (order|sequence|allocation)\b/i,
      /\brequired by (law|statute|the Act)\b/i,
      /\bprescribed by (law|statute|the Act|CBDT)\b/i,
    ];
    for (const policy of Object.values(LOSS_ALLOCATION_POLICIES)) {
      for (const pattern of AFFIRMATIVE_STATUTE_CLAIMS) {
        expect(policy.description).not.toMatch(pattern);
      }
    }
    // The portal default must say WHOSE default it is and for WHICH artifacts.
    expect(LOSS_ALLOCATION_POLICIES.portal_default_ay2026_27.description).toMatch(/portal default/i);
    expect(LOSS_ALLOCATION_POLICIES.portal_default_ay2026_27.description).toContain("v1.2");
    expect(LOSS_ALLOCATION_POLICIES.portal_default_ay2026_27.description).toMatch(/NOT a statutory/i);
  });

  it("carries review and audit flags on the elected policy only", () => {
    expect(LOSS_ALLOCATION_POLICIES.taxpayer_elected.requiresProfessionalReview).toBe(true);
    expect(LOSS_ALLOCATION_POLICIES.taxpayer_elected.auditFlagged).toBe(true);
    expect(LOSS_ALLOCATION_POLICIES.portal_default_ay2026_27.requiresProfessionalReview).toBe(false);
  });

  it("declares its own unreproduced aspects rather than implying full reproduction", () => {
    const aspects = LOSS_ALLOCATION_POLICIES.portal_default_ay2026_27.unreproducedAspects;
    expect(aspects.length).toBeGreaterThan(0);
    // The intra-type ordering and the resident basic-exemption step are the two
    // things TAX-SAFE-02A could NOT reproduce. Both must stay declared.
    expect(aspects.join(" ")).toMatch(/SAME loss type/);
    expect(aspects.join(" ")).toMatch(/basic-exemption/);
  });

  it("trips the revalidation gate when a pinned artifact version moves", () => {
    expect(assertPortalDefaultArtifactsUnchanged(PORTAL_DEFAULT_ARTIFACT_VERSIONS)).toBe(true);
    expect(portalDefaultArtifactDrift(PORTAL_DEFAULT_ARTIFACT_VERSIONS)).toEqual([]);
    expect(
      portalDefaultArtifactDrift({ ...PORTAL_DEFAULT_ARTIFACT_VERSIONS, itr2Utility: "v1.3" }),
    ).toEqual(["itr2Utility"]);
    expect(
      portalDefaultArtifactDrift({ itr2Utility: "v2", jsonSchema: "v2", validationRules: "v2" }),
    ).toEqual(["itr2Utility", "jsonSchema", "validationRules"]);
  });
});

describe("taxpayer elections", () => {
  it("neither applies nor silently re-aims an UNLAWFUL election", () => {
    const result = run(
      500_000,
      500_000,
      [record({ id: "l", lossType: "ltcl", amount: 100_000, electedSetOffTarget: "stcg_111a" })],
      "taxpayer_elected",
    );
    // Not applied to STCG (unlawful) AND not quietly redirected to LTCG.
    expect(result.absorbedAgainstStcg).toBe(0);
    expect(result.absorbedAgainstLtcg).toBe(0);
    expect(totalBroughtForwardResidual(result)).toBe(100_000);
    expect(result.electionDivergences.map((d) => d.kind)).toEqual(["unlawful_target"]);
  });

  it("reports a lawful election that the portal default would not reproduce", () => {
    // Portal default sends a short-term loss to STCG first; this election sends
    // it to LTCG instead — lawful, but a different result.
    const result = run(
      500_000,
      500_000,
      [record({ id: "s", lossType: "stcl", amount: 100_000, electedSetOffTarget: "ltcg_112a" })],
      "taxpayer_elected",
    );
    expect(result.absorbedAgainstLtcg).toBe(100_000);
    expect(result.absorbedAgainstStcg).toBe(0);
    expect(result.electionDivergences.map((d) => d.kind)).toEqual(["diverges_from_portal_default"]);
  });

  it("reports NO divergence for an election that reproduces the portal default", () => {
    const result = run(
      500_000,
      500_000,
      [record({ id: "s", lossType: "stcl", amount: 100_000, electedSetOffTarget: "stcg_111a" })],
      "taxpayer_elected",
    );
    expect(result.absorbedAgainstStcg).toBe(100_000);
    expect(result.electionDivergences).toEqual([]);
    // …but the policy's own review/audit flags still apply. An election is a
    // human tax position even when it happens to agree with the default.
    expect(result.requiresProfessionalReview).toBe(true);
    expect(result.auditFlagged).toBe(true);
  });

  it("ignores elections entirely under the portal-default policy", () => {
    const elected = [record({ id: "s", lossType: "stcl", amount: 100_000, electedSetOffTarget: "ltcg_112a" })];
    const result = run(500_000, 500_000, elected, "portal_default_ay2026_27");
    expect(result.absorbedAgainstStcg).toBe(100_000);
    expect(result.electionDivergences).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The release gate, verified by brute force rather than asserted
// ---------------------------------------------------------------------------

interface Allocation {
  readonly perRecord: ReadonlyMap<string, ReadonlyMap<BroughtForwardSetOffTarget, number>>;
}

/**
 * Every MAXIMAL lawful allocation of `entries` against the two buckets.
 *
 * "Maximal" matters: Section 74 set-off is not optional to the extent gains
 * exist, so "allocate nothing" is not a lawful alternative. Without that
 * constraint every comparison below would trivially disagree and the brute
 * force would prove nothing.
 */
function enumerateLawfulAllocations(
  entries: readonly BroughtForwardLossEntry[],
  netStcg: number,
  netLtcg: number,
  step: number,
): Allocation[] {
  const out: Allocation[] = [];
  const perRecord = new Map<string, Map<BroughtForwardSetOffTarget, number>>();

  const walk = (index: number, remStcg: number, remLtcg: number): void => {
    if (index === entries.length) {
      // Maximality: no record with a residual may still have capacity in a
      // bucket it can lawfully reach.
      for (const entry of entries) {
        const applied = perRecord.get(entry.id);
        const used = [...(applied?.values() ?? [])].reduce((a, b) => a + b, 0);
        if (used >= entry.amount) continue;
        for (const target of lawfulTargetsFor(entry.lossType)) {
          if ((target === "stcg_111a" ? remStcg : remLtcg) > 0) return;
        }
      }
      out.push({
        perRecord: new Map([...perRecord].map(([k, v]) => [k, new Map(v)])),
      });
      return;
    }
    const entry = entries[index]!;
    const targets = lawfulTargetsFor(entry.lossType);
    const toStcgMax = targets.includes("stcg_111a") ? Math.min(entry.amount, remStcg) : 0;
    for (let toStcg = 0; toStcg <= toStcgMax; toStcg += step) {
      const toLtcgMax = targets.includes("ltcg_112a")
        ? Math.min(entry.amount - toStcg, remLtcg)
        : 0;
      for (let toLtcg = 0; toLtcg <= toLtcgMax; toLtcg += step) {
        perRecord.set(
          entry.id,
          new Map<BroughtForwardSetOffTarget, number>([
            ["stcg_111a", toStcg],
            ["ltcg_112a", toLtcg],
          ]),
        );
        walk(index + 1, remStcg - toStcg, remLtcg - toLtcg);
      }
    }
    perRecord.delete(entry.id);
  };

  walk(0, netStcg, netLtcg);
  return out;
}

/** Tax + per-record residual — the two things a lawful allocation can change. */
function outcomeOf(
  entries: readonly BroughtForwardLossEntry[],
  netStcg: number,
  netLtcg: number,
  allocation: Allocation,
): string {
  let usedStcg = 0;
  let usedLtcg = 0;
  const residuals: string[] = [];
  for (const entry of entries) {
    const applied = allocation.perRecord.get(entry.id);
    const s = applied?.get("stcg_111a") ?? 0;
    const l = applied?.get("ltcg_112a") ?? 0;
    usedStcg += s;
    usedLtcg += l;
    residuals.push(`${entry.id}=${entry.amount - s - l}`);
  }
  // 111A at 20%, 112A at 12.5% above the ₹1,25,000 threshold — applied to what
  // SURVIVES set-off (D93 Q1), which is what this engine does.
  const tax =
    (netStcg - usedStcg) * 0.2 + Math.max(0, netLtcg - usedLtcg - 125_000) * 0.125;
  return `tax=${Math.round(tax)}|${residuals.sort().join(",")}`;
}

describe("the K4-10 release window is exactly where the allocation is forced", () => {
  const STEP = 50_000;
  const AMOUNTS = [0, 50_000, 150_000, 250_000];

  /** Every (gains x records) shape the grid produces, in and out of window. */
  function* scenarios() {
    for (const netStcg of AMOUNTS) {
      for (const netLtcg of AMOUNTS) {
        for (const ltcl1 of AMOUNTS) {
          for (const stcl1 of AMOUNTS) {
            for (const ltcl2 of [0, 100_000]) {
              const entries: BroughtForwardLossEntry[] = [];
              if (ltcl1 > 0) entries.push(record({ id: "L1", lossType: "ltcl", amount: ltcl1, originatingAssessmentYear: "2020-21" }));
              if (ltcl2 > 0) entries.push(record({ id: "L2", lossType: "ltcl", amount: ltcl2, originatingAssessmentYear: "2021-22" }));
              if (stcl1 > 0) entries.push(record({ id: "S1", lossType: "stcl", amount: stcl1, originatingAssessmentYear: "2020-21" }));
              if (entries.length === 0) continue;
              yield { netStcg, netLtcg, entries };
            }
          }
        }
      }
    }
  }

  it("admits only scenarios in which EVERY maximal lawful allocation agrees", () => {
    let inWindow = 0;
    for (const { netStcg, netLtcg, entries } of scenarios()) {
      if (!broughtForwardAllocationIsForced({
        currentAssessmentYear: AY,
        netStcg111a: netStcg,
        netLtcg112a: netLtcg,
        admitted: entries,
      })) continue;
      inWindow += 1;
      const outcomes = new Set(
        enumerateLawfulAllocations(entries, netStcg, netLtcg, STEP).map((a) =>
          outcomeOf(entries, netStcg, netLtcg, a),
        ),
      );
      expect(outcomes.size).toBe(1);
      // …and the engine's own portal-default result is that one outcome.
      const engine = run(netStcg, netLtcg, entries);
      const engineAlloc: Allocation = {
        perRecord: new Map(
          entries.map((e) => [
            e.id,
            new Map<BroughtForwardSetOffTarget, number>([
              ["stcg_111a", engine.allocations.filter((a) => a.recordId === e.id && a.target === "stcg_111a").reduce((s, a) => s + a.amount, 0)],
              ["ltcg_112a", engine.allocations.filter((a) => a.recordId === e.id && a.target === "ltcg_112a").reduce((s, a) => s + a.amount, 0)],
            ]),
          ]),
        ),
      };
      expect([...outcomes][0]).toBe(outcomeOf(entries, netStcg, netLtcg, engineAlloc));
    }
    // The window must not be empty, or the feature ships nothing.
    expect(inWindow).toBeGreaterThan(100);
  });

  it("is a REAL constraint: disagreements do occur outside it", () => {
    let outOfWindow = 0;
    let disagreements = 0;
    for (const { netStcg, netLtcg, entries } of scenarios()) {
      if (broughtForwardAllocationIsForced({
        currentAssessmentYear: AY,
        netStcg111a: netStcg,
        netLtcg112a: netLtcg,
        admitted: entries,
      })) continue;
      outOfWindow += 1;
      const outcomes = new Set(
        enumerateLawfulAllocations(entries, netStcg, netLtcg, STEP).map((a) =>
          outcomeOf(entries, netStcg, netLtcg, a),
        ),
      );
      if (outcomes.size > 1) disagreements += 1;
    }
    expect(outOfWindow).toBeGreaterThan(50);
    // If this were 0 the window would be needlessly narrow but harmless; the
    // assertion that matters is that it is LARGE — refusing these cases is
    // preventing real ambiguity, not performing caution.
    expect(disagreements).toBeGreaterThan(50);
  });
});
