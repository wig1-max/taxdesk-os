/**
 * Slab tables for AY 2026-27 / FY 2025-26. PURE — no external imports.
 *
 * Sources (verify against the bare Act / Finance Act before client reliance):
 *  - New regime slabs (s.115BAC, as amended by Finance Act 2025): basic
 *    exemption raised to ₹4,00,000; seven-slab structure below.
 *  - Old regime slabs (individuals below 60): unchanged.
 *  - Old regime senior/super-senior basic-exemption widening (K4-02): Finance
 *    Act, 2025, First Schedule, Part III (rate paragraphs for a resident
 *    individual aged 60+/<80 and 80+, "at any time during the previous
 *    year"), corroborated by the Income Tax Department's own AY 2026-27
 *    "Senior Citizens and Super Senior Citizens" help page (directly
 *    retrieved 2026-07-25) and an independent secondary tax-law publisher
 *    (ClearTax, retrieved 2026-07-25) — see the pack provenance entry
 *    `senior_super_senior_basic_exemption_widening`
 *    (`src/lib/tax-pack/packs/ay-2026-27-provenance.ts`) for full citation.
 *    NEW-regime-only widening does not exist — the new regime's slabs are
 *    age-neutral for every age band.
 *
 * TODO(CA-verify): confirm slab boundaries and that no further mid-year
 * amendment applies for FY 2025-26.
 */

import type {
  ComputationRateFigures,
  OldRegimeSlabTables,
  SlabBandShape,
} from "@/lib/tax-engine/core/statutory-rate-parameters";
import type { Regime, TaxpayerProfile } from "./types";

/** Reuses the engine's OWN placeholder enum — never a second, competing one. */
export type TaxpayerAgeBand = NonNullable<TaxpayerProfile["ageCategory"]>;

/**
 * One slab band.
 *
 * `K4-PORT-03`: this is now an ALIAS of the shared core's `SlabBandShape`
 * rather than a second declaration of the same three fields. Two structurally
 * identical types are not a problem until they stop being identical, and the
 * moment the arithmetic started receiving its tables from the pack boundary
 * instead of importing them, "structurally identical" became load-bearing
 * rather than incidental. One shape, owned by the Act-agnostic core, is what
 * lets the same `applySlabTax` serve a second statutory world.
 */
export type SlabBand = SlabBandShape;

/**
 * New regime (default) slabs — FY 2025-26 / AY 2026-27.
 *   0 – 4,00,000       : nil
 *   4,00,001 – 8,00,000 : 5%
 *   8,00,001 – 12,00,000: 10%
 *   12,00,001 – 16,00,000: 15%
 *   16,00,001 – 20,00,000: 20%
 *   20,00,001 – 24,00,000: 25%
 *   above 24,00,000     : 30%
 */
export const NEW_REGIME_SLABS: readonly SlabBand[] = [
  { from: 0, to: 400_000, rate: 0 },
  { from: 400_000, to: 800_000, rate: 0.05 },
  { from: 800_000, to: 1_200_000, rate: 0.1 },
  { from: 1_200_000, to: 1_600_000, rate: 0.15 },
  { from: 1_600_000, to: 2_000_000, rate: 0.2 },
  { from: 2_000_000, to: 2_400_000, rate: 0.25 },
  { from: 2_400_000, to: Infinity, rate: 0.3 },
];

/**
 * Old regime slabs — individual below 60 (resident).
 *   0 – 2,50,000        : nil
 *   2,50,001 – 5,00,000  : 5%
 *   5,00,001 – 10,00,000 : 20%
 *   above 10,00,000      : 30%
 */
export const OLD_REGIME_SLABS: readonly SlabBand[] = [
  { from: 0, to: 250_000, rate: 0 },
  { from: 250_000, to: 500_000, rate: 0.05 },
  { from: 500_000, to: 1_000_000, rate: 0.2 },
  { from: 1_000_000, to: Infinity, rate: 0.3 },
];

/**
 * Old regime slabs — resident senior citizen (60 to <80). Basic exemption
 * widened to ₹3,00,000; the 5%/20%/30% bands and boundaries above that are
 * otherwise IDENTICAL to the below-60 table (K4-02).
 *   0 – 3,00,000        : nil
 *   3,00,001 – 5,00,000  : 5%
 *   5,00,001 – 10,00,000 : 20%
 *   above 10,00,000      : 30%
 */
export const OLD_REGIME_SENIOR_SLABS: readonly SlabBand[] = [
  { from: 0, to: 300_000, rate: 0 },
  { from: 300_000, to: 500_000, rate: 0.05 },
  { from: 500_000, to: 1_000_000, rate: 0.2 },
  { from: 1_000_000, to: Infinity, rate: 0.3 },
];

/**
 * Old regime slabs — resident super-senior citizen (80+). Basic exemption
 * widened to ₹5,00,000, which absorbs the entire 5% band — the taxpayer goes
 * directly from nil to 20% (K4-02).
 *   0 – 5,00,000        : nil
 *   5,00,001 – 10,00,000 : 20%
 *   above 10,00,000      : 30%
 */
