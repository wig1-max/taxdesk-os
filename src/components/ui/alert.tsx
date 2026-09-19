import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, Lock, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { TONE_CLASSES, type Tone } from "@/lib/ui/status-tone";

/**
 * Callout / alert primitives (K.2.8.5). One component, tone-driven, with an
 * icon so meaning survives without colour. Use `WarningAlert` for
 * review-but-proceed, `LockBanner` for finalized/read-only.
 */

const ICONS: Record<Tone, typeof Info> = {
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
  info: Info,
  neutral: Info,
  primary: Info,
};

export function Callout({
  tone,
  title,
  children,
  icon: IconOverride,
  action,
  className,
}: {
  tone: Tone;
  title?: ReactNode;
  children?: ReactNode;
  icon?: typeof Info;
  action?: ReactNode;
  className?: string;
}) {
  const Icon = IconOverride ?? ICONS[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "note"}
      className={cn(
        "flex items-start gap-3 rounded-lg border px-4 py-3 text-sm",
        TONE_CLASSES[tone].soft,
        className,
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className="text-foreground/80">{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export const WarningAlert = (p: Omit<Parameters<typeof Callout>[0], "tone">) => (
  <Callout tone="warning" {...p} />
);

export function LockBanner({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Callout tone="neutral" icon={Lock} title="Read-only — internally finalized" className={className}>
      {children}
    </Callout>
  );
}
