import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { CaseQueueTable } from "@/components/tax-desk/case-queue-table";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page";
import { EmptyState } from "@/components/ui/states";
import { requireUser } from "@/lib/auth";
import { getTaxCasesList } from "@/lib/queries/tax-desk";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Tax Desk — Cases" };

export default async function TaxDeskCasesPage() {
  await requireUser();
  const rows = await getTaxCasesList();

  return (
    <div className="space-y-4">
      <PageHeader
        title="ITR Prep Cases"
        description="AY 2026-27 tax preparation cases — client PAN is never shown here"
        actions={
          <Link href="/tax-desk/cases/new" className={cn(buttonVariants(), "gap-1.5")}>
            <Plus className="h-4 w-4" /> New ITR Prep Case
          </Link>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          title="No ITR prep cases yet"
          description="Every ITR prep case links 1:1 to an existing TaxDesk OS case using the ITR service."
          action={{ href: "/tax-desk/cases/new", label: "Create ITR prep case" }}
        />
      ) : (
        <CaseQueueTable rows={rows} />
      )}
    </div>
  );
}
