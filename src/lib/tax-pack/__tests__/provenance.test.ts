/**
 * K3-13 — official-source PROVENANCE model.
 *
 * Proves: references and rule entries are validated + frozen; unknown fields are
 * omitted rather than guessed; duplicates are refused; and the shipped AY pack
 * declares provenance that is TRUTHFUL — every rule carries the engine's own
 * `TODO(CA-verify)` caveat, and the rules the engine documents no source for
 * cite none rather than an invented one.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import * as ts from "typescript";
import {
  AY_2026_27_PACK,
  AY_2026_27_PACK_PROVENANCE,
  findRuleProvenance,
  makeOfficialSourceReference,
  makeRuleProvenance,
  makeTaxPackProvenance,
  taxPackProvenance,
  taxPackSourceIds,
} from "@/lib/tax-pack";
import { BUSINESS_BOOKS_ACTIVITY_CLASSIFICATIONS } from "@/lib/tax-engine/ay-2026-27";

const SOURCE = makeOfficialSourceReference({
  id: "S1",
  kind: "act_section",
  authority: "Parliament",
  citation: "Section 1, Some Act",
});

describe("makeOfficialSourceReference", () => {
  it("validates and freezes a reference", () => {
    expect(Object.isFrozen(SOURCE)).toBe(true);
    expect(SOURCE.citation).toBe("Section 1, Some Act");
  });

  it("omits unknown identifier/date/url rather than defaulting them", () => {
    expect("identifier" in SOURCE).toBe(false);
    expect("publishedOn" in SOURCE).toBe(false);
    expect("url" in SOURCE).toBe(false);
  });

  it("rejects bad enums, empty citations, non-ISO dates and non-https urls", () => {
    const base = { id: "S", kind: "act_section", authority: "Parliament", citation: "c" } as const;
    expect(() => makeOfficialSourceReference({ ...base, kind: "blog" as never })).toThrow(/source kind/);
    expect(() => makeOfficialSourceReference({ ...base, authority: "Wikipedia" as never })).toThrow(
      /issuing authority/,
    );
    expect(() => makeOfficialSourceReference({ ...base, citation: "  " })).toThrow(/citation/);
    expect(() => makeOfficialSourceReference({ ...base, publishedOn: "2025" })).toThrow(/ISO date/);
    expect(() => makeOfficialSourceReference({ ...base, url: "http://x.test" })).toThrow(/https/);
  });
});

describe("makeRuleProvenance / makeTaxPackProvenance", () => {
  it("defaults to no sources and no caveat, and freezes", () => {
    const rule = makeRuleProvenance({ ruleId: "r", summary: "s" });
    expect(rule.sources).toEqual([]);
    expect(rule.caveat).toBeNull();
    expect(Object.isFrozen(rule)).toBe(true);
    expect(Object.isFrozen(rule.sources)).toBe(true);
  });

  it("refuses a duplicated source on one rule and a duplicated ruleId in a pack", () => {
    expect(() => makeRuleProvenance({ ruleId: "r", summary: "s", sources: [SOURCE, SOURCE] })).toThrow(
      /more than once/,
    );
    const rule = makeRuleProvenance({ ruleId: "r", summary: "s" });
    expect(() => makeTaxPackProvenance([rule, rule])).toThrow(/Duplicate provenance ruleId/);
  });

  it("looks rules up and lists distinct source ids in declaration order", () => {
    const provenance = makeTaxPackProvenance([
      makeRuleProvenance({ ruleId: "a", summary: "a", sources: [SOURCE] }),
      makeRuleProvenance({ ruleId: "b", summary: "b", sources: [SOURCE] }),
    ]);
    expect(findRuleProvenance(provenance, "b")?.summary).toBe("b");
    expect(findRuleProvenance(provenance, "missing")).toBeUndefined();
    expect(taxPackSourceIds(provenance)).toEqual(["S1"]);
  });
});

describe("AY 2026-27 pack provenance (truthfulness)", () => {
  it("is carried by the shipped pack", () => {
    expect(taxPackProvenance(AY_2026_27_PACK)).toBe(AY_2026_27_PACK_PROVENANCE);
  });

  it("declares every rule with a TODO(CA-verify) caveat — nothing is verifiable as it stands", () => {
    expect(AY_2026_27_PACK_PROVENANCE.rules.length).toBeGreaterThan(0);
    for (const rule of AY_2026_27_PACK_PROVENANCE.rules) {
      expect(rule.caveat).toMatch(/TODO\(CA-verify\)/);
    }
  });

  it("cites an official source for every rule without claiming that any rule is verified", () => {
    // MAINT-09 / AUDIT-14-F2 deliberately retires the last two members of this
    // set. Both were source problems: an empty `sources` array makes a rule
    // impossible for a CA to sign regardless of whether its values are right.
    // The held consolidated Act now has narrow s.16 and Chapter VI-A ranges,
    // and every quoted span is checked against them. This moves sourceability,
    // not lifecycle: every rule still has a TODO(CA-verify) caveat and the pack
    // remains draft with zero verification records.
    const uncited = AY_2026_27_PACK_PROVENANCE.rules
      .filter((r) => r.sources.length === 0)
      .map((r) => r.ruleId);
    expect(uncited).toEqual([]);
  });

  it("only cites official instruments the engine already documents", () => {
    expect(taxPackSourceIds(AY_2026_27_PACK_PROVENANCE)).toEqual([
      "ITA_1961_S115BAC",
      "FINANCE_ACT_2025",
      "ITA_1961_S16_STANDARD_DEDUCTION",
      "ITA_1961_S87A",
      // K4-12 — the clause-20 amending text for the section 87A rebate and its
      // rebate-threshold marginal relief, quoted verbatim in rules.ts
      // REBATE_87A. First used by `rebate_87a_marginal_relief`, declared
      // immediately after `rebate_87a` — hence this position in first-use order.
      "FINANCE_ACT_2025_S87A",
      "ITA_1961_S111A",
      "FINANCE_NO2_ACT_2024",
      "ITA_1961_S112A",
      "ITA_1961_S45",
      "ITA_1961_S48",
      "ITA_1961_S50C",
      "ITA_1961_S2_42A",
      "ITA_1961_S112",
      // The Cost Inflation Index notification chain under clause (v) of the
      // Explanation to section 48. ALL NINE now appear, in the chain's own
      // amendment order, because 44/2017 is the principal notification and
      // every later one inserts one serial into its table.
      //
      // K4-23 cited only four, and the omission was the point at the time:
      // 26/2018, 63/2019, 32/2020, 73/2021 and 62/2022 were held by no
      // registered artifact, so citing them would have asserted evidence this
      // repository did not have. `K4-SOURCE-07` registered all five from the
      // official e-Gazette and `K4-24` Phase 0 cites them. Recorded as a
      // forward correction, not a rewrite (`PROJECT_CONSTITUTION.md` §4).
      "CBDT_NOTIFICATION_44_2017",
      "CBDT_NOTIFICATION_26_2018",
      "CBDT_NOTIFICATION_63_2019",
      "CBDT_NOTIFICATION_32_2020",
      "CBDT_NOTIFICATION_73_2021",
      "CBDT_NOTIFICATION_62_2022",
      "CBDT_NOTIFICATION_39_2023",
      "CBDT_NOTIFICATION_44_2024",
      "CBDT_NOTIFICATION_70_2025",
      // K4-SOURCE-02 — the Finance Act, 2026 itself, and the Income-tax Rules,
      // 1962. All three serve the AY 2026-27 / Income-tax Act, 1961 world; the
      // Finance Act, 2026's OTHER half (s.3, First Schedule Part I-B) serves
      // the 2025-Act world and is cited only by the TY pack. First-use order
      // puts them here because `cess_rate` and `itr1_income_ceiling` are
      // declared before the K4-11 surcharge rules.
      "FINANCE_ACT_2026_S2",
      // MAINT-09 / AUDIT-14-F2 — first used by the Chapter VI-A grouped rule,
      // immediately before itr1_income_ceiling. The existing 80D/TTA/TTB
      // references move here in first-use order; they are not duplicated later.
      "ITA_1961_S80C",
      "ITA_1961_S80CCD",
      "ITA_1961_S80CCE",
      "ITA_1961_S80D",
      "ITA_1961_S80G",
      "ITA_1961_S80TTA",
      "ITA_1961_S80TTB",
      "ITR_1962_R12",
      "FINANCE_ACT_2026_FIRST_SCHEDULE_PART_I_A",
      // K4-11 — surcharge + marginal relief. Was "the only source in this pack
      // quoted VERBATIM from the bare statutory text" until K4-SOURCE-02 added
      // three more that are (corrected forward, §4); it remains the FIRST.
      // (the Finance Act, 2025
      // PDF was retrieved from a government host and its text extracted
      // locally) rather than transcribed from a publisher's rendering. Its
      // position here, not at the end, is first-use order: the two K4-11 rules
      // are declared immediately before `senior_super_senior_age_definition`,
      // which is what first uses the reference on the next line.
      "FINANCE_ACT_2025_SURCHARGE",
      "FINANCE_ACT_2025_FIRST_SCHEDULE_PART_III",
      "ITD_SENIOR_CITIZEN_HELP_AY_2026_27",
      "CBDT_ITR2_VALIDATION_RULES_AY_2026_27",
      "ITA_1961_S207",
      "ITA_1961_S22_TO_S27",
      "ITA_1961_S71_3A",
      "ITA_1961_S44ADA",
      "ITA_1961_S44AA",
      "ITD_ITR4_APPLICABILITY",
      "ITA_1961_S44AD",
      // K4-24 Phase 0 — first used by `presumptive_44ad_computation`, and it is
      // the FIRST statutory instrument that rule has ever cited for its
      // electronic-modes split. `ITD_ITR4_APPLICABILITY` is already above in
      // first-use order (44ADA cites it first), so this is the only insertion.
      "ITR_1962_R6ABBA",
      // K4-14 — books-based business/profession income. First-use order again:
      // `business_books_computation` is declared immediately after
      // `presumptive_44ad_computation` and before the K4-09 loss rules.
      // Section 115BAC is NOT repeated here — it was first used far earlier and
      // this list is first-use order, not per-rule.
      "ITA_1961_S28",
      "ITA_1961_S29",
      "ITA_1961_S44AB",
      "ITA_1961_S43_5",
      // K4-17 — Section 70 and the official set-off/carry-forward guidance are
      // now first used by the widened books-business rule. Section 70 used to
      // first appear in the K4-09 capital-loss rule below.
      "ITA_1961_S70",
      "ITA_1961_S73",
      "ITA_1961_S73A",
      "ITD_SET_OFF_AND_CARRY_FORWARD_GUIDANCE_2026",
      // K4-09 — remaining within-year capital-loss sources.
      "ITA_1961_S71_3",
      "ITA_1961_S74",
      // K4-19 — Section 89 arrears relief and its machinery. LAST in first-use
      // order because `section_89_arrears_relief` is declared last. These NAME
      // the provisions; neither has had its text read here (the consolidated
      // 1961 Act is now registered as `K4-PORT-04-S2`, but no s.89 page range
      // has been committed), which is why that rule quotes no statute at all.
      "ITA_1961_S89",
      "ITR_RULES_1962_R21A_FORM_10E",
    ]);
    const checkedOnline = new Set([
      "ITA_1961_S43_5",
      "ITA_1961_S70",
      "ITA_1961_S73",
      "ITA_1961_S73A",
      "ITD_SET_OFF_AND_CARRY_FORWARD_GUIDANCE_2026",
    ]);
    for (const rule of AY_2026_27_PACK_PROVENANCE.rules) {
      for (const source of rule.sources) {
        if (checkedOnline.has(source.id)) {
          expect(source.url).toMatch(/^https:\/\/www\.incometaxindia\.gov\.in\//);
        } else {
          // No publication date or URL has been checked for the older source
          // records, so none may be invented while touching K4-17.
          expect("publishedOn" in source).toBe(false);
          expect("url" in source).toBe(false);
        }
      }
    }
    const section70 = AY_2026_27_PACK_PROVENANCE.rules
      .flatMap((rule) => rule.sources)
      .find((source) => source.id === "ITA_1961_S70");
    expect(section70?.url).toBe("https://www.incometaxindia.gov.in/w/section-70-63");
    expect("publishedOn" in (section70 ?? {})).toBe(false);
    const section43 = AY_2026_27_PACK_PROVENANCE.rules
      .flatMap((rule) => rule.sources)
      .find((source) => source.id === "ITA_1961_S43_5");
    expect(section43?.url).toBe("https://www.incometaxindia.gov.in/w/section-43-64");
    const guidance = AY_2026_27_PACK_PROVENANCE.rules
      .flatMap((rule) => rule.sources)
      .find((source) => source.id === "ITD_SET_OFF_AND_CARRY_FORWARD_GUIDANCE_2026");
    expect(guidance?.publishedOn).toBe("2026-05-27");
    expect(guidance?.citation).toContain("official guidance, version 2.0");
  });
});

/**
 * `AUDIT-04-F2`. This rule's summary used to assert that "the engine computes
 * ONLY the window in which both are provably immaterial" — literally false of
 * `computeTax`, which applies one reading of both unresolved D93 questions
 * unconditionally and is frozen RAW into this pack's `computation` binding.
 * The window is enforced one layer up, by the computation adapter.
 *
 * The summary now says so. This guard pins the structural fact the corrected
 * wording depends on: every production module that CALLS the raw engine feeds
 * it adapter-built input. A future consumer that reached the engine directly
 * would inherit the unguarded reading, which is exactly the risk `K4-10`
 * (carry-forward) walks into.
 */
