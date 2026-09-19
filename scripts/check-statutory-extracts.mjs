#!/usr/bin/env node
/**
 * TaxDesk OS — the statutory-extract integrity gate (`K4-SOURCE-02`, `D302`).
 *
 * THIS STILL RUNS WITHOUT THE PDFs. `.sources/statutory/` is gitignored, so CI
 * and a fresh clone have the committed extracts and the manifest and nothing
 * else. In that case the unavailable re-derivation is REPORTED, never silently
 * described as verified. When a PDF is present, this gate hashes the PDF and
 * re-runs every committed page range in all three pdftotext modes.
 *
 * `scripts/build-statutory-extracts.mjs` is the generator and needs the PDFs;
 * it is NOT a gate. This is.
 *
 * What it asserts:
 *   1. every extract names an artifact that the manifest actually declares;
 *   2. every extract's recorded sha256 MATCHES that manifest entry and, when
 *      the artifact is present, the artifact bytes hash to that sha256;
 *   3. every extract's recorded rank/publisher/stage agrees with the manifest,
 *      so the two records cannot drift into disagreeing about what a document
 *      IS (the drift that hid a missing URL until K4-SOURCE-02 went looking);
 *   4. every extract still carries the verbatim text the pack provenance
 *      quotes from it — the load-bearing half. A citation whose text has
 *      vanished from the evidence base is a citation to nothing;
 *   5. the README index lists every extract and no extract is unlisted;
 *   6. every present artifact is freshly re-extracted for the configured page
 *      range and each committed pdftotext block matches that fresh output;
 *   7. RECOVERABILITY is enumerated, and any artifact that is neither
 *      re-retrievable NOR extracted is REPORTED. That is a standing count the
 *      owner can act on, not a failure — see the README.
 */

import { createHash } from "node:crypto";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { EXTRACTS as EXTRACT_SPECS, extractModes } from "./build-statutory-extracts.mjs";

const REPO = join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const MANIFEST = join(REPO, "docs/evidence/statutory-sources/manifest.json");
const SOURCES = join(REPO, ".sources/statutory");
const EXTRACTS = join(REPO, "docs/evidence/statutory-sources/extracts");
const README = join(EXTRACTS, "README.md");
const SPEC_BY_OUT = new Map(EXTRACT_SPECS.map((spec) => [spec.out, spec]));

/**
 * The load-bearing text, per extract. These strings are quoted in the pack
 * provenance caveats; if one disappears from the evidence base, a citation this
 * repository renders to a user has become a citation to nothing.
 *
 * Deliberately WORDS, not rate figures pulled from a table. The sole exception
 * is K4-SOURCE-04-S1: the notified table row is the instrument's entire
 * load-bearing result, and the exact same one-line row was independently
 * resolved in -layout and -raw before being asserted here.
 */
