import { describe, expect, it } from "vitest";
import {
  RULES_VERSION,
  PRE_K4_17_RULES_VERSION,
  PRE_K4_18_RULES_VERSION,
  ASSESSMENT_YEAR,
} from "@/lib/tax-engine/ay-2026-27/rules";
import { computeTax } from "@/lib/tax-engine/ay-2026-27/compute-tax";
import { compareRegimes } from "@/lib/tax-engine/ay-2026-27/compare-regimes";
import { recommendItrForm } from "@/lib/tax-engine/ay-2026-27/recommend-itr-form";
import { validateCase } from "@/lib/tax-engine/ay-2026-27/validate-case";
import { AY_2026_27_PACK, AY_2026_27_PACK_IDENTITY } from "@/lib/tax-pack/packs/ay-2026-27";
import {
  AY_2026_27_V0_PACK,
  AY_2026_27_V0_PACK_IDENTITY,
} from "@/lib/tax-pack/packs/ay-2026-27-v0";
import {
  AY_2026_27_OUTPUT_SCHEMA_VERSIONS,
  AY_2026_27_SOURCE_SCHEMA_VERSIONS,
} from "@/lib/tax-pack/packs/ay-2026-27-schemas";
import { createDefaultTaxPackRegistry } from "@/lib/tax-pack";
import { resolveTaxPack, resolveTaxPackForReliance } from "@/lib/tax-pack/resolver";
import { taxPackKey } from "@/lib/tax-pack/identity";

/**
 * The existing AY 2026-27 engine registered as the first pack. These assertions
 * prove the identity is truthful (a `draft` pack, no fabricated CA verification)
 * and stays in sync with the engine's `RULES_VERSION`; that the K3-11 binding
 * holds the engine's own functions by reference; and that the default registry
 * still safely refuses real-preparation reliance on a `draft` pack.
 */
describe("AY 2026-27 pack identity", () => {
  it("mirrors the engine's rules version + assessment year losslessly", () => {
    expect(AY_2026_27_PACK_IDENTITY.computationRulesVersion).toBe(RULES_VERSION);
    expect(AY_2026_27_PACK_IDENTITY.validationRulesVersion).toBe(RULES_VERSION);
    expect(AY_2026_27_PACK_IDENTITY.period).toBe(ASSESSMENT_YEAR);
    expect(AY_2026_27_PACK_IDENTITY.law).toBe("ITA_1961");
    expect(AY_2026_27_PACK_IDENTITY.periodKind).toBe("assessment_year");
    expect(taxPackKey(AY_2026_27_PACK_IDENTITY)).toBe(
      `IN:ITA_1961:assessment_year:${ASSESSMENT_YEAR}:${RULES_VERSION}`,
    );
  });

  /**
   * K4-18 moved the live coordinate V1 -> V2, so this assertion moved with it.
   * That is the bump `D276`/`D278` REQUIRE on a material computation-behaviour
   * change (a second computable activity class, and a new basis for the Section
   * 44AB aggregate), and it is what keeps the `K3-12` snapshot freshness check
   * honest — `AUDIT-09-F1` found ~15 sessions changing behaviour while the
   * version stood still.
   *
   * The historical markers are asserted here precisely so a later session
   * cannot quietly recycle one for changed semantics: every past coordinate
   * must stay distinct from the live one AND from each other.
   */
  it("versions K4-18 separately while preserving every historical snapshot marker", () => {
    expect(PRE_K4_17_RULES_VERSION).toBe("AY_2026_27_V0_PREP_ONLY");
    expect(PRE_K4_18_RULES_VERSION).toBe("AY_2026_27_V1_PREP_ONLY");
    expect(RULES_VERSION).toBe("AY_2026_27_V5_PREP_ONLY");
    expect(new Set([PRE_K4_17_RULES_VERSION, PRE_K4_18_RULES_VERSION, RULES_VERSION]).size).toBe(3);
    expect(AY_2026_27_V0_PACK_IDENTITY.computationRulesVersion).toBe(PRE_K4_17_RULES_VERSION);
    expect(AY_2026_27_V0_PACK_IDENTITY.validationRulesVersion).toBe(PRE_K4_17_RULES_VERSION);
  });

  // D277 (AUDIT-09-F2): the in-tree frozen V0 engine was removed. This pack is
  // now IDENTITY-ONLY — the pre-K4-17 coordinate stays resolvable (proved in the
  // registry block below) so historical snapshots remain identifiable and the
  // freshness check stays honest, but there is NO computation surface. The
  // frozen engine, its provenance and its schema packages are recoverable at git
  // tag `tax-pack-AY-2026-27-V0` (`b2a7406`); legacy snapshots are
  // stored-output evidence, not replay-complete inputs.
  it("carries no in-tree computation binding after D277 (identity-only, like the TY stub)", () => {
    expect(AY_2026_27_V0_PACK.binding).toBeUndefined();
    // A caller probing with `"binding" in pack` must not conclude it is bound.
    expect("binding" in AY_2026_27_V0_PACK).toBe(false);
    expect(Object.keys(AY_2026_27_V0_PACK)).toEqual(["identity"]);
  });

  it("is truthfully draft (engine carries TODO(CA-verify) values) — not ca_verified", () => {
    expect(AY_2026_27_PACK_IDENTITY.status).toBe("draft");
    expect(AY_2026_27_PACK_IDENTITY.verifiedBy).toBeNull();
    expect(AY_2026_27_PACK_IDENTITY.verifiedAt).toBeNull();
  });

  // K3-11 replaced K3-10's "exposes no compute/validate functions this session"
  // assertion: the binding is now concrete by design. The engine functions are
  // held BY REFERENCE — asserted here and proved byte-identical in
  // `pack-computation-golden.test.ts`. K3-13 extended the pack surface with
  // `provenance` (decision D13); the key-set assertion is updated accordingly —
  // it records the surface, not a behavioural contract.
  it("names the engine binding and holds the engine's four functions by reference", () => {
    expect(AY_2026_27_PACK.binding?.boundEngineId).toBe("tax-engine/ay-2026-27");
    expect(Object.keys(AY_2026_27_PACK).sort()).toEqual(["binding", "identity", "provenance"]);
    const computation = AY_2026_27_PACK.binding?.computation;
    expect(computation).toBeDefined();
    expect(computation?.computeTax).toBe(computeTax);
    expect(computation?.compareRegimes).toBe(compareRegimes);
    expect(computation?.recommendItrForm).toBe(recommendItrForm);
    expect(computation?.validateCase).toBe(validateCase);
    expect(Object.isFrozen(computation)).toBe(true);
  });

  // K3-14 replaced K3-10's "leaves source/output schema packages empty until
  // K3-14" assertion — that statement recorded K3-10's bounded scope, which this
  // session is chartered to change (decision D16, same convention as D9/D13).
  // The maps are now derived from the schema packages; the detailed contents and
  // the key-invariance proof live in `schema-boundary.test.ts`.
  it("carries source/output schema package versions derived from the schema packages", () => {
    expect(AY_2026_27_PACK_IDENTITY.sourceSchemaVersions).toEqual(AY_2026_27_SOURCE_SCHEMA_VERSIONS);
    expect(AY_2026_27_PACK_IDENTITY.outputSchemaVersions).toEqual(AY_2026_27_OUTPUT_SCHEMA_VERSIONS);
    expect(Object.keys(AY_2026_27_PACK_IDENTITY.sourceSchemaVersions).length).toBeGreaterThan(0);
    expect(Object.keys(AY_2026_27_PACK_IDENTITY.outputSchemaVersions).length).toBeGreaterThan(0);
  });
});

