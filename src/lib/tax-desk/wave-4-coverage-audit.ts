/**
 * TaxDesk OS — Wave-4 (K4-00) common-case coverage audit.
 *
 * PURE TYPESCRIPT ONLY. Like the rest of `src/lib/tax-desk/*`, this module
 * must NOT import React, Next.js, the Supabase client, UI components, server
 * actions, env/config, app routes, or `src/lib/tax-lab/*` (production code
 * never imports the synthetic case laboratory — `tax-lab/__tests__/
 * boundary.test.ts` enforces this).
 *
 * WHAT THIS IS. A read-only, code-derived inventory of what the product
 * actually supports today across six distinct dimensions per ledger
 * category — computation, validation, evidence association, human-acceptance
 * (propose/review/promote), evidence-manifest/output lineage, and
 * capability-matrix filing-readiness state — plus a small set of *silent
 * exclusion* findings this session's audit surfaced by reading the adapter
 * source, not by guessing. It changes no production behaviour: every claim
 * below is derived from the SAME closed vocabularies `ledger.ts`,
 * `tax-capability.ts`, `source-proposals.ts`, and `computation-adapter.ts`
 * already enforce by their own unit tests (same discipline as the Wave-2
 * (`tax-lab/coverage-report.ts`) and Wave-3 (`wave-3-coverage-report.ts`)
 * reports). It introduces no second, independently-maintained vocabulary.
 *
 * WHAT THIS IS NOT. Not a tax-law correctness opinion, not a CA-verification
 * record, not a client-frequency claim (K4-00 could not obtain real
 * operational evidence — see the k4-common-case-coverage-and-priorities design notes §2), and not itself a
 * prioritisation — the ranked Wave-4 roadmap lives in that same markdown
 * document, informed by (but not encoded as executable claims inside) this
 * module. `__tests__/wave-4-coverage-audit.test.ts` pins every number below;
 * a future session that changes ledger/capability/proposal vocabularies
 * fails that guard until this report is consciously reassessed.
 */

import { buildEngineInput, type CaseMeta, type LedgerRows } from "./computation-adapter";
import {
  DEDUCTION_TYPES,
  GAIN_TYPES,
  INCOME_HEADS,
  TAX_PAID_TYPES,
  type DeductionType,
  type GainType,
  type IncomeHead,
  type TaxPaidType,
} from "./ledger";
import {
  TAX_CAPABILITY_MATRIX,
  findTaxCapability,
  type TaxCapabilityArea,
  type TaxCapabilitySupportState,
} from "./tax-capability";
import { PROPOSAL_FACT_KINDS, type ProposalFactKind } from "./source-proposals";

// ---------------------------------------------------------------------------
// Shared harness (mirrors `tax-lab/coverage-report.ts`'s adapter-probe style)
// ---------------------------------------------------------------------------

const META: CaseMeta = {
  assessmentYear: "2026-27",
  financialYear: "2025-26",
  selectedItrType: "ITR-1",
  finalized: false,
};

const EMPTY: LedgerRows = { income: [], taxPaid: [], deductions: [], capitalGains: [] };

export type LedgerComputationSupport = "computed" | "excluded_unsupported" | "excluded_loss_not_modelled";

/** One ledger category's status across every dimension K4-00 was asked to
 *  distinguish (program prompt §6 Objective A) — never collapsed into one
 *  vague "supported" label. */
