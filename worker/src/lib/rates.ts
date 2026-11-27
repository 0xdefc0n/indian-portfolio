// Government rates for PPF and EPF (plan §21.12, M19). A small table in code, updated by hand each quarter (an M16
// ops checklist item). Shared with the SPA through lib/manual-assets.ts, so it must stay free of Worker imports.
//
// Checked 2026-11-27:
// - PPF 7.1 % for every quarter from April 2020 to December 2026 (Finance Ministry notification of 30 Sep 2026 for
//   Oct–Dec 2026; also Business Standard, Upstox).
// - EPF 8.50 % FY 2019-20 and 2020-21, 8.10 % 2021-22, 8.15 % 2022-23, 8.25 % 2023-24, 2024-25 and 2025-26 (FY
//   2025-26 notified by EPFO in July 2026).
// Past the end of a table the last rate is used and marked provisional (EPF for FY 2026-27 is declared next year).
// Before its start the first rate is used: balances that old are rare, and the value is approximate anyway.

export type RateTable = {
  checked: string
  /** PPF: the rate (% a year) from each date (a quarter's first day) until the next entry. Sorted by `from`. */
  ppf: { from: string; rate: number }[]
  /** The last day the PPF table is notified for. Later quarters are provisional. */
  ppfUntil: string
  /** EPF: the rate (% a year) of each financial year, keyed by its start year (2025 = FY 2025-26). */
  epf: Record<string, number>
}

export const RATES: RateTable = {
  checked: '2026-11-27',
  ppf: [{ from: '2020-04-01', rate: 7.1 }],
  ppfUntil: '2026-12-31',
  epf: { '2019': 8.5, '2020': 8.5, '2021': 8.1, '2022': 8.15, '2023': 8.25, '2024': 8.25, '2025': 8.25 },
}
