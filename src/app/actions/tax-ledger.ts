"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import {
  LEDGER_AUDIT_PREFIX,
  LEDGER_TABLE,
  PRESUMPTIVE_INCOME_HEADS,
  type LedgerKind,
} from "@/lib/tax-desk/ledger";
import { assertTaxCaseMutable } from "@/lib/tax-desk-server/finalization";
import { createClient as createServerClient } from "@/lib/supabase/server";
import {
  broughtForwardLossCreateSchema,
  broughtForwardLossUpdateSchema,
  capitalGainCreateSchema,
  capitalGainUpdateSchema,
  deductionCreateSchema,
  deductionUpdateSchema,
  businessBooksCreateSchema,
  businessBooksUpdateSchema,
  housePropertyCreateSchema,
  housePropertyUpdateSchema,
  incomeCreateSchema,
  incomeUpdateSchema,
  ledgerRemoveSchema,
  taxPaidCreateSchema,
  taxPaidUpdateSchema,
} from "@/lib/validation/tax-ledger";

type LedgerResult = { ok: boolean; error?: string; entryId?: string };

/* eslint-disable @typescript-eslint/no-explicit-any */
type SupabaseClient = Awaited<ReturnType<typeof createServerClient>>;

interface LedgerConfig {
  createSchema: z.ZodTypeAny;
  updateSchema: z.ZodTypeAny;
  /** DB columns from validated data (source_* coalesced to null). */
  columns: (d: any) => Record<string, unknown>;
  /** Source refs to validate belong to the parent case. */
  refs: (d: any) => { source_document_id?: string; source_file_id?: string; proof_case_document_id?: string };
  /** Safe audit metadata — IDs/type/amounts/source_type only, never notes. */
  auditMeta: (d: any) => Record<string, unknown>;
}

