/**
 * Post-mutation reconciliation state machine (Phase K.2.9.1 remediation).
 *
 * Pure, framework-free core for {@link useReconciledAction}. It encodes the
 * lifecycle of a server mutation whose success must NOT be surfaced until the
 * fresh server data it produced has actually landed on the client:
 *
 *   idle → (dispatch)          → pending      — the action's POST is in flight
 *   pending → (fail)           → idle+error   — action rejected; retry allowed
 *   pending → (await v)        → reconciling  — action ok; waiting for fresh props
 *   reconciling → (version v') → idle          — fresh props landed (v' ≠ v): SUCCESS
 *   reconciling → (timeout)    → unconfirmed   — refresh didn't confirm in time
 *   unconfirmed → (version v') → idle          — late props landed (v' ≠ v): SUCCESS
 *
 * The reconciliation SIGNAL is a server-derived `dataVersion` string that
 * changes whenever the mutated data changes. SUCCESS is declared — and the
 * caller's `onReconciled` (close drawer, toast) fires — ONLY on a `version`
 * transition to `idle`, i.e. positive proof the write is now visible.
 *
 * A `timeout` NEVER declares success. It moves to the terminal `unconfirmed`
 * phase: the write was accepted by the server (the action returned ok) but the
 * client could not confirm the fresh data arrived. `unconfirmed` is still "busy"
 * so the surface cannot start a duplicate write; the UI must offer a safe
 * recovery (a hard reload). If the data does eventually land, a later `version`
 * event self-heals `unconfirmed → idle` and fires `onReconciled` for real. See
 * `docs/phase-K2.9.1-reconciliation-primitive.md` for the full rationale.
 *
 * Kept in a React-free module so the contract AND the orchestration
 * ({@link createReconcileController}) can be unit-tested in the repo's node test
 * environment (no jsdom/testing-library needed).
 */

export type ReconcilePhase = "idle" | "pending" | "reconciling" | "unconfirmed";

export interface ReconcileState {
  phase: ReconcilePhase;
  /** Contextual error from the last failed action (null once cleared). */
  error: string | null;
  /** dataVersion captured when a successful action requested fresh data. The
   *  reconcile resolves only when a DIFFERENT version is observed. Preserved
   *  across `reconciling → unconfirmed` so a late refresh can still self-heal. */
  awaitingVersion: string | null;
}

export const initialReconcileState: ReconcileState = {
  phase: "idle",
  error: null,
  awaitingVersion: null,
};

export type ReconcileEvent =
  | { type: "dispatch" }
  | { type: "fail"; error: string }
  | { type: "await"; version: string }
  | { type: "version"; version: string }
  | { type: "timeout" }
  | { type: "clearError" };

export function reconcileReducer(state: ReconcileState, event: ReconcileEvent): ReconcileState {
  switch (event.type) {
    case "dispatch":
      // Begin an action. Ignore re-entrancy while already busy (including the
      // terminal `unconfirmed` phase) so a double-submit can never start a
      // second in-flight write.
      if (state.phase !== "idle") return state;
      return { phase: "pending", error: null, awaitingVersion: null };

    case "fail":
      // Action rejected — return to idle with a contextual error so the caller
      // can retry. Never leaves the surface stuck reconciling.
      return { phase: "idle", error: event.error, awaitingVersion: null };

    case "await":
      // Action succeeded. Enter reconciling and remember the version we must
      // move OFF of before declaring success.
      return { phase: "reconciling", error: null, awaitingVersion: event.version };

    case "version":
      // Fresh server props landed. Resolve — declaring SUCCESS — only if the
      // version actually changed from the captured baseline, and only while we
      // are waiting for it (reconciling OR unconfirmed, so a late refresh after
      // a timeout still self-heals). An identical version means the refetch has
      // not delivered the new data yet, so keep waiting.
      if (
        (state.phase === "reconciling" || state.phase === "unconfirmed") &&
        event.version !== state.awaitingVersion
      ) {
        return { phase: "idle", error: null, awaitingVersion: null };
      }
      return state;

    case "timeout":
      // The refresh did not confirm in time. Move to the terminal `unconfirmed`
      // phase — NEVER to a success. Preserve `awaitingVersion` so a late
      // `version` event can still self-heal into a real success.
      if (state.phase === "reconciling") {
        return { phase: "unconfirmed", error: null, awaitingVersion: state.awaitingVersion };
      }
      return state;

    case "clearError":
      // Clear a stale error without disturbing the phase.
      return state.error === null ? state : { ...state, error: null };

    default:
      return state;
  }
}

