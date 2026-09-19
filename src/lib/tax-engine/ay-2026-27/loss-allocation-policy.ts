/**
 * K4-10 — VERSIONED capital-loss allocation policies.
 *
 * This module exists because of one hard constraint in the `K4-10` release
 * boundary (**D112** and **D113**): **there is no single hard-coded "statutory
 * allocation order" to ship.**
 *
 * `TAX-SAFE-02` and `TAX-SAFE-02A` searched for one and did not find it. No
 * CBDT circular or rule was located making any intra-head rate-bucket sequence
 * legally mandatory; official ITAT orders (relying on *CIT v Rungamatee
 * Trexim*, Calcutta HC) hold that Section 70 creates no rate compartments and
 * no compulsory chronology, so a taxpayer may choose a lawful beneficial
 * allocation. NEITHER ITR validation-rules PDF prescribes any rate-bucket
 * order, and NEITHER JSON schema does — all 53 (ITR-2) / 56 (ITR-3) "set off"
 * rules are arithmetic-consistency rules (**D114**).
 *
 * What DOES exist is the behaviour of one released version of one official
 * utility, plus that utility's own admission that the behaviour is a default:
 * `CG_Calc.doSetoff` branches on `CG_TableE_Checkbox` into a **user-entered**
 * Schedule CG Table E allocation. So the utility treats its sequence as a
 * default over a taxpayer-supplied one, not as the only expressible result.
 *
 * Hence two policies, each named for what it actually is:
 *
 *   - {@link PORTAL_DEFAULT_AY2026_27} — "portal default for these artifact
 *     versions". Pinned to the artifacts it was validated against, so a
 *     utility/schema/validation-rules revision trips
 *     {@link assertPortalDefaultArtifactsUnchanged} rather than silently
 *     changing results.
 *   - {@link TAXPAYER_ELECTED} — an explicit lawful taxpayer allocation,
 *     carrying a professional-review flag and an audit flag. An election that
 *     does not reproduce current portal behaviour **stops for review**; it is
 *     never silently replaced by the default and never silently accepted.
 *
 * NOTHING in this module may be described as mandatory statute in a rule
 * summary, a caveat, UI copy or a disclosure. The only statutory facts in play
 * are Section 74(1)(a)/(b) (which BUCKETS a loss type may lawfully reach) and
 * Section 74(2) (the eight-assessment-year ceiling) — both of which constrain
 * every policy here equally, and neither of which fixes a SEQUENCE.
 *
 * PURE: no React/Next/Supabase/env/route imports.
 */

/** The artifact versions {@link PORTAL_DEFAULT_AY2026_27} was validated against. */
export interface PortalArtifactVersions {
  /** ITR-2 offline/Excel utility version. */
  readonly itr2Utility: string;
  /** ITR-2 JSON schema version. */
  readonly jsonSchema: string;
  /** ITR-2 validation-rules document version. */
  readonly validationRules: string;
}

/**
 * The pinned artifact versions. Recorded in `docs/evidence/d93-ay-2026-27/`
 * and independently hash-verified by `TAX-SAFE-02A` (**D114**).
 *
 * Changing any of these is a REVALIDATION EVENT, not an edit: the observed
 * portal behaviour below was read out of these exact artifacts, and a revision
 * may change it. See {@link assertPortalDefaultArtifactsUnchanged}.
 */
export const PORTAL_DEFAULT_ARTIFACT_VERSIONS: PortalArtifactVersions = Object.freeze({
  itr2Utility: "v1.2",
  jsonSchema: "v1.1",
  validationRules: "v1.0",
});

export const LOSS_ALLOCATION_POLICY_IDS = ["portal_default_ay2026_27", "taxpayer_elected"] as const;
export type LossAllocationPolicyId = (typeof LOSS_ALLOCATION_POLICY_IDS)[number];

export interface LossAllocationPolicy {
  readonly id: LossAllocationPolicyId;
  /** Bumped when the policy's own behaviour changes, independently of the pack. */
  readonly version: string;
  /**
   * Preparer-facing description. MUST characterise a sequence as a default for
   * named artifact versions — never as "the statutory order".
   */
  readonly description: string;
  /** Artifact versions this policy's observed behaviour was read from, if any. */
  readonly validatedAgainst: PortalArtifactVersions | null;
  /** A case computed under this policy requires independent professional review. */
  readonly requiresProfessionalReview: boolean;
  /** A case computed under this policy is flagged for audit. */
  readonly auditFlagged: boolean;
  /**
   * Behaviours this policy applies that were NOT reproduced from an official
   * artifact. Honest limits, surfaced rather than buried — the adapter refuses
   * every case in which any of these could change a figure, so none of them
   * reaches a preparer, but they are recorded because that could change.
   */
  readonly unreproducedAspects: readonly string[];
}

/**
 * The official utility's OBSERVED default sequence, for the pinned artifact
 * versions. Reproduced from the byte-verified workbook by `TAX-SAFE-02A`
 * (**D114**), not read from prose:
 *
 *   - brought-forward LTCL is consumed BEFORE brought-forward STCL
 *     (`CYLACalculations.bas:6256-6259` loads and sets off `LTCGLossCF8`
 *     first; the first brought-forward STCL consumption is at line 6621);
 *   - an active short-term loss is routed STCG 30% -> STCG applicable rate ->
 *     LTCG 12.5%, carrying the residual between steps
 *     (`SchCG.bas:7787 setOffPctg20Loss_STCG`) — i.e. SHORT-TERM buckets
 *     before the long-term one;
 *   - the surviving 12.5% pool is assigned to Section 112A first in the
 *     Schedule SI redistribution (`CG_Calc.bas:889-901`);
 *   - the Rs.1,25,000 Section 112A threshold is taken FROM the post-set-off
 *     figure (`SPI - SI` `P3 = MIN(125000,H28)`), never subtracted from the
 *     gross Schedule 112A gain beforehand.
 *
 * This is **portal-conformance evidence, not statute.**
 */
