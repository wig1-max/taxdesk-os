/**
 * K4-10 — brought-forward capital-loss set-off (Section 74), the MULTI-YEAR
 * half of Wave-4 priority #5. `K4-09` shipped the within-year half (ss.70/71).
 *
 * PIPELINE POSITION IS LOAD-BEARING. Within-year set-off runs FIRST and is
 * untouched by this module: it consumes the current year's own gains and
 * losses (ss.70/71), and only what SURVIVES it is available to absorb a
 * brought-forward loss (s.74). Every function here takes the NET post-
 * within-year figures as its input, so a case with no brought-forward record
 * is byte-identical to what `K4-09` computed — proved by the pre-existing
 * golden fixtures passing unchanged, not asserted.
 *
 * WHAT THIS MODULE DOES AND DOES NOT DECIDE:
 *
 *   - It applies Section 74(1)(a)/(b) — WHICH buckets a loss type may lawfully
 *     reach. That is statute.
 *   - It applies Section 74(2) — the eight assessment years immediately
 *     succeeding the year the loss was first computed. That is statute.
 *   - It applies Section 139(3)/80 CONSERVATIVELY — an unverified filing
 *     eligibility is never treated as eligible.
 *   - It does NOT decide a mandatory SEQUENCE, because no source establishes
 *     one. The sequence comes from a named, versioned
 *     {@link LossAllocationPolicy}, and the Tax Desk adapter admits only cases
 *     in which every lawful policy agrees — see `computation-adapter.ts`'s
 *     `broughtForwardAllocationIsForced`.
 *
 * GENERATION vs CONSUMPTION. This module CONSUMES a brought-forward loss. It
 * does not GENERATE a new carry-forward record from a current-year residual —
 * `K4-09`'s `CAPITAL_LOSS_NOT_MODELLED` still refuses that case, deliberately
 * and unchanged. Widening it would reopen `D93`'s Q1 (whether the residual is
 * measured against gross 112A gain or the part above the Rs.1,25,000
 * exemption), which is answered only on portal-conformance evidence.
 *
 * PURE: no React/Next/Supabase/env/route imports.
 */

import {
  findLossAllocationPolicy,
  type LossAllocationPolicyId,
} from "./loss-allocation-policy";
import { CAPITAL_LOSS_SET_OFF } from "./rules";
import type {
  BroughtForwardAllocation,
  BroughtForwardElectionDivergence,
  BroughtForwardExclusion,
  BroughtForwardLossEntry,
  BroughtForwardLossSetOff,
  BroughtForwardResidual,
  BroughtForwardSetOffTarget,
} from "./types";

// ---------------------------------------------------------------------------
// Assessment-year arithmetic (Section 74(2))
// ---------------------------------------------------------------------------

const ASSESSMENT_YEAR_PATTERN = /^(\d{4})-(\d{2})$/;

/**
 * The starting calendar year of an assessment year written `YYYY-YY`, or
 * `null` when the string is not a well-formed assessment year OR its two
 * halves are inconsistent (`2026-28` is refused, not silently read as 2026).
 *
 * Returning `null` rather than throwing is deliberate: a malformed stored
 * value must become a VISIBLE exclusion with a reason, never a crash on a
 * preparer's screen and never a guessed year.
 */
export function assessmentYearStartYear(assessmentYear: string): number | null {
  const match = ASSESSMENT_YEAR_PATTERN.exec(assessmentYear.trim());
  if (!match) return null;
  const start = Number(match[1]);
  const endTwoDigits = Number(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(endTwoDigits)) return null;
  if ((start + 1) % 100 !== endTwoDigits) return null;
  return start;
}

