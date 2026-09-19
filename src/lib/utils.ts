import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Mask a PAN for display. Only ever call with pan_last4 from the DB. */
export function maskedPan(last4: string | null | undefined): string {
  return last4 ? `XXXXXX${last4}` : "—";
}

export function formatInr(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Unambiguous staff-facing calendar date in the office timezone.
 *
 * The explicit timezone is load-bearing for Client Components: Next renders
 * them once on the server and again in the browser during hydration. Relying
 * on either machine's local timezone can produce different first-paint text.
 */
export function formatStaffDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  })
    .format(d)
    .replace(/[  ]/g, " ");
}

/**
 * Unambiguous staff-facing timestamp, e.g. "12 Jul 2026, 3:33 AM IST".
 * Fixed to IST + explicit month name + uppercase AM/PM so it never depends on
 * the viewer's locale or engine's am/pm casing.
 */
export function formatStaffDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const s = new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(d);
  const normalized = s
    .replace(/[  ]/g, " ") // narrow/no-break spaces → plain space
    .replace(/\b([ap])\.?m\.?\b/gi, (_m, p: string) => `${p.toUpperCase()}M`); // am/pm → AM/PM
  return `${normalized} IST`;
}
