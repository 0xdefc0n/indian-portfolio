// mfforecast on RapidAPI: the last fallback for stocks inside funds (plan §10.3.1, M18 follow-up). Order: the AMCs'
// own disclosures (amc-scrape.ts), then BharatStock (stocks.ts, 50 paid calls a day), then this, for wanted funds
// that still have no recent data because BharatStock can't help (no key, today's budget spent, no match, or failing).
//
// ✅ VERIFY (2026-11-27, one live call): `GET https://indian-mutual-fund-portfolio-holding.p.rapidapi.com/funds/
//    {amfi_code}/holdings` with x-rapidapi-key / x-rapidapi-host answers {amfi_code, scheme_name, fund_house,
//    snapshot: {snapshot_date, …}, holdings: [{isin, name, ticker, weight_pct (a fraction), quantity, asset_type:
//    EQUITY|DEBT|CASH|REIT|OTHER}]}. Foreign shares come as OTHER with a non-Indian ISIN. Data is a month behind the
//    AMCs (2026-09-30 on 2026-11-27). Limits: the response headers say 500,000 requests a month (hard limit, free
//    plan); mfforecast's own page says 1,000 an hour (not in the headers). We take 900 an hour and 450,000 a month
//    in `quota` (subject 'global'), stop when RapidAPI says fewer than 100 are left, and a 429 spends the hour.
//    Terms: their service terms forbid scraping their app; this is the official RapidAPI plan.
// Only public AMFI codes are sent. Logs carry counts and error class names, never ISINs or codes.
import { quotaWindow, type QuotaSpec, takeQuota } from '../lib/quota'
import { amcCovers, targetMonth } from './amc/coverage'
import { holdingsKey, prevMonth, type StockRow } from './stocks'
import { TRACKED_UNSEEN_MS } from './store'

export const MFF_HOST = 'indian-mutual-fund-portfolio-holding.p.rapidapi.com'
export const MFF_HOUR_LIMIT = 900 // of the 1,000 an hour mfforecast's page states
export const MFF_MONTH_LIMIT = 450_000 // of the 500,000 a month RapidAPI enforces
/** Stop when RapidAPI's own count of requests left this month drops below this. */
const MIN_REMAINING = 100
/** A fund asked for (any outcome) isn't asked again for this long. */
export const MFF_RETRY_MS = 7 * 86_400_000
/** At most this many calls per pass: the job runs again on the next request or the daily cron. */
const MAX_CALLS_PER_PASS = 200

type MffEnv = { DB: D1Database; MARKET: D1Database; BUCKET: R2Bucket; RAPIDAPI_KEY?: string; AMC_SCRAPERS?: string }

