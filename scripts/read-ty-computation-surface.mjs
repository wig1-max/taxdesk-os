/**
 * Runtime probe for the TY pack's computation surface.
 *
 * Prints `absent` or `present` — the same two tokens the restatement
 * guard compares against the docs. The authority is
 * `taxPackComputation(pack)`, not a regex over `ty-2026-27.ts`.
 *
 * Loaded via `scripts/ts-path-loader.mjs` under
 * `--experimental-strip-types`. Invoked by
 * `readTyComputationSurface()` in `check-capability-enumeration.mjs`.
 */
import { taxPackComputation } from "../src/lib/tax-pack/pack.ts";
import { TY_2026_27_STUB_PACK } from "../src/lib/tax-pack/packs/ty-2026-27.ts";

const surface = taxPackComputation(TY_2026_27_STUB_PACK);
if (surface !== undefined && (typeof surface !== "object" || surface === null)) {
  console.error(
    `read-ty-computation-surface: taxPackComputation returned ${typeof surface}, not a surface object or undefined`,
  );
  process.exit(1);
}
process.stdout.write(surface === undefined ? "absent" : "present");
