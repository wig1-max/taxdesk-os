"use server";

import { randomBytes } from "node:crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { getAppBaseUrl } from "@/lib/app-url";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  canChangeRole,
  canDeactivate,
  canReactivate,
  type TargetUser,
} from "@/lib/users/guards";
import {
  changeRoleSchema,
  inviteUserSchema,
  setActiveSchema,
} from "@/lib/validation/user";

type Result = { ok: boolean; error?: string };
type InviteResult = Result & { tempPassword?: string; email?: string; emailed?: boolean };

/**
 * All actions here are admin-only (requireAdmin) and use the server-only
 * service-role client because they create/manage auth.users. The client
 * is never handed to the browser. Every mutation is audited and routed
 * through the pure guards in lib/users/guards.ts.
 */

type Admin = ReturnType<typeof createAdminClient>;

/** Strong, url-safe temporary password shown to the admin exactly once. */
function generateTempPassword(): string {
  return "Tj" + randomBytes(12).toString("base64url") + "9!";
}

/**
 * Best-effort password-setup email (Supabase recovery link). Returns
 * false if SMTP/redirect isn't configured — the temp password is always
 * returned as the fallback, so invite never depends on email working.
 */
async function trySendSetupEmail(email: string): Promise<boolean> {
  let redirectTo: string;
  try {
    redirectTo = `${getAppBaseUrl()}/reset-password`;
  } catch {
    return false;
  }
  const anon = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { error } = await anon.auth.resetPasswordForEmail(email, { redirectTo });
  return !error;
}

async function countActiveAdmins(admin: Admin): Promise<number> {
  const { count } = await admin
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin")
    .eq("is_active", true)
    .is("deleted_at", null);
  return count ?? 0;
}

export async function inviteUserAction(input: unknown): Promise<InviteResult> {
  const actor = await requireAdmin();
  const parsed = inviteUserSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { full_name, email, role, sendSetupEmail } = parsed.data;

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (existing) return { ok: false, error: "A user with that email already exists." };

  const tempPassword = generateTempPassword();
  const { data: created, error: authErr } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name },
  });
  if (authErr || !created?.user) {
    const dup = /already|registered|exists/i.test(authErr?.message ?? "");
    return {
      ok: false,
      error: dup
        ? "That email already has an auth account."
        : "Could not create the auth user.",
    };
  }

  const { error: rowErr } = await admin.from("users").insert({
    id: created.user.id,
    full_name,
    email,
    role,
    is_active: true,
  });
  if (rowErr) {
    // Roll back the orphaned auth user so a retry is clean.
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
    return { ok: false, error: "Could not create the user profile. Nothing was saved." };
  }

  const emailed = sendSetupEmail ? await trySendSetupEmail(email) : false;

  await audit({
    actor,
    action: "user.invited",
    entityType: "users",
    entityId: created.user.id,
    after: { full_name, email, role, setup_email_sent: emailed },
  });
  revalidatePath("/settings/users");
  return { ok: true, tempPassword, email, emailed };
}

export async function setUserActiveAction(input: unknown): Promise<Result> {
  const actor = await requireAdmin();
  const parsed = setActiveSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { userId, isActive } = parsed.data;

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("users")
    .select("id, role, is_active")
    .eq("id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!target) return { ok: false, error: "User not found." };

  const t: TargetUser = { id: target.id, role: target.role, is_active: target.is_active };
  const guard = isActive
    ? canReactivate(t)
    : canDeactivate(actor.id, t, await countActiveAdmins(admin));
  if (!guard.ok) return guard;

  const { error } = await admin.from("users").update({ is_active: isActive }).eq("id", userId);
  if (error) return { ok: false, error: "Update failed." };

  await audit({
    actor,
    action: isActive ? "user.reactivated" : "user.deactivated",
    entityType: "users",
    entityId: userId,
    after: { is_active: isActive },
  });
  revalidatePath("/settings/users");
  return { ok: true };
}

export async function changeUserRoleAction(input: unknown): Promise<Result> {
  const actor = await requireAdmin();
  const parsed = changeRoleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { userId, role } = parsed.data;

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("users")
    .select("id, role, is_active")
    .eq("id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!target) return { ok: false, error: "User not found." };

  const t: TargetUser = { id: target.id, role: target.role, is_active: target.is_active };
  const guard = canChangeRole(actor.id, t, role, await countActiveAdmins(admin));
  if (!guard.ok) return guard;

  const { error } = await admin.from("users").update({ role }).eq("id", userId);
  if (error) return { ok: false, error: "Update failed." };

  await audit({
    actor,
    action: "user.role_changed",
    entityType: "users",
    entityId: userId,
    before: { role: target.role },
    after: { role },
  });
  revalidatePath("/settings/users");
  return { ok: true };
}
