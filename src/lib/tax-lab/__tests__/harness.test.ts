import { describe, expect, it } from "vitest";
import { RULES_VERSION } from "@/lib/tax-engine/ay-2026-27/rules";
import { compareRegimes, computeTax, recommendItrForm, validateCase } from "@/lib/tax-engine/ay-2026-27";
import { buildEngineInput } from "@/lib/tax-desk/computation-adapter";
import type { CaseMeta, LedgerRows } from "@/lib/tax-desk/computation-adapter";
import { createDefaultTaxPackRegistry } from "@/lib/tax-pack/registry-default";
import { createTaxPackRegistry } from "@/lib/tax-pack/registry";
import { makeTaxPackIdentity } from "@/lib/tax-pack/identity";
import { makeTaxPack } from "@/lib/tax-pack/pack";
import { makeRuleProvenance, makeTaxPackProvenance } from "@/lib/tax-pack/provenance";
import { makeExpectedOutput, makeSyntheticCaseFixture } from "../fixture";
import { makeDocumentEvidence, makeStaffAttestedEvidence } from "../evidence";
import { MATERIAL_OUTPUT_IDS, materialOutputKind } from "../material-outputs";
import { describeFixtureRun, runSyntheticCaseFixture, runSyntheticCaseFixtureWithDefaultRegistry } from "../harness";
import {
  reconciliationFindingFixture,
  salariedRefundFixture,
  unacceptedEvidenceFixture,
  unboundStatutoryWorldFixture,
  unsupportedFactsFixture,
} from "../fixtures/ay-2026-27-golden";

/**
 * K3-20 — the deterministic HARNESS. The properties defended here:
 *  - it computes THROUGH a resolved pack binding, never a direct engine import;
 *  - a value mismatch names the versioned rule AND the pack version that moved;
 *  - a cited rule the pack does not declare is a failure, not a decorative label;
 *  - an unverified value cannot be marked verified;
 *  - unsupported facts produce a typed, itemised BLOCKED outcome — no guess, no
 *    skipped assertion;
 *  - a statutory world with no computation binding is refused, never fudged.
 */

const META: CaseMeta = {
  assessmentYear: "2026-27",
  financialYear: "2025-26",
  selectedItrType: "ITR-1",
  finalized: false,
};

const SALARY_LEDGER: LedgerRows = {
  income: [{ id: "lab_inc_salary", income_head: "salary", amount: 800_000, source_type: "manual" }],
  taxPaid: [{ id: "lab_tp_tds", tax_paid_type: "salary_tds", amount: 60_000, source_type: "manual" }],
  deductions: [],
  capitalGains: [],
};

/** Accepted evidence for the two probe rows — both staff-entered, no document. */
const SALARY_EVIDENCE = [
  makeStaffAttestedEvidence({
    ledgerKind: "income",
    ledgerId: "lab_inc_salary",
    sourceType: "manual",
    acceptance: "accepted",
  }),
  makeStaffAttestedEvidence({
    ledgerKind: "tax_paid",
    ledgerId: "lab_tp_tds",
    sourceType: "manual",
    acceptance: "accepted",
  }),
];

function trace(ruleIds: readonly string[], overrides: { version?: string; unverified?: boolean } = {}) {
  return {
    ruleIds,
    packComputationRulesVersion: overrides.version ?? RULES_VERSION,
    rulesUnverified: overrides.unverified ?? true,
  };
}

function fixtureWith(
  expectations: Parameters<typeof makeSyntheticCaseFixture>[0]["expectations"],
  overrides: Partial<Parameters<typeof makeSyntheticCaseFixture>[0]> = {},
) {
  return makeSyntheticCaseFixture({
    id: "test/harness",
    description: "Harness probe fixture.",
    statutory: { assessmentYear: "2026-27", computationRulesVersion: RULES_VERSION },
    ledger: SALARY_LEDGER,
    caseMeta: META,
    evidence: SALARY_EVIDENCE,
    expectations,
    ...overrides,
  });
}

