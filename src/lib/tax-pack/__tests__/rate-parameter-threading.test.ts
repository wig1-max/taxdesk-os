/**
 * `K4-PORT-03` — THE JOIN BETWEEN THE DECLARED BOUNDARY AND THE RUNNING
 * ARITHMETIC (decision `D299`).
 *
 * `K4-PORT-02` shipped the parameter boundary and `K4-PORT-03` made the
 * arithmetic read it. Between those two facts sits a claim that nothing else
 * checks: that the figures the pack DECLARES are the figures the engine
 * COMPUTES WITH. Without this file that claim rests on two modules happening to
 * import the same constants — and "happens to" is precisely the kind of
 * coupling that survives until someone edits one of them.
 *
 * So every assertion below is `toBe`, not `toEqual`. A structural copy would
 * satisfy `toEqual` and then drift silently the first time a rate moved;
 * reference identity is the only assertion that makes drift impossible (`D6`).
 *
 * WHAT THIS DOES NOT PROVE. It proves the two SIDES agree, never that either is
 * right in tax law. No pack is CA-verified and nothing here moves one toward it.
 *
 * **THE LAST SENTENCE OF THIS HEADER USED TO SAY IT SAYS NOTHING ABOUT THE TY
 * 2026-27 WORLD'S FIGURES, "because that world withholds five of six parameters
 * and therefore has none to check". `K4-PORT-04` (`D314`) declared all six**, so
 * that world now has figures and they ARE checked below — with the opposite
 * assertion, `not.toBe`. The AY side wants reference IDENTITY (one object, no
 * drift between declaration and arithmetic); the two WORLDS want reference
 * SEPARATENESS (two enactments that happen to agree today must not share an
 * object that a future Finance Act could move for one of them only). Corrected
 * forward, not rewritten (`PROJECT_CONSTITUTION.md` §4).
 */

import { describe, expect, it } from "vitest";
import {
  AY_2026_27_COMPUTATION_FIGURES,
  AY_2026_27_ITR_FORM_FIGURES,
} from "@/lib/tax-engine/ay-2026-27/rate-figures";
import {
  CESS_RATE,
  ITR1_INCOME_CEILING,
  REBATE_87A,
  SURCHARGE,
} from "@/lib/tax-engine/ay-2026-27/rules";
import {
  AY_2026_27_OLD_REGIME_SLAB_TABLES,
  NEW_REGIME_SLABS,
  OLD_REGIME_SENIOR_SLABS,
  OLD_REGIME_SLABS,
  OLD_REGIME_SUPER_SENIOR_SLABS,
} from "@/lib/tax-engine/ay-2026-27/slabs";
import {
  RATE_PARAMETER_IDS,
  resolveComputationRateFigures,
  resolveItrFormRateFigures,
} from "@/lib/tax-engine/core/statutory-rate-parameters";
import type { StatutoryRateParameters } from "@/lib/tax-engine/core/statutory-rate-parameters";
import { createDefaultTaxPackRegistry } from "../registry-default";
import { taxPackComputation, taxPackRateParameters, type TaxPack } from "../pack";
import { taxPackKey } from "../identity";
import { AY_2026_27_RATE_PARAMETERS } from "../packs/ay-2026-27-rate-parameters";
import { TY_2026_27_RATE_PARAMETERS } from "../packs/ty-2026-27-rate-parameters";
import { TY_2026_27_STUB_PACK } from "../packs/ty-2026-27";

