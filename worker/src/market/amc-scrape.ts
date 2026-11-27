// Stocks inside funds from the AMCs' own monthly portfolio disclosures (plan §10.3.1, D10, M18). BharatStock
// (stocks.ts) becomes the fallback for what this doesn't cover.
//
// Which funds: the same `stock_match` rows the builds report (equity funds held, and funds inside them). Each gets its
// AMFI fund house from `scheme`; a fund house with an enabled adapter (amc/index.ts, env AMC_SCRAPERS) is scraped.
// The job (one `amc` message on pf-market, single-flight through job_lock 'amc'), for each due AMC, one at a time:
//   1. the adapter finds the target month's files (the month before today, IST); none yet = `not_published`;
//   2. the Worker downloads each file (fetcher.ts: robots.txt, ≥ 1 s per host, the adapter's hosts only);
//   3. the engine parses it and matches its schemes to the AMC's wanted funds (`/stocks/parse`, on an EngineBatch slot);
//   4. each matched fund gets an R2 blob `market/holdings/{isin}/{month}.json` and a fund_portfolio row with source
//      'amc' (replacing a BharatStock row for that month), and stock_state.version is bumped;
//   5. a scrape_run row records the outcome: ok, not_published, failed or blocked.
// An AMC is due when a wanted fund of it hasn't been covered for the target month and wasn't tried in the last 20 h,
// so the daily cron scrapes each AMC once a month and retries the days it isn't published yet.
//
// Logs carry slugs, months, counts and error class names. Never ISINs: the job runs right after a build asks for it.
import { engineNamespace, enginePool } from '../lib/engine-client'
import { AmcBlocked, AmcFetcher } from './amc/fetcher'
import { adapterFor } from './amc'
import { enabledAdapters, targetMonth } from './amc/coverage'
import type { AmcAdapter } from './amc/types'
import { holdingsKey, prevMonth, requestStocks, score, type StockRow } from './stocks'
import { sectorStatement } from './score'
import { TRACKED_UNSEEN_MS } from './store'

/** The daily run: 07:30 IST, before the 09:30 IST BharatStock run and the 10:00 IST final NAV run and prebuild. */
export const AMC_CRON = '0 2 * * *'
/** An AMC tried (any outcome) isn't tried again for this long. */
export const AMC_RETRY_MS = 20 * 3_600_000
export const AMC_LEASE_MS = 14 * 60_000
/** Stop starting new AMCs after this long; the rest get another message. */
const RUN_BUDGET_MS = 10 * 60_000
const REQUEST_LOST_MS = 15 * 60_000
/** Engine /stocks/parse timeout: inside the 120 s batch lease. */
export const PARSE_TIMEOUT_MS = 100_000
const MAX_FILES = 60
/** A per-scheme file is fetched when its scheme name scores this well against a wanted fund (the match is 0.6). */
const FILE_SCORE = 0.4

type AmcEnv = { DB: D1Database; MARKET: D1Database; BUCKET: R2Bucket; Q_MARKET: Queue; AMC_SCRAPERS?: string; BHARATSTOCK_API_KEY?: string; BHARATSTOCK_DAILY_LIMIT?: string }

/** pf-market sends for the job, through one object so tests can capture them. */
export const amcQueue = {
  async send(env: { Q_MARKET: Queue }): Promise<void> {
    await env.Q_MARKET.send({ type: 'amc' })
  },
}

/** Ask for a run, unless a message is already waiting (sent after the last run started, and not lost). */
export async function requestAmc(env: AmcEnv, now = Date.now(), force = false): Promise<boolean> {
  if (!enabledAdapters(env).length) return false
  const res = await env.MARKET.prepare(`UPDATE job_lock SET requested_at = ?1 WHERE name = 'amc' AND (?2 OR requested_at <= started_at OR requested_at < ?3)`)
    .bind(now, force ? 1 : 0, now - REQUEST_LOST_MS)
    .run()
  if (!(res.meta.changes ?? 0)) return false
  await amcQueue.send(env)
  return true
}

