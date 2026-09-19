import { describe, expect, it } from "vitest";
import { RULES_VERSION } from "@/lib/tax-engine/ay-2026-27/rules";
import {
  TAX_LAB_FIXTURE_FORMAT_VERSION,
  assertSyntheticOnly,
  makeExpectedOutput,
  makeSyntheticCaseFixture,
} from "../fixture";
import { MATERIAL_OUTPUT_IDS, isMaterialOutputId, readMaterialOutput } from "../material-outputs";
import type { CaseMeta, LedgerRows } from "@/lib/tax-desk/computation-adapter";

/**
 * K3-20 — the fixture CONTRACT. These tests defend the three structural
 * properties the laboratory relies on: a closed material-output vocabulary,
 * traceability recorded as data, and a synthetic-only guard that cannot be
 * talked around.
 */

const EMPTY_LEDGER: LedgerRows = { income: [], taxPaid: [], deductions: [], capitalGains: [] };
const META: CaseMeta = {
  assessmentYear: "2026-27",
  financialYear: "2025-26",
  selectedItrType: "ITR-1",
  finalized: false,
};

function trace(ruleIds: readonly string[] = ["slab_rates"]) {
  return { ruleIds, packComputationRulesVersion: RULES_VERSION, rulesUnverified: true };
}

function baseFixture(overrides: Partial<Parameters<typeof makeSyntheticCaseFixture>[0]> = {}) {
  return makeSyntheticCaseFixture({
    id: "test/base",
    description: "A minimal synthetic fixture.",
    statutory: { assessmentYear: "2026-27" },
    ledger: EMPTY_LEDGER,
    caseMeta: META,
    ...overrides,
  });
}

describe("material-output vocabulary is closed", () => {
  it("every declared id has an extractor and round-trips the type guard", () => {
    for (const id of MATERIAL_OUTPUT_IDS) {
      expect(isMaterialOutputId(id)).toBe(true);
    }
  });

  it("rejects an id that is not in the vocabulary", () => {
    expect(isMaterialOutputId("computation.someInventedField")).toBe(false);
    expect(() =>
      makeExpectedOutput({ outputId: "computation.someInventedField", expected: 1, trace: trace() }),
    ).toThrow(/Unknown material output id/);
  });

  it("does not treat inherited Object properties as output ids", () => {
    // A naive `id in EXTRACTORS` check would answer true for these.
    expect(isMaterialOutputId("toString")).toBe(false);
    expect(isMaterialOutputId("constructor")).toBe(false);
  });

  it("readMaterialOutput throws for an id outside the vocabulary", () => {
    const outputs = { computation: {}, itrForm: {} } as never;
    expect(() => readMaterialOutput(outputs, "nope" as never)).toThrow(/Unknown material output id/);
  });
});

describe("expectations record traceability as data", () => {
  it("keeps the cited rule ids, pack version and unverified marking", () => {
    const expectation = makeExpectedOutput({
      outputId: "computation.grossTaxLiability",
      expected: 1_000,
      trace: trace(["slab_rates", "cess_rate"]),
    });
    expect(expectation.trace.ruleIds).toEqual(["slab_rates", "cess_rate"]);
    expect(expectation.trace.packComputationRulesVersion).toBe(RULES_VERSION);
    expect(expectation.trace.rulesUnverified).toBe(true);
    expect(Object.isFrozen(expectation)).toBe(true);
    expect(Object.isFrozen(expectation.trace)).toBe(true);
  });

  it("requires an explicit boolean for rulesUnverified — silence is not 'verified'", () => {
    expect(() =>
      makeExpectedOutput({
        outputId: "computation.cess",
        expected: 0,
        trace: {
          ruleIds: ["cess_rate"],
          packComputationRulesVersion: RULES_VERSION,
          rulesUnverified: undefined as unknown as boolean,
        },
      }),
    ).toThrow(/rulesUnverified must be an explicit boolean/);
  });

  it("requires a non-empty pack version", () => {
    expect(() =>
      makeExpectedOutput({
        outputId: "computation.cess",
        expected: 0,
        trace: { ruleIds: [], packComputationRulesVersion: "  ", rulesUnverified: true },
      }),
    ).toThrow(/packComputationRulesVersion/);
  });

  it("refuses a duplicated rule id", () => {
    expect(() =>
      makeExpectedOutput({
        outputId: "computation.cess",
        expected: 0,
        trace: trace(["cess_rate", "cess_rate"]),
      }),
    ).toThrow(/cites rule "cess_rate" twice/);
  });
});