describe("the AY pack's declared parameters ARE the engine's computation figures", () => {
  it("resolves to the engine's own objects, member by member, by reference", () => {
    const resolved = resolveComputationRateFigures(AY_2026_27_RATE_PARAMETERS);
    if (resolved.state !== "resolved") {
      throw new Error("the AY world supplies all six parameters and must resolve");
    }
    const figures = resolved.figures;

    expect(figures.newRegimeSlabs).toBe(NEW_REGIME_SLABS);
    expect(figures.oldRegimeSlabs).toBe(AY_2026_27_OLD_REGIME_SLAB_TABLES);
    expect(figures.oldRegimeSlabs.below60).toBe(OLD_REGIME_SLABS);
    expect(figures.oldRegimeSlabs.senior).toBe(OLD_REGIME_SENIOR_SLABS);
    expect(figures.oldRegimeSlabs.superSenior).toBe(OLD_REGIME_SUPER_SENIOR_SLABS);
    expect(figures.surcharge).toBe(SURCHARGE);
    expect(figures.cess).toBe(CESS_RATE);
    expect(figures.rebate).toBe(REBATE_87A);
  });

  /**
   * THE LOAD-BEARING ONE. The engine's public entry points default to
   * `AY_2026_27_COMPUTATION_FIGURES`; the pack declares
   * `AY_2026_27_RATE_PARAMETERS`. If those two ever stop being the same
   * objects, the pack would be describing a computation the engine is not
   * performing — the exact failure the whole parameter boundary exists to make
   * impossible, and one that would otherwise be invisible because both sides
   * would keep working.
   */
  it("is the SAME object set the engine defaults to when no figures are supplied", () => {
    const resolved = resolveComputationRateFigures(AY_2026_27_RATE_PARAMETERS);
    if (resolved.state !== "resolved") throw new Error("must resolve");
    const packSide = resolved.figures;
    const engineSide = AY_2026_27_COMPUTATION_FIGURES;

    expect(Object.keys(packSide).sort()).toEqual(Object.keys(engineSide).sort());
    expect(packSide.newRegimeSlabs).toBe(engineSide.newRegimeSlabs);
    expect(packSide.oldRegimeSlabs).toBe(engineSide.oldRegimeSlabs);
    expect(packSide.surcharge).toBe(engineSide.surcharge);
    expect(packSide.cess).toBe(engineSide.cess);
    expect(packSide.rebate).toBe(engineSide.rebate);
  });

  it("resolves the ITR-form set as a strict superset carrying the same ceiling", () => {
    const resolved = resolveItrFormRateFigures(AY_2026_27_RATE_PARAMETERS);
    if (resolved.state !== "resolved") throw new Error("must resolve");
    expect(resolved.figures.itrFormIncomeCeiling).toBe(ITR1_INCOME_CEILING);
    expect(resolved.figures.itrFormIncomeCeiling).toBe(
      AY_2026_27_ITR_FORM_FIGURES.itrFormIncomeCeiling,
    );
    // The computation half is the same set, not a parallel one.
    expect(resolved.figures.surcharge).toBe(AY_2026_27_COMPUTATION_FIGURES.surcharge);
    expect(resolved.figures.rebate).toBe(AY_2026_27_COMPUTATION_FIGURES.rebate);
  });

  /**
   * The surcharge schedule now has to carry `specialRateSurchargeRateCap`,
   * because `surcharge.ts` reads it from the SUPPLIED schedule to refuse a case
   * whose band rate would exceed the 15% cap on dividend / 111A / 112 / 112A
   * income. A world supplying a schedule without it would lose that refusal
   * rather than fail loudly, so the field's presence is asserted here rather
   * than left to the type.
   */
  it("supplies the special-rate surcharge cap the refusal path depends on", () => {
    const resolved = resolveComputationRateFigures(AY_2026_27_RATE_PARAMETERS);
    if (resolved.state !== "resolved") throw new Error("must resolve");
    expect(typeof resolved.figures.surcharge.specialRateSurchargeRateCap).toBe("number");
    expect(resolved.figures.surcharge.specialRateSurchargeRateCap).toBe(
      SURCHARGE.specialRateSurchargeRateCap,
    );
  });
});

