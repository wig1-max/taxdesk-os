"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { STAGE_TONE, type WorkflowStage } from "@/lib/tax-desk/workflow";
import { TONE_CLASSES } from "@/lib/ui/status-tone";

/**
 * TaxWorkflowRail (K.2.8.5 · mobile stepper added K.2.8.6) — the persistent
 * 7-step pipeline navigator on every Tax Desk case route.
 *
 * Desktop: a horizontal rail with per-step state (dot + icon). Mobile: an
 * explicit "Step X of 7" stepper with the current stage name/status,
 * previous/next controls, and an expandable full selector — no reliance on
 * invisible horizontal scrolling.
 */
export function TaxWorkflowRail({
  basePath,
  stages,
}: {
  basePath: string;
  stages: WorkflowStage[];
}) {
  const pathname = usePathname();
  const activeSegment = useMemo(() => {
    const rest = pathname.replace(basePath, "").replace(/^\//, "");
    return rest.split("/")[0] ?? "";
  }, [pathname, basePath]);

  const activeIndex = stages.findIndex((s) => s.segment === activeSegment);
  // On the overview (no segment), point at the first not-yet-complete stage.
  const resolvedIndex =
    activeIndex >= 0
      ? activeIndex
      : Math.max(
          0,
          stages.findIndex((s) => !["complete", "finalized", "waiting"].includes(s.status)),
        );
  const activeKey = stages[activeIndex]?.key ?? null;
  const hrefFor = (s: WorkflowStage) => (s.segment ? `${basePath}/${s.segment}` : basePath);

  const current = stages[resolvedIndex];
  const prev = resolvedIndex > 0 ? stages[resolvedIndex - 1] : null;
  const next = resolvedIndex < stages.length - 1 ? stages[resolvedIndex + 1] : null;

  return (
    <nav aria-label="Tax Desk workbench">
      {/* Desktop rail */}
      <ol className="hidden items-stretch gap-1 overflow-x-auto md:flex">
        {stages.map((s, idx) => {
          const tone = STAGE_TONE[s.status];
          const done = s.status === "complete" || s.status === "finalized";
          const active = s.key === activeKey;
          return (
            <li key={s.key} className="flex items-center">
              <Link
                href={hrefFor(s)}
                aria-current={active ? "step" : undefined}
                className={cn(
                  "group flex min-w-[8.5rem] flex-col gap-1 rounded-lg border px-3 py-2 transition-all duration-[var(--motion-fast)]",
                  active ? "border-primary bg-accent shadow-elev-1" : "border-transparent hover:border-border hover:bg-muted/50",
                )}
              >
                <span className="flex items-center gap-2">
                  <StepMark idx={idx} status={s.status} tone={tone} done={done} />
                  <span className={cn("truncate text-xs font-semibold", active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground")}>
                    {s.label}
                  </span>
                </span>
                <span className={cn("truncate pl-7 text-[0.7rem]", TONE_CLASSES[tone].text)}>{s.hint}</span>
              </Link>
              {idx < stages.length - 1 && <span className="mx-0.5 h-px w-3 shrink-0 bg-border" aria-hidden />}
            </li>
          );
        })}
      </ol>

      {/* Mobile stepper */}
      {current && (
        <div className="md:hidden">
          <div className="flex items-center gap-2">
            <StepNav to={prev ? hrefFor(prev) : null} dir="prev" label={prev?.label} />
            <details className="group min-w-0 flex-1 rounded-lg border bg-card">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0">
                  <span className="block text-[0.65rem] uppercase tracking-wide text-muted-foreground">
                    Step {resolvedIndex + 1} of {stages.length}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <StepMark idx={resolvedIndex} status={current.status} tone={STAGE_TONE[current.status]} done={current.status === "complete" || current.status === "finalized"} />
                    <span className="truncate text-sm font-semibold">{current.label}</span>
                  </span>
                  <span className={cn("block truncate text-[0.7rem]", TONE_CLASSES[STAGE_TONE[current.status]].text)}>{current.hint}</span>
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <ul className="divide-y border-t">
                {stages.map((s, idx) => (
                  <li key={s.key}>
                    <Link
                      href={hrefFor(s)}
                      aria-current={s.key === activeKey ? "step" : undefined}
                      className={cn("flex items-center gap-2 px-3 py-2 text-sm", s.key === activeKey ? "bg-accent font-semibold" : "hover:bg-muted/50")}
                    >
                      <StepMark idx={idx} status={s.status} tone={STAGE_TONE[s.status]} done={s.status === "complete" || s.status === "finalized"} />
                      <span className="flex-1 truncate">{s.label}</span>
                      <span className={cn("text-[0.7rem]", TONE_CLASSES[STAGE_TONE[s.status]].text)}>{s.hint}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
            <StepNav to={next ? hrefFor(next) : null} dir="next" label={next?.label} />
          </div>
        </div>
      )}
    </nav>
  );
}

function StepMark({
  idx,
  status,
  tone,
  done,
}: {
  idx: number;
  status: string;
  tone: keyof typeof TONE_CLASSES;
  done: boolean;
}) {
  return (
    <span
      className={cn(
        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.6rem] font-bold text-white",
        done ? TONE_CLASSES[tone].solid : TONE_CLASSES[tone].dot,
      )}
    >
      {status === "finalized" ? <Lock className="h-3 w-3" aria-hidden /> : done ? <Check className="h-3 w-3" aria-hidden /> : idx + 1}
    </span>
  );
}

function StepNav({ to, dir, label }: { to: string | null; dir: "prev" | "next"; label?: string }) {
  const Icon = dir === "prev" ? ChevronLeft : ChevronRight;
  const aria = `${dir === "prev" ? "Previous" : "Next"} stage${label ? `: ${label}` : ""}`;
  if (!to) {
    return (
      <span className="flex h-10 w-9 shrink-0 items-center justify-center rounded-lg border text-muted-foreground/40" aria-hidden>
        <Icon className="h-4 w-4" />
      </span>
    );
  }
  return (
    <Link href={to} aria-label={aria} className="flex h-10 w-9 shrink-0 items-center justify-center rounded-lg border bg-card hover:bg-accent">
      <Icon className="h-4 w-4" />
    </Link>
  );
}
