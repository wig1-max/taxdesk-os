import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import {
  createBroughtForwardLossEntryAction,
  createBusinessBooksEntryAction,
  createCapitalGainEntryAction,
  createDeductionEntryAction,
  createHousePropertyEntryAction,
  createIncomeEntryAction,
  createTaxPaidEntryAction,
  removeBroughtForwardLossEntryAction,
  removeBusinessBooksEntryAction,
  removeCapitalGainEntryAction,
  removeDeductionEntryAction,
  removeHousePropertyEntryAction,
  removeIncomeEntryAction,
  removeTaxPaidEntryAction,
  updateBroughtForwardLossEntryAction,
  updateBusinessBooksEntryAction,
  updateCapitalGainEntryAction,
  updateDeductionEntryAction,
  updateHousePropertyEntryAction,
  updateIncomeEntryAction,
  updateTaxPaidEntryAction,
} from "@/app/actions/tax-ledger";
import {
  LedgerWorkspace,
  type FieldDesc,
  type LedgerCategory,
} from "@/components/tax-desk/ledger-workspace";
import { requireUser } from "@/lib/auth";
import { maybeInjectFault } from "@/lib/telemetry/fault-injection";
import { getTaxCaseLedgers } from "@/lib/queries/tax-desk";
import {
  BROUGHT_FORWARD_FILING_ELIGIBILITIES,
  BROUGHT_FORWARD_LOSS_PROVENANCES,
  BROUGHT_FORWARD_LOSS_TYPES,
  BUSINESS_BOOKS_ADJUSTMENT_DECLARATIONS,
  BUSINESS_BOOKS_ACTIVITY_CLASSIFICATIONS,
  DEDUCTION_TYPES,
  ELECTED_SET_OFF_TARGETS,
  GAIN_TYPES,
  HOUSE_SALE_ACQUISITION_MODE_DECLARATIONS,
  HOUSE_SALE_ASSET_KIND_DECLARATIONS,
  HOUSE_SALE_ALL_DECLARATIONS,
  HOUSE_PROPERTY_USAGES,
  INCOME_HEADS,
  PRESUMPTIVE_ACTIVITY_TYPES,
  PRESUMPTIVE_INCOME_HEADS,
  SOURCE_TYPES,
  TAX_PAID_TYPES,
} from "@/lib/tax-desk/ledger";
import { classifyLedgerSupport } from "@/lib/tax-desk/ledger-support";
import { assembleCompleteLedgerRows } from "@/lib/tax-desk/computation-adapter";

export const metadata: Metadata = { title: "ITR Prep — Ledgers" };

const SOURCE_FIELDS: FieldDesc[] = [
  { key: "source_type", label: "Source", kind: "enum", options: SOURCE_TYPES },
  { key: "source_document_id", label: "Source document", kind: "doc" },
  { key: "source_file_id", label: "Source file", kind: "file" },
  { key: "notes", label: "Notes", kind: "text", helper: "Never store passwords, OTPs, PAN or Aadhaar here." },
];

const INCOME_FIELDS: FieldDesc[] = [
  { key: "income_head", label: "Income head", kind: "enum", options: INCOME_HEADS },
  {
    key: "amount",
    label: "Amount",
    kind: "number",
    helper:
      "For \"presumptive professional (44ADA)\": enter GROSS RECEIPTS from a Section 44AA(1)-specified " +
      "profession (legal, medical, engineering, architecture, accountancy, technical consultancy, " +
      "interior decoration, company secretary, or IT) — a 50% deemed profit is computed automatically. " +
      "For the two \"presumptive business (44AD)\" heads: enter TURNOVER, split by receipt mode — the " +
      "digital head (banking channels / prescribed electronic modes) is computed at 6% and the cash " +
      "head at 8%. Enter both heads where both apply; the 5%-cash eligibility test is derived from " +
      "the two amounts.",
  },
  {
    key: "presumptive_activity_type",
    label: "Activity this income arises from",
    kind: "enum",
    options: PRESUMPTIVE_ACTIVITY_TYPES,
    blankOption: "— not declared (blocks computation) —",
    helper:
      "Required before a presumptive computation will run. Section 44AD(6) excludes a Section 44AA(1) " +
      "profession, commission or brokerage income, and agency business; the Explanation to Section 44AD " +
      "separately excludes goods carriage (Section 44AE). Section 44ADA applies ONLY to a Section 44AA(1) " +
      "profession. If this is left undeclared the deemed profit is NOT computed and the rows are excluded " +
      "— eligibility is never presumed.",
    visibleWhen: { field: "income_head", equals: PRESUMPTIVE_INCOME_HEADS },
  },
  {
    key: "receipts_via_banking_channels",
    label: "Receipts predominantly via banking channels (cash ≤5%)",
    kind: "boolean",
    helper:
      "Leave unchecked if not confirmed — the ₹50,00,000 (not ₹75,00,000) eligibility ceiling applies " +
      "conservatively.",
    visibleWhen: { field: "income_head", equals: "presumptive_professional_44ada" },
  },
  ...SOURCE_FIELDS,
];

