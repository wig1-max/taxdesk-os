/**
 * TaxDesk OS — the TY 2026-27 / Income-tax Act, 2025 world's STATUTORY RATE
 * PARAMETERS (`K4-PORT-02`, decision `D299`; **all six declared at
 * `K4-PORT-04`, decision `D314`**).
 *
 * PURE TYPESCRIPT ONLY.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS FOR, AND WHAT CHANGED
 * ---------------------------------------------------------------------------
 * `K4-PORT-02` created this file to make the second statutory world's inability
 * to compute **structural instead of remembered**: under `D299` the two worlds
 * share one arithmetic core and differ only in the parameters they supply, and
 * this world supplied almost none of them.
 *
 * **`K4-PORT-04` is the session that supplies them.** All six statutory rate
 * parameters are now declared from **this world's own sources** — Income-tax Act,
 * 2025 s.202(1) read with Finance Act, 2026 s.3(3) for the new-regime table;
 * Finance Act, 2026 First Schedule **Part I-B** for the old-regime tables, the
 * senior/super-senior bands, the surcharge and its marginal relief; s.3(15) for
 * the cess; Income-tax Rules, 2026 rule 164(3)(k) for the return-form ceiling.
 * `resolveEngineCapability` therefore reports **four** servable entry points and
 * `complete: true`, where it reported **zero** and `false` before.
 *
 * ---------------------------------------------------------------------------
 * READ THIS BEFORE CONCLUDING THAT THE 2025-ACT WORLD CAN NOW COMPUTE
 * ---------------------------------------------------------------------------
 * **IT CANNOT, AND NOTHING HERE MOVES IT CLOSER TO SERVING A REAL CASE.** What
 * "complete" means is exactly one thing: *this world can source every rate
 * figure the shared arithmetic needs.* It does **not** mean an arithmetic has
 * been wired to it. The pack's binding still carries **no `computation`
 * surface**, so:
 *   - `taxPackComputation` still returns `undefined`;
 *   - `bindTaxPackToCase` still refuses as `unbound`;
 *   - `resolveTaxPackForReliance` still refuses as `unverified`;
 *   - the blocker is still the existing `tax_pack_unverified`;
 *   - the pack is still truthfully `draft`, and no rule is `ca_verified`.
 *
 * **The OBSTACLE MOVED; it did not shrink to nothing.** Before this session the
 * refusal named a missing statutory authority. Now the authority is present and
 * the missing thing is the wiring — plus everything a 2025-Act computation would
 * need beyond rates, none of which exists: the adapter, the validation rules, the
 * deduction carve-outs s.202(2) lists, the Chapter VIII counterparts, the return
 * forms. A world that can price a slab is not a world that can prepare a return.
 * `parallel-worlds.test.ts` asserts every one of those refusals rather than
 * trusting this comment.
 *
 * ---------------------------------------------------------------------------
 * THE ONE THING TO UNDERSTAND BEFORE CHANGING ANYTHING HERE
 * ---------------------------------------------------------------------------
 * ITA 2025 **s.4(1)** charges income-tax "[w]here any Central Act enacts that
 * income-tax shall be charged … at any rate or rates" — exactly as 1961 s.4
 * did. The rate schedule for a tax year is therefore a **Finance Act** matter,
 * and that Act is the **Finance Act, 2026**: its **s.3(1)** charges tax year
 * 2026-27 under the Income-tax Act, 2025 at the rates in **First Schedule
 * Part I-B**, its **s.3(3)** routes a Chapter XIII Part C case (s.202, the new
 * regime) to that section's own rates, and its **s.3(15)** states the Health and
 * Education Cess at 4% in prose.
 *
 * **DO NOT REPLACE ANY FIGURE BELOW WITH THE 1961 ENGINE'S CONSTANT.** They are
 * Finance Act **2025** figures for a different Act and a different year, and
 * borrowing one would be, in this file's own earlier words, *"a fabrication
 * wearing the shape of a port"* — even where the two worlds' numbers coincide,
 * which for tax year 2026-27 they largely do. **The coincidence is the trap.**
 * Two enactments agreeing today is not one enactment shared: a future Finance
 * Act can move one half and not the other, and an imported constant would carry
 * that move silently into the wrong world. Every value here is this world's own
 * object, and `parallel-worlds.test.ts` asserts BOTH halves of that — the values
 * are equal (`toEqual`) and the objects are distinct (`not.toBe`).
 *
 * **No per-Act conditional exists and none may be added** (`D299`). Where the
 * two Acts diverge that is a different parameter, never an `if (law === …)`.
 *
 * ---------------------------------------------------------------------------
 * AND THE 1961-ACT WORLD STILL GETS NOTHING FROM THIS
 * ---------------------------------------------------------------------------
 * ICAI's edition reproduces only the 2025-Act half of the Finance Act, 2026:
 * **s.2 (Income-tax under Act 43 of 1961) and First Schedule Part I-A are both
 * OMITTED**, elided with the edition's own `* * *` marker (`D301`). The AY
 * 2026-27 pack's citations are untouched by this session, and its computed
 * output is pinned byte-for-byte by `port-slice-2-golden.test.ts` across 42
 * cases (`D309`/`D310`).
 */

