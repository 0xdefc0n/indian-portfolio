// /api/market/status (plan §9.2): public, cacheable for 5 min. Drives the "NAVs updating" hint. Public market data
// only; read from a replica (D17).
import { Hono } from 'hono'
import { type Ymd, ymdToIso } from '../market/amfi'
import type { AppBindings } from '../types'

export const marketRoutes = new Hono<AppBindings>()

export const MARKET_STATUS_MAX_AGE = 300

export type MarketStatus = { latest_nav_date: string | null; coverage_pct: number | null; final: boolean }

type DayRow = { date: Ymd; schemes_updated: number; tracked_total: number; tracked_updated: number; final: number }

/**
 * The latest full NAV day: weekends and holidays have only the daily-NAV funds (overnight, liquid: ~5% of rows), so
 * the latest date with at least half the recent busiest day's rows. Coverage is of the schemes people hold.
 */
export async function marketStatus(env: { MARKET: D1Database }): Promise<MarketStatus> {
  const days = await env.MARKET.withSession('first-unconstrained')
    .prepare('SELECT date, schemes_updated, tracked_total, tracked_updated, final FROM market_day ORDER BY date DESC LIMIT 10')
    .all<DayRow>()
  const max = days.results.reduce((m, d) => Math.max(m, d.schemes_updated), 0)
  const day = days.results.find((d) => d.schemes_updated * 2 >= max)
  if (!day) return { latest_nav_date: null, coverage_pct: null, final: false }
  return {
    latest_nav_date: ymdToIso(day.date),
    coverage_pct: day.tracked_total > 0 ? Math.round((1000 * day.tracked_updated) / day.tracked_total) / 10 : null,
    final: day.final === 1,
  }
}

/**
 * marketStatus() through the edge cache (per data centre, 5 min), so the dashboard and the rebuild consumer keep D1
 * out of it. Falls back to D1 when the Cache API isn't there.
 */
export async function cachedMarketStatus(env: { MARKET: D1Database; APP_URL: string }, waitUntil?: (p: Promise<unknown>) => void): Promise<MarketStatus> {
  const key = new Request(new URL('/api/market/status', env.APP_URL).toString())
  const cache = typeof caches === 'undefined' ? null : caches.default
  const hit = await cache?.match(key).catch(() => undefined)
  if (hit) return hit.json<MarketStatus>()
  const status = await marketStatus(env)
  const res = Response.json(status, { headers: { 'Cache-Control': `public, max-age=${MARKET_STATUS_MAX_AGE}` } })
  const put = cache?.put(key, res).catch(() => undefined)
  if (put && waitUntil) waitUntil(put)
  else if (put) await put
  return status
}

marketRoutes.get('/market/status', async (c) => {
  // The header lets browsers keep it too.
  const status = await cachedMarketStatus(c.env, (p) => c.executionCtx.waitUntil(p))
  return c.json(status, 200, { 'Cache-Control': `public, max-age=${MARKET_STATUS_MAX_AGE}` })
})