const TAX_PAID_FIELDS: FieldDesc[] = [
  { key: "tax_paid_type", label: "Tax paid type", kind: "enum", options: TAX_PAID_TYPES },
  { key: "amount", label: "Amount", kind: "number" },
  ...SOURCE_FIELDS,
];

const DEDUCTION_FIELDS: FieldDesc[] = [
  { key: "deduction_type", label: "Deduction", kind: "enum", options: DEDUCTION_TYPES },
  {
    key: "insured_party_senior",
    label: "Insured parent is 60 or above",
    kind: "boolean",
    helper: "Leave unchecked if not confirmed — the ₹25,000 (not ₹50,000) cap applies conservatively.",
    visibleWhen: { field: "deduction_type", equals: "80D_PARENTS" },
  },
  { key: "section_code", label: "Section code", kind: "text" },
  { key: "amount", label: "Amount", kind: "number" },
  { key: "source_type", label: "Source", kind: "enum", options: SOURCE_TYPES },
  { key: "source_document_id", label: "Source document", kind: "doc" },
  { key: "source_file_id", label: "Source file", kind: "file" },
  { key: "proof_case_document_id", label: "Proof document", kind: "doc" },
  { key: "notes", label: "Notes", kind: "text", helper: "Never store passwords, OTPs, PAN or Aadhaar here." },
];

const HOUSE_PROPERTY_FIELDS: FieldDesc[] = [
  { key: "usage", label: "Usage", kind: "enum", options: HOUSE_PROPERTY_USAGES },
  {
    key: "annual_rent_received",
    label: "Annual rent received",
    kind: "number",
    helper: "Actual rent received/receivable. Leave 0 for a self-occupied property (deemed nil).",
    visibleWhen: { field: "usage", equals: "let_out" },
  },
  {
    key: "municipal_taxes_paid",
    label: "Municipal taxes paid",
    kind: "number",
    helper: "Only the amount ACTUALLY PAID during the year — not merely accrued.",
    visibleWhen: { field: "usage", equals: "let_out" },
  },
  {
    key: "home_loan_interest",
    label: "Home loan interest (Section 24(b))",
    kind: "number",
    helper: "Self-occupied: capped at ₹2,00,000 (old regime); not deductible under the new regime.",
  },
  { key: "source_type", label: "Source", kind: "enum", options: SOURCE_TYPES },
  { key: "source_document_id", label: "Source document", kind: "doc" },
  { key: "source_file_id", label: "Source file", kind: "file" },
  { key: "proof_case_document_id", label: "Proof document (interest certificate)", kind: "doc" },
  { key: "notes", label: "Notes", kind: "text", helper: "Never store passwords, OTPs, PAN or Aadhaar here." },
];

