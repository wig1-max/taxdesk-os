"use client";

import { useMemo, useState } from "react";

interface DocOption {
  id: string;
  name: string;
  status: string;
}

/**
 * Public client upload form. Posts multipart/form-data to
 * /api/public-upload, ONE file per submit (each file is validated and
 * consent-recorded server-side). After each success the form stays
 * ready and auto-advances to the next pending item so the client can
 * upload as many files as they need without feeling stuck.
 */
export function UploadForm({
  token,
  docs,
  purposeText,
}: {
  token: string;
  docs: DocOption[];
  purposeText: string;
}) {
  const [consent, setConsent] = useState(false);
  const [docId, setDocId] = useState(docs[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadedIds, setUploadedIds] = useState<string[]>([]);
  const [messages, setMessages] = useState<Array<{ tone: "ok" | "err"; text: string }>>([]);

  const docNameById = useMemo(
    () => Object.fromEntries(docs.map((d) => [d.id, d.name] as const)),
    [docs]
  );

  function advance(justUploadedId: string) {
    const doneSet = new Set([...uploadedIds, justUploadedId]);
    const next = docs.find((d) => !doneSet.has(d.id));
    setDocId(next ? next.id : justUploadedId);
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file || !docId || !consent) return;
    const form = e.currentTarget;
    setBusy(true);
    const fd = new FormData();
    fd.set("token", token);
    fd.set("case_document_id", docId);
    fd.set("consent", "true");
    fd.set("file", file);
    try {
      const res = await fetch("/api/public-upload", { method: "POST", body: fd });
      const json = (await res.json()) as { ok: boolean; error?: string; document?: string };
      if (json.ok) {
        setMessages((m) => [...m, { tone: "ok", text: `Uploaded: ${json.document}` }]);
        setUploadedIds((u) => (u.includes(docId) ? u : [...u, docId]));
        setFile(null);
        // Clear only the file input; keep the consent tick for convenience
        // (consent is still recorded server-side on every upload).
        const fileInput = form.elements.namedItem("file") as HTMLInputElement | null;
        if (fileInput) fileInput.value = "";
        advance(docId);
      } else {
        setMessages((m) => [...m, { tone: "err", text: json.error ?? "Upload failed." }]);
      }
    } catch {
      setMessages((m) => [...m, { tone: "err", text: "Network error. Please try again." }]);
    }
    setBusy(false);
  }

  const remaining = docs.filter((d) => !uploadedIds.includes(d.id)).length;

  return (
    <form onSubmit={submit} className="space-y-4 text-sm">
      {uploadedIds.length > 0 && (
        <div className="rounded-md border border-green-200 bg-green-50 p-3 text-green-900">
          <p className="text-xs font-semibold">Uploaded so far ({uploadedIds.length})</p>
          <ul className="mt-1 list-inside list-disc text-xs">
            {uploadedIds.map((id) => (
              <li key={id}>{docNameById[id] ?? "document"}</li>
            ))}
          </ul>
          <p className="mt-1 text-xs">
            {remaining > 0
              ? "You can upload another document below."
              : "All listed documents have a file. You can upload more if needed, or close this page."}
          </p>
        </div>
      )}

      <div role="status" aria-live="polite" className="space-y-2 empty:hidden">
        {messages.map((m, i) => (
          <p
            key={i}
            className={
              m.tone === "ok"
                ? "rounded-md bg-green-50 px-3 py-2 text-green-800"
                : "rounded-md bg-red-50 px-3 py-2 text-red-800"
            }
          >
            {m.text}
          </p>
        ))}
      </div>

      <label className="block">
        Document
        <select
          value={docId}
          onChange={(e) => setDocId(e.target.value)}
          className="mt-1 h-11 w-full rounded-md border border-input bg-background px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {docs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
              {uploadedIds.includes(d.id)
                ? " (uploaded)"
                : d.status === "received" || d.status === "verified"
                  ? " (already received)"
                  : ""}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        File (PDF, JPG, PNG, WEBP or HEIC — max 15 MB)
        <input
          type="file"
          name="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,application/pdf,image/jpeg,image/png,image/webp,image/heic"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="mt-1 block w-full rounded-md border border-input bg-background py-2 text-sm file:mr-3 file:min-h-11 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          required
        />
      </label>

      <label className="flex items-start gap-3 rounded-md bg-muted/60 p-3">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          required
        />
        <span>{purposeText}</span>
      </label>

      <button
        type="submit"
        disabled={busy || !consent || !file}
        className="h-11 w-full rounded-md bg-primary font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        {busy ? "Uploading…" : uploadedIds.length > 0 ? "Upload another document" : "Upload document"}
      </button>

      <p className="text-center text-xs text-muted-foreground">
        You can upload more than one file for a document, and upload as many documents as you need.
        Close this page when you&apos;re done.
      </p>
    </form>
  );
}
