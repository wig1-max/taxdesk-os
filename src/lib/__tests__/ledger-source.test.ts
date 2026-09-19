import { describe, expect, it } from "vitest";
import { isSourceLinked, sourceCoverage } from "@/lib/tax-desk/ledger-source";

describe("ledger source coverage (provenance, NOT engine support)", () => {
  it("counts a row as linked when a document or file is mapped", () => {
    expect(isSourceLinked({ source_document_id: "d1" })).toBe(true);
    expect(isSourceLinked({ source_file_id: "f1" })).toBe(true);
    expect(isSourceLinked({ source_document_id: "d1", source_file_id: "f1" })).toBe(true);
  });

  it("counts a row as unlinked when neither is mapped", () => {
    expect(isSourceLinked({})).toBe(false);
    expect(isSourceLinked({ source_document_id: null, source_file_id: undefined })).toBe(false);
    expect(isSourceLinked({ source_document_id: "" })).toBe(false);
  });

  it("aggregates linked / unlinked totals", () => {
    const rows = [
      { source_document_id: "d1" },
      { source_file_id: "f1" },
      {},
      { source_document_id: null },
    ];
    expect(sourceCoverage(rows)).toEqual({ total: 4, linked: 2, unlinked: 2 });
  });

  it("empty ledger → all zero", () => {
    expect(sourceCoverage([])).toEqual({ total: 0, linked: 0, unlinked: 0 });
  });

  it("linked + unlinked always equals total (no double counting with unsupported)", () => {
    const rows = [{ source_document_id: "d1" }, {}, { source_file_id: "f2" }];
    const c = sourceCoverage(rows);
    expect(c.linked + c.unlinked).toBe(c.total);
  });
});
