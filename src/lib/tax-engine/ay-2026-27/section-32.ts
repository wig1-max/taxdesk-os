/**
 * K4-20 — Section 32(1)(ii) depreciation on a closed set of Appendix I
 * standing classes, AY 2026-27 / Income-tax Act, 1961.
 *
 * PURE. The prescribed percentages live here and nowhere else. The ledger
 * vocabulary (`DEPRECIATION_ASSET_CLASSES` in tax-desk/ledger.ts) is pinned
 * to these keys in both directions by `business-books-vocabulary.test.ts`.
 *
 * SOURCE, not memory (`D324` / `D302`). Every rate this module quotes was
 * resolved on 2026-08-18 against:
 *   1. the live PDF `K4-SOURCE-02-S4` (hash
 *      83a58dc404627a652e0a7f23170957c9d719d0626ad490a43d78efcf1fcde036,
 *      bytes 1005509, HASH_MATCH);
 *   2. the committed three-mode extract
 *      `docs/evidence/statutory-sources/extracts/ay-2026-27/income-tax-rules-1962-new-appendix-I.txt`;
 *   3. the live PDF pages rendered as images (the `-layout` extract is
 *      BROKEN on item I(4) and on Part B — see the per-class notes).
 *
 * THIS IS THE 1962 NEW APPENDIX I (rule 5), not Rules 2026 Appendix I
 * (`D301` / `D324`). Rules 2026 source s.33 of the 2025 Act. Do not
 * conflate them.
 *
 * WHAT THIS MODULE DOES NOT DO, stated so a later session does not grow it
 * silently:
 *   - time-window Appendix I rows (2019-20 motor-car 30%, 1998-2009
 *     commercial-vehicle rows, TUFS 2001-04). Those windows closed years
 *     before FY 2025-26 and are not in the standing set;
 *   - specialised classes whose `-raw` pairing is a grouped brace (pollution
 *     control, energy-saving devices, ships, medical equipment, …). An
 *     undeclared or unreadable class REFUSES — it is never guessed;
 *   - s.32(1)(i) power-generation actual-cost depreciation;
 *   - s.32(1)(iia) additional depreciation (20% of actual cost). Claimed →
 *     refused by the adapter;
 *   - s.32(2) unabsorbed depreciation carry-forward;
 *   - s.43(6)(c) written-down-value *arithmetic*. The preparer declares the
 *     WDV of the block; this module only multiplies it by the prescribed
 *     percentage. Explanation 2 to s.32(1) says WDV "shall have the same
 *     meaning as in clause (c) of sub-section (6) of section 43" — we do
 *     not implement that clause.
 */

import type { DepreciationAssetClass, DepreciationPutToUse } from "./rules";

export interface Section32Block {
  assetClass: DepreciationAssetClass;
  /** Written-down value of the block, as declared. Section 32(1)(ii)
   *  applies "such percentage on the written down value thereof as may be
   *  prescribed". */
  wdv: number;
  putToUse: DepreciationPutToUse;
}

export interface Section32ClassSpec {
  /** Appendix I percentage of WDV, after the IT (Twenty-ninth Amdt.)
   *  Rules, 2016 substitutions that the consolidation prints as n[40]. */
  ratePercent: number;
  /** The Appendix I item this class is. */
  appendixItem: string;
  /** How the rate was resolved. Not rendered. */
  resolvedFrom: string;
}

/**
 * Standing Appendix I classes this slice will quote. Closed, total, and
 * the only set `computeSection32Allowance` will multiply. A class that is
 * not a key here cannot reach the multiplier.
 *
 * Footnote substitutions (page 5 of the live PDF): ¹[40] / ⁸[40] mean the
 * figure 40, substituted for 100 and 60 respectively by the IT
 * (Twenty-ninth Amdt.) Rules, 2016, w.e.f. 1-4-2017. The live PDF prints
 * the substituted figure, not the retired one.
 */