export const PORTAL_DEFAULT_AY2026_27: LossAllocationPolicy = Object.freeze({
  id: "portal_default_ay2026_27",
  version: "K4-10.allocation.v1",
  description:
    "Portal default for ITR-2 utility v1.2 / JSON schema v1.1 / validation rules v1.0: a " +
    "brought-forward long-term loss is consumed before a brought-forward short-term loss, and a " +
    "brought-forward short-term loss is routed to short-term (111A) gains before long-term (112A) " +
    "gains. This reproduces the official utility's observed default for those artifact versions. It " +
    "is NOT a statutory ordering rule — no CBDT circular or rule prescribing an intra-head " +
    "rate-bucket sequence was located, and official ITAT orders recognise a taxpayer's lawful " +
    "beneficial allocation. The Rs.1,25,000 Section 112A threshold applies to the 112A income " +
    "SURVIVING set-off, under the same portal-conformance evidence.",
  validatedAgainst: PORTAL_DEFAULT_ARTIFACT_VERSIONS,
  requiresProfessionalReview: false,
  auditFlagged: false,
  unreproducedAspects: Object.freeze([
    "Ordering BETWEEN two brought-forward records of the SAME loss type (this policy consumes the " +
      "oldest originating assessment year first). No official artifact was found stating an " +
      "intra-type order, and the choice changes which record's residual survives and therefore when " +
      "it expires under Section 74(2). The Tax Desk adapter refuses any case in which this could " +
      "change a recorded residual, so it never reaches a preparer.",
    "The resident basic-exemption shortfall intermediary between the post-BFLA Section 112A figure " +
      "and the figure actually taxed. `TAX-SAFE-02A` classified this step as externally sourced but " +
      "NOT reproduced, and the `G28`->`H28` link as inferred (no module among the 151 recovered " +
      "writes `temp112A_125_exmp_New`). Not modelled here; a case whose result would depend on it " +
      "fails closed.",
  ]),
});

/**
 * An explicit lawful allocation chosen by the taxpayer. Always carries a
 * professional-review flag and an audit flag: the whole point is that a human
 * decided something the engine did not, so a human must review it.
 *
 * Divergence from portal behaviour is NOT resolved here — it is REFUSED
 * upstream (the Tax Desk adapter stops the case for review). This policy never
 * silently substitutes the portal default for an election, and never silently
 * accepts an election that current portal behaviour would not reproduce.
 */
export const TAXPAYER_ELECTED: LossAllocationPolicy = Object.freeze({
  id: "taxpayer_elected",
  version: "K4-10.allocation.v1",
  description:
    "Taxpayer-elected allocation. The taxpayer has nominated which gain bucket a brought-forward " +
    "loss is set off against, as the official utility's own Schedule CG Table E path allows. This " +
    "requires independent professional review and is flagged for audit. An election that does not " +
    "reproduce the portal default for the pinned artifact versions stops for review — it is never " +
    "silently replaced by the default, and never silently accepted.",
  validatedAgainst: null,
  requiresProfessionalReview: true,
  auditFlagged: true,
  unreproducedAspects: Object.freeze([
    "The lawfulness of a particular election is not adjudicated by this engine beyond the Section " +
      "74(1)(a)/(b) destination test (a long-term loss may reach only long-term gains). Whether a " +
      "given beneficial allocation withstands scrutiny in the taxpayer's own jurisdiction is a " +
      "professional judgement — ITAT orders bind their parties and are persuasive only.",
  ]),
});

export const LOSS_ALLOCATION_POLICIES: Readonly<Record<LossAllocationPolicyId, LossAllocationPolicy>> =
  Object.freeze({
    portal_default_ay2026_27: PORTAL_DEFAULT_AY2026_27,
    taxpayer_elected: TAXPAYER_ELECTED,
  });

export function findLossAllocationPolicy(id: LossAllocationPolicyId): LossAllocationPolicy {
  return LOSS_ALLOCATION_POLICIES[id];
}

/**
 * The revalidation gate, in code rather than in prose. Call with the artifact
 * versions currently in force; a mismatch means the portal-default policy's
 * observed behaviour must be re-derived from the new artifacts before it may
 * be relied on again.
 *
 * Returns the list of MISMATCHED artifact names (empty = unchanged) rather
 * than throwing, so a caller can surface a disclosure instead of crashing a
 * preparer's screen.
 */
export function portalDefaultArtifactDrift(current: PortalArtifactVersions): readonly string[] {
  const drift: string[] = [];
  if (current.itr2Utility !== PORTAL_DEFAULT_ARTIFACT_VERSIONS.itr2Utility) drift.push("itr2Utility");
  if (current.jsonSchema !== PORTAL_DEFAULT_ARTIFACT_VERSIONS.jsonSchema) drift.push("jsonSchema");
  if (current.validationRules !== PORTAL_DEFAULT_ARTIFACT_VERSIONS.validationRules) {
    drift.push("validationRules");
  }
  return drift;
}

/** True when the pinned artifacts are unchanged and the policy may be applied. */
export function assertPortalDefaultArtifactsUnchanged(current: PortalArtifactVersions): boolean {
  return portalDefaultArtifactDrift(current).length === 0;
}
