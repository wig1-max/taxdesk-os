/**
 * TaxDesk OS — Canonical Tax Capability Matrix (TAX-SAFE-01).
 *
 * PURE TYPESCRIPT ONLY. Like the rest of `src/lib/tax-desk/*`,
 * `src/lib/tax-engine/*`, `src/lib/tax-pack/*` and `src/lib/tax-lab/*`, this
 * module must NOT import React, Next.js, the Supabase client, UI components,
 * server actions, env/config, or app routes.
 *
 * WHY THIS EXISTS. The AY 2026-27 engine documents its own gaps
 * (`tax-engine/ay-2026-27/rules.ts` `NOT_IMPLEMENTED`) and the K.2.8.9A
 * eligibility gate lets a preparer DECLARE a special situation
 * (`eligibility.ts` `SPECIAL_SITUATIONS`, including
 * `"surcharge_or_marginal_relief"`) to route a case to manual professional
 * review. Both are honest, but both depend on a human noticing and acting —
 * neither structurally stops a case whose COMPUTED total income enters
 * surcharge/marginal-relief territory from being treated as reliance-ready
 * if nobody happened to declare it. A caveat is documentation. A blocker is
 * control. This module is the second half: ONE canonical evaluator that
 * states, for every tax capability the product touches, whether it is
 * supported, partially supported, unsupported, or structurally
 * reliance-blocked — and a sourced, versioned, conservative detector that
 * converts the surcharge/marginal-relief gap specifically into a real
 * blocker wired into readiness, client review, and finalization.
 *
 * WHAT THIS IS NOT. It does not compute surcharge or marginal relief (the
 * engine still does not implement either — see rules.ts). It does not
 * duplicate the eligibility evaluator's declared-situation mechanism; it
 * complements it with an AUTOMATIC, income-derived check that does not
 * depend on a human declaration. It does not invent a tax-law number from
 * memory: the one number this module relies on (the conservative ₹50,00,000
 * total-income risk threshold) is a versioned, cited pack rule
 * (`src/lib/tax-pack/packs/ay-2026-27-provenance.ts`,
 * `surcharge_marginal_relief_safety_threshold`) — imported here, never
 * restated as a bare literal elsewhere in the codebase.
 */

import { REBATE_RELIEF_WINDOW_UPPER_INR } from "@/lib/tax-engine/ay-2026-27/rebate-relief";
import { REBATE_87A } from "@/lib/tax-engine/ay-2026-27/rules";
import type { TaxLaw } from "@/lib/tax-pack/identity";
import { TAX_LAWS } from "@/lib/tax-pack/identity";
import { AY_2026_27_PACK_PROVENANCE } from "@/lib/tax-pack/packs/ay-2026-27-provenance";
import { findRuleProvenance } from "@/lib/tax-pack/provenance";

/**
 * Bump when capability states, the risk threshold, blocker codes, or a material
 * Shape-A support boundary change. The enforced fingerprint below can derive
 * the first three without inventing a second vocabulary; scope prose,
 * `ruleAuthority`, and row support booleans remain a deliberate manual-review
 * obligation. Any material change to one of those fields MUST bump this version
 * even when the derived fingerprint is unchanged.
 *
 * AUDIT-03-F5 / decision **D89**: that contract was stated and not met — `K4-06`
 * and `K4-07` each moved a capability state (`house_property` and
 * `presumptive_44ada`, both `unsupported` → `partially_supported`) while this
 * stayed at `v1`. It is bumped to `v2` here to reflect reality, and the
 * contract is now ENFORCED rather than restated: `tax-capability.test.ts` pins
 * a fingerprint of exactly the three things named above, so the next change to
 * any of them fails the suite until this version is consciously bumped
 * alongside it. Bumping-or-dropping was the choice; it was kept because a
 * cheap guard makes it real, and dropping it would discard a useful marker.
 *
 * Scheme: `<origin>.capability.v<n>` — a monotonic integer, deliberately NOT
 * AY-encoded. This module's rows are already scoped to a single assessment
 * year by `TaxCapabilityEntry.assessmentYear`, so encoding the AY here would
 * duplicate that and imply a per-AY versioning this module does not implement.
 *
 * Nothing consumes this at runtime today — it is a provenance marker for
 * anyone reading a stored capability judgement, not an input to one.
 */
// K4-10: v4 -> v5. The `loss_set_off_carry_forward` row's scope changed (
// brought-forward consumption inside the forced-allocation window) and its
// `ruleAuthority` now points at the new pack rule. D89's fingerprint guard
// forces this bump, as designed.
//
// K4-11: v5 -> v6. Both dynamic rows moved state — `surcharge` and
// `marginal_relief` go `unsupported` -> `partially_supported`, all four of each
// row's booleans flip to true (Shape A), and both `ruleAuthority` values move
// off the blocking-only `surcharge_marginal_relief_safety_threshold` onto the
// new COMPUTATION rules `surcharge_rates` / `surcharge_marginal_relief`. The
// blocker's release condition changed too. D89's fingerprint guard forces this
// bump, as designed — it is the largest single move any capability version has
// carried, since it is the first time BOTH dynamic rows changed at once.
//
// K4-12: v6 -> v7. The `marginal_relief` row's scope changed (the section 87A
// rebate-threshold limb moves from "remains unimplemented" to implemented
// new-regime-only inside a sourced window), its `ruleAuthority` gains the new
// `rebate_87a_marginal_relief` pack rule, and a SECOND blocker code
// (`REBATE_MARGINAL_RELIEF_UNSUPPORTED`) can now upgrade that row to
// `reliance_blocked`. D89's fingerprint guard forces this bump, as designed.
//
// OPS-13: v9 -> v10. K4-15 widened the Shape-A
// `business_professional_income` scope from one business per case to any
// number without changing area/state/blocker, so the derived fingerprint could
// not see it. The fingerprint stays intentionally narrow to avoid duplicating
// scope prose as a second vocabulary; the manual bump obligation above closes
// that accepted limitation prospectively.
//
// K4-17: v10 -> v11. The same Shape-A row now admits Section 70(1)
// current-year intra-head set-off between books sources where the whole head
// remains non-negative. The state/blocker fingerprint is deliberately
// unchanged, so D271's manual scope-bump obligation is load-bearing here.
//
// K4-18: v11 -> v12. Unlike v10 -> v11, this one DOES move a row's state: `fno`
// goes `unsupported` -> `partially_supported` (Shape A), because exchange-traded
// derivatives affirmed as eligible transactions under Section 43(5) proviso (d)
// now compute inside the ordinary Section 70 pool. The row also gains a real
// `ruleAuthority` where it previously had `null`. Both are material Shape-A
// changes under D271, and the bump would be required for either alone.
//
// K4-19: v12 -> v13. `income_salary_pension` moves `supported` ->
// `partially_supported` and gains a `relatedEligibilityBlockerCode`, so the
// derived fingerprint moves on both halves and D89's guard forces this bump.
// The row was one of only THREE `supported` rows while Section 89(1) arrears
// relief — squarely inside the salary/pension head, and squarely inside what
// this office files — was not computed, not disclosed and not declarable. A row
// reading `supported` with a known unmodelled limb inside it is the
// `AUDIT-10-F1` shape: a capability claim outliving the behaviour it describes,
// rendered to preparers.
//
// K4-PORT-06: v13 -> v14. No row state or blocker moves. `ruleAuthority`
// becomes world-keyed (`ITA_1961` / `ITA_2025`) so slice 6/7 can cite the
// second world without renaming the AY contract. D271's manual bump obligation
// is load-bearing: the derived fingerprint cannot see a citation-shape change.
//
// K4-PORT-07: v14 -> v15. No row state or blocker moves. Slice 6 fills the
// `fno` row's reserved `ITA_2025: null` with the s.66(31)/s.66(33) re-cite.
// The derived fingerprint still cannot see a citation fill, so D271's manual
// bump is again what makes the change visible.
// K4-24 Phase 0: `capital_gains_house_sale`'s SOURCE LIMIT prose changed
// materially — five of its twenty-five Cost Inflation Index values stopped
// resting on an owner decision with no registered instrument and became
// instrument-backed. The derived fingerprint cannot see scope prose (it reads
// area/state/blocker only), and the contract above says in terms that a
// material change to scope prose MUST bump this version anyway. No capability
// STATE moved, no boolean moved, and no computed figure moved; the row's
// support boundary is identical. This bump records that what the row TELLS a
// preparer about its evidence is different.
export const TAX_CAPABILITY_RULES_VERSION = "TAX_SAFE_01.capability.v19";

// ---------------------------------------------------------------------------
// Sourced, conservative surcharge / marginal-relief risk threshold
// ---------------------------------------------------------------------------