const CONFIGS: Record<LedgerKind, LedgerConfig> = {
  income: {
    createSchema: incomeCreateSchema,
    updateSchema: incomeUpdateSchema,
    columns: (d) => ({
      income_head: d.income_head,
      amount: d.amount,
      source_type: d.source_type,
      source_document_id: d.source_document_id ?? null,
      source_file_id: d.source_file_id ?? null,
      notes: d.notes ?? null,
      // K4-07: NULL for every non-"presumptive_professional_44ada" row, and
      // NULL/false (never inferred true) when receipts were not explicitly
      // confirmed predominantly digital — never a second, independently-
      // guessed signal (mirrors K4-05's insured_party_senior pattern).
      receipts_via_banking_channels:
        d.income_head === "presumptive_professional_44ada" ? (d.receipts_via_banking_channels ?? false) : null,
      // K4-13 (D217): NULL on every non-presumptive row, and NULL — never a
      // default member — when the preparer left it unset on a presumptive
      // row. NULL means "not declared", which the adapter treats as a
      // REFUSAL, so the unset case fails closed rather than computing a
      // deemed profit for an activity nobody classified. Deliberately unlike
      // `receipts_via_banking_channels` above, whose absence coerces to
      // `false` because there a conservative answer exists; here it does not.
      presumptive_activity_type: PRESUMPTIVE_INCOME_HEADS.includes(d.income_head)
        ? (d.presumptive_activity_type ?? null)
        : null,
    }),
    refs: (d) => ({ source_document_id: d.source_document_id, source_file_id: d.source_file_id }),
    auditMeta: (d) => ({
      income_head: d.income_head,
      amount: d.amount,
      source_type: d.source_type,
      has_notes: !!d.notes,
      ...(d.income_head === "presumptive_professional_44ada"
        ? { receipts_via_banking_channels: !!d.receipts_via_banking_channels }
        : {}),
      // K4-13: recorded on every presumptive row, including when it is absent
      // — an audit trail that shows the activity was left undeclared is the
      // point, so `null` is written rather than the key omitted.
      ...(PRESUMPTIVE_INCOME_HEADS.includes(d.income_head)
        ? { presumptive_activity_type: d.presumptive_activity_type ?? null }
        : {}),
    }),
  },
  tax_paid: {
    createSchema: taxPaidCreateSchema,
    updateSchema: taxPaidUpdateSchema,
    columns: (d) => ({
      tax_paid_type: d.tax_paid_type,
      amount: d.amount,
      source_type: d.source_type,
      source_document_id: d.source_document_id ?? null,
      source_file_id: d.source_file_id ?? null,
      notes: d.notes ?? null,
    }),
    refs: (d) => ({ source_document_id: d.source_document_id, source_file_id: d.source_file_id }),
    auditMeta: (d) => ({
      tax_paid_type: d.tax_paid_type,
      amount: d.amount,
      source_type: d.source_type,
      has_notes: !!d.notes,
    }),
  },
  deduction: {
    createSchema: deductionCreateSchema,
    updateSchema: deductionUpdateSchema,
    columns: (d) => ({
      deduction_type: d.deduction_type,
      section_code: d.section_code ?? null,
      amount: d.amount,
      source_type: d.source_type,
      source_document_id: d.source_document_id ?? null,
      source_file_id: d.source_file_id ?? null,
      proof_case_document_id: d.proof_case_document_id ?? null,
      notes: d.notes ?? null,
      // K4-05: NULL for every non-"80D_PARENTS" row, and NULL/false (never
      // inferred true) when the parent's senior status was not explicitly
      // confirmed — never a second, independently-guessed signal.
      insured_party_senior: d.deduction_type === "80D_PARENTS" ? (d.insured_party_senior ?? false) : null,
    }),
    refs: (d) => ({
      source_document_id: d.source_document_id,
      source_file_id: d.source_file_id,
      proof_case_document_id: d.proof_case_document_id,
    }),
    auditMeta: (d) => ({
      deduction_type: d.deduction_type,
      amount: d.amount,
      source_type: d.source_type,
      has_notes: !!d.notes,
      ...(d.deduction_type === "80D_PARENTS" ? { insured_party_senior: !!d.insured_party_senior } : {}),
    }),
  },
  capital_gain: {
    createSchema: capitalGainCreateSchema,
    updateSchema: capitalGainUpdateSchema,
    columns: (d) => ({
      gain_type: d.gain_type,
      sale_value: d.sale_value,
      cost: d.cost,
      expenses: d.expenses,
      exemption_claimed: d.exemption_claimed,
      taxable_gain: d.taxable_gain,
      transfer_date: d.transfer_date ?? null,
      acquisition_date: d.acquisition_date ?? null,
      stamp_duty_value: d.stamp_duty_value ?? null,
      asset_kind: d.asset_kind ?? null,
      acquisition_mode: d.acquisition_mode ?? null,
      cost_of_improvement: d.cost_of_improvement ?? 0,
      house_sale_declarations: d.house_sale_declarations ?? [],
      source_type: d.source_type,
      source_document_id: d.source_document_id ?? null,
      source_file_id: d.source_file_id ?? null,
      notes: d.notes ?? null,
    }),
    refs: (d) => ({ source_document_id: d.source_document_id, source_file_id: d.source_file_id }),
    auditMeta: (d) => ({
      gain_type: d.gain_type,
      taxable_gain: d.taxable_gain,
      sale_value: d.sale_value,
      source_type: d.source_type,
      has_notes: !!d.notes,
    }),
  },
  house_property: {
    createSchema: housePropertyCreateSchema,
    updateSchema: housePropertyUpdateSchema,
    columns: (d) => ({
      usage: d.usage,
      annual_rent_received: d.annual_rent_received,
      municipal_taxes_paid: d.municipal_taxes_paid,
      home_loan_interest: d.home_loan_interest,
      source_type: d.source_type,
      source_document_id: d.source_document_id ?? null,
      source_file_id: d.source_file_id ?? null,
      proof_case_document_id: d.proof_case_document_id ?? null,
      notes: d.notes ?? null,
    }),
    refs: (d) => ({
      source_document_id: d.source_document_id,
      source_file_id: d.source_file_id,
      proof_case_document_id: d.proof_case_document_id,
    }),
    auditMeta: (d) => ({
      usage: d.usage,
      annual_rent_received: d.annual_rent_received,
      municipal_taxes_paid: d.municipal_taxes_paid,
      home_loan_interest: d.home_loan_interest,
      source_type: d.source_type,
      has_notes: !!d.notes,
    }),
  },
  // K4-14: books-based business/profession (Sections 28/29). `adjustments` is
  // audited on every row because it is the single fact that decides whether
  // the record may be computed at all — a change to it must be attributable,
  // the same reasoning K4-10 applies to `filing_eligibility` below.
  business_books: {
    createSchema: businessBooksCreateSchema,
    updateSchema: businessBooksUpdateSchema,
    columns: (d) => ({
      revenue: d.revenue,
      expenses: d.expenses,
      is_profession: d.is_profession ?? false,
      adjustments: d.adjustments,
      activity_classification: d.activity_classification,
      // K4-18: null rather than omitted, so clearing the field on an update
      // actually clears it. Leaving it out would let a stale turnover survive a
      // reclassification away from F&O.
      declared_turnover: d.declared_turnover ?? null,
      book_depreciation: d.book_depreciation ?? null,
      claims_additional_depreciation: d.claims_additional_depreciation ?? null,
      depreciation_blocks: d.depreciation_blocks ?? [],
      source_type: d.source_type,
      source_document_id: d.source_document_id ?? null,
      source_file_id: d.source_file_id ?? null,
      proof_case_document_id: d.proof_case_document_id ?? null,
      notes: d.notes ?? null,
    }),
    refs: (d) => ({
      source_document_id: d.source_document_id,
      source_file_id: d.source_file_id,
      proof_case_document_id: d.proof_case_document_id,
    }),
    auditMeta: (d) => ({
      revenue: d.revenue,
      expenses: d.expenses,
      is_profession: d.is_profession ?? false,
      adjustments: d.adjustments,
      activity_classification: d.activity_classification,
      // K4-18: audited because it changes what the engine is permitted to
      // conclude about Section 44AB, exactly the test the brought-forward
      // fields below are audited under.
      declared_turnover: d.declared_turnover ?? null,
      book_depreciation: d.book_depreciation ?? null,
      claims_additional_depreciation: d.claims_additional_depreciation ?? null,
      depreciation_blocks: d.depreciation_blocks ?? [],
      source_type: d.source_type,
      has_notes: !!d.notes,
    }),
  },
  // K4-10: brought-forward capital losses (Section 74). The originating
  // assessment year and loss type are the row's IDENTITY, so both are audited.
  // `filing_eligibility` and `elected_set_off_target` are audited too because
  // both change what the engine is permitted to do with the row, and a change
  // to either must be attributable.
  brought_forward_loss: {
    createSchema: broughtForwardLossCreateSchema,
    updateSchema: broughtForwardLossUpdateSchema,
    columns: (d) => ({
      originating_assessment_year: d.originating_assessment_year,
      loss_type: d.loss_type,
      amount: d.amount,
      filing_eligibility: d.filing_eligibility,
      loss_provenance: d.loss_provenance,
      prior_tax_case_id: d.prior_tax_case_id ?? null,
      // NULL means "no election" — never inferred from an unset field.
      elected_set_off_target: d.elected_set_off_target ?? null,
      source_type: d.source_type,
      source_document_id: d.source_document_id ?? null,
      source_file_id: d.source_file_id ?? null,
      proof_case_document_id: d.proof_case_document_id ?? null,
      notes: d.notes ?? null,
    }),
    refs: (d) => ({
      source_document_id: d.source_document_id,
      source_file_id: d.source_file_id,
      proof_case_document_id: d.proof_case_document_id,
    }),
    auditMeta: (d) => ({
      originating_assessment_year: d.originating_assessment_year,
      loss_type: d.loss_type,
      amount: d.amount,
      filing_eligibility: d.filing_eligibility,
      loss_provenance: d.loss_provenance,
      elected_set_off_target: d.elected_set_off_target ?? null,
      source_type: d.source_type,
      has_notes: !!d.notes,
    }),
  },
};

