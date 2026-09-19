/**
 * `K3-22` — the production CASE TRACEABILITY read model.
 *
 * These tests hold the claims the Computation/Validation screens now make in
 * front of a preparer: which pack governs a case, which versioned rules produced
 * a number, which evidence contributed to it, and — above all — that nothing is
 * ever presented as verified or complete when it is not.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  citedFigureRuleIds,
  COMPUTATION_FIGURE_IDS,
  COMPUTATION_FIGURE_INVENTORY,
  computationFigureInventoryFor,
  describeCaseTraceability,
  FIGURE_INVENTORY_LAWS,
  FIGURE_RULE_ID_FAMILIES,
  FULL_CALCULATION_FIGURE_ROWS,
  packCaptionText,
  REGIME_COMPARISON_FIGURE_ROWS,
  resolvePromotedProposalLineage,
  resolveRuleTrace,
  summarizeTraceabilityStates,
  SURCHARGE_DEPENDENCY_CAVEAT,
  SURCHARGE_DEPENDENT_FIGURE_IDS,
  type ComputationFigureId,
  type ContributingLedgerFact,
  type PromotedProposalLineage,
} from "../case-traceability";
import { buildEngineInput, type CaseMeta, type LedgerRows } from "../computation-adapter";
import { compareRegimes, computeTax, recommendItrForm } from "@/lib/tax-engine/ay-2026-27";
import { TAX_LAWS } from "@/lib/tax-pack/identity";
import { AY_2026_27_PACK_PROVENANCE } from "@/lib/tax-pack/packs/ay-2026-27-provenance";
import { TY_2026_27_PACK_PROVENANCE } from "@/lib/tax-pack/packs/ty-2026-27-provenance";

const META: CaseMeta = {
  assessmentYear: "2026-27",
  financialYear: "2025-26",
  selectedItrType: "ITR-1",
  finalized: false,
};

const EMPTY: LedgerRows = { income: [], taxPaid: [], deductions: [], capitalGains: [] };

function rows(over: Partial<LedgerRows> = {}): LedgerRows {
  return { ...EMPTY, ...over };
}

/** A salaried case backed by a Form 16, plus an un-documented FD-interest row. */
const SALARIED: LedgerRows = rows({
  income: [
    {
      id: "inc_salary",
      income_head: "salary",
      amount: 900_000,
      source_type: "Form16",
      source_document_id: "doc_form16",
      source_document_name: "Form 16 — FY 2025-26",
    },
    { id: "inc_fd", income_head: "fd_interest", amount: 20_000, source_type: "manual" },
  ],
  taxPaid: [
    {
      id: "tp_tds",
      tax_paid_type: "salary_tds",
      amount: 60_000,
      source_type: "Form16",
      source_document_id: "doc_form16",
      source_document_name: "Form 16 — FY 2025-26",
    },
  ],
  deductions: [
    { id: "ded_80c", deduction_type: "80C", amount: 150_000, source_type: "manual" },
  ],
});

function trace(ledger: LedgerRows, statutoryOver: Record<string, unknown> = {}) {
  const adapter = buildEngineInput(ledger, META);
  const computation = computeTax(adapter.input);
  return describeCaseTraceability({
    statutory: { assessmentYear: "2026-27", ...statutoryOver },
    adapter,
    rows: ledger,
    outputs: {
      computation,
      comparison: compareRegimes(adapter.input),
      itrRecommendation: recommendItrForm(adapter.input),
    },
  });
}

describe("describeCaseTraceability — the governing pack", () => {
  it("names the pack that actually governs the case, at its own versions", () => {
    const result = trace(SALARIED);
    expect(result.outcome).toBe("traced");
    if (result.outcome !== "traced") return;
    expect(result.pack.key).toContain("IN:ITA_1961:assessment_year:2026-27");
    expect(result.pack.law).toBe("ITA_1961");
    expect(result.pack.computationRulesVersion).toBe("AY_2026_27_V5_PREP_ONLY");
    expect(result.pack.validationRulesVersion).toBeTruthy();
  });

  it("never reads as verified — the shipped pack is truthfully draft", () => {
    const result = trace(SALARIED);
    if (result.outcome !== "traced") throw new Error("expected traced");
    expect(result.pack.status).toBe("draft");
    expect(result.pack.verified).toBe(false);
    expect(result.pack.summary).toContain("not CA-verified");
    expect(result.pack.gaps.length).toBeGreaterThan(0);
    expect(packCaptionText(result.pack)).toBe(
      "tax pack AY_2026_27_V5_PREP_ONLY · draft — not CA-verified",
    );
  });

  it("surfaces the reliance refusal rather than leaving it an internal state", () => {
    const result = trace(SALARIED);
    if (result.outcome !== "traced") throw new Error("expected traced");
    expect(result.relianceBlocker).not.toBeNull();
    expect(result.relianceBlocker?.code).toBe("tax_pack_unverified");
  });

  it("REFUSES for a statutory world with no computation binding — never a guess", () => {
    const result = trace(SALARIED, { law: "ITA_2025" });
    expect(result.outcome).toBe("refused");
    if (result.outcome !== "refused") return;
    expect(result.resolution).toBe("unbound");
    expect(result.reason).toBeTruthy();
    // Exclusions are true regardless of which pack governs, so they survive.
    expect(result.completeness.complete).toBe(true);
  });
});

