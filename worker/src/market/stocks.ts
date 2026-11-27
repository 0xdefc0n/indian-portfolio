// Stocks inside funds: the BharatStock fallback job (plan §10.3.1, D10, M11). Since M18 the AMCs' own disclosures
// (amc-scrape.ts) come first; BharatStock takes only the funds they don't cover (amc/coverage.ts amcCovers: no active
// adapter for the fund house, or no AMC data for the target month from day 15 on).
//
// Which funds: every snapshot build reports, from the engine, the funds its stocks view needs (equity funds and funds
// inside fund-of-funds, with a display name). recordWants() keeps them in MARKET.stock_match, public scheme ids only.
// The job (one `stocks` message on pf-market, single-flight through job_lock):
//   1. search a portfolio name once per fund (unmatched ones again after 30 days);
//   2. fetch a matched portfolio's holdings once, then again only when BharatStock's free coverage list shows a newer
//      month for its fund house (checked at most daily);
//   3. store each fund's month as an R2 blob `market/holdings/{isin}/{month}.json` and a fund_portfolio row
//      (source 'bharatstock'), and bump stock_state.version (part of every snapshot's inputs hash).
// Every paid call takes one unit of a global daily budget in `quota` (subject 'global', UTC days, since the provider's
// day is UTC) before it is sent, so a failed call still counts; a 429 uses up the rest of the day.
// The next build loads the blobs (stockData) and passes them to the engine as `market.stocks`.
//
// Only scheme names and portfolio names are sent. Logs carry counts and error class names, never ISINs or names.
import { quotaCounts, type QuotaSpec, quotaWindow, takeQuota } from '../lib/quota'
import { amcCovers, enabledAdapters, targetMonth } from './amc/coverage'
import { TRACKED_UNSEEN_MS } from './store'

export const BHARATSTOCK_URL = 'https://bharatstockapi.com'
const USER_AGENT = 'Mozilla/5.0 (compatible; fund-portfolios/1.0)' // generic, like the NAV fetches
/** The daily run: 09:30 IST, after BharatStock's day resets (00:00 UTC) and before the 10:00 IST final NAV run. */
export const STOCKS_CRON = '0 4 * * *'
export const DEFAULT_DAILY_LIMIT = 50 // of the free plan's 60
export const MATCH_SCORE = 0.6
export const UNMATCHED_RETRY_MS = 30 * 86_400_000
export const COVERAGE_MAX_AGE_MS = 86_400_000
/** A fund whose search or fetch got a 4xx (a name BharatStock refuses, a portfolio gone) waits this long. */
export const FETCH_RETRY_MS = 86_400_000
/** A build refreshes a fund's wanted_at at most this often (so the nightly prebuild writes almost nothing). */
export const WANT_REFRESH_MS = 86_400_000
/** BharatStock's page size limit (✅ M11: page_size > 100 is a 422). */
export const PAGE_SIZE = 100
const MAX_PAGES = 10
/** The job holds its lock this long at most (a queue consumer gets 15 min). */
export const JOB_LEASE_MS = 14 * 60_000
/** A message counts as lost (send another) after this long without a run starting. */
export const REQUEST_LOST_MS = 15 * 60_000
export const MAX_PASSES = 3
const MAX_WANTS = 100
const ISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/
const FUND_UNIT = 'MUTUAL_FUND_UNIT'

type StocksEnv = { DB: D1Database; MARKET: D1Database; BUCKET: R2Bucket; BHARATSTOCK_API_KEY?: string; BHARATSTOCK_DAILY_LIMIT?: string; AMC_SCRAPERS?: string }

/** The stocks view has a source: BharatStock (a key) or at least one AMC scraper. */
export const stocksEnabled = (env: { BHARATSTOCK_API_KEY?: string; AMC_SCRAPERS?: string }) => !!apiKey(env) || enabledAdapters(env).length > 0

