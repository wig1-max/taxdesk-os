"use client";

import { useState } from "react";
import { rowsVersion } from "@/components/ui/reconcile-core";
import { useReconciledAction } from "@/components/ui/use-reconciled-action";
import { UnconfirmedNotice } from "@/components/ui/reconcile-unconfirmed";
import { Surface, SectionHeader } from "@/components/ui/section";
import { StatusPill } from "@/components/ui/status";
import { FileWarning } from "lucide-react";
import {
  proposeSourceFactAction,
  decideSourceProposalAction,
  promoteSourceProposalPairAction,
} from "@/app/actions/tax-source-proposals";
import { proposalFactSpec, type ProposalFactKind } from "@/lib/tax-desk/source-proposals";
import type { DocumentProposalGroup, EligibleProposalDocument } from "@/lib/queries/tax-source-proposals";
import { cn, formatInr } from "@/lib/utils";

/**
 * K3-30 — minimal staff surface for the propose -> review -> promote workflow.
 * ONE synthetic Form-16-shaped source per document, exactly two facts (salary
 * income + salary TDS). A proposal is explicitly non-authoritative until a
 * human accepts it, and never ledger truth until BOTH facts for a document are
 * accepted and promoted together. This screen never claims parsing accuracy,
 * CA verification, or filing readiness.
 */
export function SourceProposalsPanel({
  taxCaseId,
  finalized,
  groups,
  eligibleDocuments,
}: {
  taxCaseId: string;
  finalized: boolean;
  groups: DocumentProposalGroup[];
  eligibleDocuments: EligibleProposalDocument[];
}) {
  const allRows = groups.flatMap((g) => g.proposals);
  const dataVersion = rowsVersion([
    { key: "proposals", total: allRows.length, rows: allRows.map((r) => ({ id: r.id, updated_at: r.updatedAt })) },
  ]);
  const { run, busy, error, unconfirmed, reload, clearError } = useReconciledAction({ dataVersion });

  if (groups.length === 0 && eligibleDocuments.length === 0) return null;

  return (
    <Surface className="p-4">
      <SectionHeader
        title="Synthetic Form 16 salary proposals"
        description="Candidate values only — never ledger truth until a human accepts BOTH facts and promotes them together."
        icon={<FileWarning className="h-4 w-4" />}
      />

      {!finalized && eligibleDocuments.length > 0 && (
        <ProposeForm
          taxCaseId={taxCaseId}
          eligibleDocuments={eligibleDocuments}
          busy={busy}
          run={run}
          clearError={clearError}
        />
      )}

      {(error || unconfirmed) && (
        <div className="mt-3">
          {error && (
            <p className="text-xs text-danger" role="status">
              {error}
            </p>
          )}
          {unconfirmed && (
            <UnconfirmedNotice onReload={reload} testId="source-proposals-unconfirmed">
              Saved, but the page couldn&apos;t confirm the update. Reload to verify.
            </UnconfirmedNotice>
          )}
        </div>
      )}

      {groups.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">No proposals yet.</p>
      ) : (
        <ul className="mt-4 space-y-4">
          {groups.map((g) => {
            // Once ANY proposal for this document has been promoted, the pair
            // is done — `pair.ready` stays true (it also certifies the pair is
            // safe to re-call idempotently), but the call-to-action must not
            // keep inviting a click that has nothing left to do.
            const alreadyPromoted = g.proposals.some((p) => p.status === "promoted");
            return (
            <li key={g.caseDocumentId} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">{g.documentName}</span>
                {g.pair.ready && !finalized && !alreadyPromoted && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      clearError();
                      run(() =>
                        promoteSourceProposalPairAction({ taxCaseId, caseDocumentId: g.caseDocumentId }),
                      );
                    }}
                    aria-label={`Promote accepted salary facts for ${g.documentName} into the ledgers`}
                    className="inline-flex h-11 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
                  >
                    {busy ? "Working…" : "Promote to ledgers"}
                  </button>
                )}
              </div>
              <ul className="mt-2 divide-y">
                {g.proposals.map((p) => (
                  <ProposalRow
                    key={p.id}
                    taxCaseId={taxCaseId}
                    documentName={g.documentName}
                    finalized={finalized}
                    busy={busy}
                    run={run}
                    clearError={clearError}
                    id={p.id}
                    factKind={p.factKind}
                    proposedValue={p.proposedValue}
                    status={p.status}
                    decisionReason={p.decisionReason}
                  />
                ))}
              </ul>
            </li>
            );
          })}
        </ul>
      )}
    </Surface>
  );
}