describe("AUDIT-04-F2 — the D95 window is enforced by the adapter, and the pack says so", () => {
  const SRC = join(process.cwd(), "src");

  function sourceFilesUnder(dir: string): string[] {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return [];
    }
    const out: string[] = [];
    for (const entry of entries) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === "__tests__") continue;
        out.push(...sourceFilesUnder(full));
      } else if (/\.tsx?$/.test(entry)) {
        out.push(full);
      }
    }
    return out;
  }

  const ENGINE_DIR = join(SRC, "lib", "tax-engine");
  const PACK_DIR = join(SRC, "lib", "tax-pack");
  const production = sourceFilesUnder(SRC).filter(
    (f) => !f.startsWith(ENGINE_DIR) && !f.startsWith(PACK_DIR),
  );

  const RAW_ENGINE_APIS = new Set([
    "computeTax",
    "compareRegimes",
    "recommendItrForm",
    "validateCase",
  ]);

  function rootIdentifier(node: ts.Expression): string | null {
    let current = node;
    while (ts.isPropertyAccessExpression(current)) current = current.expression;
    return ts.isIdentifier(current) ? current.text : null;
  }

  function findUnmediatedEngineCalls(file: string, source: string): string[] {
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const directEngineImports = new Map<string, string>();
    const engineNamespaces = new Set<string>();
    const packBindingFactories = new Set<string>();
    const packBindings = new Set<string>();

    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const moduleName = statement.moduleSpecifier.text;
      if (!/(?:tax-engine|tax-pack)/.test(moduleName)) continue;
      const clause = statement.importClause;
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) engineNamespaces.add(bindings.name.text);
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      for (const element of bindings.elements) {
        const imported = element.propertyName?.text ?? element.name.text;
        if (RAW_ENGINE_APIS.has(imported)) directEngineImports.set(element.name.text, imported);
        if (/^bind.*TaxPack/.test(imported)) packBindingFactories.add(element.name.text);
      }
    }

    function collectPackBindings(node: ts.Node): void {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        ts.isCallExpression(node.initializer) &&
        ts.isIdentifier(node.initializer.expression) &&
        packBindingFactories.has(node.initializer.expression.text)
      ) {
        packBindings.add(node.name.text);
      }
      ts.forEachChild(node, collectPackBindings);
    }
    collectPackBindings(sourceFile);

    const findings: string[] = [];
    function inspect(node: ts.Node): void {
      if (ts.isCallExpression(node)) {
        let api: string | null = null;
        if (ts.isIdentifier(node.expression)) {
          api = directEngineImports.get(node.expression.text) ?? null;
        } else if (ts.isPropertyAccessExpression(node.expression)) {
          const candidate = node.expression.name.text;
          const root = rootIdentifier(node.expression);
          if (
            RAW_ENGINE_APIS.has(candidate) &&
            root &&
            (engineNamespaces.has(root) || packBindings.has(root))
          ) {
            api = candidate;
          }
        }

        if (api) {
          const argument = node.arguments[0];
          const mediated =
            !!argument &&
            ts.isPropertyAccessExpression(argument) &&
            argument.name.text === "input";
          if (!mediated) {
            const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
            const repoPath = relative(process.cwd(), file).replaceAll("\\", "/");
            findings.push(`${repoPath}:${line + 1}:${character + 1} ${api}`);
          }
        }
      }
      ts.forEachChild(node, inspect);
    }
    inspect(sourceFile);
    return findings;
  }

  it("actually scans a non-trivial number of production files — guards this guard", () => {
    // AUDIT-04-F3/F4's lesson: a source scan that silently matches nothing
    // approves everything.
    expect(production.length).toBeGreaterThan(50);
  });

  it("every production raw-engine call is imported/routed explicitly and receives adapter input", () => {
    const unmediated = production.flatMap((file) =>
      findUnmediatedEngineCalls(file, readFileSync(file, "utf8")),
    );
    expect(unmediated).toEqual([]);
  });

  it("does not accept a comment or unrelated builder call beside an unmediated engine call", () => {
    const planted = [
      'import { computeTax as rawCompute } from "@/lib/tax-engine/ay-2026-27";',
      "// buildEngineInput(rows, meta); adapter.input",
      "const unrelated = buildEngineInput;",
      "rawCompute(input);",
    ].join("\n");
    expect(findUnmediatedEngineCalls(join(SRC, "planted.ts"), planted)).toEqual([
      "src/planted.ts:4:1 computeTax",
    ]);
  });

  it("the rule summary attributes the window to the adapter, not to the engine", () => {
    const rule = AY_2026_27_PACK_PROVENANCE.rules.find(
      (r) => r.ruleId === "capital_loss_within_year_set_off",
    );
    if (!rule) throw new Error("expected capital_loss_within_year_set_off");
    expect(rule.summary).toContain("computation-adapter.ts");
    // The false claim must not come back.
    expect(rule.summary).not.toContain("the engine computes ONLY the window");
  });
});