describe("figure→rule mapping is keyed by statutory world (K4-PORT-06)", () => {
  it("ships an inventory for every TAX_LAWS member", () => {
    expect(FIGURE_INVENTORY_LAWS).toEqual(TAX_LAWS);
  });

  it("the AY export is the ITA_1961 inventory — Computation page contract unchanged", () => {
    expect(COMPUTATION_FIGURE_INVENTORY).toBe(computationFigureInventoryFor("ITA_1961"));
    expect(computationFigureInventoryFor("ITA_2025").map((f) => f.id)).toEqual(
      COMPUTATION_FIGURE_INVENTORY.map((f) => f.id),
    );
  });

  it("today both worlds cite the same rule ids per family — a silent divergence is a later slice", () => {
    for (const family of FIGURE_RULE_ID_FAMILIES) {
      expect([...family.ITA_2025]).toEqual([...family.ITA_1961]);
    }
    expect(citedFigureRuleIds("ITA_2025")).toEqual(citedFigureRuleIds("ITA_1961"));
  });

  it("every cited id resolves against BOTH packs — unknownRuleIds stays empty", () => {
    const ayDeclared = AY_2026_27_PACK_PROVENANCE.rules;
    const tyDeclared = TY_2026_27_PACK_PROVENANCE.rules;
    for (const spec of computationFigureInventoryFor("ITA_1961")) {
      const resolved = resolveRuleTrace(spec, ayDeclared);
      expect(resolved.unknownRuleIds, spec.id).toEqual([]);
    }
    for (const spec of computationFigureInventoryFor("ITA_2025")) {
      const resolved = resolveRuleTrace(spec, tyDeclared);
      expect(resolved.unknownRuleIds, spec.id).toEqual([]);
    }
  });

  it("does not attach a TY computation surface — bind still refuses unbound", () => {
    const result = trace(SALARIED, { law: "ITA_2025" });
    expect(result.outcome).toBe("refused");
    if (result.outcome !== "refused") return;
    expect(result.resolution).toBe("unbound");
  });
});

describe("describeCaseTraceability — rules behind a number", () => {
  it("resolves every declared rule id against the governing pack's own provenance", () => {
    const result = trace(SALARIED);
    if (result.outcome !== "traced") throw new Error("expected traced");
    const declared = new Set(AY_2026_27_PACK_PROVENANCE.rules.map((r) => r.ruleId));
    for (const line of result.lines) {
      expect(line.unknownRuleIds).toEqual([]);
      for (const rule of line.rules) expect(declared.has(rule.ruleId)).toBe(true);
    }
  });

  it("downgrades controlled unknown-rule drift to an itemised effective mapping gap", () => {
    const authored = COMPUTATION_FIGURE_INVENTORY.find(
      (figure) => figure.id === "comparison.new.rebate",
    );
    if (!authored) throw new Error("expected inventoried rebate figure");
    const controlledDeclaration = AY_2026_27_PACK_PROVENANCE.rules.filter(
      (rule) => rule.ruleId !== "rebate_87a",
    );

    const resolved = resolveRuleTrace(authored, controlledDeclaration);

    expect(authored.state).toBe("traced");
    expect(resolved.unknownRuleIds).toEqual(["rebate_87a"]);
    // K4-12: the rebate figure now cites the relief rule too, so the SURVIVING
    // citations after withdrawing `rebate_87a` are two, not one.
    expect(resolved.rules.map((rule) => rule.ruleId)).toEqual([
      "rebate_87a_marginal_relief",
      "slab_rates",
    ]);
    expect(resolved.effectiveState).toBe("untraced_rule_mapping_gap");
    expect(
      summarizeTraceabilityStates([
        { authoredState: authored.state, state: resolved.effectiveState },
      ]),
    ).toEqual({
      authoredTraced: 1,
      authoredCategorical: 0,
      authoredLimitations: 0,
      effectiveTraced: 0,
      effectiveCategorical: 0,
      effectiveLimitations: 0,
      effectiveRuleMappingGaps: 1,
    });
  });

  it("K3-26: downgrades a CATEGORICAL decision's drift too, not only traced lines", () => {
    // `decision.recommendedRegime` is authored `not_source_tagged_by_construction`
    // — no engine source tag exists for a categorical decision — but it still
    // cites governing-pack rule ids, so its citations must be checked for drift
    // exactly like a traced line's. Before K3-26 the downgrade was gated on
    // `spec.state === "traced"`, so this exact case passed through unflagged and
    // the panel's effective counts stayed clean.
    const authored = COMPUTATION_FIGURE_INVENTORY.find(
      (figure) => figure.id === "decision.recommendedRegime",
    );
    if (!authored) throw new Error("expected inventoried regime decision");
    expect(authored.state).toBe("not_source_tagged_by_construction");
    expect(authored.ruleIds.length).toBeGreaterThan(0);

    const controlledDeclaration = AY_2026_27_PACK_PROVENANCE.rules.filter(
      (rule) => rule.ruleId !== "slab_rates",
    );
    const resolved = resolveRuleTrace(authored, controlledDeclaration);

    expect(resolved.unknownRuleIds).toContain("slab_rates");
    expect(resolved.effectiveState).toBe("untraced_rule_mapping_gap");
    expect(
      summarizeTraceabilityStates([
        { authoredState: authored.state, state: resolved.effectiveState },
      ]),
    ).toEqual({
      authoredTraced: 0,
      authoredCategorical: 1,
      authoredLimitations: 0,
      effectiveTraced: 0,
      effectiveCategorical: 0,
      effectiveLimitations: 0,
      effectiveRuleMappingGaps: 1,
    });

    // The current default pack declares every id the categorical decisions
    // cite, so on UNCONTROLLED provenance both stay effectively categorical —
    // the fix changes drift handling, not today's live behaviour.
    const live = resolveRuleTrace(authored, AY_2026_27_PACK_PROVENANCE.rules);
    expect(live.unknownRuleIds).toEqual([]);
    expect(live.effectiveState).toBe("not_source_tagged_by_construction");
  });

  it("K3-26: an untraced-limitation line cites no rules, so it can never be flagged as a mapping gap", () => {
    // Guards the "naturally excluded" claim in resolveRuleTrace's own doc
    // comment: a limitation's `ruleIds` is always `[]`, so the drift-detection
    // loop never runs for it regardless of what the pack declares.
    // K4-11: this used to use `detail.old.surcharge`, which is no longer a
    // limitation. Re-pointed at one of the two that remain — the
    // presentation-derived tax-before-rebate total — so the K3-26 property is
    // still guarded against a real example rather than deleted with the
    // example that happened to carry it.
    const limitation = COMPUTATION_FIGURE_INVENTORY.find(
      (figure) => figure.id === "comparison.old.taxBeforeRebate",
    );
    if (!limitation) throw new Error("expected inventoried tax-before-rebate limitation");
    expect(limitation.state).toBe("untraced_limitation");
    expect(limitation.ruleIds).toEqual([]);

    const resolved = resolveRuleTrace(limitation, []); // even an EMPTY pack
    expect(resolved.unknownRuleIds).toEqual([]);
    expect(resolved.effectiveState).toBe("untraced_limitation");
  });

  it("every traced rule-derived line names a declared rule; limitations remain explicit", () => {
    const result = trace(SALARIED);
    if (result.outcome !== "traced") throw new Error("expected traced");
    for (const line of result.lines) {
      if (line.state === "traced" && line.kind === "rule_derived") {
        expect(line.rules.length).toBeGreaterThan(0);
      }
      if (line.state === "untraced_limitation") expect(line.limitation).toBeTruthy();
    }
  });

  it("covers the whole closed line vocabulary, in order", () => {
    const result = trace(SALARIED);
    if (result.outcome !== "traced") throw new Error("expected traced");
    expect(result.lines.map((l) => l.id)).toEqual([...COMPUTATION_FIGURE_IDS]);
  });

  it("carries the pack's own citations and TODO(CA-verify) caveats", () => {
    const result = trace(SALARIED);
    if (result.outcome !== "traced") throw new Error("expected traced");
    const rebate = result.lines.find((l) => l.id === "comparison.new.rebate");
    expect(rebate?.rules.map((r) => r.ruleId)).toEqual([
      "rebate_87a",
      "rebate_87a_marginal_relief",
      "slab_rates",
    ]);
    expect(rebate?.rules[0]?.citations).toContain("Section 87A, Income-tax Act, 1961");
    expect(rebate?.rules[0]?.caveat).toContain("TODO(CA-verify)");
  });

  it("marks EVERY line unverified — derived from the pack, not declared", () => {
    const result = trace(SALARIED);
    if (result.outcome !== "traced") throw new Error("expected traced");
    expect(result.lines.every((l) => l.rulesUnverified)).toBe(true);
  });

  it("marks even an input projection unverified while the pack is not CA-verified", () => {
    const result = trace(SALARIED);
    if (result.outcome !== "traced") throw new Error("expected traced");
    const gti = result.lines.find((l) => l.id === "summary.grossTotalIncome");
    expect(gti?.kind).toBe("input_projection");
    expect(gti?.rules).toEqual([]);
    expect(gti?.rulesUnverified).toBe(true);
  });
});

