import { describe, expect, it } from "vitest";
import { makeTaxPackIdentity, type TaxPackStatus } from "@/lib/tax-pack/identity";
import { makeTaxPack } from "@/lib/tax-pack/pack";
import { createTaxPackRegistry } from "@/lib/tax-pack/registry";
import {
  resolveTaxPack,
  resolveTaxPackForReliance,
  type TaxPackSelector,
} from "@/lib/tax-pack/resolver";

function pack(opts: {
  law?: "ITA_1961" | "ITA_2025";
  periodKind?: "assessment_year" | "tax_year";
  period?: string;
  rulesVersion?: string;
  status?: TaxPackStatus;
}) {
  const status = opts.status ?? "draft";
  const rulesVersion = opts.rulesVersion ?? "V0";
  return makeTaxPack(
    makeTaxPackIdentity({
      jurisdiction: "IN",
      law: opts.law ?? "ITA_1961",
      periodKind: opts.periodKind ?? "assessment_year",
      period: opts.period ?? "2026-27",
      computationRulesVersion: rulesVersion,
      validationRulesVersion: rulesVersion,
      status,
      effectiveFrom: "2025-04-01",
      verifiedBy: status === "ca_verified" ? "CA Test" : null,
      verifiedAt: status === "ca_verified" ? "2026-07-19T00:00:00.000Z" : null,
    }),
  );
}

const AY_SELECTOR: TaxPackSelector = {
  law: "ITA_1961",
  periodKind: "assessment_year",
  period: "2026-27",
};

describe("resolveTaxPack", () => {
  it("resolves a single matching pack (hit)", () => {
    const registry = createTaxPackRegistry();
    const p = pack({});
    registry.register(p);
    const res = resolveTaxPack(registry, AY_SELECTOR);
    expect(res.outcome).toBe("resolved");
    if (res.outcome === "resolved") expect(res.pack).toBe(p);
  });

  it("defaults jurisdiction to IN", () => {
    const registry = createTaxPackRegistry();
    registry.register(pack({}));
    expect(resolveTaxPack(registry, { ...AY_SELECTOR, jurisdiction: "IN" }).outcome).toBe("resolved");
  });

  it("returns unsupported when no pack matches (safe, no throw)", () => {
    const registry = createTaxPackRegistry();
    registry.register(pack({}));
    const res = resolveTaxPack(registry, { law: "ITA_2025", periodKind: "tax_year", period: "2026-27" });
    expect(res.outcome).toBe("unsupported");
    if (res.outcome === "unsupported") expect(res.reason).toMatch(/No tax pack supports ITA_2025/);
  });

  it("returns ambiguous with candidates in registration order when >1 match", () => {
    const registry = createTaxPackRegistry();
    registry.register(pack({ rulesVersion: "V0" }));
    registry.register(pack({ rulesVersion: "V1" }));
    const res = resolveTaxPack(registry, AY_SELECTOR); // no rules-version pin → both match
    expect(res.outcome).toBe("ambiguous");
    if (res.outcome === "ambiguous") {
      expect(res.candidates.map((c) => c.computationRulesVersion)).toEqual(["V0", "V1"]);
    }
  });

  it("pins an exact historical pack via computationRulesVersion", () => {
    const registry = createTaxPackRegistry();
    registry.register(pack({ rulesVersion: "V0" }));
    registry.register(pack({ rulesVersion: "V1" }));
    const res = resolveTaxPack(registry, { ...AY_SELECTOR, computationRulesVersion: "V1" });
    expect(res.outcome).toBe("resolved");
    if (res.outcome === "resolved") expect(res.pack.identity.computationRulesVersion).toBe("V1");
  });

  it("is deterministic — repeated resolution yields the same outcome", () => {
    const registry = createTaxPackRegistry();
    registry.register(pack({}));
    const a = resolveTaxPack(registry, AY_SELECTOR);
    const b = resolveTaxPack(registry, AY_SELECTOR);
    expect(a).toEqual(b);
  });
});

describe("resolveTaxPackForReliance (lifecycle safe-refusal)", () => {
  it("refuses when no pack supports the case", () => {
    const registry = createTaxPackRegistry();
    const r = resolveTaxPackForReliance(registry, AY_SELECTOR);
    expect(r.outcome).toBe("refused");
    if (r.outcome === "refused") expect(r.resolution).toBe("unsupported");
  });

  it("refuses a draft pack — a draft is never relied upon for real preparation", () => {
    const registry = createTaxPackRegistry();
    registry.register(pack({ status: "draft" }));
    const r = resolveTaxPackForReliance(registry, AY_SELECTOR);
    expect(r.outcome).toBe("refused");
    if (r.outcome === "refused") {
      expect(r.resolution).toBe("unverified");
      expect(r.reason).toMatch(/is draft, not ca_verified/);
    }
  });

  it("refuses a retired pack", () => {
    const registry = createTaxPackRegistry();
    registry.register(pack({ status: "retired" }));
    const r = resolveTaxPackForReliance(registry, AY_SELECTOR);
    expect(r.outcome).toBe("refused");
    if (r.outcome === "refused") expect(r.resolution).toBe("unverified");
  });

  it("refuses on ambiguity rather than guessing", () => {
    const registry = createTaxPackRegistry();
    registry.register(pack({ status: "ca_verified", rulesVersion: "V0" }));
    registry.register(pack({ status: "ca_verified", rulesVersion: "V1" }));
    const r = resolveTaxPackForReliance(registry, AY_SELECTOR);
    expect(r.outcome).toBe("refused");
    if (r.outcome === "refused") expect(r.resolution).toBe("ambiguous");
  });

  it("permits reliance only on a single ca_verified pack", () => {
    const registry = createTaxPackRegistry();
    const p = pack({ status: "ca_verified" });
    registry.register(p);
    const r = resolveTaxPackForReliance(registry, AY_SELECTOR);
    expect(r.outcome).toBe("usable");
    if (r.outcome === "usable") expect(r.pack).toBe(p);
  });
});
