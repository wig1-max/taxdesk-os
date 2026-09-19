/**
 * TaxDesk OS — Versioned Tax Pack: the AY 2026-27 V0 / Income-tax Act, 1961
 * IDENTITY-ONLY pack (D277, AUDIT-09-F2 remediation).
 *
 * PURE TYPESCRIPT ONLY (see ../identity.ts for the boundary rules).
 *
 * WHAT THIS IS: the retained IDENTITY of the pre-K4-17 computation rules
 * (`AY_2026_27_V0_PREP_ONLY`). Historical database snapshots carry this
 * `computationRulesVersion`, and the registry must still RESOLVE a version-pinned
 * selector to this pack so those snapshots remain identifiable and the freshness
 * check (`snapshot.rulesVersion !== current version`) stays honest.
 *
 * WHAT THIS IS NOT — and what D277 removed: it carries NO computation binding.
 * K4-17 froze a full in-tree copy of the pre-K4-17 engine
 * (`tax-engine/ay-2026-27/legacy-v0/`, 7,162 lines) to serve exact-version
 * replay. AUDIT-09 (`D277`) found that copy disproportionate: the product is
 * synthetic-only and draft; legacy database snapshots are NOT replay-complete
 * (their writer omitted taxpayer and several head arrays — see
 * `computation-replay-input.ts`); and there are no real clients. The frozen
 * engine, its provenance and its schema packages are therefore recoverable from
 * history at git tag `tax-pack-AY-2026-27-V0` (commit `b2a7406`, the exact
 * pre-K4-17 engine head) rather than living in-tree. A saved output remains
 * immutable historical EVIDENCE of what ran; it is not a replay-complete input.
 *
 * HOW IT FAILS SAFE. The pack carries NO `binding`, so — exactly like the
 * TY 2026-27 stub — `bindTaxPackToCase` refuses it as `unbound` (there is no
 * computation surface to hand back), and `resolveTaxPackForReliance` refuses it
 * as `unverified` (it is truthfully `draft`). New computations resolve V1 and
 * never reach this pack. Legacy V0 database rows are untouched: immutable
 * output, stale for current readiness exactly as before this change.
 *
 * WHY KEEP THE IDENTITY AT ALL. Removing the binding without removing the
 * identity lets a historical version pin still resolve (so a V0 snapshot is a
 * recognized, named thing rather than an unknown coordinate) while honestly
 * reporting that its engine is at a git tag, not in-tree. The D278 guard
 * (`__tests__/parallel-worlds.test.ts`) now fails a test if a second in-tree
 * executable engine binding is registered in this statutory world without a
 * named freeze-decision id — the durable form of the material-expansion
 * checkpoint K4-17 missed (AUDIT-09-F5).
 */

import {
  ASSESSMENT_YEAR,
  FINANCIAL_YEAR,
  PRE_K4_17_RULES_VERSION,
} from "@/lib/tax-engine/ay-2026-27/rules";
import { makeTaxPackIdentity, type TaxPackIdentity } from "../identity";
import { makeTaxPack, type TaxPack } from "../pack";

/**
 * Identity of the pre-K4-17 AY 2026-27 engine. `computationRulesVersion` and
 * `validationRulesVersion` are both `PRE_K4_17_RULES_VERSION` — the marker
 * historical snapshots stamp — so a version-pinned selector reaches this pack
 * and the freshness check can compare it against the current `RULES_VERSION`.
 *
 * No `sourceSchemaVersions` / `outputSchemaVersions` are carried here: like the
 * TY stub, this is an identity-only pack that does not compute, and the V0
 * schema packages (frozen at `COMPUTATION_SNAPSHOT_V1` etc.) remain recoverable
 * at git tag `tax-pack-AY-2026-27-V0` rather than re-declared in-tree.
 */
export const AY_2026_27_V0_PACK_IDENTITY: TaxPackIdentity = makeTaxPackIdentity({
  jurisdiction: "IN",
  law: "ITA_1961",
  periodKind: "assessment_year",
  period: ASSESSMENT_YEAR, // "2026-27"
  computationRulesVersion: PRE_K4_17_RULES_VERSION, // "AY_2026_27_V0_PREP_ONLY"
  validationRulesVersion: PRE_K4_17_RULES_VERSION,
  status: "draft", // truthful: never CA-verified; engine now at git tag only
  effectiveFrom: `${FINANCIAL_YEAR.slice(0, 4)}-04-01`, // FY 2025-26 start → "2025-04-01"
  verifiedBy: null,
  verifiedAt: null,
});

/**
 * The registered V0 pack: identity only. No `binding` (so it refuses as
 * `unbound`) and no `provenance` (so it reads as not verifiable — the truthful
 * answer for a pack whose engine lives at a git tag, not in-tree).
 */
export const AY_2026_27_V0_PACK: TaxPack = makeTaxPack(AY_2026_27_V0_PACK_IDENTITY);
