/**
 * K4-23 — Cost Inflation Index for AY 2026-27 / Income-tax Act, 1961.
 *
 * PURE. The CII values live here and nowhere else.
 *
 * AUTHORITY. s.48 Explanation (v) defines the Cost Inflation Index as
 * "such Index as the Central Government may ... by notification in the
 * Official Gazette, specify". Every value below is therefore a NOTIFIED
 * figure, not a computed one, and each carries the notification that
 * supplies it. Explanation (iii) and (iv) define the indexed cost of
 * acquisition and of any improvement in terms of it.
 *
 * SOURCE STATE, PER YEAR, stated plainly rather than implied.
 * Each row carries its own `evidence` marker, and that marker is the
 * authority — not this comment, and not the count in any prose that quotes
 * it.
 *
 * `K4-24` PHASE 0 CLOSED THE LAST GAP: ALL TWENTY-FIVE VALUES ARE NOW
 * `instrument`. Five of them read `owner_decided` from `K4-23` (`D337`)
 * until `K4-SOURCE-07` (`D343`) retrieved the five outstanding CBDT
 * notifications from the official e-Gazette through its `Search by
 * Ministry` form — a route earlier sessions had not tried. The superseded
 * sentence, retained because it is the record of a gap that stood for two
 * sessions (`PROJECT_CONSTITUTION.md` §4): *"`owner_decided` (5 of 25):
 * FY 2018-19, 2019-20, 2020-21, 2021-22 and 2022-23 … What backs these
 * five is the owner's bounded tax instruction under `D337` …
 * CORROBORATED by footnote 48c of `K4-PORT-04-S2`."*
 *
 * NO VALUE MOVED WHEN THE MARKERS DID. Every one of the five indices was
 * read back from its own committed three-mode extract before the marker
 * was changed, and each instrument states exactly the figure already
 * recorded here. Had one disagreed, that would have been a tax question
 * for the owner (§2 rule 5), not a fix.
 *
 * THE SUPPLYING INSTRUMENTS, each registered in
 * `docs/evidence/statutory-sources/manifest.json` with its bytes and
 * SHA-256, and each committed as a three-mode extract:
 *
 *   - `K4-23-S1` — Notification 44/2017, S.O. 1790(E), 5 June 2017. The
 *     PRINCIPAL notification; it alone supplies FY 2001-02 to FY 2017-18
 *     (serials 1-17). Every later notification amends this table.
 *   - `K4-SOURCE-07-CII-2018` — Notification 26/2018, S.O. 2413(E),
 *     13 June 2018 — serial 18, FY 2018-19.
 *   - `K4-SOURCE-07-CII-2019` — Notification 63/2019, S.O. 3266(E),
 *     12 September 2019 — serial 19, FY 2019-20.
 *   - `K4-SOURCE-07-CII-2020` — Notification 32/2020, S.O. 1879(E),
 *     12 June 2020 — serial 20, FY 2020-21.
 *   - `K4-SOURCE-07-CII-2021` — Notification 73/2021, S.O. 2336(E),
 *     15 June 2021 — serial 21, FY 2021-22.
 *   - `K4-SOURCE-07-CII-2022` — Notification 62/2022, S.O. 2735(E),
 *     14 June 2022 — serial 22, FY 2022-23.
 *   - `K4-23-S2` — Notification 39/2023, S.O. 2571(E) — serial 23.
 *   - `K4-23-S3` — Notification 44/2024, S.O. 2103(E) — serial 24.
 *   - `K4-SOURCE-04-S1` — Notification 70/2025, S.O. 2954(E) — serial 25.
 *
 * THE RECITAL CHAIN RUNS UNBROKEN FROM FY 2001-02 TO FY 2025-26, and that
 * is a stronger completeness check than counting rows: each notification
 * names the one it amends, so a missing link would show as a break rather
 * than as a short table.
 *
 * `owner_decided` IS RETAINED IN THE TYPE AT ZERO USES, AND DELIBERATELY.
 * A marker deleted for want of a current user is one the next session
 * invents ad hoc under a different name — the reasoning `D315` applied to
 * `QUOTE_EDITORIAL_BRACKET`. A future assessment year's index will exist
 * as an owner instruction before its Gazette copy is held, and that is
 * exactly the state this marker names. Its zero-use count is asserted.
 */

/** The first financial year the index runs from -- s.48 Explanation (iii). */
export const CII_BASE_FINANCIAL_YEAR = "2001-02";

/** The assessment year this engine computes; its previous year is FY 2025-26. */
export const CII_TRANSFER_FINANCIAL_YEAR = "2025-26";

/**
 * How a value's supplying instrument is held. `instrument` means the
 * notification itself is registered in the manifest with its SHA-256 and
 * committed as a three-mode extract, so the figure can be read back from
 * the source in a bare clone. `owner_decided` means the value rests on the
 * owner's stated tax instruction as this repository's deciding tax
 * authority (`PROJECT_CONSTITUTION.md` §2 rule 5), with no registered
 * artifact for the notification named.
 *
 * `owner_decided` HAS ZERO USES SINCE `K4-24` PHASE 0 AND IS KEPT ANYWAY —
 * see the header. A marker with no current user is not a dead one; it is
 * the state a newly-notified index sits in before its Gazette copy is
 * retrieved.
 */