export function apiKey(env: { BHARATSTOCK_API_KEY?: string }): string {
  return (env.BHARATSTOCK_API_KEY ?? '').trim().replace(/^["']|["']$/g, '')
}

export function dailyLimit(env: { BHARATSTOCK_DAILY_LIMIT?: string }): number {
  const n = Number.parseInt(env.BHARATSTOCK_DAILY_LIMIT ?? '', 10)
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DAILY_LIMIT
}

export const budgetSpec = (env: { BHARATSTOCK_DAILY_LIMIT?: string }): QuotaSpec => ({ subject: 'global', metric: 'bharatstock', period: 'day', limit: dailyLimit(env), utc: true })

/** Paid calls left today (UTC). */
export async function budgetLeft(env: StocksEnv, now = Date.now()): Promise<number> {
  const spec = budgetSpec(env)
  const [used] = await quotaCounts(env, [spec], now)
  return Math.max(0, spec.limit - (used ?? 0))
}

// ─── Matching (the old app's stocks.py, unchanged) ──────────────────────────────────────────────────────────────

const STOP = new Set(['fund', 'plan', 'direct', 'regular', 'growth', 'option', 'the', 'scheme', 'mutual', 'and', 'of', 'erstwhile', 'formerly'])

export function tokens(name: string): Set<string> {
  const n = name.toLowerCase().replaceAll('&', ' and ').replaceAll('fund of funds', 'fof').replace(/\(.*?\)/g, ' ')
  return new Set((n.match(/[a-z0-9]+/g) ?? []).filter((t) => !STOP.has(t)))
}

/** Token overlap (Jaccard) between two scheme names; ≥ 0.6 counts as a match. */
export function score(a: string, b: string): number {
  const ta = tokens(a)
  const tb = tokens(b)
  if (!ta.size || !tb.size) return 0
  let both = 0
  for (const t of ta) if (tb.has(t)) both++
  return both / (ta.size + tb.size - both)
}

/** Search text for the portfolio list: the fund's own name without 'Fund' and plan words. */
export function searchQuery(name: string): string {
  const n = name.replace(/\s*-\s*(direct|regular).*$/i, '').replace(/\bfund\b.*$/i, '').trim()
  return n || name
}

/** YYYY-MM before `m`. */
export function prevMonth(m: string): string {
  const y = Number(m.slice(0, 4))
  const mo = Number(m.slice(5, 7))
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`
}

// ─── HTTP ───────────────────────────────────────────────────────────────────────────────────────────────────────

export class BudgetSpent extends Error {
  override name = 'BudgetSpent'
}
export class StocksHttpError extends Error {
  override name = 'StocksHttpError'
  constructor(readonly status: number) {
    super(`status ${status}`)
  }
}

/** Paid BharatStock calls. Each takes a budget unit first. */
export class StocksClient {
  calls = 0
  constructor(
    private readonly env: StocksEnv,
    private readonly now: number,
  ) {}

  async get<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
    const spec = budgetSpec(this.env)
    if (!(await takeQuota(this.env, [spec], this.now)).ok) throw new BudgetSpent()
    this.calls++
    const url = new URL(path, BHARATSTOCK_URL)
    for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v))
    const res = await fetch(url, { headers: { 'x-api-key': apiKey(this.env), 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(30_000) })
    if (res.status === 429) {
      await res.body?.cancel()
      await spendRest(this.env, spec, this.now) // the provider says we're out: stop until tomorrow
      throw new BudgetSpent()
    }
    if (!res.ok) {
      await res.body?.cancel()
      throw new StocksHttpError(res.status)
    }
    return res.json<T>()
  }
}

async function spendRest(env: StocksEnv, spec: QuotaSpec, now: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO quota (subject, metric, window, count) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT (subject, metric, window) DO UPDATE SET count = MAX(count, ?4)`,
  )
    .bind(spec.subject, spec.metric, quotaWindow(spec.period, now, true), spec.limit)
    .run()
}

type SearchHit = { scheme_name: string; fund_house?: string | null }
type HoldingRow = { isin?: string | null; symbol?: string | null; company_name?: string | null; sector?: string | null; instrument_type?: string | null; pct_of_aum?: number | null }
type HoldingsPage = { portfolio_date?: string | null; data?: HoldingRow[]; pagination?: { total_pages?: number } }

export type StockRow = { isin: string; symbol: string | null; name: string | null; sector: string | null; type: string | null; pct: number }

export type Match = { provider_name: string | null; fund_house: string | null; score: number }

/** Best portfolio for a fund name: the search text, then its first two words if that found nothing good enough. */
export async function matchScheme(client: StocksClient, name: string, cache = new Map<string, SearchHit[]>()): Promise<Match> {
  let best: SearchHit | null = null
  let bestScore = 0
  if (name.trim()) {
    const q = searchQuery(name)
    for (const query of [...new Set([q, q.split(/\s+/).slice(0, 2).join(' ')])]) {
      let hits = cache.get(query.toLowerCase())
      if (!hits) {
        hits = (await client.get<{ data?: SearchHit[] }>('/v1/mf/portfolios', { q: query, limit: 50 })).data ?? []
        cache.set(query.toLowerCase(), hits)
      }
      for (const h of hits) {
        const s = score(name, h.scheme_name ?? '')
        if (s > bestScore) [best, bestScore] = [h, s]
      }
      if (bestScore >= MATCH_SCORE) break
    }
  }
  const ok = best !== null && bestScore >= MATCH_SCORE
  return { provider_name: ok ? best!.scheme_name : null, fund_house: ok ? (best!.fund_house ?? null) : null, score: Math.round(bestScore * 100) / 100 }
}

async function fetchRows(client: StocksClient, name: string, month?: string): Promise<{ rows: HoldingRow[]; month: string }> {
  const rows: HoldingRow[] = []
  let dataMonth = ''
  for (let page = 1; page <= MAX_PAGES; page++) {
    const d = await client.get<HoldingsPage>(`/v1/mf/portfolios/${encodeURIComponent(name)}/holdings`, { page, page_size: PAGE_SIZE, month })
    rows.push(...(d.data ?? []))
    dataMonth = (d.portfolio_date ?? '').slice(0, 7) || dataMonth
    if (page >= (d.pagination?.total_pages ?? 1)) break
  }
  return { rows, month: dataMonth }
}

/**
 * A portfolio's holdings. `month` is what it is fetched up to: the fund house's latest month even when that month has
 * no rows yet (then the month before is tried once), so it isn't fetched again until a newer month shows up.
 */
export async function fetchHoldings(client: StocksClient, name: string, latest: string | null, now: number): Promise<{ month: string; dataMonth: string | null; rows: StockRow[] }> {
  let { rows, month } = await fetchRows(client, name)
  if (!rows.length && latest) {
    const prev = await fetchRows(client, name, prevMonth(latest))
    rows = prev.rows
    month = prev.month || month
  }
  const kept: StockRow[] = rows
    .filter((r) => (r.pct_of_aum ?? 0) > 0)
    .map((r) => ({
      isin: String(r.isin || r.symbol || r.company_name || ''),
      symbol: r.symbol ?? null,
      name: r.company_name ?? null,
      sector: r.sector ?? null,
      type: r.instrument_type ?? null,
      pct: r.pct_of_aum ?? 0,
    }))
    .filter((r) => r.isin)
  const fetched = [month, latest ?? ''].sort().at(-1) || new Date(now).toISOString().slice(0, 7)
  return { month: fetched, dataMonth: kept.length ? month || fetched : null, rows: kept }
}

/** {fund house: latest month} from the free coverage list, refreshed at most daily; the stored copy if that fails. */
export async function coverage(env: StocksEnv, now: number): Promise<Map<string, string>> {
  const db = env.MARKET
  const stored = await db.prepare('SELECT fund_house, latest_month, fetched_at FROM stock_coverage').all<{ fund_house: string; latest_month: string | null; fetched_at: number }>()
  const fresh = stored.results.length > 0 && stored.results.every((r) => now - r.fetched_at < COVERAGE_MAX_AGE_MS)
  const toMap = (rows: { fund_house: string; latest_month: string | null }[]) => new Map(rows.filter((r) => r.latest_month).map((r) => [r.fund_house, r.latest_month!]))
  if (fresh) return toMap(stored.results)
  try {
    const res = await fetch(`${BHARATSTOCK_URL}/v1/mf-coverage`, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(30_000) })
    if (!res.ok) throw new StocksHttpError(res.status)
    const houses = ((await res.json<{ houses?: { fund_house?: string; latest_month?: string | null }[] }>()).houses ?? [])
      .filter((h): h is { fund_house: string; latest_month?: string | null } => typeof h.fund_house === 'string')
      .map((h) => ({ fund_house: h.fund_house, latest_month: /^\d{4}-\d{2}$/.test(h.latest_month ?? '') ? h.latest_month! : null }))
    if (!houses.length) throw new StocksHttpError(0)
    await db.batch([
      db.prepare('DELETE FROM stock_coverage'),
      db
        .prepare(
          `INSERT INTO stock_coverage (fund_house, latest_month, fetched_at)
           SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), ?2 FROM json_each(?1) WHERE true ON CONFLICT DO NOTHING`,
        )
        .bind(JSON.stringify(houses.map((h) => [h.fund_house, h.latest_month])), now),
    ])
    return toMap(houses)
  } catch (err) {
    console.log('stocks_coverage_failed', (err as Error).name)
    return toMap(stored.results)
  }
}

