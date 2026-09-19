import type { Metadata } from "next";
import Link from "next/link";
import { TaxCaseForm } from "@/components/tax-case-form";
import { CLIENT_SEARCH_LIMIT, clientSearchLabel } from "@/lib/clients/client-search";
import { PageHeader } from "@/components/ui/page";
import { requireUser } from "@/lib/auth";
import { createClient as createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "New ITR Prep Case" };

export default async function NewTaxCasePage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  await requireUser();
  const { client } = await searchParams;

  const supabase = await createServerClient();
  const [{ data: clients }, { data: users }] = await Promise.all([
    supabase
      .from("clients_safe")
      .select("id, full_name, primary_phone")
      .is("deleted_at", null)
      .order("full_name")
      .limit(CLIENT_SEARCH_LIMIT),
    supabase.from("users").select("id, full_name").eq("is_active", true).is("deleted_at", null),
  ]);

  // Resolve `?client=` explicitly: it may well sit outside the first page.
  const { data: presetRow } = client
    ? await supabase
        .from("clients_safe")
        .select("id, full_name, primary_phone")
        .eq("id", client)
        .is("deleted_at", null)
        .maybeSingle()
    : { data: null };

  return (
    <div className="space-y-4">
      <PageHeader
        title="New ITR Prep Case"
        description="AY 2026-27 — links a new ITR case to an existing client"
        help="This creates a normal ITR case (using the existing ITR service) and links a Tax Desk prep record to it. One ITR prep case is allowed per client per assessment year. Ledger entry, computation, reconciliation and filing arrive in later phases."
        actions={
          <Link href="/tax-desk/cases" className="text-sm text-primary hover:underline">
            ← Back to cases
          </Link>
        }
      />

      <TaxCaseForm
        clients={(clients ?? []).map((c) => ({
          id: c.id,
          label: clientSearchLabel(c),
        }))}
        users={(users ?? []).map((u) => ({ id: u.id, label: u.full_name }))}
        presetClient={
          presetRow ? { id: presetRow.id, label: clientSearchLabel(presetRow) } : undefined
        }
      />
    </div>
  );
}
