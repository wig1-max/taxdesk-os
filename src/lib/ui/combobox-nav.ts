/**
 * Pure keyboard model for a WAI-ARIA 1.2 combobox with a listbox popup
 * (`K3-ENV-4` searchable client selector). No React imports — the arrow/Home/End
 * math and the open/close/commit decisions live here so they are trivially
 * unit-testable; the component is a thin DOM wrapper over it.
 *
 * Contract (APG "Combobox with List Autocomplete"):
 *   - ArrowDown / ArrowUp move the active option and WRAP; when the popup is
 *     closed they open it (ArrowDown → first, ArrowUp → last)
 *   - Home / End jump to the first / last option
 *   - Enter commits the active option, and only when one is active
 *   - Escape closes the popup without committing
 *   - Tab closes the popup WITHOUT committing and is never swallowed, so focus
 *     always leaves the control normally
 *   - any other key returns `none`, so typing is handled by the input itself
 *
 * A commit is deliberately never implied by mere navigation: unlike the tablist
 * (automatic activation), selecting a client is a data decision, so it requires
 * an explicit Enter or click.
 */

export type ComboboxAction =
  | { kind: "none" }
  | { kind: "open"; activeIndex: number }
  | { kind: "move"; activeIndex: number }
  | { kind: "commit"; index: number }
  | { kind: "close" };

export interface ComboboxKeyContext {
  key: string;
  /** Is the listbox popup currently open? */
  open: boolean;
  /** Index of the active option, or -1 when none is active. */
  activeIndex: number;
  /** Number of options currently listed. */
  count: number;
}

const NONE: ComboboxAction = { kind: "none" };

function wrap(index: number, count: number): number {
  return ((index % count) + count) % count;
}

/**
 * Given a keydown context, return what the combobox should do. Callers should
 * `preventDefault()` for every result except `none`.
 */
export function comboboxKeyAction(ctx: ComboboxKeyContext): ComboboxAction {
  const { key, open, activeIndex, count } = ctx;

  if (key === "Escape") return open ? { kind: "close" } : NONE;
  // Tab must keep moving focus out; close the popup but never swallow the key.
  if (key === "Tab") return open ? { kind: "close" } : NONE;

  if (key === "ArrowDown" || key === "ArrowUp") {
    const dir = key === "ArrowDown" ? 1 : -1;
    if (count <= 0) return NONE;
    if (!open) return { kind: "open", activeIndex: dir === 1 ? 0 : count - 1 };
    // From "no active option", ArrowDown starts at the first and ArrowUp at the
    // last, rather than treating -1 as a real position.
    if (activeIndex < 0) return { kind: "move", activeIndex: dir === 1 ? 0 : count - 1 };
    return { kind: "move", activeIndex: wrap(activeIndex + dir, count) };
  }

  if (open && count > 0 && (key === "Home" || key === "End")) {
    return { kind: "move", activeIndex: key === "Home" ? 0 : count - 1 };
  }

  if (key === "Enter") {
    if (open && activeIndex >= 0 && activeIndex < count) {
      return { kind: "commit", index: activeIndex };
    }
    // No active option: do NOT commit, and do not submit the form by accident
    // while the popup is open.
    return open ? { kind: "close" } : NONE;
  }

  return NONE;
}

/**
 * Clamp a previously-active index against a newly-arrived result list. Search
 * results change under the user as they type, so an index that no longer exists
 * must become "nothing active" rather than silently pointing at a different
 * client than the one that was highlighted.
 */
export function clampActiveIndex(activeIndex: number, count: number): number {
  if (count <= 0) return -1;
  return activeIndex >= 0 && activeIndex < count ? activeIndex : -1;
}
