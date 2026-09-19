import { describe, it, expect, vi } from "vitest";
import {
  createReconcileController,
  fieldsVersion,
  initialReconcileState,
  isReconcileBusy,
  isReconciling,
  isUnconfirmed,
  reconcileReducer,
  rowsVersion,
  type ReconciledActionResult,
  type ReconcileControllerDeps,
  type ReconcileState,
  type VersionRowGroup,
} from "./reconcile-core";

/**
 * Reconciliation contract (Phase K.2.9.1). These tests pin the exact property
 * the keystone fix depends on: after a successful mutation the surface stays
 * BUSY (reconciling) until a DIFFERENT dataVersion is observed — never before.
 */
describe("reconcileReducer", () => {
  it("dispatch: idle → pending, clears any prior error, marks busy", () => {
    const errored: ReconcileState = { phase: "idle", error: "boom", awaitingVersion: null };
    const s = reconcileReducer(errored, { type: "dispatch" });
    expect(s.phase).toBe("pending");
    expect(s.error).toBeNull();
    expect(isReconcileBusy(s)).toBe(true);
  });

  it("dispatch is ignored while busy (no double in-flight write)", () => {
    const pending: ReconcileState = { phase: "pending", error: null, awaitingVersion: null };
    expect(reconcileReducer(pending, { type: "dispatch" })).toBe(pending);
    const reconciling: ReconcileState = { phase: "reconciling", error: null, awaitingVersion: "v0" };
    expect(reconcileReducer(reconciling, { type: "dispatch" })).toBe(reconciling);
  });

  it("fail: pending → idle with error, retry allowed (not busy)", () => {
    const pending: ReconcileState = { phase: "pending", error: null, awaitingVersion: null };
    const s = reconcileReducer(pending, { type: "fail", error: "nope" });
    expect(s.phase).toBe("idle");
    expect(s.error).toBe("nope");
    expect(isReconcileBusy(s)).toBe(false);
  });

  it("await: pending → reconciling capturing the baseline version, stays busy", () => {
    const pending: ReconcileState = { phase: "pending", error: null, awaitingVersion: null };
    const s = reconcileReducer(pending, { type: "await", version: "v0" });
    expect(s.phase).toBe("reconciling");
    expect(s.awaitingVersion).toBe("v0");
    expect(isReconciling(s)).toBe(true);
    expect(isReconcileBusy(s)).toBe(true);
  });

  it("version identical to the baseline does NOT resolve (data not landed yet)", () => {
    const reconciling: ReconcileState = { phase: "reconciling", error: null, awaitingVersion: "v0" };
    const s = reconcileReducer(reconciling, { type: "version", version: "v0" });
    expect(s).toBe(reconciling);
    expect(isReconciling(s)).toBe(true);
  });

  it("version different from the baseline resolves reconciling → idle (fresh props landed)", () => {
    const reconciling: ReconcileState = { phase: "reconciling", error: null, awaitingVersion: "v0" };
    const s = reconcileReducer(reconciling, { type: "version", version: "v1" });
    expect(s.phase).toBe("idle");
    expect(isReconcileBusy(s)).toBe(false);
    expect(s.awaitingVersion).toBeNull();
  });

  it("version events are ignored outside the reconciling phase", () => {
    const idle: ReconcileState = { phase: "idle", error: null, awaitingVersion: null };
    expect(reconcileReducer(idle, { type: "version", version: "v9" })).toBe(idle);
  });

  it("timeout parks reconciling in `unconfirmed` — NEVER a success", () => {
    const reconciling: ReconcileState = { phase: "reconciling", error: null, awaitingVersion: "v0" };
    const s = reconcileReducer(reconciling, { type: "timeout" });
    expect(s.phase).toBe("unconfirmed");
    expect(isUnconfirmed(s)).toBe(true);
    // Still busy so no duplicate write can start; baseline preserved for self-heal.
    expect(isReconcileBusy(s)).toBe(true);
    expect(s.awaitingVersion).toBe("v0");
    // Timeout is a no-op outside reconciling.
    const pending: ReconcileState = { phase: "pending", error: null, awaitingVersion: null };
    expect(reconcileReducer(pending, { type: "timeout" })).toBe(pending);
  });

  it("a late version change self-heals `unconfirmed` → idle (real success)", () => {
    const unconfirmed: ReconcileState = { phase: "unconfirmed", error: null, awaitingVersion: "v0" };
    // Same version does not resolve…
    expect(reconcileReducer(unconfirmed, { type: "version", version: "v0" })).toBe(unconfirmed);
    // …a different one does.
    const healed = reconcileReducer(unconfirmed, { type: "version", version: "v1" });
    expect(healed.phase).toBe("idle");
    expect(isReconcileBusy(healed)).toBe(false);
  });

  it("dispatch is ignored from `unconfirmed` (no duplicate write)", () => {
    const unconfirmed: ReconcileState = { phase: "unconfirmed", error: null, awaitingVersion: "v0" };
    expect(reconcileReducer(unconfirmed, { type: "dispatch" })).toBe(unconfirmed);
  });

  it("clearError nulls the error without disturbing the phase", () => {
    const reconcilingWithErr: ReconcileState = { phase: "reconciling", error: "stale", awaitingVersion: "v0" };
    const s = reconcileReducer(reconcilingWithErr, { type: "clearError" });
    expect(s.error).toBeNull();
    expect(s.phase).toBe("reconciling");
    // idle+no-error is returned unchanged (referential stability)
    expect(reconcileReducer(initialReconcileState, { type: "clearError" })).toBe(initialReconcileState);
  });

  it("models the full happy path: dispatch → await → version resolves", () => {
    let s = initialReconcileState;
    s = reconcileReducer(s, { type: "dispatch" });
    expect(isReconcileBusy(s)).toBe(true);
    s = reconcileReducer(s, { type: "await", version: "v0" });
    expect(isReconcileBusy(s)).toBe(true); // still busy while reconciling
    s = reconcileReducer(s, { type: "version", version: "v0" }); // stale echo — no-op
    expect(isReconcileBusy(s)).toBe(true);
    s = reconcileReducer(s, { type: "version", version: "v1" }); // fresh data
    expect(isReconcileBusy(s)).toBe(false);
  });
});

