/**
 * Centralized rule constants for AY 2026-27 / FY 2025-26. PURE — no imports
 * except local types. Keep ALL magic tax numbers here (and in slabs.ts).
 *
 * Official references (verify against the bare Act / CBDT before client
 * reliance — do NOT rely on developer memory):
 *  - New regime rebate u/s 87A raised to ₹60,000 for total income up to
 *    ₹12,00,000 (Finance Act 2025 / Budget 2025).
 *  - Standard deduction: ₹75,000 (new regime), ₹50,000 (old regime).
 *  - STCG u/s 111A: 20% (Finance (No.2) Act 2024, transfers on/after
 *    23-Jul-2024 — applies for the whole of FY 2025-26).
 *  - LTCG u/s 112A: 12.5% on gains exceeding the ₹1,25,000 annual exemption
 *    (no indexation).
 *  - Health & Education Cess: 4%.
 *
 * TODO(CA-verify): re-confirm each constant every assessment year.
 */

/** Historical snapshot marker used before K4-17. Never reuse it for changed
 * computation semantics: existing append-only snapshots retain this binding. */
export const PRE_K4_17_RULES_VERSION = "AY_2026_27_V0_PREP_ONLY";

/** Historical snapshot marker for the K4-17 books-loss-pool semantics. Never
 * reuse it for changed computation semantics: existing append-only snapshots
 * retain this binding. */
export const PRE_K4_18_RULES_VERSION = "AY_2026_27_V1_PREP_ONLY";

/** Historical snapshot marker for the K4-18 F&O-into-the-ordinary-pool
 *  semantics. Never reuse it for changed computation semantics. */
export const PRE_K4_20_RULES_VERSION = "AY_2026_27_V2_PREP_ONLY";

/** Historical snapshot marker for the K4-20 Section 32(1)(ii) standing-class
 *  slice. Never reuse it for changed computation semantics. */
export const PRE_K4_21_RULES_VERSION = "AY_2026_27_V3_PREP_ONLY";

/** Historical snapshot marker for the K4-21 house-sale STCG slice. Never
 *  reuse it for changed computation semantics. */
export const PRE_K4_23_RULES_VERSION = "AY_2026_27_V4_PREP_ONLY";

/**
 * K4-23 (`D337`) admits the section 112 long-term house-sale comparison,
 * which previously refused. That is a MATERIAL computation-behaviour
 * change, so `D276`/`D278` require this coordinate to move — the cheap
 * guarantee keeping the `K3-12` snapshot freshness check honest.
 *
 * `D276` also states what this bump does NOT owe: no in-tree frozen engine
 * copy is created for `V5`, exactly as none was for `V4`. A draft pack is
 * ONE mutable computation until a freeze event. `V0`-`V4` remain
 * identity-only registry coordinates.
 *
 * The superseded constant above is not decoration. Pre-K4-23 snapshots
 * genuinely carry `V4`, and naming it here is also what keeps it inside
 * `check:current-state`'s DERIVED identifier vocabulary — that guard reads
 * this directory, so a version dropped from the code becomes unprotectable
 * in the continuity corpus even while the text still sits in
 * the project status notes. Retiring a version means recording it here, never
 * deleting it.
 */
export const RULES_VERSION = "AY_2026_27_V5_PREP_ONLY";

export const ASSESSMENT_YEAR = "2026-27";
export const FINANCIAL_YEAR = "2025-26";

/** Standard deduction against salary income, by regime (in rupees). */
export const STANDARD_DEDUCTION = {
  new: 75_000,
  old: 50_000,
} as const;

/** Health & Education Cess on (tax + surcharge - rebate). */
export const CESS_RATE = 0.04;

/**
 * K4-12 — SECTION 87A REBATE and its REBATE-THRESHOLD MARGINAL RELIEF.
 * Read this before touching `rebate-relief.ts`.
 *
 * This relief shares only the NAME with the surcharge marginal relief `K4-11`
 * shipped ({@link SURCHARGE}). It operates at the ₹12,00,000 / ₹5,00,000
 * REBATE ceilings, not the ₹50,00,000 / ₹1,00,00,000 surcharge thresholds, and
 * the two can never both be live for one case — see the derived proof in
 * `rebateReliefUpperIncomeBound`, whose bound (≈₹12,70,588 under the AY 2026-27
 * new-regime slabs) sits far below `SURCHARGE.entryThreshold`.
 *
 * SOURCING (2026-08-02). The PRIMARY amending text was obtained and extracted
 * locally: the **Finance Act, 2025** PDF from `thc.nic.in/Central Governmental
 * Acts/Finance Act, 2025.pdf` (a Government of India High Court host — the same
 * route `K4-11` used), text extracted with `pypdf`. VERBATIM, clause 20:
 *
 *   "20. In section 87A of the Income-tax Act, with effect from the 1st April,
 *   2026,––
 *   (a) in the proviso,—
 *     (i) in clause (a),––
 *       (I) for the words "seven hundred thousand rupees", the words "twelve
 *       hundred thousand rupees" shall be substituted;
 *       (II) for the words "twenty-five thousand rupees", the words "sixty
 *       thousand rupees" shall be substituted;
 *     (ii) in clause (b), for the words "seven hundred thousand rupees" at both
 *     the places where they occur, the words "twelve hundred thousand rupees"
 *     shall be substituted;
 *   (b) after the proviso, the following proviso shall be inserted, namely:––
 *     "Provided further that the deduction under the first proviso, shall not
 *     exceed the amount of income-tax payable as per the rates provided in
 *     sub-section (1A) of section 115BAC.""
 *
 * `incometaxindia.gov.in` returned HTTP 403 for the **EIGHTH** consecutive
 * session (D67's running tally), as did `indiacode.nic.in` — both recorded as
 * attempted-but-blocked, never silently substituted. The base proviso the
 * clause amends was corroborated from the Income Tax Department's OWN e-filing
 * portal (`incometax.gov.in`, "New Tax vs Old Tax Regime FAQs", directly
 * retrieved), which reproduces clause (a) and clause (b) in their pre-2025
 * ₹7,00,000 form, and its opening words —
 *
 *   "Provided that where the total income of the assessee is chargeable to tax
 *   under sub-section (1A) of section 115BAC, and the total income—"
 *
 * ── (1) THE CEILINGS ARE NOT SYMMETRIC, AND THIS IS THE LOAD-BEARING FACT ──
 *
 * The marginal relief is clause (b) of a proviso conditioned on s.115BAC(1A).
 * It is therefore **NEW REGIME ONLY**. The OLD regime's ₹5,00,000 / ₹12,500
 * rebate sits in the section's MAIN body, has no clause (b), and is a genuine
 * CLIFF — which is precisely why "keep total income at or below ₹5,00,000" is
 * standard old-regime advice. The Finance Act's own new second proviso confirms
 * the reading structurally: capping "the deduction under the first proviso" by
 * reference to s.115BAC(1A) RATES would be incoherent if that proviso reached
 * old-regime assessees at all.
 *
 * ONE DIRECTLY-RETRIEVED SECONDARY PUBLISHER DISAGREES and is recorded rather
 * than suppressed: ClearTax's 87A page states marginal relief applies under
 * both regimes. It is not followed — it is a secondary source contradicted by
 * the primary structure above and by two other directly-retrieved sources
 * (the ITD e-filing portal, and taxguru's AY 2026-27 rate notes, which state
 * the relief is "only under the new Section 115BAC(1A) regime"). Recorded
 * because a conflict a future session cannot see is a conflict it will
 * re-litigate from scratch.
 *
 * ── (2) THE FORMULA, AND THE REFERENCE IT IS MEASURED AGAINST ──────────────
 *
 * Clause (b): where total income exceeds the ceiling and the income-tax payable
 * on it exceeds the amount by which the total income exceeds the ceiling, the
 * deduction is that DIFFERENCE. So:
 *
 *   relief = max(0, income-tax payable − (total income − ₹12,00,000))
 *
 * capped by the second proviso at the income-tax payable at s.115BAC(1A) rates.
 * The reference is a MONETARY EXCESS OF INCOME, not a notional total income —
 * which is what makes it a different shape from the surcharge relief, whose
 * reference is "income-tax on a total income of ₹50,00,000" and whose
 * composition `K4-11` had to refuse. There is no notional-income composition
 * question here.
 *
 * ── (3) ORDER OF OPERATIONS ────────────────────────────────────────────────
 *
 * Section 87A sits in Chapter VIII and gives "a deduction from the amount of
 * income-tax". It is therefore applied to income-tax AFTER slab and
 * special-rate tax are computed and BEFORE surcharge and cess — which is
 * exactly where `compute-tax.ts` already applied the ordinary rebate, so the
 * relief slots into the existing sequence and changes no ordering.
 *
 * ── (4) THE ONE AMBIGUITY THAT IS REFUSED ──────────────────────────────────
 *
 * Where the case carries special-rate 111A/112A income, TWO questions are
 * unresolved by any source located this session:
 *
 *   (Q1) Is the 87A deduction available AT ALL when total income includes such
 *        gains? The ITD's own return utility has denied it since July 2024, the
 *        point is litigated, and no primary text settles it.
 *   (Q2) If it is, does "the income-tax payable on such total income" in
 *        clause (b) mean the slab tax alone, or the slab tax PLUS the
 *        special-rate tax? The two give different relief.
 *
 * Rather than guess either, `rebate-relief.ts` computes relief EXACTLY only
 * where the case has NO special-rate income; where it has some, relief is
 * applied only if provably nil under every reading, and otherwise the case is
 * REFUSED (relief nil, so tax is never understated) and stays reliance-blocked.
 * The trigger is the PRESENCE of special-rate income, not a non-zero
 * special-rate tax: Q1 bites even when the 112A exemption makes that tax nil.
 *
 * NOT MODELLED, deliberately: the residency condition. Section 87A applies to
 * "an individual resident in India", and this engine does NOT gate the rebate
 * on residency — a pre-existing gap that K4-12 INHERITS rather than widens
 * (`eligibility.ts` blocks a non-resident case upstream via
 * `UNSUPPORTED_RESIDENTIAL_STATUS`, which is why it has never bitten). Recorded
 * here so it is a known gap rather than a discovered one.
 *
 * TODO(CA-verify): confirm against the bare Finance Act, 2026 First Schedule
 * and the consolidated section 87A before client reliance — the verbatim text
 * above is the Finance Act, 2025 amending clause, and the base proviso it
 * amends was corroborated from the ITD portal rather than read off the bare
 * consolidated Act, which could not be retrieved (403).
 */