/** Loads the tax case, ensuring it exists (RLS-scoped) and is not finalized.
 *  Delegates the finalized-lock check to the centralized K.2.8 guard. */
async function loadEditableTaxCase(
  supabase: SupabaseClient,
  taxCaseId: string,
): Promise<{ caseId: string } | { error: string }> {
  const res = await assertTaxCaseMutable(supabase, taxCaseId);
  return res.ok ? { caseId: res.caseId } : { error: res.error };
}

/** Every source_*_id must belong to the SAME parent case. */
async function validateSourceRefs(
  supabase: SupabaseClient,
  caseId: string,
  refs: { source_document_id?: string; source_file_id?: string; proof_case_document_id?: string },
): Promise<string | null> {
  const docIds = [refs.source_document_id, refs.proof_case_document_id].filter(Boolean) as string[];
  for (const docId of docIds) {
    const { data } = await supabase
      .from("case_documents")
      .select("id")
      .eq("id", docId)
      .eq("case_id", caseId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!data) return "Selected source document does not belong to this case.";
  }
  if (refs.source_file_id) {
    const { data } = await supabase
      .from("uploaded_files")
      .select("id")
      .eq("id", refs.source_file_id)
      .eq("case_id", caseId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!data) return "Selected source file does not belong to this case.";
  }
  return null;
}

