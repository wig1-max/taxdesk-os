"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { revealClientPanAction, setClientPanAction } from "@/app/actions/clients";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * PAN set + admin reveal. Reveal is audited server-side; to guarantee
 * ONE audit row per click we use a synchronous in-flight ref guard
 * (the `busy` state alone updates asynchronously, so a fast double-click
 * could fire the action — and the audit — twice before the button
 * disables). The ref flips synchronously, so the second call is dropped.
 */
export function PanActions({
  clientId,
  hasPan,
  isAdmin,
}: {
  clientId: string;
  hasPan: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [pan, setPan] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function submitPan() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMsg(null);
    try {
      const res = await setClientPanAction(clientId, pan);
      if (res.ok && res.panSaved) {
        setMsg({ tone: "ok", text: "PAN saved (stored encrypted)." });
        setPan("");
        router.refresh();
      } else {
        setMsg({ tone: "err", text: res.panError ?? res.error ?? "PAN could not be saved." });
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function reveal() {
    if (!reason.trim()) {
      setMsg({ tone: "err", text: "Enter a reason for the reveal (it is audited)." });
      return;
    }
    if (inFlight.current) return; // drop double-clicks: one click == one audit row
    inFlight.current = true;
    setBusy(true);
    setMsg(null);
    try {
      const res = await revealClientPanAction(clientId, reason);
      if (res.ok && res.pan) {
        setRevealed(res.pan);
        setReason("");
      } else {
        setMsg({ tone: "err", text: res.error ?? "Reveal failed." });
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
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

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          {hasPan ? "Replace PAN" : "Set PAN"}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={pan}
            onChange={(e) => setPan(e.target.value.toUpperCase())}
            placeholder="ABCDE1234F"
            autoComplete="off"
            className="w-40"
          />
          <Button type="button" size="sm" onClick={submitPan} disabled={busy || pan.length !== 10}>
            Save PAN
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Stored encrypted (AES-256-GCM). Only the masked last 4 digits are shown elsewhere.
        </p>
      </div>

      {isAdmin && (
        <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50/40 p-3">
          <p className="text-xs font-semibold text-amber-900">Reveal PAN (admin · audited)</p>
          <label htmlFor="pan-reveal-reason" className="block text-xs text-muted-foreground">
            Reason (required — recorded in the audit log)
          </label>
          <Input
            id="pan-reveal-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Verifying PAN before ITR filing"
            className="w-full max-w-md bg-white"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={reveal}
            disabled={busy || !hasPan}
          >
            {busy ? "Revealing…" : "Reveal once"}
          </Button>
          {revealed && (
            <div className="mt-2 rounded-md border border-amber-400 bg-amber-100 p-3">
              <p className="text-xs font-medium text-amber-900">
                Visible once — not stored on this page. Close when done.
              </p>
              <div className="mt-1 flex items-center gap-3">
                <span className="font-mono text-lg tracking-wide">{revealed}</span>
                <button
                  type="button"
                  className="text-xs underline"
                  onClick={() => setRevealed(null)}
                >
                  hide
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
