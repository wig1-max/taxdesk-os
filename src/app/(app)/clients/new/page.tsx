import type { Metadata } from "next";
import { ClientForm } from "@/components/client-form";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "New client" };

export default async function NewClientPage() {
  await requireUser();
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">New client</h1>
      <p className="text-sm text-muted-foreground">
        PAN is optional, stored encrypted, and always displayed masked. There is no Aadhaar
        field — Aadhaar collection is per-case, default-deny, consent-gated.
      </p>
      <ClientForm />
    </div>
  );
}