describe("the Computation screen material-figure inventory (K3-24)", () => {
  const PAGE_SINGLE_FIGURE_IDS = [
    "outcome.refundOrPayable",
    "outcome.taxPaid",
    "decision.recommendedRegime",
    "decision.recommendedItrType",
    "comparison.old.refundOrPayable",
    "comparison.new.refundOrPayable",
    "comparison.difference",
    "summary.grossTotalIncome",
  ] as const satisfies readonly ComputationFigureId[];

  it("is closed, unique, and every item has exactly one explicit state", () => {
    expect(COMPUTATION_FIGURE_INVENTORY.map((figure) => figure.id)).toEqual([
      ...COMPUTATION_FIGURE_IDS,
    ]);
    expect(new Set(COMPUTATION_FIGURE_IDS).size).toBe(COMPUTATION_FIGURE_IDS.length);
    expect(
      new Set(COMPUTATION_FIGURE_INVENTORY.map((figure) => figure.state)),
    ).toEqual(
      new Set(["traced", "not_source_tagged_by_construction", "untraced_limitation"]),
    );
    for (const figure of COMPUTATION_FIGURE_INVENTORY) {
      if (figure.state === "traced") expect(figure.limitation).toBeNull();
      else expect(figure.limitation).toBeTruthy();
    }
    expect(
      COMPUTATION_FIGURE_INVENTORY.reduce<Record<string, number>>((counts, figure) => {
        counts[figure.state] = (counts[figure.state] ?? 0) + 1;
        return counts;
      }, {}),
    ).toEqual({
      // K4-08: 32 → 34 (the two per-regime Section 44AD presumptive
      // business-income figures, both rule-derived and source-tagged).
      // K4-10: 34 → 36 (the two per-regime Section 74 brought-forward
      // capital-loss set-off figures — rule-derived and source-tagged from the
      // capital-gain rows that produced them). Deliberately updated: the
      // categorical and limitation counts are UNCHANGED, so this session adds
      // no new untraced figure and no new categorical exception.
      // K4-11: 36 → 40, and the limitation count DROPS for the first time.
      // Two of the four untraced limitations were the old/new "unimplemented
      // surcharge ₹0 placeholder" pair; surcharge is now computed from cited
      // pack rules and source-tagged, so both become traced. The two per-regime
      // marginal-relief figures are added, also traced. The two remaining
      // limitations are the old/new presentation-derived `taxBeforeRebate`
      // totals — a SEPARATE limitation this session had no mandate over, and
      // deliberately not touched. Categorical count unchanged at 2.
      // K4-12: 40 → 42 — the two per-regime section 87A rebate-threshold
      // relief figures, both rule-derived and source-tagged. Categorical and
      // limitation counts are UNCHANGED, so this session adds no new untraced
      // figure and no new categorical exception either.
      // K4-14: 42 → 44 — the two per-regime books-based business net-profit
      // figures (Sections 28/29), both rule-derived and source-tagged from the
      // ledger row that produced them. Categorical and limitation counts are
      // UNCHANGED again: this session adds no untraced figure and no new
      // categorical exception. Note the refusal paths add NO figure at all — a
      // refused books row is reported as an EXCLUSION, not as a ₹0 figure that
      // would need its own lineage.
      traced: 44,
      not_source_tagged_by_construction: 2,
      untraced_limitation: 2,
    });
  });

  it("the presentation row contracts plus explicit single figures exhaust the inventory", () => {
    const presented = new Set<ComputationFigureId>(PAGE_SINGLE_FIGURE_IDS);
    for (const row of [...REGIME_COMPARISON_FIGURE_ROWS, ...FULL_CALCULATION_FIGURE_ROWS]) {
      presented.add(row.oldId);
      presented.add(row.newId);
    }
    expect(presented).toEqual(new Set(COMPUTATION_FIGURE_IDS));

    // Lexical source-audit boundary: the page may not access ANY `.value` /
    // `?.value` member or destructure a `value` property. That catches direct
    // JSX, alternative formatters, arithmetic and aliases at the point they
    // extract a ComputedValue scalar. It deliberately does not pretend to be a
    // semantic parser; the live-DOM E2E inventory closes the rendered boundary.
    const pageSource = readFileSync(
      join(process.cwd(), "src/app/(app)/tax-desk/cases/[id]/computation/page.tsx"),
      "utf8",
    );
    expect(pageSource).toContain("buildComputationFigureValues(figureOutputs)");
    expect(pageSource).toContain("REGIME_COMPARISON_FIGURE_ROWS.map");
    expect(pageSource).toContain("FULL_CALCULATION_FIGURE_ROWS.map");
    expect(pageSource).not.toMatch(/(?:\?\.|\.)\s*value\b/);
    expect(pageSource).not.toMatch(
      /[,{]\s*value\s*(?::\s*[$A-Z_a-z][$\w]*)?\s*[,}]/,
    );
  });

  it("keeps old and new regime values separately traced", () => {
    const result = trace(SALARIED);
    if (result.outcome !== "traced") throw new Error("expected traced");
    const oldTaxable = result.lines.find((line) => line.id === "comparison.old.totalIncome");
    const newTaxable = result.lines.find((line) => line.id === "comparison.new.totalIncome");
    expect(oldTaxable?.state).toBe("traced");
    expect(newTaxable?.state).toBe("traced");
    expect(oldTaxable?.value).not.toBe(newTaxable?.value);
  });

  it("guards the exact categorical exceptions and the empty-but-traced distinction", () => {
    const result = trace(SALARIED);
    if (result.outcome !== "traced") throw new Error("expected traced");
    expect(
      result.lines
        .filter((line) => line.state === "not_source_tagged_by_construction")
        .map((line) => line.id),
    ).toEqual(["decision.recommendedRegime", "decision.recommendedItrType"]);
    const rebate = result.lines.find((line) => line.id === "comparison.new.rebate");
    expect(rebate?.state).toBe("traced");
    expect(rebate?.contributingFacts).toEqual([]);
  });

  // K4-11 REPLACED this assertion deliberately (the D123 convention). The two
  // surcharge placeholders it used to pin as limitations are the very thing
  // this session retired; keeping them here would assert the old behaviour.
  it("calls out ONLY the derived tax-before-rebate totals as limitations — the surcharge placeholders are retired", () => {
    const result = trace(SALARIED);
    if (result.outcome !== "traced") throw new Error("expected traced");
    const limitations = result.lines.filter((line) => line.state === "untraced_limitation");
    expect(limitations.map((line) => line.id)).toEqual([
      "comparison.old.taxBeforeRebate",
      "comparison.new.taxBeforeRebate",
    ]);
    // Both surcharge figures, and both marginal-relief figures, are now traced
    // — asserted here rather than merely absent above, so their retirement is a
    // positive claim that would fail if they silently became untraced again.
    for (const id of [
      "detail.old.surcharge",
      "detail.new.surcharge",
      "detail.old.marginalRelief",
      "detail.new.marginalRelief",
    ]) {
      const line = result.lines.find((l) => l.id === id);
      expect(line?.state, id).toBe("traced");
      expect(line?.limitation, id).toBeNull();
      // SALARIED is far below ₹50,00,000, so both are a COMPUTED nil.
      expect(line?.value, id).toBe(0);
      // …and both cite the real, declared computation rules.
      expect(line?.rules.map((r) => r.ruleId), id).toEqual([
        "surcharge_rates",
        "surcharge_marginal_relief",
      ]);
    }
  });

  it("keeps surcharge-dependent lineage traced while itemising implementation incompleteness", () => {
    const result = trace(SALARIED);
    if (result.outcome !== "traced") throw new Error("expected traced");
    // AUDIT-05-F2. This used to be a length assertion plus two hand-listed
    // membership loops — which is exactly why the set could sit at twelve while
    // the inventory itself declared thirteen surcharge-citing figures. The
    // membership is now DERIVED from the inventory's own citations and compared
    // BOTH WAYS, so a future figure that cites the surcharge rules and is left
    // out of this set fails here, and so does an id declared here that has no
    // surcharge lineage at all.
    const citesSurcharge = COMPUTATION_FIGURE_INVENTORY.filter((s) =>
      s.ruleIds.includes("surcharge_rates"),
    ).map((s) => s.id);
    // The ONLY admissible exceptions: the four figures that ARE the surcharge
    // treatment rather than dependents of it. Listed explicitly so removing one
    // from the inventory, or adding a fifth, is a visible edit here.
    const SURCHARGE_TREATMENT_ITSELF = [
      "detail.old.surcharge",
      "detail.new.surcharge",
      "detail.old.marginalRelief",
      "detail.new.marginalRelief",
    ] as const;
    const derived = citesSurcharge.filter(
      (id) => !(SURCHARGE_TREATMENT_ITSELF as readonly string[]).includes(id),
    );
    for (const id of SURCHARGE_TREATMENT_ITSELF) {
      expect(citesSurcharge, id).toContain(id);
      expect(SURCHARGE_DEPENDENT_FIGURE_IDS as readonly string[], id).not.toContain(id);
    }
    // Every derived id is declared…
    for (const id of derived) {
      expect(SURCHARGE_DEPENDENT_FIGURE_IDS as readonly string[], `derived but undeclared: ${id}`).toContain(id);
    }
    // …and every declared id is derived. Set equality, not a count.
    for (const id of SURCHARGE_DEPENDENT_FIGURE_IDS) {
      expect(derived, `declared but not surcharge-citing: ${id}`).toContain(id);
    }
    expect(SURCHARGE_DEPENDENT_FIGURE_IDS.length).toBe(derived.length);
    // AUDIT-05-F2's own id: the recommended regime is chosen by comparing the
    // two regimes' refundOrPayable, both of which are in this set, so surcharge
    // can flip it. It is a `decision`, not an amount, and carries no engine
    // source tags — neither fact makes it surcharge-INDEPENDENT.
    expect(SURCHARGE_DEPENDENT_FIGURE_IDS as readonly string[]).toContain("decision.recommendedRegime");
    // Cess is `4% × (slab tax - rebate + special tax + SURCHARGE)` in the
    // engine's own arithmetic, so it carries the surcharge dependency exactly
    // as gross liability does. Pinned both ways so neither set can drift.
    for (const cess of [
      "comparison.old.cess",
      "comparison.new.cess",
      "detail.old.cess",
      "detail.new.cess",
    ] as const) {
      expect(SURCHARGE_DEPENDENT_FIGURE_IDS).toContain(cess);
    }
    // Figures computed before surcharge enters the arithmetic must NOT claim it.
    for (const independent of [
      "comparison.old.rebate",
      "comparison.new.totalIncome",
      "detail.old.slabTax",
      "detail.new.specialRateTax",
      "comparison.old.taxPaid",
      "summary.grossTotalIncome",
    ] as const) {
      expect(SURCHARGE_DEPENDENT_FIGURE_IDS).not.toContain(independent);
    }
    for (const id of SURCHARGE_DEPENDENT_FIGURE_IDS) {
      const line = result.lines.find((candidate) => candidate.id === id);
      // Surcharge dependency and source-taggability are INDEPENDENT properties.
      // `decision.recommendedRegime` is categorical — the engine exposes no
      // `ComputedValue.sources` for it — so it is traced-by-construction rather
      // than `traced`. Asserted per-id from the inventory's own spec rather than
      // blanket-asserting "traced", which is what made adding it look like a
      // regression.
      const spec = COMPUTATION_FIGURE_INVENTORY.find((s) => s.id === id);
      expect(line?.state, id).toBe(
        spec?.state === "not_source_tagged_by_construction" ? "not_source_tagged_by_construction" : "traced",
      );
      expect(line?.implementationCaveat).toBe(SURCHARGE_DEPENDENCY_CAVEAT);
      // K4-11 REPLACED these two substring assertions deliberately (the D123
      // convention). "unimplemented surcharge ₹0 placeholder" is no longer a
      // true description of any case at or below ₹2,00,00,000, and a guard
      // that pins a now-false statement is worse than no guard. What the caveat
      // must still do is name the ceiling and refuse to call the ₹0 above it a
      // nil — which is what is pinned instead.
      expect(line?.implementationCaveat).toContain("up to ₹2,00,00,000");
      expect(line?.implementationCaveat).toContain("not a verified nil");
      expect(line?.implementationCaveat).toContain("reliance-blocked");
    }
    expect(
      result.lines.find((line) => line.id === "comparison.new.totalIncome")
        ?.implementationCaveat,
    ).toBeNull();
  });
});

