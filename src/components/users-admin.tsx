"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  changeUserRoleAction,
  inviteUserAction,
  setUserActiveAction,
} from "@/app/actions/users";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatStaffDate } from "@/lib/utils";

export interface AdminUserRow {
  id: string;
  full_name: string;
  email: string;
  role: "admin" | "staff";
  is_active: boolean;
  created_at: string | null;
}

export function UsersAdmin({
  users,
  currentUserId,
}: {
  users: AdminUserRow[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [tempPassword, setTempPassword] = useState<{
    email: string;
    password: string;
    emailed: boolean;
  } | null>(null);

  // Invite form state
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "staff">("staff");
  const [sendSetupEmail, setSendSetupEmail] = useState(false);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) {
    setMsg(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        setMsg({ tone: "ok", text: okText });
        router.refresh();
      } else {
        setMsg({ tone: "err", text: res.error ?? "Action failed." });
      }
    });
  }

  function invite() {
    setMsg(null);
    setTempPassword(null);
    startTransition(async () => {
      const res = await inviteUserAction({ full_name: fullName, email, role, sendSetupEmail });
      if (res.ok && res.tempPassword) {
        setTempPassword({
          email: res.email ?? email,
          password: res.tempPassword,
          emailed: res.emailed ?? false,
        });
        setFullName("");
        setEmail("");
        setRole("staff");
        setSendSetupEmail(false);
        router.refresh();
      } else {
        setMsg({ tone: "err", text: res.error ?? "Could not invite user." });
      }
    });
  }

  return (
    <div className="space-y-6">
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

      {tempPassword && (
        <div className="rounded-md border border-green-300 bg-green-50 p-4 text-sm text-green-900">
          <p className="font-semibold">Temporary password created — copy it now. It will not be shown again.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-green-800">{tempPassword.email}</span>
            <code className="rounded bg-white px-2 py-1 font-mono text-base tracking-wide">
              {tempPassword.password}
            </code>
          </div>
          {tempPassword.emailed ? (
            <p className="mt-2 text-xs text-green-800">
              A password-setup link was also emailed to the user. The temporary password above is a
              backup if the email does not arrive.
            </p>
          ) : (
            <p className="mt-2 text-xs text-green-800">
              Share it with the user over a trusted channel. Ask them to change it after first login
              (My account → Password).
            </p>
          )}
          <button className="mt-2 text-xs underline" onClick={() => setTempPassword(null)}>
            Dismiss
          </button>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invite a user</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Users are invite-only. Deactivate instead of delete.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="u_name" className="text-xs">Full name</Label>
              <Input id="u_name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Asha Verma" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="u_email" className="text-xs">Email</Label>
              <Input id="u_email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="asha@example.com" autoComplete="off" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="u_role" className="text-xs">Role</Label>
              <select
                id="u_role"
                value={role}
                onChange={(e) => setRole(e.target.value as "admin" | "staff")}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
              >
                <option value="staff">staff</option>
                <option value="admin">admin</option>
              </select>
            </div>
            <div className="flex items-end">
              <Button onClick={invite} disabled={pending || !fullName.trim() || !email.trim()} className="w-full">
                {pending ? "Working…" : "Create user"}
              </Button>
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={sendSetupEmail}
              onChange={(e) => setSendSetupEmail(e.target.checked)}
            />
            Also email a password-setup link (requires email/SMTP configured on the server; the
            temporary password is always shown as a fallback).
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Staff &amp; admins</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Email</th>
                <th className="py-2 pr-3">Role</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Created</th>
                <th className="py-2 pr-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const self = u.id === currentUserId;
                return (
                  <tr key={u.id} className="border-b align-middle">
                    <td className="py-2 pr-3">
                      {u.full_name}
                      {self && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">{u.email}</td>
                    <td className="py-2 pr-3">
                      <Badge variant={u.role === "admin" ? "default" : "secondary"}>{u.role}</Badge>
                    </td>
                    <td className="py-2 pr-3">
                      <Badge variant={u.is_active ? "success" : "destructive"}>
                        {u.is_active ? "active" : "inactive"}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">
                      {formatStaffDate(u.created_at)}
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending || self}
                          aria-label={`Make ${u.full_name} ${u.role === "admin" ? "staff" : "admin"}`}
                          onClick={() =>
                            run(
                              () =>
                                changeUserRoleAction({
                                  userId: u.id,
                                  role: u.role === "admin" ? "staff" : "admin",
                                }),
                              `Role changed to ${u.role === "admin" ? "staff" : "admin"}.`
                            )
                          }
                        >
                          Make {u.role === "admin" ? "staff" : "admin"}
                        </Button>
                        {u.is_active ? (
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={pending || self}
                            aria-label={`Deactivate ${u.full_name}`}
                            onClick={() =>
                              run(
                                () => setUserActiveAction({ userId: u.id, isActive: false }),
                                "User deactivated."
                              )
                            }
                          >
                            Deactivate
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={pending}
                            aria-label={`Reactivate ${u.full_name}`}
                            onClick={() =>
                              run(
                                () => setUserActiveAction({ userId: u.id, isActive: true }),
                                "User reactivated."
                              )
                            }
                          >
                            Reactivate
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
