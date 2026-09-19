import { describe, expect, it } from "vitest";
import { rovingNextIndex, rovingTabIndex } from "@/lib/ui/roving-tabs";

/**
 * K.2.8.7 — pure roving-tabindex keyboard model for Tax Desk tablists.
 */

describe("rovingNextIndex — horizontal arrows", () => {
  const ctx = (key: string, current: number) => ({ key, current, count: 4 });

  it("ArrowRight moves to the next tab", () => {
    expect(rovingNextIndex(ctx("ArrowRight", 0))).toBe(1);
    expect(rovingNextIndex(ctx("ArrowRight", 2))).toBe(3);
  });

  it("ArrowLeft moves to the previous tab", () => {
    expect(rovingNextIndex(ctx("ArrowLeft", 2))).toBe(1);
    expect(rovingNextIndex(ctx("ArrowLeft", 1))).toBe(0);
  });

  it("wraps last → first and first → last", () => {
    expect(rovingNextIndex(ctx("ArrowRight", 3))).toBe(0);
    expect(rovingNextIndex(ctx("ArrowLeft", 0))).toBe(3);
  });

  it("Home jumps to the first tab, End to the last", () => {
    expect(rovingNextIndex(ctx("Home", 2))).toBe(0);
    expect(rovingNextIndex(ctx("End", 1))).toBe(3);
  });

  it("returns null for keys the tablist does not own (so Tab exits)", () => {
    expect(rovingNextIndex(ctx("Tab", 1))).toBeNull();
    expect(rovingNextIndex(ctx("ArrowUp", 1))).toBeNull(); // vertical key on horizontal list
    expect(rovingNextIndex(ctx("Enter", 1))).toBeNull();
    expect(rovingNextIndex(ctx("a", 1))).toBeNull();
  });
});

describe("rovingNextIndex — vertical orientation", () => {
  const ctx = (key: string, current: number) => ({ key, current, count: 3, orientation: "vertical" as const });

  it("uses ArrowDown/ArrowUp and ignores horizontal arrows", () => {
    expect(rovingNextIndex(ctx("ArrowDown", 0))).toBe(1);
    expect(rovingNextIndex(ctx("ArrowUp", 0))).toBe(2); // wrap
    expect(rovingNextIndex(ctx("ArrowRight", 0))).toBeNull();
    expect(rovingNextIndex(ctx("ArrowLeft", 0))).toBeNull();
  });
});

describe("rovingNextIndex — disabled tabs are skipped", () => {
  // Tabs: [0 enabled, 1 DISABLED, 2 enabled, 3 DISABLED]
  const isDisabled = (i: number) => i === 1 || i === 3;
  const ctx = (key: string, current: number) => ({ key, current, count: 4, isDisabled });

  it("ArrowRight skips over a disabled neighbour", () => {
    expect(rovingNextIndex(ctx("ArrowRight", 0))).toBe(2); // skips 1
  });

  it("wraps past a trailing disabled tab", () => {
    expect(rovingNextIndex(ctx("ArrowRight", 2))).toBe(0); // skips 3, wraps to 0
  });

  it("ArrowLeft skips a disabled neighbour", () => {
    expect(rovingNextIndex(ctx("ArrowLeft", 2))).toBe(0); // skips 1
  });

  it("Home/End land on the first/last ENABLED tab", () => {
    expect(rovingNextIndex(ctx("Home", 2))).toBe(0);
    expect(rovingNextIndex(ctx("End", 0))).toBe(2); // 3 is disabled → last enabled is 2
  });

  it("does not move when every tab is disabled", () => {
    const allDisabled = { key: "ArrowRight", current: 0, count: 3, isDisabled: () => true };
    expect(rovingNextIndex(allDisabled)).toBeNull();
  });
});

describe("rovingNextIndex — empty tablist", () => {
  it("returns null when there are no tabs", () => {
    expect(rovingNextIndex({ key: "ArrowRight", current: 0, count: 0 })).toBeNull();
  });
});

describe("rovingTabIndex — roving tabindex", () => {
  it("only the active tab is tabbable (0); the rest are -1", () => {
    expect(rovingTabIndex(1, 1)).toBe(0);
    expect(rovingTabIndex(0, 1)).toBe(-1);
    expect(rovingTabIndex(2, 1)).toBe(-1);
  });
});