export const REBATE_87A = {
  new: {
    /** Total income up to this (inclusive) qualifies. */
    incomeLimit: 12_00_000,
    /** Maximum rebate on normal (slab-rate) tax. */
    maxRebate: 60_000,
    /** Clause (b) rebate-threshold marginal relief reaches this regime. */
    marginalReliefAvailable: true,
  },
  old: {
    incomeLimit: 5_00_000,
    maxRebate: 12_500,
    /** The enabling proviso is conditioned on s.115BAC(1A), so clause (b) does
     *  NOT reach the old regime — its ceiling is a genuine cliff. */
    marginalReliefAvailable: false,
  },
} as const;

/**
 * K4-11 — SURCHARGE and MARGINAL RELIEF (Wave-4). Read this before touching the
 * arithmetic: like `CAPITAL_LOSS_SET_OFF` below, the scope boundary here is
 * derived from the tax, not from convenience.
 *
 * SOURCING (2026-08-01). Unlike every prior K4 session, the PRIMARY statutory
 * text was obtained and quoted verbatim: the **Finance Act, 2025** PDF was
 * fetched from `thc.nic.in/Central Governmental Acts/Finance Act, 2025.pdf` (a
 * Government of India High Court host — reachable where the ITD's own host is
 * not) and its text extracted locally. `incometaxindia.gov.in` returned HTTP
 * 403 for the **SEVENTH** consecutive session, and `indiabudget.gov.in`'s
 * Finance Bill PDF, `tax2win.in` and `help.myitreturn.com` each returned 403
 * as well — all recorded as attempted-but-blocked, never silently substituted
 * (D67). Corroborated by two directly-retrieved secondary sources: the Income
 * Tax Department's own e-filing portal (`www.incometax.gov.in`, "Salaried
 * Individuals for AY 2026-27") and `taxguru.in`'s AY 2026-27 rate note, which
 * states the rates are "unchanged from AY 2025-26".
 *
 * VERBATIM, from the First Schedule, **Part III, Paragraph A** (the rates for
 * computing "advance tax" for FY 2025-26, i.e. AY 2026-27) — the OLD regime:
 *
 *   "(a) having a total income (including the income by way of dividend or
 *   income under the provisions of section 111A, section 112 and section 112A
 *   ...) exceeding fifty lakh rupees but not exceeding one crore rupees, at the
 *   rate of ten per cent. of such income-tax;
 *   (b) ... exceeding one crore rupees but not exceeding two crore rupees, at
 *   the rate of fifteen per cent. of such income-tax;
 *   (c) having a total income (EXCLUDING the income by way of dividend or
 *   income under ... 111A, 112 and 112A) exceeding two crore rupees but not
 *   exceeding five crore rupees, at the rate of twenty-five per cent. ...;
 *   (d) ... (excluding ...) exceeding five crore rupees, at the rate of
 *   thirty-seven per cent. ...; and
 *   (e) having a total income (including ...) exceeding two crore rupees, but
 *   is not covered under clauses (c) and (d), shall be applicable at the rate
 *   of fifteen per cent. of such income-tax:
 *
 *   Provided that in case where the total income includes any income by way of
 *   dividend or income under the provisions of section 111A, section 112 and
 *   section 112A ..., the rate of surcharge on the amount of Income-tax
 *   computed in respect of that part of income shall not exceed fifteen per
 *   cent.:
 *   ...
 *   Provided also that in the case of persons mentioned above having total
 *   income exceeding,—
 *   (a) fifty lakh rupees but not exceeding one crore rupees, the total amount
 *   payable as income-tax and surcharge on such income shall not exceed the
 *   total amount payable as income-tax on a total income of fifty lakh rupees
 *   by more than the amount of income that exceeds fifty lakh rupees;
 *   (b) one crore rupees but does not exceed two crore rupees, the total amount
 *   payable as income-tax and surcharge on such income shall not exceed the
 *   total amount payable as income-tax AND SURCHARGE on a total income of one
 *   crore rupees by more than the amount of income that exceeds one crore
 *   rupees; ..."
 *
 * The NEW regime (s.115BAC(1A)) carries the SAME 10%/15% entry tiers and the
 * SAME 15% proviso, and its top tier is capped at 25% with no 37% band — from
 * the Finance Act, 2025 s.2(3) proviso beginning "Provided also that in respect
 * of income chargeable to tax under sub-section (1A) of section 115BAC", whose
 * clause (iii) reads "... (excluding the income by way of dividend or income
 * under the provisions of sections 111A, 112 and 112A ...) exceeding two crore
 * rupees, at the rate of twenty-five per cent."
 *
 * ── THE IMPLEMENTED WINDOW, AND WHY IT ENDS WHERE IT DOES ──────────────────
 *
 * This engine computes surcharge ONLY where total income does not exceed
 * ₹2,00,00,000. Inside that window the applicable rate is 10% or 15% — BOTH at
 * or below the 15% proviso ceiling — so the first proviso is provably
 * NON-BINDING and no apportionment of income-tax between the "111A/112/112A/
 * dividend part" and the rest is needed. The answer is identical whatever the
 * income's composition. That is a proof, not a convenience.
 *
 * ABOVE ₹2,00,00,000 the 25%/37% tiers engage and the proviso BECOMES binding,
 * which needs two things this engine does not have: (1) an apportionment of
 * slab tax to the DIVIDEND component — this engine taxes dividend as ordinary
 * slab income (`SLAB_INCOME_CATEGORIES` in compute-tax.ts) and keeps no
 * separate dividend tax figure; and (2) the "total income EXCLUDING dividend/
 * 111A/112/112A" band test that clauses (c)/(d) are conditioned on. Rather than
 * guess either, surcharge is NOT computed above the ceiling and the case stays
 * reliance-blocked (`SURCHARGE_MARGINAL_RELIEF_UNSUPPORTED`).
 *
 * ── MARGINAL RELIEF, AND THE ONE AMBIGUITY THAT IS REFUSED ─────────────────
 *
 * Relief = max(0, (income-tax + surcharge) − (reference + excess)), where the
 * reference is the statute's "total amount payable as income-tax [and
 * surcharge] on a total income of ₹50,00,000 / ₹1,00,00,000". Note the
 * asymmetry, reproduced exactly: the ₹50,00,000 reference is income-tax ALONE
 * (surcharge is nil at exactly ₹50,00,000), while the ₹1,00,00,000 reference is
 * income-tax AND surcharge.
 *
 * The reference is a NOTIONAL total income, and the statute does not say how it
 * is composed when the actual case mixes slab income with special-rate
 * 111A/112A gains. Reducing the normal component, the special component, or
 * both proportionally gives three different reference figures and therefore
 * three different reliefs. No source reachable this session resolved it. So:
 *
 *   - With NO special-rate income the reference is unambiguous (all of it is
 *     slab income) and relief is computed EXACTLY.
 *   - With special-rate income, relief is computed only where it is provably
 *     ZERO under EVERY reading. Removing `excess` rupees of income cannot
 *     reduce tax by more than the highest rate in play (30%, derived in
 *     `surcharge.ts` from the slab tables and the 111A/112A rates — never a
 *     literal), which bounds the reference from below and therefore bounds
 *     relief from above. If that upper bound is ≤ 0, relief is nil under every
 *     reading and the figure is safe.
 *   - Otherwise the case is REFUSED: surcharge is reported GROSS of relief (it
 *     is never understated) and the case stays reliance-blocked.
 *
 * NOT MODELLED, deliberately: the 25%/37% tiers and the binding 15% proviso
 * above ₹2 crore; the ₹2 crore and ₹5 crore marginal-relief tiers (both lie
 * outside the window); surcharge on any income head this engine does not
 * compute; and — a genuinely SEPARATE relief that shares only the name —
 * marginal relief at the Section 87A REBATE threshold, which is still
 * unimplemented (see `NOT_IMPLEMENTED.marginalRelief` below).
 *
 * TODO(CA-verify): confirm against the bare Finance Act, 2026 First Schedule
 * before client reliance — the verbatim text above is the Finance Act, 2025
 * Part III (the FY 2025-26 advance-tax basis for AY 2026-27); that the AY
 * 2026-27 figures are unchanged is corroborated by secondary sources, not by
 * the bare 2026 Act text, which could not be retrieved (403).
 */
export const SURCHARGE = {
  /**
   * Rate bands, as `{ exceeding, upTo, rate }`. Surcharge applies only where
   * total income EXCEEDS `exceeding` (strict — exactly ₹50,00,000 attracts
   * nil, the TAX-SAFE-01A boundary). Only the two tiers inside the implemented
   * window are declared; the 25%/37% tiers are deliberately ABSENT rather than
   * declared-but-unused, so nothing can accidentally apply them.
   */
  bands: [
    { exceeding: 50_00_000, upTo: 1_00_00_000, rate: 0.1 },
    { exceeding: 1_00_00_000, upTo: 2_00_00_000, rate: 0.15 },
  ],
  /** Lowest total income at which any surcharge can arise (strict `>`). */
  entryThreshold: 50_00_000,
  /**
   * Highest total income this engine computes surcharge for. Above it the
   * 15% proviso binds and the dividend/special-rate apportionment it requires
   * is unmodelled — see the module doc.
   */
  supportedTotalIncomeCeiling: 2_00_00_000,
  /**
   * The proviso ceiling on the surcharge rate for dividend / 111A / 112 / 112A
   * income. Recorded for provenance and for the PROOF that it is non-binding
   * inside the window (every declared band rate is ≤ this); no apportionment
   * is computed from it.
   */
  specialRateSurchargeRateCap: 0.15,
} as const;

/** Special (non-slab) rate constants for capital gains. */
export const CAPITAL_GAINS = {
  /** STCG on listed equity / equity MF u/s 111A. */
  stcg111aRate: 0.2,
  /** LTCG on listed equity / equity MF u/s 112A. */
  ltcg112aRate: 0.125,
  /** Annual LTCG exemption u/s 112A before 12.5% applies. */
  ltcg112aExemption: 1_25_000,
} as const;

