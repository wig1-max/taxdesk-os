"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { CircleAlert, Pencil, Plus, Trash2 } from "lucide-react";
import { Drawer, ConfirmDialog } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/states";
import { StatusPill } from "@/components/ui/status";
import { useToast } from "@/components/ui/toast";
import { useReconciledAction } from "@/components/ui/use-reconciled-action";
import { rowsVersion } from "@/components/ui/reconcile-core";
import { useRovingTabList } from "@/components/ui/roving-tablist";
import { isSourceLinked, sourceCoverage } from "@/lib/tax-desk/ledger-source";
import {
  DEPRECIATION_ASSET_CLASS_DECLARATIONS,
  DEPRECIATION_PUT_TO_USE_DECLARATIONS,
} from "@/lib/tax-desk/ledger";
import { describeLedgerSupport } from "@/lib/tax-desk/ledger-support";
import { cn, formatInr, formatStaffDate } from "@/lib/utils";

export type FieldKind =
  | "enum"
  | "multi_enum"
  | "number"
  | "text"
  | "date"
  | "doc"
  | "file"
  | "boolean"
  | "dep_blocks";

export interface FieldDesc {
  key: string;
  label: string;
  kind: FieldKind;
  options?: readonly string[];
  allowNegative?: boolean;
  helper?: string;
  /**
   * K4-13: label for a leading blank (`value=""`) option on an `enum` field,
   * making "not answered" a real, selectable state instead of silently
   * defaulting to `options[0]`. Load-bearing for the presumptive activity
   * question (D217): the whole point is that an undeclared activity must
   * refuse, so the control may not pre-select an answer nobody gave. Enum
   * fields without this keep their previous behaviour exactly.
   */
  blankOption?: string;
  /**
   * K4-05 adaptive-question pattern: this field only renders when the named
   * SIBLING field's current value equals `equals` — e.g. the "Insured
   * parent is 60+?" checkbox appears only once "Deduction" is set to
   * "80D_PARENTS". The driver field itself needs no special declaration.
   *
   * K4-13 widened `equals` to accept a LIST, because the presumptive activity
   * question applies to all THREE presumptive income heads (44ADA plus the
   * two 44AD receipt-mode heads) and duplicating the field three times would
   * make three form controls writing one column. A bare string still means
   * exactly what it did before.
   */
  visibleWhen?: { field: string; equals: string | readonly string[] };
}

type Option = { id: string; label: string };
type LedgerRow = Record<string, unknown> & { id: string };
type ActionFn = (input: unknown) => Promise<{ ok: boolean; error?: string }>;

export interface LedgerCategory {
  key: string;
  title: string;
  totalLabel: string;
  addLabel: string;
  emptyHint: string;
  fields: FieldDesc[];
  rows: LedgerRow[];
  total: number;
  /** Engine-derived count of entries in this category needing manual tax
   *  treatment (from the shared classifier — NOT source coverage). */
  unsupported: number;
  identityField: string;
  amountField: string;
  onCreate: ActionFn;
  onUpdate: ActionFn;
  onRemove: ActionFn;
}

const isSourceField = (k: string) => k.startsWith("source_") || k.startsWith("proof_");
const money = (n: unknown) => formatInr(Math.round(Number(n) || 0));

