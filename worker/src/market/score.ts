// Benchmark score for funds and stocks (plan §21.4, M28): a 0–100 number for how a fund or share did against its
// index, with a plain line that explains it. Public market data only: a score is keyed by scheme code or ISIN and
// never says who holds it. Logs carry counts and error class names, never codes or ISINs (§0.1).
//
// Method (owner, 2026-11-27, after looking at how Morningstar, Value Research and freefincal do it):
//   - Month-end points, at most the last 10 years; under 36 months: no score (Morningstar and Value Research both
//     need 3 years; 1-year windows are noise).
//   - Half: risk-adjusted excess return. Morningstar's MRAR(γ = 2) for the fund and for the index over 3, 5 and 10
//     years, weighted like Morningstar's overall rating by the months there are (36–59: 3y; 60–119: 40/60; 120+:
//     20/30/50). The difference, in points a year, maps to 0–100 as 50 + 10 × points.
//   - Half: consistency. The share of rolling 3- and 5-year windows (one ending at every month-end) in which the
//     fund's CAGR beat the index's (freefincal's "consistency score"; a 5-year part needs ≥ 12 windows).
//   - A fund identical to its index scores 50.
//
// Index data: total-return (TRI) levels from niftyindices.com. ⚠️ Its terms of use ask for written consent for
// automated collection: the owner is getting it (2026-11-27), and it's on the launch checklist (M17). Everything
// source-specific is in the "Source" section, so a licensed feed can replace it.
import { addDays, istToday, parseAmfiDate, type Ymd, ymdToAmfi, ymdToIso } from './amfi'
import { EQUITY_ISIN, priceSeriesKey, type PriceSeries } from './prices'
import { seriesKey, TRACKED_UNSEEN_MS, type NavSeries } from './store'

// ─── Indices ────────────────────────────────────────────────────────────────────────────────────────────────────

export type IndexDef = { id: string; name: string; label: string }

/** `name` is niftyindices.com's (✅ 2026-11-27: each answers from Jan 2010, Defence from Apr 2018). */
export const INDICES: IndexDef[] = [
  { id: 'nifty50', name: 'NIFTY 50', label: 'Nifty 50' },
  { id: 'nifty100', name: 'NIFTY 100', label: 'Nifty 100' },
  { id: 'largemid250', name: 'NIFTY LARGEMIDCAP 250', label: 'Nifty LargeMidcap 250' },
  { id: 'midcap150', name: 'NIFTY MIDCAP 150', label: 'Nifty Midcap 150' },
  { id: 'smallcap250', name: 'NIFTY SMALLCAP 250', label: 'Nifty Smallcap 250' },
  { id: 'nifty500', name: 'NIFTY 500', label: 'Nifty 500' },
  { id: 'multicap', name: 'NIFTY500 MULTICAP 50:25:25', label: 'Nifty 500 Multicap 50:25:25' },
  { id: 'finserv', name: 'NIFTY FINANCIAL SERVICES', label: 'Nifty Financial Services' },
  { id: 'bank', name: 'NIFTY BANK', label: 'Nifty Bank' },
  { id: 'it', name: 'NIFTY IT', label: 'Nifty IT' },
  { id: 'pharma', name: 'NIFTY PHARMA', label: 'Nifty Pharma' },
  { id: 'healthcare', name: 'NIFTY HEALTHCARE', label: 'Nifty Healthcare' },
  { id: 'infra', name: 'NIFTY INFRASTRUCTURE', label: 'Nifty Infrastructure' },
  { id: 'consumption', name: 'NIFTY INDIA CONSUMPTION', label: 'Nifty India Consumption' },
  { id: 'fmcg', name: 'NIFTY FMCG', label: 'Nifty FMCG' },
  { id: 'manufacturing', name: 'NIFTY INDIA MANUFACTURING', label: 'Nifty India Manufacturing' },
  { id: 'auto', name: 'NIFTY AUTO', label: 'Nifty Auto' },
  { id: 'energy', name: 'NIFTY ENERGY', label: 'Nifty Energy' },
  { id: 'pse', name: 'NIFTY PSE', label: 'Nifty PSE' },
  { id: 'mnc', name: 'NIFTY MNC', label: 'Nifty MNC' },
  { id: 'defence', name: 'NIFTY INDIA DEFENCE', label: 'Nifty India Defence' },
  { id: 'metal', name: 'NIFTY METAL', label: 'Nifty Metal' },
  { id: 'realty', name: 'NIFTY REALTY', label: 'Nifty Realty' },
]
const BY_ID = new Map(INDICES.map((i) => [i.id, i]))
export const STOCK_INDEX = 'nifty50'
/** The first fetch of an index starts here (10 years of windows need 10 years of points). */
export const INDEX_START: Ymd = 20100101
/** Each incremental fetch reads back this many days, for late corrections. */
const INDEX_OVERLAP_DAYS = 10

