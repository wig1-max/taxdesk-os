#!/usr/bin/env node
/**
 * TaxDesk OS — regenerate the committed statutory TEXT extracts from the local
 * PDFs (`K4-SOURCE-02`, decision `D302`).
 *
 * WHY THIS EXISTS. The statutory PDFs live at `.sources/statutory/`, which is
 * GITIGNORED (~142 MB against a 39 MB `.git`). So a fresh clone carries the
 * manifest — hashes, URLs, provenance — and NOT ONE WORD OF STATUTE. Every
 * session that needed to check a provision had to re-retrieve the PDF (which
 * for ITD documents costs an OWNER action, and for the two ICAI editions is
 * not possible at all — they have no re-retrievable URL) and then re-run the
 * extraction and re-resolve the same table misrenderings that had already been
 * resolved once.
 *
 * The extracts this script writes are COMMITTED. After them, the cited text is
 * readable, greppable and diffable from a bare clone with no PDF present.
 *
 * ALL THREE EXTRACTION MODES ARE EMITTED, DELIBERATELY. `official-source-
 * retrieval.md` §3.2 and §9.1: `-layout` for prose, the default mode as the
 * cross-check, and `-raw` when the two disagree or are both ambiguous. Emitting
 * one "best" rendering would throw away exactly the evidence a reader needs to
 * do that cross-check — and would quietly re-create the hazard, because a
 * single rendering of a statutory table looks equally authoritative whether or
 * not its rows are offset. THE POINT IS NOT TO PICK A WINNER; it is to put all
 * three in front of the next reader.
 *
 * THIS SCRIPT IS NOT A GATE and is not run in CI — it needs the PDFs. The gate
 * is `scripts/check-statutory-extracts.mjs`, which needs only the committed
 * files. Run this one when an artifact is added or replaced, then commit.
 *
 * Usage:  node scripts/build-statutory-extracts.mjs [--check]
 *   --check  regenerate into memory and FAIL if the committed extracts differ
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";

const REPO = join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const MANIFEST = join(REPO, "docs/evidence/statutory-sources/manifest.json");
const SOURCES = join(REPO, ".sources/statutory");
const OUT = join(REPO, "docs/evidence/statutory-sources/extracts");

/**
 * What to extract, and into which world's directory.
 *
 * TWO SHAPES, and the difference is the whole design.
 *
 * 1. WHOLE-DOCUMENT. The small per-provision ITD documents (`K4-SOURCE-02-S1`
 *    …`S4`) are single provisions already, so the whole file is the extract.
 *
 * 2. PAGE-RANGE (`pages: [first, last]`, added by `MAINT-03`). The large
 *    artifacts are not dumped whole: the enacted Income-tax Act, 2025 is 666
 *    pages and ~1.9 MB PER MODE, so all three modes of the whole Act would add
 *    ~5.9 MB of text, nearly all of it about provisions this repository does not
 *    implement. Instead each PROVISION GROUP a pack caveat actually quotes gets
 *    its own file at its own page range.
 *
 *    THAT CHOICE IS NOT ONLY ABOUT SIZE — IT MAKES THE CHECK STRONGER. A span
 *    found somewhere in a 666-page Act is weak evidence; the same span found in
 *    the ten pages of the provision the caveat cites is much better evidence.
 *    Narrowing the haystack narrows what a false pass can hide in.
 *
 *    THE COROLLARY, stated because it is a real limit: a quote from a provision
 *    with NO page range here has no extract to be checked against, so
 *    `verbatim-quotes.test.ts` FAILS it rather than skipping it. That is the
 *    designed behaviour and the fix is to add the range here — not to widen the
 *    matcher and not to move the span to `unverifiableQuotes`.
 *
 * SECTIONS THAT BACK NO DECLARED QUOTE ARE DELIBERATELY NOT EXTRACTED. The TY
 * pack cites sections 92 and 93 (income from other sources), for instance, and
 * no caveat quotes a word of them; extracting them would add bytes that no guard
 * reads. Coverage is driven by the quotations, not by the citation list.
 *
 * **`K4-PORT-02-S1` NOW HAS AN EXTRACT, AND THE REASON IT DID NOT IS WORTH
 * KEEPING (`K4-PORT-04`).** This paragraph read: *"ICAI's Income-tax Act 2025
 * edition gets NO extract, and that is a finding rather than an omission: not
 * one caveat span in either pack is quoted from it … Extracting it would move
 * zero spans."* That was true when written and is corrected forward
 * (`PROJECT_CONSTITUTION.md` §4), not rewritten: `K4-PORT-04` quotes **Finance
 * Act, 2026 section 3** — the charging section for tax year 2026-27 — and s.3
 * is reproduced in NO other artifact this repository holds. ICAI reproduces the
 * Finance Act's 2025-Act half; the ITD copy on disk is **s.2 only** (the 1961
 * half), and the ITD First Schedule copy is the Schedule without the sections.
 * So the moment a caveat quotes s.3, this artifact stops being
 * identity-corroboration prose and becomes the only evidence base for a
 * declared quotation. Coverage is still driven by the quotations.
 *
 * **It stays rank 2.** Extracting a reproduction does not promote it, and the
 * rank-1 corroboration route (`incometaxindia.gov.in/finance-acts`, per-section
 * PDF under the owner save-dialog handoff) is **still owed** for s.3 — the ITD
 * s.2 PDF was retrieved that way and s.3 was not.
 *
 * That leaves ONE genuine, unfixed exposure, recorded rather than papered over:
 * the two ICAI editions have NO re-retrievable URL. If `.sources/` is lost,
 * they are gone — and a page-range extract preserves only the pages named here.
 * See the extracts README.
 */
/**
 * Hazards that apply to EVERY page range taken from the enacted Income-tax Act,
 * 2025 (`K4-PORT-00-S2`), repeated into each file because a reader opens ONE
 * file and must not have to know that a sibling carries the warning.
 *
 * The `-layout` claim is not inherited from `official-source-retrieval.md`; it
 * was re-measured on this artifact while these extracts were built. On the
 * section 202(1) rate Table, `-layout` renders "Upto Rs. 400000" on the same
 * line as "5%" (the rate belonging to the NEXT band) while `-raw` pairs it with
 * "Nil" — the same one-row offset `K4-PORT-01` recorded, still present.
 */
const ITA_2025_MODE_HAZARDS = [
  "*** -layout MISRENDERS THE TABLES IN THIS ACT. Re-measured on this artifact: on the",
  "section 202(1) rate Table, -layout puts 'Upto Rs. 400000' on the line carrying '5%',",
  "which is the NEXT band's rate; -raw pairs it with 'Nil'. The default mode splits the",
  "table COLUMN-MAJOR, listing every Sl. No., then every band, then every rate. -raw is",
  "the mode that pairs this publisher's table rows correctly (§3.2, §9.1) — but read all",
  "three before relying on any figure, which is why all three are emitted.",
  "TYPESETTING: inter-word spaces are occasionally LOST at a column or line break — the",
  "section 58 Table reads 'section 263(1)in respect of' with no space in the default and",
  "-raw modes. A faithful quotation is then not byte-identical to any mode's output.",
  "SECTION-NUMBER COLLISION: in THIS Act s.2(31) is 'Commissioner' and s.2(33) is",
  "'Commissioner (Appeals)'. The speculative-transaction / specified-derivative definitions",
  "are s.66(31) and s.66(33), scoped to Part D of Chapter IV (`D298` corrected a live",
  "citation error of exactly this shape).",
];

/**
 * The provision groups of the enacted Income-tax Act, 2025 that TY 2026-27 pack
 * caveats quote. Page ranges were derived by locating each section's opening
 * line in the `-layout` rendering, then bounded by the next section's opening —
 * never guessed, and every declared quote was confirmed present in the range
 * before the range was written down.
 */
function ita2025Sections() {
  const groups = [
    {
      out: "ita-2025-s002-s003-definitions-and-tax-year.txt",
      pages: [2, 12],
      provision: 'Income-tax Act, 2025 — sections 2 (definitions) and 3 (definition of "tax year")',
      loadBearing: [
        's.2(31) "Commissioner" and s.2(33) "Commissioner (Appeals)" — quoted to record what these',
        "  clause numbers do NOT mean, after `D298` found them cited as the F&O carve-out",
        's.2(101) "senior citizen" — an individual resident in India aged sixty years or more',
        's.3(1) — "tax year" means the twelve months period of the financial year',
      ],
      notes: [
        "SECTION 3 IS INCLUDED DELIBERATELY: the carry-forward caveat quotes the 'tax year'",
        "definition, which is s.3, while citing s.111/s.108. The guard checks PRESENCE in this",
        "artifact, NOT that the span came from the provision the caveat names — so this file",
        "carrying both is what makes that span checkable, and the limit stands unchanged.",
      ],
    },
    {
      out: "ita-2025-s019-s022-salary-and-house-property.txt",
      pages: [32, 38],
      provision: "Income-tax Act, 2025 — sections 19 to 22 (salary deductions; income from house property)",
      loadBearing: [
        "s.19(1) Table Sl. No. 2 — standard deduction (Rs. 75000 / Rs. 50000 by regime)",
        "s.21 — annual value, including the two-house self-occupied limit",
        "s.22(1) — the 30% statutory deduction and the borrowed-capital interest deduction",
      ],
      notes: [
        "s.19(1) IS A TABLE and carries the whole-Act table hazard above. The standard-deduction",
        "amounts differ by regime WITHIN one Table row; read the row, not the number.",
      ],
    },
    {
      out: "ita-2025-s026-s027-business-income.txt",
      pages: [41, 43],
      provision: "Income-tax Act, 2025 — sections 26 and 27 (profits and gains of business or profession)",
      loadBearing: [
        "s.27 — income under s.26 is computed as per sections 28 to 60, except section 58",
      ],
      notes: [
        "THE 1961-ACT COUNTERPART IS NOT HERE. Section 29 of the Income-tax Act, 1961 ('in",
        "accordance with the provisions contained in sections 30 to 43D') is quoted by the same",
        "caveat for contrast, and the consolidated 1961 Act is STILL UNRETRIEVED",
        "(`AUDIT-10-F4`), so that span stays unverifiable. Do not read its absence from this",
        "file as a defect in the file.",
      ],
    },
    {
      out: "ita-2025-s058-s063-presumptive-and-audit.txt",
      pages: [80, 88],
      provision:
        "Income-tax Act, 2025 — sections 58 (presumptive profits Table), 62 (books of account) and 63 (tax audit)",
      loadBearing: [
        "s.58(2) Table Sl. No. 1 — any business other than goods carriage (the s.44AD counterpart)",
        "s.58(2) Table Sl. No. 3 — specified profession under s.62(4) (the s.44ADA counterpart)",
        's.62(4) — the "specified profession" list',
      ],
      notes: [
        "s.58(2) IS THE TABLE THE WHOLE-ACT HAZARD ABOVE IS ABOUT, and it is the reason -raw is",
        "emitted: 'Business of plying, hiring or leasing goods carriage' and 'Specified profession",
        "as referred to in section 62(4)' are recoverable as contiguous strings in -raw ONLY.",
        "Sl. No. 2 (goods carriage, the s.44AE counterpart) is IMPLEMENTED BY NOTHING here, and",
        "`D298` recorded a live citation error that read Sl. No. 2 for Sl. No. 3.",
      ],
    },
    {
      out: "ita-2025-s066-part-d-definitions.txt",
      pages: [90, 92],
      provision:
        'Income-tax Act, 2025 — section 66 (Part D of Chapter IV: "speculative transaction", "specified derivative transaction")',
      loadBearing: [
        "s.66 opening — 'For the purposes of Part D of this Chapter' (the scope limit)",
        "s.66(31) — speculative transaction, and its carve-outs",
        "s.66(33) — specified derivative transaction (screen-based, time-stamped contract note)",
      ],
      notes: [
        "SCOPE IS LOAD-BEARING HERE. s.66 is scoped to Part D of Chapter IV, not Act-wide — which",
        "is half of what `D298` corrected. The other half is that these are s.66's clauses, not",
        "section 2's.",
      ],
    },
    {
      out: "ita-2025-s108-s114-set-off-and-carry-forward.txt",
      pages: [141, 148],
      provision:
        "Income-tax Act, 2025 — sections 108 to 114 (set off and carry forward of losses)",
      loadBearing: [
        "s.108 — set off under the same head",
        "s.109(1)(b) — house-property loss set off against any other head, capped at Rs. 200000",
        "s.109(2) — a capital loss may not be set off against any other head",
        "s.111 — carry forward of a capital loss, eight tax years",
        "s.113 — speculation-business losses set off only against speculation profits",
      ],
      notes: [
        "THE EIGHT-YEAR LIMIT IS QUOTED FROM THIS ACT, not from the Year-2000 vintage Section 73",
        "page that `K4-18` was nearly misled by. That hazard was about the 1961 Act and stale law;",
        "this text is the 2025 Act as enacted and as amended to 2026-06-10.",
      ],
    },
    {
      out: "ita-2025-s126-health-insurance.txt",
      pages: [160, 161],
      provision: "Income-tax Act, 2025 — section 126 (deduction in respect of health insurance premia)",
      loadBearing: [
        "s.126(2)/(3) — the Rs. 25000 aggregate and the senior-citizen Rs. 50000 substitution",
        "s.126(4) — the aggregate cap across sub-section (2)(a)+(c) or (2)(b)+(d)",
      ],
      notes: [
        "THE ACT SAYS 'or', LOWER-CASE, in s.126(4). The TY caveat quotes it as 'OR' for emphasis,",
        "which is why that span is declared unverifiable under QUOTE_EMPHASIS_ADDED rather than",
        "checked — the words are right and the capitalisation is this repository's.",
      ],
    },
    {
      out: "ita-2025-s153-interest-on-deposits.txt",
      pages: [190, 191],
      provision:
        "Income-tax Act, 2025 — section 153 (deduction for interest on deposits; the single section into which 1961-Act sections 80TTA and 80TTB both collapse)",
      loadBearing: [
        "s.153(1) — the assessee classes, senior citizen and non-senior stated separately",
        "s.153(2) — the differing maximum for each class",
      ],
      notes: [
        "ONE SECTION, TWO 1961-ACT PROVISIONS. The mutual exclusivity the engine implements as",
        "80TTA-vs-80TTB is, in this Act, a single section with class-dependent limits. That is a",
        "structural difference, not a rate difference, and it is not a tax conclusion (§2 rule 5).",
      ],
    },
    {
      out: "ita-2025-s156-rebate.txt",
      pages: [193, 194],
      provision: "Income-tax Act, 2025 — section 156 (rebate of income-tax in case of certain individuals)",
      loadBearing: [
        "s.156(2)(a)/(b) — the rebate and its marginal relief, conditioned on section 202(1)",
        "s.156(3) — the deduction may not exceed income-tax at the s.202(1) rates",
      ],
      notes: [
        "TWO OF THIS RULE'S QUOTATIONS ARE ELIDED (they join non-adjacent fragments with '…'), so",
        "they exist as a contiguous string in no rendering of any source and stay unverifiable",
        "even though the text they elide IS in this file. Elision is the obstacle, not absence.",
      ],
    },
    {
      // K4-24 — THE SECTION 89 COUNTERPART, WHICH THIS REPOSITORY SPENT THREE
      // SESSIONS RECORDING AS UNIDENTIFIED. `D311` withheld the citation
      // deliberately rather than guessing it (`D298`'s error class), and that
      // was right at the time. The owner named the mapping in his K4-24
      // decisions and it was then VERIFIED against this artifact rather than
      // accepted: s.157 is on page 194, immediately after s.156 (the s.87A
      // counterpart) and immediately before s.158 (the s.89A counterpart), and
      // its four limbs (a)-(d) match s.89's four heads one for one.
      out: "ita-2025-s157-arrears-relief.txt",
      pages: [194, 194],
      provision:
        "Income-tax Act, 2025 — section 157 (relief when salary, etc., is paid in arrears or in advance) — the counterpart of Income-tax Act, 1961 section 89",
      loadBearing: [
        "s.157(1)(a)-(d) — arrear or advance salary; salary for more than twelve months in one tax year; profits in lieu of salary under s.18(1); arrears of family pension as defined in s.93(1)(d)",
        "s.157(1) — relief is granted by the Assessing Officer on an application, 'as may be prescribed'",
        "s.157(2) — the counterpart of s.89's proviso: no relief where a deduction has been claimed under s.19(1) Table Sl. No. 12 for such, or any other, tax year",
      ],
      notes: [
        "THE MAPPING IS NOW SOURCED, NOT ASSERTED. It is recorded here as a citation only; NO",
        "2025-Act relief arithmetic exists in this repository and none is authorised. That world",
        "still cannot compute (`D319`), and identifying a counterpart does not change that.",
        "TWO DIFFERENCES FROM s.89 ARE VISIBLE ON THE FACE OF THE TEXT and are recorded because a",
        "later session must not assume the two sections are interchangeable. (1) s.89's proviso is",
        "framed on the section 10(10C) VRS exemption; s.157(2) is framed on a deduction under",
        "s.19(1) Table Sl. No. 12 — the same idea reached through a different provision, and",
        "whether they are co-extensive is a TAX QUESTION (§2 rule 5), not decided here.",
        "(2) s.89 says 'in any one financial year'; s.157(1)(b) says 'in any one tax year'.",
        "s.158 (the s.89A counterpart, retirement benefit account in a notified country) begins on",
        "page 195 and is deliberately OUTSIDE this range: shipping s.157 must not read as shipping",
        "s.158.",
      ],
    },
    {
      out: "ita-2025-s196-s198-special-rate-capital-gains.txt",
      pages: [236, 239],
      provision:
        "Income-tax Act, 2025 — sections 196 and 198 (tax on short-term and long-term capital gains in certain cases)",
      loadBearing: [
        "s.196 — short-term capital gains at 20% (the s.111A counterpart)",
        "s.198 — long-term capital gains above Rs. 125000 at 12.5% (the s.112A counterpart)",
      ],
      notes: [
        "THESE ARE THE 2025-ACT COUNTERPARTS OF 111A/112A AND THE TY PACK COMPUTES NEITHER.",
        "The pack carries no computation surface at all (`D299`); these citations record what the",
        "port would have to implement, and nothing more.",
      ],
    },
    {
      out: "ita-2025-s202-new-regime.txt",
      pages: [242, 243],
      provision:
        "Income-tax Act, 2025 — section 202 (new tax regime for individuals, Hindu undivided family and others)",
      loadBearing: [
        "s.202(1) Table — the rate bands",
        "s.202(2) — the exemptions and deductions denied, including s.22(1)(b) house-property interest",
        "s.202(2)(b) — no set off of a house-property loss against any other head",
      ],
      notes: [
        "*** THIS PAGE CARRIES THE TABLE THE WHOLE-ACT HAZARD IS MEASURED ON. *** Read the -raw",
        "section: it gives '1. Upto Rs. 400000 Nil'. The -layout section reads 'Upto Rs. 400000'",
        "on the same line as '5%'. `K4-PORT-00` compared this Table against NEW_REGIME_SLABS and",
        "found it byte-identical — a comparison against this repository's constants, NOT a",
        "verification of them (§2 rule 5).",
      ],
    },
    {
      out: "ita-2025-s403-advance-tax.txt",
      pages: [481, 482],
      provision: "Income-tax Act, 2025 — section 403 (liability for payment of advance tax)",
      loadBearing: [
        "s.403(3) — the resident senior-citizen exemption, conditioned on having no business income",
      ],
      notes: [
        "THE ENGINE'S DISCLOSURE OF THIS IS VALIDATION-ONLY (`D71`), and `AUDIT-02-F6` corrected",
        "its wording to state what is RECORDED rather than to assert the taxpayer has no business",
        "income. This file is the 2025-Act counterpart text; the engine implements the 1961 Act's",
        "section 207(2).",
      ],
    },
  ];
  return groups.map((g) => ({
    artifactId: "K4-PORT-00-S2",
    out: `ty-2026-27/${g.out}`,
    pages: g.pages,
    world: "TY 2026-27 / Income-tax Act, 2025",
    provision: g.provision,
    loadBearing: g.loadBearing,
    notes: [...g.notes, "", ...ITA_2025_MODE_HAZARDS],
  }));
}