async function createEntry(kind: LedgerKind, input: unknown): Promise<LedgerResult> {
  const cfg = CONFIGS[kind];
  const user = await requireUser();
  const parsed = cfg.createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data as any;

  const supabase = await createServerClient();
  const tc = await loadEditableTaxCase(supabase, d.tax_case_id);
  if ("error" in tc) return { ok: false, error: tc.error };

  const refErr = await validateSourceRefs(supabase, tc.caseId, cfg.refs(d));
  if (refErr) return { ok: false, error: refErr };

  const { data: row, error } = await supabase
    .from(LEDGER_TABLE[kind])
    .insert({ tax_case_id: d.tax_case_id, ...cfg.columns(d), created_by: user.id, updated_by: user.id })
    .select("id")
    .single();
  if (error || !row) return { ok: false, error: "Could not save the entry." };

  await audit({
    actor: user,
    action: `${LEDGER_AUDIT_PREFIX[kind]}.created`,
    entityType: LEDGER_TABLE[kind],
    entityId: row.id,
    caseId: tc.caseId,
    after: { tax_case_id: d.tax_case_id, ...cfg.auditMeta(d) },
  });
  revalidatePath(`/tax-desk/cases/${d.tax_case_id}/ledgers`);
  return { ok: true, entryId: row.id };
}

async function updateEntry(kind: LedgerKind, input: unknown): Promise<LedgerResult> {
  const cfg = CONFIGS[kind];
  const user = await requireUser();
  const parsed = cfg.updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data as any;

  const supabase = await createServerClient();
  const { data: existing } = await supabase
    .from(LEDGER_TABLE[kind])
    .select("id, tax_case_id, deleted_at")
    .eq("id", d.id)
    .maybeSingle();
  if (!existing || existing.deleted_at) return { ok: false, error: "Entry not found." };

  const tc = await loadEditableTaxCase(supabase, existing.tax_case_id);
  if ("error" in tc) return { ok: false, error: tc.error };

  const refErr = await validateSourceRefs(supabase, tc.caseId, cfg.refs(d));
  if (refErr) return { ok: false, error: refErr };

  const { error } = await supabase
    .from(LEDGER_TABLE[kind])
    .update({ ...cfg.columns(d), updated_by: user.id })
    .eq("id", d.id);
  if (error) return { ok: false, error: "Update failed." };

  await audit({
    actor: user,
    action: `${LEDGER_AUDIT_PREFIX[kind]}.updated`,
    entityType: LEDGER_TABLE[kind],
    entityId: d.id,
    caseId: tc.caseId,
    after: cfg.auditMeta(d),
  });
  revalidatePath(`/tax-desk/cases/${existing.tax_case_id}/ledgers`);
  return { ok: true, entryId: d.id };
}