// ─── Category → index ───────────────────────────────────────────────────────────────────────────────────────────

export type NoScore = 'young' | 'unmapped' | 'index_fund' | 'not_equity' | 'no_data' | 'waiting' | 'idcw_no_twin'
export type IndexChoice = { index: string } | { none: NoScore }

/** A sectoral or thematic fund's index, from words in its name; anything else is judged against Nifty 500. */
export function themeIndex(name: string): string {
  const n = name.toLowerCase()
  if (/bank|financ|bfsi/.test(n)) return 'finserv'
  if (/pharma|health/.test(n)) return 'healthcare'
  if (/technolog|\btech\b|\bit\b|digital/.test(n)) return 'it'
  if (/infra/.test(n)) return 'infra'
  if (/consum|fmcg/.test(n)) return 'consumption'
  if (/manufactur/.test(n)) return 'manufacturing'
  if (/\bauto|mobility|\bev\b/.test(n)) return 'auto'
  if (/energy|power|\boil\b/.test(n)) return 'energy'
  if (/\bpsu\b|\bpse\b|public sector/.test(n)) return 'pse'
  if (/\bmnc\b|multinational/.test(n)) return 'mnc'
  if (/defen[cs]e/.test(n)) return 'defence'
  if (/metal/.test(n)) return 'metal'
  if (/realty|real estate|housing/.test(n)) return 'realty'
  return 'nifty500'
}

/**
 * The index a fund is judged against: SEBI's tier-1 benchmark for its AMFI category (AMCs must use it since 2021).
 * `category` is the normalised AMFI header, e.g. "Open Ended Schemes (Equity Scheme - Large Cap Fund)". AMFI uses
 * two vocabularies side by side ("Equity Scheme - ELSS", "Equity Schemes - ELSS- Tax Saver Fund"); both map.
 */
export function fundIndex(category: string | null, name: string): IndexChoice {
  if (!category) return { none: 'unmapped' }
  const inner = (/\((.*)\)\s*$/.exec(category)?.[1] ?? category).toLowerCase()
  const [group, sub = group] = inner.split(/\s+-\s*/, 2).map((s) => s.trim()) as [string, string?]
  if (/exchange traded|index funds/.test(group) || (/other scheme/.test(group) && /index|etf/.test(sub))) return { none: 'index_fund' }
  if (/\bindex fund\b|\betf\b|\bbees\b/i.test(name)) return { none: 'index_fund' }
  if (/^equity scheme/.test(group)) {
    if (/large\s*&\s*mid/.test(sub)) return { index: 'largemid250' }
    if (/large cap/.test(sub)) return { index: 'nifty100' }
    if (/mid cap/.test(sub)) return { index: 'midcap150' }
    if (/small cap/.test(sub)) return { index: 'smallcap250' }
    if (/multi cap/.test(sub)) return { index: 'multicap' }
    if (/flexi|focused|elss|value|contra|dividend yield/.test(sub)) return { index: 'nifty500' }
    if (/sectoral|thematic/.test(sub)) return { index: themeIndex(name) }
    return { none: 'unmapped' }
  }
  if (group === 'elss' || group === 'growth') return { index: 'nifty500' } // old close-ended and open-ended equity
  return { none: 'not_equity' }
}