export interface LedgerCategoryAudit<T extends string> {
  readonly value: T;
  readonly computationSupport: LedgerComputationSupport;
  readonly mappingWarningCodes: readonly string[];
  /** Every ledger row (any kind, any category) carries `source_type` /
   *  `source_document_id` columns — a structural DB fact, not category-
   *  specific — so this is true for every row the engine actually maps.
   *  A row the adapter excludes never contributes a figure, so it is never
   *  meaningfully "associated" with a computed number either. */
  readonly evidenceAssociationSupport: boolean;
  /** Human accept/reject lineage via the K3-30 propose→review→promote
   *  workflow — true ONLY for the two closed `PROPOSAL_FACT_KINDS`
   *  (`income.salary`, `tax_paid.salary_tds`). Every other category has, at
   *  most, source ASSOCIATION (the row above), never a recorded human
   *  ACCEPT/REJECT decision — exactly the D24 distinction. */
  readonly proposalReviewSupport: boolean;
  /** Reachable inside an accepted-evidence manifest's `evidenceFacts` — true
   *  for any category the adapter actually maps (the manifest freezes every
   *  contributing fact from the snapshot's own stored ledger rows, not only
   *  promoted-proposal ones — `evidence-manifest.ts` `resolveEvidenceManifestCandidate`
   *  via `resolveSnapshotEvidenceLineage`). */
  readonly manifestLineageSupport: boolean;
  /** The canonical capability-matrix area this category maps to, when one
   *  exists. `null` for a category with no 1:1 area (e.g. individual
   *  deduction sections, which the matrix does not break out separately). */
  readonly capabilityArea: TaxCapabilityArea | null;
  readonly capabilityState: TaxCapabilitySupportState | null;
}

function proposalReviewSupportFor(factKind: ProposalFactKind | null): boolean {
  return factKind !== null && (PROPOSAL_FACT_KINDS as readonly string[]).includes(factKind);
}

function auditIncomeHead(head: IncomeHead): LedgerCategoryAudit<IncomeHead> {
  const id = `audit_income_${head}`;
  const result = buildEngineInput({ ...EMPTY, income: [{ id, income_head: head, amount: 1, source_type: "manual" }] }, META);
  const mapped = result.input.income.some((e) => e.id === id);
  const warningCodes = result.warnings.filter((w) => w.ledgerId === id).map((w) => w.code);
  const factKind: ProposalFactKind | null = head === "salary" ? "income.salary" : null;
  const area: TaxCapabilityArea | null =
    head === "salary" ? "income_salary_pension" : head === "house_property" ? "house_property" : head === "business_income" ? "business_professional_income" : "income_other_sources";
  return Object.freeze({
    value: head,
    computationSupport: mapped ? "computed" : "excluded_unsupported",
    mappingWarningCodes: Object.freeze(warningCodes),
    evidenceAssociationSupport: mapped,
    proposalReviewSupport: proposalReviewSupportFor(factKind),
    manifestLineageSupport: mapped,
    capabilityArea: area,
    capabilityState: area ? (findTaxCapability(TAX_CAPABILITY_MATRIX, area)?.state ?? null) : null,
  });
}

function auditTaxPaidType(category: TaxPaidType): LedgerCategoryAudit<TaxPaidType> {
  const id = `audit_tax_paid_${category}`;
  const result = buildEngineInput({ ...EMPTY, taxPaid: [{ id, tax_paid_type: category, amount: 1, source_type: "manual" }] }, META);
  const mapped = result.input.taxPaid.some((e) => e.id === id);
  const factKind: ProposalFactKind | null = category === "salary_tds" ? "tax_paid.salary_tds" : null;
  return Object.freeze({
    value: category,
    computationSupport: mapped ? "computed" : "excluded_unsupported",
    mappingWarningCodes: Object.freeze([]),
    evidenceAssociationSupport: mapped,
    proposalReviewSupport: proposalReviewSupportFor(factKind),
    manifestLineageSupport: mapped,
    capabilityArea: null,
    capabilityState: null,
  });
}

function auditDeductionType(section: DeductionType): LedgerCategoryAudit<DeductionType> {
  const id = `audit_deduction_${section}`;
  const result = buildEngineInput({ ...EMPTY, deductions: [{ id, deduction_type: section, amount: 1, source_type: "manual" }] }, META);
  const mapped = result.input.deductions.some((e) => e.id === id);
  return Object.freeze({
    value: section,
    computationSupport: mapped ? "computed" : "excluded_unsupported",
    mappingWarningCodes: Object.freeze([]),
    evidenceAssociationSupport: mapped,
    proposalReviewSupport: false,
    manifestLineageSupport: mapped,
    capabilityArea: null,
    capabilityState: null,
  });
}

