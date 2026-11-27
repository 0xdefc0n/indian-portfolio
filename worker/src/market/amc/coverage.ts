// Which funds the AMC scraper covers (plan §10.3.1, M18), shared by the scrape job, the BharatStock pass and builds.
import { ADAPTERS, adapterFor } from '.'
import type { AmcAdapter } from './types'

/** From this day of the month (IST), a wanted fund with no AMC data for the target month goes to BharatStock. */
export const FALLBACK_DAY = 15
const IST_MS = 5.5 * 3_600_000

/** The adapters this environment runs: AMC_SCRAPERS is "all", a comma list of slugs, or empty (off). */
export function enabledAdapters(env: { AMC_SCRAPERS?: string }): AmcAdapter[] {
  const v = (env.AMC_SCRAPERS ?? '').trim().toLowerCase()
  if (!v) return []
  if (v === 'all') return [...ADAPTERS]
  const want = new Set(v.split(/[\s,]+/).filter(Boolean))
  return ADAPTERS.filter((a) => want.has(a.slug))
}

/** The enabled, not-blocked adapter for an AMFI fund-house name, if any. */
export function activeAdapter(env: { AMC_SCRAPERS?: string }, amc: string | null | undefined): AmcAdapter | null {
  const a = adapterFor(amc)
  return a && !a.blocked && enabledAdapters(env).some((e) => e.slug === a.slug) ? a : null
}

/** The month whose portfolios should be out: the month before today (IST). */
export function targetMonth(now: number): string {
  const d = new Date(now + IST_MS)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7)
}

export const istDay = (now: number) => new Date(now + IST_MS).getUTCDate()

/**
 * Does the AMC scraper cover this fund, so BharatStock should leave it alone? Yes when its AMC has an active adapter
 * and either it has AMC data for the target month, or it's before day 15 and the scraper is still on it (not tried
 * yet, or it has older data to show meanwhile).
 */
export function amcCovers(
  env: { AMC_SCRAPERS?: string },
  r: { amc: string | null; amc_at: number | null; amc_current: number | boolean; has_data: number | boolean },
  now: number,
): boolean {
  if (!activeAdapter(env, r.amc)) return false
  if (r.amc_current) return true
  if (istDay(now) >= FALLBACK_DAY) return false
  return r.amc_at === null || !!r.has_data
}
