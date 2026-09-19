"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

/**
 * Completes a password recovery / setup link. The browser Supabase
 * client (detectSessionInUrl) turns the token in the URL into a
 * temporary session, after which updateUser can set the new password.
 */
export function ResetPasswordForm() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setHasSession(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setHasSession(true);
      setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function submit(formData: FormData) {
    const next = String(formData.get("new_password") ?? "");
    const confirm = String(formData.get("confirm_password") ?? "");
    if (next.length < 8) {
      setMsg({ tone: "err", text: "Password must be at least 8 characters." });
      return;
    }
    if (next !== confirm) {
      setMsg({ tone: "err", text: "Passwords do not match." });
      return;
    }
    setBusy(true);
    setMsg(null);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: next });
    setBusy(false);
    if (error) {
      setMsg({ tone: "err", text: "Could not set the password. The link may have expired." });
      return;
    }
    setMsg({ tone: "ok", text: "Password set. Redirecting to sign in…" });
    await supabase.auth.signOut();
    setTimeout(() => router.push("/login"), 1500);
  }

  if (!ready) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  if (!hasSession) {
    return (
      <div className="space-y-3 text-sm">
        <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-800">
          This reset link is missing or has expired. Request a new one from the sign-in page.
        </p>
        <Link href="/login" className="text-primary hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
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
      <form action={submit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="new_password">New password</Label>
          <Input
            id="new_password"
            name="new_password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm_password">Confirm password</Label>
          <Input
            id="confirm_password"
            name="confirm_password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
          />
        </div>
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Setting…" : "Set new password"}
        </Button>
      </form>
    </div>
  );
}
