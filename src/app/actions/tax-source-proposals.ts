"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createClient as createServerClient } from "@/lib/supabase/server";
import {
  PROPOSAL_SOURCE_SCHEMA_VERSION,
  SYNTHETIC_PROPOSAL_ADAPTER_VERSION,
  assertNoRealIdentifierShape,
  checkProposalEnvelope,
} from "@/lib/tax-desk/source-proposals";

/**
 * K3-30 — one-source propose -> review -> promote actions. Every write
 * re-verifies auth and delegates the atomic/idempotent guard logic to the
 * three SECURITY DEFINER RPCs in
 * `supabase/migrations/20260721120000_source_proposal_workflow.sql`; this
 * layer never trusts client-sent status/ownership and only classifies the
 * RPC's refusal into a stable, readable message (same convention as
 * `tax-reviewer.ts`).
 */

type ActionResult = { ok: boolean; error?: string };

function revalidate(taxCaseId: string) {
  revalidatePath(`/tax-desk/cases/${taxCaseId}/documents`);
  revalidatePath(`/tax-desk/cases/${taxCaseId}`);
}

function classifyError(message: string | undefined): string {
  const msg = message ?? "";
  if (/finalized/i.test(msg)) return "This tax case is finalized and read-only.";
  if (/not authorized/i.test(msg)) return "Not authorized.";
  if (/does not belong to this case/i.test(msg)) return "That document does not belong to this case.";
  if (/not been uploaded yet/i.test(msg)) return "That document has not been uploaded yet.";
  if (/live proposal for this fact already exists/i.test(msg))
    return "A proposal for this fact already exists for this document.";
  if (/document not found|tax case not found|proposal not found|no proposals exist/i.test(msg))
    return "Not found.";
  if (/already been decided/i.test(msg)) return "This proposal has already been decided.";
  if (/reason is required/i.test(msg)) return "A reason is required to reject a proposal.";
  if (/already used to record a different decision/i.test(msg))
    return "This decision conflicts with one already recorded — reload and check its current state.";
  if (/incomplete pair/i.test(msg)) return "Both salary income and salary TDS must be proposed before promotion.";
  if (/must be accepted before promotion/i.test(msg))
    return "Both facts must be accepted before this document can be promoted.";
  if (/inconsistent promotion state/i.test(msg)) return "Could not promote — inconsistent state. Contact an admin.";
  return "Could not complete the request.";
}

const proposeSchema = z.object({
  taxCaseId: z.string().uuid(),
  caseDocumentId: z.string().uuid(),
  factKind: z.enum(["income.salary", "tax_paid.salary_tds"]),
  proposedValue: z.coerce.number().finite().min(0),
});

export async function proposeSourceFactAction(input: unknown): Promise<ActionResult> {
  await requireUser();
  const parsed = proposeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const envelopeCheck = checkProposalEnvelope({
    sourceSchemaKind: "Form16",
    sourceSchemaVersion: PROPOSAL_SOURCE_SCHEMA_VERSION,
    adapterVersion: SYNTHETIC_PROPOSAL_ADAPTER_VERSION,
    factKind: d.factKind,
    proposedValue: d.proposedValue,
  });
  if (!envelopeCheck.ok) return { ok: false, error: envelopeCheck.reason };

  const supabase = await createServerClient();
  const { error } = await supabase.rpc("propose_source_fact", {
    p_tax_case_id: d.taxCaseId,
    p_case_document_id: d.caseDocumentId,
    p_fact_kind: d.factKind,
    p_proposed_value: d.proposedValue,
    p_source_schema_version: PROPOSAL_SOURCE_SCHEMA_VERSION,
    p_adapter_version: SYNTHETIC_PROPOSAL_ADAPTER_VERSION,
    p_event_id: crypto.randomUUID(),
  });
  if (error) return { ok: false, error: classifyError(error.message) };

  revalidate(d.taxCaseId);
  return { ok: true };
}

const reasonSchema = z.preprocess(
  (v) => (v === "" || v === null ? undefined : v),
  z.string().trim().max(500, "Keep the reason under 500 characters.").optional(),
);

const decideSchema = z.object({
  taxCaseId: z.string().uuid(),
  proposalId: z.string().uuid(),
  decision: z.enum(["accept", "reject"]),
  reason: reasonSchema,
});

export async function decideSourceProposalAction(input: unknown): Promise<ActionResult> {
  await requireUser();
  const parsed = decideSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  if (d.decision === "reject" && !d.reason) {
    return { ok: false, error: "A reason is required to reject a proposal." };
  }
  if (d.reason) {
    try {
      assertNoRealIdentifierShape(d.reason, "Reason");
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Invalid reason." };
    }
  }

  const supabase = await createServerClient();
  const { error } = await supabase.rpc("decide_source_proposal", {
    p_proposal_id: d.proposalId,
    p_decision: d.decision,
    p_reason: d.reason ?? null,
    p_event_id: crypto.randomUUID(),
  });
  if (error) return { ok: false, error: classifyError(error.message) };

  revalidate(d.taxCaseId);
  return { ok: true };
}

const promoteSchema = z.object({
  taxCaseId: z.string().uuid(),
  caseDocumentId: z.string().uuid(),
});

export async function promoteSourceProposalPairAction(input: unknown): Promise<ActionResult> {
  await requireUser();
  const parsed = promoteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const supabase = await createServerClient();
  const { error } = await supabase.rpc("promote_source_proposal_pair", {
    p_case_document_id: d.caseDocumentId,
    p_event_id: crypto.randomUUID(),
  });
  if (error) return { ok: false, error: classifyError(error.message) };

  revalidate(d.taxCaseId);
  revalidatePath(`/tax-desk/cases/${d.taxCaseId}/ledgers`);
  return { ok: true };
}
