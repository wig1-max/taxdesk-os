import { z } from "zod";
import { dateStringSchema, inrAmountSchema } from "./common";

/** Per-service service_data payloads (cases.service_data JSONB). */

const itrServiceDataSchema = z.object({
  ay: z.string().regex(/^20\d{2}-\d{2}$/, "AY like 2026-27"),
  regime: z.enum(["old", "new", "undecided"]).default("undecided"),
  return_type_notes: z.string().trim().max(500).optional(),
  computation_notes: z.string().trim().max(2000).optional(),
});

const iepfServiceDataSchema = z.object({
  company: z.string().trim().min(1, "Company name required").max(200),
  folio: z.string().trim().max(60).optional(),
  shares: z.coerce.number().int().nonnegative().optional(),
  estimated_claim_value: inrAmountSchema.optional(),
  expected_closure_month: dateStringSchema.optional(),
  confidence: z.enum(["low", "medium", "high"]).default("medium"),
  srn: z.string().trim().max(60).optional(),
  rta_contact_notes: z.string().trim().max(1000).optional(),
});

const leadServiceDataSchema = z.object({
  need_category: z.string().trim().max(120).optional(),
  partner_platform: z.string().trim().max(120).optional(),
  kyc_status: z.enum(["pending", "partial", "done"]).default("pending"),
  internal_notes: z.string().trim().max(2000).optional(),
  followup_date: dateStringSchema.optional(),
});

const genericServiceDataSchema = z.object({
  scope_notes: z.string().trim().max(2000).optional(),
});

const LEAD_SERVICES = new Set(["mutual_fund", "insurance", "loan_dsa"]);

export function validateServiceData(
  serviceCode: string,
  data: unknown
): { success: true; data: Record<string, unknown> } | { success: false; error: string } {
  const schema =
    serviceCode === "itr"
      ? itrServiceDataSchema
      : serviceCode === "iepf"
        ? iepfServiceDataSchema
        : LEAD_SERVICES.has(serviceCode)
          ? leadServiceDataSchema
          : genericServiceDataSchema;
  const parsed = schema.safeParse(data ?? {});
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid service details.",
    };
  }
  return { success: true, data: parsed.data as Record<string, unknown> };
}