function ProposeForm({
  taxCaseId,
  eligibleDocuments,
  busy,
  run,
  clearError,
}: {
  taxCaseId: string;
  eligibleDocuments: EligibleProposalDocument[];
  busy: boolean;
  run: (action: () => Promise<{ ok: boolean; error?: string }>, onReconciled?: () => void) => void;
  clearError: () => void;
}) {
  const [caseDocumentId, setCaseDocumentId] = useState("");
  const [factKind, setFactKind] = useState<ProposalFactKind | "">("");
  const [proposedValue, setProposedValue] = useState("");
  const [localErr, setLocalErr] = useState<string | null>(null);

  const doc = eligibleDocuments.find((d) => d.id === caseDocumentId);
  const factOptions = doc?.openFactKinds ?? [];

  function submit() {
    setLocalErr(null);
    if (!caseDocumentId || !factKind) {
      setLocalErr("Pick a document and a fact to propose.");
      return;
    }
    const value = Number(proposedValue);
    if (!Number.isFinite(value) || value < 0) {
      setLocalErr("Enter a non-negative amount.");
      return;
    }
    clearError();
    run(
      () => proposeSourceFactAction({ taxCaseId, caseDocumentId, factKind, proposedValue: value }),
      () => {
        setCaseDocumentId("");
        setFactKind("");
        setProposedValue("");
      },
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 rounded-md border bg-muted/20 p-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="proposal-doc" className="text-[11px] text-muted-foreground">
          Source document
        </label>
        <select
          id="proposal-doc"
          value={caseDocumentId}
          onChange={(e) => {
            setCaseDocumentId(e.target.value);
            setFactKind("");
          }}
          className="h-11 min-w-[10rem] rounded-md border border-input bg-background px-2 text-xs"
        >
          <option value="">choose…</option>
          {eligibleDocuments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="proposal-fact" className="text-[11px] text-muted-foreground">
          Fact
        </label>
        <select
          id="proposal-fact"
          value={factKind}
          onChange={(e) => setFactKind(e.target.value as ProposalFactKind)}
          disabled={!caseDocumentId}
          className="h-11 min-w-[9rem] rounded-md border border-input bg-background px-2 text-xs disabled:opacity-50"
        >
          <option value="">choose…</option>
          {factOptions.map((k) => (
            <option key={k} value={k}>
              {proposalFactSpec(k).label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="proposal-value" className="text-[11px] text-muted-foreground">
          Proposed amount (₹)
        </label>
        <input
          id="proposal-value"
          type="number"
          min="0"
          step="1"
          value={proposedValue}
          onChange={(e) => setProposedValue(e.target.value)}
          className="h-11 w-32 rounded-md border border-input bg-background px-2 text-xs"
        />
      </div>
      <button
        type="button"
        onClick={submit}
        disabled={busy}
        aria-label="Record this as a proposed fact, not yet ledger truth"
        className="inline-flex h-11 items-center rounded-md bg-secondary px-3 text-xs font-medium disabled:opacity-50"
      >
        {busy ? "Working…" : "Propose"}
      </button>
      {localErr && (
        <span className="text-xs text-danger" role="status">
          {localErr}
        </span>
      )}
    </div>
  );
}

function ProposalRow({
  taxCaseId,
  documentName,
  finalized,
  busy,
  run,
  clearError,
  id,
  factKind,
  proposedValue,
  status,
  decisionReason,
}: {
  taxCaseId: string;
  documentName: string;
  finalized: boolean;
  busy: boolean;
  run: (action: () => Promise<{ ok: boolean; error?: string }>, onReconciled?: () => void) => void;
  clearError: () => void;
  id: string;
  factKind: ProposalFactKind;
  proposedValue: number;
  status: "proposed" | "accepted" | "rejected" | "promoted";
  decisionReason: string | null;
}) {
  const [reason, setReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const spec = proposalFactSpec(factKind);

  function decide(decision: "accept" | "reject") {
    if (decision === "reject" && !reason.trim()) {
      setShowReject(true);
      return;
    }
    clearError();
    run(() =>
      decideSourceProposalAction({
        taxCaseId,
        proposalId: id,
        decision,
        reason: decision === "reject" ? reason.trim() : undefined,
      }),
    );
  }

  return (
    <li className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium">{spec.label}</span>
          <span className="tnum text-xs text-muted-foreground">{formatInr(proposedValue)}</span>
          <StatusPill code={status} />
          <span className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">proposal — not authoritative</span>
        </div>
        {decisionReason && <p className="text-[0.7rem] text-muted-foreground">Reason: {decisionReason}</p>}
      </div>
      {!finalized && status === "proposed" && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => decide("accept")}
            aria-label={`Accept proposed ${spec.label} for ${documentName}`}
            className={cn(
              "inline-flex h-11 items-center rounded-md border border-success-border bg-success-soft px-2.5 text-xs font-medium text-success disabled:opacity-50",
            )}
          >
            Accept
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => decide("reject")}
            aria-label={`Reject proposed ${spec.label} for ${documentName}`}
            className="inline-flex h-11 items-center rounded-md border border-danger-border bg-danger-soft px-2.5 text-xs font-medium text-danger disabled:opacity-50"
          >
            Reject
          </button>
          {showReject && (
            <input
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for rejection (required)"
              aria-label={`Reason for rejecting ${spec.label}`}
              className="h-11 w-56 rounded-md border border-input bg-background px-2 text-xs"
            />
          )}
        </div>
      )}
    </li>
  );
}
