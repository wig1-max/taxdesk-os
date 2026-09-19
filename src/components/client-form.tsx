"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createClientAction, updateClientAction } from "@/app/actions/clients";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { needsPanBlockingWarning, type ClientWriteResult } from "@/lib/pan-write-plan";
import { clientInputSchema, type ClientInput } from "@/lib/validation/client";

interface Props {
  clientId?: string;
  initial?: Partial<ClientInput>;
}

export function ClientForm({ clientId, initial }: Props) {
  const router = useRouter();
  const [result, setResult] = useState<ClientWriteResult | null>(null);
  const [busy, setBusy] = useState(false);
  // A server-rendered form without its React submit handler would otherwise
  // fall back to a browser GET if clicked during hydration. Keep submission
  // unavailable until the handler is attached.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ClientInput>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(clientInputSchema) as any,
    defaultValues: { kyc_status: "pending", ...initial },
  });

  const onSubmit = handleSubmit(async (values) => {
    setBusy(true);
    const res = clientId
      ? await updateClientAction(clientId, values)
      : await createClientAction(values);
    setBusy(false);
    setResult(res);
    if (res.ok && res.panSaved && res.clientId) {
      // Hard navigation: a soft router.push here is swallowed by the create
      // action's revalidatePath re-render (same rationale as case-form), which
      // left the form stuck on /clients/new after a successful create.
      window.location.assign(`/clients/${res.clientId}`);
    }
  });

  const field = (name: keyof ClientInput, label: string, props: object = {}) => (
    <div className="space-y-1">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} {...register(name)} {...props} />
      {errors[name] && (
        <p className="text-xs text-red-700">{String(errors[name]?.message)}</p>
      )}
    </div>
  );

  return (
    <form onSubmit={onSubmit} className="max-w-2xl space-y-4">
      {/* Appendix C6: blocking warning — never a plain success. */}
      {result && needsPanBlockingWarning(result) && (
        <div
          role="alertdialog"
          className="rounded-md border-2 border-red-600 bg-red-50 p-4 text-sm text-red-900"
        >
          <p className="font-bold">Client saved, PAN NOT saved.</p>
          <p>{result.panError}</p>
          <p className="mt-2">
            Retry from the client page (Set PAN), or fix the issue and retry now.
          </p>
          {result.clientId && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="mt-2"
              onClick={() => router.push(`/clients/${result.clientId}`)}
            >
              Go to client page to retry PAN
            </Button>
          )}
        </div>
      )}
      {result && !result.ok && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {result.error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {field("full_name", "Full name *")}
        {field("primary_phone", "Mobile number *", { inputMode: "numeric" })}
        {field("email", "Email", { type: "email" })}
        {field("date_of_birth", "Date of birth", { type: "date" })}
        {field("pan", "PAN (optional — stored encrypted, shown masked)", {
          placeholder: "ABCDE1234F",
          autoComplete: "off",
          style: { textTransform: "uppercase" as const },
        })}
        <div className="space-y-1">
          <Label htmlFor="kyc_status">KYC status</Label>
          <select
            id="kyc_status"
            {...register("kyc_status")}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="pending">Pending</option>
            <option value="partial">Partial</option>
            <option value="done">Done</option>
          </select>
        </div>
        {field("address_line1", "Address line 1")}
        {field("address_line2", "Address line 2")}
        {field("city", "City")}
        {field("state", "State")}
        {field("pincode", "PIN code", { inputMode: "numeric" })}
      </div>
      <div className="space-y-1">
        <Label htmlFor="notes">Internal notes</Label>
        <textarea
          id="notes"
          {...register("notes")}
          rows={3}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>
      {/* NO Aadhaar field exists on this form — by design. Never add one. */}
      <Button type="submit" disabled={busy || !hydrated}>
        {busy ? "Saving…" : clientId ? "Save changes" : "Create client"}
      </Button>
    </form>
  );
}
