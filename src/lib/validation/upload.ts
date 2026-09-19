import { z } from "zod";
import {
  UPLOAD_ALLOWED_MIME,
  UPLOAD_LINK_DEFAULT_HOURS,
  UPLOAD_LINK_DEFAULT_MAX_UPLOADS,
  UPLOAD_LINK_MAX_HOURS,
  UPLOAD_LINK_MAX_UPLOADS,
  UPLOAD_MAX_FILE_BYTES,
} from "@/lib/constants";
import { uuidSchema } from "./common";

/** Staff-side: create a client upload link. Raw token is shown once; only its hash is stored. */
export const uploadLinkCreateSchema = z.object({
  case_id: uuidSchema,
  allowed_document_ids: z.array(uuidSchema).min(1, "Select at least one document"),
  expires_in_hours: z.coerce
    .number()
    .int()
    .min(1)
    .max(UPLOAD_LINK_MAX_HOURS)
    .default(UPLOAD_LINK_DEFAULT_HOURS),
  max_uploads: z.coerce
    .number()
    .int()
    .min(1)
    .max(UPLOAD_LINK_MAX_UPLOADS)
    .default(UPLOAD_LINK_DEFAULT_MAX_UPLOADS),
});

export type UploadLinkCreateInput = z.infer<typeof uploadLinkCreateSchema>;

/**
 * Public /upload/[token] submission. Server-side re-validation is mandatory:
 * MIME is additionally verified by magic-byte sniffing before storage (Phase D).
 * Consent is required — a consent_records row is written with every upload.
 *
 * Aadhaar policy: the upload page only offers an "Aadhaar card" document type
 * if staff explicitly enabled it on the case with a reason (default deny).
 */
export const publicUploadSchema = z.object({
  token: z.string().min(32).max(128),
  case_document_id: uuidSchema,
  file_name: z.string().trim().min(1).max(255),
  mime_type: z.enum(UPLOAD_ALLOWED_MIME),
  size_bytes: z.coerce
    .number()
    .int()
    .positive()
    .max(UPLOAD_MAX_FILE_BYTES, "File too large (max 15 MB)"),
  consent_given: z
    .boolean()
    .refine((v) => v === true, "Consent is required to upload documents."),
});

export type PublicUploadInput = z.infer<typeof publicUploadSchema>;