function auditGainType(gainType: GainType): LedgerCategoryAudit<GainType> {
  const id = `audit_gain_${gainType}`;
  const row = {
    id,
    gain_type: gainType,
    sale_value: 2,
    cost: 1,
    expenses: 0,
    exemption_claimed: 0,
    taxable_gain: 1,
    source_type: "manual",
    ...(gainType === "house_sale"
      ? {
          transfer_date: "2025-12-01",
          acquisition_date: "2025-01-15",
          stamp_duty_value: 2,
          asset_kind: "building",
          acquisition_mode: "purchase",
          cost_of_improvement: 0,
          house_sale_declarations: [
            "not_agricultural_land",
            "not_depreciable_asset",
            "interest_not_in_cost",
            "agreement_and_registration_same_date",
          ],
        }
      : {}),
  };
  const result = buildEngineInput({ ...EMPTY, capitalGains: [row] }, META);
  const mapped = result.input.capitalGains.some((e) => e.id === id);
  const warningCodes = result.warnings.filter((w) => w.ledgerId === id).map((w) => w.code);
  return Object.freeze({
    value: gainType,
    computationSupport: mapped ? "computed" : "excluded_unsupported",
    mappingWarningCodes: Object.freeze(warningCodes),
    evidenceAssociationSupport: mapped,
    proposalReviewSupport: false,
    manifestLineageSupport: mapped,
    capabilityArea: gainType === "house_sale" ? "capital_gains_house_sale" : "capital_gains_111a_112a",
    capabilityState:
      findTaxCapability(
        TAX_CAPABILITY_MATRIX,
        gainType === "house_sale" ? "capital_gains_house_sale" : "capital_gains_111a_112a",
      )?.state ?? null,
  });
}

/** A NEGATIVE supported gain (a loss) is excluded even for `stcg_111a` /
 *  `ltcg_112a` — distinct from the positive-gain check above, since the
 *  SAME gain type is "computed" when positive and "excluded" when negative. */
function auditGainLoss(gainType: GainType): LedgerCategoryAudit<GainType> {
  const id = `audit_loss_${gainType}`;
  const row = {
    id,
    gain_type: gainType,
    sale_value: 1,
    cost: 2,
    expenses: 0,
    exemption_claimed: 0,
    taxable_gain: -1,
    source_type: "manual",
  };
  const result = buildEngineInput({ ...EMPTY, capitalGains: [row] }, META);
  const mapped = result.input.capitalGains.some((e) => e.id === id);
  const warningCodes = result.warnings.filter((w) => w.ledgerId === id).map((w) => w.code);
  return Object.freeze({
    value: gainType,
    computationSupport: mapped ? "computed" : "excluded_loss_not_modelled",
    mappingWarningCodes: Object.freeze(warningCodes),
    evidenceAssociationSupport: mapped,
    proposalReviewSupport: false,
    manifestLineageSupport: mapped,
    capabilityArea: "loss_set_off_carry_forward",
    capabilityState: findTaxCapability(TAX_CAPABILITY_MATRIX, "loss_set_off_carry_forward")?.state ?? null,
  });
}

export interface Wave4LedgerCoverage {
  readonly income: readonly LedgerCategoryAudit<IncomeHead>[];
  readonly taxPaid: readonly LedgerCategoryAudit<TaxPaidType>[];
  readonly deductions: readonly LedgerCategoryAudit<DeductionType>[];
  readonly capitalGains: readonly LedgerCategoryAudit<GainType>[];
  /** Only `stcg_111a`/`ltcg_112a` are meaningfully checkable for a loss (the
   *  other two gain types are already excluded regardless of sign). */
  readonly capitalGainLosses: readonly LedgerCategoryAudit<GainType>[];
}

const LOSS_CHECKABLE_GAIN_TYPES: readonly GainType[] = ["stcg_111a", "ltcg_112a"];

