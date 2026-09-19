import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getTaxCaseWorkspace } from "@/lib/queries/tax-workspace";
import { TaxCaseShell } from "@/components/tax-desk/tax-case-shell";

/**
 * Shared Tax Desk case workspace (K.2.8.5). Loads the workspace context once
 * (request-cached) and wraps every case route — overview, documents, ledgers,
 * computation, validation, review, readiness — in the persistent TaxCaseShell
 * (context header + workflow rail). Individual pages render only their body.
 */
export default async function TaxCaseLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const workspace = await getTaxCaseWorkspace(id);
  if (!workspace) notFound();

  return <TaxCaseShell workspace={workspace}>{children}</TaxCaseShell>;
}
