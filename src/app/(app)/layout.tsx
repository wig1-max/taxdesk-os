import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth";

/**
 * Authenticated shell. requireUser() enforces: session exists,
 * public.users profile exists, is_active, not soft-deleted.
 * Admin-only areas add requireAdmin() in their own layouts/pages.
 */
export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await requireUser();
  return (
    <AppShell userName={user.full_name} role={user.role}>
      {children}
    </AppShell>
  );
}