/** Fill in stock_match.amc from AMFI's scheme list for wanted funds that don't have it yet. */
async function resolveHouses(env: AmcEnv, now: number): Promise<void> {
  await env.MARKET.prepare(
    `UPDATE stock_match SET amc = (
       SELECT s.amc FROM scheme s WHERE s.isin_growth = stock_match.isin
       UNION ALL SELECT s.amc FROM scheme s WHERE s.isin_reinvest = stock_match.isin LIMIT 1)
     WHERE amc IS NULL AND wanted_at >= ?1`,
  )
    .bind(now - TRACKED_UNSEEN_MS)
    .run()
}

/** The enabled adapters with a wanted fund not yet covered for `month` and not tried in the last 20 h. */
export async function dueAdapters(env: AmcEnv, month: string, now: number): Promise<AmcAdapter[]> {
  const active = enabledAdapters(env)
  if (!active.length) return []
  await resolveHouses(env, now)
  const rows = (
    await env.MARKET.prepare(
      `SELECT DISTINCT lower(amc) AS amc FROM stock_match
       WHERE amc IS NOT NULL AND wanted_at >= ?1 AND (amc_month IS NULL OR amc_month < ?2) AND (amc_at IS NULL OR amc_at < ?3)`,
    )
      .bind(now - TRACKED_UNSEEN_MS, month, now - AMC_RETRY_MS)
      .all<{ amc: string }>()
  ).results
  const due = new Set(rows.map((r) => adapterFor(r.amc)?.slug).filter(Boolean))
  return active.filter((a) => due.has(a.slug))
}

export type AmcRunStatus = 'ok' | 'not_published' | 'failed' | 'blocked'
export type AmcScrape = { slug: string; month: string; status: AmcRunStatus; files: number; schemes: number; matched: number; wanted: number; requests: number; error?: string }
export type AmcResult = { status: 'done'; runs: AmcScrape[]; more: boolean } | { status: 'disabled' | 'busy' }