/** Submit/retry must be disabled whenever an action is in flight, its result
 *  has not yet been reconciled, OR it timed out unconfirmed (to prevent a
 *  duplicate write). True for every non-idle phase. */
export const isReconcileBusy = (s: ReconcileState): boolean => s.phase !== "idle";

/** True while an action has succeeded but fresh props have not yet landed. */
export const isReconciling = (s: ReconcileState): boolean => s.phase === "reconciling";

/** True when the action was accepted but the client could not confirm the fresh
 *  data landed (refresh timed out). The surface must offer a hard-reload
 *  recovery and must NOT invite a resubmit. */
export const isUnconfirmed = (s: ReconcileState): boolean => s.phase === "unconfirmed";

/**
 * A row group whose fingerprint contributes to a surface's `dataVersion`.
 * Kept structurally minimal so any list-bearing view can build a version.
 */
export interface VersionRowGroup {
  key: string;
  /** A numeric roll-up (e.g. a category total) that shifts on value edits. */
  total: number;
  rows: ReadonlyArray<{ id: string; updated_at?: unknown }>;
}

/**
 * Derive a stable `dataVersion` string from row groups. It changes on:
 *   - create  → a new row `id` appears (and count/total shift),
 *   - update  → the row's `updated_at` bumps (ledger tables carry the
 *               `app.set_updated_at()` trigger) and/or the total shifts,
 *   - remove  → the row `id` disappears (and count/total shift).
 * Identical inputs always produce an identical string, so it is safe as an
 * effect dependency (no spurious churn between renders).
 */
export function rowsVersion(groups: ReadonlyArray<VersionRowGroup>): string {
  const parts: string[] = [];
  for (const g of groups) {
    parts.push(g.key, String(g.total), String(g.rows.length));
    for (const r of g.rows) {
      parts.push(r.id, String(r.updated_at ?? ""));
    }
  }
  return parts.join("|");
}

/**
 * Derive a stable `dataVersion` for a lifecycle/status surface (reopen, finalize,
 * client review, snapshot, sign-off, profile, checklist, …) from the ordered
 * server-prop fields that FLIP when the mutation lands. This is the status-surface
 * counterpart to {@link rowsVersion} (which fingerprints list rows): it joins a
 * fixed sequence of scalar fields, normalizing `null`/`undefined` to the empty
 * string, so identical inputs always yield an identical string (safe as an effect
 * dependency — no spurious churn between renders).
 *
 * Choose fields that provably change on every successful mutation of the surface —
 * a status enum PLUS the monotonic timestamp the write bumps (`finalizedAt`,
 * `reopenedAt`, `decidedAt`, `taxpayer_profile_updated_at`, a max `last_checked_at`,
 * a new snapshot id + `created_at`). Prefer including such a timestamp so even an
 * idempotent re-save (same status re-applied) is still observed as a change,
 * rather than parking in `unconfirmed`.
 */
export function fieldsVersion(fields: ReadonlyArray<unknown>): string {
  return fields.map((f) => (f === null || f === undefined ? "" : String(f))).join("|");
}

// ---------------------------------------------------------------------------
// Orchestration controller
// ---------------------------------------------------------------------------

export interface ReconciledActionResult {
  ok: boolean;
  error?: string;
}

export interface ReconcileControllerDeps {
  /** The dataVersion at construction time (baseline before any observe()). */
  initialVersion: string;
  /** Request fresh server data (e.g. `router.refresh()`). Called once per
   *  successful action; treated as a REQUEST, never as a completion signal. */
  refresh: () => void;
  /** Schedule the liveness timeout; returns a cancel function. Injectable so
   *  tests can drive it deterministically instead of with a wall clock. */
  schedule: (fn: () => void, ms: number) => () => void;
  /** Current liveness timeout in ms (read lazily so prop changes take effect). */
  getTimeoutMs: () => number;
  /** Notified after every state change so a subscriber can re-render. */
  onChange: () => void;
}

export interface ReconcileController {
  getState: () => ReconcileState;
  /** Start a server action. Fires `onReconciled` ONLY after fresh data is
   *  observed (a `version` change). Synchronously no-ops if an action is
   *  already outstanding — this is the guard against a second write started
   *  before React re-renders and disables the control. */
  run: (action: () => Promise<ReconciledActionResult>, onReconciled?: () => void) => void;
  /** Feed the latest observed `dataVersion`. Resolves a pending reconcile (or a
   *  timed-out `unconfirmed` one) into SUCCESS when the version has moved. */
  observe: (dataVersion: string) => void;
  /** Clear a stale error without disturbing the phase. */
  clearError: () => void;
  /** Cancel any pending timer and drop the callback (call on unmount). */
  dispose: () => void;
}

