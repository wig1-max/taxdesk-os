import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CESS_RATE,
  ITR1_INCOME_CEILING,
  REBATE_87A,
  RULES_VERSION,
  SURCHARGE,
} from "@/lib/tax-engine/ay-2026-27/rules";
import {
  NEW_REGIME_SLABS,
  OLD_REGIME_SENIOR_SLABS,
  OLD_REGIME_SLABS,
  OLD_REGIME_SUPER_SENIOR_SLABS,
} from "@/lib/tax-engine/ay-2026-27/slabs";
import {
  ENGINE_ENTRY_POINTS,
  ENTRY_POINT_REQUIREMENTS,
  RATE_PARAMETER_IDS,
  describeWithheldParameters,
  rateParameter,
  resolveEngineCapability,
  type StatutoryRateParameters,
} from "../statutory-rate-parameters";
import { AY_2026_27_RATE_PARAMETERS } from "@/lib/tax-pack/packs/ay-2026-27-rate-parameters";
import { TY_2026_27_RATE_PARAMETERS } from "@/lib/tax-pack/packs/ty-2026-27-rate-parameters";
import {
  availableFrom,
  uncitedAvailableParameterIds,
  withheldBecause,
} from "@/lib/tax-pack/packs/rate-parameters";
import { AY_2026_27_PACK_PROVENANCE } from "@/lib/tax-pack/packs/ay-2026-27-provenance";
import { AY_2026_27_PACK_IDENTITY } from "@/lib/tax-pack/packs/ay-2026-27";
import { taxPackKey } from "@/lib/tax-pack/identity";
import { makeRuleProvenance, makeTaxPackProvenance } from "@/lib/tax-pack/provenance";

/**
 * K4-PORT-02 (`D299`) — the SHARED, ACT-AGNOSTIC CORE's parameter boundary.
 *
 * `D299` chose a shared rule core parameterised by pack over a second copied
 * engine. These tests protect the two properties that decision rests on:
 *
 *   1. the boundary can carry the WORKING 1961-Act world without changing it —
 *      every value is the engine's own object by reference, so this cannot
 *      become a second, drifting copy of the rules;
 *   2. a world that cannot source a figure cannot compute with it — capability
 *      is DERIVED from the parameters, never declared alongside them.
 */

const REPO_ROOT = process.cwd();

