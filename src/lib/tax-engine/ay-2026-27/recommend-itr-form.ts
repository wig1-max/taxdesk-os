/**
 * Basic ITR-1 vs ITR-2 recommendation for AY 2026-27. PURE — no external
 * imports. K.2.0 scope: distinguish simple salary/interest/dividend/other-
 * sources cases (ITR-1) from cases that require ITR-2 (capital gains, foreign
 * assets, high income). Business/professional cases are flagged out of scope.
 */

import type { ItrFormRateFigures } from "@/lib/tax-engine/core/statutory-rate-parameters";
import { computeTax } from "./compute-tax";
import { AY_2026_27_ITR_FORM_FIGURES } from "./rate-figures";
import { taxableGainOf } from "./compute-tax";
import type { ItrFormRecommendation, TaxEngineInput } from "./types";

/**
 * `K4-PORT-03` (decision `D299`): the ITR-1 income ceiling is no longer
 * imported from `./rules` — it arrives on `figures` from the governing pack,
 * alongside the computation figures this function needs because it calls
 * `computeTax` for the total income it tests.
 *
 * **That second half is the correction this session made to
 * `ENTRY_POINT_REQUIREMENTS`.** `K4-PORT-02` recorded this entry point as
 * needing the ceiling ALONE, on the reasoning that it selects a form and does
 * not price anything. True of its purpose, false of its code: `computeTax` is
 * called below, so a world supplying only a ceiling could not serve it. The
 * error was latent — the one world that withholds anything withholds the
 * ceiling too — but it is fixed rather than left, and the structural guard that
 * missed it now scans this file as well.
 */
