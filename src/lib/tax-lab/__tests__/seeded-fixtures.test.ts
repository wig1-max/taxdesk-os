import { describe, expect, it } from "vitest";
import { RULES_VERSION } from "@/lib/tax-engine/ay-2026-27/rules";
import { buildEngineInput } from "@/lib/tax-desk/computation-adapter";
import { computeTax, recommendItrForm, validateCase } from "@/lib/tax-engine/ay-2026-27";
import { createDefaultTaxPackRegistry } from "@/lib/tax-pack/registry-default";
import { AY_2026_27_PACK_PROVENANCE } from "@/lib/tax-pack/packs/ay-2026-27-provenance";
import { TAX_LAB_FIXTURE_FORMAT_VERSION, assertSyntheticOnly, declaredLedgerFacts } from "../fixture";
import { MATERIAL_OUTPUT_IDS, readMaterialOutput } from "../material-outputs";
import { SEEDED_CASE_FIXTURES } from "../fixtures/ay-2026-27-golden";
import { describeFixtureRun, runSyntheticCaseFixture } from "../harness";

/**
 * K3-20 — the SEEDED laboratory. Every expected value here was read off the AY
 * 2026-27 engine's own current behaviour through the resolved pack; this suite
 * both runs the fixtures and cross-checks them against a direct engine call, so
 * a rule change moves the laboratory and the engine goldens together rather than
 * leaving a stale "expected" number nobody notices.
 */

const registry = createDefaultTaxPackRegistry();
const DECLARED_RULE_IDS = AY_2026_27_PACK_PROVENANCE.rules.map((r) => r.ruleId);

describe("every seeded fixture holds", () => {
  for (const fixture of SEEDED_CASE_FIXTURES) {
    it(`${fixture.id} passes`, () => {
      const result = runSyntheticCaseFixture(registry, fixture);
      expect(describeFixtureRun(result)).toBe(`${fixture.id}: ${result.outcome} (passed)`);
      expect(result.passed).toBe(true);
    });
  }

  it("covers a supported, a blocked and a refused outcome", () => {
    const outcomes = SEEDED_CASE_FIXTURES.map((f) => runSyntheticCaseFixture(registry, f).outcome);
    expect(new Set(outcomes)).toEqual(new Set(["supported", "blocked", "refused"]));
  });
});

describe("seeded expectations are traceable and honestly unverified", () => {
  const computedFixtures = SEEDED_CASE_FIXTURES.filter((f) => f.expectedBinding === "bound");

  it("every fixture carries the laboratory format version", () => {
    for (const fixture of SEEDED_CASE_FIXTURES) {
      expect(fixture.formatVersion).toBe(TAX_LAB_FIXTURE_FORMAT_VERSION);
    }
  });

  it("every expectation is pinned to the shipped pack version", () => {
    for (const fixture of computedFixtures) {
      for (const expectation of fixture.expectations) {
        expect(expectation.trace.packComputationRulesVersion).toBe(RULES_VERSION);
      }
    }
  });

  it("every cited rule id exists in the AY pack's provenance", () => {
    for (const fixture of computedFixtures) {
      for (const expectation of fixture.expectations) {
        for (const ruleId of expectation.trace.ruleIds) {
          expect(DECLARED_RULE_IDS).toContain(ruleId);
        }
      }
    }
  });

  it("no expectation claims to be verified — the shipped packs are draft", () => {
    for (const fixture of computedFixtures) {
      for (const expectation of fixture.expectations) {
        expect(expectation.trace.rulesUnverified).toBe(true);
      }
    }
  });

  it("each computed fixture pins at least one material output", () => {
    for (const fixture of computedFixtures) {
      expect(fixture.expectations.length).toBeGreaterThan(0);
    }
  });

  it("holds no PAN- or Aadhaar-shaped data", () => {
    for (const fixture of SEEDED_CASE_FIXTURES) {
      expect(() => assertSyntheticOnly(fixture, fixture.id)).not.toThrow();
    }
  });
});

