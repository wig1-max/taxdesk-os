import { z } from "zod";
import { dateStringSchema, nonEmptyTrimmed, uuidSchema } from "./common";

/**
 * Physical document custody — original share certificates, signed affidavits,
 * indemnity bonds, etc. Separate from digital uploads: these are physical
 * objects the practice is responsible for until returned or dispatched.
 */
/** Mirrors the DB CHECK on physical_documents.custody_status. */
const custodyStatusEnum = z.enum([
  "expected",
  "in_custody",
  "dispatched",
  "returned_to_client",
  "lost",
]);

export const physicalDocumentSchema = z
  .object({
    case_id: uuidSchema,
    name: nonEmptyTrimmed("Document name", 160),
    description: z.string().trim().max(500).optional(),
    received_date: dateStringSchema,
    received_by: uuidSchema,
    storage_location: nonEmptyTrimmed("Storage location", 120),
    return_required: z.boolean().default(false),
    custody_status: custodyStatusEnum.default("expected"),
    returned_date: dateStringSchema.optional(),
    returned_to: z.string().trim().max(120).optional(),
    courier_name: z.string().trim().max(120).optional(),
    tracking_number: z.string().trim().max(80).optional(),
    dispatched_date: dateStringSchema.optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.custody_status === "returned_to_client" && !val.returned_date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["returned_date"],
        message: "Returned date is required when marking a document returned.",
      });
    }
    if (val.custody_status === "dispatched") {
      if (!val.courier_name) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["courier_name"],
          message: "Courier name is required for dispatched documents.",
        });
      }
      if (!val.tracking_number) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tracking_number"],
          message: "Tracking number is required for dispatched documents.",
        });
      }
    }
  });

export type PhysicalDocumentInput = z.infer<typeof physicalDocumentSchema>;
