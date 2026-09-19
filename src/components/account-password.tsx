"use client";

import { useState, useTransition } from "react";
import { changePasswordAction, sendMyResetEmailAction } from "@/app/actions/account";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AccountPassword() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  function change(formData: FormData) {
    setMsg(null);
    start(async () => {
      const res = await changePasswordAction(formData);
      setMsg(
        res.ok
          ? { tone: "ok", text: res.message ?? "Password updated." }
          : { tone: "err", text: res.error ?? "Could not update password." }
      );
    });
  }

  function emailReset() {
    setMsg(null);
    start(async () => {
      const res = await sendMyResetEmailAction();
      setMsg(
        res.ok
          ? { tone: "ok", text: res.message ?? "Reset link sent." }
          : { tone: "err", text: res.error ?? "Could not send email." }
      );
    });
  }

  return (
    <div className="space-y-4">
      {msg && (
        <p
          role="alert"
          className={
            msg.tone === "ok"
              ? "rounded-md bg-green-50 px-3 py-2 text-sm text-green-800"
              : "rounded-md bg-red-50 px-3 py-2 text-sm text-red-800"
          }
        >
          {msg.text}
        </p>
      )}

      <form action={change} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="current_password">Current password</Label>
          <Input
            id="current_password"
            name="current_password"
            type="password"
            autoComplete="current-password"
            required
            className="max-w-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new_password">New password</Label>
          <Input
            id="new_password"
            name="new_password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            className="max-w-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm_password">Confirm new password</Label>
          <Input
            id="confirm_password"
            name="confirm_password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            className="max-w-sm"
          />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Working…" : "Change password"}
        </Button>
      </form>

      <div className="border-t pt-3">
        <p className="mb-2 text-xs text-muted-foreground">
          Prefer email? Send yourself a secure reset link (requires email to be configured on the server).
        </p>
        <Button type="button" variant="outline" size="sm" onClick={emailReset} disabled={pending}>
          Email me a reset link
        </Button>
      </div>
    </div>
  );
}