const MUST_CONTAIN = {
  "ay-2026-27/cbdt-notification-44-2017-cii-fy-2001-02-to-2017-18.txt": [
    "MINISTRY OF FINANCE",
    // NOT A TYPO HERE — a typo in the GAZETTE. The 2017 instrument prints
    // "(CENTRAL BOARD OF DIRECT TEXES)". Asserting the corrected spelling
    // would fail against the real document, and "fixing" the extract to
    // match this file would be editing evidence. Assert what the source says.
    "(CENTRAL BOARD OF DIRECT TEXES)",
    "In exercise of the powers conferred by clause (v)",
    "1 2001-02 100",
    "17 2017-18 272",
  ],
  "ay-2026-27/cbdt-notification-39-2023-cii-fy-2023-24.txt": [
    "CENTRAL BOARD OF DIRECT TAXES",
    "In exercise of the powers conferred by clause (v)",
    '"23 2023-24 348"',
  ],
  "ay-2026-27/cbdt-notification-44-2024-cii-fy-2024-25.txt": [
    "CENTRAL BOARD OF DIRECT TAXES",
    "In exercise of the powers conferred by clause (v)",
    '"24 2024-25 363"',
  ],
  "ay-2026-27/cbdt-notification-70-2025-cii-fy-2025-26.txt": [
    "CENTRAL BOARD OF DIRECT TAXES",
    "In exercise of the powers conferred by clause (v)",
    '"25 2025-26 376"',
    "shall come into force on the 1st day of April, 2026",
  ],
  "ay-2026-27/itr-output/itr-1-schema-change-v1.1.txt": [
    "Schema changes as on 30th June 2026",
    "ExemptIncAgriOthUs10",
    "Description and Enum",
    "New field added",
  ],
  "ay-2026-27/itr-output/itr-1-validation-rules-v1.0-sample.txt": [
    "Validation Rules",
    "Category A",
    "Sum of deductions claimed u/s 80C, 80CCC & 80CCD",
  ],
  "ay-2026-27/itr-output/itr-4-schema-change-v1.1.txt": [
    "Schema changes as on 30th June 2026",
    "ExemptUs10",
    "Description and Enum",
    "New field added",
  ],
  "ay-2026-27/itr-output/itr-4-validation-rules-v1.0-sample.txt": [
    "Validation Rules",
    "Return will not be allowed to be uploaded. Error messages will be displayed.",
    "Category A",
  ],
  "ay-2026-27/itr-output/itr-2-schema-change-v1.2.txt": [
    "Schema changes as on 13th August 2026",
    "EditAutopoulatedDetail",
    "ScheduleCGFor23",
    "ScheduleSI",
  ],
  "ay-2026-27/itr-output/itr-2-validation-rules-v1.0-sample.txt": [
    "Validation Rules",
    "Assessee should enter valid Mobile Number",
    "Name of the taxpayer does not match",
  ],
  "ay-2026-27/itr-output/itr-3-schema-change-v1.1.txt": [
    "Schema changes as on 30th June 2026",
    "ScheduleTDS2",
    "ScheduleTDS3",
    "Description and Enum",
  ],
  "ay-2026-27/itr-output/itr-3-validation-rules-v1.0-sample.txt": [
    "Validation Rules",
    "HUF cannot claim relief u/s 89",
    "Assessee should provide valid Mobile Number",
  ],
  "ay-2026-27/itr-output/notification-45-2026-itr-1-opening.txt": [
    "Income-tax (Second Amendment) Rules, 2026",
    "returns filed for A.Y. 2026-27",
    "for FORM ITR-1, the following FORM shall be substituted",
    "INDIAN INCOME TAX RETURN",
  ],
  "ay-2026-27/itr-output/notification-45-2026-itr-4-opening.txt": [
    "for FORM ITR-4, the following FORM shall be substituted",
    "For Individuals, HUFs and Firms (other than LLP)",
    "INDIAN INCOME TAX RETURN",
  ],
  "ay-2026-27/itr-output/notification-46-2026-itr-2-opening.txt": [
    "Income-tax (Third Amendment) Rules, 2026",
    "returns filed for A.Y. 2026-27",
    "for FORM ITR-2, the following FORM shall",
    "INDIAN INCOME TAX RETURN",
  ],
  "ay-2026-27/itr-output/notification-47-2026-itr-3-opening.txt": [
    "Income-tax (Fourth Amendment) Rules, 2026",
    "returns filed for A.Y. 2026-27",
    "for FORM ITR-3, the following FORM shall be",
    "INDIAN INCOME TAX RETURN",
  ],
  "ay-2026-27/itr-output/notification-57-2026-corrigendum-itr-1-itr-4.txt": [
    "G.S.R. 262(E)",
    "Schedule-IT Details of Advance Tax and Self-Assessment Tax payments",
    "for the letters \"Iva\", the letters",
    "\"iva\" shall be substituted",
  ],
  "ay-2026-27/itr-output/notification-58-2026-corrigendum-itr-2.txt": [
    "G.S.R. 263(E)",
    "for the words \"dxx\", the words \"dxxi\" shall be substituted",
    "for the figures and letters \"2xv\", figures and letters \"2xiv\"",
    "for the letter \"w\", letter \"v\" shall be substituted",
  ],
  "ay-2026-27/itr-output/notification-59-2026-corrigendum-itr-3.txt": [
    "G.S.R. 264(E)",
    "the words and letters \"B13a\" shall be substituted \"B12a\"",
    "grey colour of the blank cells",
  ],
  "ay-2026-27/finance-act-2026-s2.txt": [
    "Income-tax under Act 43 of 1961",
    "for the assessment year commencing on the 1st day of April, 2026",
    "Health and Education",
    "four per cent",
  ],
  "both-worlds/finance-act-2026-first-schedule.txt": [
    "A.--INCOME-TAX UNDER THE INCOME-TAX ACT, 1961",
    "B.-- INCOME-TAX UNDER THE INCOME-TAX ACT, 2025",
    "Surcharge on income-tax",
  ],
  "ay-2026-27/income-tax-rules-1962-rule-12.txt": [
    "be in Form SAHAJ (ITR-1)",
    "has total income, exceeding fifty lakh rupees",
    "assessment year commencing",
  ],
  "ay-2026-27/income-tax-rules-1962-new-appendix-I.txt": [
    "NEW APPENDIX I",
    "TABLE OF RATES AT WHICH DEPRECIATION IS ADMISSIBLE",
    "See rule 5",
  ],
  "corroboration-only/finance-bill-2026-as-introduced.txt": [
    "BILL No. 3 OF 2026",
    "AS INTRODUCED IN LOK SABHA",
  ],
  // ── `MAINT-03`: page-range extracts of the enacted Income-tax Act, 2025 ──
  // One file per provision group the TY 2026-27 pack quotes. Words, never table
  // figures, for the reason at the top of this block — and every needle below
  // was verified present in the pdftotext OUTPUT, not merely somewhere in the
  // file, which is now what `statuteOnly` enforces.
  "ty-2026-27/ita-2025-s002-s003-definitions-and-tax-year.txt": [
    "Commissioner (Appeals)",
    "senior citizen",
    "of the age of sixty years or more",
    "tax year",
  ],
  "ty-2026-27/ita-2025-s019-s022-salary-and-house-property.txt": [
    "Standard deduction",
    "annual value",
    "borrowed capital",
  ],
  "ty-2026-27/ita-2025-s026-s027-business-income.txt": [
    "except section 58",
    "Profits and gains of business or profession",
  ],
  "ty-2026-27/ita-2025-s058-s063-presumptive-and-audit.txt": [
    "Specified profession",
    "Business of plying",
    "gross receipts",
  ],
  "ty-2026-27/ita-2025-s066-part-d-definitions.txt": [
    "For the purposes of Part D of this Chapter",
    "speculative transaction",
    "time stamped contract note",
  ],
  "ty-2026-27/ita-2025-s108-s114-set-off-and-carry-forward.txt": [
    "carried forward",
    "speculation business",
    "Capital gains",
  ],
  "ty-2026-27/ita-2025-s126-health-insurance.txt": ["senior citizen", "health insurance"],
  "ty-2026-27/ita-2025-s153-interest-on-deposits.txt": [
    "interest on deposits",
    "not being a senior citizen",
  ],
  "ty-2026-27/ita-2025-s156-rebate.txt": ["twelve lakh rupees", "deduction of 100%"],
  "ty-2026-27/ita-2025-s196-s198-special-rate-capital-gains.txt": [
    "short-term capital gains",
    "long-term capital gains",
  ],
  "ty-2026-27/ita-2025-s202-new-regime.txt": ["Upto Rs. 400000", "Rate of tax", "New tax regime"],
  "ty-2026-27/ita-2025-s403-advance-tax.txt": ["advance tax", "individual resident in India"],
  "ty-2026-27/income-tax-rules-2026-rule-164.txt": [
    "has total income, exceeding fifty lakh rupees",
    "SAHAJ",
  ],
  // ── `K4-24`: the SECTION 89 COUNTERPART in the 2025-Act world ──
  // Registered as a CITATION ONLY. No 2025-Act relief arithmetic exists in this
  // repository and none is authorised; that world still cannot compute
  // (`D319`). What these needles protect is the mapping itself, which three
  // sessions recorded as unidentified — `D311` withheld it deliberately rather
  // than guessing (`D298`'s error class), and it is now read off a held
  // artifact rather than asserted.
  //
  // EACH NEEDLE WAS TESTED AGAINST THE BUILT EXTRACT BEFORE BEING WRITTEN HERE,
  // which is `K4-SOURCE-06`'s method and the reason two of `K4-SOURCE-07`'s
  // candidates were thrown away. All six s.157 needles are present in ALL THREE
  // modes.
  "ty-2026-27/ita-2025-s157-arrears-relief.txt": [
    "Relief when salary, etc., is paid in arrears or in advance.",
    "a sum in the nature of arrear or advance salary",
    "salary for more than twelve months in any one tax year",
    "arrears of \"family pension\" as defined in section 93(1)(d)",
    // s.157(2) — the counterpart of s.89's proviso, reached through a DIFFERENT
    // provision. Whether the two are co-extensive is a tax question, not decided.
    "No relief shall be granted on any income on which deduction has been claimed by the assessee in section 19(1)",
  ],
  // Rule 73 is a TABLE of named formulae where rule 21A is prose sub-rules, so
  // §3.2 binds hard here: NO span of the Table's column B survives as one line
  // in ANY mode, because the two columns are interleaved on every line
  // ("1. Any portion of salary received in    Relief = A-B, if A exceeds B").
  //
  // THE FIRST DRAFT OF THIS LIST GOT THAT WRONG AND THE GUARD CAUGHT IT, which
  // is worth recording rather than quietly fixing. The candidates were tested
  // against the built extract first (`K4-SOURCE-06`'s method), but with a
  // whitespace-COLLAPSING matcher, while this checker compares line by line and
  // does not collapse newlines. "Any portion of salary received in arrears or
  // in advance" passed that looser test and FAILED here. Testing a candidate
  // with looser semantics than the guard uses is not testing it.
  //
  // So the needles below are the spans that ARE contiguous — the rule heading,
  // the charging sentence, the sub-rules, and the arrears limb pinned through
  // its own interleaved line, which is the honest way to reach column B.
  "ty-2026-27/income-tax-rules-2026-rule-73-section-157-relief.txt": [
    "73. Relief under section 157(1), when salary is paid in arrears or in advance,",
    "the relief admissible under section 157(1) shall be as specified in column C thereof",
    "1. Any portion of salary received in Relief = A-B, if A exceeds B, where -",
    "A = tax on the additional salary or",
    // Sl. 2-5 — the three average-rate limbs. Each is pinned through a span the
    // `-raw` mode carries whole, which is how the Table's column B is reachable
    // at all; the default and `-layout` modes interleave the two columns.
    "2. Gratuity received in respect of past",
    "Compensation received from the employer or the former employer at or in connection with the termination of employment",
    "5. Commutation of pension received",
    // r.73(2): the Board-discretion residual, which no software may exercise.
    "the Board may, having regard to the circumstances of the case, allow such relief as it deems fit",
    // r.73(3): the FORM, and a due-date condition rule 21AA does not impose.
    "the assessee shall furnish the particulars specified in Form No. 39 on or before the due date specified under section 263(1)(c)",
  ],
  // ── `K4-PORT-04`: the consolidated INCOME-TAX ACT, 1961 (owner-supplied) ──
  // `MAINT-09` / `AUDIT-14-F2`: the two previously uncited AY rules now have
  // bounded evidence. These needles protect the prose spans the caveats quote;
  // the figures were cross-read in all three modes and no computed value moved.
  "ay-2026-27/income-tax-act-1961-s016-standard-deduction.txt": [
    "Deductions from salaries",
    "a deduction of fifty thousand rupees or the amount of the salary, whichever is less",
    "seventy-five thousand rupees",
  ],
  "ay-2026-27/income-tax-act-1961-s080c-s080cce-deduction-caps.txt": [
    "CHAPTER VIA",
    "one hundred and fifty thousand rupees",
    "shall not exceed fifty thousand rupees",
  ],
  "ay-2026-27/income-tax-act-1961-s080d-health-insurance.txt": [
    "Deduction in respect of health insurance premia",
    "the provisions of this section shall have effect as if for the words",
  ],
  "ay-2026-27/income-tax-act-1961-s080g-donations.txt": [
    "Deduction in respect of donations to certain funds",
    "an amount equal to fifty per cent of the aggregate of the sums specified in sub-section (2)",
  ],
  "ay-2026-27/income-tax-act-1961-s080tta-s080ttb-deposit-interest.txt": [
    "Deduction in respect of interest on deposits in savings account",
    "in any other case, ten thousand rupees",
    "in any other case, fifty thousand rupees",
  ],
  //
  // ONE needle, because this extract backs exactly ONE declared span — the s.29
  // range MAINT-03 found matching off a reading note rather than off statute.
  // That span is the reason the file exists, so if it vanishes the file has
  // stopped earning its bytes and this gate should say so.
  //
  // The other two are structural: they prove the range really did capture s.28's
  // Explanation 2 and s.43(5), which the notes claim are in it and which a later
  // F&O session will come looking for.
  "ay-2026-27/income-tax-act-1961-s028-s030-business-computation.txt": [
    "sections 30 to 43D",
    "Profits and gains of business or profession",
    "speculative transaction",
  ],
  // ── `K4-21`: house-sale capital gains (s.2(42A), s.45/s.48/s.50C, s.112) ──
  // Needles are the spans this slice actually quotes. Verified present in the
  // pdftotext blocks (all three modes), not only in the reading notes.
  "ay-2026-27/income-tax-act-1961-s002-capital-asset-and-holding.txt": [
    "short-term capital asset",
    "twenty-four",
    "capital asset\" means",
  ],
  "ay-2026-27/income-tax-act-1961-s045-s050c-capital-gains.txt": [
    "Any profits or gains arising from the transfer of a capital asset effected in the previous year shall",
    "which takes place before the 23rd day of July, 2024",
    "one hundred and ten per cent",
  ],
  "ay-2026-27/income-tax-act-1961-s111a-s112-special-rate-capital-gains.txt": [
    "twelve and one-half per cent",
    "being land or building or both, which is acquired before the 23rd day of July, 2024",
    "being an equity share in a company or a unit of an equity oriented fund",
  ],
  "ay-2026-27/income-tax-act-1961-s055-cost-of-acquisition.txt": [
    "Meaning of \"adjusted\", \"cost of improvement\" and \"cost of acquisition\"",
    "acquired before the 1st day of February, 2018",
    "fair market value of the asset on the 1st day of April, 2001",
  ],
  "ay-2026-27/income-tax-act-1961-s112a-listed-equity-ltcg.txt": [
    "Tax on long-term capital gains in certain cases",
    "long-term capital asset being an equity share",
    "one lakh twenty-five thousand rupees",
  ],
  // ── `K4-PORT-04`: THE FINANCE ACT, 2026 AS PUBLISHED IN THE GAZETTE ───────
  //
  // No pack cites this yet (the "NOT the Gazette" disclaimers are retired by a
  // later session), so these needles are not protecting a declared quotation —
  // they are protecting the CLAIM THIS REPOSITORY NOW MAKES ABOUT THE ARTIFACT:
  // that it is the Gazette, that it carries BOTH charging sections, and that both
  // halves of First Schedule Part I are in it. If any of that stops being true
  // the register is wrong, and a wrong register is what the whole extract system
  // exists to prevent.
  //
  // The two cess spellings are both asserted deliberately: the 1961-Act half
  // writes "four per cent." in words at s.2(6) and the 2025-Act half prints "4%"
  // in digits at s.3(15). A needle written for one does not cover the other, and
  // AUDIT-11-F5 was a falsified cess rate.
  "both-worlds/finance-act-2026-gazette-chapter-ii.txt": [
    "THE GAZETTE OF INDIA",
    "for the assessment year commencing on the 1st day of April, 2026",
    "Chapter XII or Chapter XII-A",
    "calculated at the rate of four per cent",
    "Part A, B, C or D of Chapter XIII",
    "at the rate of 4%",
  ],
  "both-worlds/finance-act-2026-gazette-first-schedule-part-i.txt": [
    "THE FIRST SCHEDULE",
    "A.--INCOME-TAX UNDER THE INCOME-TAX ACT, 1961",
    "B.-- INCOME-TAX UNDER THE INCOME-TAX ACT, 2025",
    "Surcharge on income-tax",
    // Part I-A extracts its amounts cleanly; Part I-B's rupee glyph does NOT
    // survive extraction, so the ONLY safely assertable Part I-B amount here is
    // the bare digits. That asymmetry is the artifact's headline reading hazard.
    "exceed Rs. 2,50,000",
  ],
  "both-worlds/finance-act-2026-gazette-first-schedule-part-iii.txt": [
    "Part A, B, C or D of Chapter XIII",
    "at the rates as specified in that Chapter or section",
  ],
  // ── `K4-PORT-04`: Finance Act, 2026 s.3 — the TY 2026-27 charging section ──
  //
  // These are the four spans slice 5's citations rest on, and the third is the
  // one the port's tax question turned on: s.3(3) routes a Chapter XIII Part C
  // case (s.202, the new regime) to that section's own rates. If any of these
  // vanishes from the extract, five rate parameters lose their authority and
  // this gate has to say so.
  //
  // WORDS, NOT TABLE FIGURES, like every needle above — except "at the rate of
  // 4%", which is deliberate: it is PROSE in s.3(15), not a table cell, so it
  // carries none of the table-misrendering hazard, and it is the single figure
  // the `cess_rate` parameter is. `AUDIT-11-F5` was a falsified cess rate in the
  // sibling world; asserting this one here is cheap.
  "ty-2026-27/finance-act-2026-s3.txt": [
    "Income-tax under Act 30 of 2025",
    "for the tax year commencing on the 1st day of April,",
    "Part A, B, C or D of Chapter XIII",
    "at the rate of 4%",
  ],

  // ---------------------------------------------------------------------------
  // K4-SOURCE-06 — the section 89 arrears lookback corpus: thirteen enacted
  // Finance Acts, Gazette of India, Part II Section 1, AY 2015-16 to AY 2025-26.
  //
  // Each section-2 extract is pinned on FOUR identity spans (Act short title, Act
  // number, issuing ministry, Chapter II heading) plus the charging words naming
  // ITS OWN assessment year. The year in that span is what stops one Act's extract
  // from silently standing in for another's — these thirteen documents are
  // near-identical in structure and differ mostly in their numbers.
  // ---------------------------------------------------------------------------
  "historical-ay-1961/finance-act-2015-s2-charging.txt": [
    "THE FINANCE ACT, 2015",
    "NO. 20 OF 2015",
    "MINISTRY OF LAW AND JUSTICE",
    "RATES OF INCOME-TAX",
    "commencing on the 1st day of April, 2015",
    "Part I of the First Schedule",
  ],
  "historical-ay-1961/finance-act-2015-first-schedule.txt": [
    "THE FIRST SCHEDULE",
    "(See section 2",
    "Paragraph A",
    "Rates of income-tax",
    // PINNED ON PURPOSE. Part III of this same Schedule carries rates for the FOLLOWING
    // assessment year. Its presence in the extract is what makes the Part-naming warning in the
    // file header checkable rather than merely asserted.
    "PART III",
    "net agricultural income",
  ],
  "historical-ay-1961/finance-act-2016-s2-charging.txt": [
    "THE FINANCE ACT, 2016",
    "NO. 28 OF 2016",
    "MINISTRY OF LAW AND JUSTICE",
    "RATES OF INCOME-TAX",
    "commencing on the 1st day of April, 2016",
    "Part I of the First Schedule",
  ],
  "historical-ay-1961/finance-act-2016-first-schedule.txt": [
    "THE FIRST SCHEDULE",
    "(See section 2",
    "Paragraph A",
    "Rates of income-tax",
    // PINNED ON PURPOSE. Part III of this same Schedule carries rates for the FOLLOWING
    // assessment year. Its presence in the extract is what makes the Part-naming warning in the
    // file header checkable rather than merely asserted.
    "PART III",
    "net agricultural income",
  ],
  "historical-ay-1961/finance-act-2017-s2-charging.txt": [
    "THE FINANCE ACT, 2017",
    "NO. 7 OF 2017",
    "MINISTRY OF LAW AND JUSTICE",
    "RATES OF INCOME-TAX",
    "commencing on the 1st day of April, 2017",
    "Part I of the First Schedule",
  ],
  "historical-ay-1961/finance-act-2017-first-schedule.txt": [
    "THE FIRST SCHEDULE",
    "(See section 2",
    "Paragraph A",
    "Rates of income-tax",
    // PINNED ON PURPOSE. Part III of this same Schedule carries rates for the FOLLOWING
    // assessment year. Its presence in the extract is what makes the Part-naming warning in the
    // file header checkable rather than merely asserted.
    "PART III",
    "net agricultural income",
  ],
  "historical-ay-1961/finance-act-2018-s2-charging.txt": [
    "THE FINANCE ACT, 2018",
    "NO. 13 OF 2018",
    "MINISTRY OF LAW AND JUSTICE",
    "RATES OF INCOME-TAX",
    "commencing on the 1st day of April, 2018",
    "Part I of the First Schedule",
  ],
  "historical-ay-1961/finance-act-2018-first-schedule.txt": [
    "THE FIRST SCHEDULE",
    "(See section 2",
    "Paragraph A",
    "Rates of income-tax",
    // PINNED ON PURPOSE. Part III of this same Schedule carries rates for the FOLLOWING
    // assessment year. Its presence in the extract is what makes the Part-naming warning in the
    // file header checkable rather than merely asserted.
    "PART III",
    "net agricultural income",
  ],
  "historical-ay-1961/finance-act-2019-interim-s2-charging.txt": [
    "THE FINANCE ACT, 2019",
    "NO. 7 OF 2019",
    "MINISTRY OF LAW AND JUSTICE",
    "RATES OF INCOME-TAX",
    // THE INTERIM ACT'S WHOLE POINT. This Act carries NO FIRST SCHEDULE OF ITS OWN; it applies
    // the preceding Finance Act's section 2 and First Schedule to the new assessment year AND
    // SUBSTITUTES INTO THEM, including a complete replacement Part I with actual slab rates.
    // This comment read "This Act enacts no rates" until the review of PR #132 corrected it on
    // the 2014 Act and the sweep found the same claim here: no Schedule of its own is NOT no
    // rates, and the substituted Part I is operative law until the Finance (No. 2) Act
    // supersedes it. If this span ever stops matching, the previous-year -> AY -> Finance Act
    // mapping has moved.
    "The provisions of section 2 of, and the First Schedule to, the Finance Act, 2018,",
    "commencing on the 1st day of April, 2019",
  ],
  "historical-ay-1961/finance-no-2-act-2019-s2-charging.txt": [
    "THE FINANCE (NO. 2) ACT, 2019",
    "NO. 23 OF 2019",
    "MINISTRY OF LAW AND JUSTICE",
    "RATES OF INCOME-TAX",
    "commencing on the 1st day of April, 2019",
    "Part I of the First Schedule",
  ],
  "historical-ay-1961/finance-no-2-act-2019-first-schedule.txt": [
    "THE FIRST SCHEDULE",
    "(See section 2",
    "Paragraph A",
    "Rates of income-tax",
    // PINNED ON PURPOSE. Part III of this same Schedule carries rates for the FOLLOWING
    // assessment year. Its presence in the extract is what makes the Part-naming warning in the
    // file header checkable rather than merely asserted.
    "PART III",
    "net agricultural income",
  ],
  "historical-ay-1961/finance-act-2020-s2-charging.txt": [
    "THE FINANCE ACT, 2020",
    "NO. 12 OF 2020",
    "MINISTRY OF LAW AND JUSTICE",
    "RATES OF INCOME-TAX",
    "commencing on the 1st day of April, 2020",
    "Part I of the First Schedule",
  ],
  "historical-ay-1961/finance-act-2020-first-schedule.txt": [
    "THE FIRST SCHEDULE",
    "(See section 2",
    "Paragraph A",
    "Rates of income-tax",
    // PINNED ON PURPOSE. Part III of this same Schedule carries rates for the FOLLOWING
    // assessment year. Its presence in the extract is what makes the Part-naming warning in the
    // file header checkable rather than merely asserted.
    "PART III",
    "net agricultural income",
  ],
  "historical-ay-1961/finance-act-2021-s2-charging.txt": [
    "THE FINANCE ACT, 2021",
    "NO. 13 OF 2021",
    "MINISTRY OF LAW AND JUSTICE",
    "RATES OF INCOME-TAX",
    "commencing on the 1st day of April, 2021",
    "Part I of the First Schedule",
  ],
  "historical-ay-1961/finance-act-2021-first-schedule.txt": [
    "THE FIRST SCHEDULE",
    "(See section 2",
    "Paragraph A",
    "Rates of income-tax",
    // PINNED ON PURPOSE. Part III of this same Schedule carries rates for the FOLLOWING
    // assessment year. Its presence in the extract is what makes the Part-naming warning in the
    // file header checkable rather than merely asserted.
    "PART III",
    "net agricultural income",
  ],
  "historical-ay-1961/finance-act-2022-s2-charging.txt": [
    "THE FINANCE ACT, 2022",
    "No. 6 OF 2022",
    "MINISTRY OF LAW AND JUSTICE",
    "RATES OF INCOME-TAX",
    "commencing on the 1st day of April, 2022",
    "Part I of the First Schedule",
  ],
  "historical-ay-1961/finance-act-2022-first-schedule.txt": [
    "THE FIRST SCHEDULE",
    "(See section 2",
    "Paragraph A",
    "Rates of income-tax",
    // PINNED ON PURPOSE. Part III of this same Schedule carries rates for the FOLLOWING
    // assessment year. Its presence in the extract is what makes the Part-naming warning in the
    // file header checkable rather than merely asserted.
    "PART III",
    "net agricultural income",
  ],
  "historical-ay-1961/finance-act-2023-s2-charging.txt": [
    "THE FINANCE ACT, 2023",
    "No. 8 OF 2023",
    "MINISTRY OF LAW AND JUSTICE",
    "RATES OF INCOME-TAX",
    "commencing on the 1st day of April, 2023",
    "Part I of the First Schedule",
  ],
  "historical-ay-1961/finance-act-2023-first-schedule.txt": [
    "THE FIRST SCHEDULE",
    "(See section 2",
    "Paragraph A",
    "Rates of income-tax",
    // PINNED ON PURPOSE. Part III of this same Schedule carries rates for the FOLLOWING
    // assessment year. Its presence in the extract is what makes the Part-naming warning in the
    // file header checkable rather than merely asserted.
    "PART III",
    "net agricultural income",
  ],
  "historical-ay-1961/finance-act-2024-interim-s2-charging.txt": [
    "THE FINANCE ACT, 2024",
    "NO. 8 OF 2024",
    "MINISTRY OF LAW AND JUSTICE",
    "RATES OF INCOME-TAX",
    // THE INTERIM ACT'S WHOLE POINT. This Act carries NO FIRST SCHEDULE OF ITS OWN; it applies
    // the preceding Finance Act's section 2 and First Schedule to the new assessment year AND
    // SUBSTITUTES INTO THEM, including a complete replacement Part I with actual slab rates.
    // This comment read "This Act enacts no rates" until the review of PR #132 corrected it on
    // the 2014 Act and the sweep found the same claim here: no Schedule of its own is NOT no
    // rates, and the substituted Part I is operative law until the Finance (No. 2) Act
    // supersedes it. If this span ever stops matching, the previous-year -> AY -> Finance Act
    // mapping has moved.
    "The provisions of section 2 of, and the First Schedule to, the Finance Act, 2023,",
    "commencing on the 1st day of April, 2024",
  ],
  "historical-ay-1961/finance-no-2-act-2024-s2-charging.txt": [
    "THE FINANCE (No. 2) ACT, 2024",
    "No. 15 of 2024",
    "MINISTRY OF LAW AND JUSTICE",
    "RATES OF INCOME-TAX",
    "commencing on the 1st day of April, 2024",
    "Part I of the First Schedule",
  ],
  "historical-ay-1961/finance-no-2-act-2024-first-schedule.txt": [
    "THE FIRST SCHEDULE",
    "(See section 2",
    "Paragraph A",
    "Rates of income-tax",
    // PINNED ON PURPOSE. Part III of this same Schedule carries rates for the FOLLOWING
    // assessment year. Its presence in the extract is what makes the Part-naming warning in the
    // file header checkable rather than merely asserted.
    "PART III",
    "net agricultural income",
  ],
  "historical-ay-1961/finance-act-2025-s2-charging.txt": [
    "THE FINANCE ACT, 2025",
    "No. 7 of 2025",
    "MINISTRY OF LAW AND JUSTICE",
    "RATES OF INCOME-TAX",
    // ASSERTED IN THE SOURCE'S OWN WORDING, WHICH IS NOT THE SIBLINGS'. The Finance Act, 2025
    // s.2(1) reads 'the 1st April, 2025' and omits the 'day of' that every other Finance Act in
    // this corpus carries. 'the 1st day of April, 2025' DOES appear in this same extract, but in
    // s.1(2), the commencement provision — a different provision. Asserting the tidier wording
    // here would be asserting a sentence the Gazette does not contain.
    "year commencing on the 1st April, 2025, income-tax shall be charged",
    "Part I of the First Schedule",
  ],
  "historical-ay-1961/finance-act-2025-first-schedule.txt": [
    "THE FIRST SCHEDULE",
    "(See section 2",
    "Paragraph A",
    "Rates of income-tax",
    // PINNED ON PURPOSE. Part III of this same Schedule carries rates for the FOLLOWING
    // assessment year. Its presence in the extract is what makes the Part-naming warning in the
    // file header checkable rather than merely asserted.
    "PART III",
    "net agricultural income",
  ],
  // ---------------------------------------------------------------------
  // `K4-SOURCE-07` (2026-08-22).
  //
  // EVERY NEEDLE BELOW WAS TESTED AGAINST THE BUILT EXTRACT BEFORE IT WAS
  // WRITTEN HERE, and three were rejected and rewritten as a result. That is
  // the method `K4-SOURCE-06` established after five of its own extracts turned
  // out not to name their own statute, and it earned its keep again:
  //
  //   1. `CENTRAL BOARD OF DIRECT TAXES` holds for 63/2019, 32/2020, 73/2021
  //      and 62/2022 and FAILS for 26/2018, which prints the department in
  //      title case inside parentheses — `(Central Board of Direct Taxes)`.
  //      Measured in both directions, not assumed from the siblings.
  //   2. `Assessment Year 2021-22 and subsequent years.` was ABSENT from the
  //      32/2020 statute and present only in this repository's own reading
  //      notes at the top of the file. The document prints `assessment year`
  //      in LOWER CASE. Had the guard been written from the notes it would
  //      have asserted a sentence the Gazette does not contain — the exact
  //      substitution `D308` closed for whole-file matching.
  //   3. The financial year is NOT printed uniformly. 63/2019 and 73/2021
  //      print the ASSESSMENT year long (`2020-2021`, `2022-2023`) where their
  //      siblings print it short, and 73/2021 prints the FINANCIAL year long
  //      (`2021-2022`) on its English page while its HINDI page prints
  //      `2021-22`. Assert what each document says.
  // ---------------------------------------------------------------------
  "ay-2026-27/cbdt-notification-26-2018-cii-fy-2018-19.txt": [
    // Title case, in parentheses — NOT the caps its four siblings use.
    "(Central Board of Direct Taxes)",
    "In exercise of the powers conferred by clause (v)",
    "S.O. 2413(E)",
    // No space after "No." in this one, unlike 63/2019 and 32/2020.
    "Notification No.26/2018",
    // The English row, which survives intact ONLY in -raw here; see the
    // MUST_MATCH_BY_MODE entry for why -layout cannot carry it.
    '"18 2018-19 280".',
    "Assessment Year 2019-20 and subsequent years.",
  ],
  "ay-2026-27/cbdt-notification-63-2019-cii-fy-2019-20.txt": [
    "CENTRAL BOARD OF DIRECT TAXES",
    "In exercise of the powers conferred by clause (v)",
    "S.O. 3266(E)",
    "Notification No. 63/2019",
    // LONG assessment-year form. Its siblings print "2020-21".
    "Assessment Year 2020-2021 and subsequent years.",
  ],
  "ay-2026-27/cbdt-notification-32-2020-cii-fy-2020-21.txt": [
    "CENTRAL BOARD OF DIRECT TAXES",
    "In exercise of the powers conferred by clause (v)",
    "S.O. 1879(E)",
    "Notification No. 32/2020",
    // LOWER CASE "assessment year" — the only one of the five that does this.
    "apply to the assessment year 2021-22 and subsequent years.",
  ],
  "ay-2026-27/cbdt-notification-73-2021-cii-fy-2021-22.txt": [
    "CENTRAL BOARD OF DIRECT TAXES",
    "In exercise of the powers conferred by clause (v)",
    "S.O. 2336(E)",
    // Interior space after the slash: "No. 73/ 2021".
    "Notification No. 73/ 2021",
    "Assessment Year 2022-2023 and subsequent years.",
  ],
  "ay-2026-27/cbdt-notification-62-2022-cii-fy-2022-23.txt": [
    "CENTRAL BOARD OF DIRECT TAXES",
    "In exercise of the powers conferred by clause (v)",
    "S.O. 2735(E)",
    // Interior space BEFORE the slash: "No. 62 /2022".
    "Notification No. 62 /2022",
    "Assessment Year 2023-24 and subsequent years.",
  ],

  // --- the consolidated Income-tax Rules, 1962, per rule -----------------
  //
  // Each needle is a substantive fragment of the rule's own operative words.
  // Bare rule numbers (`21A.`, `3.`) were deliberately NOT used: they occur in
  // table serials, footnote markers and cross-references throughout a 629-page
  // document, so asserting one would be asserting almost nothing.
  "ay-2026-27/income-tax-rules-1962-rule-21A-21AA-section-89-relief.txt": [
    "Relief when salary is paid in arrears or in advance, etc.",
    "the relief to be granted under sub-section (1) of section 89 shall be",
    "Furnishing of particulars for claiming relief under",
    // THE 21A/21AA SPLIT, pinned. The form is prescribed by 21AA, not 21A.
    "the particulars specified in Form No. 10E",
  ],
  "ay-2026-27/income-tax-rules-1962-rule-3-perquisite-valuation.txt": [
    "Valuation of perquisites.",
    "the value of perquisites provided by the employer directly or indirec",
    "The value of residential accommodation provided by the employer",
  ],
  "ay-2026-27/income-tax-rules-1962-rule-2BB-exempt-allowances.txt": [
    "Prescribed allowances for the purposes of clause (14) of section 10.",
    "prescribed allowances, by whatever name called, shall be",
    // sub-rule (3) is on page 12. An extract cut at page 9 — which a heading
    // scan produces — would omit the new-regime restriction while looking
    // complete, so this needle is what makes the range's END load-bearing.
    "who has exercised option under sub-section (5) of section 115BAC",
  ],
  "ay-2026-27/income-tax-rules-1962-rule-11DD-specified-diseases.txt": [
    "Specified diseases and ailments for the purpose of deduction under section 80DDB.",
    "For the purposes of section 80DDB, the following shall be the eligible diseases or ailments",
    "Dementia",
  ],
  "ay-2026-27/income-tax-rules-1962-rule-11A-disability-certification.txt": [
    "Medical authority for certifying autism, cerebral palsy and multiple disabilities",
    "National Trust for Welfare of Persons with Autism, Cerebral Palsy",
  ],
  "ay-2026-27/income-tax-rules-1962-rule-6DD-cash-payment-exceptions.txt": [
    "No disallowance under sub-section (3) of section 40A shall be made",
    // The cross-reference that makes rule 6ABBA part of this rule's meaning.
    "prescribed under rule 6ABBA",
  ],
  "ay-2026-27/income-tax-rules-1962-rule-6ABBA-electronic-modes.txt": [
    "Other electronic modes.",
    "The following shall be the other electronic modes for the purposes of",
  ],
  "ay-2026-27/income-tax-rules-1962-rule-8AA-holding-period.txt": [
    "Method of determination of period of holding of capital assets in certain cases.",
    // The carve-out that makes the brief's reclassification checkable: this
    // rule EXCEPTS the assets covered by Explanation 1 to s.2(42A), which is
    // where the gift/inheritance holding period actually comes from.
    "clause (i) of the Explanation 1 to clause (42A) of section",
  ],
  "ay-2026-27/income-tax-rules-1962-rule-6G-tax-audit-report.txt": [
    "Report of audit of accounts to be furnished under section 44AB.",
    "required to be furnished under section 44AB shall",
    "shall be in Form No. 3CD",
  ],
  "ay-2026-27/income-tax-rules-1962-rule-12AB-return-furnishing-conditions.txt": [
    "Conditions for furnishing return of income by persons referred to in clause (b) of sub-section (1) of section 139.",
    // Pins it to the RETURN-FURNISHING proviso, so a later reader cannot
    // mistake the sixty-lakh figure below for a section 44AB audit threshold.
    "the seventh proviso to sub-section (1) of section 139",
    "in the business exceeds sixty lakh rupees during the previous year",
  ],
  "ay-2026-27/income-tax-rules-1962-rule-21AGA-115BAC-option.txt": [
    "Exercise of option under sub-section (6) of section 115BAC.",
    "in Form No. 10-IEA on or before the due date specified under sub-section (1) of section 139",
  ],

  // --- the consolidated Income-tax Act, 1961 (Finance Act 2026 vintage) ---
  "ay-2026-27/income-tax-act-1961-2026-vintage-identity.txt": [
    "Short title, extent and commencement.",
    "This Act may be called the Income-tax Act, 1961",
    // THE VINTAGE CLAIM, asserted from the document's own words rather than
    // from the manifest's description of it.
    "Amendments made by the Finance Act, 2026",
    "printed in italics and enclosed",
  ],
  "ay-2026-27/income-tax-act-1961-2026-s089-arrears-relief.txt": [
    "Relief when salary, etc., is paid in arrears or in advance.",
    // "as may be prescribed" is the delegation to rule 21A — the reason the
    // section alone never made the relief specifiable.
    "the Assessing Officer shall, on an application made to him in this behalf, grant such relief as may be prescribed",
  ],

  // --- the three prescribed forms ---------------------------------------
  "ay-2026-27/form-10e-section-89-relief.txt": [
    "FORM NO. 10E",
    // 21AA, NOT 21A. The acquisition brief names the pair as "Rule 21A +
    // Form 10E"; this needle is what stops that shorthand being read as the
    // form's authority.
    "[See rule 21AA]",
    "Particulars of income referred to in rule 21A of the Income-tax Rules, 1962",
  ],
  "ay-2026-27/form-3cd-section-44AB-particulars.txt": [
    "FORM NO. 3CD",
    "[See rule 6G(2)]",
    "Statement of particulars required to be furnished under",
  ],
  "ay-2026-27/form-10-iea-115BAC-option.txt": [
    "FORM No. 10-IEA",
    "[See rule 21AGA]",
    // One form serves BOTH directions; this pins the withdrawal limb.
    "or withdrawal of",
  ],

  // ===================================================================
  // K4-SOURCE-08 — the SUBSTANTIVE amending sections behind a section 89
  // lookback: s.115BAC, s.87A, and the s.112A rebate interaction.
  //
  // THESE ARE INTERIOR-PAGE EXTRACTS AND THEY DO NOT NAME THEIR OWN ACT.
  // Every K4-SOURCE-06 section-2 range deliberately starts at page 1 so the
  // extract identifies itself from the statutory text. That is impossible
  // here: these provisions sit deep inside their Acts, and the pages carry
  // only the running header ("THE GAZETTE OF INDIA EXTRAORDINARY [PART II--")
  // and a page number. Identity for this group therefore rests on a DIFFERENT
  // mechanism, and it is a real one rather than an excuse: the generated
  // header names the artifact id and its SHA-256, this checker verifies that
  // id against the manifest, and it RE-DERIVES the page range from the hashed
  // PDF. So the extract is pinned to a specific range of a specific document —
  // it simply is not self-describing in the way the page-1 extracts are, and a
  // reader should know which of the two kinds they are holding.
  //
  // THE FIRST NEEDLE OF EVERY ROW IS THAT PAGE HEADER, and it is load-bearing:
  // it is the one assertion that fails if a page range silently drifts. The
  // case varies across the corpus ("SEC. 1]" in the older Acts, "Sec. 1]" in
  // the 2024 and 2025 ones; "[PART II--" against "[Part II--"), so each is
  // taken from the document rather than copied from a sibling.
  //
  // A CANDIDATE THAT LOOKED OBVIOUS FAILED HERE AND THE FAILURE IS KEPT IN
  // MIND: "MINISTRY OF LAW AND JUSTICE" was proposed for the Finance Act, 2016
  // row by analogy with the section-2 extracts and is NOT present, because
  // page 24 is not page 1. Every needle below was tested against the BUILT
  // extract using this file's own statuteBlocks() + includes() semantics
  // before being written here — not with a whitespace-collapsing matcher,
  // which is the K4-24 defect this group was warned about.
  "historical-ay-1961/finance-act-2016-s87A-rebate.txt": [
    "24 THE GAZETTE OF INDIA EXTRAORDINARY [PART II--",
    "In section 87A of the Income-tax Act, for the words \"two thousand rupees\", the",
    "words \"five thousand rupees\" shall be substituted with effect from the 1st day of April, 2017.",
  ],
  "historical-ay-1961/finance-act-2017-s87A-rebate.txt": [
    "20 THE GAZETTE OF INDIA EXTRAORDINARY [PART II--",
    "In section 87A of the Income-tax Act, with effect from the 1st day of April, 2018,--",
    "(a) for the words \"five hundred thousand rupees\", the words \"three hundred",
    "fifty thousand rupees\" shall be substituted;",
    "the words \"two thousand five hundred rupees\" shall be substituted.",
  ],
  "historical-ay-1961/finance-act-2019-interim-s87A-rebate.txt": [
    "SEC. 1] THE GAZETTE OF INDIA EXTRAORDINARY 9",
    "In section 87A of the Income-tax Act, with effect from the 1st day of April, 2020,--",
    "(a) for the words \"three hundred fifty thousand\", the words \"five hundred",
    "thousand\" shall be substituted;",
    "(b) for the words, \"two thousand and five hundred\", the words \"twelve thousand",
    "and five hundred\" shall be substituted.",
  ],
  "historical-ay-1961/finance-act-2020-s115BAC-as-inserted.txt": [
    "SEC. 1] THE GAZETTE OF INDIA EXTRAORDINARY 33",
    "After section 115BAB of the Income-tax Act, the following sections shall be",
    "at the option of such person, be computed at the rate of tax given in the following",
  ],
  "historical-ay-1961/finance-act-2023-s87A-new-regime-proviso.txt": [
    "32 THE GAZETTE OF INDIA EXTRAORDINARY [PART II--",
    "In section 87A of the Income-tax Act, the following proviso shall be inserted with",
    "sub-section (1A) of section 115BAC, and the total income--",
    "cent. of such income-tax or an amount of twenty-five thousand rupees, whichever",
  ],
  "historical-ay-1961/finance-act-2023-s115BAC-1A-inserted.txt": [
    "SEC. 1] THE GAZETTE OF INDIA EXTRAORDINARY 33",
    "In section 115BAC of the Income-tax Act,--",
    "2021\", the figures, letters and words \"1st day of April, 2021 but before the 1st",
    "who has exercised an option under sub-section (6), for any previous",
  ],
  "historical-ay-1961/finance-no-2-act-2024-s115BAC-1A-substituted.txt": [
    "Sec. 1] THE GAZETTE OF INDIA EXTRAORDINARY 29",
    "In section 115BAC of the Income-tax Act, for sub-section (1A), the",
    "on the 1st day of April, 2024, shall be computed at the rate of tax given",
  ],
  "historical-ay-1961/finance-act-2025-s87A-rebate.txt": [
    "Sec. 1] THE GAZETTE OF INDIA EXTRAORDINARY 23",
    "In section 87A of the Income-tax Act, with effect from the 1st April, 2026,--",
    "\"twelve hundred thousand rupees\" shall be substituted;",
    "(II) for the words \"twenty-five thousand rupees\", the words",
    "not exceed the amount of income-tax payable as per the rates provided",
  ],
  "historical-ay-1961/finance-act-2025-s115BAC-1A-ay-2026-27.txt": [
    "24 THE GAZETTE OF INDIA EXTRAORDINARY [Part II--",
    "In section 115BAC of the Income-tax Act, in sub-section (1A), with effect",
    "(a) in clause (ii), the words \"or after\" shall be omitted;",
  ],
  "historical-ay-1961/finance-act-2018-s112A-rebate-and-special-rate-interaction.txt": [
    "SEC. 1] THE GAZETTE OF INDIA EXTRAORDINARY 17",
    "After section 112 of the Income-tax Act, the following section shall be inserted with",
    "referred to in sub-section (1), the rebate under section 87A shall be allowed from the",
    "income-tax on the total income as reduced by tax payable on such capital gains.",
  ],

  // ===================================================================
  // K4-SOURCE-08 — THE TWO FINANCE ACTS OF 2014, which close ASSESSMENT
  // YEAR 2014-15 and extend the lookback corpus one year earlier than the
  // Finance Act, 2015 reached.
  //
  // 2014 WAS A GENERAL-ELECTION YEAR AND PRODUCED TWO ACTS, the third such
  // pair in this corpus after 2019 and 2024. WHICH ONE CARRIES THE RATE
  // SCHEDULE WAS ESTABLISHED BY READING EACH ACT'S OWN SECTION 2, never by
  // analogy with the later pairs:
  //
  //   - the INTERIM Finance Act, 2014 (NO. 11 OF 2014) is titled "An Act to
  //     CONTINUE the existing rates", and its s.2 applies section 2 of, and
  //     the First Schedule to, the FINANCE ACT, 2013 to the year commencing
  //     1 April 2014 — AND SUBSTITUTES A COMPLETE NEW PART I, with actual slab
  //     rates, into that Schedule ("for Part I, the following Part I shall be
  //     substituted"). "THE FIRST SCHEDULE" occurs ZERO times in the artifact,
  //     scanned rather than assumed, which settles that it has no Schedule OF
  //     ITS OWN and nothing more. This comment said it enacts no rates of its
  //     own until the review of PR #132 caught it.
  //   - the Finance (No. 2) Act, 2014 (NO. 25 OF 2014) s.2(1) charges tax
  //     "for the assessment year commencing on the 1st day of April, 2014
  //     ... at the rates specified in Part I of the First Schedule".
  //
  // SO AY 2014-15 IS THE FINANCE (No. 2) ACT, 2014, and the interim Act's
  // needles pin the INCORPORATION SENTENCE rather than any rate — because
  // the incorporation is the whole content of that Act, and because it
  // names the FINANCE ACT, 2013, WHICH THIS REPOSITORY DOES NOT HOLD.
  //
  // THE INTERIM ACT CARRIES A TRAP THE OTHERS DO NOT. Its page 3 opens a
  // block reading '"PART I' / "INCOME-TAX" that looks exactly like a First
  // Schedule Part I and is SUBSTITUTED TEXT QUOTED INSIDE SECTION 2. The
  // zero-occurrence scan for "THE FIRST SCHEDULE" is what settles it, and
  // it is why no Part I needle is pinned for that file.

  "historical-ay-1961/finance-act-2014-interim-s2-charging.txt": [
    "THE FINANCE ACT, 2014",
    "NO. 11 OF 2014",
    "MINISTRY OF LAW AND JUSTICE",
    "RATES OF INCOME-TAX",
    "An Act to continue the existing rates of income-tax for the financial year 2014-2015.",
    "The provisions of section 2 of, and the First Schedule to, the Finance Act, 2013, shall",
    "year commencing on the 1st day of April, 2014, as they apply in relation to income-tax for the",
  ],
  "historical-ay-1961/finance-no-2-act-2014-s2-charging.txt": [
    "THE FINANCE (No. 2) ACT, 2014",
    "NO. 25 OF 2014",
    "MINISTRY OF LAW AND JUSTICE",
    "RATES OF INCOME-TAX",
    "commencing on the 1st day of April, 2014, income-tax shall be charged at the rates specified",
    "in Part I of the First Schedule",
  ],
  "historical-ay-1961/finance-no-2-act-2014-first-schedule.txt": [
    "THE FIRST SCHEDULE",
    "(See section 2",
    "Paragraph A",
    "Rates of income-tax",
    "PART III",
  ],
};

