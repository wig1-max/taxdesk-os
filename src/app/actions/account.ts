"use server";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getAppBaseUrl } from "@/lib/app-url";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { createClient as createServerClient } from "@/lib/supabase/server";

type Result = { ok: boolean; error?: string; message?: string };

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(72, "Password must be 72 characters or fewer.");

function anonClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

/** Best-effort recovery email. Never reveals whether the address exists. */
async function sendResetEmail(email: string): Promise<boolean> {
  let redirectTo: string;
  try {
    redirectTo = `${getAppBaseUrl()}/reset-password`;
  } catch {
    return false;
  }
  const { error } = await anonClient().auth.resetPasswordForEmail(email, { redirectTo });
  return !error;
}

/**
 * Change the signed-in user's own password. Verifies the current
 * password first (a fresh, session-less client so it never disturbs the
 * cookie session), then updates via the session client. No password
 * value is ever logged.
 */
export async function changePasswordAction(formData: FormData): Promise<Result> {
  const user = await requireUser();
  const current = String(formData.get("current_password") ?? "");
  const next = String(formData.get("new_password") ?? "");
  const confirm = String(formData.get("confirm_password") ?? "");

  const parsed = passwordSchema.safeParse(next);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  if (next !== confirm) return { ok: false, error: "New passwords do not match." };
  if (next === current) return { ok: false, error: "New password must differ from the current one." };

  const { error: verifyErr } = await anonClient().auth.signInWithPassword({
    email: user.email,
    password: current,
  });
  if (verifyErr) return { ok: false, error: "Current password is incorrect." };

  const supabase = await createServerClient();
  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) return { ok: false, error: "Could not update the password. Please try again." };

  await audit({
    actor: user,
    action: "user.password_changed",
    entityType: "users",
    entityId: user.id,
    after: { self_service: true },
  });
  return { ok: true, message: "Password updated." };
}

/** Logged-in user asks for a reset link to their own email. Audited. */
export async function sendMyResetEmailAction(): Promise<Result> {
  const user = await requireUser();
  const sent = await sendResetEmail(user.email);
  if (sent) {
    await audit({
      actor: user,
      action: "user.password_reset_requested",
      entityType: "users",
      entityId: user.id,
      after: { self_service: true },
    });
    return { ok: true, message: `Reset link sent to ${user.email}. Check your inbox.` };
  }
  return {
    ok: false,
    error: "Could not send the email (SMTP may not be configured). You can change your password directly above.",
  };
}

/** Public "forgot password" from the login page. No user enumeration. */
export async function requestPasswordResetAction(formData: FormData): Promise<Result> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!z.string().email().safeParse(email).success) {
    return { ok: false, error: "Enter a valid email address." };
  }
  await sendResetEmail(email);
  return {
    ok: true,
    message: "If that email belongs to an active account, a reset link is on its way.",
  };
}
