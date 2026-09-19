"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { paymentSchema } from "@/lib/validation";
import { dateStringSchema, inrAmountSchema, uuidSchema } from "@/lib/validation/common";

type ActionResult = { ok: boolean; error?: string };

const feeCreateSchema = z
  .object({
    case_id: uuidSchema,
    fee_type: z.enum(["fixed", "percent_of_recovery"]),
    description: z.string().trim().max(200).optional(),
    fixed_amount: inrAmountSchema.optional(),
    percent: z.coerce.number().min(0).max(100).optional(),
    estimated_claim_value: inrAmountSchema.optional(),
    upfront_amount: inrAmountSchema.default(0),
    confidence: z.enum(["low", "medium", "high"]).default("medium"),
    expected_closure_month: dateStringSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.fee_type === "fixed" && v.fixed_amount === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fixed_amount"], message: "Amount required for fixed fee." });
    }
    if (v.fee_type === "percent_of_recovery" && v.percent === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["percent"], message: "Percent required." });
    }
  });

export async function createFeeAction(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = feeCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("fees")
    .insert({
      case_id: d.case_id,
      fee_type: d.fee_type,
      description: d.description || null,
      fixed_amount: d.fee_type === "fixed" ? d.fixed_amount : null,
      percent: d.fee_type === "percent_of_recovery" ? d.percent : null,
      estimated_claim_value: d.estimated_claim_value ?? null,
      upfront_amount: d.upfront_amount,
      confidence: d.confidence,
      expected_closure_month: d.expected_closure_month ?? null,
      status: "draft",
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: "Could not create fee." };

  await audit({
    actor: user,
    action: "fee.created",
    entityType: "fees",
    entityId: data.id,
    caseId: d.case_id,
    after: d,
  });
  revalidatePath(`/cases/${d.case_id}/fees`);
  return { ok: true };
}

/** Staff-editable value fields (no percent change, no override). */
const feeValuesSchema = z.object({
  estimated_claim_value: inrAmountSchema.optional(),
  actual_recovered_value: inrAmountSchema.optional(),
  confidence: z.enum(["low", "medium", "high"]).optional(),
  expected_closure_month: dateStringSchema.optional().or(z.literal("")),
  status: z.enum(["draft", "agreed", "partially_paid", "paid", "waived"]).optional(),
});

export async function updateFeeValuesAction(feeId: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = feeValuesSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const supabase = await createServerClient();
  const { data: before } = await supabase
    .from("fees")
    .select("id, case_id, estimated_claim_value, actual_recovered_value, confidence, expected_closure_month, status")
    .eq("id", feeId)
    .maybeSingle();
  if (!before) return { ok: false, error: "Fee not found." };

  const d = parsed.data;
  const patch: Record<string, unknown> = {};
  if (d.estimated_claim_value !== undefined) patch.estimated_claim_value = d.estimated_claim_value;
  if (d.actual_recovered_value !== undefined) patch.actual_recovered_value = d.actual_recovered_value;
  if (d.confidence !== undefined) patch.confidence = d.confidence;
  if (d.expected_closure_month !== undefined)
    patch.expected_closure_month = d.expected_closure_month || null;
  if (d.status !== undefined) patch.status = d.status;

  const { error } = await supabase.from("fees").update(patch).eq("id", feeId);
  if (error) return { ok: false, error: "Update failed." };

  await audit({
    actor: user,
    action: "fee.values_updated",
    entityType: "fees",
    entityId: feeId,
    caseId: before.case_id,
    before,
    after: patch,
  });
  revalidatePath(`/cases/${before.case_id}/fees`);
  return { ok: true };
}

/** Admin-only: manual override of the computed total. Reason mandatory. */
export async function overrideFeeAction(
  feeId: string,
  overrideTotal: number | null,
  reason: string
): Promise<ActionResult> {
  const user = await requireAdmin();
  if (!reason.trim()) return { ok: false, error: "A reason is required for any fee override." };
  if (overrideTotal !== null && (Number.isNaN(overrideTotal) || overrideTotal < 0)) {
    return { ok: false, error: "Invalid override amount." };
  }

  const supabase = await createServerClient();
  const { data: before } = await supabase
    .from("fees")
    .select("id, case_id, computed_total, override_total, override_reason")
    .eq("id", feeId)
    .maybeSingle();
  if (!before) return { ok: false, error: "Fee not found." };

  const { error } = await supabase
    .from("fees")
    .update({ override_total: overrideTotal, override_reason: reason.trim() })
    .eq("id", feeId);
  if (error) return { ok: false, error: "Override failed." };

  await audit({
    actor: user,
    action: "fee.override",
    entityType: "fees",
    entityId: feeId,
    caseId: before.case_id,
    before: { computed_total: before.computed_total, override_total: before.override_total },
    after: { override_total: overrideTotal, reason: reason.trim() },
  });
  revalidatePath(`/cases/${before.case_id}/fees`);
  return { ok: true };
}

/** Append-only ledger entry. Corrections = reversing entries. */
export async function recordPaymentAction(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("payments")
    .insert({
      fee_id: d.fee_id,
      case_id: d.case_id,
      amount: d.amount,
      direction: d.direction,
      method: d.method,
      reference: d.reference || null,
      paid_on: d.paid_on,
      recorded_by: user.id,
      notes: d.notes || null,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: "Could not record payment." };

  await audit({
    actor: user,
    action: "payment.recorded",
    entityType: "payments",
    entityId: data.id,
    caseId: d.case_id,
    after: { amount: d.amount, direction: d.direction, method: d.method, paid_on: d.paid_on },
  });
  revalidatePath(`/cases/${d.case_id}/fees`);
  return { ok: true };
}
