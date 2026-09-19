/**
 * TaxDesk OS — `AUDIT-11-F5`: quoted statute in a pack caveat must exist in the
 * evidence base, or be declared unverifiable with a reason.
 *
 * WHAT THIS EXISTS TO CATCH, stated as the violation rather than the aspiration.
 * `AUDIT-11` re-quoted Finance Act 2026 s.2(6) inside `ay-2026-27-provenance.ts`
 * as *"five per cent."* where the Act says *"four per cent."*. That falsified
 * statement of law is RENDERED TO PREPARERS by
 * `src/components/tax-desk/pack-traceability.tsx`, and the entire guard estate
 * stayed green: `check:statutory-extracts` PASS, unit suite green, typecheck and
 * lint clean. The gate that claimed to cover it checked a hand-authored
 * `MUST_CONTAIN` needle list in the direction needle → extract, never
 * provenance-quote → evidence base — `D139`'s "compare two authored mappings"
 * class in the newest guard in the repository.
 *
 * WHY DECLARATION RATHER THAN DERIVATION. `MAINT-01` measured the corpus before
 * building anything (`D306`): 148 quoted spans of 12+ characters, of which 18
 * appeared anywhere in the committed evidence base and 130 did not, for five
 * distinct reasons that each demand a WIDER match — and a matcher generous
 * enough to absorb them reports green over a falsified quote just as well as no
 * matcher at all. A parser also cannot honestly recover WHICH of a rule's
 * several sources a prose sentence came from, because the caveat never says. So
 * the quote is declared, per span, and this file checks the declaration.
 *
 * THE THREE ASSERTIONS AND WHERE EACH LIVES:
 *   (i)   every declared `verbatimQuote` appears in THAT artifact's committed
 *         extract                                              — HERE;
 *   (ii)  the caveat prose CONTAINS each declared quote, so the rendered text
 *         and the checked text cannot diverge — `makeRuleProvenance`;
 *   (iii) every remaining quoted span is declared `unverifiableQuotes` with a
 *         reason                                                — `makeRuleProvenance`.
 *
 * DEFAULT FAIL, NEVER SILENT SKIP. A quote naming an artifact with no committed
 * extract FAILS here; it does not quietly pass for want of anything to compare
 * against. That is the property the old gate lacked: a source with no extract
 * used to vanish, and now it has to be written down.
 *
 * `MAINT-03` THEN COMMITTED THE MISSING EXTRACTS AND THE CHECKED SHARE MOVED
 * 7 -> 51 OF 154. The whole of the TY pack used to be checkable by nothing; 44
 * of its 69 spans are now checked against page ranges of the enacted Income-tax
 * Act, 2025 and of Income-tax Rules 2026 rule 164. `QUOTE_NO_COMMITTED_EXTRACT`
 * now has ZERO uses, asserted below — nothing is left waiting on an extract.
 *
 * WHAT THIS DOES **NOT** COVER — read this before trusting a green run:
 *   - It cannot check a single word of the 100 `unverifiableQuotes` that remain.
 *     Those declarations make the gap COUNTABLE, not closed, and most of them
 *     are not fixable by committing anything: 43 quote a source this repository
 *     holds no artifact for (headed by the consolidated Income-tax Act, 1961,
 *     still unretrieved — `AUDIT-10-F4`), and 42 are not quotations of statute.
 *   - It checks that a span is PRESENT in the artifact, never that the span was
 *     quoted from the place the caveat says it was, and never that the provision
 *     is the right one for the rule. Page-range extracts narrow that gap without
 *     closing it — a span found in the ten pages of the cited provision is much
 *     better evidence than the same span found in a 666-page Act, but "in this
 *     artifact" is still not "from this section". A short span ("at any time
 *     during") is weak evidence; a falsified RATE is still caught, which is the
 *     case that matters.
 *   - Only the `pdftotext` blocks of an extract count. That was NOT true before
 *     `MAINT-03` and it hid two live false passes; see `extractedStatuteOnly`.
 *   - It cannot see a provision that has no committed page range at all. Such a
 *     quote FAILS rather than skipping, which is right, but the failure says
 *     "not in the extract" — read it as "add the page range", not as "the
 *     quotation is wrong".
 *   - A declaration is per distinct TEXT. Where one caveat quotes the same words
 *     twice from two different sources, only one artifact can be named.
 *   - It says nothing about `summary`, about `sources`, or about any quoted text
 *     outside a caveat.
 *   - It cannot tell that an extract is itself wrong; the extract is evidence,
 *     not authority (`PROJECT_CONSTITUTION.md` §2 rule 5).
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  makeRuleProvenance,
  makeTaxPackProvenance,
  QUOTE_NO_COMMITTED_EXTRACT,
  quotedSpansInCaveat,
  type TaxPackProvenance,
} from "../provenance";
import { AY_2026_27_PACK_PROVENANCE } from "../packs/ay-2026-27-provenance";
import { TY_2026_27_PACK_PROVENANCE } from "../packs/ty-2026-27-provenance";

const REPO = process.cwd();
const EVIDENCE = join(REPO, "docs/evidence/statutory-sources");
const EXTRACTS = join(EVIDENCE, "extracts");
const MANIFEST = join(EVIDENCE, "manifest.json");

/**
 * The ONLY normalisation applied, and the reason each step is safe.
 *
 * - Whitespace collapses because an extract is `pdftotext` output, wrapped at
 *   the PDF's own line breaks, while a caveat is one long string.
 * - Quote glyphs are removed because a quotation nested inside a double-quoted
 *   span has its inner quotes re-spelled: the Act prints
 *   `the "Health and Education Cess on income-tax"` and the caveat necessarily
 *   writes `'Health and Education Cess on income-tax'`.
 *
 * NEITHER CAN TURN A WRONG WORD INTO A RIGHT ONE — "four" and "five" are
 * unaffected by both, which is asserted below rather than asserted here in prose.
 * Nothing else is normalised: no case folding, no punctuation stripping, no
 * fuzzy or token matching. Every one of those would be the "widen the match
 * until it passes" move `D306` measured and rejected.
 */
