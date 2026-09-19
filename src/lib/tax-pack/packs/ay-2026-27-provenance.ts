/**
 * TaxDesk OS — Official-source PROVENANCE for the AY 2026-27 pack
 * (Wave 1, K3-13).
 *
 * PURE TYPESCRIPT ONLY. Data only — nothing here participates in a computation,
 * and no rule value, slab, cap, or rate is declared, restated, or changed.
 *
 * EVERY reference below is transcribed from what the engine itself already
 * documents (`src/lib/tax-engine/ay-2026-27/rules.ts` and `slabs.ts` module
 * headers). NOTHING is added from developer memory, a blog, an LLM
 * recollection, or competitor output. Where the engine documents no source, the
 * rule below cites NONE — which `verification.ts` reports as an explicit gap
 * ("No official source is cited for this rule") rather than silently passing.
 * Notification numbers, publication dates and URLs are OMITTED because they have
 * not been checked against ITD / CBDT / Gazette; a guessed identifier would be
 * worse than an absent one.
 *
 * Every rule also carries the engine's own `TODO(CA-verify)` caveat, so no rule
 * here is verifiable until a real professional resolves that caveat against the
 * real official source. That is why the pack is — and stays — `draft`.
 */

import {
  makeOfficialSourceReference,
  makeRuleProvenance,
  makeTaxPackProvenance,
  QUOTE_ANNOTATION_STRIPPED,
  QUOTE_ELIDED,
  QUOTE_EMPHASIS_ADDED,
  QUOTE_NOT_STATUTORY_TEXT,
  QUOTE_SOURCE_NOT_REGISTERED,
  type TaxPackProvenance,
} from "../provenance";

/** The blanket caveat on every constant in `rules.ts`. */
const RECONFIRM_ANNUALLY = "TODO(CA-verify): re-confirm each constant every assessment year.";

const S87A = makeOfficialSourceReference({
  id: "ITA_1961_S87A",
  kind: "act_section",
  authority: "Parliament",
  citation: "Section 87A, Income-tax Act, 1961",
  identifier: "87A",
});

// K4-19: Section 89(1) arrears relief and its machinery. Cited so the GAP has a
// named provision rather than being an unexplained absence. NOTE these name the
// provision and do NOT assert its text has been read here: the consolidated
// Income-tax Act, 1961 is now REGISTERED (`K4-PORT-04-S2`, owner-supplied
// 2026-08-17 — `AUDIT-10-F4`'s headline item, closed), but no page range for
// s.89 has been committed and this rule still quotes nothing at all. Reading it
// is source work belonging to the session that would cite its text.
const S89_ARREARS_RELIEF = makeOfficialSourceReference({
  id: "ITA_1961_S89",
  kind: "act_section",
  authority: "Parliament",
  citation: "Section 89, Income-tax Act, 1961",
  identifier: "89",
});

const RULE_21A_FORM_10E = makeOfficialSourceReference({
  id: "ITR_RULES_1962_R21A_FORM_10E",
  kind: "rule",
  authority: "CBDT",
  citation: "Rule 21A and Form 10E, Income-tax Rules, 1962",
  identifier: "21A",
});

const S111A = makeOfficialSourceReference({
  id: "ITA_1961_S111A",
  kind: "act_section",
  authority: "Parliament",
  citation: "Section 111A, Income-tax Act, 1961",
  identifier: "111A",
});

const S112A = makeOfficialSourceReference({
  id: "ITA_1961_S112A",
  kind: "act_section",
  authority: "Parliament",
  citation: "Section 112A, Income-tax Act, 1961",
  identifier: "112A",
});

/**
 * The Cost Inflation Index notification chain, s.48 Explanation (v).
 *
 * ALL NINE ARE NOW CITED (`K4-24` Phase 0). `K4-23` cited four and
 * deliberately omitted five, because citing an instrument this repository
 * could not read would be the exact defect `AUDIT-14-F1` and `MAINT-02`
 * exist to prevent. `K4-SOURCE-07` (`D343`) retrieved those five from the
 * official e-Gazette, so the reason for the omission is discharged and the
 * omission is not. The superseded sentence, kept per
 * `PROJECT_CONSTITUTION.md` §4: *"FOUR of the nine are registered
 * artifacts; the other five are recorded on the engine's own table with an
 * `owner_decided` evidence marker and are NOT cited here."*
 *
 * THE CHAIN IS AN AMENDMENT CHAIN, WHICH IS WHY ALL NINE ARE NAMED AND NOT
 * ONLY THE LATEST. 44/2017 is the principal notification and every later
 * one inserts one serial into ITS table, reciting the amendment it follows.
 * A caveat citing only the newest would leave seventeen of the twenty-five
 * values attributed to nothing.
 */
const CII_N44_2017 = makeOfficialSourceReference({
  id: "CBDT_NOTIFICATION_44_2017",
  kind: "notification",
  authority: "CBDT",
  citation:
    "Notification No. 44/2017, S.O. 1790(E), dated 5 June 2017 — the principal Cost Inflation Index notification (FY 2001-02 to FY 2017-18)",
  identifier: "44/2017",
});

const CII_N39_2023 = makeOfficialSourceReference({
  id: "CBDT_NOTIFICATION_39_2023",
  kind: "notification",
  authority: "CBDT",
  citation: "Notification No. 39/2023, S.O. 2571(E), dated 12 June 2023 — CII for FY 2023-24",
  identifier: "39/2023",
});

const CII_N44_2024 = makeOfficialSourceReference({
  id: "CBDT_NOTIFICATION_44_2024",
  kind: "notification",
  authority: "CBDT",
  citation: "Notification No. 44/2024, S.O. 2103(E), dated 24 May 2024 — CII for FY 2024-25",
  identifier: "44/2024",
});

const CII_N70_2025 = makeOfficialSourceReference({
  id: "CBDT_NOTIFICATION_70_2025",
  kind: "notification",
  authority: "CBDT",
  citation: "Notification No. 70/2025, S.O. 2954(E), dated 1 July 2025 — CII for FY 2025-26",
  identifier: "70/2025",
});

const CII_N26_2018 = makeOfficialSourceReference({
  id: "CBDT_NOTIFICATION_26_2018",
  kind: "notification",
  authority: "CBDT",
  citation: "Notification No. 26/2018, S.O. 2413(E), dated 13 June 2018 — CII for FY 2018-19 (serial 18)",
  identifier: "26/2018",
});

const CII_N63_2019 = makeOfficialSourceReference({
  id: "CBDT_NOTIFICATION_63_2019",
  kind: "notification",
  authority: "CBDT",
  citation:
    "Notification No. 63/2019, S.O. 3266(E), dated 12 September 2019 — CII for FY 2019-20 (serial 19)",
  identifier: "63/2019",
});

const CII_N32_2020 = makeOfficialSourceReference({
  id: "CBDT_NOTIFICATION_32_2020",
  kind: "notification",
  authority: "CBDT",
  citation: "Notification No. 32/2020, S.O. 1879(E), dated 12 June 2020 — CII for FY 2020-21 (serial 20)",
  identifier: "32/2020",
});

const CII_N73_2021 = makeOfficialSourceReference({
  id: "CBDT_NOTIFICATION_73_2021",
  kind: "notification",
  authority: "CBDT",
  citation: "Notification No. 73/2021, S.O. 2336(E), dated 15 June 2021 — CII for FY 2021-22 (serial 21)",
  identifier: "73/2021",
});

const CII_N62_2022 = makeOfficialSourceReference({
  id: "CBDT_NOTIFICATION_62_2022",
  kind: "notification",
  authority: "CBDT",
  citation: "Notification No. 62/2022, S.O. 2735(E), dated 14 June 2022 — CII for FY 2022-23 (serial 22)",
  identifier: "62/2022",
});

const S45 = makeOfficialSourceReference({
  id: "ITA_1961_S45",
  kind: "act_section",
  authority: "Parliament",
  citation: "Section 45, Income-tax Act, 1961",
  identifier: "45",
});

const S48 = makeOfficialSourceReference({
  id: "ITA_1961_S48",
  kind: "act_section",
  authority: "Parliament",
  citation: "Section 48, Income-tax Act, 1961",
  identifier: "48",
});

const S50C = makeOfficialSourceReference({
  id: "ITA_1961_S50C",
  kind: "act_section",
  authority: "Parliament",
  citation: "Section 50C, Income-tax Act, 1961",
  identifier: "50C",
});

const S2_42A = makeOfficialSourceReference({
  id: "ITA_1961_S2_42A",
  kind: "act_section",
  authority: "Parliament",
  citation: "Section 2(42A), Income-tax Act, 1961",
  identifier: "2(42A)",
});

const S112 = makeOfficialSourceReference({
  id: "ITA_1961_S112",
  kind: "act_section",
  authority: "Parliament",
  citation: "Section 112, Income-tax Act, 1961",
  identifier: "112",
});

const S115BAC = makeOfficialSourceReference({
  id: "ITA_1961_S115BAC",
  kind: "act_section",
  authority: "Parliament",
  citation: "Section 115BAC, Income-tax Act, 1961",
  identifier: "115BAC",
});

const FINANCE_ACT_2025 = makeOfficialSourceReference({
  id: "FINANCE_ACT_2025",
  kind: "finance_act",
  authority: "Parliament",
  citation: "Finance Act, 2025",
});

const FINANCE_NO2_ACT_2024 = makeOfficialSourceReference({
  id: "FINANCE_NO2_ACT_2024",
  kind: "finance_act",
  authority: "Parliament",
  citation: "Finance (No. 2) Act, 2024",
});

// K4-11 (2026-08-01): the FIRST session in this programme to obtain the bare
// statutory text rather than a publisher's rendering of it. The Finance Act,
// 2025 PDF was fetched from `thc.nic.in/Central Governmental Acts/Finance Act,
// 2025.pdf` — a Government of India High Court host, reachable where the ITD's
// own `incometaxindia.gov.in` returned HTTP 403 for the SEVENTH consecutive
// session — and its text extracted locally, so the surcharge paragraphs and
// every proviso below are quoted verbatim from the Act itself. Corroborated by
// two directly-retrieved secondary sources (the ITD e-filing portal
// `www.incometax.gov.in`, and `taxguru.in`'s AY 2026-27 rate note stating the
// rates are unchanged from AY 2025-26). `indiabudget.gov.in`'s Finance Bill
// PDF, `tax2win.in` and `help.myitreturn.com` each returned 403 — recorded as
// attempted-but-blocked, never silently substituted (D67).
const FINANCE_ACT_2025_SURCHARGE = makeOfficialSourceReference({
  id: "FINANCE_ACT_2025_SURCHARGE",
  kind: "finance_act",
  authority: "Parliament",
  citation:
    "Finance Act, 2025, First Schedule, Part III, Paragraph A (\"Surcharge on income-tax\" — clauses " +
    "(a) to (e), the 15% proviso for dividend / section 111A / 112 / 112A income, and the marginal-" +
    "relief proviso), read with section 2(3)'s proviso for income chargeable under section 115BAC(1A)",
});

// K4-12 (2026-08-02): the amending clause for the Section 87A rebate and its
// rebate-threshold marginal relief, obtained the same way K4-11 obtained the
// surcharge paragraphs — the Finance Act, 2025 PDF from `thc.nic.in/Central
// Governmental Acts/Finance Act, 2025.pdf`, extracted locally with `pypdf`.
// `incometaxindia.gov.in` returned HTTP 403 for the EIGHTH consecutive session
// and `indiacode.nic.in` likewise; both recorded as attempted-but-blocked
// rather than silently substituted (D67). The BASE proviso this clause amends
// was corroborated from the ITD's own e-filing portal, whose FAQ reproduces
// clauses (a) and (b) in their pre-2025 ₹7,00,000 form.
const FINANCE_ACT_2025_S87A = makeOfficialSourceReference({
  id: "FINANCE_ACT_2025_S87A",
  kind: "finance_act",
  authority: "Parliament",
  citation:
    "Finance Act, 2025, clause 20 (amendment of section 87A of the Income-tax Act, with effect from " +
    "the 1st April, 2026 — substituting \"twelve hundred thousand rupees\" and \"sixty thousand rupees\" " +
    "in the proviso, and inserting the second proviso capping the deduction at the income-tax payable " +
    "at section 115BAC(1A) rates)",
});

// ═══════════════════════════════════════════════════════════════════════════
// K4-SOURCE-02 (2026-08-15) — THE FINANCE ACT, 2026 ITSELF, AND THE RULES 1962
// ═══════════════════════════════════════════════════════════════════════════
//
// EVERY SOURCE IN THIS BLOCK SERVES THE ASSESSMENT YEAR 2026-27 / INCOME-TAX
// ACT, 1961 WORLD. That is the whole point of them, and it is the one thing to
// get right when reading anything here.
//
// The Finance Act, 2026 has TWO halves. Section 2 and First Schedule Part I-A
// charge under the Income-tax Act, 1961 (AY 2026-27 — this world). Section 3
// and Part I-B charge under the Income-tax Act, 2025 (tax year 2026-27 — the
// TY world, `ty-2026-27-provenance.ts`). `K4-SOURCE-01` (`D301`) established
// that the ICAI edition this repository already held reproduces ONLY the
// 2025-Act half; these artifacts are the half it omits. NOTHING IN THIS BLOCK
// MAY BE CITED BY THE TY PACK, and nothing in the TY pack's Part I-B block may
// be cited here.
//
// Retrieved by the OWNER from `incometaxindia.gov.in/finance-acts` and
// `/income-tax-rules` under the save-dialog handoff
// (the official-source-retrieval design notes §3.1), then identified,
// SHA-256-hashed and registered by `K4-SOURCE-02` as `K4-SOURCE-02-S1`..`S4` in
// `docs/evidence/statutory-sources/manifest.json`. These are ITD publications —
// SOURCE RANK 1 for the Finance Act halves. This is the FIRST rank-1 statutory
// text this pack has ever cited for the surcharge and cess figures: `K4-11`
// could only reach the Finance Act, 2025 (the FY 2025-26 advance-tax basis) and
// corroborated the 2026 figures from secondary sources.
//
// **`K4-CITE-01` (`D315`) RE-CITED THE TWO FINANCE ACT HALVES TO THE GAZETTE.**
// The owner supplied the Finance Act, 2026 AS PUBLISHED IN THE GAZETTE OF INDIA
// (`K4-PORT-04-S1`, 2026-08-17) — the only Gazette-rank copy of this Act in the
// register, carrying s.2 and both halves of First Schedule Part I. Every span
// this pack quotes from the Finance Act, 2026 was verified present in its
// committed extracts before the re-citation, so this is a re-attribution, not a
// re-reading. Part I-A is quotable from the Gazette as-is (it prints
// "Rs. 2,50,000"); the rupee-glyph hazard affects only the 2025-Act half's
// amounts, which is why the TY pack's Part I-B AMOUNT spans stay on the ITD
// copy. The ITD artifacts stay registered as what this pack first read.
//
// CITING CHANGED NO COMPUTED FIGURE. Every constant these sources back was
// checked against the statute and found unchanged — the surcharge bands
// (10% / 15%), the 15% special-rate cap, the 25%/37% old-regime and 25%
// new-regime tiers above ₹2 crore, the marginal-relief windows, the 4% cess and
// the ₹50,00,000 ITR-1 ceiling. Had any of them moved, this session was
// required to STOP and record it as a `D276` version-bump event rather than
// edit a rate inside a citation sweep. None did. **Citing is not verifying:
// every caveat below still stands and this pack is still `draft`.**
//
// EXTRACTION DISCIPLINE (`official-source-retrieval.md` §3.2 and the new §9.1).
// Every figure below sits in a TABLE except the cess, which is prose. Each was
// resolved across ALL THREE `pdftotext` modes — `-layout`, default, and `-raw`
// — because `-layout` alone shuffles these tables' rows and the default mode
// splits them column-major. `-raw` was decisive on the s.2(5) marginal-relief
// Table and on rule 12's clause numbering.
const FINANCE_ACT_2026_S2 = makeOfficialSourceReference({
  id: "FINANCE_ACT_2026_S2",
  kind: "finance_act",
  authority: "Parliament",
  citation:
    "Finance Act, 2026, section 2 (\"Income-tax under Act 43 of 1961\") — sub-section (1) charging " +
    "income-tax for the assessment year commencing on the 1st day of April, 2026 at the rates in " +
    "Part I-A of the First Schedule; sub-section (4)(b) Table Sl. No. 10 (surcharge where income is " +
    "chargeable under section 115BAC(1A)); sub-section (5) and its Table (marginal relief, To = Ro + " +
    "So); and sub-section (6) (Health and Education Cess at four per cent.) — read in the GAZETTE " +
    "OF INDIA publication itself (No. 4 of 2026, the Finance Act, 2026 Gazette), source rank 1 " +
    "(the Gazette)",
  identifier: "2",
});

