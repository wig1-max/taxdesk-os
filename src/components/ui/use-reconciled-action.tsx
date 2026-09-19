"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  createReconcileController,
  isReconcileBusy,
  type ReconcileController,
  type ReconciledActionResult,
} from "./reconcile-core";

/**
 * useReconciledAction — the shared post-mutation reconciliation primitive
 * (Phase K.2.9.1 remediation; the keystone fix for the systemic "stale after
 * success" P1).
 *
 * THE BUG IT REPLACES. Every mutation surface did, synchronously inside a
 * `useTransition`: `onDone()` (close drawer) + `toast.success()` +
 * fire-and-forget `router.refresh()`. The drawer closed and the toast fired
 * BEFORE the refreshed server components had been fetched and committed, so a
 * successful write briefly left the list stale/contradictory — a duplicate-entry
 * risk in a financial workflow. `router.refresh()` returns void, its transition
 * participation after an `await` is unreliable, and it races the action's own
 * `revalidatePath` (see the swallowed-navigation note in `case-form.tsx`).
 *
 * THE CONTRACT. `run(action, onReconciled)`:
 *   - runs `action`; `pending`/`busy` cover the POST;
 *   - on failure (or an unexpected throw), surfaces `error` and returns to idle
 *     so retry is allowed — never stuck;
 *   - on success, enters `reconciling` and issues `router.refresh()`, then keeps
 *     `busy` TRUE until fresh server props have ACTUALLY landed — detected by
 *     observing `dataVersion` change from the value captured at success;
 *   - fires `onReconciled` (close drawer, toast the persisted milestone) ONLY
 *     after that reconciliation — never on the timeout, never prematurely;
 *   - a synchronous re-entrant `run` (a second click before React disables the
 *     control) is dropped, so a duplicate write can never begin.
 *
 * TIMEOUT / UNCONFIRMED. `reconcileTimeoutMs` is NOT a success fallback. If fresh
 * props never arrive (a genuinely stuck refresh), the surface parks in
 * `unconfirmed`: the write was accepted server-side but the client could not
 * confirm it landed. `busy` stays true (no duplicate write is possible) and the
 * caller surfaces a safe recovery via `reload()` (a hard refresh that cannot be
 * swallowed). If the data does eventually land, a later version change
 * self-heals `unconfirmed` into a real success and fires `onReconciled`.
 *
 * RECONCILIATION SIGNAL. A server-derived `dataVersion` string that changes when
 * the mutated data changes (see `rowsVersion`). This is deterministic proof the
 * write is visible, chosen over "await router.refresh()" precisely because the
 * refresh cannot be trusted to signal completion. The orchestration lives in the
 * React-free `createReconcileController`, unit-tested in node; this hook is a
 * thin binding.
 */

export type { ReconciledActionResult };

export interface UseReconciledActionOptions {
  /** A value derived from the server props this surface renders, which changes
   *  whenever the data the action mutates changes. Reconciliation completes only
   *  when this differs from its value captured at the moment the action
   *  succeeded. Build it with `rowsVersion` (or any stable fingerprint). */
  dataVersion: string;
  /** Liveness bound (ms). If fresh props never arrive within this window the
   *  write is marked `unconfirmed` (NOT a success). Never trips on the normal
   *  data-changing path where a new version lands first. Default 12000. */
  reconcileTimeoutMs?: number;
}

export interface ReconciledAction {
  /** Run a server action; on success keep `busy` true until fresh props land,
   *  THEN fire `onReconciled` (close drawer / toast the persisted value). */
  run: (action: () => Promise<ReconciledActionResult>, onReconciled?: () => void) => void;
  /** Disable submit/retry the whole time: POST in flight, awaiting fresh props,
   *  OR timed-out unconfirmed (so no duplicate write can be started). */
  busy: boolean;
  /** The server action's POST is in flight. */
  pending: boolean;
  /** Action succeeded; waiting for fresh server data to land. */
  reconciling: boolean;
  /** Action was accepted but the client could not confirm the fresh data
   *  landed. Surface a hard-reload recovery; do NOT invite a resubmit. */
  unconfirmed: boolean;
  /** Contextual error from the last failed action (null once cleared). */
  error: string | null;
  /** Clear a stale error (e.g. when reopening a drawer). Leaves phase untouched. */
  clearError: () => void;
  /** Reliable hard-refresh recovery for the `unconfirmed` state — a full
   *  navigation that cannot be swallowed by a server action's revalidate. */
  reload: () => void;
}

export function useReconciledAction({
  dataVersion,
  reconcileTimeoutMs = 12000,
}: UseReconciledActionOptions): ReconciledAction {
  const router = useRouter();
  const [, forceRender] = useReducer((n: number) => n + 1, 0);

  // Mutable deps the once-created controller reads lazily, so router/timeout
  // changes across renders take effect without recreating the controller.
  const routerRef = useRef(router);
  routerRef.current = router;
  const timeoutRef = useRef(reconcileTimeoutMs);
  timeoutRef.current = reconcileTimeoutMs;

  const controllerRef = useRef<ReconcileController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = createReconcileController({
      initialVersion: dataVersion,
      refresh: () => routerRef.current.refresh(),
      schedule: (fn, ms) => {
        const id = setTimeout(fn, ms);
        return () => clearTimeout(id);
      },
      getTimeoutMs: () => timeoutRef.current,
      onChange: () => forceRender(),
    });
  }
  const controller = controllerRef.current;

  // Feed the latest observed version; this resolves a pending (or late,
  // post-timeout) reconcile into success when the version has moved.
  useEffect(() => {
    controller.observe(dataVersion);
  }, [controller, dataVersion]);

  // Cancel timers + drop callbacks on unmount.
  useEffect(() => () => controller.dispose(), [controller]);

  const reload = useCallback(() => {
    if (typeof window !== "undefined") window.location.reload();
  }, []);

  const state = controller.getState();
  return {
    run: controller.run,
    busy: isReconcileBusy(state),
    pending: state.phase === "pending",
    reconciling: state.phase === "reconciling",
    unconfirmed: state.phase === "unconfirmed",
    error: state.error,
    clearError: controller.clearError,
    reload,
  };
}