export function normalizeForQuoteMatch(text: string): string {
  return text
    .replace(/[‘’“”'"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function walkExtracts(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walkExtracts(path, base);
    return name.endsWith(".txt") ? [relative(base, path).replace(/\\/g, "/")] : [];
  });
}

export interface EvidenceBase {
  /** Artifact ids the manifest declares. */
  readonly registered: ReadonlySet<string>;
  /** Artifact id → normalised committed extract text. Only artifacts WITH one. */
  readonly extracts: ReadonlyMap<string, string>;
}

/**
 * ONE ARTIFACT MAY HAVE SEVERAL EXTRACTS, AND THEY ARE JOINED, NOT OVERWRITTEN.
 *
 * `MAINT-03` committed page-range extracts for the enacted Income-tax Act, 2025
 * — twelve files, one per provision group, because dumping 666 pages in three
 * modes would add ~5.9 MB of mostly-irrelevant text. This function used to
 * `set()` per file, so the LAST file read would have silently replaced the other
 * eleven and eleven twelfths of the evidence base would have vanished with
 * nothing reporting it. That is the exact failure mode this whole guard exists
 * to prevent, so it is fixed here and driven by its own test below.
 *
 * The join inserts a separator that cannot occur inside `pdftotext` output, so a
 * span cannot be matched by straddling the boundary between two files.
 */
const EXTRACT_JOIN = "\n ---extract-boundary--- \n";

/**
 * ONLY THE `pdftotext` OUTPUT COUNTS AS EVIDENCE — never the project-authored
 * header or the reading notes wrapped around it.
 *
 * Found while building the `MAINT-03` extracts, and it is the "guard passes for
 * the wrong reason" class again. An extract file is a header, a block of
 * hand-written reading notes, and then the three extraction modes. The notes
 * legitimately QUOTE statute — a note has to be able to say *the Act says "or",
 * lower-case* — and the whole file used to be searched, so a span present in
 * nothing but a note THIS REPOSITORY WROTE would have read as verified against
 * the source. That is a repository checking a quotation against its own prose.
 *
 * It was not hypothetical for even one run. `business_books_computation` quotes
 * Income-tax Act **1961** section 29 ("in accordance with the provisions
 * contained in sections 30 to 43D") for contrast; that text appears in no
 * rendering of the 2025 Act, and it matched anyway — off a note in the extract
 * explaining why it is absent.
 *
 * A file with no `BEGIN pdftotext` block contributes NOTHING rather than its own
 * prose, so a malformed extract fails closed (`AUDIT-04-F4`'s shape).
 */
