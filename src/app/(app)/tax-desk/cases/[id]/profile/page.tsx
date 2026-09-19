import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { UserCog } from "lucide-react";
import { Surface, SectionHeader } from "@/components/ui/section";
import { Callout } from "@/components/ui/alert";
import { EligibilityBanner } from "@/components/tax-desk/eligibility-banner";
import { TaxpayerProfileForm } from "@/components/tax-desk/taxpayer-profile-form";
import { fieldsVersion } from "@/components/ui/reconcile-core";
import { requireUser } from "@/lib/auth";
import { getTaxCaseEligibility } from "@/lib/queries/tax-eligibility";

export const metadata: Metadata = { title: "ITR Prep — Taxpayer Profile" };

export default async function TaxpayerProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const elig = await getTaxCaseEligibility(id);
  if (!elig) notFound();

  const base = `/tax-desk/cases/${id}`;
  const p = elig.profile;
  const profileComplete = !!p.dateOfBirth && !!p.residentialStatus && !!p.taxpayerCategory;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight">Taxpayer profile — {p.clientName}</h1>
        <p className="text-xs text-muted-foreground">
          AY {elig.assessmentYear} / FY {elig.financialYear} · drives computation eligibility
        </p>
      </div>

      <EligibilityBanner result={elig.result} profileHref={`${base}/profile`} />

      {elig.finalized && (
        <Callout tone="neutral" title="Finalized — read-only">
          The taxpayer profile is locked while the case is finalized. An admin can reopen the case to edit it.
        </Callout>
      )}

      <Surface className="p-4 sm:p-5">
        <SectionHeader
          title="Profile details"
          description={
            profileComplete
              ? "All mandatory profile fields are captured."
              : "Complete the mandatory fields to satisfy the eligibility gate."
          }
          icon={<UserCog className="h-4 w-4" />}
          actions={
            <span
              data-testid="profile-completeness"
              data-complete={profileComplete}
              className={
                profileComplete
                  ? "rounded-md bg-success-soft px-2 py-1 text-xs font-medium text-success"
                  : "rounded-md bg-warning-soft px-2 py-1 text-xs font-medium text-warning"
              }
            >
              {profileComplete ? "Profile complete" : "Profile incomplete"}
            </span>
          }
        />
        <div className="mt-4">
          <TaxpayerProfileForm
            taxCaseId={id}
            initial={{
              dateOfBirth: p.dateOfBirth,
              residentialStatus: p.residentialStatus,
              taxpayerCategory: p.taxpayerCategory,
              declaredSpecialSituations: p.declaredSpecialSituations,
            }}
            // Reconciliation signal (K.2.9.2): the RPC bumps taxpayer_profile_updated_at
            // on every save, so this flips even when the field values are unchanged.
            dataVersion={fieldsVersion([
              p.updatedAt,
              p.dateOfBirth,
              p.residentialStatus,
              p.taxpayerCategory,
              [...p.declaredSpecialSituations].sort().join(","),
            ])}
            disabled={elig.finalized}
          />
        </div>
      </Surface>
    </div>
  );
}