/** A share's sector index, from AMFI's industry names in fund portfolio disclosures. Null: no sector index. */
export function sectorIndex(sector: string | null | undefined): string | null {
  const s = (sector ?? '').toLowerCase()
  if (!s) return null
  if (/\bbanks?\b/.test(s)) return 'bank'
  if (/financ|insurance|capital market|nbfc/.test(s)) return 'finserv'
  if (/\bit\b|software|information tech/.test(s)) return 'it'
  if (/pharma|biotech/.test(s)) return 'pharma'
  if (/health/.test(s)) return 'healthcare'
  if (/auto/.test(s)) return 'auto'
  if (/petroleum|\boil\b|\bgas\b|power|energy|coal/.test(s)) return 'energy'
  if (/fmcg|food|beverage|personal products|household|tobacco/.test(s)) return 'fmcg'
  if (/metal|steel|mining|alumin/.test(s)) return 'metal'
  if (/realty|real estate/.test(s)) return 'realty'
  if (/cement|construction|telecom|infra/.test(s)) return 'infra'
  return null
}

// ─── Score maths (pure) ─────────────────────────────────────────────────────────────────────────────────────────

export const MIN_MONTHS = 36
export const MAX_MONTHS = 120
export const GAMMA = 2
/** A 5-year consistency part needs this many windows. */
export const MIN_5Y_WINDOWS = 12
/** 0–100 per point a year of risk-adjusted excess. */
export const POINTS_SCALE = 10

export type Series = { dates: string[]; values: number[] } // ISO dates, oldest first

export type Horizon = { years: 3 | 5 | 10; fund: number; index: number; excess: number } // CAGRs and MRAR excess, fractions
export type Rolling = { years: 3 | 5; windows: number; beat: number } // beat: share of windows, 0–1
export type ScoreResult =
  | { score: null; reason: 'young' | 'no_data'; months: number }
  | { score: number; months: number; since: string; excess: number; consistency: number; horizons: Horizon[]; rolling: Rolling[] }

const monthOf = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1
const monthEndIso = (m: number) => {
  const y = Math.floor(m / 12)
  const mon = (m % 12) + 1
  const last = new Date(Date.UTC(y, mon, 0)).getUTCDate()
  return `${y}-${String(mon).padStart(2, '0')}-${String(last).padStart(2, '0')}`
}

/** The last value in each calendar month, up to `asOf`'s month. */
export function monthEnds(s: Series, asOf: string): Map<number, number> {
  const out = new Map<number, number>()
  const end = monthOf(asOf)
  for (let i = 0; i < s.dates.length; i++) {
    const d = s.dates[i]!
    if (d > asOf) break
    const m = monthOf(d)
    if (m <= end && s.values[i]! > 0) out.set(m, s.values[i]!)
  }
  return out
}

/** Morningstar Risk-Adjusted Return, annualised: [mean (1 + r)^-γ]^(-12/γ) − 1 over monthly returns. */
export function mrar(returns: number[], gamma = GAMMA): number {
  const mean = returns.reduce((a, r) => a + (1 + r) ** -gamma, 0) / returns.length
  return mean ** (-12 / gamma) - 1
}

const cagr = (a: number, b: number, months: number) => (b / a) ** (12 / months) - 1
const clamp = (x: number) => Math.max(0, Math.min(100, x))
const TIE = 1e-12

/**
 * Score `fund` against `index` with windows ending at `asOf`'s month-end. Points run back from that month while both
 * have one (a missing month ends the run), at most MAX_MONTHS returns.
 */
export function scoreSeries(fund: Series, index: Series, asOf: string): ScoreResult {
  const f = monthEnds(fund, asOf)
  const x = monthEnds(index, asOf)
  const last = monthOf(asOf)
  const months: number[] = []
  for (let m = last; f.has(m) && x.has(m) && months.length <= MAX_MONTHS; m--) months.unshift(m)
  if (!months.length) return { score: null, reason: 'no_data', months: 0 }
  const n = months.length - 1 // monthly returns
  if (n < MIN_MONTHS) return { score: null, reason: 'young', months: n }
  const fp = months.map((m) => f.get(m)!)
  const xp = months.map((m) => x.get(m)!)
  const ret = (p: number[]) => p.slice(1).map((v, i) => v / p[i]! - 1)
  const fr = ret(fp)
  const xr = ret(xp)

  const horizons: Horizon[] = []
  for (const years of [3, 5, 10] as const) {
    const k = years * 12
    if (n < k) continue
    horizons.push({
      years,
      fund: cagr(fp[n - k]!, fp[n]!, k),
      index: cagr(xp[n - k]!, xp[n]!, k),
      excess: mrar(fr.slice(n - k)) - mrar(xr.slice(n - k)),
    })
  }
  const weights: Record<number, number> = n >= 120 ? { 10: 0.5, 5: 0.3, 3: 0.2 } : n >= 60 ? { 5: 0.6, 3: 0.4 } : { 3: 1 }
  const excess = horizons.reduce((a, h) => a + (weights[h.years] ?? 0) * h.excess, 0)

  const rolling: Rolling[] = []
  for (const years of [3, 5] as const) {
    const k = years * 12
    let windows = 0
    let beat = 0
    for (let e = k; e <= n; e++) {
      const d = cagr(fp[e - k]!, fp[e]!, k) - cagr(xp[e - k]!, xp[e]!, k)
      windows++
      beat += d > TIE ? 1 : d < -TIE ? 0 : 0.5
    }
    if (windows && (years === 3 || windows >= MIN_5Y_WINDOWS)) rolling.push({ years, windows, beat: beat / windows })
  }
  const consistency = rolling.reduce((a, r) => a + r.beat, 0) / rolling.length
  const score = Math.round(0.5 * clamp(50 + POINTS_SCALE * 100 * excess) + 0.5 * 100 * consistency)
  return { score, months: n, since: monthEndIso(months[0]!), excess, consistency, horizons, rolling }
}

