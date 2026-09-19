import { z } from "zod";
import {
  BROUGHT_FORWARD_FILING_ELIGIBILITIES,
  BROUGHT_FORWARD_LOSS_PROVENANCES,
  BROUGHT_FORWARD_LOSS_TYPES,
  DEDUCTION_TYPES,
  ELECTED_SET_OFF_TARGETS,
  GAIN_TYPES,
  BUSINESS_BOOKS_ADJUSTMENT_DECLARATIONS,
  BUSINESS_BOOKS_ACTIVITY_CLASSIFICATIONS,
  DEPRECIATION_ASSET_CLASS_DECLARATIONS,
  DEPRECIATION_PUT_TO_USE_DECLARATIONS,
  HOUSE_PROPERTY_USAGES,
  HOUSE_SALE_ACQUISITION_MODE_DECLARATIONS,
  HOUSE_SALE_ASSET_KIND_DECLARATIONS,
  HOUSE_SALE_ALL_DECLARATIONS,
  INCOME_HEADS,
  PRESUMPTIVE_ACTIVITY_TYPES,
  SOURCE_TYPES,
  TAX_PAID_TYPES,
} from "@/lib/tax-desk/ledger";
import { screenSensitiveText } from "@/lib/validation/tax-case";

/**
 * Tax Desk ledger CRUD validation (K.2.4). Reuses screenSensitiveText from the
 * K.2.2 case validation so notes reject portal-credential / PAN / Aadhaar text
 * consistently. Preparation-only — no computation here.
 */

const emptyToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);

const optionalUuid = z.preprocess(emptyToUndefined, z.string().uuid().optional());
const optionalText = (max: number) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());

/**
 * K4-05 (reused K4-07): a tri-state checkbox submission — "" / missing (not
 * rendered, e.g. a row whose `visibleWhen` condition does not match) maps to
 * `undefined` (DB column stays NULL); the literal string "true" (the only
 * value the checkbox's `value` attribute ever submits when checked) maps to
 * `true`. Never inferred true from anything else.
 */
const optionalConfirmedBoolean = z.preprocess(
  (v) => (v === "true" ? true : v === "" || v === null || v === undefined ? undefined : v),
  z.boolean().optional(),
);

/** amount >= 0, coerced from form strings, capped like other money fields. */
const amountSchema = z.coerce
  .number()
  .nonnegative("Amount cannot be negative")
  .max(999_99_99_999, "Amount too large");

/** taxable_gain may be negative (losses); component amounts are >= 0. */
const signedAmountSchema = z.coerce
  .number()
  .min(-999_99_99_999, "Value too small")
  .max(999_99_99_999, "Value too large");

const sourceTypeSchema = z.enum(SOURCE_TYPES);

/** Notes: optional, length-capped, and screened for sensitive content. */
const notesSchema = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .trim()
    .max(1000)
    .optional()
    .superRefine((val, ctx) => {
      const msg = screenSensitiveText(val);
      if (msg) ctx.addIssue({ code: z.ZodIssueCode.custom, message: msg });
    }),
);

const taxCaseIdSchema = z.string().uuid();
const entryIdSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// Create schemas
// ---------------------------------------------------------------------------

export const incomeCreateSchema = z.object({
  tax_case_id: taxCaseIdSchema,
  income_head: z.enum(INCOME_HEADS),
  amount: amountSchema,
  source_type: sourceTypeSchema,
  source_document_id: optionalUuid,
  source_file_id: optionalUuid,
  notes: notesSchema,
  /** K4-07: meaningful only when income_head === "presumptive_professional_44ada". */
  receipts_via_banking_channels: optionalConfirmedBoolean,
  /**
   * K4-13 (D217): meaningful only on the three presumptive heads. OPTIONAL
   * here on purpose — the ledger records what the preparer actually declared,
   * including "nothing", and it is the ADAPTER that refuses to compute an
   * undeclared activity. Making it a hard form requirement instead would put
   * the gate in one submission path while a server action or a direct write
   * bypassed it; the load-bearing refusal belongs in the one place every
   * reader goes through. An unrecognised value is rejected by the enum here
   * AND treated as undeclared by the adapter — both fail closed.
   */
  presumptive_activity_type: z.preprocess(
    emptyToUndefined,
    z.enum(PRESUMPTIVE_ACTIVITY_TYPES).optional(),
  ),
});

