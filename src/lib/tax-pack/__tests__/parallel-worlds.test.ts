import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RULES_VERSION,
  PRE_K4_17_RULES_VERSION,
  ASSESSMENT_YEAR,
} from "@/lib/tax-engine/ay-2026-27/rules";
import { AY_2026_27_PACK, AY_2026_27_PACK_IDENTITY } from "@/lib/tax-pack/packs/ay-2026-27";
import { AY_2026_27_PACK_PROVENANCE } from "@/lib/tax-pack/packs/ay-2026-27-provenance";
import { AY_2026_27_V0_PACK } from "@/lib/tax-pack/packs/ay-2026-27-v0";
import {
  TY_2026_27_PACK_IDENTITY,
  TY_2026_27_PERIOD,
  TY_2026_27_RULES_VERSION,
  TY_2026_27_STUB_PACK,
} from "@/lib/tax-pack/packs/ty-2026-27";
import { TY_2026_27_PACK_PROVENANCE } from "@/lib/tax-pack/packs/ty-2026-27-provenance";
import {
  makeRuleVerificationRecord,
  verifyTaxPackWithEvidence,
} from "@/lib/tax-pack/verification";
import { createDefaultTaxPackRegistry } from "@/lib/tax-pack/registry-default";
import { createTaxPackRegistry } from "@/lib/tax-pack/registry";
import { resolveTaxPack, resolveTaxPackForReliance } from "@/lib/tax-pack/resolver";
import {
  bindDefaultTaxPackToCase,
  bindTaxPackToCase,
  periodKindForLaw,
  taxCasePackSelector,
} from "@/lib/tax-pack/case-pack";
import {
  makeTaxPack,
  taxPackComputation,
  taxPackRateParameters,
  type TaxPack,
} from "@/lib/tax-pack/pack";
import {
  ENGINE_ENTRY_POINTS,
  RATE_PARAMETER_IDS,
  describeWithheldParameters,
  rateParameter,
  resolveEngineCapability,
} from "@/lib/tax-engine/core/statutory-rate-parameters";
import { uncitedAvailableParameterIds } from "@/lib/tax-pack/packs/rate-parameters";
import {
  CESS_RATE,
  ITR1_INCOME_CEILING,
  REBATE_87A,
} from "@/lib/tax-engine/ay-2026-27/rules";
import { SURCHARGE } from "@/lib/tax-engine/ay-2026-27/rules";
import {
  AY_2026_27_OLD_REGIME_SLAB_TABLES,
  NEW_REGIME_SLABS,
  OLD_REGIME_SENIOR_SLABS,
  OLD_REGIME_SLABS,
  OLD_REGIME_SUPER_SENIOR_SLABS,
} from "@/lib/tax-engine/ay-2026-27/slabs";
import { TAX_LAWS, taxPackKey } from "@/lib/tax-pack/identity";
import {
  TAX_PACK_BLOCKER_CODES,
  defaultTaxPackRelianceBlocker,
  describeTaxPackVerification,
} from "@/lib/tax-pack/verification-state";
import { isRelianceReady } from "@/lib/tax-pack/lifecycle";
import {
  TAX_CAPABILITY_MATRIX,
  findTaxCapability,
  ruleAuthorityFor,
} from "@/lib/tax-desk/tax-capability";
/**
 * K3-15 — PARALLEL STATUTORY WORLDS.
 *
 * The default registry now holds historical/current AY 2026-27 packs (Income-
 * tax Act, 1961 / assessment years) and an identity-only TY 2026-27 stub
 * (Income-tax Act, 2025 / tax years / SAHAJ (ITR-1) under Income-tax Rules,
 * 2026 rule 164 — this line read "Form 168" until `D301`). These tests prove:
 *   1. the stub implements nothing and cannot compute;
 *   2. each world resolves deterministically to exactly one pack, with no leak
 *      in either direction and no ambiguity introduced;
 *   3. a case reaching the stub fails safe through the EXISTING refusal paths;
 *   4. the AY pack's canonical key, versions and binding are untouched.
 */

const AY_SELECTOR = {
  law: "ITA_1961",
  periodKind: "assessment_year",
  period: ASSESSMENT_YEAR,
} as const;

const CURRENT_AY_SELECTOR = {
  ...AY_SELECTOR,
  computationRulesVersion: RULES_VERSION,
} as const;

const TY_SELECTOR = {
  law: "ITA_2025",
  periodKind: "tax_year",
  period: TY_2026_27_PERIOD,
} as const;