export function recommendItrForm(
  input: TaxEngineInput,
  figures: ItrFormRateFigures = AY_2026_27_ITR_FORM_FIGURES,
): ItrFormRecommendation {
  const blockers: string[] = [];
  const reasons: string[] = [];
  const notes: string[] = [];

  const hasCapitalGains = input.capitalGains.some((cg) => taxableGainOf(cg) > 0);
  const hasBusinessIncome = input.income.some(
    (e) => e.category === "business_income" && e.amount > 0,
  );
  // K4-07: presumptive professional income (Section 44ADA) — a COMPUTED
  // income category, distinct from the `business_income` placeholder above.
  const hasPresumptive44adaIncome = input.income.some(
    (e) => e.category === "presumptive_professional_44ada" && e.amount > 0,
  );
  // K4-08: presumptive BUSINESS income (Section 44AD) — also a COMPUTED
  // category. Both presumptive schemes route to the SAME ITR-4 (Sugam)
  // resolution below (the ITD's own guidance treats 44AD/44ADA/44AE
  // identically for form applicability), so they are combined into one
  // signal here rather than given a second, parallel resolution path.
  const hasPresumptive44adIncome = input.income.some(
    (e) =>
      (e.category === "presumptive_business_44ad_digital" ||
        e.category === "presumptive_business_44ad_cash") &&
      e.amount > 0,
  );
  const hasPresumptiveIncome = hasPresumptive44adaIncome || hasPresumptive44adIncome;
  // Each presumptive scheme present contributes exactly one ITR-1 blocker
  // below; the ITR-4 branch fires when those are the ONLY blockers.
  const presumptiveBlockerCount =
    (hasPresumptive44adaIncome ? 1 : 0) + (hasPresumptive44adIncome ? 1 : 0);
  const presumptiveSchemeLabel =
    hasPresumptive44adaIncome && hasPresumptive44adIncome
      ? "Presumptive professional (Section 44ADA) and business (Section 44AD) income"
      : hasPresumptive44adaIncome
        ? "Presumptive professional income (Section 44ADA)"
        : "Presumptive business income (Section 44AD)";
  const housePropertyEntries = input.housePropertyEntries ?? [];
  const hasHouseProperty = housePropertyEntries.length > 0;
  // K4-14: BOOKS-based business/professional income — a COMPUTED category,
  // and the one case in this file with an unambiguous positive answer. ITR-3
  // is the form for business or professional income NOT returned
  // presumptively; ITR-4 is presumptive-only and ITR-2 admits no business
  // income at all. So unlike `hasBusinessIncome` (the uncomputed placeholder,
  // which still steers to a CA note) this one resolves positively, and it
  // DOMINATES: a books case plus capital gains is still ITR-3, because ITR-2
  // could not carry the business income and ITR-4 could not carry the books.
  //
  // AUDIT-08-F2 (decision D243): PRESENCE, not magnitude — `length > 0`, the
  // same shape as `hasHouseProperty` above. This previously tested
  // `revenue - expenses > 0`, which broke the dominance it documents at
  // exactly the break-even boundary. The adapter refuses only a NEGATIVE
  // whole-head aggregate (`BUSINESS_BOOKS_LOSS_NOT_MODELLED`), so a break-even
  // business — revenue equal to expenses, or a dormant registered business at
  // 0/0 — arrives here as a fully ACCEPTED, computable books entry. Under the
  // old test it set no blocker, and the case then resolved to **ITR-4** when
  // combined with presumptive income and to **ITR-2** when combined with
  // capital gains: both forms this very comment says cannot carry it, and the
  // ITR-4 branch printed "with no ... books-based business income" about a
  // case that had some. Which form applies turns on the NATURE of the income
  // present, never on how large it is. Over-selecting ITR-3 is the safe
  // direction (it is the most capable form); under-selecting ITR-4/ITR-2 is
  // the error, so presence is the correct test.
  const hasBusinessBooksIncome = (input.businessBooksEntries ?? []).length > 0;

  // Total income drives the ITR-1 ceiling test (recommended-regime figure).
  const computation = computeTax(input, figures);
  const totalIncome = computation.totalIncome.value;
  // K4-06: the recommended regime's OWN house-property treatment (not the
  // top-line GTI's old-regime-reference figure) — whichever regime is
  // actually recommended is what this eligibility check should reflect.
  const recommendedRegimeComputation =
    computation.recommendedRegime === "old" ? computation.oldRegime : computation.newRegime;
  const hasHousePropertyLoss = recommendedRegimeComputation.housePropertyIncome.value < 0;

  if (hasCapitalGains) {
    blockers.push(
      input.capitalGains.some((cg) => cg.category === "house_sale")
        ? "Capital gains present — ITR-1 not permitted."
        : "Capital gains present (STCG 111A / LTCG 112A) — ITR-1 not permitted.",
    );
  }
  if (input.hasForeignAssets) {
    blockers.push("Foreign assets flagged — ITR-1 not permitted (Schedule FA requires ITR-2).");
  }
  if (totalIncome > figures.itrFormIncomeCeiling) {
    blockers.push(
      `Total income ₹${totalIncome} exceeds the ITR-1 ceiling of ₹${figures.itrFormIncomeCeiling}.`,
    );
  }
  if (hasBusinessIncome) {
    blockers.push(
      "Business / professional income present — ITR-1 not permitted (likely ITR-3/ITR-4, out of K.2.0 scope).",
    );
    notes.push("Business income detected: ITR-3/ITR-4 selection is out of K.2.0 scope — CA to confirm.");
  }
  if (hasPresumptive44adaIncome) {
    blockers.push(
      "Presumptive professional income (Section 44ADA) present — ITR-1 not permitted (ITR-4/Sugam applies " +
        "for a presumptive-only case; ITR-3 if other complications also apply).",
    );
  }
  if (hasPresumptive44adIncome) {
    blockers.push(
      "Presumptive business income (Section 44AD) present — ITR-1 not permitted (ITR-4/Sugam applies " +
        "for a presumptive-only case; ITR-3 if other complications also apply).",
    );
  }
  if (hasBusinessBooksIncome) {
    blockers.push(
      "Books-based business or professional income present — ITR-1 not permitted (ITR-3 applies for " +
        "income computed from books rather than presumptively).",
    );
  }
  if (hasHousePropertyLoss) {
    // ITR-1 does not permit a house-property loss (current-year or
    // brought-forward) — a genuine blocker, not merely a note (K4-06).
    blockers.push(
      "House property shows a net loss under the recommended regime — ITR-1 does not permit a house-property loss.",
    );
  } else if (hasHouseProperty) {
    // A single self-occupied / let-out house with no loss is allowed in
    // ITR-1 (this session's single-property scope cannot yet distinguish
    // every ITR-1 nuance, e.g. co-ownership) — note only.
    notes.push(
      "House property present: ITR-1 allows only one house property with no loss — CA to confirm eligibility.",
    );
  }

  let recommendedItrType: ItrFormRecommendation["recommendedItrType"];
  if (blockers.length === 0) {
    recommendedItrType = "ITR-1";
    reasons.push("Simple salary / interest / dividend / other-sources case with no capital gains, foreign assets, or business income.");
  } else if (hasBusinessBooksIncome) {
    // K4-14: checked BEFORE the presumptive branch, because it dominates it.
    // A case with both a books business and presumptive income cannot be
    // ITR-4 (which admits presumptive income only) — ITR-3 is the only form
    // that carries both. Placing this branch second-to-first is what makes
    // that ordering explicit rather than emergent from blocker counting.
    recommendedItrType = "ITR-3";
    reasons.push(
      "Business or professional income computed from books of account (not presumptively) — ITR-3 " +
        "applies. ITR-1 and ITR-4 do not permit books-based business income and ITR-2 permits no " +
        "business income at all.",
    );
    notes.push(
      "Section 115BAC(6): with business income, opting out of the new regime requires Form 10-IEA by the " +
        "Section 139(1) due date, and the option once withdrawn cannot be exercised again — this product " +
        "neither files nor tracks that form.",
    );
  } else if (hasPresumptiveIncome && blockers.length === presumptiveBlockerCount) {
    // K4-07: the ONLY reason ITR-1 is blocked is presumptive income itself —
    // no capital gains, foreign assets, business income, or house-property
    // loss — which are exactly ITR-4 (Sugam)'s own eligibility conditions
    // (independently sourced: total income within the SAME ceiling as
    // ITR-1's, at most one house property with no loss, and only
    // salary/interest/one-house-property/presumptive income). Extended
    // positively here (unlike the general business-income path below)
    // because this specific condition set is directly sourced, not guessed.
    // K4-08 generalised the count so a case declaring BOTH 44ADA and 44AD
    // income (each contributing its own blocker) still resolves to ITR-4 —
    // ITR-4 covers 44AD/44ADA/44AE alike — rather than silently falling
    // through to the conservative ITR-2 path below.
    recommendedItrType = "ITR-4";
    reasons.push(
      `${presumptiveSchemeLabel} with no capital gains, foreign assets, books-based business income, or ` +
        "house-property loss — ITR-4 (Sugam) applies.",
    );
  } else if (hasBusinessIncome || hasPresumptiveIncome) {
    // Mixed with another complication (capital gains / foreign assets /
    // house-property loss / general business income) — cannot properly
    // distinguish ITR-3 from ITR-4 in K.2.0; steer to ITR-2 as the
    // conservative capital-gains-capable form and flag for CA review.
    recommendedItrType = "ITR-2";
    reasons.push("Blockers prevent ITR-1; business/presumptive income combined with other complications may require ITR-3/ITR-4 (CA to confirm).");
    if (hasPresumptiveIncome) {
      notes.push(
        `${presumptiveSchemeLabel} combined with another complication: ITR-3 vs ITR-4 selection is out of ` +
          "K.2.0 scope for this combination — CA to confirm.",
      );
    }
  } else {
    recommendedItrType = "ITR-2";
    reasons.push("Capital gains / foreign assets / high income require ITR-2.");
  }

  notes.push("Preparation-only recommendation — CA verification required before filing.");

  return { recommendedItrType, blockers, reasons, notes };
}
