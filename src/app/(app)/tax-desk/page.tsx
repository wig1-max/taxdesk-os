import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  FileWarning,
  Plus,
  UserCheck,
} from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getTaxDeskOverview, getTaxCasesList } from "@/lib/queries/tax-desk";
import { summarizeCaseRow } from "@/lib/tax-desk/case-queue";
import { buttonVariants } from "@/components/ui/button";
import { Surface, SectionHeader } from "@/components/ui/section";
import { StatusPill } from "@/components/ui/status";
import { EmptyState } from "@/components/ui/states";
import { PageHeader } from "@/components/ui/page";
import { cn } from "@/lib/utils";
import { TONE_CLASSES, type Tone } from "@/lib/ui/status-tone";

export const metadata: Metadata = { title: "Tax Desk" };

const ATTENTION: {
  key: keyof Awaited<ReturnType<typeof getTaxDeskOverview>>["counts"];
  label: string;
  tone: Tone;
  icon: typeof AlertTriangle;
}[] = [
  { key: "docsPending", label: "Docs pending", tone: "warning", icon: FileWarning },
  { key: "computationPending", label: "Computation pending", tone: "info", icon: ArrowRight },
  { key: "clientApprovalPending", label: "Awaiting client", tone: "warning", icon: UserCheck },
  { key: "blockerFindings", label: "Blocker findings", tone: "danger", icon: AlertTriangle },
];

export default async function TaxDeskPage() {
  await requireUser();
  const [{ counts, isEmpty }, rows] = await Promise.all([getTaxDeskOverview(), getTaxCasesList()]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tax Desk"
        description="AY 2026-27 ITR preparation — what needs attention across your cases"
        actions={
          <Link href="/tax-desk/cases/new" className={cn(buttonVariants(), "gap-1.5")}>
            <Plus className="h-4 w-4" /> New ITR case
          </Link>
        }
      />

      {isEmpty ? (
        <EmptyState
          title="No ITR prep cases yet"
          description="Create the first ITR preparation case to start the workflow."
          action={{ href: "/tax-desk/cases/new", label: "Create ITR prep case" }}
        />
      ) : (
        <>
          {/* Attention summary */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {ATTENTION.map((a) => {
              const count = counts[a.key];
              const Icon = a.icon;
              const active = count > 0;
              return (
                <Link
                  key={a.key}
                  href="/tax-desk/cases"
                  className={cn(
                    "flex items-center gap-3 rounded-xl border p-4 shadow-elev-1 transition-colors",
                    active ? TONE_CLASSES[a.tone].soft : "bg-card hover:bg-muted/40",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-lg",
                      active ? TONE_CLASSES[a.tone].solid : "bg-muted text-muted-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <div>
                    <div className="tnum text-2xl font-semibold leading-none">{count}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{a.label}</div>
                  </div>
                </Link>
              );
            })}
          </div>

          {/* Work queue */}
          <Surface>
            <div className="border-b p-4">
              <SectionHeader
                title="Work queue"
                description={`${rows.length} case${rows.length === 1 ? "" : "s"} · most recently updated first`}
                actions={
                  <Link href="/tax-desk/cases" className="text-sm text-primary hover:underline">
                    View all →
                  </Link>
                }
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Client / case</th>
                    <th className="px-4 py-2 font-medium">AY</th>
                    <th className="px-4 py-2 font-medium">Stage</th>
                    <th className="px-4 py-2 font-medium">Next step</th>
                    <th className="px-4 py-2 font-medium">Waiting on</th>
                    <th className="px-4 py-2 font-medium">ITR</th>
                    <th className="px-4 py-2 font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 30).map((r) => {
                    const sum = summarizeCaseRow({
                      caseStatus: r.case_status,
                      clientReviewStatus: r.client_review_status,
                      filingStatus: r.filing_status,
                      eVerificationStatus: r.e_verification_status,
                      itrSelected: r.itr_type_selected,
                    });
                    return (
                      <tr key={r.id} className="border-b last:border-0 transition-colors hover:bg-muted/40">
                        <td className="px-4 py-2.5">
                          <Link href={`/tax-desk/cases/${r.id}`} className="font-medium hover:underline">
                            {r.client_name}
                          </Link>
                          <div className="font-mono text-[0.7rem] text-muted-foreground">
                            {r.case_display_code ?? "—"}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 tnum text-muted-foreground">{r.assessment_year}</td>
                        <td className="px-4 py-2.5">
                          <StatusPill tone={sum.tone} label={sum.stage} />
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">{sum.next}</td>
                        <td className="px-4 py-2.5">
                          {sum.waitingOn ? (
                            <span className="text-warning">{sum.waitingOn}</span>
                          ) : (
                            <span className="text-muted-foreground/50">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 tnum text-muted-foreground">
                          {r.itr_type_selected ?? r.itr_type_recommended ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">
                          {new Date(r.updated_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Surface>
        </>
      )}
    </div>
  );
}
