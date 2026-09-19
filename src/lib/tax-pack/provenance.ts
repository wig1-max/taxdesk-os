/**
 * TaxDesk OS — Versioned Tax Pack: official-source PROVENANCE (Wave 1, K3-13).
 *
 * PURE TYPESCRIPT ONLY (see identity.ts for the boundary rules).
 *
 * Provenance answers ONE question: *which statutory or administrative authority
 * does a rule in this pack claim to derive from?* It is a structured, versioned
 * part of the pack contracts — not a free-text blob bolted onto the engine, and
 * not a value the engine reads (nothing here participates in a computation).
 *
 * Provenance is NOT verification. Citing a source records what a rule claims;
 * it does not assert that a qualified professional checked the rule against that
 * source. That evidence lives in `verification.ts`, and a rule with a perfect
 * citation and no verification record is still unverified. A rule that cites
 * NOTHING is reported as an explicit gap rather than silently passing.
 *
 * Nothing in this module may invent a citation. Every reference a shipped pack
 * carries must already be documented in the repository or checked against the
 * official source (ITD / CBDT / Gazette) by a person — never developer memory,
 * a blog, an LLM recollection, or competitor output.
 *
 * ── QUOTED STATUTE IN A CAVEAT IS DECLARED, NEVER INFERRED (`AUDIT-11-F5`) ──
 *
 * A caveat is prose, and this repository's caveats quote statute inside it. That
 * prose is RENDERED TO PREPARERS (`src/components/tax-desk/pack-traceability.tsx`),
 * so a wrong quotation is a wrong statement of law shown to the person preparing
 * a return. `AUDIT-11` demonstrated it: re-quoting Finance Act 2026 s.2(6) as
 * "five per cent." instead of "four per cent." left every gate in this
 * repository green.
 *
 * A parser cannot honestly recover WHICH of a rule's several sources a given
 * sentence was quoted from — the caveat never says. So the quote is DECLARED:
 *
 *   - `verbatimQuotes` — this exact span was quoted from THIS registered
 *     artifact, and `src/lib/tax-pack/__tests__/verbatim-quotes.test.ts` checks
 *     it against that artifact's committed extract. Falsify the span and the
 *     guard fails.
 *   - `unverifiableQuotes` — this exact span CANNOT be checked, and here is the
 *     reason. Nothing verifies its wording; the declaration exists so the gap is
 *     counted and visible rather than invisible.
 *
 * EVERY quoted span in a caveat must be in one list or the other. An undeclared
 * span is a construction-time ERROR, not a silent skip — that is the whole
 * property, and it is the one `D139`'s class of "compare two authored mappings"
 * guard lacks. Assertions (ii) "the caveat contains the declared text" and
 * (iii) "every span is declared" are enforced HERE, at construction, so the
 * rendered text and the checked text cannot diverge. Assertion (i) "the text is
 * really in that artifact's extract" needs the filesystem and lives in the test.
 */

/** The kind of instrument a reference points at. */
export const OFFICIAL_SOURCE_KINDS = [
  "act_section",
  "finance_act",
  "rule",
  "notification",
  "circular",
  "form_instruction",
  "gazette",
] as const;
export type OfficialSourceKind = (typeof OFFICIAL_SOURCE_KINDS)[number];

/** The body that issued the instrument. */
export const ISSUING_AUTHORITIES = ["Parliament", "CBDT", "ITD", "Gazette of India"] as const;
export type IssuingAuthority = (typeof ISSUING_AUTHORITIES)[number];

/**
 * A reference to one official source. `identifier`, `publishedOn` and `url` are
 * optional ON PURPOSE: an unknown notification number or publication date must
 * be OMITTED, never guessed to make a record look complete.
 */
export interface OfficialSourceReference {
  /** Stable id, unique within a pack's provenance (referenced by verification records). */
  readonly id: string;
  readonly kind: OfficialSourceKind;
  readonly authority: IssuingAuthority;
  /** Human-readable citation, e.g. "Section 87A, Income-tax Act, 1961". */
  readonly citation: string;
  /** Instrument number/designation when known (e.g. "87A", "Notification 05/2025"). */
  readonly identifier?: string;
  /** ISO date (YYYY-MM-DD) of publication, when known. */
  readonly publishedOn?: string;
  /** Official URL, when known. Must be https. */
  readonly url?: string;
}

/**
 * One quoted span in a caveat, declared as a verbatim quotation of a REGISTERED
 * artifact — checked, span by span, against that artifact's committed extract.
 */
