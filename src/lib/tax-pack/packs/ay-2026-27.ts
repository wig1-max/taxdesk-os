/**
 * TaxDesk OS — Versioned Tax Pack: the AY 2026-27 engine's IDENTITY as a pack
 * (Wave 1, K3-10).
 *
 * PURE TYPESCRIPT ONLY. This registers the existing
 * `src/lib/tax-engine/ay-2026-27` engine as the first pack entry. It imports the
 * engine's pure rule CONSTANTS so the pack's identity stays byte-for-byte in
 * sync with `RULES_VERSION` — a single source of truth (decision D6).
 *
 * K3-11: the binding is now CONCRETE — the pack's computation surface holds the
 * engine's own four public functions BY REFERENCE (no wrapper, no adaptation),
 * so computing through the pack is byte-identical to calling the engine
 * directly. Proved by `__tests__/pack-computation-golden.test.ts`.
 *
 * Lifecycle status is the TRUTHFUL one the engine actually has: the engine
 * carries `TODO(CA-verify)` values and documented placeholders, so this pack is
 * `draft`, NOT `ca_verified`. CA verification is K3-13 — do not fabricate it.
 * Binding an engine does NOT authorise reliance: `resolveTaxPackForReliance`
 * still refuses this pack as `unverified`.
 */

import { RULES_VERSION, ASSESSMENT_YEAR, FINANCIAL_YEAR } from "@/lib/tax-engine/ay-2026-27/rules";
import { computeTax } from "@/lib/tax-engine/ay-2026-27/compute-tax";
import { compareRegimes } from "@/lib/tax-engine/ay-2026-27/compare-regimes";
import { recommendItrForm } from "@/lib/tax-engine/ay-2026-27/recommend-itr-form";
import { validateCase } from "@/lib/tax-engine/ay-2026-27/validate-case";
import { makeTaxPackIdentity, type TaxPackIdentity } from "../identity";
import { makeTaxPack, type TaxPack } from "../pack";
import { AY_2026_27_PACK_PROVENANCE } from "./ay-2026-27-provenance";
import { AY_2026_27_RATE_PARAMETERS } from "./ay-2026-27-rate-parameters";
import {
  AY_2026_27_OUTPUT_SCHEMA_VERSIONS,
  AY_2026_27_SOURCE_SCHEMA_VERSIONS,
} from "./ay-2026-27-schemas";

/**
 * Identity of the AY 2026-27 / FY 2025-26 engine under the Income-tax Act, 1961.
 * `computationRulesVersion` and `validationRulesVersion` are both `RULES_VERSION`
 * — the same string the engine stamps on computations and the validation-run
 * marker (`tax_cases.validation_rules_version`).
 *
 * `effectiveFrom` is the FY 2025-26 start.
 *
 * K3-14: `sourceSchemaVersions` / `outputSchemaVersions` are now populated FROM
 * the schema packages in `./ay-2026-27-schemas` — the identity never re-declares
 * a version literal (decision D6 applied to schemas). These are NON-coordinate
 * identity state: a schema package version may move without changing the
 * canonical pack key, and `computationRulesVersion` may move without touching a
 * schema. Every import schema is `planned` (nothing reads those formats yet —
 * ingestion is Wave 3).
 */
export const AY_2026_27_PACK_IDENTITY: TaxPackIdentity = makeTaxPackIdentity({
  jurisdiction: "IN",
  law: "ITA_1961",
  periodKind: "assessment_year",
  period: ASSESSMENT_YEAR, // "2026-27"
  computationRulesVersion: RULES_VERSION, // "AY_2026_27_V5_PREP_ONLY"
  validationRulesVersion: RULES_VERSION,
  sourceSchemaVersions: AY_2026_27_SOURCE_SCHEMA_VERSIONS,
  outputSchemaVersions: AY_2026_27_OUTPUT_SCHEMA_VERSIONS,
  status: "draft", // truthful: engine has TODO(CA-verify) values — not CA-verified
  effectiveFrom: `${FINANCIAL_YEAR.slice(0, 4)}-04-01`, // FY 2025-26 start → "2025-04-01"
  verifiedBy: null,
  verifiedAt: null,
});

/**
 * The AY 2026-27 pack, bound to the deterministic engine. The four functions are
 * the engine's own exports by reference — a pure indirection, never a wrapper,
 * so no rounding, ordering, note text, or provenance can drift from a direct
 * engine call.
 *
 * K3-13: the pack now also declares official-source PROVENANCE per rule. That is
 * a claim about what each rule derives from — NOT verification. No verification
 * record exists for any rule, several rules cite no source at all, and every
 * rule carries the engine's own `TODO(CA-verify)` caveat, so the pack remains
 * truthfully `draft` and `resolveTaxPackForReliance` still refuses it.
 */
export const AY_2026_27_PACK: TaxPack = makeTaxPack(
  AY_2026_27_PACK_IDENTITY,
  {
    boundEngineId: "tax-engine/ay-2026-27",
    computation: Object.freeze({
      computeTax,
      compareRegimes,
      recommendItrForm,
      validateCase,
    }),
    // K4-PORT-02 (D299): what this world supplies to the shared, Act-agnostic
    // core. Every parameter is `available` and holds the engine's OWN constant
    // BY REFERENCE, so this declaration cannot drift from the rules it
    // describes. DECLARATIVE ONLY THIS SESSION — the engine still imports its
    // constants directly and computes exactly as before; threading these
    // parameters into the arithmetic is the next increment of the slice.
    rateParameters: AY_2026_27_RATE_PARAMETERS,
  },
  AY_2026_27_PACK_PROVENANCE,
);
