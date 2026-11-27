// Gold and silver rates (plan §21.5, M29): ₹ per gram of 999 metal for every market day, derived from gold and
// silver ETF NAVs already in the NAV store and anchored to IBJA through public RBI SGB prices. Public market data only.
//
// Why not IBJA itself: its API is paid and its site asks valuers to subscribe rather than scrape (§21.5). An ETF's NAV
// is its metal holding per unit × the domestic price, so NAV × k (k: ₹/g per ₹ of NAV) is the price per gram; k comes
// from dated anchors and drifts slowly with the expense ratio, so it's interpolated between them.
import type { Metal, MetalRates } from '../lib/metals'
import { addDays, type Ymd, ymdToIso } from './amfi'
import { METAL_ANCHORS, METAL_REFS, type MetalAnchor } from './metal-anchors'

export { METAL_ANCHORS, METAL_REFS }

const DAY = 86_400_000
const dayNo = (d: Ymd) => Date.UTC(Math.floor(d / 10_000), (Math.floor(d / 100) % 100) - 1, d % 100) / DAY
/** k may grow by at most 2% a year when extended past the anchors (expense ratios are 0.3–1%), and never shrink. */
const MAX_DRIFT_PER_DAY = Math.log(1.02) / 365

/** NAVs of one ETF by date. */
export type NavSeries = Map<Ymd, number>

/**
 * Undo unit splits and consolidations: a day-on-day move beyond ±30% (metal never moves that much in a day) rescales
 * every earlier NAV by it, so the series is in today's units.
 */
export function splitAdjusted(series: NavSeries): NavSeries {
  const dates = [...series.keys()].sort((a, b) => a - b)
  const out = new Map<Ymd, number>()
  let scale = 1
  for (let i = dates.length - 1; i >= 0; i--) {
    const d = dates[i]!
    const nav = series.get(d)!
    if (i < dates.length - 1) {
      const later = series.get(dates[i + 1]!)!
      const ratio = later / nav
      if (ratio < 0.7 || ratio > 1 / 0.7) scale *= ratio
    }
    out.set(d, nav * scale)
  }
  return out
}

/** One ETF's k at each anchor it has NAVs for (all of the anchor's dates), as (day number, ln k). */
export function anchorFactors(navs: NavSeries, anchors: readonly MetalAnchor[]): { t: number; lnK: number }[] {
  const out: { t: number; lnK: number }[] = []
  for (const a of anchors) {
    const vals = a.dates.map((d) => navs.get(d))
    if (vals.some((v) => v === undefined || v <= 0)) continue
    const mean = (vals as number[]).reduce((s, v) => s + v, 0) / vals.length
    out.push({ t: a.dates.map(dayNo).reduce((s, v) => s + v, 0) / a.dates.length, lnK: Math.log(a.price / mean) })
  }
  return out.sort((x, y) => x.t - y.t)
}

const clampSlope = (s: number) => Math.min(MAX_DRIFT_PER_DAY, Math.max(0, s))

/** k on day `t`: log-linear between anchors; past either end, the nearest segment's slope (clamped). */
export function factorAt(points: { t: number; lnK: number }[], t: number): number | null {
  if (!points.length) return null
  if (points.length === 1) return Math.exp(points[0]!.lnK)
  const first = points[0]!
  const last = points.at(-1)!
  if (t <= first.t) {
    const s = clampSlope((points[1]!.lnK - first.lnK) / (points[1]!.t - first.t))
    return Math.exp(first.lnK - s * (first.t - t))
  }
  if (t >= last.t) {
    const prev = points.at(-2)!
    const s = clampSlope((last.lnK - prev.lnK) / (last.t - prev.t))
    return Math.exp(last.lnK + s * (t - last.t))
  }
  let i = 1
  while (points[i]!.t < t) i++
  const a = points[i - 1]!
  const b = points[i]!
  return Math.exp(a.lnK + ((b.lnK - a.lnK) * (t - a.t)) / (b.t - a.t))
}

export type MetalRateRow = { metal: Metal; date: Ymd; rate: number; etfs: number }

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

/**
 * Each metal's rate for every date any of its reference ETFs has a NAV: the median of NAV × k over those ETFs, to
 * the paisa. An ETF without an anchor (no NAV on any anchor's dates) is left out.
 */
export function deriveRates(
  navsByCode: Map<number, NavSeries>,
  refs: readonly { metal: Metal; code: number }[] = METAL_REFS,
  anchors: Record<Metal, readonly MetalAnchor[]> = METAL_ANCHORS,
): MetalRateRow[] {
  const out: MetalRateRow[] = []
  for (const metal of ['gold', 'silver'] as const) {
    const byDate = new Map<Ymd, number[]>()
    for (const ref of refs.filter((r) => r.metal === metal)) {
      const raw = navsByCode.get(ref.code)
      if (!raw?.size) continue
      const navs = splitAdjusted(raw)
      const points = anchorFactors(navs, anchors[metal])
      if (!points.length) continue
      for (const [d, nav] of navs) {
        const k = factorAt(points, dayNo(d))
        if (k === null) continue
        const list = byDate.get(d) ?? []
        list.push(nav * k)
        byDate.set(d, list)
      }
    }
    for (const [date, xs] of [...byDate.entries()].sort((a, b) => a[0] - b[0])) {
      out.push({ metal, date, rate: Math.round(median(xs) * 100) / 100, etfs: xs.length })
    }
  }
  return out
}

