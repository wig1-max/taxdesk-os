import { describe, expect, it } from "vitest";
import {
  SCHEMA_PACKAGE_STATUSES,
  formatSchemaPackageKey,
  makeSchemaCatalog,
  makeSchemaPackageIdentity,
  schemaVersionMap,
} from "@/lib/tax-pack/schema-package";

/**
 * The shared schema-package core (K3-14): identity validation, the canonical
 * `key@version` catalog key, deterministic resolution with EXPLICIT refusal, and
 * the version map a pack identity carries.
 */

const pkg = (key: string, schemaVersion: string) => ({
  identity: makeSchemaPackageIdentity({ key, schemaVersion, status: "planned" as const }),
});

describe("schema package identity", () => {
  it("freezes a validated identity", () => {
    const id = makeSchemaPackageIdentity({ key: "AIS", schemaVersion: "AIS_V0", status: "planned" });
    expect(id).toEqual({ key: "AIS", schemaVersion: "AIS_V0", status: "planned" });
    expect(Object.isFrozen(id)).toBe(true);
  });

  it("models planned / supported / retired — planned is never a soft 'supported'", () => {
    expect([...SCHEMA_PACKAGE_STATUSES]).toEqual(["planned", "supported", "retired"]);
  });

  it("refuses empty fields, unknown statuses and the version separator", () => {
    expect(() => makeSchemaPackageIdentity({ key: "  ", schemaVersion: "V0", status: "planned" })).toThrow(
      /key must be a non-empty string/,
    );
    expect(() => makeSchemaPackageIdentity({ key: "AIS", schemaVersion: "", status: "planned" })).toThrow(
      /schemaVersion must be a non-empty string/,
    );
    expect(() =>
      makeSchemaPackageIdentity({ key: "AIS", schemaVersion: "V0", status: "live" as never }),
    ).toThrow(/Invalid schema package status/);
    expect(() => makeSchemaPackageIdentity({ key: "A@B", schemaVersion: "V0", status: "planned" })).toThrow(
      /must not contain "@"/,
    );
  });

  it("formats a lossless catalog key", () => {
    expect(formatSchemaPackageKey(makeSchemaPackageIdentity({ key: "AIS", schemaVersion: "AIS_V0", status: "planned" }))).toBe(
      "AIS@AIS_V0",
    );
  });
});

describe("schema catalog resolution", () => {
  it("resolves an exact key and preserves declaration order", () => {
    const catalog = makeSchemaCatalog([pkg("AIS", "V1"), pkg("26AS", "V1")], "source");
    expect(catalog.list().map((p) => p.identity.key)).toEqual(["AIS", "26AS"]);
    const res = catalog.resolve("AIS");
    expect(res.outcome).toBe("resolved");
    if (res.outcome === "resolved") expect(res.schema.identity.schemaVersion).toBe("V1");
    expect(catalog.get("AIS@V1")?.identity.key).toBe("AIS");
    expect(catalog.get("AIS@V2")).toBeUndefined();
  });

  it("refuses an unknown key explicitly — never a guess or a closest match", () => {
    const catalog = makeSchemaCatalog([pkg("AIS", "V1")], "source");
    const res = catalog.resolve("ITR7_UTILITY");
    expect(res.outcome).toBe("unsupported");
    if (res.outcome === "unsupported") {
      expect(res.key).toBe("ITR7_UTILITY");
      expect(res.reason).toContain("No source schema package describes");
    }
  });

  it("refuses an unknown VERSION of a known key", () => {
    const catalog = makeSchemaCatalog([pkg("AIS", "V1")], "source");
    const res = catalog.resolve("AIS", "V2");
    expect(res.outcome).toBe("unsupported");
    if (res.outcome === "unsupported") {
      expect(res.schemaVersion).toBe("V2");
      expect(res.reason).toContain("at version");
    }
  });

  it("reports ambiguity rather than handing back 'the latest'", () => {
    const catalog = makeSchemaCatalog([pkg("AIS", "V1"), pkg("AIS", "V2")], "source");
    const res = catalog.resolve("AIS");
    expect(res.outcome).toBe("ambiguous");
    if (res.outcome === "ambiguous") {
      expect(res.candidates.map((c) => c.schemaVersion)).toEqual(["V1", "V2"]);
    }
    // Pinning the version disambiguates.
    const pinned = catalog.resolve("AIS", "V2");
    expect(pinned.outcome).toBe("resolved");
  });

  it("refuses a duplicate key@version registration", () => {
    expect(() => makeSchemaCatalog([pkg("AIS", "V1"), pkg("AIS", "V1")], "source")).toThrow(
      /Duplicate source schema package: AIS@V1/,
    );
  });
});

describe("schemaVersionMap", () => {
  it("derives a frozen { key: version } map from the packages", () => {
    const map = schemaVersionMap([pkg("AIS", "V1"), pkg("26AS", "V3")], "source");
    expect(map).toEqual({ AIS: "V1", "26AS": "V3" });
    expect(Object.isFrozen(map)).toBe(true);
  });

  // Regression: bracket-assigning `__proto__` onto a plain object hits
  // Object.prototype's setter and silently drops the entry. A schema version
  // must never vanish quietly.
  it("round-trips a pathological `__proto__` key instead of silently dropping it", () => {
    const map = schemaVersionMap([pkg("__proto__", "V1")], "source");
    expect(Object.prototype.hasOwnProperty.call(map, "__proto__")).toBe(true);
    expect(map["__proto__"]).toBe("V1");
  });

  it("refuses to collapse two versions of one key into a pack identity", () => {
    expect(() => schemaVersionMap([pkg("AIS", "V1"), pkg("AIS", "V2")], "source")).toThrow(
      /has versions "V1" and "V2"/,
    );
  });
});