/** The pack rule id this threshold's provenance is recorded under. Checked
 *  against the pack's own provenance below — an undeclared id would be a
 *  silent-drift bug, never a state this module renders as sourced. */
const SURCHARGE_THRESHOLD_RULE_ID = "surcharge_marginal_relief_safety_threshold";

const surchargeThresholdProvenance = findRuleProvenance(
  AY_2026_27_PACK_PROVENANCE,
  SURCHARGE_THRESHOLD_RULE_ID,
);
if (!surchargeThresholdProvenance) {
  // Fail loudly at import time rather than silently using an unsourced
  // number — the whole point of this module is that the threshold is never
  // a bare literal disconnected from its citation.
  throw new Error(
    `tax-capability.ts: the AY 2026-27 pack no longer declares provenance for ` +
      `"${SURCHARGE_THRESHOLD_RULE_ID}" — the surcharge/marginal-relief risk ` +
      `threshold must stay a cited, versioned pack rule.`,
  );
}

/**
 * Conservative total-income threshold (₹50,00,000 / ₹50 lakh) — surcharge
 * and/or marginal relief may apply to a resident individual's income under
 * EITHER regime for AY 2026-27 / FY 2025-26 only once total income EXCEEDS
 * this figure (strictly greater than; exactly ₹50,00,000 attracts nil
 * surcharge) — sourced from the Finance Act, 2025 (First Schedule, Part III)
 * and the Income Tax Department's own AY 2026-27 guidance (see the pack
 * provenance caveat for full detail, incl. the TAX-SAFE-01A boundary
 * correction). Used ONLY to trigger a reliance blocker — no surcharge or
 * marginal-relief AMOUNT is ever computed from it, here or anywhere else.
 */
export const SURCHARGE_MARGINAL_RELIEF_RISK_THRESHOLD_INR = 50_00_000;

/** The provenance record backing the threshold above, re-exported so callers
 *  (e.g. the capability matrix / UI caveats) can cite it without a second
 *  lookup or a restated number. */
export const SURCHARGE_THRESHOLD_PROVENANCE = surchargeThresholdProvenance;

/** Stable blocker code — a public contract (server actions, guarded RPCs,
 *  E2E assertions, the capability matrix doc). Never renamed casually. */
export const SURCHARGE_MARGINAL_RELIEF_BLOCKER_CODE = "SURCHARGE_MARGINAL_RELIEF_UNSUPPORTED" as const;

/**
 * True when a total income EXCEEDS the conservative risk threshold (strict
 * `>`, never `>=`) — official sources (Finance Act 2025, First Schedule Part
 * III; ITD AY 2026-27 guidance) state surcharge/marginal relief begin only
 * once income exceeds ₹50,00,000, so a case at EXACTLY ₹50,00,000 attracts
 * nil surcharge and must not be blocked by this detector (TAX-SAFE-01A).
 * `null`/`undefined` (nothing computed yet) is never risky — there is
 * nothing to block reliance on yet; the ordinary eligibility/data-entry
 * gates already prevent an empty case from looking ready.
 */
export function detectSurchargeMarginalReliefRisk(totalIncome: number | null | undefined): boolean {
  if (totalIncome === null || totalIncome === undefined || !Number.isFinite(totalIncome)) return false;
  return totalIncome > SURCHARGE_MARGINAL_RELIEF_RISK_THRESHOLD_INR;
}

/**
 * The conservative statutory total-income figure this module's detector must
 * be evaluated against: the HIGHER of the old-regime and new-regime taxable
 * total income, regardless of which regime is ultimately recommended or
 * selected (TAX-SAFE-01 design intent, corrected to be enforced consistently
 * in TAX-SAFE-01A). `computeTax`'s top-level `totalIncome` is only the
 * RECOMMENDED regime's figure — using it alone would let a case whose
 * NON-recommended regime crosses the threshold slip through undetected
 * (e.g. old regime recommended for its larger deductions, while the new
 * regime's higher taxable income actually crosses the risk threshold).
 * Every enforcement layer (UI, actions, queries, guarded RPCs) must derive
 * this figure the same way — never re-read `computation.totalIncome.value`
 * alone for this purpose.
 */
export function totalIncomeForSurchargeApplicability(
  oldRegimeTotalIncome: number | null | undefined,
  newRegimeTotalIncome: number | null | undefined,
): number | null {
  const old =
    typeof oldRegimeTotalIncome === "number" && Number.isFinite(oldRegimeTotalIncome) ? oldRegimeTotalIncome : null;
  const nw =
    typeof newRegimeTotalIncome === "number" && Number.isFinite(newRegimeTotalIncome) ? newRegimeTotalIncome : null;
  if (old === null && nw === null) return null;
  if (old === null) return nw;
  if (nw === null) return old;
  return Math.max(old, nw);
}

// ---------------------------------------------------------------------------
// K4-12 — Section 87A REBATE-threshold marginal relief blocker
// ---------------------------------------------------------------------------

/** The pack rule id backing the 87A relief. Checked at import time for the
 *  same reason the surcharge threshold is: an undeclared id would be silent
 *  drift, never a state this module renders as sourced. */
const REBATE_RELIEF_RULE_ID = "rebate_87a_marginal_relief";

const rebateReliefProvenance = findRuleProvenance(AY_2026_27_PACK_PROVENANCE, REBATE_RELIEF_RULE_ID);
if (!rebateReliefProvenance) {
  throw new Error(
    `tax-capability.ts: the AY 2026-27 pack no longer declares provenance for ` +
      `"${REBATE_RELIEF_RULE_ID}" — the section 87A rebate-threshold relief must stay a cited, ` +
      `versioned pack rule.`,
  );
}

/** Re-exported so callers can cite the relief without a second lookup. */
export const REBATE_RELIEF_PROVENANCE = rebateReliefProvenance;

/** Stable blocker code — a public contract (server actions, guarded RPCs, E2E
 *  assertions, the capability matrix doc). Never renamed casually. */
export const REBATE_MARGINAL_RELIEF_BLOCKER_CODE = "REBATE_MARGINAL_RELIEF_UNSUPPORTED" as const;

/**
 * The total income this blocker is evaluated against — the NEW regime's own
 * figure, and deliberately NOT the higher-of-both-regimes base
 * {@link totalIncomeForSurchargeApplicability} uses.
 *
 * The difference is not an inconsistency; it follows from the two reliefs
 * being different reliefs. Surcharge applies under BOTH regimes, so the higher
 * figure is the conservative one (D44 / TAX-SAFE-01A). The section 87A
 * rebate-threshold relief reaches the NEW regime only — its enabling proviso is
 * conditioned on s.115BAC(1A) — so taking the higher figure would block cases
 * on account of an old-regime income for a relief that cannot apply to them,
 * which is over-blocking rather than conservatism.
 *
 * It is still evaluated regardless of which regime is RECOMMENDED, because the
 * new-regime figure drives the comparison and therefore the recommendation
 * itself.
 */
export function totalIncomeForRebateReliefApplicability(
  newRegimeTotalIncome: number | null | undefined,
): number | null {
  return typeof newRegimeTotalIncome === "number" && Number.isFinite(newRegimeTotalIncome)
    ? newRegimeTotalIncome
    : null;
}

/**
 * True when a new-regime total income sits inside the window where clause (b)
 * relief could be due — strictly above the ₹12,00,000 ceiling (at exactly the
 * ceiling clause (a) applies and no relief question arises) and at or below the
 * income at which relief tapers to nothing.
 *
 * The upper edge is what keeps this blocker proportionate. Without it, every
 * new-regime case above ₹12,00,000 with a pre-K4-12 snapshot — which carries no
 * verdict and therefore fails closed — would be blocked. With it, only the
 * ~₹70,588-wide band where relief could actually have been due is examined, and
 * a historical snapshot in that band SHOULD be blocked: it computed tax without
 * a relief that was due, and overstated it.
 */
export function detectRebateReliefRisk(newRegimeTotalIncome: number | null | undefined): boolean {
  const ti = totalIncomeForRebateReliefApplicability(newRegimeTotalIncome);
  if (ti === null) return false;
  return ti > REBATE_87A.new.incomeLimit && ti <= REBATE_RELIEF_WINDOW_UPPER_INR;
}

export interface RebateMarginalReliefBlocker {
  readonly code: typeof REBATE_MARGINAL_RELIEF_BLOCKER_CODE;
  readonly message: string;
  /** Safe structured detail — never sensitive text. */
  readonly totalIncome: number;
  readonly ceilingInr: number;
  readonly windowUpperInr: number;
}

/**
 * K4-12 — the engine's OWN verdict on whether it produced a complete section
 * 87A treatment (`TaxComputation.rebateReliefTreatmentSupported`, the
 * conjunction of both regimes'). Same `boolean | null | undefined` shape and
 * same fail-closed posture as {@link SurchargeTreatmentSupported}, and for the
 * same D44 reason: ONE authority (`tax-engine/ay-2026-27/rebate-relief.ts`)
 * answers "can this case's 87A deduction be computed", and every enforcement
 * layer reads it rather than growing a second copy of the window test.
 */