async function removeEntry(kind: LedgerKind, input: unknown): Promise<LedgerResult> {
  const user = await requireUser();
  const parsed = ledgerRemoveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const { id, reason } = parsed.data;

  const supabase = await createServerClient();
  const { data: existing } = await supabase
    .from(LEDGER_TABLE[kind])
    .select("id, tax_case_id, deleted_at")
    .eq("id", id)
    .maybeSingle();
  if (!existing || existing.deleted_at) return { ok: false, error: "Entry not found." };

  const tc = await loadEditableTaxCase(supabase, existing.tax_case_id);
  if ("error" in tc) return { ok: false, error: tc.error };

  const { error } = await supabase
    .from(LEDGER_TABLE[kind])
    .update({ deleted_at: new Date().toISOString(), deleted_by: user.id, delete_reason: reason ?? null })
    .eq("id", id);
  if (error) return { ok: false, error: "Remove failed." };

  await audit({
    actor: user,
    action: `${LEDGER_AUDIT_PREFIX[kind]}.removed`,
    entityType: LEDGER_TABLE[kind],
    entityId: id,
    caseId: tc.caseId,
    after: { reason: reason ?? null },
  });
  revalidatePath(`/tax-desk/cases/${existing.tax_case_id}/ledgers`);
  return { ok: true };
}

// --- Focused, named server actions (thin wrappers over the generics) --------

export async function createIncomeEntryAction(input: unknown) {
  return createEntry("income", input);
}
export async function updateIncomeEntryAction(input: unknown) {
  return updateEntry("income", input);
}
export async function removeIncomeEntryAction(input: unknown) {
  return removeEntry("income", input);
}

export async function createTaxPaidEntryAction(input: unknown) {
  return createEntry("tax_paid", input);
}
export async function updateTaxPaidEntryAction(input: unknown) {
  return updateEntry("tax_paid", input);
}
export async function removeTaxPaidEntryAction(input: unknown) {
  return removeEntry("tax_paid", input);
}

export async function createDeductionEntryAction(input: unknown) {
  return createEntry("deduction", input);
}
export async function updateDeductionEntryAction(input: unknown) {
  return updateEntry("deduction", input);
}
export async function removeDeductionEntryAction(input: unknown) {
  return removeEntry("deduction", input);
}

export async function createCapitalGainEntryAction(input: unknown) {
  return createEntry("capital_gain", input);
}
export async function updateCapitalGainEntryAction(input: unknown) {
  return updateEntry("capital_gain", input);
}
export async function removeCapitalGainEntryAction(input: unknown) {
  return removeEntry("capital_gain", input);
}

export async function createHousePropertyEntryAction(input: unknown) {
  return createEntry("house_property", input);
}
export async function updateHousePropertyEntryAction(input: unknown) {
  return updateEntry("house_property", input);
}
export async function removeHousePropertyEntryAction(input: unknown) {
  return removeEntry("house_property", input);
}

export async function createBusinessBooksEntryAction(input: unknown) {
  return createEntry("business_books", input);
}
export async function updateBusinessBooksEntryAction(input: unknown) {
  return updateEntry("business_books", input);
}
export async function removeBusinessBooksEntryAction(input: unknown) {
  return removeEntry("business_books", input);
}

export async function createBroughtForwardLossEntryAction(input: unknown) {
  return createEntry("brought_forward_loss", input);
}
export async function updateBroughtForwardLossEntryAction(input: unknown) {
  return updateEntry("brought_forward_loss", input);
}
export async function removeBroughtForwardLossEntryAction(input: unknown) {
  return removeEntry("brought_forward_loss", input);
}