describe("the parameter contract is complete and exhaustive", () => {
  it("resolves every declared id, and every id maps to a distinct parameter", () => {
    const seen = new Set<unknown>();
    for (const id of RATE_PARAMETER_IDS) {
      const parameter = rateParameter(AY_2026_27_RATE_PARAMETERS, id);
      expect(parameter, `${id} must resolve`).toBeDefined();
      expect(["available", "withheld"]).toContain(parameter.state);
      expect(seen.has(parameter), `${id} must not alias another parameter`).toBe(false);
      seen.add(parameter);
    }
    expect(seen.size).toBe(RATE_PARAMETER_IDS.length);
  });

  it("requires every entry point to declare its parameters, all of them known", () => {
    expect(Object.keys(ENTRY_POINT_REQUIREMENTS).sort()).toEqual([...ENGINE_ENTRY_POINTS].sort());
    for (const entryPoint of ENGINE_ENTRY_POINTS) {
      const required = ENTRY_POINT_REQUIREMENTS[entryPoint];
      expect(required.length, `${entryPoint} must require at least one parameter`).toBeGreaterThan(0);
      for (const id of required) expect(RATE_PARAMETER_IDS).toContain(id);
    }
  });

  /**
   * THE REQUIREMENT TABLE IS ONLY HONEST IF EVERY ENTRY POINT DECLARED TO NEED
   * THE COMPUTATION SET REALLY DOES REACH `computeTax`. The claim is checked
   * against the source rather than trusted: if one of those modules stops
   * importing `compute-tax`, this fails and the table must be re-derived.
   *
   * **`K4-PORT-03` FIXED A REAL HOLE IN THIS GUARD, and the hole is the more
   * interesting half.** It used to scan a HAND-WRITTEN pair —
   * `["compare-regimes.ts", "validate-case.ts"]` — while the property it
   * claims to defend is about the whole table. `recommend-itr-form.ts` also
   * imports and calls `compute-tax`, and it was not scanned, so
   * `ENTRY_POINT_REQUIREMENTS.recommendItrForm` could sit at
   * `["itr_form_income_ceiling"]` alone with this guard green — a guard
   * checking a PROXY for the property in its own docstring, which is exactly
   * the `AUDIT-11` class. The scan set is now DERIVED from the table: every
   * entry point whose requirements include the computation parameters must be
   * shown to reach `compute-tax`, so adding an entry point widens the scan
   * automatically instead of leaving it describing two files forever.
   */
  it("proves every entry point declared to need the computation set really does reach compute-tax", () => {
    const MODULE_FOR: Readonly<Record<string, string>> = {
      computeTax: "compute-tax.ts",
      compareRegimes: "compare-regimes.ts",
      recommendItrForm: "recommend-itr-form.ts",
      validateCase: "validate-case.ts",
    };
    // Every entry point has a module here, so a new one cannot slip past the scan.
    expect(Object.keys(MODULE_FOR).sort()).toEqual([...ENGINE_ENTRY_POINTS].sort());

    const computationSet = new Set(ENTRY_POINT_REQUIREMENTS.computeTax);
    const needsComputation = ENGINE_ENTRY_POINTS.filter(
      (entryPoint) =>
        entryPoint !== "computeTax" &&
        ENTRY_POINT_REQUIREMENTS[entryPoint].filter((id) => computationSet.has(id)).length ===
          computationSet.size,
    );
    // Not vacuous: three entry points reach `computeTax`, and the guard would
    // be worthless if this list were empty.
    expect([...needsComputation].sort()).toEqual([
      "compareRegimes",
      "recommendItrForm",
      "validateCase",
    ]);

    for (const entryPoint of needsComputation) {
      const fileName = MODULE_FOR[entryPoint] as string;
      const source = readFileSync(
        join(REPO_ROOT, "src", "lib", "tax-engine", "ay-2026-27", fileName),
        "utf8",
      );
      expect(
        /from\s+["']\.\/compute-tax["']/.test(source),
        `${fileName} must import ./compute-tax for ENTRY_POINT_REQUIREMENTS to be honest`,
      ).toBe(true);
    }

    expect(ENTRY_POINT_REQUIREMENTS.validateCase).toEqual(ENTRY_POINT_REQUIREMENTS.computeTax);
    expect(ENTRY_POINT_REQUIREMENTS.compareRegimes).toEqual(ENTRY_POINT_REQUIREMENTS.computeTax);
    // `recommendItrForm` is a strict SUPERSET: the computation set plus the
    // ceiling. Asserted both ways so it can neither shrink to the ceiling alone
    // (the pre-`K4-PORT-03` error) nor quietly acquire an extra parameter.
    expect([...ENTRY_POINT_REQUIREMENTS.recommendItrForm].sort()).toEqual(
      [...ENTRY_POINT_REQUIREMENTS.computeTax, "itr_form_income_ceiling"].sort(),
    );
  });
});

describe("the AY 2026-27 world passes through the boundary unchanged", () => {
  it("holds the engine's OWN constants BY REFERENCE — never a retyped copy", () => {
    const p = AY_2026_27_RATE_PARAMETERS;
    // `toBe`, deliberately, not `toEqual`. A structural copy would satisfy
    // `toEqual` and then drift the first time a constant moved; reference
    // identity is the only assertion that makes drift impossible (D6).
    if (p.newRegimeSlabs.state !== "available") throw new Error("new slabs must be available");
    expect(p.newRegimeSlabs.value).toBe(NEW_REGIME_SLABS);

    if (p.oldRegimeSlabs.state !== "available") throw new Error("old slabs must be available");
    expect(p.oldRegimeSlabs.value.below60).toBe(OLD_REGIME_SLABS);
    expect(p.oldRegimeSlabs.value.senior).toBe(OLD_REGIME_SENIOR_SLABS);
    expect(p.oldRegimeSlabs.value.superSenior).toBe(OLD_REGIME_SUPER_SENIOR_SLABS);

    if (p.surcharge.state !== "available") throw new Error("surcharge must be available");
    expect(p.surcharge.value).toBe(SURCHARGE);

    if (p.cess.state !== "available") throw new Error("cess must be available");
    expect(p.cess.value).toBe(CESS_RATE);

    if (p.rebate.state !== "available") throw new Error("rebate must be available");
    expect(p.rebate.value).toBe(REBATE_87A);

    if (p.itrFormIncomeCeiling.state !== "available") throw new Error("ceiling must be available");
    expect(p.itrFormIncomeCeiling.value).toBe(ITR1_INCOME_CEILING);
  });

  it("serves ALL FOUR entry points, so the live engine binding is untouched", () => {
    const capability = resolveEngineCapability(AY_2026_27_RATE_PARAMETERS);
    expect(capability.complete).toBe(true);
    expect(capability.withheld).toEqual([]);
    expect([...capability.servableEntryPoints].sort()).toEqual([...ENGINE_ENTRY_POINTS].sort());
    expect(describeWithheldParameters(capability)).toBeNull();
  });

  it("names the pack it belongs to", () => {
    expect(AY_2026_27_RATE_PARAMETERS.packKey).toBe(taxPackKey(AY_2026_27_PACK_IDENTITY));
    expect(AY_2026_27_RATE_PARAMETERS.packKey).toContain(RULES_VERSION);
    expect(AY_2026_27_RATE_PARAMETERS.engineId).toBe("tax-engine/ay-2026-27");
  });

  /**
   * A PRE-EXISTING HONESTY GAP THIS BOUNDARY MADE VISIBLE, PINNED SO IT CANNOT
   * QUIETLY GROW.
   *
   * The AY pack's own provenance cites NO official source for `cess_rate` or
   * `itr1_income_ceiling`, while the engine applies both to every case. That is
   * recorded truthfully in that pack ("the engine documents the rate but names
   * no statutory source") and is not created here — `K4-PORT-02` found it by
   * applying the contract to the working world.
   *
   * The set is asserted EXACTLY. A session that cites one of them removes it
   * from this list; a session that adds a third uncited supplied figure fails
   * here and must justify it.
   */
  it("supplies NO figure that rests on an uncited source", () => {
    // `K4-SOURCE-02` (2026-08-15) REPLACED THIS ASSERTION — recorded per
    // PROJECT_CONSTITUTION.md §4 rather than done silently. It read "supplies
    // exactly two figures that rest on no cited source" and pinned
    // `["cess", "itr_form_income_ceiling"]`.
    //
    // Both are now CITED — `cess_rate` to Finance Act, 2026 s.2(6) and
    // `itr1_income_ceiling` to Income-tax Rules, 1962 rule 12(1)(a) — so the
    // set is empty, and `K4-PORT-02`'s own instruction for closing them ("a
    // session that cites one of them removes it from this list") is what
    // happened. Neither figure's VALUE moved; the statute confirmed both.
    //
    // The assertion is now STRICTER than the one it replaces: any supplied
    // figure resting on no cited source fails here, so a future gap of this
    // shape cannot be introduced silently — it must first weaken this test.
    expect(uncitedAvailableParameterIds(AY_2026_27_RATE_PARAMETERS)).toEqual([]);
    for (const id of RATE_PARAMETER_IDS) {
      const parameter = rateParameter(AY_2026_27_RATE_PARAMETERS, id);
      if (parameter.state !== "available") continue;
      expect(parameter.sourceIds.length, `${id} must cite a source`).toBeGreaterThan(0);
    }
  });
});

describe("capability is DERIVED, so a world cannot claim what it cannot source", () => {
  it("withholding one parameter unservices exactly the entry points needing it", () => {
    // Withhold ONLY the return-form ceiling: the form recommendation dies, the
    // three computation entry points survive. A per-world on/off switch could
    // not express this, which is why capability is resolved per entry point.
    // This direction is UNAFFECTED by `K4-PORT-03`'s correction to
    // `recommendItrForm`'s requirement row — the ceiling was always in it —
    // which is why this case still reads exactly as it did.
    const parameters: StatutoryRateParameters = {
      ...AY_2026_27_RATE_PARAMETERS,
      itrFormIncomeCeiling: {
        state: "withheld",
        packRuleIds: ["itr1_income_ceiling"],
        reason: "synthetic test withholding",
      },
    };
    const capability = resolveEngineCapability(parameters);
    expect(capability.complete).toBe(false);
    expect([...capability.servableEntryPoints].sort()).toEqual([
      "compareRegimes",
      "computeTax",
      "validateCase",
    ]);
    expect(capability.withheld.map((w) => w.id)).toEqual(["itr_form_income_ceiling"]);
    const unservable = capability.entryPoints.find((e) => e.entryPoint === "recommendItrForm")!;
    expect(unservable.servable).toBe(false);
    expect(unservable.withheld.map((w) => w.id)).toEqual(["itr_form_income_ceiling"]);
  });

  /**
   * **A DELIBERATELY REPLACED ASSERTION — recorded, not done silently**
   * (`PROJECT_CONSTITUTION.md` §4; `D298`/`D299` are the precedents).
   *
   * This test used to assert `servableEntryPoints` was `["recommendItrForm"]`
   * when cess is withheld. It is now the empty array, and the change is a
   * CORRECTION rather than a regression: `recommendItrForm` calls `computeTax`
   * for the total income its ceiling test compares against, so a world with no
   * cess rate cannot serve it either. The old expectation was the visible
   * consequence of `ENTRY_POINT_REQUIREMENTS`' wrong row, and it passed for
   * exactly as long as nothing asked the function to run.
   *
   * **No shipped world changes**: the AY pack supplies all six, and the TY pack
   * withholds the ceiling too, so its `recommendItrForm` was unservable before
   * and is unservable now. Nothing computed differently either way.
   */
  it("withholding cess alone kills EVERY entry point, because all four reach the computation", () => {
    const parameters: StatutoryRateParameters = {
      ...AY_2026_27_RATE_PARAMETERS,
      cess: { state: "withheld", packRuleIds: ["cess_rate"], reason: "synthetic test withholding" },
    };
    const capability = resolveEngineCapability(parameters);
    expect(capability.servableEntryPoints).toEqual([]);
    expect(capability.complete).toBe(false);
    // And the reason is attributed to cess on every one of them, rather than
    // the entry points merely going dark.
    for (const entry of capability.entryPoints) {
      expect(entry.servable).toBe(false);
      expect(entry.withheld.map((w) => w.id)).toEqual(["cess"]);
    }
  });

  /**
   * **A DELIBERATELY REPLACED ASSERTION — recorded, not done silently**
   * (`PROJECT_CONSTITUTION.md` §4).
   *
   * This test drove `describeWithheldParameters` with the TY 2026-27 world,
   * which was the only shipped world that withheld anything. `K4-PORT-04`
   * (`D314`) declares all six of its parameters, so that world now describes
   * NOTHING as withheld and the assertion is false by design.
   *
   * The behaviour it covered — declaration order, and a reason per parameter —
   * is real and is still covered, driven by a SYNTHETIC set constructed to
   * withhold two parameters out of order. That is strictly better coverage than
   * it had: the old case exercised one arrangement that happened to ship, while
   * this one picks an order that `RATE_PARAMETER_IDS` would have to re-sort, so
   * a resolver returning encounter order rather than declaration order fails.
   * The shipped-world direction is kept alongside it as a regression pin.
   */
  it("reports withheld parameters in declaration order, with reasons", () => {
    const parameters: StatutoryRateParameters = {
      ...AY_2026_27_RATE_PARAMETERS,
      // Withheld in the REVERSE of declaration order, so encounter order and
      // declaration order genuinely differ.
      itrFormIncomeCeiling: {
        state: "withheld",
        packRuleIds: ["itr1_income_ceiling"],
        reason: "synthetic test withholding — the return-form ceiling",
      },
      newRegimeSlabs: {
        state: "withheld",
        packRuleIds: ["slab_rates"],
        reason: "synthetic test withholding — the new-regime table",
      },
    };
    const capability = resolveEngineCapability(parameters);
    const described = describeWithheldParameters(capability);
    expect(described).not.toBeNull();
    expect(described).toContain("withholds 2 statutory rate parameter(s)");
    // Declaration order, so the message is stable between runs.
    const order = capability.withheld.map((w) => w.id);
    expect(order).toEqual(["new_regime_slabs", "itr_form_income_ceiling"]);
    expect(order).toEqual(RATE_PARAMETER_IDS.filter((id) => order.includes(id)));
    for (const withheld of capability.withheld) {
      expect(withheld.reason).toContain("synthetic test withholding");
      expect(withheld.packRuleIds.length).toBeGreaterThan(0);
    }
  });

  it("describes NOTHING as withheld for either shipped world", () => {
    // Both worlds now supply all six. This is the regression pin for `D314`:
    // if a shipped world starts withholding again, that is a real change in what
    // this repository can source and it must be a deliberate one.
    for (const [label, parameters] of [
      ["AY 2026-27", AY_2026_27_RATE_PARAMETERS],
      ["TY 2026-27", TY_2026_27_RATE_PARAMETERS],
    ] as const) {
      const capability = resolveEngineCapability(parameters);
      expect(capability.withheld, `${label} must withhold nothing`).toEqual([]);
      expect(capability.complete, `${label} must be complete`).toBe(true);
      expect(describeWithheldParameters(capability)).toBeNull();
    }
  });
});

describe("the builders refuse to state an authority the pack does not have", () => {
  const P = AY_2026_27_PACK_PROVENANCE;
  const UNCITED_P = makeTaxPackProvenance([
    makeRuleProvenance({ ruleId: "synthetic_uncited", summary: "test-only uncited rule" }),
  ]);

  it("throws on a pack rule id the provenance does not declare", () => {
    expect(() => availableFrom(P, "cess", ["no_such_rule"], 0.04)).toThrow(
      /declares no rule "no_such_rule"/,
    );
    expect(() => withheldBecause(P, "cess", ["no_such_rule"], "because")).toThrow(
      /declares no rule "no_such_rule"/,
    );
  });

  it("throws when no pack rule is named at all", () => {
    expect(() => availableFrom(P, "cess", [], 0.04)).toThrow(/at least one pack rule id/);
  });

  it("refuses to supply an uncited figure without the explicit exception", () => {
    // MAINT-09 closed the shipped pack's last two uncited rules. The builder
    // invariant still needs a negative control, so it now uses a synthetic
    // provenance entry rather than preserving a production source gap for the
    // sake of a test fixture.
    expect(() => availableFrom(UNCITED_P, "cess", ["synthetic_uncited"], 0.04)).toThrow(
      /cite no official source.*allowUncited/s,
    );
    expect(availableFrom(UNCITED_P, "cess", ["synthetic_uncited"], 0.04, { allowUncited: true }).state).toBe(
      "available",
    );
  });

  it("refuses a STALE allowUncited on a figure whose rule is now cited", () => {
    // `K4-SOURCE-02`. The mirror of the check above, and the reason it exists:
    // this session retired two `allowUncited` flags when their rules gained
    // citations, and nothing would have caught either had it been left behind.
    // A stale exception is a false statement in code — it reads "this figure
    // rests on no source" about a figure that now cites one.
    expect(() =>
      availableFrom(P, "cess", ["cess_rate"], 0.04, { allowUncited: true }),
    ).toThrow(/DO cite an official source.*allowUncited exception is stale/s);
    // Without the stale flag, the same call is fine.
    expect(availableFrom(P, "cess", ["cess_rate"], 0.04).state).toBe("available");
  });

  it("refuses to withhold a SOURCED figure without the explicit exception", () => {
    // Withholding something the pack does cite would misreport the world as
    // emptier than it is — safe-looking, and therefore the harder error to spot.
    expect(() => withheldBecause(P, "new_regime_slabs", ["slab_rates"], "because")).toThrow(
      /DO cite an official source.*allowSourcedRules/s,
    );
    expect(
      withheldBecause(P, "new_regime_slabs", ["slab_rates"], "because", {
        allowSourcedRules: true,
      }).state,
    ).toBe("withheld");
  });

  it("refuses a withheld parameter with no reason", () => {
    // Use the test-only uncited rule so the sourced-rule guard does not mask the
    // missing-reason check this case exists for.
    expect(() => withheldBecause(UNCITED_P, "cess", ["synthetic_uncited"], "   ")).toThrow(
      /must state a reason/,
    );
  });

  it("reads source ids out of the pack's provenance rather than restating them", () => {
    const parameter = availableFrom(P, "rebate", ["rebate_87a"], REBATE_87A);
    if (parameter.state !== "available") throw new Error("must be available");
    const rule = P.rules.find((r) => r.ruleId === "rebate_87a")!;
    expect(parameter.sourceIds).toEqual(rule.sources.map((s) => s.id));
    expect(parameter.sourceIds.length).toBeGreaterThan(0);
  });
});
