import { describe, expect, it } from "vitest";
import { DEDUCTION_CAP_80D_SENIOR, DEDUCTION_CAPS, deductionCapForSection } from "../rules";

describe("deductionCapForSection — K4-03 age-aware 80D / 80TTA / 80TTB caps", () => {
  it("80D: flat ₹25,000 for below-60 or a null (unavailable) age band", () => {
    expect(deductionCapForSection("80D", "below_60")).toBe(DEDUCTION_CAPS["80D"]);
    expect(deductionCapForSection("80D", null)).toBe(DEDUCTION_CAPS["80D"]);
  });

  it("80D: widens to ₹50,000 for senior or super-senior", () => {
    expect(deductionCapForSection("80D", "senior")).toBe(DEDUCTION_CAP_80D_SENIOR);
    expect(deductionCapForSection("80D", "super_senior")).toBe(DEDUCTION_CAP_80D_SENIOR);
    expect(DEDUCTION_CAP_80D_SENIOR).toBe(50_000);
  });

  it("80TTA: ₹10,000 for below-60 or a null age band", () => {
    expect(deductionCapForSection("80TTA", "below_60")).toBe(DEDUCTION_CAPS["80TTA"]);
    expect(deductionCapForSection("80TTA", null)).toBe(DEDUCTION_CAPS["80TTA"]);
  });

  it("80TTA: ZERO for senior or super-senior (mutually exclusive with 80TTB)", () => {
    expect(deductionCapForSection("80TTA", "senior")).toBe(0);
    expect(deductionCapForSection("80TTA", "super_senior")).toBe(0);
  });

  it("80TTB: ₹50,000 for senior or super-senior", () => {
    expect(deductionCapForSection("80TTB", "senior")).toBe(DEDUCTION_CAPS["80TTB"]);
    expect(deductionCapForSection("80TTB", "super_senior")).toBe(DEDUCTION_CAPS["80TTB"]);
  });

  it("80TTB: ZERO for below-60 or a null age band — never silently granted the senior cap", () => {
    expect(deductionCapForSection("80TTB", "below_60")).toBe(0);
    expect(deductionCapForSection("80TTB", null)).toBe(0);
  });

  // K4-05: the "80D_PARENTS" bucket — an INDEPENDENT ₹25,000/₹50,000 cap
  // driven by the insured PARENT's own senior status (a synthetic age band a
  // caller derives from the ledger's `insuredPartySenior` flag), never the
  // taxpayer's own age band.
  it("80D_PARENTS: flat ₹25,000 for a below-60 or a null (unconfirmed) parent age band", () => {
    expect(deductionCapForSection("80D_PARENTS", "below_60")).toBe(DEDUCTION_CAPS["80D_PARENTS"]);
    expect(deductionCapForSection("80D_PARENTS", null)).toBe(DEDUCTION_CAPS["80D_PARENTS"]);
    expect(DEDUCTION_CAPS["80D_PARENTS"]).toBe(25_000);
  });

  it("80D_PARENTS: widens to ₹50,000 when the PARENT age band is senior or super-senior", () => {
    expect(deductionCapForSection("80D_PARENTS", "senior")).toBe(DEDUCTION_CAP_80D_SENIOR);
    expect(deductionCapForSection("80D_PARENTS", "super_senior")).toBe(DEDUCTION_CAP_80D_SENIOR);
  });

  it("80D and 80D_PARENTS are independent caps — passing the taxpayer's own senior status to one never affects the other", () => {
    expect(deductionCapForSection("80D", "below_60")).toBe(DEDUCTION_CAPS["80D"]);
    expect(deductionCapForSection("80D_PARENTS", "senior")).toBe(DEDUCTION_CAP_80D_SENIOR);
  });

  it("every other section is age-neutral — returns its flat DEDUCTION_CAPS value regardless of age band", () => {
    for (const section of ["80C", "80CCD", "80G", "other"] as const) {
      expect(deductionCapForSection(section, "below_60")).toBe(DEDUCTION_CAPS[section]);
      expect(deductionCapForSection(section, "senior")).toBe(DEDUCTION_CAPS[section]);
      expect(deductionCapForSection(section, "super_senior")).toBe(DEDUCTION_CAPS[section]);
      expect(deductionCapForSection(section, null)).toBe(DEDUCTION_CAPS[section]);
    }
  });

  it("an unknown section falls back to Infinity (never silently zero)", () => {
    expect(deductionCapForSection("not_a_real_section", "senior")).toBe(Infinity);
  });
});