export const OLD_REGIME_SUPER_SENIOR_SLABS: readonly SlabBand[] = [
  { from: 0, to: 500_000, rate: 0 },
  { from: 500_000, to: 1_000_000, rate: 0.2 },
  { from: 1_000_000, to: Infinity, rate: 0.3 },
];

/**
 * The old-regime slab FAMILY as one value, in the shared core's shape.
 *
 * `K4-PORT-03` moved this wrapper here from
 * `src/lib/tax-pack/packs/ay-2026-27-rate-parameters.ts`, where `K4-PORT-02`
 * assembled it. The move matters: the pack now imports THIS object by
 * reference, so the family the pack DECLARES and the family the arithmetic
 * RECEIVES are the same object rather than two objects that happen to hold the
 * same three arrays. A test asserts that identity member by member.
 *
 * The three arrays inside are the engine's own, by reference (`D6`).
 */
export const AY_2026_27_OLD_REGIME_SLAB_TABLES: OldRegimeSlabTables = Object.freeze({
  below60: OLD_REGIME_SLABS,
  senior: OLD_REGIME_SENIOR_SLABS,
  superSenior: OLD_REGIME_SUPER_SENIOR_SLABS,
});

/**
 * Select the slab table for a regime and age band FROM THE TABLES SUPPLIED BY
 * THE GOVERNING PACK (`K4-PORT-03`, decision `D299`).
 *
 * This function used to close over the module constants above. It now takes
 * them, and the difference is the whole point of slice 2: the SELECTION RULE —
 * new regime is age-neutral, the old regime widens the basic exemption for a
 * resident senior / super-senior — is Act-agnostic ARITHMETIC and is shared,
 * while the TABLES are statutory figures and arrive from the world that
 * authorises them. There is no per-Act branch here and none may be added
 * (`D299`): a world whose Act has no old-regime family withholds the parameter,
 * and its pack then carries no computation surface at all, so this function is
 * never reached with a table it should not have.
 *
 * `ageBand` is consulted ONLY for the old regime — the new regime's slabs are
 * age-neutral (K4-02). Callers are responsible for supplying `"below_60"` (or
 * omitting `ageBand`) unless the taxpayer is a RESIDENT senior/super-senior —
 * this function does not itself know or check residency; see
 * `compute-tax.ts`'s `computeRegime` for the residency + regime gate.
 */
export function slabsForRegime(
  figures: Pick<ComputationRateFigures, "newRegimeSlabs" | "oldRegimeSlabs">,
  regime: Regime,
  ageBand?: TaxpayerAgeBand | null,
): readonly SlabBand[] {
  if (regime === "new") return figures.newRegimeSlabs;
  if (ageBand === "senior") return figures.oldRegimeSlabs.senior;
  if (ageBand === "super_senior") return figures.oldRegimeSlabs.superSenior;
  return figures.oldRegimeSlabs.below60;
}

/** Apply a slab table to a (non-negative) slab income. Returns un-rounded tax. */
/**
 * "the maximum amount which is not chargeable to income-tax" — the phrase
 * s.112(1)(a)'s first proviso (and s.111A's) uses.
 *
 * DERIVED from the supplied table rather than restated as a constant, so a
 * senior or super-senior widening, a regime change or a future statutory
 * world cannot leave a second copy of this number behind to go stale. It is
 * the top of the leading nil-rate band; a table whose first band is not nil
 * yields 0, which is the safe answer rather than a guess.
 */
export function maximumAmountNotChargeable(slabs: readonly SlabBand[]): number {
  let ceiling = 0;
  for (const band of slabs) {
    if (band.rate !== 0) break;
    ceiling = Math.max(ceiling, band.to);
  }
  return ceiling;
}

export function applySlabTax(income: number, slabs: readonly SlabBand[]): number {
  const taxable = Math.max(0, income);
  let tax = 0;
  for (const band of slabs) {
    if (taxable <= band.from) break;
    const upper = Math.min(taxable, band.to);
    tax += (upper - band.from) * band.rate;
  }
  return tax;
}

/**
 * Human-readable slab description for formula strings.
 *
 * **DELIBERATELY NOT PARAMETERISED, and this is a limitation rather than an
 * oversight (`K4-PORT-03`).** These strings are AUTHORED PROSE describing the
 * AY 2026-27 tables — "0/5/10/15/20/25/30% over 4/8/12/16/20/24L" — not a
 * rendering of whatever table is in play. Under a second statutory world with
 * different rates they would be wrong. Deriving them from the supplied table is
 * the obvious fix and is NOT taken here, because a derived string would not
 * reproduce these characters and every formula string is engine OUTPUT: slice
 * 2's acceptance criterion is byte-identical output (`D309`), so changing one
 * is a `D276` event, not a tidy-up. It belongs to the session that gives the
 * second world real rates and can move both together.
 */
export function describeSlabs(regime: Regime, ageBand?: TaxpayerAgeBand | null): string {
  if (regime === "new") return "new-regime slabs (0/5/10/15/20/25/30% over 4/8/12/16/20/24L)";
  if (ageBand === "senior") return "old-regime senior-citizen slabs (0/5/20/30% over 3/5/10L)";
  if (ageBand === "super_senior") return "old-regime super-senior-citizen slabs (0/20/30% over 5/10L)";
  return "old-regime slabs (0/5/20/30% over 2.5/5/10L)";
}
