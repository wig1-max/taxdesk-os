/**
 * TaxDesk OS — Versioned Tax Pack: the TY 2026-27 / Income-tax Act, 2025 STUB
 * (Wave 1, K3-15).
 *
 * PURE TYPESCRIPT ONLY (see ../identity.ts for the boundary rules).
 *
 * WHAT THIS IS: an explicit, identity-only placeholder for the SECOND statutory
 * world the architecture must be able to represent — the Income-tax Act, 2025,
 * which counts **tax years** (`periodKind: "tax_year"`) and files on **SAHAJ
 * (ITR-1) / SUGAM (ITR-4)** prescribed by **Income-tax Rules, 2026 rule 164**,
 * as opposed to the 1961 Act's assessment years and its own return forms.
 *
 * **THIS LINE SAID "Form 168" UNTIL `K4-SOURCE-01` (`D301`), AND IT WAS WRONG.**
 * Form No. 168 is the **Annual Information Statement** under Income-tax Rules,
 * 2026 rule 245 — the counterpart of Form 26AS under the Rules 1962, not a
 * return of income at all. The claim was repeated at eight sites and was
 * **unfalsifiable while the Rules 2026 text was believed unretrievable**, which
 * is exactly how it survived; `D300` put the text on disk and reading it settled
 * the question immediately.
 *
 * WHAT THIS IS NOT — and must never become without a separately approved
 * program: it implements NO 2025-Act rule. There are no slabs, rates,
 * thresholds, deductions, rebates, surcharge/cess rules, transition provisions,
 * or return-form field definitions here, and there never will be in this file
 * without real official sources and CA verification. Registering it must not
 * make anything computable that was not computable before.
 *
 * `K4-PORT-01` (2026-08-14) ADDED PROVENANCE AND NOTHING ELSE. Per `D297` the
 * 1961 -> 2025 port is decided and begun; this pack now declares, in
 * `./ty-2026-27-provenance.ts`, which Income-tax Act, 2025 provision governs
 * each rule group the AY 2026-27 pack declares, quoted verbatim from the
 * ENACTED Act (`K4-PORT-00-S2`). **That changed only the QUALITY OF THE
 * REFUSAL, never what can be computed.**
 *
 * `K4-PORT-02` (2026-08-15, `D299`) ADDED A BINDING THAT SERVES NO COMPUTATION.
 * `D299` decided the port shares ONE Act-agnostic arithmetic core parameterised
 * by pack, rather than copying a second engine. This pack declares what it
 * supplies to that core (`./ty-2026-27-rate-parameters`).
 *
 * `K4-PORT-04` (2026-08-17, `D314`) FILLED THAT DECLARATION. This paragraph
 * used to continue: *"and it supplies almost nothing: five of six statutory rate
 * parameters are WITHHELD, because ITA 2025 s.4(1) keeps rates a Central Act
 * matter and the Finance Act, 2026 is not held here."* The second half of that
 * sentence stopped being true at `D300`, when the Finance Act was found on this
 * machine, and the first half stopped being true here: **all six parameters are
 * now supplied** from this world's own sources — s.202(1) read with Finance Act,
 * 2026 s.3(3), First Schedule Part I-B, s.3(15), and Income-tax Rules, 2026
 * rule 164(3)(k). Corrected forward, not rewritten
 * (`PROJECT_CONSTITUTION.md` §4).
 *
 * **Every refusal below is STILL unchanged, and that is the claim to check
 * hardest, because its BASIS moved.** The founding rule above still stands, and
 * `__tests__/parallel-worlds.test.ts` PROVES it rather than restating it.
 *
 * HOW IT FAILS SAFE. The pack's binding carries NO `computation` surface, so:
 *   - `bindTaxPackToCase` refuses it as `unbound` — there is no computation
 *     surface to hand back, so nothing can compute a 2025-Act case by accident;
 *   - `resolveTaxPackForReliance` refuses it as `unverified` — it is truthfully
 *     `draft`, exactly like the AY pack, and no verification is fabricated;
 *   - `taxPackRelianceBlocker` therefore yields the existing, consumable
 *     `tax_pack_unverified` blocker. No second refusal mechanism is introduced.
 *
 * **`"binding" in pack` IS NO LONGER THE TEST FOR "can this pack compute?"**
 * It is `true` here and this pack computes nothing. Use
 * `taxPackComputation(pack) !== undefined`, which is what every caller and
 * guard in the tree now does.
 *
 * WHY REGISTER IT AT ALL. Before this session the 2025 world resolved as
 * `unsupported` — indistinguishable from a typo'd period or an unknown
 * jurisdiction. Registering an explicit stub makes "this statutory world is
 * known, deliberately not implemented, and cannot compute" a modelled fact
 * rather than an absence, and it proves the two worlds coexist in one registry
 * without either leaking into the other (see `__tests__/parallel-worlds.test.ts`).
 */