export const taxPaidCreateSchema = z.object({
  tax_case_id: taxCaseIdSchema,
  tax_paid_type: z.enum(TAX_PAID_TYPES),
  amount: amountSchema,
  source_type: sourceTypeSchema,
  source_document_id: optionalUuid,
  source_file_id: optionalUuid,
  notes: notesSchema,
});

export const deductionCreateSchema = z.object({
  tax_case_id: taxCaseIdSchema,
  deduction_type: z.enum(DEDUCTION_TYPES),
  section_code: optionalText(30),
  amount: amountSchema,
  source_type: sourceTypeSchema,
  source_document_id: optionalUuid,
  source_file_id: optionalUuid,
  proof_case_document_id: optionalUuid,
  notes: notesSchema,
  /** K4-05: meaningful only when deduction_type === "80D_PARENTS". */
  insured_party_senior: optionalConfirmedBoolean,
});

export const housePropertyCreateSchema = z.object({
  tax_case_id: taxCaseIdSchema,
  usage: z.enum(HOUSE_PROPERTY_USAGES),
  annual_rent_received: amountSchema,
  municipal_taxes_paid: amountSchema,
  home_loan_interest: amountSchema,
  source_type: sourceTypeSchema,
  source_document_id: optionalUuid,
  source_file_id: optionalUuid,
  proof_case_document_id: optionalUuid,
  notes: notesSchema,
});

/**
 * K4-14: one books-based business or profession (Sections 28/29).
 *
 * `adjustments` is REQUIRED — deliberately not `.optional()`, unlike every
 * other companion field in this file. `presumptive_activity_type` is optional
 * here and refused downstream by the adapter; this one is refused at the form
 * boundary as well, because there is no partially-useful books row: without
 * the Sections 30-43D declaration the record cannot be computed under any
 * circumstance, so accepting it silently would only defer the refusal to a
 * screen where the preparer is no longer looking at the field that caused it.
 *
 * The Section 44AB threshold and the loss/adjustment gates are NOT duplicated
 * here. They live in `computation-adapter.ts`, which is their single
 * authority; a second copy in a form validator is exactly the drift §3 forbids.
 */
