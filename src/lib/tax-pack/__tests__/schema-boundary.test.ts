import { describe, expect, it } from "vitest";
import { RULES_VERSION, ASSESSMENT_YEAR } from "@/lib/tax-engine/ay-2026-27/rules";
import { SOURCE_TYPES, type LedgerKind } from "@/lib/tax-desk/ledger";
import { makeTaxPackIdentity, taxPackKey } from "@/lib/tax-pack/identity";
import {
  SOURCE_SCHEMA_KINDS,
  SOURCE_FACT_AREAS,
  makeSourceFactSpec,
  makeSourceSchemaCatalog,
  makeSourceSchemaPackage,
  resolveSourceSchema,
  sourceSchemaVersionMap,
} from "@/lib/tax-pack/source-schema";
import {
  OUTPUT_ARTIFACT_KINDS,
  makeOutputSchemaCatalog,
  makeOutputSchemaPackage,
  makeOutputSectionSpec,
  outputSchemaVersionMap,
  resolveOutputSchema,
} from "@/lib/tax-pack/output-schema";
import {
  AY_2026_27_OUTPUT_SCHEMAS,
  AY_2026_27_OUTPUT_SCHEMA_CATALOG,
  AY_2026_27_OUTPUT_SCHEMA_VERSIONS,
  AY_2026_27_SOURCE_SCHEMAS,
  AY_2026_27_SOURCE_SCHEMA_CATALOG,
  AY_2026_27_SOURCE_SCHEMA_VERSIONS,
} from "@/lib/tax-pack/packs/ay-2026-27-schemas";
import { AY_2026_27_PACK_IDENTITY } from "@/lib/tax-pack/packs/ay-2026-27";

/**
 * K3-14 — the source/output schema package BOUNDARY.
 *
 * These assertions prove the boundary is real: schema packages are versioned
 * independently of the computation rules, the pack identity is derived from them
 * (never re-declared), unknown schemas are refused explicitly, and populating the
 * maps does not move the canonical pack key.
 */

describe("source schema packages", () => {
  it("covers exactly the ledger's EXTERNAL source types (manual/adjustment are not formats)", () => {
    const external = SOURCE_TYPES.filter((s) => s !== "manual" && s !== "adjustment");
    expect([...SOURCE_SCHEMA_KINDS].sort()).toEqual([...external].sort());
  });

  // `SOURCE_FACT_AREAS` mirrors the Tax Desk's `LedgerKind` deliberately (the
  // tax-pack package must not depend on the ledger at runtime). Without this
  // cross-check the two vocabularies could drift apart unnoticed.
  it("mirrors the ledger's LedgerKind vocabulary exactly", () => {
    const ledgerKinds: LedgerKind[] = ["income", "tax_paid", "deduction", "capital_gain"];
    expect([...SOURCE_FACT_AREAS].sort()).toEqual([...ledgerKinds].sort());
  });

  it("declares only facts the repository already models — gaps are explicit, not waived", () => {
    const byKind = new Map(AY_2026_27_SOURCE_SCHEMAS.map((p) => [p.identity.key, p]));
    // Transcribed from validation-runner's COMPARABLE_SOURCE_PAIRS.
    expect(byKind.get("Form16")?.facts.map((f) => `${f.area}.${f.factKey}`)).toEqual([
      "income.salary",
      "tax_paid.salary_tds",
    ]);
    expect(byKind.get("26AS")?.facts.map((f) => `${f.area}.${f.factKey}`)).toEqual([
      "tax_paid.salary_tds",
      "tax_paid.non_salary_tds",
    ]);
    // The runner deliberately does not auto-compare these, so nothing is claimed.
    for (const kind of ["broker_report", "bank_certificate", "prefilled_json"] as const) {
      expect(byKind.get(kind)?.facts).toEqual([]);
      expect(byKind.get(kind)?.caveat).toBeTruthy();
    }
  });

  it("ships every import schema as `planned` — nothing reads these formats yet", () => {
    for (const pkg of AY_2026_27_SOURCE_SCHEMAS) {
      expect(pkg.identity.status).toBe("planned");
      expect(pkg.caveat).toContain("No specimen of the official format has been inspected");
    }
  });

  it("refuses a duplicate declared fact", () => {
    expect(() =>
      makeSourceSchemaPackage({
        kind: "AIS",
        schemaVersion: "V1",
        status: "planned",
        summary: "x",
        facts: [
          makeSourceFactSpec({ area: "income", factKey: "salary", label: "a" }),
          makeSourceFactSpec({ area: "income", factKey: "salary", label: "b" }),
        ],
      }),
    ).toThrow(/declares fact "income.salary" more than once/);
  });

  it("refuses an unknown source format explicitly", () => {
    const res = resolveSourceSchema(AY_2026_27_SOURCE_SCHEMA_CATALOG, "gst_return");
    expect(res.outcome).toBe("unsupported");
    expect(() =>
      makeSourceSchemaPackage({
        kind: "gst_return" as never,
        schemaVersion: "V1",
        status: "planned",
        summary: "x",
      }),
    ).toThrow(/Invalid schema package source schema kind/);
  });

  it("resolves a declared format and pins its version", () => {
    const res = resolveSourceSchema(AY_2026_27_SOURCE_SCHEMA_CATALOG, "AIS", "AIS_V0_PLANNED");
    expect(res.outcome).toBe("resolved");
    if (res.outcome === "resolved") expect(res.schema.identity.key).toBe("AIS");
    expect(resolveSourceSchema(AY_2026_27_SOURCE_SCHEMA_CATALOG, "AIS", "AIS_V9").outcome).toBe(
      "unsupported",
    );
  });
});