export type CostInflationIndexEvidence = "instrument" | "owner_decided";

export interface CostInflationIndexEntry {
  readonly financialYear: string;
  readonly index: number;
  /** The CBDT notification that specifies this value. */
  readonly notification: string;
  readonly evidence: CostInflationIndexEvidence;
}

/**
 * s.48 Explanation (v). Ordered oldest first. Serial numbers follow the
 * principal notification S.O. 1790(E) dated 5 June 2017, which
 * Notification 70/2025 amends by inserting serial 25.
 */
export const COST_INFLATION_INDEX: readonly CostInflationIndexEntry[] = [
  { financialYear: "2001-02", index: 100, notification: "44/2017", evidence: "instrument" },
  { financialYear: "2002-03", index: 105, notification: "44/2017", evidence: "instrument" },
  { financialYear: "2003-04", index: 109, notification: "44/2017", evidence: "instrument" },
  { financialYear: "2004-05", index: 113, notification: "44/2017", evidence: "instrument" },
  { financialYear: "2005-06", index: 117, notification: "44/2017", evidence: "instrument" },
  { financialYear: "2006-07", index: 122, notification: "44/2017", evidence: "instrument" },
  { financialYear: "2007-08", index: 129, notification: "44/2017", evidence: "instrument" },
  { financialYear: "2008-09", index: 137, notification: "44/2017", evidence: "instrument" },
  { financialYear: "2009-10", index: 148, notification: "44/2017", evidence: "instrument" },
  { financialYear: "2010-11", index: 167, notification: "44/2017", evidence: "instrument" },
  { financialYear: "2011-12", index: 184, notification: "44/2017", evidence: "instrument" },
  { financialYear: "2012-13", index: 200, notification: "44/2017", evidence: "instrument" },
  { financialYear: "2013-14", index: 220, notification: "44/2017", evidence: "instrument" },
  { financialYear: "2014-15", index: 240, notification: "44/2017", evidence: "instrument" },
  { financialYear: "2015-16", index: 254, notification: "44/2017", evidence: "instrument" },
  { financialYear: "2016-17", index: 264, notification: "44/2017", evidence: "instrument" },
  { financialYear: "2017-18", index: 272, notification: "44/2017", evidence: "instrument" },
  { financialYear: "2018-19", index: 280, notification: "26/2018", evidence: "instrument" },
  { financialYear: "2019-20", index: 289, notification: "63/2019", evidence: "instrument" },
  { financialYear: "2020-21", index: 301, notification: "32/2020", evidence: "instrument" },
  { financialYear: "2021-22", index: 317, notification: "73/2021", evidence: "instrument" },
  { financialYear: "2022-23", index: 331, notification: "62/2022", evidence: "instrument" },
  { financialYear: "2023-24", index: 348, notification: "39/2023", evidence: "instrument" },
  { financialYear: "2024-25", index: 363, notification: "44/2024", evidence: "instrument" },
  { financialYear: "2025-26", index: 376, notification: "70/2025", evidence: "instrument" },
] as const;

const BY_YEAR = new Map(COST_INFLATION_INDEX.map((e) => [e.financialYear, e]));

/**
 * The financial year an ISO calendar day falls in, as `YYYY-YY`. India's
 * previous year runs 1 April to 31 March, so 2024-03-31 is FY 2023-24 and
 * 2024-04-01 is FY 2024-25.
 */
export function financialYearOfIsoDate(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(Date.UTC(y, month - 1, day));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    return null;
  }
  const startYear = month >= 4 ? y : y - 1;
  const endYear = (startYear + 1) % 100;
  return `${startYear}-${String(endYear).padStart(2, "0")}`;
}

/** The notified index for a financial year, or `null` when none is held. */
export function costInflationIndexFor(financialYear: string): number | null {
  return BY_YEAR.get(financialYear)?.index ?? null;
}

/** The full entry, so a caller can report the notification and evidence. */
export function costInflationIndexEntryFor(
  financialYear: string,
): CostInflationIndexEntry | null {
  return BY_YEAR.get(financialYear) ?? null;
}

/**
 * s.48 Explanation (iii) and (iv): an indexed cost bears to the cost the
 * same proportion as the CII for the year of transfer bears to the CII for
 * the base year.
 *
 * ROUNDING IS DECIDED, NOT INCIDENTAL (`D337` item 4). The owner chose
 * whole-rupee portal-style rounding: each indexed cost component is
 * rounded to the nearest rupee HERE, before any gain is formed. The
 * paise-level single-rounding alternative was considered and rejected.
 * `Math.round` is half-up on positive values, which is the portal's
 * behaviour; every input here is non-negative by construction.
 */
export function indexedCost(cost: number, transferIndex: number, baseIndex: number): number {
  return Math.round((cost * transferIndex) / baseIndex);
}
