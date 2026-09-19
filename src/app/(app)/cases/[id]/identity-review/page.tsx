import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { saveIdentityReviewAction } from "@/app/actions/identity-review";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { createClient as createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Identity review" };

const MATCH_OPTS = ["not_checked", "match", "mismatch", "na"];

export default async function IdentityReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const { error, saved } = await searchParams;

  const supabase = await createServerClient();
  const [{ data: review }, { data: completeness }] = await Promise.all([
    supabase.from("identity_reviews").select("*").eq("case_id", id).maybeSingle(),
    supabase
      .from("identity_reviews_completeness")
      .select("is_complete, has_issues")
      .eq("case_id", id)
      .maybeSingle(),
  ]);

  if (!review) {
    return (
      <p className="text-sm text-muted-foreground">
        Identity review exists only for IEPF cases.
      </p>
    );
  }

  async function save(formData: FormData) {
    "use server";
    const s = (k: string) => String(formData.get(k) ?? "");
    const res = await saveIdentityReviewAction({
      case_id: id,
      pan_name_match: s("pan_name_match"),
      cml_name_match: s("cml_name_match"),
      certificate_name_match: s("certificate_name_match"),
      bank_name_match: s("bank_name_match"),
      address_mismatch: s("address_mismatch"),
      signature_mismatch_risk: s("signature_mismatch_risk"),
      same_person_affidavit_needed: formData.get("same_person_affidavit_needed") === "on",
      change_of_address_affidavit_needed:
        formData.get("change_of_address_affidavit_needed") === "on",
      notes: s("notes") || undefined,
    });
    redirect(
      res.ok
        ? `/cases/${id}/identity-review?saved=1${
            res.addedChecklistItems?.length
              ? `&error=${encodeURIComponent(
                  "Added to checklist: " + res.addedChecklistItems.join(", ")
                )}`
              : ""
          }`
        : `/cases/${id}/identity-review?error=${encodeURIComponent(res.error ?? "")}`
    );
  }

  const matchSelect = (name: string, label: string, value: string) => (
    <label className="block text-sm">
      {label}
      <select
        name={name}
        defaultValue={value}
        className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2"
      >
        {MATCH_OPTS.map((o) => (
          <option key={o} value={o}>
            {o.replaceAll("_", " ")}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center gap-2">
        {completeness?.is_complete ? (
          <Badge variant="success">Review complete</Badge>
        ) : (
          <Badge variant="warning">Incomplete — blocks IEPF-5 preparation</Badge>
        )}
        {completeness?.has_issues && <Badge variant="destructive">Mismatches found</Badge>}
      </div>
      {saved && (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">Review saved.</p>
      )}
      {error && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">
          {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Identity / mismatch checks</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={save} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {matchSelect("pan_name_match", "PAN name match", review.pan_name_match)}
              {matchSelect("cml_name_match", "Demat CML name match", review.cml_name_match)}
              {matchSelect(
                "certificate_name_match",
                "Share certificate / folio name match",
                review.certificate_name_match
              )}
              {matchSelect("bank_name_match", "Bank name match", review.bank_name_match)}
              <label className="block text-sm">
                Address mismatch
                <select
                  name="address_mismatch"
                  defaultValue={review.address_mismatch}
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2"
                >
                  {["not_checked", "no", "yes"].map((o) => (
                    <option key={o} value={o}>
                      {o.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                Signature mismatch risk
                <select
                  name="signature_mismatch_risk"
                  defaultValue={review.signature_mismatch_risk}
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2"
                >
                  {["unknown", "low", "medium", "high"].map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="space-y-2 rounded-md bg-muted/50 p-3 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="same_person_affidavit_needed"
                  defaultChecked={review.same_person_affidavit_needed}
                />
                Same-person affidavit needed (adds checklist item)
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="change_of_address_affidavit_needed"
                  defaultChecked={review.change_of_address_affidavit_needed}
                />
                Change-of-address affidavit needed (adds checklist item)
              </label>
            </div>

            <label className="block text-sm">
              Internal notes
              <textarea
                name="notes"
                defaultValue={review.notes ?? ""}
                rows={3}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"
              />
            </label>

            <button className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
              Save review (audited)
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