/**
 * K4-09 — WITHIN-YEAR set-off of capital losses (Sections 70 / 71(3) / 74),
 * Wave-4 priority #5, FIRST slice only. Read this before touching the
 * arithmetic: the scope boundary here is derived from the tax, not from
 * convenience, and narrowing it further or widening it needs new sourcing.
 *
 * Sourced 2026-07-31, primarily from ClearTax's "How to Set Off and Carry
 * Forward Capital Losses" (cleartax.in/s/set-off-carry-forward-capital-losses,
 * directly retrieved), which states that a Short-Term Capital Loss may be set
 * off against "Both Short-Term Capital Gains (STCG) and Long-Term Capital
 * Gains (LTCG)" while a Long-Term Capital Loss may be set off against "Only
 * Long-Term Capital Gains (LTCG)"; that the Act "does not allow loss under the
 * head capital gains to be set off against any income from other heads"
 * (Section 71(3)); and that both kinds "can be carried forward for 8
 * assessment years" (Section 74(2)). Corroborated by two further directly
 * fetched publishers — incometaxmanagement.in (Section 71 inter-head
 * adjustment) and aubsp.com (quoting the bare Section 74(1)(a)/(b)/(2) text).
 * incometaxindia.gov.in AND bajajfinserv.in both returned HTTP 403 to a direct
 * fetch this session — attempted-but-blocked sources, recorded rather than
 * silently substituted.
 *
 * TWO ORDERING QUESTIONS ARE DELIBERATELY LEFT UNRESOLVED, because every
 * source reachable this session presented them as tax-PLANNING advice
 * ("optimal approach", "this is only a guideline") rather than as a statutory
 * rule, and the authoritative host was blocked:
 *
 *   (Q1) Does a loss reduce the GROSS 112A gain, or only the portion ABOVE
 *        the Rs.1,25,000 exemption? The two readings give a different
 *        carried-forward residual.
 *   (Q2) When a short-term loss can go to EITHER 111A (20%) or 112A (12.5%)
 *        gains, which is absorbed first? The two orders give a different tax.
 *
 * Rather than guess either, this engine computes ONLY the window in which
 * both questions are provably immaterial, and the adapter blocks everything
 * else in full. Inside the window:
 *
 *   - A long-term loss has exactly ONE lawful destination (112A gains), so
 *     Q2 cannot arise; and the window caps it at `max(0, LTCG - 1,25,000)`,
 *     at which point both readings of Q1 yield an identical taxable amount
 *     AND an identical (zero) residual. Verified exhaustively, not asserted.
 *   - A short-term loss is admitted only when the case has NO 112A gain at
 *     all, so Q2 cannot arise and the Rs.1,25,000 threshold of Q1 is not in
 *     play; the window caps it at the available 111A gains.
 *
 * Any residual loss left after set-off would have to be CARRIED FORWARD under
 * Section 74, and no multi-year state exists in this product — so a residual
 * is never dropped and never guessed: the whole case's capital-gain rows are
 * excluded together with an explicit blocker. Brought-forward losses from an
 * earlier year likewise remain entirely unsupported (the
 * `brought_forward_losses` eligibility declaration still routes such a case to
 * manual professional review).
 */
export const CAPITAL_LOSS_SET_OFF = {
  /**
   * Section 74(2) — the maximum number of assessment years a capital loss may
   * be carried forward. Recorded for provenance and disclosure ONLY; this
   * engine implements no carry-forward, so nothing multiplies by it.
   */
  carryForwardAssessmentYears: 8,
} as const;

/**
 * Chapter VI-A deduction caps used in K.2.0 (old regime only).
 * BASIC caps only — many nuances (80G qualifying-amount computation,
 * 80CCD(2) employer share) are NOT modelled here.
 *
 * 80D / 80TTA / 80TTB are AGE-AWARE as of K4-03 — see
 * {@link deductionCapForSection}, which is what `compute-tax.ts` actually
 * calls. The flat values below remain the fallback for every OTHER section
 * and are also what `deductionCapForSection` returns for a below-60 (or
 * age-undelivered) taxpayer, so they stay meaningful on their own.
 *
 * TODO(CA-verify): 80G qualifying-limit / 50%-vs-100% categories remain
 * placeholders. 80D's "insured party" distinction for a PARENT's premium
 * (K4-05, `"80D_PARENTS"` section below) is now modelled as its own,
 * INDEPENDENT bucket — capped and summed separately from the self/family
 * "80D" bucket, never merged into one shared ceiling (CBDT's own "ITR 2 –
 * Validation Rules for AY 2026-27" V1.0 confirms the Act treats self/family
 * and parents as separate ₹50,000 caps). Still NOT modelled: whether a
 * below-60 TAXPAYER's self/family "80D" bucket should widen to ₹50,000
 * because a SPOUSE (not the taxpayer) is senior — the ITD's own AY 2026-27
 * help page states the self/family cap widens "if any person is a Senior
 * Citizen", which literally includes a senior spouse, but K4-03 scoped that
 * bucket's cap to the TAXPAYER's own age band only and no session since has
 * revisited it. This is a genuinely separate gap from the parent-premium
 * sub-case (it affects a BELOW-60 taxpayer, never the resident senior/
 * super-senior population `SENIOR_TREATMENT_UNSUPPORTED` gates — see
 * `senior-treatment.ts`'s module doc) — flagged for a future session, not
 * fixed here.
 */
export const DEDUCTION_CAPS = {
  "80C": 1_50_000,
  /** 80CCD(1B) additional NPS cap (basic). */
  "80CCD": 50_000,
  /** Non-senior 80D cap (basic, self/family bucket). Age-aware variant: {@link deductionCapForSection}. */
  "80D": 25_000,
  /** Non-senior 80D cap (basic, PARENTS bucket, K4-05). Age-aware variant: {@link deductionCapForSection}. */
  "80D_PARENTS": 25_000,
  /** 80TTA savings-interest deduction (non-senior). Age-aware variant: {@link deductionCapForSection}. */
  "80TTA": 10_000,
  /** 80TTB deposit-interest deduction (senior). Age-aware variant: {@link deductionCapForSection}. */
  "80TTB": 50_000,
  /** 80G — pass-through in K.2.0 (no qualifying-limit computation). */
  "80G": Infinity,
  other: Infinity,
} as const;

/**
 * Senior/super-senior 80D cap (K4-03) — replaces the flat ₹25,000 cap when
 * the TAXPAYER (not a relative) is senior/super-senior. Reused (K4-05) for
 * the PARENTS bucket too — same ₹50,000 figure, applied against the
 * PARENT's own senior status instead (see {@link deductionCapForSection}).
 */
export const DEDUCTION_CAP_80D_SENIOR = 50_000;

/**
 * Age-aware Chapter VI-A cap for one deduction section (K4-03 spec §10.2/
 * §10.3; K4-05 spec §10.2's parent-premium residual). Only "80D",
 * "80D_PARENTS", "80TTA" and "80TTB" vary by age band; every other section
 * returns its flat {@link DEDUCTION_CAPS} value regardless of `ageBand`.
 *
 * - **80D** (self/family): ₹25,000 for a below-60 (or age-undelivered)
 *   taxpayer; ₹{@link DEDUCTION_CAP_80D_SENIOR} for a senior/super-senior
 *   taxpayer. Covers only the TAXPAYER's own age — see the module-level
 *   caveat above for the spousal-senior scope limitation.
 * - **80D_PARENTS** (K4-05): an INDEPENDENT ₹25,000/₹50,000 cap driven by
 *   the INSURED PARENT's own senior status, never the taxpayer's own
 *   `ageBand` — callers pass a synthetic "parent age band" (see
 *   `compute-tax.ts`'s `computeDeductions`), derived from whether ANY
 *   `"80D_PARENTS"` ledger row for this case has `insuredPartySenior: true`
 *   (matching the ITD's own "₹50,000 if ANY person is a Senior Citizen"
 *   wording for the whole parents bucket, not a per-row cap). This bucket's
 *   allowed amount is SUMMED with — never merged into — the "80D" bucket's
 *   own cap; the Act's combined ₹1,00,000 ceiling (when both buckets are
 *   senior) falls out naturally from summing two independently-capped
 *   ₹50,000 buckets, not from a single shared constant.
 * - **80TTA / 80TTB are mutually exclusive by law** (Section 80TTA's own
 *   eligibility text excludes "a resident senior citizen"; Section 80TTB
 *   applies to a resident senior citizen only — see
 *   `senior_80tta_80ttb_mutual_exclusivity` in `ay-2026-27-provenance.ts`
 *   for the full citation). A ledger row tagged with the section that does
 *   NOT match the taxpayer's own age band receives a ZERO cap — it is never
 *   silently granted the OTHER section's cap. This closes a pre-K4-03 gap
 *   where a below-60 taxpayer's "80TTB" row was accepted at the full
 *   ₹50,000 senior cap regardless of actual entitlement (an over-claim-
 *   shaped silent-exclusion risk `K4-02`'s dossier flagged but did not fix).
 *
 * `ageBand: null` (age undelivered — missing/invalid DOB, or no confirmed-
 * senior parent-premium row) is treated identically to `"below_60"`,
 * matching `slabsForRegime`'s own convention: senior/super-senior treatment
 * is never granted without a confirmed age.
 */
export function deductionCapForSection(
  section: string,
  ageBand: "below_60" | "senior" | "super_senior" | null,
): number {
  const isSenior = ageBand === "senior" || ageBand === "super_senior";
  if (section === "80D") return isSenior ? DEDUCTION_CAP_80D_SENIOR : DEDUCTION_CAPS["80D"];
  if (section === "80D_PARENTS") return isSenior ? DEDUCTION_CAP_80D_SENIOR : DEDUCTION_CAPS["80D_PARENTS"];
  if (section === "80TTA") return isSenior ? 0 : DEDUCTION_CAPS["80TTA"];
  if (section === "80TTB") return isSenior ? DEDUCTION_CAPS["80TTB"] : 0;
  return (DEDUCTION_CAPS as Record<string, number>)[section] ?? Infinity;
}

/** ITR-1 (Sahaj) total-income ceiling. */
export const ITR1_INCOME_CEILING = 50_00_000;

