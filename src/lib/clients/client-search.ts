/**
 * Shared shape + cap for the New Case client picker (`K3-ENV-4`).
 *
 * These live OUTSIDE `src/app/actions/clients.ts` because a `"use server"`
 * module may export only async functions — exporting a plain const from there
 * is a build error (and one `tsc` does not catch, since it is a Next/SWC rule).
 */

export interface ClientSearchOption {
  id: string;
  label: string;
}

/** Result cap. Small on purpose: a picker list, not a data export. */
export const CLIENT_SEARCH_LIMIT = 20;

/** The single place the picker's display label is composed. */
export function clientSearchLabel(row: { full_name: string; primary_phone: string }): string {
  return `${row.full_name} (${row.primary_phone})`;
}