describe("describeCaseTraceability — evidence behind a number", () => {
  it("resolves contributing facts from the engine's own source tags", () => {
    const result = trace(SALARIED);
    if (result.outcome !== "traced") throw new Error("expected traced");
    const gti = result.lines.find((l) => l.id === "summary.grossTotalIncome");
    // The salary and FD rows feed gross total income. `tp_tds` appears too, and
    // that is NOT a defect: the engine tags a figure by the row's DOCUMENT when
    // it has one, and the same Form 16 backs the salary row and the TDS row. The
    // concept being traced is the EVIDENCE, so a document-level match is reported
    // as such (`resolvedBy: "document"`) rather than silently narrowed by a
    // second derivation path of our own.
    expect(gti?.contributingFacts.map((f) => f.ledgerId).sort()).toEqual([
      "inc_fd",
      "inc_salary",
      "tp_tds",
    ]);
    expect(gti?.contributingFacts.find((f) => f.ledgerId === "tp_tds")?.resolvedBy).toBe("document");
    expect(gti?.unresolvedSourceTags).toEqual([]);
  });

  it("reports document vs ledger-row granularity honestly", () => {
    const result = trace(SALARIED);
    if (result.outcome !== "traced") throw new Error("expected traced");
    const gti = result.lines.find((l) => l.id === "summary.grossTotalIncome");
    const salary = gti?.contributingFacts.find((f) => f.ledgerId === "inc_salary");
    const fd = gti?.contributingFacts.find((f) => f.ledgerId === "inc_fd");
    expect(salary?.resolvedBy).toBe("document");
    expect(salary?.documentLabel).toBe("Form 16 — FY 2025-26");
    expect(fd?.resolvedBy).toBe("ledger_row");
    expect(fd?.documentLabel).toBeNull();
  });

  it("one document backing two rows contributes both — the tag granularity is the engine's", () => {
    const result = trace(SALARIED);
    if (result.outcome !== "traced") throw new Error("expected traced");
    const paid = result.lines.find((l) => l.id === "outcome.taxPaid");
    // The Form 16 tag matches BOTH the salary row and the TDS row; the tax-paid
    // figure must not silently claim the salary row is a payment, but the
    // document-level match is reported as such rather than hidden.
    expect(paid?.contributingFacts.some((f) => f.ledgerId === "tp_tds")).toBe(true);
    expect(paid?.contributingFacts.every((f) => f.resolvedBy === "document")).toBe(true);
  });

  it("resolves a K4-17 books-business source instead of leaving its tag unresolved", () => {
    const result = trace(
      rows({
        businessBooksEntries: [
          {
            id: "books_profit",
            revenue: 300_000,
            expenses: 100_000,
            is_profession: false,
            adjustments: "none_s30_43d",
            activity_classification: "ordinary_business_or_profession",
            source_type: "manual",
          },
          {
            id: "books_loss",
            revenue: 50_000,
            expenses: 100_000,
            is_profession: false,
            adjustments: "none_s30_43d",
            activity_classification: "ordinary_business_or_profession",
            source_type: "manual",
          },
        ],
      }),
    );
    if (result.outcome !== "traced") throw new Error("expected traced");
    const books = result.lines.find((line) => line.id === "detail.old.businessBooksIncome");
    expect(books?.contributingFacts.map((fact) => fact.ledgerId).sort()).toEqual([
      "books_loss",
      "books_profit",
    ]);
    expect(books?.contributingFacts.every((fact) => fact.ledgerKind === "business_books")).toBe(true);
    expect(books?.unresolvedSourceTags).toEqual([]);
  });

  it("an empty contributing set is a real answer, not a gap", () => {
    const result = trace(SALARIED);
    if (result.outcome !== "traced") throw new Error("expected traced");
    const cess = result.lines.find((l) => l.id === "comparison.new.cess");
    expect(cess?.contributingFacts).toEqual([]);
    expect(cess?.unresolvedSourceTags).toEqual([]);
    // K4-11: cess is `4% × (… + surcharge)`, so the surcharge rules are part of
    // its lineage. Previously only `cess_rate` was cited while the surcharge
    // dependency lived in a caveat string; it is now a checked citation.
    expect(cess?.rules.map((r) => r.ruleId)).toEqual([
      "cess_rate",
      "surcharge_rates",
      "surcharge_marginal_relief",
    ]);
  });
});