describe("fixture construction", () => {
  it("stamps the laboratory's own format version", () => {
    expect(baseFixture().formatVersion).toBe(TAX_LAB_FIXTURE_FORMAT_VERSION);
    // V2 (K3-21): `evidence` became required, so no V1 fixture with a non-empty
    // ledger is a valid V2 fixture — a deliberate, incompatible bump.
    expect(TAX_LAB_FIXTURE_FORMAT_VERSION).toBe("TAX_LAB_FIXTURE_V2");
  });

  it("defaults to expecting a bound pack", () => {
    expect(baseFixture().expectedBinding).toBe("bound");
  });

  it("freezes the fixture and copies the ledger arrays", () => {
    const ledger: LedgerRows = { ...EMPTY_LEDGER, income: [] };
    const fixture = baseFixture({ ledger });
    expect(Object.isFrozen(fixture)).toBe(true);
    ledger.income.push({ id: "x", income_head: "salary", amount: 1, source_type: "manual" });
    expect(fixture.ledger.income).toHaveLength(0);
  });

  it("refuses an empty id or description", () => {
    expect(() => baseFixture({ id: "" })).toThrow(/id must be a non-empty string/);
    expect(() => baseFixture({ description: "   " })).toThrow(/description must be a non-empty string/);
  });

  it("refuses pinning the same material output twice", () => {
    const one = makeExpectedOutput({ outputId: "computation.cess", expected: 0, trace: trace() });
    const two = makeExpectedOutput({ outputId: "computation.cess", expected: 1, trace: trace() });
    expect(() => baseFixture({ expectations: [one, two] })).toThrow(/pins computation.cess more than once/);
  });

  it("refuses declaring the same unsupported fact twice", () => {
    expect(() =>
      baseFixture({
        expectedUnsupported: [
          { code: "UNSUPPORTED_INCOME_HEAD", ledgerId: "row_1", entryType: "house_property" },
          { code: "UNSUPPORTED_INCOME_HEAD", ledgerId: "row_1", entryType: "house_property" },
        ],
      }),
    ).toThrow(/declares unsupported fact UNSUPPORTED_INCOME_HEAD:row_1 twice/);
  });
});

describe("synthetic-only guard", () => {
  it("refuses a PAN-shaped string anywhere in the fixture", () => {
    expect(() =>
      baseFixture({
        ledger: {
          ...EMPTY_LEDGER,
          income: [
            {
              id: "row_1",
              income_head: "salary",
              amount: 1,
              source_type: "manual",
              source_document_name: "Form 16 for ABCDE1234F",
            },
          ],
        },
      }),
    ).toThrow(/PAN-shaped string/);
  });

  it("refuses an Aadhaar-shaped string, grouped or contiguous", () => {
    expect(() => assertSyntheticOnly({ note: "1234 5678 9012" }, "t")).toThrow(/Aadhaar-shaped string/);
    expect(() => assertSyntheticOnly({ note: "123456789012" }, "t")).toThrow(/Aadhaar-shaped string/);
    expect(() => assertSyntheticOnly({ note: "1234-5678-9012" }, "t")).toThrow(/Aadhaar-shaped string/);
  });

  it("scans nested structures, not just top-level strings", () => {
    expect(() => assertSyntheticOnly({ a: [{ b: { c: "ABCDE1234F" } }] }, "t")).toThrow(/PAN-shaped/);
  });

  it("accepts ordinary synthetic content", () => {
    expect(() =>
      assertSyntheticOnly({ id: "lab_inc_salary", ay: "2026-27", v: "AY_2026_27_V0_PREP_ONLY" }, "t"),
    ).not.toThrow();
  });
});
