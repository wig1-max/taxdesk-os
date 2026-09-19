import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Settle helper for surfaces driven by `useReconciledAction` (MAINT-06).
 *
 * WHY THIS EXISTS. A reconciled mutation has TWO designed terminal states, and
 * both mean the server accepted the write:
 *
 *   - CONFIRMED   — fresh props landed, `onReconciled` fired, success toast shown;
 *   - UNCONFIRMED — fresh props did NOT land within the primitive's liveness
 *                   bound (`reconcileTimeoutMs`, default 12 000 ms), so the
 *                   surface parks in `unconfirmed` and DELIBERATELY withholds the
 *                   success toast (`reconcile-core.ts`: a timeout never declares
 *                   success).
 *
 * A test that waits only for the toast therefore asserts a signal the product is
 * explicitly allowed to withhold. On a slow host the reconcile crosses 12 s, the
 * surface parks — correctly — and the test fails even though the write succeeded.
 * That is a FALSE NEGATIVE in the test, not a product defect: `MAINT-06`
 * reproduced it on demand by delaying one RSC refetch past 12 s and confirmed the
 * row was persisted while the toast never appeared.
 *
 * WHAT THIS DOES NOT DO. It does not soften any assertion about the DURABLE
 * outcome. Callers must still assert the persisted result (row counts, DB reads)
 * exactly as before — this helper only replaces the timing-dependent "did a toast
 * appear" wait with "has the action reached a terminal state, and which one".
 *
 * The `settleTimeoutMs` default deliberately EXCEEDS the product's own 12 s
 * liveness bound, because an assertion window smaller than that bound is
 * structurally incapable of observing the `unconfirmed` state it needs to
 * distinguish. It is scoped to this helper: the suite's `timeout` (45 s) and
 * `expect.timeout` (15 s) in `playwright.config.ts` are UNCHANGED.
 */

export type ReconcileOutcome = "confirmed" | "unconfirmed";

/** Every `UnconfirmedNotice` renders `data-testid="<surface>-unconfirmed"`, and
 *  `ledger-workspace.tsx`'s own copy follows the same convention. */
const UNCONFIRMED_SELECTOR = '[data-testid$="-unconfirmed"]';

/**
 * Wait for a reconciled action to reach a terminal state and report which one.
 *
 * @param toast   Locator (or exact text) of the success toast the surface shows
 *                on the confirmed path.
 * @returns `"confirmed"` when the success toast rendered, `"unconfirmed"` when
 *          the surface parked in the designed recovery state instead.
 */
export async function settleReconciled(
  page: Page,
  toast: string | Locator,
  { settleTimeoutMs = 20_000 }: { settleTimeoutMs?: number } = {},
): Promise<ReconcileOutcome> {
  const toastLocator = typeof toast === "string" ? page.getByText(toast) : toast;
  const unconfirmed = page.locator(UNCONFIRMED_SELECTOR);

  await expect(toastLocator.or(unconfirmed).first()).toBeVisible({ timeout: settleTimeoutMs });

  // Check the park first: it is the more specific, longer-lived signal (the
  // toast auto-dismisses, the notice stays until reload or a late self-heal).
  if (await unconfirmed.first().isVisible()) return "unconfirmed";
  return "confirmed";
}

/**
 * Settle a reconciled action and fail if it did not reach a terminal state.
 * Use where the test's subject is the DURABLE outcome asserted immediately
 * afterwards; the confirmed/unconfirmed distinction is returned, not asserted,
 * because both are legitimate outcomes of an accepted write.
 *
 * Also correct where the test's very next step is an unconditional
 * `page.reload()` — that reload already supplies the fresh DOM, so nothing is
 * gained by reloading again inside the helper.
 */
export async function expectReconciled(
  page: Page,
  toast: string | Locator,
  opts?: { settleTimeoutMs?: number },
): Promise<ReconcileOutcome> {
  return settleReconciled(page, toast, opts);
}

/**
 * Settle a reconciled action, and on the UNCONFIRMED path reload so the test can
 * keep driving the surface against fresh server state (`MAINT-08`, `D191`).
 *
 * WHY A SECOND HELPER. `expectReconciled` is sufficient only when the test stops
 * touching the page. Most converted sites do not: they go on to assert refreshed
 * DOM (`await expect(row).toContainText("received")`) or to click the surface's
 * next control. Both fail on the unconfirmed path for the SAME reason the toast
 * was withheld — fresh props never landed, so the DOM is stale and, because
 * `useReconciledAction` keeps `busy` true while parked (deliberately, so a
 * retry cannot double-write), the surface's controls are still disabled.
 * A tolerant wait alone would therefore convert a false failure at the toast
 * into a false failure three lines later.
 *
 * THE RELOAD IS THE PRODUCT'S OWN RECOVERY, not a workaround: `UnconfirmedNotice`
 * exists precisely to offer the operator a hard reload, and the write has already
 * been accepted by the server. Reloading is what a user is told to do here.
 *
 * WHAT THIS DOES NOT DO. It does not retry the mutation, soften any assertion, or
 * touch the confirmed path — on `"confirmed"` it returns without reloading, so
 * the fast path is byte-for-byte the old behaviour. A genuinely FAILED write
 * still fails the test: neither terminal signal appears, and `settleReconciled`
 * times out.
 *
 * HOW STRONG THE EVIDENCE ACTUALLY IS (`MAINT-08`, measured — not assumed; the
 * harness was temporary and is not in the tree). Stated precisely so nobody
 * later mistakes this for a demonstrated necessity:
 *
 *   1. Delaying one RSC refetch by 14 s on a real converted chain (spec 30's
 *      control) parked the surface `unconfirmed`; this helper reloaded and the
 *      test drove the surface to completion. The degraded branch DOES work.
 *   2. The SAME scenario ALSO passed with a plain `expectReconciled` and no
 *      reload — because a delayed refetch still lands, and the primitive's late
 *      self-heal refreshed the DOM before the next interaction ran. So the
 *      reload removes a RESIDUAL RACE; it is not a fix for a demonstrated
 *      failure, and this helper is a determinism guarantee, not a bug fix.
 *      It is kept because winning that race is timing-dependent on exactly the
 *      slow hosts this work exists to survive, and because a parked surface
 *      holds `busy` true — so the alternative is auto-waiting on a disabled
 *      control, which spends the 15 s expect budget against the 45 s TEST
 *      budget that is the OTHER half of the `MAINT-06` flake pair.
 *   3. If the refetch never lands at all (hard abort), Next.js falls back to a
 *      full document navigation, which wipes BOTH the toast and the notice, so
 *      neither terminal signal is observable and this helper times out. That is
 *      PRE-EXISTING and unchanged: the bare toast wait this replaces fails in
 *      the same scenario for the same reason. Not fixed here, not worsened here.
 */
export async function reconcileForFreshUi(
  page: Page,
  toast: string | Locator,
  opts?: { settleTimeoutMs?: number },
): Promise<ReconcileOutcome> {
  const outcome = await settleReconciled(page, toast, opts);
  if (outcome === "unconfirmed") await page.reload();
  return outcome;
}