/** The inverse of {@link assessmentYearStartYear}: 2026 -> `"2026-27"`. */
export function assessmentYearFromStartYear(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/**
 * The LAST assessment year in which a loss first computed in
 * `originatingAssessmentYear` may still be set off.
 *
 * Section 74(2): the loss may be carried forward to the EIGHT assessment years
 * IMMEDIATELY SUCCEEDING the assessment year in which it was first computed.
 * So a loss first computed in AY 2018-19 survives through AY 2026-27
 * (2018 + 8 = 2026) and lapses from AY 2027-28.
 *
 * Sourced independently for `K4-10` (2026-08-01) and CONFIRMING rather than
 * discovering — ClearTax's set-off/carry-forward guide, directly retrieved,
 * states the loss "can be carried forward for 8 assessment years immediately
 * following the assessment year in which the loss was first computed";
 * taxguru.in corroborates the eight-year figure and the long-term-loss-only-
 * against-long-term-gain restriction. `incometaxindia.gov.in` returned HTTP
 * 403 for the SIXTH consecutive session (K4-06…TAX-SAFE-02, now K4-10) —
 * recorded, never silently substituted (D67). `K4-09`'s D94 had already
 * corroborated the same boundary from three sources.
 */
export function finalEligibleAssessmentYear(originatingStartYear: number): string {
  return assessmentYearFromStartYear(
    originatingStartYear + CAPITAL_LOSS_SET_OFF.carryForwardAssessmentYears,
  );
}

// ---------------------------------------------------------------------------
// Record classification — expiry, filing eligibility, well-formedness
// ---------------------------------------------------------------------------

export type BroughtForwardAdmission =
  | { readonly admitted: true; readonly originatingStartYear: number }
  | { readonly admitted: false; readonly exclusion: BroughtForwardExclusion };

function excludeRecord(
  entry: BroughtForwardLossEntry,
  reason: BroughtForwardExclusion["reason"],
  message: string,
): BroughtForwardAdmission {
  return {
    admitted: false,
    exclusion: {
      recordId: entry.id,
      originatingAssessmentYear: entry.originatingAssessmentYear,
      lossType: entry.lossType,
      amount: entry.amount,
      reason,
      message,
    },
  };
}

/**
 * Decides whether ONE brought-forward record may be used this assessment year.
 *
 * The three exclusion outcomes are NOT interchangeable, and the difference is
 * what makes this honest rather than merely conservative:
 *
 *   - `expired_8_assessment_years` and `filing_not_eligible` are POSITIVE legal
 *     conclusions — the loss genuinely may not be used. The record is excluded
 *     VISIBLY, with a disclosure naming the originating assessment year. It is
 *     never silently dropped, and it does not block the case, because the
 *     correct treatment is known.
 *   - `filing_eligibility_unverified` is an ABSENCE of knowledge. It FAILS
 *     CLOSED: the record is excluded here as defence in depth, and the adapter
 *     refuses the whole case rather than compute a figure that assumes an
 *     unchecked Section 139(3)/80 condition was satisfied.
 *
 * A malformed or non-prior originating year is likewise excluded with a stated
 * reason rather than guessed at.
 */
export function admitBroughtForwardRecord(
  entry: BroughtForwardLossEntry,
  currentAssessmentYear: string,
): BroughtForwardAdmission {
  const currentStart = assessmentYearStartYear(currentAssessmentYear);
  const originatingStart = assessmentYearStartYear(entry.originatingAssessmentYear);

  if (originatingStart === null || currentStart === null) {
    return excludeRecord(
      entry,
      "unparseable_originating_assessment_year",
      `Brought-forward loss record for "${entry.originatingAssessmentYear}" was excluded: the ` +
        "originating assessment year is not a well-formed YYYY-YY assessment year, so its Section " +
        "74(2) eight-year window cannot be evaluated. No year was assumed.",
    );
  }

  if (originatingStart >= currentStart) {
    return excludeRecord(
      entry,
      "not_a_prior_assessment_year",
      `Brought-forward loss record for AY ${entry.originatingAssessmentYear} was excluded: a ` +
        `brought-forward loss must originate in an assessment year EARLIER than the current one ` +
        `(AY ${currentAssessmentYear}). A current-year loss is set off under Sections 70/71, not ` +
        "carried forward under Section 74.",
    );
  }

  if (currentStart > originatingStart + CAPITAL_LOSS_SET_OFF.carryForwardAssessmentYears) {
    return excludeRecord(
      entry,
      "expired_8_assessment_years",
      `Brought-forward loss of Rs.${entry.amount} from AY ${entry.originatingAssessmentYear} has ` +
        `EXPIRED and was excluded. Section 74(2) allows carry-forward for the ` +
        `${CAPITAL_LOSS_SET_OFF.carryForwardAssessmentYears} assessment years immediately ` +
        `succeeding the year the loss was first computed, so this loss could last be set off in ` +
        `AY ${finalEligibleAssessmentYear(originatingStart)}.`,
    );
  }

  if (entry.filingEligibility === "not_eligible") {
    return excludeRecord(
      entry,
      "filing_not_eligible",
      `Brought-forward loss of Rs.${entry.amount} from AY ${entry.originatingAssessmentYear} was ` +
        "excluded: it is recorded as NOT eligible to be carried forward, because the loss return " +
        "for that year was not filed by the due date (Sections 139(3) and 80).",
    );
  }

  if (entry.filingEligibility === "unverified") {
    return excludeRecord(
      entry,
      "filing_eligibility_unverified",
      `Brought-forward loss of Rs.${entry.amount} from AY ${entry.originatingAssessmentYear} was ` +
        "excluded: whether the loss return for that year was filed by the due date (Sections " +
        "139(3) and 80) has NOT been verified. An unverified condition is never treated as " +
        "satisfied — confirm the filing date and record it before relying on this loss.",
    );
  }

  return { admitted: true, originatingStartYear: originatingStart };
}

// ---------------------------------------------------------------------------
// Allocation
// ---------------------------------------------------------------------------

/**
 * The buckets a loss type may LAWFULLY reach — Section 74(1)(a)/(b). This is
 * statute and constrains every policy equally; it is not an ordering.
 */
export function lawfulTargetsFor(
  lossType: BroughtForwardLossEntry["lossType"],
): readonly BroughtForwardSetOffTarget[] {
  // s.74(1)(b): a long-term loss may be set off only against long-term gains.
  // s.74(1)(a): a short-term loss may be set off against either.
  return lossType === "ltcl" ? ["ltcg_112a"] : ["stcg_111a", "ltcg_112a"];
}

/**
 * The order in which a policy walks the admitted records.
 *
 * For `portal_default_ay2026_27` this reproduces the official utility's
 * observed default — brought-forward LTCL before brought-forward STCL
 * (`CYLACalculations.bas:6259` vs `6621`) — and, WITHIN a loss type, consumes
 * the oldest originating assessment year first. The intra-type part is
 * declared in the policy's own `unreproducedAspects`: no official artifact was
 * found stating one, and the adapter refuses any case in which it could change
 * a recorded residual.
 */
function orderedForPolicy(
  entries: readonly BroughtForwardLossEntry[],
  originatingStartYears: ReadonlyMap<string, number>,
): readonly BroughtForwardLossEntry[] {
  const typeRank = (t: BroughtForwardLossEntry["lossType"]) => (t === "ltcl" ? 0 : 1);
  return [...entries].sort((a, b) => {
    const byType = typeRank(a.lossType) - typeRank(b.lossType);
    if (byType !== 0) return byType;
    const byYear = (originatingStartYears.get(a.id) ?? 0) - (originatingStartYears.get(b.id) ?? 0);
    if (byYear !== 0) return byYear;
    // Stable, id-ordered tiebreak so the result never depends on row arrival
    // order — the same discipline `K4-09` applied to within-year aggregation.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * The bucket order a policy tries for a given loss type. For the portal
 * default a short-term loss is routed to short-term gains before long-term
 * gains, reproducing `SchCG.bas:7787 setOffPctg20Loss_STCG` (STCG 30% -> STCG
 * applicable rate -> LTCG 12.5%, carrying the residual between steps).
 */
function targetOrderFor(
  lossType: BroughtForwardLossEntry["lossType"],
): readonly BroughtForwardSetOffTarget[] {
  return lawfulTargetsFor(lossType);
}

export interface BroughtForwardSetOffInput {
  readonly currentAssessmentYear: string;
  /** Short-term 111A gains SURVIVING within-year set-off. Never negative. */
  readonly netStcg111a: number;
  /** Long-term 112A gains SURVIVING within-year set-off. Never negative. */
  readonly netLtcg112a: number;
  readonly entries: readonly BroughtForwardLossEntry[];
  readonly policyId: LossAllocationPolicyId;
}

/**
 * Applies brought-forward capital losses to the gains surviving within-year
 * set-off, under one NAMED, VERSIONED allocation policy.
 *
 * Every allocation and every residual is recorded explicitly — which loss
 * (originating AY + type) was applied against which gain bucket, in what
 * amount, under which policy, leaving what residual to carry forward and until
 * when. A residual that is computed but not recorded is precisely the defect
 * this shape exists to prevent.
 *
 * Called DIRECTLY, this function will compute an allocation for any input,
 * including one where two lawful policies would disagree — deliberately, and
 * pinned by its own direct-call tests. The Tax Desk adapter is the single
 * authority that decides which cases may reach a preparer (`AUDIT-04-F2` /
 * **D105**: making the engine refuse would create a second authority for a
 * decision the adapter owns).
 */
interface AllocationPass {
  readonly allocations: readonly BroughtForwardAllocation[];
  readonly residuals: readonly BroughtForwardResidual[];
  readonly remaining: Record<BroughtForwardSetOffTarget, number>;
  /** Records whose election names a bucket Section 74(1) does not permit. */
  readonly unlawfulElectionIds: readonly string[];
}

/**
 * ONE allocation pass over the admitted records.
 *
 * `honourElections = false` produces the pure portal-default result, ignoring
 * every election. `honourElections = true` sends each electing record to its
 * elected bucket only. Running BOTH and comparing them is how a
 * taxpayer-elected allocation is checked against portal behaviour — a real
 * comparison of two computed results, not an inference from the election's
 * shape.
 */
function allocationPass(
  ordered: readonly BroughtForwardLossEntry[],
  originatingStartYears: ReadonlyMap<string, number>,
  currentAssessmentYear: string,
  netStcg111a: number,
  netLtcg112a: number,
  policyId: LossAllocationPolicyId,
  honourElections: boolean,
): AllocationPass {
  const remaining: Record<BroughtForwardSetOffTarget, number> = {
    stcg_111a: Math.max(0, netStcg111a),
    ltcg_112a: Math.max(0, netLtcg112a),
  };
  const allocations: BroughtForwardAllocation[] = [];
  const residuals: BroughtForwardResidual[] = [];
  const unlawfulElectionIds: string[] = [];
  const currentStart = assessmentYearStartYear(currentAssessmentYear);

  for (const entry of ordered) {
    const lawful = lawfulTargetsFor(entry.lossType);
    const election = honourElections ? (entry.electedSetOffTarget ?? null) : null;
    let unabsorbed = Math.max(0, entry.amount);

    if (election !== null && !lawful.includes(election)) {
      // An unlawful election is never quietly re-aimed at the lawful bucket —
      // that would substitute the engine's judgement for the taxpayer's
      // without saying so. The record is left wholly unabsorbed and the case
      // stops for review upstream.
      unlawfulElectionIds.push(entry.id);
    } else {
      for (const target of election !== null ? [election] : targetOrderFor(entry.lossType)) {
        if (unabsorbed <= 0) break;
        const available = remaining[target];
        if (available <= 0) continue;
        const applied = Math.min(unabsorbed, available);
        remaining[target] = available - applied;
        unabsorbed -= applied;
        allocations.push({
          recordId: entry.id,
          originatingAssessmentYear: entry.originatingAssessmentYear,
          lossType: entry.lossType,
          target,
          amount: applied,
          policyId,
        });
      }
    }

    if (unabsorbed > 0) {
      const startYear = originatingStartYears.get(entry.id);
      residuals.push({
        recordId: entry.id,
        originatingAssessmentYear: entry.originatingAssessmentYear,
        lossType: entry.lossType,
        amount: unabsorbed,
        finalEligibleAssessmentYear:
          startYear === undefined
            ? entry.originatingAssessmentYear
            : finalEligibleAssessmentYear(startYear),
        expiresAfterThisYear:
          startYear !== undefined &&
          currentStart !== null &&
          currentStart === startYear + CAPITAL_LOSS_SET_OFF.carryForwardAssessmentYears,
      });
    }
  }

  return { allocations, residuals, remaining, unlawfulElectionIds };
}

/** Comparable fingerprint of one pass's per-record, per-bucket allocation. */
function allocationFingerprint(pass: AllocationPass): string {
  return [...pass.allocations]
    .map((a) => `${a.recordId}|${a.target}|${a.amount}`)
    .sort()
    .join(";");
}

export function computeBroughtForwardSetOff(
  input: BroughtForwardSetOffInput,
): BroughtForwardLossSetOff {
  const policy = findLossAllocationPolicy(input.policyId);
  const excluded: BroughtForwardExclusion[] = [];
  const admitted: BroughtForwardLossEntry[] = [];
  const originatingStartYears = new Map<string, number>();

  for (const entry of input.entries) {
    const decision = admitBroughtForwardRecord(entry, input.currentAssessmentYear);
    if (!decision.admitted) {
      excluded.push(decision.exclusion);
      continue;
    }
    originatingStartYears.set(entry.id, decision.originatingStartYear);
    admitted.push(entry);
  }

  const ordered = orderedForPolicy(admitted, originatingStartYears);
  const honourElections = policy.id === "taxpayer_elected";
  const pass = allocationPass(
    ordered,
    originatingStartYears,
    input.currentAssessmentYear,
    input.netStcg111a,
    input.netLtcg112a,
    policy.id,
    honourElections,
  );

  // The election check: compute what the PORTAL DEFAULT would have produced on
  // the identical inputs and compare the two results. Divergence is recorded,
  // never resolved here — a diverging election is neither silently replaced by
  // the default nor silently accepted; the adapter stops the case for review.
  const electionDivergences: BroughtForwardElectionDivergence[] = [];
  if (honourElections) {
    const baseline = allocationPass(
      ordered,
      originatingStartYears,
      input.currentAssessmentYear,
      input.netStcg111a,
      input.netLtcg112a,
      policy.id,
      false,
    );
    const unlawful = new Set(pass.unlawfulElectionIds);
    for (const entry of ordered) {
      const election = entry.electedSetOffTarget ?? null;
      if (election === null) continue;
      if (unlawful.has(entry.id)) {
        electionDivergences.push({
          recordId: entry.id,
          originatingAssessmentYear: entry.originatingAssessmentYear,
          lossType: entry.lossType,
          electedTarget: election,
          kind: "unlawful_target",
          message:
            `The taxpayer-elected set-off target for the AY ${entry.originatingAssessmentYear} ` +
            "brought-forward LONG-TERM loss is not lawful under Section 74(1)(b), which permits a " +
            "long-term capital loss to be set off only against long-term capital gains. The " +
            "election was neither applied nor replaced — this case stops for review.",
        });
      }
    }
    if (allocationFingerprint(pass) !== allocationFingerprint(baseline)) {
      for (const entry of ordered) {
        const election = entry.electedSetOffTarget ?? null;
        if (election === null || unlawful.has(entry.id)) continue;
        electionDivergences.push({
          recordId: entry.id,
          originatingAssessmentYear: entry.originatingAssessmentYear,
          lossType: entry.lossType,
          electedTarget: election,
          kind: "diverges_from_portal_default",
          message:
            `The taxpayer-elected set-off target for the AY ${entry.originatingAssessmentYear} ` +
            "brought-forward loss is lawful, but the resulting allocation is NOT what the portal " +
            "default for ITR-2 utility v1.2 / JSON schema v1.1 / validation rules v1.0 produces on " +
            "the same figures. It was neither silently replaced by the default nor silently " +
            "accepted — this case stops for review.",
        });
      }
    }
  }

  return {
    policyId: policy.id,
    policyVersion: policy.version,
    requiresProfessionalReview: policy.requiresProfessionalReview,
    auditFlagged: policy.auditFlagged,
    availableStcg111a: Math.max(0, input.netStcg111a),
    availableLtcg112a: Math.max(0, input.netLtcg112a),
    absorbedAgainstStcg: Math.max(0, input.netStcg111a) - pass.remaining.stcg_111a,
    absorbedAgainstLtcg: Math.max(0, input.netLtcg112a) - pass.remaining.ltcg_112a,
    allocations: [...pass.allocations],
    residuals: [...pass.residuals],
    excluded,
    electionDivergences,
  };
}

/**
 * Which allocation policy governs a set of records — DERIVED from the records
 * themselves, so there is exactly one authority for the answer.
 *
 * Any record carrying a taxpayer election puts the WHOLE case under
 * `taxpayer_elected`, with its professional-review and audit flags. Mixing an
 * elected record with unelected ones does not produce a hybrid: the case
 * carries a human allocation decision, and that is what a reviewer needs to
 * know.
 */
export function resolveLossAllocationPolicyId(
  entries: readonly BroughtForwardLossEntry[],
): LossAllocationPolicyId {
  return entries.some((e) => (e.electedSetOffTarget ?? null) !== null)
    ? "taxpayer_elected"
    : "portal_default_ay2026_27";
}

/** Total brought-forward loss absorbed, across both buckets. */
export function totalBroughtForwardAbsorbed(setOff: BroughtForwardLossSetOff): number {
  return setOff.absorbedAgainstStcg + setOff.absorbedAgainstLtcg;
}

/** Total residual carried forward to the next assessment year. */
export function totalBroughtForwardResidual(setOff: BroughtForwardLossSetOff): number {
  return setOff.residuals.reduce((sum, r) => sum + r.amount, 0);
}