describe("rowsVersion", () => {
  const base: VersionRowGroup[] = [
    { key: "income", total: 800000, rows: [{ id: "a", updated_at: "2026-07-18T10:00:00Z" }] },
    { key: "taxPaid", total: 0, rows: [] },
  ];

  it("is stable for identical input (safe as an effect dependency)", () => {
    const copy: VersionRowGroup[] = [
      { key: "income", total: 800000, rows: [{ id: "a", updated_at: "2026-07-18T10:00:00Z" }] },
      { key: "taxPaid", total: 0, rows: [] },
    ];
    expect(rowsVersion(base)).toBe(rowsVersion(copy));
  });

  it("changes when a row is created (new id + count + total)", () => {
    const created: VersionRowGroup[] = [
      {
        key: "income",
        total: 850000,
        rows: [
          { id: "a", updated_at: "2026-07-18T10:00:00Z" },
          { id: "b", updated_at: "2026-07-18T10:05:00Z" },
        ],
      },
      { key: "taxPaid", total: 0, rows: [] },
    ];
    expect(rowsVersion(created)).not.toBe(rowsVersion(base));
  });

  it("changes when a row is updated (updated_at bumps)", () => {
    const updated: VersionRowGroup[] = [
      { key: "income", total: 900000, rows: [{ id: "a", updated_at: "2026-07-18T11:00:00Z" }] },
      { key: "taxPaid", total: 0, rows: [] },
    ];
    expect(rowsVersion(updated)).not.toBe(rowsVersion(base));
  });

  it("changes when a row is removed (id disappears)", () => {
    const removed: VersionRowGroup[] = [
      { key: "income", total: 0, rows: [] },
      { key: "taxPaid", total: 0, rows: [] },
    ];
    expect(rowsVersion(removed)).not.toBe(rowsVersion(base));
  });

  it("tolerates a missing updated_at without throwing", () => {
    expect(() => rowsVersion([{ key: "x", total: 1, rows: [{ id: "z" }] }])).not.toThrow();
  });
});

/**
 * Status-surface version helper (Phase K.2.9.2). Lifecycle surfaces (reopen,
 * finalize, review, sign-off, profile, checklist) build their `dataVersion` from
 * an ordered list of scalar fields that flip on the mutation. These tests pin the
 * two properties adopters rely on: stability for identical input, and a changed
 * string whenever ANY keyed field changes (so the reconcile resolves on success).
 */