export function buildWave4LedgerCoverage(): Wave4LedgerCoverage {
  return Object.freeze({
    income: Object.freeze(INCOME_HEADS.map(auditIncomeHead)),
    taxPaid: Object.freeze(TAX_PAID_TYPES.map(auditTaxPaidType)),
    deductions: Object.freeze(DEDUCTION_TYPES.map(auditDeductionType)),
    capitalGains: Object.freeze(GAIN_TYPES.map(auditGainType)),
    capitalGainLosses: Object.freeze(LOSS_CHECKABLE_GAIN_TYPES.map(auditGainLoss)),
  });
}

// ---------------------------------------------------------------------------
// Capability-matrix summary (case-level areas, not ledger categories)
// ---------------------------------------------------------------------------

export interface CapabilityStateSummary {
  readonly totalAreas: number;
  readonly byState: Readonly<Record<TaxCapabilitySupportState, number>>;
  readonly unsupportedOrPartialAreas: readonly TaxCapabilityArea[];
}

export function buildCapabilityStateSummary(): CapabilityStateSummary {
  const byState: Record<TaxCapabilitySupportState, number> = {
    supported: 0,
    partially_supported: 0,
    unsupported: 0,
    reliance_blocked: 0,
  };
  for (const entry of TAX_CAPABILITY_MATRIX) byState[entry.state] += 1;
  const unsupportedOrPartialAreas = TAX_CAPABILITY_MATRIX.filter(
    (e) => e.state === "unsupported" || e.state === "partially_supported",
  ).map((e) => e.area);
  return Object.freeze({
    totalAreas: TAX_CAPABILITY_MATRIX.length,
    byState: Object.freeze(byState),
    unsupportedOrPartialAreas: Object.freeze(unsupportedOrPartialAreas),
  });
}

// ---------------------------------------------------------------------------
// Silent-exclusion findings (program prompt §6's mandatory search)
// ---------------------------------------------------------------------------

export type SilentExclusionRelianceRisk = "active" | "mitigated_by_structural_blocker";

/** A case where a user-entered/collected fact is dropped from computation
 *  with NO blocker or warning explaining the omission — distinct from an
 *  ordinary "unsupported, and safely blocked" gap (house property, business
 *  income, capital losses, other-gain types all raise an explicit
 *  `MappingWarning` the moment a non-zero row exists, which blocks snapshot
 *  creation via `adapter.complete === false`). Findings here are the ones
 *  this audit could NOT find an analogous automatic detector for. */
export interface SilentExclusionFinding {
  readonly code: string;
  readonly summary: string;
  readonly evidence: string;
  readonly relianceRisk: SilentExclusionRelianceRisk;
  readonly relatedCapabilityArea: TaxCapabilityArea;
  /** `null` while still open. Per PROJECT_CONSTITUTION.md §4 ("a completed
   *  session's claims are never silently reversed — corrections are new,
   *  dated entries"), a resolved finding's historical record is KEPT, not
   *  deleted, with the session that closed it named here. */
  readonly resolvedInSession: string | null;
}

