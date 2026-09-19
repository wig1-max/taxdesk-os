/**
 * K4-12 — Section 87A rebate AND its rebate-threshold MARGINAL RELIEF for
 * AY 2026-27 / FY 2025-26. PURE — no imports beyond this engine's own
 * rules/slabs/types.
 *
 * This relief is a genuinely SEPARATE relief from the one `surcharge.ts`
 * computes, and shares only the name. It operates at the section 87A REBATE
 * ceilings (₹12,00,000 new regime / ₹5,00,000 old regime), not at the
 * ₹50,00,000 / ₹1,00,00,000 SURCHARGE thresholds, and it affects a far more
 * common population. The statutory text this implements, and the ambiguity it
 * refuses rather than guesses, are documented on
 * {@link import("./rules").REBATE_87A} — read that first. This file is the
 * arithmetic only.
 *
 * ONE AUTHORITY FOR THE WHOLE 87A DEDUCTION. Before K4-12 the ordinary rebate
 * was computed inline in `compute-tax.ts`. It is computed here instead —
 * unchanged — because clause (a) and clause (b) of the same proviso are two
 * ways of quantifying ONE statutory deduction, and splitting them across two
 * modules would be the "two places compute half a rule" shape this repository
 * keeps getting bitten by. The clause (a) arithmetic is byte-for-byte the
 * behaviour it replaced.
 *
 * FAIL-CLOSED CONTRACT. Every path either returns a figure this engine can
 * defend or returns `supported: false` with a reason. There is no path that
 * returns a best-guess number. Where a case is refused, the relief reported is
 * ZERO, so the deduction is never OVERSTATED and the tax is never
 * UNDERSTATED — but it is still marked unsupported, because "not too low" is
 * not "correct".
 *
 * `K4-PORT-03` (decision `D299`): the ceilings and maximum rebates are no
 * longer imported from `./rules`. They arrive on `Rebate87AInput.schedule` from
 * the governing pack, so the arithmetic here is Act-agnostic and every figure
 * it turns on belongs to the world that authorises it.
 */

import type { RebateSchedule } from "@/lib/tax-engine/core/statutory-rate-parameters";
import { applySlabTax, type SlabBand } from "./slabs";
import type { Regime } from "./types";

/**
 * Why the 87A deduction is (or is not) a complete treatment.
 *
 * `ordinary_rebate` and `not_applicable` are POSITIVE results, not absences:
 * a nil relief under them is a computed nil, never an unimplemented
 * placeholder.
 */
export type Rebate87ASupportState =
  /** Total income does not exceed the regime's ceiling — clause (a) applies
   *  and no relief question arises. */
  | "ordinary_rebate"
  /** No rebate and no relief can arise. Either the OLD regime above its
   *  ₹5,00,000 ceiling (where the enabling proviso does not reach at all), or
   *  the new regime above the income at which clause (b) can still produce a
   *  positive figure. */
  | "not_applicable"
  /** Clause (b) relief computed exactly. */
  | "relief_computed"
  /** Inside the clause (b) window, but the case carries special-rate
   *  111A/112A income and the reference the relief is measured against is not
   *  fixed by any located source. */
  | "unsupported_special_rate_income_present"
  /** Total income is not a finite number — the ceiling test cannot even be
   *  evaluated. Unreachable in practice; refuses rather than assuming. */
  | "unsupported_total_income_indeterminate";