// ─── Wants (from builds) ────────────────────────────────────────────────────────────────────────────────────────

/** Valid [isin, name] pairs from the engine's X-Engine-Stocks-Want header (base64url JSON). */
export function decodeWant(header: string | null): [string, string][] {
  if (!header) return []
  try {
    const b64 = header.replaceAll('-', '+').replaceAll('_', '/')
    const bytes = Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0))
    const list = JSON.parse(new TextDecoder().decode(bytes)) as unknown
    if (!Array.isArray(list)) return []
    return list
      .filter((w): w is [string, string] => Array.isArray(w) && typeof w[0] === 'string' && ISIN.test(w[0]) && typeof w[1] === 'string')
      .map(([isin, name]): [string, string] => [isin, name.slice(0, 200)])
      .slice(0, MAX_WANTS)
  } catch {
    return []
  }
}

/**
 * Remember the funds a build needs. New ones are inserted; known ones get wanted_at refreshed at most daily. Returns
 * how many of the rows written were never searched (new funds, mostly). Known funds still waiting show up in the
 * build's own stockData() load instead.
 */
export async function recordWants(env: StocksEnv, want: [string, string][], now = Date.now()): Promise<number> {
  if (!want.length) return 0
  const res = await env.MARKET.prepare(
    `INSERT INTO stock_match (isin, name, wanted_at)
     SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), ?2 FROM json_each(?1) WHERE true
     ON CONFLICT (isin) DO UPDATE SET wanted_at = excluded.wanted_at,
       name = CASE WHEN stock_match.name = '' THEN excluded.name ELSE stock_match.name END
     WHERE excluded.wanted_at - stock_match.wanted_at >= ?3 OR (stock_match.name = '' AND excluded.name <> '')
     RETURNING checked_at`,
  )
    .bind(JSON.stringify(want), now, WANT_REFRESH_MS)
    .all<{ checked_at: number | null }>()
  return res.results.filter((r) => r.checked_at === null).length
}