describe("the harness computes through the resolved pack binding", () => {
  it("produces exactly what the pack-routed engine produces for the same input", () => {
    const fixture = fixtureWith([
      makeExpectedOutput({
        outputId: "computation.grossTotalIncome",
        expected: 800_000,
        trace: trace([]),
      }),
    ]);
    const result = runSyntheticCaseFixtureWithDefaultRegistry(fixture);

    // Independently reproduce the adapter + engine path the harness routed.
    const adapter = buildEngineInput(fixture.ledger, fixture.caseMeta);
    expect(result.adapter?.input).toEqual(adapter.input);
    expect(result.checks[0]?.actual).toBe(computeTax(adapter.input).grossTotalIncome.value);
    expect(result.passed).toBe(true);
    expect(result.outcome).toBe("supported");
  });

  it("reports the governing pack key and the versions it stamps", () => {
    const result = runSyntheticCaseFixtureWithDefaultRegistry(fixtureWith([]));
    expect(result.packKey).toBe("IN:ITA_1961:assessment_year:2026-27:AY_2026_27_V5_PREP_ONLY");
    expect(result.packVersions).toEqual({
      computationRulesVersion: RULES_VERSION,
      validationRulesVersion: RULES_VERSION,
    });
  });

  it("is deterministic — repeated runs are identical", () => {
    const a = runSyntheticCaseFixtureWithDefaultRegistry(salariedRefundFixture);
    const b = runSyntheticCaseFixtureWithDefaultRegistry(salariedRefundFixture);
    expect(JSON.stringify(a.checks)).toBe(JSON.stringify(b.checks));
    expect(a.outcome).toBe(b.outcome);
  });
});

describe("a failure says WHICH rule under WHICH pack version moved", () => {
  it("names the cited rules and the canonical pack key on a value mismatch", () => {
    const result = runSyntheticCaseFixtureWithDefaultRegistry(
      fixtureWith([
        makeExpectedOutput({
          outputId: "computation.grossTotalIncome",
          expected: 999_999,
          trace: trace(["slab_rates", "cess_rate"]),
        }),
      ]),
    );
    expect(result.passed).toBe(false);
    const failure = result.failures.find((f) => f.kind === "value_mismatch");
    expect(failure).toBeDefined();
    expect(failure?.detail).toContain("slab_rates, cess_rate");
    expect(failure?.detail).toContain("IN:ITA_1961:assessment_year:2026-27:AY_2026_27_V5_PREP_ONLY");
    expect(failure?.expected).toBe(999_999);
    expect(failure?.actual).toBe(800_000);
    // The check is still recorded — an expectation is never silently skipped.
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]?.matched).toBe(false);
  });

  it("refuses a rule id the governing pack does not declare", () => {
    const result = runSyntheticCaseFixtureWithDefaultRegistry(
      fixtureWith([
        makeExpectedOutput({
          outputId: "computation.grossTotalIncome",
          expected: 800_000,
          trace: trace(["rule_that_does_not_exist"]),
        }),
      ]),
    );
    expect(result.passed).toBe(false);
    expect(result.failures.map((f) => f.kind)).toContain("unknown_rule");
    expect(result.failures[0]?.detail).toContain("rule_that_does_not_exist");
  });

  it("refuses a rule-derived output that cites no rule at all", () => {
    // Without this guard a fixture could pin a tax figure to an empty ruleIds
    // array and pass, leaving the laboratory's traceability claim true only by
    // convention.
    const result = runSyntheticCaseFixtureWithDefaultRegistry(
      fixtureWith([
        makeExpectedOutput({
          outputId: "computation.grossTaxLiability",
          expected: 0,
          trace: trace([]),
        }),
      ]),
    );
    expect(result.passed).toBe(false);
    const failure = result.failures.find((f) => f.kind === "untraced_output");
    expect(failure?.detail).toContain("computation.grossTaxLiability");
    expect(failure?.detail).toContain("rule-derived");
  });

  it("allows an input projection to cite no rule — it applies none", () => {
    // Gross total income and taxes paid are sums over declared ledger rows with
    // no rate, cap or threshold applied.
    for (const outputId of ["computation.grossTotalIncome", "computation.taxPaid"] as const) {
      expect(materialOutputKind(outputId)).toBe("input_projection");
    }
    const result = runSyntheticCaseFixtureWithDefaultRegistry(
      fixtureWith([
        makeExpectedOutput({ outputId: "computation.taxPaid", expected: 60_000, trace: trace([]) }),
      ]),
    );
    expect(result.passed).toBe(true);
  });

  it("classifies every material output, and only sums as input projections", () => {
    const projections = MATERIAL_OUTPUT_IDS.filter((id) => materialOutputKind(id) === "input_projection");
    expect(projections).toEqual(["computation.grossTotalIncome", "computation.taxPaid"]);
    // No id may be left unclassified.
    for (const id of MATERIAL_OUTPUT_IDS) {
      expect(["input_projection", "rule_derived"]).toContain(materialOutputKind(id));
    }
  });

  it("refuses an expectation pinned under a different pack version", () => {
    const result = runSyntheticCaseFixtureWithDefaultRegistry(
      fixtureWith([
        makeExpectedOutput({
          outputId: "computation.grossTotalIncome",
          expected: 800_000,
          trace: trace(["slab_rates"], { version: "AY_2025_26_SOME_OTHER_VERSION" }),
        }),
      ]),
    );
    expect(result.passed).toBe(false);
    const failure = result.failures.find((f) => f.kind === "pack_version_mismatch");
    expect(failure?.detail).toContain("AY_2025_26_SOME_OTHER_VERSION");
    expect(failure?.detail).toContain(RULES_VERSION);
  });

  it("describeFixtureRun renders every failure line", () => {
    const result = runSyntheticCaseFixtureWithDefaultRegistry(
      fixtureWith([
        makeExpectedOutput({
          outputId: "computation.taxPaid",
          expected: 1,
          trace: trace([]),
        }),
      ]),
    );
    const text = describeFixtureRun(result);
    expect(text).toContain("FAILED");
    expect(text).toContain("[value_mismatch]");
  });
});