/** The month-end the scores use: the last one before the month of the latest index level. */
export function scoreAsOf(latest: Ymd): Ymd {
  const y = Math.floor(latest / 10_000)
  const m = Math.floor(latest / 100) % 100
  const d = new Date(Date.UTC(y, m - 1, 0))
  return d.getUTCFullYear() * 10_000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate()
}

// ─── What the app shows ─────────────────────────────────────────────────────────────────────────────────────────

const pct = (x: number) => Math.round(x * 10_000) / 100 // fraction → % with 2 decimals

/** One score as stored in `score.data` and carried in the snapshot (web/src/lib/api.ts `Score`). */
export type ScoreView = {
  score: number | null
  reason: NoScore | null
  index: string | null // label
  as_of: string
  months?: number
  since?: string
  excess?: number // risk-adjusted excess, points a year
  consistency?: number // %
  horizons?: { years: number; fund: number; index: number }[] // CAGR %
  rolling?: { years: number; windows: number; beat: number }[] // beat %
  sector?: { index: string; years: number; windows: number; beat: number; excess: number } | null
  growth_option?: boolean // an IDCW option shown with its growth option's score
  price_only?: boolean // a share: closes without dividends
}

export function scoreView(r: ScoreResult | null, indexId: string | null, asOf: Ymd, extra: Partial<ScoreView> = {}, reason?: NoScore): ScoreView {
  const base: ScoreView = { score: null, reason: reason ?? null, index: indexId ? (BY_ID.get(indexId)?.label ?? null) : null, as_of: ymdToIso(asOf), ...extra }
  if (!r) return base
  if (r.score === null) return { ...base, reason: r.reason, months: r.months }
  return {
    ...base,
    score: r.score,
    reason: null,
    months: r.months,
    since: r.since,
    excess: pct(r.excess),
    consistency: pct(r.consistency),
    horizons: r.horizons.map((h) => ({ years: h.years, fund: pct(h.fund), index: pct(h.index) })),
    rolling: r.rolling.map((w) => ({ years: w.years, windows: w.windows, beat: pct(w.beat) })),
  }
}

// ─── Source: niftyindices.com (swap this section for a licensed feed) ───────────────────────────────────────────

export const TRI_URL = 'https://www.niftyindices.com/BackPage/getTotalReturnIndexString'
// Generic, with no app name. ✅ 2026-11-27: the site stalls (no answer in 30 s) any user agent containing "fetch" or
// starting "Mozilla", so the AMFI one (§10.4.1) can't be reused; "market-data/1.0" answers in ~0.2 s.
const USER_AGENT = 'market-data/1.0'

export type TriRow = { date: Ymd; tri: number }
export class TriFormatError extends Error {
  override name = 'TriFormatError'
}
export class TriFetchError extends Error {
  override name = 'TriFetchError'
  constructor(readonly status: number) {
    super(`status ${status}`)
  }
}

/**
 * ✅ 2026-11-27, live: a JSON array, newest first, `{"Index Name", "Date": "26 Nov 2026", "TotalReturnsIndex":
 * "39363.60", "NTR_Value", "RequestNumber"}`; an unknown name answers `[]`. Older answers wrapped it as `{d: "…"}`.
 */
