/**
 * Physical-document custody display helper (K.2.9.4 status-copy). PURE — no
 * React/Next/Supabase. Deterministic and unit-testable.
 *
 * ONE truthful mapping from a custody row to its label + plain-language note, so
 * a document that has been RETURNED reads as returned — never as an outstanding
 * "return required" action. "Return required" is surfaced only while a return is
 * genuinely outstanding (the document is still in the practice's custody).
 */

export interface PhysicalCustodyRow {
  custody_status: string;
  return_required: boolean;
  returned_to?: string | null;
  returned_date?: string | null;
}

export interface PhysicalCustodyView {
  /** Badge label (humanized status). Carries a "return required" suffix ONLY
   *  while the return is actually outstanding. */
  badge: string;
  /** Plain-language status note: affirmative once returned, a warning while a
   *  return is still outstanding, otherwise null. */
  note: { tone: "success" | "warning"; text: string } | null;
  /** True only when a return to the client is still pending (in custody +
   *  required) — false once the document has been returned. */
  returnOutstanding: boolean;
}

const humanize = (s: string): string => s.replaceAll("_", " ");

export function describePhysicalCustody(d: PhysicalCustodyRow): PhysicalCustodyView {
  const returned = d.custody_status === "returned_to_client";
  const returnOutstanding = d.return_required && d.custody_status === "in_custody";

  const badge = humanize(d.custody_status) + (returnOutstanding ? " · return required" : "");

  let note: PhysicalCustodyView["note"] = null;
  if (returned) {
    const to = d.returned_to?.trim() || "client";
    note = {
      tone: "success",
      text: `Returned to ${to}${d.returned_date ? ` on ${d.returned_date}` : ""} — no return outstanding.`,
    };
  } else if (returnOutstanding) {
    note = { tone: "warning", text: "Return to client still required." };
  }

  return { badge, note, returnOutstanding };
}