describe("describeCaseTraceability — a partial figure is never presented as complete", () => {
  const PARTIAL: LedgerRows = rows({
    income: [
      { id: "inc_salary", income_head: "salary", amount: 600_000, source_type: "Form16" },
      { id: "inc_hp", income_head: "house_property", amount: 120_000, source_type: "manual" },
    ],
    capitalGains: [
      {
        id: "cg_other",
        gain_type: "other_ltcg",
        sale_value: 300_000,
        cost: 100_000,
        expenses: 0,
        exemption_claimed: 0,
        taxable_gain: 200_000,
        source_type: "broker_report",
      },
    ],
  });

  it("itemises every declared fact the numbers exclude", () => {
    const result = trace(PARTIAL);
    if (result.outcome !== "traced") throw new Error("expected traced");
    expect(result.completeness.complete).toBe(false);
    expect(result.completeness.excluded.map((e) => e.ledgerId).sort()).toEqual([
      "cg_other",
      "inc_hp",
    ]);
    expect(result.completeness.excluded.map((e) => e.code)).toContain("UNSUPPORTED_INCOME_HEAD");
    expect(result.completeness.excluded.map((e) => e.code)).toContain("UNSUPPORTED_GAIN_TYPE");
  });

  it("an excluded fact never contributes to a traced line", () => {
    const result = trace(PARTIAL);
    if (result.outcome !== "traced") throw new Error("expected traced");
    const excluded = new Set(result.completeness.excluded.map((e) => e.ledgerId));
    for (const line of result.lines) {
      for (const fact of line.contributingFacts) expect(excluded.has(fact.ledgerId)).toBe(false);
    }
  });

  it("a complete case says so", () => {
    const result = trace(SALARIED);
    if (result.outcome !== "traced") throw new Error("expected traced");
    expect(result.completeness.complete).toBe(true);
    expect(result.completeness.excluded).toEqual([]);
  });
});

