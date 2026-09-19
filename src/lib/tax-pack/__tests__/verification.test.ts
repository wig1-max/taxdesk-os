/**
 * K3-13 — CA-VERIFICATION evidence, verification-state reader, and the
 * consumable reliance blocker.
 *
 * Proves: (1) verification is an auditable per-rule evidence set, not a boolean;
 * (2) nothing fabricates a verifier, an uncited rule can never be verified, and a
 * documented caveat can never be rubber-stamped; (3) verification state is
 * derivable through ONE canonical reader; (4) the reliance refusal is consumable
 * as a truthful blocker; and (5) the shipped registry still holds exactly one
 * truthfully-`draft` pack — no pack is `ca_verified`.
 */

import { describe, expect, it } from "vitest";
import {
  AY_2026_27_PACK,
  AY_2026_27_PACK_IDENTITY,
  assessTaxPackVerification,
  createDefaultTaxPackRegistry,
  createTaxPackRegistry,
  defaultTaxPackRelianceBlocker,
  describeTaxPackVerification,
  isRelianceReady,
  makeOfficialSourceReference,
  makeRuleProvenance,
  makeRuleVerificationRecord,
  makeTaxPack,
  makeTaxPackIdentity,
  makeTaxPackProvenance,
  taxPackRelianceBlocker,
  verifyTaxPackWithEvidence,
  TAX_PACK_BLOCKER_CODES,
} from "@/lib/tax-pack";

// --- a synthetic, test-only pack (never registered in the default registry) ---

const SRC_A = makeOfficialSourceReference({
  id: "SRC_A",
  kind: "act_section",
  authority: "Parliament",
  citation: "Section A, Synthetic Act",
});
const SRC_B = makeOfficialSourceReference({
  id: "SRC_B",
  kind: "circular",
  authority: "CBDT",
  citation: "Synthetic Circular B",
});

const PLAIN_RULE = makeRuleProvenance({ ruleId: "plain", summary: "plain rule", sources: [SRC_A] });
const TWO_SOURCE_RULE = makeRuleProvenance({
  ruleId: "two_source",
  summary: "rule with two sources",
  sources: [SRC_A, SRC_B],
});
const CAVEAT_RULE = makeRuleProvenance({
  ruleId: "caveated",
  summary: "rule with a documented placeholder",
  sources: [SRC_A],
  caveat: "TODO(CA-verify): placeholder value",
});
const UNCITED_RULE = makeRuleProvenance({ ruleId: "uncited", summary: "rule citing nothing" });

const VERIFIER = { verifiedBy: "CA Synthetic (ICAI 000000)", verifiedAt: "2026-07-19T00:00:00.000Z" };

function record(ruleId: string, sourceIds: string[], caveatResolved = false) {
  return makeRuleVerificationRecord({ ruleId, sourceIds, caveatResolved, ...VERIFIER });
}

function syntheticIdentity(status: "draft" | "ca_verified" = "draft") {
  return makeTaxPackIdentity({
    jurisdiction: "IN",
    law: "ITA_1961",
    periodKind: "assessment_year",
    period: "2099-00",
    computationRulesVersion: "SYNTHETIC_V1",
    validationRulesVersion: "SYNTHETIC_V1",
    status,
    effectiveFrom: "2098-04-01",
    ...(status === "ca_verified" ? VERIFIER : {}),
  });
}

// --- records ---------------------------------------------------------------

describe("makeRuleVerificationRecord", () => {
  it("requires a verifier, a timestamp and at least one cited source", () => {
    expect(() => record("plain", [])).toThrow(/at least one official source/);
    expect(() =>
      makeRuleVerificationRecord({ ruleId: "plain", sourceIds: ["SRC_A"], verifiedBy: " ", verifiedAt: "t" }),
    ).toThrow(/verifiedBy/);
    expect(() =>
      makeRuleVerificationRecord({ ruleId: "plain", sourceIds: ["SRC_A"], verifiedBy: "x", verifiedAt: "" }),
    ).toThrow(/verifiedAt/);
    expect(() => record("plain", ["SRC_A", "SRC_A"])).toThrow(/more than once/);
  });

  it("freezes the record and defaults caveatResolved to false", () => {
    const r = record("plain", ["SRC_A"]);
    expect(Object.isFrozen(r)).toBe(true);
    expect(r.caveatResolved).toBe(false);
  });
});

