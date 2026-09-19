import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { TONE_CLASSES, type Tone } from "@/lib/ui/status-tone";

/**
 * NextActionPanel (K.2.8.5) — the one dominant "what to do now" affordance for a
 * screen. Tone-led, with a single primary CTA. Secondary actions are passed as
 * `meta` and stay visually subordinate.
 */
export function NextActionPanel({
  tone = "info",
  eyebrow = "Next action",
  title,
  description,
  href,
  cta,
  done,
  locked,
  meta,
  className,
}: {
  tone?: Tone;
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  href?: string;
  cta?: string;
  /** Nothing to do — render as a calm "you're all set" state. */
  done?: boolean;
  /** Finalized / read-only. */
  locked?: boolean;
  meta?: ReactNode;
  className?: string;
}) {
  const effectiveTone: Tone = locked ? "neutral" : done ? "success" : tone;
  const Icon = locked ? Lock : done ? CheckCircle2 : ArrowRight;
  return (
    <div
      className={cn(
        "rounded-xl border p-4 shadow-elev-1 sm:p-5",
        "border-l-4",
        TONE_CLASSES[effectiveTone].soft,
        className,
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
              TONE_CLASSES[effectiveTone].solid,
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0 space-y-0.5">
            <div className="text-xs font-semibold uppercase tracking-wide opacity-70">{eyebrow}</div>
            <div className="text-base font-semibold text-foreground">{title}</div>
            {description && <p className="text-sm text-foreground/70">{description}</p>}
          </div>
        </div>
        {href && cta && !locked && (
          <Link href={href} className={cn(buttonVariants(), "shrink-0 gap-2")}>
            {cta}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        )}
      </div>
      {meta && <div className="mt-3 border-t border-current/10 pt-3 text-xs text-foreground/70">{meta}</div>}
    </div>
  );
}