/** pf-market `amc` message: scrape every due AMC, one at a time. One run at a time. */
export async function runAmc(env: AmcEnv, opts: { now?: () => number; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {}): Promise<AmcResult> {
  if (!enabledAdapters(env).length) return { status: 'disabled' }
  const clock = opts.now ?? Date.now
  const db = env.MARKET
  const start = clock()
  const until = start + AMC_LEASE_MS
  const claim = await db.prepare(`UPDATE job_lock SET until = ?1, started_at = ?2 WHERE name = 'amc' AND until < ?2`).bind(until, start).run()
  if (!(claim.meta.changes ?? 0)) return { status: 'busy' }
  const runs: AmcScrape[] = []
  let more = false
  try {
    const month = targetMonth(start)
    const due = await dueAdapters(env, month, start)
    for (const [i, adapter] of due.entries()) {
      if (clock() - start > RUN_BUDGET_MS) {
        more = i < due.length
        break
      }
      const run = await scrapeAmc(env, adapter, month, clock(), opts)
      runs.push(run)
      // Not out yet: a fund with no data at all gets the month before, so a new user doesn't wait for the 10th.
      if (run.status === 'not_published' && (await hasNoData(env, adapter, start))) runs.push(await scrapeAmc(env, adapter, prevMonth(month), clock(), { ...opts, keepDue: true }))
    }
  } finally {
    await db.prepare(`UPDATE job_lock SET until = 0 WHERE name = 'amc' AND until = ?1`).bind(until).run()
  }
  if (more) await requestAmc(env, clock(), true)
  // What the AMCs didn't cover (blocked, failed, no matching scheme) is BharatStock's: let it look now.
  if (runs.length) await requestStocks(env, clock()).catch((err) => console.log('amc_stocks_request_failed', (err as Error).name))
  console.log('amc_run', { runs: runs.map((r) => `${r.slug}:${r.month}:${r.status}:${r.matched}/${r.wanted}`), ms: clock() - start, more })
  return { status: 'done', runs, more }
}

type WantRow = { isin: string; name: string; amfi_name: string | null }

async function wantedFor(env: AmcEnv, adapter: AmcAdapter, now: number): Promise<WantRow[]> {
  return (
    await env.MARKET.prepare(
      `SELECT m.isin, m.name, (SELECT s.name FROM scheme s WHERE s.isin_growth = m.isin OR s.isin_reinvest = m.isin LIMIT 1) AS amfi_name
       FROM stock_match m WHERE lower(m.amc) IN (SELECT value FROM json_each(?1)) AND m.wanted_at >= ?2 ORDER BY m.isin`,
    )
      .bind(JSON.stringify(adapter.amfi), now - TRACKED_UNSEEN_MS)
      .all<WantRow>()
  ).results
}

async function hasNoData(env: AmcEnv, adapter: AmcAdapter, now: number): Promise<boolean> {
  const row = await env.MARKET.prepare(
    `SELECT 1 AS x FROM stock_match m WHERE lower(m.amc) IN (SELECT value FROM json_each(?1)) AND m.wanted_at >= ?2
       AND NOT EXISTS (SELECT 1 FROM fund_portfolio f WHERE f.scheme_isin = m.isin) LIMIT 1`,
  )
    .bind(JSON.stringify(adapter.amfi), now - TRACKED_UNSEEN_MS)
    .first()
  return !!row
}

type Matched = Record<string, { scheme_name: string; score: number; as_of: string | null; rows: StockRow[] }>
type ParseAnswer = { ok: true; schemes: number; months: string[]; matched: Matched } | { ok: false; code: string }

export class EngineBusy extends Error {
  override name = 'EngineBusy'
}

/** /stocks/parse on a leased EngineBatch slot: the want JSON, then the file bytes, in one raw body. */
export const amcEngine = {
  async parse(env: AmcEnv, slug: string, filename: string, bytes: Uint8Array, want: [string, string, string][]): Promise<ParseAnswer> {
    const e = env as unknown as Env
    const pool = enginePool(e)
    const lease = await pool.acquire({ cls: 'batch', wait: false })
    if (!lease.ok) throw new EngineBusy()
    const started = Date.now()
    let ok = false
    try {
      const head = new TextEncoder().encode(JSON.stringify(want))
      const body = new Uint8Array(head.byteLength + bytes.byteLength)
      body.set(head, 0)
      body.set(bytes, head.byteLength)
      const engine = engineNamespace(e, 'batch').getByName(lease.name)
      const res = await engine.fetch('http://engine/stocks/parse', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', 'x-amc': slug, 'x-filename': filename.replace(/[^\w.-]+/g, '_').slice(0, 200), 'x-want-bytes': String(head.byteLength) },
        body,
        signal: AbortSignal.timeout(PARSE_TIMEOUT_MS),
      })
      if (res.status === 503) {
        await res.body?.cancel()
        throw new EngineBusy()
      }
      const out = await res.json<ParseAnswer>()
      ok = out.ok
      return out
    } finally {
      await pool.release(lease.lease_id, { duration_ms: Date.now() - started, ok, record: false })
    }
  },
}

/** Scrape one AMC for one month and store what matched. Never throws for the AMC's own problems: they're the status. */
export async function scrapeAmc(
  env: AmcEnv,
  adapter: AmcAdapter,
  month: string,
  now: number,
  opts: { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; keepDue?: boolean } = {},
): Promise<AmcScrape> {
  const want = await wantedFor(env, adapter, now)
  const run: AmcScrape = { slug: adapter.slug, month, status: 'ok', files: 0, schemes: 0, matched: 0, wanted: want.length, requests: 0 }
  const http = new AmcFetcher(adapter.hosts, { fetch: opts.fetch, sleep: opts.sleep })
  const matched: Matched = {}
  try {
    if (adapter.blocked) {
      run.status = 'blocked'
    } else if (want.length) {
      const found = await adapter.discover(month, http)
      if (!found.length) run.status = 'not_published'
      const list = want.map((w): [string, string, string] => [w.isin, w.name, w.amfi_name ?? ''])
      // Per-scheme files: only those that could be a wanted fund (the engine still does the real match).
      const names = list.flatMap(([, n, a]) => [n, a].filter(Boolean))
      const files = found.filter((f) => !f.scheme || names.some((n) => score(n, f.scheme!) >= FILE_SCORE)).slice(0, MAX_FILES)
      run.files = files.length
      for (const f of files) {
        const bytes = await http.file(f.url, f.init)
        const name = f.name ?? decodeURIComponent(new URL(f.url).pathname.split('/').pop() ?? 'file')
        const res = await amcEngine.parse(env, adapter.slug, name, bytes, list.filter(([isin]) => !matched[isin]))
        if (!res.ok) {
          if (res.code === 'unreadable') continue // an HTML page or a PDF among the links: skip it
          throw new AmcParseFailed(res.code)
        }
        run.schemes += res.schemes
        for (const [isin, m] of Object.entries(res.matched)) matched[isin] ??= m
      }
      // Files but no portfolios in them: the layout changed (or the adapter picked the wrong files).
      if (files.length && !run.schemes) throw new AmcParseFailed('no_schemes')
    }
  } catch (err) {
    if (err instanceof EngineBusy) throw err // not the AMC's fault: the queue retries the message
    run.status = err instanceof AmcBlocked ? 'blocked' : 'failed'
    run.error = (err as Error).name
  } finally {
    run.requests = http.stats.requests
  }
  run.matched = Object.keys(matched).length
  await storeRun(env, run, want, matched, now, opts.keepDue ?? false)
  return run
}