/**
 * House property (Sections 22-27, Income-tax Act 1961) — K4-06, Wave-4
 * priority #2. Session scope: ONE property per case (self-occupied OR
 * let-out); co-ownership apportionment and multiple-property loss-set-off
 * interaction are explicitly deferred to Wave-4 priority #5 (loss set-off).
 *
 * Sourced independently this session (2026-07-26) — ClearTax's "Income from
 * House Property and Taxes" (cleartax.in/s/house-property, directly
 * retrieved) states verbatim: "30% on NAV is allowed as a standard
 * deduction... You can claim 30% expense deduction even if you have not
 * actually incurred the expenses"; "Homeowners can claim a deduction under
 * section 24 up to Rs 2 lakh on their home loan interest if the owner or
 * his family resides in the house property" (self-occupied); "If you have
 * rented out the property, the entire home loan interest is allowed as a
 * deduction" (let-out, no cap); "Property tax... when paid, is allowed as a
 * deduction from GAV... Deduction is allowed only if property tax is paid
 * during the financial year; unpaid tax cannot be claimed"; "Under the new
 * tax regime, the interest on let out property is allowed, without any
 * threshold limit... [self-occupied interest is] Not Allowed"; "Under New
 * Regime, loss under house property cannot be set off under any other
 * head. Carry forward of losses is also not allowed"; and, for the OLD
 * regime, "a maximum of Rs.2 lakhs losses can be set-off against income
 * under other heads... If the loss exceeds Rs. 2 lakhs in a year, the
 * excess loss can be carried forward for 8 years" (Section 71(3A)).
 * Corroborated by an independent secondary-publisher search aggregation
 * (HomeFirstIndia, Policybazaar, TaxGarden, ManipalCigna, CallMyCA, Upstox,
 * SmartTaxCalc — all retrieved 2026-07-26) reproducing the identical 30%/
 * ₹2,00,000/no-cap/regime-split figures. The official incometaxindia.gov.in
 * Schedule-HP page (found via search, would have been the preferred direct
 * ITD citation matching prior K4 sessions' convention) returned HTTP 403 to
 * a direct fetch this session — recorded as an attempted-but-blocked source,
 * not silently omitted; ClearTax + the corroborating publishers above are
 * the sources actually relied on. Two-self-occupied-properties-nil (Budget
 * 2025, effective AY 2025-26 onward) was also confirmed but is NOT modelled
 * — out of this session's single-property scope. TODO(CA-verify): re-confirm
 * every constant below every assessment year, and before real-client
 * reliance re-confirm directly against the bare Section 22-27 / 71(3A) text
 * (never trust this comment's transcription alone).
 */
export const HOUSE_PROPERTY = {
  /** Section 24(a): flat 30% of Net Annual Value, both regimes, uncapped. */
  standardDeductionRate: 0.3,
  /** Section 24(b) self-occupied interest cap, OLD regime only. */
  selfOccupiedInterestCapOld: 2_00_000,
  /**
   * Section 71(3A): a house-property LOSS may be set off against other
   * heads up to this much per year (old regime only — the new regime
   * disallows any cross-head set-off of a house-property loss entirely,
   * per Section 115BAC). Excess beyond this cap is NOT carried forward by
   * this engine (carry-forward tracking is out of this session's scope —
   * Wave-4 priority #5).
   */
  lossSetOffCapOld: 2_00_000,
} as const;

/**
 * Presumptive professional income (Section 44ADA, Income-tax Act 1961) —
 * K4-07, Wave-4 priority #3. Session scope: the deemed-profit computation
 * on declared gross professional receipts only. Explicitly OUT of scope
 * (per the roadmap's own row, `k4-common-case-coverage-and-priorities.md`
 * item #3): the books-of-account path for a taxpayer who declares actual
 * profit LOWER than the deemed percentage (this ledger shape has no way to
 * declare a separate "actual profit" figure at all — every row IS its
 * gross receipts, so the deemed 50% always applies), and Section 44AB
 * tax-audit trigger detection.
 *
 * Sourced independently this session (2026-07-26). Primary: ClearTax's
 * "Section 44ADA – Presumptive Tax Scheme for Professionals"
 * (cleartax.in/s/section-44ada, directly retrieved), which states: "profits
 * / taxable income is presumed at 50% of the gross receipts"; the gross-
 * receipts ceiling is "Rs. 50 lakhs" (normal) widening to "Rs. 75 lakhs"
 * when "cash receipts don't exceed 5% of total gross receipts"; "Deductions
 * under sections 28 to 43C related to business income are not allowed under
 * this section" (no separate expense/depreciation claim); a taxpayer
 * declaring below 50% "must maintain books of accounts and get accounts
 * audited under section 44AB" once total income exceeds the basic exemption
 * (Section 44AB(e)/44ADA(4) territory — NOT implemented here, per the
 * explicit scope exclusion above); and eligible professionals file "ITR-4
 * form (Sugam)". Corroborated by an independent secondary-publisher search
 * aggregation (CAClubIndia, TaxGuru, Skydo, TaxGarden, Manipal Cigna,
 * Finnovate — all retrieved 2026-07-26) reproducing the identical
 * 50%/₹50L/₹75L/5%-cash figures, and by a direct fetch of TaxGuru's
 * "Professionals eligible to opt Section 44ADA" confirming the nine
 * Section 44AA(1)-specified professions: legal, medical, engineering,
 * architecture, accountancy, technical consultancy, interior decoration,
 * company secretary (CBDT Notification S.O. 2675, 25.09.1992), and
 * information technology (CBDT-notified 2001). incometaxindia.gov.in's
 * presumptive-taxation FAQ page returned HTTP 403 to a direct fetch this
 * session (recorded, not silently substituted — same host K4-06 also found
 * blocked). The ITD's own incometax.gov.in (a different host, directly
 * fetched and reachable) confirms ITR-4 (Sugam) applicability for
 * "presumptive basis (u/s 44AD / 44ADA / 44AE)" income — see
 * `recommend-itr-form.ts` for how this is used. A single search result
 * (not independently corroborated, and contradicted by every directly-
 * fetched primary source above) suggested a "₹37.5 lakh" figure for a
 * cash-heavy case — this is NOT relied on anywhere in this engine; the
 * only two ceilings implemented are the ₹50L/₹75L figures confirmed by
 * multiple independent sources. TODO(CA-verify): re-confirm every constant
 * below every assessment year, and before real-client reliance re-confirm
 * directly against the bare Section 44ADA text (never trust this comment's
 * transcription alone).
 */
export const PRESUMPTIVE_44ADA = {
  /** Deemed profit as a fraction of declared gross professional receipts. */
  deemedProfitRate: 0.5,
  /** Gross-receipts eligibility ceiling when cash receipts EXCEED 5% of the total. */
  grossReceiptsCeiling: 50_00_000,
  /** Higher ceiling when receipts are predominantly (>=95%) via banking channels. */
  grossReceiptsCeilingDigital: 75_00_000,
} as const;

/**
 * Presumptive BUSINESS income (Section 44AD, Income-tax Act 1961) — K4-08,
 * Wave-4 priority #4. Sourced INDEPENDENTLY of `PRESUMPTIVE_44ADA` above
 * (2026-07-31): 44AD and 44ADA differ materially in deemed-profit rate,
 * ceiling, eligible assessee, and — the structural difference that drives
 * this project's ledger shape — 44AD applies TWO rates to TWO PORTIONS of
 * turnover, where 44ADA applies one rate to the whole.
 *
 * Primary: ClearTax's "Section 44AD - Presumptive Scheme for Businesses"
 * (cleartax.in/s/section-44ad-presumptive-scheme, directly retrieved), which
 * states verbatim: "To the extent receipts are received in prescribed
 * electronic modes, 6% profit can be disclosed. For the rest, 8% profit can
 * be disclosed as income. Dual percentages of profits can be claimed in
 * ITR-4." The turnover ceiling is Rs.2 crore, rising to Rs.3 crore when
 * "cash receipts do not exceed 5% of the total receipts and cash payments do
 * not exceed 5% of the total payments".
 *
 * Corroborated by two further directly-fetched, independent secondary
 * publishers (all retrieved 2026-07-31): Tally Solutions' presumptive-
 * taxation guide ("Income is presumed to be 8% of total turnover, or 6% of
 * turnover, if the cash receipts do not exceed 5% of total receipts";
 * Rs.2cr/Rs.3cr ceilings; ineligible: Section 44AE goods-carriage, agency
 * business, commission/brokerage), and Treelife's 44AD/44ADA comparison
 * (8% standard / 6% for banking-or-digital-mode receipts; Rs.2cr default and
 * Rs.3cr enhanced ceiling introduced by the Finance Act 2023 effective
 * AY 2024-25; eligible assessees are resident individuals, resident HUFs and
 * resident partnership firms EXCLUDING LLPs; "the presumptive income is the
 * final taxable income. No further expense deductions are permitted"
 * — Sections 28-43C are deemed already allowed).
 *
 * incometaxindia.gov.in's deemed-profit / presumptive-taxation page again
 * returned HTTP 403 to a direct fetch this session (recorded, NOT silently
 * substituted — the same host K4-06 and K4-07 both found blocked). The ITD's
 * own incometax.gov.in (a different, reachable ITD host, directly fetched
 * this session) confirms ITR-4 (Sugam) is the return form for business
 * profits "computed on a presumptive basis" under Sections 44AD/44ADA/44AE.
 * tax2win.in returned HTTP 403 and contributed nothing.
 *
 * The eligible-ACTIVITY test IS implemented as of K4-13 (decision D217) —
 * see {@link PRESUMPTIVE_ACTIVITY_ELIGIBILITY} below, which also corrects
 * where each exclusion actually comes from: Section 44AD(6) has THREE limbs
 * and the Section 44AE carve-out lives in the Explanation's definition of
 * "eligible business", not in sub-section (6).
 *
 * NOT implemented by this engine, and each an explicit limitation rather
 * than an assumption (see `computation-adapter.ts` and `validate-case.ts`):
 * the eligible-ASSESSEE-ENTITY test beyond residency
 * (TaxDesk OS prepares individual/HUF returns, and the adapter additionally
 * refuses a non-resident); the Section 44AD(4)/(5) five-year lock-in and its
 * consequent Section 44AB audit trigger (no multi-year state exists in this
 * product); the cash-PAYMENTS leg of the enhanced-ceiling condition (no
 * payments data is captured anywhere — see `PRESUMPTIVE_44AD_ENHANCED_
 * CEILING_UNVERIFIED`, decision D91); and declaring a profit HIGHER or LOWER
 * than the deemed percentage.
 *
 * TODO(CA-verify): re-confirm every constant below every assessment year,
 * and before real-client reliance re-confirm directly against the bare
 * Section 44AD text (never trust this comment's transcription alone).
 */
export const PRESUMPTIVE_44AD = {
  /** Deemed profit rate on the portion of turnover received via banking / prescribed electronic modes. */
  deemedProfitRateDigital: 0.06,
  /** Deemed profit rate on the remaining (cash) portion of turnover. */
  deemedProfitRateCash: 0.08,
  /** Turnover eligibility ceiling when cash receipts EXCEED 5% of total receipts. */
  turnoverCeiling: 2_00_00_000,
  /** Enhanced ceiling when cash receipts do not exceed 5% of total receipts. */
  turnoverCeilingLowCash: 3_00_00_000,
  /** Cash-receipts share (of total turnover) at or below which the enhanced ceiling applies. */
  lowCashReceiptsShare: 0.05,
} as const;