import type {
  OldRegimeSlabTables,
  RebateSchedule,
  SlabBandShape,
  StatutoryRateParameters,
  SurchargeSchedule,
} from "@/lib/tax-engine/core/statutory-rate-parameters";
import { taxPackKey } from "../identity";
import { TY_2026_27_PERIOD, TY_2026_27_RULES_VERSION } from "./ty-2026-27-coordinates";
import { TY_2026_27_PACK_PROVENANCE } from "./ty-2026-27-provenance";
import { availableFrom } from "./rate-parameters";

const PROVENANCE = TY_2026_27_PACK_PROVENANCE;

// ---------------------------------------------------------------------------
// THIS WORLD'S OWN FIGURES
//
// Declared here rather than in an engine module because this world HAS no engine
// module: `D299` shares the arithmetic and parameterises the figures, so the
// pack is the authority for what the 2025 Act charges. Each constant names the
// provision it was read from; the provision's text is quoted in the matching
// rule group's caveat in `./ty-2026-27-provenance.ts` and checked against a
// committed extract by `../__tests__/verbatim-quotes.test.ts`.
//
// EVERY TABLE FIGURE BELOW WAS RESOLVED ACROSS ALL THREE `pdftotext` MODES
// (the official-source-retrieval design notes §3.2), never one. That is not
// ceremony: `-layout` offset the s.202(1) rate column by one row at
// `K4-PORT-01`, which read naively pairs the nil band with 5%.
// ---------------------------------------------------------------------------

/**
 * New regime — **ITA 2025 s.202(1)**'s own Table, read in the enacted Act.
 *
 *   1. Upto Rs. 400000            Nil
 *   2. From Rs. 400001 to 800000    5%
 *   3. From Rs. 800001 to 1200000  10%
 *   4. From Rs. 1200001 to 1600000 15%
 *   5. From Rs. 1600001 to 2000000 20%
 *   6. From Rs. 2000001 to 2400000 25%
 *   7. Above Rs. 2400000           30%
 *
 * **Its operative authority for tax year 2026-27 is an OWNER DECISION (`D314`),
 * not an inference, and that is why this constant exists at all.** `K4-PORT-02`
 * (`D299`) withheld this table despite it being printed in the Act, because
 * whether s.202(1) **alone** fixes the tax year's rates without the Finance Act,
 * 2026 is a tax question and `PROJECT_CONSTITUTION.md` §2 rule 5 puts that
 * outside a session's authority. `K4-SOURCE-01` (`D301`) declined it again.
 * `K4-PORT-04` put it to the owner — a tax professional — with the text of
 * Finance Act, 2026 s.3(3), which determines tax in cases under **Part A, B, C
 * or D of Chapter XIII** "with reference to … the rates as specified in that
 * Chapter or section", and with the fact that **s.202 sits in Chapter XIII
 * Part C**. His answer: s.202(1) is operative for this tax year **read with
 * s.3(3)**. The rule group cites both, and neither alone.
 *
 * The band boundaries coincide with the 1961-Act engine's `NEW_REGIME_SLABS`,
 * asserted rather than assumed — and this is a separate object, deliberately.
 */