// --- assessment ------------------------------------------------------------

describe("assessTaxPackVerification", () => {
  it("reports a fully evidenced pack as complete", () => {
    const provenance = makeTaxPackProvenance([PLAIN_RULE, TWO_SOURCE_RULE]);
    const assessment = assessTaxPackVerification(provenance, [
      record("plain", ["SRC_A"]),
      record("two_source", ["SRC_A", "SRC_B"]),
    ]);
    expect(assessment.evidenceComplete).toBe(true);
    expect(assessment.verifiedCount).toBe(2);
    expect(assessment.unverifiedRuleIds).toEqual([]);
    expect(assessment.gaps).toEqual([]);
    expect(assessment.rules[0]).toMatchObject({ state: "verified", verifiedBy: VERIFIER.verifiedBy });
  });

  it("is never complete for a pack that declares no provenance", () => {
    expect(assessTaxPackVerification(undefined).evidenceComplete).toBe(false);
    expect(assessTaxPackVerification(makeTaxPackProvenance([])).ruleCount).toBe(0);
  });

  it("names the specific reason each rule is unverified", () => {
    const provenance = makeTaxPackProvenance([PLAIN_RULE, TWO_SOURCE_RULE, CAVEAT_RULE, UNCITED_RULE]);
    const assessment = assessTaxPackVerification(provenance, [
      // plain: no record at all
      record("two_source", ["SRC_A"]), // declared source not checked
      record("caveated", ["SRC_A"]), // caveat not resolved
    ]);
    expect(assessment.evidenceComplete).toBe(false);
    expect(assessment.unverifiedRuleIds).toEqual(["plain", "two_source", "caveated", "uncited"]);
    expect(assessment.gaps).toEqual([
      "plain: No CA verification record",
      "two_source: Declared source(s) not checked: SRC_B",
      "caveated: Unresolved caveat: TODO(CA-verify): placeholder value",
      "uncited: No official source is cited for this rule",
    ]);
  });

  it("refuses a record citing a source the rule does not declare", () => {
    const assessment = assessTaxPackVerification(makeTaxPackProvenance([PLAIN_RULE]), [
      record("plain", ["SRC_B"]),
    ]);
    expect(assessment.gaps).toEqual(["plain: Verification cites source(s) this rule does not declare: SRC_B"]);
  });

  it("refuses conflicting records for the same rule", () => {
    const assessment = assessTaxPackVerification(makeTaxPackProvenance([PLAIN_RULE]), [
      record("plain", ["SRC_A"]),
      record("plain", ["SRC_A"]),
    ]);
    expect(assessment.gaps).toEqual(["plain: 2 conflicting verification records exist for this rule"]);
  });

  it("verifies a caveated rule only when the caveat is explicitly resolved", () => {
    const provenance = makeTaxPackProvenance([CAVEAT_RULE]);
    expect(assessTaxPackVerification(provenance, [record("caveated", ["SRC_A"], true)]).evidenceComplete).toBe(
      true,
    );
  });

  it("is deterministic", () => {
    const provenance = makeTaxPackProvenance([PLAIN_RULE, UNCITED_RULE]);
    const a = assessTaxPackVerification(provenance, [record("plain", ["SRC_A"])]);
    const b = assessTaxPackVerification(provenance, [record("plain", ["SRC_A"])]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// --- evidence-backed lifecycle transition ----------------------------------

describe("verifyTaxPackWithEvidence", () => {
  it("refuses a pack with no provenance", () => {
    const result = verifyTaxPackWithEvidence(syntheticIdentity(), {
      provenance: undefined,
      records: [],
      ...VERIFIER,
    });
    expect(result).toEqual({ ok: false, reason: "Cannot verify a pack that declares no official-source provenance" });
  });

  it("refuses while any rule lacks evidence, naming what is missing", () => {
    const result = verifyTaxPackWithEvidence(syntheticIdentity(), {
      provenance: makeTaxPackProvenance([PLAIN_RULE, UNCITED_RULE]),
      records: [record("plain", ["SRC_A"])],
      ...VERIFIER,
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("1 of 2 rules lack verification evidence");
    expect(result.ok === false && result.reason).toContain("No official source is cited");
  });

  it("verifies on complete evidence, preserving coordinates and recording the verifier", () => {
    const identity = syntheticIdentity();
    const result = verifyTaxPackWithEvidence(identity, {
      provenance: makeTaxPackProvenance([PLAIN_RULE, CAVEAT_RULE]),
      records: [record("plain", ["SRC_A"]), record("caveated", ["SRC_A"], true)],
      ...VERIFIER,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.identity.status).toBe("ca_verified");
    expect(result.identity.verifiedBy).toBe(VERIFIER.verifiedBy);
    expect(result.identity.verifiedAt).toBe(VERIFIER.verifiedAt);
    expect(result.identity.computationRulesVersion).toBe(identity.computationRulesVersion);
    // The input identity is untouched — transitions never mutate in place.
    expect(identity.status).toBe("draft");
    expect(isRelianceReady(result.identity)).toBe(true);
  });

  it("still refuses a non-draft pack (the lifecycle rule is not bypassed)", () => {
    const result = verifyTaxPackWithEvidence(syntheticIdentity("ca_verified"), {
      provenance: makeTaxPackProvenance([PLAIN_RULE]),
      records: [record("plain", ["SRC_A"])],
      ...VERIFIER,
    });
    expect(result).toEqual({ ok: false, reason: "Cannot verify a ca_verified pack" });
  });
});

// --- the canonical verification-state reader --------------------------------

describe("describeTaxPackVerification", () => {
  it("reports the shipped AY pack as NOT verified, truthfully and specifically", () => {
    const state = describeTaxPackVerification(AY_2026_27_PACK);
    expect(state.verified).toBe(false);
    expect(state.status).toBe("draft");
    expect(state.verifiedBy).toBeNull();
    expect(state.verifiedAt).toBeNull();
    expect(state.key).toBe("IN:ITA_1961:assessment_year:2026-27:AY_2026_27_V5_PREP_ONLY");
    expect(state.assessment.verifiedCount).toBe(0);
    expect(state.assessment.ruleCount).toBe(26);
    expect(state.assessment.gaps.some((gap) => gap.includes("No official source is cited"))).toBe(false);
    expect(state.unverifiedRuleIds).toEqual(AY_2026_27_PACK_PROVENANCE_RULE_IDS);
    expect(state.gaps[0]).toBe("Pack lifecycle status is draft, not ca_verified");
    expect(state.summary).toBe(
      // K4-11: 20 -> 22 rules (surcharge_rates, surcharge_marginal_relief).
      // K4-14: 23 -> 24 (business_books_computation).
      // K4-19: 24 -> 25 (section_89_arrears_relief).
      // The VERIFIED count stays 0 — adding a rule never verifies one.
      "Tax pack AY_2026_27_V5_PREP_ONLY is draft — not CA-verified (0 of 26 rules carry verification evidence)",
    );
    // Never overstates.
    expect(state.summary).not.toMatch(/ready|current|approved|verified by/i);
  });

  it("cannot read as verified on a status flag alone — the evidence must exist too", () => {
    // A pack whose status says ca_verified but whose rules carry no evidence.
    const pack = makeTaxPack(syntheticIdentity("ca_verified"), undefined, makeTaxPackProvenance([PLAIN_RULE]));
    const state = describeTaxPackVerification(pack);
    expect(state.status).toBe("ca_verified");
    expect(state.verified).toBe(false);
    expect(state.gaps).toEqual(["plain: No CA verification record"]);
  });

  it("reads as verified only with both the status and the complete evidence", () => {
    const pack = makeTaxPack(syntheticIdentity("ca_verified"), undefined, makeTaxPackProvenance([PLAIN_RULE]));
    const state = describeTaxPackVerification(pack, [record("plain", ["SRC_A"])]);
    expect(state.verified).toBe(true);
    expect(state.gaps).toEqual([]);
    expect(state.summary).toContain("is CA-verified by CA Synthetic");
  });
});

const AY_2026_27_PACK_PROVENANCE_RULE_IDS = [
  "slab_rates",
  "standard_deduction",
  "rebate_87a",
  // K4-12: section 87A rebate-threshold marginal relief, declared immediately
  // after `rebate_87a`. Unverified like every other rule in this pack — no
  // pack is `ca_verified`.
  "rebate_87a_marginal_relief",
  "capital_gains_stcg_111a",
  "capital_gains_ltcg_112a",
  "capital_gains_house_sale",
  "cess_rate",
  "chapter_via_deduction_caps",
  "itr1_income_ceiling",
  // TAX-SAFE-01: a safety (reliance-blocking) threshold, not a computation
  // rule — see ay-2026-27-provenance.ts and src/lib/tax-desk/tax-capability.ts.
  "surcharge_marginal_relief_safety_threshold",
  // K4-11: the surcharge COMPUTATION rule and the marginal-relief rule —
  // deliberately SEPARATE from the safety threshold above, which stays a
  // blocking-only entry threshold. Both are real computed rules within the
  // ₹50,00,000–₹2,00,00,000 window; above it no surcharge is computed at all.
  "surcharge_rates",
  "surcharge_marginal_relief",
  // K4-01: an age-band FACT-derivation rule (classification only), not a
  // computed slab/cap/rate — see ay-2026-27-provenance.ts and
  // src/lib/tax-desk/senior-treatment.ts.
  "senior_super_senior_age_definition",
  // K4-02: the OLD-regime basic-exemption widening itself (a real computed
  // slab rule) — see ay-2026-27-provenance.ts and slabs.ts.
  "senior_super_senior_basic_exemption_widening",
  // K4-03: the Section 80D senior-citizen cap (taxpayer's own age band only)
  // and the Section 80TTA/80TTB mutual-exclusivity cap correction — see
  // ay-2026-27-provenance.ts and rules.ts's deductionCapForSection.
  "senior_80d_deduction_cap",
  // K4-05: the Section 80D "insured party" (parent-premium) sub-case — an
  // independent cap driven by the PARENT's own senior status — see
  // ay-2026-27-provenance.ts and rules.ts's deductionCapForSection.
  "senior_80d_parents_deduction_cap",
  "senior_80tta_80ttb_mutual_exclusivity",
  // K4-04: Section 207(2) advance-tax exemption — validation-only, not a
  // computed slab/cap/rate — see ay-2026-27-provenance.ts and validate-case.ts.
  "senior_citizen_advance_tax_exemption_207_2",
  // K4-06: house property (Sections 22-27, 71(3A)/115BAC) — a real computed
  // rule (single property per case) — see ay-2026-27-provenance.ts and
  // compute-tax.ts's computeHouseProperty.
  "house_property_computation",
  // K4-07: presumptive professional income (Section 44ADA) — a real
  // computed rule (deemed profit) — see ay-2026-27-provenance.ts and
  // compute-tax.ts's deriveIncome.
  "presumptive_44ada_computation",
  // K4-08: presumptive business income (Section 44AD) — a real computed
  // rule (dual-rate deemed profit: 6% digital turnover + 8% cash turnover)
  // — see ay-2026-27-provenance.ts and compute-tax.ts's deriveIncome.
  "presumptive_44ad_computation",
  // K4-14: books-based business/profession income (Sections 28/29), declared
  // immediately after the presumptive rules. Unverified like every other rule
  // in this pack — no pack is `ca_verified`.
  "business_books_computation",
  // K4-09: within-year capital-loss set-off (Sections 70/71(3)/74) — a real
  // computed rule; it changes the net 111A/112A figures the special-rate tax
  // is charged on. Carry-forward across years remains unimplemented.
  "capital_loss_within_year_set_off",
  // K4-10: brought-forward set-off across assessment years (Section 74). The
  // rule declares NO mandatory allocation sequence — the sequence lives in a
  // named, versioned policy (`loss-allocation-policy.ts`), not in the pack.
  "capital_loss_brought_forward_set_off",
  // K4-19: a GAP rule — Section 89(1) arrears relief is NOT computed at all.
  // It is unverified like every other rule here, and adding it moves the
  // denominator below without moving the verified numerator, which is exactly
  // what a newly declared unimplemented provision should do.
  "section_89_arrears_relief",
];

// --- consumable reliance blocker -------------------------------------------

describe("taxPackRelianceBlocker", () => {
  it("blocks the shipped AY case with the unverified code and the specific gaps", () => {
    const blocker = defaultTaxPackRelianceBlocker({ assessmentYear: "2026-27" });
    expect(blocker).not.toBeNull();
    expect(blocker?.code).toBe(TAX_PACK_BLOCKER_CODES.unverified);
    expect(blocker?.message).toBe(
      "The versioned tax pack governing this case is not CA-verified against official sources",
    );
    expect(blocker?.details[0]).toBe("Pack lifecycle status is draft, not ca_verified");
    expect(blocker?.details.some((detail) => detail.includes("No official source is cited"))).toBe(false);
    expect(blocker?.details).toContain("standard_deduction: No CA verification record");
  });

  it("blocks an unsupported statutory period", () => {
    const blocker = defaultTaxPackRelianceBlocker({ assessmentYear: "2099-00" });
    expect(blocker?.code).toBe(TAX_PACK_BLOCKER_CODES.unsupported);
    expect(blocker?.details[0]).toContain("No tax pack supports");
  });

  it("blocks an ambiguous registration", () => {
    const registry = createTaxPackRegistry();
    registry.register(makeTaxPack(syntheticIdentity()));
    registry.register(
      makeTaxPack(
        makeTaxPackIdentity({
          ...syntheticIdentity(),
          computationRulesVersion: "SYNTHETIC_V2",
          sourceSchemaVersions: {},
          outputSchemaVersions: {},
        }),
      ),
    );
    const blocker = taxPackRelianceBlocker(registry, { assessmentYear: "2099-00" });
    expect(blocker?.code).toBe(TAX_PACK_BLOCKER_CODES.ambiguous);
  });

  it("returns null only for a ca_verified pack", () => {
    const registry = createTaxPackRegistry();
    registry.register(makeTaxPack(syntheticIdentity("ca_verified")));
    expect(taxPackRelianceBlocker(registry, { assessmentYear: "2099-00" })).toBeNull();
  });
});

// --- the shipped registry is unchanged --------------------------------------

describe("the shipped registry after K3-13", () => {
  // K3-15 replaced the "exactly one pack" count (decision D18) — the registry
  // now also holds the TY 2026-27 identity-only stub. The invariant this test
  // actually guards is unchanged and now covers BOTH packs: every shipped pack
  // is truthfully draft with no verification fabricated.
  it("holds historical/current AY plus the TY world, all truthfully draft", () => {
    const packs = createDefaultTaxPackRegistry().list();
    expect(packs).toHaveLength(3);
    expect(packs[1]?.identity).toBe(AY_2026_27_PACK_IDENTITY);
    for (const pack of packs) {
      expect(pack.identity.status).toBe("draft");
      expect(pack.identity.verifiedBy).toBeNull();
      expect(pack.identity.verifiedAt).toBeNull();
      expect(isRelianceReady(pack.identity)).toBe(false);
    }
  });
});