export const businessBooksCreateSchema = z.object({
  tax_case_id: taxCaseIdSchema,
  revenue: amountSchema,
  expenses: amountSchema,
  is_profession: z.boolean().default(false),
  /**
   * K4-20: a SET. A lone string is the pre-K4-20 form/snapshot shape and is
   * wrapped. Empty is rejected here because the column is NOT NULL and
   * absence is not a member; the adapter is still the authority on what
   * the set *computes*.
   */
  adjustments: z.preprocess((v) => {
    if (v == null || v === "") return undefined;
    if (typeof v === "string") {
      try {
        const parsed = JSON.parse(v) as unknown;
        if (Array.isArray(parsed)) return parsed;
      } catch {
        /* a bare member, not JSON */
      }
      return [v];
    }
    return v;
  }, z.array(z.enum(BUSINESS_BOOKS_ADJUSTMENT_DECLARATIONS)).min(1)).refine(
    (set) => !(set.includes("none_s30_43d") && set.length > 1),
    "none_s30_43d cannot be combined with another Sections 30-43D adjustment",
  ),
  activity_classification: z.enum(BUSINESS_BOOKS_ACTIVITY_CLASSIFICATIONS),
  book_depreciation: z.preprocess(emptyToUndefined, amountSchema.optional()),
  /**
   * K4-20: tri-state on purpose. "true" / "false" are answers; blank is
   * unanswered and the adapter refuses a depreciation row that did not
   * answer. Never inferred false from silence.
   */
  claims_additional_depreciation: z.preprocess((v) => {
    if (v === "true" || v === true) return true;
    if (v === "false" || v === false) return false;
    return undefined;
  }, z.boolean().optional()),
  depreciation_blocks: z.preprocess((v) => {
    if (v == null || v === "") return [];
    if (typeof v === "string") {
      try {
        return JSON.parse(v);
      } catch {
        return v;
      }
    }
    return v;
  }, z.array(
    z.object({
      asset_class: z.enum(DEPRECIATION_ASSET_CLASS_DECLARATIONS),
      wdv: amountSchema,
      put_to_use: z.enum(DEPRECIATION_PUT_TO_USE_DECLARATIONS),
    }),
  )),
  /**
   * K4-18 — the preparer-declared Section 44AB turnover. Optional HERE, and
   * deliberately so: whether a given row REQUIRES it is a function of its
   * classification's `turnoverFromBooksRevenue`, which is the engine
   * vocabulary's to state. Enforcing the requirement in this validator too
   * would put the rule in two places and let them drift — the same reason the
   * Section 44AB threshold and the loss/adjustment gates are not duplicated
   * here (see the note above). The adapter refuses a row that needs the figure
   * and lacks it, so a row saved without it is recordable but not computable.
   *
   * Non-negativity IS enforced here, because that is a property of the field
   * itself rather than a rule about when it applies, and the DB CHECK asserts
   * the same thing independently.
   *
   * `emptyToUndefined` IS LOAD-BEARING, not tidiness. A blank number input
   * submits `""`, and `amountSchema` is `z.coerce.number()`, so `""` coerces to
   * **0** — a bare `.optional()` would accept it, because `.optional()` admits
   * only `undefined`. An F&O row saved with the field left blank would then
   * carry a DECLARED turnover of zero rather than no declaration: it would sail
   * under the Section 44AB threshold and compute with the audit question
   * silently answered "no". That is the fail-open shape `K4-13` exists because
   * of. Empty must mean undeclared, so the adapter can refuse it.
   */
  declared_turnover: z.preprocess(emptyToUndefined, amountSchema.optional()),
  source_type: sourceTypeSchema,
  source_document_id: optionalUuid,
  source_file_id: optionalUuid,
  proof_case_document_id: optionalUuid,
  notes: notesSchema,
});

/**
 * K4-10: the originating assessment year of a brought-forward loss, as
 * `YYYY-YY`. The two halves must be consecutive — `2026-28` is rejected here
 * rather than silently read as 2026 downstream. The eight-year Section 74(2)
 * window is NOT evaluated here: that is the engine's
 * `admitBroughtForwardRecord`, and a second copy of it in a form validator
 * would be a second authority that could drift.
 */
const assessmentYearSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}$/, "Assessment year must look like 2024-25")
  .refine(
    (v) => (Number(v.slice(0, 4)) + 1) % 100 === Number(v.slice(5)),
    "Assessment year halves must be consecutive (e.g. 2024-25, not 2024-26)",
  );

/**
 * K4-10: the taxpayer's ELECTED set-off bucket, or absent for none. Absent
 * means the versioned portal-default policy applies; it is never inferred to
 * be an election.
 */
const optionalElectedTargetSchema = z.preprocess(
  emptyToUndefined,
  z.enum(ELECTED_SET_OFF_TARGETS).optional(),
);