import { makeTaxPackIdentity, type TaxPackIdentity } from "../identity";
import { makeTaxPack, type TaxPack } from "../pack";
import { TY_2026_27_PACK_PROVENANCE } from "./ty-2026-27-provenance";
import { TY_2026_27_RATE_PARAMETERS } from "./ty-2026-27-rate-parameters";
import { TY_2026_27_PERIOD, TY_2026_27_RULES_VERSION } from "./ty-2026-27-coordinates";

// Re-exported so every existing importer keeps working: the two coordinates
// moved to `./ty-2026-27-coordinates` in K4-PORT-02 only to break an import
// cycle with the rate-parameter set, not to change what they mean.
export { TY_2026_27_PERIOD, TY_2026_27_RULES_VERSION };

/**
 * Identity of the TY 2026-27 stub.
 *
 * `effectiveFrom` is now a **VERIFIED commencement date**, no longer a
 * placeholder. It was carried as a `TODO(CA-verify)` gap on the ground that
 * "nobody has verified the 2025 Act's commencement date against the Gazette";
 * that is no longer true. `OPS-14` read it in the Gazette Bill (`OPS-14-S1`)
 * and `K4-PORT-00` read it in the **enacted** Act — Income-tax Act, 2025
 * [30 of 2025], assented 21-8-2025, as amended by Finance Act 2026, s.1(3):
 * "Save as otherwise provided in this Act, it shall come into force on the 1st
 * April, 2026" (`K4-PORT-00-S2`, registered in
 * the official-source-retrieval design notes §6).
 *
 * The value is unchanged — it was always right — and **no behaviour depends on
 * it**: no code reads this field to decide anything, and the pack still cannot
 * compute. Only the honesty of the surrounding claim changed. The AY pack's
 * provenance rule (decision D15) is unaffected: an honest visible gap still
 * beats an invented-looking date; this gap is simply now closed by source.
 *
 * The schema-version maps are deliberately EMPTY. The 2025-Act return forms and
 * source formats have no inspected specimen and no modelled package, and
 * inventing one here would be exactly the fabricated-schema failure mode
 * decision D17 rejected.
 */
export const TY_2026_27_PACK_IDENTITY: TaxPackIdentity = makeTaxPackIdentity({
  jurisdiction: "IN",
  law: "ITA_2025",
  periodKind: "tax_year",
  period: TY_2026_27_PERIOD,
  computationRulesVersion: TY_2026_27_RULES_VERSION,
  // No validation rules exist for this world either; the string names that fact
  // rather than borrowing the 1961 Act engine's version.
  validationRulesVersion: TY_2026_27_RULES_VERSION,
  status: "draft", // truthful: nothing here is implemented, let alone CA-verified
  // ITA 2025 s.1(3), enacted text — see the block comment above (K4-PORT-00-S2).
  effectiveFrom: "2026-04-01",
  verifiedBy: null,
  verifiedAt: null,
});