// K4-SOURCE-04 / review `3830016816`: the exact CII row is independently
// load-bearing in two resolved table modes. Checking the concatenated statute
// would let the -raw occurrence conceal a corrupted -layout row when the PDF is
// absent in CI, so pin the row inside EACH named block.
const CATEGORY_A_UPLOAD_BLOCK = /Return will not be allowed to be uploaded/;
const CATEGORY_B_POSSIBLE_DEFECT = /possible defect present in the return u\/s 139\(9\)/;
const CATEGORY_D_CLAIM_FORMS = /respective\s+claim\s+forms or particulars/;

const ITR2_CORRIGENDUM_ALL_NINE = [
  /row B\(5\)\(e\) of schedule CG,[\s\S]*?"6c - 6d"[\s\S]*?"5c - 5d"[\s\S]*?shall be substituted/,
  /marginal heading of row E,[\s\S]*?"B12a"[\s\S]*?"B11a"/,
  /table F grey colour of the blank cells shall be removed/,
  /schedule-112A, column \(1b\) shall be omitted/,
  /schedule-115AD\(1\)\(b\)\(iii\) proviso, column \(1b\) shall be omitted/,
  /row 2\(d\), for the words "dxx", the words "dxxi" shall be substituted/,
  /row 10\(3b\), grey colour of the blank cells[\s\S]*?"upto 15\/6"[\s\S]*?"from 16\/6 to 15\/9"[\s\S]*?shall be removed/,
  /row xi of schedule CFL,[\s\S]*?"2xv"[\s\S]*?"2xiv"[\s\S]*?substituted/,
  /row 11 of part B-TI,[\s\S]*?letter "w", letter "v" shall be substituted/,
];

