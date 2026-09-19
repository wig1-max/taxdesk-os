import { cn } from "@/lib/utils";
import {
  labelForStatus,
  TONE_CLASSES,
  toneForStatus,
  type Tone,
} from "@/lib/ui/status-tone";

/**
 * Status primitives (K.2.8.5). Every status in the product renders through
 * these so a given colour + dot always carries the same meaning. Colour is
 * never the only signal — a text label is always present.
 */

export function StatusDot({ tone, className }: { tone: Tone; className?: string }) {
  return (
    <span
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", TONE_CLASSES[tone].dot, className)}
      aria-hidden
    />
  );
}

export function StatusPill({
  code,
  tone: toneOverride,
  label,
  dot = true,
  className,
}: {
  code?: string | null;
  tone?: Tone;
  label?: string;
  dot?: boolean;
  className?: string;
}) {
  const tone = toneOverride ?? toneForStatus(code);
  const text = label ?? labelForStatus(code);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium capitalize",
        TONE_CLASSES[tone].soft,
        className,
      )}
    >
      {dot && <StatusDot tone={tone} />}
      {text}
    </span>
  );
}
