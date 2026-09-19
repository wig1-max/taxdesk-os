import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatInr } from "@/lib/utils";
import { TONE_CLASSES, type Tone } from "@/lib/ui/status-tone";

/**
 * Financial display primitives (K.2.8.5). Large, legible, tabular figures that
 * align across a group so amounts can be compared at a glance.
 */

export function FinancialMetric({
  label,
  value,
  hint,
  tone,
  size = "md",
  align = "left",
  className,
}: {
  label: ReactNode;
  /** Number → formatted as INR; string → rendered as-is. */
  value: number | string;
  hint?: ReactNode;
  tone?: Tone;
  size?: "sm" | "md" | "lg";
  align?: "left" | "right";
  className?: string;
}) {
  const display = typeof value === "number" ? formatInr(value) : value;
  const valueSize =
    size === "lg" ? "text-3xl" : size === "sm" ? "text-lg" : "text-2xl";
  return (
    <div className={cn("space-y-0.5", align === "right" && "text-right", className)}>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "tnum font-semibold leading-tight",
          valueSize,
          tone ? TONE_CLASSES[tone].text : "text-foreground",
        )}
      >
        {display}
      </div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function MetricGroup({
  children,
  className,
  cols = 3,
}: {
  children: ReactNode;
  className?: string;
  cols?: 2 | 3 | 4;
}) {
  const colClass =
    cols === 4
      ? "sm:grid-cols-2 lg:grid-cols-4"
      : cols === 2
        ? "sm:grid-cols-2"
        : "sm:grid-cols-2 lg:grid-cols-3";
  return (
    <div className={cn("grid gap-x-6 gap-y-4", colClass, className)}>{children}</div>
  );
}
