"use client";

import { useCallback, useRef, type KeyboardEvent } from "react";
import { rovingNextIndex, rovingTabIndex, type TabOrientation } from "@/lib/ui/roving-tabs";

/**
 * useRovingTabList (K.2.8.7) — a thin, reusable WAI-ARIA tablist behaviour hook
 * shared by every Tax Desk tablist (ledger categories, queue segments). The
 * key math lives in the pure `roving-tabs.ts` model; this hook only wires it to
 * the DOM: roving tabindex, arrow/Home/End movement, and moving real focus to
 * the newly-active tab. Activation is AUTOMATIC (focus === selection) — correct
 * for these lightweight client-only tabs where switching just filters
 * already-loaded rows (no navigation, no data fetch).
 *
 * `Tab`/`Shift+Tab` are intentionally NOT handled, so they exit the tablist
 * instead of stepping through every tab.
 */
export function useRovingTabList({
  activeIndex,
  count,
  onActivate,
  orientation = "horizontal",
  isDisabled,
}: {
  activeIndex: number;
  count: number;
  onActivate: (index: number) => void;
  orientation?: TabOrientation;
  isDisabled?: (index: number) => boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      const next = rovingNextIndex({ key: e.key, current: activeIndex, count, orientation, isDisabled });
      if (next === null) return; // not a tablist nav key — let Tab/Enter behave normally
      e.preventDefault();
      onActivate(next);
      // Roving focus: move real DOM focus to the now-active tab. The tabs are
      // always rendered, so this works before the re-render lands.
      const tabs = listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]');
      tabs?.[next]?.focus();
    },
    [activeIndex, count, orientation, isDisabled, onActivate],
  );

  const getTabProps = useCallback(
    (index: number) => ({
      role: "tab" as const,
      tabIndex: rovingTabIndex(index, activeIndex),
      "aria-selected": index === activeIndex,
    }),
    [activeIndex],
  );

  return { listRef, onKeyDown, getTabProps };
}