/** pf-market sends for the job, through one object so tests can capture them. */
export const stocksQueue = {
  async send(env: { Q_MARKET: Queue }): Promise<void> {
    await env.Q_MARKET.send({ type: 'stocks' })
  },
}

/**
 * Ask for a job run. Sends a message unless one is already waiting (sent after the last run started, and not lost).
 * `force` (the daily cron) always sends.
 */
export async function requestStocks(env: StocksEnv & { Q_MARKET: Queue }, now = Date.now(), force = false): Promise<boolean> {
  if (!apiKey(env)) return false
  const res = await env.MARKET.prepare(
    `UPDATE job_lock SET requested_at = ?1 WHERE name = 'stocks' AND (?2 OR requested_at <= started_at OR requested_at < ?3)`,
  )
    .bind(now, force ? 1 : 0, now - REQUEST_LOST_MS)
    .run()
  if (!(res.meta.changes ?? 0)) return false
  await stocksQueue.send(env)
  return true
}

// ─── The job ────────────────────────────────────────────────────────────────────────────────────────────────────

type MatchRow = {
  isin: string
  name: string
  provider_name: string | null
  fund_house: string | null
  checked_at: number | null
  month: string | null
  failed_at: number | null
  amc: string | null
  amc_at: number | null
  amc_current: number
  has_data: number
}

