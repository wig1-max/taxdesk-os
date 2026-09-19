/**
 * Pure logic for the binding PAN atomicity contract (Appendix C6).
 * Unit-tested; the client server actions must route through these.
 */

export interface ClientWriteResult {
  ok: boolean;
  clientId?: string;
  /** true = no PAN was supplied OR the PAN write succeeded. */
  panSaved: boolean;
  panError?: string;
  error?: string;
}

export type PanWritePath = "service_role_single_statement" | "session_client";

/**
 * With a PAN present, the ONLY allowed path is one service-role
 * statement that writes the row and both PAN columns together
 * (atomic). Without a PAN, the normal RLS session path is used.
 */
export function planClientWrite(hasPan: boolean): PanWritePath {
  return hasPan ? "service_role_single_statement" : "session_client";
}

/**
 * Builds the contract-compliant result and enforces its invariants:
 * - panSaved:false EXCLUSIVELY signals a partial PAN failure
 *   (row saved, PAN not) and must carry panError.
 * - a failed row write is a plain failure (ok:false, panSaved
 *   reflects that nothing PAN-related was silently dropped).
 * - a PAN failure can never be reported as plain success.
 */
export function resolveClientWriteResult(args: {
  rowSaved: boolean;
  clientId?: string;
  panRequested: boolean;
  panWriteOk: boolean;
  panErrorMsg?: string;
  rowErrorMsg?: string;
}): ClientWriteResult {
  const { rowSaved, clientId, panRequested, panWriteOk, panErrorMsg, rowErrorMsg } = args;

  if (!rowSaved) {
    return {
      ok: false,
      panSaved: false,
      error: rowErrorMsg ?? "Could not save client.",
      ...(panRequested ? { panError: panErrorMsg ?? "Not attempted — client save failed." } : {}),
    };
  }

  if (!panRequested) {
    return { ok: true, clientId, panSaved: true };
  }

  if (panWriteOk) {
    return { ok: true, clientId, panSaved: true };
  }

  // Split-write partial failure: row exists, PAN does not.
  return {
    ok: true,
    clientId,
    panSaved: false,
    panError: panErrorMsg ?? "PAN could not be saved. Retry from the client page.",
  };
}

/** UI helper: true when the result demands the blocking warning. */
export function needsPanBlockingWarning(r: ClientWriteResult): boolean {
  return r.ok && !r.panSaved;
}
