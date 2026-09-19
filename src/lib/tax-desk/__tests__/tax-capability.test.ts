import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  evaluateHouseSaleLtcgRisk,
  snapshotHasHouseSaleLtcg,
  citedPackRuleIds,
  detectSurchargeMarginalReliefRisk,
  evaluateSurchargeMarginalReliefRisk,
  evaluateTaxCapability,
  findTaxCapability,
  isPackRuleAuthorityList,
  ruleAuthorityFor,
  RULE_AUTHORITY_LAWS,
  SURCHARGE_MARGINAL_RELIEF_BLOCKER_CODE,
  SURCHARGE_MARGINAL_RELIEF_RISK_THRESHOLD_INR,
  SURCHARGE_THRESHOLD_PROVENANCE,
  TAX_CAPABILITY_MATRIX,
  TAX_CAPABILITY_RULES_VERSION,
  totalIncomeForSurchargeApplicability,
} from "@/lib/tax-desk/tax-capability";
import { TAX_LAWS } from "@/lib/tax-pack/identity";
import { AY_2026_27_PACK_PROVENANCE } from "@/lib/tax-pack/packs/ay-2026-27-provenance";
import { TY_2026_27_PACK_PROVENANCE } from "@/lib/tax-pack/packs/ty-2026-27-provenance";

describe("sourced threshold", () => {
  it("is exactly Rs 50,00,000 (50 lakh)", () => {
    expect(SURCHARGE_MARGINAL_RELIEF_RISK_THRESHOLD_INR).toBe(5000000);
  });

  it("is checked against the pack's own provenance, not a disconnected literal", () => {
    expect(SURCHARGE_THRESHOLD_PROVENANCE.ruleId).toBe("surcharge_marginal_relief_safety_threshold");
    const inPack = AY_2026_27_PACK_PROVENANCE.rules.find(
      (r) => r.ruleId === "surcharge_marginal_relief_safety_threshold",
    );
    expect(inPack).toBeDefined();
    expect(inPack).toBe(SURCHARGE_THRESHOLD_PROVENANCE);
  });

  it("cites at least one official source and carries an unresolved CA-verify caveat (still draft)", () => {
    expect(SURCHARGE_THRESHOLD_PROVENANCE.sources.length).toBeGreaterThan(0);
    expect(SURCHARGE_THRESHOLD_PROVENANCE.caveat).toBeTruthy();
    expect(SURCHARGE_THRESHOLD_PROVENANCE.caveat).toMatch(/CA-verify/);
  });
});