export function parseTri(body: unknown, today: Ymd): TriRow[] {
  let rows = body
  if (rows && typeof rows === 'object' && !Array.isArray(rows) && typeof (rows as { d?: unknown }).d === 'string') rows = JSON.parse((rows as { d: string }).d)
  if (!Array.isArray(rows)) throw new TriFormatError('not an array')
  const out = new Map<Ymd, number>()
  for (const r of rows as Array<Record<string, unknown>>) {
    const date = typeof r?.Date === 'string' ? parseAmfiDate(r.Date.trim().replace(/\s+/g, '-')) : null
    const tri = Number(String(r?.TotalReturnsIndex ?? '').replace(/,/g, ''))
    if (date && date <= today && Number.isFinite(tri) && tri > 0) out.set(date, tri)
  }
  return [...out].map(([date, tri]) => ({ date, tri })).sort((a, b) => a.date - b.date)
}

type FetchOpts = { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> }
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** One index from `from` to `to`; one request covers years (the site's page limits a year, the endpoint doesn't). */
export async function fetchTri(name: string, from: Ymd, to: Ymd, opts: FetchOpts = {}): Promise<TriRow[]> {
  const f = opts.fetch ?? fetch
  const wait = opts.sleep ?? sleep
  const cinfo = `{'name':'${name}','startDate':'${ymdToAmfi(from)}','endDate':'${ymdToAmfi(to)}','indexName':'${name}'}`
  let last: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await wait(attempt === 1 ? 2_000 : 8_000)
    try {
      const res = await f(TRI_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8', 'user-agent': USER_AGENT, accept: 'application/json' },
        body: JSON.stringify({ cinfo }),
        signal: AbortSignal.timeout(30_000),
      })
      if (res.status === 429 || res.status >= 500) {
        last = new TriFetchError(res.status)
        continue
      }
      if (!res.ok) throw new TriFetchError(res.status)
      return parseTri(JSON.parse(await res.text()), to)
    } catch (err) {
      if (err instanceof TriFetchError || err instanceof TriFormatError || err instanceof SyntaxError) throw err
      last = err
    }
  }
  throw last instanceof Error ? last : new TriFetchError(0)
}

// ─── Store ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const indexSeriesKey = (id: string) => `market/idx/${id}.json`
export type IndexSeries = { id: string; dates: string[]; tris: number[] }
type Env = { MARKET: D1Database; BUCKET: R2Bucket }

async function writeIndexSeries(env: Env, id: string): Promise<void> {
  const res = await env.MARKET.withSession('first-primary').prepare('SELECT date, tri FROM index_level WHERE index_id = ?1 ORDER BY date').bind(id).all<TriRow>()
  const s: IndexSeries = { id, dates: res.results.map((r) => ymdToIso(r.date)), tris: res.results.map((r) => r.tri) }
  await env.BUCKET.put(indexSeriesKey(id), JSON.stringify(s), { httpMetadata: { contentType: 'application/json' } })
}

export type IndicesResult = { indices: number; changed: number; rows: number; failed: number }

/** Fetch every index (one after another), store what changed, rewrite those series. Throws only if all failed. */
export async function runIndices(env: Env, opts: { now?: number } & FetchOpts = {}): Promise<IndicesResult> {
  const today = istToday(opts.now ?? Date.now())
  const db = env.MARKET
  const latest = new Map(
    (await db.prepare('SELECT index_id, MAX(date) AS date FROM index_level GROUP BY index_id').all<{ index_id: string; date: Ymd }>()).results.map((r) => [r.index_id, r.date]),
  )
  const out: IndicesResult = { indices: INDICES.length, changed: 0, rows: 0, failed: 0 }
  let errorClass: string | null = null
  for (const ix of INDICES) {
    const have = latest.get(ix.id)
    try {
      const rows = await fetchTri(ix.name, have ? addDays(have, -INDEX_OVERLAP_DAYS) : INDEX_START, today, opts)
      if (!rows.length) continue
      const res = await db
        .prepare(
          `INSERT INTO index_level (index_id, date, tri)
           SELECT ?1, json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?2) WHERE true
           ON CONFLICT (index_id, date) DO UPDATE SET tri = excluded.tri WHERE index_level.tri <> excluded.tri`,
        )
        .bind(ix.id, JSON.stringify(rows.map((r) => [r.date, r.tri])))
        .run()
      const n = res.meta.changes ?? 0
      out.rows += n
      if (n) {
        out.changed++
        await writeIndexSeries(env, ix.id)
      }
    } catch (err) {
      out.failed++
      errorClass = err instanceof Error ? err.name : 'Error'
    }
  }
  console.log('indices', { ...out, error_class: errorClass })
  if (out.failed === INDICES.length) throw new TriFetchError(0)
  return out
}