const ITR3_CORRIGENDUM_ALL_THREE = [
  /"i\. Total\s+\(ic \+ ii\)"[\s\S]*?"Total \(ic \+ ii\)" shall be substituted/,
  /"B13a" shall be substituted "B12a"/,
  /grey colour of the blank cells under column "upto 15\/6"[\s\S]*?"from 16\/6 to 15\/9" shall be removed/,
];

const ITR2_SCHEMA_CHANGE_LAYOUT = [
  /1\.[\s\S]{0,160}Modified[\s\S]{0,100}OthersIncDtlEI[\s\S]{0,100}SubCategory[\s\S]{0,100}Description and Enum[\s\S]{0,100}Updated/,
  /2\.\s+OthersIncDtlEI\s+Description\s+Modified[\s\S]{0,120}New field added/,
  /1\. ScheduleCGFor23/,
  /2\. ScheduleCYLA/,
  /3\. ScheduleBFLA/,
  /4\. ScheduleSI/,
  /(?:EditAutopoulatedDetail[\s\S]*?){4}/,
  /(?:Tag Added[\s\S]*?){4}/,
  /(?:New Field Added[\s\S]*?){4}/,
];

const ITR2_SCHEMA_CHANGE_DEFAULT = [
  /(?:OthersIncDtlEI[\s\S]*?){2}/,
  /OthersIncDtlEI[\s\S]*?SubCategory[\s\S]*?Change Modified[\s\S]*?2\.[\s\S]*?OthersIncDtlEI[\s\S]*?Description[\s\S]*?Modified[\s\S]*?Change Description[\s\S]*?Description and Enum Updated[\s\S]*?New field added/,
  /1\. ScheduleCGFor23 2\. ScheduleCYLA 3\. ScheduleBFLA 4\. ScheduleSI/,
  /(?:EditAutopoulatedDetail[\s\S]*?){4}/,
  /(?:Tag Added[\s\S]*?){4}/,
  /(?:New Field Added[\s\S]*?){4}/,
];