describe("TY 2026-27 stub is an explicit, non-computing identity", () => {
  it("carries the 2025-Act coordinates in the tax-year counting model", () => {
    expect(TY_2026_27_PACK_IDENTITY.jurisdiction).toBe("IN");
    expect(TY_2026_27_PACK_IDENTITY.law).toBe("ITA_2025");
    expect(TY_2026_27_PACK_IDENTITY.periodKind).toBe("tax_year");
    expect(TY_2026_27_PACK_IDENTITY.period).toBe(TY_2026_27_PERIOD);
    expect(taxPackKey(TY_2026_27_PACK_IDENTITY)).toBe(
      `IN:ITA_2025:tax_year:${TY_2026_27_PERIOD}:${TY_2026_27_RULES_VERSION}`,
    );
  });

  it("is truthfully draft with no fabricated CA verification", () => {
    expect(TY_2026_27_PACK_IDENTITY.status).toBe("draft");
    expect(TY_2026_27_PACK_IDENTITY.verifiedBy).toBeNull();
    expect(TY_2026_27_PACK_IDENTITY.verifiedAt).toBeNull();
    expect(isRelianceReady(TY_2026_27_PACK_IDENTITY)).toBe(false);
  });

  // D299 — DELIBERATE REPLACEMENT of a pre-existing assertion, recorded rather
  // than done silently (PROJECT_CONSTITUTION.md §4). This test previously
  // asserted `binding` was `undefined`, absent from `Object.keys`, and `false`
  // under `"binding" in pack`. K4-PORT-02 gives the pack a binding that
  // declares its statutory rate parameters and serves NO computation, so those
  // three assertions are now false BY DESIGN.
  //
  // What they were actually protecting — that no caller can obtain a
  // computation surface for the 2025 world — is preserved and STRENGTHENED
  // below: the surface is still absent, and its absence is now DERIVED from
  // what this world can source rather than from an authoring choice.
  //
  // The load-bearing consequence, stated once here because it changes how
  // every future guard must be written: `"binding" in pack` is NO LONGER a
  // test for "can this pack compute?". `taxPackComputation(pack)` is.
  it("carries a binding that serves NO computation — the pack still cannot compute anything", () => {
    expect(TY_2026_27_STUB_PACK.binding).toBeDefined();
    expect(Object.keys(TY_2026_27_STUB_PACK)).toEqual(["identity", "binding", "provenance"]);
    expect("binding" in TY_2026_27_STUB_PACK).toBe(true);

    // …and every one of those is compatible with computing nothing:
    expect(taxPackComputation(TY_2026_27_STUB_PACK)).toBeUndefined();
    expect("computation" in TY_2026_27_STUB_PACK.binding!).toBe(false);
    expect(TY_2026_27_STUB_PACK.binding!.boundEngineId).toBe("tax-engine/core");
  });

  /**
   * **THE BIGGEST DELIBERATELY REPLACED ASSERTION IN THIS FILE — recorded, never
   * done silently** (`PROJECT_CONSTITUTION.md` §4; `D298`/`D299`/`D310` set the
   * precedent, and this is the fourth time this describe block has moved).
   *
   * This test asserted `servableEntryPoints` was `[]`, `complete` was `false`,
   * and five named parameters were withheld. `K4-PORT-04` (`D314`) declares all
   * six from this world's own sources — ITA 2025 s.202(1) read with Finance Act,
   * 2026 s.3(3), First Schedule Part I-B for the slab families, the surcharge
   * and its marginal relief, s.3(15) for the cess and Income-tax Rules, 2026
   * rule 164(3)(k) for the return-form ceiling — so all four entry points are
   * servable and every one of those expectations is false BY DESIGN.
   *
   * **WHAT THOSE ASSERTIONS WERE PROTECTING IS NOT WEAKENED, AND THIS IS THE
   * PART TO READ.** They were never protecting "zero entry points" for its own
   * sake; they were protecting *no caller can obtain a computation surface for
   * the 2025 world*. That property is preserved and re-asserted here, and its
   * basis has MOVED rather than gone:
   *
   *   - BEFORE: the surface was absent because the world could not source rates.
   *   - NOW:    the world can source every rate and there is still no surface,
   *             because none has been wired — `"computation" in binding` is
   *             `false` and `taxPackComputation` returns `undefined`.
   *
   * That is a genuinely weaker structural guarantee than the one it replaces,
   * and saying so is the point: a missing rate was impossible to overlook,
   * whereas a missing binding key is one edit away. So the assertion below is
   * written as the thing a future session must come and change ON PURPOSE, and
   * `capability.complete === true` is asserted alongside it so nobody can read
   * this test as still claiming the old, stronger property.
   */
  it("now sources ALL SIX rate parameters — and still serves no computation", () => {
    const parameters = taxPackRateParameters(TY_2026_27_STUB_PACK);
    expect(parameters).toBeDefined();
    const capability = resolveEngineCapability(parameters!);

    // Every parameter is available, so nothing is withheld and every entry point
    // is servable. Pinned in both directions.
    expect(capability.withheld).toEqual([]);
    expect(capability.complete).toBe(true);
    expect([...capability.servableEntryPoints].sort()).toEqual([...ENGINE_ENTRY_POINTS].sort());
    for (const entryPoint of capability.entryPoints) {
      expect(entryPoint.servable, `${entryPoint.entryPoint} must be servable`).toBe(true);
      expect(entryPoint.withheld).toEqual([]);
    }
    for (const id of RATE_PARAMETER_IDS) {
      expect(rateParameter(parameters!, id).state, `${id} must be available`).toBe("available");
    }

    // THE LOAD-BEARING HALF, and the reason this test still belongs in a file
    // about the two worlds not leaking into each other. A complete capability is
    // a PRECONDITION for binding an executable surface, never the binding
    // itself. The 2025 world has the precondition and not the surface.
    expect(taxPackComputation(TY_2026_27_STUB_PACK)).toBeUndefined();
    expect("computation" in TY_2026_27_STUB_PACK.binding!).toBe(false);
  });

  it("every supplied parameter cites a real source, and none is uncited", () => {
    // `availableFrom` REFUSES an uncited figure without an explicit
    // `allowUncited` exception, so this could only fail if a future session
    // reached for that exception. The AY world needed it twice and both uses
    // were retired by citing (`K4-SOURCE-02`); this world never needed it, and
    // asserting the empty set is what keeps that true.
    const parameters = taxPackRateParameters(TY_2026_27_STUB_PACK)!;
    expect(uncitedAvailableParameterIds(parameters)).toEqual([]);
    for (const id of RATE_PARAMETER_IDS) {
      const parameter = rateParameter(parameters, id);
      if (parameter.state !== "available") continue;
      expect(parameter.sourceIds.length, `${id} must cite a source`).toBeGreaterThan(0);
      // And every pack rule it names must actually exist in this pack's
      // provenance — the builders throw on an unknown id, so this is belt and
      // braces for the case where the throw is ever softened.
      for (const ruleId of parameter.packRuleIds) {
        expect(
          TY_2026_27_PACK_PROVENANCE.rules.some((r) => r.ruleId === ruleId),
          `${id} names unknown pack rule ${ruleId}`,
        ).toBe(true);
      }
    }
  });

  it("borrows NO rate figure from the 1961-Act engine", () => {
    // The failure mode this exists to prevent, UNCHANGED IN SUBSTANCE AND NOW
    // THE ONLY THING STANDING BETWEEN THE TWO WORLDS' FIGURES: "unblocking" the
    // 2025 world by copying the 1961-Act engine's constants across. They are the
    // Finance Act 2025's figures for a different Act and a different year, and
    // copying one would be a fabrication wearing the shape of a port.
    //
    // **THE VALUES LARGELY COINCIDE FOR TAX YEAR 2026-27, AND THE COINCIDENCE IS
    // THE TRAP.** Two enactments agreeing today is not one enactment shared: a
    // future Finance Act can move Part I-B without moving Part I-A, and an
    // imported constant would carry that move into the wrong world in silence
    // with every other guard green. So both halves are asserted — the values are
    // equal (`toEqual`) and the objects are distinct (`not.toBe`).
    const parameters = taxPackRateParameters(TY_2026_27_STUB_PACK)!;

    const pairs = [
      ["newRegimeSlabs", NEW_REGIME_SLABS],
      ["surcharge", SURCHARGE],
      ["cess", CESS_RATE],
      ["rebate", REBATE_87A],
      ["itrFormIncomeCeiling", ITR1_INCOME_CEILING],
    ] as const;
    for (const [field, ayConstant] of pairs) {
      const parameter = parameters[field];
      if (parameter.state !== "available") throw new Error(`${field} must be available`);
      expect(parameter.value, `${field} must equal the 1961-Act figure for this year`).toEqual(
        ayConstant,
      );
      // Numbers cannot be distinct objects, so identity is only meaningful for
      // the two structural figures — asserted where it means something rather
      // than asserted uniformly and vacuously for `cess` and the ceiling.
      if (typeof ayConstant === "object") {
        expect(parameter.value, `${field} must NOT be the 1961-Act object`).not.toBe(ayConstant);
      }
    }

    // The old-regime FAMILY, member by member. `K4-PORT-03` moved the AY
    // family's wrapper into `slabs.ts` so the pack and the arithmetic share one
    // object; this world must share neither the wrapper nor any table inside it.
    const old = parameters.oldRegimeSlabs;
    if (old.state !== "available") throw new Error("oldRegimeSlabs must be available");
    expect(old.value).not.toBe(AY_2026_27_OLD_REGIME_SLAB_TABLES);
    expect(old.value.below60).not.toBe(OLD_REGIME_SLABS);
    expect(old.value.senior).not.toBe(OLD_REGIME_SENIOR_SLABS);
    expect(old.value.superSenior).not.toBe(OLD_REGIME_SUPER_SENIOR_SLABS);
    expect(old.value.below60).toEqual(OLD_REGIME_SLABS);
    expect(old.value.senior).toEqual(OLD_REGIME_SENIOR_SLABS);
    expect(old.value.superSenior).toEqual(OLD_REGIME_SUPER_SENIOR_SLABS);
  });

  it("reads its slab boundaries from the 2025-Act text, not from the 1961 table's shape", () => {
    // A NEGATIVE CONTROL for the test above, and the reason it is needed: every
    // assertion up there would still pass if this world's tables had been
    // produced by structurally copying the AY ones — `toEqual` plus `not.toBe`
    // catches a shared reference, never a retyped copy. What distinguishes a
    // reading of s.202(1) and Part I-B from a copy of `slabs.ts` is that the
    // FIGURES are the ones the statute prints, so they are pinned here against
    // the provisions rather than against the sibling world.
    const parameters = taxPackRateParameters(TY_2026_27_STUB_PACK)!;
    const news = parameters.newRegimeSlabs;
    if (news.state !== "available") throw new Error("newRegimeSlabs must be available");
    // s.202(1) Table: seven bands, nil to Rs. 400000, 30% above Rs. 2400000.
    expect(news.value.map((b) => b.to)).toEqual([
      400_000, 800_000, 1_200_000, 1_600_000, 2_000_000, 2_400_000, Infinity,
    ]);
    expect(news.value.map((b) => b.rate)).toEqual([0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3]);

    const old = parameters.oldRegimeSlabs;
    if (old.state !== "available") throw new Error("oldRegimeSlabs must be available");
    // Part I-B ¶A items (I)/(II)/(III): the three basic exemptions, and the
    // super-senior table has one fewer band because the widened exemption
    // absorbs the whole 5% one.
    expect(old.value.below60[0]!.to).toBe(250_000);
    expect(old.value.senior[0]!.to).toBe(300_000);
    expect(old.value.superSenior[0]!.to).toBe(500_000);
    expect(old.value.superSenior).toHaveLength(3);
    expect(old.value.below60).toHaveLength(4);
    // …and the 80-year band EXISTS, which `D298` recorded as unsourced and not
    // to be assumed. It is now read from Part I-B, so this assertion is the
    // answer rather than a restatement of the question.
    expect(old.value.superSenior[1]!.rate).toBe(0.2);

    const surcharge = parameters.surcharge;
    if (surcharge.state !== "available") throw new Error("surcharge must be available");
    // Part I-B ¶F Table 1 Sl. No. 1: only the two bands inside the supported
    // window are declared. The 25%/37% tiers are ABSENT, not declared-and-unused,
    // so nothing can apply them by accident.
    expect(surcharge.value.bands.map((b) => b.rate)).toEqual([0.1, 0.15]);
    expect(surcharge.value.entryThreshold).toBe(50_00_000);
    expect(surcharge.value.supportedTotalIncomeCeiling).toBe(2_00_00_000);
    // Every declared band rate is at or below the special-rate cap, which is
    // what makes clause (vi) provably non-binding inside the window.
    for (const band of surcharge.value.bands) {
      expect(band.rate).toBeLessThanOrEqual(surcharge.value.specialRateSurchargeRateCap);
    }
  });

  // D298 — DELIBERATE REPLACEMENT of a pre-existing assertion, recorded rather
  // than done silently (PROJECT_CONSTITUTION.md §4). This test previously
  // asserted `provenance` was `undefined` and `ruleCount === 0`. K4-PORT-01
  // gives the pack real provenance, so that assertion is now false BY DESIGN.
  // What it was actually protecting — that the pack reads as NOT verifiable —
  // is preserved and strengthened below: the pack is still unverified, and the
  // reason is now specific per rule instead of one blunt "no provenance".
  it("declares provenance yet still reads as NOT verifiable, with a specific gap per rule", () => {
    expect(TY_2026_27_STUB_PACK.provenance).toBe(TY_2026_27_PACK_PROVENANCE);
    const state = describeTaxPackVerification(TY_2026_27_STUB_PACK);
    expect(state.verified).toBe(false);
    expect(state.summary).toContain("not CA-verified");
    // Every declared rule is reported unverified — none is verified by the mere
    // act of citing a source.
    expect(state.assessment.ruleCount).toBe(TY_2026_27_PACK_PROVENANCE.rules.length);
    expect(state.assessment.verifiedCount).toBe(0);
    expect(state.assessment.evidenceComplete).toBe(false);
    expect(state.unverifiedRuleIds).toEqual(TY_2026_27_PACK_PROVENANCE.rules.map((r) => r.ruleId));
    // The refusal got MORE specific, not weaker: one gap per rule, plus the
    // lifecycle-status gap.
    expect(state.gaps.length).toBe(TY_2026_27_PACK_PROVENANCE.rules.length + 1);
    expect(state.gaps[0]).toContain("not ca_verified");
  });

  it("borrows no 1961-Act version string", () => {
    expect(TY_2026_27_RULES_VERSION).not.toBe(RULES_VERSION);
    expect(TY_2026_27_PACK_IDENTITY.computationRulesVersion).not.toBe(RULES_VERSION);
    expect(TY_2026_27_PACK_IDENTITY.validationRulesVersion).not.toBe(RULES_VERSION);
  });

  it("invents no source/output schema packages for the 2025-Act return forms", () => {
    expect(TY_2026_27_PACK_IDENTITY.sourceSchemaVersions).toEqual({});
    expect(TY_2026_27_PACK_IDENTITY.outputSchemaVersions).toEqual({});
  });
});