export const SILENT_EXCLUSION_FINDINGS: readonly SilentExclusionFinding[] = Object.freeze([
  Object.freeze({
    code: "AGE_CATEGORY_HARDCODED_BELOW_60",
    summary:
      "The taxpayer's date of birth is collected and required (eligibility.ts blocks a case on " +
      "PROFILE_DOB_MISSING), but it never reaches the tax engine. computation-adapter.ts's " +
      "buildEngineInput() hardcodes `taxpayer: { residentStatus: \"resident\", ageCategory: " +
      '"below_60" }` for every case, unconditionally — there is no per-case derivation from the ' +
      "profile's actual date of birth anywhere in the codebase, and no automatic reliance blocker " +
      "analogous to the surcharge/marginal-relief detector (TAX-SAFE-01) fires when a case's " +
      "taxpayer is actually a senior or super-senior citizen. A senior citizen's case can be " +
      "computed, snapshotted, approved, and internally finalized while silently applying below-60 " +
      "slab and deduction treatment (missing senior slab widening, the senior 80D cap, and " +
      "80TTB), with nothing in the UI stating that age was ignored. " +
      "RESOLVED in K4-01: `buildEngineInput()` now derives the real age band from `CaseMeta." +
      "dateOfBirth` via `deriveTaxpayerAgeBand()` (senior-treatment.ts) and propagates the real " +
      "stored `residentialStatus` — never a hardcoded literal — and a real, sourced, automatic " +
      "reliance blocker (`evaluateSeniorTreatmentRisk`, codes `SENIOR_TREATMENT_UNSUPPORTED` / " +
      "`REGIME_COMPARISON_UNRELIABLE` / `RESIDENTIAL_STATUS_UNRESOLVED`) is now wired into filing " +
      "readiness, client review, evidence-manifest creation, and the three protected RPCs. No " +
      "senior/super-senior slab, enlarged basic exemption, 80D senior cap, or 80TTB amount is " +
      "computed — that remains `rules.ts` `NOT_IMPLEMENTED.seniorSlabs`, unchanged. This entry is " +
      "KEPT (not deleted) as the historical record of the finding K4-01 closed. " +
      "STATUS NOTE (AUDIT-03-F5, added by MAINT-03 on 2026-07-27): the sentence above beginning " +
      "\"No senior/super-senior slab…\" was accurate when K4-01 wrote it and is now out of date — " +
      "it is left in place because this paragraph is a kept historical record and " +
      "PROJECT_CONSTITUTION.md §4 forbids rewriting one. What has changed since: K4-02 implemented " +
      "the OLD-regime senior/super-senior basic-exemption widening and REMOVED " +
      "`NOT_IMPLEMENTED.seniorSlabs` entirely, so that identifier no longer exists; K4-03 applied " +
      "the senior 80D cap and 80TTA-vs-80TTB mutual exclusivity for the taxpayer's own age band; " +
      "K4-04 added the Section 207(2) advance-tax exemption as a validation-only disclosure; and " +
      "K4-05 closed the 80D insured-party/parent-premium sub-case and NARROWED " +
      "`SENIOR_TREATMENT_UNSUPPORTED` so a resident senior on the OLD regime is no longer blocked " +
      "solely for age (decision D79). One senior-treatment gap remains open: the self/family 80D " +
      "bucket does not yet widen for a senior SPOUSE (decision D78). See " +
      "the k4-senior-treatment-specification design notes and " +
      "the tax-capability-matrix design notes for the current position.",
    evidence:
      "src/lib/tax-desk/computation-adapter.ts buildEngineInput() (as it stood before K4-01): the " +
      "taxpayer object was a fixed literal; CaseMeta (the function's only other argument) had no " +
      "age/date-of-birth field; a repository-wide search confirmed `ageCategory`/`below_60` " +
      "appeared only inside tax-engine/tax-pack/tax-desk domain and test files — never in " +
      "src/app/actions, src/components, or any query module. TAX_CAPABILITY_MATRIX's " +
      "`senior_citizen_treatment` row was descriptive only: `findTaxCapability` was called nowhere " +
      "outside its own unit test, unlike the surcharge/marginal-relief rows.",
    relianceRisk: "active",
    relatedCapabilityArea: "senior_citizen_treatment",
    resolvedInSession: "K4-01",
  }),
]);

/** Every capability-matrix area with an `unsupported` non-zero ledger entry
 *  DOES raise an explicit blocking warning (`UNSUPPORTED_INCOME_HEAD` /
 *  `UNSUPPORTED_GAIN_TYPE` / `CAPITAL_LOSS_NOT_MODELLED`), which blocks
 *  snapshot creation via `adapter.complete === false` — this list documents
 *  that those are NOT silent exclusions, precisely because the audit checked
 *  and confirmed a blocker exists, rather than assuming one does. */
export const CONFIRMED_NON_SILENT_UNSUPPORTED_AREAS: readonly TaxCapabilityArea[] = Object.freeze([
  "house_property",
  "business_professional_income",
  "loss_set_off_carry_forward",
]);