/** The latest stored Nifty 50 level's date (scores wait for it). */
async function latestIndexDate(db: D1Database): Promise<Ymd | null> {
  return (await db.prepare('SELECT MAX(date) AS d FROM index_level WHERE index_id = ?1').bind(STOCK_INDEX).first<number>('d')) ?? null
}

/** Remember the sector of each share in a fund portfolio (M11/M18 rows), for the stock score's sector line. */
export function sectorStatement(db: D1Database, rows: Array<{ isin?: string | null; sector?: string | null }>, now: number): D1PreparedStatement | null {
  const pairs = new Map<string, string>()
  for (const r of rows) {
    const isin = (r.isin ?? '').toUpperCase()
    const sector = (r.sector ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
    if (EQUITY_ISIN.test(isin) && sector) pairs.set(isin, sector)
  }
  if (!pairs.size) return null
  return db
    .prepare(
      `INSERT INTO stock_sector (isin, sector, updated_at) SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), ?2 FROM json_each(?1) WHERE true
       ON CONFLICT (isin) DO UPDATE SET sector = excluded.sector, updated_at = excluded.updated_at WHERE stock_sector.sector <> excluded.sector`,
    )
    .bind(JSON.stringify([...pairs]), now)
}

/** score_state.version: part of every snapshot's inputs hash. */
export async function scoreVersion(env: { MARKET: D1Database }): Promise<number> {
  return (await env.MARKET.withSession('first-unconstrained').prepare('SELECT version FROM score_state WHERE id = 1').first<number>('version')) ?? 0
}

// ─── Jobs ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type ScoresMessage = { type: 'scores'; keys: string[] }
export type IndicesMessage = { type: 'indices' }
export const KEYS_PER_MESSAGE = 20
const KEY = /^(mf:[1-9]\d{0,8}|eq:IN[E9][0-9A-Z]{9})$/

/**
 * Which held funds and shares need a (new) score: none yet, an older month-end, history stored since (a backfill), or
 * waiting for a growth option's history. One `scores` message per 20 keys.
 */
export async function planScores(env: { MARKET: D1Database }, now: number, send: (msgs: ScoresMessage[]) => Promise<void>): Promise<number> {
  const db = env.MARKET
  const latest = await latestIndexDate(db)
  if (!latest) return 0
  const asOf = scoreAsOf(latest)
  const since = now - TRACKED_UNSEEN_MS
  const [funds, shares] = await db.batch<{ key: string }>([
    db
      .prepare(
        `SELECT 'mf:' || t.code AS key FROM (SELECT DISTINCT amfi_code AS code FROM tracked_scheme WHERE amfi_code IS NOT NULL AND last_seen_at >= ?1) t
         LEFT JOIN score s ON s.key = 'mf:' || t.code LEFT JOIN nav_backfill b ON b.amfi_code = t.code
         WHERE s.key IS NULL OR s.as_of < ?2 OR s.reason = 'waiting' OR (b.status = 'done' AND b.at > s.computed_at) ORDER BY t.code`,
      )
      .bind(since, asOf),
    db
      .prepare(
        `SELECT 'eq:' || e.isin AS key FROM tracked_equity e LEFT JOIN score s ON s.key = 'eq:' || e.isin
         WHERE e.last_seen_at >= ?1 AND e.exchange IN ('NSE', 'BSE') AND e.backfilled_at IS NOT NULL
           AND (s.key IS NULL OR s.as_of < ?2 OR e.backfilled_at > s.computed_at) ORDER BY e.isin`,
      )
      .bind(since, asOf),
  ])
  const keys = [...funds!.results, ...shares!.results].map((r) => r.key)
  const msgs: ScoresMessage[] = []
  for (let i = 0; i < keys.length; i += KEYS_PER_MESSAGE) msgs.push({ type: 'scores', keys: keys.slice(i, i + KEYS_PER_MESSAGE) })
  if (msgs.length) await send(msgs)
  console.log('scores_plan', { keys: keys.length, messages: msgs.length })
  return msgs.length
}

type SchemeInfo = { amfi_code: number; isin_growth: string | null; name: string; amc: string | null; category: string | null; plan: string | null; option: string | null }
const isGrowth = (option: string | null) => !option || /growth/i.test(option)

async function readJson<T>(env: Env, key: string): Promise<T | null> {
  const obj = await env.BUCKET.get(key)
  return obj ? ((await obj.json()) as T) : null
}

export type ScoresResult = { keys: number; scored: number; unscored: number; changed: number }

/** One pf-market message: score each key from the R2 series, upsert what changed, bump score_state. */
export async function runScores(env: Env, keys: string[], now = Date.now()): Promise<ScoresResult> {
  const db = env.MARKET
  const list = [...new Set(keys.filter((k) => KEY.test(k)))].slice(0, KEYS_PER_MESSAGE)
  const out: ScoresResult = { keys: list.length, scored: 0, unscored: 0, changed: 0 }
  const latest = list.length ? await latestIndexDate(db) : null
  if (!latest) return out
  const asOf = scoreAsOf(latest)
  const asOfIso = ymdToIso(asOf)

  const indexCache = new Map<string, Series | null>()
  const indexSeries = async (id: string) => {
    if (!indexCache.has(id)) {
      const s = await readJson<IndexSeries>(env, indexSeriesKey(id))
      indexCache.set(id, s ? { dates: s.dates, values: s.tris } : null)
    }
    return indexCache.get(id)!
  }
  const navSeries = async (code: number): Promise<Series | null> => {
    const s = await readJson<NavSeries>(env, seriesKey(code))
    return s ? { dates: s.dates, values: s.navs } : null
  }

  const codes = list.filter((k) => k.startsWith('mf:')).map((k) => Number(k.slice(3)))
  const isins = list.filter((k) => k.startsWith('eq:')).map((k) => k.slice(3))
  const [schemeRes, sectorRes] = await db.batch([
    db.prepare('SELECT amfi_code, isin_growth, name, amc, category, plan, option FROM scheme WHERE amfi_code IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(codes)),
    db.prepare('SELECT isin, sector FROM stock_sector WHERE isin IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(isins)),
  ])
  const schemes = new Map((schemeRes!.results as SchemeInfo[]).map((s) => [s.amfi_code, s]))
  const sectors = new Map((sectorRes!.results as { isin: string; sector: string }[]).map((r) => [r.isin, r.sector]))

  const views = new Map<string, ScoreView>()
  const track: Array<[string, number, string | null]> = [] // growth options to keep history for: [isin, code, amc]
  for (const code of codes) {
    const s = schemes.get(code)
    const key = `mf:${code}`
    if (!s) {
      views.set(key, scoreView(null, null, asOf, {}, 'no_data'))
      continue
    }
    const choice = fundIndex(s.category, s.name)
    if ('none' in choice) {
      views.set(key, scoreView(null, null, asOf, {}, choice.none))
      continue
    }
    let from = code
    let extra: Partial<ScoreView> = {}
    if (!isGrowth(s.option)) {
      // IDCW options lose NAV at every payout: show the growth option's score (same name and plan, 99% match).
      const twin = await db
        .prepare(`SELECT amfi_code, isin_growth FROM scheme WHERE name = ?1 AND plan IS ?2 AND amc IS ?3 AND amfi_code <> ?4 AND (option IS NULL OR lower(option) LIKE '%growth%') ORDER BY amfi_code LIMIT 1`)
        .bind(s.name, s.plan, s.amc, code)
        .first<{ amfi_code: number; isin_growth: string | null }>()
      if (!twin) {
        views.set(key, scoreView(null, choice.index, asOf, {}, 'idcw_no_twin'))
        continue
      }
      from = twin.amfi_code
      extra = { growth_option: true }
      if (twin.isin_growth) track.push([twin.isin_growth, twin.amfi_code, s.amc])
    }
    const [fund, index] = await Promise.all([navSeries(from), indexSeries(choice.index)])
    if (!fund) {
      views.set(key, scoreView(null, choice.index, asOf, extra, from === code ? 'no_data' : 'waiting'))
      continue
    }
    views.set(key, index ? scoreView(scoreSeries(fund, index, asOfIso), choice.index, asOf, extra) : scoreView(null, choice.index, asOf, extra, 'no_data'))
  }

  for (const isin of isins) {
    const key = `eq:${isin}`
    const px = await readJson<PriceSeries>(env, priceSeriesKey(isin))
    const index = await indexSeries(STOCK_INDEX)
    if (!px || !index) {
      views.set(key, scoreView(null, STOCK_INDEX, asOf, { price_only: true }, 'no_data'))
      continue
    }
    const share: Series = { dates: px.dates, values: px.closes }
    const view = scoreView(scoreSeries(share, index, asOfIso), STOCK_INDEX, asOf, { price_only: true })
    const sid = sectorIndex(sectors.get(isin))
    const sIndex = sid ? await indexSeries(sid) : null
    if (sid && sIndex && view.score !== null) {
      const r = scoreSeries(share, sIndex, asOfIso)
      const w = r.score !== null ? r.rolling[r.rolling.length - 1] : undefined
      if (r.score !== null && w) view.sector = { index: BY_ID.get(sid)!.label, years: w.years, windows: w.windows, beat: pct(w.beat), excess: pct(r.excess) }
    }
    views.set(key, view)
  }

  const rows = [...views].map(([key, v]) => [key, asOf, v.score, v.reason, JSON.stringify(v)])
  for (const [, v] of views) {
    if (v.score === null) out.unscored++
    else out.scored++
  }
  const stmts = [
    db
      .prepare(
        `INSERT INTO score (key, as_of, score, reason, data, computed_at)
         SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'), json_extract(value, '$[3]'), json_extract(value, '$[4]'), ?2
         FROM json_each(?1) WHERE true
         ON CONFLICT (key) DO UPDATE SET as_of = excluded.as_of, score = excluded.score, reason = excluded.reason, data = excluded.data, computed_at = excluded.computed_at
         WHERE score.data <> excluded.data OR score.as_of <> excluded.as_of`,
      )
      .bind(JSON.stringify(rows), now),
    // Rows left unchanged still count as computed now (so a backfill that changed nothing isn't planned again).
    db.prepare('UPDATE score SET computed_at = ?2 WHERE key IN (SELECT value FROM json_each(?1))').bind(JSON.stringify([...views.keys()]), now),
  ]
  // A growth option nobody holds is tracked like a held fund (public ids only), so its history is backfilled and kept.
  if (track.length)
    stmts.push(
      db
        .prepare(
          `INSERT INTO tracked_scheme (isin, amfi_code, amc, last_seen_at) SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'), ?2
           FROM json_each(?1) WHERE true ON CONFLICT (isin) DO UPDATE SET last_seen_at = excluded.last_seen_at, amfi_code = COALESCE(tracked_scheme.amfi_code, excluded.amfi_code)`,
        )
        .bind(JSON.stringify(track), now),
    )
  const res = await db.batch(stmts)
  out.changed = res[0]?.meta.changes ?? 0
  if (out.changed) await db.prepare('UPDATE score_state SET version = version + 1 WHERE id = 1').run()
  console.log('scores', out)
  return out
}

/** For a build: the scores of the held funds (by either ISIN of the scheme) and shares, keyed by ISIN. */
export async function scoresFor(env: { MARKET: D1Database }, isins: string[]): Promise<Record<string, ScoreView>> {
  if (!isins.length) return {}
  const json = JSON.stringify(isins)
  const res = await env.MARKET.withSession('first-unconstrained')
    .prepare(
      `SELECT x.isin, s.data FROM (SELECT value AS isin FROM json_each(?1)) x
       JOIN score s ON s.key = 'eq:' || x.isin
       UNION ALL
       SELECT x.isin, s.data FROM (SELECT value AS isin FROM json_each(?1)) x
       JOIN scheme c ON c.isin_growth = x.isin OR c.isin_reinvest = x.isin JOIN score s ON s.key = 'mf:' || c.amfi_code`,
    )
    .bind(json)
    .all<{ isin: string; data: string }>()
  const out: Record<string, ScoreView> = {}
  for (const r of res.results) out[r.isin] = JSON.parse(r.data) as ScoreView
  return out
}
