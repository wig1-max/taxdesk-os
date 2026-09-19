import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUSINESS_BOOKS_ADJUSTMENT_DECLARATIONS,
  BUSINESS_BOOKS_ACTIVITY_CLASSIFICATIONS as LEDGER_ACTIVITY_CLASSIFICATIONS,
  DEPRECIATION_ASSET_CLASS_DECLARATIONS,
  DEPRECIATION_PUT_TO_USE_DECLARATIONS,
  HOUSE_SALE_ACQUISITION_MODE_DECLARATIONS,
  HOUSE_SALE_ASSET_KIND_DECLARATIONS,
  HOUSE_SALE_REQUIRED_DECLARATIONS,
  LEDGER_AUDIT_PREFIX,
  LEDGER_TABLE,
} from "@/lib/tax-desk/ledger";
import {
  BUSINESS_BOOKS,
  BUSINESS_BOOKS_ACTIVITY_CLASSIFICATIONS,
  BUSINESS_BOOKS_ADJUSTMENTS,
  DEPRECIATION_ASSET_CLASSES,
  DEPRECIATION_PUT_TO_USE,
  HOUSE_SALE_ACQUISITION_MODES,
  HOUSE_SALE_ASSET_KINDS,
  HOUSE_SALE_REQUIRED_DECLARATIONS as ENGINE_HOUSE_SALE_DECLARATIONS,
  SECTION_32_APPENDIX_I_RATES,
} from "@/lib/tax-engine/ay-2026-27";

/**
 * K4-14 — the books-adjustment vocabulary and its statutory authority.
 *
 * This is the session's load-bearing safety property, so it is asserted
 * directly rather than inferred from the adapter suite. Section 29 computes
 * business income "in accordance with the provisions contained in sections 30
 * to 43D" and this engine implements NONE of them, so the ONLY computable case
 * is the one a preparer has affirmatively declared adjustment-free. Every test
 * here fails if silence ever becomes a computable answer again.
 */
describe("BUSINESS_BOOKS_ADJUSTMENT_DECLARATIONS (K4-14)", () => {
  // Two parallel vocabularies, exactly as PRESUMPTIVE_ACTIVITY_TYPES is: the
  // engine may not import from tax-desk, and that module may not become a
  // second authority on what is computable. Pinned in BOTH directions so a
  // member added to either side alone fails here rather than silently becoming
  // a basis the adapter gate cannot classify.
  it("matches the engine's BUSINESS_BOOKS_ADJUSTMENTS keys in both directions", () => {
    expect([...BUSINESS_BOOKS_ADJUSTMENT_DECLARATIONS].sort()).toEqual(
      Object.keys(BUSINESS_BOOKS_ADJUSTMENTS).sort(),
    );
  });

  /**
   * DELIBERATELY REPLACED ASSERTION (K4-20 / D325), recorded rather than
   * hidden — `PROJECT_CONSTITUTION.md` §4. This read
   * `expect(computable).toEqual(["none_s30_43d"])`. That was a true
   * statement of K4-14's bounded scope, and admitting Section 32(1)(ii) is
   * exactly what K4-20 is chartered to do. The assertion is not weakened:
   * it still pins the computable set EXACTLY.
   */
  it("admits exactly none_s30_43d and a complete standing-class Section 32 claim", () => {
    const computable = Object.entries(BUSINESS_BOOKS_ADJUSTMENTS)
      .filter(([, v]) => v.computable)
      .map(([k]) => k)
      .sort();
    expect(computable).toEqual(["depreciation_s32", "none_s30_43d"]);
  });

  it("has no unknown/other/default member — absence is not a member", () => {
    // A default here would BE the assumption ("there is no depreciation and
    // nothing is disallowable") the vocabulary exists to stop anyone making on
    // the taxpayer's behalf.
    for (const member of BUSINESS_BOOKS_ADJUSTMENT_DECLARATIONS) {
      expect(member).not.toMatch(/^(unknown|other|default)$/);
    }
  });

  it("every non-computable member names the authority it refuses under", () => {
    for (const [key, value] of Object.entries(BUSINESS_BOOKS_ADJUSTMENTS)) {
      if (value.computable) continue;
      expect(value.authority, key).toContain("Income-tax Act 1961");
      expect(value.authority, key).toContain("Section");
    }
  });

  it("registers the new ledger kind's table and audit prefix", () => {
    expect(LEDGER_TABLE.business_books).toBe("tax_business_books_entries");
    expect(LEDGER_AUDIT_PREFIX.business_books).toBe("tax_ledger.business_books");
  });
});