export const TY_2026_27_NEW_REGIME_SLABS: readonly SlabBandShape[] = Object.freeze([
  Object.freeze({ from: 0, to: 400_000, rate: 0 }),
  Object.freeze({ from: 400_000, to: 800_000, rate: 0.05 }),
  Object.freeze({ from: 800_000, to: 1_200_000, rate: 0.1 }),
  Object.freeze({ from: 1_200_000, to: 1_600_000, rate: 0.15 }),
  Object.freeze({ from: 1_600_000, to: 2_000_000, rate: 0.2 }),
  Object.freeze({ from: 2_000_000, to: 2_400_000, rate: 0.25 }),
  Object.freeze({ from: 2_400_000, to: Infinity, rate: 0.3 }),
]);

/**
 * Old regime — **Finance Act, 2026 First Schedule Part I-B Paragraph A**, read
 * in the Income Tax Department's own rank-1 publication.
 *
 * The Income-tax Act, 2025 carries **no old-regime rate table at all**: s.202(4)
 * provides only the opt-out, and the rates that then apply come from this
 * Paragraph. That is the same structure the 1961 Act had, which is why this is a
 * continuity rather than a change.
 *
 *   item (I)   individual below sixty  — nil to 250000, 5%, 20%, 30%
 *   item (II)  resident sixty to <80   — nil to 300000, then identical
 *   item (III) resident eighty or more — nil to 500000, absorbing the 5% band
 *
 * **THE SUPER-SENIOR BAND SURVIVES, AND IT WAS AN OPEN QUESTION.** `D298`
 * recorded that "super senior" and "eighty years" appear ZERO times in the
 * enacted Act and that the band's survival into tax year 2026-27 "must not be
 * assumed". It is not assumed: item (III) states it. The 80-year concept lives
 * in a Finance Act rate paragraph and in no section — exactly as under the 1961
 * Act — which is why the age DEFINITION and these rate BANDS are two separate
 * rule groups in the provenance.
 *
 * **A typesetting artifact, recorded because a reader will meet it.** Item
 * (I)(4) prints "Rs. 112500 plus 3 0% of the amount…", with a space inside the
 * rate, in all three extraction modes — so it is the PDF's, not one mode's. It
 * is 30%: items (II)(4) and (III)(3) both print "30%" and the arithmetic agrees
 * (112500 = 12500 + 20% of 500000). The caveat quotes the span as it stands
 * rather than tidied.
 */
export const TY_2026_27_OLD_REGIME_SLAB_TABLES: OldRegimeSlabTables = Object.freeze({
  // Part I-B ¶A item (I).
  below60: Object.freeze([
    Object.freeze({ from: 0, to: 250_000, rate: 0 }),
    Object.freeze({ from: 250_000, to: 500_000, rate: 0.05 }),
    Object.freeze({ from: 500_000, to: 1_000_000, rate: 0.2 }),
    Object.freeze({ from: 1_000_000, to: Infinity, rate: 0.3 }),
  ]),
  // Part I-B ¶A item (II) — resident, sixty or more but less than eighty.
  senior: Object.freeze([
    Object.freeze({ from: 0, to: 300_000, rate: 0 }),
    Object.freeze({ from: 300_000, to: 500_000, rate: 0.05 }),
    Object.freeze({ from: 500_000, to: 1_000_000, rate: 0.2 }),
    Object.freeze({ from: 1_000_000, to: Infinity, rate: 0.3 }),
  ]),
  // Part I-B ¶A item (III) — resident, eighty or more. The widened exemption
  // absorbs the whole 5% band, so this table goes nil straight to 20%.
  superSenior: Object.freeze([
    Object.freeze({ from: 0, to: 500_000, rate: 0 }),
    Object.freeze({ from: 500_000, to: 1_000_000, rate: 0.2 }),
    Object.freeze({ from: 1_000_000, to: Infinity, rate: 0.3 }),
  ]),
});