export interface Rebate87ATreatment {
  readonly state: Rebate87ASupportState;
  /**
   * TRUE only when the 87A deduction is a complete, defensible treatment for
   * this case. Every enforcement layer reads THIS — never the state string,
   * and never a re-derivation of the ceiling test (D44's single-derivation
   * rule, generalised from a number to a judgement, exactly as `K4-11` did for
   * surcharge).
   */
  readonly supported: boolean;
  readonly regime: Regime;
  /** The regime's own total income the treatment was evaluated against. */
  readonly totalIncome: number;
  /** The regime's own rebate ceiling (₹12,00,000 new / ₹5,00,000 old). */
  readonly incomeLimit: number;
  /** Clause (a) rebate. Nil above the ceiling. */
  readonly ordinaryRebate: number;
  /** Clause (b) marginal relief. Nil at or below the ceiling. */
  readonly marginalRelief: number;
  /** The deduction actually allowed — `ordinaryRebate + marginalRelief`. The
   *  two are mutually exclusive by construction; one of them is always nil. */
  readonly rebate: number;
  /**
   * True when relief was proved nil under EVERY reading of the ambiguous
   * reference rather than computed exactly. A preparer reading a ₹0 relief is
   * entitled to know which of the two it is.
   */
  readonly reliefProvedNilUnderEveryReading: boolean;
  /** Plain-language statement of what was and was not done. Always present. */
  readonly message: string;
}

export interface Rebate87AInput {
  readonly regime: Regime;
  /** This regime's own total income (normal taxable + special-rate gains). */
  readonly totalIncome: number;
  /** Slab (normal-rate) tax before any rebate. */
  readonly slabTax: number;
  /** Special-rate (111A + 112A) tax. */
  readonly specialRateTax: number;
  /**
   * Special-rate (111A + 112A) income included in `totalIncome`, NET of every
   * loss set-off. Its mere PRESENCE — not its tax — is what triggers the
   * refusal; see the module doc on `REBATE_87A` for why the weaker
   * `specialRateTax > 0` test would not be safe.
   */
  readonly specialRateIncome: number;
  /**
   * The section 87A rebate schedule SUPPLIED BY THE GOVERNING PACK
   * (`K4-PORT-03`, decision `D299`) — the per-regime ceiling, the maximum
   * rebate, and whether the clause (b) marginal relief reaches that limb at all.
   *
   * This file used to import the AY world's `REBATE_87A` from `./rules`. Taking
   * it as an input is what lets the same arithmetic serve a second Act: clause
   * (a)'s "the lesser of the tax and the maximum" and clause (b)'s "the tax on
   * the excess may not exceed the excess" are mechanics, while the ceilings and
   * the availability flag are statutory figures.
   *
   * **`D170`'s old-regime CLIFF travels as the `marginalReliefAvailable: false`
   * flag, never as a branch on which Act is in play.** That is not a
   * convenience: the TY 2026-27 pack independently declares the same `false` for
   * its s.156(1) limb, on its own reading of its own Act, so the shared code
   * below expresses the cliff once and each world states whether it has one.
   */
  readonly schedule: RebateSchedule;
}

/**
 * The highest total income at which clause (b) relief can still be POSITIVE,
 * DERIVED from the slab table in play rather than stated as a literal.
 *
 * Relief is positive exactly while `slabTax(X) > X − limit`. At `X = limit`
 * the left side is the full ceiling tax and the right side is nil, and the
 * difference strictly decreases as `X` rises (every slab rate is below 100%),
 * so there is exactly one crossing. This walks the bands and solves for it.
 *
 * Returns `null` for the OLD regime, where clause (b) does not reach at all.
 *
 * This exists to be ASSERTED against, not just documented: the bound it
 * returns is what proves 87A relief and surcharge can never both be live for
 * one case (the bound sits far below `SURCHARGE.entryThreshold`), and what the
 * reliance-blocker's income pre-gate is checked against.
 */
export function rebateReliefUpperIncomeBound(
  schedule: RebateSchedule,
  regime: Regime,
  slabs: readonly SlabBand[],
): number | null {
  if (!schedule[regime].marginalReliefAvailable) return null;
  const limit: number = schedule[regime].incomeLimit;
  let x = limit;
  let f = applySlabTax(limit, slabs);
  if (f <= 0) return limit;
  for (const band of slabs) {
    if (band.to <= x) continue;
    const lower = Math.max(x, band.from);
    const slope = band.rate - 1; // strictly negative: every slab rate is < 100%
    if (slope >= 0) return Infinity;
    const fAtUpper = f + slope * (band.to - lower);
    if (fAtUpper <= 0) return lower + f / -slope;
    f = fAtUpper;
    x = band.to;
  }
  return Infinity;
}