// K4-14. Same discipline as the K4-10 block below: every helper states a
// fail-closed default or a legal consequence, because each of these fields
// decides what the engine is permitted to do with the record. The
// `adjustments` helper is the most load-bearing text on this screen — it is
// the only thing standing between a preparer and a silently-wrong business
// profit.
const BUSINESS_BOOKS_FIELDS: FieldDesc[] = [
  {
    key: "revenue",
    label: "Revenue / turnover / gross receipts",
    kind: "number",
    helper:
      "The declared gross figure for the year. Also tested against the Section 44AB audit threshold — " +
      "₹1,00,00,000 for a business, ₹50,00,000 for a profession. Above it the case needs a tax audit, " +
      "which this product does not handle, and the computation is held back.",
  },
  {
    key: "expenses",
    label: "Total expenses per the books",
    kind: "number",
    helper:
      "The declared total charged in the books. If this exceeds revenue the result is a business loss: " +
      "Section 70(1) set-off against positive current-year books rows is included only when their whole " +
      "aggregate remains zero or positive. A residual loss is held back because cross-head set-off and " +
      "carry-forward (Sections 71/72) are not modelled; it is never treated as ₹0 income.",
  },
  {
    key: "is_profession",
    label: "This is a profession (not a business)",
    kind: "boolean",
    helper:
      "Selects the Section 44AB threshold: ₹50,00,000 for a profession under 44AB(b), ₹1,00,00,000 for " +
      "a business under 44AB(a). Leave unchecked if unsure — that applies the business threshold.",
  },
  {
    key: "adjustments",
    label: "What do the books require under Sections 30-43D?",
    kind: "multi_enum",
    options: BUSINESS_BOOKS_ADJUSTMENT_DECLARATIONS,
    helper:
      "Required. Tick every adjustment that arises — this is a SET, not a single pick. " +
      "none_s30_43d is exclusive: tick it only if no depreciation, no Section 37/40/43B " +
      "disallowance and no presumptive-to-books move arises. depreciation_s32 computes for " +
      "a closed set of Appendix I standing classes when you also declare the book-depreciation " +
      "add-back, answer the additional-depreciation question, and name each block. " +
      "disallowance and a presumptive transition still hold the computation back.",
  },
  {
    key: "book_depreciation",
    label: "Book depreciation charged in the P&L",
    kind: "number",
    helper:
      "Required when depreciation_s32 is ticked. Added back before the Section 32(1)(ii) " +
      "allowance is deducted, because Explanation 5 applies whether or not the deduction " +
      "was claimed. Leave blank only when no Section 32 claim is being made.",
  },
  {
    key: "claims_additional_depreciation",
    label: "Does additional depreciation under Section 32(1)(iia) arise?",
    kind: "enum",
    options: ["false", "true"],
    blankOption: "— not declared (blocks a Section 32 claim) —",
    helper:
      "Required when depreciation_s32 is ticked. Additional depreciation is twenty per cent of " +
      "actual cost of new manufacturing plant and is not implemented. Answer false only if it " +
      "does not arise. true, or silence, holds the computation back.",
  },
  {
    key: "depreciation_blocks",
    label: "Section 32(1)(ii) Appendix I blocks",
    kind: "dep_blocks",
    helper:
      "Required when depreciation_s32 is ticked. Each block is one standing Appendix I class " +
      "with its declared written-down value. The engine multiplies WDV by the prescribed " +
      "percentage; it does not compute WDV under Section 43(6)(c). An unreadable or " +
      "specialised class is not listed and cannot be guessed. Put-to-use half-rate applies " +
      "the second proviso to Section 32(1) — fifty per cent of the calculated allowance — " +
      "only to assets acquired this year and used for less than 180 days.",
  },
  {
    key: "activity_classification",
    label: "Activity classification for loss set-off",
    kind: "enum",
    options: BUSINESS_BOOKS_ACTIVITY_CLASSIFICATIONS,
    blankOption: "— not declared (blocks computation) —",
    helper:
      "Required. Two classifications compute. Choose ordinary_business_or_profession only after confirming " +
      "this is not derivatives, speculation, or a Section 35AD specified business. Choose " +
      "fno_non_speculative_s43_5_d only if EVERY transaction in this undertaking is an eligible transaction " +
      "under Explanation 1 to Section 43(5) proviso (d) — carried out electronically on a recognised stock " +
      "exchange through a SEBI-registered intermediary, and supported by a time-stamped contract note showing " +
      "the unique client code and PAN; such an undertaking is not speculative and joins the ordinary Section 70 " +
      "pool. Everything else holds the whole books-business head back: futures_and_options is the honest answer " +
      "when you are NOT affirming that for every transaction, intraday_speculative_s43_5 covers intraday equity " +
      "squared off without delivery, and both speculation and specified-business losses sit in restricted pools " +
      "(Explanation 2 to Section 28 with Sections 73 and 73A) that this engine does not implement.",
  },
  {
    key: "declared_turnover",
    label: "Declared Section 44AB turnover (F&O only)",
    kind: "number",
    helper:
      "Required for fno_non_speculative_s43_5_d, and ignored for every other classification. No statutory, " +
      "CBDT or return-form source defines turnover for derivatives — not the Act, not the Income-tax Rules, " +
      "no circular or notification, and neither the ITR-3 instructions nor Form 3CD — so this product will " +
      "not derive it and will never treat declared revenue as turnover. State the figure yourself (the ICAI " +
      "Guidance Note on Tax Audit is the professional standard; the judgement remains yours), and it will be " +
      "tested against the Section 44AB threshold. Leave blank for an ordinary business or profession, whose " +
      "revenue already is its turnover.",
  },
  { key: "source_type", label: "Source", kind: "enum", options: SOURCE_TYPES },
  { key: "source_document_id", label: "Source document", kind: "doc" },
  { key: "source_file_id", label: "Source file", kind: "file" },
  { key: "proof_case_document_id", label: "Proof document (profit & loss / balance sheet)", kind: "doc" },
  { key: "notes", label: "Notes", kind: "text", helper: "Never store passwords, OTPs, PAN or Aadhaar here." },
];