describe("seeded values are cross-consistent with a direct engine call", () => {
  const computedFixtures = SEEDED_CASE_FIXTURES.filter((f) => f.expectedBinding === "bound");

  for (const fixture of computedFixtures) {
    it(`${fixture.id} matches the engine computed directly from the same accepted ledger`, () => {
      // The direct call is fed the ACCEPTED rows only — the same facts the
      // harness lets through (K3-21). Feeding it the whole ledger would make the
      // cross-check disagree with the run by construction for any fixture that
      // withholds a fact.
      const withheld = new Set(fixture.expectedWithheld.map((w) => w.ledgerId));
      const keep = <T extends { id: string }>(rows: readonly T[]) => rows.filter((r) => !withheld.has(r.id));
      const adapter = buildEngineInput(
        {
          income: keep(fixture.ledger.income),
          taxPaid: keep(fixture.ledger.taxPaid),
          deductions: keep(fixture.ledger.deductions),
          capitalGains: keep(fixture.ledger.capitalGains),
          housePropertyEntries: keep(fixture.ledger.housePropertyEntries ?? []),
          // K4-14: added in the same change as the ledger kind. This guard
          // caught its own omission on the first run — the books fixture's GTI
          // came back ₹5,00,000 against the harness's ₹11,00,000 — which is
          // precisely the failure the K4-10 note below predicted.
          businessBooksEntries: keep(fixture.ledger.businessBooksEntries ?? []),
          // K4-10: this hand-rebuilt ledger must carry EVERY kind the fixture
          // declares. Omitting one does not fail loudly — it silently compares
          // the harness against a different input, which is the opposite of
          // what this cross-consistency test exists to prove.
          broughtForwardLosses: keep(fixture.ledger.broughtForwardLosses ?? []),
        },
        fixture.caseMeta,
      );
      const outputs = {
        computation: computeTax(adapter.input),
        itrForm: recommendItrForm(adapter.input),
      };
      const result = runSyntheticCaseFixture(registry, fixture);
      // The pack is a pure indirection (K3-11), so the pack-routed run and the
      // direct call must agree on every checked output.
      expect(result.checks.length).toBe(fixture.expectations.length);
      expect(outputs.computation.rulesVersion).toBe(result.packVersions?.computationRulesVersion);
      for (const check of result.checks) {
        expect(check.matched).toBe(true);
        expect(check.actual).toBe(readMaterialOutput(outputs, check.outputId));
      }
      // Every pinned finding is what a direct `validateCase` raises, too.
      expect(result.findings).toEqual(validateCase(adapter.input).findings);
    });
  }

  it("the golden-path fixtures reproduce the engine's own fixture outcomes", () => {
    // Looked up BY ID, not by array position — reordering the seeded list must
    // not silently repoint these semantic assertions at a different case.
    const byFixtureId = (id: string) => {
      const fixture = SEEDED_CASE_FIXTURES.find((f) => f.id === id);
      if (!fixture) throw new Error(`seeded fixture ${id} is missing`);
      return runSyntheticCaseFixture(registry, fixture);
    };

    // `salaried-refund-new-regime` mirrors the engine fixture `simpleSalariedRefundCase`:
    // nil tax under the new regime after the 87A rebate, and the whole TDS refunded.
    const refund = byFixtureId("ay2026-27/salaried-refund-new-regime");
    const byId = new Map(refund.checks.map((c) => [c.outputId, c.actual]));
    expect(byId.get("computation.recommendedRegime")).toBe("new");
    expect(byId.get("computation.grossTaxLiability")).toBe(0);
    expect(byId.get("computation.refundOrPayable")).toBe(-60_000);

    // `salary-capital-gains` mirrors `salaryCapitalGainsCase`: special-rate gains
    // stay out of slab income and ITR-1 is escalated to ITR-2.
    const gains = byFixtureId("ay2026-27/salary-capital-gains");
    const gainsById = new Map(gains.checks.map((c) => [c.outputId, c.actual]));
    expect(gainsById.get("computation.specialRateCapitalGains")).toBe(300_000);
    expect(gainsById.get("itrForm.recommendedItrType")).toBe("ITR-2");
  });
});

