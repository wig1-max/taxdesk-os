"use client";

import { useEffect, useRef } from "react";

/**
 * Shared modal-dialog behaviour (extracted from `drawer.tsx` in K.2.9.5 so the
 * mobile navigation drawer in `app-shell.tsx` can reuse the exact same, already
 * hardened, focus semantics instead of a second implementation).
 *
 * While `open`, the returned ref's element:
 * - receives focus on open (first focusable child, or the panel itself);
 * - traps Tab / Shift+Tab within itself (never into the page behind);
 * - closes on Escape;
 * - restores focus on close — to `options.restoreFocusRef` when supplied
 *   (needed when the trigger is inside a region that becomes `inert`, which
 *   blurs it before the fallback capture can read `document.activeElement`),
 *   otherwise to whatever was focused when it opened;
 * - locks body scroll.
 *
 * Background inertness (`inert` / `aria-hidden`) is intentionally NOT handled
 * here: the hook can't know the surrounding DOM. Callers that portal to
 * `document.body` (Drawer/ConfirmDialog) rely on `aria-modal` + scroll-lock;
 * callers rendered inline (the nav drawer) apply `inert` to their own
 * background siblings.
 */

// The initial-focus query and the Tab-trap query differ by design (the trap
// also skips disabled inputs/selects). Kept verbatim from the original
// `useDialog` so Drawer/ConfirmDialog behaviour is unchanged.
const INITIAL_FOCUSABLE =
  'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';
const TRAP_FOCUSABLE =
  'a[href],button:not([disabled]),textarea,input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function useModalDialog<T extends HTMLElement = HTMLDivElement>(
  open: boolean,
  onClose: () => void,
  options?: { restoreFocusRef?: { readonly current: HTMLElement | null } },
) {
  const panelRef = useRef<T>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = options?.restoreFocusRef;

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // Focus the first focusable element (or the panel).
    const focusables = panel?.querySelectorAll<HTMLElement>(INITIAL_FOCUSABLE);
    (focusables && focusables[0] ? focusables[0] : panel)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Tab" && panel) {
        const list = panel.querySelectorAll<HTMLElement>(TRAP_FOCUSABLE);
        if (list.length === 0) return;
        const first = list[0];
        const last = list[list.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      // Prefer the explicit trigger (survives the background going inert);
      // fall back to whatever held focus when the dialog opened. Reading
      // `.current` at cleanup is intentional — we restore focus to the LIVE
      // trigger element, whose identity is stable across the dialog's lifetime.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const target = restoreFocusRef?.current ?? restoreRef.current;
      target?.focus?.();
    };
  }, [open, onClose, restoreFocusRef]);

  return panelRef;
}
