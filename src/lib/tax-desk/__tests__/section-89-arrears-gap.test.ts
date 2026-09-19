/**
 * K4-19 — Section 89(1) arrears relief is ABSENT, and this file asserts the
 * properties of that absence.
 *
 * WHY A TEST FILE FOR SOMETHING NOT IMPLEMENTED. Every other assertion K4-19
 * touched is a pinned INVENTORY — a fingerprint, a rule-id list, a state count.
 * Those move whenever anything moves, so they prove the row changed without
 * proving WHAT it now claims. The properties below are the substance: that the
 * gap is named, that it is sourced, that its caveat quotes no statute (the
 * `D307`/`D308` two-part-edit rule), that the row no longer reads `supported`,
 * and that the declaration reaches the database vocabulary.
 *
 * WHAT THIS FILE CANNOT DO, said plainly because the whole slice is about not
 * overstating: it cannot verify any statement of tax law. It checks that this
 * repository says a consistent thing in five places, never that the thing is
 * right. Section 89 and Rule 21A have not been read here — the consolidated
 * Income-tax Act, 1961 is unretrieved (`AUDIT-10-F4`).
 */

import { describe, expect, it } from "vitest";

import { SPECIAL_SITUATIONS, isSpecialSituationCode } from "@/lib/tax-desk/eligibility";
import { TAX_CAPABILITY_MATRIX, findTaxCapability, ruleAuthorityFor } from "@/lib/tax-desk/tax-capability";
import { NOT_IMPLEMENTED } from "@/lib/tax-engine/ay-2026-27/rules";
import { AY_2026_27_PACK_PROVENANCE } from "@/lib/tax-pack/packs/ay-2026-27-provenance";
import { TY_2026_27_PACK_PROVENANCE } from "@/lib/tax-pack/packs/ty-2026-27-provenance";
import { findRuleProvenance, quotedSpansInCaveat } from "@/lib/tax-pack/provenance";

const RULE_ID = "section_89_arrears_relief";
const SITUATION = "salary_arrears_section_89";