export type RebateReliefTreatmentSupported = boolean | null | undefined;

/**
 * Evaluate the section 87A rebate-relief reliance blocker. Returns `null` when
 * not blocked.
 *
 * `rebateReliefTreatmentSupported` is REQUIRED, not optional, for exactly the
 * reason `evaluateSurchargeMarginalReliefRisk`'s is: the compiler must name
 * every call site rather than let one default quietly to permitted.
 */
export function evaluateRebateMarginalReliefRisk(
  newRegimeTotalIncome: number | null | undefined,
  rebateReliefTreatmentSupported: RebateReliefTreatmentSupported,
): RebateMarginalReliefBlocker | null {
  if (!detectRebateReliefRisk(newRegimeTotalIncome)) return null;
  if (rebateReliefTreatmentSupported === true) return null;
  return {
    code: REBATE_MARGINAL_RELIEF_BLOCKER_CODE,
    message:
      "This case's new-regime total income sits just above the ₹12,00,000 section 87A rebate ceiling, " +
      "where marginal relief may be due, AND the engine could not produce a complete treatment for it. " +
      "That happens when the case also carries special-rate section 111A/112A income, where neither " +
      "whether the rebate is available at all, nor what \"the income-tax payable on such total income\" " +
      "comprises, is settled by any located source — or when the computation predates the relief being " +
      "implemented at all. NO relief was applied, so the tax shown is NOT understated; it may be " +
      "overstated by up to the full rebate. Reliance is blocked until a professional computes the " +
      "relief manually or the engine adds verified treatment. This is a SEPARATE relief from the " +
      "surcharge marginal relief and shares only the name.",
    totalIncome: newRegimeTotalIncome as number,
    ceilingInr: REBATE_87A.new.incomeLimit,
    windowUpperInr: REBATE_RELIEF_WINDOW_UPPER_INR,
  };
}

export interface SurchargeMarginalReliefBlocker {
  readonly code: typeof SURCHARGE_MARGINAL_RELIEF_BLOCKER_CODE;
  readonly message: string;
  /** Safe structured detail — the income figure that tripped the detector and
   *  the sourced threshold, never sensitive text. */
  readonly totalIncome: number;
  readonly thresholdInr: number;
}

/**
 * K4-11 — the engine's OWN verdict on whether it produced a complete surcharge
 * treatment for this case (`TaxComputation.surchargeTreatmentSupported`, the
 * conjunction of both regimes').
 *
 * Deliberately a `boolean | null | undefined` rather than an income figure this
 * module could re-derive. That is D44's rule, generalised from a number to a
 * judgement: there is ONE authority for "can this case's surcharge be computed"
 * — `tax-engine/ay-2026-27/surcharge.ts` — and every enforcement layer reads it
 * rather than growing a second copy of the window test. A copy in this module
 * (or in SQL) would be exactly the divergence `TAX-SAFE-01A` found when three of
 * four layers had each derived the income base their own way.
 *
 * `null`/`undefined` — a snapshot predating K4-11, or a caller with nothing to
 * read — FAILS CLOSED: it is never treated as supported, which reproduces the
 * pre-K4-11 behaviour exactly (every case above ₹50,00,000 blocked).
 */
export type SurchargeTreatmentSupported = boolean | null | undefined;

/**
 * Evaluate the surcharge/marginal-relief reliance blocker for one computed
 * total income. Returns `null` when not blocked.
 *
 * K4-11 NARROWED this, in the `TAX-SAFE-01A` shape — by exactly as far as the
 * implementation reaches and no further. The trigger CONDITION is unchanged:
 * total income strictly exceeding ₹50,00,000 still puts a case in scope, and
 * `SURCHARGE_MARGINAL_RELIEF_RISK_THRESHOLD_INR` is untouched. What changed is
 * the RELEASE: a case in scope is no longer blocked outright, but only when the
 * engine could not complete the treatment. Concretely, a case is still blocked
 * when its total income exceeds ₹2,00,00,000 (where the 25%/37% tiers engage and
 * the 15% cap on dividend / 111A / 112 / 112A income becomes binding — see
 * `rules.ts`'s `SURCHARGE`), or when marginal relief may be due but the notional
 * reference income's composition is not fixed by any located source.
 *
 * `surchargeTreatmentSupported` is a REQUIRED parameter on purpose. Making it
 * optional would let a fifth enforcement layer grow that silently kept the old
 * behaviour — or, worse, a layer that forgot to thread it through and released
 * a case it should hold. The compiler now names every call site instead.
 */
export function evaluateSurchargeMarginalReliefRisk(
  totalIncome: number | null | undefined,
  surchargeTreatmentSupported: SurchargeTreatmentSupported,
): SurchargeMarginalReliefBlocker | null {
  if (!detectSurchargeMarginalReliefRisk(totalIncome)) return null;
  if (surchargeTreatmentSupported === true) return null;
  return {
    code: SURCHARGE_MARGINAL_RELIEF_BLOCKER_CODE,
    message:
      "This case's total income exceeds the surcharge entry threshold AND the engine could not " +
      "produce a complete surcharge/marginal-relief treatment for it — either the income exceeds " +
      "₹2,00,00,000 (where the 25%/37% tiers and the binding 15% cap on dividend / section 111A / " +
      "112 / 112A income are not modelled), or marginal relief may be due on a case mixing slab and " +
      "special-rate income, where the statute does not fix how the notional reference income is " +
      "composed. Reliance is blocked until a professional prepares this case manually or the engine " +
      "adds verified treatment for it. Surcharge IS computed, and this blocker does NOT fire, for a " +
      "total income up to ₹2,00,00,000 whose relief is either exactly computable or provably nil.",
    totalIncome: totalIncome as number,
    thresholdInr: SURCHARGE_MARGINAL_RELIEF_RISK_THRESHOLD_INR,
  };
}

// ---------------------------------------------------------------------------
// Canonical capability matrix
// ---------------------------------------------------------------------------

export const TAX_CAPABILITY_SUPPORT_STATES = [
  "supported",
  "partially_supported",
  "unsupported",
  "reliance_blocked",
] as const;
export type TaxCapabilitySupportState = (typeof TAX_CAPABILITY_SUPPORT_STATES)[number];

export type TaxCapabilityArea =
  | "income_salary_pension"
  | "income_other_sources"
  | "capital_gains_111a_112a"
  | "capital_gains_house_sale"
  | "house_property"
  | "business_professional_income"
  | "presumptive_44ad"
  | "presumptive_44ada"
  | "loss_set_off_carry_forward"
  | "fno"
  | "vda"
  | "senior_citizen_treatment"
  | "surcharge"
  | "marginal_relief"
  | "foreign_assets"
  | "tax_audit";

/**
 * Citation keyed by statutory world. Both keys are always present so a new
 * `TAX_LAWS` member is a type error until every row names it.
 */
export type WorldKeyedRuleAuthority = Readonly<Record<TaxLaw, string | null>>;

/** Pack-rule-id list shared by both worlds — the common case after `D317`. */
function packRuleAuthority(ids: string): WorldKeyedRuleAuthority {
  return Object.freeze({ ITA_1961: ids, ITA_2025: ids });
}

/** Row that cites no pack rule in either world. */
function noRuleAuthority(): WorldKeyedRuleAuthority {
  return Object.freeze({ ITA_1961: null, ITA_2025: null });
}

/** A pack-rule-id list is snake_case tokens separated by comma+space. */
const PACK_RULE_ID_LIST = /^[a-z][a-z0-9_]*(?:,\s*[a-z][a-z0-9_]*)*$/;

export function isPackRuleAuthorityList(value: string): boolean {
  return PACK_RULE_ID_LIST.test(value);
}

export function ruleAuthorityFor(entry: TaxCapabilityEntry, law: TaxLaw): string | null {
  return entry.ruleAuthority[law];
}

export function citedPackRuleIds(authority: string): readonly string[] {
  return authority.split(",").map((id) => id.trim()).filter((id) => id.length > 0);
}

/** Runtime proof that every shipped law is a key on every row. */
export const RULE_AUTHORITY_LAWS: readonly TaxLaw[] = TAX_LAWS;

/**
 * One row of the canonical capability matrix. `relatedEligibilityBlockerCode`
 * links to the EXISTING eligibility mechanism where one already covers this
 * area (declared special situations, `eligibility.ts`) — this module never
 * re-derives a second, competing check for an area eligibility.ts already
 * blocks; it only adds automatic detection where none existed (surcharge /
 * marginal relief).
 */