// ─── Job (after every nav-ingest run, and after a reference ETF's backfill) ─────────────────────────────────────

export const REF_CODES = METAL_REFS.map((r) => r.code)
/** Rates before this aren't derived (the first SGB was issued in November 2015; older gold isn't needed). */
export const METAL_FROM: Ymd = 20150101
const ROWS_PER_STATEMENT = 2_000

export type MetalRun = { ok: boolean; rates: number; changed: number; backfills: number[]; error_class: string | null }

/**
 * Make sure the reference ETFs have their history (a nav_backfill row: the caller sends the codes returned to
 * pf-market), then derive every rate from their NAVs and upsert the ones that changed. A re-run writes 0 rows.
 */
export async function metalRates(env: { MARKET: D1Database }, now = Date.now()): Promise<MetalRun> {
  const db = env.MARKET
  try {
    const [pending, navRes] = await db.batch<{ amfi_code: number; date?: Ymd; nav?: number }>([
      db
        .prepare(
          `INSERT INTO nav_backfill (amfi_code, status, at) SELECT value, 'pending', ?2 FROM json_each(?1) WHERE true
           ON CONFLICT DO NOTHING RETURNING amfi_code`,
        )
        .bind(JSON.stringify(REF_CODES), now),
      db.prepare('SELECT amfi_code, date, nav FROM nav WHERE amfi_code IN (SELECT value FROM json_each(?1)) AND date >= ?2').bind(JSON.stringify(REF_CODES), METAL_FROM),
    ])
    const navs = new Map<number, NavSeries>()
    for (const r of navRes?.results ?? []) {
      const s = navs.get(r.amfi_code) ?? new Map<Ymd, number>()
      s.set(r.date!, r.nav!)
      navs.set(r.amfi_code, s)
    }
    const rows = deriveRates(navs)
    const stmts: D1PreparedStatement[] = []
    for (let i = 0; i < rows.length; i += ROWS_PER_STATEMENT) {
      const json = JSON.stringify(rows.slice(i, i + ROWS_PER_STATEMENT).map((r) => [r.metal, r.date, r.rate, r.etfs]))
      stmts.push(
        db
          .prepare(
            `INSERT INTO metal_rate (metal, date, rate, etfs)
             SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'), json_extract(value, '$[3]')
             FROM json_each(?1) WHERE true
             ON CONFLICT (metal, date) DO UPDATE SET rate = excluded.rate, etfs = excluded.etfs
             WHERE abs(metal_rate.rate - excluded.rate) >= 0.005 OR metal_rate.etfs <> excluded.etfs`,
          )
          .bind(json),
      )
    }
    const res = stmts.length ? await db.batch(stmts) : []
    const changed = res.reduce((n, r) => n + (r.meta.changes ?? 0), 0)
    const run = { ok: true, rates: rows.length, changed, backfills: (pending?.results ?? []).map((r) => r.amfi_code), error_class: null }
    console.log('metal_rates', { rates: run.rates, changed, backfills: run.backfills.length })
    return run
  } catch (err) {
    const error_class = err instanceof Error ? err.name : 'Unknown'
    console.error('metal_rates_failed', error_class)
    return { ok: false, rates: 0, changed: 0, backfills: [], error_class }
  }
}

// ─── Serving (GET /api/assets → rates.metals) ───────────────────────────────────────────────────────────────────

/** Daily points this recent are served as they are; older ones as one per month (the month's last). */
export const SERVED_DAILY_DAYS = 31
export const METALS_MAX_AGE = 3_600

/** Month-end points since 2015 plus the last 31 days, per metal. One read from a replica. */
export async function readMetalRates(env: { MARKET: D1Database }, today: Ymd): Promise<MetalRates> {
  const recent = addDays(today, -SERVED_DAILY_DAYS)
  const res = await env.MARKET.withSession('first-unconstrained')
    .prepare(
      `SELECT metal, date, rate FROM metal_rate WHERE date >= ?1
       UNION SELECT metal, MAX(date) AS date, rate FROM metal_rate WHERE date < ?1 GROUP BY metal, date / 100
       ORDER BY metal, date`,
    )
    .bind(recent)
    .all<{ metal: Metal; date: Ymd; rate: number }>()
  const out: MetalRates = { gold: [], silver: [] }
  for (const r of res.results) out[r.metal]?.push([ymdToIso(r.date), r.rate])
  return out
}

/** The edge-cache key for a day's served rates (a new day is a new key). */
export const metalCacheKey = (env: { APP_URL: string }, today: Ymd) => new Request(new URL(`/api/market/metals?d=${today}`, env.APP_URL).toString())

/** readMetalRates() through the edge cache (per data centre, 1 h): households never reach the market DB for it. */
export async function cachedMetalRates(env: { MARKET: D1Database; APP_URL: string }, today: Ymd, waitUntil?: (p: Promise<unknown>) => void): Promise<MetalRates> {
  const key = metalCacheKey(env, today)
  const cache = typeof caches === 'undefined' ? null : caches.default
  const hit = await cache?.match(key).catch(() => undefined)
  if (hit) return hit.json<MetalRates>()
  const rates = await readMetalRates(env, today)
  const put = cache?.put(key, Response.json(rates, { headers: { 'Cache-Control': `public, max-age=${METALS_MAX_AGE}` } })).catch(() => undefined)
  if (put && waitUntil) waitUntil(put)
  else if (put) await put
  return rates
}
