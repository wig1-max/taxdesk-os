/**
 * Database types.
 *
 * TARGET: generate the full Database type from the live schema —
 *
 *   supabase gen types typescript --local > src/lib/db/database.types.ts
 *   (or --project-id <ref> for hosted)
 *
 * — then re-export it here. Until Phase D wires that in, the narrow
 * hand-written types below cover what the scaffold references. They
 * must stay in sync with supabase/migrations/000001_initial_schema.sql.
 */

export type UserRole = "admin" | "staff";

export type WorkflowType = "full" | "lead" | "generic";

export type CaseDocumentStatus =
  | "pending"
  | "requested"
  | "received"
  | "verified"
  | "waived"
  | "rejected";

export type FileReviewStatus = "uploaded" | "verified" | "rejected";

export type CustodyStatus =
  | "expected"
  | "in_custody"
  | "dispatched"
  | "returned_to_client"
  | "lost";

export type MatchStatus = "not_checked" | "match" | "mismatch" | "na";

export type FeeStatus =
  | "draft"
  | "agreed"
  | "partially_paid"
  | "paid"
  | "waived";

/** Row shape of the clients_safe view — never contains pan_encrypted. */
export interface ClientSafeRow {
  id: string;
  display_code: string | null;
  full_name: string;
  primary_phone: string;
  email: string | null;
  pan_last4: string | null;
  pan_masked: string | null;
  date_of_birth: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  kyc_status: "pending" | "partial" | "done";
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Shape of services.status_flow JSONB (seeded in 000004). */
export interface StatusFlow {
  initial: string;
  terminal: string[];
  hold?: string;
  filing_confirmation_required?: string[];
  guards?: Record<string, string[]>;
  compliance_note?: string;
  statuses: Array<{
    code: string;
    label: string;
    next_action: string;
  }>;
}