describe("describeCaseTraceability — degenerate inputs", () => {
  it("describes the pack and completeness with NO lines when no computation exists", () => {
    const adapter = buildEngineInput(SALARIED, META);
    const result = describeCaseTraceability({
      statutory: { assessmentYear: "2026-27" },
      adapter,
      rows: SALARIED,
      outputs: null,
    });
    if (result.outcome !== "traced") throw new Error("expected traced");
    expect(result.lines).toEqual([]);
    expect(result.pack.verified).toBe(false);
  });

  it("an empty case traces every line to zero without inventing facts", () => {
    const result = trace(EMPTY);
    if (result.outcome !== "traced") throw new Error("expected traced");
    expect(result.lines).toHaveLength(COMPUTATION_FIGURE_IDS.length);
    expect(result.lines.every((l) => l.contributingFacts.length === 0)).toBe(true);
    expect(result.lines.every((l) => l.unresolvedSourceTags.length === 0)).toBe(true);
  });

  it("is deterministic and frozen", () => {
    const a = JSON.stringify(trace(SALARIED));
    const b = JSON.stringify(trace(SALARIED));
    expect(a).toBe(b);
    const result = trace(SALARIED);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("K4-06: a stored snapshot's comparison predating housePropertyIncome does not throw (treated as ₹0, never fabricated)", () => {
    // `resolveEvidenceManifestCandidate` (evidence-manifest.ts) feeds
    // `outputs.comparison` from a snapshot's OWN immutable stored JSON — never
    // recomputed. A snapshot taken before this field existed has no such
    // property at all (not a zero ComputedValue — genuinely `undefined`).
    // This reproduces that exact shape and proves the read model degrades
    // gracefully rather than crashing (the K4-06 session's own E2E gate
    // caught this as a real TypeError before this fix).
    const adapter = buildEngineInput(SALARIED, META);
    const computation = computeTax(adapter.input);
    const comparison = compareRegimes(adapter.input);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const oldRegimeWithoutHouseProperty = { ...comparison.oldRegime } as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newRegimeWithoutHouseProperty = { ...comparison.newRegime } as any;
    delete oldRegimeWithoutHouseProperty.housePropertyIncome;
    delete newRegimeWithoutHouseProperty.housePropertyIncome;
    const staleComparison = {
      ...comparison,
      oldRegime: oldRegimeWithoutHouseProperty,
      newRegime: newRegimeWithoutHouseProperty,
    };
    const result = describeCaseTraceability({
      statutory: { assessmentYear: "2026-27" },
      adapter,
      rows: SALARIED,
      outputs: {
        computation,
        comparison: staleComparison,
        itrRecommendation: recommendItrForm(adapter.input),
      },
    });
    if (result.outcome !== "traced") throw new Error("expected traced");
    const oldLine = result.lines.find((l) => l.id === "detail.old.housePropertyIncome");
    const newLine = result.lines.find((l) => l.id === "detail.new.housePropertyIncome");
    expect(oldLine?.value).toBe(0);
    expect(newLine?.value).toBe(0);
    expect(oldLine?.contributingFacts).toEqual([]);
  });
});

describe("K3-26 — raw-engine-type boundary (the residual the live-DOM guard cannot see)", () => {
  // The K3-25 anti-bypass pair only covers the Computation page itself: the
  // lexical `.value`/destructure guard scans `page.tsx`, and the live-DOM E2E
  // check compares whatever DOES carry `data-material-figure-id` against the
  // closed inventory. Neither can see a value that never reaches page.tsx that
  // way at all — a CHILD COMPONENT holding a raw engine value object
  // (`ComputedValue`, `TaxComputation`, `RegimeComparison`,
  // `ItrFormRecommendation`) could extract and render a `.value` with no
  // attribute, invisible to both guards.
  //
  // `pack-traceability.tsx` — the only other component reading traceability
  // data — is NOT an exception that needs carving out: it renders
  // `TraceableLine.value`, the read model's OWN already-projected
  // `number | string` scalar. It does not import the raw engine types at all,
  // and this test proves that rather than assume it.
  //
  // This makes the boundary structural rather than a promise in a decision log
  // (same convention as `tax-lab/__tests__/boundary.test.ts`): it scans every
  // `.tsx` file under `src/components/` and the Computation page directory and
  // fails if ANY of them import a raw engine value type. Verified empty today;
  // if this ever fails, that is the trigger to add a same-shaped guard for
  // whatever new file tripped it — never to add an exception here instead.
  const RAW_ENGINE_VALUE_TYPES = [
    "ComputedValue",
    "TaxComputation",
    "RegimeComparison",
    "ItrFormRecommendation",
  ] as const;

  function tsxFilesUnder(dir: string): string[] {
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
        out.push(...tsxFilesUnder(full));
      } else if (entry.endsWith(".tsx")) {
        out.push(full);
      }
    }
    return out;
  }

  it("no component under src/components or the Computation page imports a raw engine value type", () => {
    const COMPONENTS_ROOT = join(process.cwd(), "src/components");
    const COMPUTATION_ROOT = join(process.cwd(), "src/app/(app)/tax-desk/cases/[id]/computation");
    const roots = [COMPONENTS_ROOT, COMPUTATION_ROOT];
    const offenders: string[] = [];
    const scanned = new Map<string, number>();
    for (const root of roots) {
      const files = tsxFilesUnder(root);
      scanned.set(root, files.length);
      for (const file of files) {
        const source = readFileSync(file, "utf8");
        // AUDIT-11-F8 — matched on the MODULE, not on one spelling of its
        // specifier. This read `["']@\/lib\/tax-engine\/ay-2026-27\/types["']`,
        // which pinned the alias form alone: the identical import written
        // `../../lib/tax-engine/ay-2026-27/types` reached the same module,
        // exposed the same raw engine types to the same component, and passed.
        // Proven by planting both forms — the alias failed, the relative path
        // did not, and nothing else in the estate caught it (typecheck clean,
        // lint only an unused-var WARNING, unit 1542/1542 green).
        //
        // Any specifier ENDING in the module path is the same module, so that
        // is what is asserted. A future `@/lib/tax-engine/core/...` value type
        // would need its own clause here; this one deliberately does not try
        // to guess at paths that do not exist yet.
        const importsEngineTypes =
          /from\s+["'][^"']*\btax-engine\/ay-2026-27\/types["']/.test(source) &&
          RAW_ENGINE_VALUE_TYPES.some((t) => new RegExp(`\\b${t}\\b`).test(source));
        if (importsEngineTypes) offenders.push(relative(process.cwd(), file));
      }
    }
    expect(offenders).toEqual([]);

    // AUDIT-04-F4 guards the guard: `tsxFilesUnder` returns [] on ANY readdir
    // failure, so a renamed or moved root would make the scan above pass
    // vacuously over an empty file list — the same convention as
    // `tax-lab/__tests__/boundary.test.ts`'s "actually scans a non-trivial
    // number of production files". Asserted over EVERY entry in `roots`
    // rather than by index, so a root added later is covered automatically
    // and this guard cannot fall behind a new entry the way the guard it
    // hardens did.
    for (const root of roots) {
      expect(scanned.get(root), `scanned no .tsx files under ${root}`).toBeGreaterThanOrEqual(1);
    }
    expect(scanned.get(COMPONENTS_ROOT)).toBeGreaterThan(20);
  });
});