describe("output schema packages", () => {
  it("describes the artifacts the product actually produces", () => {
    const byArtifact = new Map(AY_2026_27_OUTPUT_SCHEMAS.map((p) => [p.identity.key, p]));
    expect([...byArtifact.keys()].sort()).toEqual([...OUTPUT_ARTIFACT_KINDS].sort());

    const snapshot = byArtifact.get("computation_snapshot");
    expect(snapshot?.identity.status).toBe("supported");
    expect(snapshot?.sections.map((s) => s.key)).toEqual([
      "input_snapshot.eligibility",
      "input_snapshot.summary",
      "input_snapshot.sourceTrace",
      "input_snapshot.warningCodes",
      "input_snapshot.excludedLedgerIds",
      "input_snapshot.engineInputReplay",
      "input_snapshot.engineInput",
      "output_snapshot.computation",
      "output_snapshot.comparison",
      "output_snapshot.recommendation",
    ]);
    for (const section of snapshot?.sections ?? []) {
      expect(section.producedBy).toBe("src/app/actions/tax-computation.ts");
    }

    const sheet = byArtifact.get("computation_sheet");
    expect(sheet?.identity.status).toBe("supported");
    expect(sheet?.sections.map((s) => s.key)).toEqual([
      "ay",
      "regime",
      "incomeHeads",
      "deductions",
      "taxSummary",
      "notes",
    ]);
  });

  it("keeps the unbuilt draft-return payload `planned` with NO invented sections", () => {
    const planned = AY_2026_27_OUTPUT_SCHEMAS.find((p) => p.identity.key === "draft_return_payload");
    expect(planned?.identity.status).toBe("planned");
    expect(planned?.sections).toEqual([]);
    expect(planned?.caveat).toContain("Nothing produces this artifact today");
  });

  it("refuses a duplicate section and an unknown artifact", () => {
    expect(() =>
      makeOutputSchemaPackage({
        artifact: "computation_sheet",
        schemaVersion: "V1",
        status: "supported",
        summary: "x",
        sections: [
          makeOutputSectionSpec({ key: "ay", label: "a", producedBy: "m" }),
          makeOutputSectionSpec({ key: "ay", label: "b", producedBy: "m" }),
        ],
      }),
    ).toThrow(/declares section "ay" more than once/);
    expect(resolveOutputSchema(AY_2026_27_OUTPUT_SCHEMA_CATALOG, "form_168_payload").outcome).toBe(
      "unsupported",
    );
  });
});

