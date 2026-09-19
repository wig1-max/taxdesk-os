import type { Metadata } from "next";
import { UsersAdmin, type AdminUserRow } from "@/components/users-admin";
import { PageHeader } from "@/components/ui/page";
import { requireAdmin } from "@/lib/auth";
import { createClient as createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Users" };

export default async function UsersSettingsPage() {
  const user = await requireAdmin();

  // Read via the session client (RLS: users_select is staff/admin only).
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("users")
    .select("id, full_name, email, role, is_active, created_at")
    .is("deleted_at", null)
    .order("is_active", { ascending: false })
    .order("full_name");

  const users = (data ?? []) as AdminUserRow[];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Users (admin)"
        description="Invite-only staff management. No self-signup exists anywhere."
        help="Create staff or admin accounts here; there is no public sign-up. New users get a temporary password (shown once) and can optionally be emailed a setup link. Deactivate blocks login immediately instead of deleting the account, so history is preserved. You cannot deactivate or demote yourself, or remove the last active admin. Every action is written to the audit log."
      />
      <UsersAdmin users={users} currentUserId={user.id} />
    </div>
  );
}