describe("K3-31 — resolvePromotedProposalLineage", () => {
  const LINEAGE: PromotedProposalLineage = {
    proposalId: "prop_income",
    taxCaseId: "case_1",
    factKind: "income.salary",
    sourceDocumentId: "doc_form16",
    promotedLedgerKind: "income",
    promotedLedgerEntryId: "inc_salary",
    decidedByName: "Priya CA",
    decidedAt: "2026-07-20T10:00:00Z",
    promotedByName: "Priya CA",
    promotedAt: "2026-07-20T10:05:00Z",
  };

  it("matches through the immutable promotion link (kind + entry id)", () => {
    const result = resolvePromotedProposalLineage(
      { ledgerKind: "income", ledgerId: "inc_salary", sourceDocumentId: "doc_form16" },
      "case_1",
      [LINEAGE],
    );
    expect(result).toEqual(LINEAGE);
  });

  it("never matches on ledgerKind/ledgerId alone if taxCaseId disagrees — defense in depth", () => {
    const result = resolvePromotedProposalLineage(
      { ledgerKind: "income", ledgerId: "inc_salary", sourceDocumentId: "doc_form16" },
      "some_other_case",
      [LINEAGE],
    );
    expect(result).toBeNull();
  });

  it("never matches if the fact's own source document id disagrees — defense in depth", () => {
    const result = resolvePromotedProposalLineage(
      { ledgerKind: "income", ledgerId: "inc_salary", sourceDocumentId: "doc_different" },
      "case_1",
      [LINEAGE],
    );
    expect(result).toBeNull();
  });

  it("matches when the fact's source document id is unknown (null) — kind+id link is sufficient", () => {
    const result = resolvePromotedProposalLineage(
      { ledgerKind: "income", ledgerId: "inc_salary", sourceDocumentId: null },
      "case_1",
      [LINEAGE],
    );
    expect(result).toEqual(LINEAGE);
  });

  it("never returns lineage for a deduction or capital-gain ledger kind — this workflow promotes only income/tax_paid", () => {
    expect(
      resolvePromotedProposalLineage(
        { ledgerKind: "deduction", ledgerId: "inc_salary", sourceDocumentId: "doc_form16" },
        "case_1",
        [LINEAGE],
      ),
    ).toBeNull();
    expect(
      resolvePromotedProposalLineage(
        { ledgerKind: "capital_gain", ledgerId: "inc_salary", sourceDocumentId: "doc_form16" },
        "case_1",
        [LINEAGE],
      ),
    ).toBeNull();
  });

  it("does NOT match a manually entered row merely because it shares the same ledger kind and a DIFFERENT id", () => {
    // Same case, same kind, but this ledger row was never promoted.
    const result = resolvePromotedProposalLineage(
      { ledgerKind: "income", ledgerId: "inc_manual", sourceDocumentId: "doc_form16" },
      "case_1",
      [LINEAGE],
    );
    expect(result).toBeNull();
  });

  it("an empty promotedProposals list never matches anything", () => {
    expect(
      resolvePromotedProposalLineage({ ledgerKind: "income", ledgerId: "inc_salary", sourceDocumentId: "doc_form16" }, "case_1", []),
    ).toBeNull();
  });
});