const ITR2_SCHEMA_CHANGE_RAW = [
  /1\. OthersIncDtlEI SubCategory Modified Description and Enum\s+Updated/,
  /2\. OthersIncDtlEI Description Modified New field added/,
  /1\. ScheduleCGFor23 EditAutopoulatedDetail Tag Added New Field Added/,
  /2\. ScheduleCYLA EditAutopoulatedDetail Tag Added New Field Added/,
  /3\. ScheduleBFLA EditAutopoulatedDetail Tag Added New Field Added/,
  /4\. ScheduleSI EditAutopoulatedDetail Tag Added New Field Added/,
];

const TWO_ROW_EXEMPT_SCHEMA_COLUMNAR = (root) => [
  new RegExp(`(?:${root}[\\s\\S]*?){2}`),
  /SubCategory/,
  /Description/,
  /(?:Modified[\s\S]*?){2}/,
  /Description and Enum[\s\S]*?Updated/,
  /New field added/,
];

const ITR3_SCHEMA_CHANGE_COLUMNAR = [
  /ScheduleTDS2/,
  /ScheduleTDS3/,
  /(?:TDSSection[\s\S]*?){2}/,
  /(?:Modified[\s\S]*?){2}/,
  /(?:Description and Enum[\s\S]*?Updated[\s\S]*?){2}/,
];

