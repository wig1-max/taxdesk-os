"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Drawer, ConfirmDialog } from "@/components/ui/drawer";
import { StatusPill } from "@/components/ui/status";
import { useToast } from "@/components/ui/toast";
import {
  upsertReviewerCredentialAction,
  setReviewerCredentialStatusAction,
} from "@/app/actions/reviewer-credentials";
import { REVIEWER_QUALIFICATIONS, qualificationLabel } from "@/lib/tax-desk/reviewer";
import type { ReviewerCredentialRow, AssignableUser } from "@/lib/queries/tax-reviewer";
import type { Tone } from "@/lib/ui/status-tone";

const STATUS_TONE: Record<string, Tone> = { active: "success", inactive: "neutral", revoked: "danger" };

/**
 * Reviewer credential management (K.2.8.9B, ADMIN). Create/update qualifications
 * and activate/deactivate/revoke reviewers. All writes go through the guarded,
 * admin-only RPCs; this UI just gathers the input.
 */
export function ReviewerCredentialsAdmin({
  credentials,
  users,
}: {
  credentials: ReviewerCredentialRow[];
  users: AssignableUser[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [editor, setEditor] = useState<null | { row?: ReviewerCredentialRow }>(null);
  const [revoke, setRevoke] = useState<ReviewerCredentialRow | null>(null);

  const [userId, setUserId] = useState("");
  const [qualification, setQualification] = useState("chartered_accountant");
  const [reference, setReference] = useState("");
  const [revokeReason, setRevokeReason] = useState("");
  const [err, setErr] = useState<string | null>(null);

  function openEditor(row?: ReviewerCredentialRow) {
    setErr(null);
    setEditor({ row });
    setUserId(row?.userId ?? "");
    setQualification(row?.qualification ?? "chartered_accountant");
    setReference(row?.credentialReference ?? "");
  }

  function save() {
    setErr(null);
    start(async () => {
      const res = await upsertReviewerCredentialAction({
        userId,
        qualification,
        credentialReference: reference || undefined,
      });
      if (res.ok) {
        toast.success("Reviewer credential saved ✓");
        setEditor(null);
        router.refresh();
      } else {
        setErr(res.error ?? "Could not save the credential.");
      }
    });
  }

  function changeStatus(row: ReviewerCredentialRow, status: "active" | "inactive" | "revoked", reason?: string) {
    start(async () => {
      const res = await setReviewerCredentialStatusAction({ credentialId: row.id, status, reason });
      if (res.ok) {
        toast.success(`Credential ${status} ✓`);
        setRevoke(null);
        setRevokeReason("");
        router.refresh();
      } else {
        toast.error(res.error ?? "Could not update status.");
      }
    });
  }

  const field = "h-10 w-full rounded-md border bg-background px-3 text-sm";
  // Users who don't yet have a credential (for the create flow).
  const credUserIds = new Set(credentials.map((c) => c.userId));

  return (
    <div className="space-y-4" data-testid="reviewer-credentials-admin">
      <div className="flex justify-end">
        <Button type="button" onClick={() => openEditor()} className="h-9">
          <Plus className="mr-1.5 h-4 w-4" aria-hidden />
          Add reviewer
        </Button>
      </div>

      {credentials.length === 0 ? (
        <p className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
          No reviewer credentials yet. Add a qualified reviewer to enable manual-review sign-off.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Reviewer</th>
                <th className="px-3 py-2 font-medium">Qualification</th>
                <th className="px-3 py-2 font-medium">Reference</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {credentials.map((c) => (
                <tr key={c.id} className="border-t" data-testid="credential-row" data-status={c.status}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{c.fullName}</div>
                    <div className="text-xs text-muted-foreground">{c.email}</div>
                  </td>
                  <td className="px-3 py-2">{qualificationLabel(c.qualification)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{c.credentialReference ?? "—"}</td>
                  <td className="px-3 py-2">
                    <StatusPill tone={STATUS_TONE[c.status] ?? "neutral"} label={c.status} dot={false} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => openEditor(c)}
                        disabled={pending}
                        aria-label={`Edit ${c.fullName}'s reviewer credential`}
                        className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent"
                      >
                        <Pencil className="h-3 w-3" aria-hidden /> Edit
                      </button>
                      {c.status !== "active" && (
                        <button
                          type="button"
                          onClick={() => changeStatus(c, "active")}
                          disabled={pending}
                          aria-label={`Activate ${c.fullName}'s reviewer credential`}
                          className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
                        >
                          Activate
                        </button>
                      )}
                      {c.status === "active" && (
                        <button
                          type="button"
                          onClick={() => changeStatus(c, "inactive")}
                          disabled={pending}
                          aria-label={`Deactivate ${c.fullName}'s reviewer credential`}
                          className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
                        >
                          Deactivate
                        </button>
                      )}
                      {c.status !== "revoked" && (
                        <button
                          type="button"
                          onClick={() => setRevoke(c)}
                          disabled={pending}
                          aria-label={`Revoke ${c.fullName}'s reviewer credential`}
                          className="rounded-md border border-danger-border px-2 py-1 text-xs text-danger hover:bg-danger-soft"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / edit drawer */}
      <Drawer
        open={editor !== null}
        onClose={() => setEditor(null)}
        title={editor?.row ? "Edit reviewer credential" : "Add reviewer credential"}
        description="Grant qualified-reviewer status to a staff or admin user."
        footer={
          <>
            <button type="button" onClick={() => setEditor(null)} className="h-9 rounded-md border bg-background px-3 text-sm font-medium hover:bg-accent">
              Cancel
            </button>
            <Button type="button" onClick={save} disabled={pending || !userId} className="h-9">
              {pending ? "Saving…" : "Save credential"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="rc-user" className="block text-sm font-medium">
              Team member
            </label>
            <select
              id="rc-user"
              value={userId}
              disabled={!!editor?.row}
              onChange={(e) => setUserId(e.target.value)}
              className={`${field} disabled:opacity-60`}
              data-testid="credential-user-select"
            >
              <option value="">Select a user…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id} disabled={!editor?.row && credUserIds.has(u.id)}>
                  {u.fullName} · {u.role}
                  {!editor?.row && credUserIds.has(u.id) ? " (already a reviewer)" : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor="rc-qual" className="block text-sm font-medium">
              Qualification
            </label>
            <select id="rc-qual" value={qualification} onChange={(e) => setQualification(e.target.value)} className={field}>
              {REVIEWER_QUALIFICATIONS.map((q) => (
                <option key={q.code} value={q.code}>
                  {q.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor="rc-ref" className="block text-sm font-medium">
              Registration / membership number (optional)
            </label>
            <input
              id="rc-ref"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className={field}
              placeholder="e.g. ICAI membership no."
            />
            <p className="text-xs text-muted-foreground">
              Credential-sensitive. Visible to admins only — never shown to ordinary staff.
            </p>
          </div>

          {err && (
            <p className="text-sm text-danger" role="alert">
              {err}
            </p>
          )}
        </div>
      </Drawer>

      <ConfirmDialog
        open={revoke !== null}
        onClose={() => setRevoke(null)}
        onConfirm={() => revoke && changeStatus(revoke, "revoked", revokeReason)}
        title="Revoke reviewer credential"
        confirmLabel="Revoke"
        pending={pending}
      >
        <div className="space-y-2">
          <p>
            Revoking removes {revoke?.fullName}&apos;s ability to sign off. Past sign-offs remain in the immutable
            review history with their qualification snapshot.
          </p>
          <textarea
            value={revokeReason}
            onChange={(e) => setRevokeReason(e.target.value)}
            rows={3}
            required
            className="w-full rounded-md border bg-background p-2 text-sm"
            placeholder="Reason for revocation (required)…"
          />
        </div>
      </ConfirmDialog>
    </div>
  );
}
