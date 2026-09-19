/**
 * TaxDesk OS — Official-source PROVENANCE for the TY 2026-27 / Income-tax Act,
 * 2025 pack (Wave K.4 port, `K4-PORT-01`).
 *
 * PURE TYPESCRIPT ONLY. Data only — nothing here participates in a computation,
 * and no rule value, slab, cap, or rate is declared, restated, or changed.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE IS, AND WHAT IT DELIBERATELY IS NOT
 * ══════════════════════════════════════════════════════════════════════════
 *
 * It is the FIRST slice of the 1961 → 2025 port decided by `D297`: the rule
 * groups the AY 2026-27 pack declares, re-cited to their Income-tax Act, 2025
 * counterparts, with the statutory text quoted VERBATIM from the ENACTED Act.
 *
 * It is NOT a computation. The TY 2026-27 pack still carries NO `binding`, so:
 *   - `bindTaxPackToCase` still refuses it as `unbound`;
 *   - `resolveTaxPackForReliance` still refuses it as `unverified`;
 *   - it is still truthfully `draft`.
 *
 * **Registering provenance must not make anything computable that was not
 * computable before.** That is the stub's founding rule (`K3-15`) and it is
 * unchanged. What provenance changes is only the QUALITY of the refusal: before
 * this session a reader was told "no rules declare official-source provenance";
 * now they are told, rule by rule, exactly which 2025-Act provision governs and
 * exactly what is still unverified about it. `__tests__/parallel-worlds.test.ts`
 * proves the refusal paths are untouched rather than asserting it.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THE SOURCE, AND WHY EVERY QUOTE COMES FROM IT
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `K4-PORT-00-S2` — **Income-tax Act, 2025 `[30 OF 2025]`, AS ENACTED, as
 * amended by the Finance Act, 2026**, assented by the President on 21-8-2025.
 * Registered in the official-source-retrieval design notes §6.
 * `K4-PORT-01` re-extracted it independently from the same PDF rather than
 * inheriting a prior session's scratch text, and reproduced the register's
 * 25,923-line extraction exactly.
 *
 * **The ITD mapping utility (`K4-PORT-00-S1`) is rank 4 and is NOT quoted
 * anywhere in this file.** It establishes that a counterpart exists and its
 * number; it does not establish that two provisions say the same thing. Every
 * quotation below was read in the enacted Act itself.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * SECTION-NUMBER COLLISIONS ARE THE HAZARD THIS FILE IS BUILT AROUND
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The 1961 and 2025 Acts share section numbers that mean different things, and
 * `OPS-14` recorded a real incident where a supplied "Section 72" turned out to
 * be the 2025 Act's. Every `citation` below therefore names its Act in full.
 *
 * **`K4-PORT-01` found the same class of error INSIDE the port assessment that
 * warned about it** (see `ITA_2025_S66_SPECULATIVE_TRANSACTION` below): the
 * assessment cited the F&O carve-out as "s.2(31)(a) + s.2(33)", but in the
 * enacted Act **s.2(31) is "Commissioner" and s.2(33) is "Commissioner
 * (Appeals)"**. The derivative definitions live in **section 66**. A bare
 * clause number carried without its owning SECTION is the same defect as a bare
 * section number carried without its Act.
 */

import {
  makeOfficialSourceReference,
  makeRuleProvenance,
  makeTaxPackProvenance,
  // `QUOTE_EDITORIAL_BRACKET` is deliberately NOT imported any more. Its single
  // user in this pack was the "[w]here any Central Act enacts…" quotation of ITA
  // 2025 s.4(1), repeated across the five rule groups that cited nothing; those
  // five now cite the Finance Act, 2026 and quote IT instead. The CONSTANT stays
  // exported from `../provenance` — an editorial bracket is the right
  // declaration the moment a caveat needs one, and `verbatim-quotes.test.ts`
  // asserts the reason census, so its use count moving is a visible event.
  QUOTE_ELIDED,
  QUOTE_EMPHASIS_ADDED,
  QUOTE_NOT_STATUTORY_TEXT,
  // `QUOTE_SOURCE_NOT_REGISTERED` is no longer imported, and the reason is a
  // property worth naming rather than a lint fix: **this pack no longer declares
  // ANY span as resting on a source the repository holds no artifact for.** Its
  // one use was the 1961-Act s.29 contrast span, and `K4-PORT-04` registered the
  // consolidated Act (owner-supplied) so that span is now CHECKED. Every
  // remaining unverifiable span here fails for a reason about the QUOTATION —
  // elision, emphasis, not-statute — never about a missing document.
  // The AY pack still uses the constant 42 times, and those 42 are not fixable by
  // acquiring anything: they quote help pages and secondary publishers.
  QUOTE_SPACE_LOST_IN_EXTRACTION,
  type TaxPackProvenance,
} from "../provenance";

/**
 * The blanket caveat every rule in this pack carries.
 *
 * It is deliberately STRONGER than the AY pack's `RECONFIRM_ANNUALLY`. That
 * pack's rules are implemented and merely unverified; these are **not
 * implemented at all**. No rule id below is served by any computation, because
 * the pack has no binding. `verification.ts` requires a caveat to be explicitly
 * resolved before a rule can be verified, so while this stands no rule here can
 * be rubber-stamped — which is the point.
 */
const NOT_IMPLEMENTED_PROVENANCE_ONLY =
  "TODO(CA-verify): PROVENANCE ONLY — the TY 2026-27 pack implements NO rule and serves NO computation " +
  "surface, so nothing computes from this entry. K4-PORT-04 changed what is MISSING without changing " +
  "that: the pack now declares all six statutory rate parameters from this world's own sources, so the " +
  "obstacle is no longer an unsourced rate but the absence of a wired computation. It records which " +
  "Income-tax Act, 2025 provision would govern, quoted from the enacted Act, so a later porting session " +
  "re-derives against statute rather than against the 1961 engine's constants. Re-confirm every " +
  "quotation directly against the bare Act text before CA verification.";

/**
 * The caveat for a rule whose figures come from the FINANCE ACT, 2026 rather
 * than from the Income-tax Act itself.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THIS CONSTANT REPLACES `FINANCE_ACT_2026_NOT_HELD` (`K4-PORT-04`, `D314`)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Its predecessor said, of five rule groups: *"NO SOURCE IS CITED,
 * DELIBERATELY … The rate schedule for tax year 2026-27 is therefore the
 * FINANCE ACT, 2026 First Schedule, which THIS REPOSITORY DOES NOT HOLD."*
 *
 * **That was true when it was written and is corrected FORWARD, not rewritten**
 * (`PROJECT_CONSTITUTION.md` §4). `D300` found the Finance Act, 2026 on this
 * machine; `K4-SOURCE-01` (`D301`) read it and recorded that Part I-B sources
 * all five, deliberately leaving the citations to the session that would also
 * declare the FIGURES — because a citation sweep may not start the port's
 * parameter threading. `K4-PORT-04` is that session, and it does both.
 *
 * `K4-PORT-00` §4's underlying point is UNCHANGED and still the reason this
 * constant exists: ITA 2025 s.4(1) keeps rates a Central Act matter, exactly as
 * 1961 s.4 did, so a 2025-Act rate rule is sourced from a Finance Act and not
 * from the Act. What changed is only that the Finance Act is now in hand.
 *
 * **The two limits that survive citing, both stated in the rendered text
 * because a preparer sees the caveat and not this comment:**
 *   1. **RANK, per span since `K4-CITE-01` (`D315`).** s.3 is read in the
 *      GAZETTE itself (`K4-PORT-04-S1`, rank 1). The Part I-B AMOUNT spans stay
 *      read in the Income Tax Department's own publication
 *      (`K4-SOURCE-02-S2`, rank 1) because the Gazette prints this Part's
 *      amounts with the rupee glyph, which extraction drops — the higher
 *      authority is the harder one to quote, and the citation says so.
 *   2. **TABLES.** Every rate in Part I-B is in a table, and `-layout` shuffles
 *      these tables' rows. Each figure below was resolved across ALL THREE
 *      `pdftotext` modes (`official-source-retrieval.md` §3.2).
 *
 * **Citing is still not verifying** (§2 rule 10). No rule here becomes
 * `ca_verified`, and every rule still carries a caveat that must be explicitly
 * resolved before it could.
 */
const FINANCE_ACT_2026_PART_I_B_SOURCED =
  "TODO(CA-verify): SOURCED FROM THE FINANCE ACT, 2026, WHICH THIS ENTRY ONCE SAID WAS NOT HELD. " +
  "Income-tax Act, 2025 s.4(1) keeps rates a Central Act matter, and that Central Act is the Finance " +
  "Act, 2026: its section 3(1) provides that \"for the tax year commencing on the 1st day of April, " +
  "2026, income-tax shall be charged under the provisions of the Income-tax Act, 2025\" \"at the rates " +
  "specified in Part I-B of the First Schedule\". This entry previously cited nothing and said the Act " +
  "was not held; that was true when written and is corrected forward, never rewritten (D300 found the " +
  "Act, K4-SOURCE-01 read it, K4-PORT-04 cites it). TWO LIMITS SURVIVE THE CITATION AND BOTH MATTER. " +
  "(1) RANK: section 3 is read in the GAZETTE itself (No. 4 of 2026, source rank 1), while the " +
  "quoted First Schedule Part I-B AMOUNT spans are read in the Income Tax Department's own " +
  "publication (source rank 1) — the Gazette prints this Part's amounts with the rupee glyph, " +
  "which extraction drops, so the ITD copy is the quotable text for them (K4-CITE-01, D315). " +
  "(2) TABLES: every rate in Part I-B sits in a table and " +
  "pdftotext -layout shuffles these tables' rows, so each figure was resolved across ALL THREE " +
  "extraction modes rather than one. Citing is not verifying: this pack is still draft.";

