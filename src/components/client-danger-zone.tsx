"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { softDeleteClientAction } from "@/app/actions/clients";
import { Button } from "@/components/ui/button";

/** Admin-only soft delete. Separated into its own section for safety. */
export function ClientDangerZone({ clientId }: { clientId: string }) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function softDelete() {
    if (inFlight.current) return;
    if (!confirm("Soft delete this client? They will be hidden from lists. Only admins can restore.")) {
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await softDeleteClientAction(clientId);
      if (res.ok) router.push("/clients");
      else setError(res.error ?? "Delete failed.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        Soft delete hides the client from lists without destroying records. It does not delete
        cases or documents, and only an admin can restore it.
      </p>
      <Button type="button" size="sm" variant="destructive" onClick={softDelete} disabled={busy}>
        {busy ? "Working…" : "Soft delete client"}
      </Button>
    </div>
  );
}
