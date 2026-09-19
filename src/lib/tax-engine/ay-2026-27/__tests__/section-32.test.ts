import { describe, expect, it } from "vitest";
import {
  computeSection32Allowance,
  section32BlockAllowancePaise,
  SECTION_32_APPENDIX_I_RATES,
} from "../section-32";

describe("section32BlockAllowancePaise (K4-20)", () => {
  it("applies the prescribed percentage to WDV at full rate", () => {
    expect(
      section32BlockAllowancePaise({
        assetClass: "plant_machinery_general_iii1",
        wdv: 1_00_000,
        putToUse: "full_rate",
      }),
    ).toBe(15_00_000);
  });

  it("takes fifty per cent of the calculated amount, not a halved rate", () => {
    // 15% of ₹1,00,000 = ₹15,000 = 1_500_000 paise; half is 750_000 paise.
    expect(
      section32BlockAllowancePaise({
        assetClass: "plant_machinery_general_iii1",
        wdv: 1_00_000,
        putToUse: "half_rate_acquired_under_180_days",
      }),
    ).toBe(7_50_000);
  });

  it("rounds the full allowance to the nearest paise before halving", () => {
    // 15% of ₹1.01 = ₹0.1515 → 15 paise; half of 15 paise rounds to 8.
    expect(
      section32BlockAllowancePaise({
        assetClass: "plant_machinery_general_iii1",
        wdv: 1.01,
        putToUse: "half_rate_acquired_under_180_days",
      }),
    ).toBe(8);
  });
});

describe("computeSection32Allowance (K4-20)", () => {
  it("sums every declared block", () => {
    expect(
      computeSection32Allowance([
        { assetClass: "furniture_fittings_ii", wdv: 50_000, putToUse: "full_rate" },
        { assetClass: "computers_iii5", wdv: 40_000, putToUse: "full_rate" },
      ]),
    ).toBe(5_000 + 16_000);
  });

  it("uses the standing rates the live PDF and three modes resolved", () => {
    expect(SECTION_32_APPENDIX_I_RATES.building_temporary_i4.ratePercent).toBe(40);
    expect(SECTION_32_APPENDIX_I_RATES.intangibles_part_b.ratePercent).toBe(25);
  });
});
