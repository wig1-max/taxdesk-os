"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function signInAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) redirect("/login?error=missing");

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) redirect("/login?error=invalid");

  // Server-only admin profile check.
  // The normal RLS client can fail here because active-user RLS depends
  // on public.users itself, creating a circular login check.
  //
  // The three failure modes MUST stay distinct:
  //   1. lookup ERROR      -> infrastructure problem (bad service key, wrong
  //                           URL, REST unreachable). Never report this as
  //                           "account inactive" — log it and show a server
  //                           error so it is diagnosable.
  //   2. no profile row    -> invite-only check: auth user exists but was
  //                           never invited into public.users. Inactive.
  //   3. inactive/deleted  -> genuinely blocked account. Inactive.
  const admin = createAdminClient();

  const { data: profile, error: profileError } = await admin
    .from("users")
    .select("id, role, is_active, deleted_at")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profileError) {
    console.error(
      `signInAction: public.users lookup FAILED for auth user ${data.user.id}: ` +
        `${profileError.message} (code: ${profileError.code ?? "n/a"}). ` +
        "This is a server/config problem (check SUPABASE_SERVICE_ROLE_KEY and " +
        "NEXT_PUBLIC_SUPABASE_URL), not an inactive account."
    );
    await supabase.auth.signOut();
    redirect("/login?error=server");
  }

  if (!profile) {
    console.error(
      `signInAction: auth user ${data.user.id} (${email}) has NO public.users ` +
        "profile row. Access is invite-only — bootstrap it with: " +
        `insert into public.users (id, full_name, email, role) values ('${data.user.id}', '<name>', '${email}', 'admin');`
    );
    await supabase.auth.signOut();
    redirect("/login?error=inactive");
  }

  const isActiveStaffOrAdmin =
    profile.is_active &&
    !profile.deleted_at &&
    (profile.role === "admin" || profile.role === "staff");

  if (!isActiveStaffOrAdmin) {
    await supabase.auth.signOut();
    redirect("/login?error=inactive");
  }

  redirect("/dashboard");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  // Local scope: end only THIS browser's session. The Supabase default
  // ("global") revokes every session for the user across all devices, which
  // is surprising for a web sign-out and also breaks shared E2E auth state.
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}