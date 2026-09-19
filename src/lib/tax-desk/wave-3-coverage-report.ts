/**
 * TaxDesk OS — Wave-3 (K3-33) executable coverage inventory.
 *
 * PURE TYPESCRIPT ONLY — no React/Next/Supabase/env/route imports, matching
 * every other module in `src/lib/tax-desk/*`.
 *
 * Mirrors the Wave-2 discipline (`src/lib/tax-lab/coverage-report.ts`,
 * `K3-23`): the Wave-3 coverage report (the k3-wave-3-coverage-and-limitations design notes) must be an executable inventory
 * rather than prose that can silently drift. This module derives every
 * claim from the SAME closed vocabularies the propose→review→promote
 * workflow (`source-proposals.ts`), the accepted-evidence manifest
 * (`evidence-manifest.ts`), the persisted draft-output artifact
 * (`draft-output-artifact.ts`), and the live traceability read model
 * (`case-traceability.ts`) already enforce by their own unit tests — it
 * introduces no second, independently-maintained vocabulary of its own.
 * `__tests__/wave-3-coverage-report.test.ts` pins the exact current values,
 * so any future change to the supported scope fails this guard until the
 * coverage report is consciously reassessed (same convention as `K3-23`'s
 * `coverage-report.test.ts`).
 */

import { COMPUTATION_FIGURE_INVENTORY, type ComputationFigureTraceabilityState } from "./case-traceability";
import {
  PROPOSAL_SOURCE_SCHEMA_KIND,
  PROPOSAL_SOURCE_SCHEMA_VERSION,
  requiredProposalPair,
  type ProposalFactKind,
} from "./source-proposals";
import { MANIFEST_SCHEMA_VERSION, REGIME_VALUES } from "./evidence-manifest";
import { DRAFT_OUTPUT_ARTIFACT_STATUS, DRAFT_OUTPUT_PACKAGE_SCHEMA_VERSION } from "./draft-output-artifact";
import type { Regime } from "@/lib/tax-engine/ay-2026-27/types";

export interface ComputationFigureInventoryCounts {
  readonly total: number;
  readonly traced: number;
  readonly categorical: number;
  readonly untracedLimitations: number;
}

export interface Wave3CoverageReport {
  /** The one source kind this narrow Wave-3 slice supports. */
  readonly supportedSourceKind: string;
  readonly supportedSourceSchemaVersion: string;
  /** The exactly-two proposal facts this narrow Wave-3 slice supports. */
  readonly supportedProposalFacts: readonly ProposalFactKind[];
  /** The regimes an evidence manifest may be explicitly bound to. */
  readonly supportedRegimes: readonly Regime[];
  readonly manifestSchemaVersion: string;
  readonly draftOutputPackageSchemaVersion: string;
  readonly draftOutputStatus: string;
  /** The live Computation screen's closed material-figure partition
   *  (K3-24..26) — reused verbatim, never re-derived, so a Wave-3 claim
   *  about "full lineage" cannot silently diverge from what Computation
   *  actually proves. */
  readonly computationFigureInventory: ComputationFigureInventoryCounts;
}

function countByState(state: ComputationFigureTraceabilityState): number {
  return COMPUTATION_FIGURE_INVENTORY.filter((f) => f.state === state).length;
}

export function buildWave3CoverageReport(): Wave3CoverageReport {
  return Object.freeze({
    supportedSourceKind: PROPOSAL_SOURCE_SCHEMA_KIND,
    supportedSourceSchemaVersion: PROPOSAL_SOURCE_SCHEMA_VERSION,
    supportedProposalFacts: requiredProposalPair(),
    supportedRegimes: REGIME_VALUES,
    manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
    draftOutputPackageSchemaVersion: DRAFT_OUTPUT_PACKAGE_SCHEMA_VERSION,
    draftOutputStatus: DRAFT_OUTPUT_ARTIFACT_STATUS,
    computationFigureInventory: Object.freeze({
      total: COMPUTATION_FIGURE_INVENTORY.length,
      traced: countByState("traced"),
      categorical: countByState("not_source_tagged_by_construction"),
      untracedLimitations: countByState("untraced_limitation"),
    }),
  });
}
