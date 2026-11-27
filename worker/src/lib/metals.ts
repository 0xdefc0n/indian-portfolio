// Gold and silver (plan §21.5, D24, M29): the daily per-gram rate lookup and the Sovereign Gold Bond series table.
// Shared with the SPA through lib/manual-assets.ts, so it must stay free of Worker and DOM imports (no enums, ES2023).
import { SGB_SERIES, type SgbSeries } from './sgb-series'

export { SGB_SERIES, type SgbSeries }

export type Metal = 'gold' | 'silver'

/**
 * Daily rates, ₹ per gram of 999 metal, as `[ISO date, rate]` sorted by date. Served in `GET /api/assets` as month-end
 * points since 2015 plus the last 31 days (plan §21.5); a lookup takes the latest point on or before the date.
 */
export type MetalSeries = [string, number][]
export type MetalRates = { gold: MetalSeries; silver: MetalSeries }

/** A rate more than this many days older than the day it's used for shows "Rate from {date}". */
export const STALE_RATE_DAYS = 7

/** The latest rate on or before `date`, with the day it's from; null before the series starts (or with none). */
export function metalRate(rates: MetalRates | undefined, metal: Metal, date: string): { rate: number; date: string } | null {
  const s = rates?.[metal]
  if (!s?.length || s[0]![0] > date) return null
  let lo = 0
  let hi = s.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (s[mid]![0] <= date) lo = mid
    else hi = mid - 1
  }
  const [d, rate] = s[lo]!
  return { rate, date: d }
}

// ─── Purity ─────────────────────────────────────────────────────────────────────────────────────────────────────

export type GoldPurity = 999 | 916 | 750
export const GOLD_PURITIES: readonly { purity: GoldPurity; karat: string }[] = [
  { purity: 999, karat: '24K' },
  { purity: 916, karat: '22K' },
  { purity: 750, karat: '18K' },
]
/**
 * The share of the 999 rate a purity is worth. IBJA quotes 916 and 750 as the 999 rate × 0.916 and × 0.75, and 999
 * itself is the base (not 0.999).
 */
export const purityFactor = (purity: GoldPurity | 999) => (purity === 999 ? 1 : purity / 1000)
export const karatOf = (purity: GoldPurity) => GOLD_PURITIES.find((p) => p.purity === purity)?.karat ?? `${purity}`

// ─── Sovereign Gold Bonds ───────────────────────────────────────────────────────────────────────────────────────

/** 8 years from issue (96 months); early redemption from the 5th year on an interest date. */
export const SGB_TERM_MONTHS = 96
export const SGB_EARLY_MONTHS = 60

export const sgbSeries = (id: string): SgbSeries | undefined => SGB_SERIES.find((s) => s.id === id)

const SGB_NAME_RE = /\bSGB\b|SOVEREIGN\s*GOLD|GOLD\s*BONDS?\b|\bGOLDBONDS?\b/i

/**
 * A demat holding that is a Sovereign Gold Bond: its ISIN is in the series table, or (an ISIN we don't have) it's a
 * government security (IN00…) whose name says so. Funds (INF…) never are, even "gold" ones.
 */
export function sgbOfHolding(isin: string, name: string): SgbSeries | 'unknown' | null {
  const byIsin = SGB_SERIES.find((s) => s.isin === isin)
  if (byIsin) return byIsin
  if (isin.startsWith('IN00') && SGB_NAME_RE.test(name)) return 'unknown'
  return null
}
