import { z } from "zod";
import { SERVICE_CODES } from "@/lib/constants";
import { dateStringSchema, nonEmptyTrimmed, uuidSchema } from "./common";

export const caseCreateSchema = z.object({
  client_id: uuidSchema,
  service_code: z.enum(SERVICE_CODES),
  title: z.string().trim().max(160).optional(),
  owner_id: uuidSchema,
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  lead_source: z
    .enum(["walk_in", "referral", "existing", "campaign", "other"])
    .optional(),
  /** Service-specific payload; refined per service in Phase D. */
  service_data: z.record(z.string(), z.unknown()).default({}),
});

export type CaseCreateInput = z.infer<typeof caseCreateSchema>;

export const followupSchema = z.object({
  case_id: uuidSchema,
  due_date: dateStringSchema,
  note: nonEmptyTrimmed("Note", 500),
  assigned_to: uuidSchema.optional(),
});

export type FollowupInput = z.infer<typeof followupSchema>;