/**
 * The ELIGIBLE-ACTIVITY test for both presumptive schemes (K4-13, decision
 * D217). K4-07 and K4-08 shipped the deemed-profit computations and the
 * turnover/gross-receipts ceilings but recorded, openly, that the eligible-
 * BUSINESS-TYPE test was not covered "and no ledger field records which
 * applies". That gap FAILS OPEN: a commission agent's turnover entered under
 * Section 44AD computed a 6%/8% deemed profit anyway. This constant, together
 * with the adapter gate that consumes it, closes it.
 *
 * TWO AUTHORITIES, NOT ONE — and K4-13 corrects an error carried in D217 and
 * in this session's own brief, both of which attributed all four exclusions
 * to Section 44AD(6):
 *
 *  1. **Section 44AD(6)** — "The provisions of this section, notwithstanding
 *     anything contained in the foregoing provisions, shall not apply to —
 *     (i) a person carrying on profession as referred to in sub-section (1)
 *     of section 44AA; (ii) a person earning income in the nature of
 *     commission or brokerage; (iii) a person carrying on any agency
 *     business." THREE limbs. Goods carriage is NOT one of them.
 *  2. **The Explanation to Section 44AD**, defining "eligible business" as
 *     "any business except the business of plying, hiring or leasing goods
 *     carriages referred to in section 44AE" (and within the turnover
 *     ceiling — the limb K4-08 already implements). The Section 44AE
 *     exclusion lives HERE, in the definition, not in sub-section (6).
 *
 * Section 44ADA(1) is the MIRROR IMAGE of 44AD(6)(i): it applies to an
 * assessee "engaged in a profession referred to in sub-section (1) of
 * section 44AA". So one declared activity drives both gates in opposite
 * directions — exactly one vocabulary member is 44AD-eligible and exactly
 * one (a different one) is 44ADA-eligible. That is asserted as a test, not
 * left as a property of this comment.
 *
 * Sourced 2026-08-09. indiacode.nic.in returned HTTP 403 to a direct fetch
 * (recorded, not silently substituted — the same treatment K4-06 and K4-07
 * gave incometaxindia.gov.in's 403). The three-limb structure of 44AD(6) and
 * the placement of the 44AE carve-out inside the "eligible business"
 * definition were confirmed by two independent directly-fetched sources:
 * ClearTax's "Section 44AD(6) — Non-applicability of Presumptive Taxation
 * Scheme" (cleartax.in/s/non-applicabity-section-44ad) and Indian Kanoon's
 * reproduction of the bare section (indiankanoon.org/doc/106630282). Indian
 * Kanoon's copy is an OLDER version of the section — it carries a ₹40 lakh
 * turnover threshold — so it is relied on for STRUCTURE ONLY and for no
 * figure; every monetary constant remains K4-08's, in PRESUMPTIVE_44AD above.
 * The nine Section 44AA(1) professions are NOT re-sourced here: K4-07 already
 * confirmed them by direct fetch (legal, medical, engineering, architecture,
 * accountancy, technical consultancy, interior decoration, company secretary
 * per CBDT Notification S.O. 2675 of 25.09.1992, and information technology,
 * CBDT-notified 2001) — see PRESUMPTIVE_44ADA's doc block, which is the
 * recorded authority for that list rather than a second transcription of it.
 *
 * DELIBERATELY NOT MODELLED, and each stays a gap rather than a silent pass:
 *
 *  - **The eligible-ASSESSEE limbs** of the same Explanation — resident
 *    individual / HUF / partnership firm but NOT an LLP, and having claimed
 *    no deduction under Sections 10A / 10AA / 10B / 10BA or Chapter VI-A
 *    Part C. Those are properties of the PERSON, not of the activity this
 *    constant classifies. Residency is partly covered upstream by
 *    `eligibility.ts`; entity type and the Part C condition are captured
 *    nowhere in this product. A future slice, not this one.
 *  - **Section 44AD(4)/(5)'s five-year lock-in** and its consequent Section
 *    44AB audit trigger — needs multi-year state, which exists nowhere here.
 *  - **The finer identity of a Section 44AA(1) profession** (which of the
 *    nine). Both gates need only the coarse yes/no, so recording more would
 *    be vocabulary with no consumer. Rule 6F book-keeping and ITR-4
 *    nature-of-business codes would need it; neither is implemented.
 *
 * TODO(CA-verify): re-confirm the three limbs of 44AD(6) and the "eligible
 * business" definition directly against the bare Act text before real-client
 * reliance — never trust this comment's transcription alone.
 */
export const PRESUMPTIVE_ACTIVITY_ELIGIBILITY = {
  specified_profession_44aa_1: {
    label: "Profession specified under Section 44AA(1)",
    /** Excluded from 44AD by Section 44AD(6)(i). */
    eligibleFor44AD: false,
    /** REQUIRED by Section 44ADA(1) — the mirror image of 44AD(6)(i). */
    eligibleFor44ADA: true,
    authority: "Section 44AD(6)(i); Section 44ADA(1), Income-tax Act 1961",
  },
  commission_or_brokerage: {
    label: "Income in the nature of commission or brokerage",
    /** Excluded from 44AD by Section 44AD(6)(ii). */
    eligibleFor44AD: false,
    /** Not a Section 44AA(1) profession, so outside Section 44ADA(1). */
    eligibleFor44ADA: false,
    authority: "Section 44AD(6)(ii), Income-tax Act 1961",
  },
  agency_business: {
    label: "Agency business",
    /** Excluded from 44AD by Section 44AD(6)(iii). */
    eligibleFor44AD: false,
    eligibleFor44ADA: false,
    authority: "Section 44AD(6)(iii), Income-tax Act 1961",
  },
  goods_carriage_44ae: {
    label: "Plying, hiring or leasing goods carriages (Section 44AE)",
    /**
     * Excluded from the DEFINITION of "eligible business" in the Explanation
     * to Section 44AD — NOT by sub-section (6). Section 44AE's own
     * presumptive scheme is not implemented by this engine either, so such a
     * case is recorded and excluded, never computed under some other head.
     */
    eligibleFor44AD: false,
    eligibleFor44ADA: false,
    authority: 'Explanation to Section 44AD ("eligible business"); Section 44AE, Income-tax Act 1961',
  },
  other_business: {
    label: "Other business (none of the excluded activities)",
    /**
     * The only 44AD-eligible member. Named `other_business` rather than
     * `eligible_business` deliberately: this value asserts that the ACTIVITY
     * limbs are satisfied, and says nothing about the eligible-ASSESSEE
     * limbs, which this engine does not test. A name that claimed outright
     * eligibility would overstate what the gate verifies.
     */
    eligibleFor44AD: true,
    /** A business is not a profession, so outside Section 44ADA(1). */
    eligibleFor44ADA: false,
    authority: 'Explanation to Section 44AD ("eligible business"), Income-tax Act 1961',
  },
} as const;

/** The declared activity of a presumptive ledger row. */
export type PresumptiveActivityType = keyof typeof PRESUMPTIVE_ACTIVITY_ELIGIBILITY;

