import { describe, expect, it } from "vitest";
import { makeTaxPackIdentity } from "@/lib/tax-pack/identity";
import { makeTaxPack } from "@/lib/tax-pack/pack";
import { createTaxPackRegistry } from "@/lib/tax-pack/registry";

function pack(period: string, rulesVersion: string) {
  return makeTaxPack(
    makeTaxPackIdentity({
      jurisdiction: "IN",
      law: "ITA_1961",
      periodKind: "assessment_year",
      period,
      computationRulesVersion: rulesVersion,
      validationRulesVersion: rulesVersion,
      status: "draft",
      effectiveFrom: "2025-04-01",
    }),
  );
}

describe("createTaxPackRegistry", () => {
  it("registers, gets by coordinates and by key, and reports presence", () => {
    const registry = createTaxPackRegistry();
    const p = pack("2026-27", "V0");
    registry.register(p);

    expect(registry.has(p.identity)).toBe(true);
    expect(registry.has("IN:ITA_1961:assessment_year:2026-27:V0")).toBe(true);
    expect(registry.get(p.identity)).toBe(p);
    expect(registry.get("IN:ITA_1961:assessment_year:2026-27:V0")).toBe(p);
    expect(registry.get("IN:ITA_1961:assessment_year:2099-00:VX")).toBeUndefined();
    expect(registry.has("IN:ITA_1961:assessment_year:2099-00:VX")).toBe(false);
  });

  it("preserves registration order in list()", () => {
    const registry = createTaxPackRegistry();
    const a = pack("2025-26", "V0");
    const b = pack("2026-27", "V0");
    const c = pack("2026-27", "V1");
    registry.register(a);
    registry.register(b);
    registry.register(c);
    expect(registry.list().map((p) => p.identity.computationRulesVersion)).toEqual(["V0", "V0", "V1"]);
    expect(registry.list().map((p) => p.identity.period)).toEqual(["2025-26", "2026-27", "2026-27"]);
  });

  it("refuses a duplicate registration for the same coordinates (immutability)", () => {
    const registry = createTaxPackRegistry();
    registry.register(pack("2026-27", "V0"));
    expect(() => registry.register(pack("2026-27", "V0"))).toThrow(/already registered/);
    // Same coordinates even from a distinct object instance is still refused.
    expect(registry.list()).toHaveLength(1);
  });

  it("allows distinct coordinates that share some fields", () => {
    const registry = createTaxPackRegistry();
    registry.register(pack("2026-27", "V0"));
    expect(() => registry.register(pack("2026-27", "V1"))).not.toThrow(); // different rules version
    expect(() => registry.register(pack("2025-26", "V0"))).not.toThrow(); // different period
    expect(registry.list()).toHaveLength(3);
  });

  it("returns a frozen list snapshot that cannot mutate the registry", () => {
    const registry = createTaxPackRegistry();
    registry.register(pack("2026-27", "V0"));
    const list = registry.list();
    expect(Object.isFrozen(list)).toBe(true);
    expect(() => {
      // @ts-expect-error — frozen array push must throw in strict mode.
      list.push(pack("2099-00", "VX"));
    }).toThrow();
    expect(registry.list()).toHaveLength(1);
  });
});