/**
 * Framework-agnostic orchestration for {@link useReconciledAction}. All the
 * timing-sensitive behaviour lives here so it can be unit-tested in node with an
 * injected scheduler — the hook is a thin React binding over it. Key guarantees:
 *   - the success callback fires exactly once, and only on a real version change;
 *   - a timeout parks the surface in `unconfirmed` (never a false success);
 *   - a synchronous re-entrant `run` cannot start a second write;
 *   - a rejected/throwing action returns to idle (retry allowed), never stuck;
 *   - timers are always cleaned up.
 */
export function createReconcileController(deps: ReconcileControllerDeps): ReconcileController {
  let state = initialReconcileState;
  let onReconciled: (() => void) | null = null;
  let cancelTimer: (() => void) | null = null;
  // Synchronous guard: set the instant a run starts, so a second run() issued
  // before React re-renders the (now-disabled) control is dropped. Stays true
  // through `reconciling`/`unconfirmed` so no duplicate write can begin until the
  // reconcile resolves (success) or the action fails.
  let inFlight = false;
  // Baseline captured SYNCHRONOUSLY at run() start — the version we must move off
  // of to declare success. Never derived from `currentVersion` after the action
  // resolves (that could already hold the mutation's own new version — the race).
  let runBaseline: string | null = null;
  // Latest version fed by observe(); tracks what the client is currently showing.
  let currentVersion = deps.initialVersion;
  // Once disposed (unmount) nothing may fire: no callbacks, no refresh, no state.
  let disposed = false;

  const setState = (next: ReconcileState) => {
    if (next === state) return;
    state = next;
    deps.onChange();
  };
  const send = (event: ReconcileEvent) => setState(reconcileReducer(state, event));

  const clearTimer = () => {
    if (cancelTimer) {
      cancelTimer();
      cancelTimer = null;
    }
  };

  const resolveSuccess = (version: string) => {
    clearTimer();
    inFlight = false;
    runBaseline = null;
    const cb = onReconciled;
    onReconciled = null;
    send({ type: "version", version });
    cb?.();
  };

  return {
    getState: () => state,
    clearError: () => send({ type: "clearError" }),

    run: (action, cb) => {
      if (disposed || inFlight) return; // drop a re-entrant submit (pre-rerender double click)
      inFlight = true;
      // Capture the baseline BEFORE invoking/awaiting the action, so a version
      // change that lands while the action promise settles is still recognised.
      const baseline = currentVersion;
      runBaseline = baseline;
      send({ type: "dispatch" });
      void (async () => {
        let res: ReconciledActionResult;
        try {
          res = await action();
        } catch {
          if (disposed) return;
          // Never leave the UI stuck on an unexpected throw.
          inFlight = false;
          runBaseline = null;
          send({ type: "fail", error: "Something went wrong. Please try again." });
          return;
        }
        if (disposed) return;
        if (!res.ok) {
          inFlight = false;
          runBaseline = null;
          send({ type: "fail", error: res.error ?? "Action failed." });
          return;
        }
        // Success. Reconcile against the ORIGINAL run baseline.
        onReconciled = cb ?? null;
        send({ type: "await", version: baseline });
        if (currentVersion !== baseline) {
          // Fresh props already arrived while the action was in flight — the
          // write is visible now. Reconcile immediately; do NOT refetch and do
          // NOT arm a liveness timer (nothing to wait for).
          resolveSuccess(currentVersion);
          return;
        }
        // Otherwise wait for a later version change. Arm the timer BEFORE calling
        // refresh so that a synchronous/very-fast observe triggered by the refresh
        // cancels it via resolveSuccess() — never leaving a timer armed after a
        // completed reconciliation.
        clearTimer();
        cancelTimer = deps.schedule(() => {
          cancelTimer = null;
          // Timeout → unconfirmed. Does NOT fire onReconciled and does NOT
          // declare success; the stored callback is retained so a late version
          // change can still self-heal into a real success.
          send({ type: "timeout" });
        }, deps.getTimeoutMs());
        deps.refresh();
      })();
    },

    observe: (dataVersion) => {
      if (disposed) return;
      currentVersion = dataVersion;
      if (
        (state.phase === "reconciling" || state.phase === "unconfirmed") &&
        runBaseline !== null &&
        dataVersion !== runBaseline
      ) {
        resolveSuccess(dataVersion);
      }
    },

    dispose: () => {
      disposed = true;
      clearTimer();
      onReconciled = null;
    },
  };
}
