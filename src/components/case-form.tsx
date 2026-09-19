"use client";

import { useRef, useState } from "react";
import { createCaseAction } from "@/app/actions/cases";
import { ClientSelector } from "@/components/client-selector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ServiceCode } from "@/lib/constants";

interface Option {
  id: string;
  label: string;
}

interface Props {
  /** First page of clients, shown before the user types anything. */
  clients: Option[];
  users: Option[];
  services: { code: string; name: string }[];
  currentUserId: string;
  /** Resolved from `?client=`, so a preselected client shows its real label. */
  presetClient?: Option;
}

const LEAD = new Set(["mutual_fund", "insurance", "loan_dsa"]);

export function CaseForm({ clients, users, services, currentUserId, presetClient }: Props) {
  const inFlight = useRef(false);
  const [service, setService] = useState<string>("itr");
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

    let service_data: Record<string, unknown> = {};
    if (service === "itr") {
      service_data = {
        ay: get("ay"),
        regime: get("regime") || "undecided",
        return_type_notes: get("return_type_notes") || undefined,
        computation_notes: get("computation_notes") || undefined,
      };
    } else if (service === "iepf") {
      service_data = {
        company: get("company"),
        folio: get("folio") || undefined,
        shares: get("shares") ? Number(get("shares")) : undefined,
        estimated_claim_value: get("estimated_claim_value")
          ? Number(get("estimated_claim_value"))
          : undefined,
        expected_closure_month: get("expected_closure_month")
          ? `${get("expected_closure_month")}-01`
          : undefined,
        confidence: get("confidence") || "medium",
        srn: get("srn") || undefined,
        rta_contact_notes: get("rta_contact_notes") || undefined,
      };
    } else if (LEAD.has(service)) {
      service_data = {
        need_category: get("need_category") || undefined,
        partner_platform: get("partner_platform") || undefined,
        kyc_status: get("lead_kyc_status") || "pending",
        internal_notes: get("internal_notes") || undefined,
        followup_date: get("followup_date") || undefined,
      };
    } else {
      service_data = { scope_notes: get("scope_notes") || undefined };
    }

    const res = await createCaseAction({
      client_id: get("client_id"),
      service_code: service as ServiceCode,
      title: get("title") || undefined,
      owner_id: get("owner_id"),
      priority: (get("priority") || "normal") as "low" | "normal" | "high",
      lead_source: (get("lead_source") || undefined) as never,
      service_data,
    });
    if (res.ok && res.caseId) {
      // Deterministic navigation on success. A soft `router.push` here was
      // being swallowed by the create action's `revalidatePath("/cases")`
      // re-render, so a successful create left the button stuck at "Creating…"
      // and never left /cases/new (observed live on the admin deferred IEPF
      // path). A hard navigation cannot be swallowed and matches the
      // confirmed-working direct case URL. Keep inFlight/busy true — this page
      // is unloading, so the form can't be resubmitted and can't duplicate.
      window.location.assign(`/cases/${res.caseId}`);
      return;
    }
    inFlight.current = false;
    setBusy(false);
    setError(res.error ?? "Could not create case.");
  }

  const select = (name: string, label: string, options: React.ReactNode, defaultValue?: string) => (
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
        {/* K3-ENV-4: searchable, server-backed. The old `<select>` rendered only
            the first 500 clients by name, so anything past that window was
            unreachable with no indication it had been omitted. */}
        <ClientSelector initialOptions={clients} presetClient={presetClient} />

        <div className="space-y-1">
          <Label htmlFor="service">Service *</Label>
          <select
            id="service"
            value={service}
            onChange={(e) => setService(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {services.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="title">Title</Label>
          <Input id="title" name="title" placeholder="Optional — defaults to service name" />
        </div>
        {select(
          "owner_id",
          "Owner *",
          users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
            </option>
          )),
          currentUserId
        )}
        {select(
          "priority",
          "Priority",
          ["low", "normal", "high"].map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          )),
          "normal"
        )}
        {select(
          "lead_source",
          "Lead source",
          [
            <option key="" value="">
              —
            </option>,
            ...["walk_in", "referral", "existing", "campaign", "other"].map((s) => (
              <option key={s} value={s}>
                {s.replaceAll("_", " ")}
              </option>
            )),
          ]
        )}
      </div>

      <fieldset className="space-y-4 rounded-md border p-4">
        <legend className="px-1 text-sm font-medium">Service details</legend>

        {service === "itr" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ay">Assessment year *</Label>
              <Input id="ay" name="ay" placeholder="2026-27" required />
            </div>
            {select(
              "regime",
              "Regime preference",
              ["undecided", "new", "old"].map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))
            )}
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="return_type_notes">Return type notes</Label>
              <Input id="return_type_notes" name="return_type_notes" />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="computation_notes">Computation notes</Label>
              <Input id="computation_notes" name="computation_notes" />
            </div>
          </div>
        )}

        {service === "iepf" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="company">Company name *</Label>
              <Input id="company" name="company" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="folio">Folio number</Label>
              <Input id="folio" name="folio" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="shares">Shares/units</Label>
              <Input id="shares" name="shares" type="number" min="0" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="estimated_claim_value">Estimated claim value (Rs.)</Label>
              <Input id="estimated_claim_value" name="estimated_claim_value" type="number" min="0" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="expected_closure_month">Expected closure month</Label>
              <Input id="expected_closure_month" name="expected_closure_month" type="month" />
            </div>
            {select(
              "confidence",
              "Confidence",
              ["low", "medium", "high"].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              )),
              "medium"
            )}
            <div className="space-y-1">
              <Label htmlFor="srn">SRN (if already filed)</Label>
              <Input id="srn" name="srn" />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="rta_contact_notes">RTA/company contact notes</Label>
              <Input id="rta_contact_notes" name="rta_contact_notes" />
            </div>
          </div>
        )}

        {LEAD.has(service) && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="need_category">Need category</Label>
              <Input id="need_category" name="need_category" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="partner_platform">Partner/platform</Label>
              <Input id="partner_platform" name="partner_platform" />
            </div>
            {select(
              "lead_kyc_status",
              "KYC status",
              ["pending", "partial", "done"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))
            )}
            <div className="space-y-1">
              <Label htmlFor="followup_date">Follow-up date</Label>
              <Input id="followup_date" name="followup_date" type="date" />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="internal_notes">Internal notes (never sent to client)</Label>
              <Input id="internal_notes" name="internal_notes" />
            </div>
            <p className="text-xs text-amber-700 sm:col-span-2">
              Distribution/lead handling only — no scheme recommendations, no returns talk.
            </p>
          </div>
        )}

        {!["itr", "iepf"].includes(service) && !LEAD.has(service) && (
          <div className="space-y-1">
            <Label htmlFor="scope_notes">Scope notes</Label>
            <Input id="scope_notes" name="scope_notes" />
          </div>
        )}
      </fieldset>

      <Button type="submit" disabled={busy}>
        {busy ? "Creating…" : "Create case"}
      </Button>
    </form>
  );
}