export function extractedStatuteOnly(raw: string): string {
  const blocks: string[] = [];
  let current: string[] | null = null;
  for (const line of raw.split(/\r?\n/)) {
    if (/^BEGIN pdftotext /.test(line)) {
      current = [];
      continue;
    }
    if (/^END pdftotext /.test(line)) {
      if (current !== null) blocks.push(current.join("\n"));
      current = null;
      continue;
    }
    if (current !== null) current.push(line);
  }
  return blocks.join(EXTRACT_JOIN);
}

function loadEvidenceBase(): EvidenceBase {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
    artifacts: readonly { id: string }[];
  };
  const parts = new Map<string, string[]>();
  for (const rel of walkExtracts(EXTRACTS)) {
    const raw = readFileSync(join(EXTRACTS, rel), "utf8");
    const id = raw.match(/^Artifact id\s*:\s*(.+)$/m)?.[1]?.trim();
    if (id === undefined) throw new Error(`extract ${rel} carries no "Artifact id" header`);
    const list = parts.get(id);
    const statute = normalizeForQuoteMatch(extractedStatuteOnly(raw));
    if (list === undefined) parts.set(id, [statute]);
    else list.push(statute);
  }
  const extracts = new Map<string, string>();
  for (const [id, list] of parts) extracts.set(id, list.join(EXTRACT_JOIN));
  return { registered: new Set(manifest.artifacts.map((a) => a.id)), extracts };
}

/**
 * Assertion (i), as a pure function so the guard-the-guard tests below can drive
 * it with synthetic input instead of trusting that it would fire.
 */
export function checkVerbatimQuotes(
  packLabel: string,
  provenance: TaxPackProvenance,
  evidence: EvidenceBase,
): string[] {
  const problems: string[] = [];
  for (const rule of provenance.rules) {
    for (const quote of rule.verbatimQuotes) {
      const where = `${packLabel} :: ${rule.ruleId} :: ${JSON.stringify(quote.text.slice(0, 60))}`;
      if (!evidence.registered.has(quote.artifactId)) {
        problems.push(`${where} — names artifact ${quote.artifactId}, which the manifest does not declare`);
        continue;
      }
      const extract = evidence.extracts.get(quote.artifactId);
      if (extract === undefined) {
        problems.push(
          `${where} — artifact ${quote.artifactId} has NO committed extract, so this quote is ` +
            `checked by nothing. Commit an extract for it, or move the span to unverifiableQuotes ` +
            `with a reason. It may not simply pass.`,
        );
        continue;
      }
      if (!extract.includes(normalizeForQuoteMatch(quote.text))) {
        problems.push(
          `${where} — this text is NOT in ${quote.artifactId}'s committed extract. Either the ` +
            `quotation is wrong, or it was quoted from a different artifact.`,
        );
      }
    }
  }
  return problems;
}

const PACKS = [
  ["AY 2026-27", AY_2026_27_PACK_PROVENANCE],
  ["TY 2026-27", TY_2026_27_PACK_PROVENANCE],
] as const;