/**
 * BOOKS-BASED business / professional income (K4-14, Wave-4 slice #6, slice 1).
 * The general head that Sections 44AD/44ADA are the presumptive ALTERNATIVE to:
 * a taxpayer who actually keeps books and declares an actual profit.
 *
 * THE ONE THING THIS SLICE COMPUTES, AND WHY IT IS NARROW
 * ------------------------------------------------------
 * Section 28 charges the head. Its opening words and clause (i), verbatim:
 *
 *   "The following income shall be chargeable to income-tax under the head
 *   \"Profits and gains of business of profession\",-"
 *   "(i) the profits and gains of any business or profession which was carried
 *   on by the assessee at any time during the previous year;"
 *
 * (The Act's own printed head reads "business of profession" — a long-standing
 * typographical artefact in the bare text. Quoted as printed, not corrected.)
 *
 * Section 29 then says HOW, and it is the whole reason this slice is bounded:
 *
 *   "29. Income from profits and gains of business or profession, how computed."
 *   "The income referred to in section 28 shall be computed in accordance with the"
 *   "provisions contained in sections 30 to [43-D]"
 *
 * So book net profit is NOT, by itself, taxable business income. It becomes
 * taxable business income only once every Sections 30-43D adjustment has been
 * made. This engine implements NONE of those adjustments. Therefore the only
 * case it can compute honestly is the one where the preparer has affirmatively
 * declared that no such adjustment arises — see
 * {@link BUSINESS_BOOKS_ADJUSTMENTS}. An undeclared case is REFUSED, never
 * assumed adjustment-free. That default is the entire safety property here:
 * `K4-13` exists because a presumptive path failed open, and "revenue minus
 * expenses" with an unasked depreciation question is the same failure wearing
 * different clothes.
 *
 * WHY EACH EXCLUDED CASE IS EXCLUDED, WITH ITS SOURCE
 * ---------------------------------------------------
 *  - **Depreciation (Section 32).** Not merely unimplemented — depreciation is
 *    not the taxpayer's to decline. Explanation 5 to Section 32(1), verbatim:
 *
 *      "For the removal of doubts, it is hereby declared that the provisions of this sub-section shall apply"
 *      "whether or not the assessee has claimed the deduction in respect of depreciation in computing his total income"
 *
 *    A P&L carrying BOOK depreciation therefore states a figure that is wrong
 *    in both directions at once: the book charge must come out, and the
 *    Section 32 allowance must go in. K4-20 computes the second half for a
 *    CLOSED set of Appendix I standing classes (`section-32.ts`); the book
 *    charge is a required declared add-back. An unreadable or out-of-set
 *    class, a missing WDV, additional depreciation under s.32(1)(iia), and
 *    s.32(2) unabsorbed carry-forward still refuse.
 *  - **Disallowances (Sections 37 / 40 / 43B).** Section 37(1), verbatim:
 *
 *      "Any expenditure (not being expenditure of the nature described in sections 30 to 36"
 *      "and not being in the nature of capital expenditure or personal expenses of the assessee),"
 *      "laid out or expended wholly and exclusively for the purposes of the business or profession"
 *      "shall be allowed in computing the income chargeable under the head \"Profits and gains of"
 *      "business or profession"
 *
 *    and Section 43B's non-obstante opening, verbatim:
 *
 *      "Notwithstanding anything contained in any other provision of this Act, a deduction otherwise allowable"
 *      "only in computing the income referred to in section 28 of that previous year in which such sum is"
 *      "actually paid by him"
 *
 *    An expense total that includes a capital, personal, or unpaid-statutory
 *    item is not an allowable expense total. This engine cannot tell, so it
 *    asks and refuses on a yes.
 *  - **A presumptive-to-books transition.** Section 44AD(4)/(5) impose a
 *    five-year lock-in whose breach itself triggers a Section 44AB audit
 *    (Section 44AB(e)). No multi-year state exists anywhere in this product —
 *    the same gap `K4-08` recorded — so the transition cannot be tested and is
 *    refused rather than ignored.
 *  - **A Section 44AB audit trigger.** DERIVED, not declared: see
 *    {@link BUSINESS_BOOKS} below.
 *  - **A residual business LOSS.** K4-17 implements Section 70(1) current-year
 *    intra-head set-off between otherwise-admissible books sources, but only
 *    when their whole aggregate is zero or positive. A negative aggregate is
 *    refused, never silently floored to zero, because the residual would need
 *    Section 71 cross-head set-off or Section 72 carry-forward, neither of
 *    which is modelled.
 *
 *    Section 70(1), verbatim:
 *
 *      "Save as otherwise provided in this Act, where the net result for any assessment year in respect of"
 *      "any source falling under any head of income, other than \"Capital gains\", is a loss, the assessee"
 *      "shall be entitled to have the amount of such loss set off against his income from any other source"
 *      "under the same head."
 *
 *    Netting one business's loss against another's profit IS that set-off.
 *    K4-17 admits it only where the current-year head absorbs the loss in full;
 *    no Section 71/72 residual is generated or consumed.
 *
 * MORE THAN ONE BUSINESS — COMPUTED SINCE `K4-15`, AND WHY `K4-14` WAS WRONG
 * -------------------------------------------------------------------------
 * `K4-14` refused a case with more than one books record, reasoning that "each
 * business has its own Section 44AB threshold, so an aggregate could not even
 * be tested against one". Reading the section shows the opposite. Section
 * 44AB(a) tests "his TOTAL sales, turnover or gross receipts, as the case may
 * be, IN BUSINESS" and 44AB(b) "his gross receipts IN PROFESSION" — each limb
 * asks one question about the PERSON, so the aggregate is not merely testable,
 * it is the only correct test. A per-row test silently under-asks it: two
 * businesses of ₹60,00,000 each are a ₹1,20,00,000 turnover that requires an
 * audit, and neither row exceeds the threshold on its own.
 *
 * The refusal failed closed, so no case was ever computed wrongly — but the
 * recorded REASON was the reverse of the rule. `computation-adapter.ts` now
 * sums each limb and tests it once, and Section 28(i)'s "profits and gains of
 * ANY business or profession which was carried on" supplies the aggregation of
 * the profits themselves. Every other refusal is unchanged, and each applies
 * to the WHOLE head: one bad record excludes them all, because a partial
 * aggregate is a figure that is not the taxpayer's.
 *
 * SOURCING. The Sections 28/29/32/37/43B/44AB quotations were taken on
 * 2026-08-10 from a
 * DIRECTLY FETCHED indiankanoon.org reproduction of the bare section —
 * Section 28 (doc/555776), Section 29 (doc/176471), Section 32 (doc/179995),
 * Section 37(1) (doc/41962694), Section 43B (doc/632021) and Section 44AB
 * (doc/1956509) — never from memory and never from a competitor's output.
 * K4-17 re-retrieved Section 70(1) directly from the official Income Tax
 * Department host on 2026-08-13 and checked the Department's official
 * "Set-off and carry forward of losses" guidance, which separately describes
 * intra-head adjustment, inter-head adjustment, and carry-forward. The code's
 * non-negative-aggregate boundary is an implementation inference: when the
 * current-year head reaches zero or more, no residual loss reaches the latter
 * two categories. It remains professional judgement pending CA verification.
 *
 * TODO(CA-verify): every quotation above is a transcription. Before any
 * real-client reliance, re-confirm each one directly against the bare Act text
 * — never trust this comment alone.
 */
export const BUSINESS_BOOKS = {
  /**
   * Section 44AB(a) — the audit threshold for a BUSINESS, verbatim:
   *
   *   "carrying on business shall, if his total sales, turnover or gross receipts, as"
   *   "the case may be, in business exceed or exceeds one crore rupees in any"
   *   "previous year [***]:"
   *
   * A case EXCEEDING this turnover is REFUSED (see `computation-adapter.ts`),
   * because an audited case needs a Section 44AB report this product neither
   * holds nor produces.
   *
   * STRICTLY GREATER THAN, never `>=` — the section says "exceed or exceeds
   * one crore rupees", so a turnover of exactly ₹1,00,00,000 does NOT require
   * an audit and is not refused. The same `>` / `>=` distinction `D44` had to
   * correct for the surcharge window. (This comment previously read "at or
   * above", which contradicted the code; the CODE was right.)
   *
   * `K4-15`: tested against the SUM of every live business record, not each
   * one, because the clause asks about the person's TOTAL turnover in
   * business.
   */
  auditThresholdBusinessTurnover: 1_00_00_000,
  /**
   * Section 44AB(b) — the audit threshold for a PROFESSION, verbatim:
   *
   *   "(b)carrying on profession shall, if his gross receipts in profession exceed"
   *   "fifty lakh rupees in any previous year; or"
   *
   * Also strictly `>` ("exceed"), and also tested on the SUM of every live
   * PROFESSION record since `K4-15`. The two limbs are summed and tested
   * SEPARATELY — a business and a profession are never pooled into one figure,
   * because (a) and (b) are different questions with different thresholds.
   */
  auditThresholdProfessionGrossReceipts: 50_00_000,
  /**
   * The FIRST PROVISO to Section 44AB(a) raises the business threshold to ten
   * crore rupees, verbatim:
   *
   *   "Provided that in the case of a person whose—"
   *   "(a)aggregate of all amounts received including amount received for sales,"
   *   "turnover or gross receipts during the previous year, in cash, does not exceed"
   *   "five per cent of the said amount; and"
   *   "(b)aggregate of all payments made including amount incurred for expenditure, in"
   *   "cash, during the previous year does not exceed five per cent of the said"
   *   "payment, this clause shall have effect as if for the words \"one crore rupees\","
   *   "the words \"[ten] crore rupees\" had been substituted:"
   *
   * DELIBERATELY NOT APPLIED. The proviso has TWO conjunctive limbs, and the
   * SECOND is about cash PAYMENTS, which no ledger in this product captures —
   * the identical gap `K4-08` recorded as
   * `PRESUMPTIVE_44AD_ENHANCED_CEILING_UNVERIFIED` (decision D91). An
   * unverifiable condition is never treated as satisfied, so the LOWER
   * one-crore threshold governs. The figure is recorded here so that a future
   * session that does capture cash payments finds the constant already sourced
   * rather than re-deriving it — it has no consumer today, which
   * `rules.test.ts` asserts rather than leaves to trust.
   */
  auditThresholdBusinessTurnoverLowCash: 10_00_00_000,
  /** The 5% share both limbs of that proviso turn on. Recorded, not consumed — see above. */
  lowCashShare: 0.05,
} as const;

/**
 * The declared BASIS of a books row: what, if anything, the books require
 * under Sections 30-43D. Exactly one member is computable.
 *
 * TWO PARALLEL VOCABULARIES, NOT ONE IMPORT — the same shape `K4-13` used for
 * {@link PRESUMPTIVE_ACTIVITY_ELIGIBILITY}. `tax-desk/ledger.ts` owns the
 * ledger/database vocabulary; this constant owns the statutory verdict, and
 * the engine may not import from `tax-desk`. They are pinned identical in BOTH
 * directions by a test, so a member added to either side alone fails the suite
 * rather than silently becoming a basis the gate cannot classify.
 *
 * ABSENCE IS NOT A MEMBER. A row with no declared basis is `null`, and `null`
 * REFUSES. There is deliberately no "unknown", no "other", and no default:
 * a default here is precisely the assumption — "there is no depreciation and
 * nothing is disallowable" — that this vocabulary exists to stop anyone making
 * on the taxpayer's behalf.
 *
 * ONE SELECTION, THOUGH TWO CAN BE TRUE. A real case may carry depreciation
 * AND a disallowance at once, and this single-select field can name only one.
 * That costs no SAFETY — every non-computable member refuses, so the outcome
 * of any combination is refusal either way — but it does mean the REPORTED
 * reason may be one of several true ones. Recorded as a known limitation
 * rather than smoothed over; a slice that computes any adjustment will have to
 * replace this field with a per-adjustment model anyway.
 */
export const BUSINESS_BOOKS_ADJUSTMENTS = {
  none_s30_43d: {
    label: "No Sections 30-43D adjustment arises",
    /**
     * Still computable, and now one of TWO. Named for what the preparer
     * ASSERTS: the declared expense total is already the allowable total,
     * carries no depreciation charge, and needs no add-back. Exclusive of
     * every other member — a set containing `none_s30_43d` and anything
     * else is contradictory and refuses. It does NOT assert that the
     * figure is correct — nothing in this engine can.
     */
    computable: true,
    authority: "Sections 28, 29 and 37(1), Income-tax Act 1961",
  },
  depreciation_s32: {
    label: "Depreciation is claimed or the books carry a depreciation charge",
    /**
     * K4-20: computable when the row also carries a closed set of Appendix I
     * standing-class blocks, a declared book-depreciation add-back, and an
     * explicit "no s.32(1)(iia) additional depreciation" answer. Incomplete
     * or out-of-set facts still refuse (adapter mapping-warning, `D238`).
     */
    computable: true,
    authority: "Section 32(1)(ii) and Explanation 5 to Section 32(1), Income-tax Act 1961; Income-tax Rules, 1962, New Appendix I (rule 5)",
  },
  disallowance_s37_s40_s43b: {
    label: "A Sections 37 / 40 / 43B disallowance or add-back arises",
    computable: false,
    authority: "Sections 37(1), 40 and 43B, Income-tax Act 1961",
  },
  presumptive_transition: {
    label: "Moving to books from a presumptive scheme (Section 44AD/44ADA)",
    computable: false,
    authority: "Sections 44AD(4), 44AD(5) and 44AB(e), Income-tax Act 1961",
  },
} as const;

/** The declared Sections 30-43D basis of a books-based business row. */
export type BusinessBooksAdjustment = keyof typeof BUSINESS_BOOKS_ADJUSTMENTS;

