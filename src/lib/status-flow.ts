import type { StatusFlow } from "@/lib/db/types";

/**
 * Pure transition logic — the brain of transitionCase(). No I/O,
 * fully unit-tested. The server action loads the context (identity
 * review completeness, checklist verification, payments, balances)
 * and this module decides.
 */

export interface TransitionContext {
  isAdmin: boolean;
  reason?: string;
  confirmedManualAction?: boolean;
  /** IEPF guard inputs (server action supplies for IEPF cases). */
  identityReviewComplete?: boolean;
  authorizationVerified?: boolean;
  feeAgreementVerified?: boolean;
  upfrontPaidTotal?: number;
  requiredUpfront?: number;
  balanceFeeDue?: number;
}

export type TransitionCheck = { ok: true } | { ok: false; error: string };

const fail = (error: string): TransitionCheck => ({ ok: false, error });

export function statusIndex(flow: StatusFlow, code: string): number {
  return flow.statuses.findIndex((s) => s.code === code);
}

export function statusLabel(flow: StatusFlow, code: string): string {
  return flow.statuses.find((s) => s.code === code)?.label ?? code;
}

export function defaultNextAction(flow: StatusFlow, code: string): string | null {
  return flow.statuses.find((s) => s.code === code)?.next_action ?? null;
}

export function isTerminal(flow: StatusFlow, code: string): boolean {
  return flow.terminal.includes(code);
}

export function checkTransition(
  flow: StatusFlow,
  serviceCode: string,
  from: string,
  to: string,
  ctx: TransitionContext
): TransitionCheck {
  const fromIdx = statusIndex(flow, from);
  const toIdx = statusIndex(flow, to);
  const hold = flow.hold ?? "on_hold";
  const reason = ctx.reason?.trim() || undefined;

  if (toIdx < 0) return fail(`Unknown status "${to}" for this service.`);
  if (from === to) return fail("Case is already in this status.");

  // Hold: allowed from anywhere, reason mandatory.
  if (to === hold) {
    if (!reason) return fail("A reason is required to put a case on hold.");
    return { ok: true };
  }

  // Resuming from hold: any status allowed, no extra reason needed —
  // but filing/guard checks below still apply.
  const resuming = from === hold;

  if (!resuming && fromIdx >= 0) {
    if (toIdx < fromIdx && !reason) {
      return fail("A reason is required to move a case backward.");
    }
    if (toIdx > fromIdx + 1) {
      if (!ctx.isAdmin) return fail("Skipping statuses ahead requires an admin.");
      if (!reason) return fail("A reason is required to skip statuses.");
    }
  }

  // The system never files anything — human confirmation required.
  if (flow.filing_confirmation_required?.includes(to) && !ctx.confirmedManualAction) {
    return fail(
      "Confirm that this filing/submission was done manually by an authorized person after review."
    );
  }

  // ITR: cannot file before client approval, ever (admin skip included).
  if (serviceCode === "itr" && to === "filed") {
    const apprIdx = statusIndex(flow, "approved_by_client");
    if (fromIdx < apprIdx) {
      return fail("Cannot mark as Filed before the client has approved the computation.");
    }
  }

  if (serviceCode === "iepf") {
    if (to === "iepf5_preparation") {
      if (!ctx.identityReviewComplete) {
        return fail("Identity review must be complete before IEPF-5 preparation.");
      }
      if (!ctx.authorizationVerified) {
        return fail("The signed authorization letter must be verified first.");
      }
      if (!ctx.feeAgreementVerified) {
        return fail("The signed fee agreement must be verified first.");
      }
      const required = ctx.requiredUpfront ?? 5000;
      if ((ctx.upfrontPaidTotal ?? 0) < required) {
        if (!(ctx.isAdmin && reason)) {
          return fail(
            `Upfront fee of at least Rs. ${required} must be recorded first (admin override with reason possible).`
          );
        }
      }
    }
    if (to === "completed" && (ctx.balanceFeeDue ?? 0) > 0) {
      if (!(ctx.isAdmin && reason)) {
        return fail("Balance fee is still due. Only an admin can complete with a reason.");
      }
    }
  }

  return { ok: true };
}
