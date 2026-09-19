/**
 * TaxDesk OS — Versioned Tax Pack: LIFECYCLE (Wave 1, K3-10).
 *
 * PURE TYPESCRIPT ONLY (see identity.ts for the boundary rules).
 *
 * Lifecycle: `draft → ca_verified → retired`. Transitions are pure functions
 * that return a NEW frozen identity (the coordinates never change — see
 * identity.ts) or a typed refusal; they never mutate in place. A pack must be
 * `ca_verified` to be relied upon for real preparation.
 *
 * NOTE: the actual CA-verification workflow, official-source provenance, and
 * verifier identity are K3-13. This file provides only the deterministic state
 * machine; nothing here fabricates verification (`verifyTaxPack` requires a
 * caller-supplied verifier + timestamp).
 */

import { makeTaxPackIdentity, type TaxPackIdentity, type TaxPackStatus } from "./identity";

/** Allowed forward transitions. Anything not listed is refused. */
const ALLOWED_TRANSITIONS: Readonly<Record<TaxPackStatus, readonly TaxPackStatus[]>> = {
  draft: ["ca_verified", "retired"],
  ca_verified: ["retired"],
  retired: [],
};

export type LifecycleTransition =
  | { ok: true; identity: TaxPackIdentity }
  | { ok: false; reason: string };

/** True when `from → to` is a permitted lifecycle transition. */
export function canTransition(from: TaxPackStatus, to: TaxPackStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Move a pack to `ca_verified`, recording the verifier + timestamp. Refuses if
 * the pack is not currently `draft`, or if verifier/timestamp are missing.
 * (This is the deterministic state transition only — K3-13 owns the real
 * evidence-backed verification workflow that would call this.)
 */
export function verifyTaxPack(
  identity: TaxPackIdentity,
  verification: { verifiedBy: string; verifiedAt: string },
): LifecycleTransition {
  if (!canTransition(identity.status, "ca_verified")) {
    return { ok: false, reason: `Cannot verify a ${identity.status} pack` };
  }
  if (!verification.verifiedBy || !verification.verifiedAt) {
    return { ok: false, reason: "Verification requires verifiedBy and verifiedAt" };
  }
  return {
    ok: true,
    identity: makeTaxPackIdentity({
      ...identity,
      sourceSchemaVersions: { ...identity.sourceSchemaVersions },
      outputSchemaVersions: { ...identity.outputSchemaVersions },
      status: "ca_verified",
      verifiedBy: verification.verifiedBy,
      verifiedAt: verification.verifiedAt,
    }),
  };
}

/**
 * Retire a pack (from `draft` or `ca_verified`). Retiring clears the
 * verification fields — a retired pack is kept for reproducing historical
 * calculations, never for new reliance.
 */
export function retireTaxPack(identity: TaxPackIdentity): LifecycleTransition {
  if (!canTransition(identity.status, "retired")) {
    return { ok: false, reason: `Cannot retire a ${identity.status} pack` };
  }
  return {
    ok: true,
    identity: makeTaxPackIdentity({
      ...identity,
      sourceSchemaVersions: { ...identity.sourceSchemaVersions },
      outputSchemaVersions: { ...identity.outputSchemaVersions },
      status: "retired",
      verifiedBy: null,
      verifiedAt: null,
    }),
  };
}

/** True when a pack's lifecycle state permits real-preparation reliance. */
export function isRelianceReady(identity: TaxPackIdentity): boolean {
  return identity.status === "ca_verified";
}