describe("an unverified value cannot be marked verified", () => {
  it("fails when a fixture claims a draft pack's rules are verified", () => {
    const result = runSyntheticCaseFixtureWithDefaultRegistry(
      fixtureWith([
        makeExpectedOutput({
          outputId: "computation.grossTotalIncome",
          expected: 800_000,
          trace: trace(["slab_rates"], { unverified: false }),
        }),
      ]),
    );
    expect(result.passed).toBe(false);
    const failure = result.failures.find((f) => f.kind === "trace_understated");
    expect(failure?.detail).toContain("draft");
    expect(failure?.detail).toContain("TODO(CA-verify)");
  });

  it("marks every check from the shipped draft pack as unverified", () => {
    const result = runSyntheticCaseFixtureWithDefaultRegistry(salariedRefundFixture);
    expect(result.checks.length).toBeGreaterThan(0);
    expect(result.checks.every((c) => c.rulesUnverified)).toBe(true);
  });

  it("allows rulesUnverified:false only for a caveat-free, genuinely verified pack", () => {
    // A SYNTHETIC, test-only pack — never registered in the shipped registry.
    // It exists solely to prove the harness's verified branch is reachable; no
    // real rule is claimed to be CA-verified anywhere in the product.
    const registry = createTaxPackRegistry();
    registry.register(
      makeTaxPack(
        makeTaxPackIdentity({
          jurisdiction: "IN",
          law: "ITA_1961",
          periodKind: "assessment_year",
          period: "2026-27",
          computationRulesVersion: "TEST_ONLY_VERIFIED_PACK",
          validationRulesVersion: "TEST_ONLY_VERIFIED_PACK",
          status: "ca_verified",
          effectiveFrom: "2025-04-01",
          verifiedBy: "test-only synthetic reviewer",
          verifiedAt: "2026-01-01T00:00:00.000Z",
        }),
        {
          boundEngineId: "tax-engine/ay-2026-27",
          computation: { computeTax, compareRegimes, recommendItrForm, validateCase },
        },
        makeTaxPackProvenance([
          makeRuleProvenance({ ruleId: "slab_rates", summary: "test-only", caveat: null }),
        ]),
      ),
    );

    const fixture = fixtureWith(
      [
        makeExpectedOutput({
          outputId: "computation.grossTotalIncome",
          expected: 800_000,
          trace: trace(["slab_rates"], { version: "TEST_ONLY_VERIFIED_PACK", unverified: false }),
        }),
      ],
      {
        id: "test/verified-pack",
        statutory: {
          assessmentYear: "2026-27",
          computationRulesVersion: "TEST_ONLY_VERIFIED_PACK",
        },
      },
    );

    const result = runSyntheticCaseFixture(registry, fixture);
    expect(result.passed).toBe(true);
    expect(result.checks[0]?.rulesUnverified).toBe(false);
  });
});

