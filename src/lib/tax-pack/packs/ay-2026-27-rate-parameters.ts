/**
 * TaxDesk OS — the AY 2026-27 / Income-tax Act, 1961 world's STATUTORY RATE
 * PARAMETERS (`K4-PORT-02`, decision `D299`).
 *
 * PURE TYPESCRIPT ONLY.
 *
 * This is the FIRST statutory world expressed through the shared core's
 * parameter boundary, and its job is to prove the boundary can carry a working
 * world without changing it. Every value here is the engine's OWN object passed
 * **by reference** — no number is retyped, no table is copied, and a test
 * asserts the reference identity (`toBe`, not `toEqual`) so this file can never
 * become a second, drifting copy of the rules (`D6`).
 *
 * **THE ARITHMETIC NOW READS THIS — `K4-PORT-03` (2026-08-16), closing the
 * increment `K4-PORT-02` deferred.** This header used to say the engine "still
 * imports its constants directly", which was true and was the whole gap: the
 * boundary described the world without governing it. `compute-tax.ts`,
 * `slabs.ts`, `surcharge.ts`, `rebate-relief.ts` and `recommend-itr-form.ts`
 * now receive these figures instead of importing them, and
 * `src/lib/tax-pack/__tests__/rate-parameter-threading.test.ts` asserts member
 * by member (`toBe`) that resolving this set yields the SAME OBJECTS the engine
 * computes with. Output is unchanged — byte-identical over the
 * `port-slice-2-golden.test.ts` corpus, which is slice 2's acceptance criterion
 * (`D309`) — so no `computationRulesVersion` bump was owed (`D276`).
 *
 * The old-regime slab FAMILY wrapper moved to `slabs.ts` and is imported here
 * by reference. It was assembled in this file by `K4-PORT-02`, which made the
 * family the pack declared a DIFFERENT object from any the engine held; now the
 * declaration and the arithmetic share one.
 *
 * ---------------------------------------------------------------------------
 * THE TWO UNCITED FIGURES ARE NOW CITED — `K4-SOURCE-02` (2026-08-15)
 * ---------------------------------------------------------------------------
 * `K4-PORT-02` recorded here that `cess` and `itrFormIncomeCeiling` were
 * supplied under the `allowUncited` exception, because this pack's provenance
 * cited **no official source** for `cess_rate` or `itr1_income_ceiling` while
 * the engine applied the 4% cess to every computed case and the ₹50,00,000
 * ceiling to every ITR-form recommendation. That finding was correct, and the
 * boundary surfacing it was the boundary doing its job.
 *
 * **BOTH ARE NOW CLOSED, and closed the way `rate-parameters.ts` requires — by
 * CITING them, never by suppressing the enumeration.** `cess_rate` cites
 * Finance Act, 2026 **section 2(6)** (the 4% Health and Education Cess, stated
 * in prose, for the Income-tax Act **1961** world); `itr1_income_ceiling` cites
 * **Income-tax Rules, 1962 rule 12(1)(a)** and clause (IV) of its proviso. Both
 * `allowUncited` flags are retired, `uncitedAvailableParameterIds` is now empty
 * for this world, and `availableFrom` will refuse a stale `allowUncited` if a
 * later session leaves one behind.
 *
 * **Citing changed no computed figure.** The 4% and the ₹50,00,000 were already
 * correct; the statute confirmed them. Read the rule caveats in
 * `ay-2026-27-provenance.ts` before relying on either — the ITR-1 one in
 * particular records that this engine models ONE of the rule's fourteen
 * disqualifying conditions.
 */

import {
  ASSESSMENT_YEAR,
  CESS_RATE,
  ITR1_INCOME_CEILING,
  REBATE_87A,
  RULES_VERSION,
  SURCHARGE,
} from "@/lib/tax-engine/ay-2026-27/rules";
import {
  AY_2026_27_OLD_REGIME_SLAB_TABLES,
  NEW_REGIME_SLABS,
} from "@/lib/tax-engine/ay-2026-27/slabs";
import type { StatutoryRateParameters } from "@/lib/tax-engine/core/statutory-rate-parameters";
import { taxPackKey } from "../identity";
import { AY_2026_27_PACK_PROVENANCE } from "./ay-2026-27-provenance";
import { availableFrom } from "./rate-parameters";

const PROVENANCE = AY_2026_27_PACK_PROVENANCE;

/**
 * The parameters the AY 2026-27 pack supplies to the shared core.
 *
 * `packKey` is composed from the same two engine constants the pack identity
 * uses, and `makeTaxPack` REJECTS a binding whose parameters name a different
 * pack — so a parameter set cannot be attached to the wrong statutory world,
 * and the check fires at module load rather than in a test.
 */
export const AY_2026_27_RATE_PARAMETERS: StatutoryRateParameters = Object.freeze({
  engineId: "tax-engine/ay-2026-27",
  packKey: taxPackKey({
    jurisdiction: "IN",
    law: "ITA_1961",
    periodKind: "assessment_year",
    period: ASSESSMENT_YEAR,
    computationRulesVersion: RULES_VERSION,
  }),

  newRegimeSlabs: availableFrom(PROVENANCE, "new_regime_slabs", ["slab_rates"], NEW_REGIME_SLABS),

  // The senior / super-senior widening is a SEPARATE rule group from the base
  // slab table, and both authorise this one parameter — which is why a
  // parameter names rule idS, plural.
  oldRegimeSlabs: availableFrom(
    PROVENANCE,
    "old_regime_slabs",
    ["slab_rates", "senior_super_senior_basic_exemption_widening"],
    AY_2026_27_OLD_REGIME_SLAB_TABLES,
  ),

  surcharge: availableFrom(
    PROVENANCE,
    "surcharge",
    ["surcharge_rates", "surcharge_marginal_relief"],
    SURCHARGE,
  ),

  // K4-SOURCE-02: CITED. `allowUncited` retired — Finance Act, 2026 s.2(6).
  cess: availableFrom(PROVENANCE, "cess", ["cess_rate"], CESS_RATE),

  rebate: availableFrom(
    PROVENANCE,
    "rebate",
    ["rebate_87a", "rebate_87a_marginal_relief"],
    REBATE_87A,
  ),

  // K4-SOURCE-02: CITED. `allowUncited` retired — Income-tax Rules, 1962 r.12.
  itrFormIncomeCeiling: availableFrom(
    PROVENANCE,
    "itr_form_income_ceiling",
    ["itr1_income_ceiling"],
    ITR1_INCOME_CEILING,
  ),
});
