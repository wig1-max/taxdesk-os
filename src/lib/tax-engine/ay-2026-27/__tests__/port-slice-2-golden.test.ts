/**
 * `K4-PORT-03` — THE ACCEPTANCE TEST FOR THE PORT'S SLICE 2.
 *
 * `D309` sets the acceptance criterion for slice 2 explicitly, and it is not a
 * green suite: **byte-identical output**. Slice 2 moves the code path that
 * produces every computed number in the product — the six statutory rate
 * figures stop being module constants the arithmetic imports and become
 * parameters the arithmetic receives — and a passing unit suite is a weaker
 * claim than an unchanged result. `K3-11` is the precedent: it moved the engine
 * behind the pack binding and proved output preservation with golden fixtures.
 *
 * `golden/port-slice-2-baseline.json` was generated on the tree **immediately
 * before** the threading change, from `PORT_SLICE_2_GOLDEN_CASES`, by calling
 * all four entry points on every case. This test re-runs the same calls and
 * requires the serialisation to match **character for character**.
 *
 * IF THIS TEST EVER FAILS, THAT IS A `D276` EVENT. A moved figure is not
 * something to absorb, to "correct in passing", or to accommodate by
 * regenerating the baseline — and it is not something a
 * `computationRulesVersion` bump makes acceptable, because a bump records a
 * DELIBERATE behaviour change and this file exists to catch an accidental one.
 * Read the diff, find out which figure moved and why, and stop.
 *
 * `K4-20` (`D325`) is the first deliberate update: the V2→V3 identity
 * string (the `D276` bump this slice owes) plus the
 * `BUSINESS_BOOKS_NET_PROFIT_APPLIED` disclosure. No computed figure in
 * this corpus moved — proved by substituting the version string first
 * (169/170 green) and then replacing only that finding's copy.
 *
 * `K4-23` (`D337`) is the second, and it is the first that could not be
 * taken by substitution, because it adds three KEYS to every
 * `RegimeComputation` — `houseSaleLtcgTreatmentSupported`,
 * `houseSaleLtcgDetails` and `houseSaleLtcgExcessIgnored` — so the
 * serialisation of all 42 cases changed while no number did. THE BASELINE
 * WAS NOT REGENERATED ON THAT ASSERTION. A structural differ walked the old
 * and fresh trees key by key and classified every difference, and only then
 * was the file rewritten. The measurement, which is the acceptance:
 *   - 546 differences are the three ADDED keys — 13 per case (7 through
 *     `computeTax`, 6 through `compareRegimes`), 42 × 13 = 546 — and their
 *     distinct values across the whole corpus are exactly `true`, `[]` and
 *     `0`, the no-house-LTCG defaults;
 *   - 84 are the V4→V5 identity string, 2 per case (`rulesVersion` and
 *     `notes[0]`);
 *   - EVERY OTHER DIFFERENCE: zero. No value moved, nothing was removed,
 *     and no unexpected key appeared.
 * The version-only predicate used for that split was itself proven to fire:
 * it accepts a pure V4→V5 change, and REJECTS both a moved figure and a
 * string that changes the version AND a number together. Its first draft
 * compared a value to itself and was therefore vacuous — the `AUDIT-12-F4`
 * class, caught before it was relied on. The corpus contains no long-term
 * house sale, which is why the added keys carry only defaults; the s.112
 * arithmetic is pinned by `house-sale.test.ts`, not here.
 *
 * WHAT IT DOES NOT PROVE. It pins this engine's output against ITSELF at one
 * commit; it says nothing about whether any of those figures is the RIGHT
 * answer in tax law. No pack is CA-verified and none moves toward it here. It
 * also only covers inputs the corpus actually contains — the coverage assertion
 * below pins the six parameters, not the whole input space.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RATE_PARAMETER_IDS } from "@/lib/tax-engine/core/statutory-rate-parameters";
import { compareRegimes } from "../compare-regimes";
import { computeTax } from "../compute-tax";
import { recommendItrForm } from "../recommend-itr-form";
import { validateCase } from "../validate-case";
import { PORT_SLICE_2_GOLDEN_CASES } from "./port-slice-2-corpus";

const BASELINE_PATH = path.join(
  process.cwd(),
  "src/lib/tax-engine/ay-2026-27/__tests__/golden/port-slice-2-baseline.json",
);

interface CaseBaseline {
  readonly computeTax: unknown;
  readonly compareRegimes: unknown;
  readonly recommendItrForm: unknown;
  readonly validateCase: unknown;
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Record<string, CaseBaseline>;

describe("port slice 2 — byte-identical output over the golden corpus", () => {
  it("the baseline covers exactly the corpus, in both directions", () => {
    // A case silently dropped from the corpus would make this suite pass by
    // testing less, which is the failure mode a golden test is most prone to.
    expect(Object.keys(baseline).sort()).toEqual(
      PORT_SLICE_2_GOLDEN_CASES.map((c) => c.name).sort(),
    );
    expect(new Set(PORT_SLICE_2_GOLDEN_CASES.map((c) => c.name)).size).toBe(
      PORT_SLICE_2_GOLDEN_CASES.length,
    );
  });

  it("every one of the six rate parameters is exercised by at least one case", () => {
    // The point of the corpus is that each threaded parameter has a case that
    // would have caught it moving. A parameter with no case is a parameter this
    // suite cannot defend, so it fails rather than passing quietly.
    const covered = new Set(PORT_SLICE_2_GOLDEN_CASES.flatMap((c) => c.coversParameters));
    expect([...covered].sort()).toEqual([...RATE_PARAMETER_IDS].sort());
  });

  for (const golden of PORT_SLICE_2_GOLDEN_CASES) {
    describe(golden.name, () => {
      const expected = baseline[golden.name];

      it("computeTax is unchanged", () => {
        expect(JSON.stringify(computeTax(golden.input))).toBe(
          JSON.stringify(expected?.computeTax),
        );
      });

      it("compareRegimes is unchanged", () => {
        expect(JSON.stringify(compareRegimes(golden.input))).toBe(
          JSON.stringify(expected?.compareRegimes),
        );
      });

      it("recommendItrForm is unchanged", () => {
        expect(JSON.stringify(recommendItrForm(golden.input))).toBe(
          JSON.stringify(expected?.recommendItrForm),
        );
      });

      it("validateCase is unchanged", () => {
        expect(JSON.stringify(validateCase(golden.input))).toBe(
          JSON.stringify(expected?.validateCase),
        );
      });
    });
  }
});
