import { describe, expect, it } from "vitest";
import { checkTransition, type TransitionContext } from "@/lib/status-flow";
import type { StatusFlow } from "@/lib/db/types";

const ITR_FLOW: StatusFlow = {
  initial: "new_lead",
  terminal: ["completed"],
  hold: "on_hold",
  filing_confirmation_required: ["filed"],
  statuses: [
    "new_lead",
    "basic_details_pending",
    "documents_pending",
    "documents_received",
    "computation_in_progress",
    "client_approval_pending",
    "approved_by_client",
    "filed",
    "e_verified",
    "completed",
    "on_hold",
  ].map((code) => ({ code, label: code, next_action: `do ${code}` })),
};

const IEPF_FLOW: StatusFlow = {
  initial: "new_lead",
  terminal: ["completed"],
  hold: "on_hold",
  filing_confirmation_required: ["iepf5_uploaded", "srn_generated"],
  statuses: [
    "new_lead",
    "folio_details_pending",
    "documents_pending",
    "documents_received",
    "documents_verified",
    "authorization_signed",
    "fee_agreement_signed",
    "iepf5_preparation",
    "iepf5_uploaded",
    "srn_generated",
    "dispatch_pending",
    "sent_to_rta",
    "objection_received",
    "objection_reply_pending",
    "under_verification",
    "approved",
    "credited",
    "balance_fee_pending",
    "completed",
    "on_hold",
  ].map((code) => ({ code, label: code, next_action: `do ${code}` })),
};

const staff: TransitionContext = { isAdmin: false };
const admin: TransitionContext = { isAdmin: true };

const iepfReady: Partial<TransitionContext> = {
  identityReviewComplete: true,
  authorizationVerified: true,
  feeAgreementVerified: true,
  upfrontPaidTotal: 5000,
  requiredUpfront: 5000,
};

describe("generic transition rules", () => {
  it("allows a simple forward step", () => {
    expect(checkTransition(ITR_FLOW, "itr", "new_lead", "basic_details_pending", staff).ok).toBe(true);
  });
  it("rejects unknown target status", () => {
    expect(checkTransition(ITR_FLOW, "itr", "new_lead", "banana", staff).ok).toBe(false);
  });
  it("rejects same-status transition", () => {
    expect(checkTransition(ITR_FLOW, "itr", "filed", "filed", staff).ok).toBe(false);
  });
  it("backward requires a reason", () => {
    expect(
      checkTransition(ITR_FLOW, "itr", "documents_received", "documents_pending", staff).ok
    ).toBe(false);
    expect(
      checkTransition(ITR_FLOW, "itr", "documents_received", "documents_pending", {
        ...staff,
        reason: "client sent wrong Form 16",
      }).ok
    ).toBe(true);
  });
  it("hold requires a reason, from anywhere", () => {
    expect(checkTransition(ITR_FLOW, "itr", "filed", "on_hold", staff).ok).toBe(false);
    expect(
      checkTransition(ITR_FLOW, "itr", "filed", "on_hold", { ...staff, reason: "client abroad" }).ok
    ).toBe(true);
  });
  it("skipping ahead needs admin + reason", () => {
    expect(
      checkTransition(ITR_FLOW, "itr", "new_lead", "documents_received", staff).ok
    ).toBe(false);
    expect(
      checkTransition(ITR_FLOW, "itr", "new_lead", "documents_received", admin).ok
    ).toBe(false); // no reason
    expect(
      checkTransition(ITR_FLOW, "itr", "new_lead", "documents_received", {
        ...admin,
        reason: "docs walked in",
      }).ok
    ).toBe(true);
  });
});

describe("ITR guardrails", () => {
  it("cannot file before client approval, even as admin with reason", () => {
    const r = checkTransition(ITR_FLOW, "itr", "computation_in_progress", "filed", {
      ...admin,
      reason: "hurry",
      confirmedManualAction: true,
    });
    expect(r.ok).toBe(false);
  });
  it("filing from approved_by_client needs manual confirmation", () => {
    expect(
      checkTransition(ITR_FLOW, "itr", "approved_by_client", "filed", staff).ok
    ).toBe(false);
    expect(
      checkTransition(ITR_FLOW, "itr", "approved_by_client", "filed", {
        ...staff,
        confirmedManualAction: true,
      }).ok
    ).toBe(true);
  });
});

describe("IEPF guardrails", () => {
  it("blocks iepf5_preparation until identity review complete", () => {
    const r = checkTransition(IEPF_FLOW, "iepf", "fee_agreement_signed", "iepf5_preparation", {
      ...staff,
      ...iepfReady,
      identityReviewComplete: false,
    });
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/identity review/i);
  });
  it("blocks iepf5_preparation until authorization + fee agreement verified", () => {
    expect(
      checkTransition(IEPF_FLOW, "iepf", "fee_agreement_signed", "iepf5_preparation", {
        ...staff,
        ...iepfReady,
        authorizationVerified: false,
      }).ok
    ).toBe(false);
    expect(
      checkTransition(IEPF_FLOW, "iepf", "fee_agreement_signed", "iepf5_preparation", {
        ...staff,
        ...iepfReady,
        feeAgreementVerified: false,
      }).ok
    ).toBe(false);
  });
  it("blocks iepf5_preparation until ₹5,000 upfront recorded (admin+reason can override)", () => {
    expect(
      checkTransition(IEPF_FLOW, "iepf", "fee_agreement_signed", "iepf5_preparation", {
        ...staff,
        ...iepfReady,
        upfrontPaidTotal: 2000,
      }).ok
    ).toBe(false);
    expect(
      checkTransition(IEPF_FLOW, "iepf", "fee_agreement_signed", "iepf5_preparation", {
        ...admin,
        ...iepfReady,
        upfrontPaidTotal: 2000,
        reason: "owner approved deferred upfront",
      }).ok
    ).toBe(true);
  });
  it("allows iepf5_preparation when all guards pass", () => {
    expect(
      checkTransition(IEPF_FLOW, "iepf", "fee_agreement_signed", "iepf5_preparation", {
        ...staff,
        ...iepfReady,
      }).ok
    ).toBe(true);
  });
  it("iepf5_uploaded / srn_generated need manual filing confirmation", () => {
    expect(
      checkTransition(IEPF_FLOW, "iepf", "iepf5_preparation", "iepf5_uploaded", staff).ok
    ).toBe(false);
    expect(
      checkTransition(IEPF_FLOW, "iepf", "iepf5_preparation", "iepf5_uploaded", {
        ...staff,
        confirmedManualAction: true,
      }).ok
    ).toBe(true);
  });
  it("cannot complete with balance due unless admin + reason", () => {
    expect(
      checkTransition(IEPF_FLOW, "iepf", "balance_fee_pending", "completed", {
        ...staff,
        balanceFeeDue: 31000,
      }).ok
    ).toBe(false);
    expect(
      checkTransition(IEPF_FLOW, "iepf", "balance_fee_pending", "completed", {
        ...admin,
        balanceFeeDue: 31000,
        reason: "written off by owner",
      }).ok
    ).toBe(true);
    expect(
      checkTransition(IEPF_FLOW, "iepf", "balance_fee_pending", "completed", {
        ...staff,
        balanceFeeDue: 0,
      }).ok
    ).toBe(true);
  });
});