/** stock_match columns plus what amcCovers() needs. ?2 = the target month. */
const MATCH_COLUMNS = `m.isin, m.name, m.provider_name, m.fund_house, m.checked_at, m.month, m.failed_at, m.amc, m.amc_at,
  EXISTS (SELECT 1 FROM fund_portfolio f WHERE f.scheme_isin = m.isin AND f.source = 'amc' AND f.month >= ?2) AS amc_current,
  EXISTS (SELECT 1 FROM fund_portfolio f WHERE f.scheme_isin = m.isin) AS has_data`

export type StocksStats = { matched: number; unmatched: number; fetched: number; failed: number; calls: number; budget: boolean }
export type StocksResult = ({ status: 'done' } & StocksStats & { passes: number }) | { status: 'disabled' | 'busy' }

export const holdingsKey = (isin: string, month: string) => `market/holdings/${isin}/${month}.json`

/** pf-market `stocks` message: up to MAX_PASSES passes while new requests keep arriving. One run at a time. */
export async function runStocks(env: StocksEnv, opts: { now?: () => number } = {}): Promise<StocksResult> {
  if (!apiKey(env)) return { status: 'disabled' }
  const clock = opts.now ?? Date.now
  const db = env.MARKET
  const start = clock()
  const until = start + JOB_LEASE_MS
  const claim = await db.prepare(`UPDATE job_lock SET until = ?1, started_at = ?2 WHERE name = 'stocks' AND until < ?2`).bind(until, start).run()
  if (!(claim.meta.changes ?? 0)) return { status: 'busy' }
  const total: StocksStats = { matched: 0, unmatched: 0, fetched: 0, failed: 0, calls: 0, budget: false }
  let passes = 0
  try {
    let passStart = start
    for (;;) {
      passes++
      const s = await stocksPass(env, passStart)
      for (const k of ['matched', 'unmatched', 'fetched', 'failed', 'calls'] as const) total[k] += s[k]
      total.budget ||= s.budget
      if (s.budget || passes >= MAX_PASSES) break
      const lock = await db.prepare(`SELECT requested_at FROM job_lock WHERE name = 'stocks'`).first<{ requested_at: number }>()
      if (!lock || lock.requested_at <= passStart) break
      passStart = Math.max(clock(), lock.requested_at)
      await db.prepare(`UPDATE job_lock SET started_at = ?1 WHERE name = 'stocks' AND until = ?2`).bind(passStart, until).run()
    }
  } finally {
    await db.prepare(`UPDATE job_lock SET until = 0 WHERE name = 'stocks' AND until = ?1`).bind(until).run()
  }
  console.log('stocks_run', { ...total, passes, ms: clock() - start })
  return { status: 'done', ...total, passes }
}