describe("both statutory worlds coexist and resolve unambiguously", () => {
  it("holds historical/current AY packs plus the separate statutory world", () => {
    const packs = createDefaultTaxPackRegistry().list();
    expect(packs).toHaveLength(3);
    expect(packs[0]).toBe(AY_2026_27_V0_PACK);
    expect(packs[1]).toBe(AY_2026_27_PACK);
    expect(packs[2]).toBe(TY_2026_27_STUB_PACK);
    // Distinct canonical keys — the registry could not hold both otherwise.
    expect(taxPackKey(packs[0]!.identity)).not.toBe(taxPackKey(packs[1]!.identity));
    expect(taxPackKey(packs[1]!.identity)).not.toBe(taxPackKey(packs[2]!.identity));
  });

  it("resolves a current-version 1961-Act selector to exactly the live AY pack", () => {
    const res = resolveTaxPack(createDefaultTaxPackRegistry(), CURRENT_AY_SELECTOR);
    expect(res.outcome).toBe("resolved");
    if (res.outcome === "resolved") expect(res.pack).toBe(AY_2026_27_PACK);
  });

  it("resolves an exact historical pin to the identity-only V0 AY pack", () => {
    const res = resolveTaxPack(createDefaultTaxPackRegistry(), {
      ...AY_SELECTOR,
      computationRulesVersion: PRE_K4_17_RULES_VERSION,
    });
    expect(res.outcome).toBe("resolved");
    if (res.outcome === "resolved") expect(res.pack).toBe(AY_2026_27_V0_PACK);
  });

  it("resolves the 2025-Act selector to exactly the TY stub", () => {
    const res = resolveTaxPack(createDefaultTaxPackRegistry(), TY_SELECTOR);
    expect(res.outcome).toBe("resolved");
    if (res.outcome === "resolved") expect(res.pack).toBe(TY_2026_27_STUB_PACK);
  });

  it("only an unpinned multi-version AY selector is ambiguous", () => {
    const registry = createDefaultTaxPackRegistry();
    expect(TY_2026_27_PERIOD).toBe(ASSESSMENT_YEAR); // same text, different world
    expect(resolveTaxPack(registry, AY_SELECTOR).outcome).toBe("ambiguous");
    for (const selector of [CURRENT_AY_SELECTOR, TY_SELECTOR]) {
      expect(resolveTaxPack(registry, selector).outcome).toBe("resolved");
    }
  });

  it("does not leak either world into the other's period-counting model", () => {
    const registry = createDefaultTaxPackRegistry();
    // 1961 Act asked for in tax years, and 2025 Act asked for in assessment
    // years, both match nothing — a mismatched periodKind is never coerced.
    expect(
      resolveTaxPack(registry, { law: "ITA_1961", periodKind: "tax_year", period: ASSESSMENT_YEAR })
        .outcome,
    ).toBe("unsupported");
    expect(
      resolveTaxPack(registry, {
        law: "ITA_2025",
        periodKind: "assessment_year",
        period: TY_2026_27_PERIOD,
      }).outcome,
    ).toBe("unsupported");
  });

  it("still refuses a period neither world registers", () => {
    const registry = createDefaultTaxPackRegistry();
    expect(
      resolveTaxPack(registry, { law: "ITA_1961", periodKind: "assessment_year", period: "2030-31" })
        .outcome,
    ).toBe("unsupported");
    expect(
      resolveTaxPack(registry, { law: "ITA_2025", periodKind: "tax_year", period: "2030-31" })
        .outcome,
    ).toBe("unsupported");
  });

  it("`periodKindForLaw` is what makes a case selector reach the right world", () => {
    expect(periodKindForLaw("ITA_1961")).toBe("assessment_year");
    expect(periodKindForLaw("ITA_2025")).toBe("tax_year");
    expect(taxCasePackSelector({ assessmentYear: "2026-27" })).toMatchObject(AY_SELECTOR);
    expect(taxCasePackSelector({ assessmentYear: "2026-27", law: "ITA_2025" })).toMatchObject(
      TY_SELECTOR,
    );
  });
});