export interface TaxCapabilityEntry {
  readonly area: TaxCapabilityArea;
  readonly label: string;
  readonly state: TaxCapabilitySupportState;
  readonly computationAllowed: boolean;
  readonly clientApprovalAllowed: boolean;
  readonly finalizationAllowed: boolean;
  readonly canonicalOutputAllowed: boolean;
  readonly reason: string;
  readonly assessmentYear: "2026-27";
  /**
   * Pack/rule authority this row's support claim is checked against, keyed by
   * statutory world (`K4-PORT-06` / `D317`). Pack-rule-id lists are the stable
   * contract and are the same string in both worlds today. The `fno` row is
   * the reserved exception: its 1961 value is the `K4-18` statute prose; its
   * 2025 value is the `K4-PORT-07` / `D318` re-cite against s.66(31)/s.66(33),
   * not a copy of the 1961 string. `null` in both worlds means the row cites
   * no pack rule.
   */
  readonly ruleAuthority: WorldKeyedRuleAuthority;
  readonly lifecycleStatus: "draft_not_ca_verified";
  readonly remediationMilestone: string | null;
  /** The existing declared-situation code (`eligibility.ts`
   *  `SpecialSituationCode`) a preparer can use to route this area to manual
   *  review TODAY, when one already exists. `null` means no such declared
   *  code exists for this row (either because it is supported, or because —
   *  as with surcharge/marginal relief — this module now detects it
   *  automatically instead of relying solely on a declaration). */
  readonly relatedEligibilityBlockerCode: string | null;
}

const DRAFT = "draft_not_ca_verified" as const;

/**
 * The static rows of the matrix. Rows whose state can change per-case
 * (surcharge, marginal relief) are re-derived dynamically by
 * {@link evaluateTaxCapability} using the case's computed total income —
 * the entries below are the FLOOR state (true whenever no income-specific
 * override applies).
 */