// ONE PHYSICAL ARTIFACT, TWO STATUTORY WORLDS — AND THAT IS TRUE OF THE GAZETTE
// TOO. `K4-SOURCE-02-S2` contains the First Schedule COMPLETE — Part I-A (1961
// Act, cited here) and Part I-B (2025 Act, the TY pack's business) in the same
// PDF — and the Gazette's First Schedule Part I extract
// (`K4-PORT-04-S1`, which `K4-CITE-01`/`D315` re-cited this source to) carries
// both halves the same way. Nothing but discipline and the `parallel-worlds`
// guard stops a later session citing the wrong half out of the right file, so:
// THIS CONSTANT IS PART I-A ONLY.
//
// The warning deliberately lives in this comment and NOT in the `citation`
// string below. A citation should be a citation; commentary inside it also
// defeats the guard, which can only match substrings and cannot tell a citation
// of Part I-B from a disclaimer about it.
const FINANCE_ACT_2026_FIRST_SCHEDULE_PART_I_A = makeOfficialSourceReference({
  id: "FINANCE_ACT_2026_FIRST_SCHEDULE_PART_I_A",
  kind: "finance_act",
  authority: "Parliament",
  citation:
    "Finance Act, 2026, First Schedule, PART I, A.--Income-tax under the Income-tax Act, 1961 " +
    "(Part I-A) — Paragraph F (\"Surcharge on income-tax\"), Table 1 Sl. No. 1 for the individual " +
    "surcharge rates and Table 2 Sl. No. 1 for marginal relief (Wo = Uo + Vo) — read in the GAZETTE " +
    "OF INDIA publication itself (No. 4 of 2026, the Finance Act, 2026 Gazette), source rank 1 " +
    "(the Gazette)",
});

// The 1962 Rules — the AY-world counterpart of the Income-tax Rules, 2026
// rule 164 that `K4-SOURCE-01` cited for the TY world. SAME FIGURE, DIFFERENT
// INSTRUMENT, DIFFERENT WORLD; the two citations must never be merged.
//
// Return forms are prescribed by RULES, not by the Act, which is the structural
// reason this gap outlived every Income-tax Act retrieval this programme ever
// attempted.
//
// THE CLAUSE NUMERAL (IV) NEEDED A THIRD EXTRACTION MODE. Under `pdftotext
// -layout` the fifty-lakh words appear to sit against clause (V); the PDF wraps
// clause (IG)'s text onto a line whose marker cell already holds the next
// marker, so every numeral in that proviso reads one row off its own text. Both
// documented modes are AMBIGUOUS here, not merely awkward. `-raw` resolves it to
// (IV), and the footnote-bracket structure agrees independently. The WORDS are
// identical and unambiguous in all three modes; only the numeral was in doubt.
const ITR_RULES_1962_R12_RETURN_FORMS = makeOfficialSourceReference({
  id: "ITR_1962_R12",
  kind: "rule",
  authority: "CBDT",
  citation:
    "Rule 12 (return of income), Income-tax Rules, 1962, as it applies to the assessment year " +
    "commencing on the 1st day of April, 2026 — sub-rule (1)(a) prescribing Form SAHAJ (ITR-1), and " +
    "clause (IV) of its proviso disqualifying a person who \"has total income, exceeding fifty lakh " +
    "rupees\" — read in the Income Tax Department's own consolidation (rank-1 publisher, but a Rule " +
    "is a rank-2 INSTRUMENT), NOT the notifying Gazette",
  identifier: "12",
});

const FINANCE_ACT_2025_FIRST_SCHEDULE_PART_III = makeOfficialSourceReference({
  id: "FINANCE_ACT_2025_FIRST_SCHEDULE_PART_III",
  kind: "finance_act",
  authority: "Parliament",
  citation:
    "Finance Act, 2025, First Schedule, Part III (rate paragraphs for a resident individual of " +
    "the age of sixty years or more but less than eighty years, and of the age of eighty years " +
    "or more, at any time during the previous year)",
});

// NOTE: `url` is deliberately OMITTED here even though this source was
// directly retrieved this session (see the rule's own caveat text for the
// URL) — matching this pack's existing convention (e.g. the surcharge
// threshold rule below) that no source in this pack carries a structural
// `url`/`publishedOn` field; the retrieval details live in caveat prose only.
const ITD_SENIOR_CITIZEN_HELP_AY_2026_27 = makeOfficialSourceReference({
  id: "ITD_SENIOR_CITIZEN_HELP_AY_2026_27",
  kind: "form_instruction",
  authority: "ITD",
  citation:
    "Income Tax Department, \"Senior Citizens and Super Senior Citizens for AY 2026-2027\" (help page)",
});

const S16_STANDARD_DEDUCTION = makeOfficialSourceReference({
  id: "ITA_1961_S16_STANDARD_DEDUCTION",
  kind: "act_section",
  authority: "Parliament",
  citation: "Section 16(ia), Income-tax Act, 1961 (standard deduction from salary)",
  identifier: "16(ia)",
});

const S80C = makeOfficialSourceReference({
  id: "ITA_1961_S80C",
  kind: "act_section",
  authority: "Parliament",
  citation: "Section 80C, Income-tax Act, 1961",
  identifier: "80C",
});

const S80CCD = makeOfficialSourceReference({
  id: "ITA_1961_S80CCD",
  kind: "act_section",
  authority: "Parliament",
  citation: "Section 80CCD(1B), Income-tax Act, 1961",
  identifier: "80CCD(1B)",
});

const S80CCE = makeOfficialSourceReference({
  id: "ITA_1961_S80CCE",
  kind: "act_section",
  authority: "Parliament",
  citation: "Section 80CCE, Income-tax Act, 1961",
  identifier: "80CCE",
});

const S80D = makeOfficialSourceReference({
  id: "ITA_1961_S80D",
  kind: "act_section",
  authority: "Parliament",
  citation: "Section 80D, Income-tax Act, 1961",
  identifier: "80D",
});

const S80TTA = makeOfficialSourceReference({
  id: "ITA_1961_S80TTA",
  kind: "act_section",
  authority: "Parliament",
  citation: "Section 80TTA, Income-tax Act, 1961",
  identifier: "80TTA",
});

const S80TTB = makeOfficialSourceReference({
  id: "ITA_1961_S80TTB",
  kind: "act_section",
  authority: "Parliament",
  citation: "Section 80TTB, Income-tax Act, 1961",
  identifier: "80TTB",
});

const S80G = makeOfficialSourceReference({
  id: "ITA_1961_S80G",
  kind: "act_section",
  authority: "Parliament",
  citation: "Section 80G, Income-tax Act, 1961",
  identifier: "80G",
});

const S207 = makeOfficialSourceReference({
  id: "ITA_1961_S207",
  kind: "act_section",
  authority: "Parliament",
  citation: "Section 207, Income-tax Act, 1961",
  identifier: "207",
});

// K4-03: directly retrieved this session (2026-07-25) from incometax.gov.in
// (URL in the rule's own caveat text, matching this pack's existing
// convention of no structural `url` field). A CBDT e-Filing validation-rules
// document, not the bare Act — cited as corroborating, machine-checked
// evidence of how the Department itself operationalizes these sections
// (self/family-vs-parents 80D split; 80TTA/80TTB mutual exclusivity), not as
// a substitute for the bare statutory text.
// K4-06: house property (Sections 22-27, 71(3A)). Direct ITD/CBDT-hosted
// pages were searched this session but the official Schedule-HP page
// (incometaxindia.gov.in/w/schedule_hp) returned HTTP 403 to a direct fetch
// — recorded, not silently omitted (see `rules.ts`'s `HOUSE_PROPERTY` module
// doc). ClearTax's "Income from House Property and Taxes" is relied on as
// the primary source instead, directly retrieved and quoted verbatim in
// that same module doc, corroborated by an independent secondary-publisher
// search aggregation (HomeFirstIndia, Policybazaar, TaxGarden, ManipalCigna,
// CallMyCA, Upstox, SmartTaxCalc).
const S22_24_HOUSE_PROPERTY = makeOfficialSourceReference({
  id: "ITA_1961_S22_TO_S27",
  kind: "act_section",
  authority: "Parliament",
  citation: "Sections 22-24 and 27, Income-tax Act, 1961",
  identifier: "22-27",
});

const S71_3A = makeOfficialSourceReference({
  id: "ITA_1961_S71_3A",
  kind: "act_section",
  authority: "Parliament",
  citation: "Section 71(3A), Income-tax Act, 1961",
  identifier: "71(3A)",
});

// K4-09: within-year capital-loss set-off (Sections 70, 71(3), 74). ClearTax's
// "How to Set Off and Carry Forward Capital Losses" is relied on as the primary
// source (directly retrieved 2026-07-31), corroborated by direct fetches of
// incometaxmanagement.in (Section 71 inter-head adjustment) and aubsp.com
// (quoting the bare Section 74(1)(a)/(b)/(2) text). BOTH incometaxindia.gov.in
// and bajajfinserv.in returned HTTP 403 to a direct fetch this session —
// recorded as attempted-but-blocked, not silently substituted.
const S43_5_DERIVATIVES = makeOfficialSourceReference({
  id: "ITA_1961_S43_5",
  kind: "act_section",
  authority: "Parliament",
  citation:
    "Section 43(5), Income-tax Act, 1961 (definition of speculative transaction and provisos for eligible derivatives)",
  identifier: "43(5)",
  url: "https://www.incometaxindia.gov.in/w/section-43-64",
});

const S70_INTRA_HEAD_SET_OFF = makeOfficialSourceReference({
  id: "ITA_1961_S70",
  kind: "act_section",
  authority: "Parliament",
  citation: "Section 70, Income-tax Act, 1961 (set off of loss from one source against income from another source under the same head)",
  identifier: "70",
  url: "https://www.incometaxindia.gov.in/w/section-70-63",
});

const S73_SPECULATION_LOSS = makeOfficialSourceReference({
  id: "ITA_1961_S73",
  kind: "act_section",
  authority: "Parliament",
  citation: "Section 73, Income-tax Act, 1961 (losses in speculation business)",
  identifier: "73",
  url: "https://www.incometaxindia.gov.in/w/section-73-1",
});

const S73A_SPECIFIED_BUSINESS_LOSS = makeOfficialSourceReference({
  id: "ITA_1961_S73A",
  kind: "act_section",
  authority: "Parliament",
  citation: "Section 73A, Income-tax Act, 1961 (carry forward and set off of losses by specified business)",
  identifier: "73A",
  url: "https://www.incometaxindia.gov.in/w/section-73a-13",
});

// K4-17: official ITD/CBDT guidance retrieved 2026-08-13. This is guidance,
// not the statute: it corroborates the separation between current-year
// intra-head adjustment, residual inter-head adjustment, and carry-forward.
const ITD_SET_OFF_AND_CARRY_FORWARD_GUIDANCE = makeOfficialSourceReference({
  id: "ITD_SET_OFF_AND_CARRY_FORWARD_GUIDANCE_2026",
  kind: "form_instruction",
  authority: "ITD",
  citation: "Income Tax Department, Set-off and carry forward of losses (official guidance, version 2.0)",
  publishedOn: "2026-05-27",
  url: "https://www.incometaxindia.gov.in/documents/20117/42998/Set-off-and-carry-forward-of-losses_2026-05-27_12-13-23_131dc8_en.pdf/6713bef0-2a75-75f8-a539-2b2aa9a128d7?t=1779945185808&version=2.0",
});

const S71_3_CAPITAL_LOSS = makeOfficialSourceReference({
  id: "ITA_1961_S71_3",
  kind: "act_section",
  authority: "Parliament",
  citation: "Section 71(3), Income-tax Act, 1961 (a capital loss may not be set off against any other head)",
  identifier: "71(3)",
});

const S74_CARRY_FORWARD = makeOfficialSourceReference({
  id: "ITA_1961_S74",
  kind: "act_section",
  authority: "Parliament",
  citation: "Section 74, Income-tax Act, 1961 (carry forward and set off of losses under the head Capital gains)",
  identifier: "74",
});

const CBDT_ITR2_VALIDATION_RULES_AY_2026_27 = makeOfficialSourceReference({
  id: "CBDT_ITR2_VALIDATION_RULES_AY_2026_27",
  kind: "form_instruction",
  authority: "CBDT",
  citation:
    "Central Board of Direct Taxes, e-Filing Project, \"ITR 2 – Validation Rules for AY 2026-27\", Version 1.0",
});

// K4-07: Section 44ADA presumptive professional income. ClearTax's
// "Section 44ADA – Presumptive Tax Scheme for Professionals"
// (cleartax.in/s/section-44ada, directly retrieved) is relied on as the
// primary source (see rules.ts's PRESUMPTIVE_44ADA module doc for the full
// verbatim citations); incometaxindia.gov.in's presumptive-taxation FAQ
// page returned HTTP 403 to a direct fetch this session (recorded, not
// silently substituted — the same host K4-06 also found blocked).
const S44ADA = makeOfficialSourceReference({
  id: "ITA_1961_S44ADA",
  kind: "act_section",
  authority: "Parliament",
  citation: "Section 44ADA, Income-tax Act, 1961",
  identifier: "44ADA",
});

const S44AA = makeOfficialSourceReference({
  id: "ITA_1961_S44AA",
  kind: "act_section",
  authority: "Parliament",
  citation: "Section 44AA(1), Income-tax Act, 1961 (specified professions)",
  identifier: "44AA",
});

// K4-07: directly fetched incometax.gov.in (a different host than the
// blocked incometaxindia.gov.in above), confirming ITR-4 (Sugam)
// applicability for presumptive-basis income under Sections 44AD/44ADA/44AE.
const ITD_ITR4_APPLICABILITY = makeOfficialSourceReference({
  id: "ITD_ITR4_APPLICABILITY",
  kind: "form_instruction",
  authority: "ITD",
  citation: "Income Tax Department, ITR-4 (Sugam) applicability guidance (incometax.gov.in)",
});

// K4-08 (2026-07-31): Section 44AD, sourced independently of 44ADA above —
// see rules.ts's PRESUMPTIVE_44AD module doc for the full verbatim
// citations. incometaxindia.gov.in returned HTTP 403 to a direct fetch this
// session too (recorded, not silently substituted).
const S44AD = makeOfficialSourceReference({
  id: "ITA_1961_S44AD",
  kind: "act_section",
  authority: "Parliament",
  citation: "Section 44AD, Income-tax Act, 1961",
  identifier: "44AD",
});

// K4-24 Phase 0 — RULE 6ABBA, LOAD-BEARING SINCE K4-08 AND CITED BY NOTHING
// UNTIL NOW. Section 44AD(1)'s proviso sets the 6% rate for the portion of
// turnover received "by an account payee cheque or an account payee bank draft
// or use of electronic clearing system through a bank account or through such
// other electronic mode as may be prescribed". `presumptive_44ad_computation`
// has split turnover on that basis since the slice shipped, while the rule
// that PRESCRIBES those modes was named by no source reference — the caveat
// rested entirely on secondary publishers for an element that has a statutory
// instrument. `K4-SOURCE-07` registered the rule and deliberately did not
// re-cite it (`D343`: adding a citation is a pack-provenance change a
// retrieval session does not make); this closes that.
//
// It is a RANK-2 CONSOLIDATED DEPARTMENTAL REPRINT, not the notifying Gazette,
// and the citation says so. Citing it establishes WHICH modes are prescribed;
// it decides nothing about the 6%/8% split itself, which stays sourced as the
// caveat below already describes.
const ITR_RULES_1962_R6ABBA = makeOfficialSourceReference({
  id: "ITR_1962_R6ABBA",
  kind: "rule",
  authority: "CBDT",
  citation:
    "Rule 6ABBA (other electronic modes), Income-tax Rules, 1962 — the prescribed electronic modes " +
    "for, among others, the \"proviso to sub-section (1) of section 44AD\" — read in the Income Tax " +
    "Department's own consolidation (rank-1 publisher, but a Rule is a rank-2 INSTRUMENT and this " +
    "is a reprint, NOT the notifying Gazette)",
  identifier: "6ABBA",
});

// K4-14 — the books-based business/profession head. Section 28 charges it and
// Section 29 says it is computed "in accordance with the provisions contained
// in sections 30 to 43D", which is precisely why the implemented window is so
// narrow: this engine implements none of Sections 30 to 43D. Section 44AB is
// cited because the audit threshold is what bounds the window from above.
const S28 = makeOfficialSourceReference({
  id: "ITA_1961_S28",
  kind: "act_section",
  authority: "Parliament",
  citation: "Section 28, Income-tax Act, 1961",
  identifier: "28",
});

const S29 = makeOfficialSourceReference({
  id: "ITA_1961_S29",
  kind: "act_section",
  authority: "Parliament",
  citation: "Section 29, Income-tax Act, 1961",
  identifier: "29",
});

const S44AB = makeOfficialSourceReference({
  id: "ITA_1961_S44AB",
  kind: "act_section",
  authority: "Parliament",
  citation: "Section 44AB, Income-tax Act, 1961",
  identifier: "44AB",
});

/**
 * The rule groups the AY 2026-27 engine implements, each with the sources the
 * engine documents for it. Rule ids are a stable contract — verification records
 * reference them.
 */
