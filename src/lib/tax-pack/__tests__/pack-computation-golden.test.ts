import { describe, expect, it } from "vitest";
import {
  compareRegimes,
  computeTax,
  recommendItrForm,
  validateCase,
} from "@/lib/tax-engine/ay-2026-27";
import {
  reconciliationMismatchCase,
  salaryCapitalGainsCase,
  simpleSalariedRefundCase,
} from "@/lib/tax-engine/ay-2026-27/fixtures";
import { ASSESSMENT_YEAR, RULES_VERSION } from "@/lib/tax-engine/ay-2026-27/rules";
import type { TaxEngineInput } from "@/lib/tax-engine/ay-2026-27/types";
import { createDefaultTaxPackRegistry, taxPackComputation } from "@/lib/tax-pack";
import { resolveTaxPack, resolveTaxPackForReliance } from "@/lib/tax-pack/resolver";
import type { TaxPackComputation } from "@/lib/tax-pack/pack";

/**
 * K3-11 golden regression: the AY 2026-27 engine is now callable THROUGH the
 * resolved pack. The contract these tests defend is that the pack is a pure
 * indirection — for every representative fixture, pack-routed output must be
 * deep-equal (byte-identical after JSON serialisation) to a direct engine call.
 *
 * If any assertion here fails, the pack has started adapting the engine and the
 * migration is no longer output-preserving.
 */

/** Resolve the AY 2026-27 pack's computation surface (fails loudly if absent). */
function resolvedComputation(): TaxPackComputation {
  const registry = createDefaultTaxPackRegistry();
  const resolution = resolveTaxPack(registry, {
    law: "ITA_1961",
    periodKind: "assessment_year",
    period: ASSESSMENT_YEAR,
    computationRulesVersion: RULES_VERSION,
  });
  if (resolution.outcome !== "resolved") {
    throw new Error(`expected a resolved AY pack, got ${resolution.outcome}`);
  }
  const computation = taxPackComputation(resolution.pack);
  if (computation === undefined) {
    throw new Error("resolved AY pack carries no computation binding");
  }
  return computation;
}

const FIXTURES: ReadonlyArray<readonly [string, TaxEngineInput]> = [
  ["simpleSalariedRefundCase", simpleSalariedRefundCase],
  ["salaryCapitalGainsCase", salaryCapitalGainsCase],
  ["reconciliationMismatchCase", reconciliationMismatchCase],
];

describe("pack-routed computation is byte-identical to the direct engine", () => {
  const pack = resolvedComputation();

  for (const [name, input] of FIXTURES) {
    describe(name, () => {
      it("computeTax matches the direct engine call", () => {
        const direct = computeTax(input);
        const viaPack = pack.computeTax(input);
        expect(viaPack).toEqual(direct);
        expect(JSON.stringify(viaPack)).toBe(JSON.stringify(direct));
      });

      it("compareRegimes matches the direct engine call", () => {
        const direct = compareRegimes(input);
        const viaPack = pack.compareRegimes(input);
        expect(viaPack).toEqual(direct);
        expect(JSON.stringify(viaPack)).toBe(JSON.stringify(direct));
      });

      it("recommendItrForm matches the direct engine call", () => {
        const direct = recommendItrForm(input);
        const viaPack = pack.recommendItrForm(input);
        expect(viaPack).toEqual(direct);
        expect(JSON.stringify(viaPack)).toBe(JSON.stringify(direct));
      });

      it("validateCase matches the direct engine call", () => {
        const direct = validateCase(input);
        const viaPack = pack.validateCase(input);
        expect(viaPack).toEqual(direct);
        expect(JSON.stringify(viaPack)).toBe(JSON.stringify(direct));
      });
    });
  }

  it("stamps the pack's own rules version on pack-routed computations", () => {
    // The identity's computationRulesVersion IS the engine's RULES_VERSION, so a
    // pack-routed computation is self-describing: the result's rulesVersion and
    // the resolving identity can never disagree.
    const result = pack.computeTax(simpleSalariedRefundCase);
    expect(result.rulesVersion).toBe(RULES_VERSION);
  });

  it("is deterministic — repeated pack-routed calls are identical", () => {
    const a = pack.computeTax(salaryCapitalGainsCase);
    const b = pack.computeTax(salaryCapitalGainsCase);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("binding an engine does not authorise reliance", () => {
  it("still refuses real-preparation reliance on the draft AY pack", () => {
    const registry = createDefaultTaxPackRegistry();
    const reliance = resolveTaxPackForReliance(registry, {
      law: "ITA_1961",
      periodKind: "assessment_year",
      period: ASSESSMENT_YEAR,
      computationRulesVersion: RULES_VERSION,
    });
    expect(reliance.outcome).toBe("refused");
    if (reliance.outcome === "refused") expect(reliance.resolution).toBe("unverified");
  });

  // K3-15 replaced this assertion's mechanism (decision D18): the 2025-Act world
  // now RESOLVES to a registered identity-only stub instead of being
  // `unsupported`. The property under test is unchanged and is asserted more
  // directly — that world still offers no computation.
  it("offers no computation for the unimplemented 2025-Act statutory world", () => {
    const registry = createDefaultTaxPackRegistry();
    const resolution = resolveTaxPack(registry, {
      law: "ITA_2025",
      periodKind: "tax_year",
      period: "2026-27",
    });
    expect(resolution.outcome).toBe("resolved");
    if (resolution.outcome !== "resolved") return;
    expect(taxPackComputation(resolution.pack)).toBeUndefined();
  });
});