/** One pass over the wanted funds: search the unmatched ones, then fetch what's missing or newer. */
export async function stocksPass(env: StocksEnv, now: number): Promise<StocksStats> {
  const db = env.MARKET
  const stats: StocksStats = { matched: 0, unmatched: 0, fetched: 0, failed: 0, calls: 0, budget: false }
  // The funds the AMC scrapers cover are left alone (M18): BharatStock fills the gaps only.
  const rows = (
    await db
      .prepare(`SELECT ${MATCH_COLUMNS} FROM stock_match m WHERE m.wanted_at >= ?1 ORDER BY m.isin`)
      .bind(now - TRACKED_UNSEEN_MS, targetMonth(now))
      .all<MatchRow>()
  ).results.filter((r) => !amcCovers(env, r, now))
  const client = new StocksClient(env, now)
  try {
    // 1. Search: never-searched funds first, then unmatched ones due for another try.
    const toMatch = rows
      .filter((r) => !r.provider_name && (r.checked_at === null || now - r.checked_at >= UNMATCHED_RETRY_MS) && !failedRecently(r, now))
      .sort((a, b) => (a.checked_at ?? -1) - (b.checked_at ?? -1))
    const cache = new Map<string, SearchHit[]>()
    for (const r of toMatch) {
      let m: Match
      try {
        m = await matchScheme(client, r.name, cache)
      } catch (err) {
        if (!isRowError(err)) throw err
        stats.failed++
        console.log('stocks_search_failed', (err as StocksHttpError).status)
        await db.prepare('UPDATE stock_match SET failed_at = ?2 WHERE isin = ?1').bind(r.isin, now).run()
        continue
      }
      await db.batch([
        db.prepare('UPDATE stock_match SET provider_name = ?2, fund_house = ?3, score = ?4, checked_at = ?5 WHERE isin = ?1').bind(r.isin, m.provider_name, m.fund_house, m.score, now),
        db.prepare('UPDATE stock_state SET version = version + 1 WHERE id = 1'),
      ])
      Object.assign(r, m, { checked_at: now })
      if (m.provider_name) stats.matched++
      else stats.unmatched++
    }

    // 2. Fetch per portfolio (several ISINs, e.g. direct and regular plans, share one): never fetched first.
    const houses = await coverage(env, now)
    const groups = new Map<string, MatchRow[]>()
    for (const r of rows) if (r.provider_name) groups.set(r.provider_name, [...(groups.get(r.provider_name) ?? []), r])
    const due = [...groups.entries()]
      .map(([name, group]) => ({ name, group, latest: houses.get(group[0]!.fund_house ?? '') ?? null }))
      .filter(({ group, latest }) => group.some((r) => !r.month || (latest !== null && r.month < latest)))
      .filter(({ group }) => !group.every((r) => failedRecently(r, now)))
      .sort((a, b) => Number(a.group.every((r) => r.month)) - Number(b.group.every((r) => r.month)))
    for (const { name, group, latest } of due) {
      let got
      try {
        got = await fetchHoldings(client, name, latest, now)
      } catch (err) {
        if (!isRowError(err)) throw err
        stats.failed++
        console.log('stocks_fetch_failed', (err as StocksHttpError).status)
        await db.prepare('UPDATE stock_match SET failed_at = ?2 WHERE isin IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(group.map((r) => r.isin)), now).run()
        continue
      }
      await storeHoldings(env, group.map((r) => r.isin), got, now)
      stats.fetched++
    }
  } catch (err) {
    if (!(err instanceof BudgetSpent)) throw err
    stats.budget = true
  } finally {
    stats.calls = client.calls
  }
  return stats
}

const failedRecently = (r: { failed_at: number | null }, now: number) => r.failed_at !== null && now - r.failed_at < FETCH_RETRY_MS

/**
 * A 4xx is about this one fund: mark it and go on. A 5xx, a timeout or a network error means BharatStock is having
 * trouble: the pass stops, and the queue tries the message again with backoff.
 */
const isRowError = (err: unknown) => err instanceof StocksHttpError && err.status >= 400 && err.status < 500

/** The same holdings under each ISIN of the portfolio: R2 blobs, fund_portfolio rows, the fetched month. */
async function storeHoldings(env: StocksEnv, isins: string[], got: { month: string; dataMonth: string | null; rows: StockRow[] }, now: number): Promise<void> {
  const db = env.MARKET
  const writes: D1PreparedStatement[] = []
  if (got.dataMonth) {
    for (const isin of isins) {
      const key = holdingsKey(isin, got.dataMonth)
      await env.BUCKET.put(key, JSON.stringify({ isin, month: got.dataMonth, source: 'bharatstock', rows: got.rows }), { httpMetadata: { contentType: 'application/json' } })
      writes.push(
        db
          .prepare(
            `INSERT INTO fund_portfolio (scheme_isin, month, source, blob_key, fetched_at) VALUES (?1, ?2, 'bharatstock', ?3, ?4)
             ON CONFLICT (scheme_isin, month) DO UPDATE SET blob_key = excluded.blob_key, fetched_at = excluded.fetched_at
             WHERE fund_portfolio.source = 'bharatstock'`,
          )
          .bind(isin, got.dataMonth, key, now),
      )
    }
  }
  writes.push(
    db.prepare('UPDATE stock_match SET month = ?2, fetched_at = ?3, failed_at = NULL WHERE isin IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(isins), got.month, now),
    db.prepare('UPDATE stock_state SET version = version + 1 WHERE id = 1'),
  )
  await db.batch(writes)
}

// ─── Reads (snapshot builds) ────────────────────────────────────────────────────────────────────────────────────

/** The engine's `market.stocks` (engine/engine/stocks.py). */
export type StockData = {
  enabled: boolean
  matches: Record<string, { scheme_name: string | null; checked_at: number }>
  holdings: Record<string, { month: string; data_month: string | null; rows: StockRow[] }>
}

/** Part of every snapshot's inputs hash: changes whenever the job stores something. */
export async function stocksVersion(env: { MARKET: D1Database }): Promise<number> {
  const row = await env.MARKET.withSession('first-unconstrained').prepare('SELECT version FROM stock_state WHERE id = 1').first<{ version: number }>()
  return row?.version ?? 0
}

type LoadRow = MatchRow & { data_month: string | null; blob_key: string | null; source: string | null; amc_scheme: string | null }

/**
 * Stock data for the funds a household holds (and the funds inside them), from stock_match, fund_portfolio and the R2
 * blobs. `waiting` is true when one of them still needs the job (never searched, or matched and never fetched).
 */
export async function stockData(env: StocksEnv, held: string[], now = Date.now()): Promise<{ data: StockData; waiting: boolean }> {
  const data: StockData = { enabled: stocksEnabled(env), matches: {}, holdings: {} }
  const bharat = !!apiKey(env)
  const target = targetMonth(now)
  if (!data.enabled || !held.length) return { data, waiting: false }
  const read = env.MARKET.withSession('first-unconstrained')
  let waiting = false
  const seen = new Set<string>()
  let isins = held.filter((i) => ISIN.test(i))
  for (let depth = 0; depth < 2 && isins.length; depth++) {
    for (const i of isins) seen.add(i)
    const rows = (
      await read
        .prepare(
          `SELECT ${MATCH_COLUMNS}, m.amc_scheme, f.month AS data_month, f.blob_key, f.source
           FROM stock_match m LEFT JOIN fund_portfolio f ON f.scheme_isin = m.isin
             AND f.month = (SELECT MAX(month) FROM fund_portfolio WHERE scheme_isin = m.isin)
           WHERE m.isin IN (SELECT value FROM json_each(?1))`,
        )
        .bind(JSON.stringify(isins), target)
        .all<LoadRow>()
    ).results
    const blobs = await Promise.all(
      rows.map(async (r) => {
        if (!r.blob_key) return null
        const obj = await env.BUCKET.get(r.blob_key)
        return obj ? ((await obj.json()) as { rows?: StockRow[] }) : null
      }),
    )
    const next = new Set<string>()
    for (const [i, r] of rows.entries()) {
      const covered = amcCovers(env, r, now)
      if (r.source === 'amc' && r.blob_key) {
        // The AMC's own disclosure (M18), keyed per fund: the engine finds holdings by matches[isin].scheme_name.
        const key = `amc:${r.isin}`
        const stockRows = blobs[i]?.rows ?? []
        data.matches[r.isin] = { scheme_name: key, checked_at: r.amc_at ?? 0 }
        data.holdings[key] = { month: r.data_month!, data_month: r.data_month, rows: stockRows }
        for (const s of stockRows) if (s.type === FUND_UNIT && s.isin.startsWith('INF') && !seen.has(s.isin)) next.add(s.isin)
        continue
      }
      if (covered) {
        // The scraper is still on it (not tried yet, or older data shown): its run will store something or hand over.
        if (r.amc_at === null) waiting = true
        if (!r.blob_key) continue
      } else if (!bharat) {
        // No BharatStock key and the AMC didn't cover it: once the scraper has looked, it counts as unmatched.
        if (r.amc_at !== null) data.matches[r.isin] = { scheme_name: null, checked_at: r.amc_at }
        continue
      }
      if (r.checked_at === null) {
        if (!failedRecently(r, now)) waiting = true
        continue
      }
      data.matches[r.isin] = { scheme_name: r.provider_name, checked_at: r.checked_at }
      if (!r.provider_name) continue
      if (!r.month) {
        if (!failedRecently(r, now)) waiting = true
        continue
      }
      const stockRows = blobs[i]?.rows ?? []
      data.holdings[r.provider_name] ??= { month: r.month, data_month: r.data_month, rows: stockRows }
      for (const s of stockRows) if (s.type === FUND_UNIT && s.isin.startsWith('INF') && !seen.has(s.isin)) next.add(s.isin)
    }
    isins = [...next]
  }
  return { data, waiting }
}