// ═══════════════════════════════════════════════════════════════════════════
// OFFICIAL SOURCE REFERENCES — Income-tax Act, 2025 [30 of 2025], as enacted
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Salary deductions, including the standard deduction.
 *
 * NEW CITATION, not a re-citation: the AY 2026-27 pack's `standard_deduction`
 * rule cites NO source at all ("The engine documents the amounts but names no
 * statutory source"). The enacted 2025 Act closes that gap, so this pack cites
 * it. Verbatim, s.19(1) Table Sl. No. 2 ("Standard deduction"): "(a) Rs. 75000
 * or the salary, whichever is less, where income-tax is computed under section
 * 202(1); (b) Rs. 50000 or the salary, whichever is less, in any other case."
 * Those are the figures the 1961-Act engine already holds.
 */
const ITA_2025_S19_SALARY_DEDUCTIONS = makeOfficialSourceReference({
  id: "ITA_2025_S19",
  kind: "act_section",
  authority: "Parliament",
  citation:
    "Section 19(1) (Table: Sl. No. 2 — standard deduction), Income-tax Act, 2025 [30 of 2025], as enacted",
  identifier: "19(1) Table Sl.2",
});

/**
 * "Senior citizen", defined in the Act itself.
 *
 * Verbatim, s.2(101): "\"senior citizen\" means an individual resident in India
 * who is of the age of sixty years or more at any time during the relevant tax
 * year". The resident requirement and the "at any time during" test both
 * survive the port verbatim.
 *
 * **There is NO super-senior (80 years) category anywhere in the enacted Act** —
 * see `senior_super_senior_age_definition` below.
 */
const ITA_2025_S2_101_SENIOR_CITIZEN = makeOfficialSourceReference({
  id: "ITA_2025_S2_101",
  kind: "act_section",
  authority: "Parliament",
  citation: "Section 2(101) (\"senior citizen\"), Income-tax Act, 2025 [30 of 2025], as enacted",
  identifier: "2(101)",
});

/** House property: charge (s.20), annual value (s.21), deductions (s.22). */
const ITA_2025_S20_TO_S22_HOUSE_PROPERTY = makeOfficialSourceReference({
  id: "ITA_2025_S20_TO_S22",
  kind: "act_section",
  authority: "Parliament",
  citation:
    "Sections 20 to 22 (income from house property; determination of annual value; deductions), " +
    "Income-tax Act, 2025 [30 of 2025], as enacted",
  identifier: "20-22",
});

/** Business/profession: the charge. 1961 counterpart s.28. */
const ITA_2025_S26_BUSINESS_CHARGE = makeOfficialSourceReference({
  id: "ITA_2025_S26",
  kind: "act_section",
  authority: "Parliament",
  citation:
    "Section 26 (income under head \"Profits and gains of business or profession\"), " +
    "Income-tax Act, 2025 [30 of 2025], as enacted",
  identifier: "26",
});

/**
 * Speculation business deemed distinct. 1961 counterpart is Explanation 2
 * to s.28. Cited separately from the s.26 charge because `K4-PORT-07` /
 * `D318` needs the deeming, not the charge, to record the carve-out's
 * reach: this sub-section sits in Part D of Chapter IV, which is the
 * scope of s.66. Equivalence with the 1961 Explanation is a CA question
 * and is not decided here.
 */
const ITA_2025_S26_3_SPECULATION_BUSINESS = makeOfficialSourceReference({
  id: "ITA_2025_S26_3",
  kind: "act_section",
  authority: "Parliament",
  citation:
    "Section 26(3) (speculation business deemed distinct and separate from any other business), " +
    "Income-tax Act, 2025 [30 of 2025], as enacted — this sub-section sits in Part D of Chapter IV, " +
    "which is the scope of section 66",
  identifier: "26(3)",
});

/**
 * Business/profession: the manner of computation. 1961 counterpart s.29.
 *
 * **THE COMPUTATION RANGE CHANGED AND THE DIFFERENCE IS LOAD-BEARING.** 1961
 * s.29 says income under s.28 "shall be computed in accordance with the
 * provisions contained in sections 30 to 43D". The 2025 counterpart, s.27, says
 * verbatim: "The income referred to in section 26 shall be computed as per the
 * provisions of sections 28 to 60, except section 58."
 *
 * The `business_books_computation` rule's whole narrowness rests on "THIS ENGINE
 * IMPLEMENTS NONE OF SECTIONS 30 TO 43D". Under the 2025 Act the equivalent
 * sentence is a different, wider range with an express carve-out for the
 * presumptive section. A porting session must restate that boundary against
 * s.27's own words, not translate the 1961 range section by section.
 */
const ITA_2025_S27_BUSINESS_COMPUTATION = makeOfficialSourceReference({
  id: "ITA_2025_S27",
  kind: "act_section",
  authority: "Parliament",
  citation:
    "Section 27 (manner of computing profits and gains of business or profession — \"as per the " +
    "provisions of sections 28 to 60, except section 58\"), Income-tax Act, 2025 [30 of 2025], as enacted",
  identifier: "27",
});

/**
 * Carry forward of business loss. 1961 counterpart s.72.
 *
 * Cited because `business_books_computation` names the 1961 Sections 71/72
 * cross-head and carry-forward treatment as explicitly unimplemented, and a
 * reader of the ported rule needs the 2025 coordinate for that same gap.
 * `OPS-14` recorded a real incident in which a supplied "Section 72" was in fact
 * the 2025 Act's — so this id names its Act, and s.112 is the 2025 provision
 * that does what 1961 s.72 does.
 */
const ITA_2025_S112_BUSINESS_LOSS_CARRY_FORWARD = makeOfficialSourceReference({
  id: "ITA_2025_S112",
  kind: "act_section",
  authority: "Parliament",
  citation:
    "Section 112 (carry forward and set off of business loss), Income-tax Act, 2025 [30 of 2025], as enacted",
  identifier: "112",
});

/**
 * **THE ONE BUCKET-B ITEM, AND THE ONE CITATION `K4-PORT-00` GOT WRONG.**
 *
 * `k4-port-delta-assessment.md` §2/§3 and `D297` all cite this carve-out as
 * "s.2(31)(a) + s.2(33)". **That is a misattribution.** In the enacted Act:
 *   - **s.2(31) is "Commissioner"**;
 *   - **s.2(33) is "Commissioner (Appeals)"**.
 *
 * The definitions actually relied on are in **section 66**, whose opening words
 * are "66. For the purposes of Part D of this Chapter,--". Verbatim:
 *
 *   s.66(31): "\"speculative transaction\" means a transaction in which a
 *   contract for the purchase or sale of any commodity, including stocks and
 *   shares, is periodically or ultimately settled otherwise than by the actual
 *   delivery or transfer of the commodity or scrips, other than the following
 *   transactions:-- (a) a specified derivative transaction as defined in clause
 *   (33); …"
 *
 *   s.66(33): "\"specified derivative transaction\" means any transaction in
 *   respect of trading in derivatives referred to in section 2(ac) of the
 *   Securities Contracts (Regulation) Act, 1956 (42 of 1956); …"
 *
 * Two substantive points a porting session must not lose:
 *
 * 1. **The carve-out is now a DEFINITION, not an Explanation to a proviso.**
 *    1961 s.43(5)'s proviso (d) with Explanation 1 excluded an "eligible
 *    transaction"; 2025 s.66(31)(a) excludes a "specified derivative
 *    transaction" defined standalone in s.66(33). `K4-PORT-07` / `D318`
 *    re-cited the capability row against that formulation. Equivalence of
 *    the two formulations is a CA question and is not decided here.
 * 2. **The definition is SCOPED to "Part D of this Chapter"**, not Act-wide.
 *    Reach recorded in `D318`: s.26 (including s.26(3)) sits in Part D, so
 *    s.66 applies there; s.108 and s.113 sit in Chapter VII and speak of
 *    speculation business, not speculative transaction.
 *
 * The conjunctive per-transaction conditions `K4-18` relies on survive in
 * s.66(33)(a)-(b) — screen-based trading on a recognised stock exchange through
 * a SEBI-registered intermediary, supported by a time-stamped contract note
 * bearing the unique client identity number. This product holds none of that
 * evidence, so the affirmation stays the preparer's under either Act.
 */
const ITA_2025_S66_SPECULATIVE_TRANSACTION = makeOfficialSourceReference({
  id: "ITA_2025_S66_31_33",
  kind: "act_section",
  authority: "Parliament",
  citation:
    "Section 66(31) (\"speculative transaction\") and section 66(33) (\"specified derivative " +
    "transaction\"), Income-tax Act, 2025 [30 of 2025], as enacted — the interpretation section for " +
    "Part D of Chapter IV, NOT section 2 (in the enacted Act s.2(31) is \"Commissioner\" and s.2(33) is " +
    "\"Commissioner (Appeals)\")",
  identifier: "66(31), 66(33)",
});

/**
 * Presumptive business. 1961 counterpart s.44AD. s.58(2) Table **Sl. No. 1**.
 *
 * Verbatim from column D: "(a) Does not exceed two crore rupees; or (b) does not
 * exceed three crore rupees, where the amount or aggregate of amounts received,
 * in cash, does not exceed 5% of the total turnover or gross receipts." Column E
 * gives "6% of total turnover or gross receipts which is received by specified
 * banking or online mode" plus "8% of total turnover or gross receipts as
 * reduced by the turnover or gross receipts" covered by the 6% limb — the same
 * two-rates-on-two-portions shape the 1961-Act engine implements.
 */
const ITA_2025_S58_PRESUMPTIVE_BUSINESS = makeOfficialSourceReference({
  id: "ITA_2025_S58_TABLE_SL1",
  kind: "act_section",
  authority: "Parliament",
  citation:
    "Section 58(2) (Table: Sl. No. 1 — any business other than goods carriage), presumptive profits " +
    "and gains, Income-tax Act, 2025 [30 of 2025], as enacted",
  identifier: "58(2) Table Sl.1",
});

/**
 * Presumptive profession. 1961 counterpart s.44ADA. s.58(2) Table **Sl. No. 3**.
 *
 * **`K4-PORT-00` §2 recorded this as "s.58(2) Table Sl.2". That serial is
 * wrong.** In the enacted Act, Table Sl. No. 2 is "Business of plying, hiring or
 * leasing goods carriage" — the 1961 s.44AE counterpart, which this engine does
 * not implement. The profession row is **Sl. No. 3**: "Specified profession as
 * referred to in section 62(4)", "(a) Does not exceed fifty lakh rupees; or (b)
 * does not exceed seventy-five lakh rupees, where the amount or aggregate of
 * amounts received in cash does not exceed 5% of the gross receipts", computed
 * at "50% of the gross receipts or profit claimed to have been actually earned,
 * whichever is higher" — the same ₹50L/₹75L/50% shape the engine holds.
 */
const ITA_2025_S58_PRESUMPTIVE_PROFESSION = makeOfficialSourceReference({
  id: "ITA_2025_S58_TABLE_SL3",
  kind: "act_section",
  authority: "Parliament",
  citation:
    "Section 58(2) (Table: Sl. No. 3 — specified profession referred to in section 62(4)), presumptive " +
    "profits and gains, Income-tax Act, 2025 [30 of 2025], as enacted",
  identifier: "58(2) Table Sl.3",
});

/**
 * Books of account, and the "specified profession" list. 1961 counterpart
 * s.44AA, whose s.44AA(1) list the presumptive-profession gate depends on.
 *
 * Verbatim, s.62(4)(a): "legal, medical, engineering, architectural,
 * accountancy, technical consultancy, interior decoration, information
 * technology or company secretary" — the same nine professions.
 */
const ITA_2025_S62_BOOKS_AND_PROFESSIONS = makeOfficialSourceReference({
  id: "ITA_2025_S62",
  kind: "act_section",
  authority: "Parliament",
  citation:
    "Section 62 (maintenance of books of account; s.62(4) \"specified profession\"), " +
    "Income-tax Act, 2025 [30 of 2025], as enacted",
  identifier: "62",
});

/**
 * Tax audit. 1961 counterpart s.44AB.
 *
 * Verbatim, s.63(1) Table Sl. No. 1: "(a) carrying on business shall, if his
 * total sales, turnover or gross receipts, as the case may be, in business
 * exceed or exceeds one crore rupees in any tax year, subject to the provisions
 * of clause (b)"; "(c) carrying on profession shall, if his gross receipts in
 * profession exceed fifty lakh rupees in any tax year." Clause (b) substitutes
 * "ten crore rupees" where BOTH the cash-receipts and cash-payments limbs stay
 * within 5% — the same two-limb condition the AY pack deliberately does not
 * apply, because no ledger here captures cash PAYMENTS.
 */
const ITA_2025_S63_TAX_AUDIT = makeOfficialSourceReference({
  id: "ITA_2025_S63",
  kind: "act_section",
  authority: "Parliament",
  citation: "Section 63 (tax audit), Income-tax Act, 2025 [30 of 2025], as enacted",
  identifier: "63",
});

/**
 * Intra-head set-off. 1961 counterpart s.70.
 *
 * Verbatim, s.108(1): "Unless provided otherwise in this Act, for any tax year,
 * if net result of computation from any source under any head of income (other
 * than \"Capital gains\") is a loss, then assessee shall be entitled to set off
 * such loss against his income from any other source under the same head for
 * that tax year." The "Unless provided otherwise" opening — which is what
 * `K4-17`'s bounded window is built on — survives verbatim.
 *
 * s.108(2) carries the capital-gains limbs: a short-term loss set off "against
 * the income, computed in respect of any other capital asset", a long-term loss
 * "against the income computed in respect of any other long-term capital asset".
 */
const ITA_2025_S108_INTRA_HEAD_SET_OFF = makeOfficialSourceReference({
  id: "ITA_2025_S108",
  kind: "act_section",
  authority: "Parliament",
  citation:
    "Section 108 (set off of losses under same head of income), Income-tax Act, 2025 [30 of 2025], as enacted",
  identifier: "108",
});

/**
 * A capital loss may not cross heads. 1961 counterpart s.71(3).
 *
 * Verbatim, s.109(2): "For any tax year, the loss under the head \"Capital
 * gains\" shall not be set off against income under any other head."
 */
const ITA_2025_S109_2_CAPITAL_LOSS = makeOfficialSourceReference({
  id: "ITA_2025_S109_2",
  kind: "act_section",
  authority: "Parliament",
  citation:
    "Section 109(2) (a capital loss may not be set off against any other head), " +
    "Income-tax Act, 2025 [30 of 2025], as enacted",
  identifier: "109(2)",
});

/**
 * The ₹2,00,000 house-property cross-head cap. 1961 counterpart s.71(3A).
 *
 * Verbatim, s.109(1)(b): "loss under the head \"Income from house property\"
 * shall be set off to the extent of Rs. 200000 against income under any other
 * head." Same figure, and now an inline condition on s.109(1) rather than a
 * separate sub-section.
 */
const ITA_2025_S109_1_B_HOUSE_PROPERTY_LOSS = makeOfficialSourceReference({
  id: "ITA_2025_S109_1_B",
  kind: "act_section",
  authority: "Parliament",
  citation:
    "Section 109(1)(b) (house-property loss set off against any other head to the extent of Rs. 200000), " +
    "Income-tax Act, 2025 [30 of 2025], as enacted",
  identifier: "109(1)(b)",
});

/**
 * Carry forward of capital losses. 1961 counterpart s.74.
 *
 * Verbatim, s.111(2): "No loss shall be carried forward under this section for
 * more than eight tax years immediately succeeding the tax year for which the
 * loss was first computed." The eight-year boundary the AY pack's
 * `capital_loss_brought_forward_set_off` enforces survives, now counted in TAX
 * YEARS rather than assessment years — a counting-model change the ported rule
 * must carry, because the pack's records are keyed by originating year.
 */
const ITA_2025_S111_CAPITAL_LOSS_CARRY_FORWARD = makeOfficialSourceReference({
  id: "ITA_2025_S111",
  kind: "act_section",
  authority: "Parliament",
  citation:
    "Section 111 (carry forward and set off of loss from Capital gains), " +
    "Income-tax Act, 2025 [30 of 2025], as enacted",
  identifier: "111",
});

/**
 * Speculation-business losses. 1961 counterpart s.73.
 *
 * Verbatim, s.113(1): "Any loss, computed in respect of a speculation business
 * carried on by the assessee shall be set off only against profits and gains of
 * another speculation business." s.113(3) carries a FOUR-tax-year carry-forward
 * limit — and `OPS-14` recorded that a Section 73 page of Year 2000 vintage had
 * once supplied "eight assessment years" as stale law, so the number is quoted
 * here from the enacted text rather than carried over.
 */
const ITA_2025_S113_SPECULATION_LOSS = makeOfficialSourceReference({
  id: "ITA_2025_S113",
  kind: "act_section",
  authority: "Parliament",
  citation:
    "Section 113 (set off and carry forward of losses computed in respect of speculation business), " +
    "Income-tax Act, 2025 [30 of 2025], as enacted",
  identifier: "113",
});

/**
 * Specified-business losses. 1961 counterpart s.73A.
 *
 * Verbatim, s.114(1): "Any loss, computed in respect of a specified business,
 * referred to in section 46, shall be set off only against profits and gains of
 * another specified business." The cross-reference moves from 1961 s.35AD to
 * 2025 s.46.
 */
const ITA_2025_S114_SPECIFIED_BUSINESS_LOSS = makeOfficialSourceReference({
  id: "ITA_2025_S114",
  kind: "act_section",
  authority: "Parliament",
  citation:
    "Section 114 (set off and carry forward of losses computed in respect of specified business, " +
    "referred to in section 46), Income-tax Act, 2025 [30 of 2025], as enacted",
  identifier: "114",
});

/**
 * Health-insurance premia. 1961 counterpart s.80D.
 *
 * The senior widening survives, RESTRUCTURED. 1961 s.80D states the ₹50,000
 * figure inline per bucket; 2025 s.126 states ₹25,000 in s.126(2)(a) (self and
 * family) and s.126(2)(b) (parents), then substitutes by rule — verbatim,
 * s.126(8)(a): "such person is a senior citizen, the amount of sum as provided
 * in such clauses, shall be substituted with Rs. 50000 for Rs. 25000".
 *
 * The two-bucket structure the AY pack's `senior_80d_deduction_cap` and
 * `senior_80d_parents_deduction_cap` treat as separate caps survives: s.126(4)
 * caps "the aggregate of the sum specified under sub-section (2)(a) and (c) or
 * aggregate of the sum specified under sub-section (2)(b) and (d)" — two
 * aggregates, not one. Substitution keys on the INSURED person being a senior
 * citizen, matching the AY pack's parents-bucket reading.
 */
const ITA_2025_S126_HEALTH_INSURANCE = makeOfficialSourceReference({
  id: "ITA_2025_S126",
  kind: "act_section",
  authority: "Parliament",
  citation:
    "Section 126 (deduction in respect of health insurance premia), Income-tax Act, 2025 [30 of 2025], as enacted",
  identifier: "126",
});

/**
 * Interest on deposits. **1961 s.80TTA AND s.80TTB COLLAPSE INTO THIS ONE
 * SECTION** — the only many-to-one collapse in the ported surface.
 *
 * The mutual exclusivity the AY pack enforces is now structural rather than
 * inferred: s.153(1) splits the assessee into "(a) an individual, not being a
 * senior citizen", "(b) an individual, being a senior citizen", and "(c) a Hindu
 * undivided family"; s.153(2) then gives (a)/(c) "the whole of the interest up
 * to a maximum amount of Rs. 10000 on deposits in a savings account, excluding
 * time deposits" and (b) "the whole of the interest up to a maximum amount of
 * Rs. 50000 on deposits in any account, including time deposits."
 *
 * Same ₹10,000/₹50,000 figures, same savings-only vs all-deposits distinction —
 * but one section cannot be claimed twice, so the two provisions can no longer
 * be additively claimed even in principle.
 */
const ITA_2025_S153_DEPOSIT_INTEREST = makeOfficialSourceReference({
  id: "ITA_2025_S153",
  kind: "act_section",
  authority: "Parliament",
  citation:
    "Section 153 (deduction for interest on deposits — the single section into which Income-tax Act, " +
    "1961 sections 80TTA and 80TTB both collapse), Income-tax Act, 2025 [30 of 2025], as enacted",
  identifier: "153",
});

/**
 * The rebate and its marginal relief. 1961 counterpart s.87A and its provisos.
 *
 * Verbatim, s.156(1): a resident individual is "entitled to a deduction of 100%
 * of income-tax payable or Rs. 12500, whichever is less … if such total income
 * does not exceed Rs. 500000."
 *
 * Verbatim, s.156(2), whose opening is the load-bearing part: "Where the total
 * income of a resident individual assessee for any tax year is chargeable to tax
 * **under section 202(1)** … (a) the income does not exceed twelve lakh rupees,
 * 100% of the income-tax payable or Rs. 60000, whichever is less; (b) the total
 * income exceeds twelve lakh rupees and the income-tax payable on such total
 * income exceeds the amount by which the total income is in excess of twelve
 * lakh rupees, an amount equal to the amount by which the income-tax payable on
 * such total income is in excess of the amount by which the total income exceeds
 * twelve lakh rupees."
 *
 * Verbatim, s.156(3): "The deduction under sub-section (2), shall not exceed
 * income-tax payable as per the rates provided in section 202(1)."
 *
 * **`D170`'S OLD-REGIME CLIFF SURVIVES THE PORT VERBATIM.** s.156(2) is
 * conditioned on the total income being chargeable under s.202(1) — the new
 * regime — exactly as the 1961 proviso was conditioned on s.115BAC(1A). The
 * marginal relief in clause (b) is therefore still NEW-REGIME ONLY, and the old
 * regime's ₹5,00,000 ceiling in s.156(1) is still a genuine cliff whose ₹0 is a
 * computed nil rather than an unimplemented gap.
 */
const ITA_2025_S156_REBATE = makeOfficialSourceReference({
  id: "ITA_2025_S156",
  kind: "act_section",
  authority: "Parliament",
  citation:
    "Section 156 (rebate of income-tax in case of certain individuals; s.156(2)(b) marginal relief, " +
    "conditioned on section 202(1)), Income-tax Act, 2025 [30 of 2025], as enacted",
  identifier: "156",
});

/**
 * Short-term capital gains on STT-paid equity. 1961 counterpart s.111A.
 *
 * Verbatim, s.196(1)(i): "income-tax calculated on such short-term capital gains
 * at the rate of 20%" — identical to the engine's `stcg111aRate`.
 */
const ITA_2025_S196_STCG = makeOfficialSourceReference({
  id: "ITA_2025_S196",
  kind: "act_section",
  authority: "Parliament",
  citation:
    "Section 196 (tax on short-term capital gains in certain cases), Income-tax Act, 2025 [30 of 2025], as enacted",
  identifier: "196",
});

/**
 * Long-term capital gains on STT-paid equity. 1961 counterpart s.112A.
 *
 * Verbatim, s.198(2)(a): "income-tax calculated on such long-term capital gains
 * exceeding Rs. 125000 at the rate of 12.5%" — identical to the engine's
 * `ltcg112aRate` and its ₹1,25,000 annual exemption.
 */
const ITA_2025_S198_LTCG = makeOfficialSourceReference({
  id: "ITA_2025_S198",
  kind: "act_section",
  authority: "Parliament",
  citation:
    "Section 198 (tax on long-term capital gains in certain cases), Income-tax Act, 2025 [30 of 2025], as enacted",
  identifier: "198",
});

/**
 * The new regime. 1961 counterpart s.115BAC.
 *
 * **THE RATE TABLE IS DELIBERATELY NOT QUOTED AS A BLOCK, AND THE REASON IS A
 * REAL EXTRACTION HAZARD.** `official-source-retrieval.md` §3 directs
 * `pdftotext -layout` because statutory PDFs are multi-column. For this TABLE
 * `-layout` produces a MISALIGNED rendering in which the rate column is offset
 * by one row against the income column — read naively it pairs "Upto Rs. 400000"
 * with 5%. `K4-PORT-01` cross-checked with a second extraction WITHOUT
 * `-layout`, which renders the table column-major and resolves it: seven serial
 * numbers, seven income bands, seven rates, pairing
 *   Upto ₹4,00,000 → Nil; ₹4,00,001-₹8,00,000 → 5%; ₹8,00,001-₹12,00,000 → 10%;
 *   ₹12,00,001-₹16,00,000 → 15%; ₹16,00,001-₹20,00,000 → 20%;
 *   ₹20,00,001-₹24,00,000 → 25%; above ₹24,00,000 → 30%.
 * That agrees band-for-band with `NEW_REGIME_SLABS`, confirming `K4-PORT-00`'s
 * substance finding. **Never quote a statutory TABLE from a single extraction
 * mode.**
 *
 * Two further provisions this section carries, both of which the AY pack's
 * house-property and regime-option rules depend on: s.202(2)(a)(v) denies the
 * s.22(1)(b) interest deduction "in respect of properties referred to in section
 * 21(6)" (self-occupied), and s.202(2)(b)(ii) denies set-off of "any loss under
 * the head \"Income from house property\" with any other head of income".
 * s.202(4) is the opt-out, exercised "in such manner as may be prescribed" — the
 * counterpart to 1961 s.115BAC(6)'s Form 10-IEA procedure.
 */
const ITA_2025_S202_NEW_REGIME = makeOfficialSourceReference({
  id: "ITA_2025_S202",
  kind: "act_section",
  authority: "Parliament",
  citation:
    "Section 202 (new tax regime for individuals, Hindu undivided family and others; s.202(1) rate " +
    "Table, s.202(2) denied deductions and set-offs, s.202(4) opt-out), " +
    "Income-tax Act, 2025 [30 of 2025], as enacted",
  identifier: "202",
});

/**
 * Advance tax, and the senior-citizen exemption. 1961 counterpart s.207.
 *
 * Verbatim, s.403(3): the liability "shall not apply to an individual resident in
 * India, who-- (a) does not have any income chargeable under the head \"Profits
 * and gains of business or profession\"; and (b) is of the age of sixty years or
 * more at any time during the tax year." All three conditions of 1961 s.207(2) —
 * resident, no business/profession income, 60+ at any time — survive verbatim.
 */
const ITA_2025_S403_ADVANCE_TAX = makeOfficialSourceReference({
  id: "ITA_2025_S403",
  kind: "act_section",
  authority: "Parliament",
  citation:
    "Section 403 (liability for payment of advance tax; s.403(3) resident senior-citizen exemption), " +
    "Income-tax Act, 2025 [30 of 2025], as enacted",
  identifier: "403",
});

/**
 * Income from other sources. 1961 counterparts s.56 and s.57.
 *
 * Cited by `itr1_income_ceiling` and `chapter_via_deduction_caps` only as the
 * head they operate over. The AY pack carries no s.56/s.57 reference at all;
 * this one exists because the port is the moment the head acquires a citable
 * coordinate, not because any new rule is claimed.
 */
const ITA_2025_S92_93_OTHER_SOURCES = makeOfficialSourceReference({
  id: "ITA_2025_S92_93",
  kind: "act_section",
  authority: "Parliament",
  citation:
    "Sections 92 and 93 (income from other sources; deductions), Income-tax Act, 2025 [30 of 2025], as enacted",
  identifier: "92-93",
});

/**
 * THE ONE NON-ACT SOURCE IN THIS FILE, AND THE ONLY RANK-2 ONE (`K4-SOURCE-01`,
 * decision `D301`).
 *
 * Return forms and their eligibility conditions are prescribed by RULES, not by
 * the Act, so this rule group can only ever be cited to a statutory rule. Until
 * `D300` the Rules 2026 text was believed unretrievable and this rule therefore
 * cited nothing; `K4-SOURCE-01` read it.
 *
 * **Rank 2, and the citation says so.** The artifact read is ICAI's edition
 * (`K4-PORT-02-S2`), a REPRODUCTION that names its own primary source — CBDT
 * Notification No. 64/2026 / GSR 286(E) dated 16 April 2026 — which is the
 * rank-1 instrument named in `authority`/`citation` here. `official-source-
 * retrieval.md` §5 forbids a rank-2 reproduction silently standing in for
 * rank 1, so the reproduction is disclosed rather than elided.
 *
 * **Cross-checked in BOTH extraction modes (§3.2).** Rule 164(3)(k) is prose in
 * a lettered clause list rather than a rate table, and `-layout` and no-`-layout`
 * render it identically, clause letter included.
 *
 * **THE CEILING IS NOW SUPPLIED (`K4-PORT-04`, `D314`).** This comment read
 * *"This citation does NOT make the ceiling available to the engine"*, which was
 * `D301`'s deliberate sequencing: supplying it alone would have moved this world
 * from zero servable entry points to one, and a citation sweep may not make a
 * derived-capability change in passing. Slice 5 is the session `D301` deferred
 * to, and it supplies all six parameters together. Corrected forward, not
 * rewritten (`PROJECT_CONSTITUTION.md` §4). The rank-2 limit is untouched — this
 * is still a reproduction, and the citation still says so.
 */
// ═══════════════════════════════════════════════════════════════════════════
// FINANCE ACT, 2026 — the 2025-ACT HALF ONLY (`K4-PORT-04`, decision `D314`)
//
// EVERY SOURCE IN THIS BLOCK SERVES THE TAX YEAR 2026-27 / INCOME-TAX ACT, 2025
// WORLD, and that is the one thing to get right when reading it.
//
// The Finance Act, 2026 is ONE Act with TWO halves. **Section 2 and First
// Schedule Part I-A** charge under the Income-tax Act, 1961 — the AY 2026-27
// world, `ay-2026-27-provenance.ts`. **Section 3 and First Schedule Part I-B**
// charge under the Income-tax Act, 2025 — this world. `K4-SOURCE-02-S2`
// physically contains BOTH Parts in one PDF, so nothing but discipline and the
// `parallel-worlds` guard stops a session citing the wrong half out of the
// right file. NOTHING IN THIS BLOCK MAY BE CITED BY THE AY PACK, and nothing in
// that pack's Part I-A block may be cited here.
//
// TWO ARTIFACTS, TWO RANKS, AND THE DIFFERENCE IS NOT COSMETIC:
//   - the SECTIONS come from ICAI's reproduction (`K4-PORT-02-S1`, **rank 2**),
//     because the ITD copy this repository holds is s.2 — the 1961-Act half —
//     and s.3 was never retrieved from a rank-1 route. That corroboration is
//     **owed**, and it is one owner action at `incometaxindia.gov.in/finance-acts`.
//   - the FIRST SCHEDULE comes from the Income Tax Department's own publication
//     (`K4-SOURCE-02-S2`, **rank 1**).
// Both facts are disclosed in the `citation` strings, never left to a comment,
// because `official-source-retrieval.md` §5 forbids a lower tier standing in
// for a higher one silently.
//
// EXTRACTION DISCIPLINE (§3.2). Every rate in Part I-B is in a TABLE and was
// resolved across all three `pdftotext` modes; all three agree on Paragraph A
// and on Paragraph F Table 1, and `-layout` badly misrenders Paragraph F's
// Table 2 (the marginal-relief bands), where the default and `-raw` modes agree
// with each other. The cess is PROSE in s.3(15) and carries no table hazard.
//
// CITING CHANGED NO AY 2026-27 COMPUTED FIGURE, AND COULD NOT: these sources
// are consumed only by this pack, which serves no computation surface at all.
// `port-slice-2-golden.test.ts` pins the 1961-Act world's output across 42
// cases and is green before and after (`D309`/`D310`).

/**
 * Finance Act, 2026 **section 3** — the charging section for tax year 2026-27.
 *
 * **THIS IS THE SOURCE THE PORT'S OPEN TAX QUESTION TURNED ON.** `K4-PORT-02`
 * (`D299`) withheld the new-regime slab table despite it being printed in ITA
 * 2025 s.202(1), because whether s.202(1) **alone** fixes the tax year 2026-27
 * rates without the Finance Act, 2026 is a tax question and
 * `PROJECT_CONSTITUTION.md` §2 rule 5 puts that outside a session's authority.
 * `K4-SOURCE-01` declined it again and noted only that Part I-B is where the
 * answer lives.
 *
 * **`K4-PORT-04` put the question to the owner — a tax professional — with the
 * text below, and he answered it. `D314` records the answer**, which is that
 * s.202(1) is operative for tax year 2026-27 **read with s.3(3)**, so the
 * parameter is cited to BOTH. The evidence put to him, all of it read this
 * session and none of it previously in this repository:
 *
 *   - **s.3(1)** charges the tax year "at the rates specified in Part I-B of
 *     the First Schedule", *subject to* sub-sections (2) to (5);
 *   - **Part I-B Paragraph A carries only the old-regime tables** and contains
 *     no new-regime table and no reference to s.202 at all;
 *   - **s.3(3)** provides that in cases to which Part A, B, C or D of Chapter
 *     XIII applies, tax is determined as provided in that Chapter or section
 *     and with reference to the rates specified there — and **s.202 sits in
 *     Chapter XIII Part C** ("New Tax Regimes", ss.199-205), so s.3(3) reaches
 *     it;
 *   - **s.3(2)(a) Table Sl. No. 4** sets the maximum amount not chargeable at
 *     Rs. 400000 for a s.202 assessee, and **s.3(2)(b)**'s Xn formula names
 *     "Paragraph A of Part I-B … or section 202 of the said Act" as
 *     alternatives;
 *   - **s.3(4)(a)(ii)** excepts a s.202 person from the Paragraph F surcharge
 *     limb.
 *
 * The 1961-side analogue is exact — Finance Act 2026 **s.2(3)** does the same
 * for Chapter XII and s.115BAC(1A) — which is what makes the two worlds' rate
 * chains structurally identical rather than merely numerically equal.
 *
 * **Read in the Gazette itself since `K4-CITE-01` (`D315`), and rank 2 before
 * that.** s.3 first entered this repository through ICAI's rank-2 reproduction
 * (`K4-PORT-02-S1`) because the ITD copy on disk is s.2 (`K4-SOURCE-02-S1`) and
 * the ITD First Schedule copy carries the Schedule without the sections; the
 * owner then supplied the Finance Act, 2026 AS PUBLISHED IN THE GAZETTE
 * (`K4-PORT-04-S1`, 2026-08-17), and every span this pack quotes from s.3 was
 * verified present in it before the re-citation. The ICAI reproduction stays
 * registered as the artifact the `D314` reading first used; nothing quotes it
 * any more.
 */
const FINANCE_ACT_2026_S3 = makeOfficialSourceReference({
  id: "FINANCE_ACT_2026_S3",
  kind: "finance_act",
  authority: "Parliament",
  citation:
    "Finance Act, 2026, section 3 (\"Income-tax under Act 30 of 2025\") — sub-section (1) charging " +
    "income-tax for the tax year commencing on the 1st day of April, 2026 under the Income-tax Act, " +
    "2025 at the rates in Part I-B of the First Schedule; sub-section (3) determining tax in cases " +
    "under Part A, B, C or D of Chapter XIII (which contains section 202, the new regime) at the " +
    "rates specified in that Chapter or section; and sub-section (15) (Health and Education Cess at " +
    "4%) — read in the GAZETTE OF INDIA publication itself (No. 4 of 2026, the Finance Act, 2026 " +
    "Gazette), source rank 1 (the Gazette)",
  identifier: "3",
});

/**
 * Finance Act, 2026 **First Schedule Part I-B** — this world's rate schedule.
 *
 * Paragraph A carries the old-regime slab tables, item (I) for an individual
 * below sixty, item (II) for a resident aged sixty to under eighty and item
 * (III) for a resident aged eighty or more. Paragraph F carries the surcharge
 * (Table 1) and its marginal relief (Table 2, the Wn = Un + Vn formula).
 *
 * **THE SUPER-SENIOR BAND SURVIVES INTO TAX YEAR 2026-27, AND THAT IS A REAL
 * ANSWER TO AN OPEN QUESTION.** `D298` recorded that "super senior" and "eighty
 * years" appear ZERO times in the enacted Income-tax Act, 2025 and that the
 * band's survival "must not be assumed". It is not assumed here: Part I-B
 * Paragraph A item (III) states it, in the ITD's own rank-1 publication, in all
 * three extraction modes.
 *
 * **THE FIGURES COINCIDE WITH PART I-A's AND ARE NOT THE SAME FIGURES.** The
 * 2.5/3/5 lakh exemption thresholds and the 5/20/30% bands read identically in
 * both halves of this one Act. That is a coincidence of two enactments, not one
 * enactment shared: the two halves can diverge in any future Finance Act, and
 * nothing in this pack may reach into the 1961-Act world's constants to obtain
 * them. `parallel-worlds.test.ts` asserts both the coincidence and the
 * separateness.
 *
 * **A TYPESETTING ARTIFACT WORTH KNOWING ABOUT.** Paragraph A item (I)(4)
 * renders as "Rs. 112500 plus 3 0% of the amount…" — with a space inside the
 * rate — in ALL THREE extraction modes, so it is in the PDF rather than in one
 * mode's rendering. It is 30%: the parallel rows at item (II)(4) and item
 * (III)(3) both read "30%" and the arithmetic agrees. The span is quoted
 * verbatim in `slab_rates`' caveat, artifact included, rather than silently
 * repaired — a quotation this repository tidied would no longer be a quotation.
 */
/**
 * Finance Act, 2026 **First Schedule Part III** — cited for ONE thing only:
 * **rank-1 corroboration of the mechanism `D314` turns on.**
 *
 * **WHY THIS EXISTS AT ALL.** `D314`'s answer rests on s.3(3), and when that
 * answer was given s.3 was held here only in ICAI's **rank-2** reproduction —
 * the ITD copy on disk is s.2, the 1961-Act half. The owner asked whether the
 * Gazette or an ITD copy of s.3 was already supplied; it was not. But looking
 * for it found the next best thing in an artifact already held: **the ITD's own
 * First Schedule (rank 1) states the same mechanism, in a different Part, in
 * almost the same words.**
 *
 * **`K4-CITE-01` (`D315`) re-cited this source from the ITD copy to the GAZETTE
 * itself** (`K4-PORT-04-S1`), whose Part III is committed as an extract and
 * carries the same exclusion. With s.3 itself now Gazette-read, this source is
 * no longer the only rank-1 leg under `D314`'s mechanism — it is a SECOND,
 * independent one, and it stays cited for exactly that.
 *
 * Part III computes advance tax at its own rates, **excepting** advance tax
 * "in respect of any income chargeable to tax under Part A, B, C or D of Chapter
 * XIII … at the rates as specified in that Chapter or section". That exclusion
 * **presupposes** exactly what s.3(3) provides: income chargeable under Chapter
 * XIII Part A-D is charged at the rates specified in that Chapter or section. And
 * s.202 is in Chapter XIII Part C.
 *
 * **WHAT IT DOES NOT DO, stated because the temptation is to over-read it.** It
 * is **not s.3(3)** and it **does not itself charge the tax year**: it is an
 * exclusion inside the advance-tax Part. It corroborates the mechanism's
 * EXISTENCE and its exact WORDING; it does not charge anything, and it says
 * nothing about the cess.
 *
 * Parts II and III of this Schedule serve the 2025 Act throughout — their opening
 * lines reference "the Income-tax Act, 2025 (30 of 2025)" — unlike Parts I and
 * IV, which are split into A (1961) and B (2025) halves. So a TY citation may
 * name Part III without breaching the half separation `D301` established.
 */
const FINANCE_ACT_2026_FIRST_SCHEDULE_PART_III = makeOfficialSourceReference({
  id: "FINANCE_ACT_2026_FIRST_SCHEDULE_PART_III",
  kind: "finance_act",
  authority: "Parliament",
  citation:
    "Finance Act, 2026, First Schedule, PART III (rates for charging income-tax in certain cases, " +
    "deducting income-tax from income chargeable under the head \"Salaries\" and computing " +
    "\"advance tax\" under the Income-tax Act, 2025) — its opening exclusion for income chargeable " +
    "under Part A, B, C or D of Chapter XIII at the rates specified in that Chapter or section, " +
    "cited as CORROBORATION of that mechanism and NOT as a charging provision — read in the GAZETTE " +
    "OF INDIA publication itself (No. 4 of 2026), source rank 1 (the Gazette)",
});

const FINANCE_ACT_2026_FIRST_SCHEDULE_PART_I_B = makeOfficialSourceReference({
  id: "FINANCE_ACT_2026_FIRST_SCHEDULE_PART_I_B",
  kind: "finance_act",
  authority: "Parliament",
  citation:
    "Finance Act, 2026, First Schedule, PART I, B.--Income-tax under the Income-tax Act, 2025 " +
    "(Part I-B) — Paragraph A items (I), (II) and (III) for the slab tables including the resident " +
    "sixty-to-eighty and eighty-plus bands, and Paragraph F (\"Surcharge on income-tax\") Table 1 " +
    "Sl. No. 1 for the individual surcharge rates with Table 2 Sl. No. 1 for marginal relief " +
    "(Wn = Un + Vn) — the quoted AMOUNT spans stay checked against the Income Tax Department's own " +
    "publication (source rank 1), because the Gazette original (No. 4 of 2026) prints this Part's " +
    "amounts with the rupee glyph, which extraction drops, so the ITD copy is the quotable text " +
    "for them (K4-CITE-01, D315)",
});

// K4-24 — THE SECTION 89 COUNTERPART, AND ITS MACHINERY. Cited here for the
// first time. `D311` withheld this citation deliberately because the
// counterpart had not been identified and guessing a section number is the
// error `D298` found three times in the port assessment; the owner named the
// mapping in his K4-24 decisions and it was then VERIFIED against artifacts
// this repository already holds rather than accepted on his word alone —
// s.157 on page 194 of `K4-PORT-00-S2`, rule 73 on pages 123-127 of
// `K4-PORT-02-S2`, both committed as three-mode extracts.
//
// CITING IT COMPUTES NOTHING. This world still has no computation surface
// (`D319`), and identifying a counterpart does not give it one.
const ITA_2025_S157_ARREARS_RELIEF = makeOfficialSourceReference({
  id: "ITA_2025_S157",
  kind: "act_section",
  authority: "Parliament",
  // THE CITATION NAMES THIS WORLD'S INSTRUMENT AND NOTHING ELSE. The
  // correspondence with the 1961 Act belongs in the summary and the caveat, not
  // in the authority string a preparer reads as "what this rests on" — and the
  // `parallel-worlds` leak guard enforces exactly that, which is how the first
  // draft of this pair was caught naming the 1962 Rules inside a 2026-Rules
  // citation.
  citation:
    "Section 157 (relief when salary, etc., is paid in arrears or in advance), Income-tax Act, 2025 " +
    "[30 of 2025], as enacted",
  identifier: "157",
});

const ITR_RULES_2026_R73_RELIEF = makeOfficialSourceReference({
  id: "ITR_2026_R73",
  kind: "rule",
  authority: "CBDT",
  citation:
    "Rule 73 (relief under section 157(1) when salary is paid in arrears or in advance, gratuity, etc.; " +
    "sub-rule (3) prescribes Form No. 39), Income-tax Rules, 2026, notified by CBDT Notification " +
    "No. 64/2026 [F. No. 370142/41/2025-TPL] / GSR 286(E) dated 16 April 2026 — read in ICAI's " +
    "reproduction (source rank 2), NOT the Gazette",
  identifier: "73",
});

const ITR_RULES_2026_R164_RETURN_FORMS = makeOfficialSourceReference({
  id: "ITR_2026_R164",
  kind: "rule",
  authority: "CBDT",
  citation:
    "Rule 164 (return of income — Form SAHAJ (ITR-1) and Form SUGAM (ITR-4)), Income-tax Rules, 2026, " +
    "notified by CBDT Notification No. 64/2026 [F. No. 370142/41/2025-TPL] / GSR 286(E) dated 16 April 2026 " +
    "— read in ICAI's reproduction (source rank 2), NOT the Gazette",
  identifier: "164",
});

// ═══════════════════════════════════════════════════════════════════════════
// RULE GROUPS
//
// The rule IDS ARE DELIBERATELY IDENTICAL to the AY 2026-27 pack's, and
// `__tests__/parallel-worlds.test.ts` asserts the two sets match exactly in
// both directions. Two reasons:
//   1. rule ids are a stable contract — `verification.ts` records reference
//      them, and `case-traceability.ts` maps engine output lines onto them, so
//      a later slice re-keys a pack rather than renaming a contract;
//   2. an exact set match is the cheapest possible proof that the port covers
//      every declared rule and invents none — a rule appearing in only one
//      world fails the guard in whichever direction it drifted.
//
// Every entry carries a caveat, so no rule here can be verified while it
// stands (`verification.ts` requires a caveat to be explicitly resolved).
// ═══════════════════════════════════════════════════════════════════════════

export const TY_2026_27_PACK_PROVENANCE: TaxPackProvenance = makeTaxPackProvenance([
  makeRuleProvenance({
    ruleId: "slab_rates",
    summary:
      "BOTH slab families for tax year 2026-27. The NEW-regime bands and rates are section 202(1)'s own " +
      "Table, operative for this tax year read with Finance Act, 2026 section 3(3). The OLD-regime " +
      "table has no counterpart in the Income-tax Act, 2025 at all — s.202(4) provides only the " +
      "opt-out — and comes from Finance Act, 2026 First Schedule Part I-B Paragraph A.",
    sources: [
      ITA_2025_S202_NEW_REGIME,
      FINANCE_ACT_2026_S3,
      FINANCE_ACT_2026_FIRST_SCHEDULE_PART_I_B,
      // Corroboration only, at rank 1 — see the reference's own comment for what
      // it does and pointedly does not establish.
      FINANCE_ACT_2026_FIRST_SCHEDULE_PART_III,
    ],
    caveat:
      NOT_IMPLEMENTED_PROVENANCE_ONLY +
      " THE s.202(1) RATE TABLE MUST NOT BE QUOTED FROM A SINGLE EXTRACTION MODE: `pdftotext -layout` " +
      "renders it with the rate column offset by one row against the income column, which read naively " +
      "pairs \"Upto Rs. 400000\" with 5% instead of Nil. A second extraction without `-layout` renders " +
      "the table column-major and resolves it to seven bands (nil to Rs. 400000, then 5/10/15/20/25%, " +
      "30% above Rs. 2400000). " +
      "THE NEW-REGIME TABLE'S OPERATIVE AUTHORITY WAS AN OPEN TAX QUESTION AND IS NOW AN OWNER " +
      "DECISION (D314), NOT AN INFERENCE. K4-PORT-02 (D299) and K4-SOURCE-01 (D301) each declined to " +
      "decide whether s.202(1) ALONE fixes tax year 2026-27 rates without the Finance Act, 2026, and " +
      "withheld the figure rather than guess. K4-PORT-04 put it to the owner, a tax professional, with " +
      "the text of Finance Act, 2026 s.3: sub-section (3) provides that \"In cases to which the " +
      "provisions of Part A, B, C or D of Chapter XIII\" of the said Act apply, \"the tax chargeable " +
      "shall be determined-- (i) as provided in that Chapter or that section; and (ii) with reference " +
      "to the rates imposed by sub-section (1) or the rates as specified in that Chapter or section, " +
      "as the case may be.\" — and section 202 sits in Chapter XIII Part C. HIS ANSWER: s.202(1) is " +
      "operative for this tax year READ WITH s.3(3), so this rule cites both and neither alone. " +
      "THAT MECHANISM IS CORROBORATED AT RANK 1 BY A SECOND PROVISION, which mattered because " +
      "s.3 was then held only in a rank-2 reproduction — and matters still, now that K4-CITE-01 " +
      "(D315) has re-cited s.3 to the Gazette itself, because corroboration from a DIFFERENT " +
      "provision is independent of the Gazette's own printing of s.3. First Schedule PART III — " +
      "read in the Gazette itself since that re-citation — computes advance tax at its own rates " +
      "but EXCEPTS advance tax " +
      "\"in respect of any income chargeable to tax under Part A, B, C or D of Chapter XIII or " +
      "section 207 to 218, 223, 224, 307, 308, 311 or 334 of the said Act at the rates as specified " +
      "in that Chapter or section\". That exclusion PRESUPPOSES what s.3(3) provides. IT IS NOT " +
      "s.3(3) AND CHARGES NOTHING: it sits inside the advance-tax Part, so it corroborates the " +
      "mechanism's existence and its exact wording, never the charge itself — and it says nothing " +
      "about the cess. Rank-1 corroboration for s.3(1), s.3(3) and s.3(15) is no longer owed: " +
      "the Gazette itself is held, and s.3 is cited to it (K4-CITE-01, D315). " +
      "THE OLD-REGIME TABLE IS NOW COVERED BY THIS ENTRY TOO, from Part I-B Paragraph A item (I): " +
      "\"where the total income does not exceed Rs. 250000\" Nil, then \"where the total income " +
      "exceeds Rs. 250000 but does not exceed Rs. 500000\" at 5%, \"where the total income exceeds " +
      "Rs. 500000 but does not exceed Rs. 1000000\" at \"Rs. 12500 plus 20% of the amount by which the " +
      "total income exceeds Rs. 500000\", and above that \"Rs. 112500 plus 3 0% of the amount by which " +
      "the total income exceeds Rs. 1000000\". THAT LAST SPACE IS IN THE DOCUMENT, NOT IN ONE MODE'S " +
      "RENDERING — it appears identically in all three, the rate is 30%, and the parallel rows in " +
      "items (II) and (III) both print \"30%\" without it. It is quoted as it stands because a " +
      "quotation this repository tidied would no longer be a quotation. " +
      FINANCE_ACT_2026_PART_I_B_SOURCED,
    verbatimQuotes: [
      {
        artifactId: "K4-PORT-00-S2",
        text: "Upto Rs. 400000",
      },
      // ── Finance Act, 2026 s.3 — ICAI reproduction, rank 2 ──
      {
        artifactId: "K4-PORT-04-S1",
        text: "In cases to which the provisions of Part A, B, C or D of Chapter XIII",
      },
      {
        artifactId: "K4-PORT-04-S1",
        text: "the tax chargeable shall be determined-- (i) as provided in that Chapter or that "
            + "section; and (ii) with reference to the rates imposed by sub-section (1) or the rates "
            + "as specified in that Chapter or section, as the case may be.",
      },
      {
        artifactId: "K4-PORT-04-S1",
        text: "for the tax year commencing on the 1st day of April, 2026, income-tax shall be "
            + "charged under the provisions of the Income-tax Act, 2025",
      },
      {
        artifactId: "K4-PORT-04-S1",
        text: "at the rates specified in Part I-B of the First Schedule",
      },
      // ── First Schedule Part I-B Paragraph A item (I) — ITD, rank 1 ──
      {
        artifactId: "K4-SOURCE-02-S2",
        text: "where the total income does not exceed Rs. 250000",
      },
      {
        artifactId: "K4-SOURCE-02-S2",
        text: "where the total income exceeds Rs. 250000 but does not exceed Rs. 500000",
      },
      {
        artifactId: "K4-SOURCE-02-S2",
        text: "where the total income exceeds Rs. 500000 but does not exceed Rs. 1000000",
      },
      {
        artifactId: "K4-SOURCE-02-S2",
        text: "Rs. 12500 plus 20% of the amount by which the total income exceeds Rs. 500000",
      },
      {
        artifactId: "K4-SOURCE-02-S2",
        text: "Rs. 112500 plus 3 0% of the amount by which the total income exceeds Rs. 1000000",
      },
      {
        // Gazette Part I prints this rate cleanly; the rupee-glyph hazard affects
        // only the AMOUNT spans, which stay on the ITD copy (D315).
        artifactId: "K4-PORT-04-S1",
        text: "30%",
      },
      // ── First Schedule PART III — rank-1 corroboration of the s.3(3) mechanism ──
      {
        // Part III serves the 2025 Act throughout, so this TY span may name it;
        // re-pointed from the ITD copy to the Gazette's own Part III extract
        // (K4-CITE-01, D315).
        artifactId: "K4-PORT-04-S1",
        text: "in respect of any income chargeable to tax under Part A, B, C or D of Chapter XIII "
            + "or section 207 to 218, 223, 224, 307, 308, 311 or 334 of the said Act at the rates "
            + "as specified in that Chapter or section",
      },
    ],
  }),
  makeRuleProvenance({
    ruleId: "standard_deduction",
    summary:
      "Standard deduction against salary income, by regime — section 19(1) (Table: Sl. No. 2). " +
      "Rs. 75000 where income-tax is computed under section 202(1), Rs. 50000 in any other case.",
    // NOT a re-citation: the AY pack cites NO source for this rule. The enacted
    // 2025 Act closes that gap, so this pack cites it.
    sources: [ITA_2025_S19_SALARY_DEDUCTIONS],
    caveat:
      NOT_IMPLEMENTED_PROVENANCE_ONLY +
      " THIS ENTRY CLOSES A GAP RATHER THAN PORTING A CITATION: the AY 2026-27 pack's `standard_deduction` " +
      "rule cites NO statutory source at all (\"the engine documents the amounts but names no statutory " +
      "source\"), and the enacted Act supplies one. Quoted verbatim from s.19(1) Table Sl. No. 2 " +
      "(\"Standard deduction\"): \"(a) Rs. 75000 or the salary, whichever is less, where income-tax is " +
      "computed under section 202(1); (b) Rs. 50000 or the salary, whichever is less, in any other case.\"",
    verbatimQuotes: [
      {
        artifactId: "K4-PORT-00-S2",
        text: "Standard deduction",
      },
      {
        artifactId: "K4-PORT-00-S2",
        text: "(a) Rs. 75000 or the salary, whichever is less, where income-tax is computed under "
            + "section 202(1); (b) Rs. 50000 or the salary, whichever is less, in any other case.",
      },
    ],
    unverifiableQuotes: [
      {
        text: "the engine documents the amounts but names no statutory source",
        reason: QUOTE_NOT_STATUTORY_TEXT,
      },
    ],
  }),
  makeRuleProvenance({
    ruleId: "rebate_87a",
    summary:
      "Rebate parameters (income limit and maximum rebate), by regime — section 156(1) for the " +
      "Rs. 500000 / Rs. 12500 limb and section 156(2)(a) for the Rs. 1200000 / Rs. 60000 limb.",
    sources: [ITA_2025_S156_REBATE],
    caveat:
      NOT_IMPLEMENTED_PROVENANCE_ONLY +
      " Quoted verbatim, s.156(1): a resident individual is \"entitled to a deduction of 100% of " +
      "income-tax payable or Rs. 12500, whichever is less … if such total income does not exceed " +
      "Rs. 500000\"; and s.156(2)(a): \"the income does not exceed twelve lakh rupees, 100% of the " +
      "income-tax payable or Rs. 60000, whichever is less\". Both figures match the 1961-Act engine's " +
      "constants. The section number moves 87A -> 156; the rebate itself is unchanged in substance.",
    verbatimQuotes: [
      {
        artifactId: "K4-PORT-00-S2",
        text: "the income does not exceed twelve lakh rupees, 100% of the income-tax payable or Rs. "
            + "60000, whichever is less",
      },
    ],
    unverifiableQuotes: [
      {
        text: "entitled to a deduction of 100% of income-tax payable or Rs. 12500, whichever is less "
            + "… if such total income does not exceed Rs. 500000",
        reason: QUOTE_ELIDED,
      },
    ],
  }),
  makeRuleProvenance({
    ruleId: "rebate_87a_marginal_relief",
    summary:
      "Marginal relief at the REBATE threshold — section 156(2)(b). Where total income exceeds twelve " +
      "lakh rupees and the income-tax on it exceeds that excess, the deduction is the difference, capped " +
      "by section 156(3) at the income-tax payable at section 202(1) rates. NEW REGIME ONLY: section " +
      "156(2) is conditioned on the total income being chargeable under section 202(1), so the old " +
      "regime's Rs. 500000 ceiling in section 156(1) remains a genuine cliff with no relief. A SEPARATE " +
      "relief from `surcharge_marginal_relief`, sharing only the name.",
    sources: [ITA_2025_S156_REBATE],
    caveat:
      NOT_IMPLEMENTED_PROVENANCE_ONLY +
      " `D170`'S OLD-REGIME CLIFF SURVIVES THE PORT VERBATIM, AND THAT IS THE LOAD-BEARING FINDING HERE. " +
      "Quoted verbatim, s.156(2): \"Where the total income of a resident individual assessee for any tax " +
      "year is chargeable to tax under section 202(1), then from income-tax … following deductions shall " +
      "be allowed, if-- … (b) the total income exceeds twelve lakh rupees and the income-tax payable on " +
      "such total income exceeds the amount by which the total income is in excess of twelve lakh rupees, " +
      "an amount equal to the amount by which the income-tax payable on such total income is in excess of " +
      "the amount by which the total income exceeds twelve lakh rupees.\" And s.156(3): \"The deduction " +
      "under sub-section (2), shall not exceed income-tax payable as per the rates provided in section " +
      "202(1).\" The conditioning on s.202(1) is structurally identical to the 1961 proviso's conditioning " +
      "on s.115BAC(1A), so the relief remains new-regime-only and the old-regime nil remains a COMPUTED " +
      "nil rather than an unimplemented gap. NOT RESOLVED BY THE PORT: the special-rate 111A/112A " +
      "ambiguity `D171` refuses under the 1961 Act is neither resolved nor worsened by the 2025 text — " +
      "s.156 does not state how \"the income-tax payable on such total income\" composes when the case " +
      "mixes slab and special-rate income, so the same refusal would be owed.",
    verbatimQuotes: [
      {
        artifactId: "K4-PORT-00-S2",
        text: "The deduction under sub-section (2), shall not exceed income-tax payable as per the "
            + "rates provided in section 202(1).",
      },
      {
        artifactId: "K4-PORT-00-S2",
        text: "the income-tax payable on such total income",
      },
    ],
    unverifiableQuotes: [
      {
        text: "Where the total income of a resident individual assessee for any tax year is "
            + "chargeable to tax under section 202(1), then from income-tax … following deductions "
            + "shall be allowed, if-- … (b) the total income exceeds twelve lakh rupees and the "
            + "income-tax payable on such total income exceeds the amount by which the total income "
            + "is in excess of twelve lakh rupees, an amount equal to the amount by which the "
            + "income-tax payable on such total income is in excess of the amount by which the total "
            + "income exceeds twelve lakh rupees.",
        reason: QUOTE_ELIDED,
      },
    ],
  }),
  makeRuleProvenance({
    ruleId: "capital_gains_stcg_111a",
    summary:
      "Short-term capital gains rate on STT-paid listed equity / equity-oriented fund / business-trust " +
      "units — section 196.",
    sources: [ITA_2025_S196_STCG],
    caveat:
      NOT_IMPLEMENTED_PROVENANCE_ONLY +
      " Quoted verbatim, s.196(1)(i): \"income-tax calculated on such short-term capital gains at the " +
      "rate of 20%\" — identical to the rate the 1961-Act engine holds. NOT covered by this entry: " +
      "s.196(2)'s resident basic-exemption shortfall step, which the AY pack also records as externally " +
      "sourced and not reproduced.",
    verbatimQuotes: [
      {
        artifactId: "K4-PORT-00-S2",
        text: "income-tax calculated on such short-term capital gains at the rate of 20%",
      },
    ],
  }),
  makeRuleProvenance({
    ruleId: "capital_gains_ltcg_112a",
    summary:
      "Long-term capital gains rate and annual exemption on STT-paid listed equity / equity-oriented " +
      "fund / business-trust units — section 198.",
    sources: [ITA_2025_S198_LTCG],
    caveat:
      NOT_IMPLEMENTED_PROVENANCE_ONLY +
      " Quoted verbatim, s.198(2)(a): \"income-tax calculated on such long-term capital gains exceeding " +
      "Rs. 125000 at the rate of 12.5%\" — identical to both the rate and the annual exemption the " +
      "1961-Act engine holds.",
    verbatimQuotes: [
      {
        artifactId: "K4-PORT-00-S2",
        text: "income-tax calculated on such long-term capital gains exceeding Rs. 125000 at the rate "
            + "of 12.5%",
      },
    ],
  }),
  makeRuleProvenance({
    ruleId: "capital_gains_house_sale",
    summary:
      "Capital gains on a sale of land or building — the Income-tax Act, 2025 counterpart of " +
      "Income-tax Act, 1961 sections 45 and 48. NOT IMPLEMENTED, and additionally NOT YET LOCATED " +
      "in the enacted 2025 Act this session.",
    sources: [],
    caveat:
      "TODO(CA-verify): NO SOURCE IS CITED, DELIBERATELY. This session implemented the 1961 / " +
      "AY 2026-27 house-sale slice only. Identifying the 2025-Act counterpart is source work and " +
      "must be done by reading the Act, not by mapping a section number (`D298`). The TY world " +
      "still has no computation surface. Guessing a 2025 section would be the same error as " +
      "citing s.2(31) for what is actually s.66(31).",
  }),
  makeRuleProvenance({
    ruleId: "cess_rate",
    summary:
      "Health & Education Cess applied on tax plus surcharge less rebate — Finance Act, 2026 section " +
      "3(15). NO counterpart exists in the Income-tax Act, 2025: cess is a Finance Act matter under " +
      "both Acts, and the phrase appears zero times in the enacted Act.",
    sources: [FINANCE_ACT_2026_S3],
    caveat:
      "TODO(CA-verify): THE RATE IS PROSE, NOT A TABLE, WHICH MAKES IT THE CLEANEST OF THE FIGURES " +
      "THIS SESSION CITED — it carries none of the row-shuffling hazard the Part I-B rate tables do. " +
      "Finance Act, 2026 s.3(15) increases the income-tax specified in sub-sections (1) to (5), as " +
      "increased by any applicable surcharge, by an additional surcharge to be called the " +
      "\"Health and Education Cess on income-tax\", \"calculated at the rate of 4% of such income-tax " +
      "and surcharge\". s.3(16) states the same 4% for sub-sections (6) to (14), which are the " +
      "deduction-at-source and advance-tax limbs this engine does not compute. " +
      "THE TWO HALVES OF THIS ONE ACT SPELL THE SAME RATE DIFFERENTLY, which is a reading hazard " +
      "rather than a substantive difference: the 1961-Act half writes it in words at s.2(6) (four per " +
      "cent.) while this half prints it in digits (4%). A guard needle written for one half will not " +
      "match the other, and AUDIT-11-F5 was a falsified cess rate in the sibling world. " +
      FINANCE_ACT_2026_PART_I_B_SOURCED,
    verbatimQuotes: [
      {
        artifactId: "K4-PORT-04-S1",
        text: "Health and Education Cess on income-tax",
      },
      {
        artifactId: "K4-PORT-04-S1",
        text: "calculated at the rate of 4% of such income-tax and surcharge",
      },
      {
        artifactId: "K4-PORT-04-S1",
        text: "for the tax year commencing on the 1st day of April, 2026, income-tax shall be "
            + "charged under the provisions of the Income-tax Act, 2025",
      },
      {
        artifactId: "K4-PORT-04-S1",
        text: "at the rates specified in Part I-B of the First Schedule",
      },
    ],
  }),
  makeRuleProvenance({
    ruleId: "chapter_via_deduction_caps",
    summary:
      "Deduction caps used in the old regime (basic caps only). Under the Income-tax Act, 2025 these sit " +
      "in Chapter VIII, whose deductions section 202(2)(a)(xii) denies to a person computing under " +
      "section 202(1).",
    sources: [ITA_2025_S126_HEALTH_INSURANCE, ITA_2025_S153_DEPOSIT_INTEREST, ITA_2025_S92_93_OTHER_SOURCES],
    caveat:
      NOT_IMPLEMENTED_PROVENANCE_ONLY +
      " The 1961 Act's Chapter VI-A becomes Chapter VIII. Section 202(2)(a)(xii) denies \"Chapter VIII " +
      "other than the provisions of section 124(1) and 124(2), or 125(2) or 146\" to a person computing " +
      "under s.202(1) — the same regime split the 1961-Act engine applies, with a different carve-out " +
      "list that a porting session must re-derive rather than translate. The 80G qualifying-limit and " +
      "50%-vs-100% categories the AY pack records as placeholders remain UNSOURCED here: no 2025-Act " +
      "counterpart was read for them this session.",
    verbatimQuotes: [
      {
        artifactId: "K4-PORT-00-S2",
        text: "Chapter VIII other than the provisions of section 124(1) and 124(2), or 125(2) or 146",
      },
    ],
  }),
  makeRuleProvenance({
    ruleId: "itr1_income_ceiling",
    summary:
      "The total-income ceiling used by the return-form recommendation. Prescribed by RULES rather than " +
      "by the Act: Income-tax Rules, 2026 rule 164(2) puts a resident individual's return on Form SAHAJ " +
      "(ITR-1), and rule 164(3)(k) makes a person ineligible for it where total income exceeds fifty " +
      "lakh rupees.",
    sources: [ITR_RULES_2026_R164_RETURN_FORMS],
    caveat:
      "TODO(CA-verify): the CEILING is now cited, the TREATMENT is not confirmed, and those are different " +
      "things. Rule 164(3)(k)'s \"has total income, exceeding fifty lakh rupees\" was read in BOTH " +
      "pdftotext modes (`official-source-retrieval.md` §3.2) and is prose in a lettered clause list, not " +
      "a rate table — but it was read in ICAI's REPRODUCTION (rank 2, `K4-PORT-02-S2`), not the Gazette, " +
      "so a CA must corroborate it against CBDT Notification No. 64/2026 / GSR 286(E) before reliance. " +
      "Rule 164(3) carries FOURTEEN disqualifying conditions and this engine models only the income one; " +
      "recommending ITR-1 on the ceiling alone is therefore narrower than the rule. " +
      "**`K4-SOURCE-01` CORRECTED A FACTUAL ERROR HERE (`D301`):** this entry, and seven other sites, " +
      "said the Income-tax Act, 2025 \"registers Form 168 as its return form\". It does not. Form No. 168 " +
      "is the ANNUAL INFORMATION STATEMENT under Income-tax Rules, 2026 rule 245, whose parallel under " +
      "the Income-tax Rules, 1962 is Form 26AS. The 2025-Act return forms keep the SAHAJ (ITR-1) / SUGAM " +
      "(ITR-4) names. The claim was unfalsifiable while the Rules text was believed unretrievable, which " +
      "is exactly how it survived. `D17` is untouched: no form FIELD LAYOUT is claimed here, and none may " +
      "be without an inspected specimen — a ceiling stated in the rule's own prose is not a form-format " +
      "fact.",
    verbatimQuotes: [
      {
        artifactId: "K4-PORT-02-S2",
        text: "has total income, exceeding fifty lakh rupees",
      },
    ],
    unverifiableQuotes: [
      {
        text: "registers Form 168 as its return form",
        reason: QUOTE_NOT_STATUTORY_TEXT,
      },
    ],
  }),
  makeRuleProvenance({
    ruleId: "surcharge_marginal_relief_safety_threshold",
    summary:
      "The conservative total-income threshold above which a resident individual's income may attract " +
      "surcharge and/or marginal relief — Finance Act, 2026 First Schedule Part I-B Paragraph F, " +
      "Table 1 Sl. No. 1(i). A SAFETY (reliance-blocking) threshold, not a computation rule. NO " +
      "counterpart exists in the Income-tax Act, 2025: surcharge is a Finance Act matter.",
    sources: [FINANCE_ACT_2026_FIRST_SCHEDULE_PART_I_B],
    caveat:
      "TODO(CA-verify): A SAFETY THRESHOLD, NOT A RATE, AND THE DISTINCTION IS THE POINT OF THE ENTRY. " +
      "It exists to decide when a case must be reliance-BLOCKED, so it must be conservative in the " +
      "direction of blocking more, never fewer. The lowest total income at which any surcharge can " +
      "arise for an individual under this Part is the first band's floor: Table 1 Sl. No. 1 charges " +
      "10% where the total income \"exceeds Rs. 5000000 but does not exceed Rs. 10000000, at the rate " +
      "of 10%\". THE TEST IS STRICT AND THE STRICTNESS IS LOAD-BEARING (the 1961-Act world's D44 " +
      "boundary, restated here because the same defect is available in this world): the statute says " +
      "EXCEEDS, so a total income of exactly Rs. 50,00,000 attracts nil and must not be blocked. " +
      FINANCE_ACT_2026_PART_I_B_SOURCED,
    verbatimQuotes: [
      {
        artifactId: "K4-SOURCE-02-S2",
        text: "exceeds Rs. 5000000 but does not exceed Rs. 10000000, at the rate of 10%",
      },
      {
        artifactId: "K4-PORT-04-S1",
        text: "for the tax year commencing on the 1st day of April, 2026, income-tax shall be "
            + "charged under the provisions of the Income-tax Act, 2025",
      },
      {
        artifactId: "K4-PORT-04-S1",
        text: "at the rates specified in Part I-B of the First Schedule",
      },
    ],
  }),
  makeRuleProvenance({
    ruleId: "surcharge_rates",
    summary:
      "Surcharge on income-tax — Finance Act, 2026 First Schedule Part I-B Paragraph F, Table 1 " +
      "Sl. No. 1. NO counterpart exists in the Income-tax Act, 2025: section 4(1) charges income-tax " +
      "at rates set by any Central Act, so the rate schedule for tax year 2026-27 is that Act.",
    sources: [FINANCE_ACT_2026_FIRST_SCHEDULE_PART_I_B, FINANCE_ACT_2026_S3],
    caveat:
      "TODO(CA-verify): ONLY THE TWO BANDS INSIDE THE SUPPORTED WINDOW ARE DECLARED, AND THE OMISSION " +
      "OF THE OTHERS IS DELIBERATE RATHER THAN INCOMPLETE. Paragraph F is headed \"Surcharge on " +
      "income-tax\" and its Table 1 Sl. No. 1 charges an individual at 10% where total income " +
      "\"exceeds Rs. 5000000 but does not exceed Rs. 10000000, at the rate of 10%\" and at 15% where " +
      "it \"exceeds Rs. 10000000 but does not exceed Rs. 20000000, at the rate of 15%\". Above two " +
      "crore the 25% and 37% tiers engage, and clause (vi) then binds: where the total income includes " +
      "dividend income or capital gains under sections 196, 197 and 198, \"the rate of surcharge on " +
      "the amount of income-tax computed in respect of that part of income shall not exceed 15%\". " +
      "That cap requires apportioning income-tax between the capped and uncapped parts, which is " +
      "modelled nowhere, so the higher tiers are ABSENT from the declared schedule rather than " +
      "declared-but-unused — nothing can apply them by accident. Inside the declared window every " +
      "band rate is at or below the cap, so the cap is provably non-binding there. This mirrors the " +
      "1961-Act world's own window and its reason, arrived at from THIS world's text. " +
      FINANCE_ACT_2026_PART_I_B_SOURCED,
    verbatimQuotes: [
      {
        // A heading, not an amount — quotable from the Gazette (D315).
        artifactId: "K4-PORT-04-S1",
        text: "Surcharge on income-tax",
      },
      {
        artifactId: "K4-SOURCE-02-S2",
        text: "exceeds Rs. 5000000 but does not exceed Rs. 10000000, at the rate of 10%",
      },
      {
        artifactId: "K4-SOURCE-02-S2",
        text: "exceeds Rs. 10000000 but does not exceed Rs. 20000000, at the rate of 15%",
      },
      {
        // The 15% cap is prose — quotable from the Gazette (D315). The two
        // AMOUNT spans above it stay on the ITD copy for the rupee-glyph reason.
        artifactId: "K4-PORT-04-S1",
        text: "the rate of surcharge on the amount of income-tax computed in respect of that part "
            + "of income shall not exceed 15%",
      },
      {
        artifactId: "K4-PORT-04-S1",
        text: "for the tax year commencing on the 1st day of April, 2026, income-tax shall be "
            + "charged under the provisions of the Income-tax Act, 2025",
      },
      {
        artifactId: "K4-PORT-04-S1",
        text: "at the rates specified in Part I-B of the First Schedule",
      },
    ],
  }),
  makeRuleProvenance({
    ruleId: "surcharge_marginal_relief",
    summary:
      "Marginal relief at the surcharge thresholds — Finance Act, 2026 First Schedule Part I-B " +
      "Paragraph F, the Wn = Un + Vn formula and Table 2 Sl. No. 1. NO counterpart exists in the " +
      "Income-tax Act, 2025: the relief lives in the same Finance Act rate paragraph as the surcharge " +
      "it relieves.",
    sources: [FINANCE_ACT_2026_FIRST_SCHEDULE_PART_I_B],
    caveat:
      "TODO(CA-verify): THIS PART STATES THE RELIEF AS A FORMULA WHERE THE 1961-ACT HALF STATES IT AS " +
      "PROSE, AND THE FORMULA RESOLVES AN ASYMMETRY THE PROSE LEFT IMPLICIT. Part I-B Paragraph F " +
      "provides \"Wn = Un + Vn\", where \"Un = the total amount payable as income-tax and surcharge, " +
      "if applicable, on an amount as specified in column C of the Table 2 below\" and " +
      "\"Vn = the total income - amount as specified in column C of the said Table.\" The words IF " +
      "APPLICABLE are what matter: at exactly Rs. 50,00,000 no surcharge is payable, because Table 1 " +
      "charges only where the total income EXCEEDS that amount, so the first reference is income-tax " +
      "alone while the second (at one crore) is income-tax and surcharge. The 1961-Act half reaches " +
      "the same place by stating the two limbs separately in prose. " +
      "TABLE 2 IS THE WORST-RENDERING TABLE IN THIS DOCUMENT and its bands were NOT read from " +
      "-layout, which shuffles the column C and column D amounts across the Sl. No. rows; the default " +
      "and -raw modes agree independently that Sl. No. 1 (individuals) runs 50,00,000 to 1,00,00,000, " +
      "1,00,00,000 to 2,00,00,000, 2,00,00,000 to 5,00,00,000 and 5,00,00,000 upward. Only the first " +
      "two lie inside the supported surcharge window. " +
      "NOT MODELLED, and inherited from the 1961-Act world's own reasoning rather than assumed: where " +
      "a case mixes slab income with special-rate gains the statute does not say how the NOTIONAL " +
      "reference total income is composed, so relief is computed only where it is provably nil under " +
      "every reading. " +
      FINANCE_ACT_2026_PART_I_B_SOURCED,
    verbatimQuotes: [
      {
        artifactId: "K4-SOURCE-02-S2",
        text: "Wn = Un + Vn",
      },
      {
        artifactId: "K4-SOURCE-02-S2",
        text: "Un = the total amount payable as income-tax and surcharge, if applicable, on an "
            + "amount as specified in column C of the Table 2 below",
      },
      {
        artifactId: "K4-SOURCE-02-S2",
        text: "Vn = the total income - amount as specified in column C of the said Table.",
      },
      {
        artifactId: "K4-PORT-04-S1",
        text: "for the tax year commencing on the 1st day of April, 2026, income-tax shall be "
            + "charged under the provisions of the Income-tax Act, 2025",
      },
      {
        artifactId: "K4-PORT-04-S1",
        text: "at the rates specified in Part I-B of the First Schedule",
      },
    ],
  }),
  makeRuleProvenance({
    ruleId: "senior_super_senior_age_definition",
    summary:
      "Age and residency thresholds classifying a resident individual as a senior citizen — section " +
      "2(101). THE SUPER-SENIOR (80 YEARS) CATEGORY HAS NO COUNTERPART IN THE INCOME-TAX ACT, 2025 AT " +
      "ALL, and no age band is computed from this entry.",
    sources: [ITA_2025_S2_101_SENIOR_CITIZEN, ITA_2025_S403_ADVANCE_TAX],
    caveat:
      NOT_IMPLEMENTED_PROVENANCE_ONLY +
      " Quoted verbatim, s.2(101): \"'senior citizen' means an individual resident in India who is of the " +
      "age of sixty years or more at any time during the relevant tax year\" — the resident requirement " +
      "and the \"at any time during\" test both survive. Corroborated inside the Act by s.403(3), which " +
      "conditions the advance-tax exemption on being \"of the age of sixty years or more at any time " +
      "during the tax year\". " +
      "A SEARCH OF THE WHOLE ENACTED ACT FOUND ZERO OCCURRENCES OF \"super senior\" OR \"eighty years\". " +
      "That is NOT a retrieval failure and NOT a new gap: the super-senior band was never an Act concept " +
      "under the 1961 Act either — the AY pack sources it from the Finance Act, 2025 First Schedule Part " +
      "III rate paragraphs, not from a section. It means the 80-year band's continued existence for tax " +
      "year 2026-27 depends entirely on the FINANCE ACT, 2026 First Schedule. " +
      "THAT DEPENDENCY IS NOW DISCHARGED, AND THE SENTENCE THAT FOLLOWED IT IS CORRECTED FORWARD RATHER " +
      "THAN REWRITTEN (K4-PORT-04, D314; PROJECT_CONSTITUTION.md §4). This caveat used to end \"which " +
      "this repository does not hold, and MUST NOT be assumed to carry over\". The repository DOES hold " +
      "it (D300 found it, K4-SOURCE-01 read it), nothing was assumed, and the band was read: Finance " +
      "Act, 2026 First Schedule Part I-B Paragraph A item (III) carries a rate table for an individual " +
      "\"who is of the age of eighty years or more at any time during the tax year\", in the Income Tax " +
      "Department's own rank-1 publication and in all three extraction modes. See " +
      "`senior_super_senior_basic_exemption_widening`, which cites it. " +
      "WHAT HAS NOT CHANGED: the ACT still defines no super-senior category, so the 80-year concept " +
      "exists for this tax year inside a Finance Act rate paragraph and nowhere else — which is the " +
      "same shape as under the 1961 Act, and is why the AGE DEFINITION and the RATE BANDS are two " +
      "separate rule groups. This entry classifies nothing.",
    verbatimQuotes: [
      {
        artifactId: "K4-PORT-00-S2",
        text: "'senior citizen' means an individual resident in India who is of the age of sixty "
            + "years or more at any time during the relevant tax year",
      },
      {
        artifactId: "K4-PORT-00-S2",
        text: "at any time during",
      },
      {
        artifactId: "K4-PORT-00-S2",
        text: "of the age of sixty years or more at any time during the tax year",
      },
      // The Finance Act band this caveat's forward correction rests on. It is a
      // DIFFERENT artifact from the three above (the ITD First Schedule, rank 1,
      // rather than the enacted Act) — which is the whole point: the 80-year
      // concept is not in the Act and is checkable only against the Finance Act.
      {
        // Item (III)'s heading prose, no amounts — quotable from the Gazette
        // (D315).
        artifactId: "K4-PORT-04-S1",
        text: "who is of the age of eighty years or more at any time during the tax year",
      },
    ],
    unverifiableQuotes: [
      {
        text: "super senior",
        reason: QUOTE_NOT_STATUTORY_TEXT,
      },
      {
        text: "eighty years",
        reason: QUOTE_NOT_STATUTORY_TEXT,
      },
      {
        // This repository's own retired sentence, quoted in order to correct it
        // forward rather than delete it (§4). Not statute, and never was.
        text: "which this repository does not hold, and MUST NOT be assumed to carry over",
        reason: QUOTE_NOT_STATUTORY_TEXT,
      },
    ],
  }),
  makeRuleProvenance({
    ruleId: "senior_super_senior_basic_exemption_widening",
    summary:
      "The OLD-regime basic-exemption widening for a resident senior or super-senior citizen — Finance " +
      "Act, 2026 First Schedule Part I-B Paragraph A items (II) and (III). NO counterpart exists in " +
      "the Income-tax Act, 2025: the old-regime rate table is a Finance Act matter, and section " +
      "202(1)'s new-regime table is age-neutral.",
    sources: [FINANCE_ACT_2026_FIRST_SCHEDULE_PART_I_B],
    caveat:
      "TODO(CA-verify): THE SUPER-SENIOR BAND SURVIVES INTO TAX YEAR 2026-27, WHICH ANSWERS AN OPEN " +
      "QUESTION RATHER THAN ASSUMING IT AWAY. This entry used to say that whether an 80-year band " +
      "exists for this tax year at all was UNKNOWN here, because \"super senior\" and \"eighty years\" " +
      "appear zero times in the enacted Income-tax Act, 2025 and D298 recorded that its survival must " +
      "not be assumed. That was right, and it is answered by source rather than by inference: Part I-B " +
      "Paragraph A carries item (II) for an individual resident in India \"who is of the age of sixty " +
      "years or more but less than eighty years at any time during the tax year\", whose exemption " +
      "runs to \"where the total income does not exceed Rs. 300000\"; and item (III) for one \"who is " +
      "of the age of eighty years or more at any time during the tax year\", whose exemption runs to " +
      "\"where the total income does not exceed Rs. 500000\" and which therefore absorbs the entire 5% " +
      "band. THE BANDS ARE IN THE FINANCE ACT AND NOT IN THE ACT, exactly as they were under the 1961 " +
      "Act, so this is a structural continuity and not a change. " +
      "The AGE DEFINITIONS are a separate question from these RATE BANDS: the Act defines a senior " +
      "citizen at s.2(101) and defines no super-senior at all, so the 80-year concept exists for this " +
      "tax year only inside this Paragraph. See `senior_super_senior_age_definition`. " +
      FINANCE_ACT_2026_PART_I_B_SOURCED,
    verbatimQuotes: [
      {
        // Item (II)'s heading prose, no amounts — quotable from the Gazette
        // (D315). The two exemption-floor AMOUNT spans below stay on the ITD
        // copy for the rupee-glyph reason.
        artifactId: "K4-PORT-04-S1",
        text: "who is of the age of sixty years or more but less than eighty years at any time "
            + "during the tax year",
      },
      {
        artifactId: "K4-SOURCE-02-S2",
        text: "where the total income does not exceed Rs. 300000",
      },
      {
        // Item (III)'s heading prose — quotable from the Gazette (D315).
        artifactId: "K4-PORT-04-S1",
        text: "who is of the age of eighty years or more at any time during the tax year",
      },
      {
        artifactId: "K4-SOURCE-02-S2",
        text: "where the total income does not exceed Rs. 500000",
      },
      {
        artifactId: "K4-PORT-04-S1",
        text: "for the tax year commencing on the 1st day of April, 2026, income-tax shall be "
            + "charged under the provisions of the Income-tax Act, 2025",
      },
      {
        artifactId: "K4-PORT-04-S1",
        text: "at the rates specified in Part I-B of the First Schedule",
      },
    ],
    unverifiableQuotes: [
      {
        text: "super senior",
        reason: QUOTE_NOT_STATUTORY_TEXT,
      },
      {
        text: "eighty years",
        reason: QUOTE_NOT_STATUTORY_TEXT,
      },
    ],
  }),
  makeRuleProvenance({
    ruleId: "senior_80d_deduction_cap",
    summary:
      "The health-insurance-premium deduction cap for the self/family bucket, widening when the insured " +
      "person is a senior citizen — section 126(2)(a) read with section 126(8)(a).",
    sources: [ITA_2025_S126_HEALTH_INSURANCE, ITA_2025_S2_101_SENIOR_CITIZEN],
    caveat:
      NOT_IMPLEMENTED_PROVENANCE_ONLY +
      " THE WIDENING SURVIVES BUT IS RESTRUCTURED, AND THE RESTRUCTURE IS THE POINT. The 1961 Act states " +
      "the Rs. 50000 figure inline per bucket; s.126(2)(a) instead states \"up to Rs. 25000 in aggregate\" " +
      "and s.126(8)(a) then substitutes, verbatim: \"such person is a senior citizen, the amount of sum as " +
      "provided in such clauses, shall be substituted with Rs. 50000 for Rs. 25000\". A porting session " +
      "must implement the SUBSTITUTION, not a second literal. Note also that s.126(2)(c) and (d) carry a " +
      "separate Rs. 50000 medical-expenditure limb available only where no health-insurance premium was " +
      "paid (s.126(7)) — the AY pack records that limb as NOT covered, and this entry does not cover it " +
      "either.",
    verbatimQuotes: [
      {
        artifactId: "K4-PORT-00-S2",
        text: "up to Rs. 25000 in aggregate",
      },
      {
        artifactId: "K4-PORT-00-S2",
        text: "such person is a senior citizen, the amount of sum as provided in such clauses, shall "
            + "be substituted with Rs. 50000 for Rs. 25000",
      },
    ],
  }),
  makeRuleProvenance({
    ruleId: "senior_80d_parents_deduction_cap",
    summary:
      "The INDEPENDENT parents-bucket health-insurance cap, widening when the insured PARENT is a senior " +
      "citizen — section 126(2)(b) read with section 126(8)(a), capped separately by section 126(4).",
    sources: [ITA_2025_S126_HEALTH_INSURANCE, ITA_2025_S2_101_SENIOR_CITIZEN],
    caveat:
      NOT_IMPLEMENTED_PROVENANCE_ONLY +
      " THE TWO-BUCKET STRUCTURE THE AY PACK TREATS AS SEPARATE CAPS IS NOW EXPLICIT IN THE ACT ITSELF. " +
      "Quoted verbatim, s.126(4): the sum \"shall not exceed Rs. 50000 in aggregate of the sum specified " +
      "under sub-section (2)(a) and (c) OR aggregate of the sum specified under sub-section (2)(b) and " +
      "(d)\" — two aggregates, never one shared cap, which is the reading the AY pack reached from CBDT " +
      "validation rules rather than from statute. The s.126(8)(a) substitution keys on \"such person\" " +
      "being a senior citizen, i.e. the INSURED party, matching the AY pack's parents-bucket reading. " +
      "The residual gap the AY pack records — whether the self/family bucket widens for a senior SPOUSE " +
      "— is neither resolved nor worsened by the 2025 text and remains open.",
    verbatimQuotes: [
      {
        artifactId: "K4-PORT-00-S2",
        text: "such person",
      },
    ],
    unverifiableQuotes: [
      {
        text: "shall not exceed Rs. 50000 in aggregate of the sum specified under sub-section (2)(a) "
            + "and (c) OR aggregate of the sum specified under sub-section (2)(b) and (d)",
        reason: QUOTE_EMPHASIS_ADDED,
      },
    ],
  }),
  makeRuleProvenance({
    ruleId: "senior_80tta_80ttb_mutual_exclusivity",
    summary:
      "Deduction for interest on deposits — section 153. THE TWO 1961 SECTIONS COLLAPSE INTO ONE, so " +
      "mutual exclusivity becomes structural: section 153(1) splits the assessee by senior-citizen " +
      "status and section 153(2) gives each split its own single cap.",
    sources: [ITA_2025_S153_DEPOSIT_INTEREST, ITA_2025_S2_101_SENIOR_CITIZEN],
    caveat:
      NOT_IMPLEMENTED_PROVENANCE_ONLY +
      " THIS IS THE ONLY MANY-TO-ONE COLLAPSE IN THE PORTED SURFACE, and it makes the AY pack's rule " +
      "structurally unnecessary rather than merely renumbered. Quoted verbatim, s.153(1): the assessee is " +
      "\"(a) an individual, not being a senior citizen; or (b) an individual, being a senior citizen; or " +
      "(c) a Hindu undivided family\"; and s.153(2): \"(a) in case of an assessee mentioned in " +
      "sub-section (1)(a) or (c), the whole of the interest up to a maximum amount of Rs. 10000 on " +
      "deposits in a savings account, excluding time deposits; (b) in case of an assessee mentioned in " +
      "sub-section (1)(b), the whole of the interest up to a maximum amount of Rs. 50000 on deposits in " +
      "any account, including time deposits.\" Same Rs. 10000 / Rs. 50000 figures and the same " +
      "savings-only versus all-deposits distinction the 1961-Act engine holds — but because there is now " +
      "ONE section, the two limbs cannot be additively claimed even in principle, so a ported " +
      "implementation selects a limb rather than zeroing a mismatched section's cap.",
    verbatimQuotes: [
      {
        artifactId: "K4-PORT-00-S2",
        text: "(a) an individual, not being a senior citizen; or (b) an individual, being a senior "
            + "citizen; or (c) a Hindu undivided family",
      },
      {
        artifactId: "K4-PORT-00-S2",
        text: "(a) in case of an assessee mentioned in sub-section (1)(a) or (c), the whole of the "
            + "interest up to a maximum amount of Rs. 10000 on deposits in a savings account, "
            + "excluding time deposits; (b) in case of an assessee mentioned in sub-section (1)(b), "
            + "the whole of the interest up to a maximum amount of Rs. 50000 on deposits in any "
            + "account, including time deposits.",
      },
    ],
  }),
  makeRuleProvenance({
    ruleId: "senior_citizen_advance_tax_exemption_207_2",
    summary:
      "A resident individual aged sixty years or more at any time during the tax year, with no income " +
      "chargeable under the head \"Profits and gains of business or profession\", is not liable to pay " +
      "advance tax — section 403(3).",
    sources: [ITA_2025_S403_ADVANCE_TAX, ITA_2025_S2_101_SENIOR_CITIZEN],
    caveat:
      NOT_IMPLEMENTED_PROVENANCE_ONLY +
      " ALL THREE CONDITIONS SURVIVE VERBATIM. Quoted, s.403(3): the advance-tax liability \"shall not " +
      "apply to an individual resident in India, who-- (a) does not have any income chargeable under the " +
      "head 'Profits and gains of business or profession'; and (b) is of the age of sixty years or more " +
      "at any time during the tax year.\" NOTE THE RULE ID RETAINS ITS 1961 COORDINATE (`207_2`) " +
      "DELIBERATELY: rule ids are a stable contract referenced by verification records and by " +
      "`case-traceability.ts`, and renaming them here would break the set-equality guard that proves this " +
      "port covers every declared rule. The id is a key, not a citation — the citation is the `sources` " +
      "field, and it names section 403 of the 2025 Act.",
    verbatimQuotes: [
      {
        artifactId: "K4-PORT-00-S2",
        text: "shall not apply to an individual resident in India, who-- (a) does not have any income "
            + "chargeable under the head 'Profits and gains of business or profession'; and (b) is of "
            + "the age of sixty years or more at any time during the tax year.",
      },
    ],
  }),
  makeRuleProvenance({
    ruleId: "house_property_computation",
    summary:
      "Income from house property under sections 20 to 22: annual value determined under section 21, " +
      "less a flat 30% deduction under section 22(1)(a) and borrowed-capital interest under section " +
      "22(1)(b)-(c), capped at Rs. 200000 by section 22(2)(a) for a self-occupied property. Section " +
      "202(2)(a)(v) denies that interest deduction entirely under the new regime, and section 109(1)(b) " +
      "caps cross-head set-off of a resulting loss at Rs. 200000.",
    sources: [
      ITA_2025_S20_TO_S22_HOUSE_PROPERTY,
      ITA_2025_S109_1_B_HOUSE_PROPERTY_LOSS,
      ITA_2025_S202_NEW_REGIME,
    ],
    caveat:
      NOT_IMPLEMENTED_PROVENANCE_ONLY +
      " EVERY FIGURE THE 1961-ACT ENGINE HOLDS APPEARS VERBATIM IN THE ENACTED TEXT, which is a stronger " +
      "position than the AY pack's — that rule is sourced from a secondary publisher because " +
      "incometaxindia.gov.in returned HTTP 403 to it. Quoted, s.22(1): \"(a) 30% of the annual value as " +
      "determined under section 21; (b) where the property has been acquired, constructed, repaired, " +
      "renewed or reconstructed with borrowed capital, the amount of any interest payable on such " +
      "capital\". Quoted, s.22(2): for self-occupied properties the aggregate interest deduction \"shall " +
      "not exceed-- (a) Rs. 200000 …; (b) Rs. 30000 in any other case.\" Quoted, s.202(2)(a)(v): the new " +
      "regime denies \"section 22(1)(b), in respect of properties referred to in section 21(6)\"; and " +
      "s.202(2)(b)(ii) denies set-off of \"any loss under the head 'Income from house property' with any " +
      "other head of income\". Quoted, s.109(1)(b): a house-property loss \"shall be set off to the " +
      "extent of Rs. 200000 against income under any other head.\" " +
      "A SCOPE NOTE THAT CHANGES SHAPE UNDER THE 2025 ACT: the AY pack scopes to ONE property and records " +
      "the two-self-occupied-property widening as not covered. s.21(7)(a) states that limb directly — the " +
      "nil-annual-value rule \"shall apply only in respect of two of such houses as specified by the " +
      "assessee\" — so under the 2025 Act it is a statutory condition read off the Act rather than a " +
      "Budget change tracked separately. Still NOT covered here: co-ownership apportionment, and s.21(1)'s " +
      "higher-of test (the AY engine uses actual rent received directly).",
    verbatimQuotes: [
      {
        artifactId: "K4-PORT-00-S2",
        text: "(a) 30% of the annual value as determined under section 21; (b) where the property has "
            + "been acquired, constructed, repaired, renewed or reconstructed with borrowed capital, "
            + "the amount of any interest payable on such capital",
      },
      {
        artifactId: "K4-PORT-00-S2",
        text: "section 22(1)(b), in respect of properties referred to in section 21(6)",
      },
      {
        artifactId: "K4-PORT-00-S2",
        text: "any loss under the head 'Income from house property' with any other head of income",
      },
      {
        artifactId: "K4-PORT-00-S2",
        text: "shall be set off to the extent of Rs. 200000 against income under any other head.",
      },
      {
        artifactId: "K4-PORT-00-S2",
        text: "shall apply only in respect of two of such houses as specified by the assessee",
      },
    ],
    unverifiableQuotes: [
      {
        text: "shall not exceed-- (a) Rs. 200000 …; (b) Rs. 30000 in any other case.",
        reason: QUOTE_ELIDED,
      },
    ],
  }),
  makeRuleProvenance({
    ruleId: "presumptive_44ada_computation",
    summary:
      "Presumptive professional income — section 58(2) (Table: Sl. No. 3), for a specified profession " +
      "referred to in section 62(4). Deemed profit of 50% of gross receipts, ceiling Rs. 5000000 " +
      "widening to Rs. 7500000 on the 5% cash-receipts test.",
    sources: [
      ITA_2025_S58_PRESUMPTIVE_PROFESSION,
      ITA_2025_S62_BOOKS_AND_PROFESSIONS,
      ITA_2025_S63_TAX_AUDIT,
    ],
    caveat:
      NOT_IMPLEMENTED_PROVENANCE_ONLY +
      " THE SERIAL NUMBER IN `k4-port-delta-assessment.md` §2 IS WRONG AND IS CORRECTED HERE: that table " +
      "records the s.44ADA counterpart as \"s.58(2) Table Sl.2\", but in the enacted Act Sl. No. 2 is " +
      "\"Business of plying, hiring or leasing goods carriage\" — the s.44AE counterpart, which this " +
      "product does not implement. The profession row is Sl. No. 3. Quoted verbatim from Sl. No. 3: " +
      "\"Specified profession as referred to in section 62(4)\", \"(a) Does not exceed fifty lakh rupees; " +
      "or (b) does not exceed seventy-five lakh rupees, where the amount or aggregate of amounts received " +
      "in cash does not exceed 5% of the gross receipts\", computed at \"50% of the gross receipts or " +
      "profit claimed to have been actually earned, whichever is higher\". " +
      "THE ELIGIBLE-ACTIVITY TEST `D217` BUILT SURVIVES WITH A CITABLE HOME: s.62(4)(a) lists the " +
      "professions verbatim as \"legal, medical, engineering, architectural, accountancy, technical " +
      "consultancy, interior decoration, information technology or company secretary\" — the same nine. " +
      "NOTE A STRUCTURAL DIFFERENCE THE AY PACK HAS NO EQUIVALENT FOR: column E ends \"whichever is " +
      "higher\", so the deemed profit is a FLOOR against actually-earned profit rather than a flat " +
      "substitution, and s.58(3) routes a lower declared profit into the s.62 books and s.63 audit " +
      "obligations. The AY pack records the books-of-account fallback as out of scope; under the 2025 Act " +
      "it is visible in the same table cell and a porting session must decide it explicitly rather than " +
      "inherit the omission.",
    verbatimQuotes: [
      {
        artifactId: "K4-PORT-00-S2",
        text: "Business of plying, hiring or leasing goods carriage",
      },
      {
        artifactId: "K4-PORT-00-S2",
        text: "Specified profession as referred to in section 62(4)",
      },
      {
        artifactId: "K4-PORT-00-S2",
        text: "(a) Does not exceed fifty lakh rupees; or (b) does not exceed seventy-five lakh "
            + "rupees, where the amount or aggregate of amounts received in cash does not exceed 5% "
            + "of the gross receipts",
      },
      {
        artifactId: "K4-PORT-00-S2",
        text: "50% of the gross receipts or profit claimed to have been actually earned, whichever is "
            + "higher",
      },
      {
        artifactId: "K4-PORT-00-S2",
        text: "legal, medical, engineering, architectural, accountancy, technical consultancy, "
            + "interior decoration, information technology or company secretary",
      },
      {
        artifactId: "K4-PORT-00-S2",
        text: "whichever is higher",
      },
    ],
    unverifiableQuotes: [
      {
        text: "s.58(2) Table Sl.2",
        reason: QUOTE_NOT_STATUTORY_TEXT,
      },
    ],
  }),
  makeRuleProvenance({
    ruleId: "presumptive_44ad_computation",
    summary:
      "Presumptive business income — section 58(2) (Table: Sl. No. 1), for an eligible assessee carrying " +
      "on any business other than goods carriage. 6% of turnover received by specified banking or online " +
      "mode plus 8% of the remainder; ceiling two crore rupees widening to three crore rupees on the 5% " +
      "cash-receipts test.",
    sources: [
      ITA_2025_S58_PRESUMPTIVE_BUSINESS,
      ITA_2025_S62_BOOKS_AND_PROFESSIONS,
      ITA_2025_S63_TAX_AUDIT,
    ],
    caveat:
      NOT_IMPLEMENTED_PROVENANCE_ONLY +
      " Quoted verbatim from Table Sl. No. 1 column D: \"(a) Does not exceed two crore rupees; or (b) does " +
      "not exceed three crore rupees, where the amount or aggregate of amounts received, in cash, does " +
      "not exceed 5% of the total turnover or gross receipts\"; and column E: \"(i) 6% of total turnover " +
      "or gross receipts which is received by specified banking or online mode during the tax year or " +
      "before the due date specified in section 263(1) in respect of that tax year; (ii) 8% of total " +
      "turnover or gross receipts as reduced by the turnover or gross receipts\" covered by limb (i). The " +
      "two-rates-on-two-portions shape and every figure match the 1961-Act engine's constants. " +
      "\"Specified Banking or Online Mode\" now has its own definition at s.66(32). " +
      "THE FIVE-YEAR LOCK-IN SURVIVES AT s.58(7)-(8), and the AY pack records it as unimplemented for " +
      "want of multi-year state — unchanged by the port. NOT covered, as in the AY pack: the " +
      "eligible-ASSESSEE limbs (properties of the person that no captured data can verify), per-business " +
      "turnover ceilings, and the cash-PAYMENTS leg of the enhanced-ceiling condition (`D91`).",
    verbatimQuotes: [
      {
        artifactId: "K4-PORT-00-S2",
        text: "(a) Does not exceed two crore rupees; or (b) does not exceed three crore rupees, where "
            + "the amount or aggregate of amounts received, in cash, does not exceed 5% of the total "
            + "turnover or gross receipts",
      },
      {
        artifactId: "K4-PORT-00-S2",
        text: "Specified Banking or Online Mode",
      },
    ],
    unverifiableQuotes: [
      {
        text: "(i) 6% of total turnover or gross receipts which is received by specified banking or "
            + "online mode during the tax year or before the due date specified in section 263(1) in "
            + "respect of that tax year; (ii) 8% of total turnover or gross receipts as reduced by "
            + "the turnover or gross receipts",
        reason: QUOTE_SPACE_LOST_IN_EXTRACTION,
      },
    ],
  }),
  makeRuleProvenance({
    ruleId: "business_books_computation",
    summary:
      "Books-based business or professional income — charged by section 26 and computed under section 27 " +
      "\"as per the provisions of sections 28 to 60, except section 58\". The audit threshold that bounds " +
      "the window from above is section 63; the current-year intra-head pool is section 108(1); the " +
      "restricted speculation and specified-business pools are sections 113 and 114; the derivative " +
      "carve-out is section 66(31)(a) with section 66(33).",
    sources: [
      ITA_2025_S26_BUSINESS_CHARGE,
      ITA_2025_S26_3_SPECULATION_BUSINESS,
      ITA_2025_S27_BUSINESS_COMPUTATION,
      ITA_2025_S63_TAX_AUDIT,
      ITA_2025_S66_SPECULATIVE_TRANSACTION,
      ITA_2025_S108_INTRA_HEAD_SET_OFF,
      ITA_2025_S112_BUSINESS_LOSS_CARRY_FORWARD,
      ITA_2025_S113_SPECULATION_LOSS,
      ITA_2025_S114_SPECIFIED_BUSINESS_LOSS,
      ITA_2025_S202_NEW_REGIME,
    ],
    caveat:
      NOT_IMPLEMENTED_PROVENANCE_ONLY +
      " THREE FINDINGS HERE ARE LOAD-BEARING FOR THE PORT AND NONE OF THEM IS A PURE RENUMBERING. " +
      "(1) THE COMPUTATION RANGE CHANGED. 1961 s.29 computes the head \"in accordance with the provisions " +
      "contained in sections 30 to 43D\", and the AY pack's entire narrowness rests on the sentence \"THIS " +
      "ENGINE IMPLEMENTS NONE OF SECTIONS 30 TO 43D\". The 2025 counterpart reads, verbatim: \"27. The " +
      "income referred to in section 26 shall be computed as per the provisions of sections 28 to 60, " +
      "except section 58.\" That is a different range with an express carve-out for the presumptive " +
      "section, so the ported boundary must be restated against s.27's own words rather than translated " +
      "section by section. Depreciation, which the AY pack refuses because it is not optional, is s.33. " +
      "(2) THE DERIVATIVE CARVE-OUT MOVED MECHANISM AND `k4-port-delta-assessment.md` CITED IT WRONGLY. " +
      "That assessment (§2, §3) and `D297` cite \"s.2(31)(a) + s.2(33)\"; in the enacted Act s.2(31) is " +
      "\"Commissioner\" and s.2(33) is \"Commissioner (Appeals)\". The definitions relied on are s.66(31) " +
      "and s.66(33), in the interpretation section that opens \"66. For the purposes of Part D of this " +
      "Chapter,--\". Quoted verbatim, s.66(31): a speculative transaction is one \"periodically or " +
      "ultimately settled otherwise than by the actual delivery or transfer of the commodity or scrips, " +
      "other than the following transactions:-- (a) a specified derivative transaction as defined in " +
      "clause (33)\". The carve-out is therefore a STANDALONE DEFINITION rather than 1961's Explanation 1 " +
      "to the proviso to s.43(5), and it is SCOPED to Part D of that Chapter rather than Act-wide. " +
      "`K4-PORT-07` (`D318`) re-derived the citation against those sections and recorded the reach: " +
      "s.26 sits under Part D, so s.26(3)'s use of speculative transactions is inside the s.66 scope; " +
      "s.108 and s.113 sit in Chapter VII and speak of speculation business — the s.26(3) concept — not " +
      "speculative transaction. Whether the 1961 eligible-transaction formulation and the 2025 " +
      "specified-derivative-transaction formulation are substantively identical is a CA question and is " +
      "NOT decided here. The 2025-world preparer affirmation, if a computation surface is ever wired, " +
      "would be against s.66(33), not Explanation 1; this pack still has no computation surface, so the " +
      "1961-named activity vocabulary is not rewired. The capability row's ITA_2025 ruleAuthority is now " +
      "this citation rather than null. " +
      "(3) WHAT DOES NOT CHANGE, AND IT IS THE PART THAT MATTERS MOST. s.66(33)(a)-(b) keeps the " +
      "conjunctive, per-transaction conditions: carried out through a SEBI-registered intermediary or by " +
      "banks or mutual funds, \"electronically on screen-based systems of a recognised stock exchange\", " +
      "and \"supported by a time stamped contract note issued by the intermediary to every client\" " +
      "bearing the unique client identity number. THIS PRODUCT HOLDS NO CONTRACT NOTE, EXCHANGE IDENTITY " +
      "OR INTERMEDIARY REGISTRATION AND CAN VERIFY NONE OF IT under either Act, so the classification " +
      "remains the PREPARER'S AFFIRMATION and never a finding of this engine. Likewise s.113(1) still " +
      "restricts a speculation loss to \"profits and gains of another speculation business\", so the AY " +
      "pack's refusal to implement a speculation pool is owed identically. AND NO SOURCE DEFINES " +
      "DERIVATIVE TURNOVER UNDER THE 2025 ACT EITHER — `D287` recorded the definition as verified ABSENT " +
      "in the Income-tax Act 2025 as well as the 1961 Act, so the s.63 threshold would still be tested " +
      "against a preparer-declared figure this engine does not derive.",
    verbatimQuotes: [
      {
        artifactId: "K4-PORT-00-S2",
        text: "27. The income referred to in section 26 shall be computed as per the provisions of "
            + "sections 28 to 60, except section 58.",
      },
      {
        artifactId: "K4-PORT-00-S2",
        text: "Commissioner",
      },
      {
        artifactId: "K4-PORT-00-S2",
        text: "Commissioner (Appeals)",
      },
      {
        artifactId: "K4-PORT-00-S2",
        text: "66. For the purposes of Part D of this Chapter,--",
      },
      {
        artifactId: "K4-PORT-00-S2",
        text: "periodically or ultimately settled otherwise than by the actual delivery or transfer "
            + "of the commodity or scrips, other than the following transactions:-- (a) a specified "
            + "derivative transaction as defined in clause (33)",
      },
      {
        artifactId: "K4-PORT-00-S2",
        text: "electronically on screen-based systems of a recognised stock exchange",
      },
      {
        artifactId: "K4-PORT-00-S2",
        text: "supported by a time stamped contract note issued by the intermediary to every client",
      },
      {
        artifactId: "K4-PORT-00-S2",
        text: "profits and gains of another speculation business",
      },
      /**
       * **THE ONE SPAN THE CONSOLIDATED 1961 ACT MADE CHECKABLE, AND IT WAS A
       * KNOWN LIVE FALSE PASS** (`K4-PORT-04`, artifact `K4-PORT-04-S2`).
       *
       * This span was declared `QUOTE_SOURCE_NOT_REGISTERED` because the
       * consolidated Income-tax Act, 1961 was unretrieved (`AUDIT-10-F4`) — and
       * `MAINT-03` (`D308`) found it matching anyway, off a READING NOTE in an
       * extract explaining why the 1961 text is absent. That was one of the two
       * live false passes which made `extractedStatuteOnly` read only the
       * `pdftotext` blocks. The owner supplied the Act on 2026-08-17, so the span
       * is now checked against **statute** instead of against this repository's
       * own prose.
       *
       * It is quoted here **for CONTRAST** with the 2025 Act's s.27, which is a
       * different range with an express carve-out — so this is a 1961-Act
       * quotation living legitimately in the 2025-Act pack, and the artifact it
       * names is the AY world's Act. The `parallel-worlds` half-separation guard
       * constrains a rule's `sources`, not the artifact a caveat quotes for
       * comparison, which is why this is allowed and why the distinction is
       * worth stating rather than leaving to be re-derived.
       */
      {
        artifactId: "K4-PORT-04-S2",
        text: "in accordance with the provisions contained in sections 30 to 43D",
      },
    ],
    unverifiableQuotes: [
      {
        text: "THIS ENGINE IMPLEMENTS NONE OF SECTIONS 30 TO 43D",
        reason: QUOTE_NOT_STATUTORY_TEXT,
      },
      {
        text: "s.2(31)(a) + s.2(33)",
        reason: QUOTE_NOT_STATUTORY_TEXT,
      },
    ],
  }),
  makeRuleProvenance({
    ruleId: "capital_loss_within_year_set_off",
    summary:
      "Within-year set-off of capital losses against capital gains — section 108(2). A short-term loss " +
      "may be set off against income from any other capital asset; a long-term loss only against another " +
      "long-term capital asset. Section 109(2) bars any cross-head set-off of a capital loss.",
    sources: [ITA_2025_S108_INTRA_HEAD_SET_OFF, ITA_2025_S109_2_CAPITAL_LOSS],
    caveat:
      NOT_IMPLEMENTED_PROVENANCE_ONLY +
      " THE ASYMMETRY THE AY PACK IMPLEMENTS IS NOW IN ONE SUB-SECTION RATHER THAN SPREAD ACROSS s.70 AND " +
      "s.74(1). Quoted verbatim, s.108(2): \"(a) any short-term capital asset is a loss, such loss shall " +
      "be set off against the income, computed in respect of any other capital asset for that year; (b) " +
      "any long-term capital asset is a loss, such loss shall be set off against the income computed in " +
      "respect of any other long-term capital asset for that year.\" And s.109(2): \"For any tax year, " +
      "the loss under the head 'Capital gains' shall not be set off against income under any other head.\" " +
      "THE TWO ORDERING QUESTIONS `K4-09` LEFT OPEN ARE NOT RESOLVED BY THE PORT AND MUST NOT BE READ AS " +
      "RESOLVED: neither whether a loss reduces the gross s.198 gain or only the portion above " +
      "Rs. 125000, nor which of the two gain buckets absorbs a short-term loss first, is stated by " +
      "s.108 or s.198. `D113`'s rule stands — an allocation sequence is not statute and must never be " +
      "described as such. The portal-conformance evidence the AY pack relies on is bound to the AY " +
      "2026-27 ITR-2 utility and does NOT transfer to a 2025-Act return form.",
    verbatimQuotes: [
      {
        artifactId: "K4-PORT-00-S2",
        text: "(a) any short-term capital asset is a loss, such loss shall be set off against the "
            + "income, computed in respect of any other capital asset for that year; (b) any "
            + "long-term capital asset is a loss, such loss shall be set off against the income "
            + "computed in respect of any other long-term capital asset for that year.",
      },
      {
        artifactId: "K4-PORT-00-S2",
        text: "For any tax year, the loss under the head 'Capital gains' shall not be set off against "
            + "income under any other head.",
      },
    ],
  }),
  makeRuleProvenance({
    ruleId: "capital_loss_brought_forward_set_off",
    summary:
      "Brought-forward set-off of prior-year capital losses — section 111, applied after the within-year " +
      "set-off and only against gains surviving it. Section 111(2) permits carry-forward for eight tax " +
      "years immediately succeeding the tax year for which the loss was first computed.",
    sources: [ITA_2025_S111_CAPITAL_LOSS_CARRY_FORWARD, ITA_2025_S108_INTRA_HEAD_SET_OFF],
    caveat:
      NOT_IMPLEMENTED_PROVENANCE_ONLY +
      " THE EIGHT-YEAR BOUNDARY SURVIVES BUT ITS UNIT CHANGES, AND THAT IS A REAL PORTING HAZARD RATHER " +
      "THAN A COSMETIC ONE. Quoted verbatim, s.111(2): \"No loss shall be carried forward under this " +
      "section for more than eight tax years immediately succeeding the tax year for which the loss was " +
      "first computed.\" The AY pack identifies each carry-forward record by its originating ASSESSMENT " +
      "year, because s.74(2) counts in assessment years; s.111(2) counts in TAX years, a different " +
      "period-counting model (s.3(1): \"'tax year' means the twelve months period of the financial year " +
      "commencing on the 1st April\"). A ported implementation must re-key those records, and a record " +
      "crossing the 2026-04-01 commencement boundary is governed by whichever Act applies to its own " +
      "originating year under s.536(2)(c) — a transition question this entry does NOT decide. The " +
      "destination test survives in s.111(1)(a)(i)-(ii) with the same short-term/long-term asymmetry. " +
      "NOT covered: the return-filing condition on carry-forward, whose 2025-Act counterpart was not read " +
      "this session; and the allocation-sequence design requirement, which `D113`/`D114` leave open under " +
      "both Acts.",
    verbatimQuotes: [
      {
        artifactId: "K4-PORT-00-S2",
        text: "No loss shall be carried forward under this section for more than eight tax years "
            + "immediately succeeding the tax year for which the loss was first computed.",
      },
      {
        artifactId: "K4-PORT-00-S2",
        text: "'tax year' means the twelve months period of the financial year commencing on the 1st "
            + "April",
      },
    ],
  }),
  // K4-19: the TY counterpart of the AY pack `section_89_arrears_relief` gap
  // rule, present because `parallel-worlds.test.ts` asserts SET EQUALITY of rule
  // ids both ways — a rule in one world only is a drift failure.
  //
  // K4-24: IT NOW CITES ITS COUNTERPART, AND THE WITHHOLDING THAT PRECEDED THAT
  // WAS RIGHT RATHER THAN LAZY. This rule cited NOTHING for five sessions
  // because the Income-tax Act, 2025 counterpart of section 89 had not been
  // identified here, and guessing a section number is exactly the error `D298`
  // found three times in the assessment that authorised this port (s.2(31) for
  // what is actually s.66(31)). The mapping was supplied by the owner in his
  // K4-24 decisions and then READ OFF ARTIFACTS THIS REPOSITORY ALREADY HELD
  // rather than accepted: s.157 sits on page 194 of `K4-PORT-00-S2`, between
  // s.156 (the s.87A counterpart) and s.158 (the s.89A counterpart), and rule 73
  // with its Form No. 39 sits on pages 123-127 of `K4-PORT-02-S2`. Both are
  // committed as three-mode extracts, so the citation is checkable in a bare
  // clone. The superseded caveat, kept per `PROJECT_CONSTITUTION.md` §4:
  // *"NO SOURCE IS CITED, DELIBERATELY … the Income-tax Act, 2025 counterpart of
  // Section 89 HAS NOT BEEN IDENTIFIED."*
  //
  // NOTHING ELSE MOVED. No relief is computed in either world, this world still
  // has no computation surface, and no equivalence between the two regimes'
  // relief mechanics is decided (§2 rule 5).
  makeRuleProvenance({
    ruleId: "section_89_arrears_relief",
    summary:
      "Relief on salary or pension received in arrears or in advance under Income-tax Act, 2025 " +
      "section 157, computed under Income-tax Rules, 2026 rule 73 and claimed on Form No. 39 — the " +
      "counterparts of Income-tax Act, 1961 section 89, rules 21A / 21AA and Form No. 10E. " +
      "NOT IMPLEMENTED: no relief amount is computed in this statutory world, which has no " +
      "computation surface at all. The counterpart is now LOCATED, which it was not before K4-24.",
    sources: [ITA_2025_S157_ARREARS_RELIEF, ITR_RULES_2026_R73_RELIEF],
    caveat:
      "TODO(CA-verify): THE COUNTERPART IS LOCATED AND READ; NO RELIEF IS COMPUTED AND NO EQUIVALENCE " +
      "IS DECIDED. Section 157(1) grants relief where total income \"is assessed at a rate higher than " +
      "the rate at which it would otherwise have been assessed\" on four receipts — arrear or advance " +
      "salary, salary for more than twelve months in one tax year, profits in lieu of salary under " +
      "s.18(1), and arrears of family pension — matching section 89's four heads one for one. Rule 73 " +
      "states the same five relief limbs rule 21A states, but as a TABLE OF NAMED FORMULAE rather than " +
      "as prose sub-rules, and rule 73(3) prescribes the particulars in Form No. 39. " +
      "WHETHER THE TWO WORLDS' MECHANICS ARE EQUIVALENT IS A TAX QUESTION AND IS NOT DECIDED HERE " +
      "(PROJECT_CONSTITUTION.md §2 rule 5). Two differences are visible on the face of the text and " +
      "are recorded so a later session does not assume interchangeability: section 89's proviso is " +
      "framed on the section 10(10C) voluntary-retirement exemption while s.157(2) is framed on a " +
      "deduction claimed under s.19(1) Table Sl. No. 12; and rule 73(3) imposes a DUE-DATE condition " +
      "on furnishing Form No. 39, by reference to section 263(1)(c), that rule 21AA does not impose " +
      "for Form No. 10E. " +
      "SOURCE RANK: THE TWO DIFFER AND ARE STATED SEPARATELY. s.157 is read in the Income Tax " +
      "Department's publication of the Act AS ENACTED, registered RANK 1 (K4-PORT-00-S2); rule 73 " +
      "is read in ICAI's REPRODUCTION of CBDT Notification No. 64/2026 / GSR 286(E), registered " +
      "RANK 2 (K4-PORT-02-S2). A STATUTORY RULE IS RANK 2 BY ITS NATURE, not merely because of who " +
      "printed this copy: the source ladder puts rules and notifications at rank 2 EVEN WHEN THE " +
      "PUBLISHER IS THE OFFICIAL GAZETTE. So what rule 73 still wants is corroboration against the " +
      "NOTIFYING GAZETTE, and that buys the instrument AS NOTIFIED rather than a publisher's " +
      "reproduction of it — it is NOT a rank promotion, and no corroboration can make a rule " +
      "rank 1. Extracting either artifact promotes neither. " +
      "FORM No. 39 ITSELF IS NOT HELD. What is established is that rule 73(3) prescribes it; its " +
      "field layout has not been inspected, so `D17` binds and no field of it may be modelled — " +
      "exactly the position Form No. 10E was in before K4-SOURCE-07 inspected that specimen.",
    verbatimQuotes: [
      {
        artifactId: "K4-PORT-00-S2",
        text: "is assessed at a rate higher than the rate at which it would otherwise have been assessed",
      },
    ],
  }),
]);
