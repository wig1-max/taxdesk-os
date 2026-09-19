import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCaseMessageVariables } from "@/app/actions/messages";
import { MessageComposer } from "@/components/message-composer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { filterTemplatesForService } from "@/lib/services/catalog";
import { createClient as createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Messages" };

export default async function CaseMessagesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;

  const supabase = await createServerClient();
  const { data: kase } = await supabase
    .from("cases")
    .select("id, services(code)")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!kase) notFound();
  const serviceCode = (kase.services as unknown as { code: string }).code;

  const [{ data: templates }, { data: history }, variables] = await Promise.all([
    supabase
      .from("message_templates")
      .select("id, code, name, body, services(code)")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("case_messages")
      .select("id, rendered_body, copied_at, created_at, users:composed_by(full_name), message_templates(name)")
      .eq("case_id", id)
      .order("created_at", { ascending: false })
      .limit(30),
    getCaseMessageVariables(id),
  ]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Compose WhatsApp message</CardTitle>
          </CardHeader>
          <CardContent>
            <MessageComposer
              caseId={id}
              serviceCode={serviceCode}
              // Server-side filter: only this service's templates + generic
              // ones. Unrelated-service templates are not sent to the client
              // at all (not merely sorted last).
              templates={filterTemplatesForService(
                (templates ?? []).map((t) => ({
                  id: t.id,
                  code: t.code,
                  name: t.name,
                  body: t.body,
                  service_code: (t.services as unknown as { code: string } | null)?.code ?? null,
                })),
                serviceCode
              )}
              variables={variables}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Message history</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3 text-sm">
              {(history ?? []).map((m) => (
                <li key={m.id} className="border-b pb-2">
                  <p className="text-xs text-muted-foreground">
                    {new Date(m.created_at).toLocaleString("en-IN")} ·{" "}
                    {(m.message_templates as unknown as { name: string } | null)?.name ?? "custom"}{" "}
                    · {(m.users as unknown as { full_name: string } | null)?.full_name ?? "—"}
                  </p>
                  <p className="whitespace-pre-wrap text-xs">{m.rendered_body}</p>
                </li>
              ))}
              {(history ?? []).length === 0 && (
                <li className="text-muted-foreground">No messages logged yet.</li>
              )}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