export const TAX_CAPABILITY_MATRIX: readonly TaxCapabilityEntry[] = Object.freeze([
  {
    area: "income_salary_pension",
    label: "Salary and pension income",
    // K4-19: `supported` -> `partially_supported`. Ordinary salary and pension
    // ARE computed; Section 89(1) relief on salary or pension received in
    // ARREARS or in advance (Rule 21A, Form 10E) is not computed at all, and
    // neither are the Rule 21A(3)-(5) limbs. That is inside this head, not
    // beside it, so `supported` overstated the row.
    state: "partially_supported",
    computationAllowed: true,
    clientApprovalAllowed: true,
    finalizationAllowed: true,
    canonicalOutputAllowed: true,
    reason:
      "Ordinary salary and pension are implemented by the AY 2026-27 engine (standard deduction, " +
      "slab computation). Section 89(1) relief on salary or pension received in arrears or in " +
      "advance (Rule 21A, Form 10E) is NOT computed — it needs prior years' rate schedules and " +
      "prior years' total incomes, and this engine holds one year's rate parameters and no " +
      "multi-year state. Omitting it can only OVERSTATE tax, never understate it. A preparer who " +
      "declares the `salary_arrears_section_89` situation routes the case to manual professional " +
      "preparation; a preparer who does NOT declare it gets an unmissable Computation disclosure " +
      "and nothing stronger — that residual is real and is stated rather than implied.",
    assessmentYear: "2026-27",
    ruleAuthority: packRuleAuthority("standard_deduction, slab_rates, section_89_arrears_relief"),
    lifecycleStatus: DRAFT,
    remediationMilestone: null,
    relatedEligibilityBlockerCode: "salary_arrears_section_89",
  },
  {
    area: "income_other_sources",
    label: "Interest, dividends, and other-sources income",
    state: "supported",
    computationAllowed: true,
    clientApprovalAllowed: true,
    finalizationAllowed: true,
    canonicalOutputAllowed: true,
    reason: "Implemented as ordinary slab-rate income.",
    assessmentYear: "2026-27",
    ruleAuthority: packRuleAuthority("slab_rates"),
    lifecycleStatus: DRAFT,
    remediationMilestone: null,
    relatedEligibilityBlockerCode: null,
  },
  {
    area: "capital_gains_111a_112a",
    label: "Basic capital gains (111A short-term, 112A long-term)",
    state: "supported",
    computationAllowed: true,
    clientApprovalAllowed: true,
    finalizationAllowed: true,
    canonicalOutputAllowed: true,
    reason:
      "Implemented for listed-equity/equity-MF STCG (111A) and LTCG (112A) only. " +
      "House-sale capital gains are a separate row (`capital_gains_house_sale`); " +
      "other_stcg/other_ltcg stay placeholders and are never taxed as 111A/112A.",
    assessmentYear: "2026-27",
    ruleAuthority: packRuleAuthority("capital_gains_stcg_111a, capital_gains_ltcg_112a"),
    lifecycleStatus: DRAFT,
    remediationMilestone: null,
    relatedEligibilityBlockerCode: null,
  },
  {
    area: "capital_gains_house_sale",
    label: "House-sale capital gains (s.45 / s.48 land or building)",
    state: "partially_supported",
    computationAllowed: true,
    clientApprovalAllowed: true,
    finalizationAllowed: true,
    canonicalOutputAllowed: true,
    reason:
      "K4-21 + K4-23 (D337): a sale of land or building or both, transferred in FY 2025-26 and " +
      "acquired by purchase, with s.50C's 110% stamp-duty rule and no exemption claimed. " +
      "SHORT-TERM (s.2(42A) twenty-four months) is taxed at slab rates, not s.111A — unchanged " +
      "by K4-23. LONG-TERM now computes the s.112 comparison PER PROPERTY: 12.5% on the " +
      "unindexed gain, capped at 20% on the gain indexed under s.48 Explanation (iii), with the " +
      "excess ignored under the second proviso and the lower figure adopted. Total income " +
      "carries the UNINDEXED gain; only the tax is capped. It is s.112 special-rate income — no " +
      "s.87A rebate against it, and it counts for the rebate-relief refusal. " +
      "NOT this row: house-property income (s.22/23 GAV). " +
      "REFUSED, LONG-TERM: the s.112(1)(a) FIRST proviso (basic-exemption absorption) is not " +
      "applied, so the whole treatment fails closed wherever it could bite in either regime; " +
      "any declared cost of improvement (no improvement year is stored); acquisition before " +
      "1 April 2001 (s.55(2)(b) FMV not modelled); an undeclared assessee share; an unaccepted " +
      "or s.50C(2)-disputed stamp value; any year with no held Cost Inflation Index. " +
      "REFUSED, BOTH HOLDINGS: s.54/s.54F; s.49; s.50; agricultural land; an actual loss; mixed " +
      "set-off with a capital loss (K4-09 Q2). other_stcg/other_ltcg are not this slice. " +
      "SOURCE LIMIT: all 25 Cost Inflation Index values the indexed branch can need come from the " +
      "nine registered e-Gazette notifications, chain unbroken from FY 2001-02 to FY 2025-26 " +
      "(K4-24 Phase 0 closed the five that had rested on the owner's D337 decision alone; no " +
      "value moved). They remain rank-2 e-Gazette PDFs, not the instruments as issued, and this " +
      "row is NOT promoted by that.",
    assessmentYear: "2026-27",
    ruleAuthority: packRuleAuthority("capital_gains_house_sale"),
    lifecycleStatus: DRAFT,
    remediationMilestone: null,
    relatedEligibilityBlockerCode: null,
  },
  {
    area: "house_property",
    label: "Income from house property",
    state: "partially_supported",
    computationAllowed: true,
    clientApprovalAllowed: true,
    finalizationAllowed: true,
    canonicalOutputAllowed: true,
    reason:
      "Implemented for a SINGLE property per case (self-occupied or let-out) — Section 24(a) 30% " +
      "standard deduction, Section 24(b) regime/usage-aware interest cap, and the Section 71(3A)/ " +
      "115BAC loss set-off rule (K4-06, rules.ts HOUSE_PROPERTY, compute-tax.ts computeHouseProperty). " +
      "NOT covered: co-ownership apportionment, multiple-property loss-set-off interaction and " +
      "carry-forward beyond the current year (Wave-4 priority #5), and the fair-rent/municipal-value/ " +
      "standard-rent GAV comparison — more than one live house-property row is safely excluded " +
      "(MULTIPLE_HOUSE_PROPERTIES_NOT_MODELLED), never silently combined.",
    assessmentYear: "2026-27",
    ruleAuthority: packRuleAuthority("house_property_computation"),
    lifecycleStatus: DRAFT,
    remediationMilestone: "Wave 4 (common-case engine breadth) — K4-06 closed the single-property slice",
    relatedEligibilityBlockerCode: null,
  },
  {
    area: "business_professional_income",
    label: "Business or professional income",
    state: "partially_supported",
    computationAllowed: true,
    clientApprovalAllowed: true,
    finalizationAllowed: true,
    canonicalOutputAllowed: true,
    reason:
      "SHAPE A (scoped support; a case outside the scope is held back in code, not by this row). K4-14 " +
      "implements a BOOKS-BASED net profit under Sections 28/29 — declared revenue minus declared " +
      "expenses — and K4-15 AGGREGATES it across ANY NUMBER of businesses or professions in one case, " +
      "because Section 28(i) charges the head on \"the profits and gains of any business or profession " +
      "which was carried on\" (rules.ts BUSINESS_BOOKS, compute-tax.ts " +
      "computeBusinessBooksIncome, pack rule business_books_computation). K4-17 applies Section 70(1) " +
      "current-year intra-head set-off when negative books sources are fully absorbed and the aggregate " +
      "remains zero or positive; a negative aggregate still refuses because Sections 71/72 cross-head " +
      "set-off and carry-forward remain outside the model. Section 29 computes this head " +
      "\"in accordance with the provisions contained in sections 30 to 43D\". K4-20 implements a " +
      "bounded Section 32(1)(ii) slice on a closed Appendix I standing-class set, so the subtraction " +
      "is admitted where the preparer declares none_s30_43d OR a complete standing-class Section 32 " +
      "claim. An UNDECLARED basis refuses " +
      "(BUSINESS_BOOKS_ADJUSTMENTS_UNDECLARED) and is never read as \"no adjustment\". Refused in full " +
      "too: an undeclared activity/loss pool (BUSINESS_BOOKS_ACTIVITY_UNDECLARED), F&O/derivatives " +
      "(BUSINESS_BOOKS_FNO_UNSUPPORTED, Section 43(5)), a speculation business " +
      "(BUSINESS_BOOKS_SPECULATION_UNSUPPORTED, Section 73), or a specified business " +
      "(BUSINESS_BOOKS_SPECIFIED_BUSINESS_UNSUPPORTED, Sections 35AD/73A); only an affirmatively declared " +
      "ordinary_business_or_profession pool enters K4-17's Section 70 set-off. Refused in full " +
      "by computation-adapter.ts, each with its own code, never partially computed: an incomplete or " +
      "out-of-set Section 32 claim (BUSINESS_BOOKS_DEPRECIATION_UNSUPPORTED) or additional depreciation " +
      "under s.32(1)(iia) (BUSINESS_BOOKS_ADDITIONAL_DEPRECIATION_UNSUPPORTED); a Section 37/40/43B disallowance " +
      "(BUSINESS_BOOKS_DISALLOWANCE_UNSUPPORTED); a move to books from a presumptive scheme " +
      "(BUSINESS_BOOKS_PRESUMPTIVE_TRANSITION_UNSUPPORTED — Section 44AD(4)/(5), needs multi-year state " +
      "that does not exist here); turnover EXCEEDING the Section 44AB threshold (strictly >, since the " +
      "section says \"exceed or exceeds\"; ₹1,00,00,000 business under 44AB(a) / ₹50,00,000 profession " +
      "under 44AB(b), BUSINESS_BOOKS_AUDIT_THRESHOLD_EXCEEDED — tested since K4-15 on the AGGREGATE of " +
      "each limb separately, never per row, because 44AB(a) asks about the person's TOTAL turnover in " +
      "business; the proviso's ₹10,00,00,000 figure is NOT used because its cash-payments limb is " +
      "unverifiable here); and a residual business LOSS (BUSINESS_BOOKS_LOSS_NOT_MODELLED — Sections " +
      "71/72 cross-head treatment and carry-forward remain unimplemented after Section 70(1) intra-head " +
      "set-off, and the residual is excluded rather than floored to ₹0). MORE THAN ONE BUSINESS IS NO " +
      "LONGER A REFUSAL (K4-15 " +
      "deleted MULTIPLE_BUSINESS_BOOKS_NOT_MODELLED). Every surviving refusal excludes the WHOLE head, " +
      "not one row — the head is an aggregate, so a partial total would not be the taxpayer's figure; a " +
      "row excluded for a sibling's reason reports BUSINESS_BOOKS_SIBLING_ROW_REFUSED. The legacy " +
      "`business_income` ledger head remains an uncomputed placeholder and still blocks via " +
      "UNSUPPORTED_INCOME_HEAD. Neither the declared revenue nor the declared expense figure is " +
      "verified against any book of account by this product.",
    assessmentYear: "2026-27",
    ruleAuthority: packRuleAuthority("business_books_computation"),
    lifecycleStatus: DRAFT,
    remediationMilestone:
      "Wave 4 (common-case engine breadth) — K4-14 closed the declared-adjustment-free books slice; " +
      "K4-15 aggregated it across businesses; K4-17 added bounded current-year s.70(1) set-off; " +
      "K4-20 added bounded Section 32(1)(ii) on a closed Appendix I standing-class set. " +
      "Specialised/time-window Appendix I classes, s.32(1)(iia), s.32(2), s.43(6)(c) WDV arithmetic, " +
      "disallowances (s.37/40/43B), presumptive-to-books transitions, residual " +
      "losses requiring s.71/s.72 treatment and s.44AB audit-threshold cases remain open",
    relatedEligibilityBlockerCode: "business_or_professional_income",
  },
  {
    area: "presumptive_44ad",
    label: "Presumptive business income (Section 44AD)",
    state: "partially_supported",
    computationAllowed: true,
    clientApprovalAllowed: true,
    finalizationAllowed: true,
    canonicalOutputAllowed: true,
    reason:
      "Implemented as a DUAL-rate deemed-profit computation (6% of turnover received through banking / " +
      "prescribed electronic modes plus 8% of cash turnover — two rates on two portions, unlike Section " +
      "44ADA's single rate on the whole; K4-08, rules.ts PRESUMPTIVE_44AD, compute-tax.ts deriveIncome). " +
      "The aggregate turnover eligibility ceiling (₹2,00,00,000, widening to ₹3,00,00,000 when cash " +
      "receipts do not exceed 5% of the total — a share DERIVED from the declared split, not asserted) " +
      "is enforced by the adapter: a taxpayer above the applicable ceiling is excluded entirely, never " +
      "partially computed (PRESUMPTIVE_44AD_CEILING_EXCEEDED). The eligible-ACTIVITY test IS now applied " +
      "(K4-13, decision D217, rules.ts PRESUMPTIVE_ACTIVITY_ELIGIBILITY): every row declares the activity " +
      "its turnover arises from, and a Section 44AA(1) profession, commission or brokerage, or agency " +
      "business (Section 44AD(6)), or goods carriage excluded from \"eligible business\" by the " +
      "Explanation to Section 44AD, is excluded entirely — as is an UNDECLARED activity, which fails " +
      "closed rather than being presumed eligible (PRESUMPTIVE_44AD_INELIGIBLE_ACTIVITY / " +
      "PRESUMPTIVE_44AD_ACTIVITY_TYPE_UNDECLARED). TAX-SAFE-03 additionally persists the exact per-row " +
      "activity facts and eligible verdict in each new snapshot, rejects legacy/malformed presumptive " +
      "snapshots on read, and rechecks the immutable contract against live rows at review preparation, " +
      "manifest creation, approval and finalization. NOT covered: the eligible-ASSESSEE limbs of the same " +
      "Explanation (resident individual/HUF/firm-not-LLP, and no Section 10A/10AA/10B/10BA or Chapter " +
      "VI-A Part C deduction), which are properties of the person rather than the activity; per-BUSINESS " +
      "turnover ceilings (the declared activity records a type, not a business identity, so turnover " +
      "stays conservatively aggregated across businesses); the Section 44AD(4)/(5) " +
      "five-year lock-in and its Section 44AB audit consequence (no multi-year state exists); the " +
      "cash-PAYMENTS leg of the enhanced-ceiling condition, disclosed as a blocker finding whenever the " +
      "enhanced ceiling is load-bearing (PRESUMPTIVE_44AD_ENHANCED_CEILING_UNVERIFIED, decision D91); " +
      "and declaring a profit higher or lower than the deemed percentage.",
    assessmentYear: "2026-27",
    ruleAuthority: packRuleAuthority("presumptive_44ad_computation"),
    lifecycleStatus: DRAFT,
    remediationMilestone: "Wave 4 (common-case engine breadth) — K4-08 closed the deemed-profit slice",
    relatedEligibilityBlockerCode: null,
  },
  {
    area: "presumptive_44ada",
    label: "Presumptive professional income (Section 44ADA)",
    state: "partially_supported",
    computationAllowed: true,
    clientApprovalAllowed: true,
    finalizationAllowed: true,
    canonicalOutputAllowed: true,
    reason:
      "Implemented as a deemed-profit computation (50% of declared gross professional receipts, " +
      "K4-07, rules.ts PRESUMPTIVE_44ADA, compute-tax.ts deriveIncome). The aggregate gross-receipts " +
      "eligibility ceiling (₹50,00,000, widening to ₹75,00,000 when receipts are confirmed " +
      "predominantly via banking channels) is enforced by the adapter — a taxpayer above the " +
      "applicable ceiling is excluded entirely, never partially computed " +
      "(PRESUMPTIVE_44ADA_CEILING_EXCEEDED). The eligible-ACTIVITY test IS now applied (K4-13, decision " +
      "D217): Section 44ADA(1) reaches only a profession referred to in Section 44AA(1) — the mirror " +
      "image of Section 44AD(6)(i) — so a declared non-profession activity, and an UNDECLARED activity, " +
      "are both excluded entirely rather than presumed eligible " +
      "(PRESUMPTIVE_44ADA_INELIGIBLE_ACTIVITY / PRESUMPTIVE_44ADA_ACTIVITY_TYPE_UNDECLARED). TAX-SAFE-03 " +
      "persists the exact per-row activity and banking-channel facts plus an eligible verdict in each new " +
      "snapshot, rejects legacy/malformed presumptive snapshots on read, and rechecks the immutable " +
      "contract against live rows at review preparation, manifest creation, approval and finalization. Which of " +
      "the nine Section 44AA(1) professions applies is deliberately NOT recorded — both gates need only " +
      "the coarse yes/no, and Rule 6F book-keeping and ITR-4 nature-of-business codes, which would need " +
      "the finer identity, are not implemented. NOT covered: the books-of-account fallback path (a " +
      "taxpayer declaring actual profit BELOW the deemed 50%, which this ledger shape has no field " +
      "to represent) and Section 44AB tax-audit trigger detection — both remain unsupported and " +
      "route via the general business-income declared situation instead.",
    assessmentYear: "2026-27",
    ruleAuthority: packRuleAuthority("presumptive_44ada_computation"),
    lifecycleStatus: DRAFT,
    remediationMilestone: "Wave 4 (common-case engine breadth) — K4-07 closed the deemed-profit slice",
    relatedEligibilityBlockerCode: null,
  },
  {
    area: "loss_set_off_carry_forward",
    label: "Set-off and carry-forward of losses",
    // K4-09/K4-10 — Shape A (scoped support, D88): all four booleans true,
    // because a case whose facts fall OUTSIDE the supported window is held back
    // in code (the adapter excludes every capital-gain row AND every
    // brought-forward row together, so `adapter.complete === false` blocks
    // snapshot/approval/finalization), not by this row.
    //
    // WHY THE `brought_forward_losses` BLOCKER STAYS WIRED even though K4-10
    // shipped brought-forward CONSUMPTION. The eligibility declaration is a
    // coarse staff self-report covering multi-year loss complexity as a whole,
    // and it still covers something genuinely unmodelled: GENERATION of a new
    // carry-forward record from an unabsorbed CURRENT-year loss, which
    // `CAPITAL_LOSS_NOT_MODELLED` still refuses outright. Narrowing the blocker
    // would therefore claim more than the implementation reaches. It narrows
    // exactly as far as the code does — which this session is zero — with the
    // reason stated rather than left to be inferred.
    state: "partially_supported",
    computationAllowed: true,
    clientApprovalAllowed: true,
    finalizationAllowed: true,
    canonicalOutputAllowed: true,
    reason:
      "Within-year set-off of 111A/112A capital losses is applied (Sections 70, 71(3), 74(1)), but ONLY " +
      "where the outcome does not depend on an unresolved ordering question: a long-term loss up to the " +
      "112A gains above the ₹1,25,000 exemption, and a short-term loss only when the case has no 112A " +
      "gain at all AND the loss does not exceed the 111A gains. K4-10 added BROUGHT-FORWARD set-off " +
      "across assessment years (Section 74), including the eight-year expiry (s.74(2)), the " +
      "Section 139(3)/80 filing condition (an UNVERIFIED record fails closed), source provenance, and " +
      "an explicit allocation-and-residual ledger — but ONLY where the allocation is FORCED, i.e. where " +
      "every lawful allocation policy gives the identical result. No mandatory allocation sequence is " +
      "claimed: the sequence comes from a named, versioned `portal_default_ay2026_27` policy pinned to " +
      "ITR-2 utility v1.2 / JSON schema v1.1 / validation rules v1.0, alongside a `taxpayer_elected` " +
      "policy that requires professional review and stops for review on divergence. Every other loss " +
      "case is excluded in FULL (all capital-gain and brought-forward rows together). NOT modelled: " +
      "GENERATION of a new carry-forward record from an unabsorbed current-year loss, which is still " +
      "refused outright. K4-17 separately added current-year Section 70(1) set-off between otherwise-" +
      "admissible books-business/profession sources only where the aggregate remains zero or positive. " +
      "Still not modelled: losses in gain types this engine does not compute; house-property or " +
      "business-loss cross-head set-off; and business-loss carry-forward.",
    assessmentYear: "2026-27",
    ruleAuthority: packRuleAuthority("capital_loss_brought_forward_set_off"),
    lifecycleStatus: DRAFT,
    remediationMilestone:
      "Wave 4 — K4-09 closed within-year set-off, K4-10 closed brought-forward consumption inside the " +
      "forced-allocation window; K4-17 added bounded current-year books-business intra-head set-off; " +
      "generation of new carry-forward remains open",
    relatedEligibilityBlockerCode: "brought_forward_losses",
  },
  {
    area: "fno",
    label: "F&O (futures & options) / speculative business",
    state: "partially_supported",
    computationAllowed: true,
    clientApprovalAllowed: true,
    finalizationAllowed: true,
    canonicalOutputAllowed: true,
    reason:
      "Shape A — scoped support (K4-18). Exchange-traded derivatives compute inside the ordinary " +
      "Section 70(1) pool ONLY where the preparer affirms every transaction is an eligible transaction " +
      "under Explanation 1 to Section 43(5) proviso (d) AND declares the Section 44AB turnover, which no " +
      "statutory, CBDT or return-form source defines and which this product therefore never derives. " +
      "Everything else is held back IN CODE, not by this row: unaffirmed F&O, intraday equity settled " +
      "without delivery, and any speculation business are refused at the adapter, because Explanation 2 to " +
      "Section 28 deems a speculation business distinct and separate and Section 73(1) quarantines its " +
      "loss — no speculation pool exists. Carry-forward generation, Section 71 residual treatment and " +
      "Form 3CD / audited returns remain unsupported.",
    assessmentYear: "2026-27",
    // 1961 prose is the computing world's citation (`K4-18` / `D286`).
    // 2025 is the slice-6 re-cite (`K4-PORT-07` / `D318`): s.66(31)(a) with
    // s.66(33), not the assessment's s.2(31)/s.2(33) and not a copy of the
    // 1961 string. Companion provisions are named from the enacted 2025 Act
    // (s.108(1), s.26(3), s.113, s.63). Equivalence of the two formulations
    // is a CA question and is not decided here. No TY computation is wired.
    ruleAuthority: Object.freeze({
      ITA_1961:
        "Section 43(5) proviso (d) with Explanation 1, Section 70(1), Explanation 2 to Section 28, " +
        "Sections 73 and 44AB, Income-tax Act 1961",
      ITA_2025:
        "Section 66(31)(a) with Section 66(33) (specified derivative transaction, scoped to Part D of " +
        "Chapter IV), Section 108(1), Section 26(3), Sections 113 and 63, Income-tax Act 2025",
    }),
    lifecycleStatus: DRAFT,
    remediationMilestone: "Wave 4 (common-case engine breadth)",
    relatedEligibilityBlockerCode: "futures_and_options",
  },
  {
    area: "vda",
    label: "Virtual digital assets / crypto (Section 115BBH)",
    state: "unsupported",
    computationAllowed: false,
    clientApprovalAllowed: false,
    finalizationAllowed: false,
    canonicalOutputAllowed: false,
    reason: "Not applied (rules.ts NOT_IMPLEMENTED.crypto).",
    assessmentYear: "2026-27",
    ruleAuthority: noRuleAuthority(),
    lifecycleStatus: DRAFT,
    remediationMilestone: "Wave 4 (common-case engine breadth)",
    relatedEligibilityBlockerCode: "virtual_digital_assets",
  },
  {
    area: "senior_citizen_treatment",
    label: "Senior / super-senior citizen slab and deduction variations",
    state: "partially_supported",
    computationAllowed: true,
    clientApprovalAllowed: false,
    finalizationAllowed: false,
    canonicalOutputAllowed: false,
    reason:
      "Age category is derived from the taxpayer's date of birth (K4-01, " +
      "deriveTaxpayerAgeBand). The OLD-regime senior/super-senior basic-exemption " +
      "slab widening is applied (K4-02, slabs.ts); the senior 80D cap and " +
      "80TTB-vs-80TTA mutual exclusivity are applied for the taxpayer's OWN age " +
      "band (K4-03); and Section 80D's independent parents-bucket cap for a " +
      "premium paid on a senior/super-senior PARENT's behalf is applied (K4-05, " +
      "the \"80D_PARENTS\" ledger section — rules.ts deductionCapForSection). " +
      "The full later-computation dossier (spec §10.1-§10.4) is now closed — no " +
      "known senior-specific computation gap remains. A genuinely separate, " +
      "still-open gap was noted during K4-05: the self/family \"80D\" bucket " +
      "does not yet widen for a senior SPOUSE (affects a below-60 taxpayer, " +
      "never the resident senior/super-senior population this row describes). " +
      "clientApprovalAllowed/finalizationAllowed/canonicalOutputAllowed below " +
      "are unconditional and descriptive only — this module has no regime " +
      "input to vary on; the real, regime-aware reliance evaluator is " +
      "senior-treatment.ts's evaluateSeniorTreatmentRisk, whose OLD-regime " +
      "block and pre-approval comparison-unreliable disclosure were BOTH " +
      "REMOVED in K4-05 (decision D79; see AUDIT-01-F4/D67, AUDIT-02-F1 for " +
      "this row's own maintenance history).",
    assessmentYear: "2026-27",
    ruleAuthority: noRuleAuthority(),
    lifecycleStatus: DRAFT,
    remediationMilestone: "Wave 4 (common-case engine breadth)",
    relatedEligibilityBlockerCode: null,
  },
  {
    // K4-11 — Shape A (scoped support, D88), like the loss-set-off row. All
    // four booleans are true because a case OUTSIDE the supported window is
    // held back in code (the engine reports `surchargeTreatmentSupported =
    // false` and `evaluateSurchargeMarginalReliefRisk` blocks on it), not by
    // this row. The dynamic per-case override below still upgrades this row to
    // `reliance_blocked` for exactly those cases.
    area: "surcharge",
    label: "Surcharge on income tax",
    state: "partially_supported",
    computationAllowed: true,
    clientApprovalAllowed: true,
    finalizationAllowed: true,
    canonicalOutputAllowed: true,
    reason:
      "Implemented for a total income up to ₹2,00,00,000 — the 10% tier (exceeding ₹50,00,000) and " +
      "the 15% tier (exceeding ₹1,00,00,000), identical under both regimes, charged on income-tax " +
      "after the section 87A rebate and before cess, with cess following the RELIEVED surcharge " +
      "(K4-11, rules.ts SURCHARGE, surcharge.ts computeSurcharge). The window ends at ₹2,00,00,000 " +
      "for a sourced reason, not a convenient one: at 10% and 15% the Finance Act's own proviso " +
      "capping surcharge on dividend / section 111A / 112 / 112A income at 15% is provably " +
      "NON-BINDING, so no apportionment of income-tax between capped and uncapped parts is needed " +
      "and the answer does not depend on the income's composition. NOT covered: the 25% and 37% " +
      "tiers above ₹2,00,00,000, the band test on total income EXCLUDING dividend/111A/112/112A that " +
      "those tiers are conditioned on, and the apportionment the then-binding 15% cap requires — a " +
      "case above the ceiling computes NO surcharge and stays reliance-blocked, never a ₹0 that " +
      "reads as nil.",
    assessmentYear: "2026-27",
    ruleAuthority: packRuleAuthority("surcharge_rates"),
    lifecycleStatus: DRAFT,
    remediationMilestone:
      "Wave 4 — K4-11 closed the 10%/15% tiers up to ₹2,00,00,000; the 25%/37% tiers remain open",
    relatedEligibilityBlockerCode: "surcharge_or_marginal_relief",
  },
  {
    area: "marginal_relief",
    label: "Marginal relief (surcharge / rebate thresholds)",
    state: "partially_supported",
    computationAllowed: true,
    clientApprovalAllowed: true,
    finalizationAllowed: true,
    canonicalOutputAllowed: true,
    reason:
      "Implemented at the ₹50,00,000 and ₹1,00,00,000 SURCHARGE thresholds (K4-11, surcharge.ts) — " +
      "income-tax plus surcharge is capped at the income-tax (and, at the ₹1,00,00,000 threshold, " +
      "surcharge) on a notional total income equal to the threshold, plus the income exceeding it; " +
      "the statute's own asymmetry between the two limbs is reproduced exactly. Computed EXACTLY " +
      "where the case has no special-rate 111A/112A income, since the notional reference income then " +
      "has one lawful composition. Where the case mixes slab and special-rate income the reference " +
      "composition is NOT fixed by any located source, so relief is applied only where it is provably " +
      "nil under every reading; otherwise surcharge is reported GROSS of relief and the case is " +
      "reliance-blocked rather than guessed. K4-12 added the genuinely SEPARATE section 87A " +
      "REBATE-threshold relief, which shares only the name and operates ~₹37,00,000 lower: where " +
      "new-regime total income exceeds ₹12,00,000 and the income-tax on it exceeds that excess, the " +
      "deduction is the difference, capped at the income-tax payable at s.115BAC(1A) rates. It is " +
      "NEW-REGIME ONLY — the enabling proviso is conditioned on s.115BAC(1A), so the old regime's " +
      "₹5,00,000 ceiling is a genuine cliff, and that ₹0 is a computed nil rather than a gap. " +
      "Computed EXACTLY where the case carries no special-rate 111A/112A income; where it does, " +
      "neither whether the rebate is available at all nor what the reference income-tax comprises is " +
      "settled by any located source, so relief is applied only where provably nil and the case is " +
      "otherwise reliance-blocked with NO relief applied. NOT covered: the ₹2,00,00,000 and " +
      "₹5,00,00,000 surcharge thresholds (outside the surcharge window entirely).",
    assessmentYear: "2026-27",
    ruleAuthority: packRuleAuthority("surcharge_marginal_relief, rebate_87a_marginal_relief"),
    lifecycleStatus: DRAFT,
    remediationMilestone:
      "Wave 4 — K4-11 closed the ₹50,00,000/₹1,00,00,000 surcharge thresholds and K4-12 closed the " +
      "section 87A rebate threshold (new regime, no special-rate income); the special-rate-income " +
      "case and the ₹2 crore / ₹5 crore surcharge tiers remain open",
    relatedEligibilityBlockerCode: "surcharge_or_marginal_relief",
  },
  {
    area: "foreign_assets",
    label: "Foreign assets / income (Schedule FA)",
    state: "unsupported",
    computationAllowed: false,
    clientApprovalAllowed: false,
    finalizationAllowed: false,
    canonicalOutputAllowed: false,
    reason: "Not computed; blocks ITR-1 only (rules.ts NOT_IMPLEMENTED.foreignAssets).",
    assessmentYear: "2026-27",
    ruleAuthority: noRuleAuthority(),
    lifecycleStatus: DRAFT,
    remediationMilestone: "Wave 4 (common-case engine breadth)",
    relatedEligibilityBlockerCode: "foreign_income_or_assets",
  },
  {
    area: "tax_audit",
    label: "Tax-audit cases (Section 44AB)",
    state: "unsupported",
    computationAllowed: false,
    clientApprovalAllowed: false,
    finalizationAllowed: false,
    canonicalOutputAllowed: false,
    reason:
      "Not handled (rules.ts NOT_IMPLEMENTED.taxAudit). K4-14 did NOT narrow this row — it added " +
      "DETECTION of the Section 44AB turnover threshold on a books-based row and refuses such a case " +
      "(BUSINESS_BOOKS_AUDIT_THRESHOLD_EXCEEDED), which is the opposite of handling one. No audit " +
      "report, Form 3CA/3CB/3CD, or 44AB(c)/(d)/(e) trigger is produced or tested, and the " +
      "₹10,00,00,000 proviso threshold is deliberately not applied because its cash-payments limb " +
      "cannot be verified from any ledger held here.",
    assessmentYear: "2026-27",
    ruleAuthority: noRuleAuthority(),
    lifecycleStatus: DRAFT,
    remediationMilestone: "Wave 4 (common-case engine breadth)",
    relatedEligibilityBlockerCode: "other_unsupported",
  },
]);