/**
 * Hazards that apply to EVERY page range taken from an enacted Finance Act in
 * the Gazette of India (`K4-SOURCE-06`), repeated into each file because a
 * reader opens ONE file and must not have to know that a sibling carries the
 * warning.
 *
 * Every rate in a Finance Act lives in a TABLE inside the First Schedule, so
 * §3.2's table hazard applies to the whole of that Schedule, not to a footnote
 * in it. All three modes are emitted for exactly that reason.
 */
const FINANCE_ACT_MODE_HAZARDS = [
  "*** EVERY RATE IN THIS ACT IS IN A TABLE, AND -layout MISRENDERS STATUTORY TABLES",
  "(official-source-retrieval.md §3.2). The default mode splits a table COLUMN-MAJOR and -raw",
  "emits content-stream order. NEVER quote a rate, slab bound or surcharge threshold from a",
  "single mode — read all three, which is why all three are emitted.",
  "BILINGUAL GAZETTE: the Hindi text layer is degraded and decodes to replacement characters;",
  "the English statutory text is clean.",
  "MARGINAL NOTES (the section captions and the `43 of 1961.` style Act references printed in",
  "the margin) FOLD INTO THE TEXT COLUMN in -layout, so a charging sentence is not always a",
  "contiguous string in that mode. The default and -raw modes carry it.",
  "RUNNING HEADERS (`THE GAZETTE OF INDIA EXTRAORDINARY [PART II--`) interrupt provisions at",
  "every page break. A span that crosses a page boundary is therefore NOT byte-contiguous in",
  "any mode.",
];

/**
 * The section 89 arrears lookback corpus (`K4-SOURCE-06`).
 *
 * TWO RANGES PER ACT, and the pairing is the point. Section 2 is the charging
 * provision that names the assessment year and BINDS Part I of the First
 * Schedule to it; the First Schedule carries the rates. Holding one without the
 * other would leave either rates with no assessment year or an assessment year
 * with no rates.
 *
 * THE TWO INTERIM ACTS HAVE NO FIRST SCHEDULE, AND THAT IS A FINDING RATHER
 * THAN A GAP. The Finance Act, 2019 (NO. 7 OF 2019) and the Finance Act, 2024
 * (NO. 8 OF 2024) were enacted before their year's full Budget; each one's
 * section 2 APPLIES the PRECEDING Finance Act's section 2 and First Schedule to
 * the new assessment year, with enumerated modifications, instead of enacting
 * rates of its own. Each was then superseded for that assessment year by a
 * Finance (No. 2) Act. A full-text scan of both artifacts confirms that neither
 * contains the string "THE FIRST SCHEDULE"; the absence was established, not
 * assumed, and their section-2 ranges are correspondingly long because the
 * modifications are set out in the section itself.
 *
 * Page ranges were derived by locating "RATES OF INCOME-TAX", "CHAPTER III",
 * "THE FIRST SCHEDULE" and "THE SECOND SCHEDULE" in the `-layout` rendering of
 * each artifact — never guessed and never copied between Acts, whose pagination
 * differs widely (the First Schedule opens on page 52 of the Finance Act, 2025
 * and on page 109 of the Finance Act, 2021).
 *
 * EVERY SECTION-2 RANGE STARTS AT PAGE 1 DELIBERATELY, even for the Acts whose
 * Chapter II opens on page 2. Page 1 carries the Gazette masthead, the Act's
 * short title, its Act number and the assent recital, so the extract IDENTIFIES
 * ITSELF from the statutory text rather than only from this builder's generated
 * header. That was not the first cut: the ranges initially began where
 * "RATES OF INCOME-TAX" appears, and five extracts — the Finance (No. 2) Acts
 * of 2019 and 2024, the Finance Act, 2020, the Finance Act, 2024 interim and
 * the Finance Act, 2025 — then contained neither their own Act title nor
 * "MINISTRY OF LAW AND JUSTICE". An extract of a statute that does not name the
 * statute is exactly the hazard §4 of `official-source-retrieval.md` exists to
 * prevent, so the one extra page is bought deliberately.
 */
function financeActLookbackSections() {
  const acts = [
    {
      id: "K4-SOURCE-08-FA2014-INTERIM", slug: "finance-act-2014-interim",
      label: "Finance Act, 2014 (NO. 11 OF 2014) — the INTERIM Act", ay: "2014-15", py: "2013-14",
      s2: [1, 8], fs: null, incorporates: "Finance Act, 2013", supersededBy: "Finance (No. 2) Act, 2014 (NO. 25 OF 2014)",
    },
    { id: "K4-SOURCE-08-FA2014-NO2", slug: "finance-no-2-act-2014", label: "Finance (No. 2) Act, 2014 (NO. 25 OF 2014)", ay: "2014-15", py: "2013-14", s2: [1, 6], fs: [38, 51], supersedes: "Finance Act, 2014 (NO. 11 OF 2014)" },
    { id: "K4-SOURCE-06-FA2015", slug: "finance-act-2015", label: "Finance Act, 2015 (NO. 20 OF 2015)", ay: "2015-16", py: "2014-15", s2: [1, 7], fs: [63, 74] },
    { id: "K4-SOURCE-06-FA2016", slug: "finance-act-2016", label: "Finance Act, 2016 (NO. 28 OF 2016)", ay: "2016-17", py: "2015-16", s2: [1, 7], fs: [93, 104] },
    { id: "K4-SOURCE-06-FA2017", slug: "finance-act-2017", label: "Finance Act, 2017 (NO. 7 OF 2017)", ay: "2017-18", py: "2016-17", s2: [1, 8], fs: [67, 81] },
    { id: "K4-SOURCE-06-FA2018", slug: "finance-act-2018", label: "Finance Act, 2018 (NO. 13 OF 2018)", ay: "2018-19", py: "2017-18", s2: [1, 8], fs: [67, 78] },
    {
      id: "K4-SOURCE-06-FA2019-INTERIM", slug: "finance-act-2019-interim",
      label: "Finance Act, 2019 (NO. 7 OF 2019) — the INTERIM Act", ay: "2019-20", py: "2018-19",
      s2: [1, 8], fs: null, incorporates: "Finance Act, 2018", supersededBy: "Finance (No. 2) Act, 2019 (NO. 23 OF 2019)",
    },
    { id: "K4-SOURCE-06-FA2019-NO2", slug: "finance-no-2-act-2019", label: "Finance (No. 2) Act, 2019 (NO. 23 OF 2019)", ay: "2019-20", py: "2018-19", s2: [1, 9], fs: [75, 89], supersedes: "Finance Act, 2019 (NO. 7 OF 2019)" },
    { id: "K4-SOURCE-06-FA2020", slug: "finance-act-2020", label: "Finance Act, 2020 (NO. 12 OF 2020)", ay: "2020-21", py: "2019-20", s2: [1, 11], fs: [67, 83] },
    { id: "K4-SOURCE-06-FA2021", slug: "finance-act-2021", label: "Finance Act, 2021 (NO. 13 OF 2021)", ay: "2021-22", py: "2020-21", s2: [1, 13], fs: [109, 129] },
    { id: "K4-SOURCE-06-FA2022", slug: "finance-act-2022", label: "Finance Act, 2022 (No. 6 OF 2022)", ay: "2022-23", py: "2021-22", s2: [1, 13], fs: [69, 88] },
    { id: "K4-SOURCE-06-FA2023", slug: "finance-act-2023", label: "Finance Act, 2023 (No. 8 OF 2023)", ay: "2023-24", py: "2022-23", s2: [1, 14], fs: [68, 86] },
    {
      id: "K4-SOURCE-06-FA2024-INTERIM", slug: "finance-act-2024-interim",
      label: "Finance Act, 2024 (NO. 8 OF 2024) — the INTERIM Act", ay: "2024-25", py: "2023-24",
      s2: [1, 24], fs: null, incorporates: "Finance Act, 2023", supersededBy: "Finance (No. 2) Act, 2024 (No. 15 of 2024)",
    },
    { id: "K4-SOURCE-06-FA2024-NO2", slug: "finance-no-2-act-2024", label: "Finance (No. 2) Act, 2024 (No. 15 of 2024)", ay: "2024-25", py: "2023-24", s2: [1, 17], fs: [73, 96], supersedes: "Finance Act, 2024 (NO. 8 OF 2024)" },
    { id: "K4-SOURCE-06-FA2025", slug: "finance-act-2025", label: "Finance Act, 2025 (No. 7 of 2025)", ay: "2025-26", py: "2024-25", s2: [1, 16], fs: [52, 70] },
  ];

  const out = [];
  for (const a of acts) {
    const mapping = `MAPPING: previous year ${a.py} → assessment year ${a.ay} → ${a.label}.`;
    out.push({
      artifactId: a.id,
      out: `historical-ay-1961/${a.slug}-s2-charging.txt`,
      pages: a.s2,
      world: `AY ${a.ay} / Income-tax Act, 1961 (section 89 lookback)`,
      provision: `${a.label} — CHAPTER II, section 2 (rates of income-tax), the charging provision for assessment year ${a.ay}`,
      loadBearing: a.incorporates
        ? [
            `s.2 — applies section 2 of, and the First Schedule to, the ${a.incorporates}, to the assessment year commencing on the 1st day of April, ${a.ay.slice(0, 4)}, with enumerated modifications`,
            "The enumerated modifications themselves, which is why this range is long",
            mapping,
          ]
        : [
            `s.2(1) — income-tax charged for the assessment year commencing on the 1st day of April, ${a.ay.slice(0, 4)} at the rates specified in Part I of the First Schedule`,
            "The surcharge and (in the later Acts) cess sub-sections that sit in the same section",
            mapping,
          ],
      notes: [
        ...(a.incorporates
          ? [
              "*** THIS ACT CARRIES NO FIRST SCHEDULE OF ITS OWN, BUT IT DOES ENACT RATES. ***",
              `Section 2 incorporates the ${a.incorporates}'s section 2 and First Schedule by`,
              "reference AND THEN SUBSTITUTES INTO THEM — including, at (b)(i), \"for Part I, the",
              "following Part I shall be substituted\", followed by a complete Part I with actual",
              "slab rates. THAT SUBSTITUTED PART I IS OPERATIVE LAW FOR THIS ASSESSMENT YEAR",
              `until the ${a.supersededBy} supersedes it, not a quotation of someone else's rates.`,
              "The earlier wording here said this Act ENACTS NO RATES OF ITS OWN. That was wrong,",
              "and it was corrected forward after the review of PR #132 caught it on the 2014 Act;",
              "the same string had been generated for all three interim Acts. The true narrow",
              "claim is the one the scan supports: the string 'THE FIRST SCHEDULE' occurs ZERO",
              "times, so this Act has no Schedule of its own — which is NOT the same as enacting",
              "no rates.",
              `For the position finally applicable to AY ${a.ay} read the ${a.supersededBy}'s own`,
              "First Schedule Part I. COMPARE the two rather than assuming they agree: for",
              "AY 2014-15 the interim and superseding Paragraph A rates were CHECKED and are",
              "identical, and that is a measurement, not a rule that holds for every year, every",
              "Paragraph, or the surcharge provisos.",
            ]
          : []),
        ...(a.supersedes
          ? [
              `THIS ACT SUPERSEDED the ${a.supersedes} for AY ${a.ay}. That earlier Act was the`,
              "interim/vote-on-account enactment and carried no First Schedule of its own; this one does.",
            ]
          : []),
        ...(a.id === "K4-SOURCE-06-FA2025"
          ? [
              "TEXTUAL VARIANT: s.2(1) here reads 'commencing on the 1st April, 2025', omitting the",
              "'day of' that every sibling Finance Act carries. Preserve it in any quoted span.",
            ]
          : []),
        "",
        "RETRIEVAL ONLY. Holding this text decides no tax question, implements no section 89",
        "relief, and moves no pack toward ca_verified (PROJECT_CONSTITUTION.md §2 rules 5 and 10).",
        "",
        ...FINANCE_ACT_MODE_HAZARDS,
      ],
    });

    if (!a.fs) continue;
    out.push({
      artifactId: a.id,
      out: `historical-ay-1961/${a.slug}-first-schedule.txt`,
      pages: a.fs,
      world: `AY ${a.ay} / Income-tax Act, 1961 (section 89 lookback)`,
      provision: `${a.label} — THE FIRST SCHEDULE, complete (Parts I to IV), the rate schedule for assessment year ${a.ay}`,
      loadBearing: [
        `Part I — the rates of income-tax for assessment year ${a.ay}, which section 2(1) charges`,
        "Part II — rates for deduction of tax at source in the financial year",
        `Part III — rates for advance tax and for TDS on salaries, which serve the FOLLOWING assessment year, NOT ${a.ay}`,
        "Part IV — the rules for computing net agricultural income",
        mapping,
      ],
      notes: [
        "*** PART I IS THE PART SECTION 2(1) BINDS TO THIS ASSESSMENT YEAR. *** Part III of the",
        "SAME Schedule states rates for the FOLLOWING assessment year, and the two are printed",
        "in one document with near-identical wording. NAME THE PART EVERY TIME YOU CITE THIS",
        `FILE — quoting Part III as the AY ${a.ay} rate is the mistake this note exists to prevent.`,
        "",
        "The whole Schedule is extracted rather than Part I alone, so that the Part boundaries are",
        "visible in the evidence and a reader can see which Part a span came from.",
        "",
        "RETRIEVAL ONLY. These rates are not implemented, not approved, and not verified. No",
        "section 89 computation exists in this repository.",
        "",
        ...FINANCE_ACT_MODE_HAZARDS,
      ],
    });
  }
  return out;
}

/**
 * `K4-SOURCE-08` — the SUBSTANTIVE amending sections behind a section 89
 * lookback: s.115BAC, s.87A and the s.112A rebate interaction.
 *
 * WHY THIS EXISTS, AND WHY IT IS AN EXTRACTION JOB RATHER THAN A RETRIEVAL ONE.
 * `K4-24`'s Phase A packet reported the historical s.115BAC rate table and the
 * per-year s.87A limits as NOT HELD. That was true of the committed EXTRACTS
 * and false of the ARTIFACTS. `K4-SOURCE-06` registered each Finance Act as a
 * COMPLETE Gazette PDF and then extracted section 2 and the First Schedule
 * only — so the substantive amending sections have been on this machine since
 * that session and were simply never given a page range. Every range below is
 * taken from an artifact already registered and hash-pinned; nothing here was
 * retrieved.
 *
 * THE FIRST SCHEDULE DOES NOT CARRY THESE RATES AND NEVER DID. s.115BAC and
 * s.87A live in the Income-tax Act, 1961, amended by each Finance Act's
 * substantive sections. A First Schedule REFERENCES s.115BAC (for the
 * surcharge caps and for TDS) and nowhere states its rate table. So the
 * `K4-SOURCE-06` corpus is necessary and was never sufficient.
 *
 * *** THE -layout MISRENDERING IS LIVE ON THE MOST LOAD-BEARING TABLE HERE. ***
 * In the Finance Act, 2020 s.53 table (the s.115BAC rates as first enacted),
 * `-layout` renders the first two rows as
 *
 *     1.  Up to Rs. 2,50,000                     Nil
 *                                            5 per cent.
 *     2.  From Rs. 2,50,001 to Rs. 5,00,000  10 per cent.
 *
 * — which pairs the 2,50,001-5,00,000 band with TEN per cent. when the enacted
 * rate is FIVE, and offsets every band below it by one row. `-raw` pairs the
 * rows correctly. This is not a hypothetical hazard quoted from §3.2; it is
 * that hazard, on the new-regime slab table for AY 2021-22 to AY 2023-24, in
 * this corpus. A reader who took the `-layout` rendering would misstate every
 * new-regime band for three assessment years. READ `-raw` FOR EVERY TABLE HERE.
 *
 * WHAT THE CHAIN ACTUALLY IS — measured by reading each Act, not inferred.
 * Only the Acts listed below contain the string "In section 87A"; a scan of all
 * fourteen held Finance Acts established that, so the s.87A chain is complete
 * WITHIN THE HELD CORPUS rather than merely as far as anyone looked. Two
 * near-misses were rejected on reading: Finance Act, 2021 page 42 mentions
 * s.87A only inside the new s.194P (TDS for specified senior citizens), and
 * Finance Act, 2018 page 18 mentions it only inside s.112A(6) — a
 * cross-reference and an interaction rule respectively, neither an amendment.
 *
 * WHERE THE CHAIN STOPS, AND IT IS A REAL GAP RATHER THAN AN OVERSIGHT. The
 * corpus begins at the Finance Act, 2015, so the s.87A baseline it inherits —
 * five hundred thousand rupees / two thousand rupees, which governs AY 2015-16
 * and AY 2016-17 — is stated by NO artifact held here. It was enacted by the
 * Finance Act, 2013, which is outside the registered corpus. s.87A did not
 * exist at all before AY 2014-15. Both facts bound what any lookback can claim
 * for the earliest years and are recorded rather than papered over.
 */