export function LedgerWorkspace({
  taxCaseId,
  locked,
  categories,
  totalUnsupported,
  docOptions,
  fileOptions,
}: {
  taxCaseId: string;
  locked: boolean;
  categories: LedgerCategory[];
  /** Engine-derived total of entries needing manual tax treatment (all categories). */
  totalUnsupported: number;
  docOptions: Option[];
  fileOptions: Option[];
}) {
  const toast = useToast();
  const [activeKey, setActiveKey] = useState(categories[0]?.key ?? "");
  const [drawer, setDrawer] = useState<{ mode: "add" | "edit"; row?: LedgerRow } | null>(null);
  const [confirmRow, setConfirmRow] = useState<LedgerRow | null>(null);
  const [dirty, setDirty] = useState(false);
  // K4-05: current value of any field OTHER fields declare `visibleWhen` on
  // (e.g. "deduction_type"), so a dependent field (e.g. the parent-senior
  // checkbox) can be shown/hidden live as the driver changes. Reset whenever
  // the drawer opens for a different row/category.
  const [driverValues, setDriverValues] = useState<Record<string, string>>({});

  // Reconciliation signal: a fingerprint of every live ledger row (id +
  // updated_at) plus per-category totals/counts. It changes on every successful
  // create/update/remove, so the hook can hold `busy` until the write is
  // provably visible in these props — no premature toast/drawer-close.
  const dataVersion = rowsVersion(categories);
  const { run, busy, error, unconfirmed, reload, clearError } = useReconciledAction({ dataVersion });

  const docMap = useMemo(() => new Map(docOptions.map((o) => [o.id, o.label])), [docOptions]);
  const fileMap = useMemo(() => new Map(fileOptions.map((o) => [o.id, o.label])), [fileOptions]);

  const activeIndex = Math.max(0, categories.findIndex((c) => c.key === activeKey));
  const active: LedgerCategory = categories[activeIndex] ?? (categories[0] as LedgerCategory);

  // K4-05: (re)seed driverValues whenever the drawer opens (add or edit) —
  // from the edited row's own current values, or "" for a fresh add — so a
  // dependent field's initial visibility matches the form's actual state,
  // not last drawer's leftover values.
  useEffect(() => {
    if (!drawer) return;
    const driverKeys = new Set(active.fields.flatMap((f) => (f.visibleWhen ? [f.visibleWhen.field] : [])));
    const seeded: Record<string, string> = {};
    for (const key of driverKeys) seeded[key] = drawer.row ? String(drawer.row[key] ?? "") : "";
    setDriverValues(seeded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawer]);

  // Roving-tabindex keyboard behaviour for the category tablist (shared helper).
  const { listRef, onKeyDown, getTabProps } = useRovingTabList({
    activeIndex,
    count: categories.length,
    onActivate: (i) => {
      const key = categories[i]?.key;
      if (key) setActiveKey(key);
    },
  });

  if (!active) return null;

  const sourceLinked = (r: LedgerRow) => isSourceLinked(r);
  const linkedCount = sourceCoverage(active.rows).linked;
  const panelId = `ledger-panel-${active.key}`;
  const tabId = (key: string) => `ledger-tab-${key}`;

  function submit(action: ActionFn, payload: unknown, onDone: () => void, successToast?: string) {
    // `run` keeps `busy` true until the write is reconciled against fresh server
    // props; `onDone` (close drawer) + the success toast fire only then, never
    // before the persisted row is visible. Field/server-validation errors stay
    // contextual (drawer or section) via the hook's `error` — never a toast too.
    run(
      () => action(payload),
      () => {
        onDone();
        if (successToast) toast.success(successToast);
      },
    );
  }

  function valuesFromForm(form: HTMLFormElement): Record<string, unknown> {
    const fd = new FormData(form);
    const out: Record<string, unknown> = {};
    for (const f of active.fields) {
      if (f.kind === "multi_enum") {
        out[f.key] = fd.getAll(f.key).map((v) => String(v).trim()).filter(Boolean);
      } else {
        out[f.key] = String(fd.get(f.key) ?? "").trim();
      }
    }
    return out;
  }

  function onDrawerSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const values = valuesFromForm(form);
    if (drawer?.mode === "add") {
      submit(
        active.onCreate,
        { tax_case_id: taxCaseId, ...values },
        () => {
          setDrawer(null);
          setDirty(false);
        },
        `${active.title} entry added`,
      );
    } else if (drawer?.mode === "edit" && drawer.row) {
      submit(
        active.onUpdate,
        { id: drawer.row.id, ...values },
        () => {
          setDrawer(null);
          setDirty(false);
        },
        `${active.title} entry updated`,
      );
    }
  }

  function onRemoveConfirm(reason: string) {
    if (!confirmRow) return;
    submit(
      active.onRemove,
      { id: confirmRow.id, reason: reason || undefined },
      () => setConfirmRow(null),
      `${active.title} entry removed`,
    );
  }

  const displayValue = (f: FieldDesc, row: LedgerRow): string => {
    const raw = row[f.key];
    if (raw === null || raw === undefined || raw === "") return "—";
    if (f.kind === "doc") return docMap.get(String(raw)) ?? "—";
    if (f.kind === "file") return fileMap.get(String(raw)) ?? "—";
    if (f.kind === "number") return money(raw);
    if (f.kind === "multi_enum") return Array.isArray(raw) ? raw.join(", ") : String(raw);
    if (f.kind === "dep_blocks") {
      if (!Array.isArray(raw) || raw.length === 0) return "—";
      return `${raw.length} block${raw.length === 1 ? "" : "s"}`;
    }
    return String(raw);
  };

  return (
    <div className="space-y-4">
      {/* Category switcher */}
      <div
        ref={listRef}
        role="tablist"
        aria-label="Ledger category"
        aria-orientation="horizontal"
        onKeyDown={onKeyDown}
        className="flex flex-wrap gap-2"
      >
        {categories.map((c, i) => {
          const selected = c.key === active.key;
          // Source coverage (provenance) — a DIFFERENT axis from engine support.
          const noSource = sourceCoverage(c.rows).unlinked;
          return (
            <button
              key={c.key}
              id={tabId(c.key)}
              type="button"
              {...getTabProps(i)}
              aria-controls={selected ? panelId : undefined}
              onClick={() => setActiveKey(c.key)}
              className={cn(
                "flex flex-col items-start rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected ? "border-primary bg-accent" : "hover:bg-muted/50",
              )}
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                {c.title}
                {c.unsupported > 0 && (
                  <span
                    className="inline-flex items-center gap-0.5 rounded-full bg-warning-soft px-1.5 py-0.5 text-[0.65rem] font-semibold text-warning"
                    title={`${c.unsupported} ${c.unsupported === 1 ? "entry needs" : "entries need"} manual tax treatment`}
                  >
                    <CircleAlert className="h-3 w-3" aria-hidden />
                    {c.unsupported} manual
                  </span>
                )}
              </span>
              <span className="tnum text-xs text-muted-foreground">
                {money(c.total)} · {c.rows.length} {c.rows.length === 1 ? "entry" : "entries"}
                {noSource > 0 ? ` · ${noSource} no source` : ""}
              </span>
            </button>
          );
        })}
      </div>

      {/* Engine support summary — the SAME classification Computation shows.
          Distinct from source coverage ("no source") above. */}
      {active.rows.length > 0 || totalUnsupported > 0 ? (
        <div
          data-testid="ledger-support-summary"
          data-unsupported-count={totalUnsupported}
          className={cn(
            "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs",
            totalUnsupported > 0
              ? "border-warning-border bg-warning-soft text-warning"
              : "border-success-border bg-success-soft text-success",
          )}
        >
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            {describeLedgerSupport(totalUnsupported)}
            {totalUnsupported > 0
              ? " — these are excluded from the Computation until resolved (a source document does not make an entry supported)."
              : " — every entry maps to a figure the AY 2026-27 engine computes."}
          </span>
        </div>
      ) : null}

      {/* Active category. Kept as a named landmark region (its established
          accessible-name contract) and associated with the active tab via
          aria-controls; a single panel swaps content as tabs change. */}
      <section
        id={panelId}
        aria-label={active.title}
        className="rounded-xl border bg-card shadow-elev-1"
      >
        {/* Sticky summary + add */}
        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-t-xl border-b bg-card/95 px-4 py-3 backdrop-blur">
          <div>
            <div className="text-sm font-semibold">{active.title}</div>
            <div className="tnum text-xs text-muted-foreground">
              {active.totalLabel}: <span className="font-medium text-foreground">{money(active.total)}</span> ·{" "}
              {active.rows.length} {active.rows.length === 1 ? "entry" : "entries"} · {linkedCount} source-linked
            </div>
          </div>
          {/* Single primary CTA per state: the header owns it when the
              category has entries; the empty state owns it when it doesn't. */}
          {!locked && active.rows.length > 0 && (
            <button
              type="button"
              onClick={() => {
                clearError();
                setDirty(false);
                setDrawer({ mode: "add" });
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" /> {active.addLabel}
            </button>
          )}
        </div>

        {error && !drawer && (
          <p className="mx-4 mt-3 rounded-md bg-danger-soft px-3 py-2 text-xs text-danger" role="alert">
            {error}
          </p>
        )}

        {unconfirmed && !drawer && <UnconfirmedBanner onReload={reload} className="mx-4 mt-3" />}

        {/* Rows */}
        {active.rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={`No ${active.title.toLowerCase()} entries yet`}
              description={active.emptyHint}
              action={
                locked ? undefined : (
                  <button
                    type="button"
                    onClick={() => {
                      clearError();
                      setDirty(false);
                      setDrawer({ mode: "add" });
                    }}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    <Plus className="h-4 w-4" /> {active.addLabel}
                  </button>
                )
              }
            />
          </div>
        ) : (
          <ul className="divide-y">
            {active.rows.map((row) => {
              const sourceType = String(row.source_type ?? "manual");
              const linked = sourceLinked(row);
              return (
                <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium capitalize">{displayValue(fieldByKey(active, active.identityField), row)}</span>
                      <StatusPill tone={linked ? "info" : "neutral"} label={sourceType.replaceAll("_", " ")} dot={false} />
                      {linked && <span className="text-[0.7rem] text-success">source linked</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {sourceDetail(row, docMap, fileMap)}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="tnum text-sm font-semibold">{displayValue(fieldByKey(active, active.amountField), row)}</span>
                    {!locked && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          aria-label={`Edit ${active.title} entry`}
                          onClick={() => {
                            clearError();
                            setDirty(false);
                            setDrawer({ mode: "edit", row });
                          }}
                          className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove ${active.title} entry`}
                          onClick={() => setConfirmRow(row)}
                          className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-danger-soft hover:text-danger"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {locked && (
        <p className="text-xs text-muted-foreground">This tax case is finalized — ledgers are read-only.</p>
      )}

      {/* Add / edit drawer */}
      <Drawer
        open={!!drawer && !locked}
        onClose={() => {
          setDrawer(null);
          setDirty(false);
        }}
        dirty={dirty}
        title={drawer?.mode === "edit" ? `Edit ${active.title.toLowerCase()} entry` : active.addLabel}
        description="Server-side validation applies on save."
        footer={
          <>
            <button
              type="button"
              onClick={() => {
                setDrawer(null);
                setDirty(false);
              }}
              className="h-9 rounded-md border bg-background px-3 text-sm font-medium hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="ledger-entry-form"
              disabled={busy}
              className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {unconfirmed ? "Unconfirmed" : busy ? "Saving…" : "Save"}
            </button>
          </>
        }
      >
        {drawer && (
          <form
            id="ledger-entry-form"
            data-testid="ledger-drawer"
            onSubmit={onDrawerSubmit}
            onInput={() => setDirty(true)}
            className="space-y-5"
          >
            {error && (
              <p className="rounded-md bg-danger-soft px-3 py-2 text-xs text-danger" role="alert">
                {error}
              </p>
            )}
            {unconfirmed && <UnconfirmedBanner onReload={reload} />}
            <FieldGroup
              legend="Details"
              fields={active.fields.filter((f) => !isSourceField(f.key) && f.key !== "notes")}
              row={drawer.row}
              docOptions={docOptions}
              fileOptions={fileOptions}
              driverValues={driverValues}
              onDriverChange={(key, value) => setDriverValues((prev) => ({ ...prev, [key]: value }))}
            />
            <FieldGroup
              legend="Source"
              fields={active.fields.filter((f) => isSourceField(f.key))}
              row={drawer.row}
              docOptions={docOptions}
              fileOptions={fileOptions}
              driverValues={driverValues}
              onDriverChange={(key, value) => setDriverValues((prev) => ({ ...prev, [key]: value }))}
            />
            <FieldGroup
              legend="Notes"
              fields={active.fields.filter((f) => f.key === "notes")}
              row={drawer.row}
              docOptions={docOptions}
              fileOptions={fileOptions}
              driverValues={driverValues}
              onDriverChange={(key, value) => setDriverValues((prev) => ({ ...prev, [key]: value }))}
            />
          </form>
        )}
      </Drawer>

      {/* Remove confirm */}
      <RemoveDialog
        open={!!confirmRow && !locked}
        onClose={() => setConfirmRow(null)}
        onConfirm={onRemoveConfirm}
        pending={busy}
        category={active.title}
      />
    </div>
  );
}

function fieldByKey(cat: LedgerCategory, key: string): FieldDesc {
  return cat.fields.find((f) => f.key === key) ?? { key, label: key, kind: "text" };
}

/**
 * Recovery banner for the `unconfirmed` state: the entry was accepted by the
 * server, but the page could not confirm it appeared here (the background
 * refresh did not land in time). We do NOT close the drawer or toast success —
 * that would be a false confirmation. Instead we tell the user plainly and offer
 * a reliable hard reload so they can verify BEFORE adding another entry, avoiding
 * a duplicate financial write. Submit stays disabled until they reload (or the
 * data lands late and self-heals into a real success).
 */
function UnconfirmedBanner({ onReload, className }: { onReload: () => void; className?: string }) {
  return (
    <div
      role="alert"
      data-testid="ledger-unconfirmed"
      className={cn(
        "flex flex-col gap-2 rounded-md border border-warning-border bg-warning-soft px-3 py-2 text-xs text-warning",
        className,
      )}
    >
      <span>
        Your entry was saved, but this page couldn&apos;t confirm it appeared. To avoid creating a
        duplicate, reload before adding another entry.
      </span>
      <button
        type="button"
        onClick={onReload}
        className="inline-flex h-8 w-fit items-center rounded-md border border-warning-border bg-background px-3 font-medium text-foreground hover:bg-accent"
      >
        Reload page
      </button>
    </div>
  );
}

function sourceDetail(
  row: LedgerRow,
  docMap: Map<string, string>,
  fileMap: Map<string, string>,
): string {
  const parts: string[] = [];
  if (row.source_document_id) parts.push(docMap.get(String(row.source_document_id)) ?? "document");
  if (row.source_file_id) parts.push(fileMap.get(String(row.source_file_id)) ?? "file");
  if (row.updated_at) {
    parts.push(`updated ${formatStaffDate(String(row.updated_at))}`);
  }
  return parts.join(" · ") || "No source linked";
}

function FieldGroup({
  legend,
  fields,
  row,
  docOptions,
  fileOptions,
  driverValues,
  onDriverChange,
}: {
  legend: string;
  fields: FieldDesc[];
  row?: LedgerRow;
  docOptions: Option[];
  fileOptions: Option[];
  driverValues: Record<string, string>;
  onDriverChange: (key: string, value: string) => void;
}) {
  // K4-05: a field with `visibleWhen` is skipped entirely (not rendered —
  // never merely hidden) unless its driver field's CURRENT value matches.
  // K4-13: `equals` may name several driver values (see FieldDesc).
  const visible = fields.filter((f) => {
    if (!f.visibleWhen) return true;
    const current = driverValues[f.visibleWhen.field];
    const want = f.visibleWhen.equals;
    return typeof want === "string" ? current === want : want.includes(current ?? "");
  });
  if (visible.length === 0) return null;
  return (
    <fieldset className="space-y-3">
      <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{legend}</legend>
      <div className="grid gap-3">
        {visible.map((f) => (
          <Field
            key={f.key}
            f={f}
            row={row}
            docOptions={docOptions}
            fileOptions={fileOptions}
            onDriverChange={onDriverChange}
          />
        ))}
      </div>
    </fieldset>
  );
}

function Field({
  f,
  row,
  docOptions,
  fileOptions,
  onDriverChange,
}: {
  f: FieldDesc;
  row?: LedgerRow;
  docOptions: Option[];
  fileOptions: Option[];
  onDriverChange: (key: string, value: string) => void;
}) {
  const id = useId();
  const def = row ? String(row[f.key] ?? "") : "";
  const cls =
    "h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div className="space-y-1">
      {f.kind !== "boolean" && (
        <label htmlFor={id} className="block text-xs font-medium">
          {f.label}
        </label>
      )}
      {f.kind === "enum" ? (
        <select
          id={id}
          name={f.key}
          defaultValue={def}
          className={cls}
          aria-label={f.label}
          onChange={(e) => onDriverChange(f.key, e.target.value)}
        >
          {f.blankOption !== undefined && <option value="">{f.blankOption}</option>}
          {(f.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : f.kind === "multi_enum" ? (
        <fieldset className="space-y-1.5 rounded-md border border-input p-2">
          <legend className="sr-only">{f.label}</legend>
          {(f.options ?? []).map((o) => {
            const selected = Array.isArray(row?.[f.key])
              ? (row[f.key] as unknown[]).includes(o)
              : String(row?.[f.key] ?? "") === o;
            return (
              <label key={o} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  name={f.key}
                  value={o}
                  defaultChecked={selected}
                  className="h-4 w-4 rounded border-input"
                />
                {o}
              </label>
            );
          })}
        </fieldset>
      ) : f.kind === "dep_blocks" ? (
        <DepBlocksField id={id} name={f.key} initial={row?.[f.key]} />
      ) : f.kind === "doc" || f.kind === "file" ? (
        <select id={id} name={f.key} defaultValue={def} className={cls} aria-label={f.label}>
          <option value="">—</option>
          {(f.kind === "doc" ? docOptions : fileOptions).map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      ) : f.kind === "number" ? (
        <input
          id={id}
          name={f.key}
          type="number"
          step="0.01"
          min={f.allowNegative ? undefined : "0"}
          defaultValue={def}
          className={cls}
          aria-label={f.label}
          inputMode="decimal"
        />
      ) : f.kind === "date" ? (
        <input
          id={id}
          name={f.key}
          type="date"
          defaultValue={def}
          className={cls}
          aria-label={f.label}
        />
      ) : f.kind === "boolean" ? (
        <label htmlFor={id} className="flex items-center gap-2 text-xs font-medium">
          <input
            id={id}
            name={f.key}
            type="checkbox"
            value="true"
            defaultChecked={def === "true"}
            className="h-4 w-4 rounded border-input"
            aria-label={f.label}
          />
          {f.label}
        </label>
      ) : (
        <input id={id} name={f.key} type="text" defaultValue={def} className={cls} aria-label={f.label} />
      )}
      {f.helper && <p className="text-[0.7rem] text-muted-foreground">{f.helper}</p>}
    </div>
  );
}

type DepBlockDraft = {
  asset_class: string;
  wdv: string;
  put_to_use: string;
};

function parseDepBlocks(raw: unknown): DepBlockDraft[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const rec = (item ?? {}) as { asset_class?: unknown; wdv?: unknown; put_to_use?: unknown };
    return {
      asset_class: String(rec.asset_class ?? ""),
      wdv: rec.wdv == null ? "" : String(rec.wdv),
      put_to_use: String(rec.put_to_use ?? "full_rate"),
    };
  });
}

function DepBlocksField({ id, name, initial }: { id: string; name: string; initial: unknown }) {
  const [blocks, setBlocks] = useState<DepBlockDraft[]>(() => parseDepBlocks(initial));
  const cls =
    "h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div className="space-y-2">
      <input id={id} type="hidden" name={name} value={JSON.stringify(blocks)} />
      {blocks.length === 0 && (
        <p className="text-[0.7rem] text-muted-foreground">No blocks yet. Required when depreciation_s32 is declared.</p>
      )}
      {blocks.map((block, index) => (
        <div key={index} className="grid gap-2 rounded-md border border-input p-2 sm:grid-cols-3">
          <label className="space-y-1 text-xs">
            <span className="font-medium">Appendix I class</span>
            <select
              value={block.asset_class}
              onChange={(e) =>
                setBlocks((prev) =>
                  prev.map((item, i) => (i === index ? { ...item, asset_class: e.target.value } : item)),
                )
              }
              className={cls}
              aria-label={`Appendix I class for block ${index + 1}`}
            >
              <option value="">—</option>
              {DEPRECIATION_ASSET_CLASS_DECLARATIONS.map((clsId) => (
                <option key={clsId} value={clsId}>
                  {clsId}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium">Written-down value</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={block.wdv}
              onChange={(e) =>
                setBlocks((prev) =>
                  prev.map((item, i) => (i === index ? { ...item, wdv: e.target.value } : item)),
                )
              }
              className={cls}
              aria-label={`Written-down value for block ${index + 1}`}
              inputMode="decimal"
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium">Put to use</span>
            <select
              value={block.put_to_use}
              onChange={(e) =>
                setBlocks((prev) =>
                  prev.map((item, i) => (i === index ? { ...item, put_to_use: e.target.value } : item)),
                )
              }
              className={cls}
              aria-label={`Put-to-use for block ${index + 1}`}
            >
              {DEPRECIATION_PUT_TO_USE_DECLARATIONS.map((put) => (
                <option key={put} value={put}>
                  {put}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="text-xs text-muted-foreground underline sm:col-span-3"
            onClick={() => setBlocks((prev) => prev.filter((_, i) => i !== index))}
          >
            Remove block {index + 1}
          </button>
        </div>
      ))}
      <button
        type="button"
        className="text-xs font-medium underline"
        onClick={() =>
          setBlocks((prev) => [
            ...prev,
            { asset_class: "", wdv: "", put_to_use: "full_rate" },
          ])
        }
      >
        Add Appendix I block
      </button>
    </div>
  );
}

function RemoveDialog({
  open,
  onClose,
  onConfirm,
  pending,
  category,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  pending?: boolean;
  category: string;
}) {
  const [reason, setReason] = useState("");
  return (
    <ConfirmDialog
      open={open}
      onClose={() => {
        setReason("");
        onClose();
      }}
      onConfirm={() => onConfirm(reason)}
      title={`Remove ${category.toLowerCase()} entry?`}
      confirmLabel="Remove"
      pending={pending}
    >
      <p className="mb-2">This soft-removes the entry (recoverable, audited). Add a reason if useful.</p>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason for removal (optional)"
        aria-label="Reason for removal"
        className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm"
      />
    </ConfirmDialog>
  );
}