export interface TaxCapabilityContext {
  /** The case's computed total income, when a computation exists. `null`
   *  when no computation has been run yet — nothing to evaluate the dynamic
   *  surcharge/marginal-relief rows against. */
  readonly totalIncome: number | null;
  /** K4-11 — the engine's own surcharge verdict for this case. See
   *  {@link SurchargeTreatmentSupported}: absent fails closed. */
  readonly surchargeTreatmentSupported: SurchargeTreatmentSupported;
  /** K4-12 — the NEW regime's own total income, for the section 87A
   *  rebate-relief window test. See
   *  {@link totalIncomeForRebateReliefApplicability} for why this is not the
   *  higher-of-both base the surcharge blocker uses. */
  readonly newRegimeTotalIncome: number | null;
  /** K4-12 — the engine's own 87A verdict. Absent fails closed, but only
   *  inside the window the detector examines. */
  readonly rebateReliefTreatmentSupported: RebateReliefTreatmentSupported;
  /** K4-23 — whether the computation carries a long-term house sale at all. */
  readonly hasHouseSaleLtcg: boolean;
  /** K4-23 — the engine's own s.112 verdict. REQUIRED, not optional, for the
   *  reason the two above are: the compiler must name every call site rather
   *  than let one default quietly to permitted. */
  readonly houseSaleLtcgTreatmentSupported: boolean | null | undefined;
}

