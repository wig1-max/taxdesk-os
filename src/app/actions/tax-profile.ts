"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createClient as createServerClient } from "@/lib/supabase/server";
import {
  RESIDENTIAL_STATUSES,
  SPECIAL_SITUATIONS,
  TAXPAYER_CATEGORIES,
} from "@/lib/tax-desk/eligibility";
import { assertTaxCaseMutable } from "@/lib/tax-desk-server/finalization";

/**
 * Taxpayer Profile capture (K.2.8.9A). STAFF/ADMIN. The minimum structured data
 * the eligibility evaluator needs: date of birth (reused from clients), the
 * residential status, the taxpayer category, and any declared unsupported
 * situations. Written through the guarded save_taxpayer_profile RPC — direct
 * authenticated writes to the profile columns are revoked, so the profile can
 * only change through this atomic, audited, actor-attributed path.
 */

type ActionResult = { ok: boolean; error?: string };

const SITUATION_CODES = SPECIAL_SITUATIONS.map((s) => s.code) as [string, ...string[]];

const schema = z.object({
  taxCaseId: z.string().uuid(),
  // A blank DOB is allowed as input (it just leaves the case ineligible); the
  // gate — not the form — is the source of "you must add a DOB".
  dateOfBirth: z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date of birth.").optional(),
  ),
  residentialStatus: z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z.enum(RESIDENTIAL_STATUSES).optional(),
  ),
  taxpayerCategory: z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z.enum(TAXPAYER_CATEGORIES).optional(),
  ),
  declaredSpecialSituations: z.array(z.enum(SITUATION_CODES)).default([]),
});

/** Save the taxpayer profile for a tax case. Blocked once finalized. */
export async function saveTaxpayerProfileAction(input: unknown): Promise<ActionResult> {
  await requireUser();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const supabase = await createServerClient();
  const mutable = await assertTaxCaseMutable(
    supabase,
    d.taxCaseId,
    "This tax case is finalized. The taxpayer profile is read-only.",
  );
  if (!mutable.ok) return { ok: false, error: mutable.error };

  const { error } = await supabase.rpc("save_taxpayer_profile", {
    p_tax_case_id: d.taxCaseId,
    p_date_of_birth: d.dateOfBirth ?? null,
    p_residential_status: d.residentialStatus ?? null,
    p_taxpayer_category: d.taxpayerCategory ?? null,
    p_declared_situations: [...new Set(d.declaredSpecialSituations)],
    p_event_id: crypto.randomUUID(),
  });
  if (error) {
    if (/finalized/i.test(error.message ?? "")) {
      return { ok: false, error: "This tax case is finalized. The taxpayer profile is read-only." };
    }
    return { ok: false, error: "Could not save the taxpayer profile." };
  }

  revalidatePath(`/tax-desk/cases/${d.taxCaseId}/profile`);
  revalidatePath(`/tax-desk/cases/${d.taxCaseId}`);
  revalidatePath(`/tax-desk/cases/${d.taxCaseId}/computation`);
  return { ok: true };
}