export class AmcParseFailed extends Error {
  override name = 'AmcParseFailed'
  constructor(readonly code: string) {
    super(code)
  }
}

async function storeRun(env: AmcEnv, run: AmcScrape, want: WantRow[], matched: Matched, now: number, keepDue: boolean): Promise<void> {
  const db = env.MARKET
  const writes: D1PreparedStatement[] = [
    db.prepare('INSERT INTO scrape_run (amc, month, status, schemes_found, error_class, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT DO NOTHING')
      .bind(run.slug, run.month, run.status, run.schemes, run.error ?? null, now),
  ]
  const isins = JSON.stringify(want.map((w) => w.isin))
  if (run.status === 'ok') {
    for (const [isin, m] of Object.entries(matched)) {
      const dataMonth = m.as_of && /^\d{4}-\d{2}$/.test(m.as_of) ? m.as_of : run.month
      const key = holdingsKey(isin, dataMonth)
      await env.BUCKET.put(key, JSON.stringify({ isin, month: dataMonth, source: 'amc', amc: run.slug, scheme: m.scheme_name, rows: m.rows }), { httpMetadata: { contentType: 'application/json' } })
      writes.push(
        db
          .prepare(
            `INSERT INTO fund_portfolio (scheme_isin, month, source, blob_key, fetched_at) VALUES (?1, ?2, 'amc', ?3, ?4)
             ON CONFLICT (scheme_isin, month) DO UPDATE SET source = 'amc', blob_key = excluded.blob_key, fetched_at = excluded.fetched_at`,
          )
          .bind(isin, dataMonth, key, now),
      )
    }
    // Every fund sent counts as covered for the month, matched or not (unmatched ones are BharatStock's from day 15).
    const month = keepDue ? null : run.month
    writes.push(
      db
        .prepare(
          `UPDATE stock_match SET amc_at = ?2, amc_month = COALESCE(?3, amc_month),
             amc_scheme = CASE WHEN ?3 IS NULL THEN amc_scheme ELSE json_extract(?4, '$.' || '"' || isin || '"') END
           WHERE isin IN (SELECT value FROM json_each(?1))`,
        )
        .bind(isins, now, month, JSON.stringify(Object.fromEntries(Object.entries(matched).map(([i, m]) => [i, m.scheme_name])))),
    )
    if (Object.keys(matched).length) writes.push(db.prepare('UPDATE stock_state SET version = version + 1 WHERE id = 1'))
    const sectors = sectorStatement(db, Object.values(matched).flatMap((m) => m.rows), now) // the stock score's sector line (M28)
    if (sectors) writes.push(sectors)
  } else {
    writes.push(db.prepare('UPDATE stock_match SET amc_at = ?2 WHERE isin IN (SELECT value FROM json_each(?1))').bind(isins, now))
    // A blocked or failing AMC leaves its funds to BharatStock: the next build's state changes, so rebuild.
    if (run.status !== 'not_published') writes.push(db.prepare('UPDATE stock_state SET version = version + 1 WHERE id = 1'))
  }
  await db.batch(writes)
}