describe("K3-31 — describeCaseTraceability surfaces promoted-proposal lineage on contributing facts", () => {
  const INCOME_LINEAGE: PromotedProposalLineage = {
    proposalId: "prop_income",
    taxCaseId: "case_1",
    factKind: "income.salary",
    sourceDocumentId: "doc_form16",
    promotedLedgerKind: "income",
    promotedLedgerEntryId: "inc_salary",
    decidedByName: "Priya CA",
    decidedAt: "2026-07-20T10:00:00Z",
    promotedByName: "Priya CA",
    promotedAt: "2026-07-20T10:05:00Z",
  };
  const TDS_LINEAGE: PromotedProposalLineage = {
    proposalId: "prop_tds",
    taxCaseId: "case_1",
    factKind: "tax_paid.salary_tds",
    sourceDocumentId: "doc_form16",
    promotedLedgerKind: "tax_paid",
    promotedLedgerEntryId: "tp_tds",
    decidedByName: "Priya CA",
    decidedAt: "2026-07-20T10:00:00Z",
    promotedByName: "Priya CA",
    promotedAt: "2026-07-20T10:05:00Z",
  };
  const LINEAGE: readonly PromotedProposalLineage[] = [INCOME_LINEAGE, TDS_LINEAGE];

  function traceWithLineage(taxCaseId: string | undefined, promotedProposals: readonly PromotedProposalLineage[] | undefined) {
    const adapter = buildEngineInput(SALARIED, META);
    const computation = computeTax(adapter.input);
    return describeCaseTraceability({
      statutory: { assessmentYear: "2026-27" },
      adapter,
      rows: SALARIED,
      outputs: {
        computation,
        comparison: compareRegimes(adapter.input),
        itrRecommendation: recommendItrForm(adapter.input),
      },
      taxCaseId,
      promotedProposals,
    });
  }

  function contributingFactsFor(lines: readonly { id: string; contributingFacts: readonly ContributingLedgerFact[] }[], id: string) {
    const line = lines.find((l) => l.id === id);
    if (!line) throw new Error(`expected line ${id}`);
    return line.contributingFacts;
  }

  it("existing callers who omit taxCaseId/promotedProposals see promotedProposal: null everywhere — byte-identical default behaviour", () => {
    const result = traceWithLineage(undefined, undefined);
    if (result.outcome !== "traced") throw new Error("expected traced");
    const facts = contributingFactsFor(result.lines, "outcome.taxPaid");
    expect(facts.length).toBeGreaterThan(0);
    for (const f of facts) expect(f.promotedProposal).toBeNull();
  });

  function findFact(facts: readonly ContributingLedgerFact[], ledgerId: string): ContributingLedgerFact {
    const fact = facts.find((f) => f.ledgerId === ledgerId);
    if (!fact) throw new Error(`expected contributing fact ${ledgerId}`);
    return fact;
  }

  it("marks the promoted salary + TDS rows with their decision lineage, and leaves the manual FD row untouched", () => {
    const result = traceWithLineage("case_1", LINEAGE);
    if (result.outcome !== "traced") throw new Error("expected traced");

    const grossTotalFacts = contributingFactsFor(result.lines, "comparison.old.grossTotalIncome");
    expect(findFact(grossTotalFacts, "inc_salary").promotedProposal).toEqual(INCOME_LINEAGE);
    expect(findFact(grossTotalFacts, "inc_fd").promotedProposal).toBeNull(); // manual entry — never promoted

    const taxPaidFacts = contributingFactsFor(result.lines, "outcome.taxPaid");
    expect(findFact(taxPaidFacts, "tp_tds").promotedProposal).toEqual(TDS_LINEAGE);
  });

  it("a manually entered Form16-tagged row is NEVER labelled with proposal lineage merely by sharing source_type", () => {
    // inc_salary/tp_tds both carry source_type "Form16" and source_document_id
    // "doc_form16" — identical to what promotion writes — but they are ONLY
    // matched because they appear in the lineage list by (kind, ledger id).
    // Proving the negative: drop the income lineage entry and the row must
    // render as un-promoted even though nothing else about the row changed.
    const result = traceWithLineage("case_1", [TDS_LINEAGE]); // TDS lineage only
    if (result.outcome !== "traced") throw new Error("expected traced");
    const grossTotalFacts = contributingFactsFor(result.lines, "comparison.old.grossTotalIncome");
    const salaryFact = findFact(grossTotalFacts, "inc_salary");
    expect(salaryFact.sourceType).toBe("Form16"); // still Form16-tagged
    expect(salaryFact.promotedProposal).toBeNull(); // but not in this case's lineage list
  });

  it("a taxCaseId mismatch withholds lineage even when the ledger link matches — defense in depth is exercised end to end", () => {
    const result = traceWithLineage("a_different_case", LINEAGE);
    if (result.outcome !== "traced") throw new Error("expected traced");
    const grossTotalFacts = contributingFactsFor(result.lines, "comparison.old.grossTotalIncome");
    expect(findFact(grossTotalFacts, "inc_salary").promotedProposal).toBeNull();
  });
});
