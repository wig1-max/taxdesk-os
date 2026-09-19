"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { StatusPill } from "@/components/ui/status";
import { EmptyState } from "@/components/ui/states";
import { useRovingTabList } from "@/components/ui/roving-tablist";
import {
  CASE_SEGMENTS,
  caseRowSegment,
  summarizeCaseRow,
  type CaseSegment,
} from "@/lib/tax-desk/case-queue";
import { cn } from "@/lib/utils";
import type { TaxCaseListRow } from "@/lib/queries/tax-desk";

/**
 * Segmented Tax Desk queue (K.2.8.6). Client-side filter over the already-safe
 * list rows — segments are derived from existing per-row statuses only (no
 * invented metrics). Every row links straight to its case workspace.
 */
export function CaseQueueTable({ rows }: { rows: TaxCaseListRow[] }) {
  const [segment, setSegment] = useState<CaseSegment | "all">("all");

  const withSeg = useMemo(
    () =>
      rows.map((r) => ({
        row: r,
        seg: caseRowSegment({
          caseStatus: r.case_status,
          clientReviewStatus: r.client_review_status,
          filingStatus: r.filing_status,
          eVerificationStatus: r.e_verification_status,
          itrSelected: r.itr_type_selected,
        }),
      })),
    [rows],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: withSeg.length };
    for (const { seg } of withSeg) c[seg] = (c[seg] ?? 0) + 1;
    return c;
  }, [withSeg]);

  const visible = segment === "all" ? withSeg : withSeg.filter((x) => x.seg === segment);

  // Ordered segment keys ("all" first) for roving-tabindex keyboard navigation.
  const segmentKeys = useMemo<(CaseSegment | "all")[]>(
    () => ["all", ...CASE_SEGMENTS.map((s) => s.key)],
    [],
  );
  const activeIndex = Math.max(0, segmentKeys.indexOf(segment));
  const { listRef, onKeyDown, getTabProps } = useRovingTabList({
    activeIndex,
    count: segmentKeys.length,
    onActivate: (i) => {
      const key = segmentKeys[i];
      if (key) setSegment(key);
    },
  });
  const panelId = "queue-panel";

  return (
    <div className="space-y-3">
      {/* Segment tabs */}
      <div
        ref={listRef}
        role="tablist"
        aria-label="Queue segment"
        aria-orientation="horizontal"
        onKeyDown={onKeyDown}
        className="flex flex-wrap gap-1.5"
      >
        <SegTab
          {...getTabProps(0)}
          controls={segment === "all" ? panelId : undefined}
          onClick={() => setSegment("all")}
          label="All cases"
          count={counts.all ?? 0}
        />
        {CASE_SEGMENTS.map((s, i) => (
          <SegTab
            key={s.key}
            {...getTabProps(i + 1)}
            controls={segment === s.key ? panelId : undefined}
            onClick={() => setSegment(s.key)}
            label={s.label}
            count={counts[s.key] ?? 0}
          />
        ))}
      </div>

      {visible.length === 0 ? (
        <div id={panelId} aria-label="Queue results" role="region">
          <EmptyState title="No cases in this view" description="Switch segment to see other cases." />
        </div>
      ) : (
        <div id={panelId} aria-label="Queue results" role="region" className="overflow-x-auto rounded-xl border bg-card shadow-elev-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Client / case</th>
                <th className="px-4 py-2.5 font-medium">AY</th>
                <th className="px-4 py-2.5 font-medium">Stage</th>
                <th className="px-4 py-2.5 font-medium">Next action</th>
                <th className="px-4 py-2.5 font-medium">Waiting on</th>
                <th className="px-4 py-2.5 font-medium">ITR</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ row: r }) => {
                const sum = summarizeCaseRow({
                  caseStatus: r.case_status,
                  clientReviewStatus: r.client_review_status,
                  filingStatus: r.filing_status,
                  eVerificationStatus: r.e_verification_status,
                  itrSelected: r.itr_type_selected,
                });
                return (
                  <tr key={r.id} className="border-b transition-colors last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-2.5">
                      <Link href={`/tax-desk/cases/${r.id}`} className="font-medium hover:underline">
                        {r.client_name}
                      </Link>
                      <div className="font-mono text-[0.7rem] text-muted-foreground">{r.case_display_code ?? "—"}</div>
                    </td>
                    <td className="px-4 py-2.5 tnum text-muted-foreground">{r.assessment_year}</td>
                    <td className="px-4 py-2.5">
                      <StatusPill tone={sum.tone} label={sum.stage} />
                    </td>
                    <td className="px-4 py-2.5">
                      <Link href={`/tax-desk/cases/${r.id}`} className="text-primary hover:underline">
                        {sum.next}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{sum.waitingOn ?? "—"}</td>
                    <td className="px-4 py-2.5 tnum text-muted-foreground">
                      {r.itr_type_selected ?? r.itr_type_recommended ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SegTab({
  onClick,
  label,
  count,
  controls,
  role,
  tabIndex,
  "aria-selected": ariaSelected,
}: {
  onClick: () => void;
  label: string;
  count: number;
  controls?: string;
  role: "tab";
  tabIndex: 0 | -1;
  "aria-selected": boolean;
}) {
  const active = ariaSelected;
  return (
    <button
      type="button"
      role={role}
      aria-selected={ariaSelected}
      aria-controls={controls}
      tabIndex={tabIndex}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted/50",
      )}
    >
      {label}
      <span className={cn("tnum rounded-full px-1.5 text-[0.65rem]", active ? "bg-white/20" : "bg-muted")}>{count}</span>
    </button>
  );
}
