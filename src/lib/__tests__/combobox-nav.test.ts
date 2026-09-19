import { describe, expect, it } from "vitest";
import { clampActiveIndex, comboboxKeyAction } from "../ui/combobox-nav";

const ctx = (over: Partial<Parameters<typeof comboboxKeyAction>[0]> = {}) => ({
  key: "ArrowDown",
  open: true,
  activeIndex: -1,
  count: 3,
  ...over,
});

describe("comboboxKeyAction — WAI-ARIA combobox keyboard model", () => {
  it("opens the popup from a closed state, entering at the correct edge", () => {
    expect(comboboxKeyAction(ctx({ key: "ArrowDown", open: false }))).toEqual({
      kind: "open",
      activeIndex: 0,
    });
    expect(comboboxKeyAction(ctx({ key: "ArrowUp", open: false }))).toEqual({
      kind: "open",
      activeIndex: 2,
    });
  });

  it("moves and wraps in both directions", () => {
    expect(comboboxKeyAction(ctx({ activeIndex: 0 }))).toEqual({ kind: "move", activeIndex: 1 });
    expect(comboboxKeyAction(ctx({ activeIndex: 2 }))).toEqual({ kind: "move", activeIndex: 0 });
    expect(comboboxKeyAction(ctx({ key: "ArrowUp", activeIndex: 0 }))).toEqual({
      kind: "move",
      activeIndex: 2,
    });
  });

  it("treats 'no active option' as before-the-first, not as a position", () => {
    expect(comboboxKeyAction(ctx({ activeIndex: -1 }))).toEqual({ kind: "move", activeIndex: 0 });
    expect(comboboxKeyAction(ctx({ key: "ArrowUp", activeIndex: -1 }))).toEqual({
      kind: "move",
      activeIndex: 2,
    });
  });

  it("jumps to the edges with Home/End only while open", () => {
    expect(comboboxKeyAction(ctx({ key: "Home", activeIndex: 2 }))).toEqual({
      kind: "move",
      activeIndex: 0,
    });
    expect(comboboxKeyAction(ctx({ key: "End", activeIndex: 0 }))).toEqual({
      kind: "move",
      activeIndex: 2,
    });
    expect(comboboxKeyAction(ctx({ key: "Home", open: false }))).toEqual({ kind: "none" });
  });

  it("commits ONLY an explicitly active option — navigation never implies selection", () => {
    expect(comboboxKeyAction(ctx({ key: "Enter", activeIndex: 1 }))).toEqual({
      kind: "commit",
      index: 1,
    });
    // Open with nothing highlighted: close, never commit, and never fall through
    // to a form submit.
    expect(comboboxKeyAction(ctx({ key: "Enter", activeIndex: -1 }))).toEqual({ kind: "close" });
    // Closed: the key belongs to the form, not to us.
    expect(comboboxKeyAction(ctx({ key: "Enter", open: false }))).toEqual({ kind: "none" });
  });

  it("never commits an index outside the current result list", () => {
    expect(comboboxKeyAction(ctx({ key: "Enter", activeIndex: 5, count: 3 }))).toEqual({
      kind: "close",
    });
  });

  it("closes on Escape, and lets Tab close WITHOUT being swallowed", () => {
    expect(comboboxKeyAction(ctx({ key: "Escape" }))).toEqual({ kind: "close" });
    expect(comboboxKeyAction(ctx({ key: "Escape", open: false }))).toEqual({ kind: "none" });
    expect(comboboxKeyAction(ctx({ key: "Tab" }))).toEqual({ kind: "close" });
    expect(comboboxKeyAction(ctx({ key: "Tab", open: false }))).toEqual({ kind: "none" });
  });

  it("does nothing with an empty list, so typing is never blocked", () => {
    expect(comboboxKeyAction(ctx({ count: 0 }))).toEqual({ kind: "none" });
    expect(comboboxKeyAction(ctx({ key: "ArrowUp", count: 0, open: false }))).toEqual({
      kind: "none",
    });
    expect(comboboxKeyAction(ctx({ key: "a" }))).toEqual({ kind: "none" });
  });
});

describe("clampActiveIndex — results change under the user as they type", () => {
  it("drops an index the new result list no longer has", () => {
    expect(clampActiveIndex(4, 2)).toBe(-1);
    expect(clampActiveIndex(0, 0)).toBe(-1);
  });

  it("keeps a still-valid index", () => {
    expect(clampActiveIndex(1, 3)).toBe(1);
  });
});