const NOTIFICATION_57_ALL_CORRECTIONS = [
  /Schedule-IT Details of Advance Tax and Self-Assessment Tax payments/,
  /BSR Code/,
  /Date of Deposit/,
  /Serial Number of Challan/,
  /Tax paid/,
  /sub-row \(ii\) shall be renumbered as sub-row \(iii\)/,
  /for the letters "Iva", the letters\s+"iva" shall be substituted/,
];

const formSubstitution = (form) => new RegExp(`for FORM ${form}, the following\\s+FORM shall\\s+be\\s+substituted`);

const SECTION_55_COST_BASES = [
  /acquired before\s+the 1st day of February, 2018, shall be higher\s+of/,
  /\(i\) the cost of acquisition of such asset; and/,
  /\(ii\) lower of/,
  /\(A\) the fair market value of such asset; and/,
  /\(B\) the full value of consideration received or accruing as a result of the transfer of/,
  /fair market value of the asset on\s+the 1st day of April, 2001, at the option of the\s+assessee/,
  /being land or building or both, the fair market value of such asset on the 1st day[\s\S]*?shall not exceed the stamp\s+duty value/,
];

const MUST_MATCH_BY_MODE = {
  // K4-23. PER-MODE, deliberately, and NOT uniformly across the three files.
  // The K4-SOURCE-04 review established why a whole-file needle is not enough:
  // MUST_CONTAIN searches the concatenation of every mode, so a row present in
  // `-raw` alone satisfies it while `-layout` carries something else entirely.
  //
  // 44/2017 IS PINNED IN `raw` ONLY, AND THAT IS A FINDING RATHER THAN A GAP.
  // Its `-layout` extraction MISRENDERS the table exactly as
  // official-source-retrieval.md §3.2 warns: it prints "2  2001-02  105" and
  // "3  2001-02  109", pairing serial 2 and serial 3 with the SAME financial
  // year and with the NEXT year's index. A naive `-layout` read of this file
  // would take FY 2001-02's index to be 105 or 109 instead of 100. `-raw`
  // pairs all seventeen rows correctly. Pinning the wrong pairing to satisfy
  // a symmetry with the other two files would be committing a false reading,
  // so the asymmetry is kept and explained.
  "ay-2026-27/cbdt-notification-44-2017-cii-fy-2001-02-to-2017-18.txt": {
    raw: [
      /^\s*1 2001-02 100\s*$/m,
      /^\s*12 2012-13 200\s*$/m,
      /^\s*17 2017-18 272\s*$/m,
    ],
  },
  "ay-2026-27/cbdt-notification-39-2023-cii-fy-2023-24.txt": {
    layout: [/^\s*"23\s+2023-24\s+348"\.$/m],
    raw: [/^\s*"23\s+2023-24\s+348"\s*$/m],
  },
  "ay-2026-27/cbdt-notification-44-2024-cii-fy-2024-25.txt": {
    layout: [/^\s*"24\s+2024-25\s+363"\s*$/m],
    raw: [/^\s*"24\s+2024-25\s+363"\s*$/m],
  },
  "ay-2026-27/cbdt-notification-70-2025-cii-fy-2025-26.txt": {
    layout: [/^\s*"25\s+2025-26\s+376"\.$/m],
    raw: [/^\s*"25\s+2025-26\s+376"\.$/m],
  },
  // K4-SOURCE-05. These are technical tables, not statute. Each extract is
  // pinned in every mode because the session read every load-bearing span in
  // all three modes. Where a mode separates columns, assert the exact stable
  // token rather than inventing a row that the rendering does not carry.
  "ay-2026-27/itr-output/itr-1-schema-change-v1.1.txt": {
    layout: TWO_ROW_EXEMPT_SCHEMA_COLUMNAR("ExemptIncAgriOthUs10"),
    default: TWO_ROW_EXEMPT_SCHEMA_COLUMNAR("ExemptIncAgriOthUs10"),
    raw: [/1\.[\s\S]*?ExemptIncAgriOthUs10[\s\S]*?SubCategory Modified Description and Enum\s+Updated/, /2\.[\s\S]*?ExemptIncAgriOthUs10[\s\S]*?Description Modified New field added/],
  },
  "ay-2026-27/itr-output/itr-1-validation-rules-v1.0-sample.txt": {
    layout: [CATEGORY_A_UPLOAD_BLOCK, CATEGORY_B_POSSIBLE_DEFECT, CATEGORY_D_CLAIM_FORMS, /Sum of deductions claimed u\/s 80C, 80CCC & 80CCD/],
    default: [CATEGORY_A_UPLOAD_BLOCK, CATEGORY_B_POSSIBLE_DEFECT, CATEGORY_D_CLAIM_FORMS, /Sum of deductions claimed u\/s 80C, 80CCC & 80CCD/],
    raw: [CATEGORY_A_UPLOAD_BLOCK, CATEGORY_B_POSSIBLE_DEFECT, CATEGORY_D_CLAIM_FORMS, /Sum of deductions claimed u\/s 80C, 80CCC & 80CCD/],
  },
  "ay-2026-27/itr-output/itr-4-schema-change-v1.1.txt": {
    layout: TWO_ROW_EXEMPT_SCHEMA_COLUMNAR("ExemptUs10"),
    default: TWO_ROW_EXEMPT_SCHEMA_COLUMNAR("ExemptUs10"),
    raw: [/1\. ExemptUs10 SubCategory Modified Description and Enum/, /2\. ExemptUs10 Description Modified New field added/],
  },
  "ay-2026-27/itr-output/itr-4-validation-rules-v1.0-sample.txt": {
    layout: [CATEGORY_A_UPLOAD_BLOCK, CATEGORY_B_POSSIBLE_DEFECT, CATEGORY_D_CLAIM_FORMS, /Income u\/s 44AD, 44ADA, 44AE is disclosed/],
    default: [CATEGORY_A_UPLOAD_BLOCK, CATEGORY_B_POSSIBLE_DEFECT, CATEGORY_D_CLAIM_FORMS, /Income u\/s 44AD, 44ADA, 44AE is disclosed/],
    raw: [CATEGORY_A_UPLOAD_BLOCK, CATEGORY_B_POSSIBLE_DEFECT, CATEGORY_D_CLAIM_FORMS, /Income u\/s 44AD, 44ADA, 44AE is disclosed/],
  },
  "ay-2026-27/itr-output/itr-2-schema-change-v1.2.txt": {
    layout: ITR2_SCHEMA_CHANGE_LAYOUT,
    default: ITR2_SCHEMA_CHANGE_DEFAULT,
    raw: ITR2_SCHEMA_CHANGE_RAW,
  },
  "ay-2026-27/itr-output/itr-2-validation-rules-v1.0-sample.txt": {
    layout: [CATEGORY_A_UPLOAD_BLOCK, CATEGORY_D_CLAIM_FORMS, /Assessee should enter valid Mobile Number/, /Name of the taxpayer does not match with the "Name" as per the PAN database/],
    default: [CATEGORY_A_UPLOAD_BLOCK, CATEGORY_D_CLAIM_FORMS, /Assessee should enter valid Mobile Number/, /Name of the taxpayer does not match with the "Name" as per the PAN database/],
    raw: [CATEGORY_A_UPLOAD_BLOCK, CATEGORY_D_CLAIM_FORMS, /1\. Assessee should enter valid Mobile Number/, /Name of the taxpayer does not match with the "Name" as per the PAN database/],
  },
  "ay-2026-27/itr-output/itr-3-schema-change-v1.1.txt": {
    layout: ITR3_SCHEMA_CHANGE_COLUMNAR,
    default: ITR3_SCHEMA_CHANGE_COLUMNAR,
    raw: [/ScheduleTDS2\s+TDSSection Modified Description and Enum\s+Updated/, /ScheduleTDS3\s+TDSSection Modified Description and Enum\s+Updated/],
  },
  "ay-2026-27/itr-output/itr-3-validation-rules-v1.0-sample.txt": {
    layout: [CATEGORY_A_UPLOAD_BLOCK, CATEGORY_B_POSSIBLE_DEFECT, CATEGORY_D_CLAIM_FORMS, /HUF cannot claim relief u\/s 89/],
    default: [CATEGORY_A_UPLOAD_BLOCK, CATEGORY_B_POSSIBLE_DEFECT, CATEGORY_D_CLAIM_FORMS, /HUF cannot claim relief u\/s 89/],
    raw: [CATEGORY_A_UPLOAD_BLOCK, CATEGORY_B_POSSIBLE_DEFECT, CATEGORY_D_CLAIM_FORMS, /2\. HUF cannot claim relief u\/s 89/],
  },
  "ay-2026-27/itr-output/notification-45-2026-itr-1-opening.txt": {
    layout: [/Income-tax \(Second Amendment\) Rules, 2026/, formSubstitution("ITR-1")],
    default: [/Income-tax \(Second Amendment\) Rules, 2026/, formSubstitution("ITR-1")],
    raw: [/Income-tax \(Second Amendment\) Rules, 2026/, formSubstitution("ITR-1")],
  },
  "ay-2026-27/itr-output/notification-45-2026-itr-4-opening.txt": {
    layout: [formSubstitution("ITR-4"), /For Individuals, HUFs and Firms \(other than LLP\)/],
    default: [formSubstitution("ITR-4"), /For Individuals, HUFs and Firms \(other than LLP\)/],
    raw: [formSubstitution("ITR-4"), /For Individuals, HUFs and Firms \(other than LLP\)/],
  },
  "ay-2026-27/itr-output/notification-46-2026-itr-2-opening.txt": {
    layout: [/Income-tax \(Third Amendment\) Rules, 2026/, formSubstitution("ITR-2")],
    default: [/Income-tax \(Third Amendment\) Rules, 2026/, formSubstitution("ITR-2")],
    raw: [/Income-tax \(Third Amendment\) Rules, 2026/, formSubstitution("ITR-2")],
  },
  "ay-2026-27/itr-output/notification-47-2026-itr-3-opening.txt": {
    layout: [/Income-tax \(Fourth Amendment\) Rules, 2026/, formSubstitution("ITR-3")],
    default: [/Income-tax \(Fourth Amendment\) Rules, 2026/, formSubstitution("ITR-3")],
    raw: [/Income-tax \(Fourth Amendment\) Rules, 2026/, formSubstitution("ITR-3")],
  },
  "ay-2026-27/itr-output/notification-57-2026-corrigendum-itr-1-itr-4.txt": {
    layout: NOTIFICATION_57_ALL_CORRECTIONS,
    default: NOTIFICATION_57_ALL_CORRECTIONS,
    raw: NOTIFICATION_57_ALL_CORRECTIONS,
  },
  "ay-2026-27/itr-output/notification-58-2026-corrigendum-itr-2.txt": {
    layout: ITR2_CORRIGENDUM_ALL_NINE,
    default: ITR2_CORRIGENDUM_ALL_NINE,
    raw: ITR2_CORRIGENDUM_ALL_NINE,
  },
  "ay-2026-27/itr-output/notification-59-2026-corrigendum-itr-3.txt": {
    layout: ITR3_CORRIGENDUM_ALL_THREE,
    default: ITR3_CORRIGENDUM_ALL_THREE,
    raw: ITR3_CORRIGENDUM_ALL_THREE,
  },
  "ay-2026-27/income-tax-act-1961-s055-cost-of-acquisition.txt": {
    layout: SECTION_55_COST_BASES,
    default: SECTION_55_COST_BASES,
    raw: SECTION_55_COST_BASES,
  },
  "ay-2026-27/income-tax-act-1961-s112a-listed-equity-ltcg.txt": {
    layout: [/long-term capital asset being an equity share/, /one lakh twenty-five thousand rupees/, /twelve and one-half per cent/, /on or after the 23rd day of July, 2024/],
    default: [/long-term capital asset being an equity share/, /one lakh twenty-five thousand rupees/, /twelve and one-half per cent/, /on or after the 23rd day of July, 2024/],
    raw: [/long-term capital asset being an equity share/, /one lakh twenty-five thousand rupees/, /twelve and one-half per cent/, /on or after the 23rd day of July, 2024/],
  },
  // `K4-SOURCE-07`. The five outstanding CII notifications, pinned PER MODE
  // for the reason the K4-SOURCE-04 review established: MUST_CONTAIN searches
  // the concatenation of every mode, so a row intact in one mode satisfies it
  // while another mode carries something different.
  //
  // 26/2018 IS PINNED IN `raw` ONLY, AND THE ASYMMETRY IS A FINDING.
  // Its `-layout` extraction breaks the inserted row across two lines and puts
  // the VALUE ABOVE ITS OWN ROW LABEL:
  //
  //        Sl. No.  Financial Year          Cost Inflation Index
  //                                                280".
  //         "18       2018-19
  //
  // A naive `-layout` read pairs 280 with the header rather than with serial
  // 18. `-raw` renders it as one line and is pinned instead. This is exactly
  // the §3.2 hazard that 44/2017 carries in a different shape, and it is kept
  // and explained rather than smoothed into a false symmetry.
  //
  // 73/2021 PRINTS THE FINANCIAL YEAR LONG — `2021-2022` — with a SPACE after
  // the opening quote, on its English page. Its HINDI page prints `2021-22`.
  // The two pages of one instrument disagree on format, so a pattern written
  // from the compact form would be asserting the Hindi page.
  "ay-2026-27/cbdt-notification-26-2018-cii-fy-2018-19.txt": {
    raw: [/^\s*"18 2018-19 280"\.$/m],
  },
  "ay-2026-27/cbdt-notification-63-2019-cii-fy-2019-20.txt": {
    layout: [/^\s*"19\s+2019-20\s+289"\.$/m],
  },
  "ay-2026-27/cbdt-notification-32-2020-cii-fy-2020-21.txt": {
    layout: [/^\s*"20\s+2020-21\s+301"\.$/m],
  },
  "ay-2026-27/cbdt-notification-73-2021-cii-fy-2021-22.txt": {
    layout: [/^\s*" 21\s+2021-2022\s+317"\.$/m],
  },
  "ay-2026-27/cbdt-notification-62-2022-cii-fy-2022-23.txt": {
    layout: [/^\s*"22\s+2022-23\s+331"$/m],
  },

  // ===================================================================
  // K4-SOURCE-08 — THE NEW-REGIME RATE TABLES, PINNED IN `raw` ONLY.
  //
  // THIS IS THE 44/2017 SITUATION AGAIN, ON A MORE LOAD-BEARING TABLE. The
  // Finance Act, 2020 s.53 table — the s.115BAC rates as first enacted, which
  // govern AY 2021-22, AY 2022-23 and AY 2023-24 — is MISRENDERED BY `-layout`
  // exactly as official-source-retrieval.md §3.2 warns. `-layout` prints both
  // "Nil" and "5 per cent." against "Up to Rs. 2,50,000" and then pairs
  // "From Rs. 2,50,001 to Rs. 5,00,000" with "10 per cent." — so every band
  // below the first is offset by one row and the second band reads DOUBLE its
  // enacted rate. `-raw` pairs all seven rows correctly.
  //
  // A whole-file MUST_CONTAIN needle cannot catch that, because MUST_CONTAIN
  // searches the concatenation of every mode: the correct row exists in `raw`
  // and satisfies the assertion while `-layout` carries the wrong pairing.
  // Pinning PER MODE is the only assertion that says which rendering was read.
  //
  // ALL FOUR new-regime tables are pinned the same way, not just the one known
  // to misrender. The AY 2024-25 table is pinned TWICE — once in the Finance
  // Act, 2023 that inserted it and once in the Finance (No. 2) Act, 2024 that
  // re-enacted it verbatim as limb (i) — so the two Gazette artifacts are
  // asserted to agree. That corroboration is free here and available for no
  // other year in the corpus.
  //
  // EACH TABLE IS ONE CONTIGUOUS ORDERED BLOCK, NOT A SET OF PER-ROW PATTERNS,
  // AND THE REVIEW OF PR #132 IS WHY. The first version listed rows
  // individually, and that was weaker than the prose above it claimed in two
  // ways at once. It did not assert every row — rows 3-6 of the AY 2024-25
  // table and row 5 of the AY 2025-26 table were unpinned — so deleting or
  // corrupting them left the gate GREEN while the two 'agreeing' Gazette
  // tables no longer agreed. And because both tables live in ONE extract and
  // share row 1 verbatim ('1. Upto Rs. 3,00,000 Nil'), a single-occurrence
  // pattern was satisfied by either table, so it could not tell them apart at
  // all.
  //
  // A whole-block pattern fixes both: it pins every row, pins their ORDER, and
  // pins the grouping into two distinct tables — the two blocks are told apart
  // by their row-2 bounds (6,00,000 against 7,00,000) and by their closing
  // punctuation (';' against '".'), which the Act itself supplies. A claim
  // that two sources corroborate each other has to be checked on every row it
  // covers, or it is a claim about the two rows someone happened to list.
  "historical-ay-1961/finance-act-2020-s115BAC-as-inserted.txt": {
    raw: [
      /^1\. Up to Rs\. 2,50,000 Nil\n2\. From Rs\. 2,50,001 to Rs\. 5,00,000 5 per cent\.\n3\. From Rs\. 5,00,001 to Rs\. 7,50,000 10 per cent\.\n4\. From Rs\. 7,50,001 to Rs\. 10,00,000 15 per cent\.\n5\. From Rs\. 10,00,001 to Rs\. 12,50,000 20 per cent\.\n6\. From Rs\. 12,50,001 to Rs\. 15,00,000 25 per cent\.\n7\. Above Rs\. 15,00,000 30 per cent\.:$/m,
    ],
  },
  "historical-ay-1961/finance-act-2023-s115BAC-1A-inserted.txt": {
    raw: [
      /^1\. Upto Rs\.3,00,000 Nil\n2\. From Rs\.3,00,001 to Rs\.6,00,000 5 per cent\.\n3\. From Rs\.6,00,001 to Rs\.9,00,000 10 per cent\.\n4\. From Rs\.9,00,001 to Rs\.12,00,000 15 per cent\.\n5\. From Rs\.12,00,001 to Rs\.15,00,000 20 per cent\.\n6\. Above Rs\.15,00,000 30 per cent\.";$/m,
    ],
  },
  "historical-ay-1961/finance-no-2-act-2024-s115BAC-1A-substituted.txt": {
    raw: [
      /^1\. Upto Rs\. 3,00,000 Nil\n2\. From Rs\. 3,00,001 to Rs\. 6,00,000 5 per cent\.\n3\. From Rs\. 6,00,001 to Rs\. 9,00,000 10 per cent\.\n4\. From Rs\. 9,00,001 to Rs\. 12,00,000 15 per cent\.\n5\. From Rs\. 12,00,001 to Rs\. 15,00,000 20 per cent\.\n6\. Above Rs\. 15,00,000 30 per cent\.;$/m,
      /^1\. Upto Rs\. 3,00,000 Nil\n2\. From Rs\. 3,00,001 to Rs\. 7,00,000 5 per cent\.\n3\. From Rs\. 7,00,001 to Rs\. 10,00,000 10 per cent\.\n4\. From Rs\. 10,00,001 to Rs\. 12,00,000 15 per cent\.\n5\. From Rs\. 12,00,001 to Rs\. 15,00,000 20 per cent\.\n6\. Above Rs\. 15,00,000 30 per cent\."\.$/m,
    ],
  },
  "historical-ay-1961/finance-act-2025-s115BAC-1A-ay-2026-27.txt": {
    raw: [
      /^1\. Upto Rs\. 4,00,000 Nil\n2\. From Rs\. 4,00,001 to Rs\. 8,00,000 5 per cent\.\n3\. From Rs\. 8,00,001 to Rs\. 12,00,000 10 per cent\.\n4\. From Rs\. 12,00,001 to Rs\. 16,00,000 15 per cent\.\n5\. From Rs\. 16,00,001 to Rs\. 20,00,000 20 per cent\.\n6\. From Rs\. 20,00,001 to Rs\. 24,00,000 25 per cent\.\n7\. Above Rs\. 24,00,000 30 per cent\."\.$/m,
    ],
  },
};