describe("unsupported facts produce a typed, itemised blocked outcome", () => {
  it("reports blocked with every unsupported fact itemised", () => {
    const result = runSyntheticCaseFixtureWithDefaultRegistry(unsupportedFactsFixture);
    expect(result.outcome).toBe("blocked");
    expect(result.passed).toBe(true);
    expect(result.blocked.map((b) => b.code).sort()).toEqual([
      "UNSUPPORTED_GAIN_TYPE",
      "UNSUPPORTED_INCOME_HEAD",
    ]);
    expect(result.blocked.map((b) => b.ledgerId).sort()).toEqual(["lab_cg_other_ltcg", "lab_inc_hp"]);
    for (const fact of result.blocked) {
      expect(fact.message).not.toBe("");
      expect(typeof fact.amount).toBe("number");
    }
  });

  it("still evaluates every expectation — no assertion is skipped when blocked", () => {
    const result = runSyntheticCaseFixtureWithDefaultRegistry(unsupportedFactsFixture);
    expect(result.checks).toHaveLength(unsupportedFactsFixture.expectations.length);
    expect(result.checks.every((c) => c.matched)).toBe(true);
  });

  it("fails when a blocker is raised that the fixture did not declare", () => {
    const undeclared = fixtureWith([], {
      id: "test/undeclared-blocker",
      ledger: {
        ...SALARY_LEDGER,
        income: [
          ...SALARY_LEDGER.income,
          { id: "lab_inc_hp", income_head: "house_property", amount: 50_000, source_type: "manual" },
        ],
      },
      evidence: [
        ...SALARY_EVIDENCE,
        makeStaffAttestedEvidence({
          ledgerKind: "income",
          ledgerId: "lab_inc_hp",
          sourceType: "manual",
          acceptance: "accepted",
        }),
      ],
    });
    const result = runSyntheticCaseFixtureWithDefaultRegistry(undeclared);
    expect(result.outcome).toBe("blocked");
    expect(result.passed).toBe(false);
    expect(result.failures[0]?.kind).toBe("unsupported_mismatch");
    expect(result.failures[0]?.detail).toContain("did not declare");
  });

  it("fails when a declared blocker no longer occurs", () => {
    const stale = fixtureWith([], {
      id: "test/stale-blocker",
      expectedUnsupported: [
        { code: "UNSUPPORTED_INCOME_HEAD", ledgerId: "lab_inc_ghost", entryType: "house_property" },
      ],
    });
    const result = runSyntheticCaseFixtureWithDefaultRegistry(stale);
    expect(result.passed).toBe(false);
    expect(result.failures[0]?.kind).toBe("unsupported_mismatch");
    expect(result.failures[0]?.detail).toContain("raised no such blocker");
  });
});

describe("a statutory world with no computation binding is refused", () => {
  it("refuses rather than falling back to the 1961-Act engine", () => {
    const result = runSyntheticCaseFixtureWithDefaultRegistry(unboundStatutoryWorldFixture);
    expect(result.outcome).toBe("refused");
    expect(result.passed).toBe(true);
    expect(result.checks).toHaveLength(0);
    expect(result.blocked).toHaveLength(0);
    // Nothing was computed, so no pack versions are reported.
    expect(result.packVersions).toBeUndefined();
    expect(result.adapter).toBeUndefined();
  });

  it("fails a fixture that expected a binding but got a refusal", () => {
    const result = runSyntheticCaseFixtureWithDefaultRegistry(
      fixtureWith([], { id: "test/expects-binding", statutory: { assessmentYear: "2026-27", law: "ITA_2025" } }),
    );
    expect(result.outcome).toBe("refused");
    expect(result.passed).toBe(false);
    expect(result.failures[0]?.kind).toBe("pack_refused");
    expect(result.failures[0]?.detail).toContain("unbound");
  });

  it("fails a fixture that expected a refusal but bound a pack", () => {
    const result = runSyntheticCaseFixtureWithDefaultRegistry(
      fixtureWith([], { id: "test/expects-refusal", expectedBinding: "refused" }),
    );
    expect(result.passed).toBe(false);
    expect(result.failures[0]?.kind).toBe("pack_bound_unexpectedly");
  });

  it("refuses a statutory world that resolves to no pack at all", () => {
    const registry = createDefaultTaxPackRegistry();
    const result = runSyntheticCaseFixture(
      registry,
      fixtureWith([], { id: "test/unknown-year", statutory: { assessmentYear: "1999-00" }, expectedBinding: "refused" }),
    );
    expect(result.outcome).toBe("refused");
    expect(result.passed).toBe(true);
  });
});

