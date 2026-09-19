/**
 * Pure roving-tabindex keyboard model for WAI-ARIA tablists (K.2.8.7). No React
 * imports — the arrow/Home/End math lives here so it is trivially unit-testable;
 * the `useRovingTabList` hook (roving-tablist.tsx) is a thin DOM wrapper over it.
 *
 * Contract (APG Tabs, automatic activation):
 *   - horizontal: ArrowRight → next, ArrowLeft → previous
 *   - vertical:   ArrowDown  → next, ArrowUp   → previous
 *   - Home → first focusable tab, End → last focusable tab
 *   - movement wraps (last → first, first → last)
 *   - disabled tabs are skipped; if every tab is disabled, focus does not move
 *   - any other key returns null (the tablist does not handle it, so Tab still
 *     moves focus OUT of the tablist rather than between tabs)
 */

export type TabOrientation = "horizontal" | "vertical";

export interface RovingKeyContext {
  key: string;
  /** Index of the currently focused tab. */
  current: number;
  /** Total number of tabs. */
  count: number;
  orientation?: TabOrientation;
  /** Predicate: is the tab at this index disabled (skipped)? */
  isDisabled?: (index: number) => boolean;
}

const NEXT_KEYS: Record<TabOrientation, string> = { horizontal: "ArrowRight", vertical: "ArrowDown" };
const PREV_KEYS: Record<TabOrientation, string> = { horizontal: "ArrowLeft", vertical: "ArrowUp" };

/** Step from `start` in `dir` (+1/−1), wrapping, until a non-disabled tab is
 *  found. Returns `start` if every other tab is disabled, or null if none are
 *  focusable at all. */
function seek(start: number, dir: 1 | -1, count: number, isDisabled: (i: number) => boolean): number | null {
  if (count <= 0) return null;
  for (let step = 1; step <= count; step++) {
    const idx = (((start + dir * step) % count) + count) % count;
    if (!isDisabled(idx)) return idx;
  }
  return isDisabled(start) ? null : start;
}

/** First / last focusable index in the given direction (for Home / End). */
function edge(from: number, dir: 1 | -1, count: number, isDisabled: (i: number) => boolean): number | null {
  const start = dir === 1 ? 0 : count - 1;
  for (let i = 0; i < count; i++) {
    const idx = start + dir * i;
    if (!isDisabled(idx)) return idx;
  }
  return null;
}

/**
 * Given a keydown context, return the index the roving focus should move to, or
 * `null` when this key is not a tablist navigation key (caller should not
 * preventDefault, so Tab/Shift+Tab keep exiting the tablist normally).
 */
export function rovingNextIndex(ctx: RovingKeyContext): number | null {
  const { key, current, count } = ctx;
  const orientation: TabOrientation = ctx.orientation ?? "horizontal";
  const isDisabled = ctx.isDisabled ?? (() => false);
  if (count <= 0) return null;

  if (key === NEXT_KEYS[orientation]) return seek(current, 1, count, isDisabled);
  if (key === PREV_KEYS[orientation]) return seek(current, -1, count, isDisabled);
  if (key === "Home") return edge(0, 1, count, isDisabled);
  if (key === "End") return edge(0, -1, count, isDisabled);
  return null;
}

/** Roving tabindex value for a tab: only the active tab is in the Tab order. */
export function rovingTabIndex(index: number, activeIndex: number): 0 | -1 {
  return index === activeIndex ? 0 : -1;
}