/**
 * The `pdftotext` OUTPUT of an extract, without the project-authored header and
 * reading notes wrapped around it.
 *
 * `MAINT-03` found that searching the whole file lets this gate pass off THIS
 * REPOSITORY'S OWN PROSE: a reading note legitimately quotes the statute it is
 * warning about, so a needle present in nothing but a note would report the
 * evidence base as still carrying its cited text. It caught a real instance
 * immediately — "Specified profession as referred to in section 62(4)" is a note
 * in `ita-2025-s058-s063`, and in the extraction itself the phrase is broken
 * across a line, so the needle would have been satisfied by the warning rather
 * than by the Act.
 *
 * A file with no `BEGIN pdftotext` block yields the empty string, so its needles
 * all fail — a malformed extract fails closed rather than passing on its header.
 */
function statuteBlocks(raw) {
  const blocks = new Map();
  let current = null;
  let mode = null;
  for (const line of raw.split(/\r?\n/)) {
    const begin = line.match(/^BEGIN pdftotext (?:-(layout|raw)|\(default mode, no flags\))$/);
    if (begin) {
      current = [];
      mode = begin[1] ?? "default";
      continue;
    }
    if (/^END pdftotext /.test(line)) {
      if (current !== null && mode !== null) {
        const modeBlocks = blocks.get(mode) ?? [];
        modeBlocks.push(current.join("\n"));
        blocks.set(mode, modeBlocks);
      }
      current = null;
      mode = null;
      continue;
    }
    if (current !== null) current.push(line);
  }
  return blocks;
}