/**
 * Normalise a pre-K4-20 single member or a K4-20 set to a set. A string
 * that is not a vocabulary member is dropped (the adapter already refused
 * it; this is defence in depth, not a second classification).
 */
export function asAdjustmentSet(
  declared: BusinessBooksAdjustment | readonly BusinessBooksAdjustment[] | null | undefined,
): BusinessBooksAdjustment[] {
  const raw = declared == null ? [] : typeof declared === "string" ? [declared] : [...declared];
  return raw.filter((member): member is BusinessBooksAdjustment =>
    Object.prototype.hasOwnProperty.call(BUSINESS_BOOKS_ADJUSTMENTS, member),
  );
}

/** True when the set is exactly the adjustment-free declaration. */
export function isNoneOnlyAdjustments(
  declared: BusinessBooksAdjustment | readonly BusinessBooksAdjustment[] | null | undefined,
): boolean {
  const set = asAdjustmentSet(declared);
  return set.length === 1 && set[0] === "none_s30_43d";
}

/**
 * K4-20 — closed set of Appendix I standing classes this engine will
 * multiply. Keys are the ledger/database vocabulary; the prescribed
 * percentages live in `section-32.ts` `SECTION_32_APPENDIX_I_RATES` and
 * are the single authority for the figure. An asset that is not one of
 * these classes is unreadable-or-out-of-scope and REFUSES.
 *
 * Put-to-use is a SEPARATE vocabulary: the second proviso to s.32(1)
 * restricts the deduction to fifty per cent where the asset was acquired
 * during the previous year and put to use for less than 180 days. The
 * preparer declares which regime each block is under; this engine does
 * not compute the 180-day clock.
 */
export const DEPRECIATION_ASSET_CLASSES = {
  building_residential_i1: {
    label: "Building used mainly for residential purposes (Appendix I item I(1))",
    appendixItem: "I(1)",
  },
  building_other_i2: {
    label: "Building other than residential, not water-supply/80-IA (Appendix I item I(2))",
    appendixItem: "I(2)",
  },
  building_temporary_i4: {
    label: "Purely temporary erections such as wooden structures (Appendix I item I(4))",
    appendixItem: "I(4)",
  },
  furniture_fittings_ii: {
    label: "Furniture and fittings including electrical fittings (Appendix I item II)",
    appendixItem: "II",
  },
  plant_machinery_general_iii1: {
    label: "Machinery and plant, general (Appendix I item III(1))",
    appendixItem: "III(1)",
  },
  motor_car_not_hire_iii2i: {
    label: "Motor cars not used in a business of running them on hire (Appendix I item III(2)(i))",
    appendixItem: "III(2)(i)",
  },
  motor_hire_iii3iia: {
    label: "Motor buses, lorries and taxis used in a business of running them on hire (Appendix I item III(3)(ii)(a))",
    appendixItem: "III(3)(ii)(a)",
  },
  computers_iii5: {
    label: "Computers including computer software (Appendix I item III(5))",
    appendixItem: "III(5)",
  },
  intangibles_part_b: {
    label: "Know-how, patents, copyrights, trademarks, licences, franchises or similar commercial rights (Appendix I Part B)",
    appendixItem: "Part B",
  },
} as const;

export type DepreciationAssetClass = keyof typeof DEPRECIATION_ASSET_CLASSES;

export const DEPRECIATION_PUT_TO_USE = {
  full_rate: {
    label: "Full prescribed percentage (not an asset acquired this year and put to use for less than 180 days)",
  },
  half_rate_acquired_under_180_days: {
    label: "Acquired this year and put to use for less than 180 days — fifty per cent of the prescribed amount (second proviso to Section 32(1))",
  },
} as const;

export type DepreciationPutToUse = keyof typeof DEPRECIATION_PUT_TO_USE;

/**
 * Activity classification for the Section 70 loss pool. Section 70(1) is
 * expressly subject to contrary provisions ("Save as otherwise provided in
 * this Act"); Section 43(5) classifies eligible exchange-traded derivatives as
 * non-speculative, while Sections 73 and 73A restrict speculation-business and
 * specified-business losses. The Tax Desk vocabulary is pinned to these keys in
 * both directions without importing across the engine boundary.
 *
 * `K4-17` admitted exactly one member. **`K4-18` admits a second** —
 * `fno_non_speculative_s43_5_d` — on the strength of the official-source work
 * recorded in the k4-18-fno-source-research design notes, and adds
 * `intraday_speculative_s43_5` as an explicitly-named refusal. Two computable
 * members now exist, and each carries `turnoverFromBooksRevenue` stating
 * whether books revenue may serve as its Section 44AB figure. That flag is the
 * single authority on the question — the adapter reads it rather than
 * re-deciding per classification, so a future member cannot silently inherit
 * the ordinary answer.
 */
export const BUSINESS_BOOKS_ACTIVITY_CLASSIFICATIONS = {
  ordinary_business_or_profession: {
    label: "Ordinary business or profession (not F&O, speculation, or specified business)",
    computable: true,
    /**
     * Books revenue IS the Section 44AB figure for an ordinary undertaking:
     * "total sales, turnover or gross receipts" describes exactly what an
     * ordinary trading or service business books as revenue.
     */
    turnoverFromBooksRevenue: true,
    authority: "Sections 43(5), 70(1), 73 and 73A, Income-tax Act 1961",
  },
  /**
   * K4-18 — the one class this session adds to the computable pool.
   *
   * Section 43(5) proviso (d), verbatim:
   *
   *   "an eligible transaction in respect of trading in derivatives referred to"
   *   "in clause (ac) of section 2 of the Securities Contracts (Regulation) Act,"
   *   "1956 (42 of 1956) carried out in a recognised stock exchange"
   *
   * — closing "shall not be deemed to be a speculative transaction". Such an
   * undertaking is therefore an ORDINARY business under the head, and Section
   * 70(1) admits it to the same pool `K4-17` built. Nothing about it is
   * speculative, so Sections 28 Expl. 2 and 73 never engage.
   *
   * WHAT THE PREPARER IS DECLARING, AND WHY IT MUST BE DECLARED. Explanation 1
   * makes "eligible transaction" conjunctive: (A) carried out electronically on
   * screen-based systems through a SEBI-registered intermediary on a recognised
   * stock exchange, AND (B) supported by a time-stamped contract note bearing
   * the unique client identity number and PAN. The test is PER TRANSACTION.
   * This product holds no contract note, no exchange identity and no
   * intermediary registration, so it can verify none of it. Choosing this
   * member is the preparer's affirmation that EVERY transaction in the
   * undertaking meets Explanation 1. Absence of that affirmation is never read
   * as non-speculative — that is why `futures_and_options` is retained below as
   * a distinct, refusing member rather than being migrated onto this one.
   */
  fno_non_speculative_s43_5_d: {
    label:
      "Exchange-traded F&O — every transaction an eligible transaction, non-speculative under Section 43(5) proviso (d)",
    computable: true,
    /**
     * FALSE, and this is the load-bearing half of the K4-18 slice. Books
     * revenue for a derivatives undertaking is not "total sales, turnover or
     * gross receipts" in the Section 44AB sense, and NO official source
     * defines what is — not the 1961 Act (s.44AB's Explanation defines only
     * "accountant" and "specified date"), not the Income-tax Act 2025, not the
     * CBDT-notified Income-tax Rules 2026, and no CBDT circular, notification
     * or instruction. The ITR-3 instructions and Form 3CD prescribe no formula
     * either. The method in professional use is the ICAI Guidance Note's, which
     * is professional judgement and NOT law.
     *
     * So the engine never derives this figure. The preparer declares it, and
     * the engine applies the statutory threshold to what was declared. A row
     * that declares no turnover is REFUSED, never treated as though its books
     * revenue were its turnover. Evidence and tiering:
     * the k4-18-fno-source-research design notes §4.
     */
    turnoverFromBooksRevenue: false,
    authority: "Section 43(5) proviso (d) and Explanation 1, Income-tax Act 1961",
  },
  /**
   * RETAINED AS REFUSAL-ONLY, deliberately (K4-18). This is F&O that the
   * preparer has NOT affirmed against Explanation 1 — the honest "it is F&O and
   * I am not asserting proviso (d) applies to every transaction" answer. It
   * must keep refusing: proviso (d) is conditional, so unaffirmed derivative
   * activity falls back to the main limb and is speculative.
   */
  futures_and_options: {
    label: "Futures and options / exchange-traded derivatives (eligible-transaction status not affirmed)",
    computable: false,
    turnoverFromBooksRevenue: false,
    authority: "Section 43(5) and Explanation 1 thereto, Income-tax Act 1961",
  },
  /**
   * K4-18 — intraday equity, named explicitly so a preparer can declare what
   * they actually have rather than having to recognise it as "speculation
   * business". A cash-segment contract squared off without delivery is settled
   * "otherwise than by the actual delivery or transfer of the commodity or
   * scrips" and so falls in the Section 43(5) MAIN limb. Provisos (b) and (c)
   * do not reach a retail day-trader: (b) is a dealer or investor hedging an
   * existing holding, (c) is jobbing or arbitrage by a MEMBER of the exchange.
   *
   * REFUSED, and quarantined on two independent statutory footings: Explanation
   * 2 to Section 28 deems a speculation business "distinct and separate from
   * any other business", and Section 73(1) permits its loss to be set off only
   * against another speculation business. No speculation pool is implemented.
   */
  intraday_speculative_s43_5: {
    label: "Intraday equity settled without delivery — speculative under Section 43(5)",
    computable: false,
    turnoverFromBooksRevenue: false,
    authority:
      "Section 43(5) main limb with Explanation 2 to Section 28 and Section 73(1), Income-tax Act 1961",
  },
  speculation_business_s73: {
    label: "Speculation business",
    computable: false,
    turnoverFromBooksRevenue: false,
    authority: "Section 73 with Explanation 2 to Section 28, Income-tax Act 1961",
  },
  specified_business_s35ad: {
    label: "Specified business under Section 35AD",
    computable: false,
    turnoverFromBooksRevenue: false,
    authority: "Sections 35AD and 73A, Income-tax Act 1961",
  },
} as const;

export type BusinessBooksActivityClassification =
  keyof typeof BUSINESS_BOOKS_ACTIVITY_CLASSIFICATIONS;

/**
 * Risky free-text tokens that must never be stored in prep notes. This is a
 * practical validation guard, NOT a security product. Case-insensitive
 * substring / word matches.
 */
