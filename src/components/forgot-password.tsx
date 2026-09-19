"use client";

import { useState, useTransition } from "react";
import { requestPasswordResetAction } from "@/app/actions/account";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Small disclosure on the login page to request a reset link by email. */
export function ForgotPassword() {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function submit(formData: FormData) {
    setMsg(null);
    start(async () => {
      const res = await requestPasswordResetAction(formData);
      setMsg(res.message ?? res.error ?? "");
    });
  }

  return (
    <div className="mt-3">
      {!open ? (
        <button
          type="button"
          className="w-full text-center text-xs text-muted-foreground underline"
          onClick={() => setOpen(true)}
        >
          Forgot password?
        </button>
      ) : (
        <form action={submit} className="space-y-2">
          <Input name="email" type="email" placeholder="you@example.com" autoComplete="email" required />
          <Button type="submit" variant="outline" size="sm" className="w-full" disabled={pending}>
            {pending ? "Sending…" : "Email me a reset link"}
          </Button>
        </form>
      )}
      {msg && <p className="mt-2 text-center text-xs text-muted-foreground">{msg}</p>}
    </div>
  );
}