export const SECTION_32_APPENDIX_I_RATES: {
  readonly [K in DepreciationAssetClass]: Section32ClassSpec;
} = {
  building_residential_i1: {
    ratePercent: 5,
    appendixItem: "Part A, item I(1)",
    resolvedFrom:
      "I(1) 'Buildings which are used mainly for residential purposes except hotels and boarding houses' " +
      "carries 5 on its own line in -layout, default, -raw, and the live PDF page 1.",
  },
  building_other_i2: {
    ratePercent: 10,
    appendixItem: "Part A, item I(2)",
    resolvedFrom:
      "I(2) 'Buildings other than those used mainly for residential purposes…' carries 10 on the " +
      "live PDF page 1 and on its own line in -raw. Default mode groups I(2)/I(3)/I(4) then " +
      "'10 1[40] 1[40]'. -layout puts 10 on I(2) and then offsets 1[40] onto the wrong rows.",
  },
  building_temporary_i4: {
    ratePercent: 40,
    appendixItem: "Part A, item I(4)",
    resolvedFrom:
      "I(4) 'Purely temporary erections such as wooden structures' carries ¹[40] on the live PDF " +
      "page 1 and on the SAME LINE in -raw. -layout is BROKEN here (no rate on the I(4) line; " +
      "1[40] appears twice offset onto I(2)/I(3)). Default mode's '10 1[40] 1[40]' after the " +
      "I(2)/I(3)/I(4) group agrees with the live PDF and -raw once I(2)=10 is taken off. " +
      "Footnote 1: substituted for 100, so the current figure is 40.",
  },
  furniture_fittings_ii: {
    ratePercent: 10,
    appendixItem: "Part A, item II",
    resolvedFrom:
      "II 'Furniture and fittings including electrical fittings' carries 10 on its own line in " +
      "all three modes and on the live PDF page 1.",
  },
  plant_machinery_general_iii1: {
    ratePercent: 15,
    appendixItem: "Part A, item III(1)",
    resolvedFrom:
      "III(1) 'Machinery and plant other than those covered by sub-items (2), (3) and (8)' " +
      "carries 15 on its own line in all three modes and on the live PDF page 1.",
  },
  motor_car_not_hire_iii2i: {
    ratePercent: 15,
    appendixItem: "Part A, item III(2)(i)",
    resolvedFrom:
      "III(2)(i) 'Motor cars, other than those used in a business of running them on hire, " +
      "acquired or put to use on or after the 1st day of April, 1990 except those covered under " +
      "entry (ii)' carries 15 on the live PDF page 1 and in -raw (15 on the line after the " +
      "item). The 2019-20 window in (ii) at 30% is NOT this class.",
  },
  motor_hire_iii3iia: {
    ratePercent: 30,
    appendixItem: "Part A, item III(3)(ii)(a)",
    resolvedFrom:
      "III(3)(ii)(a) 'Motor buses, motor lorries and motor taxis used in a business of running " +
      "them on hire other than those covered under entry (b)' carries 30 on the live PDF page 1 " +
      "and in -raw. The 2019-20 window in (b) at 45% is NOT this class.",
  },
  computers_iii5: {
    ratePercent: 40,
    appendixItem: "Part A, item III(5)",
    resolvedFrom:
      "III(5) 'Computers including computer software' carries ⁸[40] on the live PDF page 2 and " +
      "[40] on its own line in -raw. Footnote 8: substituted for 60, so the current figure is 40.",
  },
  intangibles_part_b: {
    ratePercent: 25,
    appendixItem: "Part B",
    resolvedFrom:
      "Part B 'Know-how, patents, copyrights, trademarks, licences, franchises or any other " +
      "business or commercial rights of similar nature' carries 25 on the live PDF page 5. " +
      "Default mode emits '20 20 20' (the three ship rows) then 25 on Part B. -layout is " +
      "BROKEN here too: it puts 25 on the speed-boats line (IV(3)); the live PDF shows 20 " +
      "for every ship row and 25 for Part B. Speed boats are NOT in this standing set.",
  },
};

function toPaise(n: number): number {
  return Math.round(n * 100);
}

/**
 * Section 32(1)(ii) allowance for one declared block.
 *
 * Full-rate: WDV × prescribed percentage.
 * Half-rate: fifty per cent of that amount — the second proviso to
 * s.32(1), which restricts the deduction where an asset is acquired
 * during the previous year and put to use for less than 180 days.
 *
 * Half is taken of the *calculated* full allowance (paise-rounded), not
 * as a halved rate, because the proviso says "fifty per cent of the
 * amount calculated at the percentage prescribed".
 */
export function section32BlockAllowancePaise(block: Section32Block): number {
  const spec = SECTION_32_APPENDIX_I_RATES[block.assetClass];
  const fullPaise = Math.round((toPaise(block.wdv) * spec.ratePercent) / 100);
  if (block.putToUse === "half_rate_acquired_under_180_days") {
    return Math.round(fullPaise / 2);
  }
  return fullPaise;
}

/** Sum of every block's Section 32(1)(ii) allowance, in rupees. */
export function computeSection32Allowance(blocks: readonly Section32Block[]): number {
  const paise = blocks.reduce((sum, block) => sum + section32BlockAllowancePaise(block), 0);
  return paise / 100;
}