describe("a world that withholds refuses to yield figures at all", () => {
  /**
   * **TWO DELIBERATELY REPLACED ASSERTIONS — recorded, never done silently**
   * (`PROJECT_CONSTITUTION.md` §4; `D298`/`D299`/`D310` are the precedents).
   *
   * These two tests asserted that the TY 2026-27 world yields `"withheld"` from
   * both resolvers, naming `new_regime_slabs` / `old_regime_slabs` / `surcharge`
   * / `cess` and the ITR-form ceiling. `K4-PORT-04` (`D314`) declares all six
   * parameters from the Finance Act, 2026 and ITA 2025 s.202(1), so both
   * resolvers now RESOLVE and those expectations are false by design.
   *
   * **What they were actually protecting is the all-or-nothing property, and it
   * is untouched** — proved below by the synthetic single-withholding loop and by
   * `resolveEngineCapability`'s own tests, which drive the withheld branch with
   * every one of the six in turn. The branch is not less covered; it is covered
   * by a case constructed to exercise it rather than by a shipped world that
   * happened to be empty.
   *
   * The tests are rewritten to assert what is now the load-bearing thing: this
   * world resolves its own figures, those figures are its OWN objects, and
   * resolving them still does not let anything compute.
   */
  it("now resolves the TY 2026-27 world's OWN computation figures", () => {
    const resolved = resolveComputationRateFigures(TY_2026_27_RATE_PARAMETERS);
    expect(resolved.state).toBe("resolved");
    if (resolved.state !== "resolved") throw new Error("unreachable");

    // Every figure is this world's own object, never the 1961-Act engine's.
    // `not.toBe` is the assertion that matters: the VALUES coincide for tax year
    // 2026-27 and a future Finance Act can move one half without the other, so
    // sharing an object would carry that move into the wrong world in silence.
    expect(resolved.figures.newRegimeSlabs).not.toBe(NEW_REGIME_SLABS);
    expect(resolved.figures.surcharge).not.toBe(SURCHARGE);
    expect(resolved.figures.rebate).not.toBe(REBATE_87A);
    expect(resolved.figures.newRegimeSlabs).toEqual(NEW_REGIME_SLABS);

    // …and it shares nothing with the AY world's resolved set either.
    const ay = resolveComputationRateFigures(AY_2026_27_RATE_PARAMETERS);
    if (ay.state !== "resolved") throw new Error("AY must resolve");
    for (const key of ["newRegimeSlabs", "oldRegimeSlabs", "surcharge", "rebate"] as const) {
      expect(resolved.figures[key], `${key} must not be the AY object`).not.toBe(ay.figures[key]);
    }
  });

  it("resolves the ITR-form set too, and STILL cannot compute anything", () => {
    const resolved = resolveItrFormRateFigures(TY_2026_27_RATE_PARAMETERS);
    expect(resolved.state).toBe("resolved");
    if (resolved.state !== "resolved") throw new Error("unreachable");
    expect(resolved.figures.itrFormIncomeCeiling).toBe(50_00_000);

    // THE LINE THAT KEEPS THIS HONEST. Sourcing every rate figure is not the
    // same as having an arithmetic wired to them: the TY pack's binding carries
    // no `computation` surface, so nothing can obtain one. If a later session
    // attaches one, THIS is the assertion it has to come and change on purpose.
    expect(taxPackComputation(TY_2026_27_STUB_PACK)).toBeUndefined();
  });

  /**
   * ALL-OR-NOTHING, PROVED. Withholding any ONE member of the computation set
   * must yield nothing rather than a partial set — a caller handed four of five
   * figures would destructure the fifth as `undefined` and compute with it.
   */
  it("yields NOTHING when any single computation parameter is withheld", () => {
    for (const id of ["new_regime_slabs", "old_regime_slabs", "surcharge", "cess", "rebate"] as const) {
      const field = {
        new_regime_slabs: "newRegimeSlabs",
        old_regime_slabs: "oldRegimeSlabs",
        surcharge: "surcharge",
        cess: "cess",
        rebate: "rebate",
      }[id];
      const parameters = {
        ...AY_2026_27_RATE_PARAMETERS,
        [field]: { state: "withheld", packRuleIds: [id], reason: "synthetic test withholding" },
      } as unknown as StatutoryRateParameters;
      const resolved = resolveComputationRateFigures(parameters);
      expect(resolved.state, `withholding ${id} must yield no figures`).toBe("withheld");
    }
  });

  /**
   * **THE TRAP A DEFAULTED ARGUMENT CREATES, CLOSED.**
   *
   * `computeTax` / `compareRegimes` / `recommendItrForm` / `validateCase` take
   * their figures as an OPTIONAL trailing argument defaulting to the AY world's
   * set, because `TaxPackComputation` declares one-argument signatures and the
   * pack binds those functions BY REFERENCE (`K3-11`). A caller routed through
   * a pack therefore CANNOT supply figures — so if a second statutory world
   * ever bound these same four functions without slice 3 first changing the
   * binding shape, it would compute a 2025-Act return at 1961-Act rates, in
   * silence, with every existing guard green.
   *
   * That is the worst accident this architecture could permit, and it is a
   * FUTURE one, so it is guarded now rather than left as a note for the session
   * that would trip it: any registered pack carrying an executable surface must
   * declare rate parameters that resolve to exactly the objects those functions
   * default to.
   */
  it("no registered pack can bind the shared functions while supplying different figures", () => {
    const registry = createDefaultTaxPackRegistry();
    const computable = registry
      .list()
      .filter((pack: TaxPack) => taxPackComputation(pack) !== undefined);
    // Not vacuous — exactly one world computes today, and if that ever becomes
    // zero this test would otherwise pass by checking nothing.
    expect(computable.length).toBeGreaterThan(0);

    for (const pack of computable) {
      const parameters = taxPackRateParameters(pack);
      expect(parameters, `${taxPackKey(pack.identity)} binds a computation but declares no parameters`)
        .toBeDefined();
      const resolved = resolveComputationRateFigures(parameters as StatutoryRateParameters);
      expect(resolved.state, `${taxPackKey(pack.identity)} binds a computation it cannot supply`).toBe(
        "resolved",
      );
      if (resolved.state !== "resolved") continue;
      // The defaulted figures the bound functions would actually use.
      expect(resolved.figures.newRegimeSlabs).toBe(AY_2026_27_COMPUTATION_FIGURES.newRegimeSlabs);
      expect(resolved.figures.oldRegimeSlabs).toBe(AY_2026_27_COMPUTATION_FIGURES.oldRegimeSlabs);
      expect(resolved.figures.surcharge).toBe(AY_2026_27_COMPUTATION_FIGURES.surcharge);
      expect(resolved.figures.cess).toBe(AY_2026_27_COMPUTATION_FIGURES.cess);
      expect(resolved.figures.rebate).toBe(AY_2026_27_COMPUTATION_FIGURES.rebate);
    }
  });

  it("covers every declared rate parameter between the two resolvers", () => {
    // No parameter may be declared and then reachable by neither resolver — it
    // would be a figure the boundary carries and the arithmetic can never see.
    const covered = new Set([
      ...["new_regime_slabs", "old_regime_slabs", "surcharge", "cess", "rebate"],
      "itr_form_income_ceiling",
    ]);
    expect([...covered].sort()).toEqual([...RATE_PARAMETER_IDS].sort());
  });
});
