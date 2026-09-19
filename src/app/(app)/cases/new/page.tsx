import type { Metadata } from "next";
import Link from "next/link";
import { CaseForm } from "@/components/case-form";
import { CLIENT_SEARCH_LIMIT, clientSearchLabel } from "@/lib/clients/client-search";
import { requireUser } from "@/lib/auth";
import { filterNormalServices } from "@/lib/services/catalog";
import { createClient as createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "New case" };

export default async function NewCasePage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; includeDeferred?: string }>;
}) {
  const user = await requireUser();
  const { client, includeDeferred } = await searchParams;

  // Normal workflow = Tax Desk services only. Admins can opt into deferred
  // services (IEPF etc.) via ?includeDeferred=1 for the rare case that still
  // needs one; staff never see them in New Case.
  const showDeferred = includeDeferred === "1" && user.role === "admin";

  const supabase = await createServerClient();
  // K3-ENV-4: the client picker is searchable and server-backed, so this is only
  // the FIRST PAGE of results shown before the user types — not the selectable
  // universe. The old `.limit(500)` was exactly that universe, which made every
  // client outside the window unreachable in an office with more than 500.
  const [{ data: clients }, { data: users }, { data: services }] = await Promise.all([
    supabase
      .from("clients_safe")
      .select("id, full_name, primary_phone")
      .is("deleted_at", null)
      .order("full_name")
      .limit(CLIENT_SEARCH_LIMIT),
    supabase.from("users").select("id, full_name").eq("is_active", true).is("deleted_at", null),
    supabase.from("services").select("code, name").eq("is_active", true).order("name"),
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

  const allServices = services ?? [];
  const formServices = showDeferred ? allServices : filterNormalServices(allServices);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">New case</h1>
      <CaseForm
        clients={(clients ?? []).map((c) => ({ id: c.id, label: clientSearchLabel(c) }))}
        users={(users ?? []).map((u) => ({ id: u.id, label: u.full_name }))}
        services={formServices}
        currentUserId={user.id}
        presetClient={
          presetRow
            ? { id: presetRow.id, label: clientSearchLabel(presetRow) }
            : undefined
        }
      />
      {user.role === "admin" && (
        <p className="text-xs text-muted-foreground">
          {showDeferred ? (
            <Link href="/cases/new" className="underline">
              ← Back to Tax Desk services only
            </Link>
          ) : (
            <Link href="/cases/new?includeDeferred=1" className="underline">
              Admin: create a deferred/other-service case (IEPF, etc.)
            </Link>
          )}
        </p>
      )}
    </div>
  );
}