/**
 * K4-23 review F1 (P1) — the THIRD reliance blocker.
 *
 * `D337` item 5 makes the engine remove a long-term house-sale gain from
 * both tax and gross total income wherever the s.112(1)(a) first proviso
 * could change the figure. That refusal was previously visible only inside
 * the engine: nothing downstream read it, so a knowingly incomplete
 * computation could still be approved and finalized with a real capital gain
 * silently absent. This is the gate that stops it.
 *
 * Deliberately its OWN blocker rather than folded into either existing one,
 * for `D172`'s reason: the three refuse different cases, and telling a
 * preparer "surcharge" about a house-sale refusal is untrue status copy
 * (`D129`).
 */
export const HOUSE_SALE_LTCG_BLOCKER_CODE =
  "HOUSE_SALE_LTCG_BASIC_EXEMPTION_ABSORPTION_UNSUPPORTED" as const;

export interface HouseSaleLtcgBlocker {
  readonly code: typeof HOUSE_SALE_LTCG_BLOCKER_CODE;
  readonly message: string;
}

/**
 * Returns `null` when not blocked. Blocks only when a long-term house sale is
 * actually PRESENT and its verdict is not exactly `true` — so absence never
 * blocks a case that carries no such gain, and no pre-K4-23 snapshot is
 * caught by a property it could not have carried.
 */