export const AY_2026_27_PACK_PROVENANCE: TaxPackProvenance = makeTaxPackProvenance([
  makeRuleProvenance({
    ruleId: "slab_rates",
    summary: "New- and old-regime slab bands and rates (slabs.ts)",
    sources: [S115BAC, FINANCE_ACT_2025],
    caveat:
      "TODO(CA-verify): confirm slab boundaries and that no further mid-year amendment applies for FY 2025-26.",
  }),
  makeRuleProvenance({
    ruleId: "standard_deduction",
    summary: "Standard deduction against salary income, by regime",
    sources: [S16_STANDARD_DEDUCTION],
    caveat:
      "TODO(CA-verify): cited from the consolidated Income-tax Act, 1961 as amended by Finance Act " +
      "2025 (`K4-PORT-04-S2`, rank 2, editorial brackets, publisher not established). Section " +
      "16(ia) states \"a deduction of fifty thousand rupees or the amount of the salary, whichever " +
      "is less\". For income-tax computed under section 115BAC(1A)(ii), its proviso says \"the " +
      "provisions of this clause shall have effect as if for the words 'fifty thousand rupees', the " +
      "words 'seventy-five thousand rupees' had been substituted\". Both spans were read on pages " +
      "127-128 in -layout, default and -raw. THE FIGURES DID NOT MOVE and no computed result " +
      "changed; adding source text makes this draft rule verifiable, not verified. Re-confirm each year.",
    verbatimQuotes: [
      {
        artifactId: "K4-PORT-04-S2",
        text: "a deduction of fifty thousand rupees or the amount of the salary, whichever is less",
      },
      {
        artifactId: "K4-PORT-04-S2",
        text: "the provisions of this clause shall have effect as if for the words 'fifty thousand " +
          "rupees', the words 'seventy-five thousand rupees' had been substituted",
      },
    ],
  }),
  makeRuleProvenance({
    ruleId: "rebate_87a",
    summary: "Section 87A rebate parameters (income limit and maximum rebate), by regime",
    sources: [S87A, FINANCE_ACT_2025],
    caveat: RECONFIRM_ANNUALLY,
  }),
  // K4-12: the rebate-threshold marginal relief is its own rule, deliberately
  // NOT folded into `rebate_87a` above. They are cited by different figures
  // (the ordinary rebate exists at every income; the relief exists only in a
  // ~₹70,588-wide window), they were sourced in different sessions from
  // different text, and a reader of a relieved figure needs THIS caveat rather
  // than the ceiling's.
  makeRuleProvenance({
    ruleId: "rebate_87a_marginal_relief",
    summary:
      "Section 87A marginal relief at the REBATE threshold — where total income exceeds ₹12,00,000 and " +
      "the income-tax on it exceeds that excess, the deduction is the difference, capped at the " +
      "income-tax payable at section 115BAC(1A) rates. NEW REGIME ONLY: the enabling proviso is " +
      "conditioned on section 115BAC(1A), so the old regime's ₹5,00,000 ceiling is a genuine cliff " +
      "with no relief. A SEPARATE relief from `surcharge_marginal_relief`, sharing only the name.",
    sources: [S87A, FINANCE_ACT_2025_S87A],
    caveat:
      "TODO(CA-verify): the AMENDING text is quoted VERBATIM from the Finance Act, 2025, clause 20 — " +
      "\"20. In section 87A of the Income-tax Act, with effect from the 1st April, 2026,–– (a) in the " +
      "proviso,— (i) in clause (a),–– (I) for the words 'seven hundred thousand rupees', the words " +
      "'twelve hundred thousand rupees' shall be substituted; (II) for the words 'twenty-five thousand " +
      "rupees', the words 'sixty thousand rupees' shall be substituted; (ii) in clause (b), for the " +
      "words 'seven hundred thousand rupees' at both the places where they occur, the words 'twelve " +
      "hundred thousand rupees' shall be substituted; (b) after the proviso, the following proviso " +
      "shall be inserted, namely:–– 'Provided further that the deduction under the first proviso, " +
      "shall not exceed the amount of income-tax payable as per the rates provided in sub-section (1A) " +
      "of section 115BAC.'\" — but the BASE proviso it amends was NOT read off the bare consolidated " +
      "Act, which could not be retrieved (incometaxindia.gov.in HTTP 403 for the eighth consecutive " +
      "session; indiacode.nic.in HTTP 403). It was corroborated from the ITD e-filing portal's own " +
      "FAQ. ONE directly-retrieved secondary publisher (ClearTax) states the relief applies under BOTH " +
      "regimes and is NOT followed — it is contradicted by the primary structure (capping \"the " +
      "deduction under the first proviso\" at section 115BAC(1A) rates is incoherent if that proviso " +
      "reached old-regime assessees) and by two other directly-retrieved sources. The conflict is " +
      "recorded so it is not re-litigated from scratch. AN UNRESOLVED AMBIGUITY IS REFUSED RATHER THAN " +
      "GUESSED: where the case carries special-rate 111A/112A income, neither (a) whether the section " +
      "87A deduction is available at all, nor (b) whether \"the income-tax payable on such total " +
      "income\" means the slab tax alone or the slab tax plus the special-rate tax, is settled by any " +
      "located source — so relief is applied only where provably nil under every reading, and the case " +
      "is otherwise reliance-blocked with NO relief applied (tax never understated).",
    unverifiableQuotes: [
      {
        text: "20. In section 87A of the Income-tax Act, with effect from the 1st April, 2026,–– (a) "
            + "in the proviso,— (i) in clause (a),–– (I) for the words 'seven hundred thousand "
            + "rupees', the words 'twelve hundred thousand rupees' shall be substituted; (II) for the "
            + "words 'twenty-five thousand rupees', the words 'sixty thousand rupees' shall be "
            + "substituted; (ii) in clause (b), for the words 'seven hundred thousand rupees' at both "
            + "the places where they occur, the words 'twelve hundred thousand rupees' shall be "
            + "substituted; (b) after the proviso, the following proviso shall be inserted, namely:–– "
            + "'Provided further that the deduction under the first proviso, shall not exceed the "
            + "amount of income-tax payable as per the rates provided in sub-section (1A) of section "
            + "115BAC.'",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
      {
        text: "the deduction under the first proviso",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
      {
        text: "the income-tax payable on such total income",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
    ],
  }),
  makeRuleProvenance({
    ruleId: "capital_gains_stcg_111a",
    summary: "Short-term capital gains rate on listed equity / equity MF under section 111A",
    sources: [S111A, FINANCE_NO2_ACT_2024],
    caveat: RECONFIRM_ANNUALLY,
  }),
  makeRuleProvenance({
    ruleId: "capital_gains_ltcg_112a",
    summary: "Long-term capital gains rate and annual exemption under section 112A",
    sources: [S112A],
    caveat: RECONFIRM_ANNUALLY,
  }),
  makeRuleProvenance({
    ruleId: "capital_gains_house_sale",
    summary:
      "Capital gains on a sale of land or building or both under sections 45, 48, 50C and 112, " +
      "AY 2026-27 — short-term at slab rates, long-term at the section 112 comparison",
    sources: [
      S45,
      S48,
      S50C,
      S2_42A,
      S112,
      S111A,
      FINANCE_NO2_ACT_2024,
      CII_N44_2017,
      CII_N26_2018,
      CII_N63_2019,
      CII_N32_2020,
      CII_N73_2021,
      CII_N62_2022,
      CII_N39_2023,
      CII_N44_2024,
      CII_N70_2025,
    ],
    caveat:
      "TODO(CA-verify): quoted from the consolidated Income-tax Act, 1961 as amended by Finance Act " +
      "2025 (`K4-PORT-04-S2`, rank 2, editorial brackets, publisher not established from the " +
      "document). Three-mode read 2026-08-18; Gazette Chapter III Part A does not amend these " +
      "provisions. s.45(1): \"Any profits or gains arising from the transfer of a capital asset " +
      "effected in the previous year shall\" be chargeable under Capital gains. s.2(42A) default: a " +
      "\"short-term capital asset\" is held for not more than twenty-four months. s.48 second " +
      "proviso indexes only a transfer \"which takes place before the 23rd day of July, 2024\". " +
      "s.50C deems stamp duty value the full consideration unless it does not exceed \"one hundred " +
      "and ten per cent\" of consideration; ONE such full value feeds both comparison branches. " +
      "SHORT-TERM is slab-rate income, not s.111A — s.111A is listed equity / equity-oriented fund " +
      "/ business trust only, never a house. " +
      "LONG-TERM (K4-23, owner decision D337) is the s.112 comparison, per property: branch A is " +
      "s.112(1)(a)(ii)(B)'s \"twelve and one-half per cent\" on the UNINDEXED gain; branch B is " +
      "twenty per cent on the gain indexed under s.48 Explanation (iii). The second proviso says " +
      "that where the item (B) tax exceeds the pre-Finance (No. 2) Act, 2024 figure \"such excess " +
      "shall be ignored\", so the adopted figure is the lower, and branch A on an exact tie. TOTAL " +
      "INCOME CARRIES THE UNINDEXED GAIN; only the tax is capped. Each indexed cost and each " +
      "branch's tax is rounded to the nearest rupee before the comparison. A nil-or-negative " +
      "indexed comparator makes branch B nil, which is the proviso read literally, not a gap. " +
      "THE COST INFLATION INDEX IS NOW UNIFORMLY SOURCED, and K4-24 Phase 0 is what made that " +
      "true: all 25 notified values the indexed branch can need come from the NINE notifications " +
      "cited above, each held as a hash-registered e-Gazette artifact with a committed three-mode " +
      "extract, and the recital chain runs unbroken from FY 2001-02 to FY 2025-26. Each of the " +
      "five FY 2018-19 to FY 2022-23 values was read back from its own instrument before its " +
      "evidence marker moved, and NO VALUE CHANGED. The superseded limitation, kept because it " +
      "is the record of a gap that stood for two sessions: the five were the OWNER'S DECISION " +
      "under D337, corroborated by footnote 48c of the rank-2 consolidated Act but held by no " +
      "registered instrument, so a case indexing from one of those years rested on a weaker " +
      "source than any other. IT NO LONGER DOES. What has NOT changed is rank: every one of the " +
      "nine is a rank-2 e-Gazette PDF of a statutory instrument, not the instrument as issued, " +
      "and none of this verifies a tax treatment or moves this pack toward ca_verified. " +
      "THE s.112(1)(a) FIRST PROVISO (basic-exemption absorption) IS NOT APPLIED: wherever " +
      "it could change the figure in either regime the whole long-term treatment is REFUSED " +
      "rather than disclosed. Also refused long-term: any declared cost of improvement (no " +
      "improvement year is stored), acquisition before 1 April 2001 (s.55(2)(b) fair market value " +
      "is not modelled), an undeclared assessee share, an unaccepted or disputed stamp value " +
      "(s.50C(2) refers valuation to a Valuation Officer), and any year with no held index. " +
      "s.54 / s.54F, s.49, s.50, agricultural land and an actual capital loss refuse in both " +
      "holdings. This is NOT s.22/23 house-property income. other_stcg / other_ltcg stay " +
      "placeholders. No TY computation. Re-confirm each year.",
    verbatimQuotes: [
      {
        artifactId: "K4-PORT-04-S2",
        text: "Any profits or gains arising from the transfer of a capital asset effected in the previous year shall",
      },
      {
        artifactId: "K4-PORT-04-S2",
        text: "short-term capital asset",
      },
      {
        artifactId: "K4-PORT-04-S2",
        text: "which takes place before the 23rd day of July, 2024",
      },
      {
        artifactId: "K4-PORT-04-S2",
        text: "one hundred and ten per cent",
      },
      {
        artifactId: "K4-PORT-04-S2",
        text: "twelve and one-half per cent",
      },
      {
        artifactId: "K4-PORT-04-S2",
        text: "such excess shall be ignored",
      },
    ],
  }),
  // K4-SOURCE-02 (2026-08-15): this rule cited NO statutory source at all until
  // now — the engine applied 4% to every case on documentation alone. The cess
  // is a Finance Act matter under BOTH Acts, and the AY 2026-27 one is charged
  // by section 2, which is exactly the half ICAI's edition omits (`D301`).
  makeRuleProvenance({
    ruleId: "cess_rate",
    summary:
      "Health & Education Cess at 4%, applied on income-tax plus surcharge less rebate, for AY " +
      "2026-27 under the Income-tax Act, 1961",
    sources: [FINANCE_ACT_2026_S2],
    caveat:
      "TODO(CA-verify): quoted VERBATIM from the Finance Act, 2026, section 2(6) — \"The amount of " +
      "income-tax as specified in sub-sections (1) to (5) and as increased by the applicable " +
      "surcharge, for the purposes of the Union, calculated in the manner provided therein, shall be " +
      "further increased by an additional surcharge, for the purposes of the Union, to be called the " +
      "'Health and Education Cess on income-tax', calculated at the rate of four per cent. of such " +
      "income-tax and surcharge so as to fulfil the commitment of the Government to provide and " +
      "finance quality health services and universalised quality basic education and secondary and " +
      "higher education.\" This is PROSE, not a rate table, so the §3.2 table-misrendering hazard " +
      "does not apply to it; it was nonetheless read in all three pdftotext modes and is identical in " +
      "each. THE FIGURE DID NOT MOVE: the engine's 4% was already correct and no computed value " +
      "changed when this citation was added. TWO LIMITS SURVIVE. (1) The base this engine applies the " +
      "4% to is its own (tax + surcharge - rebate); the statute says \"such income-tax and surcharge\" " +
      "as increased under sub-sections (1) to (5), and whether the engine's rebate ordering matches " +
      "the statutory base in every case is a tax question this session did not decide. (2) It was " +
      "first read in the Income Tax Department's own publication and is now read in the GAZETTE of " +
      "India itself (No. 4 of 2026, source rank 1 — the enacting publication; K4-CITE-01, D315). " +
      "Re-confirm each assessment year.",
    verbatimQuotes: [
      {
        artifactId: "K4-PORT-04-S1",
        text: "The amount of income-tax as specified in sub-sections (1) to (5) and as increased by "
            + "the applicable surcharge, for the purposes of the Union, calculated in the manner "
            + "provided therein, shall be further increased by an additional surcharge, for the "
            + "purposes of the Union, to be called the 'Health and Education Cess on income-tax', "
            + "calculated at the rate of four per cent. of such income-tax and surcharge so as to "
            + "fulfil the commitment of the Government to provide and finance quality health services "
            + "and universalised quality basic education and secondary and higher education.",
      },
      {
        artifactId: "K4-PORT-04-S1",
        text: "such income-tax and surcharge",
      },
    ],
  }),
  makeRuleProvenance({
    ruleId: "chapter_via_deduction_caps",
    summary: "Chapter VI-A deduction caps used in the old regime (basic caps only)",
    sources: [S80C, S80CCD, S80CCE, S80D, S80G, S80TTA, S80TTB],
    caveat:
      "TODO(CA-verify): cited from the consolidated Income-tax Act, 1961 as amended by Finance Act " +
      "2025 (`K4-PORT-04-S2`, rank 2, editorial brackets, publisher not established). The held " +
      "Chapter VI-A pages state for section 80C \"as does not exceed one hundred and fifty thousand " +
      "rupees\" and section 80CCE says \"The aggregate amount of deductions under section 80C, " +
      "section 80CCC and sub-section (1) of section 80CCD shall not, in any case, exceed one hundred " +
      "and fifty thousand rupees\". Section 80CCD(1B) says \"which shall not exceed fifty thousand " +
      "rupees\". Section 80D says \"the provisions of this section shall have effect as if for the " +
      "words 'twenty-five thousand rupees', the words 'fifty thousand rupees' had been substituted\" " +
      "for a senior citizen. Section 80G includes \"an amount equal to fifty per cent of the aggregate " +
      "of the sums specified in sub-section (2)\". Section 80TTA says \"in any other case, ten " +
      "thousand rupees\"; section 80TTB says \"in any other case, fifty thousand rupees\". Every " +
      "declared span was read in -layout, default and -raw; -layout is unreliable for the long " +
      "section 80G lists, so default and -raw were cross-checked. THE FIGURES DID NOT MOVE and no " +
      "computed result changed. The 80G value remains pass-through: qualifying limits and 50%-vs-100% " +
      "category eligibility are not computed. The senior-spouse 80D scope gap documented in " +
      "rules.ts also remains. Adding source text makes this draft rule verifiable, not verified. " +
      "Re-confirm each year.",
    verbatimQuotes: [
      {
        artifactId: "K4-PORT-04-S2",
        text: "as does not exceed one hundred and fifty thousand rupees",
      },
      {
        artifactId: "K4-PORT-04-S2",
        text: "The aggregate amount of deductions under section 80C, section 80CCC and sub-section " +
          "(1) of section 80CCD shall not, in any case, exceed one hundred and fifty thousand rupees",
      },
      {
        artifactId: "K4-PORT-04-S2",
        text: "which shall not exceed fifty thousand rupees",
      },
      {
        artifactId: "K4-PORT-04-S2",
        text: "the provisions of this section shall have effect as if for the words 'twenty-five " +
          "thousand rupees', the words 'fifty thousand rupees' had been substituted",
      },
      {
        artifactId: "K4-PORT-04-S2",
        text: "an amount equal to fifty per cent of the aggregate of the sums specified in sub-section (2)",
      },
      {
        artifactId: "K4-PORT-04-S2",
        text: "in any other case, ten thousand rupees",
      },
      {
        artifactId: "K4-PORT-04-S2",
        text: "in any other case, fifty thousand rupees",
      },
    ],
  }),
  // K4-SOURCE-02 (2026-08-15): cited to the Income-tax RULES, 1962 — the AY
  // 2026-27 counterpart of the Rules 2026 rule 164 that `K4-SOURCE-01` cited
  // for the TY world. Same figure, different instrument, different statutory
  // world; the two are deliberately separate citations and must not be merged.
  makeRuleProvenance({
    ruleId: "itr1_income_ceiling",
    summary:
      "ITR-1 (SAHAJ) total-income ceiling of ₹50,00,000 used by the form recommendation for AY " +
      "2026-27 under the Income-tax Act, 1961",
    sources: [ITR_RULES_1962_R12_RETURN_FORMS],
    caveat:
      "TODO(CA-verify): quoted VERBATIM from the Income-tax Rules, 1962, rule 12(1)(a), which puts a " +
      "resident-other-than-not-ordinarily-resident individual with salary / one-or-two house " +
      "properties / other-sources income on Form SAHAJ (ITR-1), and from clause (IV) of that " +
      "sub-rule's proviso listing persons to whom it does NOT apply — \"has total income, exceeding " +
      "fifty lakh rupees;\". The rule text is expressly for \"the assessment year commencing on the " +
      "1st day of April, 2026\". THE FIGURE DID NOT MOVE: the engine's ₹50,00,000 was already correct " +
      "and no computed value changed when this citation was added. THE CEILING IS STRICT — the rule " +
      "disqualifies income EXCEEDING fifty lakh rupees, so exactly ₹50,00,000 remains ITR-1 eligible " +
      "on this condition. THREE LIMITS SURVIVE. (1) THE ENGINE MODELS ONE CONDITION OUT OF FOURTEEN: " +
      "the proviso also disqualifies on foreign assets, foreign signing authority, foreign income, " +
      "section 5A apportionment, section 57 deductions, directorship, unlisted shares, TDS in another " +
      "person's hands, section 90/90A/91 relief, agricultural income above ₹5,000, section 115BBDA " +
      "income, section 115BBE income, section 194N deduction, and deferred section 191(2)/192(1C) " +
      "tax. Recommending ITR-1 on the income ceiling alone is NARROWER THAN THE RULE — the same limit " +
      "recorded for the TY world's rule 164(3). (2) The clause NUMERAL (IV) could not be resolved " +
      "from either documented pdftotext mode, both of which render this proviso's roman numerals one " +
      "row off their own text; it was settled with a third mode (`-raw`) and corroborated by the " +
      "footnote-bracket structure. The quoted WORDS are identical in all three modes. (3) It was read " +
      "in the Income Tax Department's own consolidation — a rank-1 publisher, but a Rule is a rank-2 " +
      "INSTRUMENT and this is not the notifying Gazette. Re-confirm each assessment year.",
    verbatimQuotes: [
      {
        artifactId: "K4-SOURCE-02-S3",
        text: "has total income, exceeding fifty lakh rupees;",
      },
    ],
    unverifiableQuotes: [
      {
        text: "the assessment year commencing on the 1st day of April, 2026",
        reason: QUOTE_ANNOTATION_STRIPPED,
      },
    ],
  }),
  // TAX-SAFE-01: a SAFETY (reliance-blocking) threshold, not a computation
  // rule — the engine applies no surcharge or marginal-relief arithmetic
  // (rules.ts NOT_IMPLEMENTED.surcharge / .marginalRelief). This entry exists
  // so the conservative income threshold that triggers the
  // SURCHARGE_MARGINAL_RELIEF_UNSUPPORTED reliance blocker
  // (src/lib/tax-desk/tax-capability.ts) is itself a versioned, cited pack
  // rule rather than a bare literal in application code — per the rule that a
  // safety threshold used only to block reliance is still a tax-law rule and
  // must live in this layer.
  makeRuleProvenance({
    ruleId: "surcharge_marginal_relief_safety_threshold",
    summary:
      "Conservative total-income threshold (₹50,00,000) above which — NOT at or " +
      "equal to, strictly EXCEEDING — a resident individual's income may attract " +
      "surcharge and/or marginal relief under both regimes for AY 2026-27 / FY " +
      "2025-26. Used ONLY to trigger a reliance blocker (no surcharge/marginal-" +
      "relief amount is computed from it). A case at EXACTLY ₹50,00,000 attracts " +
      "nil surcharge and is NOT blocked by this rule.",
    sources: [FINANCE_ACT_2025],
    caveat:
      "TODO(CA-verify): sourced from the Finance Act, 2025 (First Schedule, " +
      "Part III — rates for advance tax/TDS purposes for FY 2025-26, i.e. AY " +
      "2026-27), which conditions the surcharge/marginal-relief tiers on total " +
      "income that EXCEEDS the stated figures (strict inequality) — never " +
      "\"at or above\". TAX-SAFE-01 (2026-07-24) originally corroborated the " +
      "₹50 lakh entry figure only against two independent secondary tax-law " +
      "publishers because the primary government portal " +
      "(incometaxindia.gov.in) blocked automated retrieval (HTTP 403) that " +
      "session; it also mis-recorded the boundary as \"at or above\". " +
      "TAX-SAFE-01A (2026-07-24) corrected the boundary to strict `>` and " +
      "additionally retrieved the Income Tax Department's own AY 2026-27 " +
      "guidance directly (incometax.gov.in, \"Salaried Individuals for AY " +
      "2026-27\" help page — a different ITD domain than the one blocked " +
      "previously), which states the applicable surcharge rate for total " +
      "income \"Up to Rs. 50 lakhs\" is Nil, and describes marginal relief as " +
      "capping combined tax-plus-surcharge at (tax on ₹50 lakh) + (the amount " +
      "of income that EXCEEDS ₹50 lakh) — confirming strict inequality at the " +
      "entry tier from a primary source, corroborated further by two " +
      "independent secondary tax-law publishers (retrieved 2026-07-24). Only " +
      "the lowest entry threshold (₹50 lakh, common to both regimes) is used " +
      "— the higher-tier percentages/thresholds (₹1cr/15%, ₹2cr/25%, " +
      "₹5cr/37% old vs 25% capped new) are NOT relied on for this blocker and " +
      "are not independently re-verified here. Re-confirm directly against " +
      "the bare Finance Act text before CA verification.",
    unverifiableQuotes: [
      {
        text: "at or above",
        reason: QUOTE_NOT_STATUTORY_TEXT,
      },
      {
        text: "Salaried Individuals for AY 2026-27",
        reason: QUOTE_NOT_STATUTORY_TEXT,
      },
      {
        text: "Up to Rs. 50 lakhs",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
    ],
  }),
  // K4-11: the surcharge COMPUTATION rule — distinct from the
  // `surcharge_marginal_relief_safety_threshold` SAFETY rule above, which
  // remains what it always was (a blocking-only entry threshold) and is
  // deliberately NOT merged into this one. The safety rule still governs where
  // the blocker triggers; this rule governs what is actually computed once it
  // does.
  makeRuleProvenance({
    ruleId: "surcharge_rates",
    summary:
      "Surcharge on income-tax for an individual for AY 2026-27 / FY 2025-26 — the 10% tier (total " +
      "income exceeding ₹50,00,000 but not exceeding ₹1,00,00,000) and the 15% tier (exceeding " +
      "₹1,00,00,000 but not exceeding ₹2,00,00,000), identical under both regimes. The 25% and 37% " +
      "tiers above ₹2,00,00,000 are NOT declared and NOT computed.",
    sources: [
      FINANCE_ACT_2026_FIRST_SCHEDULE_PART_I_A,
      FINANCE_ACT_2026_S2,
      FINANCE_ACT_2025_SURCHARGE,
      S111A,
      S112A,
      S115BAC,
    ],
    caveat:
      "**K4-SOURCE-02 (2026-08-15) CORRECTED THIS CAVEAT FORWARD, and the correction is at the END " +
      "of it — read that before relying on anything in between.** The Finance Act, 2026 text HAS now " +
      "been retrieved and read, and it CONFIRMS every declared figure. The original caveat follows " +
      "unrewritten (PROJECT_CONSTITUTION.md §4). — TODO(CA-verify): quoted VERBATIM from the bare Finance Act, 2025, First Schedule, Part III, " +
      "Paragraph A (the rates for computing advance tax for FY 2025-26, i.e. AY 2026-27) — \"(a) " +
      "having a total income (including the income by way of dividend or income under the provisions " +
      "of section 111A, section 112 and section 112A ...) exceeding fifty lakh rupees but not " +
      "exceeding one crore rupees, at the rate of ten per cent. of such income-tax; (b) ... exceeding " +
      "one crore rupees but not exceeding two crore rupees, at the rate of fifteen per cent. of such " +
      "income-tax\" — and, for the new regime, from section 2(3)'s proviso \"Provided also that in " +
      "respect of income chargeable to tax under sub-section (1A) of section 115BAC ...\", whose " +
      "clause (iii) caps the top tier at \"twenty-five per cent.\" with no 37% band. The Act's own " +
      "first proviso limits the surcharge rate on the income-tax computed in respect of dividend / " +
      "111A / 112 / 112A income to fifteen per cent.; that proviso is provably NON-BINDING at both " +
      "declared tiers (10% and 15% are each at or below 15%), which is precisely why the implemented " +
      "window ends at ₹2,00,00,000 — above it the proviso binds and the apportionment it requires is " +
      "unmodelled. The Finance Act, 2025 text is the FY 2025-26 advance-tax basis; that the AY " +
      "2026-27 figures are unchanged is corroborated by secondary sources only (the bare Finance Act, " +
      "2026 text could not be retrieved — indiabudget.gov.in returned HTTP 403). Re-confirm against " +
      "the Finance Act, 2026 First Schedule before CA verification. " +
      "— **THE K4-SOURCE-02 FORWARD CORRECTION.** That last sentence is now DONE and the sentence " +
      "before it is SUPERSEDED: the Finance Act, 2026 is no longer corroborated by secondary sources, " +
      "it is READ. Both halves were checked, in all three pdftotext modes, against the Income Tax " +
      "Department's own rank-1 publication. OLD REGIME — First Schedule Part I-A, Paragraph F, Table " +
      "1, Sl. No. 1: \"(i) Where the total income (including dividend income or capital gains under " +
      "the provisions of sections 111A, 112 and 112A of the said Act) exceeds Rs. 50,00,000 but does " +
      "not exceed Rs. 1,00,00,000, at the rate of 10 per cent.; (ii) ... exceeds Rs. 1,00,00,000 but " +
      "does not exceed Rs. 2,00,00,000, at the rate of 15 per cent.\", with (iii) 25 per cent. above " +
      "Rs. 2,00,00,000, (iv) 37 per cent. above Rs. 5,00,00,000, and (vi) the cap that \"the rate of " +
      "surcharge on the amount of income-tax computed in respect of that part of income shall not " +
      "exceed 15 per cent.\" NEW REGIME — section 2(4)(b) Table, Sl. No. 10 (income chargeable under " +
      "section 115BAC(1A)): the same 10 per cent. and 15 per cent. bands at the same boundaries, a " +
      "top tier of \"twenty-five per cent.\" above Rs. 2,00,00,000 with NO 37 per cent. band, and the " +
      "same 15 per cent. special-rate cap. EVERY DECLARED FIGURE IS UNCHANGED FROM THE FINANCE ACT, " +
      "2025 BASIS — the two declared bands, the 15% cap, the regime asymmetry above ₹2 crore, and " +
      "therefore the ₹2,00,00,000 implementation ceiling. NO COMPUTED VALUE MOVED when this citation " +
      "was added; had one moved, this session was required to stop and treat it as a D276 " +
      "version-bump event rather than change a rate inside a citation sweep. WHAT IS STILL NOT DONE: " +
      "citing is not verifying. This pack remains `draft`, the 25%/37% tiers and the binding 15% " +
      "proviso above ₹2 crore remain unimplemented, and a CA must still confirm the treatment. The " +
      "text was first read in an ITD publication (source rank 1) and is now read in the GAZETTE of " +
      "India itself (No. 4 of 2026; K4-CITE-01, D315).",
    verbatimQuotes: [
      {
        artifactId: "K4-PORT-04-S1",
        text: "twenty-five per cent.",
      },
      {
        artifactId: "K4-PORT-04-S1",
        text: "the rate of surcharge on the amount of income-tax computed in respect of that part of "
            + "income shall not exceed 15 per cent.",
      },
    ],
    unverifiableQuotes: [
      {
        text: "(a) having a total income (including the income by way of dividend or income under the "
            + "provisions of section 111A, section 112 and section 112A ...) exceeding fifty lakh "
            + "rupees but not exceeding one crore rupees, at the rate of ten per cent. of such "
            + "income-tax; (b) ... exceeding one crore rupees but not exceeding two crore rupees, at "
            + "the rate of fifteen per cent. of such income-tax",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
      {
        text: "Provided also that in respect of income chargeable to tax under sub-section (1A) of "
            + "section 115BAC ...",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
      {
        text: "(i) Where the total income (including dividend income or capital gains under the "
            + "provisions of sections 111A, 112 and 112A of the said Act) exceeds Rs. 50,00,000 but "
            + "does not exceed Rs. 1,00,00,000, at the rate of 10 per cent.; (ii) ... exceeds Rs. "
            + "1,00,00,000 but does not exceed Rs. 2,00,00,000, at the rate of 15 per cent.",
        reason: QUOTE_ELIDED,
      },
    ],
  }),
  makeRuleProvenance({
    ruleId: "surcharge_marginal_relief",
    summary:
      "Marginal relief at the ₹50,00,000 and ₹1,00,00,000 surcharge thresholds — income-tax plus " +
      "surcharge may not exceed the income-tax (and, at the ₹1,00,00,000 threshold, surcharge) on a " +
      "notional total income equal to the threshold, by more than the income exceeding it. Computed " +
      "EXACTLY where the notional reference income's composition is unambiguous, proved nil where it " +
      "is not, and REFUSED otherwise. The ₹2,00,00,000 and ₹5,00,00,000 tiers are NOT computed.",
    sources: [
      FINANCE_ACT_2026_FIRST_SCHEDULE_PART_I_A,
      FINANCE_ACT_2026_S2,
      FINANCE_ACT_2025_SURCHARGE,
    ],
    caveat:
      "**K4-SOURCE-02 (2026-08-15) CORRECTED THIS CAVEAT FORWARD — the correction is at the END.** " +
      "The Finance Act, 2026 has been read; it re-drafts this relief as an algebraic formula rather " +
      "than a proviso, and the arithmetic is unchanged. The original caveat follows unrewritten " +
      "(PROJECT_CONSTITUTION.md §4). — TODO(CA-verify): quoted VERBATIM from the Finance Act, 2025, First Schedule, Part III, " +
      "Paragraph A — \"Provided also that in the case of persons mentioned above having total income " +
      "exceeding,— (a) fifty lakh rupees but not exceeding one crore rupees, the total amount payable " +
      "as income-tax and surcharge on such income shall not exceed the total amount payable as " +
      "income-tax on a total income of fifty lakh rupees by more than the amount of income that " +
      "exceeds fifty lakh rupees; (b) one crore rupees but does not exceed two crore rupees, the " +
      "total amount payable as income-tax and surcharge on such income shall not exceed the total " +
      "amount payable as income-tax and surcharge on a total income of one crore rupees by more than " +
      "the amount of income that exceeds one crore rupees\" — note the deliberate asymmetry (the " +
      "₹50,00,000 reference carries NO surcharge term, the ₹1,00,00,000 reference does), which the " +
      "engine reproduces exactly. AN UNRESOLVED AMBIGUITY IS REFUSED RATHER THAN GUESSED: the statute " +
      "does not state how the notional reference total income is COMPOSED when the actual case mixes " +
      "slab income with special-rate 111A/112A gains, and reducing the slab part, the special-rate " +
      "part, or both proportionally give three different reliefs. No located source resolves it, so " +
      "such a case is computed only where relief is provably nil under every reading and is otherwise " +
      "reported gross of relief AND reliance-blocked. This rule does NOT cover marginal relief at the " +
      "Section 87A REBATE threshold, which is a separate relief and remains unimplemented. " +
      "— **THE K4-SOURCE-02 FORWARD CORRECTION.** The Finance Act, 2026 states this relief as a " +
      "FORMULA where the Finance Act, 2025 stated it as prose provisos, and that change of DRAFTING " +
      "is the thing to notice — the arithmetic it prescribes is the same. OLD REGIME — First Schedule " +
      "Part I-A, Paragraph F, after Table 1: \"Wo = Uo + Vo ... Wo = the total amount beyond which " +
      "the total amount payable as income-tax and surcharge thereon shall not exceed; Uo = the total " +
      "amount payable as income-tax and surcharge, IF APPLICABLE, on an amount as specified in column " +
      "C of the Table 2 below; and Vo = the total income - amount as specified in column C of the " +
      "said Table.\" Table 2, Sl. No. 1 gives the windows as column C -> column D: Rs. 50,00,000 -> " +
      "Rs. 1,00,00,000; Rs. 1,00,00,000 -> Rs. 2,00,00,000; Rs. 2,00,00,000 -> Rs. 5,00,00,000; Rs. " +
      "5,00,00,000 -> (no upper limit). NEW REGIME — section 2(5) states the identical formula as " +
      "\"To = Ro + So\" and its Table Sl. No. 6 gives Rs. 50,00,000 -> Rs. 1,00,00,000; Rs. " +
      "1,00,00,000 -> Rs. 2,00,00,000; Rs. 2,00,00,000 -> (no upper limit). The two windows this " +
      "engine implements (₹50,00,000 and ₹1,00,00,000) are the first two in both regimes and are " +
      "UNCHANGED, as are the ₹2,00,00,000 and ₹5,00,00,000 tiers it does not compute. NO COMPUTED " +
      "VALUE MOVED. **ONE POINT IS FLAGGED FOR THE CA RATHER THAN DECIDED, because it is a tax " +
      "question (§2 rule 5) and this session had no authority over it:** the engine reproduces the " +
      "Finance Act, 2025 asymmetry in which the ₹50,00,000 reference carries NO surcharge term while " +
      "the ₹1,00,00,000 reference does. The Finance Act, 2026 does not state that asymmetry " +
      "explicitly — it states \"income-tax and surcharge, IF APPLICABLE\" and leaves the reader to " +
      "resolve when surcharge is applicable at the reference amount. Under the STRICT-INEQUALITY " +
      "reading this pack already relies on and cites (surcharge attaches only where total income " +
      "EXCEEDS ₹50,00,000 — `surcharge_marginal_relief_safety_threshold`, D44/TAX-SAFE-01A), " +
      "\"if applicable\" yields no surcharge at exactly ₹50,00,000 and a 10% surcharge at exactly " +
      "₹1,00,00,000, which reproduces the 2025 asymmetry exactly and leaves the engine correct. That " +
      "reading is CONSISTENT with everything else this pack cites, but it is a reading, and it is " +
      "recorded here to be confirmed rather than presented as settled. The text was first read in " +
      "an ITD publication (source rank 1) and is now read in the GAZETTE of India itself (No. 4 of " +
      "2026; K4-CITE-01, D315), in all three pdftotext modes.",
    verbatimQuotes: [
      {
        artifactId: "K4-PORT-04-S1",
        text: "To = Ro + So",
      },
      {
        artifactId: "K4-PORT-04-S1",
        text: "if applicable",
      },
    ],
    unverifiableQuotes: [
      {
        text: "Provided also that in the case of persons mentioned above having total income "
            + "exceeding,— (a) fifty lakh rupees but not exceeding one crore rupees, the total amount "
            + "payable as income-tax and surcharge on such income shall not exceed the total amount "
            + "payable as income-tax on a total income of fifty lakh rupees by more than the amount "
            + "of income that exceeds fifty lakh rupees; (b) one crore rupees but does not exceed two "
            + "crore rupees, the total amount payable as income-tax and surcharge on such income "
            + "shall not exceed the total amount payable as income-tax and surcharge on a total "
            + "income of one crore rupees by more than the amount of income that exceeds one crore "
            + "rupees",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
      {
        text: "Wo = Uo + Vo ... Wo = the total amount beyond which the total amount payable as "
            + "income-tax and surcharge thereon shall not exceed; Uo = the total amount payable as "
            + "income-tax and surcharge, IF APPLICABLE, on an amount as specified in column C of the "
            + "Table 2 below; and Vo = the total income - amount as specified in column C of the said "
            + "Table.",
        reason: QUOTE_ELIDED,
      },
      {
        text: "income-tax and surcharge, IF APPLICABLE",
        reason: QUOTE_EMPHASIS_ADDED,
      },
    ],
  }),
  // K4-01: age-band FACT derivation only (senior/super-senior CLASSIFICATION).
  // The OLD-regime basic-exemption widening this classification drives is a
  // SEPARATE, later rule (`senior_super_senior_basic_exemption_widening`,
  // K4-02, below) — this entry only ever backed the age/residency threshold
  // itself. The senior 80D cap and 80TTB-vs-80TTA remain DEDUCTION_CAPS
  // placeholders (K4-03+). This entry exists so the age thresholds
  // `senior-treatment.ts`'s deriveTaxpayerAgeBand() applies (60, 80, "at any
  // time during the previous year", resident-only) are themselves a
  // versioned, cited pack rule rather than bare literals in application code.
  makeRuleProvenance({
    ruleId: "senior_super_senior_age_definition",
    summary:
      "Age (and residency) thresholds that classify a resident individual as a senior citizen " +
      "(60 years or more but less than 80 years) or super-senior citizen (80 years or more), " +
      "determined as of any time during the previous year. Used ONLY to derive a taxpayer's age " +
      "band and to drive the K4-01 reliance blocker/disclosure — no senior/super-senior slab, " +
      "80D cap, or 80TTB/80TTA amount is computed from it.",
    sources: [FINANCE_ACT_2025_FIRST_SCHEDULE_PART_III, ITD_SENIOR_CITIZEN_HELP_AY_2026_27],
    caveat:
      "TODO(CA-verify): sourced from the Finance Act, 2025 (First Schedule, Part III rate " +
      "paragraphs for resident individuals aged 60+/<80 and 80+) and directly retrieved from the " +
      "Income Tax Department's own AY 2026-27 guidance (incometax.gov.in, \"Senior Citizens and " +
      "Super Senior Citizens for AY 2026-2027\" help page, retrieved 2026-07-25), which states: " +
      "\"An individual resident who is 60 years or above in age but less than 80 years at any " +
      "time during the previous year\" (senior citizen) and \"a Super Senior Citizen is an " +
      "individual resident who is 80 years or above, at any time during the previous year\" " +
      "(super senior citizen) — both definitions require RESIDENT status; a non-resident is " +
      "never classified under this rule regardless of age. Re-confirm directly against the bare " +
      "Finance Act / First Schedule text before CA verification. The associated basic-exemption " +
      "widening (old regime), Section 80D senior limit, and Section 80TTB (senior) vs 80TTA are " +
      "NOT covered by this rule id — see " +
      "the k4-senior-treatment-specification design notes's later-computation dossier for " +
      "their own separate sourcing.",
    unverifiableQuotes: [
      {
        text: "Senior Citizens and Super Senior Citizens for AY 2026-2027",
        reason: QUOTE_NOT_STATUTORY_TEXT,
      },
      {
        text: "An individual resident who is 60 years or above in age but less than 80 years at any "
            + "time during the previous year",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
      {
        text: "a Super Senior Citizen is an individual resident who is 80 years or above, at any time "
            + "during the previous year",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
    ],
  }),
  // K4-02: the FIRST later-computation dossier item (spec §10.1) actually
  // implemented — the OLD-regime basic-exemption WIDENING itself (slabs.ts
  // `OLD_REGIME_SENIOR_SLABS` / `OLD_REGIME_SUPER_SENIOR_SLABS`). Distinct
  // from `senior_super_senior_age_definition` above, which backs only the
  // age/residency CLASSIFICATION — this rule backs the actual rupee widening
  // applied once that classification is known. Section 80D senior cap and
  // 80TTB-vs-80TTA (spec §10.2/§10.3) remain NOT implemented and are not
  // covered by this rule id.
  makeRuleProvenance({
    ruleId: "senior_super_senior_basic_exemption_widening",
    summary:
      "OLD-regime basic-exemption widening for a resident senior citizen (₹3,00,000, vs " +
      "₹2,50,000 below 60) or super-senior citizen (₹5,00,000). The 5%/20%/30% slab rates and " +
      "the ₹5,00,000/₹10,00,000 upper boundaries are UNCHANGED from the below-60 table — only " +
      "the nil-rate threshold widens. NEW-regime slabs are age-neutral and are never affected by " +
      "this rule. Applies only when the taxpayer is RESIDENT (matches " +
      "`senior_super_senior_age_definition`'s own residency requirement) and the OLD regime is " +
      "the one being computed.",
    sources: [FINANCE_ACT_2025_FIRST_SCHEDULE_PART_III, ITD_SENIOR_CITIZEN_HELP_AY_2026_27],
    caveat:
      "TODO(CA-verify): sourced from the same two references as " +
      "`senior_super_senior_age_definition` — the Finance Act, 2025 (First Schedule, Part III " +
      "rate paragraphs for resident individuals aged 60+/<80 and 80+) and the Income Tax " +
      "Department's own AY 2026-27 guidance (incometax.gov.in, \"Senior Citizens and Super " +
      "Senior Citizens for AY 2026-2027\" help page), which states the OLD-regime basic " +
      "exemption is \"Up to ₹3,00,000\" for a senior citizen and \"Up to ₹5,00,000\" for a super " +
      "senior citizen — directly re-retrieved and re-confirmed for K4-02 (2026-07-25), " +
      "corroborated by an independent secondary tax-law publisher (ClearTax, \"Income Tax Slab " +
      "for Senior Citizens FY 2025-26\", retrieved 2026-07-25), which reproduces the identical " +
      "₹3,00,000/₹5,00,000 thresholds and the identical unchanged 5%/20%/30% bands above them, " +
      "and states explicitly that \"the new tax regime... does not offer any higher basic " +
      "exemption limit to senior and super senior citizens like the old tax regime\" — confirming " +
      "the widening is OLD-regime-only. Re-confirm directly against the bare Finance Act / First " +
      "Schedule text before CA verification. Section 80D senior-citizen cap (₹50,000) and Section " +
      "80TTB (senior) vs 80TTA are NOT covered by this rule id and remain DEDUCTION_CAPS " +
      "placeholders — see the k4-senior-treatment-specification design notes §10.2/§10.3.",
    unverifiableQuotes: [
      {
        text: "Senior Citizens and Super Senior Citizens for AY 2026-2027",
        reason: QUOTE_NOT_STATUTORY_TEXT,
      },
      {
        text: "Up to ₹3,00,000",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
      {
        text: "Up to ₹5,00,000",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
      {
        text: "Income Tax Slab for Senior Citizens FY 2025-26",
        reason: QUOTE_NOT_STATUTORY_TEXT,
      },
      {
        text: "the new tax regime... does not offer any higher basic exemption limit to senior and "
            + "super senior citizens like the old tax regime",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
    ],
  }),
  // K4-03: spec §10.2 — the Section 80D senior-citizen cap. Distinct from
  // `senior_super_senior_age_definition` (age/residency classification) and
  // `senior_super_senior_basic_exemption_widening` (the OLD-regime slab
  // widening) — this rule backs ONLY the Chapter VI-A 80D cap correction.
  makeRuleProvenance({
    ruleId: "senior_80d_deduction_cap",
    summary:
      "Section 80D health-insurance-premium deduction cap widens from ₹25,000 to ₹50,000 when the " +
      "TAXPAYER (not a relative) is a resident senior/super-senior citizen. Applies to the " +
      "taxpayer's own age band only, for the self/family ledger bucket — see the separate " +
      "`senior_80d_parents_deduction_cap` rule (K4-05) for the INDEPENDENT parents-bucket cap, " +
      "summed with — never merged into — this rule's own cap. NOT covered by this rule: whether " +
      "the self/family bucket should ALSO widen when a SPOUSE (not the taxpayer) is senior — see " +
      "`senior_80d_parents_deduction_cap`'s own caveat for that residual scope note.",
    sources: [S80D, ITD_SENIOR_CITIZEN_HELP_AY_2026_27, CBDT_ITR2_VALIDATION_RULES_AY_2026_27],
    caveat:
      "TODO(CA-verify): sourced from the Income Tax Department's own AY 2026-27 guidance " +
      "(incometax.gov.in, \"Senior Citizens and Super Senior Citizens for AY 2026-2027\" help page, " +
      "directly retrieved 2026-07-25), which states the 80D limit is \"₹25,000\" for self/spouse/" +
      "dependent children but \"₹50,000 if any person is a Senior Citizen\" (same figure for parents), " +
      "corroborated by directly retrieving the Central Board of Direct Taxes' own \"ITR 2 – " +
      "Validation Rules for AY 2026-27\" (Version 1.0, incometax.gov.in, retrieved 2026-07-25), " +
      "whose rule #300/#301 caps the senior-citizen 80D figure at ₹50,000 per bucket (self/family; " +
      "parents) with a combined ceiling of ₹1,00,000 when both self/family AND parents are senior — " +
      "confirming the Act treats \"self/family\" and \"parents\" as SEPARATE caps. " +
      "Also corroborated by an independent secondary tax-law publisher (search aggregation of " +
      "multiple established tax-law publishers including ClearTax/TataAIG/HDFC Life, retrieved " +
      "2026-07-25) reproducing the identical ₹25,000/₹50,000 figures. Re-confirm directly against " +
      "the bare Section 80D text before CA verification. The preventive-health-checkup ₹5,000 sub-" +
      "limit and the ₹50,000 no-premium medical-expenditure clause (uninsured senior) are NOT " +
      "covered by this rule id either — see " +
      "the k4-senior-treatment-specification design notes §10.2.",
    unverifiableQuotes: [
      {
        text: "Senior Citizens and Super Senior Citizens for AY 2026-2027",
        reason: QUOTE_NOT_STATUTORY_TEXT,
      },
      {
        text: "₹25,000",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
      {
        text: "₹50,000 if any person is a Senior Citizen",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
      {
        text: "ITR 2 – Validation Rules for AY 2026-27",
        reason: QUOTE_NOT_STATUTORY_TEXT,
      },
      {
        text: "self/family",
        reason: QUOTE_NOT_STATUTORY_TEXT,
      },
      {
        text: "parents",
        reason: QUOTE_NOT_STATUTORY_TEXT,
      },
    ],
  }),
  // K4-05: spec §10.2's residual gap — the Section 80D "insured party"
  // distinction for a premium paid on behalf of a PARENT. Independent from
  // `senior_80d_deduction_cap` (self/family bucket) — its own ₹25,000/
  // ₹50,000 cap, driven by the PARENT's own senior status (never the
  // taxpayer's), summed with — never merged into — the self/family bucket's
  // cap. Re-sourced directly this session (not trusted from K4-03's prior
  // retrieval) — see the caveat below.
  makeRuleProvenance({
    ruleId: "senior_80d_parents_deduction_cap",
    summary:
      "Section 80D health-insurance-premium deduction for a PARENT's premium (paid by a taxpayer of " +
      "ANY age) is capped at ₹25,000, widening to ₹50,000 when the INSURED PARENT (not the " +
      "taxpayer) is a senior/super-senior citizen. This is a SEPARATE ₹25,000/₹50,000 cap from the " +
      "self/family bucket (`senior_80d_deduction_cap`) — the two are summed, giving a combined " +
      "ceiling of ₹1,00,000 when both buckets are senior, never a single shared cap. Applied only " +
      "when the taxpayer is resident and the OLD regime is being computed (mirrors every other " +
      "senior-aware Chapter VI-A rule in this pack); a NULL/false confirmed-senior flag on every " +
      "parents-bucket ledger row is treated conservatively as the flat ₹25,000 cap, never inferred " +
      "senior.",
    sources: [S80D, ITD_SENIOR_CITIZEN_HELP_AY_2026_27, CBDT_ITR2_VALIDATION_RULES_AY_2026_27],
    caveat:
      "TODO(CA-verify): independently RE-retrieved this session (2026-07-26, not trusted from " +
      "K4-03's prior citation) — the Income Tax Department's own AY 2026-27 guidance " +
      "(incometax.gov.in, \"Senior Citizens and Super Senior Citizens for AY 2026-2027\" help page), " +
      "which states verbatim, as a distinct table row: \"For Parents: ₹25,000 (₹50,000 if any " +
      "person is a Senior Citizen)\" — independent of the self/family row and independent of the " +
      "taxpayer's own age. Corroborated by re-retrieving the Central Board of Direct Taxes' own " +
      "\"ITR 2 – Validation Rules for AY 2026-27\" (Version 1.0, incometax.gov.in) again this " +
      "session, whose Schedule 80D rules distinguish Serial No. 1b (Self and Family — Senior " +
      "Citizen, ₹50,000) from Serial No. 2b (Parents — Senior Citizen, ₹50,000) as separate line " +
      "items, confirming the two buckets are independently capped, not merged. Re-confirm directly " +
      "against the bare Section 80D text before CA verification. NOT covered by this rule: the " +
      "preventive-health-checkup ₹5,000 sub-limit, the ₹50,000 no-premium medical-expenditure " +
      "clause (uninsured senior parent), and whether the self/family bucket should ALSO widen for " +
      "a senior SPOUSE (a genuinely separate, still-open gap affecting a DIFFERENT, never-blocked " +
      "population — see `rules.ts`'s `DEDUCTION_CAPS` module doc). See " +
      "the k4-senior-treatment-specification design notes §10.2.",
    unverifiableQuotes: [
      {
        text: "Senior Citizens and Super Senior Citizens for AY 2026-2027",
        reason: QUOTE_NOT_STATUTORY_TEXT,
      },
      {
        text: "For Parents: ₹25,000 (₹50,000 if any person is a Senior Citizen)",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
      {
        text: "ITR 2 – Validation Rules for AY 2026-27",
        reason: QUOTE_NOT_STATUTORY_TEXT,
      },
    ],
  }),
  // K4-03: spec §10.3 — Section 80TTA / 80TTB mutual exclusivity by age. Also
  // closes the SECOND, distinct silent-exclusion-shaped finding the K4-02
  // dossier flagged but did not fix (a below-60 taxpayer's "80TTB" ledger row
  // was previously accepted at the full ₹50,000 senior cap regardless of
  // actual entitlement) — see `deductionCapForSection` in `rules.ts`.
  makeRuleProvenance({
    ruleId: "senior_80tta_80ttb_mutual_exclusivity",
    summary:
      "Section 80TTA (₹10,000, savings-account interest only) and Section 80TTB (₹50,000, ALL " +
      "deposit interest — savings + FD/RD — resident senior/super-senior citizen only) are " +
      "MUTUALLY EXCLUSIVE, never additive. A ledger row tagged with the section that does NOT " +
      "match the taxpayer's own age band receives a ZERO cap for that section — never silently " +
      "granted the other section's cap.",
    sources: [S80TTA, S80TTB, CBDT_ITR2_VALIDATION_RULES_AY_2026_27],
    caveat:
      "TODO(CA-verify): directly retrieved the Central Board of Direct Taxes' own \"ITR 2 – " +
      "Validation Rules for AY 2026-27\" (Version 1.0, incometax.gov.in, retrieved 2026-07-25), " +
      "whose rule #322 states verbatim: \"If Old Tax regime is selected, deduction u/s 80TTA cannot " +
      "be claimed by a Resident Senior Citizen person\" (confirming mutual exclusivity from the " +
      "80TTA side), rule #343 states \"Deduction u/s 80TTA should be restricted to interest income " +
      "from Savings Account under Income from other sources\" (savings-account interest ONLY), rule " +
      "#344 states a resident-senior-citizen 80TTB claim \"should be restricted to interest income " +
      "(Savings & Deposits) from other sources\" (broader — ALL deposit interest), and rule #349 " +
      "states \"Non resident individuals cannot claim deduction u/s 80TTB\" (resident-only). " +
      "Corroborated by an independent secondary tax-law publisher (ClearTax, \"Section 80TTB " +
      "Deduction for Senior Citizens\", retrieved 2026-07-25), which states plainly that \"Senior " +
      "citizens cannot avail section 80TTA and 80TTB together in their ITR.\" Re-confirm directly " +
      "against the bare Section 80TTA / 80TTB text before CA verification. TaxDesk OS's ledger lets " +
      "staff choose the section explicitly per row rather than deriving it automatically from the " +
      "underlying interest-income type — this rule corrects the CAP once a section is chosen, but " +
      "does not itself re-derive which section SHOULD have been chosen; see " +
      "the k4-senior-treatment-specification design notes §10.3.",
    unverifiableQuotes: [
      {
        text: "ITR 2 – Validation Rules for AY 2026-27",
        reason: QUOTE_NOT_STATUTORY_TEXT,
      },
      {
        text: "If Old Tax regime is selected, deduction u/s 80TTA cannot be claimed by a Resident "
            + "Senior Citizen person",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
      {
        text: "Deduction u/s 80TTA should be restricted to interest income from Savings Account under "
            + "Income from other sources",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
      {
        text: "should be restricted to interest income (Savings & Deposits) from other sources",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
      {
        text: "Non resident individuals cannot claim deduction u/s 80TTB",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
      {
        text: "Section 80TTB Deduction for Senior Citizens",
        reason: QUOTE_NOT_STATUTORY_TEXT,
      },
      {
        text: "Senior citizens cannot avail section 80TTA and 80TTB together in their ITR.",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
    ],
  }),
  // K4-04: spec §10.4 — Section 207(2) advance-tax exemption. VALIDATION-only:
  // no ComputedValue is ever tagged with this rule id (it drives an
  // informational validate-case.ts finding, never a computed liability/
  // refund figure) — see `NON_COMPUTED_VALUE_PACK_RULE_IDS` in
  // coverage-report.ts (renamed from SAFETY_ONLY_PACK_RULE_IDS in K4-04),
  // which excludes it from the fixture-trace requirement for exactly that
  // reason.
  makeRuleProvenance({
    ruleId: "senior_citizen_advance_tax_exemption_207_2",
    summary:
      "A resident individual who is 60 years of age or more at any time during the previous year, " +
      "and who has no income chargeable under the head 'Profits and gains of business or " +
      "profession', is not liable to pay advance tax under Section 207(2) — such a taxpayer faces " +
      "no interest under Sections 234B/234C for having settled the liability via self-assessment " +
      "tax instead. Used ONLY to drive a validate-case.ts disclosure finding when tax is payable; " +
      "no liability/refund figure, interest amount, or advance-tax adequacy computation is derived " +
      "from it — TaxDesk OS computes no 234B/234C interest for ANY taxpayer.",
    sources: [S207, ITD_SENIOR_CITIZEN_HELP_AY_2026_27],
    caveat:
      "TODO(CA-verify): directly retrieved the Income Tax Department's own AY 2026-27 guidance " +
      "(incometax.gov.in, \"Senior Citizens and Super Senior Citizens for AY 2026-2027\" help page, " +
      "re-retrieved 2026-07-26), which states verbatim: \"Section 207, Income Tax Act, 1961 gives " +
      "relief from payment of Advance Tax to a Resident Senior Citizen\" — the same page K4-01/K4-02/" +
      "K4-03 already used for the age/residency and basic-exemption/deduction-cap rules, re-confirmed " +
      "rather than assumed to transfer. Corroborated by independent secondary tax-law publishers " +
      "(TaxGuru, \"Senior Citizens not having Business Income Exempt from Advance tax Payment\"; " +
      "Bajaj Finserv Markets, \"Section 207: Advance Tax Exemption for Senior Citizens\"; Bankbazaar, " +
      "\"Advance Tax Exemption for Senior Citizen\" — all retrieved 2026-07-26), which state the same " +
      "three conditions: resident, 60 years or more at any time during the relevant financial year, " +
      "and no income chargeable under 'Profits and gains of business or profession'. The exemption is " +
      "unconditional on the AMOUNT of non-business income (rental, pension, interest, dividend, " +
      "capital gains, etc. do not disqualify it) and applies at both regimes (advance-tax liability is " +
      "a payment-timing concept, not a slab/deduction concept). Not covered by this rule id: any " +
      "234B/234C interest computation (TaxDesk OS computes none, for any taxpayer — this rule only " +
      "explains an ALREADY-absent computation for the senior/super-senior case, it does not newly " +
      "withhold or compute anything); the exact FY the sub-section was inserted (Finance Bill 2012, " +
      "per TaxGuru — not independently verified against the amending Finance Act text). Re-confirm " +
      "directly against the bare Section 207 text before CA verification. See " +
      "the k4-senior-treatment-specification design notes §10.4.",
    unverifiableQuotes: [
      {
        text: "Senior Citizens and Super Senior Citizens for AY 2026-2027",
        reason: QUOTE_NOT_STATUTORY_TEXT,
      },
      {
        text: "Section 207, Income Tax Act, 1961 gives relief from payment of Advance Tax to a "
            + "Resident Senior Citizen",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
      {
        text: "Senior Citizens not having Business Income Exempt from Advance tax Payment",
        reason: QUOTE_NOT_STATUTORY_TEXT,
      },
      {
        text: "Section 207: Advance Tax Exemption for Senior Citizens",
        reason: QUOTE_NOT_STATUTORY_TEXT,
      },
      {
        text: "Advance Tax Exemption for Senior Citizen",
        reason: QUOTE_NOT_STATUTORY_TEXT,
      },
    ],
  }),
  // K4-06: Wave-4 priority #2 — house property (Sections 22-27, 71(3A)).
  // Bundles GAV/NAV derivation, the flat 30% standard deduction, the
  // regime/usage-aware Section 24(b) interest cap, and the Section 71(3A)/
  // 115BAC loss-set-off rule into ONE rule id (mirrors how
  // `chapter_via_deduction_caps` already bundles several caps) — session
  // scope is a SINGLE property per case; co-ownership and multiple-property
  // loss-set-off interaction are NOT covered (Wave-4 priority #5).
  makeRuleProvenance({
    ruleId: "house_property_computation",
    summary:
      "Income from house property (Sections 22-24, 27): Gross Annual Value (actual rent received for " +
      "a let-out property, deemed nil for self-occupied) less municipal taxes actually paid gives Net " +
      "Annual Value; a flat 30% standard deduction (Section 24(a)) applies to NAV in both regimes; " +
      "Section 24(b) home-loan interest is uncapped for a let-out property in both regimes, capped at " +
      "₹2,00,000 for a self-occupied property under the OLD regime only, and DISALLOWED entirely for a " +
      "self-occupied property under the NEW regime (Section 115BAC). A resulting LOSS may be set off " +
      "against other heads up to ₹2,00,000/year under the OLD regime (Section 71(3A), excess not " +
      "carried forward by this engine); the NEW regime disallows any cross-head set-off of a " +
      "house-property loss at all (Section 115BAC).",
    sources: [S22_24_HOUSE_PROPERTY, S71_3A, S115BAC],
    caveat:
      "TODO(CA-verify): sourced 2026-07-26 primarily from ClearTax's \"Income from House Property and " +
      "Taxes\" (cleartax.in/s/house-property, directly retrieved and quoted verbatim in rules.ts's " +
      "HOUSE_PROPERTY module doc), corroborated by an independent secondary-publisher search " +
      "aggregation (HomeFirstIndia, Policybazaar, TaxGarden, ManipalCigna, CallMyCA, Upstox, " +
      "SmartTaxCalc — all retrieved 2026-07-26) reproducing the identical 30%/₹2,00,000/no-cap/" +
      "regime-split figures. The official incometaxindia.gov.in Schedule-HP page returned HTTP 403 to " +
      "a direct fetch this session — an attempted-but-blocked source, not a substitute for it. NOT " +
      "covered by this rule: co-ownership apportionment; multiple-property loss-set-off interaction " +
      "and carry-forward tracking beyond the current year (Wave-4 priority #5); the fair-rent/" +
      "municipal-value/standard-rent comparison that can raise GAV above actual rent received (actual " +
      "rent received is used directly); and the \"up to two self-occupied properties\" nil-annual-value " +
      "widening (Budget 2025, confirmed current for AY 2026-27 but this session scopes to ONE " +
      "property). Re-confirm directly against the bare Section 22-27 / 71(3A) text before CA " +
      "verification. See the k4-common-case-coverage-and-priorities design notes row #2 and the " +
      "`K4-06` decision-log entry (D80).",
    unverifiableQuotes: [
      {
        text: "Income from House Property and Taxes",
        reason: QUOTE_NOT_STATUTORY_TEXT,
      },
      {
        text: "up to two self-occupied properties",
        reason: QUOTE_NOT_STATUTORY_TEXT,
      },
    ],
  }),
  // K4-07: Wave-4 priority #3 — presumptive professional income (Section
  // 44ADA). Deemed profit only; the books-of-account fallback (actual
  // profit declared below the deemed 50%) and Section 44AB tax-audit
  // trigger detection are NOT covered by this rule.
  makeRuleProvenance({
    ruleId: "presumptive_44ada_computation",
    summary:
      "Presumptive professional income under Section 44ADA: deemed profit of 50% of declared gross " +
      "professional receipts, for a resident individual/HUF/partnership firm (excluding LLP) in a " +
      "Section 44AA(1)-specified profession (legal, medical, engineering, architecture, accountancy, " +
      "technical consultancy, interior decoration, company secretary, or information technology). No " +
      "separate expense/depreciation deduction is claimed on top (Sections 28-43C disallowed). " +
      "Eligibility ceiling: Rs.50,00,000 gross receipts, widening to Rs.75,00,000 when cash receipts " +
      "do not exceed 5% of the total (aggregated across every declared presumptive-44ADA row for the " +
      "case) — a taxpayer above the applicable ceiling is excluded entirely, never partially " +
      "computed. Multiple presumptive-44ADA sources per case ARE in scope (a simple linear sum, " +
      "unlike house property's genuinely per-property regime-dependent nuance).",
    sources: [S44ADA, S44AA, ITD_ITR4_APPLICABILITY],
    caveat:
      "TODO(CA-verify): sourced 2026-07-26 primarily from ClearTax's Section 44ADA presumptive-tax " +
      "guide (cleartax.in/s/section-44ada, directly retrieved), which states verbatim: profit " +
      "\"is presumed at 50% of the gross receipts\"; the normal ceiling is \"Rs. 50 lakhs\", widening " +
      "to \"Rs. 75 lakhs\" when \"cash receipts don't exceed 5% of total gross receipts\"; " +
      "\"Deductions under sections 28 to 43C related to business income are not allowed under this " +
      "section\"; a taxpayer declaring below 50% \"must maintain books of accounts and get accounts " +
      "audited under section 44AB\" once total income exceeds the basic exemption; and eligible " +
      "taxpayers \"file return in the ITR-4 form (Sugam)\". Corroborated by an independent secondary-" +
      "publisher search aggregation (CAClubIndia, TaxGuru, Skydo, TaxGarden, Manipal Cigna, Finnovate " +
      "— all retrieved 2026-07-26) reproducing the identical 50%/Rs.50L/Rs.75L/5%-cash figures, and " +
      "by a direct fetch of TaxGuru's \"Professionals eligible to opt Section 44ADA\" confirming the " +
      "nine Section 44AA(1)-specified professions (including company secretary, CBDT Notification " +
      "S.O. 2675 dated 25.09.1992, and information technology, CBDT-notified 2001). " +
      "incometaxindia.gov.in's presumptive-taxation FAQ page returned HTTP 403 to a direct fetch this " +
      "session (recorded, not silently substituted — the same host K4-06 also found blocked); " +
      "incometax.gov.in (a different, reachable ITD host) directly confirms ITR-4 (Sugam) " +
      "applicability for presumptive-basis income under Sections 44AD/44ADA/44AE. A single, " +
      "uncorroborated search-result snippet suggested a \"Rs.37.5 lakh\" figure for a cash-heavy " +
      "case — this is NOT relied on anywhere (contradicted by every directly-fetched primary source " +
      "above); only the Rs.50L/Rs.75L ceilings are implemented. NOT covered by this rule: the books-" +
      "of-account fallback path (a taxpayer declaring actual profit BELOW the deemed 50%, which this " +
      "ledger shape has no field to even represent) and Section 44AB tax-audit trigger detection — " +
      "both explicitly out of K4-07's scope per k4-common-case-coverage-and-priorities.md item #3. " +
      "K4-13 (2026-08-09, decision D217) added the eligible-ACTIVITY test: Section 44ADA(1) reaches only " +
      "a profession referred to in Section 44AA(1) — the mirror image of Section 44AD(6)(i) — so a " +
      "declared non-profession activity, and an UNDECLARED activity, are both refused entirely rather " +
      "than presumed eligible. Which of the nine Section 44AA(1) professions applies is deliberately " +
      "NOT recorded: both presumptive gates need only the coarse yes/no, and Rule 6F book-keeping and " +
      "ITR-4 nature-of-business codes, which would need the finer identity, are not implemented. " +
      "TAX-SAFE-03 preserves that coarse activity plus the banking-channel fact and eligible verdict " +
      "in each new immutable snapshot and rechecks them against live rows at every reliance boundary. " +
      "Re-confirm directly against the bare Section 44ADA text before CA verification.",
    unverifiableQuotes: [
      {
        text: "is presumed at 50% of the gross receipts",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
      {
        text: "Rs. 50 lakhs",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
      {
        text: "Rs. 75 lakhs",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
      {
        text: "cash receipts don't exceed 5% of total gross receipts",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
      {
        text: "Deductions under sections 28 to 43C related to business income are not allowed under "
            + "this section",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
      {
        text: "must maintain books of accounts and get accounts audited under section 44AB",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
      {
        text: "file return in the ITR-4 form (Sugam)",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
      {
        text: "Professionals eligible to opt Section 44ADA",
        reason: QUOTE_NOT_STATUTORY_TEXT,
      },
      {
        text: "Rs.37.5 lakh",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
    ],
  }),
  makeRuleProvenance({
    ruleId: "presumptive_44ad_computation",
    summary:
      "Presumptive business income under Section 44AD: deemed profit of 6% of the portion of turnover " +
      "received through banking / prescribed electronic modes PLUS 8% of the remaining (cash) portion — " +
      "two rates applied to two portions, unlike Section 44ADA's single rate on the whole. For a " +
      "resident individual/HUF/partnership firm (excluding LLP) carrying on an eligible business. No " +
      "separate expense/depreciation deduction is claimed on top (Sections 28-43C deemed already " +
      "allowed). Eligibility ceiling: Rs.2,00,00,000 aggregate turnover, widening to Rs.3,00,00,000 " +
      "when cash receipts do not exceed 5% of the total — a share DERIVED from the two declared " +
      "portions rather than asserted by staff. Aggregated across every declared 44AD row for the case; " +
      "a case above the applicable ceiling is excluded entirely, never partially computed.",
    sources: [S44AD, ITR_RULES_1962_R6ABBA, ITD_ITR4_APPLICABILITY],
    caveat:
      "TODO(CA-verify): sourced 2026-07-31 primarily from ClearTax's \"Section 44AD - Presumptive " +
      "Scheme for Businesses\" (cleartax.in/s/section-44ad-presumptive-scheme, directly retrieved), " +
      "which states verbatim: \"To the extent receipts are received in prescribed electronic modes, 6% " +
      "profit can be disclosed. For the rest, 8% profit can be disclosed as income. Dual percentages " +
      "of profits can be claimed in ITR-4.\", and that the Rs.2 crore ceiling rises to Rs.3 crore when " +
      "\"cash receipts do not exceed 5% of the total receipts and cash payments do not exceed 5% of " +
      "the total payments\". Corroborated by two further directly-fetched independent publishers " +
      "(Tally Solutions; Treelife — both retrieved 2026-07-31) reproducing the identical 6%/8% and " +
      "Rs.2cr/Rs.3cr figures, the 5%-cash-receipts condition, the Finance Act 2023 / AY 2024-25 " +
      "effective date of the enhanced ceiling, the resident individual/HUF/non-LLP-firm eligible-" +
      "assessee set, and the disallowance of any further expense deduction. incometaxindia.gov.in " +
      "returned HTTP 403 to a direct fetch this session (recorded, not silently substituted — the " +
      "same host K4-06 and K4-07 both found blocked); incometax.gov.in (a different, reachable ITD " +
      "host) directly confirms ITR-4 (Sugam) applicability for presumptive-basis income. The eligible-" +
      "ACTIVITY test IS covered as of K4-13 (2026-08-09, decision D217): every presumptive row declares " +
      "the activity its turnover arises from, and Section 44AD(6)'s three limbs (a Section 44AA(1) " +
      "profession, commission or brokerage, agency business) plus the goods-carriage business the " +
      "Explanation to Section 44AD excludes from \"eligible business\" are each refused entirely, as is " +
      "an UNDECLARED activity — which fails closed rather than being presumed eligible. K4-13 also " +
      "corrected an attribution error carried by this programme's own records: the Section 44AE " +
      "carve-out sits in the \"eligible business\" DEFINITION, not in sub-section (6), confirmed by two " +
      "directly-fetched sources (ClearTax's \"Section 44AD(6) - Non-applicability\" page and Indian " +
      "Kanoon's reproduction of the bare section, both retrieved 2026-08-09; indiacode.nic.in returned " +
      "HTTP 403, recorded rather than silently substituted, and Indian Kanoon's copy is an OLDER " +
      "version carrying a Rs.40 lakh threshold so it was relied on for structure only and for no " +
      "figure). TAX-SAFE-03 preserves the exact per-row activity and eligible verdict in each new " +
      "immutable snapshot and rechecks them against live rows at every reliance boundary. " +
      "THE PRESCRIBED ELECTRONIC MODES NOW HAVE A STATUTORY SOURCE, WHICH THEY DID NOT WHEN THIS " +
      "SPLIT SHIPPED (K4-24 Phase 0). Rule 6ABBA of the Income-tax Rules, 1962 states that \"The " +
      "following shall be the other electronic modes for the purposes of\" a list of provisions " +
      "that expressly includes the \"proviso to sub-section (1) of section 44AD\", and prescribes " +
      "them as \"(a) Credit Card; (b) Debit Card;\" and Net Banking, IMPS, UPI, RTGS, NEFT and BHIM " +
      "Aadhaar Pay. Until now the 6%-portion element rested on secondary publishers alone for a " +
      "point that has an instrument. TWO LIMITS ON WHAT THAT CITATION BUYS, stated rather than " +
      "left to be assumed: the rule is read in a rank-2 DEPARTMENTAL CONSOLIDATION and not the " +
      "notifying Gazette; and this product captures the digital and cash PORTIONS as declared " +
      "amounts, so nothing here verifies that a receipt actually arrived through one of the eight " +
      "listed modes — the rule tells you what qualifies, never that a given rupee qualified. " +
      "NOT covered " +
      "by this rule, each an explicit limitation rather than an assumption: the eligible-ASSESSEE limbs " +
      "of the same Explanation (resident individual / HUF / firm but not an LLP, and no Section 10A / " +
      "10AA / 10B / 10BA or Chapter VI-A Part C deduction), which are properties of the person rather " +
      "than the activity and which no captured data can verify; per-BUSINESS turnover ceilings (the " +
      "declared activity records a type, not a business identity, so turnover stays conservatively " +
      "aggregated across businesses); the " +
      "Section 44AD(4)/(5) five-year lock-in and its consequent Section 44AB audit trigger (no multi-" +
      "year state exists in this product); the cash-PAYMENTS leg of the enhanced-ceiling condition, " +
      "which no captured data can verify (disclosed as a blocker finding whenever the enhanced " +
      "ceiling is load-bearing — decision D91); and declaring a profit higher or lower than the deemed " +
      "percentage. Re-confirm directly against the bare Section 44AD text before CA verification.",
    verbatimQuotes: [
      // K4-24 Phase 0 — the first checked statutory quotation this rule has
      // ever carried. All three declarations are checked against the committed
      // page-74 extract of `K4-SOURCE-07-RULES-1962`; the third is the one that
      // matters, because it is the express link between rule 6ABBA and the
      // section this rule computes.
      {
        artifactId: "K4-SOURCE-07-RULES-1962",
        text: "The following shall be the other electronic modes for the purposes of",
      },
      {
        artifactId: "K4-SOURCE-07-RULES-1962",
        text: "proviso to sub-section (1) of section 44AD",
      },
      {
        artifactId: "K4-SOURCE-07-RULES-1962",
        text: "(a) Credit Card; (b) Debit Card;",
      },
    ],
    unverifiableQuotes: [
      {
        text: "Section 44AD - Presumptive Scheme for Businesses",
        reason: QUOTE_NOT_STATUTORY_TEXT,
      },
      {
        text: "To the extent receipts are received in prescribed electronic modes, 6% profit can be "
            + "disclosed. For the rest, 8% profit can be disclosed as income. Dual percentages of "
            + "profits can be claimed in ITR-4.",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
      {
        text: "cash receipts do not exceed 5% of the total receipts and cash payments do not exceed "
            + "5% of the total payments",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
      {
        text: "eligible business",
        reason: QUOTE_NOT_STATUTORY_TEXT,
      },
      {
        text: "Section 44AD(6) - Non-applicability",
        reason: QUOTE_NOT_STATUTORY_TEXT,
      },
    ],
  }),
  // K4-14: Wave-4 priority #6, FIRST slice — a books-based net profit ONLY,
  // and only where the preparer has declared that no Sections 30-43D
  // adjustment arises. Everything else in the head is refused, not estimated.
  // Extended by K4-15 (aggregation across undertakings), K4-17 (the ordinary
  // Section 70(1) intra-head pool) and K4-18 (affirmed exchange-traded F&O into
  // that pool, on a PREPARER-DECLARED Section 44AB turnover — D286/D287).
  // AUDIT-10-F1: this text is RENDERED to preparers by `pack-traceability.tsx`
  // on Computation and Validation, and went four sessions describing behaviour
  // the engine no longer had. `provenance.test.ts` now pins it to the activity
  // vocabulary — if you change what computes, that guard sends you back here.
  makeRuleProvenance({
    ruleId: "business_books_computation",
    summary:
      "Books-based business or professional income under Sections 28 and 29: taxable income is taken as " +
      "declared revenue/turnover MINUS declared expenses, AGGREGATED across every business or profession " +
      "carried on in the year (K4-15; K4-14 admitted only one per case). K4-17 applies Section 70(1) " +
      "current-year intra-head set-off when negative books sources are fully absorbed by positive books " +
      "sources and the whole head remains zero or positive, after every row affirmatively declares a " +
      "classification admitted to that pool. K4-18 admitted a SECOND such classification: exchange-traded " +
      "derivatives the preparer affirms are eligible transactions under Explanation 1 to Section 43(5) " +
      "proviso (d) are NOT speculative and COMPUTE inside that same ordinary Section 70(1) pool. The rest of " +
      "the derivative and speculation space still REFUSES, and each refusal holds back the WHOLE head: " +
      "derivative activity the preparer does not affirm as eligible (the honest answer when that affirmation " +
      "cannot be made for every transaction, which falls back to the main limb of Section 43(5) because " +
      "proviso (d) is conditional); intraday equity squared off without delivery; and the Sections 73/73A " +
      "restricted pools, which this engine does not implement. " +
      "Section 28 charges \"the profits and gains of any business or profession which was carried on by " +
      "the assessee at any time during the previous year\"; Section 29 provides that income referred to " +
      "in Section 28 \"shall be computed in accordance with the provisions contained in sections 30 to " +
      "43D\". K4-20 implements a BOUNDED Section 32(1)(ii) slice: a closed set of Income-tax Rules, " +
      "1962 New Appendix I standing classes, multiplied by the preparer's declared written-down value, " +
      "with book depreciation added back and the second-proviso half-rate applied when declared. " +
      "The Sections 30-43D declaration is a SET (`D237`): none_s30_43d remains exclusive, and " +
      "depreciation_s32 computes only with complete standing-class facts and an explicit no to " +
      "Section 32(1)(iia) additional depreciation. An undeclared basis REFUSES, and is never read as " +
      "no adjustment. Refused in full, each with its own distinct code and never partially computed: " +
      "an incomplete or out-of-set Section 32 claim (which is not optional — Explanation 5 to " +
      "Section 32(1) applies \"whether or not the assessee has claimed the deduction in respect of " +
      "depreciation in computing his total income\"); additional depreciation under Section 32(1)(iia); " +
      "any Section 37 / 40 / 43B disallowance or add-back; a move to books from a presumptive scheme (Section " +
      "44AD(4)/(5) lock-in and its Section 44AB(e) audit trigger, needing multi-year state that does " +
      "not exist here); a residual business LOSS after Section 70(1) current-year intra-head set-off " +
      "(Sections 71/72 cross-head treatment and carry-forward are unimplemented, and the residual is " +
      "excluded rather than floored to zero); and turnover EXCEEDING the Section " +
      "44AB audit threshold, tested on the AGGREGATE of each limb SEPARATELY because 44AB(a) asks about " +
      "\"his total sales, turnover or gross receipts, as the case may be, in business\" and 44AB(b) " +
      "about \"his gross receipts in profession\" — one question per limb about the PERSON, never one " +
      "per record. WHERE THAT TURNOVER FIGURE COMES FROM DIFFERS BY CLASSIFICATION, and for derivatives it " +
      "is NOT this engine's figure: an ordinary business or profession's declared revenue IS its turnover, " +
      "but for an affirmed F&O row the figure tested against the threshold is one the PREPARER SEPARATELY " +
      "DECLARES, because no source defines derivative turnover at all (see the caveat). An affirmed F&O row " +
      "that declares no turnover REFUSES; its revenue is never substituted for the missing figure. " +
      "MORE THAN ONE BUSINESS IS NO LONGER REFUSED. Every surviving refusal excludes the " +
      "WHOLE head rather than one record, because the head is an aggregate and a partial total would " +
      "not be the taxpayer's figure. WHICH LAYER ENFORCES THIS: the Tax Desk " +
      "computation ADAPTER (`computation-adapter.ts`) gates every one of those, and " +
      "`computeBusinessBooksIncome` re-checks the declared basis and the whole-head aggregate from the " +
      "SAME constants as defence in depth — not as a second rule.",
    sources: [
      S28,
      S29,
      S44AB,
      S43_5_DERIVATIVES,
      S70_INTRA_HEAD_SET_OFF,
      S73_SPECULATION_LOSS,
      S73A_SPECIFIED_BUSINESS_LOSS,
      ITD_SET_OFF_AND_CARRY_FORWARD_GUIDANCE,
      S115BAC,
    ],
    caveat:
      "TODO(CA-verify): sourced 2026-08-10 from directly-fetched indiankanoon.org reproductions of the " +
      "bare sections — Section 28 (doc/555776), Section 29 (doc/176471), Section 32 (doc/179995), " +
      "Section 37(1) (doc/41962694), Section 43B (doc/632021) and Section 44AB (doc/1956509). " +
      "incometaxindia.gov.in did not resolve from the K4-14 authoring host that session (recorded rather " +
      "than silently substituted — the same treatment K4-06/K4-07/K4-08 gave that host's HTTP 403s). " +
      "K4-17 re-retrieved the official Income Tax Department Section 70 page and its official May 2026 " +
      "set-off/carry-forward guidance on 2026-08-13. STATUTE: Section 70(1) entitles a loss from one " +
      "non-capital-gains source to be set off against income from another source under the same head. " +
      "Its opening 'Save as otherwise provided' is enforced through an affirmative activity classification. " +
      "Section 43(5) proviso (d) with Explanation 1 provides that an eligible transaction in exchange-traded " +
      "derivatives \"shall not be deemed to be a speculative transaction\", and K4-18 acted on that (D286): " +
      "such an undertaking now COMPUTES inside the ordinary Section 70(1) pool. But Explanation 1 is " +
      "CONJUNCTIVE and PER-TRANSACTION — screen-based on a notified recognised stock exchange, through a " +
      "SEBI-registered intermediary, evidenced by a time-stamped contract note bearing the unique client code " +
      "and PAN — and this product holds NO contract note, exchange identity or intermediary registration and " +
      "can verify NONE of it. That classification is therefore the PREPARER'S AFFIRMATION that every " +
      "transaction qualifies, never a finding of this engine. Derivative activity that is not so affirmed " +
      "still refuses, proviso (d) being conditional, as does intraday equity squared off without delivery; " +
      "Section 73 speculation-business and Section 73A specified-business losses remain refused, on the two " +
      "independent footings that Explanation 2 to Section 28 deems a speculation business distinct and " +
      "separate and Section 73(1) restricts its loss to another speculation business. No speculation pool is " +
      "implemented here. " +
      "NO SOURCE DEFINES DERIVATIVE TURNOVER, AND THAT GAP IS THE PREPARER'S TO CLOSE, NOT THIS PRODUCT'S " +
      "(D287). The Section 44AB thresholds stated below are applied to a turnover figure that, for an F&O " +
      "row, THIS ENGINE DOES NOT AND CANNOT DERIVE. A definition was verified ABSENT in the Income-tax Act " +
      "1961 (Section 44AB's own Explanation defines only \"accountant\" and \"specified date\"), in the " +
      "Income-tax Act 2025, in the CBDT-notified Income-tax Rules 2026 (Notification 64/2026, GSR 286(E)), " +
      "across the CBDT circular / notification / instruction databases, and in both the ITR-3 instructions " +
      "and Form 3CD. The method in professional use is the ICAI Guidance Note on Tax Audit, which is " +
      "PROFESSIONAL JUDGEMENT AND NOT LAW, and this pack may not treat it as authoritative. So the figure " +
      "tested against the threshold on an F&O row is the PREPARER'S OWN DECLARATION: this product records " +
      "it, cannot verify it, and never derives it. Declared revenue is NEVER substituted for a missing " +
      "declaration, because substituting would both invent a formula and UNDERSTATE the aggregate — the " +
      "dangerous direction, since it converts an audit case into a no-audit-required one — so an affirmed " +
      "F&O row declaring no turnover REFUSES instead. Nothing in this rule supports an audited return or " +
      "Form 3CD, and the tax-audit capability remains unsupported: THE SECTION 44AB JUDGEMENT ON AN F&O " +
      "CASE REMAINS THE PREPARER'S. " +
      "OFFICIAL GUIDANCE: the Department describes intra-head adjustment separately from residual " +
      "inter-head adjustment and carry-forward. IMPLEMENTATION INFERENCE: a zero-or-positive aggregate " +
      "means the current-year books head has absorbed the loss in full and leaves no residual for those " +
      "later categories. UNRESOLVED PROFESSIONAL JUDGEMENT: this pack remains draft and the inference " +
      "requires independent per-rule CA verification before reliance. The Section 44AB thresholds applied " +
      "are one crore rupees for a business (44AB(a)) and fifty " +
      "lakh rupees for a profession (44AB(b)). The FIRST PROVISO to 44AB(a), which substitutes ten " +
      "crore rupees, is DELIBERATELY NOT APPLIED: its second limb turns on cash PAYMENTS, which no " +
      "ledger in this product captures — the same unverifiable-condition gap decision D91 recorded " +
      "for the Section 44AD enhanced ceiling — so the LOWER threshold governs. NOT covered by this " +
      "rule, each an explicit limitation rather than an assumption: every provision in Sections 30 to " +
      "43D OTHER THAN the bounded Section 32(1)(ii) standing-class slice K4-20 ships; Section 43(6)(c) " +
      "written-down-value arithmetic (the WDV is the preparer's declaration); Section 32(1)(iia) " +
      "additional depreciation; Section 32(2) unabsorbed depreciation; specialised or time-window " +
      "Appendix I classes this slice will not quote; the correctness of the declared revenue and expense figures themselves, which this engine " +
      "cannot verify against any book of account; the interaction between this head's Section 44AB " +
      "aggregate and turnover declared PRESUMPTIVELY under Sections 44AD/44ADA on the same case, and " +
      "the proviso exempting a person who \"declares profits and gains for the previous year in " +
      "accordance with the provisions of sub-section (1) of section 44AD\" — the 44AB aggregate is " +
      "computed over BOOKS records only (a pre-existing K4-14 boundary that K4-15 did not widen and " +
      "did not close); Section 44AA book-keeping " +
      "requirements; and Section 115BAC(6)'s Form 10-IEA regime-option procedure, which is DISCLOSED " +
      "as an informational finding and neither filed nor tracked. Re-confirm every quotation directly " +
      "against the bare Act text before CA verification.",
    unverifiableQuotes: [
      {
        text: "shall not be deemed to be a speculative transaction",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
      {
        text: "accountant",
        reason: QUOTE_NOT_STATUTORY_TEXT,
      },
      {
        text: "specified date",
        reason: QUOTE_NOT_STATUTORY_TEXT,
      },
      {
        text: "declares profits and gains for the previous year in accordance with the provisions of "
            + "sub-section (1) of section 44AD",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
    ],
  }),
  // K4-09: Wave-4 priority #5, FIRST slice — WITHIN-YEAR capital-loss set-off
  // only. Carry-forward across assessment years and brought-forward losses are
  // explicitly NOT covered by this rule (no multi-year state exists yet).
  makeRuleProvenance({
    ruleId: "capital_loss_within_year_set_off",
    summary:
      "Within-year set-off of capital losses against capital gains, for the 111A/112A gain types this " +
      "engine already computes. A long-term capital loss may be set off ONLY against long-term capital " +
      "gains (Section 74(1)(b)); a short-term capital loss may be set off against either short-term or " +
      "long-term capital gains (Section 70). A capital loss may NOT be set off against income under any " +
      "other head (Section 71(3)). Any loss left unabsorbed at the end of the year would be carried " +
      "forward for up to eight assessment years (Section 74(2)) — NOT implemented. Because two ordering " +
      "questions could not be resolved from any source reachable when this rule was written, only the " +
      "window in which both are provably immaterial is admitted for computation: a long-term loss up " +
      "to the 112A gains ABOVE the Rs.1,25,000 exemption, and a short-term loss only when " +
      "the case has no 112A gain at all and the loss does not exceed the 111A gains. Every other loss " +
      "case is excluded IN FULL (all capital-gain rows together), never partially computed. " +
      "WHICH LAYER ENFORCES THIS (AUDIT-04-F2): the window is enforced by the Tax Desk computation " +
      "ADAPTER (`computation-adapter.ts`), NOT by the engine functions this pack freezes. Called " +
      "directly, `computeTax` applies one reading of both unresolved questions unconditionally and will " +
      "compute an out-of-window case — deliberately, and pinned by its own direct-call tests. Every " +
      "production path and the tax-lab harness build `buildEngineInput(...)` first, so no preparer-visible " +
      "figure escapes the window; a future consumer that reaches the raw engine would.",
    sources: [S70_INTRA_HEAD_SET_OFF, S71_3_CAPITAL_LOSS, S74_CARRY_FORWARD],
    caveat:
      "TODO(CA-verify): sourced 2026-07-31 primarily from ClearTax's \"How to Set Off and Carry Forward " +
      "Capital Losses\" (cleartax.in/s/set-off-carry-forward-capital-losses, directly retrieved), which " +
      "states that a Short-Term Capital Loss may be set off against \"Both Short-Term Capital Gains " +
      "(STCG) and Long-Term Capital Gains (LTCG)\" while a Long-Term Capital Loss may be set off against " +
      "\"Only Long-Term Capital Gains (LTCG)\"; that the Act \"does not allow loss under the head " +
      "capital gains to be set off against any income from other heads\"; and that both kinds \"can be " +
      "carried forward for 8 assessment years immediately following the assessment year in which the " +
      "loss was first computed\". Corroborated by two further directly-fetched publishers — " +
      "incometaxmanagement.in (Section 71 inter-head adjustment, confirming \"Losses from the head of " +
      "income 'Capital Gains' cannot be set off against income from any other head\") and aubsp.com " +
      "(quoting the bare Section 74(1)(a)/(b) and 74(2) eight-year text). BOTH incometaxindia.gov.in " +
      "AND bajajfinserv.in returned HTTP 403 to a direct fetch this session — attempted-but-blocked " +
      "sources, recorded rather than silently substituted (incometaxindia.gov.in is the same host K4-06, " +
      "K4-07 and K4-08 each found blocked). AS `K4-09` RECORDED THEM, TWO ORDERING QUESTIONS WERE OPEN: " +
      "(Q1) whether a loss reduces the GROSS 112A gain or only the portion above the Rs.1,25,000 " +
      "exemption — the two readings give a different carried-forward residual; and (Q2) when a " +
      "short-term loss may lawfully be absorbed by either 111A (20%) or 112A (12.5%) gains, which is " +
      "absorbed first — the two orders give a different tax. Every source reachable that session framed " +
      "both as tax-PLANNING advice (\"optimal approach\", \"this is only a guideline\"), never as a " +
      "statutory ordering rule, so neither was implemented. " +
      "UPDATE (`TAX-SAFE-02`, 2026-08-01, decisions D110-D113) — an OWNER-SUPPLIED external research " +
      "package (preserved at `docs/evidence/d93-ay-2026-27/`, retrieved 2026-07-31) partly resolves " +
      "them. It changes NO computation: this pack's window, the engine and the adapter are byte-" +
      "identical to what `K4-09` shipped. (Q1) is recorded as ANSWERED-BUT-NOT-REPRODUCED: the " +
      "Rs.1,25,000 threshold applies to the Section 112A income SURVIVING capital-loss set-off (and, " +
      "for a resident, after any basic-exemption shortfall), NOT to the gross Schedule 112A gain. That " +
      "conclusion rests on static inspection of the official ITR-2 v1.2 workbook by the supplied " +
      "package (`Schedule SI`: `P3 = MIN(125000,H28)` applied AFTER `calcBFLA`); `TAX-SAFE-02` did NOT " +
      "independently reproduce the workbook trace and did not hold the workbook. It is EXTERNAL " +
      "PORTAL-CONFORMANCE EVIDENCE, not statute, and NOT CA-verified. (Q2) is NARROWED, NOT closed: no " +
      "CBDT circular or rule was located making any intra-head rate-bucket sequence legally mandatory, " +
      "and official ITAT orders (Divya Dinesh v DCIT, India Acorn Fund, Ishana Capital Master Fund, " +
      "relying on CIT v Rungamatee Trexim, Calcutta HC) hold that Section 70 creates no rate " +
      "compartments and no compulsory chronology, so a taxpayer may choose a lawful beneficial " +
      "allocation. The official utility nevertheless applies a FIXED DEFAULT sequence (non-112A 12.5% " +
      "LTCG consumed before 112A; brought-forward LTCL before brought-forward STCL). Q2 therefore " +
      "becomes a DESIGN REQUIREMENT rather than a single answer: any future carry-forward slice must " +
      "carry an explicit, versioned allocation policy plus a taxpayer-election path, and MUST NOT " +
      "hard-code one order as the statutory result. This evidence is VERSION-BOUND — revalidate on any " +
      "AY 2026-27 utility, JSON-schema or validation-rules revision (recorded at ITR-2 utility v1.2, " +
      "schema v1.1, validation rules v1.0). `incometaxindia.gov.in` returned HTTP 403 again to " +
      "`TAX-SAFE-02` (FIFTH consecutive session), so the statute pages remain unverified here; " +
      "`incometax.gov.in`'s downloads page WAS reachable and independently confirms the utility and " +
      "schema versions above. NOT covered by this rule: carry-forward " +
      "across assessment years (Section 74(2)); brought-forward losses from an earlier year (still " +
      "routed to manual professional review by the `brought_forward_losses` eligibility declaration); " +
      "the Section 139(3)/80 condition that a return be filed by the due date for a loss to be carried " +
      "forward; losses in the `other_stcg`/`other_ltcg` gain types this engine does not compute at all; " +
      "and house-property or business-loss set-off. See the common-case coverage " +
      "notes row #5 and the `K4-09` decision-log entries (D92-D96).",
    unverifiableQuotes: [
      {
        text: "How to Set Off and Carry Forward Capital Losses",
        reason: QUOTE_NOT_STATUTORY_TEXT,
      },
      {
        text: "Both Short-Term Capital Gains (STCG) and Long-Term Capital Gains (LTCG)",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
      {
        text: "Only Long-Term Capital Gains (LTCG)",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
      {
        text: "does not allow loss under the head capital gains to be set off against any income from "
            + "other heads",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
      {
        text: "can be carried forward for 8 assessment years immediately following the assessment "
            + "year in which the loss was first computed",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
      {
        text: "Losses from the head of income 'Capital Gains' cannot be set off against income from "
            + "any other head",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
      {
        text: "optimal approach",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
      {
        text: "this is only a guideline",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
    ],
  }),
  makeRuleProvenance({
    ruleId: "capital_loss_brought_forward_set_off",
    summary:
      "BROUGHT-FORWARD set-off of prior-year capital losses under Section 74, applied AFTER the " +
      "within-year set-off (ss.70/71) and only against the 111A/112A gains SURVIVING it. Each " +
      "carry-forward record is identified by its ORIGINATING assessment year and its STCL/LTCL type, " +
      "because the Section 74(2) expiry test needs the year and the Section 74(1) destination test " +
      "needs the type. Section 74(2) permits carry-forward for the EIGHT assessment years " +
      "immediately succeeding the year the loss was first computed; a loss past that boundary is " +
      "EXCLUDED VISIBLY, with a disclosure naming its originating assessment year, never silently " +
      "dropped. Section 139(3)/80 conditions carry-forward on the loss return having been filed by " +
      "the due date: a record whose filing eligibility is UNVERIFIED fails closed (the case is " +
      "refused, never computed on the assumption that it was filed on time), and a record recorded " +
      "as NOT eligible is excluded with its own disclosure. Every allocation and every residual is " +
      "recorded explicitly — which loss went to which gain bucket, in what amount, under which " +
      "policy, leaving what residual and until which assessment year. " +
      "THIS RULE DECLARES NO MANDATORY ALLOCATION SEQUENCE. The sequence comes from a NAMED, " +
      "VERSIONED policy (`src/lib/tax-engine/ay-2026-27/loss-allocation-policy.ts`): " +
      "`portal_default_ay2026_27`, pinned to ITR-2 utility v1.2 / JSON schema v1.1 / validation " +
      "rules v1.0, alongside `taxpayer_elected`, which carries a professional-review flag and an " +
      "audit flag and STOPS FOR REVIEW when the election does not reproduce current portal " +
      "behaviour. WHICH LAYER ENFORCES THE SCOPE (the AUDIT-04-F2 / D105 convention): the Tax Desk " +
      "computation ADAPTER admits only cases in which the allocation is FORCED — where every lawful " +
      "policy produces the identical result — and excludes every other case IN FULL (all " +
      "capital-gain rows AND all brought-forward rows together, never the loss alone). Called " +
      "directly, the engine will compute an allocation for any input, deliberately, and is pinned " +
      "by its own direct-call tests. NOT COVERED: GENERATION of a new carry-forward record from an " +
      "unabsorbed CURRENT-year loss (that case is still refused outright by " +
      "`CAPITAL_LOSS_NOT_MODELLED`); losses in the `other_stcg`/`other_ltcg` gain types this engine " +
      "does not compute at all; house-property and business-loss carry-forward; and the resident " +
      "basic-exemption shortfall step, which `TAX-SAFE-02A` classified as externally sourced but " +
      "NOT reproduced.",
    sources: [S70_INTRA_HEAD_SET_OFF, S71_3_CAPITAL_LOSS, S74_CARRY_FORWARD],
    caveat:
      "TODO(CA-verify): the STATUTORY content of this rule was sourced independently for `K4-10` on " +
      "2026-08-01 and CONFIRMS rather than discovers — ClearTax's \"How to Set Off and Carry " +
      "Forward Capital Losses\" (cleartax.in/s/set-off-carry-forward-capital-losses, directly " +
      "retrieved) states that both kinds of capital loss \"can be carried forward for 8 assessment " +
      "years immediately following the assessment year in which the loss was first computed\", that " +
      "a long-term capital loss is set off \"Only\" against long-term capital gains while a " +
      "short-term loss may reach both, and that \"losses for a year cannot be carried forward " +
      "unless that year's return has been filed before the due date\" (the Section 139(3)/80 " +
      "condition, which `K4-09` had left unmodelled). taxguru.in corroborates the eight-year figure " +
      "and the long-term restriction. `K4-09`'s D94 had already corroborated the same boundary from " +
      "three sources. `incometaxindia.gov.in` returned HTTP 403 AGAIN — the SIXTH consecutive " +
      "session (K4-06, K4-07, K4-08, K4-09, TAX-SAFE-02, now K4-10) — and tax2win.in also 403'd; " +
      "both recorded as attempted-but-blocked rather than silently substituted (D67). " +
      "THE ALLOCATION SEQUENCE IS NOT STATUTE AND MUST NEVER BE DESCRIBED AS SUCH (D113). No CBDT " +
      "circular or rule making any intra-head rate-bucket sequence legally mandatory was located; " +
      "official ITAT orders relying on CIT v Rungamatee Trexim (Calcutta HC) hold that Section 70 " +
      "creates no rate compartments and no compulsory chronology; NEITHER ITR validation-rules PDF " +
      "prescribes any order and NEITHER JSON schema does (all 53/56 \"set off\" rules are " +
      "arithmetic-consistency rules); and `CG_Calc.doSetoff` itself BRANCHES on " +
      "`CG_TableE_Checkbox` into a user-entered Schedule CG Table E allocation, so the official " +
      "utility treats its own sequence as a default over a taxpayer-supplied one (D114). " +
      "THE PORTAL DEFAULT IS PORTAL-CONFORMANCE EVIDENCE, reproduced from the byte-verified ITR-2 " +
      "v1.2 workbook by `TAX-SAFE-02A`: brought-forward LTCL consumed before brought-forward STCL " +
      "(`CYLACalculations.bas:6256-6259` vs the first BF STCL consumption at 6621); a short-term " +
      "loss routed to short-term buckets before LTCG 12.5% (`SchCG.bas:7787 " +
      "setOffPctg20Loss_STCG`); the surviving 12.5% pool assigned to Section 112A first " +
      "(`CG_Calc.bas:889-901`); and the Rs.1,25,000 Section 112A threshold taken FROM the " +
      "post-set-off figure (`SPI - SI`, `P3 = MIN(125000,H28)`), never subtracted from the gross " +
      "Schedule 112A gain beforehand. TWO ASPECTS ARE NOT REPRODUCED and are declared on the policy " +
      "itself: the ordering BETWEEN two brought-forward records of the SAME type (this policy takes " +
      "the oldest originating year first, and the adapter refuses any case where that could change " +
      "a recorded residual), and the resident basic-exemption shortfall intermediary (the " +
      "`G28`->`H28` step is INFERRED — no module among the 151 recovered writes " +
      "`temp112A_125_exmp_New`). This evidence is VERSION-BOUND: revalidate on any AY 2026-27 " +
      "utility, JSON-schema or validation-rules revision (`portalDefaultArtifactDrift` is the gate " +
      // Phrased to avoid the literal substring "is CA-verified". That is not
      // pedantry: `e2e/26-case-traceability.spec.ts` asserts ZERO occurrences of
      // /is CA-verified/ anywhere on Computation, deliberately as a blunt
      // truthfulness guard, and a DENIAL containing the same substring trips it
      // exactly like a claim would. The guard is right and the prose was wrong —
      // the fix belongs here, not in a weakened assertion.
      "in code). NOTHING here has been CA-verified and no pack is `ca_verified`. See " +
      "`docs/evidence/d93-ay-2026-27/`, the tax-capability-matrix design notes's K4-10 section, " +
      "and the `K4-10` decision-log entries (D117 onward).",
    unverifiableQuotes: [
      {
        text: "How to Set Off and Carry Forward Capital Losses",
        reason: QUOTE_NOT_STATUTORY_TEXT,
      },
      {
        text: "can be carried forward for 8 assessment years immediately following the assessment "
            + "year in which the loss was first computed",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
      {
        text: "Only",
        reason: QUOTE_NOT_STATUTORY_TEXT,
      },
      {
        text: "losses for a year cannot be carried forward unless that year's return has been filed "
            + "before the due date",
        reason: QUOTE_SOURCE_NOT_REGISTERED,
      },
      {
        text: "set off",
        reason: QUOTE_NOT_STATUTORY_TEXT,
      },
    ],
  }),
  // K4-19: a GAP rule, in the shape of
  // `surcharge_marginal_relief_safety_threshold` above — it exists so an
  // unimplemented provision is a versioned, cited, rendered fact rather than an
  // absence nobody can see. NOTHING here is computed from it.
  //
  // IT QUOTES NO STATUTE, DELIBERATELY (D307/D308). The consolidated Income-tax
  // Act, 1961 is unretrieved (`AUDIT-10-F4`), so any span quoted from s.89 or
  // rule 21A could only ever be parked in `unverifiableQuotes` under
  // QUOTE_SOURCE_NOT_REGISTERED. Writing a caveat that quotes nothing is
  // strictly more honest than declaring a span nothing can check, and it leaves
  // the asserted quoted-statute census untouched.
  makeRuleProvenance({
    ruleId: "section_89_arrears_relief",
    summary:
      "Relief under Section 89(1) on salary or pension received in arrears or in advance, computed " +
      "under Rule 21A and claimed on Form 10E. NOT IMPLEMENTED — no relief amount is computed, and " +
      "none of the Rule 21A(3)-(5) limbs (gratuity, commuted pension, compensation on termination) " +
      "is computed either. Recorded as a versioned rule so the gap is visible where a preparer works.",
    sources: [S89_ARREARS_RELIEF, RULE_21A_FORM_10E],
    caveat:
      "TODO(CA-verify): NO RELIEF IS COMPUTED, and the reason is structural rather than a matter of " +
      "effort. Rule 21A(2) requires, for each earlier previous year the arrears relate to, the tax on " +
      "that year total income including the portion attributable to it less the tax on that year " +
      "total income excluding it. That needs PRIOR YEARS RATE SCHEDULES, each fixed by its own " +
      "Finance Act, and this engine holds exactly one year of figures — " +
      "`tax-engine/core/statutory-rate-parameters.ts` declares six rate parameters for a single " +
      "statutory world (D299/D310). It also needs the prior years total incomes, which are client " +
      "facts the ledger does not model; no multi-year state exists in this product at all, the same " +
      "limitation `capital_loss_brought_forward_set_off` records from the other side. " +
      "DIRECTION OF ERROR: omitting relief can only OVERSTATE tax, never understate it — so this is " +
      "a client-detriment and unfiled-Form-10E risk, not a wrong-number-in-the-dangerous-direction " +
      "risk, and it is stated that way rather than dressed up as a safety property. " +
      "THE TEXT OF SECTION 89 AND RULE 21A HAS NOT BEEN READ HERE: the consolidated Income-tax Act, " +
      "1961 remains unretrieved by every route tested (`AUDIT-10-F4`), so the sources above NAME the " +
      "provisions and this caveat quotes neither. Before any CA verification, read both against " +
      "official text and re-derive this summary from them rather than from this paragraph.",
  }),
]);