describe("default tax-pack registry", () => {
  it("requires a version pin when historical and current AY packs coexist", () => {
    const registry = createDefaultTaxPackRegistry();
    const unpinned = resolveTaxPack(registry, {
      law: "ITA_1961",
      periodKind: "assessment_year",
      period: ASSESSMENT_YEAR,
    });
    expect(unpinned.outcome).toBe("ambiguous");

    const current = resolveTaxPack(registry, {
      law: "ITA_1961",
      periodKind: "assessment_year",
      period: ASSESSMENT_YEAR,
      computationRulesVersion: RULES_VERSION,
    });
    expect(current.outcome).toBe("resolved");
    if (current.outcome === "resolved") expect(current.pack).toBe(AY_2026_27_PACK);

    const historical = resolveTaxPack(registry, {
      law: "ITA_1961",
      periodKind: "assessment_year",
      period: ASSESSMENT_YEAR,
      computationRulesVersion: PRE_K4_17_RULES_VERSION,
    });
    expect(historical.outcome).toBe("resolved");
    if (historical.outcome === "resolved") expect(historical.pack).toBe(AY_2026_27_V0_PACK);
  });

  it("safely refuses reliance — no ca_verified pack exists yet (unverified refusal)", () => {
    const registry = createDefaultTaxPackRegistry();
    const r = resolveTaxPackForReliance(registry, {
      law: "ITA_1961",
      periodKind: "assessment_year",
      period: ASSESSMENT_YEAR,
      computationRulesVersion: RULES_VERSION,
    });
    expect(r.outcome).toBe("refused");
    if (r.outcome === "refused") expect(r.resolution).toBe("unverified");
  });

  // K3-15 replaced this assertion's expectation: the TY 2026-27 / ITA_2025 world
  // is now REGISTERED as an explicit identity-only stub (decision D18, same
  // convention as D9/D13/D16), so the refusal is `unverified` (a draft pack
  // resolved) rather than `unsupported` (nothing matched). It still refuses, and
  // the stub still cannot compute — proved in `parallel-worlds.test.ts`.
  it("safely refuses a TY 2026-27 / ITA_2025 case — the stub is draft, never relied upon", () => {
    const registry = createDefaultTaxPackRegistry();
    const r = resolveTaxPackForReliance(registry, {
      law: "ITA_2025",
      periodKind: "tax_year",
      period: "2026-27",
    });
    expect(r.outcome).toBe("refused");
    if (r.outcome === "refused") expect(r.resolution).toBe("unverified");
  });
});