describe("the pack identity carries the schema versions (K3-14)", () => {
  it("derives both maps from the packages — no re-declared literals", () => {
    expect(AY_2026_27_PACK_IDENTITY.sourceSchemaVersions).toEqual(AY_2026_27_SOURCE_SCHEMA_VERSIONS);
    expect(AY_2026_27_PACK_IDENTITY.outputSchemaVersions).toEqual(AY_2026_27_OUTPUT_SCHEMA_VERSIONS);
    expect(AY_2026_27_SOURCE_SCHEMA_VERSIONS).toEqual(
      sourceSchemaVersionMap(AY_2026_27_SOURCE_SCHEMAS),
    );
    expect(AY_2026_27_OUTPUT_SCHEMA_VERSIONS).toEqual(
      outputSchemaVersionMap(AY_2026_27_OUTPUT_SCHEMAS),
    );
  });

  it("names one version per format/artifact, frozen", () => {
    expect(AY_2026_27_PACK_IDENTITY.sourceSchemaVersions).toEqual({
      AIS: "AIS_V0_PLANNED",
      "26AS": "FORM_26AS_V0_PLANNED",
      Form16: "FORM16_V0_PLANNED",
      prefilled_json: "PREFILLED_JSON_V0_PLANNED",
      broker_report: "BROKER_REPORT_V0_PLANNED",
      bank_certificate: "BANK_CERTIFICATE_V0_PLANNED",
    });
    expect(AY_2026_27_PACK_IDENTITY.outputSchemaVersions).toEqual({
      computation_snapshot: "COMPUTATION_SNAPSHOT_V2",
      computation_sheet: "COMPUTATION_SHEET_V1",
      draft_return_payload: "DRAFT_RETURN_PAYLOAD_V0_PLANNED",
    });
    expect(Object.isFrozen(AY_2026_27_PACK_IDENTITY.sourceSchemaVersions)).toBe(true);
    expect(Object.isFrozen(AY_2026_27_PACK_IDENTITY.outputSchemaVersions)).toBe(true);
  });

  it("leaves the canonical pack key untouched — schema versions are NOT coordinates", () => {
    expect(taxPackKey(AY_2026_27_PACK_IDENTITY)).toBe(
      `IN:ITA_1961:assessment_year:${ASSESSMENT_YEAR}:${RULES_VERSION}`,
    );
  });
});

describe("the boundary is real: schema and rules versions move independently", () => {
  const base = {
    jurisdiction: "IN" as const,
    law: "ITA_1961" as const,
    periodKind: "assessment_year" as const,
    period: "2026-27",
    computationRulesVersion: "RULES_V1",
    validationRulesVersion: "RULES_V1",
    status: "draft" as const,
    effectiveFrom: "2025-04-01",
  };

  it("a schema version can change WITHOUT changing the pack key", () => {
    const a = makeTaxPackIdentity({ ...base, sourceSchemaVersions: { AIS: "AIS_V0" } });
    const b = makeTaxPackIdentity({ ...base, sourceSchemaVersions: { AIS: "AIS_V1" } });
    expect(taxPackKey(a)).toBe(taxPackKey(b));
    expect(a.sourceSchemaVersions).not.toEqual(b.sourceSchemaVersions);
  });

  it("the computation rules can change WITHOUT touching a schema version", () => {
    const schemas = { computation_snapshot: "COMPUTATION_SNAPSHOT_V1" };
    const a = makeTaxPackIdentity({ ...base, outputSchemaVersions: schemas });
    const b = makeTaxPackIdentity({
      ...base,
      computationRulesVersion: "RULES_V2",
      validationRulesVersion: "RULES_V2",
      outputSchemaVersions: schemas,
    });
    expect(taxPackKey(a)).not.toBe(taxPackKey(b));
    expect(a.outputSchemaVersions).toEqual(b.outputSchemaVersions);
  });

  it("an empty schema map is still valid — a pack need declare no schema at all", () => {
    const id = makeTaxPackIdentity(base);
    expect(id.sourceSchemaVersions).toEqual({});
    expect(id.outputSchemaVersions).toEqual({});
  });
});

describe("catalogs stay independent of one another", () => {
  it("a source catalog never resolves an output artifact and vice versa", () => {
    const sources = makeSourceSchemaCatalog([
      makeSourceSchemaPackage({ kind: "AIS", schemaVersion: "V1", status: "planned", summary: "x" }),
    ]);
    const outputs = makeOutputSchemaCatalog([
      makeOutputSchemaPackage({
        artifact: "computation_snapshot",
        schemaVersion: "V1",
        status: "supported",
        summary: "x",
      }),
    ]);
    expect(sources.resolve("computation_snapshot").outcome).toBe("unsupported");
    expect(outputs.resolve("AIS").outcome).toBe("unsupported");
  });
});
