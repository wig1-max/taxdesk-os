"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { logCopiedMessageAction } from "@/app/actions/messages";
import { Button } from "@/components/ui/button";
import { renderTemplate } from "@/lib/messages/render";

interface TemplateRow {
  id: string;
  code: string;
  name: string;
  body: string;
  service_code: string | null;
}

/**
 * Renders templates to PLAIN TEXT only (textarea — nothing is ever
 * interpreted as HTML). Unresolved {{variables}} are highlighted and
 * must be filled (or accepted) before copying.
 */
export function MessageComposer({
  caseId,
  serviceCode,
  templates,
  variables,
}: {
  caseId: string;
  serviceCode: string;
  templates: TemplateRow[];
  variables: Record<string, string>;
}) {
  const ordered = useMemo(() => {
    const svc = templates.filter((t) => t.service_code === serviceCode);
    const generic = templates.filter((t) => t.service_code === null);
    const other = templates.filter((t) => t.service_code && t.service_code !== serviceCode);
    return [...svc, ...generic, ...other];
  }, [templates, serviceCode]);

  const router = useRouter();
  const [, startRefresh] = useTransition();
  const [templateId, setTemplateId] = useState<string>(ordered[0]?.id ?? "");
  const [extraVars, setExtraVars] = useState<Record<string, string>>({});
  const [text, setText] = useState<string>("");
  const [edited, setEdited] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const template = ordered.find((t) => t.id === templateId);
  const rendered = useMemo(() => {
    const mergedVars = { ...variables, ...extraVars };
    return template ? renderTemplate(template.body, mergedVars) : { text: "", unresolved: [] };
  }, [template, variables, extraVars]);
  const displayText = edited ? text : rendered.text;
  const unresolved = edited ? [] : rendered.unresolved;

  async function copyAndLog() {
    const body = displayText.trim();
    if (!body) return;
    try {
      await navigator.clipboard.writeText(body);
    } catch {
      setStatus("Clipboard blocked by browser — select and copy manually, then press Log.");
    }
    const res = await logCopiedMessageAction({
      caseId,
      templateId: template?.id ?? null,
      renderedBody: body,
    });
    setStatus(res.ok ? "Copied to clipboard and logged." : res.error ?? "Logging failed.");
    // Re-fetch the server-rendered history so the new entry appears
    // immediately (no manual reload). revalidatePath runs server-side too.
    if (res.ok) startRefresh(() => router.refresh());
  }

  return (
    <div className="space-y-3 text-sm">
      <label className="block">
        Template
        <select
          value={templateId}
          onChange={(e) => {
            setTemplateId(e.target.value);
            setEdited(false);
            setStatus(null);
          }}
          className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2"
        >
          {ordered.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.service_code ? ` (${t.service_code})` : " (generic)"}
            </option>
          ))}
        </select>
      </label>

      {unresolved.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
          <p className="mb-2 font-medium text-amber-900">
            Unresolved variables — fill them in before sending:
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {unresolved.map((name) => (
              <label key={name} className="block text-xs">
                <span className="font-mono text-amber-800">{`{{${name}}}`}</span>
                <input
                  value={extraVars[name] ?? ""}
                  onChange={(e) =>
                    setExtraVars((prev) => ({ ...prev, [name]: e.target.value }))
                  }
                  className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2"
                />
              </label>
            ))}
          </div>
        </div>
      )}

      <label className="block">
        Message (plain text — edit freely)
        <textarea
          value={displayText}
          onChange={(e) => {
            setText(e.target.value);
            setEdited(true);
          }}
          rows={7}
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
        />
      </label>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={copyAndLog}
          disabled={!displayText.trim() || unresolved.length > 0}
        >
          Copy for WhatsApp &amp; log
        </Button>
        {edited && (
          <Button size="sm" variant="outline" onClick={() => setEdited(false)}>
            Reset to template
          </Button>
        )}
        {status && <span className="text-xs text-muted-foreground">{status}</span>}
      </div>
      <p className="text-xs text-muted-foreground">
        Nothing is sent automatically — paste into WhatsApp yourself. Every copy is logged and
        audited.
      </p>
    </div>
  );
}