/**
 * `AUDIT-10-F1`, the same class as `AUDIT-04-F2` one rule over.
 *
 * `K4-18` made affirmed exchange-traded F&O COMPUTE into the ordinary Section
 * 70(1) pool and left `business_books_computation` saying it refuses — for four
 * sessions, on a rule `pack-traceability.tsx` renders to preparers on
 * Computation and Validation. Nothing failed, because no guard tied the rule's
 * text to the vocabulary it describes.
 *
 * This is that tie. It pins the STRUCTURAL facts the corrected wording depends
 * on, not the wording itself: which classifications compute, which refuse, and
 * which may take their Section 44AB figure from books revenue. A future books
 * slice that moves any of them fails here, with a message naming the rule to
 * revisit — which is the whole point, since no test can know that a sentence
 * has quietly become false.
 *
 * The two retired sentences are additionally pinned as regressions, exactly as
 * the `AUDIT-04-F2` guard above pins its own.
 */
describe("AUDIT-10-F1 — business_books_computation matches the vocabulary it describes", () => {
  const RULE = "business_books_computation";
  const REVISIT = `if this changed deliberately, revisit the ${RULE} summary and caveat — they describe it`;

  const rule = AY_2026_27_PACK_PROVENANCE.rules.find((r) => r.ruleId === RULE);
  if (!rule) throw new Error(`expected ${RULE} in the AY 2026-27 pack provenance`);

  const entries = Object.entries(BUSINESS_BOOKS_ACTIVITY_CLASSIFICATIONS);
  const computable = entries.filter(([, v]) => v.computable).map(([k]) => k);
  const refusing = entries.filter(([, v]) => !v.computable).map(([k]) => k);

  it(`admits exactly the two classifications the rule says compute (${REVISIT})`, () => {
    expect(computable.sort()).toEqual(
      ["fno_non_speculative_s43_5_d", "ordinary_business_or_profession"].sort(),
    );
  });

  it(`keeps unaffirmed F&O and intraday equity refusing (${REVISIT})`, () => {
    // The corrected summary states both of these refuse and hold back the whole
    // head. If either ever computes, that sentence is false the day it lands.
    expect(refusing).toContain("futures_and_options");
    expect(refusing).toContain("intraday_speculative_s43_5");
  });

  it(`lets ONLY the ordinary class take its Section 44AB figure from books revenue (${REVISIT})`, () => {
    const fromBooksRevenue = entries
      .filter(([, v]) => v.turnoverFromBooksRevenue)
      .map(([k]) => k);
    expect(fromBooksRevenue).toEqual(["ordinary_business_or_profession"]);
  });

  it("discloses the declared-turnover boundary whenever a computable class cannot use books revenue", () => {
    // This is the D287 condition, derived rather than assumed: a class that
    // computes but may NOT read its turnover from books revenue is precisely a
    // class whose Section 44AB figure the PREPARER must declare. While one
    // exists, the rendered caveat owes the preparer that disclosure.
    const declaredTurnoverRequired = entries.filter(
      ([, v]) => v.computable && !v.turnoverFromBooksRevenue,
    );
    expect(declaredTurnoverRequired.length).toBeGreaterThan(0);

    expect(rule.caveat).toContain("D287");
    expect(rule.caveat).toContain("NO SOURCE DEFINES DERIVATIVE TURNOVER");
    // The direction of the refusal matters more than its presence: substituting
    // revenue would understate the aggregate and convert an audit case into a
    // no-audit-required one.
    expect(rule.caveat).toContain("never derives it");
    expect(rule.summary).toContain("PREPARER SEPARATELY");
  });

  it("does not let either retired pre-K4-18 sentence come back", () => {
    expect(rule.summary).not.toContain(
      "F&O under Section 43(5) and Sections 73/73A restricted pools refuse",
    );
    expect(rule.caveat).not.toContain(
      "outside this product's unsupported F&O category rather than being inferred ordinary",
    );
  });
});