describe("the seeded evidence dimension (K3-21)", () => {
  it("every seeded fact carries evidence — no row is unaccounted for", () => {
    for (const fixture of SEEDED_CASE_FIXTURES) {
      const declared = declaredLedgerFacts(fixture.ledger).map((f) => f.ledgerId).sort();
      const evidenced = fixture.evidence.map((e) => e.ledgerId).sort();
      expect(evidenced).toEqual(declared);
    }
  });

  it("every source-tagged check reports only accepted facts; categorical exceptions stay exact", () => {
    const nonSourceTagged = new Set<string>();
    const exercised = new Set<string>();
    for (const fixture of SEEDED_CASE_FIXTURES.filter((f) => f.expectedBinding === "bound")) {
      const result = runSyntheticCaseFixture(registry, fixture);
      for (const check of result.checks) {
        exercised.add(check.outputId);
        if (!check.evidenceTraceable) {
          nonSourceTagged.add(check.outputId);
          expect(check.contributingFacts).toEqual([]);
          continue;
        }
        for (const fact of check.contributingFacts) {
          expect(fact.acceptance).toBe("accepted");
          expect(fixture.evidence.some((e) => e.ledgerId === fact.ledgerId)).toBe(true);
        }
      }
    }
    expect(nonSourceTagged).toEqual(
      new Set(["computation.recommendedRegime", "itrForm.recommendedItrType"]),
    );
    expect(exercised).toEqual(new Set(MATERIAL_OUTPUT_IDS));
  });

  it("keeps empty-but-source-traceable rule outputs distinct from categorical decisions", () => {
    const checks = SEEDED_CASE_FIXTURES.filter((f) => f.expectedBinding === "bound").flatMap(
      (fixture) => runSyntheticCaseFixture(registry, fixture).checks,
    );
    const emptyRebate = checks.find(
      (check) =>
        check.outputId === "computation.rebate" && check.contributingFacts.length === 0,
    );
    expect(emptyRebate).toBeDefined();
    expect(emptyRebate?.evidenceTraceable).toBe(true);
    expect(
      checks
        .filter((check) => !check.evidenceTraceable)
        .every((check) => check.contributingFacts.length === 0),
    ).toBe(true);
  });

  it("covers a document-backed, a proof-backed and a staff-attested fact", () => {
    const kinds = new Set(SEEDED_CASE_FIXTURES.flatMap((f) => f.evidence.map((e) => e.kind)));
    expect(kinds).toEqual(new Set(["source_document", "proof_document", "staff_attested"]));
  });

  it("seeds exactly one unaccepted fact, and it is withheld from the computation", () => {
    const unaccepted = SEEDED_CASE_FIXTURES.filter((f) => f.expectedWithheld.length > 0);
    expect(unaccepted).toHaveLength(1);
    const result = runSyntheticCaseFixture(registry, unaccepted[0]!);
    expect(result.outcome).toBe("blocked");
    expect(result.withheld.map((w) => w.ledgerId)).toEqual(["lab_cg_stcg"]);
    // The gain is absent from the computed figures, not netted or estimated.
    expect(result.checks.find((c) => c.outputId === "computation.specialRateCapitalGains")?.actual).toBe(0);
  });

  it("pins every validation finding the seeded cases raise, under the pack's validation version", () => {
    for (const fixture of SEEDED_CASE_FIXTURES.filter((f) => f.expectedBinding === "bound")) {
      const result = runSyntheticCaseFixture(registry, fixture);
      expect((result.findings ?? []).map((f) => f.code).sort()).toEqual(
        fixture.expectedFindings.map((f) => f.code).sort(),
      );
      for (const pin of fixture.expectedFindings) {
        expect(pin.packValidationRulesVersion).toBe(RULES_VERSION);
      }
    }
  });

  it("seeds at least one pinned finding, including a reconciliation one", () => {
    const pinned = SEEDED_CASE_FIXTURES.flatMap((f) => f.expectedFindings);
    expect(pinned.length).toBeGreaterThan(0);
    expect(pinned.some((f) => f.area === "reconciliation")).toBe(true);
  });
});

describe("the deliberately-unsupported fixture proves facts become work, not guesses", () => {
  const fixture = SEEDED_CASE_FIXTURES.find((f) => f.expectedUnsupported.length > 0)!;

  it("declares its unsupported facts and the harness confirms each one", () => {
    expect(fixture.expectedUnsupported).toHaveLength(2);
    const result = runSyntheticCaseFixture(registry, fixture);
    expect(result.outcome).toBe("blocked");
    for (const declared of fixture.expectedUnsupported) {
      expect(result.blocked.some((b) => b.ledgerId === declared.ledgerId && b.code === declared.code)).toBe(true);
    }
  });

  it("excludes the unsupported amounts from the computed figures rather than guessing", () => {
    const result = runSyntheticCaseFixture(registry, fixture);
    const gti = result.checks.find((c) => c.outputId === "computation.grossTotalIncome");
    // The ledger declares ₹6,00,000 salary plus ₹2,40,000 house property and a
    // ₹50,000 non-112A gain; only the salary is counted.
    expect(gti?.actual).toBe(600_000);
    expect(result.adapter?.excludedLedgerIds.sort()).toEqual(["lab_cg_other_ltcg", "lab_inc_hp"]);
    expect(result.adapter?.complete).toBe(false);
  });
});