// K4-10. Every helper here states a fail-closed default or a legal consequence
// rather than describing the widget, because each of these fields changes what
// the engine is permitted to do with the record.
const BROUGHT_FORWARD_LOSS_FIELDS: FieldDesc[] = [
  {
    key: "originating_assessment_year",
    label: "Originating assessment year",
    kind: "text",
    helper:
      "The assessment year the loss was FIRST computed in, as YYYY-YY (e.g. 2022-23). Section 74(2) " +
      "allows carry-forward for the 8 assessment years immediately after it, so this decides when " +
      "the loss expires — it is not a label.",
  },
  {
    key: "loss_type",
    label: "Loss type",
    kind: "enum",
    options: BROUGHT_FORWARD_LOSS_TYPES,
    helper:
      "Short-term (stcl) may be set off against either gain bucket; long-term (ltcl) only against " +
      "long-term gains (Section 74(1)).",
  },
  {
    key: "amount",
    label: "Unabsorbed loss brought forward",
    kind: "number",
    helper: "Enter as a positive amount — the direction is carried by the loss type, not the sign.",
  },
  {
    key: "filing_eligibility",
    label: "Loss return filed by the due date (Sections 139(3)/80)",
    kind: "enum",
    options: BROUGHT_FORWARD_FILING_ELIGIBILITIES,
    helper:
      "A loss is carryable at all only if that year's return was filed on time. Leave as " +
      "\"unverified\" until it is actually checked — an unverified record is never treated as " +
      "eligible, and the computation is held back rather than assuming it.",
  },
  {
    key: "loss_provenance",
    label: "Where this figure comes from",
    kind: "enum",
    options: BROUGHT_FORWARD_LOSS_PROVENANCES,
    helper:
      "A loss carried out of a finalized prior-year case in this system and a staff-declared figure " +
      "do not carry the same assurance, and the difference is shown to the preparer.",
  },
  {
    key: "elected_set_off_target",
    label: "Taxpayer-elected set-off target (optional)",
    kind: "enum",
    options: ELECTED_SET_OFF_TARGETS,
    helper:
      "Leave blank unless the taxpayer has actually elected a bucket. An election requires " +
      "professional review, is flagged for audit, and stops the case for review if it does not " +
      "reproduce current portal behaviour — it is never silently replaced or silently accepted.",
  },
  { key: "source_type", label: "Source", kind: "enum", options: SOURCE_TYPES },
  { key: "source_document_id", label: "Source document", kind: "doc" },
  { key: "source_file_id", label: "Source file", kind: "file" },
  {
    key: "proof_case_document_id",
    label: "Proof document (prior-year return / acknowledgement)",
    kind: "doc",
  },
  { key: "notes", label: "Notes", kind: "text", helper: "Never store passwords, OTPs, PAN or Aadhaar here." },
];

