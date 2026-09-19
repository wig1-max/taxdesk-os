import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChevronDown, GitCompareArrows } from "lucide-react";
import { ValidationInbox } from "@/components/tax-desk/validation-inbox";
import { requireUser } from "@/lib/auth";
import { getTaxCaseValidationView } from "@/lib/queries/tax-desk";
import { describeGoverningPack } from "@/lib/tax-desk/case-traceability";
import { taxCaseStatutoryContext } from "@/lib/tax-pack";
import {
  PackRefusedNotice,
  PackVerificationNotice,
} from "@/components/tax-desk/pack-traceability";

export const metadata: Metadata = { title: "ITR Prep — Validation" };

const inr = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `₹${Math.round(n).toLocaleString("en-IN")}`;

export default async function TaxDeskValidationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const view = await getTaxCaseValidationView(id);
  if (!view) notFound();

  // Phase 3 (K.2.9.3): a run is authoritative — derived solely from the
  // case-level validation-run marker, never inferred from findings. A
  // zero-finding run is still a run.
  const hasRun = view.runExists;
  const basePath = `/tax-desk/cases/${view.taxCaseId}`;

  // K3-22: the validation rules that produced these findings belong to a
  // versioned pack, and that pack is not CA-verified. Say so where the findings
  // are read, not only in the laboratory.
  const governing = describeGoverningPack(
    taxCaseStatutoryContext(view.assessmentYear, view.law),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight">Validation — {view.clientName}</h1>
        <p className="text-xs text-muted-foreground">
          Deterministic checks + source reconciliation. Not filing readiness; no source is assumed authoritative.
          {governing.outcome === "bound" && (
            <> · validation rules {governing.pack.validationRulesVersion} ({governing.pack.status})</>
          )}
        </p>
      </div>

      {governing.outcome === "bound" ? (
        <PackVerificationNotice
          pack={governing.pack}
          relianceBlocker={governing.relianceBlocker}
          scope="validation"
        />
      ) : (
        <PackRefusedNotice reason={governing.reason} resolution={governing.resolution} />
      )}

      <ValidationInbox
        taxCaseId={view.taxCaseId}
        basePath={basePath}
        findings={view.findings}
        counts={view.counts}
        lastRunAt={view.lastRunAt}
        rulesVersion={view.rulesVersion}
        locked={view.finalized}
        hasRun={hasRun}
      />

      {/* Source reconciliation — compact, secondary, collapsible */}
      {hasRun && (
        <details className="group rounded-xl border bg-card shadow-elev-1">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold">
            <span className="flex items-center gap-2">
              <GitCompareArrows className="h-4 w-4 text-muted-foreground" aria-hidden />
              Source reconciliation
            </span>
            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="space-y-3 border-t px-4 py-3">
            <p className="text-xs text-muted-foreground">
              Source totals — no source is assumed authoritative. Deltas shown for configured comparable pairs only.
            </p>

            {view.reconciliation.pairs.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th scope="col" className="py-1 pr-2 font-medium">Comparable pair</th>
                      <th scope="col" className="py-1 pr-2 font-medium">Source A</th>
                      <th scope="col" className="py-1 pr-2 font-medium">Source B</th>
                      <th scope="col" className="py-1 font-medium">Difference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.reconciliation.pairs.map((p) => (
                      <tr key={p.pairCode} className={p.mismatch ? "border-t text-warning" : "border-t"}>
                        <td className="py-1 pr-2">{p.label}</td>
                        <td className="py-1 pr-2 tnum">{p.sourceA} {inr(p.totalA)}</td>
                        <td className="py-1 pr-2 tnum">{p.sourceB} {inr(p.totalB)}</td>
                        <td className="py-1 tnum">{inr(p.delta)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              {view.reconciliation.groups.map((g) => (
                <div key={`${g.category}:${g.key}`} className="rounded-lg border p-2">
                  <p className="text-xs font-medium capitalize">
                    {g.category} · {g.key}
                  </p>
                  <table className="mt-1 w-full text-xs">
                    <tbody>
                      {g.rows.map((r) => (
                        <tr key={r.sourceType} className="border-t">
                          <td className="py-0.5 pr-2 text-muted-foreground capitalize">{r.sourceType.replaceAll("_", " ")}</td>
                          <td className="py-0.5 pr-2 text-right tnum">{inr(r.total)}</td>
                          <td className="py-0.5 text-right text-muted-foreground">×{r.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
              {view.reconciliation.groups.length === 0 && (
                <p className="text-xs text-muted-foreground">No ledger entries to reconcile.</p>
              )}
            </div>
          </div>
        </details>
      )}
    </div>
  );
}
