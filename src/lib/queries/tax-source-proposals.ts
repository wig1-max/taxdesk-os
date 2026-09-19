import { createClient as createServerClient } from "@/lib/supabase/server";
import {
  assessPairReadiness,
  isProposalFactKind,
  summarizeProposalWork,
  type PairReadiness,
  type ProposalFactKind,
  type ProposalStatus,
  type ProposalWorkSummary,
} from "@/lib/tax-desk/source-proposals";
import type { PromotedProposalLineage } from "@/lib/tax-desk/case-traceability";

/**
 * Read model for the K3-30 propose -> review -> promote workflow. Session
 * client (RLS applies) — mirrors the rest of `queries/tax-*.ts`. Read-only;
 * every mutation goes through `app/actions/tax-source-proposals.ts`.
 */

export interface SourceProposalRow {
  id: string;
  caseDocumentId: string;
  factKind: ProposalFactKind;
  proposedValue: number;
  status: ProposalStatus;
  decisionReason: string | null;
  decidedAt: string | null;
  promotedLedgerEntryId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentProposalGroup {
  caseDocumentId: string;
  documentName: string;
  /** Newest first; includes superseded (rejected) rows for audit visibility. */
  proposals: SourceProposalRow[];
  pair: PairReadiness;
  /** The CURRENT (newest non-superseded) status per fact — a rejected reading
   *  may have been superseded by a fresh proposal, so this is never a simple
   *  "latest row" read. Used by `workSummary` below. */
  currentByFact: Partial<Record<ProposalFactKind, ProposalStatus>>;
}

export interface EligibleProposalDocument {
  id: string;
  name: string;
  /** Fact kinds this document does not yet have a LIVE (non-rejected) proposal for. */
  openFactKinds: ProposalFactKind[];
}

export interface SourceProposalsView {
  taxCaseId: string;
  caseId: string;
  finalized: boolean;
  groups: DocumentProposalGroup[];
  eligibleDocuments: EligibleProposalDocument[];
  /** K3-31: outstanding proposal work across every document on this case —
   *  the summary a preparer-facing surface OTHER than this Documents page may
   *  show, always linking back here for the itemised detail. */
  workSummary: ProposalWorkSummary;
}

const FACT_KINDS: readonly ProposalFactKind[] = ["income.salary", "tax_paid.salary_tds"];

export async function getSourceProposalsView(taxCaseId: string): Promise<SourceProposalsView | null> {
  const supabase = await createServerClient();
  const { data: tc } = await supabase
    .from("tax_cases")
    .select("id, case_id, finalized_at")
    .eq("id", taxCaseId)
    .maybeSingle();
  if (!tc) return null;

  const caseId: string = tc.case_id;

  const [{ data: proposalRows }, { data: docRows }, { data: fileRows }] = await Promise.all([
    supabase
      .from("tax_source_proposals")
      .select(
        "id, case_document_id, fact_kind, proposed_value, status, decision_reason, decided_at, promoted_ledger_entry_id, created_at, updated_at",
      )
      .eq("tax_case_id", taxCaseId)
      .order("created_at", { ascending: false }),
    supabase.from("case_documents").select("id, name").eq("case_id", caseId).is("deleted_at", null),
    supabase.from("uploaded_files").select("case_document_id").eq("case_id", caseId).is("deleted_at", null),
  ]);

  const docNameById = new Map<string, string>((docRows ?? []).map((d) => [d.id, d.name]));
  const ingestedDocIds = new Set<string>(
    (fileRows ?? []).map((f) => f.case_document_id).filter((id): id is string => !!id),
  );

  const rowsByDoc = new Map<string, SourceProposalRow[]>();
  for (const r of proposalRows ?? []) {
    if (!isProposalFactKind(r.fact_kind)) continue; // defensive: closed vocabulary
    const row: SourceProposalRow = {
      id: r.id,
      caseDocumentId: r.case_document_id,
      factKind: r.fact_kind,
      proposedValue: Number(r.proposed_value),
      status: r.status as ProposalStatus,
      decisionReason: r.decision_reason,
      decidedAt: r.decided_at,
      promotedLedgerEntryId: r.promoted_ledger_entry_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
    const list = rowsByDoc.get(row.caseDocumentId) ?? [];
    list.push(row);
    rowsByDoc.set(row.caseDocumentId, list);
  }

  const groups: DocumentProposalGroup[] = [];
  for (const [caseDocumentId, rows] of rowsByDoc) {
    // rows are newest-first (query order); the CURRENT status per fact is the
    // first (newest) row for that fact — a rejected reading may have been
    // superseded by a fresh, corrected proposal.
    const currentByFact: Partial<Record<ProposalFactKind, ProposalStatus>> = {};
    for (const row of rows) {
      if (!(row.factKind in currentByFact)) currentByFact[row.factKind] = row.status;
    }
    groups.push({
      caseDocumentId,
      documentName: docNameById.get(caseDocumentId) ?? "(document removed)",
      proposals: rows,
      pair: assessPairReadiness(currentByFact),
      currentByFact,
    });
  }
  groups.sort((a, b) => a.documentName.localeCompare(b.documentName));

  const workSummary = summarizeProposalWork(
    groups.flatMap((g) => Object.values(g.currentByFact) as ProposalStatus[]),
  );

  const eligibleDocuments: EligibleProposalDocument[] = [...ingestedDocIds]
    .map((id) => {
      const rows = rowsByDoc.get(id) ?? [];
      const liveFactKinds = new Set(
        rows.filter((r) => r.status !== "rejected").map((r) => r.factKind),
      );
      const openFactKinds = FACT_KINDS.filter((k) => !liveFactKinds.has(k));
      return { id, name: docNameById.get(id) ?? "(document removed)", openFactKinds };
    })
    .filter((d) => d.openFactKinds.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    taxCaseId,
    caseId,
    finalized: !!tc.finalized_at,
    groups,
    eligibleDocuments,
    workSummary,
  };
}

/**
 * K3-31: promoted-proposal lineage for a case, for the case-traceability read
 * model (`describeCaseTraceability`'s `promotedProposals` argument). Reads
 * ONLY `status = 'promoted'` rows — proposed/accepted-not-promoted/rejected
 * rows never produced a ledger row, so they have no lineage to attach and are
 * correctly absent from this list (see `resolvePromotedProposalLineage`,
 * which additionally never trusts `source_type` alone).
 */
export async function getPromotedProposalLineage(taxCaseId: string): Promise<PromotedProposalLineage[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("tax_source_proposals")
    .select(
      "id, tax_case_id, fact_kind, case_document_id, promoted_ledger_kind, promoted_ledger_entry_id, " +
        "decided_at, promoted_at, " +
        "decided_by_user:decided_by(full_name), promoted_by_user:promoted_by(full_name)",
    )
    .eq("tax_case_id", taxCaseId)
    .eq("status", "promoted");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[])
    .filter(
      (r) =>
        isProposalFactKind(r.fact_kind) &&
        (r.promoted_ledger_kind === "income" || r.promoted_ledger_kind === "tax_paid") &&
        !!r.promoted_ledger_entry_id,
    )
    .map((r) => ({
      proposalId: r.id,
      taxCaseId: r.tax_case_id,
      factKind: r.fact_kind as ProposalFactKind,
      sourceDocumentId: r.case_document_id,
      promotedLedgerKind: r.promoted_ledger_kind as "income" | "tax_paid",
      promotedLedgerEntryId: r.promoted_ledger_entry_id,
      decidedByName: r.decided_by_user?.full_name ?? null,
      decidedAt: r.decided_at,
      promotedByName: r.promoted_by_user?.full_name ?? null,
      promotedAt: r.promoted_at,
    }));
}