describe("AUDIT-11-F5 — quoted statute is declared and checked", () => {
  const evidence = loadEvidenceBase();

  it("the extract scan root resolves — an empty evidence base is a failure, not a pass", () => {
    // AUDIT-04-F4's shape: a guard that reads nothing must not report success.
    expect(evidence.extracts.size).toBeGreaterThan(0);
    expect(evidence.registered.size).toBeGreaterThan(0);
  });

  for (const [label, provenance] of PACKS) {
    it(`${label}: every declared verbatim quote is in its artifact's committed extract`, () => {
      expect(checkVerbatimQuotes(label, provenance, evidence)).toEqual([]);
    });
  }

  it("the AUDIT-11 plant target is one of the checked quotes", () => {
    // The exact span AUDIT-11 falsified. Named explicitly so that deleting the
    // declaration is a visible failure rather than a silently smaller checked set.
    // The ARTIFACT assertion was deliberately replaced (`K4-CITE-01`, `D315`,
    // recorded per `PROJECT_CONSTITUTION.md` §4): the cess quotation was
    // re-pointed from the ITD s.2 copy (`K4-SOURCE-02-S1`) to the Gazette
    // itself (`K4-PORT-04-S1`) after being verified present in its committed
    // Chapter II extract — a HIGHER-ranked home for the same span, which is
    // the whole point of the re-citation.
    const cess = AY_2026_27_PACK_PROVENANCE.rules.find((r) => r.ruleId === "cess_rate");
    const quoted = cess?.verbatimQuotes.map((q) => q.text).join("\n") ?? "";
    expect(quoted).toContain("calculated at the rate of four per cent.");
    expect(cess?.verbatimQuotes.every((q) => q.artifactId === "K4-PORT-04-S1")).toBe(true);
  });

  it("normalisation cannot rescue a falsified figure", () => {
    const truth = normalizeForQuoteMatch("calculated at the rate of  four  per cent. of such");
    expect(truth).toBe("calculated at the rate of four per cent. of such");
    expect(truth).not.toContain("five per cent.");
    // …and the whitespace/quote-glyph steps really do their job, so the tolerance
    // that exists is the tolerance that is needed and no more.
    expect(normalizeForQuoteMatch("the “Health and Education\nCess”")).toBe(
      normalizeForQuoteMatch("the 'Health and Education Cess'"),
    );
  });

  it("the whole quoted surface is accounted for, and the census is asserted", () => {
    let spanOccurrences = 0;
    let verbatim = 0;
    const byReason = new Map<string, number>();
    for (const [, provenance] of PACKS) {
      for (const rule of provenance.rules) {
        if (rule.caveat === null) continue;
        spanOccurrences += quotedSpansInCaveat(rule.caveat).length;
        verbatim += rule.verbatimQuotes.length;
        for (const quote of rule.unverifiableQuotes) {
          byReason.set(quote.reason, (byReason.get(quote.reason) ?? 0) + 1);
        }
      }
    }
    const unverifiable = [...byReason.values()].reduce((a, b) => a + b, 0);

    // Measured, not aspirational. Any change to the corpus moves one of these
    // and fails, which is the point: the gap has to stay countable.
    //
    // `MAINT-03` moved 7 -> 51 checked by committing page-range extracts of the
    // enacted Income-tax Act, 2025 and of Income-tax Rules 2026 rule 164.
    //
    // **`K4-PORT-04` (`D314`) MOVED IT AGAIN, 51 -> 88, AND THE UNVERIFIABLE
    // COUNT WENT DOWN RATHER THAN UP — 100 -> 91.** That direction is the
    // interesting part: slice 5 cited six TY rule groups to the Finance Act,
    // 2026 (First Schedule Part I-B for the slabs, the senior/super-senior
    // bands, the surcharge and its marginal relief; s.3(15) for the cess), so
    // caveats that used to quote ITA 2025 s.4(1) in order to explain why they
    // could cite NOTHING now quote the rate paragraph they actually rest on.
    //
    // **`K4-CITE-01` (`D315`) MOVED NO CENSUS NUMBER, DELIBERATELY — the
    // arithmetic of that is recorded here because a silent non-move is also a
    // drift the census exists to expose.** The re-citation to the Gazette
    // re-pointed 29 existing `verbatimQuote` declarations at a different
    // artifact (6 in the AY pack, 23 in the TY pack: all 16 s.3 spans plus 7
    // Part I prose spans) without adding, removing, or reclassifying a single
    // span: 88 + 90 = 178 declarations over 181 occurrences, 6 reasons, TY
    // 81/15 — all unchanged. A citation-quality change that altered the SPAN
    // census would have meant quoting different words, which is not what
    // re-attribution is.
    //
    // The 90 that remain are NOT one problem, and the largest group is NOT what
    // this comment used to say it was. It read "43 quote a source with no
    // registered artifact (headed by the consolidated Income-tax Act, 1961, still
    // unretrieved)". **THE 1961 ACT HEADED NOTHING.** `K4-PORT-04` registered the
    // consolidated Act (owner-supplied) and MEASURED that set: the Act accounted
    // for exactly ONE of the 43 — the s.29 span quoted for contrast, which is now
    // checked and is the +1 above. The other 42 quote ITD help pages, e-filing
    // portal prose and secondary publishers ("Up to Rs. 50 lakhs", "file return in
    // the ITR-4 form (Sugam)", "optimal approach", "this is only a guideline"), and
    // **no artifact will ever make them checkable, because they are not quotations
    // of statute.** Closing them means re-declaring them QUOTE_NOT_STATUTORY_TEXT
    // or removing them from the caveats — editorial work, not retrieval work.
    // MAINT-09 / AUDIT-14-F2 adds NINE AY spans backed by the held consolidated
    // Act: two for s.16 and seven across the already-implemented Chapter VI-A
    // caps. The deliberate census therefore moves 93/90/186/6 to
    // 102/90/195/6. Nothing is reclassified or parked as unverifiable, the TY
    // split remains 81/15, and `QUOTE_NO_COMMITTED_EXTRACT` stays at zero uses.
    //
    // K4-23 / D337 adds exactly ONE AY span — "such excess shall be ignored",
    // the operative words of the second proviso to s.112(1)(a), which is the
    // whole basis of the long-term comparison this slice implements and was
    // quoted by no caveat before. It is checked against the already-committed
    // s.111A/s.112 extract of `K4-PORT-04-S2` (pages 433-436), so no new page
    // range was needed and nothing was parked as unverifiable. The census
    // therefore moves 102/90/195/6 to 103/90/196/6; the TY split is untouched
    // at 81/15 and `QUOTE_NO_COMMITTED_EXTRACT` stays at zero uses.
    //
    // K4-24 Phase 0 adds THREE AY spans and no unverifiable ones, all on
    // `presumptive_44ad_computation`, which until now carried not one checked
    // statutory quotation: "The following shall be the other electronic modes
    // for the purposes of", "proviso to sub-section (1) of section 44AD" and
    // "(a) Credit Card; (b) Debit Card;". They are checked against the
    // already-committed page-74 extract of `K4-SOURCE-07-RULES-1962`, so no
    // new page range was needed. The second is the load-bearing one: rule 6ABBA
    // has prescribed 44AD's electronic modes since the slice shipped and was
    // named by no source reference at all, so the caveat rested on secondary
    // publishers for a point with an instrument.
    //
    // The five NEW Cost Inflation Index citations in the same phase move NO
    // census number, and that is worth stating rather than leaving as a
    // silent non-move: they add `sources` entries and rewrite caveat PROSE, and
    // the rewritten `capital_gains_house_sale` paragraph quotes nothing. A
    // citation added without a quotation is invisible to this census by
    // construction — the census counts quoted spans, never sources.
    //
    // K4-24 also adds exactly ONE TY span, and it is the first checked
    // quotation `section_89_arrears_relief` has ever carried in that world:
    // "is assessed at a rate higher than the rate at which it would otherwise
    // have been assessed", the charging words of Income-tax Act, 2025 s.157,
    // checked against the newly-committed page-194 extract of `K4-PORT-00-S2`.
    // That rule cited NOTHING until this session, so the span could not have
    // existed before the citation did.
    //
    // The census therefore moves 103/90/196/6 to 107/90/200/6; the TY split
    // moves 81/15 to 82/15 and `QUOTE_NO_COMMITTED_EXTRACT` stays at zero uses.
    expect(spanOccurrences).toBe(200);
    expect(verbatim).toBe(107);
    expect(unverifiable).toBe(90);
    // 200 occurrences over 197 declarations: THREE spans each appear twice in
    // their own caveat ("at or above", "twenty-five per cent.", "eligible
    // business"), and one declaration covers both occurrences of each.
    expect(verbatim + unverifiable).toBe(197);
    // SIX distinct obstacles, down from seven, and the retirement is deliberate
    // rather than a shrinking vocabulary: `QUOTE_EDITORIAL_BRACKET` was carried
    // by exactly one span — the "[w]here any Central Act enacts…" quotation of
    // ITA 2025 s.4(1) — repeated across the five rule groups that cited nothing.
    // Those five now cite the Finance Act, 2026 and quote IT, so the bracketed
    // span is gone from the corpus. The CONSTANT is deliberately kept in
    // `provenance.ts`: an editorial bracket is the correct declaration the moment
    // a caveat needs one again, and deleting a reason because it currently has no
    // user is how a vocabulary drifts into being invented ad hoc.
    expect(byReason.size).toBe(6);
  });

  it("the TY pack's own split is asserted separately from the corpus total", () => {
    // Until `MAINT-03` this read "the TY pack has no checkable quote at all",
    // and it was true: all 69 of its spans came from artifacts with no committed
    // extract. Committing the enacted Act's cited provisions moved 44 of them,
    // and `K4-PORT-04` took it to 80 by citing the Finance Act, 2026 — one of them
    // cited purely as RANK-1 CORROBORATION of the s.3(3) mechanism, from First
    // Schedule Part III, because s.3 itself was then held only at rank 2. That
    // corroboration span is now checked against the GAZETTE's own Part III
    // extract (`K4-CITE-01`, `D315`), and s.3 itself is Gazette-read too.
    // The split is asserted per pack, not only in the corpus total, because a
    // corpus total can stay right while one pack silently empties.
    // **`K4-24` TAKES IT TO 82.** `section_89_arrears_relief` cited nothing at
    // all in this world until this session, so it could carry no checked quote;
    // it now quotes s.157's charging words against the newly-committed page-194
    // extract of the enacted Act. Citing the counterpart gives this world no
    // computation surface — the relief is computed in neither world.
    const ty = TY_2026_27_PACK_PROVENANCE.rules;
    expect(ty.flatMap((r) => r.verbatimQuotes).length).toBe(82);
    expect(ty.flatMap((r) => r.unverifiableQuotes).length).toBe(15);
    // **FIVE artifacts now, and each addition carries a rank.** The enacted Act
    // and ICAI's Rules 2026 were the original two. `K4-PORT-04` added ICAI's
    // Income-tax Act 2025 edition (`K4-PORT-02-S1`) for Finance Act, 2026
    // **section 3** and the ITD's First Schedule (`K4-SOURCE-02-S2`) for
    // **Part I-B**; `K4-PORT-04-S2` is the consolidated 1961 Act, quoted once
    // for contrast. **`K4-CITE-01` (`D315`) SWAPPED `K4-PORT-02-S1` FOR THE
    // GAZETTE (`K4-PORT-04-S1`)**: all sixteen s.3 spans moved to the Gazette's
    // committed Chapter II extract, so the ICAI reproduction — rank 2 — is no
    // longer quoted by anything, which is the census-visible half of the
    // re-citation. Seven Part I PROSE spans also moved to the Gazette; the
    // thirteen Part I-B AMOUNT spans deliberately did not (rupee glyph).
    //
    // The remaining ICAI artifact is **rank 2**; extracting a reproduction does
    // NOT promote it, and the citation resting on it discloses the rank. The
    // ITD First Schedule and the Gazette are rank 1. The rank split is asserted
    // in `parallel-worlds`, not here — this test's job is the artifact SET, so
    // that a later session cannot quietly widen the evidence base to whatever
    // happens to contain its span.
    expect(new Set(ty.flatMap((r) => r.verbatimQuotes).map((q) => q.artifactId))).toEqual(
      new Set([
        "K4-PORT-00-S2",
        "K4-PORT-04-S1",
        "K4-PORT-02-S2",
        "K4-SOURCE-02-S2",
        // The consolidated Income-tax Act, 1961 — a 1961-Act artifact named by a
        // 2025-Act pack, legitimately: `business_books_computation` quotes s.29
        // FOR CONTRAST with s.27. The half-separation guard constrains a rule's
        // `sources`, not the artifact a caveat quotes for comparison.
        "K4-PORT-04-S2",
      ]),
    );
    // AND THE PART-SEPARATION SURVIVES INTO THE QUOTATIONS, not only into the
    // citation strings. `K4-SOURCE-02-S2` physically contains Part I-A (the
    // 1961-Act world) as well as Part I-B, so a TY quote could match against the
    // wrong half of the right file and pass. Every span this pack declares
    // against it was read in Part I-B, whose figures are printed WITHOUT group
    // separators ("Rs. 250000") while Part I-A prints them WITH ("Rs. 2,50,000")
    // — so a span carrying a comma-grouped amount is evidence of the wrong half.
    // **The Gazette's Part I extract carries both halves TOO, and its Part I-B
    // Table 2 prints comma-grouped "Rs." amounts, so this heuristic is
    // ITD-COPY-SPECIFIC and deliberately still scoped to `K4-SOURCE-02-S2`
    // quotes only** (`K4-CITE-01` measured that; the seven Gazette-moved spans
    // are prose and carry no amounts at all).
    const fromFirstSchedule = ty
      .flatMap((r) => r.verbatimQuotes)
      .filter((q) => q.artifactId === "K4-SOURCE-02-S2");
    expect(fromFirstSchedule.length).toBeGreaterThan(0);
    for (const quote of fromFirstSchedule) {
      expect(quote.text, `${quote.text} looks like a Part I-A amount`).not.toMatch(
        /Rs\.\s?\d{1,2},\d{2},\d{3}/,
      );
    }
  });

  it("no span is left declared unverifiable for want of an extract", () => {
    // `QUOTE_NO_COMMITTED_EXTRACT` is the one obstacle in the vocabulary that a
    // session can simply REMOVE, by committing the extract. So its use count is
    // asserted at zero: reaching for it again turns a fixable gap into a
    // permanent declaration, and that has to fail rather than pass quietly.
    const all = PACKS.flatMap(([, p]) => p.rules.flatMap((r) => r.unverifiableQuotes));
    expect(all.filter((q) => q.reason === QUOTE_NO_COMMITTED_EXTRACT)).toEqual([]);
  });
});

