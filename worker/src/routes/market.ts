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

marketRoutes.get('/market/status', async (c) => {
  // The edge cache (per data centre) keeps D1 out of it; the header lets browsers keep it too.
  const key = new Request(new URL('/api/market/status', c.req.url).toString())
  const cache = caches.default
  const hit = await cache.match(key)
  if (hit) return hit
  const res = c.json(await marketStatus(c.env), 200, { 'Cache-Control': `public, max-age=${MARKET_STATUS_MAX_AGE}` })
  c.executionCtx.waitUntil(cache.put(key, res.clone()))
  return res
})
