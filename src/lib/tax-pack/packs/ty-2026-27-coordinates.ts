/**
 * TaxDesk OS — the TY 2026-27 / Income-tax Act, 2025 world's IDENTITY
 * COORDINATES (`K4-PORT-02`, decision `D299`).
 *
 * PURE TYPESCRIPT ONLY.
 *
 * WHY THIS FILE EXISTS. The AY 2026-27 world takes its coordinates from the
 * engine's own `rules.ts` (`ASSESSMENT_YEAR`, `RULES_VERSION`), so both the
 * pack and its rate-parameter set can read them without importing each other.
 * The 2025 world has no engine module to play that part, and `K4-PORT-02` gave
 * its pack a rate-parameter set that must name the pack it belongs to — which
 * would have made `ty-2026-27.ts` and `ty-2026-27-rate-parameters.ts` import
 * each other. These two constants are lifted here so neither has to.
 *
 * They are IDENTITY facts, not rate facts, and they stay identity facts: no
 * tax figure, threshold or rate may ever be added to this file.
 */

/**
 * The statutory period this world stands for, in the 2025 Act's own counting
 * model (a tax year, not an assessment year).
 *
 * Deliberately a local constant: it must NOT be imported from the AY 2026-27
 * engine, whose `ASSESSMENT_YEAR` happens to share the string `"2026-27"` but
 * means a different thing under a different Act.
 */
export const TY_2026_27_PERIOD = "2026-27";

/**
 * The world's rules-version coordinate. The name states its own status so the
 * canonical pack key is self-describing wherever it is stored or logged:
 * `IN:ITA_2025:tax_year:2026-27:TY_2026_27_NO_COMPUTATION_SURFACE`.
 *
 * ── RENAMED TWICE, AND BOTH RENAMES ARE THE SAME MOVE ──────────────────────
 *
 * `K4-PORT-02` (`D299`) renamed it from `TY_2026_27_UNSUPPORTED_STUB` to
 * `TY_2026_27_NO_RATE_AUTHORITY`, on two grounds: "stub" had stopped being
 * accurate (the pack declares 25 rule groups of provenance and a full statutory
 * rate-parameter set, and carries a `binding`), and the new name stated the
 * BLOCKER, which is the useful fact for the next session.
 *
 * **`K4-PORT-04` (`D314`) renames it again for exactly that second reason, which
 * cut the other way the moment the blocker moved.** `NO_RATE_AUTHORITY` became a
 * FALSE STATEMENT in an identity string that is stored and logged: this world
 * now holds and cites its rate authority — Income-tax Act, 2025 s.202(1) read
 * with Finance Act, 2026 s.3(3), First Schedule Part I-B, s.3(15), and
 * Income-tax Rules, 2026 rule 164(3)(k) — and supplies all six rate parameters.
 * What actually stops it computing is that **no arithmetic is wired to it**: the
 * pack's binding carries no `computation` surface. The name says that instead.
 *
 * A name that states a blocker has to be re-read every time the blocker moves.
 * That is a cost of the convention, not an argument against it — a version
 * string carrying a stale claim is worse than one carrying none, and this
 * repository has been bitten by stale claims far more often than by renames.
 *
 * **NEITHER rename is a `D276` computation-behaviour bump**, and must not be read
 * as one: nothing computed before either rename and nothing computes after them.
 * Both were safe for the same reason — no stored row could reference this
 * coordinate. **`K4-PORT-05` / `D316` (slice 3) expired that argument:** a
 * case row can now carry `law = ITA_2025` and store this key in
 * `tax_cases.tax_pack_key`. A rename after this lands needs a migration that
 * updates stored keys, not a decision alone. The coordinate is NOT renamed
 * here — the name still truthfully states that no computation surface is
 * bound, and renaming it is out of this slice's scope.
 */
export const TY_2026_27_RULES_VERSION = "TY_2026_27_NO_COMPUTATION_SURFACE";