function section89SubstantiveProvisions() {
  const RETRIEVAL_ONLY = [
    "",
    "RETRIEVAL ONLY. Holding this text decides no tax question, implements no section 89",
    "relief, computes nothing, and moves no pack toward ca_verified",
    "(PROJECT_CONSTITUTION.md §2 rules 5 and 10). No section 89 arithmetic exists in this",
    "repository, and this session was explicitly forbidden to write any.",
  ];

  const rows = [
    {
      slug: "finance-act-2016-s87A-rebate",
      artifactId: "K4-SOURCE-06-FA2016",
      act: "Finance Act, 2016 (NO. 28 OF 2016)",
      pages: [24, 24],
      provision: "section 46 — amendment of section 87A of the Income-tax Act, 1961",
      effect: "s.87A maximum rebate raised from two thousand rupees to FIVE thousand rupees",
      eff: "1st day of April, 2017",
      firstAy: "2017-18",
      loadBearing: [
        "s.46 — 'for the words \"two thousand rupees\", the words \"five thousand rupees\" shall be",
        "substituted with effect from the 1st day of April, 2017'",
        "The INCOME LIMIT is untouched by this section and remains five hundred thousand rupees",
      ],
      notes: [
        "THIS SECTION MOVES THE CEILING ONLY, NOT THE INCOME LIMIT. Reading it as though it",
        "restated the whole rebate would lose the limit, which this Act does not mention.",
      ],
    },
    {
      slug: "finance-act-2017-s87A-rebate",
      artifactId: "K4-SOURCE-06-FA2017",
      act: "Finance Act, 2017 (NO. 7 OF 2017)",
      pages: [20, 20],
      provision: "section 38 — amendment of section 87A of the Income-tax Act, 1961",
      effect:
        "s.87A income limit CUT to three hundred fifty thousand rupees and the maximum rebate CUT to two thousand five hundred rupees",
      eff: "1st day of April, 2018",
      firstAy: "2018-19",
      loadBearing: [
        "s.38(a) — income limit: 'five hundred thousand rupees' to 'three hundred fifty thousand rupees'",
        "s.38(b) — maximum rebate: 'five thousand rupees' to 'two thousand five hundred rupees'",
      ],
      notes: [
        "BOTH FIGURES MOVE DOWNWARD HERE, which is the opposite direction to every other",
        "amendment in this chain. A lookback that assumed the rebate only ever rises would",
        "overstate relief for AY 2018-19 and AY 2019-20.",
        "The Act's own text carries the editorial gloss '[as substituted by section 46 of the",
        "Finance Act, 2016]' inside clause (b), which is how the chain identifies itself.",
      ],
    },
    {
      slug: "finance-act-2019-interim-s87A-rebate",
      artifactId: "K4-SOURCE-06-FA2019-INTERIM",
      act: "Finance Act, 2019 (NO. 7 OF 2019) — the INTERIM Act",
      pages: [9, 9],
      provision: "section 8 — amendment of section 87A of the Income-tax Act, 1961",
      effect:
        "s.87A income limit raised to five hundred thousand rupees and the maximum rebate raised to twelve thousand five hundred rupees",
      eff: "1st day of April, 2020",
      firstAy: "2020-21",
      loadBearing: [
        "s.8(a) — 'three hundred fifty thousand' to 'five hundred thousand'",
        "s.8(b) — 'two thousand and five hundred' to 'twelve thousand and five hundred'",
      ],
      notes: [
        "*** THIS IS THE OTHER FACE OF THE INTERIM-ACT TRAP, AND IT CUTS THE OPPOSITE WAY. ***",
        "An interim Finance Act carries NO FIRST SCHEDULE OF ITS OWN, so a lookback must not",
        "take an assessment year's FINALLY APPLICABLE rate schedule from one. The complement is",
        "equally true and more dangerous: THIS INTERIM ACT DOES CARRY SUBSTANTIVE AMENDMENTS,",
        "and this is one of them. A session that filed the interim Acts as 'the ones with",
        "nothing in them' would take AY 2020-21's rebate from the wrong text — and would find",
        "no amendment at all in the Finance (No. 2) Act, 2019, because that Act does not touch",
        "s.87A.",
        "",
        "*** THIS NOTE SAID THE INTERIM ACTS 'enact NO RATES' AND THAT RATES COME 'NEVER' FROM",
        "AN INTERIM ACT. BOTH WERE FALSE, AND THE SECOND REVIEW OF PR #132 CAUGHT THEM HERE",
        "AFTER THE FIRST CORRECTION SWEEP HAD MISSED THIS FUNCTION. ***  The sweep grep matched",
        "'enactS no rates' and this text reads 'enact NO RATES' — a verb inflection was the",
        "whole difference, which is why a sweep should match the CLAIM and not a phrasing of it.",
        "Every interim Finance Act — 2014, 2019 and 2024 alike — SUBSTITUTES a complete new",
        "Part I, with actual slab rates, into the incorporated Act's First Schedule ('for Part I,",
        "the following Part I shall be substituted'), and that substituted Part I is OPERATIVE",
        "LAW for its year until the Finance (No. 2) Act supersedes it.",
        "",
        "STATE THE RULE AS TWO HALVES, CAREFULLY: the FINALLY APPLICABLE rate schedule for an",
        "assessment year comes from the Finance (No. 2) Act, never from the interim Act — but",
        "the interim Act's own substituted Part I is real law and must be read, not skipped;",
        "and substantive amendments must be read from BOTH Acts, in enactment order.",
        "",
        "PAGE 9 IS OUTSIDE THIS ARTIFACT'S OTHER COMMITTED RANGE. The s.2 charging extract for",
        "this Act covers pages 1-8, so before this file the amendment was held in the PDF and",
        "in no committed text.",
      ],
    },
    {
      slug: "finance-act-2020-s115BAC-as-inserted",
      artifactId: "K4-SOURCE-06-FA2020",
      act: "Finance Act, 2020 (NO. 12 OF 2020)",
      pages: [33, 35],
      provision:
        "section 53 — insertion of new sections 115BAC and 115BAD, with the s.115BAC rate TABLE as first enacted",
      effect:
        "s.115BAC inserted, OPTIONAL, for assessment years beginning on or after 1 April 2021 — the new-regime table for AY 2021-22, AY 2022-23 and AY 2023-24",
      eff: "1st day of April, 2021",
      firstAy: "2021-22",
      loadBearing: [
        "s.53 — 'After section 115BAB of the Income-tax Act, the following sections shall be",
        "inserted with effect from the 1st day of April, 2021'",
        "s.115BAC(1) and its TABLE — seven bands, Nil / 5 / 10 / 15 / 20 / 25 / 30 per cent.",
        "s.115BAC(1) — 'at the option of such person', which is what makes this regime OPTIONAL",
        "for AY 2021-22 to AY 2023-24 and is the fact the Form 10E portal-behaviour question",
        "turns on",
        "s.115BAC(2) — the exemptions and deductions forgone, which is why total income under",
        "this regime is not the same figure as total income under the old one",
        "s.115BAC(5) — the option and the manner of exercising it",
      ],
      notes: [
        "*** THE -layout RENDERING OF THIS TABLE IS WRONG BY ONE ROW. *** It prints 'Nil' and",
        "'5 per cent.' both against 'Up to Rs. 2,50,000' and then pairs 'From Rs. 2,50,001 to",
        "Rs. 5,00,000' with '10 per cent.'. The enacted pairing, which -raw renders correctly,",
        "is 2,50,001-5,00,000 at FIVE per cent. EVERY BAND BELOW THE FIRST IS OFFSET IN",
        "-layout. Quote this table from -raw only. This is the single sharpest reading hazard",
        "in the section 89 corpus.",
        "",
        "RANGE ENDS AT PAGE 35 BECAUSE s.115BAD OPENS THERE and s.54 opens on page 36. The",
        "range deliberately includes the s.115BAD opening so the boundary is visible in the",
        "evidence rather than asserted in this header — s.115BAD is the CO-OPERATIVE SOCIETY",
        "regime and has nothing to do with an individual's section 89 lookback.",
        "",
        "THIS TABLE GOVERNS THREE ASSESSMENT YEARS AND WAS THEN CLOSED, not superseded in",
        "place: the Finance Act, 2023 confined sub-section (1) to years 'before the 1st day of",
        "April, 2024' and inserted sub-section (1A) alongside it. Both sub-sections coexist in",
        "the Act; which one applies is a function of the assessment year AND of whether an",
        "option was exercised.",
      ],
    },
    {
      slug: "finance-act-2023-s87A-new-regime-proviso",
      artifactId: "K4-SOURCE-06-FA2023",
      act: "Finance Act, 2023 (No. 8 OF 2023)",
      pages: [32, 32],
      provision: "section 44 — insertion of the new-regime proviso to section 87A",
      effect:
        "a s.87A proviso for income chargeable under s.115BAC(1A): seven hundred thousand rupees / twenty-five thousand rupees, WITH a marginal-relief limb",
      eff: "1st day of April, 2024",
      firstAy: "2024-25",
      loadBearing: [
        "proviso clause (a) — total income not exceeding seven hundred thousand rupees: rebate of",
        "one hundred per cent. of the income-tax or twenty-five thousand rupees, whichever is less",
        "proviso clause (b) — THE REBATE-THRESHOLD MARGINAL RELIEF: where total income exceeds",
        "seven hundred thousand rupees and the income-tax payable exceeds the excess over seven",
        "hundred thousand rupees, a deduction equal to that difference",
        "The proviso is conditioned on 'chargeable to tax under sub-section (1A) of section",
        "115BAC' — it is NEW-REGIME ONLY, and the old regime keeps its own unprovisoed limits",
      ],
      notes: [
        "*** THIS IS THE HISTORICAL ORIGIN OF THE RELIEF `K4-12` IMPLEMENTED FOR AY 2026-27. ***",
        "It is the REBATE-threshold marginal relief, NOT the surcharge marginal relief, and the",
        "two share only the name (D170-D172). This extract is the AY 2024-25 text of",
        "the same mechanism, held here as evidence and NOT as permission to compute it for any",
        "historical year.",
        "",
        "THE PROVISO IS CONDITIONED ON s.115BAC(1A), so it does not reach a taxpayer taxed under",
        "the OLD regime in AY 2024-25 or AY 2025-26. The old regime's own limit (five hundred",
        "thousand / twelve thousand five hundred, from the interim Finance Act, 2019) continues",
        "unamended alongside it. TWO REBATE RULES COEXIST from AY 2024-25 and the applicable one",
        "depends on the regime the taxpayer was actually taxed under.",
      ],
    },
    {
      slug: "finance-act-2023-s115BAC-1A-inserted",
      artifactId: "K4-SOURCE-06-FA2023",
      act: "Finance Act, 2023 (No. 8 OF 2023)",
      pages: [33, 34],
      provision:
        "section 52 — amendment of section 115BAC: sub-section (1) confined, sub-section (1A) INSERTED with the AY 2024-25 rate table",
      effect:
        "the new regime becomes the DEFAULT from AY 2024-25 under s.115BAC(1A); the optional s.115BAC(1) is confined to years before 1 April 2024",
      eff: "1st day of April, 2024",
      firstAy: "2024-25",
      loadBearing: [
        "s.52(A)(b) — sub-section (1) confined to '1st day of April, 2021 but before the 1st day",
        "of April, 2024', which CLOSES the optional regime after AY 2023-24",
        "s.52(A)(c) — sub-section (1A) inserted, and its TABLE: six bands, Nil / 5 / 10 / 15 / 20",
        "/ 30 per cent. at 3 / 6 / 9 / 12 / 15 lakh",
        "s.115BAC(1A) — 'other than a person who has exercised an option under sub-section (6)',",
        "which is the OPT-OUT structure: (1A) applies BY DEFAULT and the old regime is elected",
        "s.52(A)(a) — the marginal heading widened to ', Hindu undivided family and others'",
      ],
      notes: [
        "*** THE DEFAULT FLIPS HERE, AND THIS IS THE STATUTORY FACT BEHIND THE FORM 10E",
        "PORTAL-BEHAVIOUR QUESTION. *** Under s.115BAC(1) the new regime was OPTIONAL for",
        "AY 2021-22 to AY 2023-24 — a taxpayer got it only by exercising the option. Under",
        "s.115BAC(1A) it is the DEFAULT from AY 2024-25 and the old regime is what must be",
        "elected, via sub-section (6). So a portal that assumes old regime through AY 2023-24",
        "and new regime from AY 2024-25 is assuming each year's DEFAULT.",
        "",
        "THAT ASSUMPTION IS NOT THE SAME AS THE LAW FOR A PARTICULAR TAXPAYER, and the",
        "difference is exactly the open question. A taxpayer who actually exercised the",
        "s.115BAC(5) option for AY 2021-22, AY 2022-23 or AY 2023-24 was taxed under (1) in a",
        "year the default assumption calls old-regime. THIS EXTRACT DOES NOT RESOLVE THAT",
        "QUESTION AND THIS SESSION WAS FORBIDDEN TO. It is a tax question for the owner",
        "(PROJECT_CONSTITUTION.md §2 rule 5). What the extract establishes is only that the",
        "portal's split tracks the statutory DEFAULT, which is a narrower claim than the",
        "portal's split being correct for every taxpayer.",
      ],
    },
    {
      slug: "finance-no-2-act-2024-s115BAC-1A-substituted",
      artifactId: "K4-SOURCE-06-FA2024-NO2",
      act: "Finance (No. 2) Act, 2024 (No. 15 of 2024)",
      pages: [29, 30],
      provision:
        "section 37 — substitution of section 115BAC(1A), splitting it into a per-assessment-year limb (i) and limb (ii)",
      effect:
        "the AY 2024-25 table RE-ENACTED as limb (i) and a NEW table for AY 2025-26 onward enacted as limb (ii): 3 / 7 / 10 / 12 / 15 lakh",
      eff: "1st day of April, 2025",
      firstAy: "2025-26",
      loadBearing: [
        "s.37 — 'for sub-section (1A), the following sub-section shall be substituted'",
        "limb (i) — the AY 2024-25 table, RESTATED unchanged: 3 / 6 / 9 / 12 / 15 lakh",
        "limb (ii) — AY 2025-26 onward: Nil to 3,00,000; 5 per cent. to 7,00,000; 10 per cent. to",
        "10,00,000; 15 per cent. to 12,00,000; 20 per cent. to 15,00,000; 30 per cent. above",
      ],
      notes: [
        "*** THIS ACT RESTATES THE AY 2024-25 TABLE, WHICH IS A FREE CORROBORATION. *** Because",
        "sub-section (1A) was SUBSTITUTED rather than amended, limb (i) re-enacts the Finance",
        "Act, 2023 table verbatim. Two independent Gazette artifacts therefore state the",
        "AY 2024-25 bands, and they agree. Cross-check one against the other before relying on",
        "either — that check costs nothing here and is not available for most years.",
        "",
        "LIMB (ii) SAYS 'ON OR AFTER' AND WAS LATER NARROWED. The Finance Act, 2025 s.25(a)",
        "omits the words 'or after' from clause (ii), which confines limb (ii) to AY 2025-26",
        "once the AY 2026-27 table exists. Reading limb (ii) in isolation would apply the",
        "AY 2025-26 bands to every later year.",
        "",
        "THE TWO TABLES ARE ~40 LINES APART AND OPEN IDENTICALLY ('Sl. No. Total income Rate of",
        "tax'), and limb (ii) falls on the NEXT PAGE behind a running header and a block of",
        "marginal notes. Naming the limb every time is not pedantry here; the tables differ in",
        "one band bound and are otherwise easy to confuse.",
      ],
    },
    {
      slug: "finance-act-2025-s87A-rebate",
      artifactId: "K4-SOURCE-06-FA2025",
      act: "Finance Act, 2025 (No. 7 of 2025)",
      pages: [23, 23],
      provision: "section 20 — amendment of section 87A",
      effect:
        "the new-regime rebate raised to twelve hundred thousand rupees / sixty thousand rupees, and a SECOND proviso capping the deduction",
      eff: "1st April, 2026",
      firstAy: "2026-27",
      loadBearing: [
        "s.20(a)(i)(I) — 'seven hundred thousand rupees' to 'twelve hundred thousand rupees'",
        "s.20(a)(i)(II) — 'twenty-five thousand rupees' to 'sixty thousand rupees'",
        "s.20(a)(ii) — the same limit substituted at BOTH places in the marginal-relief clause (b)",
        "s.20(b) — the SECOND proviso: the deduction under the first proviso 'shall not exceed the",
        "amount of income-tax payable as per the rates provided in sub-section (1A) of section",
        "115BAC'",
      ],
      notes: [
        "THE SECOND PROVISO IS THE SPECIAL-RATE INTERACTION, STATED IN THE STATUTE. It caps the",
        "rebate at the tax computed at s.115BAC(1A) SLAB rates — so tax on income charged at a",
        "special rate under another section is outside what the rebate can wipe out. This is the",
        "AY 2026-27 text and is already implemented for that year; it is extracted here because",
        "the lookback chain needs to show WHEN the cap arrived, and it did not exist for",
        "AY 2024-25 or AY 2025-26.",
        "",
        "THIS ACT IS THE CURRENT-YEAR CHARGING ACT, NOT A HISTORICAL ONE. It is in this group",
        "because the s.87A chain is only readable end to end, not because AY 2026-27 is a",
        "lookback year.",
      ],
    },
    {
      slug: "finance-act-2025-s115BAC-1A-ay-2026-27",
      artifactId: "K4-SOURCE-06-FA2025",
      act: "Finance Act, 2025 (No. 7 of 2025)",
      pages: [24, 25],
      provision:
        "section 25 — amendment of section 115BAC(1A): clause (ii) narrowed and clause (iii) inserted with the AY 2026-27 rate table",
      effect:
        "the AY 2026-27 new-regime table enacted as limb (iii): 4 / 8 / 12 / 16 / 20 / 24 lakh, and limb (ii) confined to AY 2025-26",
      eff: "1st April, 2026",
      firstAy: "2026-27",
      loadBearing: [
        "s.25(a) — 'in clause (ii), the words \"or after\" shall be omitted', which CONFINES the",
        "AY 2025-26 table to that year alone",
        "s.25(b) — clause (iii) inserted: seven bands, Nil / 5 / 10 / 15 / 20 / 25 / 30 per cent.",
        "at 4 / 8 / 12 / 16 / 20 / 24 lakh",
      ],
      notes: [
        "THE NARROWING IN CLAUSE (a) IS AS LOAD-BEARING AS THE NEW TABLE. Deleting two words",
        "from clause (ii) is what stops the AY 2025-26 bands running forward. An extract of the",
        "new table alone would be a true statement of the AY 2026-27 rate and a silent",
        "misstatement of the AY 2025-26 one.",
        "",
        "THE PROVISION SPANS A PAGE BREAK MID-SENTENCE: 'with effect' ends page 24 and 'from the",
        "1st April, 2026' opens page 25 behind a running header and three marginal Act",
        "references. No span across that boundary is byte-contiguous in any mode.",
      ],
    },
    {
      slug: "finance-act-2018-s112A-rebate-and-special-rate-interaction",
      artifactId: "K4-SOURCE-06-FA2018",
      act: "Finance Act, 2018 (NO. 13 OF 2018)",
      pages: [17, 19],
      provision:
        "section 33 — insertion of section 112A (long-term capital gains on equity), including sub-section (6), the s.87A rebate interaction",
      effect:
        "s.112A enacted, and with it the statutory rule that the s.87A rebate is allowed on income-tax REDUCED BY the tax on such capital gains",
      eff: "1st day of April, 2019",
      firstAy: "2019-20",
      loadBearing: [
        "s.112A(6) — 'Where the total income of an assessee includes any long-term capital gains",
        "referred to in sub-section (1), the rebate under section 87A shall be allowed from the",
        "income-tax on the total income as reduced by tax payable on such capital gains'",
        "s.112A(5) — Chapter VI-A deductions allowed from gross total income AS REDUCED BY such",
        "capital gains",
        "s.112A(1)-(2) — the charge and the rate branch",
      ],
      notes: [
        "*** THIS IS THE STATUTORY ANSWER TO ONE HALF OF THE SPECIAL-RATE-INCOME QUESTION. ***",
        "The open architecture question is whether a historical year's tax can be reconstructed",
        "from total income alone. Sub-section (6) shows in the enacted text that it cannot where",
        "the year contained s.112A gains: the rebate is computed on tax REDUCED BY the tax on",
        "those gains, so two years with identical total income and different composition carry",
        "different tax. Extracted as EVIDENCE FOR THAT DESIGN QUESTION, not as an implementation",
        "of s.112A for any historical year.",
        "",
        "THIS IS NOT AN s.87A AMENDMENT and must not be filed as one. It is an interaction rule",
        "inside a different section, which is why a scan for 'In section 87A' does not find it",
        "and a scan for '87A' does.",
        "",
        "s.112A ITSELF IS NOT IMPLEMENTED FOR ANY HISTORICAL YEAR. The range covers the whole",
        "inserted section so sub-section (6) is readable in its context; the surrounding",
        "sub-sections are held as context, not as a modelled provision.",
      ],
    },
  ];

  return rows.map((r) => ({
    artifactId: r.artifactId,
    out: `historical-ay-1961/${r.slug}.txt`,
    pages: r.pages,
    world: `AY ${r.firstAy} onward / Income-tax Act, 1961 (section 89 lookback — SUBSTANTIVE amendment)`,
    provision: `${r.act} — ${r.provision}`,
    loadBearing: [
      ...r.loadBearing,
      `EFFECT: ${r.effect}`,
      `COMMENCEMENT: with effect from the ${r.eff}, so first applicable to assessment year ${r.firstAy}`,
    ],
    notes: [
      "*** THIS IS A SUBSTANTIVE AMENDING SECTION, NOT A RATE SCHEDULE. *** It amends the",
      "Income-tax Act, 1961 itself. The First Schedule of this Act carries the OLD-regime rates",
      "and is committed separately; it does not state this provision and never did.",
      "",
      "COMMENCEMENT IS NOT ENACTMENT. The date above is when the amendment takes effect, which",
      "is what binds it to an assessment year. Reading the Act's own year as the year the",
      "change applies is off by one for every row in this group.",
      "",
      ...r.notes,
      ...RETRIEVAL_ONLY,
      "",
      ...FINANCE_ACT_MODE_HAZARDS,
    ],
  }));
}