describe("AUDIT-11-F5 — the guard itself fires (guard-the-guard)", () => {
  const evidence: EvidenceBase = {
    registered: new Set(["ART-WITH-EXTRACT", "ART-WITHOUT-EXTRACT"]),
    extracts: new Map([["ART-WITH-EXTRACT", normalizeForQuoteMatch("at the rate of four per cent. of such")]]),
  };
  const packWith = (fields: Parameters<typeof makeRuleProvenance>[0]) =>
    makeTaxPackProvenance([makeRuleProvenance(fields)]);

  it("passes on a quote that really is in the extract", () => {
    const pack = packWith({
      ruleId: "r",
      summary: "s",
      caveat: 'cess is "four per cent." here',
      verbatimQuotes: [{ artifactId: "ART-WITH-EXTRACT", text: "four per cent." }],
    });
    expect(checkVerbatimQuotes("T", pack, evidence)).toEqual([]);
  });

  it("FAILS on a falsified quote — the AUDIT-11 plant in miniature", () => {
    const pack = packWith({
      ruleId: "r",
      summary: "s",
      caveat: 'cess is "five per cent." here',
      verbatimQuotes: [{ artifactId: "ART-WITH-EXTRACT", text: "five per cent." }],
    });
    expect(checkVerbatimQuotes("T", pack, evidence)).toHaveLength(1);
    expect(checkVerbatimQuotes("T", pack, evidence)[0]).toContain("NOT in ART-WITH-EXTRACT");
  });

  it("FAILS — never silently skips — when the artifact has no committed extract", () => {
    const pack = packWith({
      ruleId: "r",
      summary: "s",
      caveat: 'it says "four per cent." here',
      verbatimQuotes: [{ artifactId: "ART-WITHOUT-EXTRACT", text: "four per cent." }],
    });
    expect(checkVerbatimQuotes("T", pack, evidence)[0]).toContain("NO committed extract");
  });

  it("FAILS on an artifact the manifest does not declare", () => {
    const pack = packWith({
      ruleId: "r",
      summary: "s",
      caveat: 'it says "four per cent." here',
      verbatimQuotes: [{ artifactId: "ART-INVENTED", text: "four per cent." }],
    });
    expect(checkVerbatimQuotes("T", pack, evidence)[0]).toContain("does not declare");
  });

  it("refuses an UNDECLARED span at construction — assertion (iii)", () => {
    expect(() =>
      makeRuleProvenance({ ruleId: "r", summary: "s", caveat: 'the Act says "four per cent." here' }),
    ).toThrow(/UNDECLARED quoted span/);
  });

  it("refuses a declaration the caveat does not contain — assertion (ii)", () => {
    expect(() =>
      makeRuleProvenance({
        ruleId: "r",
        summary: "s",
        caveat: 'the Act says "four per cent." here',
        verbatimQuotes: [
          { artifactId: "ART-WITH-EXTRACT", text: "four per cent." },
          { artifactId: "ART-WITH-EXTRACT", text: "eight per cent." },
        ],
      }),
    ).toThrow(/does not appear as a quoted span/);
  });

  it("refuses an unverifiable declaration with no reason", () => {
    expect(() =>
      makeRuleProvenance({
        ruleId: "r",
        summary: "s",
        caveat: 'the Act says "four per cent." here',
        unverifiableQuotes: [{ text: "four per cent.", reason: "" }],
      }),
    ).toThrow(/a reason is required/);
  });

  it("refuses one span classified both ways", () => {
    expect(() =>
      makeRuleProvenance({
        ruleId: "r",
        summary: "s",
        caveat: 'the Act says "four per cent." here',
        verbatimQuotes: [{ artifactId: "ART-WITH-EXTRACT", text: "four per cent." }],
        unverifiableQuotes: [{ text: "four per cent.", reason: "cannot decide" }],
      }),
    ).toThrow(/exactly one classification/);
  });

  it("refuses an unclosed quotation rather than losing the span", () => {
    expect(() => quotedSpansInCaveat('the Act says "four per cent. here')).toThrow(/odd number of quote marks/);
  });

  it("reads ONLY the pdftotext blocks — a quote in a reading note is not evidence", () => {
    const file = [
      "Artifact id    : ART-WITH-EXTRACT",
      "READING NOTES — read these before quoting anything below:",
      '  The Act does NOT say "five per cent." anywhere; that was the AUDIT-11 plant.',
      "",
      "BEGIN pdftotext -layout",
      "at the rate of four per cent. of such income-tax",
      "END pdftotext -layout",
    ].join("\n");
    const statute = extractedStatuteOnly(file);
    expect(statute).toContain("four per cent.");
    // The note quotes it, the statute does not, and the note must not count.
    expect(file).toContain("five per cent.");
    expect(statute).not.toContain("five per cent.");
  });

  it("a file with no pdftotext block contributes NOTHING, not its own prose", () => {
    // AUDIT-04-F4's shape: a guard that reads nothing must not report success.
    expect(extractedStatuteOnly("Artifact id : X\nsome prose that quotes four per cent.")).toBe("");
  });

  it("joins several extracts of one artifact instead of overwriting them", () => {
    // Twelve files carry one artifact (the enacted Act). A per-file `set()`
    // would keep the last and silently discard the rest.
    const evidenceTwo: EvidenceBase = {
      registered: new Set(["A"]),
      extracts: new Map([["A", normalizeForQuoteMatch("first file text ---extract-boundary--- second file text")]]),
    };
    const pack = packWith({
      ruleId: "r",
      summary: "s",
      caveat: 'it says "first file text" here',
      verbatimQuotes: [{ artifactId: "A", text: "first file text" }],
    });
    expect(checkVerbatimQuotes("T", pack, evidenceTwo)).toEqual([]);
    // …and the join separator itself blocks a span straddling two files.
    const straddle = packWith({
      ruleId: "r",
      summary: "s",
      caveat: 'it says "first file text second file text" here',
      verbatimQuotes: [{ artifactId: "A", text: "first file text second file text" }],
    });
    expect(checkVerbatimQuotes("T", straddle, evidenceTwo)).toHaveLength(1);
  });

  it("pairs spans by position, not by a length-floored regex", () => {
    // The naive `/"([^"]{12,})"/g` returns the PROSE BETWEEN two short quotes.
    // This is the real shape from `senior_80d_deduction_cap`.
    expect(quotedSpansInCaveat('caps "₹25,000" for self/spouse/dependent children but "₹50,000" more')).toEqual([
      "₹25,000",
      "₹50,000",
    ]);
  });
});