export interface VerbatimQuote {
  /**
   * The artifact id as registered in
   * `docs/evidence/statutory-sources/manifest.json` (e.g. "K4-SOURCE-02-S1").
   * NOT an `OfficialSourceReference.id` — those name a provision, this names the
   * physical document whose text is committed to the evidence base.
   */
  readonly artifactId: string;
  /**
   * The span exactly as it appears between the quote marks in the caveat.
   * Restated here on purpose: editing the caveat's wording without editing this
   * breaks the pairing and fails at construction, which is what forces a
   * falsified quote to be noticed.
   */
  readonly text: string;
}

/**
 * One quoted span that this repository CANNOT check against its evidence base,
 * together with the reason. This is a declaration of a GAP, never a waiver: the
 * wording of such a span is verified by nothing, and it is listed so that the
 * gap is countable instead of invisible.
 */
export interface UnverifiableQuote {
  /** The span exactly as it appears between the quote marks in the caveat. */
  readonly text: string;
  /** Why it cannot be checked. Free prose, but it must say something. */
  readonly reason: string;
}

/**
 * The obstacles that actually occur in this repository's caveats, each measured
 * rather than imagined. `reason` is free prose so a genuinely new obstacle can be
 * stated in its own words — but reuse one of these where it fits, because the
 * guard takes a CENSUS by reason and asserts the counts, so a lazily-invented
 * synonym moves a number and fails rather than quietly widening the vocabulary.
 *
 * Every one of these means the same thing operationally: NOTHING IN THIS
 * REPOSITORY CHECKS THE WORDING OF THAT SPAN. They differ only in why.
 */
export const QUOTE_SOURCE_NOT_REGISTERED =
  "The span is quoted from a source this repository holds no registered artifact for — an ITD " +
  "help page, a CBDT validation-rules PDF, a bare-section reproduction, or a secondary tax-law " +
  "publisher — so there is no evidence base to check its wording against.";

/**
 * `MAINT-03` COMMITTED THE EXTRACTS THIS REASON EXISTED FOR, AND ITS USE COUNT
 * IS NOW ZERO. The constant is KEPT, not deleted: it is the correct reason the
 * moment a caveat quotes a newly-registered artifact, or a provision outside the
 * page ranges `scripts/build-statutory-extracts.mjs` commits. What must NOT
 * happen is reaching for it to silence a quote that could be checked by adding a
 * page range — that would turn a fixable gap into a permanent declaration.
 */
export const QUOTE_NO_COMMITTED_EXTRACT =
  "The artifact this span is quoted from IS registered in the manifest but has no committed " +
  "extract under docs/evidence/statutory-sources/extracts/, so a clean clone cannot read the " +
  "text. Committing an extract for that artifact would move this span to verbatimQuotes.";

/**
 * Found by `MAINT-03` in the enacted Income-tax Act, 2025, and distinct from
 * every reason above because NOTHING about the quotation or the evidence base is
 * wrong — the rendering is. Section 58's Table emits `section 263(1)in respect
 * of` with the inter-word space lost at a column break, in the default AND `-raw`
 * modes, while `-layout` scrambles that Table's rows entirely. A faithful
 * quotation therefore matches no mode's output. Whitespace normalisation
 * COLLAPSES runs of space; it cannot INSERT one, and widening it to do so would
 * let `four percent` match `four per cent` — the "widen the match until it
 * passes" move `D306` measured and rejected.
 */
export const QUOTE_SPACE_LOST_IN_EXTRACTION =
  "The committed extract has LOST an inter-word space at a column or line break (section 58's " +
  "Table renders \"section 263(1)in respect of\"), so a faithful quotation is not byte-identical " +
  "to any extraction mode's output. The words are present and correct; the spacing is the " +
  "artifact's, and normalisation may not insert a space it does not have.";

export const QUOTE_ELIDED =
  "The span joins non-adjacent fragments with an ellipsis, so it exists as a contiguous string " +
  "in no source and cannot be matched even though the source text IS committed here.";

export const QUOTE_EMPHASIS_ADDED =
  "The span carries capitalisation this repository added for emphasis, which the source does not " +
  "have, so it is not a byte-faithful quotation even though the source text IS committed here.";

export const QUOTE_EDITORIAL_BRACKET =
  "The span carries an editorial bracket this repository added to fit the quotation into its " +
  'sentence (e.g. "[w]here" for "Where"), which the source text does not have.';

export const QUOTE_ANNOTATION_STRIPPED =
  "The source is a CONSOLIDATION that carries inline amendment-footnote markers inside the " +
  'quoted words (rule 12 reads "1st day of April, 94[2026]"), and the quotation reproduces the ' +
  "provision de-annotated, so it is not byte-identical to the committed extract.";

export const QUOTE_NOT_STATUTORY_TEXT =
  "The span is not a quotation of any source's text — it is a document or web-page title, a term " +
  "of art, this repository's own prose quoted back at itself, or a phrase quoted in order to " +
  "record its ABSENCE from a source.";