/**
 * `K4-SOURCE-07` — the five outstanding Cost Inflation Index notifications.
 *
 * WHY THEY WERE MISSING FOR TWO SESSIONS. `K4-SOURCE-05` recorded all five NOT
 * FOUND after bounded e-Gazette id interpolation, and `K4-23` confirmed their
 * ITD URLs all return 403. Both conclusions were about the routes TRIED. The
 * e-Gazette `Search by Ministry` form — Ministry of Finance, month of issue —
 * lists every one of them, which is the same form that surfaced both
 * `Finance (No. 2)` Acts for `K4-SOURCE-06`. AN ABSENT SEARCH RESULT IS
 * EVIDENCE ABOUT THE SEARCH, NOT ABOUT THE GAZETTE.
 *
 * `K4-24` PHASE 0 THEN RE-MARKED THE FIVE ENGINE ROWS, AND MOVED NO VALUE.
 * Each index was read back from the committed `-raw` block below before its
 * `evidence` marker changed from `owner_decided` to `instrument`, and every
 * instrument states exactly the figure already recorded. Had one disagreed,
 * that would have been a tax question for the owner, not a fix. The
 * superseded note this replaced, kept per `PROJECT_CONSTITUTION.md` §4:
 * *"All five indices remain `owner_decided` under `D337` until a session is
 * separately authorized to re-mark their evidence markers."* Retrieval is
 * still never permission to change a value — only permission to say where
 * the value comes from.
 *
 * THE CHAIN IS WORTH READING AS A CHAIN. Each notification amends the previous
 * one and recites which: 26/2018 amends the principal S.O. 1790(E); 63/2019
 * amends S.O. 2413(E); 32/2020 and 73/2021 and 62/2022 each recite S.O. 1790(E)
 * as principal and name the immediately preceding amendment. With the four
 * already held (44/2017, 39/2023, 44/2024, 70/2025) the recital chain is now
 * unbroken from FY 2001-02 to FY 2025-26, and an unbroken recital chain is a
 * stronger check on completeness than counting rows.
 */
function ciiNotifications() {
  const rows = [
    {
      id: "K4-SOURCE-07-CII-2018",
      slug: "cbdt-notification-26-2018-cii-fy-2018-19",
      no: "26/2018",
      so: "S.O. 2413(E)",
      date: "13 June 2018",
      fy: "2018-19",
      sl: 18,
      cii: 280,
      ay: "2019-20",
      eff: "1st day of April, 2019",
      amends: "the principal notification S.O. 1790(E) dated 5 June 2017",
      hazard: [
        "PAGE 1 EXTRACTS AS DIGITS AND PUNCTUATION ONLY, IN ALL THREE MODES, AND THAT IS THE",
        "SHARPEST READING HAZARD IN THIS CLUSTER. Page 1 is the Hindi page; its Devanagari uses",
        "a legacy non-Unicode font and pdftotext drops the surrounding English glyphs, so the",
        "operative sentence renders as '.. 2413().--   ,  - ,  1961 (1961  43)   48'. Every",
        "load-bearing NUMBER survives, which is precisely what makes it dangerous: the page",
        "looks like a degraded but usable English text and is not one.",
        "THE ENGLISH INSTRUMENT IS ON PAGE 2 AND EXTRACTS CLEANLY. Quote page 2, never page 1.",
      ],
    },
    {
      id: "K4-SOURCE-07-CII-2019",
      slug: "cbdt-notification-63-2019-cii-fy-2019-20",
      no: "63/2019",
      so: "S.O. 3266(E)",
      date: "12 September 2019",
      fy: "2019-20",
      sl: 19,
      cii: 289,
      ay: "2020-2021",
      eff: "1st day of April, 2020",
      amends: "S.O. 2413(E) dated 13 June 2018",
      hazard: [
        "THE ONLY NOTIFICATION IN THE CHAIN THAT NAMES ITS PREDECESSOR RATHER THAN THE PRINCIPAL",
        "as the notification it amends — its own Note calls S.O. 2413(E) 'the principal",
        "notification'. Read the recital, not the pattern.",
        "Its assessment year is printed '2020-2021', not '2020-21' as its siblings print theirs.",
      ],
    },
    {
      id: "K4-SOURCE-07-CII-2020",
      slug: "cbdt-notification-32-2020-cii-fy-2020-21",
      no: "32/2020",
      so: "S.O. 1879(E)",
      date: "12 June 2020",
      fy: "2020-21",
      sl: 20,
      cii: 301,
      ay: "2021-22",
      eff: "1st day of April, 2021",
      amends:
        "the principal notification S.O. 1790(E) dated 5 June 2017, last amended by S.O. 3266(E) dated 12 September 2019",
      hazard: [
        "Bilingual; the Hindi layer is degraded and the English layer is clean.",
        "The inserted row renders on one line in -layout and -raw and column-major in the",
        "default mode — §3.2 applies to the table.",
      ],
    },
    {
      id: "K4-SOURCE-07-CII-2021",
      slug: "cbdt-notification-73-2021-cii-fy-2021-22",
      no: "73/2021",
      so: "S.O. 2336(E)",
      date: "15 June 2021",
      fy: "2021-2022",
      sl: 21,
      cii: 317,
      ay: "2022-2023",
      eff: "1st day of April, 2022",
      amends:
        "the principal notification S.O. 1790(E) dated 5 June 2017, last amended by S.O. 1879(E) dated 12 June 2020",
      hazard: [
        "ITS OWN OFFICE FIELD IN THE E-GAZETTE LISTING READS 'Not Applicable', NOT 'Central Board",
        "of Direct Taxes', and its subject reads only 'Income Tax'. A search filtered on the CBDT",
        "office would miss this row entirely — which is one reason the five looked unfindable.",
        "It prints the financial year as '2021-2022' inside the inserted row.",
        "Its S.O. number appears both as 'S.O. 2336(E)' and, in the Note, as 'S.O.1790(E)' without",
        "a space — spacing is not stable across this corpus.",
      ],
    },
    {
      id: "K4-SOURCE-07-CII-2022",
      slug: "cbdt-notification-62-2022-cii-fy-2022-23",
      no: "62/2022",
      so: "S.O. 2735(E)",
      date: "14 June 2022",
      fy: "2022-23",
      sl: 22,
      cii: 331,
      ay: "2023-24",
      eff: "1st day of April, 2023",
      amends:
        "the principal notification S.O. 1790(E) dated 5 June 2017, last amended by S.O. 2336(E) dated 15 June 2021",
      hazard: [
        "The notification number prints with an interior space — 'Notification No. 62 /2022' —",
        "so an assertion written as '62/2022' will not match the document. Assert what it says.",
        "First of this cluster to carry a digital Gazette ID (CG-DL-E-14062022-236565).",
      ],
    },
  ];

  return rows.map((r) => ({
    artifactId: r.id,
    out: `ay-2026-27/${r.slug}.txt`,
    pages: [1, 2],
    world: "AY 2026-27 / Income-tax Act, 1961",
    provision: `CBDT Notification No. ${r.no} / ${r.so} — FY ${r.fy} Cost Inflation Index under section 48 Explanation clause (v)`,
    loadBearing: [
      `${r.so} — exercise of powers under clause (v) of the Explanation to section 48 of the Income-tax Act, 1961`,
      `Inserted row: serial ${r.sl} / Financial Year ${r.fy} / Cost Inflation Index ${r.cii}`,
      `Effective ${r.eff}; applies to Assessment Year ${r.ay} and subsequent years`,
      `Amends ${r.amends}`,
    ],
    notes: [
      "OFFICIAL E-GAZETTE PUBLISHER; RANK-2 STATUTORY NOTIFICATION. Official publication does",
      "not promote the instrument to rank 1.",
      `Retrieved 2026-08-22 via e-Gazette 'Search by Ministry' (Ministry of Finance, ${r.date.replace(/^\d+ /, "")}).`,
      "THE ENGINE ROW FOR THIS YEAR NOW READS `instrument` (K4-24 Phase 0), AND THE VALUE DID NOT",
      "MOVE. The index below was read back from the -raw block before the marker changed, and it",
      "states exactly the figure already recorded in cost-inflation-index.ts. Retrieval supplies",
      "the EVIDENCE for a recorded value; it is never permission to change one.",
      ...r.hazard,
    ],
  }));
}

