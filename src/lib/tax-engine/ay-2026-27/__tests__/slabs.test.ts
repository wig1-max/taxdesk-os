import { describe, expect, it } from "vitest";
import {
  NEW_REGIME_SLABS,
  OLD_REGIME_SENIOR_SLABS,
  OLD_REGIME_SLABS,
  OLD_REGIME_SUPER_SENIOR_SLABS,
  applySlabTax,
  describeSlabs,
  slabsForRegime,
} from "../slabs";
import { AY_2026_27_COMPUTATION_FIGURES as FIGURES } from "../rate-figures";

describe("slabsForRegime — K4-02 senior/super-senior OLD-regime widening", () => {
  it("returns the below-60 old-regime table when no age band is supplied", () => {
    expect(slabsForRegime(FIGURES, "old")).toBe(OLD_REGIME_SLABS);
  });

  it("returns the below-60 old-regime table for ageBand 'below_60'", () => {
    expect(slabsForRegime(FIGURES, "old", "below_60")).toBe(OLD_REGIME_SLABS);
  });

  it("returns the below-60 old-regime table for a null age band", () => {
    expect(slabsForRegime(FIGURES, "old", null)).toBe(OLD_REGIME_SLABS);
  });

  it("returns the senior table for ageBand 'senior'", () => {
    expect(slabsForRegime(FIGURES, "old", "senior")).toBe(OLD_REGIME_SENIOR_SLABS);
  });

  it("returns the super-senior table for ageBand 'super_senior'", () => {
    expect(slabsForRegime(FIGURES, "old", "super_senior")).toBe(OLD_REGIME_SUPER_SENIOR_SLABS);
  });

  it("ALWAYS returns the age-neutral new-regime table regardless of age band", () => {
    expect(slabsForRegime(FIGURES, "new")).toBe(NEW_REGIME_SLABS);
    expect(slabsForRegime(FIGURES, "new", "senior")).toBe(NEW_REGIME_SLABS);
    expect(slabsForRegime(FIGURES, "new", "super_senior")).toBe(NEW_REGIME_SLABS);
  });

  it("senior table widens only the nil-rate band — 5/20/30% bands and boundaries above ₹3L are unchanged", () => {
    expect(OLD_REGIME_SENIOR_SLABS).toEqual([
      { from: 0, to: 300_000, rate: 0 },
      { from: 300_000, to: 500_000, rate: 0.05 },
      { from: 500_000, to: 1_000_000, rate: 0.2 },
      { from: 1_000_000, to: Infinity, rate: 0.3 },
    ]);
  });

  it("super-senior table skips the 5% band entirely — nil directly to 20% at ₹5L", () => {
    expect(OLD_REGIME_SUPER_SENIOR_SLABS).toEqual([
      { from: 0, to: 500_000, rate: 0 },
      { from: 500_000, to: 1_000_000, rate: 0.2 },
      { from: 1_000_000, to: Infinity, rate: 0.3 },
    ]);
  });

  it("applySlabTax on the senior table: ₹7,50,000 taxable → ₹60,000 (0 + 10,000 + 50,000)", () => {
    expect(applySlabTax(750_000, OLD_REGIME_SENIOR_SLABS)).toBe(60_000);
  });

  it("applySlabTax on the super-senior table: ₹7,50,000 taxable → ₹50,000 (0 + 50,000)", () => {
    expect(applySlabTax(750_000, OLD_REGIME_SUPER_SENIOR_SLABS)).toBe(50_000);
  });

  it("applySlabTax on the below-60 table: ₹7,50,000 taxable → ₹62,500 (12,500 + 50,000) — control", () => {
    expect(applySlabTax(750_000, OLD_REGIME_SLABS)).toBe(62_500);
  });
});

describe("describeSlabs — K4-02", () => {
  it("names the senior-citizen table distinctly", () => {
    expect(describeSlabs("old", "senior")).toContain("senior-citizen");
    expect(describeSlabs("old", "senior")).toContain("3/5/10L");
  });

  it("names the super-senior-citizen table distinctly", () => {
    expect(describeSlabs("old", "super_senior")).toContain("super-senior-citizen");
    expect(describeSlabs("old", "super_senior")).toContain("5/10L");
  });

  it("names the below-60 table for a null/below_60 age band", () => {
    expect(describeSlabs("old", null)).toContain("2.5/5/10L");
    expect(describeSlabs("old", "below_60")).toContain("2.5/5/10L");
  });

  it("the new-regime description never varies with age band", () => {
    expect(describeSlabs("new")).toBe(describeSlabs("new", "senior"));
    expect(describeSlabs("new")).toBe(describeSlabs("new", "super_senior"));
  });
});
