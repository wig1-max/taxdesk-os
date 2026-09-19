import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page";
import { requireUser } from "@/lib/auth";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { maskedPan } from "@/lib/utils";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireUser();
  const { q } = await searchParams;
  const query = (q ?? "").trim().replace(/[,()%]/g, "");

  const supabase = await createServerClient();
  let builder = supabase
    .from("clients_safe")
    .select("id, display_code, full_name, primary_phone, pan_last4, kyc_status, city")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(100);

  if (query) {
    builder = builder.or(
      `full_name.ilike.%${query}%,primary_phone.ilike.%${query}%,pan_last4.eq.${query.slice(-4)}`
    );
  }
  const { data: clients } = await builder;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Clients"
        description="Everyone your office works with."
        help="Each client is a person or business. Open a client to see their profile, PAN (stored encrypted, shown masked), and all their cases. Use the search box to find someone by name, phone, or the last 4 digits of their PAN. Create a case from a client to start a piece of work (ITR, IEPF, etc.)."
        actions={
          <Link href="/clients/new" className={buttonVariants()}>
            New client
          </Link>
        }
      />

      <form className="max-w-md" action="/clients">
        <Input name="q" defaultValue={query} placeholder="Search name / phone / PAN last 4" />
      </form>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left">
            <tr>
              <th className="px-3 py-2">Code</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Phone</th>
              <th className="px-3 py-2">PAN</th>
              <th className="px-3 py-2">KYC</th>
              <th className="px-3 py-2">City</th>
            </tr>
          </thead>
          <tbody>
            {(clients ?? []).map((c) => (
              <tr key={c.id} className="border-t hover:bg-accent/50">
                <td className="px-3 py-2 font-mono text-xs">{c.display_code ?? "—"}</td>
                <td className="px-3 py-2">
                  <Link href={`/clients/${c.id}`} className="font-medium text-primary hover:underline">
                    {c.full_name}
                  </Link>
                </td>
                <td className="px-3 py-2">{c.primary_phone}</td>
                <td className="px-3 py-2 font-mono text-xs">{maskedPan(c.pan_last4)}</td>
                <td className="px-3 py-2">{c.kyc_status}</td>
                <td className="px-3 py-2">{c.city ?? "—"}</td>
              </tr>
            ))}
            {(clients ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  No clients found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
