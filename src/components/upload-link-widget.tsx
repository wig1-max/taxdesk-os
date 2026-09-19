"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createUploadLinkAction } from "@/app/actions/upload-links";
import { Button } from "@/components/ui/button";

interface DocOption {
  id: string;
  name: string;
  status: string;
}

/**
 * Creates a client upload link. The raw URL is displayed ONCE from
 * component state — it is never stored or shown again (only its
 * hash exists server-side).
 */
export function UploadLinkWidget({ caseId, docs }: { caseId: string; docs: DocOption[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(
    docs.filter((d) => ["pending", "requested", "rejected"].includes(d.status)).map((d) => d.id)
  );
  const [hours, setHours] = useState(72);
  const [maxUploads, setMaxUploads] = useState(10);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    const res = await createUploadLinkAction({
      case_id: caseId,
      allowed_document_ids: selected,
      expires_in_hours: hours,
      max_uploads: maxUploads,
    });
    setBusy(false);
    if (res.ok && res.url) {
      setLink(res.url);
      router.refresh();
    } else {
      setError(res.error ?? "Could not create link.");
    }
  }

  async function copy() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (link) {
    return (
      <div className="space-y-2 rounded-md border-2 border-green-600 bg-green-50 p-3 text-sm">
        <p className="font-semibold text-green-900">
          Upload link created — copy it NOW. It will not be shown again.
        </p>
        <code className="block break-all rounded bg-white p-2 text-xs">{link}</code>
        <p className="text-xs text-green-800">
          This exact address (with its one-time secret) can&apos;t be retrieved later. If you lose
          it, revoke the link below and generate a new one — the link keeps working until it expires
          or you revoke it.
        </p>
        <div className="flex gap-2">
          <Button size="sm" onClick={copy}>
            {copied ? "Copied!" : "Copy link for WhatsApp"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setLink(null)}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      {error && <p className="rounded bg-red-50 px-2 py-1 text-red-800">{error}</p>}
      <p className="font-medium">Documents the client may upload:</p>
      <div className="grid gap-1 sm:grid-cols-2">
        {docs.map((d) => (
          <label key={d.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={selected.includes(d.id)}
              onChange={(e) =>
                setSelected((prev) =>
                  e.target.checked ? [...prev, d.id] : prev.filter((x) => x !== d.id)
                )
              }
            />
            {d.name} <span className="text-xs text-muted-foreground">({d.status})</span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label>
          Expiry (hours, max 168)
          <input
            type="number"
            min={1}
            max={168}
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className="ml-2 h-9 w-20 rounded-md border border-input bg-background px-2"
          />
        </label>
        <label>
          Max uploads (≤25)
          <input
            type="number"
            min={1}
            max={25}
            value={maxUploads}
            onChange={(e) => setMaxUploads(Number(e.target.value))}
            className="ml-2 h-9 w-16 rounded-md border border-input bg-background px-2"
          />
        </label>
        <Button size="sm" onClick={create} disabled={busy || selected.length === 0}>
          {busy ? "Creating…" : "Generate upload link"}
        </Button>
      </div>
    </div>
  );
}
