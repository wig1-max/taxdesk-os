import type { Metadata } from "next";
import { AccountPassword } from "@/components/account-password";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "My account" };

export default async function AccountPage() {
  const user = await requireUser();

  return (
    <div className="max-w-2xl space-y-5">
      <PageHeader
        title="My account"
        description="Your profile and password."
        help="Update your own password here without asking an admin. Your name, email, and role are managed by an administrator — ask them if any of these need to change."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div className="flex justify-between border-b border-dashed py-1.5">
            <span className="text-xs text-muted-foreground">Name</span>
            <span>{user.full_name}</span>
          </div>
          <div className="flex justify-between border-b border-dashed py-1.5">
            <span className="text-xs text-muted-foreground">Email</span>
            <span>{user.email}</span>
          </div>
          <div className="flex justify-between py-1.5">
            <span className="text-xs text-muted-foreground">Role</span>
            <Badge variant={user.role === "admin" ? "default" : "secondary"}>{user.role}</Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Password</CardTitle>
        </CardHeader>
        <CardContent>
          <AccountPassword />
        </CardContent>
      </Card>
    </div>
  );
}
