"use client";

import { useRef, useState } from "react";
import { createTaxPrepCaseAction } from "@/app/actions/tax-cases";
import { ClientSelector } from "@/components/client-selector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ITR_TYPES, SUPPORTED_TAX_LAWS } from "@/lib/validation/tax-case";

interface Option {
  id: string;
  label: string;
}

interface Props {
  clients: Option[];
  users: Option[];
  /** Resolved from `?client=`, so a preselected client shows its real label. */
  presetClient?: Option;
}

export function TaxCaseForm({ clients, users, presetClient }: Props) {
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (inFlight.current) return; // drop concurrent/duplicate submits
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? "").trim();

    const res = await createTaxPrepCaseAction({
      client_id: get("client_id"),
      title: get("title"),
      assessment_year: get("assessment_year"),
      financial_year: get("financial_year"),
      law: get("law"),
      itr_type_selected: get("itr_type_selected"),
      assigned_staff_id: get("assigned_staff_id"),
      reviewer_id: get("reviewer_id"),
      notes: get("notes"),
    });

    if (res.ok && res.taxCaseId) {
      // Hard navigation on success — cannot be swallowed by revalidatePath
      // re-render (same rationale as the normal case form). Keep busy true;
      // the page is unloading so the form can't resubmit or duplicate.
      window.location.assign(`/tax-desk/cases/${res.taxCaseId}`);
      return;
    }
    inFlight.current = false;
    setBusy(false);
    setError(res.error ?? "Could not create the ITR prep case.");
  }

  const select = (
    name: string,
    label: string,
    options: React.ReactNode,
    defaultValue?: string,
  ) => (
    <div className="space-y-1">
      <Label htmlFor={name}>{label}</Label>
      <select
        id={name}
        name={name}
        defaultValue={defaultValue}
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
      >
        {options}
      </select>
    </div>
  );

  return (
    <form onSubmit={onSubmit} className="max-w-2xl space-y-4">
      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {/* K3-ENV-4: searchable, server-backed — the old `<select>` showed only
            the first 500 clients by name, making the rest unselectable. */}
        <ClientSelector initialOptions={clients} presetClient={presetClient} />
        <div className="space-y-1">
          <Label htmlFor="title">Case title</Label>
          <Input id="title" name="title" placeholder="Optional — defaults to ITR Filing" />
        </div>
        {select(
          "law",
          "Statutory world *",
          SUPPORTED_TAX_LAWS.map((law) => (
            <option key={law} value={law}>
              {law === "ITA_2025"
                ? "Income-tax Act, 2025 (tax year) — no computation yet"
                : "Income-tax Act, 1961 (assessment year)"}
            </option>
          )),
          "ITA_1961",
        )}
        <div className="space-y-1">
          <Label htmlFor="assessment_year">Statutory period *</Label>
          <Input id="assessment_year" name="assessment_year" defaultValue="2026-27" readOnly />
        </div>
        <div className="space-y-1">
          <Label htmlFor="financial_year">Financial year *</Label>
          <Input id="financial_year" name="financial_year" defaultValue="2025-26" readOnly />
        </div>
        {select(
          "itr_type_selected",
          "ITR type (optional)",
          [
            <option key="" value="">
              — Not decided yet —
            </option>,
            ...ITR_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            )),
          ],
        )}
        {select(
          "assigned_staff_id",
          "Assigned staff (optional)",
          [
            <option key="" value="">
              — Unassigned —
            </option>,
            ...users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            )),
          ],
        )}
        {select(
          "reviewer_id",
          "Reviewer (optional)",
          [
            <option key="" value="">
              — No reviewer —
            </option>,
            ...users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            )),
          ],
        )}
      </div>

      <div className="space-y-1">
        <Label htmlFor="notes">Scope notes (optional)</Label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          placeholder="Internal scope notes. Never store portal passwords, OTPs, PAN or Aadhaar here."
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>

      <Button type="submit" disabled={busy}>
        {busy ? "Creating…" : "Create ITR prep case"}
      </Button>
    </form>
  );
}