/**
 * Surcharge — **Finance Act, 2026 First Schedule Part I-B Paragraph F**, Table 1
 * Sl. No. 1 for the rates and Table 2 Sl. No. 1 for the marginal-relief bands.
 *
 * **ONLY THE TWO BANDS INSIDE THE SUPPORTED WINDOW ARE DECLARED, and the
 * omission of the 25% and 37% tiers is deliberate rather than incomplete.**
 * Above two crore, clause (vi) binds: where the total income includes dividend
 * income or capital gains under ss.196/197/198, the surcharge rate on the
 * income-tax computed on **that part** may not exceed 15%. Honouring that needs
 * an apportionment of income-tax between the capped and uncapped parts, which is
 * modelled nowhere. Inside the declared window every band rate is at or below
 * the cap, so the cap is provably non-binding and the answer does not depend on
 * the income's composition — a proof, not a convenience.
 *
 * Declaring the higher tiers here and relying on `supportedTotalIncomeCeiling`
 * to keep them unused would leave them one refactor away from being applied.
 * They are ABSENT for the same reason the 1961-Act world's are.
 *
 * `entryThreshold` is **strict**: Table 1 charges only where total income
 * "exceeds Rs. 5000000", so exactly ₹50,00,000 attracts nil. That is the `D44`
 * boundary restated for this world from this world's text, because the same
 * off-by-one is available here.
 */
export const TY_2026_27_SURCHARGE: SurchargeSchedule = Object.freeze({
  bands: Object.freeze([
    Object.freeze({ exceeding: 50_00_000, upTo: 1_00_00_000, rate: 0.1 }),
    Object.freeze({ exceeding: 1_00_00_000, upTo: 2_00_00_000, rate: 0.15 }),
  ]),
  entryThreshold: 50_00_000,
  supportedTotalIncomeCeiling: 2_00_00_000,
  specialRateSurchargeRateCap: 0.15,
});

/**
 * Health and Education Cess — **Finance Act, 2026 s.3(15)**, at 4%.
 *
 * **PROSE, NOT A TABLE**, which makes it the one figure in this file that
 * carries none of the row-shuffling hazard. The Income-tax Act, 2025 contains no
 * counterpart: "Health and Education Cess" appears zero times in the enacted
 * Act, and cess is a Finance Act matter under both Acts.
 *
 * A reading hazard worth keeping: the two halves of this one Finance Act spell
 * the same rate differently — the 1961-Act half writes "four per cent." in words
 * at s.2(6), this half prints 4% in digits. `AUDIT-11-F5` was a falsified cess
 * rate in the sibling world, so a needle written for one half must not be
 * assumed to cover the other.
 */
export const TY_2026_27_CESS_RATE = 0.04;

/**
 * Return-form ceiling — **Income-tax Rules, 2026 rule 164(3)(k)**, read in
 * ICAI's reproduction (rank 2, `K4-PORT-02-S2`), not the Gazette.
 *
 * **THIS PARAMETER WAS WITHHELD FOR A REASON THAT WAS NEVER ABOUT SOURCING, AND
 * `D314` IS THE DECISION THAT DISCHARGED IT.** `K4-SOURCE-01` cited the rule and
 * then deliberately left the figure withheld, because `recommendItrForm` depends
 * on this parameter in addition to the computation set, and supplying it alone
 * would have moved this world's derived engine capability. A citation sweep may
 * not make that change in passing; slice 5 supplies all six together, which is
 * the session `D301` was deferring to.
 *
 * **The rule's own narrowness survives the citation, and it is not small.**
 * Rule 164(3) carries FOURTEEN disqualifying conditions and this figure is one
 * of them, so a form recommendation resting on the ceiling alone is narrower
 * than the rule. That limit is recorded in the rule group's caveat, which is
 * rendered, rather than only here.
 */
export const TY_2026_27_ITR1_INCOME_CEILING = 50_00_000;

