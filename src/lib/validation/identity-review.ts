import { z } from "zod";
import { uuidSchema } from "./common";

/**
 * IEPF identity/mismatch review — one per IEPF case.
 * Every field must leave 'not_checked' before the case may enter
 * "IEPF-5 preparation" (admin override with reason, audited).
 * Affidavit flags suggest adding the matching conditional checklist items.
 */
const matchStatusEnum = z.enum(["not_checked", "match", "mismatch", "na"]);
const addressMismatchEnum = z.enum(["not_checked", "no", "yes"]);
const signatureRiskEnum = z.enum(["unknown", "low", "medium", "high"]);

export const identityReviewSchema = z.object({
  case_id: uuidSchema,
  pan_name_match: matchStatusEnum.default("not_checked"),
  cml_name_match: matchStatusEnum.default("not_checked"),
  certificate_name_match: matchStatusEnum.default("not_checked"),
  bank_name_match: matchStatusEnum.default("not_checked"),
  address_mismatch: addressMismatchEnum.default("not_checked"),
  signature_mismatch_risk: signatureRiskEnum.default("unknown"),
  same_person_affidavit_needed: z.boolean().default(false),
  change_of_address_affidavit_needed: z.boolean().default(false),
  notes: z.string().trim().max(2000).optional(),
});

export type IdentityReviewInput = z.infer<typeof identityReviewSchema>;

/** True when the review is complete enough to allow IEPF-5 preparation. */
export function isIdentityReviewComplete(
  review: IdentityReviewInput
): boolean {
  return (
    review.pan_name_match !== "not_checked" &&
    review.cml_name_match !== "not_checked" &&
    review.certificate_name_match !== "not_checked" &&
    review.bank_name_match !== "not_checked" &&
    review.address_mismatch !== "not_checked" &&
    review.signature_mismatch_risk !== "unknown"
  );
}