/**
 * `REBATE_RELIEF_WINDOW_UPPER_INR` — the same bound as an integer, rounded UP,
 * for the enforcement layers that cannot evaluate a slab table: the SQL
 * reliance-blocker helpers, which must compare a stored total income against a
 * literal.
 *
 * Rounding UP is the safe direction — it can only widen the window a blocker
 * examines, never narrow it below the income at which relief is genuinely due.
 * `__tests__/rebate-relief.test.ts` pins it to the derived bound within one
 * rupee and fails if the slab table ever moves the bound past it, so the SQL
 * literal cannot silently drift away from the engine.
 */
export const REBATE_RELIEF_WINDOW_UPPER_INR = 12_70_589;

export function computeRebate87A(input: Rebate87AInput): Rebate87ATreatment {
  // No slab table is needed here, and that is a RESULT, not an omission: unlike
  // the surcharge relief, whose reference is "income-tax on a notional total
  // income of ₹50,00,000" and therefore has to re-run the slab table, clause
  // (b)'s reference is a monetary EXCESS OF INCOME. Every figure it needs has
  // already been computed.
  const { regime, totalIncome, slabTax, specialRateTax, specialRateIncome, schedule } = input;
  const cfg = schedule[regime];
  const limit = cfg.incomeLimit;

  const base = {
    regime,
    totalIncome,
    incomeLimit: limit,
    ordinaryRebate: 0,
    marginalRelief: 0,
    rebate: 0,
    reliefProvedNilUnderEveryReading: false,
  } as const;

  if (!Number.isFinite(totalIncome)) {
    return {
      ...base,
      state: "unsupported_total_income_indeterminate",
      supported: false,
      message:
        "Total income is not a finite figure, so the section 87A ceiling test cannot be evaluated and no " +
        "rebate or relief is allowed. This is a defect upstream of the rebate, not a tax outcome (CA-verify).",
    };
  }

  // ── Clause (a): total income does not exceed the ceiling ──────────────────
  if (totalIncome <= limit) {
    const ordinary = Math.min(slabTax, cfg.maxRebate);
    return {
      ...base,
      state: "ordinary_rebate",
      supported: true,
      ordinaryRebate: ordinary,
      rebate: ordinary,
      message:
        `Section 87A rebate of ₹${Math.round(ordinary)} allowed: total income ₹${Math.round(totalIncome)} does ` +
        `not exceed ₹${limit}, so the deduction is the lesser of the slab tax (₹${Math.round(slabTax)}) and ` +
        `₹${cfg.maxRebate}. No marginal relief question arises at or below the ceiling.`,
    };
  }

  // ── Above the ceiling, OLD regime: the enabling proviso does not reach ────
  //
  // This is a POSITIVE finding, not a gap. The clause (b) marginal relief sits
  // inside the proviso opening "Provided that where the total income of the
  // assessee is chargeable to tax under sub-section (1A) of section 115BAC" —
  // it is new-regime-only. The old regime's ₹5,00,000 rebate therefore has a
  // genuine CLIFF, which is exactly why "keep total income at or below
  // ₹5,00,000" is standard old-regime advice. See REBATE_87A's module doc for
  // the sourcing, including the one secondary publisher that disagrees and why
  // the primary text is preferred over it.
  if (!cfg.marginalReliefAvailable) {
    return {
      ...base,
      state: "not_applicable",
      supported: true,
      message:
        `No section 87A rebate: total income ₹${Math.round(totalIncome)} exceeds ₹${limit}. No marginal relief ` +
        "arises either — the clause (b) relief sits inside the proviso conditioned on section 115BAC(1A), so it " +
        "reaches the NEW regime only, and the old-regime ceiling is a genuine cliff. This ₹0 is a computed nil " +
        "grounded in the statute's structure, not an unimplemented placeholder (CA-verify).",
    };
  }

  // ── Above the ceiling, NEW regime: clause (b) territory ───────────────────
  const excess = totalIncome - limit;

  // The second proviso (inserted by the Finance Act, 2025) caps the deduction
  // at "the amount of income-tax payable as per the rates provided in
  // sub-section (1A) of section 115BAC" — i.e. at the SLAB tax. That phrase is
  // the least ambiguous in the whole provision and is applied as written.
  const cap = Math.max(0, slabTax);

  if (specialRateIncome <= 0) {
    // Unambiguous: every rupee of total income is slab income, so "the
    // income-tax payable on such total income" can only be the slab tax.
    const relief = Math.min(cap, Math.max(0, slabTax - excess));
    if (relief <= 0) {
      return {
        ...base,
        state: "not_applicable",
        supported: true,
        message:
          `No section 87A rebate or marginal relief: total income ₹${Math.round(totalIncome)} exceeds ₹${limit} ` +
          `by ₹${Math.round(excess)}, which is not less than the income-tax on it (₹${Math.round(slabTax)}), so ` +
          "clause (b) yields nothing. This ₹0 is a computed nil.",
      };
    }
    return {
      ...base,
      state: "relief_computed",
      supported: true,
      marginalRelief: relief,
      rebate: relief,
      message:
        `Section 87A marginal relief of ₹${Math.round(relief)} allowed: total income ₹${Math.round(totalIncome)} ` +
        `exceeds ₹${limit} by ₹${Math.round(excess)}, and the income-tax on it (₹${Math.round(slabTax)}) exceeds ` +
        "that, so the deduction is the difference — the tax on the excess may not exceed the excess itself. " +
        `Capped at the income-tax payable at section 115BAC(1A) rates (₹${Math.round(cap)}) by the second proviso.`,
    };
  }

  // ── Ambiguous: the case carries special-rate 111A/112A income ─────────────
  //
  // Bound the relief from ABOVE by taking the LARGEST reading of "the
  // income-tax payable on such total income" — slab tax PLUS special-rate tax
  // — and applying the second proviso's cap. If even that is nil, relief is
  // nil under every reading and the figure is safe.
  const reliefUpperBound = Math.min(cap, Math.max(0, slabTax + specialRateTax - excess));

  if (reliefUpperBound <= 0) {
    return {
      ...base,
      state: "not_applicable",
      supported: true,
      reliefProvedNilUnderEveryReading: true,
      message:
        `No section 87A rebate or marginal relief: total income ₹${Math.round(totalIncome)} exceeds ₹${limit} by ` +
        `₹${Math.round(excess)}. This case carries special-rate 111A/112A income, so what counts as "the ` +
        'income-tax payable on such total income" is not fixed by any located source — but relief is nil under ' +
        `EVERY reading of it (proved by bounding that figure from above at ₹${Math.round(slabTax + specialRateTax)}, ` +
        "the whole income-tax before surcharge and cess). No reading was assumed.",
    };
  }

  return {
    ...base,
    state: "unsupported_special_rate_income_present",
    supported: false,
    // ZERO, never a guess. The deduction is never overstated, so the tax is
    // never understated. Still unsupported: a figure that is merely "not too
    // low" is not a correct figure.
    message:
      `NO section 87A marginal relief was applied and this case is NOT reliance-ready. Relief may be due (up to ` +
      `about ₹${Math.round(reliefUpperBound)}) — total income ₹${Math.round(totalIncome)} exceeds ₹${limit} by ` +
      `₹${Math.round(excess)}, which is less than the income-tax on it — but the case carries special-rate ` +
      "111A/112A income and TWO questions are unresolved by any located source: whether the section 87A " +
      "deduction is available at all where the total income includes such gains, and, if it is, whether \"the " +
      "income-tax payable on such total income\" in clause (b) means the slab tax alone or the slab tax plus " +
      "the special-rate tax. The two readings give different relief. No reading was assumed and no relief was " +
      "applied, so the tax shown is not understated. A professional must compute the relief manually " +
      "(CA-verify).",
  };
}