const CAPITAL_GAIN_FIELDS: FieldDesc[] = [
  { key: "gain_type", label: "Gain type", kind: "enum", options: GAIN_TYPES },
  { key: "sale_value", label: "Sale value / consideration", kind: "number" },
  { key: "cost", label: "Cost of acquisition", kind: "number" },
  { key: "expenses", label: "Transfer expenses", kind: "number" },
  { key: "exemption_claimed", label: "Exemption claimed (s.54 / s.54F)", kind: "number" },
  { key: "taxable_gain", label: "Taxable gain (111A/112A / other)", kind: "number", allowNegative: true },
  {
    key: "transfer_date",
    label: "Date of transfer",
    kind: "date",
    visibleWhen: { field: "gain_type", equals: "house_sale" },
    helper: "s.45(1) charges the previous year of transfer. This engine assesses FY 2025-26 only.",
  },
  {
    key: "acquisition_date",
    label: "Date of acquisition",
    kind: "date",
    visibleWhen: { field: "gain_type", equals: "house_sale" },
    helper:
      "s.2(42A): held for not more than twenty-four months → short-term, taxed at slab rates. Held longer → LONG-TERM, which computes the s.112 comparison: 12.5% on the unindexed gain against 20% on the gain indexed from the acquisition year, and the lower tax is adopted. A long-term sale needs two further declarations and has its own refusals — see the declarations field below.",
  },
  {
    key: "stamp_duty_value",
    label: "Stamp duty value",
    kind: "number",
    visibleWhen: { field: "gain_type", equals: "house_sale" },
    helper: "s.50C: if this exceeds 110% of consideration, it is deemed the full value.",
  },
  {
    key: "asset_kind",
    label: "Asset",
    kind: "enum",
    options: HOUSE_SALE_ASSET_KIND_DECLARATIONS,
    blankOption: "Not answered",
    visibleWhen: { field: "gain_type", equals: "house_sale" },
  },
  {
    key: "acquisition_mode",
    label: "How acquired",
    kind: "enum",
    options: HOUSE_SALE_ACQUISITION_MODE_DECLARATIONS,
    blankOption: "Not answered",
    visibleWhen: { field: "gain_type", equals: "house_sale" },
    helper: "Purchase only. Gift / inheritance / partition are s.49 and refuse.",
  },
  {
    key: "cost_of_improvement",
    label: "Cost of improvement",
    kind: "number",
    visibleWhen: { field: "gain_type", equals: "house_sale" },
  },
  {
    key: "house_sale_declarations",
    label: "Closed declarations",
    kind: "multi_enum",
    options: HOUSE_SALE_ALL_DECLARATIONS,
    visibleWhen: { field: "gain_type", equals: "house_sale" },
    helper:
      "The first four are required for ANY house sale. If the holding is LONG-TERM (held more than 24 months), 'amounts_are_assessee_share' and 'stamp_duty_value_accepted' are required too and the sale refuses without them. Silence is incomplete, never 'no'. This is not house-property income (s.22/23). A ticked exemption amount above refuses — s.54/s.54F are not implemented. A long-term sale also refuses if any cost of improvement is entered, if the property was acquired before 1 April 2001, or if the stamp-duty value is disputed under s.50C(2).",
  },
  ...SOURCE_FIELDS,
];

