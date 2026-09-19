"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import {
  refreshTaxValidationAction,
  reopenTaxValidationFindingAction,
  resolveTaxValidationFindingAction,
} from "@/app/actions/tax-validation";
import { ConfirmDialog } from "@/components/ui/drawer";
import { StatusDot, StatusPill } from "@/components/ui/status";
import { EmptyState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { useReconciledAction } from "@/components/ui/use-reconciled-action";
import { UnconfirmedNotice } from "@/components/ui/reconcile-unconfirmed";
import { rowsVersion } from "@/components/ui/reconcile-core";
import { cn, formatStaffDateTime } from "@/lib/utils";
import type { Tone } from "@/lib/ui/status-tone";
import type { ValidationFindingRow } from "@/lib/queries/tax-desk";

const inr = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `₹${Math.round(n).toLocaleString("en-IN")}`;

const sevTone = (sev: string): Tone =>
  sev === "error" || sev === "blocker" ? "danger" : sev === "warning" ? "warning" : "info";

/** Category → a safe contextual destination (no data is changed). */
function contextLink(category: string): { href: string; label: string } | null {
  switch (category) {
    case "documents":
      return { href: "documents", label: "Open Documents" };
    case "ledger":
    case "reconciliation":
      return { href: "ledgers", label: "Open Ledgers" };
    case "engine":
    case "computation_coverage":
    case "itr_form":
      return { href: "computation", label: "Open Computation" };
    default:
      return null;
  }
}

export function ValidationInbox({
  taxCaseId,
  basePath,
  findings,
  counts,
  lastRunAt,
  rulesVersion,
  locked,
  hasRun,
}: {
  taxCaseId: string;
  basePath: string;
  findings: ValidationFindingRow[];
  counts: { openError: number; openWarning: number; openInfo: number; resolved: number };
  lastRunAt: string | null;
  rulesVersion: string | null;
  locked: boolean;
  hasRun: boolean;
}) {
  const toast = useToast();
  // Reconciliation signal (Phase 3 / K.2.9.3): a fingerprint of the findings set
  // (id + status + last_seen_at + resolved_at) plus the AUTHORITATIVE case-level
  // validation-run marker (`lastRunAt` + `rulesVersion`). The run marker is
  // written on EVERY refresh — including a zero-finding run — so it flips on
  // every run even when no finding row changes. This closes the Phase 2
  // limitation where a zero-finding run on an already-empty case parked in
  // `unconfirmed`: it now reconciles as a real success. Resolve/reopen still
  // reconcile against the findings fingerprint (status change).
  const dataVersion =
    rowsVersion([
      {
        key: "findings",
        total: counts.openError + counts.openWarning + counts.openInfo + counts.resolved,
        rows: findings.map((f) => ({
          id: f.id,
          updated_at: `${f.status}:${f.last_seen_at}:${f.resolved_at ?? ""}`,
        })),
      },
    ]) + `|${lastRunAt ?? ""}|${rulesVersion ?? ""}`;
  const { run: runAction, busy, error, unconfirmed, reload, clearError } = useReconciledAction({ dataVersion });
  const [resolveId, setResolveId] = useState<string | null>(null);

  function run() {
    clearError();
    let summary: { title: string; detail: string } | null = null;
    runAction(
      async () => {
        const res = await refreshTaxValidationAction({ taxCaseId });
        if (res.ok && res.counts) {
          summary = {
            title: `Validation saved: ${res.counts.error} error(s), ${res.counts.warning} warning(s), ${res.counts.info} info`,
            detail: `${res.counts.reopened} reopened · ${res.counts.resolved} auto-resolved.`,
          };
        }
        return res;
      },
      () => {
        if (summary) toast.success(summary.title, summary.detail);
      },
    );
  }

  const open = findings.filter((f) => f.status === "open");
  const blocking = open.filter((f) => f.severity === "error" || f.severity === "blocker");
  const warnings = open.filter((f) => f.severity === "warning");
  const info = open.filter((f) => f.severity === "info");
  const resolved = findings.filter((f) => f.status !== "open");

  return (
    <div className="space-y-4">
      {/* Run state + primary action */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4 shadow-elev-1">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <Count label="Errors" value={counts.openError} tone="danger" />
          <Count label="Warnings" value={counts.openWarning} tone="warning" />
          <Count label="Info" value={counts.openInfo} tone="info" />
          <Count label="Resolved" value={counts.resolved} tone="neutral" />
          <span className="text-xs text-muted-foreground">
            Last run: {lastRunAt ? formatStaffDateTime(lastRunAt) : "never"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {error && !resolveId && (
            <span className="text-xs text-danger" role="alert">
              {error}
            </span>
          )}
          <button
            type="button"
            onClick={run}
            disabled={busy || locked}
            className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "Working…" : hasRun ? "Refresh validation" : "Run validation"}
          </button>
        </div>
      </div>

      {unconfirmed && (
        <UnconfirmedNotice onReload={reload} testId="validation-unconfirmed">
          The action was saved, but the page couldn&apos;t confirm the findings updated. Reload to verify.
        </UnconfirmedNotice>
      )}

      {locked && (
        <p className="rounded-md border border-warning-border bg-warning-soft px-3 py-2 text-sm text-warning">
          This tax case is finalized — validation is read-only; existing findings remain visible.
        </p>
      )}

      {!hasRun ? (
        <EmptyState
          title="No validation run yet"
          description="Run the deterministic checks to generate findings. Passing them never replaces the independent professional review every return receives before filing."
        />
      ) : (
        <>
          <Section title="Blocking errors" tone="danger" items={blocking} defaultOpen>
            {(f) => <Finding key={f.id} f={f} basePath={basePath} locked={locked} onResolve={() => openResolve(f.id)} onReopen={() => reopen(f.id)} pending={busy} defaultExpanded />}
          </Section>
          <Section title="Warnings" tone="warning" items={warnings} defaultOpen>
            {(f) => <Finding key={f.id} f={f} basePath={basePath} locked={locked} onResolve={() => openResolve(f.id)} onReopen={() => reopen(f.id)} pending={busy} />}
          </Section>
          <Section title="Information" tone="info" items={info} defaultOpen>
            {(f) => <Finding key={f.id} f={f} basePath={basePath} locked={locked} onResolve={() => openResolve(f.id)} onReopen={() => reopen(f.id)} pending={busy} />}
          </Section>
          <Section title="Resolved" tone="neutral" items={resolved} defaultOpen>
            {(f) => <Finding key={f.id} f={f} basePath={basePath} locked={locked} onResolve={() => openResolve(f.id)} onReopen={() => reopen(f.id)} pending={busy} />}
          </Section>
        </>
      )}

      <ResolveDialog
        open={!!resolveId}
        onClose={() => {
          setResolveId(null);
          clearError();
        }}
        onConfirm={(note) => resolveId && resolve(resolveId, note)}
        pending={busy}
        // The hook's single error is contextual to the in-flight action; while the
        // resolve dialog is open that action is the resolve, so show it here.
        error={resolveId ? error : null}
      />
    </div>
  );

  function openResolve(findingId: string) {
    clearError();
    setResolveId(findingId);
  }

  function resolve(findingId: string, note: string) {
    clearError();
    // Server remains the note authority (length + sensitive-text screening). On
    // success the dialog closes + toast fires ONLY after the finding's resolved
    // status is reconciled into these props; on failure the hook surfaces `error`
    // and the dialog stays open (contextual).
    runAction(
      () => resolveTaxValidationFindingAction({ findingId, note: note.trim() }),
      () => {
        setResolveId(null);
        toast.success("Finding resolved");
      },
    );
  }
  function reopen(findingId: string) {
    clearError();
    // Success toast fires only after the finding's reopened status is reconciled
    // into these props; a failure surfaces the hook's contextual `error`.
    runAction(
      () => reopenTaxValidationFindingAction({ findingId }),
      () => toast.success("Finding reopened"),
    );
  }
}

function Count({ label, value, tone }: { label: string; value: number; tone: Tone }) {
  return (
    <span className="flex items-center gap-1.5">
      <StatusDot tone={value > 0 ? tone : "neutral"} />
      <span className="tnum font-semibold">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function Section({
  title,
  tone,
  items,
  defaultOpen,
  children,
}: {
  title: string;
  tone: Tone;
  items: ValidationFindingRow[];
  defaultOpen?: boolean;
  children: (f: ValidationFindingRow) => React.ReactNode;
}) {
  if (items.length === 0) return null;
  return (
    <details open={defaultOpen} className="group rounded-xl border bg-card shadow-elev-1">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <StatusDot tone={tone} />
          {title}
          <span className="text-xs font-normal text-muted-foreground">({items.length})</span>
        </span>
        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <ul className="divide-y border-t">{items.map(children)}</ul>
    </details>
  );
}

function Finding({
  f,
  basePath,
  locked,
  onResolve,
  onReopen,
  pending,
  defaultExpanded,
}: {
  f: ValidationFindingRow;
  basePath: string;
  locked: boolean;
  onResolve: () => void;
  onReopen: () => void;
  pending: boolean;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(!!defaultExpanded);
  const tone = sevTone(f.severity);
  const link = contextLink(f.category);
  const isOpen = f.status === "open";
  const hasEvidence = f.source_value !== null || f.entered_value !== null || f.difference !== null;

  return (
    <li className="px-4 py-3" data-testid="validation-issue">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusDot tone={isOpen ? tone : "neutral"} />
            <span className="font-medium">{f.title ?? f.rule_code}</span>
            {(f.severity === "error" || f.severity === "blocker") && isOpen && (
              <StatusPill tone="danger" label="blocking" dot={false} />
            )}
            {!isOpen && <StatusPill tone="neutral" label={f.status} dot={false} />}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{f.message}</p>
          {hasEvidence && (
            <p className="mt-0.5 text-xs text-muted-foreground tnum">
              {f.source_value !== null && <>A {inr(f.source_value)} </>}
              {f.entered_value !== null && <>· B {inr(f.entered_value)} </>}
              {f.difference !== null && <>· Δ {inr(f.difference)}</>}
            </p>
          )}
        </div>
        {/* Primary actions stay reachable without expanding the row. */}
        <div className="flex shrink-0 items-center gap-1.5">
          {!locked &&
            (isOpen ? (
              <button
                type="button"
                onClick={onResolve}
                disabled={pending}
                className="h-8 rounded-md bg-success-soft px-2.5 text-xs font-medium text-success hover:opacity-90 disabled:opacity-50"
              >
                Resolve
              </button>
            ) : (
              <button
                type="button"
                onClick={onReopen}
                disabled={pending}
                className="h-8 rounded-md border bg-background px-2.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
              >
                Reopen
              </button>
            ))}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label="Toggle finding details"
            className="rounded-md p-1 text-muted-foreground hover:bg-accent"
          >
            <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} aria-hidden />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="ml-4 mt-3 space-y-2 border-l-2 border-muted pl-3 text-xs">
          {f.suggested_action && <p className="text-muted-foreground">→ {f.suggested_action}</p>}
          <p className="text-muted-foreground">
            {f.rule_code} · {f.category} · first seen {formatStaffDateTime(f.first_seen_at)} · last seen{" "}
            {formatStaffDateTime(f.last_seen_at)}
            {!isOpen && f.resolved_at && (
              <>
                {" "}· resolved {formatStaffDateTime(f.resolved_at)}
                {f.resolver_name ? ` by ${f.resolver_name}` : ""}
                {f.resolution_note ? ` — "${f.resolution_note}"` : ""}
              </>
            )}
          </p>
          {link && (
            <Link href={`${basePath}/${link.href}`} className="inline-block h-8 rounded-md border bg-background px-2.5 font-medium leading-8 hover:bg-accent">
              {link.label}
            </Link>
          )}
        </div>
      )}
    </li>
  );
}

function ResolveDialog({
  open,
  onClose,
  onConfirm,
  pending,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (note: string) => void;
  pending?: boolean;
  error?: string | null;
}) {
  const [note, setNote] = useState("");
  return (
    <ConfirmDialog
      open={open}
      onClose={() => {
        setNote("");
        onClose();
      }}
      onConfirm={() => onConfirm(note)}
      title="Resolve finding"
      confirmLabel="Save resolution"
      confirmTone="primary"
      pending={pending}
    >
      <p className="mb-2">Add a resolution note (required). Do not include passwords, OTPs, PAN or Aadhaar.</p>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Resolution note (required)"
        aria-label="Resolution note"
        className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm"
      />
      {error && (
        <p className="mt-2 text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </ConfirmDialog>
  );
}