describe("BUSINESS_BOOKS_ACTIVITY_CLASSIFICATIONS (K4-17, extended by K4-18)", () => {
  it("matches the engine vocabulary in both directions", () => {
    expect([...LEDGER_ACTIVITY_CLASSIFICATIONS].sort()).toEqual(
      Object.keys(BUSINESS_BOOKS_ACTIVITY_CLASSIFICATIONS).sort(),
    );
  });

  /**
   * DELIBERATELY REPLACED ASSERTION (K4-18), recorded rather than hidden — the
   * repository convention behind D9, D13 and D28/D29.
   *
   * This read `expect(computable).toEqual(["ordinary_business_or_profession"])`.
   * That was a true statement of K4-17's bounded scope, and admitting a second
   * pool member is exactly what K4-18 is chartered to do on the strength of
   * the k4-18-fno-source-research design notes. The assertion is not weakened:
   * it still pins the computable set EXACTLY, so a third member cannot appear
   * without a session changing this line and justifying it.
   */
  it("admits exactly the ordinary Section 70 pool plus eligible exchange-traded F&O", () => {
    const computable = Object.entries(BUSINESS_BOOKS_ACTIVITY_CLASSIFICATIONS)
      .filter(([, value]) => value.computable)
      .map(([key]) => key)
      .sort();
    expect(computable).toEqual(["fno_non_speculative_s43_5_d", "ordinary_business_or_profession"]);
  });

  it("every member names the authority it computes or refuses under", () => {
    for (const [key, value] of Object.entries(BUSINESS_BOOKS_ACTIVITY_CLASSIFICATIONS)) {
      expect(value.authority, key).toContain("Income-tax Act 1961");
      expect(value.authority, key).toContain("Section");
    }
    // The specific footings each class actually rests on, so a later edit
    // cannot quietly re-point a member at a different provision.
    expect(BUSINESS_BOOKS_ACTIVITY_CLASSIFICATIONS.fno_non_speculative_s43_5_d.authority).toContain(
      "43(5) proviso (d)",
    );
    expect(BUSINESS_BOOKS_ACTIVITY_CLASSIFICATIONS.fno_non_speculative_s43_5_d.authority).toContain(
      "Explanation 1",
    );
    expect(BUSINESS_BOOKS_ACTIVITY_CLASSIFICATIONS.futures_and_options.authority).toContain("43(5)");
    // Intraday is quarantined on BOTH footings, not just one: Section 43(5)
    // classifies the transaction, Explanation 2 to Section 28 makes the
    // business distinct and separate, and Section 73(1) restricts the loss.
    expect(BUSINESS_BOOKS_ACTIVITY_CLASSIFICATIONS.intraday_speculative_s43_5.authority).toContain(
      "43(5)",
    );
    expect(BUSINESS_BOOKS_ACTIVITY_CLASSIFICATIONS.intraday_speculative_s43_5.authority).toContain(
      "Explanation 2 to Section 28",
    );
    expect(BUSINESS_BOOKS_ACTIVITY_CLASSIFICATIONS.intraday_speculative_s43_5.authority).toContain(
      "Section 73(1)",
    );
    expect(BUSINESS_BOOKS_ACTIVITY_CLASSIFICATIONS.speculation_business_s73.authority).toContain(
      "Section 73",
    );
    expect(BUSINESS_BOOKS_ACTIVITY_CLASSIFICATIONS.specified_business_s35ad.authority).toContain(
      "73A",
    );
  });

  /**
   * K4-18's load-bearing safety property. Books revenue may serve as the
   * Section 44AB figure for exactly ONE class — the ordinary one, where "total
   * sales, turnover or gross receipts" genuinely describes what is booked as
   * revenue. Every other class must obtain the figure from a declaration,
   * because no statutory, CBDT or return-form source defines derivative
   * turnover. If a future member is added with `turnoverFromBooksRevenue: true`
   * it will silently start feeding the Section 44AB aggregate from revenue —
   * this test is what stops that happening unnoticed.
   */
  it("permits books revenue as the Section 44AB figure for the ordinary class ONLY", () => {
    const fromRevenue = Object.entries(BUSINESS_BOOKS_ACTIVITY_CLASSIFICATIONS)
      .filter(([, value]) => value.turnoverFromBooksRevenue)
      .map(([key]) => key);
    expect(fromRevenue).toEqual(["ordinary_business_or_profession"]);
  });

  it("has no unknown/other/default member — absence is not a member", () => {
    for (const member of LEDGER_ACTIVITY_CLASSIFICATIONS) {
      expect(member).not.toMatch(/^(unknown|other|default)$/);
    }
  });
});