describe("an unaccepted fact never becomes preparation truth (K3-21)", () => {
  it("withholds the fact BEFORE the adapter runs — it never reaches the engine input", () => {
    const result = runSyntheticCaseFixtureWithDefaultRegistry(unacceptedEvidenceFixture);
    expect(result.passed).toBe(true);
    // Not filtered downstream: the row is absent from the engine input entirely.
    expect(result.adapter?.input.capitalGains).toEqual([]);
    expect(result.adapter?.input.sourceRecordIds).not.toContain("lab_cg_stcg");
  });

  it("reports the withheld fact as typed, itemised work with its reason", () => {
    const result = runSyntheticCaseFixtureWithDefaultRegistry(unacceptedEvidenceFixture);
    expect(result.withheld).toHaveLength(1);
    const [fact] = result.withheld;
    expect(fact?.ledgerId).toBe("lab_cg_stcg");
    expect(fact?.ledgerKind).toBe("capital_gain");
    expect(fact?.acceptance).toBe("proposed");
    expect(fact?.documentId).toBe("lab_doc_broker");
    expect(fact?.reason).toMatch(/not been reviewed or accepted/);
  });

  it("blocks the run — an excluded declared fact is never silently absent", () => {
    const result = runSyntheticCaseFixtureWithDefaultRegistry(unacceptedEvidenceFixture);
    expect(result.outcome).toBe("blocked");
    // ...and every expectation is still evaluated, exactly as for engine gaps.
    expect(result.checks).toHaveLength(unacceptedEvidenceFixture.expectations.length);
    expect(result.checks.every((c) => c.matched)).toBe(true);
  });

  it("computes the same numbers as a case that never declared the fact at all", () => {
    // The strongest statement of "not folded in": the unaccepted gain leaves no
    // trace on any figure, rather than being netted, estimated or partially used.
    const withoutFact = buildEngineInput(
      {
        income: [...unacceptedEvidenceFixture.ledger.income],
        taxPaid: [...unacceptedEvidenceFixture.ledger.taxPaid],
        deductions: [],
        capitalGains: [],
      },
      unacceptedEvidenceFixture.caseMeta,
    );
    const result = runSyntheticCaseFixtureWithDefaultRegistry(unacceptedEvidenceFixture);
    expect(result.adapter?.input).toEqual(withoutFact.input);
  });

  it("fails when an unaccepted fact was not declared as withheld", () => {
    const undeclared = makeSyntheticCaseFixture({
      id: "test/undeclared-withheld",
      description: "Probe.",
      statutory: { assessmentYear: "2026-27", computationRulesVersion: RULES_VERSION },
      ledger: SALARY_LEDGER,
      caseMeta: META,
      evidence: [
        SALARY_EVIDENCE[0]!,
        makeStaffAttestedEvidence({
          ledgerKind: "tax_paid",
          ledgerId: "lab_tp_tds",
          sourceType: "manual",
          acceptance: "rejected",
          acceptanceReason: "Challan could not be located.",
        }),
      ],
      expectedWithheld: [{ ledgerId: "lab_tp_tds", ledgerKind: "tax_paid", acceptance: "rejected" }],
    });
    // Constructed correctly, the run agrees. Now hand-build the same fixture
    // WITHOUT the declaration — the interface allows it, the harness must not.
    const smuggled = { ...undeclared, expectedWithheld: [] } as typeof undeclared;
    const result = runSyntheticCaseFixtureWithDefaultRegistry(smuggled);
    expect(result.passed).toBe(false);
    expect(result.failures[0]?.kind).toBe("withheld_mismatch");
    expect(result.failures[0]?.detail).toContain("Challan could not be located.");
  });

  it("refuses a declared fact carrying no evidence record at all", () => {
    // `makeSyntheticCaseFixture` blocks this; a hand-built literal must not slip
    // an un-evidenced fact into a computation.
    const base = fixtureWith([]);
    const unevidenced = { ...base, evidence: [] } as typeof base;
    const result = runSyntheticCaseFixtureWithDefaultRegistry(unevidenced);
    expect(result.passed).toBe(false);
    expect(result.failures.map((f) => f.kind)).toContain("untraced_evidence");
    expect(result.adapter?.input.income).toEqual([]);
  });
});