describe("fieldsVersion", () => {
  it("is stable for identical input (safe as an effect dependency)", () => {
    const a = fieldsVersion(["finalized", "2026-07-18T10:00:00Z", null, true]);
    const b = fieldsVersion(["finalized", "2026-07-18T10:00:00Z", null, true]);
    expect(a).toBe(b);
  });

  it("changes when a status field flips (reopen: finalized → reopened)", () => {
    const before = fieldsVersion(["finalized", "2026-07-18T10:00:00Z", null]);
    const after = fieldsVersion(["reopened_needs_review", "2026-07-18T10:00:00Z", "2026-07-18T12:00:00Z"]);
    expect(after).not.toBe(before);
  });

  it("changes when only a timestamp bumps (idempotent re-save still observed)", () => {
    const before = fieldsVersion(["approved", "2026-07-18T10:00:00Z"]);
    const after = fieldsVersion(["approved", "2026-07-18T10:05:00Z"]);
    expect(after).not.toBe(before);
  });

  it("normalizes null/undefined to empty and does not collide with a real value", () => {
    expect(fieldsVersion([null, "x"])).toBe(fieldsVersion([undefined, "x"]));
    // A null field and an empty-string field are indistinguishable (documented);
    // but a null field must not collide with a populated one.
    expect(fieldsVersion([null, "x"])).not.toBe(fieldsVersion(["set", "x"]));
  });

  it("is order-sensitive (two fields swapping values changes the string)", () => {
    expect(fieldsVersion(["a", "b"])).not.toBe(fieldsVersion(["b", "a"]));
  });
});

/**
 * Orchestration contract (the part reducer tests can't cover). These drive the
 * controller with an injected scheduler so timing is deterministic — proving the
 * exact ordering the keystone fix depends on, without a browser or jsdom.
 */
