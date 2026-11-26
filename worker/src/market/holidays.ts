// Exchange trading holidays (M12, owner request 2026-11-26). A SIP due on a holiday runs on the next business day, as
// brokers and RTAs do, so the engine needs the calendar ahead of time.
//
// Source: Upstox's public market-holidays API (no key; JSON with the closed exchanges per date). NSE's own API turns
// away automated clients, and its circular is a PDF. ✅ 2026-11-26: the 2026 list (16 NSE closures) matches the NAV
// store: every past date has no NAV for an equity fund, except 31 Mar (financial-year end: NAVs are published, but
// the exchange is shut). The list covers the current calendar year. The next year's dates appear once the exchanges
// publish them (December), and the weekly refresh picks them up.
//
// The job rides the daily stocks cron and fetches at most once a week (holiday_run). A failed fetch keeps the stored
// dates; builds fall back to the engine's own 2026 list only when the table is empty.
// Public market data only. Logs carry counts and error class names.
import type { Ymd } from './amfi'

export const UPSTOX_HOLIDAYS_URL = 'https://api.upstox.com/v2/market/holidays'
/** Fetch again after this long. */
export const HOLIDAY_REFRESH_MS = 6 * 86_400_000
/** Builds get holidays from this far back (past SIP run days) onwards. */
export const HOLIDAY_LOOKBACK_DAYS = 400
const USER_AGENT = 'Mozilla/5.0 (compatible; nav-fetch/1.0)' // generic, as for AMFI (§10.4.1)

export class HolidayFormatError extends Error {
  override name = 'HolidayFormatError'
}

export type Holiday = { date: Ymd; name: string }

/** NSE trading holidays from Upstox's answer. Throws on an unexpected shape, so a bad answer never clears the table. */
export function parseUpstoxHolidays(body: unknown): Holiday[] {
  const b = body as { status?: unknown; data?: unknown }
  if (b?.status !== 'success' || !Array.isArray(b.data)) throw new HolidayFormatError('shape')
  const out: Holiday[] = []
  for (const raw of b.data as Array<Record<string, unknown>>) {
    if (raw?.holiday_type !== 'TRADING_HOLIDAY') continue // settlement holidays and special sessions aren't closures
    if (!Array.isArray(raw.closed_exchanges) || !raw.closed_exchanges.includes('NSE')) continue
    const date = typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? Number(raw.date.replaceAll('-', '')) : NaN
    if (!Number.isFinite(date)) throw new HolidayFormatError('date')
    const name = typeof raw.description === 'string' ? raw.description.slice(0, 80) : 'Holiday'
    out.push({ date, name })
  }
  if (!out.length) throw new HolidayFormatError('empty')
  return out
}

type HolidayEnv = { MARKET: D1Database }

/**
 * Refresh the stored calendar if the last fetch is a week old (or `force`). For every year the answer covers, the
 * stored dates become exactly the answer's (a cancelled holiday goes). Never throws.
 */
export async function refreshHolidays(env: HolidayEnv, opts: { now?: number; force?: boolean; fetcher?: typeof fetch } = {}): Promise<{ ran: boolean; rows?: number; error?: string }> {
  const now = opts.now ?? Date.now()
  try {
    if (!opts.force) {
      const last = await env.MARKET.prepare('SELECT at FROM holiday_run WHERE id = 1 AND ok = 1').first<{ at: number }>()
      if (last && now - last.at < HOLIDAY_REFRESH_MS) return { ran: false }
    }
    const res = await (opts.fetcher ?? fetch)(UPSTOX_HOLIDAYS_URL, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' }, signal: AbortSignal.timeout(20_000) })
    if (!res.ok) throw new HolidayFormatError(`status_${res.status}`)
    const holidays = parseUpstoxHolidays(await res.json())
    const years = [...new Set(holidays.map((h) => Math.floor(h.date / 10_000)))]
    const json = JSON.stringify(holidays.map((h) => [h.date, h.name]))
    await env.MARKET.batch([
      ...years.map((y) =>
        env.MARKET.prepare(
          `DELETE FROM market_holiday WHERE date BETWEEN ?1 AND ?2 AND source = 'upstox'
             AND date NOT IN (SELECT json_extract(value, '$[0]') FROM json_each(?3))`,
        ).bind(y * 10_000 + 101, y * 10_000 + 1231, json),
      ),
      env.MARKET.prepare(
        `INSERT INTO market_holiday (date, name, source, fetched_at)
         SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), 'upstox', ?2 FROM json_each(?1) WHERE true
         ON CONFLICT (date) DO UPDATE SET name = excluded.name, fetched_at = excluded.fetched_at`,
      ).bind(json, now),
      env.MARKET.prepare('INSERT INTO holiday_run (id, at, ok, rows) VALUES (1, ?1, 1, ?2) ON CONFLICT (id) DO UPDATE SET at = ?1, ok = 1, rows = ?2').bind(now, holidays.length),
    ])
    console.log('holidays_refreshed', { rows: holidays.length, years: years.length })
    return { ran: true, rows: holidays.length }
  } catch (err) {
    const error = (err as Error).name === 'HolidayFormatError' ? `format_${(err as Error).message}` : (err as Error).name
    console.error('holidays_refresh_failed', error)
    // a failed fetch is remembered but doesn't count as fresh: the next daily run tries again
    await env.MARKET.prepare('INSERT INTO holiday_run (id, at, ok, rows) VALUES (1, ?1, 0, 0) ON CONFLICT (id) DO UPDATE SET at = ?1, ok = 0, rows = 0')
      .bind(now)
      .run()
      .catch(() => undefined)
    return { ran: true, error }
  }
}

/** ISO dates of the stored holidays from `fromYmd` on, oldest first (empty: the engine uses its fallback list). */
export async function holidayDates(env: HolidayEnv, fromYmd: Ymd): Promise<string[]> {
  const res = await env.MARKET.withSession('first-unconstrained').prepare('SELECT date FROM market_holiday WHERE date >= ?1 ORDER BY date').bind(fromYmd).all<{ date: Ymd }>()
  return res.results.map((r) => `${String(r.date).slice(0, 4)}-${String(r.date).slice(4, 6)}-${String(r.date).slice(6, 8)}`)
}