function normalizeStatuteBlock(text) {
  return text
    .replace(/\r\n/g, "\n")
    // AUDIT-14 measured exactly one compatibility-glyph delta: `½`. Keep the
    // exception that narrow; whole-string NFKC would also make full-width
    // digits compare equal and could hide a changed statutory figure.
    .replace(/½/g, "1⁄2")
    .replace(/^={78}\n/, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n+$/, "");
}

function firstDifferentLine(committed, fresh) {
  const have = committed.split("\n");
  const want = fresh.split("\n");
  const count = Math.max(have.length, want.length);
  for (let i = 0; i < count; i++) {
    if (have[i] !== want[i]) {
      return `line ${i + 1}\n      committed ${JSON.stringify(have[i] ?? "<missing>")}\n      fresh     ${JSON.stringify(want[i] ?? "<missing>")}`;
    }
  }
  return "different byte sequence";
}

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const byId = new Map(manifest.artifacts.map((a) => [a.id, a]));
const problems = [];
const artifactHashes = new Map();
const absentArtifacts = new Set();
let absentExtracts = 0;
let rederivedExtracts = 0;

function walk(dir, base = dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return walk(p, base);
    return n.endsWith(".txt") ? [relative(base, p).replace(/\\/g, "/")] : [];
  });
}

const found = walk(EXTRACTS).sort();
if (found.length === 0) problems.push("no extracts found at all");

const field = (text, label) => {
  const m = text.match(new RegExp(`^${label}\\s*:\\s*(.+)$`, "m"));
  return m ? m[1].trim() : null;
};

for (const rel of found) {
  const text = readFileSync(join(EXTRACTS, rel), "utf8");
  const id = field(text, "Artifact id");
  const sha = field(text, "Artifact sha256");
  const rank = field(text, "Source rank");
  const publisher = field(text, "Publisher");

  if (!id) {
    problems.push(`${rel}: no "Artifact id" header`);
    continue;
  }
  const artifact = byId.get(id);
  if (!artifact) {
    problems.push(`${rel}: names artifact ${id}, which the manifest does not declare`);
    continue;
  }
  if (sha !== artifact.sha256) {
    problems.push(
      `${rel}: sha256 disagrees with the manifest\n    extract  ${sha}\n    manifest ${artifact.sha256}\n` +
        `    -> the artifact was replaced; regenerate with build-statutory-extracts.mjs`,
    );
  }
  const wantRank = String(artifact.sourceRank);
  if (rank !== wantRank) {
    problems.push(`${rel}: source rank "${rank}" disagrees with the manifest's "${wantRank}"`);
  }
  if (publisher !== artifact.publisher) {
    problems.push(`${rel}: publisher disagrees with the manifest`);
  }
  const blocks = statuteBlocks(text);
  const statute = [...blocks.values()].flat().join("\n");
  for (const needle of MUST_CONTAIN[rel] ?? []) {
    if (!statute.includes(needle)) {
      problems.push(
        `${rel}: load-bearing text is MISSING from the extracted statute: ${JSON.stringify(needle)}` +
          (text.includes(needle)
            ? `\n    -> it IS present in this file, but only in the header or the reading notes, ` +
              `which are this repository's own prose and are not evidence.`
            : ""),
      );
    }
  }
  for (const [mode, patterns] of Object.entries(MUST_MATCH_BY_MODE[rel] ?? {})) {
    const modeStatute = (blocks.get(mode) ?? []).join("\n");
    for (const pattern of patterns) {
      if (!pattern.test(modeStatute)) {
        problems.push(
          `${rel}: load-bearing row is MISSING from the ${mode} extraction block: ${pattern}`,
        );
      }
    }
  }
  if (!(rel in MUST_CONTAIN)) {
    problems.push(`${rel}: has no load-bearing-text assertions — add them to MUST_CONTAIN`);
  }

  const spec = SPEC_BY_OUT.get(rel);
  if (!spec) {
    problems.push(`${rel}: has no page-range specification in build-statutory-extracts.mjs`);
    continue;
  }
  if (spec.artifactId !== id) {
    problems.push(`${rel}: builder names ${spec.artifactId}, but the extract header names ${id}`);
    continue;
  }
  const pdf = join(SOURCES, artifact.file);
  if (!existsSync(pdf)) {
    absentArtifacts.add(id);
    absentExtracts++;
    continue;
  }
  let actualHash = artifactHashes.get(id);
  if (!actualHash) {
    actualHash = createHash("sha256").update(readFileSync(pdf)).digest("hex");
    artifactHashes.set(id, actualHash);
  }
  if (actualHash !== artifact.sha256) {
    problems.push(
      `${rel}: local artifact sha256 DRIFT\n    manifest ${artifact.sha256}\n    on disk  ${actualHash}\n` +
        `    -> refusing to compare an extract against unregistered artifact bytes`,
    );
    continue;
  }
  let fresh;
  try {
    fresh = extractModes(pdf, spec.onlyPages, spec.pages);
  } catch (error) {
    problems.push(`${rel}: could not re-run pdftotext: ${error instanceof Error ? error.message : String(error)}`);
    continue;
  }
  let rederivationMatches = true;
  for (const mode of ["layout", "default", "raw"]) {
    const modeBlocks = blocks.get(mode) ?? [];
    if (modeBlocks.length !== 1) {
      problems.push(`${rel}: ${modeBlocks.length} committed pdftotext ${mode} blocks; expected exactly 1`);
      rederivationMatches = false;
      continue;
    }
    const committed = normalizeStatuteBlock(modeBlocks[0]);
    const regenerated = normalizeStatuteBlock(fresh[mode]);
    if (committed !== regenerated) {
      rederivationMatches = false;
      problems.push(
        `${rel}: committed pdftotext ${mode} block differs from fresh artifact extraction at ` +
          firstDifferentLine(committed, regenerated),
      );
    }
  }
  if (rederivationMatches) rederivedExtracts++;
}

for (const spec of EXTRACT_SPECS) {
  if (!found.includes(spec.out)) problems.push(`${spec.out}: builder specifies an extract that is not committed`);
}

// The index must list every extract, and list nothing that does not exist.
if (!existsSync(README)) {
  problems.push("extracts/README.md (the index) is missing");
} else {
  const index = readFileSync(README, "utf8");
  for (const rel of found) {
    if (!index.includes(rel)) problems.push(`extracts/README.md does not list ${rel}`);
  }
  for (const m of index.matchAll(/\(([a-z0-9-]+\/[a-z0-9-]+\.txt)\)/gi)) {
    if (!found.includes(m[1])) problems.push(`extracts/README.md lists ${m[1]}, which does not exist`);
  }
}

// ── Recoverability report — a standing count, not a pass/fail. ──────────────
//
// An artifact is recoverable if ANY of three things is true: it has a fetchable
// URL, its text is committed here, or the OWNER holds it off-repository.
//
// The third was added by the owner on 2026-08-15 for the two ICAI editions, and
// it is read from a manifest FIELD rather than left as prose on purpose: **a
// mitigation only a human can see is one the next session re-raises as a risk.**
// This report is the thing a future session will actually read, so the fact has
// to live where the report can reach it.
const extracted = new Set(
  found.map((rel) => field(readFileSync(join(EXTRACTS, rel), "utf8"), "Artifact id")),
);
const hasUrl = (a) => String(a.url ?? "").startsWith("http");
const covered = (a) => hasUrl(a) || extracted.has(a.id) || a.ownerBackup === true;
const stranded = manifest.artifacts.filter((a) => !covered(a));
const backedUp = manifest.artifacts.filter((a) => a.ownerBackup === true);

console.log(`[statutory-extracts] ${found.length} extract(s) checked against ${byId.size} artifact(s).`);
if (absentArtifacts.size > 0) {
  console.log(
    `[statutory-extracts] RE-DERIVATION REPORT: ${absentArtifacts.size} artifact(s) absent locally; ` +
      `${absentExtracts} extract(s) could not be re-derived. Committed-only checks still ran.`,
  );
} else {
  console.log(
    `[statutory-extracts] RE-DERIVATION: ${rederivedExtracts}/${found.length} extract(s) match fresh ` +
      `pdftotext output from ${artifactHashes.size} hash-verified local artifact(s).`,
  );
}
console.log(
  `[statutory-extracts] RECOVERABILITY: ${manifest.artifacts.filter(hasUrl).length} re-retrievable by URL, ` +
    `${extracted.size} preserved as committed text, ${backedUp.length} held by the owner off-repository.`,
);
for (const a of backedUp) {
  console.log(
    `    owner-backed-up: ${a.id}  ${a.file}  (${(a.bytes / 1e6).toFixed(1)} MB) — re-suppliable on request`,
  );
}
if (stranded.length > 0) {
  console.log(
    `[statutory-extracts] NOTE: ${stranded.length} artifact(s) are re-retrievable by NO route —\n` +
      `  no URL, no committed text, no recorded owner backup. If .sources/statutory/ is lost,\n` +
      `  these are GONE:`,
  );
  for (const a of stranded) console.log(`    ${a.id}  ${a.file}  (${(a.bytes / 1e6).toFixed(1)} MB)`);
  console.log(`  This is REPORTED, not failed — see extracts/README.md "Recoverability".`);
} else {
  console.log(`[statutory-extracts] Every registered artifact is recoverable by at least one route.`);
}

if (problems.length > 0) {
  console.error(`\n[statutory-extracts] FAIL — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(
  "\n[statutory-extracts] PASS — committed checks passed; local artifact re-derivation coverage is reported above.",
);