describe("every material output reports the accepted evidence behind it (K3-21)", () => {
  it("names the evidence-backed facts that contributed to a number", () => {
    const result = runSyntheticCaseFixtureWithDefaultRegistry(salariedRefundFixture);
    const gti = result.checks.find((c) => c.outputId === "computation.grossTotalIncome");
    expect(gti?.evidenceTraceable).toBe(true);
    expect(gti?.contributingFacts.map((f) => f.ledgerId).sort()).toContain("lab_inc_salary");
    const salary = gti?.contributingFacts.find((f) => f.ledgerId === "lab_inc_salary");
    expect(salary?.documentId).toBe("lab_doc_form16");
    expect(salary?.sourceType).toBe("Form16");
    expect(salary?.acceptance).toBe("accepted");
    // The engine tags this figure with the DOCUMENT, which backs more than one
    // row — reported as such rather than implying the tag singled out one row.
    expect(salary?.resolvedBy).toBe("document");
  });

  it("reports a staff-attested contribution as resolved by ledger row", () => {
    const result = runSyntheticCaseFixtureWithDefaultRegistry(salariedRefundFixture);
    const gti = result.checks.find((c) => c.outputId === "computation.grossTotalIncome");
    const fd = gti?.contributingFacts.find((f) => f.ledgerId === "lab_inc_fd");
    expect(fd?.evidenceKind).toBe("staff_attested");
    expect(fd?.documentId).toBeUndefined();
    expect(fd?.resolvedBy).toBe("ledger_row");
  });

  it("distinguishes 'no contributing facts' from 'not source-tagged at all'", () => {
    const result = runSyntheticCaseFixtureWithDefaultRegistry(salariedRefundFixture);
    // A categorical decision over the whole case carries no source tags.
    const regime = result.checks.find((c) => c.outputId === "computation.recommendedRegime");
    expect(regime?.evidenceTraceable).toBe(false);
    expect(regime?.contributingFacts).toEqual([]);
    // The rebate IS source-tagged; it simply derives from totals, not from rows.
    const rebate = result.checks.find((c) => c.outputId === "computation.rebate");
    expect(rebate?.evidenceTraceable).toBe(true);
    expect(rebate?.contributingFacts).toEqual([]);
  });

  it("fails loudly when a number was computed from evidence the fixture cannot name", () => {
    // Hand-build a fixture whose evidence names a row the ledger does not carry
    // under the id the engine tags with — the number then stands on evidence the
    // laboratory cannot account for, which is exactly what the gate forbids.
    const base = fixtureWith([
      makeExpectedOutput({
        outputId: "computation.grossTotalIncome",
        expected: 800_000,
        trace: trace([]),
      }),
    ]);
    const renamed = {
      ...base,
      evidence: [
        makeStaffAttestedEvidence({
          ledgerKind: "income",
          ledgerId: "lab_inc_somewhere_else",
          sourceType: "manual",
          acceptance: "accepted",
        }),
        ...base.evidence.filter((e) => e.ledgerId === "lab_tp_tds"),
      ],
    } as typeof base;
    const result = runSyntheticCaseFixtureWithDefaultRegistry(renamed);
    expect(result.passed).toBe(false);
    expect(result.failures.map((f) => f.kind)).toContain("untraced_evidence");
  });

  it("every contributing fact reported anywhere is accepted", () => {
    for (const fixture of [salariedRefundFixture, unacceptedEvidenceFixture, reconciliationFindingFixture]) {
      const result = runSyntheticCaseFixtureWithDefaultRegistry(fixture);
      for (const check of result.checks) {
        for (const fact of check.contributingFacts) {
          expect(fact.acceptance).toBe("accepted");
        }
      }
    }
  });
});

