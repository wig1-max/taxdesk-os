"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { createCaseAction } from "@/app/actions/cases";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { taxPrepCaseCreateSchema } from "@/lib/validation/tax-case";
import { periodKindForLaw, storedTaxPackKeyForLaw } from "@/lib/tax-pack";

type TaxCaseActionResult = {
  ok: boolean;
  taxCaseId?: string;
  /** Set when the block is a pre-existing tax case for this client + AY. */
  existingTaxCaseId?: string;
  error?: string;
};

/**
 * Create a Tax Desk ITR Prep case (K.2.2).
 *
 * Architecture: reuses the normal ITR case-creation path (createCaseAction)
 * so the parent `cases` row, checklist, status history and case.created audit
 * are IDENTICAL to a case made from /cases/new — then links a 1:1 tax_cases
 * child. Nothing about /cases behavior changes.
 *
 * Duplicate policy: case_id uniqueness is enforced by the DB (K.2.1). We also
 * block a second tax_case for the same (client_id, assessment_year) here, at
 * the application level, so revised/belated/reworked returns stay POSSIBLE in
 * future phases without a hard-to-reverse unique index.
 */
export async function createTaxPrepCaseAction(input: unknown): Promise<TaxCaseActionResult> {
  const user = await requireUser();

  const parsed = taxPrepCaseCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;

  const supabase = await createServerClient();

  // Client must exist and not be soft-deleted.
  const { data: client } = await supabase
    .from("clients")
    .select("id")
    .eq("id", d.client_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!client) return { ok: false, error: "Selected client was not found." };

  // ITR service must exist and be active (reuse the existing service).
  const { data: itrService } = await supabase
    .from("services")
    .select("id")
    .eq("code", "itr")
    .eq("is_active", true)
    .maybeSingle();
  if (!itrService) return { ok: false, error: "The ITR service is not available." };

  // Optional assignee / reviewer must be active users when provided.
  for (const [field, id] of [
    ["Assigned staff", d.assigned_staff_id],
    ["Reviewer", d.reviewer_id],
  ] as const) {
    if (!id) continue;
    const { data: u } = await supabase
      .from("users")
      .select("id")
      .eq("id", id)
      .eq("is_active", true)
      .is("deleted_at", null)
      .maybeSingle();
    if (!u) return { ok: false, error: `${field} is not a valid active user.` };
  }

  // Application-level duplicate guard: one ITR prep case per client + world + period.
  // A client may have both an ITA_1961 and an ITA_2025 case for 2026-27 — they
  // are different statutory worlds, not duplicates.
  const { data: dup } = await supabase
    .from("tax_cases")
    .select("id")
    .eq("client_id", d.client_id)
    .eq("assessment_year", d.assessment_year)
    .eq("law", d.law)
    .limit(1)
    .maybeSingle();
  if (dup) {
    const world = d.law === "ITA_2025" ? "tax year" : "AY";
    return {
      ok: false,
      existingTaxCaseId: dup.id,
      error: `An ITR prep case for ${world} ${d.assessment_year} (${d.law}) already exists for this client. Open the existing case instead of creating a duplicate.`,
    };
  }

  // Create the parent ITR case via the normal path (checklist + audit + history).
  const parent = await createCaseAction({
    client_id: d.client_id,
    service_code: "itr",
    title: d.title,
    owner_id: d.assigned_staff_id ?? user.id,
    priority: "normal",
    service_data: {
      ay: d.assessment_year,
      regime: "undecided",
      // Scope notes ride on the parent case; already screened for
      // credentials/PAN/Aadhaar by taxPrepCaseCreateSchema.
      computation_notes: d.notes,
    },
  });
  if (!parent.ok || !parent.caseId) {
    return { ok: false, error: parent.error ?? "Could not create the parent case." };
  }

  // Link the 1:1 tax_cases child.
  const { data: taxCase, error } = await supabase
    .from("tax_cases")
    .insert({
      case_id: parent.caseId,
      client_id: d.client_id,
      assessment_year: d.assessment_year,
      financial_year: d.financial_year,
      law: d.law,
      period_kind: periodKindForLaw(d.law),
      tax_pack_key: storedTaxPackKeyForLaw(d.law),
      itr_type_selected: d.itr_type_selected ?? null,
      assigned_staff_id: d.assigned_staff_id ?? null,
      reviewer_id: d.reviewer_id ?? null,
    })
    .select("id")
    .single();

  if (error || !taxCase) {
    // The parent case exists as a normal ITR case; do not orphan silently.
    console.error("[tax-cases] tax_cases insert failed:", error?.message);
    return {
      ok: false,
      error:
        "The parent case was created but the tax link failed. Find it under Cases and retry, or contact an admin.",
    };
  }

  await audit({
    actor: user,
    action: "tax_case.created",
    entityType: "tax_cases",
    entityId: taxCase.id,
    caseId: parent.caseId,
    after: {
      case_id: parent.caseId,
      assessment_year: d.assessment_year,
      financial_year: d.financial_year,
      law: d.law,
      period_kind: periodKindForLaw(d.law),
      tax_pack_key: storedTaxPackKeyForLaw(d.law),
      itr_type_selected: d.itr_type_selected ?? null,
      assigned_staff_id: d.assigned_staff_id ?? null,
      reviewer_id: d.reviewer_id ?? null,
    },
  });

  revalidatePath("/tax-desk");
  revalidatePath("/tax-desk/cases");
  return { ok: true, taxCaseId: taxCase.id };
}