/**
 * The registered pack: identity + provenance + a binding that declares this
 * world's statutory rate parameters and **deliberately serves no computation**.
 *
 * ---------------------------------------------------------------------------
 * WHAT `K4-PORT-02` CHANGED HERE, AND WHAT IT POINTEDLY DID NOT
 * ---------------------------------------------------------------------------
 * CHANGED: the pack now carries a `binding`, so `"binding" in pack` is `true`
 * where it used to be `false`. That key no longer means "this pack can
 * compute" — it means "this pack has declared how it relates to the shared
 * core". The binding carries `rateParameters` and **no `computation`**.
 *
 * NOT CHANGED — every refusal, and each is proven rather than asserted:
 *   - `taxPackComputation` still returns `undefined`, because the binding
 *     carries no computation surface;
 *   - `bindTaxPackToCase` still refuses as `unbound`, and still hands back no
 *     `computation` key a caller could destructure an engine out of;
 *   - `resolveTaxPackForReliance` still refuses as `unverified`;
 *   - the blocker is still the existing `tax_pack_unverified` — no second
 *     refusal mechanism was introduced;
 *   - the pack is still truthfully `draft`.
 *
 * `K4-PORT-02`'s refusal named which statutory rate authority was missing,
 * derived from the parameters themselves rather than from authored prose.
 * **`K4-PORT-04` took that sentence away, and the loss is recorded rather than
 * glossed:** nothing is withheld now, so `describeWithheldParameters` correctly
 * returns `null` and the refusal reads only "no computation binding". It did not
 * get worse by accident — the authority it named is no longer missing, and
 * naming a false obstacle would be worse than naming none. A better message
 * ("this world can source every rate and no arithmetic is bound to it") belongs
 * to the slice that wires the surface, which can move the copy and the behaviour
 * together.
 *
 * ---------------------------------------------------------------------------
 * THE REFUSAL WAS STRUCTURAL AND IS NOW A DECISION — READ THIS BEFORE RELYING
 * ON THE SHAPE OF THIS FILE (`K4-PORT-04`, `D314`)
 * ---------------------------------------------------------------------------
 * This block used to read: *"Five of the six rate parameters are withheld … so
 * `resolveEngineCapability` reports **zero** servable entry points, and a
 * computation surface may be attached only when every entry point is servable.
 * The absence of `computation` is therefore DERIVED from what this world can
 * source — not a decision someone has to remember to keep making."*
 *
 * **That guarantee is GONE, and pretending otherwise would be the worst possible
 * reading of this session.** All six parameters are supplied, so
 * `resolveEngineCapability` reports **four** servable entry points and
 * `complete: true`. The precondition for attaching a computation surface is
 * satisfied; the surface is absent because none has been written.
 *
 * **So the absence of `computation` IS now a decision someone has to keep
 * making, and it is one edit away from being reversed by accident.** What holds
 * the line is no longer the type system but three things, in descending
 * strength: `taxPackComputation` returning `undefined` (asserted),
 * `"computation" in binding` being `false` (asserted), and this comment.
 *
 * **The obstacle moved rather than disappearing.** Rates are only the first of
 * the things a 2025-Act computation needs. There is no adapter for this world,
 * no validation rules, no re-derivation of the deduction carve-outs s.202(2)
 * lists, no Chapter VIII counterparts, and no inspected return-form specimen
 * (`D17`). A world that can price a slab is not a world that can prepare a
 * return, and attaching a surface here would claim otherwise.
 *
 * `provenance` (`K4-PORT-01`) still makes `assessTaxPackVerification` report
 * one specific gap per declared rule, and declaring provenance still cannot
 * verify a pack: `verifyTaxPackWithEvidence` requires a per-rule record for
 * every rule AND explicit resolution of every caveat, none of which exists.
 */
export const TY_2026_27_STUB_PACK: TaxPack = makeTaxPack(
  TY_2026_27_PACK_IDENTITY,
  {
    // The SHARED core (D299), not the 1961-Act engine module. This world is
    // served by no executable engine today; naming one would imply otherwise.
    boundEngineId: "tax-engine/core",
    // `computation` is deliberately ABSENT, not `undefined` — see above.
    rateParameters: TY_2026_27_RATE_PARAMETERS,
  },
  TY_2026_27_PACK_PROVENANCE,
);