describe("validation findings are pinnable work, not prose (K3-21)", () => {
  it("pins a reconciliation finding by code, severity and area", () => {
    const result = runSyntheticCaseFixtureWithDefaultRegistry(reconciliationFindingFixture);
    expect(result.passed).toBe(true);
    expect(result.findingChecks).toHaveLength(1);
    expect(result.findingChecks[0]).toMatchObject({
      code: "AIS_INTEREST_NOT_ENTERED",
      expectedSeverity: "warning",
      actualSeverity: "warning",
      expectedArea: "reconciliation",
      matched: true,
      packValidationRulesVersion: RULES_VERSION,
    });
  });

  it("routes validateCase through the pack binding, not a direct engine import", () => {
    const result = runSyntheticCaseFixtureWithDefaultRegistry(reconciliationFindingFixture);
    const adapter = buildEngineInput(
      reconciliationFindingFixture.ledger,
      reconciliationFindingFixture.caseMeta,
    );
    expect(result.findings).toEqual(validateCase(adapter.input).findings);
  });

  it("fails when a pinned finding is no longer raised", () => {
    const result = runSyntheticCaseFixtureWithDefaultRegistry(
      fixtureWith([], {
        id: "test/ghost-finding",
        expectedFindings: [
          {
            code: "AIS_INTEREST_NOT_ENTERED",
            severity: "warning",
            area: "reconciliation",
            packValidationRulesVersion: RULES_VERSION,
          },
        ],
      }),
    );
    expect(result.passed).toBe(false);
    expect(result.failures[0]?.kind).toBe("validation_finding_missing");
  });

  it("fails when the case raises a finding the fixture did not pin", () => {
    const result = runSyntheticCaseFixtureWithDefaultRegistry(
      makeSyntheticCaseFixture({
        id: "test/unpinned-finding",
        description: "Probe.",
        statutory: { assessmentYear: "2026-27", computationRulesVersion: RULES_VERSION },
        ledger: {
          ...SALARY_LEDGER,
          income: [
            ...SALARY_LEDGER.income,
            {
              id: "lab_inc_fd",
              income_head: "fd_interest",
              amount: 50_000,
              source_type: "bank_certificate",
              source_document_id: "lab_doc_bank",
            },
          ],
        },
        caseMeta: META,
        evidence: [
          ...SALARY_EVIDENCE,
          makeDocumentEvidence({
            kind: "source_document",
            ledgerKind: "income",
            ledgerId: "lab_inc_fd",
            document: {
              documentId: "lab_doc_bank",
              label: "Synthetic bank interest certificate",
              sourceType: "bank_certificate",
            },
            acceptance: "accepted",
          }),
        ],
      }),
    );
    expect(result.passed).toBe(false);
    const failure = result.failures.find((f) => f.kind === "validation_finding_unexpected");
    expect(failure?.detail).toContain("AIS_INTEREST_NOT_ENTERED");
  });

  it("fails when a pinned finding changes severity", () => {
    const result = runSyntheticCaseFixtureWithDefaultRegistry({
      ...reconciliationFindingFixture,
      expectedFindings: [
        {
          code: "AIS_INTEREST_NOT_ENTERED",
          severity: "blocker",
          area: "reconciliation",
          packValidationRulesVersion: RULES_VERSION,
        },
      ],
    });
    expect(result.passed).toBe(false);
    const failure = result.failures.find((f) => f.kind === "validation_finding_mismatch");
    expect(failure?.detail).toContain("blocker");
    expect(failure?.detail).toContain("warning");
  });

  it("refuses a finding pinned under a different validation rules version", () => {
    const result = runSyntheticCaseFixtureWithDefaultRegistry({
      ...reconciliationFindingFixture,
      expectedFindings: [
        {
          code: "AIS_INTEREST_NOT_ENTERED",
          severity: "warning",
          area: "reconciliation",
          packValidationRulesVersion: "SOME_OTHER_VALIDATION_VERSION",
        },
      ],
    });
    expect(result.passed).toBe(false);
    const failure = result.failures.find((f) => f.kind === "pack_version_mismatch");
    expect(failure?.detail).toContain("SOME_OTHER_VALIDATION_VERSION");
  });
});

describe("the harness never asserts on tax knowledge of its own", () => {
  it("reads ITR-form recommendation from the pack binding, not a local rule", () => {
    const adapter = buildEngineInput(SALARY_LEDGER, META);
    const result = runSyntheticCaseFixtureWithDefaultRegistry(
      fixtureWith([
        makeExpectedOutput({
          outputId: "itrForm.recommendedItrType",
          expected: recommendItrForm(adapter.input).recommendedItrType,
          trace: trace(["itr1_income_ceiling"]),
        }),
      ]),
    );
    expect(result.passed).toBe(true);
  });
});
