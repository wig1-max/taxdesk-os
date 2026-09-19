import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClientDangerZone } from "@/components/client-danger-zone";
import { ClientForm } from "@/components/client-form";
import { PanActions } from "@/components/pan-actions";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpBox } from "@/components/ui/page";
import { requireUser } from "@/lib/auth";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { maskedPan } from "@/lib/utils";

export const metadata: Metadata = { title: "Client" };

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-dashed py-1.5 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right text-sm">{value || "—"}</span>
    </div>
  );
}

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const isAdmin = user.role === "admin";

  const supabase = await createServerClient();
  // Independent queries (both keyed by the route id) run in parallel.
  const [{ data: client }, { data: cases }] = await Promise.all([
    supabase.from("clients_safe").select("*").eq("id", id).is("deleted_at", null).maybeSingle(),
    supabase
      .from("cases")
      .select("id, display_code, title, status, next_action, next_action_due, services(name, code)")
      .eq("client_id", id)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false }),
  ]);
  if (!client) notFound();

  const panPending = !client.pan_last4;
  const address =
    [client.address_line1, client.address_line2, client.city, client.state, client.pincode]
      .filter(Boolean)
      .join(", ") || "";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{client.full_name}</h1>
        <span className="font-mono text-xs text-muted-foreground">{client.display_code}</span>
        {panPending ? (
          <Badge variant="warning">PAN pending — not on file</Badge>
        ) : (
          <Badge variant="secondary">PAN {maskedPan(client.pan_last4)}</Badge>
        )}
        <Badge variant="outline">KYC: {client.kyc_status}</Badge>
      </div>

      <HelpBox>
        This is one client&apos;s full record. Set or replace their PAN under Identity &amp; PAN
        (stored encrypted; only admins can reveal it, and every reveal is audited with a reason).
        Start or open work under Cases, update contact details under Edit client. Deleting is a
        soft delete in the admin-only Danger zone — nothing is destroyed and an admin can restore it.
      </HelpBox>

      {/* Row 1: summary + identity/PAN */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Client summary</CardTitle>
          </CardHeader>
          <CardContent>
            <Field label="Phone" value={client.primary_phone} />
            <Field label="Email" value={client.email} />
            <Field label="Date of birth" value={client.date_of_birth} />
            <Field label="Address" value={address} />
            <Field label="KYC status" value={client.kyc_status} />
            {client.notes && (
              <p className="mt-3 rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
                {client.notes}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Identity &amp; PAN</CardTitle>
          </CardHeader>
          <CardContent>
            <PanActions clientId={id} hasPan={!panPending} isAdmin={isAdmin} />
          </CardContent>
        </Card>
      </div>

      {/* Row 2: cases */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Cases</CardTitle>
          <Link href={`/cases/new?client=${id}`} className="text-sm text-primary hover:underline">
            + New case
          </Link>
        </CardHeader>
        <CardContent>
          {(cases ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No cases yet.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {(cases ?? []).map((k) => (
                  <tr key={k.id} className="border-t">
                    <td className="py-2 pr-3 font-mono text-xs">
                      <Link href={`/cases/${k.id}`} className="text-primary hover:underline">
                        {k.display_code}
                      </Link>
                    </td>
                    <td className="py-2 pr-3">
                      <Link href={`/cases/${k.id}`} className="hover:underline">
                        {k.title}
                      </Link>
                    </td>
                    <td className="py-2 pr-3">
                      <StatusBadge code={k.status} />
                    </td>
                    <td className="py-2 text-muted-foreground">
                      {k.next_action} {k.next_action_due ? `(due ${k.next_action_due})` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Documents and upload links are managed inside each case.
          </p>
        </CardContent>
      </Card>

      {/* Row 3: edit */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Edit client</CardTitle>
        </CardHeader>
        <CardContent>
          <ClientForm
            clientId={id}
            initial={{
              full_name: client.full_name,
              primary_phone: client.primary_phone,
              email: client.email ?? "",
              date_of_birth: client.date_of_birth ?? "",
              address_line1: client.address_line1 ?? "",
              address_line2: client.address_line2 ?? "",
              city: client.city ?? "",
              state: client.state ?? "",
              pincode: client.pincode ?? "",
              kyc_status: client.kyc_status,
              notes: client.notes ?? "",
            }}
          />
        </CardContent>
      </Card>

      {/* Row 4: danger zone (admin only) */}
      {isAdmin && (
        <Card className="border-red-300">
          <CardHeader>
            <CardTitle className="text-base text-red-800">Danger zone</CardTitle>
          </CardHeader>
          <CardContent>
            <ClientDangerZone clientId={id} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