describe("createReconcileController", () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));

  function harness(initialVersion = "v0", timeoutMs = 1000) {
    const scheduled: Array<() => void> = [];
    let refreshCount = 0;
    let changes = 0;
    const deps: ReconcileControllerDeps = {
      initialVersion,
      refresh: () => {
        refreshCount += 1;
      },
      schedule: (fn) => {
        scheduled.push(fn);
        return () => {
          const i = scheduled.indexOf(fn);
          if (i >= 0) scheduled.splice(i, 1);
        };
      },
      getTimeoutMs: () => timeoutMs,
      onChange: () => {
        changes += 1;
      },
    };
    const controller = createReconcileController(deps);
    return {
      controller,
      fireTimeout: () => scheduled.shift()?.(),
      pendingTimers: () => scheduled.length,
      refreshCount: () => refreshCount,
      changes: () => changes,
    };
  }

  const ok: () => Promise<ReconciledActionResult> = async () => ({ ok: true });

  function deferred() {
    let resolve!: (v: ReconciledActionResult) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<ReconciledActionResult>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  // ── The version-change race (review finding) ──────────────────────────────
  // Fresh props can land WHILE the action promise is still settling. The
  // baseline must be captured at run() start, not read from currentVersion after
  // the action resolves — otherwise the mutation's own new version becomes the
  // baseline and the write falsely times out as `unconfirmed`.
  it("recognises a version that arrived while the action was pending (no false timeout)", async () => {
    const h = harness("v0");
    const cb = vi.fn();
    const d = deferred();
    h.controller.run(() => d.promise, cb);
    await flush();
    expect(h.controller.getState().phase).toBe("pending");

    // Fresh server props land before the action resolves.
    h.controller.observe("v1");
    expect(cb).not.toHaveBeenCalled(); // not until the action itself succeeds
    expect(h.controller.getState().phase).toBe("pending");

    // Action resolves: baseline was v0, currentVersion is already v1 → reconcile
    // immediately. No refetch, no armed timer, callback exactly once.
    d.resolve({ ok: true });
    await flush();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(h.controller.getState().phase).toBe("idle");
    expect(h.pendingTimers()).toBe(0);
    expect(h.refreshCount()).toBe(0); // intentional: data already present
  });

  it("does not reconcile prematurely on an unchanged version observed while pending", async () => {
    const h = harness("v0");
    const cb = vi.fn();
    const d = deferred();
    h.controller.run(() => d.promise, cb);
    await flush();

    h.controller.observe("v0"); // echo of the baseline — not a real change
    d.resolve({ ok: true });
    await flush();

    // No change yet → normal reconciling: refresh requested, timer armed.
    expect(cb).not.toHaveBeenCalled();
    expect(h.controller.getState().phase).toBe("reconciling");
    expect(h.refreshCount()).toBe(1);
    expect(h.pendingTimers()).toBe(1);

    // The real change later resolves exactly once and clears the timer.
    h.controller.observe("v1");
    expect(cb).toHaveBeenCalledTimes(1);
    expect(h.controller.getState().phase).toBe("idle");
    expect(h.pendingTimers()).toBe(0);
  });

  it("does not fire callbacks or refresh after dispose while an action is pending", async () => {
    const h = harness("v0");
    const cb = vi.fn();
    const d = deferred();
    h.controller.run(() => d.promise, cb);
    await flush();

    h.controller.dispose(); // unmount mid-flight
    d.resolve({ ok: true });
    await flush();

    expect(cb).not.toHaveBeenCalled();
    expect(h.refreshCount()).toBe(0);
    expect(h.pendingTimers()).toBe(0);
    // observe() after dispose is inert too.
    h.controller.observe("v1");
    expect(cb).not.toHaveBeenCalled();
  });

  it("fires onReconciled ONLY after a different version is observed", async () => {
    const h = harness("v0");
    const cb = vi.fn();
    h.controller.run(ok, cb);
    await flush();

    expect(h.controller.getState().phase).toBe("reconciling");
    expect(h.refreshCount()).toBe(1); // refresh requested…
    expect(cb).not.toHaveBeenCalled(); // …but success NOT yet declared

    h.controller.observe("v0"); // identical — data hasn't landed
    expect(cb).not.toHaveBeenCalled();
    expect(h.controller.getState().phase).toBe("reconciling");

    h.controller.observe("v1"); // fresh data lands
    expect(cb).toHaveBeenCalledTimes(1);
    expect(h.controller.getState().phase).toBe("idle");
    expect(h.pendingTimers()).toBe(0); // liveness timer cleaned up
  });

  it("timeout never closes/toasts: no onReconciled, parks unconfirmed, stays busy", async () => {
    const h = harness("v0");
    const cb = vi.fn();
    h.controller.run(ok, cb);
    await flush();

    h.fireTimeout();
    expect(cb).not.toHaveBeenCalled(); // the crux: NO false success
    expect(h.controller.getState().phase).toBe("unconfirmed");
    expect(isReconcileBusy(h.controller.getState())).toBe(true); // submit stays disabled
  });

  it("self-heals: a late version change after timeout fires a real success", async () => {
    const h = harness("v0");
    const cb = vi.fn();
    h.controller.run(ok, cb);
    await flush();
    h.fireTimeout();

    h.controller.observe("v1");
    expect(cb).toHaveBeenCalledTimes(1);
    expect(h.controller.getState().phase).toBe("idle");
  });

  it("drops a re-entrant run (second click before the control disables)", async () => {
    const h = harness();
    const action = vi.fn(ok);
    h.controller.run(action);
    h.controller.run(action); // synchronous second call
    expect(action).toHaveBeenCalledTimes(1);
    await flush();
    h.controller.run(action); // still guarded while reconciling
    expect(action).toHaveBeenCalledTimes(1);
    // unconfirmed also blocks a resubmit
    h.fireTimeout();
    h.controller.run(action);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("a rejected action returns to idle with the error; retry allowed", async () => {
    const h = harness();
    const cb = vi.fn();
    h.controller.run(async () => ({ ok: false, error: "bad input" }), cb);
    await flush();
    expect(h.controller.getState()).toMatchObject({ phase: "idle", error: "bad input" });
    expect(cb).not.toHaveBeenCalled();

    const retry = vi.fn(ok);
    h.controller.run(retry);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("a thrown action is handled safely (idle + error), never stuck", async () => {
    const h = harness();
    h.controller.run(async () => {
      throw new Error("boom");
    });
    await flush();
    expect(h.controller.getState().phase).toBe("idle");
    expect(h.controller.getState().error).toBeTruthy();

    const retry = vi.fn(ok);
    h.controller.run(retry);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("dispose cancels a pending liveness timer", async () => {
    const h = harness();
    h.controller.run(ok);
    await flush();
    expect(h.pendingTimers()).toBe(1);
    h.controller.dispose();
    expect(h.pendingTimers()).toBe(0);
  });
});
