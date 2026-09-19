import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UserRole } from "@/lib/db/types";

export interface SessionUser {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
}

/**
 * Loads the authenticated user from Supabase Auth, then loads their
 * public.users profile with the service-role client.
 *
 * Reason:
 * During login/session checks, using the normal RLS client to read
 * public.users can fail because the user's active-role lookup itself
 * depends on public.users. This creates a circular RLS problem.
 *
 * This function is server-only and returns only safe profile fields.
 *
 * Wrapped in React `cache()` so it runs at most ONCE per server request:
 * the app layout and each page/tab both call requireUser()/requireAdmin(),
 * and without this each call repeated a network auth.getUser() + a profile
 * query. Same auth checks — just memoized within a single render pass.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const t0 = process.env.PERF_LOG ? Date.now() : 0;
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return null;

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("users")
    .select("id, email, full_name, role, is_active, deleted_at")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Profile lookup failed:", error.message);
    return null;
  }

  if (!data) {
    // Auth session exists but there is no public.users profile (invite-only).
    // Log once per request so this state is diagnosable — it otherwise
    // surfaces only as a generic redirect back to /login.
    console.warn(
      `getSessionUser: auth user ${user.id} has no public.users profile row; treating as signed out.`
    );
    return null;
  }

  if (!data.is_active || data.deleted_at) return null;

  if (process.env.PERF_LOG) {
    console.log(`[perf] getSessionUser ${Date.now() - t0}ms`);
  }

  return {
    id: data.id,
    email: data.email,
    full_name: data.full_name,
    role: data.role as UserRole,
  };
});

/** For pages/actions that need any active staff/admin user. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login?error=session");
  return user;
}

/** For /settings/*, /audit-log and admin-only actions. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/dashboard?error=admin_only");
  return user;
}