describe("a case reaching the TY stub fails safe through the existing paths", () => {
  it("binding refuses as `unbound` — not `unsupported`, and never a fallback", () => {
    const b = bindDefaultTaxPackToCase({ assessmentYear: "2026-27", law: "ITA_2025" });
    expect(b.outcome).toBe("refused");
    if (b.outcome !== "refused") return;
    expect(b.resolution).toBe("unbound");
    expect(b.reason).toContain(TY_2026_27_RULES_VERSION);
    expect(b.reason).toContain("no computation binding");
  });

  it("reliance refuses as `unverified` through the unchanged resolver", () => {
    const r = resolveTaxPackForReliance(createDefaultTaxPackRegistry(), TY_SELECTOR);
    expect(r.outcome).toBe("refused");
    if (r.outcome === "refused") expect(r.resolution).toBe("unverified");
  });

  it("produces the existing consumable blocker — no second refusal mechanism", () => {
    const blocker = defaultTaxPackRelianceBlocker({ assessmentYear: "2026-27", law: "ITA_2025" });
    expect(blocker).not.toBeNull();
    expect(blocker?.code).toBe(TAX_PACK_BLOCKER_CODES.unverified);
    expect(blocker?.details.some((d) => d.includes("draft"))).toBe(true);
  });

  it("hands back no computation surface a caller could invoke", () => {
    const b = bindTaxPackToCase(createDefaultTaxPackRegistry(), {
      assessmentYear: TY_2026_27_PERIOD,
      law: "ITA_2025",
    });
    // The refused branch has no `computation` key at all — a caller cannot
    // accidentally destructure an engine out of it.
    expect("computation" in b).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// K4-PORT-01 — the 2025 world now carries REAL citations (D297, D298).
//
// The whole hazard of this slice is that 1961 and 2025 share section numbers
// meaning different things. These tests make the separation checkable rather
// than a matter of authoring care, and they prove that registering provenance
// did not make anything computable.
// ---------------------------------------------------------------------------
describe("K4-PORT-01 — the two worlds' citations cannot leak into each other", () => {
  const tySources = TY_2026_27_PACK_PROVENANCE.rules.flatMap((r) => [...r.sources]);
  const aySources = AY_2026_27_PACK_PROVENANCE.rules.flatMap((r) => [...r.sources]);

  it("declares one provenance rule per AY rule — the port covers everything and invents nothing", () => {
    // Set equality BOTH ways. A rule present in only one world fails here in
    // whichever direction it drifted, which is the cheapest possible proof that
    // the port is complete and additive-free.
    const ay = [...new Set(AY_2026_27_PACK_PROVENANCE.rules.map((r) => r.ruleId))].sort();
    const ty = [...new Set(TY_2026_27_PACK_PROVENANCE.rules.map((r) => r.ruleId))].sort();
    expect(ty).toEqual(ay);
    // K4-19: 24 -> 25. `section_89_arrears_relief` is a GAP rule and had to be
    // added to BOTH worlds, because this assertion is set equality and a rule
    // present in one world only is a drift failure — which is the assertion
    // doing its job, not an obstacle routed around. The count is deliberately
    // still a literal: the whole point is that adding a rule group is a
    // conscious act, so deriving it from the pack would make this test agree
    // with whatever the pack happens to say.
    expect(ty.length).toBe(26);
  });

  it("cites NO Income-tax Act, 1961 source id, and the AY pack cites no 2025 id", () => {
    for (const source of tySources) {
      expect(source.id.startsWith("ITA_1961")).toBe(false);
      expect(source.id).not.toBe("FINANCE_ACT_2025");
    }
    for (const source of aySources) {
      expect(source.id.startsWith("ITA_2025")).toBe(false);
    }
    // The two worlds share NO source id at all.
    const tyIds = new Set(tySources.map((s) => s.id));
    for (const source of aySources) expect(tyIds.has(source.id)).toBe(false);
  });

  it("never carries a bare section number — every citation names its instrument", () => {
    // The OPS-14 incident: a supplied "Section 72" turned out to be the 2025
    // Act's. A citation that names a section but not an Act is exactly that
    // defect, so it fails here.
    //
    // `K4-SOURCE-01` (`D301`) MADE THIS INSTRUMENT-AWARE, and that is a
    // STRENGTHENING rather than a relaxation — recorded per §4 because it
    // modifies a pre-existing assertion. The check asserted every TY citation
    // contains "Income-tax Act, 2025", which silently assumed every source is
    // an ACT SECTION. That held until the return-form ceiling was cited to
    // Income-tax RULES, 2026 rule 164 — a citation that is fully qualified and
    // unambiguous, and would have failed a guard aimed at bare section numbers.
    // Each kind must now name ITS OWN instrument, so a bare "rule 164" is
    // caught exactly as a bare "section 72" is, and the 1961-leak half is
    // unchanged and still applies to every source regardless of kind.
    for (const source of tySources) {
      if (source.kind === "rule" || source.kind === "notification") {
        expect(source.citation, `${source.id} must name the Rules it comes from`).toContain(
          "Income-tax Rules, 2026",
        );
        // A rule-kind source must never name the 1962 Rules as its own
        // instrument — that is the Rules-level form of the same collision.
        expect(source.citation).not.toContain("Income-tax Rules, 1962 rule");
      } else {
        expect(source.citation).toContain("Income-tax Act, 2025");
      }
      expect(source.citation).not.toContain("Income-tax Act, 1961 (");
    }
    // `K4-SOURCE-02` (2026-08-15) MADE THE AY SIDE INSTRUMENT-AWARE TOO —
    // recorded per §4 because it replaces a pre-existing assertion, and it is a
    // STRENGTHENING like its TY counterpart above.
    //
    // This is the "if you fix one, grep for the others" class that
    // the project status notes names as recurring. `K4-SOURCE-01` made the TY branch
    // instrument-aware and left this branch as it was; this branch then took
    // its first `rule`-kind source (Income-tax Rules, 1962 rule 12) and PASSED
    // — but for the wrong reason. Its citation happens to contain "Income Tax
    // Department" (naming where it was read), which satisfied the old
    // disjunction. A citation reading bare "rule 12" plus an ITD mention would
    // have passed identically, which is exactly the defect the TY branch was
    // hardened against.
    //
    // So a rule-kind source must now name the RULES it comes from, and must
    // never name the 2026 Rules as its own instrument — the mirror image of the
    // TY branch's check, and the Rules-level form of the section-number
    // collision `OPS-14` was bitten by.
    //
    // `K4-23` (`D337`) SPLIT `notification` OFF FROM `rule`, and that is a
    // STRENGTHENING recorded per §4. The two kinds were checked by one
    // branch requiring "Income-tax Rules, 1962", which was right while the
    // only notification-kind source WAS a Rules notification. The Cost
    // Inflation Index notifications are made under clause (v) of the
    // Explanation to section 48 of the ACT, not under the Rules, so that
    // string is simply false of them and widening the disjunction to let
    // them through would have re-created the "passed for the wrong reason"
    // defect described above. Instead a notification must now name its OWN
    // instrument identity — its notification number AND its Gazette S.O.
    // number — which nothing checked before, and which is the notification-
    // level form of the same bare-section-number rule.
    for (const source of aySources) {
      if (source.kind === "notification") {
        expect(
          /No\. \d+\/\d{4}/.test(source.citation),
          `${source.id} must name its notification number`,
        ).toBe(true);
        expect(
          /S\.O\. \d+\(E\)/.test(source.citation),
          `${source.id} must name its Gazette S.O. number`,
        ).toBe(true);
        expect(source.citation).not.toContain("Income-tax Rules, 2026 rule");
      } else if (source.kind === "rule") {
        expect(source.citation, `${source.id} must name the Rules it comes from`).toContain(
          "Income-tax Rules, 1962",
        );
        expect(source.citation).not.toContain("Income-tax Rules, 2026 rule");
      } else {
        const namesAnAct =
          source.citation.includes("Income-tax Act, 1961") ||
          source.citation.includes("Finance Act") ||
          source.citation.includes("Finance (No. 2) Act") ||
          source.citation.includes("Income Tax Department") ||
          source.citation.includes("Central Board of Direct Taxes");
        expect(namesAnAct).toBe(true);
      }
      // The 2025-Act leak half, unchanged and applying to every kind.
      expect(source.citation).not.toContain("Income-tax Act, 2025 (");
    }
  });

  it("cites the AY-world Finance Act 2026 halves, and NEVER the 2025-Act halves", () => {
    // `K4-SOURCE-02`. The Finance Act, 2026 is ONE Act serving TWO statutory
    // worlds: s.2 + First Schedule Part I-A charge under the Income-tax Act,
    // 1961 (this pack), s.3 + Part I-B under the Income-tax Act, 2025 (the TY
    // pack). A single artifact on disk (`K4-SOURCE-02-S2`) physically contains
    // both Parts, so nothing but this assertion stops a later session citing
    // the wrong half from the right file.
    const fa2026 = aySources.filter((s) => s.id.startsWith("FINANCE_ACT_2026"));
    expect(fa2026.length, "the AY pack must cite the Finance Act, 2026").toBeGreaterThan(0);
    for (const source of fa2026) {
      expect(source.citation).toContain("Finance Act, 2026");
      // The 1961-Act half, named.
      const namesTheAyHalf =
        source.citation.includes("Act 43 of 1961") ||
        source.citation.includes("Income-tax Act, 1961");
      expect(namesTheAyHalf, `${source.id} must name the 1961-Act half`).toBe(true);
      // And never the 2025-Act half's coordinates.
      expect(source.citation).not.toContain("Part I-B");
      expect(source.citation).not.toContain("Act 30 of 2025");
    }
    // The TY pack must not reach into this pack's halves either.
    for (const source of tySources) {
      expect(source.citation).not.toContain("Part I-A");
      expect(source.citation).not.toContain("Act 43 of 1961");
    }
  });

  it("discloses the source RANK on every K4-SOURCE-02-era citation, and names the Gazette only where the Gazette is what it read", () => {
    // `official-source-retrieval.md` §5: a lower tier must never stand in for a
    // higher one SILENTLY. `K4-SOURCE-01` pinned exactly this for the TY
    // world's rule 164 citation; `K4-SOURCE-02` then found the AY side had no
    // equivalent assertion at all — the "fix one, grep for the others" class.
    //
    // **`K4-CITE-01` (`D315`) INVERTED HALF OF THIS GUARD, and the inversion is
    // the point.** Until the owner supplied the Finance Act, 2026 as published
    // in the Gazette (`K4-PORT-04-S1`), every Finance Act 2026 citation read a
    // non-Gazette copy and was REQUIRED to disclaim. The Gazette is now held
    // and the two Finance Act halves are re-cited to it — so those citations
    // must NAME the Gazette and carry NO stale disclaimer — while the RULES
    // citation still reads a non-Gazette copy and must still say so: the
    // Gazette that notified the Income-tax Rules, 1962 is not held. Rank
    // disclosure, which is the property §5 actually demands, is asserted on
    // all three unchanged.
    const wanted = new Set([
      "FINANCE_ACT_2026_S2",
      "FINANCE_ACT_2026_FIRST_SCHEDULE_PART_I_A",
      "ITR_1962_R12",
    ]);
    const byId = new Map(aySources.filter((s) => wanted.has(s.id)).map((s) => [s.id, s]));
    const sources = [...byId.values()];
    expect(sources).toHaveLength(3);
    for (const source of sources) {
      expect(source.citation, `${source.id} must disclose its source rank`).toMatch(/rank[- ]?\d/i);
    }
    // The two Finance Act 2026 halves: read in the Gazette since K4-CITE-01,
    // after every span they quote was verified present in the Gazette's
    // committed Chapter II / First Schedule Part I extracts.
    for (const id of ["FINANCE_ACT_2026_S2", "FINANCE_ACT_2026_FIRST_SCHEDULE_PART_I_A"]) {
      const source = byId.get(id)!;
      expect(source.citation, `${id} must name the Gazette it is read in`).toMatch(
        /Gazette of India/i,
      );
      expect(source.citation, `${id} must not still disclaim the Gazette`).not.toMatch(
        /NOT the (notifying )?Gazette/i,
      );
    }
    // The Rules citation is the mirror case: still a non-Gazette copy, so the
    // disclaimer is still REQUIRED — retiring it here would be false, because
    // the notifying Gazette for the 1962 Rules is not held.
    expect(byId.get("ITR_1962_R12")!.citation).toMatch(/NOT the (notifying )?Gazette/i);
  });

  it("marks the enacted Act as the stage on every 2025 Act-section citation", () => {
    // A Bill as introduced is not the Act as enacted (OPS-14 §4). Every
    // act_section citation in this world must say which it is.
    for (const source of tySources.filter((s) => s.kind === "act_section")) {
      expect(source.citation).toContain("as enacted");
    }
  });

  it("keeps every rule caveated, so none can be rubber-stamped", () => {
    for (const rule of TY_2026_27_PACK_PROVENANCE.rules) {
      expect(rule.caveat).not.toBeNull();
      expect(rule.caveat).toContain("TODO(CA-verify)");
    }
  });

  it("cites nothing for exactly ONE rule, and for a reason that is not a Finance Act", () => {
    // `K4-SOURCE-01` (`D301`) narrowed this set from six to five and recorded
    // WHY the five remained: the Finance Act, 2026 IS held, First Schedule
    // Part I-B sources all five, and they cited nothing only because declaring
    // the FIGURES was the port's parameter threading and a citation sweep may
    // not start it.
    //
    // **`K4-PORT-04` (`D314`) IS THAT SESSION, SO THE SET IS NOW ONE — recorded
    // per `PROJECT_CONSTITUTION.md` §4 rather than done silently.** All five
    // now cite the Finance Act, 2026 (Part I-B for the surcharge, its marginal
    // relief, its safety threshold and the senior/super-senior widening; s.3(15)
    // for the cess), and `slab_rates` gained Part I-B and s.3 alongside
    // s.202(1). Each is asserted positively below rather than merely dropped
    // from this list, because a rule LEAVING a "cites nothing" set is exactly
    // the change that should be visible.
    //
    // The one that stays is uncited for a categorically different reason, which
    // is why it was worth keeping this test rather than deleting it: no Finance
    // Act can close it.
    //
    // **`K4-24` EMPTIES THIS SET, AND THE EMPTYING IS THE ASSERTION — recorded
    // per `PROJECT_CONSTITUTION.md` §4 rather than done silently.** The last
    // member was `section_89_arrears_relief`, uncited since `K4-19` because the
    // 2025-Act counterpart of section 89 had not been identified and was
    // deliberately not guessed (`D298`'s citation-error class). It was a missing
    // IDENTIFICATION rather than a missing document, which is why no Finance Act
    // could ever have closed it and why the test said so. The owner named the
    // mapping in his `K4-24` decisions and it was then READ OFF ARTIFACTS THIS
    // REPOSITORY ALREADY HELD — not accepted on the naming alone — so it now
    // cites Income-tax Act, 2025 s.157 and Income-tax Rules, 2026 rule 73,
    // asserted positively below exactly as the five that left before it are.
    //
    // THE SET IS NOW EMPTY, AND AN EMPTY LIST DRIVING A `for` LOOP ASSERTS
    // NOTHING — which is `AUDIT-12-F4`'s class, caught in this session's own
    // change before it was relied on. The first draft of this edit kept
    // `mustCiteNothing` as an empty array with the loops below it and claimed in
    // a comment that its emptiness was "a fact worth failing on". It was not:
    // zero iterations cannot fail. The property is therefore asserted
    // POSITIVELY, over the whole pack, in both of the two places it lives.
    //
    // **AND THE POSITIVE FORM IMMEDIATELY FOUND A SECOND UNCITED RULE THE OLD
    // GUARD NEVER SAW, WHICH IS THE POINT OF WRITING IT THIS WAY.** This test is
    // titled "cites nothing for exactly ONE rule" and that was **false** when
    // `K4-24` ran it: `capital_gains_house_sale` was added to the TY pack by
    // `K4-23` citing nothing, because the 2025-Act counterparts of ss.45/48/50C
    // were not identified either. The old loop could not notice, because it
    // iterated the list it was given and never asked whether the list was
    // complete — a summary outliving its rows (`AUDIT-10-F2`) inside a guard
    // that checks a proxy for its own claim (`AUDIT-11`, `D304`).
    //
    // It is DECLARED here rather than quietly cited. Citing it would mean
    // identifying 2025-Act counterparts for the house-sale chain, which is
    // source work nobody has done and which `D298` forbids inventing.
    const mustCiteNothing: readonly string[] = ["capital_gains_house_sale"];
    for (const ruleId of mustCiteNothing) {
      const rule = TY_2026_27_PACK_PROVENANCE.rules.find((r) => r.ruleId === ruleId);
      expect(rule, `${ruleId} must exist`).toBeDefined();
      expect(rule!.sources, `${ruleId} must cite no source`).toEqual([]);
    }
    // (1) In the provenance itself: NO TY rule cites zero sources any more. A
    // future rule added with none fails here, naming itself.
    const uncited = TY_2026_27_PACK_PROVENANCE.rules
      .filter((r) => r.sources.length === 0)
      .map((r) => r.ruleId);
    expect(
      uncited,
      "the TY rules citing no source must be exactly the declared set, both ways",
    ).toEqual([...mustCiteNothing]);
    // (2) In what `verification.ts` REPORTS, which is the half a preparer and a
    // verifying CA actually see. The "no source" gap must have gone, not merely
    // stopped being listed here — those are different things, and only this
    // second check can tell them apart.
    const state = describeTaxPackVerification(TY_2026_27_STUB_PACK);
    for (const ruleId of mustCiteNothing) {
      expect(state.gaps).toContain(`${ruleId}: No official source is cited for this rule`);
    }
    expect(
      state.gaps
        .filter((gap) => gap.includes("No official source is cited for this rule"))
        .map((gap) => gap.split(":")[0]),
      "the reported no-source gaps must be exactly the declared set, both ways",
    ).toEqual([...mustCiteNothing]);

    // THE FIVE THAT LEFT, each now citing the Finance Act, 2026 — and none of
    // them reporting the "no source" gap any longer. Pinned in both directions
    // so a later session cannot quietly un-cite one.
    const nowCited = {
      // K4-24. Both are RANK 2 (an ITD consolidation of the enacted Act; ICAI's
      // reproduction of CBDT Notification No. 64/2026) and both are committed as
      // three-mode extracts, so the citation is checkable in a bare clone.
      // Citing the counterpart gives this world NO computation surface: the
      // relief is computed in neither world, and equivalence of the two
      // mechanics is a tax question that is not decided (§2 rule 5).
      section_89_arrears_relief: ["ITA_2025_S157", "ITR_2026_R73"],
      slab_rates: [
        "ITA_2025_S202",
        "FINANCE_ACT_2026_S3",
        "FINANCE_ACT_2026_FIRST_SCHEDULE_PART_I_B",
        // Rank-1 CORROBORATION of the s.3(3) mechanism, cited as nothing else.
        "FINANCE_ACT_2026_FIRST_SCHEDULE_PART_III",
      ],
      surcharge_rates: ["FINANCE_ACT_2026_FIRST_SCHEDULE_PART_I_B", "FINANCE_ACT_2026_S3"],
      surcharge_marginal_relief: ["FINANCE_ACT_2026_FIRST_SCHEDULE_PART_I_B"],
      surcharge_marginal_relief_safety_threshold: ["FINANCE_ACT_2026_FIRST_SCHEDULE_PART_I_B"],
      cess_rate: ["FINANCE_ACT_2026_S3"],
      senior_super_senior_basic_exemption_widening: ["FINANCE_ACT_2026_FIRST_SCHEDULE_PART_I_B"],
      itr1_income_ceiling: ["ITR_2026_R164"],
    } as const;
    for (const [ruleId, sourceIds] of Object.entries(nowCited)) {
      const rule = TY_2026_27_PACK_PROVENANCE.rules.find((r) => r.ruleId === ruleId);
      expect(rule, `${ruleId} must exist`).toBeDefined();
      expect(rule!.sources.map((s) => s.id), `${ruleId} sources`).toEqual(sourceIds);
      expect(state.gaps).not.toContain(`${ruleId}: No official source is cited for this rule`);
    }
  });

  it("discloses the RANK on every Finance Act 2026 citation, and the Gazette only where the Gazette is what it read", () => {
    // `official-source-retrieval.md` §5: a lower tier may never stand in for a
    // higher one SILENTLY. Until `K4-CITE-01` this guard CONFLATED two
    // properties — "discloses its rank" and "disclaims the Gazette" — and
    // asserted both on every Finance Act 2026 citation, because no Gazette
    // artifact existed. The owner supplied the Finance Act, 2026 as published
    // in the Gazette of India (`K4-PORT-04-S1`, 2026-08-17), and the
    // disclaimers became retirable, so the two properties are now asserted
    // SEPARATELY (recorded as `D315` per `PROJECT_CONSTITUTION.md` §4 — this
    // inverts two pre-existing assertions rather than deleting them):
    //   - RANK is disclosed on every Finance Act 2026 citation, always;
    //   - a citation resting on the GAZETTE names it and carries NO stale
    //     "NOT the Gazette" disclaimer — s.3 and Part III, both re-cited by
    //     `K4-CITE-01` after every span was verified present in the Gazette's
    //     committed extracts;
    //   - a citation still resting on a non-Gazette copy says WHY: Part I-B's
    //     AMOUNT spans stay on the ITD copy because the Gazette prints this
    //     Part's amounts with the rupee glyph, which extraction drops — the
    //     higher authority is the harder one to quote. Extracting a
    //     reproduction does not promote it, and neither does owning the
    //     Gazette demote the copy that actually extracts cleanly.
    const byId = new Map(tySources.map((s) => [s.id, s]));
    const partIB = byId.get("FINANCE_ACT_2026_FIRST_SCHEDULE_PART_I_B");
    const section3 = byId.get("FINANCE_ACT_2026_S3");
    const partIII = byId.get("FINANCE_ACT_2026_FIRST_SCHEDULE_PART_III");
    expect(partIB, "Part I-B must be cited").toBeDefined();
    expect(section3, "section 3 must be cited").toBeDefined();
    expect(partIII, "Part III must be cited").toBeDefined();
    for (const source of [partIB!, section3!, partIII!]) {
      expect(source.citation, `${source.id} must disclose its rank`).toMatch(/rank[- ]?\d/i);
      expect(source.citation).toContain("Finance Act, 2026");
    }
    // The two Gazette-read citations: named, and WITHOUT the retired disclaimer.
    for (const source of [section3!, partIII!]) {
      expect(source.citation, `${source.id} must name the Gazette it is read in`).toMatch(
        /Gazette of India/i,
      );
      expect(source.citation, `${source.id} must not still disclaim the Gazette`).not.toMatch(
        /NOT the (notifying )?Gazette/i,
      );
    }
    // Part I-B: rank-1 ITD copy RETAINED for the amount spans, and the citation
    // must SAY WHY rather than merely disclaim — the per-span decision D315
    // recorded, and the thing a reader of the citation needs to know.
    expect(partIB!.citation).toMatch(/rank 1/i);
    expect(partIB!.citation, "Part I-B must say why the ITD copy stays quotable").toMatch(
      /rupee glyph/i,
    );
  });

  it("cites the ITR-1 ceiling to the Rules, and now SUPPLIES it", () => {
    // `K4-SOURCE-01` (`D301`) cited this rule and deliberately left the FIGURE
    // withheld, because `recommendItrForm` depends on the ceiling in addition to
    // the computation set and supplying it alone would have moved this world's
    // derived engine capability — a change a citation sweep may not make in
    // passing.
    //
    // **`K4-PORT-04` (`D314`) IS THE SESSION `D301` WAS DEFERRING TO**, and it
    // supplies all six parameters together. The second half of this test is
    // therefore inverted — recorded per `PROJECT_CONSTITUTION.md` §4 rather than
    // done silently. THE CITATION HALF IS UNTOUCHED, which is the point of
    // keeping the two halves in one test: the rank-2 limit did not improve just
    // because the figure is now used.
    const rule = TY_2026_27_PACK_PROVENANCE.rules.find((r) => r.ruleId === "itr1_income_ceiling");
    expect(rule, "itr1_income_ceiling must exist").toBeDefined();
    expect(rule!.sources).toHaveLength(1);

    const source = rule!.sources[0]!;
    // A RULE, not an Act section — return forms are prescribed by rules, which
    // is precisely why this gap outlived every Act retrieval.
    expect(source.kind).toBe("rule");
    expect(source.authority).toBe("CBDT");
    expect(source.identifier).toBe("164");
    // Source rank must be DISCLOSED, never elided (official-source-retrieval.md
    // §5): this was read in ICAI's reproduction, not the Gazette. Supplying the
    // figure does NOT promote the source.
    expect(source.citation).toContain("Income-tax Rules, 2026");
    expect(source.citation).toContain("GSR 286(E)");
    expect(source.citation).toMatch(/rank 2/i);
    expect(source.citation).toMatch(/NOT the Gazette/i);

    const parameters = taxPackRateParameters(TY_2026_27_STUB_PACK)!;
    const ceiling = parameters.itrFormIncomeCeiling;
    expect(ceiling.state).toBe("available");
    if (ceiling.state !== "available") return;
    expect(ceiling.value).toBe(50_00_000);
    // It cites the rule it was read from, resolved OUT of the provenance rather
    // than restated at the parameter — so the parameter cannot claim an
    // authority the pack does not declare.
    expect(ceiling.sourceIds).toEqual([source.id]);

    // AND THE OLD PROPERTY, RESTATED WHERE IT NOW LIVES. `recommendItrForm` is
    // servable, and that still buys nothing: the pack has no computation surface
    // for anything to reach it through.
    expect(resolveEngineCapability(parameters).servableEntryPoints).toContain("recommendItrForm");
    expect(taxPackComputation(TY_2026_27_STUB_PACK)).toBeUndefined();
  });

  it("cites section 66, NOT section 2, for the derivative carve-out", () => {
    // k4-port-delta-assessment.md §2/§3 and D297 cite this as "s.2(31)(a) +
    // s.2(33)". In the ENACTED Act s.2(31) is "Commissioner" and s.2(33) is
    // "Commissioner (Appeals)"; the derivative definitions are s.66(31)/(33).
    // This is the single bucket-B item of the whole port, so the corrected
    // citation is pinned rather than left to prose.
    const books = TY_2026_27_PACK_PROVENANCE.rules.find(
      (r) => r.ruleId === "business_books_computation",
    );
    const derivative = books!.sources.find((s) => s.id === "ITA_2025_S66_31_33");
    expect(derivative, "the derivative carve-out must be cited").toBeDefined();
    expect(derivative!.identifier).toBe("66(31), 66(33)");
    expect(derivative!.citation).toContain("Section 66(31)");
    expect(derivative!.citation).toContain("section 66(33)");
    // No source in this world may claim s.2(31)/s.2(33) as the carve-out.
    for (const source of tySources) {
      expect(source.identifier).not.toBe("2(31)");
      expect(source.identifier).not.toBe("2(33)");
    }
  });

  it("records the s.66 reach rather than leaving the F&O re-derivation as future work", () => {
    // K4-PORT-07 / D318. The caveat used to say K4-18's affirmation "must be
    // re-derived". Slice 6 does that re-cite: s.26(3) is inside Part D (so
    // s.66 applies), s.108/s.113 are Chapter VII (they speak of speculation
    // business, not speculative transaction). Equivalence is not decided.
    const books = TY_2026_27_PACK_PROVENANCE.rules.find(
      (r) => r.ruleId === "business_books_computation",
    );
    expect(books!.sources.some((s) => s.id === "ITA_2025_S26_3")).toBe(true);
    expect(books!.sources.find((s) => s.id === "ITA_2025_S26_3")!.identifier).toBe("26(3)");
    expect(books!.caveat).not.toMatch(/must be re-derived/);
    expect(books!.caveat).toMatch(/Part D/);
    expect(books!.caveat).toMatch(/Chapter VII/);
    expect(books!.caveat).toMatch(/NOT decided/);
    expect(books!.caveat).toMatch(/no computation surface/);
  });

  it("cites Table Sl.3, NOT Sl.2, for presumptive professional income", () => {
    // The assessment records "s.58(2) Table Sl.2"; Sl.2 is goods carriage (the
    // s.44AE counterpart, unimplemented here). The profession row is Sl.3.
    const rule = TY_2026_27_PACK_PROVENANCE.rules.find(
      (r) => r.ruleId === "presumptive_44ada_computation",
    );
    const table = rule!.sources.find((s) => s.id.startsWith("ITA_2025_S58"));
    expect(table!.identifier).toBe("58(2) Table Sl.3");
    const business = TY_2026_27_PACK_PROVENANCE.rules.find(
      (r) => r.ruleId === "presumptive_44ad_computation",
    );
    expect(business!.sources.find((s) => s.id.startsWith("ITA_2025_S58"))!.identifier).toBe(
      "58(2) Table Sl.1",
    );
  });
});

describe("K4-PORT-01 — registering provenance made NOTHING computable", () => {
  // D299 — REPLACED ASSERTION (PROJECT_CONSTITUTION.md §4). This asserted
  // `"binding" in TY_2026_27_STUB_PACK` is `false`; K4-PORT-02 makes it `true`
  // while the pack still computes nothing. The claim being protected — that no
  // computation surface reaches a caller — is unchanged and re-asserted here
  // through the test that actually carries it.
  it("still hands back no computation surface", () => {
    expect(taxPackComputation(TY_2026_27_STUB_PACK)).toBeUndefined();
    const b = bindTaxPackToCase(createDefaultTaxPackRegistry(), {
      assessmentYear: TY_2026_27_PERIOD,
      law: "ITA_2025",
    });
    expect("computation" in b).toBe(false);
  });

  /**
   * **A DELIBERATELY REPLACED ASSERTION, AND AN HONEST LOSS RECORDED WITH IT**
   * (`PROJECT_CONSTITUTION.md` §4).
   *
   * This test asserted the refusal names the missing statutory authority —
   * "withholds 5 statutory rate parameter(s)", "Finance Act, 2026",
   * "new_regime_slabs", "surcharge". That was `K4-PORT-02`'s deliverable and it
   * is now unreachable BY DESIGN: nothing is withheld, so
   * `describeWithheldParameters` returns `null` and the withheld clause is
   * correctly absent.
   *
   * **THE REFUSAL IS THEREFORE LESS INFORMATIVE THAN IT WAS, AND THAT IS SAID
   * RATHER THAN GLOSSED.** It still refuses, still as `unbound`, still handing
   * back no `computation` key — but a preparer is now told only that the pack has
   * no computation binding, where before they were told which statutory authority
   * was missing. The message did not get worse by accident: the thing it named is
   * no longer true, and naming a false obstacle would be the worse outcome. What
   * is missing now is the WIRING, which is `case-pack.ts`'s existing sentence.
   *
   * A richer message — "this world can source every rate and no arithmetic is
   * bound to it" — would be an improvement and is deliberately NOT taken here:
   * it is refusal COPY on a path a preparer can reach, and slice 5's acceptance
   * is that no computed figure and no user-facing tax claim moves. It belongs to
   * the slice that wires the surface, which can move the message and the
   * behaviour together.
   */
  it("refuses as `unbound`, and its reason no longer names a withheld authority", () => {
    const b = bindDefaultTaxPackToCase({ assessmentYear: "2026-27", law: "ITA_2025" });
    expect(b.outcome).toBe("refused");
    if (b.outcome !== "refused") return;
    expect(b.resolution).toBe("unbound");
    expect(b.reason).toContain("no computation binding");
    expect(b.reason).toContain("it cannot govern a computation");

    // The clause that used to follow is gone, and its absence is DERIVED from the
    // pack's own parameters rather than from authored prose — which is why this
    // change needed no edit to `case-pack.ts` at all.
    const capability = resolveEngineCapability(taxPackRateParameters(TY_2026_27_STUB_PACK)!);
    expect(describeWithheldParameters(capability)).toBeNull();
    expect(b.reason).not.toContain("withholds");
    // Pinned so a future session cannot re-introduce a stale authority claim: the
    // refusal must not name a rate parameter it is no longer missing.
    expect(b.reason).not.toContain("new_regime_slabs");
    expect(b.reason).not.toContain("Finance Act, 2026");
  });

  it("leaves the AY refusal text untouched — the AY pack withholds nothing", () => {
    // A pack whose parameters are all available appends no withheld clause, so
    // the 1961-Act world's messages are byte-identical to before this change.
    const capability = resolveEngineCapability(
      taxPackRateParameters(AY_2026_27_PACK)!,
    );
    expect(capability.complete).toBe(true);
    expect(describeWithheldParameters(capability)).toBeNull();
  });

  it("still refuses binding as `unbound` and reliance as `unverified`", () => {
    const b = bindDefaultTaxPackToCase({ assessmentYear: "2026-27", law: "ITA_2025" });
    expect(b.outcome).toBe("refused");
    if (b.outcome !== "refused") return;
    expect(b.resolution).toBe("unbound");
    expect(b.reason).toContain("no computation binding");

    const r = resolveTaxPackForReliance(createDefaultTaxPackRegistry(), TY_SELECTOR);
    expect(r.outcome).toBe("refused");
    if (r.outcome === "refused") expect(r.resolution).toBe("unverified");
  });

  it("still yields the SAME blocker code — no second refusal mechanism appeared", () => {
    const blocker = defaultTaxPackRelianceBlocker({ assessmentYear: "2026-27", law: "ITA_2025" });
    expect(blocker?.code).toBe(TAX_PACK_BLOCKER_CODES.unverified);
  });

  it("is still truthfully draft and not reliance-ready", () => {
    expect(TY_2026_27_PACK_IDENTITY.status).toBe("draft");
    expect(TY_2026_27_PACK_IDENTITY.verifiedBy).toBeNull();
    expect(TY_2026_27_PACK_IDENTITY.verifiedAt).toBeNull();
    expect(isRelianceReady(TY_2026_27_PACK_IDENTITY)).toBe(false);
  });

  it("cannot be verified even by records that cite every declared source", () => {
    // The strongest form of "provenance is not verification". Feed a complete,
    // well-formed record for EVERY rule that cites a source. It still refuses,
    // because each rule's caveat is unresolved — and the rules citing no source
    // can never be verified at all.
    const records = TY_2026_27_PACK_PROVENANCE.rules
      .filter((rule) => rule.sources.length > 0)
      .map((rule) =>
        makeRuleVerificationRecord({
          ruleId: rule.ruleId,
          verifiedBy: "synthetic-test-not-a-real-ca",
          verifiedAt: "2026-08-14T00:00:00.000Z",
          sourceIds: rule.sources.map((s) => s.id),
          caveatResolved: false,
        }),
      );
    const transition = verifyTaxPackWithEvidence(TY_2026_27_PACK_IDENTITY, {
      provenance: TY_2026_27_PACK_PROVENANCE,
      records,
      verifiedBy: "synthetic-test-not-a-real-ca",
      verifiedAt: "2026-08-14T00:00:00.000Z",
    });
    expect(transition.ok).toBe(false);
    if (transition.ok) return;
    expect(transition.reason).toContain("lack verification evidence");
    expect(transition.reason).toContain("Unresolved caveat");
    expect(transition.reason).toContain("No official source is cited for this rule");
  });

  it("does not reach any live case — no production reader can see it", () => {
    // case-traceability.ts and the tax-lab harness read provenance only off a
    // BOUND pack (`taxPackProvenance(binding.pack)` after a successful bind).
    // The TY pack cannot bind, so those readers structurally cannot reach it.
    // Every other production consumer imports AY_2026_27_PACK_PROVENANCE by
    // name. This asserts the load-bearing half: a live case still binds the AY
    // pack, and its provenance is the AY one.
    const live = bindDefaultTaxPackToCase({ assessmentYear: ASSESSMENT_YEAR });
    expect(live.outcome).toBe("bound");
    if (live.outcome !== "bound") return;
    expect(live.pack.provenance).toBe(AY_2026_27_PACK_PROVENANCE);
    expect(live.pack.provenance).not.toBe(TY_2026_27_PACK_PROVENANCE);
  });
});

/**
 * K4-PORT-08 / D319 — the cite-vs-compute distinction, as ONE property.
 * Slice 6 made the 2025 world citeable, including the F&O carve-out. It
 * still cannot compute. These two facts are not independent: a later
 * session that wires a surface must come here ON PURPOSE, and a session
 * that only edits docs cannot make this file green.
 *
 * Equivalence of s.66(31)/s.66(33) and 1961 s.43(5) Explanation 1 is a
 * CA question and is not decided here (`D318`).
 */
describe("K4-PORT-08 — the 2025 world is citeable and not computable", () => {
  it("can be cited: every capability row names ITA_2025, including the filled fno carve-out", () => {
    expect(TAX_LAWS).toContain("ITA_2025");
    for (const row of TAX_CAPABILITY_MATRIX) {
      expect(
        Object.prototype.hasOwnProperty.call(row.ruleAuthority, "ITA_2025"),
        `${row.area} is missing an ITA_2025 authority key`,
      ).toBe(true);
    }
    const fno = findTaxCapability(TAX_CAPABILITY_MATRIX, "fno")!;
    expect(ruleAuthorityFor(fno, "ITA_2025")).toMatch(/Section 66\(31\)/);
    expect(ruleAuthorityFor(fno, "ITA_2025")).toMatch(/Section 66\(33\)/);
    expect(ruleAuthorityFor(fno, "ITA_2025")).not.toMatch(/Section 43\(5\)/);
  });

  it("cannot compute: no surface, bind still refuses unbound, no 1961 figures are handed back", () => {
    expect(taxPackComputation(TY_2026_27_STUB_PACK)).toBeUndefined();
    expect("computation" in TY_2026_27_STUB_PACK.binding!).toBe(false);
    const b = bindDefaultTaxPackToCase({ assessmentYear: "2026-27", law: "ITA_2025" });
    expect(b.outcome).toBe("refused");
    if (b.outcome !== "refused") return;
    expect(b.resolution).toBe("unbound");
    expect(b.reason).toContain("no computation binding");
    expect("computation" in b).toBe(false);
  });

  it("does not decide whether s.66(31)/s.66(33) equals 1961 s.43(5) Explanation 1", () => {
    const books = TY_2026_27_PACK_PROVENANCE.rules.find(
      (r) => r.ruleId === "business_books_computation",
    );
    expect(books!.caveat).toMatch(/NOT decided/);
    expect(books!.caveat).toMatch(/no computation surface/);
  });
});

describe("registering a second world changes nothing about the AY 2026-27 path", () => {
  it("leaves the AY canonical key byte-identical", () => {
    expect(taxPackKey(AY_2026_27_PACK_IDENTITY)).toBe(
      `IN:ITA_1961:assessment_year:${ASSESSMENT_YEAR}:${RULES_VERSION}`,
    );
  });

  it("leaves the AY binding and stamped versions untouched", () => {
    const b = bindDefaultTaxPackToCase({ assessmentYear: ASSESSMENT_YEAR });
    expect(b.outcome).toBe("bound");
    if (b.outcome !== "bound") return;
    expect(b.pack).toBe(AY_2026_27_PACK);
    expect(b.versions).toEqual({
      computationRulesVersion: RULES_VERSION,
      validationRulesVersion: RULES_VERSION,
    });
    expect(b.computation.computeTax).toBe(AY_2026_27_PACK.binding?.computation?.computeTax);
  });

  it("leaves the AY reliance refusal exactly as it was (unverified, draft)", () => {
    const r = resolveTaxPackForReliance(createDefaultTaxPackRegistry(), CURRENT_AY_SELECTOR);
    expect(r.outcome).toBe("refused");
    if (r.outcome === "refused") expect(r.resolution).toBe("unverified");
    expect(AY_2026_27_PACK_IDENTITY.status).toBe("draft");
  });

  it("leaves an unversioned-pin AY refusal `unsupported` (the stub does not absorb it)", () => {
    const b = bindDefaultTaxPackToCase({
      assessmentYear: ASSESSMENT_YEAR,
      computationRulesVersion: "AY_2026_27_V9_NOT_REGISTERED",
    });
    expect(b).toMatchObject({ outcome: "refused", resolution: "unsupported" });
  });
});

// ---------------------------------------------------------------------------
// D278 (AUDIT-09-F5) — recurrence guard. The default registry holds at most ONE
// in-tree executable engine binding per statutory world. A second binding for the
// same world is allowed ONLY when its world key is listed in
// `FREEZE_AUTHORIZED_EXTRA_BINDINGS` below WITH a comment naming the freeze
// decision, because a freeze event (D276) is the sole legitimate reason to keep
// a historical engine copy in-tree. This is the cheap, durable form of the
// material-expansion checkpoint K4-17 missed: a silent V2/V3 in-tree engine copy
// now fails a test rather than slipping through review.
// ---------------------------------------------------------------------------
const FREEZE_AUTHORIZED_EXTRA_BINDINGS = new Set<string>([
  // (none today — D277 removed the V0 in-tree copy; the V0 identity is unbound)
]);

/** Statutory world = jurisdiction:law:periodKind:period — the coordinate space a single executable engine serves. */
function worldKeyOf(pack: TaxPack): string {
  const { jurisdiction, law, periodKind, period } = pack.identity;
  return `${jurisdiction}:${law}:${periodKind}:${period}`;
}

function assertAtMostOneBoundEnginePerWorld(packs: readonly TaxPack[]): void {
  const boundByWorld = new Map<string, number>();
  for (const pack of packs) {
    // D299 — TIGHTENED, and this correction is load-bearing rather than
    // cosmetic. This line read `if (!pack.binding) continue`, which was exact
    // while `binding` implied executability. K4-PORT-02 breaks that: the TY
    // pack now carries a binding that serves NO computation, and counting it
    // would have made this guard measure the wrong thing — reporting a
    // non-computing pack as an "in-tree executable engine binding".
    //
    // What D278 actually protects against is a second EXECUTABLE engine copy,
    // so the guard now counts executable surfaces. Left unfixed it would have
    // been a guard that still passes today (one such pack per world) while
    // silently counting the wrong population — the most expensive kind of
    // wrong, because it looks green.
    if (!taxPackComputation(pack)) continue; // identity-only and rates-withheld packs don't count
    const key = worldKeyOf(pack);
    boundByWorld.set(key, (boundByWorld.get(key) ?? 0) + 1);
  }
  for (const [world, count] of boundByWorld) {
    const limit = 1 + (FREEZE_AUTHORIZED_EXTRA_BINDINGS.has(world) ? 1 : 0);
    if (count > limit) {
      throw new Error(
        `D278: statutory world ${world} has ${count} in-tree executable engine bindings; ` +
          `at most ${limit} is allowed without a named freeze-decision id in FREEZE_AUTHORIZED_EXTRA_BINDINGS.`,
      );
    }
  }
}

describe("D278 — at most one in-tree executable engine binding per statutory world", () => {
  it("the default registry satisfies the guard (V0 is identity-only after D277)", () => {
    expect(() => assertAtMostOneBoundEnginePerWorld(createDefaultTaxPackRegistry().list())).not.toThrow();
  });

  it("fires when a second in-tree binding is planted in the same world (the K4-17 recurrence)", () => {
    const registry = createTaxPackRegistry();
    registry.register(AY_2026_27_PACK);
    // Plant a rogue V2 in-tree copy in the SAME statutory world — exactly what
    // K4-17 did with the V0 frozen copy, and what D278 exists to catch.
    //
    // D299: the rogue must now carry its own computation surface WITHOUT the
    // real pack's `rateParameters`, because `makeTaxPack` rejects a parameter
    // set whose `packKey` names a different pack. That rejection is a genuine
    // strengthening — the laziest form of copy (reusing the original binding
    // wholesale) is now refused at construction, before D278 is even consulted
    // — but a determined copy would simply supply matching parameters, so D278
    // is still needed and is still what this test exercises.
    const rogueV2 = makeTaxPack(
      { ...AY_2026_27_PACK_IDENTITY, computationRulesVersion: "AY_2026_27_V2_ROGUE_COPY" },
      { boundEngineId: "tax-engine/ay-2026-27-rogue-copy", computation: AY_2026_27_PACK.binding!.computation! },
    );
    registry.register(rogueV2);
    expect(() => assertAtMostOneBoundEnginePerWorld(registry.list())).toThrow(/D278/);
  });

  it("does NOT count a binding that serves no computation (the TY pack)", () => {
    // The tightening above, asserted directly. Before D299 this guard counted
    // the `binding` KEY; the TY pack now has one and must still not count.
    const registry = createTaxPackRegistry();
    registry.register(AY_2026_27_PACK);
    registry.register(TY_2026_27_STUB_PACK);
    expect(() => assertAtMostOneBoundEnginePerWorld(registry.list())).not.toThrow();
    expect(TY_2026_27_STUB_PACK.binding).toBeDefined();
    expect(taxPackComputation(TY_2026_27_STUB_PACK)).toBeUndefined();
  });

  it("rejects a parameter set attached to the WRONG statutory world", () => {
    // The construction-time check `makeTaxPack` gained in D299. Attaching the
    // 1961 world's rates to the 2025 world's identity is the single worst
    // accident this boundary could permit — one Act's rates pricing another
    // Act's return — so it throws at build time, not at compute time.
    expect(() =>
      makeTaxPack(TY_2026_27_PACK_IDENTITY, {
        boundEngineId: "tax-engine/ay-2026-27",
        rateParameters: AY_2026_27_PACK.binding!.rateParameters!,
      }),
    ).toThrow(/may not be attached to a different statutory world/);
  });
});

// ---------------------------------------------------------------------------
// AUDIT-11-F9 / MAINT-01 — the SAME subject, measured against the TREE.
//
// The guard above is strong about what it measures and measures the wrong
// population for part of its stated subject. Its subject is "a silent V2/V3
// in-tree engine copy"; its measurement is packs in the default registry that
// carry an executable computation surface. An in-tree engine copy that is
// simply NOT REGISTERED — which is exactly the `legacy-v0/` shape `D277` spent
// 7,162 deleted lines removing — is invisible to it: it can sit in the tree,
// be imported directly by anything that bypasses the registry, and be
// registered later by a one-line change no test would notice.
//
// This is a COMPLEMENT, not a replacement. Registry membership is still the
// thing that decides what `bindTaxPackToCase` can reach; the tree is the thing
// `D277` actually cleaned up. Both halves are needed.
//
// The property, derived rather than restated: an engine, for the purposes of
// `D278`, is a module defining the computation entry points a pack binding
// holds. That list is read from the LIVE binding
// (`taxPackComputation(AY_2026_27_PACK)`) rather than hand-authored, so adding
// a fifth entry point to the binding widens this scan automatically instead of
// leaving it describing a four-function engine forever.
//
// WHAT THIS DOES NOT COVER — stated, because every finding `AUDIT-11` filed
// exists because a guard was described by its aspiration:
//   · A copy that RENAMES its entry points. It is then not textually an engine
//     copy, and the registry half above is what catches it the moment it is
//     registered. Nothing catches an unregistered, renamed copy — that gap is
//     real and is left named rather than papered over.
//   · A copy outside `src/` (a script, a fixture archive, a sibling package).
//   · A copy assembled at runtime, or re-exported through indirection deep
//     enough that no file textually defines the entry point.
//   · Whether two definitions are actually the SAME arithmetic. This counts
//     definition sites; it does not diff them.
// ---------------------------------------------------------------------------

/** Engine trees allowed to define the computation entry points, with the
 *  decision that authorises each. A frozen historical copy kept in-tree after a
 *  freeze event (`D276`) belongs here WITH its decision id — the tree-level
 *  counterpart of `FREEZE_AUTHORIZED_EXTRA_BINDINGS` above. */
const AUTHORIZED_ENGINE_TREES: ReadonlyMap<string, string> = new Map([
  ["src/lib/tax-engine/ay-2026-27", "the live AY 2026-27 engine"],
  // (no frozen in-tree copy today — D277 removed `legacy-v0/`; the pre-K4-17
  //  engine is recoverable at git tag `tax-pack-AY-2026-27-V0` / `b2a7406`)
]);

const REPO_ROOT_FOR_SCAN = join(__dirname, "..", "..", "..", "..");
const SRC_FOR_SCAN = join(REPO_ROOT_FOR_SCAN, "src");

function typescriptFilesUnder(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...typescriptFilesUnder(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function repoRelative(file: string): string {
  return relative(REPO_ROOT_FOR_SCAN, file).split(sep).join("/");
}

/**
 * True if `source` DEFINES and exports `name`. Three shapes, because a copy
 * that avoided one of them would otherwise slip through:
 *   1. `export function NAME` / `export async function NAME` / `export default`
 *   2. `export const|let|var NAME =`
 *   3. a local `function NAME` / `const NAME =` / `class NAME` combined with an
 *      `export { … NAME … }` list elsewhere in the file
 * A bare `export { NAME } from "./elsewhere"` is a RE-EXPORT, not a definition,
 * and deliberately does not count — otherwise `index.ts` would be reported as a
 * second engine.
 */
function definesExportedSymbol(source: string, name: string): boolean {
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`^\\s*export\\s+(?:default\\s+)?(?:async\\s+)?function\\s+${n}\\b`, "m").test(source)) return true;
  if (new RegExp(`^\\s*export\\s+(?:const|let|var)\\s+${n}\\b`, "m").test(source)) return true;
  const declaresLocally = new RegExp(
    `^\\s*(?:(?:async\\s+)?function|const|let|var|class)\\s+${n}\\b`,
    "m",
  ).test(source);
  if (!declaresLocally) return false;
  // An export list that is NOT a re-export (`export { … } from "…"`).
  for (const match of source.matchAll(/^\s*export\s*\{([^}]*)\}\s*(from\s*["'][^"']+["'])?/gm)) {
    if (match[2]) continue; // re-export
    if (
      match[1]!
        .split(",")
        .map((s) => s.trim().split(/\s+as\s+/)[0]!.trim())
        .includes(name)
    ) {
      return true;
    }
  }
  return false;
}

describe("D278 (AUDIT-11-F9) — at most one in-tree ENGINE TREE, measured from the filesystem", () => {
  const entryPoints = Object.keys(taxPackComputation(AY_2026_27_PACK) ?? {});
  const scanned = typescriptFilesUnder(SRC_FOR_SCAN);

  it("guards the guard: it scanned a real tree and found every entry point", () => {
    // AUDIT-04-F4 — a moved or renamed root, or a matcher that stopped
    // matching, must fail here rather than make the scan below pass vacuously.
    expect(scanned.length).toBeGreaterThan(200);
    expect(entryPoints.length).toBeGreaterThanOrEqual(4);
    const found = new Map<string, number>();
    for (const file of scanned) {
      const source = readFileSync(file, "utf8");
      for (const name of entryPoints) {
        if (definesExportedSymbol(source, name)) found.set(name, (found.get(name) ?? 0) + 1);
      }
    }
    // Every entry point the live binding names must be defined SOMEWHERE, or
    // the matcher is broken and the emptiness would read as cleanliness.
    expect([...entryPoints].filter((n) => !found.has(n))).toEqual([]);
  });

  it("no unauthorized tree defines the engine's computation entry points", () => {
    const byTree = new Map<string, string[]>();
    for (const file of scanned) {
      const source = readFileSync(file, "utf8");
      const defined = entryPoints.filter((name) => definesExportedSymbol(source, name));
      if (defined.length === 0) continue;
      const rel = repoRelative(file);
      const tree = rel.slice(0, rel.lastIndexOf("/"));
      byTree.set(tree, [...(byTree.get(tree) ?? []), `${rel} → ${defined.join(", ")}`]);
    }
    const unauthorized = [...byTree.entries()]
      .filter(([tree]) => !AUTHORIZED_ENGINE_TREES.has(tree))
      .flatMap(([, sites]) => sites);
    expect(unauthorized).toEqual([]);
    // And the authorized list must not have gone stale in the other direction:
    // a declared tree that no longer exists is a dead exemption.
    expect([...AUTHORIZED_ENGINE_TREES.keys()].filter((t) => !byTree.has(t))).toEqual([]);
  });
});