export default async function TaxDeskLedgersPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ __fault?: string | string[] }>;
}) {
  await requireUser();
  const { id } = await params;
  // Test-only, production-inert resilience fault seam (Phase K.2.9.7). Lets an
  // e2e/preview force this task screen to throw so the task-level `error.tsx`
  // boundary can be proven. No-op unless a dev/test trigger is present.
  await maybeInjectFault((await searchParams)?.__fault);
  const view = await getTaxCaseLedgers(id);
  if (!view) notFound();

  // Engine-derived support classification — the SAME authority Computation uses
  // (buildEngineInput warnings), reshaped per category. Computed from the
  // already-loaded rows; no extra DB requests. Distinct from source coverage.
  const support = classifyLedgerSupport(
    assembleCompleteLedgerRows({
      income: view.income,
      taxPaid: view.taxPaid,
      deductions: view.deductions,
      capitalGains: view.capitalGains,
      housePropertyEntries: view.houseProperty,
      businessBooksEntries: view.businessBooks,
      broughtForwardLosses: view.broughtForwardLosses,
    }),
    {
      assessmentYear: view.assessmentYear,
      financialYear: view.financialYear,
      selectedItrType: null, // ITR selection does not affect support classification
      finalized: view.locked,
    },
  );

  const categories: LedgerCategory[] = [
    {
      key: "income",
      title: "Income",
      totalLabel: "Total income",
      addLabel: "Add income entry",
      emptyHint: "Add salary, interest, dividend, or another supported income source.",
      fields: INCOME_FIELDS,
      rows: view.income,
      total: view.totals.income,
      unsupported: support.byCategory.income.unsupported,
      identityField: "income_head",
      amountField: "amount",
      onCreate: createIncomeEntryAction,
      onUpdate: updateIncomeEntryAction,
      onRemove: removeIncomeEntryAction,
    },
    {
      key: "taxPaid",
      title: "Tax Paid",
      totalLabel: "Total tax paid",
      addLabel: "Add tax-paid entry",
      emptyHint: "Add TDS, TCS, advance tax, or self-assessment tax.",
      fields: TAX_PAID_FIELDS,
      rows: view.taxPaid,
      total: view.totals.taxPaid,
      unsupported: support.byCategory.taxPaid.unsupported,
      identityField: "tax_paid_type",
      amountField: "amount",
      onCreate: createTaxPaidEntryAction,
      onUpdate: updateTaxPaidEntryAction,
      onRemove: removeTaxPaidEntryAction,
    },
    {
      key: "deductions",
      title: "Deductions",
      totalLabel: "Total deductions",
      addLabel: "Add deduction entry",
      emptyHint: "Add 80C, 80D, or other Chapter VI-A deductions.",
      fields: DEDUCTION_FIELDS,
      rows: view.deductions,
      total: view.totals.deductions,
      unsupported: support.byCategory.deductions.unsupported,
      identityField: "deduction_type",
      amountField: "amount",
      onCreate: createDeductionEntryAction,
      onUpdate: updateDeductionEntryAction,
      onRemove: removeDeductionEntryAction,
    },
    {
      key: "capitalGains",
      title: "Capital Gains",
      totalLabel: "Total taxable gain",
      addLabel: "Add capital-gain entry",
      emptyHint: "Add equity, property, or other capital-gain transactions.",
      fields: CAPITAL_GAIN_FIELDS,
      rows: view.capitalGains,
      total: view.totals.capitalGainsTaxable,
      unsupported: support.byCategory.capitalGains.unsupported,
      identityField: "gain_type",
      amountField: "taxable_gain",
      onCreate: createCapitalGainEntryAction,
      onUpdate: updateCapitalGainEntryAction,
      onRemove: removeCapitalGainEntryAction,
    },
    {
      key: "houseProperty",
      title: "House Property",
      totalLabel: "Net estimate (rent − municipal taxes − interest)",
      addLabel: "Add house property",
      emptyHint: "Is any property owned? Add it here — self-occupied or let-out.",
      fields: HOUSE_PROPERTY_FIELDS,
      rows: view.houseProperty,
      total: view.totals.houseProperty,
      unsupported: support.byCategory.houseProperty.unsupported,
      identityField: "usage",
      amountField: "annual_rent_received",
      onCreate: createHousePropertyEntryAction,
      onUpdate: updateHousePropertyEntryAction,
      onRemove: removeHousePropertyEntryAction,
    },
    {
      key: "businessBooks",
      title: "Business (books)",
      totalLabel: "Current-year books-business aggregate (revenue − expenses)",
      addLabel: "Add business (books)",
      emptyHint:
        "Is a business or profession run with books of account, rather than declared presumptively " +
        "under Section 44AD/44ADA? Add it here with its revenue and expense totals.",
      fields: BUSINESS_BOOKS_FIELDS,
      rows: view.businessBooks,
      total: view.totals.businessBooksNetProfit,
      unsupported: support.byCategory.businessBooks.unsupported,
      identityField: "adjustments",
      amountField: "net_estimate",
      onCreate: createBusinessBooksEntryAction,
      onUpdate: updateBusinessBooksEntryAction,
      onRemove: removeBusinessBooksEntryAction,
    },
    {
      key: "broughtForwardLosses",
      title: "Brought-forward Losses",
      totalLabel: "Total declared brought-forward loss",
      addLabel: "Add brought-forward loss",
      emptyHint:
        "Is an unabsorbed capital loss carried forward from an earlier assessment year? Add it here " +
        "with the year it was first computed in.",
      fields: BROUGHT_FORWARD_LOSS_FIELDS,
      rows: view.broughtForwardLosses,
      total: view.totals.broughtForwardLoss,
      unsupported: support.byCategory.broughtForwardLosses.unsupported,
      identityField: "loss_type",
      amountField: "amount",
      onCreate: createBroughtForwardLossEntryAction,
      onUpdate: updateBroughtForwardLossEntryAction,
      onRemove: removeBroughtForwardLossEntryAction,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight">Ledgers — {view.clientName}</h1>
        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
          Never store passwords, OTPs, PAN or Aadhaar in notes.
        </p>
      </div>

      <LedgerWorkspace
        taxCaseId={view.taxCaseId}
        locked={view.locked}
        categories={categories}
        totalUnsupported={support.unsupported}
        docOptions={view.docOptions}
        fileOptions={view.fileOptions}
      />
    </div>
  );
}