export function evaluateHouseSaleLtcgRisk(
  hasHouseSaleLtcg: boolean,
  houseSaleLtcgTreatmentSupported: boolean | null | undefined,
): HouseSaleLtcgBlocker | null {
  if (!hasHouseSaleLtcg) return null;
  if (houseSaleLtcgTreatmentSupported === true) return null;
  return {
    code: HOUSE_SALE_LTCG_BLOCKER_CODE,
    message:
      "This case carries a long-term house sale whose section 112 treatment the engine could not " +
      "complete, so the gain has been removed from both the tax and the gross total income. The " +
      "first proviso to section 112(1)(a) reduces a long-term gain where total income as reduced " +
      "by that gain falls short of the maximum amount not chargeable to income-tax, and this " +
      "engine does not apply that reduction — so the figure could be wrong under either regime. " +
      "The computation is knowingly incomplete and is not eligible for reliance, approval or " +
      "finalization.",
  };
}

/**
 * K4-23 review F1 — does a STORED snapshot carry a long-term house sale?
 *
 * Derived from the snapshot's own computation, never from a live ledger row:
 * an output gate may not read mutable live data (the `D40` invariant). A
 * refused treatment zeroes the per-property detail, so the refusal must be
 * recognised from the VERDICT as well as from the detail — reading only the
 * detail would make a refused case look like a case with no house sale,
 * which is precisely the fail-open this gate exists to close.
 */
export function snapshotHasHouseSaleLtcg(snapshot: {
  computation: {
    houseSaleLtcgTreatmentSupported?: boolean;
    oldRegime?: { houseSaleLtcgDetails?: readonly unknown[] };
    newRegime?: { houseSaleLtcgDetails?: readonly unknown[] };
  };
}): boolean {
  const c = snapshot.computation;
  if (c.houseSaleLtcgTreatmentSupported === false) return true;
  return (
    (c.oldRegime?.houseSaleLtcgDetails?.length ?? 0) > 0 ||
    (c.newRegime?.houseSaleLtcgDetails?.length ?? 0) > 0
  );
}

/** Either reliance blocker this module can raise. Kept as a union rather than
 *  widened to a shapeless record so a consumer that handles only one of them
 *  fails to compile rather than silently ignoring the other. */
export type TaxCapabilityBlocker =
  | SurchargeMarginalReliefBlocker
  | RebateMarginalReliefBlocker
  | HouseSaleLtcgBlocker;

export interface TaxCapabilityEvaluation {
  readonly matrix: readonly TaxCapabilityEntry[];
  readonly blockers: readonly TaxCapabilityBlocker[];
  readonly rulesVersion: string;
}

/**
 * Evaluate the full capability matrix for one case context. The static rows
 * pass through unchanged; the two dynamic rows (`surcharge`,
 * `marginal_relief`) are upgraded to `reliance_blocked` when
 * {@link detectSurchargeMarginalReliefRisk} trips, and any active blocker is
 * also returned directly for callers that only need the blocker (readiness /
 * review / finalize enforcement) without re-scanning the matrix.
 */
export function evaluateTaxCapability(ctx: TaxCapabilityContext): TaxCapabilityEvaluation {
  const risk = evaluateSurchargeMarginalReliefRisk(ctx.totalIncome, ctx.surchargeTreatmentSupported);
  // K4-12: a SECOND, independent blocker. It upgrades only the
  // `marginal_relief` row — never the `surcharge` row, because a case at ₹12.2
  // lakh has a perfectly complete surcharge treatment (a computed nil), and
  // saying otherwise would be exactly the kind of untrue status copy `D129`
  // treats as a defect in its own right.
  const rebateRisk = evaluateRebateMarginalReliefRisk(
    ctx.newRegimeTotalIncome,
    ctx.rebateReliefTreatmentSupported,
  );
  // K4-23 review F1: the third blocker. It upgrades the
  // `capital_gains_house_sale` row only — not surcharge, not marginal relief.
  const houseSaleRisk = evaluateHouseSaleLtcgRisk(
    ctx.hasHouseSaleLtcg,
    ctx.houseSaleLtcgTreatmentSupported,
  );
  const matrix = TAX_CAPABILITY_MATRIX.map((entry) => {
    const surchargeApplies = risk !== null && (entry.area === "surcharge" || entry.area === "marginal_relief");
    const rebateApplies = rebateRisk !== null && entry.area === "marginal_relief";
    // K4-23 review F1: upgrades the house-sale row ONLY.
    const houseSaleApplies = houseSaleRisk !== null && entry.area === "capital_gains_house_sale";
    if (!surchargeApplies && !rebateApplies && !houseSaleApplies) return entry;
    if (houseSaleApplies) {
      return {
        ...entry,
        state: "reliance_blocked" as const,
        computationAllowed: false,
        clientApprovalAllowed: false,
        finalizationAllowed: false,
        canonicalOutputAllowed: false,
        reason:
          "The section 112 long-term treatment could not be completed for this case, so the gain " +
          "is excluded from both tax and gross total income — " + entry.reason,
      };
    }
    const prefix = surchargeApplies
      ? `Total income (₹${(risk as SurchargeMarginalReliefBlocker).totalIncome.toLocaleString("en-IN")}) exceeds the ` +
        `conservative sourced risk threshold (₹${(risk as SurchargeMarginalReliefBlocker).thresholdInr.toLocaleString("en-IN")}) — `
      : `New-regime total income (₹${(rebateRisk as RebateMarginalReliefBlocker).totalIncome.toLocaleString("en-IN")}) sits just above the ` +
        `₹${(rebateRisk as RebateMarginalReliefBlocker).ceilingInr.toLocaleString("en-IN")} section 87A rebate ceiling and the relief could not be computed — `;
    return {
      ...entry,
      state: "reliance_blocked" as const,
      clientApprovalAllowed: false,
      finalizationAllowed: false,
      canonicalOutputAllowed: false,
      reason: prefix + entry.reason,
    };
  });
  return {
    matrix,
    blockers: [
      ...(risk ? [risk] : []),
      ...(rebateRisk ? [rebateRisk] : []),
      ...(houseSaleRisk ? [houseSaleRisk] : []),
    ],
    rulesVersion: TAX_CAPABILITY_RULES_VERSION,
  };
}

/** The capability entry for one area, or `undefined`. Callers must handle
 *  absence explicitly — never assume every area is present. */
export function findTaxCapability(
  matrix: readonly TaxCapabilityEntry[],
  area: TaxCapabilityArea,
): TaxCapabilityEntry | undefined {
  return matrix.find((e) => e.area === area);
}
