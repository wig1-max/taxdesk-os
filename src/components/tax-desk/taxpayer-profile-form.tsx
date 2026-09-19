"use client";

import { useState } from "react";
import { saveTaxpayerProfileAction } from "@/app/actions/tax-profile";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useReconciledAction } from "@/components/ui/use-reconciled-action";
import { UnconfirmedNotice } from "@/components/ui/reconcile-unconfirmed";
import {
  RESIDENTIAL_STATUSES,
  SPECIAL_SITUATIONS,
  TAXPAYER_CATEGORIES,
  type SpecialSituationCode,
} from "@/lib/tax-desk/eligibility";

const RESIDENTIAL_LABELS: Record<string, string> = {
  resident: "Resident",
  non_resident: "Non-resident (NRI)",
  not_ordinarily_resident: "Resident but not ordinarily resident (RNOR)",
};
const CATEGORY_LABELS: Record<string, string> = {
  individual: "Individual",
  huf: "Hindu Undivided Family (HUF)",
};

export interface TaxpayerProfileInitial {
  dateOfBirth: string | null;
  residentialStatus: string | null;
  taxpayerCategory: string | null;
  declaredSpecialSituations: SpecialSituationCode[];
}

/**
 * Taxpayer Profile form (K.2.8.9A; reconciled in K.2.9.2). Captures the minimum
 * structured data the eligibility evaluator needs. Native, keyboard-accessible
 * controls with labels and inline validation. Read-only when finalized.
 *
 * Reconciliation: the save runs through {@link useReconciledAction} keyed on
 * `dataVersion` (the profile's `taxpayer_profile_updated_at`, which the RPC bumps
 * on every save, plus the field values), so "Profile saved ✓" — and thus the
 * cue that eligibility was re-evaluated — fires ONLY after the fresh profile /
 * eligibility props land, never before.
 */
export function TaxpayerProfileForm({
  taxCaseId,
  initial,
  dataVersion,
  disabled = false,
}: {
  taxCaseId: string;
  initial: TaxpayerProfileInitial;
  /** Fingerprint of the persisted profile (updated-at + values); flips on save. */
  dataVersion: string;
  disabled?: boolean;
}) {
  const toast = useToast();
  const { run, busy, error, unconfirmed, reload, clearError } = useReconciledAction({ dataVersion });
  const [dob, setDob] = useState(initial.dateOfBirth ?? "");
  const [residential, setResidential] = useState(initial.residentialStatus ?? "");
  const [category, setCategory] = useState(initial.taxpayerCategory ?? "");
  const [situations, setSituations] = useState<Set<string>>(
    new Set(initial.declaredSpecialSituations),
  );

  function toggleSituation(code: string, on: boolean) {
    setSituations((prev) => {
      const next = new Set(prev);
      if (on) next.add(code);
      else next.delete(code);
      return next;
    });
  }

  function save() {
    clearError();
    run(
      () =>
        saveTaxpayerProfileAction({
          taxCaseId,
          dateOfBirth: dob || undefined,
          residentialStatus: residential || undefined,
          taxpayerCategory: category || undefined,
          declaredSpecialSituations: [...situations],
        }),
      () => toast.success("Profile saved ✓", "Eligibility has been re-evaluated."),
    );
  }

  const field = "h-10 w-full rounded-md border bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <form
      data-testid="taxpayer-profile-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!disabled) save();
      }}
      className="space-y-5"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="tp-dob" className="block text-sm font-medium">
            Date of birth
          </label>
          <input
            id="tp-dob"
            name="dateOfBirth"
            type="date"
            value={dob}
            disabled={disabled}
            onChange={(e) => setDob(e.target.value)}
            aria-describedby="tp-dob-help"
            className={field}
          />
          <p id="tp-dob-help" className="text-xs text-muted-foreground">
            Required for tax treatment. Shared with the client record.
          </p>
        </div>

        <div className="space-y-1">
          <label htmlFor="tp-residential" className="block text-sm font-medium">
            Residential status
          </label>
          <select
            id="tp-residential"
            name="residentialStatus"
            value={residential}
            disabled={disabled}
            onChange={(e) => setResidential(e.target.value)}
            aria-describedby="tp-residential-help"
            className={field}
          >
            <option value="">Select…</option>
            {RESIDENTIAL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {RESIDENTIAL_LABELS[s]}
              </option>
            ))}
          </select>
          <p id="tp-residential-help" className="text-xs text-muted-foreground">
            The current engine supports resident individuals only.
          </p>
        </div>

        <div className="space-y-1">
          <label htmlFor="tp-category" className="block text-sm font-medium">
            Taxpayer category
          </label>
          <select
            id="tp-category"
            name="taxpayerCategory"
            value={category}
            disabled={disabled}
            onChange={(e) => setCategory(e.target.value)}
            className={field}
          >
            <option value="">Select…</option>
            {TAXPAYER_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset className="space-y-2" disabled={disabled}>
        <legend className="text-sm font-medium">Declared situations (route to manual professional preparation)</legend>
        <p className="text-xs text-muted-foreground">
          Tick anything this case involves. The current engine does not reliably compute these, so any
          selection blocks automatic computation and flags the case for a professional.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {SPECIAL_SITUATIONS.map((s) => (
            <label
              key={s.code}
              className="flex items-start gap-2 rounded-md border p-2 text-sm has-[:checked]:border-warning has-[:checked]:bg-warning-soft"
            >
              <input
                type="checkbox"
                name="declaredSpecialSituations"
                value={s.code}
                checked={situations.has(s.code)}
                disabled={disabled}
                onChange={(e) => toggleSituation(s.code, e.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              <span className="capitalize">{s.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      {unconfirmed && (
        <UnconfirmedNotice onReload={reload} testId="profile-unconfirmed">
          The profile was saved, but the page couldn&apos;t confirm eligibility was re-evaluated. Reload to verify.
        </UnconfirmedNotice>
      )}

      {!disabled && (
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy} className="h-9 px-4 text-sm">
            {busy ? "Saving…" : "Save profile"}
          </Button>
          <span className="text-xs text-muted-foreground">Saving re-evaluates eligibility immediately.</span>
        </div>
      )}
    </form>
  );
}