export const EXTRACTS = [
  {
    artifactId: "K4-23-S1",
    out: "ay-2026-27/cbdt-notification-44-2017-cii-fy-2001-02-to-2017-18.txt",
    pages: [1, 2],
    world: "AY 2026-27 / Income-tax Act, 1961",
    provision:
      "CBDT Notification No. 44/2017 / S.O. 1790(E) - the PRINCIPAL Cost Inflation Index notification, FY 2001-02 to FY 2017-18, under section 48 Explanation clause (v)",
    loadBearing: [
      "S.O. 1790(E) - exercise of powers under clause (v) of the Explanation to section 48 of the Income-tax Act, 1961",
      "Serials 1 to 17: 2001-02 100 through 2017-18 272",
    ],
    notes: [
      "OFFICIAL E-GAZETTE PUBLISHER; RANK-2 STATUTORY NOTIFICATION. Official publication does not promote the instrument to rank 1.",
      "This is the PRINCIPAL notification every later CII notification amends; 70/2025 inserts serial 25 into THIS table.",
      "It supplies seventeen of the twenty-five values the section 112 indexed branch can need. The other eight are supplied by the eight amending notifications, ALL of which are now registered - K4-SOURCE-07 closed the last five. See the engine's cost-inflation-index.ts evidence markers, which are the authority for that state rather than this note.",
      "Bilingual; the Hindi layer is degraded and the English layer is clean. All three modes agree on the table.",
    ],
  },
  {
    artifactId: "K4-23-S2",
    out: "ay-2026-27/cbdt-notification-39-2023-cii-fy-2023-24.txt",
    pages: [1, 2],
    world: "AY 2026-27 / Income-tax Act, 1961",
    provision:
      "CBDT Notification No. 39/2023 / S.O. 2571(E) - FY 2023-24 Cost Inflation Index under section 48 Explanation clause (v)",
    loadBearing: [
      "S.O. 2571(E) - exercise of powers under clause (v) of the Explanation to section 48 of the Income-tax Act, 1961",
      "Inserted row: serial 23 / Financial Year 2023-24 / Cost Inflation Index 348",
    ],
    notes: [
      "OFFICIAL E-GAZETTE PUBLISHER; RANK-2 STATUTORY NOTIFICATION.",
      "Bilingual; the Hindi layer is degraded and the English layer is clean.",
    ],
  },
  {
    artifactId: "K4-23-S3",
    out: "ay-2026-27/cbdt-notification-44-2024-cii-fy-2024-25.txt",
    pages: [1, 2],
    world: "AY 2026-27 / Income-tax Act, 1961",
    provision:
      "CBDT Notification No. 44/2024 / S.O. 2103(E) - FY 2024-25 Cost Inflation Index under section 48 Explanation clause (v)",
    loadBearing: [
      "S.O. 2103(E) - exercise of powers under clause (v) of the Explanation to section 48 of the Income-tax Act, 1961",
      "Inserted row: serial 24 / Financial Year 2024-25 / Cost Inflation Index 363",
    ],
    notes: [
      "OFFICIAL E-GAZETTE PUBLISHER; RANK-2 STATUTORY NOTIFICATION.",
      "Bilingual; the Hindi layer is degraded and the English layer is clean.",
    ],
  },
  {
    artifactId: "K4-SOURCE-04-S1",
    out: "ay-2026-27/cbdt-notification-70-2025-cii-fy-2025-26.txt",
    pages: [1, 2],
    world: "AY 2026-27 / Income-tax Act, 1961",
    provision:
      "CBDT Notification No. 70/2025 / S.O. 2954(E) - FY 2025-26 Cost Inflation Index under section 48 Explanation clause (v)",
    loadBearing: [
      "S.O. 2954(E) - exercise of powers under clause (v) of the Explanation to section 48 of the Income-tax Act, 1961",
      "Inserted row: serial 25 / Financial Year 2025-26 / Cost Inflation Index 376",
      "Effective 1 April 2026; applies to assessment year 2026-27 and subsequent assessment years",
    ],
    notes: [
      "OFFICIAL E-GAZETTE PUBLISHER; RANK-2 STATUTORY NOTIFICATION. Official publication does not promote the instrument to rank 1.",
      "The English instrument is on page 2; the Gazette cover and publication identity are on page 1.",
      "-layout and -raw keep the inserted row on one line; default extraction separates the three table cells but preserves their order. All three modes agree.",
      "The Hindi text layer is degraded. The English text layer is clean, and a visual review confirmed the boxed row and signature/publication line.",
      "This fills a source gap only. It does not decide section 112 comparison mechanics, indexation inputs, section 54/54F eligibility, or any other house-sale tax question, and it does not change the engine's refusal.",
    ],
  },
  {
    artifactId: "K4-SOURCE-05-ITR1-CHANGES",
    out: "ay-2026-27/itr-output/itr-1-schema-change-v1.1.txt",
    pages: [5, 5],
    world: "AY 2026-27 / Income-tax Act, 1961 / e-Filing output layer",
    provision: "ITR-1 Schema Change Document v1.1 - release changes on 30 June 2026",
    loadBearing: [
      "ExemptIncAgriOthUs10.SubCategory - description and enum updated",
      "ExemptIncAgriOthUs10.Description - new field added",
    ],
    notes: [
      "OFFICIAL PORTAL TECHNICAL ARTIFACT; NOT LAW AND OUTSIDE THE SOURCE-RANK LADDER.",
      "SCOPE IS PAGE 5 ONLY. Pages 1-4 are cover/revision/contents and are not committed.",
      "TABLE HAZARD: -layout and default separate some row labels from their cells; -raw gives",
      "the clearest row-major pairing. All three modes preserve the same two modifications.",
      "This registers an output contract and implements nothing (`D17`).",
    ],
  },
  {
    artifactId: "K4-SOURCE-05-ITR1-VALIDATIONS",
    out: "ay-2026-27/itr-output/itr-1-validation-rules-v1.0-sample.txt",
    pages: [4, 6],
    world: "AY 2026-27 / Income-tax Act, 1961 / e-Filing output layer",
    provision: "ITR-1 Validation Rules v1.0 - defect categories and opening Category A rules",
    loadBearing: [
      "the document's category definitions and enforcement descriptions",
      "the opening Category A scenarios, beginning with the document's sections 80C/80CCC/80CCD(1) aggregate rule",
    ],
    notes: [
      "RANK-5 PORTAL TECHNICAL MATERIAL. It does not decide substantive law.",
      "SCOPE IS PAGES 4-6 ONLY of 22. The full official bytes are hashed in the manifest.",
      "Default mode introduces extra line breaks inside table rows; -raw most clearly preserves",
      "serial-to-scenario order. Read all three modes before quoting a scenario.",
      "No validation is implemented in this retrieval session.",
    ],
  },
  {
    artifactId: "K4-SOURCE-05-ITR4-CHANGES",
    out: "ay-2026-27/itr-output/itr-4-schema-change-v1.1.txt",
    pages: [5, 5],
    world: "AY 2026-27 / Income-tax Act, 1961 / e-Filing output layer",
    provision: "ITR-4 Schema Change Document v1.1 - release changes on 30 June 2026",
    loadBearing: [
      "ExemptUs10.SubCategory - description and enum updated",
      "ExemptUs10.Description - new field added",
    ],
    notes: [
      "OFFICIAL PORTAL TECHNICAL ARTIFACT; NOT LAW AND OUTSIDE THE SOURCE-RANK LADDER.",
      "SCOPE IS PAGE 5 ONLY. Pages 1-4 are cover/revision/contents and are not committed.",
      "Default mode splits the change table column-major; -raw preserves the two row pairings",
      "most clearly. All three modes were read.",
      "This registers an output contract and implements nothing (`D17`).",
    ],
  },
  {
    artifactId: "K4-SOURCE-05-ITR4-VALIDATIONS",
    out: "ay-2026-27/itr-output/itr-4-validation-rules-v1.0-sample.txt",
    pages: [5, 7],
    world: "AY 2026-27 / Income-tax Act, 1961 / e-Filing output layer",
    provision: "ITR-4 Validation Rules v1.0 - defect categories and opening Category A rules",
    loadBearing: [
      "the A/B/D defect-category actions",
      "the opening Category A validation scenarios",
    ],
    notes: [
      "RANK-5 PORTAL TECHNICAL MATERIAL. It does not decide substantive law.",
      "SCOPE IS PAGES 5-7 ONLY of 24. The full official bytes are hashed in the manifest.",
      "TABLE HAZARD: default mode merges the D category marker into its action text; -layout",
      "and -raw preserve the category/action separation. Read all three modes.",
      "No validation is implemented in this retrieval session.",
    ],
  },
  {
    artifactId: "K4-SOURCE-05-ITR2-CHANGES",
    out: "ay-2026-27/itr-output/itr-2-schema-change-v1.2.txt",
    pages: [5, 5],
    world: "AY 2026-27 / Income-tax Act, 1961 / e-Filing output layer",
    provision: "ITR-2 Schema Change Document v1.2 - release changes through 13 August 2026",
    loadBearing: [
      "OthersIncDtlEI changes recorded for 30 June 2026",
      "EditAutopoulatedDetail added to ScheduleCGFor23, ScheduleCYLA, ScheduleBFLA and ScheduleSI on 13 August 2026",
    ],
    notes: [
      "OFFICIAL PORTAL TECHNICAL ARTIFACT; NOT LAW AND OUTSIDE THE SOURCE-RANK LADDER.",
      "SCOPE IS PAGE 5 ONLY. Pages 1-4 are cover/revision/contents and are not committed.",
      "ASSERT THE DOCUMENT'S ACTUAL SPELLING: `EditAutopoulatedDetail` (not a corrected",
      "`EditAutopopulatedDetail`). -raw gives the clearest row-major pairing.",
      "This registers an output contract and implements nothing (`D17`).",
    ],
  },
  {
    artifactId: "K4-SOURCE-05-ITR2-VALIDATIONS",
    out: "ay-2026-27/itr-output/itr-2-validation-rules-v1.0-sample.txt",
    pages: [5, 7],
    world: "AY 2026-27 / Income-tax Act, 1961 / e-Filing output layer",
    provision: "ITR-2 Validation Rules v1.0 - defect categories and opening Category A rules",
    loadBearing: [
      "the document's category definitions",
      "Category A opening scenarios, beginning with valid mobile number and PAN-name matching",
    ],
    notes: [
      "RANK-5 PORTAL TECHNICAL MATERIAL. It does not decide substantive law.",
      "SCOPE IS PAGES 5-7 ONLY of 51. The full official bytes are hashed in the manifest.",
      "Layout/default split multi-line scenarios differently; -raw preserves serial-to-scenario",
      "order most clearly. Read all three modes before quoting.",
      "No validation is implemented in this retrieval session.",
    ],
  },
  {
    artifactId: "K4-SOURCE-05-ITR3-CHANGES",
    out: "ay-2026-27/itr-output/itr-3-schema-change-v1.1.txt",
    pages: [5, 5],
    world: "AY 2026-27 / Income-tax Act, 1961 / e-Filing output layer",
    provision: "ITR-3 Schema Change Document v1.1 - release changes on 30 June 2026",
    loadBearing: [
      "ScheduleTDS2.TDSSection - description and enum updated",
      "ScheduleTDS3.TDSSection - description and enum updated",
    ],
    notes: [
      "OFFICIAL PORTAL TECHNICAL ARTIFACT; NOT LAW AND OUTSIDE THE SOURCE-RANK LADDER.",
      "SCOPE IS PAGE 5 ONLY. Pages 1-4 are cover/revision/contents and are not committed.",
      "Default mode extracts the table column-major; -raw preserves the two row pairings",
      "most clearly. All three modes were read.",
      "This registers an output contract and implements nothing (`D17`).",
    ],
  },
  {
    artifactId: "K4-SOURCE-05-ITR3-VALIDATIONS",
    out: "ay-2026-27/itr-output/itr-3-validation-rules-v1.0-sample.txt",
    pages: [3, 5],
    world: "AY 2026-27 / Income-tax Act, 1961 / e-Filing output layer",
    provision: "ITR-3 Validation Rules v1.0 - defect categories and opening Category A rules",
    loadBearing: [
      "the document's A/B/D defect-category actions",
      "the exact Category A scenario `HUF cannot claim relief u/s 89`",
    ],
    notes: [
      "RANK-5 PORTAL TECHNICAL MATERIAL. It does not decide section 89 or any tax question.",
      "SCOPE IS PAGES 3-5 ONLY of 73. The full official bytes are hashed in the manifest.",
      "Default mode puts serials and scenarios on separate blocks; -raw preserves row-major",
      "serial/scenario pairs. Read all three modes.",
      "No validation is implemented in this retrieval session.",
    ],
  },
  {
    artifactId: "K4-SOURCE-05-ITR14-NOTIFICATION",
    out: "ay-2026-27/itr-output/notification-45-2026-itr-1-opening.txt",
    pages: [15, 16],
    world: "AY 2026-27 / Income-tax Act, 1961 / notified ITR forms",
    provision:
      "CBDT Notification No. 45/2026 / G.S.R. 226(E) - Income-tax (Second Amendment) Rules, 2026 and the opening of substituted Form ITR-1",
    loadBearing: [
      "the instrument's section 139 and section 295 rule-making authority",
      "application to returns filed for AY 2026-27",
      "the substitution direction and opening identity of Form ITR-1",
    ],
    notes: [
      "OFFICIAL E-GAZETTE; RANK-2 STATUTORY NOTIFICATION. It is not a tax decision.",
      "SCOPE IS PAGES 15-16 ONLY of a 27-page Gazette file. The ITR-4 opening is committed",
      "as a separate bounded extract from pages 19-20 of these same hashed bytes.",
      "TABLE HAZARD: the form is a dense visual grid. -layout preserves more of the grid;",
      "default and -raw flatten cells in different orders. No table value is asserted here.",
      "Notification 57/2026 / G.S.R. 262(E) later corrects both forms and is registered separately.",
    ],
  },
  {
    artifactId: "K4-SOURCE-05-ITR14-NOTIFICATION",
    out: "ay-2026-27/itr-output/notification-45-2026-itr-4-opening.txt",
    pages: [19, 20],
    world: "AY 2026-27 / Income-tax Act, 1961 / notified ITR forms",
    provision:
      "CBDT Notification No. 45/2026 / G.S.R. 226(E) - substitution and opening of Form ITR-4",
    loadBearing: [
      "the direction substituting Form ITR-4",
      "the form identity, individual/HUF/firm scope words, rule 12 reference and AY 2026-27 masthead",
    ],
    notes: [
      "OFFICIAL E-GAZETTE; RANK-2 STATUTORY NOTIFICATION. It is not a tax decision.",
      "SCOPE IS PAGES 19-20 ONLY of a 27-page Gazette file. The title and ITR-1 opening are",
      "committed in a separate bounded extract from pages 15-16 of the same artifact.",
      "TABLE HAZARD: -layout, default and -raw traverse the form grid differently. All three",
      "carry the form identity; no table figure is relied upon in this retrieval session.",
      "Notification 57/2026 / G.S.R. 262(E) later corrects both forms and is registered separately.",
    ],
  },
  {
    artifactId: "K4-SOURCE-05-ITR2-NOTIFICATION",
    out: "ay-2026-27/itr-output/notification-46-2026-itr-2-opening.txt",
    pages: [38, 39],
    world: "AY 2026-27 / Income-tax Act, 1961 / notified ITR forms",
    provision:
      "CBDT Notification No. 46/2026 / G.S.R. 227(E) - Income-tax (Third Amendment) Rules, 2026 and substituted Form ITR-2",
    loadBearing: [
      "the instrument's section 139 and section 295 rule-making authority",
      "application to returns filed for AY 2026-27",
      "the substitution direction and opening identity of Form ITR-2",
    ],
    notes: [
      "OFFICIAL E-GAZETTE; RANK-2 STATUTORY NOTIFICATION. It is not a tax decision.",
      "SCOPE IS PAGES 38-39 ONLY of a 72-page Gazette file.",
      "TABLE HAZARD: -layout preserves the opening grid most closely; default and -raw flatten",
      "cells in different orders. No form-table value is asserted here.",
      "Notification 58/2026 / G.S.R. 263(E) later corrects the form and is registered separately.",
    ],
  },
  {
    artifactId: "K4-SOURCE-05-ITR3-NOTIFICATION",
    out: "ay-2026-27/itr-output/notification-47-2026-itr-3-opening.txt",
    pages: [75, 76],
    world: "AY 2026-27 / Income-tax Act, 1961 / notified ITR forms",
    provision:
      "CBDT Notification No. 47/2026 / G.S.R. 228(E) - Income-tax (Fourth Amendment) Rules, 2026 and substituted Form ITR-3",
    loadBearing: [
      "the instrument's section 139 and section 295 rule-making authority",
      "application to returns filed for AY 2026-27",
      "the substitution direction and opening identity of Form ITR-3",
    ],
    notes: [
      "OFFICIAL E-GAZETTE; RANK-2 STATUTORY NOTIFICATION. It is not a tax decision.",
      "SCOPE IS PAGES 75-76 ONLY of a 134-page Gazette file.",
      "TABLE HAZARD: the form begins as a dense visual grid; default collapses the notification",
      "heading into one line while -layout and -raw retain more structure. No table value is asserted.",
      "Notification 59/2026 / G.S.R. 264(E) later corrects the form and is registered separately.",
    ],
  },
  {
    artifactId: "K4-SOURCE-05-ITR14-CORRIGENDUM",
    out: "ay-2026-27/itr-output/notification-57-2026-corrigendum-itr-1-itr-4.txt",
    pages: [3, 3],
    world: "AY 2026-27 / Income-tax Act, 1961 / notified ITR forms",
    provision:
      "CBDT Notification No. 57/2026 / G.S.R. 262(E) - corrigendum to Forms ITR-1 and ITR-4",
    loadBearing: [
      "replacement of Form ITR-1 Schedule-IT",
      "the ITR-4 B2 sub-row renumbering and the exact `Iva` to `iva` correction",
    ],
    notes: [
      "OFFICIAL E-GAZETTE; RANK-2 CORRIGENDUM. Read with Notification 45/2026.",
      "SCOPE IS PAGE 3 ONLY of a four-page Gazette file.",
      "Default mode collapses the correction list and Schedule-IT cells; -layout and -raw retain",
      "separate clauses. All three modes carry `Iva` and `iva`; assert the source's exact case.",
    ],
  },
  {
    artifactId: "K4-SOURCE-05-ITR2-CORRIGENDUM",
    out: "ay-2026-27/itr-output/notification-58-2026-corrigendum-itr-2.txt",
    pages: [2, 2],
    world: "AY 2026-27 / Income-tax Act, 1961 / notified ITR forms",
    provision: "CBDT Notification No. 58/2026 / G.S.R. 263(E) - corrigendum to Form ITR-2",
    loadBearing: [
      "the nine corrections to Schedule CG, Schedule 112A, Schedule 115AD(1)(b)(iii), Schedule OS, Schedule CFL and Part B-TI",
      "the exact source substitutions `dxx` to `dxxi`, `2xv` to `2xiv`, and `w` to `v`",
    ],
    notes: [
      "OFFICIAL E-GAZETTE; RANK-2 CORRIGENDUM. Read with Notification 46/2026.",
      "SCOPE IS PAGE 2 ONLY of a three-page Gazette file.",
      "Default mode collapses all nine clauses into one long line; -layout and -raw retain the",
      "clause breaks. The words and spellings are consistent across all three modes.",
    ],
  },
  {
    artifactId: "K4-SOURCE-05-ITR3-CORRIGENDUM",
    out: "ay-2026-27/itr-output/notification-59-2026-corrigendum-itr-3.txt",
    pages: [2, 2],
    world: "AY 2026-27 / Income-tax Act, 1961 / notified ITR forms",
    provision: "CBDT Notification No. 59/2026 / G.S.R. 264(E) - corrigendum to Form ITR-3",
    loadBearing: [
      "the three corrections to Schedule CG and Schedule OS",
      "the document's exact sentence `the words and letters B13a shall be substituted B12a`",
    ],
    notes: [
      "OFFICIAL E-GAZETTE; RANK-2 CORRIGENDUM. Read with Notification 47/2026.",
      "SCOPE IS PAGE 2 ONLY of a three-page Gazette file.",
      "ASSERT WHAT THE DOCUMENT ACTUALLY SAYS: clause (ii) omits `by` or `with` between",
      "`shall be substituted` and `B12a`. Do not silently repair that Gazette wording.",
      "Default mode collapses each correction to one line; -layout/-raw introduce line breaks.",
    ],
  },
  {
    artifactId: "K4-SOURCE-02-S1",
    out: "ay-2026-27/finance-act-2026-s2.txt",
    world: "AY 2026-27 / Income-tax Act, 1961",
    provision: "Finance Act, 2026 — section 2 (Income-tax under Act 43 of 1961)",
    loadBearing: [
      "s.2(1) — charges AY 2026-27 at Part I-A rates (the AY world's charging provision)",
      "s.2(4)(b) Table Sl. No. 10 — NEW-REGIME surcharge rates (s.115BAC(1A))",
      "s.2(5) + Table Sl. No. 6 — new-regime marginal relief (To = Ro + So)",
      "s.2(6) — Health and Education Cess at FOUR PER CENT, in prose",
    ],
    notes: [
      "TABLE HAZARD: s.2(5)'s Table renders with amounts SHUFFLED ACROSS ROWS under -layout.",
      "The -raw section below pairs every column-C amount with its column-D amount correctly.",
      "OCR HAZARD: this document carries character-level corruption in section CROSS-REFERENCES",
      "— '115BAC(14)', '115BAC(M)', '115AD(1)(6)', '115AD(7)(6)', 'Rs. 1 ,00,00,000' all appear.",
      "The RATE WORDS are spelled out ('ten per cent.') and are unaffected. Do not quote a",
      "cross-reference from this document without corroboration.",
    ],
  },
  {
    artifactId: "K4-SOURCE-02-S2",
    out: "both-worlds/finance-act-2026-first-schedule.txt",
    world: "BOTH — Part I-A/IV-A serve the 1961 Act; Part I-B/IV-B serve the 2025 Act",
    provision: "Finance Act, 2026 — THE FIRST SCHEDULE (Parts I, II, III and IV, complete)",
    loadBearing: [
      "PART I A.--INCOME-TAX UNDER THE INCOME-TAX ACT, 1961 — the AY 2026-27 world",
      "  Paragraph A — old-regime slabs incl. resident senior (60-80) and super-senior (80+)",
      "  Paragraph F Table 1 Sl. No. 1 — OLD-REGIME individual surcharge rates",
      "  Paragraph F Table 2 Sl. No. 1 — old-regime marginal relief (Wo = Uo + Vo)",
      "PART I B.--INCOME-TAX UNDER THE INCOME-TAX ACT, 2025 — the TY 2026-27 world",
      "  Paragraph A items (I)/(II)/(III) — the old-regime slab tables, incl. the resident",
      "    60-80 and 80+ bands. `D298` said the 80+ band must not be assumed; item (III) is",
      "    where it IS sourced (`K4-PORT-04`).",
      "  Paragraph F Table 1 Sl. No. 1 / Table 2 Sl. No. 1 — TY surcharge and marginal relief",
      "PART III — RANK-1 CORROBORATION OF THE MECHANISM `D314` TURNS ON, and the reason this",
      "  file matters beyond its rate tables. Its opening line excepts advance tax \"in respect",
      "  of any income chargeable to tax under Part A, B, C or D of Chapter XIII ... at the rates",
      "  as specified in that Chapter or section\", which PRESUPPOSES what Finance Act 2026",
      "  s.3(3) provides — and s.3 is held here only in ICAI's RANK-2 reproduction. It is NOT",
      "  s.3(3) and charges nothing; it corroborates the mechanism's wording, not the charge.",
      "  NOTE Parts II and III serve the 2025 Act THROUGHOUT (their opening lines reference",
      "  \"the Income-tax Act, 2025 (30 of 2025)\"), unlike Parts I and IV which split A/B.",
    ],
    notes: [
      "THIS ONE FILE SERVES TWO STATUTORY WORLDS. Name the PART whenever you cite it.",
      "A `parallel-worlds` guard fails the build if the AY pack cites Part I-B, or the TY",
      "pack cites Part I-A.",
      "EVERY RATE IN THIS DOCUMENT IS IN A TABLE. -layout misrenders Paragraph F's Table 2.",
      "IDENTITY: this document's Part I-B Paragraph A is VERBATIM-IDENTICAL to the Finance",
      "Act 2026 appendix in ICAI's K4-PORT-02-S1 — which is what establishes that this is",
      "the Finance Act, 2026 First Schedule, since the PDF carries no title naming its Act.",
    ],
  },
  {
    artifactId: "K4-SOURCE-02-S3",
    out: "ay-2026-27/income-tax-rules-1962-rule-12.txt",
    world: "AY 2026-27 / Income-tax Act, 1961",
    provision: "Income-tax Rules, 1962 — rule 12 (Return of income)",
    loadBearing: [
      "r.12(1)(a) — prescribes Form SAHAJ (ITR-1)",
      "r.12(1)(a) proviso cl. (IV) — 'has total income, exceeding fifty lakh rupees'",
    ],
    notes: [
      "CLAUSE-NUMBERING HAZARD, and it is the reason -raw is emitted at all.",
      "The PDF wraps clause (IG)'s text onto a line whose MARKER CELL ALREADY HOLDS THE NEXT",
      "MARKER, so in the -layout and default renderings every roman numeral in this proviso",
      "sits ONE ROW OFF ITS OWN TEXT. Read naively, -layout pairs the fifty-lakh words with",
      "clause (V). The -raw section below gives (IV), and the footnote-bracket structure",
      "('2[(IV) ... rupees;]' opening and closing within one clause) agrees independently.",
      "The WORDS are identical in all three modes; only the NUMERAL was ever in doubt.",
      "SCOPE: this proviso carries FOURTEEN disqualifying conditions. The engine models ONE.",
    ],
  },
  {
    artifactId: "K4-SOURCE-02-S4",
    out: "ay-2026-27/income-tax-rules-1962-new-appendix-I.txt",
    world: "AY 2026-27 / Income-tax Act, 1961",
    provision: "Income-tax Rules, 1962 — NEW APPENDIX I (table of depreciation rates)",
    loadBearing: ["[See rule 5] — the Section 32 depreciation rate table, UNREAD and UNRESOLVED"],
    notes: [
      "*** NOT ONE RATE IN THIS DOCUMENT HAS BEEN READ, RESOLVED, QUOTED OR RELIED ON. ***",
      "K4-SOURCE-02 registered and extracted it and stopped there. UNBLOCKED IS NOT",
      "IMPLEMENTED. This extract is raw evidence, NOT a resolved reading.",
      "The -layout rendering is ALREADY VISIBLY BROKEN on the first table: item I(4) 'Purely",
      "temporary erections' renders with no rate on its line while '1[40]' appears twice,",
      "offset against the wrong rows. A session implementing Section 32 depreciation must",
      "resolve EVERY rate across all three modes below before quoting any of them.",
      "DO NOT SUBSTITUTE the Income-tax Rules 2026 Appendix I: rule 2321 defines \"'Act' means",
      "the Income-tax Act, 2025\", so that one serves s.33 and this one serves Section 32.",
    ],
  },
  {
    artifactId: "K4-SOURCE-02-S5",
    out: "corroboration-only/finance-bill-2026-as-introduced.txt",
    world: "BOTH — clause 2 (1961 Act) and clause 3 (2025 Act)",
    provision: "THE FINANCE BILL, 2026 — BILL No. 3 of 2026, AS INTRODUCED IN LOK SABHA",
    onlyPages: 12,
    loadBearing: ["Chapter II clauses 2 and 3, and the First Schedule as PROPOSED"],
    notes: [
      "*** A BILL IS NOT AN ACT AND SITS OUTSIDE THE §5 SOURCE-RANK LADDER. ***",
      "NEVER cite this as law. Its only legitimate use is CORROBORATION: comparing it against",
      "the enacted text (K4-SOURCE-02-S1/S2) shows what moved between Bill and Act, which §4",
      "warns is exactly where numbering and text shift.",
      "Only the first pages are extracted — enough to establish identity and the arrangement",
      "of clauses. The full text is in the registered PDF.",
    ],
  },
  // ═════════════════════════════════════════════════════════════════════════
  // `K4-PORT-04-S1` — THE FINANCE ACT, 2026 AS PUBLISHED IN THE GAZETTE.
  //
  // **THE FIRST GAZETTE ARTIFACT FOR THIS ACT, AND THE ONLY ONE THAT CARRIES
  // BOTH WORLDS' CHARGING SECTIONS.** Owner-supplied 2026-08-17, immediately
  // after this session recorded rank-1 corroboration for s.3 as OWED — which is
  // `D300`'s lesson arriving from the other direction: ask, and the document may
  // already exist.
  //
  // Every other Finance Act 2026 artifact here discloses "NOT the Gazette" in its
  // citation string, because they are ITD departmental publications (rank 1 but
  // not the Gazette) or ICAI's reproduction (rank 2). This one IS the Gazette.
  //
  // **THE GAZETTE IS NOW CITED BY BOTH PACKS (`K4-CITE-01`, `D315`).** Until
  // that session no pack cited this artifact, because retiring the
  // "NOT the Gazette" disclaimers meant editing caveats in the LIVE AY 2026-27
  // pack — text rendered to preparers — and inverting a `parallel-worlds`
  // assertion that then REQUIRED that disclaimer on every `K4-SOURCE-02`
  // citation. That contract change has now been made and recorded. Coverage
  // below is still driven by what is quoted: the two charging sections and
  // First Schedule Part I, plus Part III for the corroboration the TY pack
  // cites (now from the Gazette's own Part III).
  // ═════════════════════════════════════════════════════════════════════════
  {
    artifactId: "K4-PORT-04-S1",
    out: "both-worlds/finance-act-2026-gazette-chapter-ii.txt",
    pages: [2, 29],
    world: "BOTH — section 2 serves the Income-tax Act 1961, section 3 the Income-tax Act 2025",
    provision:
      "Finance Act, 2026 (No. 4 of 2026), CHAPTER II — the charging sections: section 2 " +
      "(\"Income-tax under Act 43 of 1961\") and section 3 (\"Income-tax under Act 30 of 2025\")",
    loadBearing: [
      "s.2(1) — charges AY 2026-27 at First Schedule Part I-A rates (the AY world's charge)",
      "s.2(3) — routes Chapter XII / XII-A cases (which contain s.115BAC) to those rates",
      "s.2(6) — Health and Education Cess at FOUR PER CENT, in prose, for the 1961-Act world",
      "s.3(1) — charges tax year 2026-27 at First Schedule Part I-B rates",
      "s.3(3) — THE PROVISION K4-PORT-04's TAX QUESTION TURNED ON. Routes Part A, B, C or D",
      "  of Chapter XIII cases to the rates specified in that Chapter or section; section 202",
      "  (the new regime) sits in Chapter XIII Part C, so s.3(3) reaches it. D314.",
      "s.3(2)(a) Table Sl. No. 4 / s.3(2)(b) — the s.202 assessee's exemption and the Xn formula",
      "s.3(15)/(16) — Health and Education Cess at 4%, in prose, for the 2025-Act world",
      "s.3(18) — definitions for this section and Parts I-B, II, III and IV-B",
    ],
    notes: [
      "*** THIS IS THE GAZETTE ITSELF. *** Ministry of Law and Justice (Legislative Department),",
      "Gazette of India Extraordinary, Part II Section 1, No. 9, 30 March 2026 / Chaitra 9, 1948",
      "(Saka); assented 30 March 2026; digitally signed 2026-03-31. Rank 1 at the TOP of the",
      "ladder (official-source-retrieval.md §5), and the only artifact here for which a citation",
      "needs no 'NOT the Gazette' disclaimer.",
      "-layout SPLITS THE MARGINAL NOTES INTO THE TEXT COLUMN, so s.3(1)'s charging words do not",
      "appear as a contiguous string in that mode. The default and -raw modes both carry them.",
      "Cross-check all three (§3.2) — this was measured on this artifact, not inherited.",
      "SEVEN BYTES IN THE WHOLE DOCUMENT ARE NON-UTF8 (the Devanagari masthead and the rupee",
      "glyphs) and decode to replacement characters. The English statutory text is clean.",
      "BOTH PACKS NOW CITE THIS (K4-CITE-01, D315). The TY pack's sixteen s.3 spans and the AY",
      "pack's six Finance Act 2026 spans are declared against THESE extracts; the TY pack's",
      "thirteen Part I-B AMOUNT spans deliberately stay on the ITD copy (K4-SOURCE-02-S2),",
      "whose 'Rs. 250000' formatting extracts where the Gazette's rupee glyph does not.",
    ],
  },
  {
    artifactId: "K4-PORT-04-S1",
    out: "both-worlds/finance-act-2026-gazette-first-schedule-part-i.txt",
    pages: [80, 87],
    world: "BOTH — Part I-A serves the Income-tax Act 1961, Part I-B the Income-tax Act 2025",
    provision:
      "Finance Act, 2026 (No. 4 of 2026), THE FIRST SCHEDULE, PART I — A.--Income-tax under the " +
      "Income-tax Act, 1961 and B.--Income-tax under the Income-tax Act, 2025",
    loadBearing: [
      "PART I-A Paragraph A — old-regime slabs incl. resident senior (60-80) and super-senior (80+)",
      "PART I-A Paragraph F — surcharge Table 1 and marginal-relief Table 2 (Wo = Uo + Vo)",
      "PART I-B Paragraph A items (I)/(II)/(III) — the SAME shape for the tax year. Item (III)",
      "  is where the 80+ band D298 said must not be assumed is actually sourced.",
      "PART I-B Paragraph F — TY surcharge Table 1 and marginal relief Table 2 (Wn = Un + Vn)",
    ],
    notes: [
      "*** THE RUPEE GLYPH DOES NOT EXTRACT IN PART I-B, AND THE CONSEQUENCE IS COUNTER-INTUITIVE.",
      "*** The Gazette prints the 2025-Act amounts with the rupee sign; pdftotext DROPS it, so the",
      "text reads 'exceed  250000' and ' 12500 plus 20%' with a leading blank. The ITD copy",
      "(K4-SOURCE-02-S2) prints the same amounts as 'Rs. 250000' and extracts cleanly.",
      "SO FOR A QUOTABLE PART I-B SPAN THE LOWER-RANKED ITD COPY IS BETTER EVIDENCE THAN THE",
      "GAZETTE. The higher authority is the harder one to quote. A re-citation session must decide",
      "that PER SPAN rather than assume the Gazette wins everywhere — and where it keeps the ITD",
      "copy, the citation should say why. Part I-A is unaffected: it prints 'Rs. 2,50,000'.",
      "A SECOND TEXTUAL DIFFERENCE, no figure involved: Part I-B here omits '(30 of 2025)' after",
      "'Income-tax Act, 2025' where the ITD copy carries it.",
      "EVERY RATE IN THIS PART IS IN A TABLE. Read all three modes before relying on a figure.",
    ],
  },
  {
    artifactId: "K4-PORT-04-S1",
    out: "both-worlds/finance-act-2026-gazette-first-schedule-part-iii.txt",
    pages: [96, 100],
    world: "TY 2026-27 / Income-tax Act, 2025 (Part III serves the 2025 Act throughout)",
    provision:
      "Finance Act, 2026 (No. 4 of 2026), THE FIRST SCHEDULE, PART III — rates for charging " +
      "income-tax in certain cases, deducting from \"Salaries\" and computing \"advance tax\"",
    loadBearing: [
      "The opening exclusion: advance tax is computed at Part III rates EXCEPT in respect of",
      "  income chargeable under Part A, B, C or D of Chapter XIII at the rates specified in that",
      "  Chapter or section — which PRESUPPOSES what s.3(3) provides, and is the rank-1",
      "  corroboration K4-PORT-04 cited for the D314 mechanism (from the ITD copy).",
    ],
    notes: [
      "WHY THIS PART IS COMMITTED AT ALL: the TY pack cites its opening exclusion as corroboration",
      "of the s.3(3) mechanism. K4-PORT-04 cited it from the ITD copy (K4-SOURCE-02-S2); K4-CITE-01",
      "(D315) re-pointed that span to THIS extract, so the Gazette's own wording of the same",
      "exclusion is what the pack's declaration is now checked against.",
      "IT IS NOT s.3(3) AND CHARGES NOTHING. It is an exclusion inside the advance-tax Part: it",
      "corroborates the mechanism's existence and wording, never the charge, and is silent on",
      "the cess.",
      "PARTS II AND III SERVE THE 2025 ACT THROUGHOUT — their opening lines reference the",
      "Income-tax Act, 2025 — unlike Parts I and IV, which split into A (1961) and B (2025)",
      "halves. So a TY citation may name Part II or III without breaching D301's half separation.",
    ],
  },
  // ═════════════════════════════════════════════════════════════════════════
  // `K4-PORT-04-S2` — THE CONSOLIDATED INCOME-TAX ACT, 1961, as amended by
  // Finance Act 2025. Owner-supplied 2026-08-17; closes `AUDIT-10-F4`'s headline
  // item, unretrieved since `AUDIT-10`.
  //
  // `MAINT-09` ADDS ONLY THE RANGES AUDIT-14-F2 NEEDS. Section 16 and the
  // Chapter VI-A cap provisions were already held in this artifact but the AY
  // pack cited neither, making two rules unsignable. Each implemented group has
  // a narrow range below; no full-Act dump and no `QUOTE_NO_COMMITTED_EXTRACT`
  // parking declaration substitutes for committing the source text.
  //
  // THE EARLIER s.28-s.30 RANGE CLOSES A KNOWN LIVE FALSE PASS. `MAINT-03` (`D308`) found the
  // TY pack's `business_books_computation` caveat quoting 1961 s.29 —
  // "in accordance with the provisions contained in sections 30 to 43D", for
  // contrast with the 2025 Act's s.27 — and matching only off a READING NOTE in
  // an extract, i.e. this repository's own prose. It is on page 137 here.
  // ═════════════════════════════════════════════════════════════════════════
  {
    artifactId: "K4-PORT-04-S2",
    out: "ay-2026-27/income-tax-act-1961-s016-standard-deduction.txt",
    pages: [127, 128],
    world: "AY 2026-27 / Income-tax Act, 1961",
    provision: "Income-tax Act, 1961 — section 16 (deductions from salaries)",
    loadBearing: [
      "s.16(ia) — fifty thousand rupees or salary, whichever is less",
      "s.16(ia) proviso — seventy-five thousand rupees where tax is computed under s.115BAC(1A)(ii)",
    ],
    notes: [
      "*** THIS IS A CONSOLIDATION, NOT THE GAZETTE. Rank 2; publisher not established. ***",
      "MAINT-09 / AUDIT-14-F2 (2026-08-21): pages 127-128 were read in -layout, default and",
      "-raw. The base deduction is on page 127; its s.115BAC(1A)(ii) substitution proviso",
      "begins at the page break on page 128. All three modes carry both declared spans.",
      "CITATION ONLY: the pack remains draft and unverified; no amount or computed result moved.",
    ],
  },
  {
    artifactId: "K4-PORT-04-S2",
    out: "ay-2026-27/income-tax-act-1961-s080c-s080cce-deduction-caps.txt",
    pages: [310, 322],
    world: "AY 2026-27 / Income-tax Act, 1961",
    provision:
      "Income-tax Act, 1961 — Chapter VI-A opening and sections 80C, 80CCD(1B) and 80CCE " +
      "(basic and additional deduction caps)",
    loadBearing: [
      "Chapter VI-A — deductions to be made in computing total income",
      "s.80C and s.80CCE — one hundred and fifty thousand rupees",
      "s.80CCD(1B) — additional fifty thousand rupees",
    ],
    notes: [
      "*** THIS IS A CONSOLIDATION, NOT THE GAZETTE. Rank 2; publisher not established. ***",
      "MAINT-09 / AUDIT-14-F2 (2026-08-21): all declared spans were read in -layout, default",
      "and -raw. TABLE WARNING: list/table alignment is not reliable under -layout; the quoted",
      "cap sentences are prose and agree across all three modes after whitespace normalisation.",
      "The range starts at the Chapter VI-A opening and ends with s.80CCE on page 322.",
      "CITATION ONLY: the pack remains draft and unverified; no amount or computed result moved.",
    ],
  },
  {
    artifactId: "K4-PORT-04-S2",
    out: "ay-2026-27/income-tax-act-1961-s080d-health-insurance.txt",
    pages: [324, 325],
    world: "AY 2026-27 / Income-tax Act, 1961",
    provision: "Income-tax Act, 1961 — section 80D (health-insurance deduction)",
    loadBearing: [
      "s.80D(2) — twenty-five-thousand-rupee self/family and parents buckets",
      "s.80D(4) — fifty-thousand-rupee substitution for a senior citizen",
    ],
    notes: [
      "*** THIS IS A CONSOLIDATION, NOT THE GAZETTE. Rank 2; publisher not established. ***",
      "MAINT-09 / AUDIT-14-F2 (2026-08-21): pages 324-325 were read in -layout, default and",
      "-raw. The section crosses the page boundary; all three modes carry the declared",
      "twenty-five-thousand to fifty-thousand substitution span.",
      "CITATION ONLY: the pack remains draft and unverified; no amount or computed result moved.",
    ],
  },
  {
    artifactId: "K4-PORT-04-S2",
    out: "ay-2026-27/income-tax-act-1961-s080g-donations.txt",
    pages: [331, 337],
    world: "AY 2026-27 / Income-tax Act, 1961",
    provision: "Income-tax Act, 1961 — section 80G (donations to certain funds and institutions)",
    loadBearing: [
      "s.80G(1) — whole-sum and fifty-per-cent categories",
      "s.80G(5) — qualifying institution/fund conditions",
    ],
    notes: [
      "*** THIS IS A CONSOLIDATION, NOT THE GAZETTE. Rank 2; publisher not established. ***",
      "MAINT-09 / AUDIT-14-F2 (2026-08-21): pages 331-337 were read in -layout, default and",
      "-raw. LIST/TABLE WARNING: -layout interleaves long clause markers; reliance requires",
      "the default and -raw cross-check. The engine still passes 80G through and does not",
      "compute qualifying limits or category eligibility; this extract does not widen it.",
      "CITATION ONLY: the pack remains draft and unverified; no amount or computed result moved.",
    ],
  },
  {
    artifactId: "K4-PORT-04-S2",
    out: "ay-2026-27/income-tax-act-1961-s080tta-s080ttb-deposit-interest.txt",
    pages: [398, 398],
    world: "AY 2026-27 / Income-tax Act, 1961",
    provision:
      "Income-tax Act, 1961 — sections 80TTA and 80TTB (interest on savings/deposits)",
    loadBearing: [
      "s.80TTA — ten-thousand-rupee cap and exclusion of the s.80TTB assessee",
      "s.80TTB — fifty-thousand-rupee cap for a senior citizen",
    ],
    notes: [
      "*** THIS IS A CONSOLIDATION, NOT THE GAZETTE. Rank 2; publisher not established. ***",
      "MAINT-09 / AUDIT-14-F2 (2026-08-21): page 398 contains both provisions and was read in",
      "-layout, default and -raw. All three modes carry both cap sentences and the mutually",
      "exclusive population wording.",
      "CITATION ONLY: the pack remains draft and unverified; no amount or computed result moved.",
    ],
  },
  {
    artifactId: "K4-PORT-04-S2",
    out: "ay-2026-27/income-tax-act-1961-s028-s030-business-computation.txt",
    pages: [135, 138],
    world: "AY 2026-27 / Income-tax Act, 1961",
    provision:
      "Income-tax Act, 1961 — sections 28 to 30 (profits and gains of business or profession: the " +
      "charge, how the income is computed, and the first of the computation provisions)",
    loadBearing: [
      "s.29 — \"The income referred to in section 28 shall be computed in accordance with the",
      "  provisions contained in sections 30 to 43D.\" THE SPAN MAINT-03 FOUND MATCHING ONLY OFF A",
      "  READING NOTE. The TY pack quotes it for CONTRAST with the 2025 Act's s.27, whose range is",
      "  wider and carries an express carve-out (\"sections 28 to 60, except section 58\").",
      "s.28 Explanation 2 — speculation business treated as distinct and separate",
      "s.43(5) — the \"speculative transaction\" definition and its carve-outs (K4-18's F&O slice)",
    ],
    notes: [
      "*** THIS IS A CONSOLIDATION, NOT THE GAZETTE, AND ITS PUBLISHER IS NOT ESTABLISHED. ***",
      "Rank 2. The document carries no imprint or title page — only \"INCOME-TAX ACT, 1961*",
      "[43 OF 1961] [AS AMENDED BY FINANCE ACT, 2025]\" and an editorial front note. The",
      "annotation style matches the Income Tax Department's own reprint, but that is an INFERENCE.",
      "THE EDITORIAL BRACKETS SIT INSIDE THE QUOTED WORDS. Amendment markers and bracketed",
      "substitutions appear mid-sentence throughout this Act, which is the QUOTE_ANNOTATION_STRIPPED",
      "hazard already in the vocabulary (rule 12's \"1st day of April, 94[2026]\"). A faithful",
      "quotation of a consolidated provision is frequently NOT byte-identical here — check per span.",
      "s.29 itself is CLEAN of that: it carries no amendment marker at all, which is why this one",
      "span moves to verbatimQuotes while nothing else does.",
      "VINTAGE LIMIT: amended to FINANCE ACT 2025 only. \"Finance Act, 2026\" occurs ZERO times in",
      "the full 916-page extraction (verified). Finance Act 2026's amendments TO the 1961 Act live",
      "in K4-PORT-04-S1's Chapter III, pages 30-79 of the Gazette — held, but NOT extracted. Do",
      "not treat this consolidation as the current 1961 Act without checking there.",
      "LINE WRAPPING DEFEATS A NAIVE GREP on this artifact: s.29's own span, s.115BAC's heading,",
      "s.43(5) and Explanation 2 to s.28 were all found only after normalising whitespace. Do not",
      "conclude a provision is absent because a line-based search missed it.",
    ],
  },
  {
    artifactId: "K4-PORT-04-S2",
    out: "ay-2026-27/income-tax-act-1961-s002-capital-asset-and-holding.txt",
    pages: [4, 20],
    world: "AY 2026-27 / Income-tax Act, 1961",
    provision:
      "Income-tax Act, 1961 — section 2 clauses (14) (capital asset) and (42A) (short-term capital asset)",
    loadBearing: [
      's.2(14) — "capital asset" means property of any kind held by an assessee',
      's.2(42A) — "short-term capital asset" means a capital asset held for not more than twenty-four months',
    ],
    notes: [
      "*** THIS IS A CONSOLIDATION, NOT THE GAZETTE. Rank 2. Same vintage limit as the s.28-s.30 extract. ***",
      "K4-21 (2026-08-18): three-mode read. Default / -layout / -raw all carry \"twenty-four\" and",
      "\"capital asset\\\" means\". Gazette Chapter III Part A (K4-PORT-04-S1 pages 30-79) does NOT",
      "amend s.2(14) or s.2(42A). The default limb is 24 months; listed securities are 12.",
    ],
  },
  {
    artifactId: "K4-PORT-04-S2",
    out: "ay-2026-27/income-tax-act-1961-s045-s050c-capital-gains.txt",
    pages: [236, 258],
    world: "AY 2026-27 / Income-tax Act, 1961",
    provision:
      "Income-tax Act, 1961 — sections 45, 48 and 50C (charge, mode of computation, stamp-duty deeming)",
    loadBearing: [
      "s.45(1) — profits or gains from the transfer of a capital asset in the previous year",
      "s.48 second proviso — indexation only for a transfer which takes place before 23 July 2024",
      "s.50C third proviso — stamp duty value within one hundred and ten per cent of consideration",
      "CII table in footnote 48c ends at 2024-25 : 363. FY 2025-26 is absent in all three modes.",
    ],
    notes: [
      "*** THIS IS A CONSOLIDATION, NOT THE GAZETTE. Rank 2. Same vintage limit as the s.28-s.30 extract. ***",
      "K4-21 (2026-08-18): three-mode read. Default / -layout / -raw agree on the s.45(1) charging",
      "words, the 23 July 2024 cutoff, the 110% tolerance and the CII table ending 2024-25 : 363.",
      "\"2025-26\" occurs ZERO times in this page range in every mode. Gazette Chapter III Part A",
      "does NOT amend s.45, s.48 or s.50C (amended 1961 sections: 92CA, 139, 140B, 144B, 144C,",
      "147, 148, 150, 153, 153B, 220, 222, 234H, 245, 245MA, 254, 270A, 270AA, 274, 275A, 275B,",
      "276, 277, 277A, 278, 278A, 280, 292B, 292BB).",
    ],
  },
  {
    artifactId: "K4-PORT-04-S2",
    out: "ay-2026-27/income-tax-act-1961-s111a-s112-special-rate-capital-gains.txt",
    pages: [433, 436],
    world: "AY 2026-27 / Income-tax Act, 1961",
    provision:
      "Income-tax Act, 1961 — sections 111A and 112 (special-rate STCG on listed equity; LTCG rate)",
    loadBearing: [
      "s.111A — listed equity / equity-oriented fund / business trust only. Not a house.",
      "s.112(1)(a)(ii)(B) — twelve and one-half per cent on or after 23 July 2024",
      "s.112(1)(a) second proviso — land or building acquired before 23 July 2024 comparison",
    ],
    notes: [
      "*** THIS IS A CONSOLIDATION, NOT THE GAZETTE. Rank 2. Same vintage limit as the s.28-s.30 extract. ***",
      "K4-21 (2026-08-18): three-mode read. All three modes carry \"twelve and one-half per cent\"",
      "and the land-or-building-acquired-before-23-July-2024 proviso. Gazette Chapter III Part A",
      "does NOT amend s.111A or s.112. The 12.5% rate is sourced and recorded; it does not fire",
      "for any house-sale in AY 2026-27 (every long-term holding this year was acquired before",
      "the cutoff, so the old-law comparison is owed). FY 2025-26 CII is now held under",
      "K4-SOURCE-04-S1; the five FY 2018-19 to FY 2022-23 instruments remain missing.",
    ],
  },
  {
    artifactId: "K4-PORT-04-S2",
    out: "ay-2026-27/income-tax-act-1961-s055-cost-of-acquisition.txt",
    pages: [276, 279],
    world: "AY 2026-27 / Income-tax Act, 1961",
    provision:
      "Income-tax Act, 1961 - section 55 (meaning of adjusted, cost of improvement and cost of acquisition)",
    loadBearing: [
      "s.55(2)(ac) - the section 112A cost basis for specified assets acquired before 1 February 2018",
      "s.55(2)(b) - the optional 1 April 2001 fair-market-value basis for a pre-2001 asset",
    ],
    notes: [
      "*** THIS IS A CONSOLIDATION, NOT THE GAZETTE. Rank 2. ***",
      "SCOPE IS PAGES 276-279 ONLY. Section 56 starts on page 280.",
      "THE PRE-2001 INPUT IS NOT A NOTIFICATION FIGURE. The section offers a case-specific fair",
      "market value on 1 April 2001; this extract corrects the brief's earlier source request",
      "without choosing a value or implementing a valuation field.",
      "MODE HAZARD: default keeps several provisos on one long line; -layout/-raw split them.",
      "All three modes carry the dates and operative alternatives after whitespace normalisation.",
    ],
  },
  {
    artifactId: "K4-PORT-04-S2",
    out: "ay-2026-27/income-tax-act-1961-s112a-listed-equity-ltcg.txt",
    pages: [436, 437],
    world: "AY 2026-27 / Income-tax Act, 1961",
    provision: "Income-tax Act, 1961 - section 112A (listed-equity long-term capital gains)",
    loadBearing: [
      "s.112A(1) - the specified long-term equity share, equity-oriented fund and business-trust-unit boundary",
      "s.112A(2) - the post-23-July-2024 rate branch and aggregate threshold wording",
    ],
    notes: [
      "*** THIS IS A CONSOLIDATION, NOT THE GAZETTE. Rank 2. ***",
      "SCOPE IS PAGES 436-437 ONLY; section 113 begins on page 438.",
      "The 31 January 2018 acquisition-basis mechanics are in s.55(2)(ac), committed separately.",
      "MODE HAZARD: default collapses the opening conditions and rate limb into long lines;",
      "-layout/-raw retain clause breaks. All three modes were read; no treatment was decided.",
    ],
  },
  ...ita2025Sections(),
  ...financeActLookbackSections(),
  ...section89SubstantiveProvisions(),
  {
    // K4-24 — the rule 21A counterpart, and the FORM. Registered as a citation
    // only; no 2025-Act arithmetic exists here and none is authorised.
    artifactId: "K4-PORT-02-S2",
    out: "ty-2026-27/income-tax-rules-2026-rule-73-section-157-relief.txt",
    pages: [123, 127],
    world: "TY 2026-27 / Income-tax Act, 2025",
    provision:
      "Income-tax Rules, 2026 — rule 73 (relief under section 157(1) when salary is paid in arrears or in advance, gratuity, etc.) and its Form No. 39 — the counterparts of Income-tax Rules, 1962 rule 21A and rule 21AA with Form No. 10E",
    loadBearing: [
      "r.73(1) Table Sl. 1 — the arrears / advance salary / family-pension limb, drafted as Steps 1-4 with named terms (A = C - D, B = aggregate of E, E = F - G)",
      "r.73(1) Table Sl. 2-5 — gratuity (5-15 years and 15 years or more), termination compensation, and commutation of pension, each as an explicit average-rate formula",
      "r.73(2) — the residual: 'the Board may, having regard to the circumstances of the case, allow such relief as it deems fit'",
      "r.73(3) — the particulars are furnished in FORM No. 39, on or before the due date specified under section 263(1)(c)",
      "r.73(4) — the employer route, the counterpart of rule 21AA",
    ],
    notes: [
      "*** RANK 2. THIS IS ICAI'S REPRODUCTION, NOT THE GAZETTE, AND EXTRACTING IT DOES NOT",
      "PROMOTE IT. *** The instrument is CBDT Notification No. 64/2026 / GSR 286(E).",
      "THE DRAFTING SHAPE DIFFERS FROM RULE 21A AND THAT IS THE POINT OF EXTRACTING IT. Rule 21A",
      "states five limbs as prose sub-rules; rule 73 states the same five as a TABLE of named",
      "formulae with defined terms. The substance appears to correspond limb for limb, but",
      "WHETHER THE TWO ARE EQUIVALENT IS A TAX QUESTION (§2 rule 5) and is NOT decided here.",
      "TWO DIFFERENCES ARE VISIBLE ON THE FACE OF THE TEXT. (1) r.73(3) imposes a DUE-DATE",
      "condition on furnishing Form 39 that rule 21AA does not impose for Form 10E. (2) rule 21AA",
      "carries only the employer route; rule 73 carries both a direct route (3) and the employer",
      "route (4).",
      "SCOPE: pages 123-127 only. Rule 72 ends on page 122 and rule 74 (the s.158 machinery)",
      "begins on page 127, deliberately outside what this range is load-bearing for.",
      "FORM No. 39 ITSELF IS NOT HELD. This range establishes that rule 73(3) PRESCRIBES it; the",
      "form's own layout is unretrieved, so `D17` binds exactly as it did for Form 10E before",
      "`K4-SOURCE-07` inspected that specimen. No field of Form 39 may be modelled.",
    ],
  },
  {
    artifactId: "K4-PORT-02-S2",
    out: "ty-2026-27/income-tax-rules-2026-rule-164.txt",
    pages: [225, 229],
    world: "TY 2026-27 / Income-tax Act, 2025",
    provision: "Income-tax Rules, 2026 — rule 164 (return of income: Form SAHAJ / Form SUGAM)",
    loadBearing: [
      "r.164(2) — puts a resident individual's return on Form SAHAJ (ITR-1)",
      "r.164(3)(k) — 'has total income, exceeding fifty lakh rupees' (the TY ITR-1 ceiling)",
    ],
    notes: [
      "*** RANK 2. THIS IS A REPRODUCTION, NOT THE GAZETTE, AND EXTRACTING IT DOES NOT",
      "PROMOTE IT. *** The instrument is CBDT Notification No. 64/2026 [F. No.",
      "370142/41/2025-TPL] / GSR 286(E) dated 16 April 2026; what is committed here is ICAI's",
      "edition of it. A load-bearing quotation still wants rank-1 corroboration, and the TY",
      "pack's citation string discloses the rank for exactly that reason (`D301`, §5).",
      "SCOPE: pages 225-229 only — rule 164 and nothing else. Rule 165 begins on page 229.",
      "The 1962-Rules counterpart for the AY world is rule 12, extracted separately at",
      "ay-2026-27/income-tax-rules-1962-rule-12.txt. SAME FIGURE, DIFFERENT INSTRUMENT,",
      "DIFFERENT WORLD — do not merge the two citations (`K4-SOURCE-02`).",
      "THE ITR-1 PARAMETER IS NO LONGER WITHHELD (`K4-PORT-04`, `D314`). This note said it",
      "was, on `D301`'s sequencing ground that supplying it would flip `recommendItrForm`",
      "servable. Slice 5 is the session `D301` was deferring to, and it supplied all six.",
    ],
  },
  {
    artifactId: "K4-PORT-02-S1",
    out: "ty-2026-27/finance-act-2026-s3.txt",
    pages: [834, 859],
    world: "TY 2026-27 / Income-tax Act, 2025",
    provision:
      "Finance Act, 2026 — Chapter II section 3 (Income-tax under Act 30 of 2025), the charging " +
      "section for tax year 2026-27, with Chapter I section 1 (commencement) ahead of it",
    loadBearing: [
      "s.3(1) — charges tax year 2026-27 'at the rates specified in Part I-B of the First Schedule'",
      "  and directs that the tax so charged 'shall be increased by a surcharge'",
      "s.3(3) — THE PROVISION THE PORT'S TAX QUESTION TURNED ON. In cases to which Part A, B, C",
      "  or D of Chapter XIII applies, tax is determined as provided in that Chapter/section and",
      "  with reference to the rates specified there. Section 202 (the new regime) sits in",
      "  Chapter XIII Part C ('New Tax Regimes', ss.199-205), so s.3(3) reaches it.",
      "s.3(2)(a) Table Sl. No. 4 — Rs. 400000 maximum not chargeable for a s.202 assessee",
      "s.3(2)(b) — the Xn/Yn formula, 'at the rates specified in Paragraph A of Part I-B of the",
      "  First Schedule or section 202 of the said Act'",
      "s.3(4)(a)(ii) — a s.202 person is excepted from the Paragraph F surcharge limb",
      "s.3(15) — Health and Education Cess at 4%, IN PROSE, on sub-sections (1) to (5)",
      "s.3(16) — the same 4% cess on sub-sections (6) to (14)",
    ],
    notes: [
      "*** RANK 2. THIS IS A REPRODUCTION, NOT THE GAZETTE, AND EXTRACTING IT DOES NOT",
      "PROMOTE IT. *** Rank-1 corroboration for s.3 is still OWED and is a bounded task:",
      "`incometaxindia.gov.in/finance-acts` serves the Act per section under the owner",
      "save-dialog handoff (`official-source-retrieval.md` §3.1) — one owner action. The ITD",
      "copy already on disk is `K4-SOURCE-02-S1`, which is s.2 (the 1961-Act half) and NOT s.3.",
      "WHY THIS ARTIFACT AND NOT ANOTHER: s.3 is reproduced in NO other artifact held here.",
      "ICAI omits the Finance Act's 1961-Act half (s.2, First Schedule Part I-A, Chapter III",
      "Part A) with its own '* * *' marker; the ITD First Schedule PDF carries the Schedule",
      "but none of the charging sections. This file is the only evidence base for an s.3 quote.",
      "SCOPE: pages 834-859 of the PDF, which is Chapter I s.1 plus the whole of Chapter II s.3.",
      "Page 859 also begins Chapter III s.35 (amendment of section 2 of the Income-tax Act,",
      "2025) — that overspill is the page boundary, not part of the provision group.",
      "s.3(15)/(16) ARE PROSE, NOT A TABLE, so the whole-document table hazard does not reach",
      "the cess figure. Nearly everything else in s.3 IS a table (the surcharge Tables under",
      "sub-sections (4), (5) and (10) to (13)) and does carry it — cross-check all three modes.",
      "TYPESETTING: this edition prints rupee amounts WITHOUT group separators inside s.3",
      "('250000', '5000000'), while the ITD First Schedule copy prints Part I-A with separators",
      "('Rs. 2,50,000') and Part I-B without. Do not read a separator difference as a different",
      "figure, and do not normalise one into a quotation.",
      "THE ELISION IS VISIBLE HERE AND IS EVIDENCE: Chapter II opens '* * *' and jumps straight",
      "to s.3, which is how `K4-SOURCE-01` (`D301`) established that s.2 is omitted rather than",
      "absent from the Act.",
    ],
  },
  // ---------------------------------------------------------------------
  // `K4-SOURCE-07` (2026-08-22). Three clusters, added together because they
  // were retrieved together, and each carries a different provenance shape.
  //
  // (1) THE FIVE OUTSTANDING COST INFLATION INDEX NOTIFICATIONS. `K4-SOURCE-05`
  //     recorded these NOT FOUND after bounded e-Gazette id interpolation, and
  //     they were the last gap in the indexation chain. They were found through
  //     the e-Gazette `Search by Ministry` form — a genuinely different route,
  //     not a retry — which is the same form that surfaced both
  //     `Finance (No. 2)` Acts for `K4-SOURCE-06`.
  //
  //     `K4-24` PHASE 0 RE-MARKED THE FIVE ENGINE ROWS TO `instrument` AND
  //     MOVED NO VALUE — each index was read back from the committed `-raw`
  //     block first. A retrieved notification is the missing evidence for a
  //     value already recorded; it is never permission to change one.
  //
  // (2) THE CONSOLIDATED INCOME-TAX RULES, 1962, per-rule. The acquisition
  //     brief §2.1 asked for the consolidated Rules "as one document if at all
  //     possible" because fetching rules one owner-action at a time is how this
  //     repository spent three sittings on two rules. ITD publishes exactly
  //     that, as a static stored `/documents/` file — so ten of the brief's
  //     thirteen priority items came from ONE owner action.
  //
  //     THE PAGE RANGES BELOW WERE NOT DERIVED FROM A HEADING SCAN, AND THE
  //     REASON IS A DEFECT THIS SESSION HIT AND CORRECTED. Rule numbers and
  //     TABLE SERIAL NUMBERS share the shape `N. ` at line start, so the first
  //     index put rule 3 on page 9 — pages 9-12 are still rule 2BB's allowance
  //     table, and rule 3 is on page 31. Footnote lines (`53. Substituted by`)
  //     collide the same way. Every range here was matched on the rule's
  //     MARGINAL HEADING TEXT and then verified by reading the boundary page.
  //
  // (3) THE THREE PRESCRIBED FORMS. Each is committed whole because each IS a
  //     single provision-group already, the same shape as `K4-SOURCE-02-S1`…`S4`.
  //
  // WHAT NONE OF THIS DOES: it decides no tax question, specifies no section 89
  // relief arithmetic, implements nothing, and moves no pack toward
  // `ca_verified`.
  // ---------------------------------------------------------------------
  ...ciiNotifications(),
  {
    artifactId: "K4-SOURCE-07-RULES-1962",
    out: "ay-2026-27/income-tax-rules-1962-rule-21A-21AA-section-89-relief.txt",
    pages: [306, 308],
    world: "AY 2026-27 / Income-tax Act, 1961",
    provision:
      "Income-tax Rules, 1962 — rule 21A (relief when salary is paid in arrears or in advance) " +
      "and rule 21AA (furnishing of particulars for claiming relief under section 89)",
    loadBearing: [
      "rule 21A(1) — the heads of receipt relief is available for, each routed to its own sub-rule",
      "rule 21A(2) — the arrears/advance computation, which is why section 89 needs EARLIER YEARS'",
      "  rate schedules and not merely the current year's",
      "rule 21AA — 'he may furnish ... the particulars specified in Form No. 10E'",
    ],
    notes: [
      "*** RANK 2. A CONSOLIDATED DEPARTMENTAL REPRINT, NOT THE NOTIFYING INSTRUMENT. ***",
      "Extracting it does not promote it, and a load-bearing quotation still wants the",
      "Gazette notification that made the amendment.",
      "THE TWO RULES ARE COMMITTED TOGETHER DELIBERATELY: they are the section 89 pair, and",
      "keeping them in one file makes the 21A/21AA split visible where a reader meets it.",
      "THE FORM IS PRESCRIBED BY RULE 21AA, NOT RULE 21A. Form 10E's own rubric reads",
      "'[See rule 21AA]'. The acquisition brief §2.1 names the pair as 'Rule 21A + Form 10E',",
      "which elides that distinction; the extract carries both rules so it cannot be re-elided.",
      "HOLDING THIS RULE DOES NOT MAKE SECTION 89 COMPUTABLE. `D311` records the gap's cause as",
      "structural — rule 21A(2) needs each earlier year's own rate schedule and total income,",
      "and this engine holds ONE year of rate parameters and no multi-year state. The",
      "`K4-SOURCE-06` Finance Acts supply the schedules; nothing here supplies the state, and",
      "no session has been authorized to design the computation.",
      "Page 308 also carries rule 21AA's own footnotes 1 and 2 (the IT (Eighth Amdt.) Rules,",
      "2024 substitutions of 'section 89' for 'section 89(1)'), which is why the range ends",
      "there rather than at 307.",
    ],
  },
  {
    artifactId: "K4-SOURCE-07-RULES-1962",
    out: "ay-2026-27/income-tax-rules-1962-rule-3-perquisite-valuation.txt",
    pages: [31, 35],
    world: "AY 2026-27 / Income-tax Act, 1961",
    provision: "Income-tax Rules, 1962 — rule 3 (valuation of perquisites)",
    loadBearing: [
      "rule 3(1) — valuation of rent-free / concessional accommodation",
      "rule 3(2) — valuation of the motor-car perquisite",
      "rule 3(7) — the residual perquisites, including concessional loans and ESOP-adjacent items",
    ],
    notes: [
      "*** RANK 2 — CONSOLIDATED DEPARTMENTAL REPRINT. ***",
      "PAGE RANGE VERIFIED, NOT INFERRED. A heading scan placed this rule on page 9; page 9 is",
      "inside rule 2BB's allowance table and the digit was a table serial. Rule 3A begins on",
      "page 36, which is what bounds this range.",
      "ALMOST ENTIRELY TABLES, so §3.2 governs the whole extract rather than a footnote in it:",
      "never read a valuation figure against its head of perquisite from a single mode.",
      "NOTHING IN THIS REPOSITORY VALUES A PERQUISITE. This is source for a future session.",
    ],
  },
  {
    artifactId: "K4-SOURCE-07-RULES-1962",
    out: "ay-2026-27/income-tax-rules-1962-rule-2BB-exempt-allowances.txt",
    pages: [7, 12],
    world: "AY 2026-27 / Income-tax Act, 1961",
    provision:
      "Income-tax Rules, 1962 — rule 2BB (prescribed allowances for the purposes of clause (14) of section 10)",
    loadBearing: [
      "rule 2BB(1) — the allowances exempt under s.10(14)(i), by purpose",
      "rule 2BB(2) — the Table of allowances exempt under s.10(14)(ii), with per-month ceilings",
      "rule 2BB(3) — the s.115BAC restriction on which of them survive in the new regime",
    ],
    notes: [
      "*** RANK 2 — CONSOLIDATED DEPARTMENTAL REPRINT. ***",
      "RANGE ENDS AT 12, NOT 9. Rule 2BB's Table runs across pages 8-12 and its serial numbers",
      "(`4.`, `6.`, `8.`) read exactly like rule numbers; rule 2BBA begins on page 13, which is",
      "what actually bounds it. Verified by reading page 12 (still 2BB's proviso and sub-rule",
      "(3)) and page 13 (2BBA's heading).",
      "sub-rule (3) IS THE LOAD-BEARING PART FOR THIS ENGINE'S WORLD and is on page 12 — an",
      "extract cut at page 9 would have omitted the new-regime restriction entirely while",
      "looking complete.",
      "THE TABLE IS THE WHOLE RULE, so §3.2 governs throughout.",
    ],
  },
  {
    artifactId: "K4-SOURCE-07-RULES-1962",
    out: "ay-2026-27/income-tax-rules-1962-rule-11DD-specified-diseases.txt",
    pages: [184, 184],
    world: "AY 2026-27 / Income-tax Act, 1961",
    provision:
      "Income-tax Rules, 1962 — rule 11DD (specified diseases and ailments for the purpose of deduction under section 80DDB)",
    loadBearing: [
      "rule 11DD(1) — the closed list of eligible diseases, by clause",
      "rule 11DD(2) — the prescription requirement and who may issue it",
    ],
    notes: [
      "*** RANK 2 — CONSOLIDATED DEPARTMENTAL REPRINT. ***",
      "THE LIST IS THE DEDUCTION. s.80DDB cannot be computed without it, which is why the",
      "acquisition brief ranks this with the Chapter VI-A cluster rather than as a detail.",
      "Rule 11E begins on page 185 and is an OMITTED rule, which is what bounds this range.",
      "NOTHING IN THIS REPOSITORY COMPUTES s.80DDB.",
    ],
  },
  {
    artifactId: "K4-SOURCE-07-RULES-1962",
    out: "ay-2026-27/income-tax-rules-1962-rule-11A-disability-certification.txt",
    pages: [179, 179],
    world: "AY 2026-27 / Income-tax Act, 1961",
    provision:
      "Income-tax Rules, 1962 — rule 11A (medical authority for certifying autism, cerebral palsy and multiple disabilities, for sections 80DD and 80U)",
    loadBearing: [
      "rule 11A(1) — who constitutes the medical authority, by reference to the National Trust Act, 1999",
      "rule 11A(2) — the certificate requirement in Form 10-IA",
    ],
    notes: [
      "*** RANK 2 — CONSOLIDATED DEPARTMENTAL REPRINT. ***",
      "IT CERTIFIES, IT DOES NOT QUANTIFY. The s.80DD/80U deduction amounts are in the Act;",
      "this rule supplies the certification precondition. Rule 11AA begins on page 180.",
      "NOTHING IN THIS REPOSITORY COMPUTES s.80DD or s.80U.",
    ],
  },
  {
    artifactId: "K4-SOURCE-07-RULES-1962",
    out: "ay-2026-27/income-tax-rules-1962-rule-6DD-cash-payment-exceptions.txt",
    pages: [80, 80],
    world: "AY 2026-27 / Income-tax Act, 1961",
    provision:
      "Income-tax Rules, 1962 — rule 6DD (cases and circumstances in which a payment exceeding ten thousand rupees may be made otherwise than by account payee cheque)",
    loadBearing: [
      "the opening words — no disallowance under s.40A(3) and no deemed profit under s.40A(3A)",
      "  in the cases and circumstances specified",
      "the clause list (a) onward — the exhaustive exceptions",
    ],
    notes: [
      "*** RANK 2 — CONSOLIDATED DEPARTMENTAL REPRINT. ***",
      "WITHOUT THIS RULE EVERY CASH PAYMENT IS EITHER WRONGLY DISALLOWED OR WRONGLY ALLOWED,",
      "which is the acquisition brief's own reason for ranking it. Rule 6DDA begins on page 81.",
      "IT CROSS-REFERENCES RULE 6ABBA for the prescribed electronic modes, extracted separately",
      "in this same cluster — the two are read together or not at all.",
      "NOTHING IN THIS REPOSITORY MODELS s.40A(3); disallowances are an open Wave-4 gap.",
    ],
  },
  {
    artifactId: "K4-SOURCE-07-RULES-1962",
    out: "ay-2026-27/income-tax-rules-1962-rule-6ABBA-electronic-modes.txt",
    pages: [74, 74],
    world: "AY 2026-27 / Income-tax Act, 1961",
    provision: "Income-tax Rules, 1962 — rule 6ABBA (other electronic modes)",
    loadBearing: [
      "the closed list of prescribed electronic modes, clause (a) onward",
    ],
    notes: [
      "*** RANK 2 — CONSOLIDATED DEPARTMENTAL REPRINT. ***",
      "LOAD-BEARING FOR 44AD's DIGITAL-TURNOVER SPLIT, AND NOW CITED BY IT (K4-24 Phase 0).",
      "The acquisition brief §2.1 records that the split was shipped citing nothing, and",
      "K4-SOURCE-07 registered the rule without retro-citing it, because adding a citation is a",
      "pack-provenance change a retrieval session does not make. `presumptive_44ad_computation`",
      "now cites ITR_1962_R6ABBA and quotes the words that tie the rule to section 44AD.",
      "Rule 6ABBB begins on page 75.",
    ],
  },
  {
    artifactId: "K4-SOURCE-07-RULES-1962",
    out: "ay-2026-27/income-tax-rules-1962-rule-8AA-holding-period.txt",
    pages: [98, 98],
    world: "AY 2026-27 / Income-tax Act, 1961",
    provision:
      "Income-tax Rules, 1962 — rule 8AA (method of determination of period of holding of capital assets in certain cases)",
    loadBearing: [
      "the sub-rules fixing the holding period for the specific asset classes the rule names",
    ],
    notes: [
      "*** RANK 2 — CONSOLIDATED DEPARTMENTAL REPRINT. ***",
      "READ THE BRIEF'S OWN RECLASSIFICATION BEFORE REACHING FOR THIS. §2.1 records that rule",
      "8AA does NOT unblock gift/inheritance holding periods: Explanation 1(b) to s.2(42A)",
      "already includes the previous owner's holding period for every s.49(1) mode, and that",
      "text is in a HELD extract (`income-tax-act-1961-s002-capital-asset-and-holding.txt`).",
      "This rule is here for its own narrower cases, not for that one.",
      "Rule 8AB begins on page 99.",
    ],
  },
  {
    artifactId: "K4-SOURCE-07-RULES-1962",
    out: "ay-2026-27/income-tax-rules-1962-rule-6G-tax-audit-report.txt",
    pages: [89, 89],
    world: "AY 2026-27 / Income-tax Act, 1961",
    provision:
      "Income-tax Rules, 1962 — rule 6G (report of audit of accounts to be furnished under section 44AB)",
    loadBearing: [
      "rule 6G(1)(a) — Form 3CA where the person is already audited under another law",
      "rule 6G(1)(b) — Form 3CB otherwise",
      "rule 6G(2) — 'The particulars ... shall be in Form No. 3CD'",
    ],
    notes: [
      "*** RANK 2 — CONSOLIDATED DEPARTMENTAL REPRINT. ***",
      "IT SUPPLIES THE FORM ROUTING, NOT THE THRESHOLD. The s.44AB thresholds are in s.44AB",
      "itself; this rule only says which form follows once the section bites.",
      "GENERATING FORM 3CD REMAINS AN EXPLICIT NON-GOAL (acquisition brief §2.1) and the",
      "`tax_audit` capability row stays unsupported. Rule 6GA begins on page 90.",
    ],
  },
  {
    artifactId: "K4-SOURCE-07-RULES-1962",
    out: "ay-2026-27/income-tax-rules-1962-rule-12AB-return-furnishing-conditions.txt",
    pages: [230, 230],
    world: "AY 2026-27 / Income-tax Act, 1961",
    provision:
      "Income-tax Rules, 1962 — rule 12AB (conditions for furnishing return of income by persons referred to in clause (b) of sub-section (1) of section 139)",
    loadBearing: [
      "clause (i) — total sales/turnover/gross receipts in business exceeding sixty lakh rupees",
      "clause (ii) — gross receipts in profession exceeding ten lakh rupees",
      "clause (iii) — aggregate TDS and TCS during the previous year",
    ],
    notes: [
      "*** RANK 2 — CONSOLIDATED DEPARTMENTAL REPRINT. ***",
      "IT IS A FILING-OBLIGATION RULE, NOT AN AUDIT-THRESHOLD RULE. The acquisition brief §2.1",
      "reclassified it for exactly this reason: it prescribes the conditions for MANDATORY",
      "RETURN FURNISHING under the seventh proviso to s.139(1), and adds nothing to s.44AB.",
      "Its sixty-lakh and ten-lakh figures are NOT the audit thresholds and must not be read",
      "as them. Rule 12AC (updated return) begins on page 231.",
    ],
  },
  {
    artifactId: "K4-SOURCE-07-RULES-1962",
    out: "ay-2026-27/income-tax-rules-1962-rule-21AGA-115BAC-option.txt",
    pages: [317, 317],
    world: "AY 2026-27 / Income-tax Act, 1961",
    provision:
      "Income-tax Rules, 1962 — rule 21AGA (exercise of option under sub-section (6) of section 115BAC)",
    loadBearing: [
      "rule 21AGA(1)(a) — Form No. 10-IEA on or before the s.139(1) due date, for a person having",
      "  income from business or profession",
      "rule 21AGA(1) — the rule applies from the previous year relevant to AY 2024-25 onward",
    ],
    notes: [
      "*** RANK 2 — CONSOLIDATED DEPARTMENTAL REPRINT. ***",
      "THIS IS THE RULE THAT PRESCRIBES FORM 10-IEA, and it is the pair to the form committed",
      "separately in this cluster.",
      "THE ENGINE RECOMMENDS A REGIME AND MODELS NO OPT-OUT INSTRUMENT. Holding the rule does",
      "not implement one and does not decide when an election is valid. Rule 21AH (the s.115BAD",
      "co-operative-society counterpart) begins on page 318.",
    ],
  },
  {
    artifactId: "K4-SOURCE-07-ACT-1961",
    out: "ay-2026-27/income-tax-act-1961-2026-vintage-identity.txt",
    pages: [7, 7],
    world: "AY 2026-27 / Income-tax Act, 1961",
    provision:
      "Income-tax Act, 1961 — section 1 (short title, extent and commencement) together with the " +
      "publisher's Finance Act, 2026 printing-convention note",
    loadBearing: [
      "s.1(1) — 'This Act may be called the Income-tax Act, 1961'",
      "s.1(3) — commencement on the 1st day of April, 1962",
      "THE VINTAGE CLAIM ITSELF: 'Amendments made by the Finance Act, 2026 ... have been printed",
      "  in italics and enclosed with bold square brackets'",
    ],
    notes: [
      "*** RANK 2 — CONSOLIDATED DEPARTMENTAL REPRINT, NOT THE ACT AS ENACTED. ***",
      "THIS EXTRACT EXISTS TO MAKE THE VINTAGE CLAIM CHECKABLE FROM A BARE CLONE. The manifest",
      "asserts this artifact incorporates the Finance Act, 2026; that assertion is only worth",
      "anything if the document's own statement of it is committed, and this is that statement.",
      "PAGE 7, NOT PAGE 1. The PDF opens at Chapter XIV s.139 — the page order is not section",
      "order, and a reader who checks page 1 will wrongly conclude the document is partial.",
      "Completeness was established by LOCATING s.1, s.89 and the First through Fourteenth",
      "Schedules, not by trusting the page order.",
      "IT DOES NOT SUPERSEDE `K4-PORT-04-S2`. That artifact stays registered and is what every",
      "existing Act extract in this repository was cut from; re-pointing a citation here is a",
      "deliberate re-citation of the `K4-CITE-01` shape and was NOT done this session.",
    ],
  },
  {
    artifactId: "K4-SOURCE-07-ACT-1961",
    out: "ay-2026-27/income-tax-act-1961-2026-s089-arrears-relief.txt",
    pages: [387, 388],
    world: "AY 2026-27 / Income-tax Act, 1961",
    provision:
      "Income-tax Act, 1961 — section 89 (relief when salary etc. is paid in arrears or in advance) " +
      "and section 89A, at the Finance Act, 2026 vintage",
    loadBearing: [
      "s.89 — the relief is granted 'in the prescribed manner', which is what routes it to rule 21A",
      "s.89A — relief on income from a retirement benefit account maintained in a notified country",
    ],
    notes: [
      "*** RANK 2 — CONSOLIDATED DEPARTMENTAL REPRINT. ***",
      "THE SECTION DELEGATES THE ARITHMETIC AND THAT IS THE POINT. s.89 grants relief 'in the",
      "prescribed manner'; the manner is rule 21A(2). Holding s.89 without rule 21A never made",
      "the relief specifiable, and holding both still does not make it COMPUTABLE — see `D311`",
      "for the structural cause (one year of rate parameters, no multi-year state).",
      "WHY A SECOND COPY OF A SECTION THIS REPOSITORY ALREADY HOLDS: `K4-PORT-04-S2` is a",
      "Finance Act 2025-vintage consolidation. This one is Finance Act 2026-vintage, and s.89",
      "is the operative section for the cluster that is actually blocked. The two are committed",
      "side by side deliberately so a later session can compare vintages rather than assume",
      "they agree.",
      "NO SECTION 89 MECHANISM, FORM 10E FIELD OR RELIEF COMPUTATION EXISTS IN THIS REPOSITORY,",
      "and this extract creates none.",
    ],
  },
  {
    artifactId: "K4-SOURCE-07-FORM-10E",
    out: "ay-2026-27/form-10e-section-89-relief.txt",
    world: "AY 2026-27 / Income-tax Act, 1961",
    provision:
      "FORM NO. 10E — particulars for claiming relief under section 89, prescribed by rule 21AA (whole form, 8 pages including Annexures)",
    loadBearing: [
      "the rubric '[See rule 21AA]' — THE FORM'S PRESCRIBING RULE IS 21AA, NOT 21A",
      "'Particulars of income referred to in rule 21A of the Income-tax Rules, 1962'",
      "items 1(a)-(d) — arrears/advance salary, gratuity for past services, compensation on",
      "  termination, and commutation of pension, each routed to its own sub-rule of rule 21A",
    ],
    notes: [
      "*** RANK 2 — A PRESCRIBED FORM, published by the department. ***",
      "COMMITTED WHOLE because the form IS a single provision group, the same shape as",
      "`K4-SOURCE-02-S1`…`S4`.",
      "THE 21A/21AA DISTINCTION IS THE FINDING HERE. The acquisition brief §2.1 names the",
      "blocking pair as 'Rule 21A + Form 10E'; the form is in fact prescribed by rule 21AA and",
      "merely REFERS to rule 21A for the particulars. A session that cites rule 21A as the",
      "form's authority would be citing the wrong rule.",
      "MOSTLY DOTTED LEADER LINES. The three modes disagree substantially on how the fill-in",
      "rules render, so read this for STRUCTURE — which particulars are demanded under which",
      "sub-rule — and never as continuous prose.",
      "IT PRESCRIBES A DISCLOSURE, NOT AN ARITHMETIC.",
    ],
  },
  {
    artifactId: "K4-SOURCE-07-FORM-3CD",
    out: "ay-2026-27/form-3cd-section-44AB-particulars.txt",
    world: "AY 2026-27 / Income-tax Act, 1961",
    provision:
      "FORM NO. 3CD — statement of particulars required under section 44AB, prescribed by rule 6G(2) (whole form, 20 pages)",
    loadBearing: [
      "the rubric '[See rule 6G(2)]' and the marking '[e-Form]'",
      "'Statement of particulars required to be furnished under section 44AB of the Income-tax Act, 1961'",
      "PART A items 1-8 — the assessee identification block",
    ],
    notes: [
      "*** RANK 2 — A PRESCRIBED FORM, published by the department. ***",
      "GENERATING FORM 3CD IS AN EXPLICIT NON-GOAL (acquisition brief §2.1). This is committed",
      "so a session reading about the s.44AB linkage can see the actual instrument, NOT so that",
      "anyone builds it. The `tax_audit` capability row stays unsupported.",
      "EVERY SUBSTANTIVE CLAUSE IS IN A TWO-COLUMN TABLE across 20 pages, so §3.2 governs the",
      "whole extract: never read a clause number against its text from one mode.",
      "IT SUPPLIES NO THRESHOLD. s.44AB's limits are in the Act, and no located source defines",
      "derivative turnover — which is why `K4-18` left that figure to the preparer.",
    ],
  },
  {
    artifactId: "K4-SOURCE-07-FORM-10-IEA",
    out: "ay-2026-27/form-10-iea-115BAC-option.txt",
    world: "AY 2026-27 / Income-tax Act, 1961",
    provision:
      "FORM No. 10-IEA — application to exercise or withdraw the option under section 115BAC(6), prescribed by rule 21AGA (whole form, 3 pages)",
    loadBearing: [
      "the rubric '[See rule 21AGA]'",
      "'Application for exercise of option under clause (i) of sub-section (6) of section 115BAC",
      "  or withdrawal of option under the proviso to sub-section (6) of section 115BAC'",
    ],
    notes: [
      "*** RANK 2 — A PRESCRIBED FORM, published by the department. ***",
      "ONE FORM SERVES BOTH DIRECTIONS — exercise AND withdrawal — which is visible in its own",
      "title and is the kind of thing an inferred design would get wrong.",
      "THE ENGINE RECOMMENDS A REGIME AND MODELS NO OPT-OUT INSTRUMENT. No regime-election",
      "state exists in this repository and this extract creates none.",
      "THE SERIAL COLUMN AND THE LABEL COLUMN ARE SEPARATELY POSITIONED, so the default mode",
      "interleaves them ('Sl.No. Name : 1. 2. PAN :'). Read the labels against rule 21AGA",
      "rather than against the serial numbers.",
    ],
  },
];