export const broughtForwardLossCreateSchema = z.object({
  tax_case_id: taxCaseIdSchema,
  originating_assessment_year: assessmentYearSchema,
  loss_type: z.enum(BROUGHT_FORWARD_LOSS_TYPES),
  amount: amountSchema,
  // No default here: the DB column defaults to 'unverified' and the enum has
  // no bare "eligible" member, so an unset field can never read as verified.
  filing_eligibility: z.enum(BROUGHT_FORWARD_FILING_ELIGIBILITIES),
  loss_provenance: z.enum(BROUGHT_FORWARD_LOSS_PROVENANCES),
  prior_tax_case_id: optionalUuid,
  elected_set_off_target: optionalElectedTargetSchema,
  source_type: sourceTypeSchema,
  source_document_id: optionalUuid,
  source_file_id: optionalUuid,
  proof_case_document_id: optionalUuid,
  notes: notesSchema,
});

const optionalIsoDate = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
    .optional(),
);

const optionalDeclarationSet = z.preprocess((v) => {
  if (v == null || v === "") return [];
  if (Array.isArray(v)) return v;
  return [v];
}, z.array(z.enum(HOUSE_SALE_ALL_DECLARATIONS)));

export const capitalGainCreateSchema = z.object({
  tax_case_id: taxCaseIdSchema,
  gain_type: z.enum(GAIN_TYPES),
  sale_value: amountSchema,
  cost: amountSchema,
  expenses: amountSchema,
  exemption_claimed: amountSchema,
  taxable_gain: signedAmountSchema,
  transfer_date: optionalIsoDate,
  acquisition_date: optionalIsoDate,
  stamp_duty_value: z.preprocess(emptyToUndefined, amountSchema.optional()),
  asset_kind: z.preprocess(emptyToUndefined, z.enum(HOUSE_SALE_ASSET_KIND_DECLARATIONS).optional()),
  acquisition_mode: z.preprocess(
    emptyToUndefined,
    z.enum(HOUSE_SALE_ACQUISITION_MODE_DECLARATIONS).optional(),
  ),
  cost_of_improvement: z.preprocess(emptyToUndefined, amountSchema.optional()),
  house_sale_declarations: optionalDeclarationSet,
  source_type: sourceTypeSchema,
  source_document_id: optionalUuid,
  source_file_id: optionalUuid,
  notes: notesSchema,
});

// ---------------------------------------------------------------------------
// Update schemas = create fields (minus tax_case_id) + entry id
// ---------------------------------------------------------------------------

export const incomeUpdateSchema = incomeCreateSchema
  .omit({ tax_case_id: true })
  .extend({ id: entryIdSchema });
export const taxPaidUpdateSchema = taxPaidCreateSchema
  .omit({ tax_case_id: true })
  .extend({ id: entryIdSchema });
export const deductionUpdateSchema = deductionCreateSchema
  .omit({ tax_case_id: true })
  .extend({ id: entryIdSchema });
export const capitalGainUpdateSchema = capitalGainCreateSchema
  .omit({ tax_case_id: true })
  .extend({ id: entryIdSchema });
export const housePropertyUpdateSchema = housePropertyCreateSchema
  .omit({ tax_case_id: true })
  .extend({ id: entryIdSchema });
export const broughtForwardLossUpdateSchema = broughtForwardLossCreateSchema
  .omit({ tax_case_id: true })
  .extend({ id: entryIdSchema });
export const businessBooksUpdateSchema = businessBooksCreateSchema
  .omit({ tax_case_id: true })
  .extend({ id: entryIdSchema });

export const ledgerRemoveSchema = z.object({
  id: entryIdSchema,
  reason: optionalText(300),
});

export type IncomeCreateInput = z.infer<typeof incomeCreateSchema>;
export type TaxPaidCreateInput = z.infer<typeof taxPaidCreateSchema>;
export type DeductionCreateInput = z.infer<typeof deductionCreateSchema>;
export type CapitalGainCreateInput = z.infer<typeof capitalGainCreateSchema>;
export type HousePropertyCreateInput = z.infer<typeof housePropertyCreateSchema>;
export type BroughtForwardLossCreateInput = z.infer<typeof broughtForwardLossCreateSchema>;