/**
 * One rule (or rule group) of a pack together with the sources it derives from
 * and any documented caveat that keeps it from being verifiable as it stands.
 */
export interface RuleProvenance {
  /** Stable id of the rule/value group, e.g. "rebate_87a". */
  readonly ruleId: string;
  /** What the rule is. Deliberately descriptive — never a restatement of values. */
  readonly summary: string;
  /** Sources the rule claims to derive from. May be empty — that is a reported gap. */
  readonly sources: readonly OfficialSourceReference[];
  /**
   * A documented placeholder / `TODO(CA-verify)` marker. While a caveat stands,
   * the rule can only be verified by a record that explicitly resolves it, so a
   * known placeholder can never be rubber-stamped.
   */
  readonly caveat: string | null;
  /** Quoted spans checked against a registered artifact's committed extract. */
  readonly verbatimQuotes: readonly VerbatimQuote[];
  /** Quoted spans nothing can check, each with the reason it cannot. */
  readonly unverifiableQuotes: readonly UnverifiableQuote[];
}

/** The provenance a pack carries: one entry per declared rule. */
export interface TaxPackProvenance {
  readonly rules: readonly RuleProvenance[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertEnum<T extends string>(value: string | undefined, allowed: readonly T[], field: string): T {
  if (value === undefined || !(allowed as readonly string[]).includes(value)) {
    throw new Error(
      `Invalid provenance ${field}: ${JSON.stringify(value)} (expected one of ${allowed.join(", ")})`,
    );
  }
  return value as T;
}

function assertNonEmpty(value: string | undefined, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Provenance ${field} must be a non-empty string`);
  }
  return value;
}

/** Construct a validated, frozen official-source reference. */
export function makeOfficialSourceReference(fields: {
  id: string;
  kind: OfficialSourceKind;
  authority: IssuingAuthority;
  citation: string;
  identifier?: string;
  publishedOn?: string;
  url?: string;
}): OfficialSourceReference {
  const id = assertNonEmpty(fields.id, "source id");
  const kind = assertEnum(fields.kind, OFFICIAL_SOURCE_KINDS, "source kind");
  const authority = assertEnum(fields.authority, ISSUING_AUTHORITIES, "issuing authority");
  const citation = assertNonEmpty(fields.citation, "citation");
  if (fields.publishedOn !== undefined && !ISO_DATE.test(fields.publishedOn)) {
    throw new Error(`Provenance publishedOn must be an ISO date (YYYY-MM-DD): ${JSON.stringify(fields.publishedOn)}`);
  }
  if (fields.url !== undefined && !fields.url.startsWith("https://")) {
    throw new Error(`Provenance url must be https: ${JSON.stringify(fields.url)}`);
  }
  return Object.freeze({
    id,
    kind,
    authority,
    citation,
    ...(fields.identifier !== undefined ? { identifier: assertNonEmpty(fields.identifier, "identifier") } : {}),
    ...(fields.publishedOn !== undefined ? { publishedOn: fields.publishedOn } : {}),
    ...(fields.url !== undefined ? { url: fields.url } : {}),
  });
}

/**
 * Every quoted span in a caveat, in order, WITHOUT its quote marks.
 *
 * Deliberately a paired split rather than a regular expression. `/"([^"]{n,})"/g`
 * mis-pairs: given `... "parents" ... a long stretch of prose ... "self/family"`,
 * a length-floored regex skips the short spans and then matches the PROSE
 * BETWEEN them as though it were the quotation. Splitting on `"` and taking the
 * odd indices cannot make that mistake, and an odd count of quote marks —
 * an unclosed quotation — is itself a reported error rather than a span that
 * quietly disappears.
 *
 * There is NO minimum length. A floor is exactly the kind of proxy this guard
 * exists to remove: `"5 per cent"` is ten characters, and a falsified figure is
 * usually short. Spans that are terminology rather than statute are declared
 * `unverifiableQuotes` with that as the stated reason.
 */
export function quotedSpansInCaveat(caveat: string): readonly string[] {
  const parts = caveat.split('"');
  if (parts.length % 2 === 0) {
    throw new Error(
      `Caveat has an odd number of quote marks (an unclosed quotation), so its quoted spans ` +
        `cannot be determined: ${JSON.stringify(caveat.slice(0, 120))}…`,
    );
  }
  return parts.filter((_, index) => index % 2 === 1).filter((span) => span.trim() !== "");
}

/**
 * Construct a validated, frozen rule-provenance entry. Duplicate source ids are
 * refused, and EVERY quoted span in the caveat must be declared — see the module
 * header for why an undeclared span is an error rather than a skip.
 */
export function makeRuleProvenance(fields: {
  ruleId: string;
  summary: string;
  sources?: readonly OfficialSourceReference[];
  caveat?: string | null;
  verbatimQuotes?: readonly VerbatimQuote[];
  unverifiableQuotes?: readonly UnverifiableQuote[];
}): RuleProvenance {
  const ruleId = assertNonEmpty(fields.ruleId, "ruleId");
  const summary = assertNonEmpty(fields.summary, "rule summary");
  const sources = fields.sources ?? [];
  const seen = new Set<string>();
  for (const source of sources) {
    if (seen.has(source.id)) {
      throw new Error(`Rule ${ruleId} cites source ${JSON.stringify(source.id)} more than once`);
    }
    seen.add(source.id);
  }
  const caveat = fields.caveat ?? null;
  if (caveat !== null) assertNonEmpty(caveat, "caveat");

  const verbatimQuotes = fields.verbatimQuotes ?? [];
  const unverifiableQuotes = fields.unverifiableQuotes ?? [];
  for (const quote of verbatimQuotes) {
    assertNonEmpty(quote.artifactId, `verbatim quote artifactId on rule ${ruleId}`);
    assertNonEmpty(quote.text, `verbatim quote text on rule ${ruleId}`);
  }
  for (const quote of unverifiableQuotes) {
    assertNonEmpty(quote.text, `unverifiable quote text on rule ${ruleId}`);
    assertNonEmpty(quote.reason, `unverifiable quote reason on rule ${ruleId} (a reason is required)`);
  }

  const declared = new Map<string, "verbatim" | "unverifiable">();
  const declare = (text: string, kind: "verbatim" | "unverifiable") => {
    const existing = declared.get(text);
    if (existing !== undefined) {
      throw new Error(
        `Rule ${ruleId} declares the same quoted span twice (${existing} then ${kind}); ` +
          `each span gets exactly one classification: ${JSON.stringify(text.slice(0, 80))}`,
      );
    }
    declared.set(text, kind);
  };
  for (const quote of verbatimQuotes) declare(quote.text, "verbatim");
  for (const quote of unverifiableQuotes) declare(quote.text, "unverifiable");

  if (caveat === null) {
    if (declared.size > 0) {
      throw new Error(`Rule ${ruleId} declares quoted spans but has no caveat to quote them from`);
    }
  } else {
    const spans = new Set(quotedSpansInCaveat(caveat));
    // (iii) every span in the rendered prose is classified. DEFAULT FAIL.
    for (const span of spans) {
      if (!declared.has(span)) {
        throw new Error(
          `Rule ${ruleId} has an UNDECLARED quoted span in its caveat. Every quoted span must be ` +
            `either a verbatimQuote (checked against a committed extract) or an unverifiableQuote ` +
            `(with a reason). Undeclared: ${JSON.stringify(span.slice(0, 120))}`,
        );
      }
    }
    // (ii) nothing is declared that the rendered prose does not actually say —
    // so the checked text and the displayed text cannot drift apart.
    for (const text of declared.keys()) {
      if (!spans.has(text)) {
        throw new Error(
          `Rule ${ruleId} declares a quote that does not appear as a quoted span in its caveat ` +
            `(the caveat was edited without the declaration, or vice versa): ` +
            `${JSON.stringify(text.slice(0, 120))}`,
        );
      }
    }
  }

  return Object.freeze({
    ruleId,
    summary,
    sources: Object.freeze([...sources]),
    caveat,
    verbatimQuotes: Object.freeze(verbatimQuotes.map((q) => Object.freeze({ ...q }))),
    unverifiableQuotes: Object.freeze(unverifiableQuotes.map((q) => Object.freeze({ ...q }))),
  });
}

/** Assemble a pack's provenance. Duplicate rule ids are refused. */
export function makeTaxPackProvenance(rules: readonly RuleProvenance[]): TaxPackProvenance {
  const seen = new Set<string>();
  for (const rule of rules) {
    if (seen.has(rule.ruleId)) {
      throw new Error(`Duplicate provenance ruleId: ${JSON.stringify(rule.ruleId)}`);
    }
    seen.add(rule.ruleId);
  }
  return Object.freeze({ rules: Object.freeze([...rules]) });
}

/** The provenance entry for a rule, or `undefined`. Callers must handle absence. */
export function findRuleProvenance(
  provenance: TaxPackProvenance,
  ruleId: string,
): RuleProvenance | undefined {
  return provenance.rules.find((rule) => rule.ruleId === ruleId);
}

/** Every distinct source id a pack's provenance cites, in declaration order. */
export function taxPackSourceIds(provenance: TaxPackProvenance): readonly string[] {
  const ids: string[] = [];
  for (const rule of provenance.rules) {
    for (const source of rule.sources) {
      if (!ids.includes(source.id)) ids.push(source.id);
    }
  }
  return Object.freeze(ids);
}