/**
 * Rebate — **ITA 2025 s.156**, the 2025 Act's own figures.
 *
 * s.156(1) gives ₹12,500 at ₹5,00,000 and s.156(2)(a) gives ₹60,000 at
 * ₹12,00,000, both quoted verbatim in this pack's provenance.
 *
 * **`D170`'s OLD-REGIME CLIFF SURVIVES THE PORT VERBATIM.** s.156(2) is
 * conditioned on the income being chargeable under s.202(1), structurally
 * identical to the 1961 proviso's conditioning on s.115BAC(1A), so no marginal
 * relief reaches the ₹5,00,000 limb and its ceiling stays a genuine cliff — a
 * computed nil rather than an unimplemented gap.
 *
 * This was the ONE parameter `K4-PORT-02` supplied, on the ground that marking a
 * genuinely sourced figure withheld would misreport this world as emptier than it
 * is. That reasoning is unchanged; it is now simply no longer the exception.
 */
export const TY_2026_27_REBATE: RebateSchedule = Object.freeze({
  // s.156(2)(a)/(b): the ₹60,000 / ₹12,00,000 limb, conditioned on s.202(1),
  // with the clause (b) marginal relief that reaches only that limb.
  new: Object.freeze({
    incomeLimit: 12_00_000,
    maxRebate: 60_000,
    marginalReliefAvailable: true,
  }),
  // s.156(1): the ₹12,500 / ₹5,00,000 limb. No relief reaches it — see above.
  old: Object.freeze({
    incomeLimit: 5_00_000,
    maxRebate: 12_500,
    marginalReliefAvailable: false,
  }),
});

/**
 * The parameters the TY 2026-27 pack supplies to the shared core — which is, as
 * of `K4-PORT-04`, **all six**.
 *
 * Each `availableFrom` call names the pack provenance rule group(s) that
 * authorise the figure and reads the official-source ids OUT of that provenance,
 * so a parameter can never state an authority the pack does not declare
 * (`PROJECT_CONSTITUTION.md` §3, one authority per concept). Every one of the
 * six now resolves at least one source id, so no `allowUncited` exception is
 * used anywhere in this world — and `availableFrom` refuses a stale one, so a
 * later session cannot leave the flag behind after citing a rule.
 */
export const TY_2026_27_RATE_PARAMETERS: StatutoryRateParameters = Object.freeze({
  // The SHARED core the parameters are shaped for. Naming the 1961-Act engine
  // module here would be wrong twice over: nothing in this world is served by
  // it, and `D299` shares the arithmetic, not the world.
  engineId: "tax-engine/core",
  packKey: taxPackKey({
    jurisdiction: "IN",
    law: "ITA_2025",
    periodKind: "tax_year",
    period: TY_2026_27_PERIOD,
    computationRulesVersion: TY_2026_27_RULES_VERSION,
  }),

  // s.202(1) read with Finance Act, 2026 s.3(3) — the owner decision `D314`.
  newRegimeSlabs: availableFrom(
    PROVENANCE,
    "new_regime_slabs",
    ["slab_rates"],
    TY_2026_27_NEW_REGIME_SLABS,
  ),

  // The senior / super-senior widening is a SEPARATE rule group from the base
  // slab table and both authorise this one parameter — which is why a parameter
  // names rule idS, plural. Both now cite Part I-B Paragraph A.
  oldRegimeSlabs: availableFrom(
    PROVENANCE,
    "old_regime_slabs",
    ["slab_rates", "senior_super_senior_basic_exemption_widening"],
    TY_2026_27_OLD_REGIME_SLAB_TABLES,
  ),

  surcharge: availableFrom(
    PROVENANCE,
    "surcharge",
    ["surcharge_rates", "surcharge_marginal_relief"],
    TY_2026_27_SURCHARGE,
  ),

  cess: availableFrom(PROVENANCE, "cess", ["cess_rate"], TY_2026_27_CESS_RATE),

  rebate: availableFrom(
    PROVENANCE,
    "rebate",
    ["rebate_87a", "rebate_87a_marginal_relief"],
    TY_2026_27_REBATE,
  ),

  itrFormIncomeCeiling: availableFrom(
    PROVENANCE,
    "itr_form_income_ceiling",
    ["itr1_income_ceiling"],
    TY_2026_27_ITR1_INCOME_CEILING,
  ),
});
