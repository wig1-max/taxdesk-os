import { describe, expect, it } from "vitest";
import {
  formatTaxPackKey,
  makeTaxPackIdentity,
  parseTaxPackKey,
  sameTaxPackCoordinates,
  taxPackCoordinates,
  taxPackKey,
  type TaxPackIdentity,
} from "@/lib/tax-pack/identity";

/** A valid draft identity used across the suite. */
function draftIdentity(overrides: Partial<Parameters<typeof makeTaxPackIdentity>[0]> = {}): TaxPackIdentity {
  return makeTaxPackIdentity({
    jurisdiction: "IN",
    law: "ITA_1961",
    periodKind: "assessment_year",
    period: "2026-27",
    computationRulesVersion: "AY_2026_27_V0_PREP_ONLY",
    validationRulesVersion: "AY_2026_27_V0_PREP_ONLY",
    status: "draft",
    effectiveFrom: "2025-04-01",
    ...overrides,
  });
}

describe("makeTaxPackIdentity", () => {
  it("constructs a frozen identity with defaulted schema records + null verification", () => {
    const id = draftIdentity();
    expect(id.jurisdiction).toBe("IN");
    expect(id.sourceSchemaVersions).toEqual({});
    expect(id.outputSchemaVersions).toEqual({});
    expect(id.verifiedBy).toBeNull();
    expect(id.verifiedAt).toBeNull();
    expect(Object.isFrozen(id)).toBe(true);
    expect(Object.isFrozen(id.sourceSchemaVersions)).toBe(true);
    expect(Object.isFrozen(id.outputSchemaVersions)).toBe(true);
  });

  it("rejects invalid enum fields", () => {
    // @ts-expect-error — invalid law is a compile + runtime error.
    expect(() => draftIdentity({ law: "ITA_1962" })).toThrow(/Invalid tax-pack law/);
    // @ts-expect-error — invalid status.
    expect(() => draftIdentity({ status: "verified" })).toThrow(/Invalid tax-pack status/);
    // @ts-expect-error — invalid jurisdiction.
    expect(() => draftIdentity({ jurisdiction: "US" })).toThrow(/Invalid tax-pack jurisdiction/);
  });

  it("rejects empty period / rules versions", () => {
    expect(() => draftIdentity({ period: "  " })).toThrow(/period must be a non-empty string/);
    expect(() => draftIdentity({ computationRulesVersion: "" })).toThrow(
      /computationRulesVersion must be a non-empty string/,
    );
  });

  it("rejects key fields containing the separator (would break round-trip)", () => {
    expect(() => draftIdentity({ period: "2026:27" })).toThrow(/must not contain/);
    expect(() => draftIdentity({ computationRulesVersion: "V0:PREP" })).toThrow(/must not contain/);
  });

  it("enforces the ca_verified ⇒ verifiedBy/verifiedAt invariant", () => {
    expect(() => draftIdentity({ status: "ca_verified" })).toThrow(
      /ca_verified tax pack must carry verifiedBy and verifiedAt/,
    );
    // A non-verified pack must NOT carry verification fields.
    expect(() => draftIdentity({ status: "draft", verifiedBy: "CA X", verifiedAt: "2026-07-19T00:00:00.000Z" })).toThrow(
      /draft tax pack must not carry verifiedBy\/verifiedAt/,
    );
    // A well-formed verified identity is accepted.
    const verified = draftIdentity({
      status: "ca_verified",
      verifiedBy: "CA Test",
      verifiedAt: "2026-07-19T00:00:00.000Z",
    });
    expect(verified.status).toBe("ca_verified");
    expect(verified.verifiedBy).toBe("CA Test");
  });
});

describe("tax-pack key round-trip", () => {
  it("formats the canonical key", () => {
    expect(taxPackKey(draftIdentity())).toBe("IN:ITA_1961:assessment_year:2026-27:AY_2026_27_V0_PREP_ONLY");
  });

  it("parse(format(coords)) is identity for the coordinate fields", () => {
    const coords = taxPackCoordinates(draftIdentity());
    expect(parseTaxPackKey(formatTaxPackKey(coords))).toEqual(coords);
  });

  it("parses a valid key back to validated coordinates", () => {
    expect(parseTaxPackKey("IN:ITA_2025:tax_year:2026-27:TY_2026_27_STUB")).toEqual({
      jurisdiction: "IN",
      law: "ITA_2025",
      periodKind: "tax_year",
      period: "2026-27",
      computationRulesVersion: "TY_2026_27_STUB",
    });
  });

  it("rejects a malformed key and validates enums on parse", () => {
    expect(() => parseTaxPackKey("IN:ITA_1961:assessment_year")).toThrow(/Malformed tax-pack key/);
    expect(() => parseTaxPackKey("IN:BOGUS:assessment_year:2026-27:V0")).toThrow(/Invalid tax-pack law/);
  });

  it("sameTaxPackCoordinates compares only the coordinate fields", () => {
    const a = draftIdentity();
    const b = draftIdentity({ effectiveFrom: "2099-01-01" }); // non-coordinate difference
    const c = draftIdentity({ period: "2025-26" });
    expect(sameTaxPackCoordinates(a, b)).toBe(true);
    expect(sameTaxPackCoordinates(a, c)).toBe(false);
  });
});