function sh(args) {
  return execFileSync("pdftotext", args, { encoding: "utf8", maxBuffer: 1 << 28 });
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * `onlyPages: N` means pages 1..N (the Bill's identity pages, unchanged since
 * `K4-SOURCE-02`). `pages: [first, last]` is the general form added by
 * `MAINT-03`. They are the same `-f`/`-l` flags; both spellings are kept so the
 * five pre-existing extracts regenerate byte-identically.
 */
export function extractModes(pdf, onlyPages, pages) {
  const tmp = join(tmpdir(), `taxdesk-extract-${process.pid}.txt`);
  const page = pages
    ? ["-f", String(pages[0]), "-l", String(pages[1])]
    : onlyPages
      ? ["-f", "1", "-l", String(onlyPages)]
      : [];
  const out = {};
  for (const [name, flags] of [
    ["layout", ["-layout"]],
    ["default", []],
    ["raw", ["-raw"]],
  ]) {
    sh([...flags, ...page, pdf, tmp]);
    out[name] = readFileSync(tmp, "utf8").replace(/\r\n/g, "\n");
  }
  rmSync(tmp, { force: true });
  return out;
}

function render(spec, artifact, modes) {
  const bar = "=".repeat(78);
  const L = [];
  L.push(bar);
  L.push("TAXDESK OS — COMMITTED STATUTORY TEXT EXTRACT");
  L.push(bar);
  L.push("");
  L.push(`Provision      : ${spec.provision}`);
  L.push(`Statutory world: ${spec.world}`);
  L.push(`Artifact id    : ${spec.artifactId}`);
  L.push(`Artifact file  : ${artifact.file}`);
  L.push(`Artifact sha256: ${artifact.sha256}`);
  L.push(`Publisher      : ${artifact.publisher}`);
  L.push(`Source rank    : ${artifact.sourceRank}`);
  L.push(`Stage          : ${artifact.stage}`);
  L.push("");
  L.push("THIS FILE IS EVIDENCE, NOT AUTHORITY. Registering or extracting a source neither");
  L.push("verifies a tax treatment (PROJECT_CONSTITUTION.md §2 rule 5) nor moves any pack");
  L.push("toward `ca_verified` (§2 rule 10). It is generated by");
  L.push("`scripts/build-statutory-extracts.mjs` — EDIT THE SCRIPT, NEVER THIS FILE.");
  L.push("");
  L.push("What this document is load-bearing for:");
  for (const b of spec.loadBearing) L.push(`  - ${b}`);
  L.push("");
  L.push("READING NOTES — read these before quoting anything below:");
  for (const n of spec.notes) L.push(`  ${n}`);
  L.push("");
  L.push("ALL THREE pdftotext MODES FOLLOW. They are not redundant: -layout preserves prose");
  L.push("but shuffles table rows, the default mode splits tables column-major, and -raw");
  L.push("emits content-stream order and pairs these publishers' table rows correctly.");
  L.push("Cross-check any figure across modes before relying on it (§3.2, §9.1).");
  if (spec.onlyPages) L.push(`NOTE: only pages 1-${spec.onlyPages} are extracted.`);
  if (spec.pages) {
    L.push(
      `SCOPE: pages ${spec.pages[0]}-${spec.pages[1]} of the artifact ONLY. The rest of the document is ` +
        `not committed here.`,
    );
    L.push(
      "A quotation from a provision OUTSIDE this range has no extract to be checked against, and",
      "`verbatim-quotes.test.ts` FAILS it rather than skipping it. Add the range to",
      "`scripts/build-statutory-extracts.mjs`; never widen the matcher instead.",
    );
  }
  L.push("");
  for (const mode of ["layout", "default", "raw"]) {
    L.push(bar);
    L.push(`BEGIN pdftotext ${mode === "default" ? "(default mode, no flags)" : `-${mode}`}`);
    L.push(bar);
    L.push(modes[mode].replace(/\n+$/, ""));
    L.push("");
    L.push(`END pdftotext ${mode === "default" ? "(default mode)" : `-${mode}`}`);
    L.push("");
  }
  return L.join("\n") + "\n";
}

function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const byId = new Map(manifest.artifacts.map((a) => [a.id, a]));
  const checkOnly = process.argv.includes("--check");
  let failures = 0;

  for (const spec of EXTRACTS) {
    const artifact = byId.get(spec.artifactId);
    if (!artifact) {
      console.error(`FAIL ${spec.artifactId}: not in the manifest`);
      failures++;
      continue;
    }
    const pdf = join(SOURCES, artifact.file);
    if (!existsSync(pdf)) {
      console.error(
        `SKIP ${spec.artifactId}: ${artifact.file} is not in .sources/statutory/ ` +
          `(gitignored — re-retrieve from the manifest url)`,
      );
      failures++;
      continue;
    }
    const actual = sha256(pdf);
    if (actual !== artifact.sha256) {
      console.error(`FAIL ${spec.artifactId}: sha256 DRIFT\n  manifest ${artifact.sha256}\n  on disk  ${actual}`);
      failures++;
      continue;
    }
    const text = render(spec, artifact, extractModes(pdf, spec.onlyPages, spec.pages));
    const dest = join(OUT, spec.out);
    mkdirSync(dirname(dest), { recursive: true });
    if (checkOnly) {
      const have = existsSync(dest) ? readFileSync(dest, "utf8").replace(/\r\n/g, "\n") : null;
      if (have !== text) {
        console.error(`FAIL ${spec.out}: committed extract differs from a fresh regeneration`);
        failures++;
      } else {
        console.log(`ok   ${spec.out}`);
      }
    } else {
      writeFileSync(dest, text, { encoding: "utf8" });
      console.log(`wrote ${spec.out} (${text.split("\n").length} lines)`);
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} problem(s).`);
    process.exit(1);
  }
  console.log(`\nOK — ${EXTRACTS.length} extract(s) ${checkOnly ? "verified" : "written"}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
