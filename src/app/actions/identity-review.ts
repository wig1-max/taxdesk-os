"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { identityReviewSchema } from "@/lib/validation";

type ActionResult = { ok: boolean; error?: string; addedChecklistItems?: string[] };

export async function saveIdentityReviewAction(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = identityReviewSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;

  const supabase = await createServerClient();
  const { data: before } = await supabase
    .from("identity_reviews")
    .select("*")
    .eq("case_id", d.case_id)
    .maybeSingle();
  if (!before) return { ok: false, error: "No identity review exists for this case (IEPF only)." };

  const patch = {
    pan_name_match: d.pan_name_match,
    cml_name_match: d.cml_name_match,
    certificate_name_match: d.certificate_name_match,
    bank_name_match: d.bank_name_match,
    address_mismatch: d.address_mismatch,
    signature_mismatch_risk: d.signature_mismatch_risk,
    same_person_affidavit_needed: d.same_person_affidavit_needed,
    change_of_address_affidavit_needed: d.change_of_address_affidavit_needed,
    notes: d.notes || null,
    reviewed_by: user.id,
    reviewed_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("identity_reviews").update(patch).eq("case_id", d.case_id);
  if (error) return { ok: false, error: "Could not save identity review." };

  // Affidavit flags -> ensure matching checklist items exist.
  const added: string[] = [];
  const wanted: Array<{ flag: boolean; code: string; name: string }> = [
    {
      flag: d.same_person_affidavit_needed,
      code: "affidavit_same_person",
      name: "Same-person affidavit",
    },
    {
      flag: d.change_of_address_affidavit_needed,
      code: "affidavit_address",
      name: "Change-of-address affidavit",
    },
  ];
  for (const w of wanted.filter((w) => w.flag)) {
    const { data: existing } = await supabase
      .from("case_documents")
      .select("id, document_requirements!inner(code)")
      .eq("case_id", d.case_id)
      .eq("document_requirements.code", w.code)
      .limit(1);
    const { data: byName } = await supabase
      .from("case_documents")
      .select("id")
      .eq("case_id", d.case_id)
      .ilike("name", w.name)
      .limit(1);
    if ((existing?.length ?? 0) === 0 && (byName?.length ?? 0) === 0) {
      await supabase
        .from("case_documents")
        .insert({ case_id: d.case_id, name: w.name, is_required: true, requirement_id: null });
      added.push(w.name);
    } else if ((existing?.length ?? 0) > 0) {
      // mark the templated (optional) item as required now
      await supabase
        .from("case_documents")
        .update({ is_required: true })
        .eq("id", existing![0]!.id);
    }
  }

  await audit({
    actor: user,
    action: "identity_review.updated",
    entityType: "identity_reviews",
    entityId: before.id,
    caseId: d.case_id,
    before,
    after: patch,
  });
  revalidatePath(`/cases/${d.case_id}/identity-review`);
  revalidatePath(`/cases/${d.case_id}/documents`);
  return { ok: true, addedChecklistItems: added };
}
