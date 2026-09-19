import { z } from "zod";
import type { TaxLaw } from "@/lib/tax-pack/identity";

/**
 * Tax Desk (K.2.2) — ITR Prep case creation validation.
 *
 * Preparation-only. Notes/scope text is screened so obvious portal
 * credentials, OTPs, PANs and Aadhaar numbers never get stored in free
 * text. This is a practical guard, NOT a security product.
 */

export const ITR_TYPES = ["ITR-1", "ITR-2", "ITR-3", "ITR-4"] as const;
export type ItrType = (typeof ITR_TYPES)[number];

/** Only period 2026-27 / FY 2025-26 is supported in this phase (mirrors the DB checks). */
export const SUPPORTED_ASSESSMENT_YEAR = "2026-27" as const;
export const SUPPORTED_FINANCIAL_YEAR = "2025-26" as const;

/**
 * Statutory-basis vocabulary offered at case creation. A tuple so Zod can
 * consume it; pinned equal to `TAX_LAWS` by test so a new Act cannot appear
 * on one side only.
 */
export const SUPPORTED_TAX_LAWS = ["ITA_1961", "ITA_2025"] as const satisfies readonly TaxLaw[];
export type SupportedTaxLaw = (typeof SUPPORTED_TAX_LAWS)[number];

/** Risky free-text tokens that must never be stored in prep notes. */
const PORTAL_CREDENTIAL_PATTERNS: readonly RegExp[] = [
  /\bpassword\b/i,
  /\bpwd\b/i,
  /\botp\b/i,
  /\bcaptcha\b/i,
  /income[\s-]*tax[\s-]*portal[\s-]*password/i,
  /login[\s-]*password/i,
  /e[\s-]*filing[\s-]*password/i,
  /portal[\s-]*credential/i,
  /client[\s-]*password/i,
];

const PAN_PATTERN = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/;
/** 12 digits, optionally grouped 4-4-4 with spaces/hyphens (Aadhaar-like). */
const AADHAAR_LIKE = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/;

/**
 * Returns an error message if the text contains credential/PAN/Aadhaar-like
 * content that must not be stored, else null. Pure + unit-tested.
 */
export function screenSensitiveText(text: string | null | undefined): string | null {
  if (!text) return null;
  if (PORTAL_CREDENTIAL_PATTERNS.some((re) => re.test(text))) {
    return "Notes must not contain portal passwords, OTPs, captchas or login credentials. TaxDesk OS never stores portal credentials.";
  }
  if (PAN_PATTERN.test(text.toUpperCase())) {
    return "Do not put a PAN number in free-text notes.";
  }
  if (AADHAAR_LIKE.test(text)) {
    return "Do not put an Aadhaar number in free-text notes.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// K.2.7 — Client review / approval capture validation.
// ---------------------------------------------------------------------------

/** Allowed staff-recorded approval channels (mirrors the DB check). */
export const APPROVAL_METHODS = [
  "whatsapp",
  "email",
  "phone",
  "in_person",
  "signed_document",
  "other",
] as const;
export type ApprovalMethod = (typeof APPROVAL_METHODS)[number];

/**
 * A brief, SAFE approval reference (e.g. "Confirmed by WhatsApp on 10 Jul 2026").
 * Screened so credentials/OTP/PAN/Aadhaar can never be stored, and length-capped
 * so it stays a reference — NOT a full copied conversation transcript.
 */
export const approvalReferenceSchema = z
  .string()
  .trim()
  .min(3, "Enter a brief approval reference (at least 3 characters).")
  .max(280, "Keep the reference brief (max 280 characters) — do not paste the full conversation.")
  .superRefine((val, ctx) => {
    const msg = screenSensitiveText(val);
    if (msg) ctx.addIssue({ code: z.ZodIssueCode.custom, message: msg });
  });

/** Screened, length-capped changes-requested summary. */
export const changesSummarySchema = z
  .string()
  .trim()
  .min(3, "Enter a brief summary of the changes requested (at least 3 characters).")
  .max(500, "Keep the summary brief (max 500 characters).")
  .superRefine((val, ctx) => {
    const msg = screenSensitiveText(val);
    if (msg) ctx.addIssue({ code: z.ZodIssueCode.custom, message: msg });
  });

export const approvalMethodSchema = z.enum(APPROVAL_METHODS, {
  errorMap: () => ({ message: "Select a valid approval method." }),
});

// ---------------------------------------------------------------------------
// K.2.8 — internal finalization / reopen note validation.
// ---------------------------------------------------------------------------

/** Required, screened, bounded finalization note (10–300 chars). */
export const finalizationNoteSchema = z
  .string()
  .trim()
  .min(10, "Enter a finalization note (at least 10 characters).")
  .max(300, "Keep the finalization note brief (max 300 characters).")
  .superRefine((val, ctx) => {
    const msg = screenSensitiveText(val);
    if (msg) ctx.addIssue({ code: z.ZodIssueCode.custom, message: msg });
  });

/** Required, screened, bounded reopen reason (10–500 chars). */
export const reopenReasonSchema = z
  .string()
  .trim()
  .min(10, "Enter a reopen reason (at least 10 characters).")
  .max(500, "Keep the reopen reason brief (max 500 characters).")
  .superRefine((val, ctx) => {
    const msg = screenSensitiveText(val);
    if (msg) ctx.addIssue({ code: z.ZodIssueCode.custom, message: msg });
  });

/** Turn "" (unselected form option) into undefined before validating. */
const emptyToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);

const optionalUuid = z.preprocess(emptyToUndefined, z.string().uuid().optional());
const optionalItrType = z.preprocess(emptyToUndefined, z.enum(ITR_TYPES).optional());

export const taxPrepCaseCreateSchema = z
  .object({
    client_id: z.string().uuid("Select a client."),
    title: z.preprocess(emptyToUndefined, z.string().trim().max(160).optional()),
    assessment_year: z.literal(SUPPORTED_ASSESSMENT_YEAR, {
      errorMap: () => ({ message: "Only period 2026-27 is supported in this phase." }),
    }),
    financial_year: z.literal(SUPPORTED_FINANCIAL_YEAR, {
      errorMap: () => ({ message: "Only FY 2025-26 is supported in this phase." }),
    }),
    law: z.enum(SUPPORTED_TAX_LAWS, {
      errorMap: () => ({ message: "Select a supported statutory world." }),
    }).default("ITA_1961"),
    itr_type_selected: optionalItrType,
    assigned_staff_id: optionalUuid,
    reviewer_id: optionalUuid,
    notes: z.preprocess(emptyToUndefined, z.string().trim().max(2000).optional()),
  })
  .superRefine((data, ctx) => {
    const msg = screenSensitiveText(data.notes);
    if (msg) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: msg, path: ["notes"] });
    }
  });

export type TaxPrepCaseCreateInput = z.infer<typeof taxPrepCaseCreateSchema>;