export function mffKey(env: { RAPIDAPI_KEY?: string }): string {
  return (env.RAPIDAPI_KEY ?? '').trim().replace(/^["']|["']$/g, '')
}

export const mffSpecs: QuotaSpec[] = [
  { subject: 'global', metric: 'mfforecast', period: 'hour', limit: MFF_HOUR_LIMIT, utc: true },
  { subject: 'global', metric: 'mfforecast', period: 'month', limit: MFF_MONTH_LIMIT, utc: true },
]

export class MffSpent extends Error {
  override name = 'MffSpent'
}
export class MffHttpError extends Error {
  override name = 'MffHttpError'
  constructor(readonly status: number) {
    super(`status ${status}`)
  }
}

type MffHolding = { isin?: string | null; name?: string | null; ticker?: string | null; weight_pct?: number | null; asset_type?: string | null }
type MffAnswer = { snapshot?: { snapshot_date?: string | null } | null; holdings?: MffHolding[] | null }

/** mfforecast's rows in the stocks view's shape (BharatStock's types; weights in percent). */
export function toRows(holdings: MffHolding[]): StockRow[] {
  const raw = holdings.filter((h) => typeof h.weight_pct === 'number' && h.weight_pct !== 0 && (h.isin || h.name))
  const total = raw.reduce((s, h) => s + (h.weight_pct ?? 0), 0)
  const scale = total <= 1.5 ? 100 : 1 // fractions (as verified), or percent if that ever changes
  return raw
    .map((h): StockRow => {
      const isin = String(h.isin ?? '').toUpperCase()
      const kind = String(h.asset_type ?? '').toUpperCase()
      const indian = isin.startsWith('IN')
      const type = isin.startsWith('INF')
        ? 'MUTUAL_FUND_UNIT'
        : kind === 'EQUITY'
          ? indian ? 'EQUITY' : 'FOREIGN_EQUITY'
          : kind === 'OTHER' && isin && !indian
            ? 'FOREIGN_EQUITY' // Alphabet, Amazon… come as OTHER
            : kind === 'CASH' ? 'CASH' : kind === 'DEBT' ? 'DEBT' : 'OTHER'
      const symbol = h.ticker ? h.ticker.replace(/\.(NS|BO)$/i, '') : null
      return { isin: isin || String(h.name).slice(0, 120), symbol, name: h.name ?? null, sector: null, type, pct: Math.round((h.weight_pct ?? 0) * scale * 10_000) / 10_000 }
    })
    .filter((r) => r.pct > 0 || r.type === 'CASH')
}

/** One paid call. Takes a unit of both budgets first, so a failed call still counts. */
export async function fetchMff(env: MffEnv, code: number, now: number, f: typeof fetch = fetch): Promise<{ month: string | null; rows: StockRow[] } | null> {
  if (!(await takeQuota(env, mffSpecs, now)).ok) throw new MffSpent()
  const res = await f(`https://${MFF_HOST}/funds/${code}/holdings`, {
    headers: { 'x-rapidapi-key': mffKey(env), 'x-rapidapi-host': MFF_HOST, accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  })
  const remaining = Number(res.headers.get('x-ratelimit-requests-remaining') ?? Number.NaN)
  if (res.status === 429 || (Number.isFinite(remaining) && remaining < MIN_REMAINING)) {
    await res.body?.cancel()
    await spend(env, now, res.status === 429 ? 'hour' : 'month')
    throw new MffSpent()
  }
  if (res.status === 404) {
    await res.body?.cancel()
    return null // not one of its funds
  }
  if (!res.ok) {
    await res.body?.cancel()
    throw new MffHttpError(res.status)
  }
  const body = await res.json<MffAnswer>()
  const date = body.snapshot?.snapshot_date ?? ''
  return { month: /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : null, rows: toRows(body.holdings ?? []) }
}

/** The provider says stop: fill the budget for the rest of the hour (a 429) or the month (almost none left). */
async function spend(env: MffEnv, now: number, period: 'hour' | 'month'): Promise<void> {
  const spec = mffSpecs.find((s) => s.period === period)!
  await env.DB.prepare(
    `INSERT INTO quota (subject, metric, window, count) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT (subject, metric, window) DO UPDATE SET count = MAX(count, ?4)`,
  )
    .bind(spec.subject, spec.metric, quotaWindow(period, now, true), spec.limit)
    .run()
}

type Row = {
  isin: string
  amc: string | null
  amc_at: number | null
  amc_current: number
  has_data: number
  has_recent: number
  provider_name: string | null
  checked_at: number | null
  failed_at: number | null
  mff_at: number | null
  code: number | null
}

export type MffStats = { fetched: number; missing: number; failed: number; calls: number; spent: boolean }

/**
 * One pass: wanted funds the AMCs don't cover, with nothing from the last two months, that BharatStock can't serve
 * (`bharatOut`: no key or today's budget spent; or it searched and found no match; or it is failing for the fund).
 */
export async function mffPass(env: MffEnv, now: number, opts: { bharatOut: boolean; fetch?: typeof fetch }): Promise<MffStats> {
  const stats: MffStats = { fetched: 0, missing: 0, failed: 0, calls: 0, spent: false }
  if (!mffKey(env)) return stats
  const db = env.MARKET
  const target = targetMonth(now)
  const rows = (
    await db
      .prepare(
        `SELECT m.isin, m.amc, m.amc_at, m.provider_name, m.checked_at, m.failed_at, m.mff_at,
           EXISTS (SELECT 1 FROM fund_portfolio f WHERE f.scheme_isin = m.isin AND f.source = 'amc' AND f.month >= ?2) AS amc_current,
           EXISTS (SELECT 1 FROM fund_portfolio f WHERE f.scheme_isin = m.isin) AS has_data,
           EXISTS (SELECT 1 FROM fund_portfolio f WHERE f.scheme_isin = m.isin AND f.month >= ?3) AS has_recent,
           (SELECT s.amfi_code FROM scheme s WHERE s.isin_growth = m.isin
            UNION ALL SELECT s.amfi_code FROM scheme s WHERE s.isin_reinvest = m.isin LIMIT 1) AS code
         FROM stock_match m WHERE m.wanted_at >= ?1 AND (m.mff_at IS NULL OR m.mff_at < ?4) ORDER BY m.mff_at IS NOT NULL, m.isin`,
      )
      .bind(now - TRACKED_UNSEEN_MS, target, prevMonth(target), now - MFF_RETRY_MS)
      .all<Row>()
  ).results
  const due = rows.filter(
    (r) =>
      r.code !== null &&
      !r.has_recent &&
      !amcCovers(env, r, now) &&
      (opts.bharatOut || (r.checked_at !== null && !r.provider_name) || (r.failed_at !== null && now - r.failed_at < 86_400_000)),
  )
  try {
    for (const r of due.slice(0, MAX_CALLS_PER_PASS)) {
      stats.calls++
      let got
      try {
        got = await fetchMff(env, r.code!, now, opts.fetch)
      } catch (err) {
        if (!(err instanceof MffHttpError) || err.status >= 500) throw err
        stats.failed++ // a 4xx about this fund: try again in a week
        await db.prepare('UPDATE stock_match SET mff_at = ?2 WHERE isin = ?1').bind(r.isin, now).run()
        continue
      }
      const writes = [db.prepare('UPDATE stock_match SET mff_at = ?2 WHERE isin = ?1').bind(r.isin, now)]
      if (got && got.month && got.rows.length) {
        const key = holdingsKey(r.isin, got.month)
        await env.BUCKET.put(key, JSON.stringify({ isin: r.isin, month: got.month, source: 'mfforecast', rows: got.rows }), { httpMetadata: { contentType: 'application/json' } })
        writes.push(
          // Never over an AMC or BharatStock month: those come first.
          db.prepare(`INSERT INTO fund_portfolio (scheme_isin, month, source, blob_key, fetched_at) VALUES (?1, ?2, 'mfforecast', ?3, ?4) ON CONFLICT DO NOTHING`).bind(r.isin, got.month, key, now),
          db.prepare('UPDATE stock_state SET version = version + 1 WHERE id = 1'),
        )
        stats.fetched++
      } else {
        stats.missing++
      }
      await db.batch(writes)
    }
  } catch (err) {
    if (!(err instanceof MffSpent)) {
      console.log('mff_pass_stopped', (err as Error).name)
      stats.failed++
    } else stats.spent = true
  }
  if (stats.calls) console.log('mff_pass', stats)
  return stats
}
