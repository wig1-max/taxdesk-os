"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Accessible toast system (K.2.8.7). Internal, design-system-consistent — no
 * third-party dependency. Toasts SUPPLEMENT contextual feedback (they never
 * replace field validation, drawer errors, blocker explanations, readiness
 * detail, confirmation dialogs, or audit records).
 *
 * Accessibility:
 *   - routine success/info → role="status" + aria-live="polite"
 *   - urgent operation failures → role="alert" + aria-live="assertive"
 *   - dismissal pauses while the viewport is hovered or keyboard-focused
 *   - motion is the shared CSS entrance util, disabled under prefers-reduced-motion
 *   - non-critical success/info auto-dismiss; errors stay until dismissed
 *
 * Placement is bottom-center full-width on mobile and bottom-right on desktop,
 * clear of the ledger sticky header / workflow rail / case anchor and of the
 * mobile primary actions.
 *
 * NEVER pass PAN, Aadhaar, credentials, storage URLs, or note text into a toast.
 */

export type ToastVariant = "success" | "info" | "error";

export interface ToastOptions {
  variant?: ToastVariant;
  title: string;
  description?: string;
  /** ms before auto-dismiss. `null` = sticky. Default: errors sticky, else 5000. */
  duration?: number | null;
}

interface ToastRecord {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: string;
  duration: number | null;
}

interface ToastApi {
  toast: (opts: ToastOptions) => string;
  success: (title: string, description?: string) => string;
  info: (title: string, description?: string) => string;
  error: (title: string, description?: string) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_DURATION = 5000;
const MAX_VISIBLE = 4;

let counter = 0;
const nextId = () => `toast-${Date.now()}-${++counter}`;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const [paused, setPaused] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const dismiss = useCallback((id: string) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((opts: ToastOptions) => {
    const variant = opts.variant ?? "info";
    const id = nextId();
    const duration =
      opts.duration !== undefined ? opts.duration : variant === "error" ? null : DEFAULT_DURATION;
    setToasts((list) => {
      const next = [...list, { id, variant, title: opts.title, description: opts.description, duration }];
      // Cap the stack; drop the oldest so newest feedback is always visible.
      return next.length > MAX_VISIBLE ? next.slice(next.length - MAX_VISIBLE) : next;
    });
    return id;
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      toast,
      success: (title, description) => toast({ variant: "success", title, description }),
      info: (title, description) => toast({ variant: "info", title, description }),
      error: (title, description) => toast({ variant: "error", title, description }),
      dismiss,
    }),
    [toast, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {mounted &&
        createPortal(
          <div
            role="region"
            aria-label="Notifications"
            className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-3 sm:inset-x-auto sm:right-0 sm:items-end sm:p-4"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocusCapture={() => setPaused(true)}
            onBlurCapture={() => setPaused(false)}
          >
            {toasts.map((t) => (
              <ToastItem key={t.id} toast={t} paused={paused} onDismiss={dismiss} />
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

const VARIANT_STYLES: Record<ToastVariant, { border: string; icon: typeof Info; iconClass: string }> = {
  success: { border: "border-l-success", icon: CheckCircle2, iconClass: "text-success" },
  info: { border: "border-l-info", icon: Info, iconClass: "text-info" },
  error: { border: "border-l-danger", icon: AlertTriangle, iconClass: "text-danger" },
};

function ToastItem({
  toast,
  paused,
  onDismiss,
}: {
  toast: ToastRecord;
  paused: boolean;
  onDismiss: (id: string) => void;
}) {
  const remainingRef = useRef<number>(toast.duration ?? 0);
  const style = VARIANT_STYLES[toast.variant];
  const Icon = style.icon;
  const isError = toast.variant === "error";

  useEffect(() => {
    if (toast.duration === null) return; // sticky — manual dismiss only
    if (paused) return; // hovered/focused — hold; remaining is preserved by cleanup
    const start = Date.now();
    const timer = setTimeout(() => onDismiss(toast.id), Math.max(0, remainingRef.current));
    return () => {
      clearTimeout(timer);
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - start));
    };
  }, [paused, toast.duration, toast.id, onDismiss]);

  return (
    <div
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      className={cn(
        "pointer-events-auto w-full max-w-sm rounded-lg border border-l-4 bg-elevated p-3 shadow-elev-3 animate-rise-in",
        style.border,
      )}
    >
      <div className="flex items-start gap-2.5">
        <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", style.iconClass)} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug">{toast.title}</p>
          {toast.description && (
            <p className="mt-0.5 text-xs text-muted-foreground">{toast.description}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          aria-label="Dismiss notification"
          className="-mr-1 -mt-1 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** Access the toast API. Safe no-op fallback if used outside a provider. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (ctx) return ctx;
  // Defensive fallback — never throw from a feedback helper.
  const noop = () => "";
  return { toast: noop, success: noop, info: noop, error: noop, dismiss: () => {} };
}