describe("K4-19 — the Section 89 arrears-relief gap is declared, not merely absent", () => {
  it("the engine records the gap AND its cause, not just the fact of it", () => {
    const text = NOT_IMPLEMENTED.section89ArrearsRelief;
    expect(text).toMatch(/Section 89\(1\)/);
    expect(text).toMatch(/Rule 21A/);
    expect(text).toMatch(/Form 10E/);
    // The CAUSE is the part a later session needs: it says why this cannot be
    // closed by ordinary implementation work, so nobody schedules it as one.
    expect(text).toMatch(/prior years' rate schedules/i);
    expect(text).toMatch(/no multi-year state/i);
    // And the direction of error, which is the opposite of most gaps here.
    expect(text).toMatch(/overstate tax, never understate/i);
  });

  it("names the Rule 21A(3)-(5) limbs as equally uncomputed, so the gap is not read as narrower than it is", () => {
    const text = NOT_IMPLEMENTED.section89ArrearsRelief;
    expect(text).toMatch(/gratuity/i);
    expect(text).toMatch(/commuted pension/i);
    expect(text).toMatch(/compensation on termination/i);
  });

  it("the AY pack declares the rule and cites both the section and its machinery", () => {
    const rule = findRuleProvenance(AY_2026_27_PACK_PROVENANCE, RULE_ID);
    expect(rule, `${RULE_ID} must exist in the AY pack`).toBeDefined();
    expect(rule!.sources.map((s) => s.id).sort()).toEqual([
      "ITA_1961_S89",
      "ITR_RULES_1962_R21A_FORM_10E",
    ]);
    expect(rule!.summary).toMatch(/NOT IMPLEMENTED/);
  });

  it("the AY caveat QUOTES NO STATUTE — the D307/D308 property, asserted rather than assumed", () => {
    // This is the load-bearing one. A quoted span in a caveat is a two-part
    // edit: it must be declared as a `verbatimQuote` checked against a committed
    // extract, or as an `unverifiableQuote` with a reason. The 1961 Act is
    // unretrieved, so any span here could ONLY ever be unverifiable — checked by
    // nothing, and counted in a census that exists to shrink. Quoting nothing is
    // strictly more honest, and this asserts it stays that way.
    const rule = findRuleProvenance(AY_2026_27_PACK_PROVENANCE, RULE_ID)!;
    expect(quotedSpansInCaveat(rule.caveat ?? "")).toEqual([]);
    expect(rule.verbatimQuotes).toEqual([]);
    expect(rule.unverifiableQuotes).toEqual([]);
    // The caveat must still SAY the text was not read, so a reader does not take
    // the citations above as evidence anybody checked them.
    expect(rule.caveat).toMatch(/HAS NOT BEEN READ HERE/);
  });

  it("the TY pack cites the LOCATED counterpart, and every citation is checkable", () => {
    // **THIS ASSERTION IS A 1:1 REPLACEMENT OF ITS `K4-19` PREDECESSOR AND IS
    // RECORDED AS ONE** (`PROJECT_CONSTITUTION.md` §4). That one asserted the TY
    // rule "cites nothing, and does not guess a 2025-Act section", and it was
    // right for as long as it stood: the counterpart had not been identified,
    // and `D298` found three invented citations in the assessment that
    // authorised this port, so the number was WITHHELD rather than inferred.
    //
    // `K4-24` did not relax that standard, it MET it. The owner named the
    // mapping in his decisions, and it was then read off artifacts this
    // repository already holds — s.157 on page 194 of `K4-PORT-00-S2`, rule 73
    // on pages 123-127 of `K4-PORT-02-S2` — both committed as three-mode
    // extracts. The property guarded here is therefore the STRONGER one: not
    // "cites nothing", but "cites exactly the two located provisions, and the
    // quotation is checked against a committed extract".
    const rule = findRuleProvenance(TY_2026_27_PACK_PROVENANCE, RULE_ID);
    expect(rule, `${RULE_ID} must exist in the TY pack too (set equality)`).toBeDefined();
    expect(rule!.sources.map((src) => src.id)).toEqual(["ITA_2025_S157", "ITR_2026_R73"]);
    // Every quoted span is a CHECKED one. Nothing was parked as unverifiable to
    // get the citation in, which would have been the cheap version of this.
    expect(rule!.unverifiableQuotes).toEqual([]);
    expect(rule!.verbatimQuotes.map((q) => q.artifactId)).toEqual(["K4-PORT-00-S2"]);
    expect(quotedSpansInCaveat(rule!.caveat ?? "").length).toBe(1);
    // The D298 guard is KEPT and re-aimed rather than dropped. A 2025-Act
    // section number may now appear in this caveat, but only the three the
    // located text actually names — s.157 itself, s.18(1) and s.19(1). Any
    // other is an invention of exactly the kind `D298` caught.
    const cited = [...(rule!.caveat ?? "").matchAll(/\bs\.\s?(\d+)/g)].map((m) => m[1]);
    expect([...new Set(cited)].sort()).toEqual(["157", "18", "19"]);
  });

  it("the TY caveat states what citing the counterpart does NOT establish", () => {
    // The risk this guards is no longer a missing citation; it is a citation
    // being read as more than it is. Locating a counterpart does not decide that
    // the two worlds' relief mechanics are equivalent, and it gives this world
    // no computation surface.
    const caveat = findRuleProvenance(TY_2026_27_PACK_PROVENANCE, RULE_ID)!.caveat ?? "";
    expect(caveat).toMatch(/NO EQUIVALENCE IS DECIDED/);
    expect(caveat).toMatch(/TAX QUESTION/i);
    // **THE TWO SOURCES HAVE DIFFERENT RANKS AND THE CAVEAT MUST SAY SO
    // SEPARATELY.** This assertion is a 1:1 §4 replacement of one that required
    // `BOTH RANK 2`, which was **wrong** and was rendered to preparers: the
    // manifest registers `K4-PORT-00-S2` (ITD's publication of the Act AS
    // ENACTED) at **rank 1**, and its own extract header prints `Source rank :
    // 1`. Only ICAI's reproduction of the Rules is rank 2. Caught by review on
    // PR #130 — after that PR had merged — and verified against the manifest
    // before being accepted. The error was over-generalising from
    // `K4-PORT-04-S2` and `K4-SOURCE-07-ACT-1961`, which ARE rank-2
    // consolidations with editorial brackets; this artifact is not one.
    //
    // Pinned in both directions, because the failure mode is a caveat asserting
    // an evidence classification that contradicts the repository's own manifest.
    expect(caveat).toMatch(/RANK 1 \(K4-PORT-00-S2\)/);
    expect(caveat).toMatch(/RANK 2 \(K4-PORT-02-S2\)/);
    expect(caveat).not.toMatch(/BOTH RANK 2/);

    // **AND EVERY OTHER RANK CLAIM IN THE CAVEAT IS PINNED, NOT JUST THE TWO
    // ARTIFACT LABELS.** The review that caught the `BOTH RANK 2` error also
    // said, correctly, that a label-only check would not catch a wrong rank
    // claim in the surrounding PROSE — and the very next draft proved it by
    // writing "the rule wants **rank-1** corroboration against the notifying
    // Gazette", which is false: `official-source-retrieval.md` §5 puts rules
    // and notifications at **rank 2**, and the manifest's own `sourceRankNote`
    // says an official Gazette publisher does NOT promote a notification to
    // rank 1. A rule cannot be corroborated up to rank 1 by anyone.
    //
    // So the whole multiset of rank digits is asserted. Order matters and is
    // part of the claim: rank 1 for the Act artifact, rank 2 for the Rules
    // artifact, rank 2 twice more for "a rule is rank 2 by its nature" and
    // "even when the publisher is the official Gazette", and a final 1 only in
    // the denial that corroboration can reach it.
    const rankClaims = [...caveat.matchAll(/rank[- ]?(\d)/gi)].map((m) => m[1]);
    expect(rankClaims).toEqual(["1", "2", "2", "2", "1"]);
    // The specific false phrasing, named so that reintroducing it fails loudly
    // rather than merely moving a count.
    expect(caveat).not.toMatch(/rank-1 corroboration/i);
    // Form 39's layout is NOT held, so D17 binds exactly as it did for Form 10E
    // before K4-SOURCE-07 inspected that specimen.
    expect(caveat).toMatch(/FORM No\. 39 ITSELF IS NOT HELD/);
    expect(caveat).toMatch(/D17/);
  });

  it("the salary/pension capability row no longer claims to be fully supported", () => {
    const row = findTaxCapability(TAX_CAPABILITY_MATRIX, "income_salary_pension")!;
    expect(row.state).toBe("partially_supported");
    expect(ruleAuthorityFor(row, "ITA_1961")).toContain(RULE_ID);
    expect(ruleAuthorityFor(row, "ITA_2025")).toContain(RULE_ID);
    expect(row.relatedEligibilityBlockerCode).toBe(SITUATION);
    // The reason must name the exclusion AND the residual. A row that named the
    // gap but implied it was fully controlled would be the same overstatement in
    // a new place.
    expect(row.reason).toMatch(/Section 89\(1\)/);
    expect(row.reason).toMatch(/does NOT declare it/);
  });

  it("the row keeps all four booleans true, and that is deliberate rather than an oversight", () => {
    // Shape B (blocking approval/finalization/output) would block EVERY salaried
    // case on a relief that applies to a minority of them. The declared case is
    // held back by the eligibility gate instead. If a future session wants this
    // stronger, that is a decision, not a tidy-up — hence an assertion.
    const row = findTaxCapability(TAX_CAPABILITY_MATRIX, "income_salary_pension")!;
    expect(row.computationAllowed).toBe(true);
    expect(row.clientApprovalAllowed).toBe(true);
    expect(row.finalizationAllowed).toBe(true);
    expect(row.canonicalOutputAllowed).toBe(true);
  });

  it("the declaration is a real special-situation code a preparer can select", () => {
    expect(isSpecialSituationCode(SITUATION)).toBe(true);
    const entry = SPECIAL_SITUATIONS.find((s) => s.code === SITUATION);
    expect(entry, "the situation must be selectable, not merely type-valid").toBeDefined();
    // The label is what a preparer actually reads, so it must name Form 10E —
    // the artifact they have to produce — not only the section number.
    expect(entry!.label).toMatch(/arrears/i);
    expect(entry!.label).toMatch(/10E/);
  });

  it("states the relief is NOT computed, in every place that mentions it", () => {
    // WRITTEN AS A POSITIVE, AFTER A NEGATIVE VERSION FAILED ON ITS OWN DENIAL.
    // The first draft scanned for /relief is (computed|applied|available)/i and
    // tripped on the AY caveat's opening words, "NO RELIEF IS COMPUTED" — the
    // exact hazard `pack-traceability.tsx` already documents for the "is
    // CA-verified" scan, where a DENIAL containing the substring trips a guard
    // meant to catch the claim. A substring cannot tell an assertion from its
    // negation, so this asserts the negation is PRESENT instead, which is both
    // robust and the property actually wanted.
    const row = findTaxCapability(TAX_CAPABILITY_MATRIX, "income_salary_pension")!;
    const ayCaveat = findRuleProvenance(AY_2026_27_PACK_PROVENANCE, RULE_ID)!.caveat ?? "";
    const tyCaveat = findRuleProvenance(TY_2026_27_PACK_PROVENANCE, RULE_ID)!.caveat ?? "";
    expect(row.reason).toMatch(/is NOT computed/);
    expect(ayCaveat).toMatch(/NO RELIEF IS COMPUTED/);
    // K4-24: a 1:1 §4 replacement. This matched "not computed in EITHER
    // statutory world" — a sentence the caveat lost when the counterpart was
    // located and the caveat rewritten. The PROPERTY is unchanged and is now
    // asserted against the sentence that carries it, plus the absence of the
    // superseded claim, so the two cannot both be live.
    expect(tyCaveat).toMatch(/NO RELIEF IS COMPUTED/);
    expect(tyCaveat).not.toMatch(/HAS NOT BEEN IDENTIFIED/);
  });
});