describe("detectSurchargeMarginalReliefRisk", () => {
  it("is false for null / undefined (nothing computed yet)", () => {
    expect(detectSurchargeMarginalReliefRisk(null)).toBe(false);
    expect(detectSurchargeMarginalReliefRisk(undefined)).toBe(false);
  });

  it("is false for a case well below the threshold", () => {
    expect(detectSurchargeMarginalReliefRisk(800000)).toBe(false);
  });

  it("is false exactly one rupee below the threshold (boundary)", () => {
    expect(detectSurchargeMarginalReliefRisk(SURCHARGE_MARGINAL_RELIEF_RISK_THRESHOLD_INR - 1)).toBe(false);
  });

  it("is false exactly AT the threshold — ₹50,00,000 attracts nil surcharge (TAX-SAFE-01A: strict >, not >=)", () => {
    expect(detectSurchargeMarginalReliefRisk(SURCHARGE_MARGINAL_RELIEF_RISK_THRESHOLD_INR)).toBe(false);
    expect(detectSurchargeMarginalReliefRisk(4999999)).toBe(false);
    expect(detectSurchargeMarginalReliefRisk(5000000)).toBe(false);
  });

  it("is true one rupee above the threshold", () => {
    expect(detectSurchargeMarginalReliefRisk(SURCHARGE_MARGINAL_RELIEF_RISK_THRESHOLD_INR + 1)).toBe(true);
    expect(detectSurchargeMarginalReliefRisk(5000001)).toBe(true);
  });

  it("is true well above the threshold", () => {
    expect(detectSurchargeMarginalReliefRisk(20000000)).toBe(true);
  });

  it("is false for non-finite input (defensive)", () => {
    expect(detectSurchargeMarginalReliefRisk(Number.NaN)).toBe(false);
    expect(detectSurchargeMarginalReliefRisk(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("evaluateSurchargeMarginalReliefRisk", () => {
  // K4-11 made the engine-verdict argument REQUIRED rather than optional, so
  // that a future enforcement layer cannot silently omit it. Below the
  // threshold the verdict is irrelevant, so `undefined` (the fail-closed value)
  // is passed to prove the income test alone decides these.
  it("returns null below the threshold", () => {
    expect(evaluateSurchargeMarginalReliefRisk(4999999, undefined)).toBeNull();
  });

  it("returns null EXACTLY at the threshold — ₹50,00,000 is not blocked (TAX-SAFE-01A)", () => {
    expect(evaluateSurchargeMarginalReliefRisk(5000000, undefined)).toBeNull();
    expect(evaluateSurchargeMarginalReliefRisk(5000000, false)).toBeNull();
    expect(
      evaluateSurchargeMarginalReliefRisk(SURCHARGE_MARGINAL_RELIEF_RISK_THRESHOLD_INR, undefined),
    ).toBeNull();
  });

  it("returns a stable blocker with safe structured detail strictly above the threshold, when the engine could not treat it", () => {
    const blocker = evaluateSurchargeMarginalReliefRisk(5000001, false);
    expect(blocker).not.toBeNull();
    expect(blocker!.code).toBe(SURCHARGE_MARGINAL_RELIEF_BLOCKER_CODE);
    expect(blocker!.code).toBe("SURCHARGE_MARGINAL_RELIEF_UNSUPPORTED");
    expect(blocker!.totalIncome).toBe(5000001);
    expect(blocker!.thresholdInr).toBe(SURCHARGE_MARGINAL_RELIEF_RISK_THRESHOLD_INR);
  });

  // K4-11 — the narrowing itself, and its fail-closed edges. The blocker code
  // is deliberately UNCHANGED (it is a public contract: server actions, guarded
  // RPCs, E2E assertions, the capability matrix doc); only when it fires moved.
  it("is NARROWED by the engine's own verdict, and only by that", () => {
    // Same income, three verdicts, three outcomes.
    expect(evaluateSurchargeMarginalReliefRisk(60_00_000, true)).toBeNull();
    expect(evaluateSurchargeMarginalReliefRisk(60_00_000, false)).not.toBeNull();
    expect(evaluateSurchargeMarginalReliefRisk(60_00_000, undefined)).not.toBeNull();
    expect(evaluateSurchargeMarginalReliefRisk(60_00_000, null)).not.toBeNull();
  });

  it("only a literal `true` releases a case — no truthy coercion", () => {
    // A snapshot's stored JSON is `unknown` at the boundary; a stray truthy
    // value (a non-empty string, a 1) must NOT release a blocked case.
    for (const truthy of ["true", 1, {}, [1]] as unknown[]) {
      expect(
        evaluateSurchargeMarginalReliefRisk(60_00_000, truthy as boolean),
        `${JSON.stringify(truthy)} must not release the blocker`,
      ).not.toBeNull();
    }
  });

  it("never computes a surcharge or marginal-relief AMOUNT — only a boolean-shaped blocker", () => {
    const blocker = evaluateSurchargeMarginalReliefRisk(100000000, false);
    expect(blocker).not.toHaveProperty("surchargeAmount");
    expect(blocker).not.toHaveProperty("marginalRelief");
    expect(Object.keys(blocker!).sort()).toEqual(["code", "message", "thresholdInr", "totalIncome"]);
  });
});

describe("totalIncomeForSurchargeApplicability — the conservative higher-of-both-regimes base", () => {
  it("returns the higher of old/new when both are known", () => {
    expect(totalIncomeForSurchargeApplicability(4000000, 5200000)).toBe(5200000);
    expect(totalIncomeForSurchargeApplicability(5200000, 4000000)).toBe(5200000);
  });

  it("falls back to whichever regime figure is known when the other is missing", () => {
    expect(totalIncomeForSurchargeApplicability(5200000, null)).toBe(5200000);
    expect(totalIncomeForSurchargeApplicability(null, 5200000)).toBe(5200000);
    expect(totalIncomeForSurchargeApplicability(undefined, 5200000)).toBe(5200000);
  });

  it("returns null when neither regime figure is known — never a fabricated 0", () => {
    expect(totalIncomeForSurchargeApplicability(null, null)).toBeNull();
    expect(totalIncomeForSurchargeApplicability(undefined, undefined)).toBeNull();
  });

  it("ignores non-finite input defensively", () => {
    expect(totalIncomeForSurchargeApplicability(Number.NaN, 5200000)).toBe(5200000);
    expect(totalIncomeForSurchargeApplicability(Number.NaN, Number.NaN)).toBeNull();
  });

  it("this is exactly the base evaluateSurchargeMarginalReliefRisk must be fed — proves a case whose NON-recommended regime crosses the threshold is not missed", () => {
    // Old regime (larger deductions) recommended at a LOWER total income;
    // new regime's total income (fewer deductions) is the one that actually
    // crosses the risk threshold. Feeding only the recommended (old) figure
    // would wrongly pass this case through undetected.
    const recommendedRegimeOnly = 4800000; // old regime total income (recommended)
    const nonRecommendedRegime = 5000001; // new regime total income (not recommended)
    expect(evaluateSurchargeMarginalReliefRisk(recommendedRegimeOnly, false)).toBeNull(); // WRONG base — would miss it
    const correctBase = totalIncomeForSurchargeApplicability(recommendedRegimeOnly, nonRecommendedRegime);
    expect(correctBase).toBe(nonRecommendedRegime);
    expect(evaluateSurchargeMarginalReliefRisk(correctBase, false)).not.toBeNull(); // correct base catches it
  });
});

describe("canonical capability matrix — static rows", () => {
  it("declares every required area exactly once", () => {
    const areas = TAX_CAPABILITY_MATRIX.map((e) => e.area);
    expect(new Set(areas).size).toBe(areas.length);
    for (const required of [
      "income_salary_pension",
      "income_other_sources",
      "capital_gains_111a_112a",
      "capital_gains_house_sale",
      "house_property",
      "business_professional_income",
      "presumptive_44ad",
      "presumptive_44ada",
      "loss_set_off_carry_forward",
      "fno",
      "vda",
      "senior_citizen_treatment",
      "surcharge",
      "marginal_relief",
      "foreign_assets",
      "tax_audit",
    ]) {
      expect(areas).toContain(required);
    }
  });

  it("no row is falsely labelled ca_verified (every row is draft_not_ca_verified)", () => {
    for (const e of TAX_CAPABILITY_MATRIX) {
      expect(e.lifecycleStatus).toBe("draft_not_ca_verified");
    }
  });

  it("no unsupported row claims computation/approval/finalization/output allowed", () => {
    for (const e of TAX_CAPABILITY_MATRIX) {
      if (e.state === "unsupported") {
        expect(e.clientApprovalAllowed).toBe(false);
        expect(e.finalizationAllowed).toBe(false);
        expect(e.canonicalOutputAllowed).toBe(false);
      }
    }
  });

  // AUDIT-03-F4 / D88. The doc's `partially_supported` definition contradicted
  // two of its own three rows in that state, and D76's prose-only maintenance
  // obligation had by then been missed by two consecutive sessions. A guard
  // beats a stronger promise: every partially_supported row must match one of
  // exactly TWO documented boolean shapes, so a third, undescribed shape
  // cannot be introduced without failing here and forcing
  // the tax-capability-matrix design notes to be updated with it.
  it("every partially_supported row matches one of the two documented shapes (AUDIT-03-F4)", () => {
    // Shape A — "scoped support": the supported scope is fully reliance-
    // eligible and the unsupported variant is structurally excluded by the
    // adapter (which sets adapter.complete === false and is what actually
    // holds such a case back). All four allowed.
    const scopedSupport = {
      computationAllowed: true, clientApprovalAllowed: true,
      finalizationAllowed: true, canonicalOutputAllowed: true,
    };
    // Shape B — "diagnostic-only": computation proceeds for diagnosis, but the
    // area holds the case back regardless of its facts.
    const diagnosticOnly = {
      computationAllowed: true, clientApprovalAllowed: false,
      finalizationAllowed: false, canonicalOutputAllowed: false,
    };

    const partial = TAX_CAPABILITY_MATRIX.filter((e) => e.state === "partially_supported");
    expect(partial.length).toBeGreaterThan(0);

    for (const e of partial) {
      const shape = {
        computationAllowed: e.computationAllowed,
        clientApprovalAllowed: e.clientApprovalAllowed,
        finalizationAllowed: e.finalizationAllowed,
        canonicalOutputAllowed: e.canonicalOutputAllowed,
      };
      expect(
        [scopedSupport, diagnosticOnly],
        `${e.area} is partially_supported but matches neither documented shape — ` +
          "either the row is wrong, or tax-capability-matrix.md needs a third shape documented",
      ).toContainEqual(shape);
    }

    // Pin WHICH shape each current row is, so a silent flip between the two
    // (a real behavioural claim change) also fails rather than passing as
    // "still one of the two".
    //
    // AUDIT-04-F9: this used to be four hand-written `byArea(...)` assertions,
    // and `K4-09`'s `loss_set_off_carry_forward` row was never added — so a
    // silent Shape A↔B flip on the newest row passed. The expected set is now
    // DERIVED against the live matrix in both directions, so a row added by a
    // future session fails here until it is pinned deliberately. A guard that
    // has to be remembered is the defect this audit kept finding.
    const EXPECTED_SHAPES: Record<string, typeof scopedSupport | typeof diagnosticOnly> = {
      // K4-19: moved from `supported` into `partially_supported`. Shape A by its
      // BOOLEANS, and the booleans are the only thing this guard defines a shape
      // by — but the MECHANISM differs from every row below and is recorded here
      // rather than left to be assumed. Shape A's narration says the unsupported
      // variant is excluded by the adapter; for Section 89 arrears the adapter
      // cannot see it, because arrears are not in the numbers at all. What holds
      // a declared case back is the `salary_arrears_section_89` special
      // situation through the K.2.8.9A eligibility gate, and what covers an
      // UNDECLARED one is a Computation disclosure and nothing stronger. That
      // residual is real. Shape B was considered and rejected: it would block
      // approval and finalization on EVERY salaried case, for a relief that
      // applies to a small minority of them.
      income_salary_pension: scopedSupport,
      house_property: scopedSupport,
      presumptive_44ada: scopedSupport,
      presumptive_44ad: scopedSupport,
      loss_set_off_carry_forward: scopedSupport,
      // K4-11: both dynamic rows moved from `unsupported` into
      // `partially_supported`/Shape A. Shape A is right for them for exactly
      // the reason it is right for `loss_set_off_carry_forward`: a case outside
      // the supported window is held back IN CODE (the engine's own
      // `surchargeTreatmentSupported === false` drives
      // `evaluateSurchargeMarginalReliefRisk`, which still upgrades these two
      // rows to `reliance_blocked` per case), not by these booleans — which
      // remain descriptive (D102).
      surcharge: scopedSupport,
      marginal_relief: scopedSupport,
      // K4-14: moved from `unsupported` into `partially_supported`/Shape A.
      // Shape A for the same reason as every row above it — a books case
      // outside the supported window (any Sections 30-43D adjustment, an
      // undeclared basis, a loss, an audit-threshold turnover, or a second
      // business) is held back IN CODE by `computation-adapter.ts`, which
      // excludes the row and sets `complete === false`, not by these
      // descriptive booleans (D102).
      business_professional_income: scopedSupport,
      // K4-18: moved from `unsupported` into `partially_supported`/Shape A, for
      // the same reason as every scoped row above. Exchange-traded derivatives
      // compute only inside a narrow window — every transaction affirmed an
      // eligible transaction under Explanation 1 to Section 43(5) proviso (d),
      // and a declared Section 44AB turnover, since no official source defines
      // derivative turnover. Everything outside it (unaffirmed F&O, intraday
      // equity, any speculation business) is held back IN CODE by
      // `computation-adapter.ts`, which excludes the row and sets
      // `complete === false` — not by these descriptive booleans (D102).
      fno: scopedSupport,
      capital_gains_house_sale: scopedSupport,
      senior_citizen_treatment: diagnosticOnly,
    };
    expect(
      Object.keys(EXPECTED_SHAPES).sort(),
      "a partially_supported row is unpinned (or a pinned row disappeared) — pin its shape here",
    ).toEqual(partial.map((e) => e.area).sort());
    for (const e of partial) {
      const expected = EXPECTED_SHAPES[e.area];
      if (!expected) throw new Error(`${e.area} is partially_supported but has no pinned shape`);
      expect(e, `${e.area} changed shape`).toMatchObject(expected);
    }
  });

  /**
   * `D102` (closing `AUDIT-01-F4` / `D65` / `D67`, open across three audits).
   * The four booleans stay DESCRIPTIVE and must never become load-bearing:
   * wiring them up would create a second authority for decisions `eligibility.ts`,
   * `evaluateSurchargeMarginalReliefRisk` and `adapter.complete === false`
   * already own, which `PROJECT_CONSTITUTION.md` §3 forbids. `AUDIT-04` verified
   * they have zero production consumers; that is asserted here rather than
   * left as a claim in a decision log, because a claim nobody checks is how
   * this repository loses invariants.
   */
  it("D102: the four capability booleans have NO production consumer", () => {
    const SRC = join(process.cwd(), "src");
    const BOOLEANS = [
      "computationAllowed",
      "clientApprovalAllowed",
      "finalizationAllowed",
      "canonicalOutputAllowed",
    ];

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

    const files = sourceFilesUnder(SRC).filter(
      (f) => f !== join(SRC, "lib", "tax-desk", "tax-capability.ts"),
    );
    // Guards this guard (AUDIT-04-F3/F4): an empty scan approves everything.
    expect(files.length).toBeGreaterThan(50);

    const consumers: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (BOOLEANS.some((b) => new RegExp(`\\b${b}\\b`).test(source))) {
        consumers.push(relative(process.cwd(), file));
      }
    }
    expect(
      consumers,
      "these booleans are DESCRIPTIVE (D102). If one is now load-bearing, that is a second " +
        "authority for a decision eligibility/adapter already own — resolve it there, not here.",
    ).toEqual([]);
  });

  it("every unsupported category with an existing declared-situation code names it (no second competing check invented)", () => {
    const businessRow = findTaxCapability(TAX_CAPABILITY_MATRIX, "business_professional_income")!;
    expect(businessRow.relatedEligibilityBlockerCode).toBe("business_or_professional_income");
    const fnoRow = findTaxCapability(TAX_CAPABILITY_MATRIX, "fno")!;
    expect(fnoRow.relatedEligibilityBlockerCode).toBe("futures_and_options");
  });

  // K4-11 REPLACED this assertion deliberately (the D123 convention). Both rows
  // used to cite `surcharge_marginal_relief_safety_threshold` — correct while
  // nothing was computed, since the only sourced number in play was the
  // blocking threshold. Now that surcharge and relief are actually computed,
  // citing the blocking-only rule as the authority for a COMPUTED figure would
  // be a false citation, so each row cites its own computation rule. The safety
  // rule still exists and still backs the threshold; it is simply no longer the
  // authority for these rows.
  it("surcharge/marginal_relief rows cite their own COMPUTATION pack rule, not a bare literal and not the blocking-only threshold", () => {
    const surchargeRow = findTaxCapability(TAX_CAPABILITY_MATRIX, "surcharge")!;
    const marginalRow = findTaxCapability(TAX_CAPABILITY_MATRIX, "marginal_relief")!;
    expect(ruleAuthorityFor(surchargeRow, "ITA_1961")).toBe("surcharge_rates");
    // K4-12: the row now covers TWO reliefs that share only the name, so it
    // cites both computation rules.
    expect(ruleAuthorityFor(marginalRow, "ITA_1961")).toBe(
      "surcharge_marginal_relief, rebate_87a_marginal_relief",
    );

    // Both cited ids must be real, declared pack rules — a citation that names
    // nothing is worse than no citation, because it reads as sourced.
    // K4-12: `ruleAuthority` is a comma-separated LIST wherever a row rests on
    // more than one rule (as several static rows already are), so each id is
    // checked individually — checking the joined string would silently pass
    // only while every row happened to cite exactly one rule.
    const declared = new Set(AY_2026_27_PACK_PROVENANCE.rules.map((r) => r.ruleId));
    for (const id of citedPackRuleIds(ruleAuthorityFor(surchargeRow, "ITA_1961")!)) {
      expect(declared).toContain(id);
    }
    for (const id of citedPackRuleIds(ruleAuthorityFor(marginalRow, "ITA_1961")!)) {
      expect(declared).toContain(id);
    }
    expect(citedPackRuleIds(ruleAuthorityFor(marginalRow, "ITA_1961")!)).toEqual([
      "surcharge_marginal_relief",
      "rebate_87a_marginal_relief",
    ]);
    // …and the blocking-only rule is still declared, still separate, and still
    // what SURCHARGE_THRESHOLD_PROVENANCE resolves to.
    expect(declared).toContain("surcharge_marginal_relief_safety_threshold");
    expect(SURCHARGE_THRESHOLD_PROVENANCE.ruleId).toBe("surcharge_marginal_relief_safety_threshold");
  });

  // AUDIT-03-F5 / D89. This pins the three capability dimensions that are
  // derivable without duplicating the matrix's scope vocabulary. Material
  // Shape-A scope, ruleAuthority, and support-boolean changes remain an
  // explicit manual bump obligation (OPS-13 / K4-15-F2).
  it("pins the capability fingerprint TAX_CAPABILITY_RULES_VERSION versions (AUDIT-03-F5)", () => {
    const fingerprint = TAX_CAPABILITY_MATRIX.map(
      (e) => `${e.area}=${e.state}/${e.relatedEligibilityBlockerCode ?? "-"}`,
    ).sort();

    // If this assertion fails, a capability state or blocker code changed.
    // Update BOTH this list and TAX_CAPABILITY_RULES_VERSION (bump the vN),
    // and reflect the change in the tax-capability-matrix design notes.
    expect(fingerprint).toEqual([
      // K4-14: moved unsupported -> partially_supported (Shape A). The
      // `business_or_professional_income` declared-situation code stays wired,
      // deliberately, for the same reason K4-11 kept the surcharge one on a
      // row that DID move: it still covers everything this slice refuses —
      // every Sections 30-43D adjustment, a presumptive-to-books transition, a
      // business loss, an audit-threshold turnover, and a second business.
      // Narrowing it would claim more than the code reaches (D119's reasoning).
      "business_professional_income=partially_supported/business_or_professional_income",
      "capital_gains_111a_112a=supported/-",
      "capital_gains_house_sale=partially_supported/-",
      // K4-18: moved unsupported -> partially_supported (Shape A). Exchange-
      // traded derivatives compute inside the ordinary Section 70 pool where
      // the preparer affirms Explanation 1 to Section 43(5) proviso (d) AND
      // declares the Section 44AB turnover. The `futures_and_options`
      // declared-situation code stays wired for the same reason K4-14's did on
      // the row it moved: it still covers everything the slice refuses —
      // unaffirmed F&O, intraday equity, any speculation business, and
      // carry-forward generation. Narrowing it would claim more than the code
      // reaches (D119's reasoning).
      "fno=partially_supported/futures_and_options",
      "foreign_assets=unsupported/foreign_income_or_assets",
      "house_property=partially_supported/-",
      "income_other_sources=supported/-",
      // K4-19: `supported` -> `partially_supported`, and `-` -> the declared
      // situation code. BOTH halves of the fingerprint move, so this row alone
      // forces the v12 -> v13 bump that D89's guard exists to compel.
      "income_salary_pension=partially_supported/salary_arrears_section_89",
      // K4-09: within-year set-off shipped (Shape A). The eligibility blocker
      // stays wired — brought-forward losses are still entirely unsupported.
      "loss_set_off_carry_forward=partially_supported/brought_forward_losses",
      // K4-11: BOTH dynamic rows moved unsupported -> partially_supported
      // (Shape A). The `surcharge_or_marginal_relief` declared-situation code
      // stays wired on both, deliberately: it still covers the band above
      // ₹2,00,00,000 and the ambiguous-marginal-relief case, which the engine
      // genuinely does not model. Narrowing it would claim more than the code
      // reaches — the same reasoning K4-10 recorded in D119 for the
      // brought-forward blocker, reached this time on a row that DID move.
      "marginal_relief=partially_supported/surcharge_or_marginal_relief",
      "presumptive_44ad=partially_supported/-",
      "presumptive_44ada=partially_supported/-",
      "senior_citizen_treatment=partially_supported/-",
      "surcharge=partially_supported/surcharge_or_marginal_relief",
      "tax_audit=unsupported/other_unsupported",
      "vda=unsupported/virtual_digital_assets",
    ]);
    expect(SURCHARGE_MARGINAL_RELIEF_RISK_THRESHOLD_INR).toBe(50_00_000);
    // K4-09 bumped v3 -> v4: loss_set_off_carry_forward moved to
    // partially_supported, changing the fingerprint above.
    // K4-10 bumped v4 -> v5. The state/blocker PAIR above is deliberately
    // UNCHANGED — brought-forward consumption shipped, but the
    // `brought_forward_losses` declaration still covers something genuinely
    // unmodelled (GENERATION of a new carry-forward record from an unabsorbed
    // current-year loss), so narrowing it would claim more than the code
    // reaches. What changed is the row's scope text and its `ruleAuthority`,
    // which is exactly what the version string exists to make visible.
    // K4-11 bumped v5 -> v6, and this is the largest move the fingerprint has
    // carried: BOTH dynamic rows changed state at once, all four booleans on
    // each flipped to true, and both `ruleAuthority` values moved off the
    // blocking-only threshold onto real computation rules.
    // OPS-13 bumped v9 -> v10 for K4-15's material scope widening, which this
    // intentionally narrow derived fingerprint cannot observe. K4-17 bumps
    // v10 -> v11 for the same Shape-A reason: bounded Section 70(1) books-
    // business intra-head set-off changes scope without changing state/code.
    // K4-18 bumps v11 -> v12, and unlike the two before it this one IS visible
    // to the fingerprint: `fno` moves unsupported -> partially_supported. The
    // row also gains a real `ruleAuthority` where it carried `null`, which
    // would have required the bump on its own under D271.
    // K4-19: v12 -> v13. income_salary_pension moved supported ->
    // partially_supported AND gained a relatedEligibilityBlockerCode, so both
    // halves of this row's fingerprint moved. D89's guard compelled the bump.
    // K4-PORT-06: v13 -> v14. Fingerprint unchanged; ruleAuthority became
    // world-keyed. D271's manual bump is what makes that visible.
    // K4-PORT-07: v14 -> v15. Fingerprint still unchanged; fno ITA_2025
    // filled. D271's manual bump is again what makes the fill visible.
    // K4-20: v15 -> v16. Fingerprint unchanged (row still
    // partially_supported); reason/citation now describe the bounded
    // Section 32 slice. D271's manual bump is what makes that visible.
    expect(TAX_CAPABILITY_RULES_VERSION).toBe("TAX_SAFE_01.capability.v19");
  });

  // K4-PORT-06 / D317 — citations are keyed by statutory world. No row state
  // moves; the AY strings are unchanged; the TY side is the same pack-rule-id
  // contract except `fno`, which K4-PORT-07 / D318 now owns as a 2025 statute
  // citation rather than null.
  describe("ruleAuthority is keyed by statutory world (K4-PORT-06)", () => {
    const ayIds = new Set(AY_2026_27_PACK_PROVENANCE.rules.map((r) => r.ruleId));
    const tyIds = new Set(TY_2026_27_PACK_PROVENANCE.rules.map((r) => r.ruleId));

    it("every shipped law is a key on every row — a new world cannot be silent", () => {
      expect(RULE_AUTHORITY_LAWS).toEqual(TAX_LAWS);
      for (const row of TAX_CAPABILITY_MATRIX) {
        for (const law of TAX_LAWS) {
          expect(Object.prototype.hasOwnProperty.call(row.ruleAuthority, law)).toBe(true);
        }
      }
    });

    it("every pack-rule-id citation exists in BOTH packs (set equality, both ways)", () => {
      for (const row of TAX_CAPABILITY_MATRIX) {
        for (const law of TAX_LAWS) {
          const authority = ruleAuthorityFor(row, law);
          if (authority === null) continue;
          if (!isPackRuleAuthorityList(authority)) continue;
          const declared = law === "ITA_2025" ? tyIds : ayIds;
          for (const id of citedPackRuleIds(authority)) {
            expect(declared, `${row.area} ${law} cites undeclared ${id}`).toContain(id);
          }
        }
      }
    });

    it("pack-rule-id rows cite the same string in both worlds today — divergence is a later slice", () => {
      for (const row of TAX_CAPABILITY_MATRIX) {
        const ay = ruleAuthorityFor(row, "ITA_1961");
        const ty = ruleAuthorityFor(row, "ITA_2025");
        if (ay !== null && isPackRuleAuthorityList(ay)) {
          expect(ty, `${row.area} TY drifted from its AY pack-rule contract`).toBe(ay);
        }
      }
    });

    // PROJECT_CONSTITUTION.md §4: this replaces the K4-PORT-06 pin that
    // required ITA_2025 to be null. Slice 6 fills that hole; keeping the
    // null assertion would freeze the reserved gap as if it were the
    // finished citation.
    it("fno 2025 authority is the s.66(31)/s.66(33) re-cite, not a 1961 copy or a guessed s.2 citation", () => {
      const fno = findTaxCapability(TAX_CAPABILITY_MATRIX, "fno")!;
      const ay = ruleAuthorityFor(fno, "ITA_1961");
      const ty = ruleAuthorityFor(fno, "ITA_2025");
      expect(ay).toMatch(/Section 43\(5\)/);
      expect(ay).toMatch(/Income-tax Act 1961/);
      expect(isPackRuleAuthorityList(ay!)).toBe(false);
      expect(ty).not.toBeNull();
      expect(isPackRuleAuthorityList(ty!)).toBe(false);
      expect(ty).toMatch(/Section 66\(31\)/);
      expect(ty).toMatch(/Section 66\(33\)/);
      expect(ty).toMatch(/Income-tax Act 2025/);
      expect(ty).toMatch(/Section 108\(1\)/);
      expect(ty).toMatch(/Section 26\(3\)/);
      expect(ty).toMatch(/Sections 113 and 63/);
      expect(ty, "2025 fno authority leaked a 1961 citation").not.toMatch(/Income-tax Act 1961/);
      expect(ty, "2025 fno authority leaked s.43(5)").not.toMatch(/Section 43\(5\)/);
      // D298: s.2(31)/s.2(33) are Commissioner / Commissioner (Appeals).
      // A bare `2(31)` regex would also match `66(31)` — do not do that.
      expect(ty, "2025 fno authority reused the assessment's s.2(31)").not.toMatch(/Section 2\(31\)/);
      expect(ty, "2025 fno authority reused the assessment's s.2(31)").not.toMatch(/s\.2\(31\)/);
      expect(ty, "2025 fno authority reused the assessment's s.2(33)").not.toMatch(/Section 2\(33\)/);
      expect(ty, "2025 fno authority reused the assessment's s.2(33)").not.toMatch(/s\.2\(33\)/);
    });

    it("no 2025 authority names a 1961 section or the 1961 Act — the fill is a re-cite, not a copy", () => {
      for (const row of TAX_CAPABILITY_MATRIX) {
        const ty = ruleAuthorityFor(row, "ITA_2025");
        if (ty === null) continue;
        expect(ty, `${row.area} TY authority leaked a 1961 citation`).not.toMatch(/Income-tax Act 1961/);
        expect(ty, `${row.area} TY authority leaked s.43(5)`).not.toMatch(/Section 43\(5\)/);
      }
    });
  });

  it("findTaxCapability returns undefined for an absent area rather than throwing", () => {
    // @ts-expect-error deliberately an invalid area to prove the lookup is safe
    expect(findTaxCapability(TAX_CAPABILITY_MATRIX, "not_a_real_area")).toBeUndefined();
  });
});

/**
 * K4-12: the section 87A rebate-relief inputs, held NEUTRAL so the surcharge
 * cases below still test the surcharge blocker alone. `null` income keeps the
 * 87A window detector from tripping at all, so the (fail-closed) absent verdict
 * beside it cannot contribute a second blocker.
 */
const noRebateRisk = {
  newRegimeTotalIncome: null,
  rebateReliefTreatmentSupported: undefined,
      hasHouseSaleLtcg: false,
      houseSaleLtcgTreatmentSupported: undefined,
} as const;

describe("evaluateTaxCapability — dynamic surcharge/marginal-relief rows", () => {
  // K4-11: below/at the threshold the detector never trips, so the engine's
  // verdict is irrelevant — passed as `undefined` (the fail-closed value) to
  // prove these cases are decided by the INCOME test alone and cannot be
  // rescued or broken by the new marker.
  it("below the threshold: surcharge/marginal_relief stay at floor state (not reliance_blocked), no blockers", () => {
    const result = evaluateTaxCapability({ totalIncome: 800000, surchargeTreatmentSupported: undefined, ...noRebateRisk });
    expect(result.blockers).toEqual([]);
    expect(findTaxCapability(result.matrix, "surcharge")!.state).toBe("partially_supported");
    expect(findTaxCapability(result.matrix, "marginal_relief")!.state).toBe("partially_supported");
    expect(result.rulesVersion).toBe(TAX_CAPABILITY_RULES_VERSION);
  });

  it("null totalIncome (no computation yet): no blockers, dynamic rows stay at floor state", () => {
    const result = evaluateTaxCapability({ totalIncome: null, surchargeTreatmentSupported: undefined, ...noRebateRisk });
    expect(result.blockers).toEqual([]);
    expect(findTaxCapability(result.matrix, "surcharge")!.state).toBe("partially_supported");
  });

  it("exactly at the threshold: surcharge/marginal_relief stay at floor state, no blockers (TAX-SAFE-01A)", () => {
    const result = evaluateTaxCapability({
      totalIncome: SURCHARGE_MARGINAL_RELIEF_RISK_THRESHOLD_INR,
      surchargeTreatmentSupported: undefined,
      ...noRebateRisk,
    });
    expect(result.blockers).toEqual([]);
    expect(findTaxCapability(result.matrix, "surcharge")!.state).toBe("partially_supported");
    expect(findTaxCapability(result.matrix, "marginal_relief")!.state).toBe("partially_supported");
  });

  it("strictly above the threshold with NO engine verdict: still reliance_blocked (a pre-K4-11 snapshot fails closed)", () => {
    const result = evaluateTaxCapability({
      totalIncome: SURCHARGE_MARGINAL_RELIEF_RISK_THRESHOLD_INR + 1,
      surchargeTreatmentSupported: undefined,
      ...noRebateRisk,
    });
    expect(result.blockers.length).toBe(1);
    expect(result.blockers[0]!.code).toBe(SURCHARGE_MARGINAL_RELIEF_BLOCKER_CODE);
    const surchargeRow = findTaxCapability(result.matrix, "surcharge")!;
    const marginalRow = findTaxCapability(result.matrix, "marginal_relief")!;
    expect(surchargeRow.state).toBe("reliance_blocked");
    expect(marginalRow.state).toBe("reliance_blocked");
    expect(surchargeRow.clientApprovalAllowed).toBe(false);
    expect(surchargeRow.finalizationAllowed).toBe(false);
    expect(surchargeRow.canonicalOutputAllowed).toBe(false);
  });

  // THE narrowing, stated as a test: the only thing that releases a case above
  // the threshold is the engine's own verdict.
  it("strictly above the threshold WITH a supported engine verdict: no blocker, rows stay partially_supported", () => {
    const result = evaluateTaxCapability({
      totalIncome: SURCHARGE_MARGINAL_RELIEF_RISK_THRESHOLD_INR + 1,
      surchargeTreatmentSupported: true,
      ...noRebateRisk,
    });
    expect(result.blockers).toEqual([]);
    const surchargeRow = findTaxCapability(result.matrix, "surcharge")!;
    expect(surchargeRow.state).toBe("partially_supported");
    expect(surchargeRow.clientApprovalAllowed).toBe(true);
    expect(surchargeRow.finalizationAllowed).toBe(true);
    expect(surchargeRow.canonicalOutputAllowed).toBe(true);
  });

  it("an explicit UNsupported engine verdict blocks, at any income above the threshold", () => {
    for (const totalIncome of [SURCHARGE_MARGINAL_RELIEF_RISK_THRESHOLD_INR + 1, 2_50_00_000, 10_00_00_000]) {
      const result = evaluateTaxCapability({ totalIncome, surchargeTreatmentSupported: false, ...noRebateRisk });
      expect(result.blockers.length, `income ${totalIncome} must stay blocked`).toBe(1);
      expect(result.blockers[0]!.code).toBe(SURCHARGE_MARGINAL_RELIEF_BLOCKER_CODE);
    }
  });

  // K4-19 DELIBERATELY REPLACED THE ASSERTION IN THIS TEST, recorded here rather
  // than done silently (`PROJECT_CONSTITUTION.md` §4, `D298`/`D310` precedent).
  //
  // It read `expect(salaryRow.state).toBe("supported")`. The PROPERTY under test
  // is that a surcharge upgrade does not mutate UNRELATED rows; `"supported"`
  // was never that property, it was just what the salary row happened to be, and
  // K4-19 legitimately changed it to `partially_supported`. Rewriting the
  // literal to `"partially_supported"` would have preserved the same latent
  // fragility for the next session to hit.
  //
  // It now asserts the row is UNCHANGED FROM THE STATIC MATRIX — which is the
  // property the test name claims, is derived rather than retyped, and is
  // strictly stronger: it compares every field, so a future upgrade that
  // mutated `reason` or a boolean on this row would now fail too.
  it("upgrading surcharge/marginal_relief never mutates unrelated rows (e.g. the salary row)", () => {
    const result = evaluateTaxCapability({ totalIncome: 100000000, surchargeTreatmentSupported: false, ...noRebateRisk });
    const salaryRow = findTaxCapability(result.matrix, "income_salary_pension")!;
    const staticRow = findTaxCapability(TAX_CAPABILITY_MATRIX, "income_salary_pension")!;
    expect(salaryRow).toEqual(staticRow);
    // Kept explicitly: this is the consequence the test exists to protect, and
    // deriving it away would let a matrix that changed in BOTH places pass.
    expect(salaryRow.clientApprovalAllowed).toBe(true);
  });

  it("does not mutate the static TAX_CAPABILITY_MATRIX in place", () => {
    const before = JSON.stringify(TAX_CAPABILITY_MATRIX);
    evaluateTaxCapability({ totalIncome: 100000000, surchargeTreatmentSupported: false, ...noRebateRisk });
    expect(JSON.stringify(TAX_CAPABILITY_MATRIX)).toBe(before);
  });
});

describe("K4-23 review F1 — the house-sale LTCG reliance blocker", () => {
  const base = {
    totalIncome: 10_00_000,
    surchargeTreatmentSupported: true,
    newRegimeTotalIncome: 10_00_000,
    rebateReliefTreatmentSupported: true,
  } as const;

  it("does NOT block when no long-term house sale is present", () => {
    expect(evaluateHouseSaleLtcgRisk(false, undefined)).toBeNull();
    expect(evaluateHouseSaleLtcgRisk(false, false)).toBeNull();
  });

  it("does NOT block when the treatment was computed", () => {
    expect(evaluateHouseSaleLtcgRisk(true, true)).toBeNull();
  });

  it("BLOCKS a present-but-refused treatment, and on absence too", () => {
    // Absence fails closed, but only when such a gain is actually present —
    // which is what keeps every pre-K4-23 snapshot out of this gate.
    for (const verdict of [false, undefined, null]) {
      const b = evaluateHouseSaleLtcgRisk(true, verdict);
      expect(b?.code).toBe("HOUSE_SALE_LTCG_BASIC_EXEMPTION_ABSORPTION_UNSUPPORTED");
    }
  });

  it("upgrades ONLY the house-sale row, and blocks approval and output on it", () => {
    const evaluation = evaluateTaxCapability({
      ...base,
      hasHouseSaleLtcg: true,
      houseSaleLtcgTreatmentSupported: false,
    });
    const row = evaluation.matrix.find((e) => e.area === "capital_gains_house_sale");
    expect(row?.state).toBe("reliance_blocked");
    expect(row?.clientApprovalAllowed).toBe(false);
    expect(row?.finalizationAllowed).toBe(false);
    expect(row?.canonicalOutputAllowed).toBe(false);
    // Never the surcharge or marginal-relief rows — D129's status-copy rule.
    expect(evaluation.matrix.find((e) => e.area === "surcharge")?.state).not.toBe(
      "reliance_blocked",
    );
    expect(evaluation.matrix.find((e) => e.area === "marginal_relief")?.state).not.toBe(
      "reliance_blocked",
    );
    expect(evaluation.blockers.map((b) => b.code)).toContain(
      "HOUSE_SALE_LTCG_BASIC_EXEMPTION_ABSORPTION_UNSUPPORTED",
    );
  });

  it("leaves the matrix untouched when the treatment is supported", () => {
    const evaluation = evaluateTaxCapability({
      ...base,
      hasHouseSaleLtcg: true,
      houseSaleLtcgTreatmentSupported: true,
    });
    expect(evaluation.matrix.find((e) => e.area === "capital_gains_house_sale")?.state).toBe(
      "partially_supported",
    );
    expect(evaluation.blockers).toHaveLength(0);
  });

  it("recognises a refused snapshot even though its detail list is empty", () => {
    // The refusal zeroes the per-property detail. Reading only the detail
    // would make a refused case look like a case with no house sale at all —
    // the exact fail-open this helper exists to close.
    expect(
      snapshotHasHouseSaleLtcg({
        computation: {
          houseSaleLtcgTreatmentSupported: false,
          oldRegime: { houseSaleLtcgDetails: [] },
          newRegime: { houseSaleLtcgDetails: [] },
        },
      }),
    ).toBe(true);
    expect(
      snapshotHasHouseSaleLtcg({
        computation: {
          houseSaleLtcgTreatmentSupported: true,
          oldRegime: { houseSaleLtcgDetails: [{}] },
          newRegime: { houseSaleLtcgDetails: [{}] },
        },
      }),
    ).toBe(true);
    // A pre-K4-23 snapshot carries neither property.
    expect(snapshotHasHouseSaleLtcg({ computation: {} })).toBe(false);
  });
});