export const PORTAL_CREDENTIAL_PATTERNS: readonly RegExp[] = [
  /\bpassword\b/i,
  /\bpwd\b/i,
  /\botp\b/i,
  /\bcaptcha\b/i,
  /income[\s-]*tax[\s-]*portal[\s-]*password/i,
  /login[\s-]*password/i,
  /e[\s-]*filing[\s-]*password/i,
  /portal[\s-]*credential/i,
  /client[\s-]*password/i,
];

/** Small money tolerance for reconciliation mismatches (rupees). */
export const RECON_TOLERANCE = 1;

/**
 * PLACEHOLDERS — intentionally NOT implemented in K.2.0. Documented here so
 * downstream phases know what is missing. See README "Limitations".
 *
 * `seniorSlabs` (senior/super-senior OLD-regime basic-exemption widening) was
 * REMOVED from this object in K4-02 — it is now implemented (slabs.ts
 * `OLD_REGIME_SENIOR_SLABS` / `OLD_REGIME_SUPER_SENIOR_SLABS`). The senior
 * 80D cap and 80TTB-vs-80TTA mutual exclusivity are now implemented too
 * (K4-03, `deductionCapForSection` above) for the taxpayer's OWN age band,
 * and 80D's "insured party" (parent-premium) sub-case is now implemented as
 * well (K4-05, the `"80D_PARENTS"` section — see `DEDUCTION_CAPS`'s own
 * caveat above for the one remaining, unrelated 80D scope gap: a below-60
 * taxpayer with a senior SPOUSE). Section 207(2) advance-tax exemption
 * is DISCLOSED as of K4-04 — `validate-case.ts` raises the informational
 * `ADVANCE_TAX_EXEMPT_SENIOR_CITIZEN_207_2` finding — but no advance-tax
 * adequacy, instalment schedule, or 234B/234C interest amount is computed
 * anywhere, for any taxpayer (see
 * the k4-senior-treatment-specification design notes §10.4, marked DONE).
 * `houseProperty` was REMOVED from this object in K4-06 — it is now
 * computed (`HOUSE_PROPERTY` above, `computeHouseProperty` in
 * compute-tax.ts), for a SINGLE property per case only (co-ownership and
 * multiple-property loss-set-off interaction remain unmodelled — Wave-4
 * priority #5). K4-07 computes presumptive professional income (Section
 * 44ADA, `PRESUMPTIVE_44ADA` above) as a NEW income category distinct from
 * `businessIncome` below — general books-based business/professional
 * income remains the unimplemented placeholder `businessIncome` describes;
 * the books-of-account fallback path (actual profit declared BELOW the
 * deemed 50%) and Section 44AB tax-audit trigger detection remain
 * unimplemented for either category. K4-08 adds presumptive BUSINESS income
 * (Section 44AD, `PRESUMPTIVE_44AD` above) as two further computed
 * categories, split by receipt mode because 44AD's two deemed rates apply
 * to two portions of turnover; the Section 44AD(4)/(5) five-year lock-in
 * and its consequent Section 44AB audit trigger remain unimplemented (no
 * multi-year state exists in this product). K4-13 implemented the
 * eligible-ACTIVITY test for BOTH schemes — see
 * {@link PRESUMPTIVE_ACTIVITY_ELIGIBILITY}; what remains untested there is
 * the eligible-ASSESSEE limbs, which are properties of the person rather
 * than the activity.
 */
export const NOT_IMPLEMENTED = {
  /**
   * K4-11 narrowed this. Surcharge IS now computed for total income up to
   * ₹2,00,00,000 (the 10% and 15% tiers, where the 15% proviso on dividend /
   * 111A / 112 / 112A income is provably non-binding) — see {@link SURCHARGE}.
   * What remains unimplemented is the band ABOVE ₹2,00,00,000: the 25%/37%
   * tiers, the band test on total income EXCLUDING dividend/111A/112/112A that
   * they are conditioned on, and the apportionment of income-tax to those
   * components that the now-binding 15% proviso requires.
   */
  surcharge:
    "Surcharge above a total income of ₹2,00,00,000 (the 25%/37% tiers and the binding 15% cap on " +
    "dividend / 111A / 112 / 112A income) not applied; the 10%/15% tiers up to ₹2,00,00,000 are.",
  /**
   * K4-11 narrowed this for SURCHARGE marginal relief; **K4-12 narrowed the
   * remaining half — the Section 87A REBATE-threshold relief is now applied**
   * (see {@link REBATE_87A} and `rebate-relief.ts`), new-regime-only, exactly
   * where the case carries no special-rate 111A/112A income and proved nil
   * otherwise. What remains unimplemented for the 87A limb is the case that
   * DOES carry such income and where relief is not provably nil: it is refused
   * (relief nil, tax never understated) and reliance-blocked, not guessed.
   * What remains unimplemented for the surcharge limb is unchanged — the
   * ₹2 crore / ₹5 crore thresholds, both outside the surcharge window.
   */
  marginalRelief:
    "Marginal relief at the ₹2 crore / ₹5 crore surcharge thresholds not applied; relief at the ₹50 lakh " +
    "and ₹1 crore surcharge thresholds is applied within the window K4-11 sourced, and relief at the " +
    "Section 87A rebate threshold is applied within the window K4-12 sourced (new regime only, and only " +
    "where the case carries no special-rate 111A/112A income or relief is provably nil).",
  /**
   * K4-14 narrowed this; K4-20 narrowed it again. A books-based
   * business/profession net result IS now computed for the affirmatively-
   * declared case described by {@link BUSINESS_BOOKS} and
   * {@link BUSINESS_BOOKS_ADJUSTMENTS}: a non-negative aggregate after K4-17
   * current-year Section 70(1) set-off, turnover/gross receipts within the
   * Section 44AB threshold, and a declared basis of either `none_s30_43d` or
   * a complete standing-class Section 32(1)(ii) block set. Everything else —
   * an incomplete or out-of-set depreciation claim, additional depreciation
   * under s.32(1)(iia), any disallowance, a
   * presumptive-to-books transition, a residual business loss, and an
   * audit-threshold case — is REFUSED by the adapter and excluded, never
   * estimated. The legacy
   * `business_income` ledger head remains an uncomputed placeholder.
   *
   * K4-15 removed ONE item from that refusal list and nothing else: MORE THAN
   * ONE BUSINESS is now computed, as the Section 28 aggregate, with Section
   * 44AB tested once per limb on the sum. See {@link BUSINESS_BOOKS}. Every
   * refusal above survives and now applies to the whole head. K4-17 then
   * admits negative current-year sources only where Section 70(1) set-off
   * leaves that whole head zero or positive; Sections 71/72 remain refused.
   */
  businessIncome:
    "Sections 30-43D adjustments (depreciation under s.32, disallowances under s.37/40/43B), " +
    "presumptive-to-books transitions, residual business losses requiring s.71/s.72 treatment, " +
    "and s.44AB audit-threshold cases are not computed; s.70(1) current-year intra-head set-off is " +
    "computed only where the books-business aggregate remains non-negative; a books-based net result is " +
    "computed only in the narrow declared-adjustment-free window K4-14 sourced, aggregated across " +
    "businesses by K4-15. The legacy `business_income` placeholder head is still not computed.",
  foreignAssets: "Foreign assets / Schedule FA not computed (blocks ITR-1 only).",
  clubbing: "Clubbing of income not applied.",
  /** K4-09 narrowed this: WITHIN-YEAR set-off of 111A/112A capital losses IS
   *  now applied, but only inside the provably unambiguous window described in
   *  {@link CAPITAL_LOSS_SET_OFF}. Carry-forward across assessment years
   *  (Section 74) and brought-forward losses remain entirely unimplemented —
   *  no multi-year state exists in this product. */
  setOffCarryForward:
    "Carry-forward of losses across assessment years (s.74) and brought-forward losses not applied; " +
    "within-year capital-loss set-off is applied only in the narrow window K4-09 sourced.",
  fno: "F&O (speculative / non-speculative business) not applied.",
  crypto: "VDA / crypto (s.115BBH) not applied.",
  taxAudit: "Tax-audit (s.44AB) cases not handled.",
  basicExemptionAdjustment:
    "Resident adjustment of unexhausted basic exemption against 111A/112A gains not applied.",
  /**
   * K4-19. Section 89(1) relief on salary or pension received in ARREARS or in
   * advance, computed under Rule 21A and claimed on **Form 10E**, is not
   * applied. It is not a narrow window like the entries above — **none of it
   * is implemented**, for a reason that is structural rather than incidental
   * and that no amount of work inside this file can change.
   *
   * Rule 21A(2) requires, for EACH earlier previous year the arrears relate
   * to, the tax on that year's total income INCLUDING the portion attributable
   * to it, less the tax on that year's total income EXCLUDING it. That needs
   * **prior years' rate schedules** — each fixed by its own Finance Act — and
   * this engine holds exactly ONE year's figures: `statutory-rate-parameters`
   * declares six rate parameters for a single statutory world (D299/D310).
   * It also needs the prior years' total incomes, which are client facts the
   * ledger does not model, exactly as `setOffCarryForward` above records that
   * **no multi-year state exists in this product**.
   *
   * DIRECTION OF ERROR, stated because it differs from every other entry here.
   * Omitting relief can only OVERSTATE tax, never understate it — so this is
   * not a wrong-number-in-the-dangerous-direction risk. It is a
   * client-detriment risk and an unfiled Form 10E, which is why K4-19 made it
   * a declarable situation that routes to manual professional preparation and
   * an unmissable disclosure on Computation, rather than leaving it to be
   * noticed. See `SPECIAL_SITUATIONS.salary_arrears_section_89`
   * (`tax-desk/eligibility.ts`) and the `section_89_arrears_relief` pack rule.
   *
   * The other Section 89 limbs — gratuity, commuted pension and compensation
   * on termination under Rule 21A(3)-(5) — are equally unimplemented. K4-19
   * scoped its wording to arrears because that is what the office files; the
   * absence is the same for all of them and must not be read as narrower than
   * it is.
   */
  section89ArrearsRelief:
    "Section 89(1) relief on salary or pension received in arrears or in advance (Rule 21A, Form 10E) " +
    "is not computed at all — it requires prior years' rate schedules and prior years' total incomes, " +
    "and this engine holds one year's rate parameters and no multi-year state. Omitting it can only " +
    "overstate tax, never understate it. The Rule 21A(3)-(5) limbs (gratuity, commuted pension, " +
    "compensation on termination) are equally not computed.",
} as const;