describe("BUSINESS_BOOKS Section 44AB thresholds (K4-14)", () => {
  it("uses the LOWER Section 44AB(a) threshold, and the proviso figure has no consumer", () => {
    expect(BUSINESS_BOOKS.auditThresholdBusinessTurnover).toBe(1_00_00_000);
    expect(BUSINESS_BOOKS.auditThresholdProfessionGrossReceipts).toBe(50_00_000);
    // The proviso's higher figure is recorded so a future session that DOES
    // capture cash payments finds the constant already sourced. That it is
    // recorded-but-UNCONSUMED is asserted here rather than left to trust —
    // its second limb turns on cash PAYMENTS, which no ledger here captures
    // (the same unverifiable-condition gap decision D91 recorded for the
    // Section 44AD enhanced ceiling).
    expect(BUSINESS_BOOKS.auditThresholdBusinessTurnoverLowCash).toBe(10_00_00_000);
    expect(BUSINESS_BOOKS.lowCashShare).toBe(0.05);
    const adapter = readFileSync(
      join(process.cwd(), "src", "lib", "tax-desk", "computation-adapter.ts"),
      "utf8",
    );
    expect(adapter).not.toContain("auditThresholdBusinessTurnoverLowCash");
    expect(adapter).not.toContain("lowCashShare");
  });
});

describe("DEPRECIATION_ASSET_CLASS_DECLARATIONS (K4-20)", () => {
  it("matches the engine's DEPRECIATION_ASSET_CLASSES keys in both directions", () => {
    expect([...DEPRECIATION_ASSET_CLASS_DECLARATIONS].sort()).toEqual(
      Object.keys(DEPRECIATION_ASSET_CLASSES).sort(),
    );
  });

  it("matches SECTION_32_APPENDIX_I_RATES keys in both directions", () => {
    expect([...DEPRECIATION_ASSET_CLASS_DECLARATIONS].sort()).toEqual(
      Object.keys(SECTION_32_APPENDIX_I_RATES).sort(),
    );
  });

  it("matches the engine's DEPRECIATION_PUT_TO_USE keys in both directions", () => {
    expect([...DEPRECIATION_PUT_TO_USE_DECLARATIONS].sort()).toEqual(
      Object.keys(DEPRECIATION_PUT_TO_USE).sort(),
    );
  });

  it("quotes only the standing rates resolved across the live PDF and three modes", () => {
    expect(SECTION_32_APPENDIX_I_RATES.building_residential_i1.ratePercent).toBe(5);
    expect(SECTION_32_APPENDIX_I_RATES.building_other_i2.ratePercent).toBe(10);
    expect(SECTION_32_APPENDIX_I_RATES.building_temporary_i4.ratePercent).toBe(40);
    expect(SECTION_32_APPENDIX_I_RATES.furniture_fittings_ii.ratePercent).toBe(10);
    expect(SECTION_32_APPENDIX_I_RATES.plant_machinery_general_iii1.ratePercent).toBe(15);
    expect(SECTION_32_APPENDIX_I_RATES.motor_car_not_hire_iii2i.ratePercent).toBe(15);
    expect(SECTION_32_APPENDIX_I_RATES.motor_hire_iii3iia.ratePercent).toBe(30);
    expect(SECTION_32_APPENDIX_I_RATES.computers_iii5.ratePercent).toBe(40);
    expect(SECTION_32_APPENDIX_I_RATES.intangibles_part_b.ratePercent).toBe(25);
  });
});

describe("HOUSE_SALE vocabularies (K4-21)", () => {
  it("matches the engine's closed sets in both directions", () => {
    expect([...HOUSE_SALE_ASSET_KIND_DECLARATIONS].sort()).toEqual([...HOUSE_SALE_ASSET_KINDS].sort());
    expect([...HOUSE_SALE_ACQUISITION_MODE_DECLARATIONS].sort()).toEqual(
      [...HOUSE_SALE_ACQUISITION_MODES].sort(),
    );
    expect([...HOUSE_SALE_REQUIRED_DECLARATIONS].sort()).toEqual(
      [...ENGINE_HOUSE_SALE_DECLARATIONS].sort(),
    );
  });
});
