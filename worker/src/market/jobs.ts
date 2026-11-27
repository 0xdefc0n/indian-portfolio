// NAV jobs (plan §10.4.3): nav-ingest (cron ×4 a night), nav-backfill and series writes (pf-market), nav-repair
// (Sunday cron, then pf-market). Public market data only. Requests carry no user data: a backfill passes a scheme code
// and a date, nothing else. Logs carry counts, dates and error class names, never scheme codes: a backfill logged
// right after an upload would tie that household to a fund it holds (§0.1).
import { prebuild } from '../lib/snapshot'
import { EngineBusy, runAmc } from './amc-scrape'
import { runStocks } from './stocks'
import { metalRates, REF_CODES } from './metals'
import { amcId } from './amc-ids'
import { addDays, AmfiFormatError, anomalies, istToday, type NavRow, parseAmfiNav, parseMfapi, type Ymd, ymdToAmfi, ymdToIso } from './amfi'
import {
  anomalyStatements,
  BENCHMARK_CODE,
  pendingBackfillStatement,
  RECENT_DAYS,
  resolveTrackedStatement,
  schemeAnomalyStatements,
  schemeUpsertStatements,
  storeNavs,
  TRACKED_UNSEEN_MS,
  writeSeries,
} from './store'

export const NAVALL_URL = 'https://portal.amfiindia.com/spages/NAVAll.txt' // ✅ M9: www.amfiindia.com now 302s here
export const HISTORY_URL = 'https://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx'
export const MFAPI_URL = 'https://api.mfapi.in/mf/'
const USER_AGENT = 'Mozilla/5.0 (compatible; nav-fetch/1.0)' // generic (§10.4.1)

/** nav-ingest: 23:00, 02:00, 07:00 and 10:00 IST. The 10:00 run makes the night's dates final whatever their coverage. */
export const NAV_INGEST_CRONS = ['30 17 * * *', '30 20 * * *', '30 1 * * *', '30 4 * * *']
export const NAV_FINAL_CRON = '30 4 * * *'
export const NAV_REPAIR_CRON = '0 3 * * SUN'

/** The history report refuses long ranges (an HTML page with status 200): 107 days worked, 153 didn't (M9). */
export const HISTORY_CHUNK_DAYS = 90
/** Backfill from this far back when no statement gave a first transaction date. */
export const DEFAULT_HISTORY_DAYS = 5 * 365
/** AMFI's history starts on 1 April 2006. */
const HISTORY_START: Ymd = 20060401
export const SERIES_CODES_PER_MESSAGE = 20
/** pf-market's max_retries (wrangler.jsonc). The last attempt marks a backfill failed instead of going to the DLQ. */
export const MARKET_MAX_ATTEMPTS = 5
/** A backfill still pending this long lost its message: nav-ingest sends it again. */
export const BACKFILL_STUCK_MS = 6 * 3_600_000
/** nav-repair retries failed backfills this old. */
export const BACKFILL_RETRY_MS = 7 * 86_400_000

export type MarketMessage =
  | { type: 'backfill'; code: number; from?: Ymd }
  | { type: 'series'; codes: number[] }
  | { type: 'repair'; date: Ymd }
  | { type: 'stocks' } // the BharatStock job (src/market/stocks.ts, M11)
  | { type: 'amc' } // the AMC disclosure scrapers (src/market/amc-scrape.ts, M18)

/** pf-market sends, through one object so tests can capture them instead of the real queue. */
export const marketQueue = {
  async sendBatch(env: { Q_MARKET: Queue }, msgs: MarketMessage[]): Promise<void> {
    for (let i = 0; i < msgs.length; i += 100) await env.Q_MARKET.sendBatch(msgs.slice(i, i + 100).map((body) => ({ body })))
  },
}

/** Called once per date when it becomes final: snapshot-prebuild for the latest full NAV day (§10.3, M10). */
export const marketHooks = {
  async onFinal(env: Env, dates: Ymd[]): Promise<void> {
    console.log('market_day_final', { dates })
    await prebuild(env, { finalDates: dates.map(ymdToIso) }).catch((e) => console.error('prebuild_failed', (e as Error).name))
  },
  /** After every nav-ingest run: the gold and silver rates from the NAVs just stored (M29). */
  async afterIngest(env: Env, now: number): Promise<void> {
    await refreshMetals(env, now)
  },
}

// ─── Fetch ──────────────────────────────────────────────────────────────────────────────────────────────────────

export class FetchError extends Error {
  override name = 'FetchError'
  constructor(readonly status: number) {
    super(`status ${status}`)
  }
}

export type FetchOpts = { tries?: number; sleep?: (ms: number) => Promise<void>; timeoutMs?: number }
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** GET with retry and backoff (2 s, 8 s, …) on network errors, 429 and 5xx. Other statuses fail at once. */
export async function fetchWithRetry(url: string, opts: FetchOpts = {}): Promise<Response> {
  const tries = opts.tries ?? 3
  const sleep = opts.sleep ?? realSleep
  let last: unknown
  for (let attempt = 1; attempt <= tries; attempt++) {
    if (attempt > 1) await sleep(2_000 * 4 ** (attempt - 2))
    try {
      const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000) })
      if (res.ok) return res
      await res.body?.cancel()
      last = new FetchError(res.status)
      if (res.status !== 429 && res.status < 500) break
    } catch (err) {
      last = err
    }
  }
  throw last instanceof Error ? last : new FetchError(0)
}

const errorClass = (err: unknown) => (err instanceof Error ? err.name : 'Error')

// ─── Runs (the "fetched nothing twice in a row" alert) ──────────────────────────────────────────────────────────

type Run = { ok: boolean; parsed: number; inserted: number; error_class: string | null }

async function recordRun(env: Env, job: 'nav-ingest' | 'nav-repair', at: number, run: Run): Promise<void> {
  const db = env.MARKET
  const [, prev] = await db.batch<{ ok: number }>([
    db
      .prepare('INSERT INTO nav_run (job, at, ok, parsed, inserted, error_class) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT DO NOTHING')
      .bind(job, at, run.ok ? 1 : 0, run.parsed, run.inserted, run.error_class),
    db.prepare('SELECT ok FROM nav_run WHERE job = ?1 AND at < ?2 ORDER BY at DESC LIMIT 1').bind(job, at),
  ])
  // M16 turns this log line into an alert.
  if (!run.ok && prev?.results[0]?.ok === 0) console.error('nav_fetch_alert', { job, error_class: run.error_class })
}

// ─── nav-ingest ─────────────────────────────────────────────────────────────────────────────────────────────────

export type IngestResult = Run & { schemes: number; finalized: Ymd[]; series_msgs: number; backfills: number }

/**
 * One fetch of AMFI's daily file, then one batch: anomalies, NAV rows (ON CONFLICT DO NOTHING), the scheme upsert
 * (skipping unchanged rows), tracked codes resolved by ISIN, and pending backfills. Then market_day and finality, and
 * pf-market messages for the R2 series and the backfills. A re-run inserts nothing.
 */
export async function navIngest(env: Env, opts: { cron?: string; now?: number } & FetchOpts = {}): Promise<IngestResult> {
  const now = opts.now ?? Date.now()
  const started = Date.now()
  const today = istToday(now)
  const empty = { schemes: 0, finalized: [], series_msgs: 0, backfills: 0 }
  let parsed
  try {
    const res = await fetchWithRetry(NAVALL_URL, opts)
    parsed = parseAmfiNav(await res.text(), today)
    if (!parsed.navs.length) throw new AmfiFormatError('empty')
  } catch (err) {
    const run = { ok: false, parsed: 0, inserted: 0, error_class: errorClass(err) }
    await recordRun(env, 'nav-ingest', now, run)
    console.error('nav_ingest_failed', run.error_class)
    return { ...run, ...empty }
  }

  const db = env.MARKET
  const latest = parsed.navs.reduce((m, r) => Math.max(m, r.date), 0)
  const upserts = schemeUpsertStatements(db, parsed.schemes, now)
  const stored = await storeNavs(env, parsed.navs, {
    now,
    today,
    before: schemeAnomalyStatements(db, parsed.navs),
    after: [
      ...upserts,
      resolveTrackedStatement(db),
      pendingBackfillStatement(db, now),
      db.prepare("UPDATE nav_backfill SET at = ?1 WHERE status = 'pending' AND at < ?2 RETURNING amfi_code").bind(now, now - BACKFILL_STUCK_MS),
    ],
    finalUpTo: opts.cron === NAV_FINAL_CRON ? latest : null,
  })
  const afterRes = stored.extra.slice(-(upserts.length + 3))
  const schemes = afterRes.slice(0, upserts.length).reduce((n, r) => n + (r.meta.changes ?? 0), 0)
  const backfillCodes = [...new Set(afterRes.slice(-2).flatMap((r) => (r.results as { amfi_code: number }[]).map((x) => x.amfi_code)))]

  const series = chunk(stored.changedTracked, SERIES_CODES_PER_MESSAGE).map((codes): MarketMessage => ({ type: 'series', codes }))
  await marketQueue.sendBatch(env, [...backfillCodes.map((code): MarketMessage => ({ type: 'backfill', code })), ...series])
  if (stored.finalized.length) await marketHooks.onFinal(env, stored.finalized)

  const result: IngestResult = {
    ok: true,
    parsed: parsed.navs.length,
    inserted: stored.inserted,
    error_class: null,
    schemes,
    finalized: stored.finalized,
    series_msgs: series.length,
    backfills: backfillCodes.length,
  }
  await recordRun(env, 'nav-ingest', now, result)
  console.log('nav_ingest', { ...result, dropped: parsed.dropped, latest, ms: Date.now() - started })
  await marketHooks.afterIngest(env, now)
  return result
}

/**
 * Gold and silver rates (M29) from the reference ETFs' NAVs just stored. First run: their history is queued for
 * backfill, and each finished backfill runs this again. Never fails the caller.
 */
export async function refreshMetals(env: Env, now = Date.now()): Promise<void> {
  const run = await metalRates(env, now)
  if (run.backfills.length) await marketQueue.sendBatch(env, run.backfills.map((code): MarketMessage => ({ type: 'backfill', code }))).catch(() => undefined)
}

const chunk = <T>(rows: T[], size: number): T[][] => Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size))

// ─── nav-backfill (pf-market) ───────────────────────────────────────────────────────────────────────────────────

export type BackfillOutcome = { status: 'done' | 'skipped'; source?: 'mfapi' | 'amfi_history'; rows?: number }

export class BackfillEmpty extends Error {
  override name = 'BackfillEmpty'
}
export class NoAmcId extends Error {
  override name = 'NoAmcId'
}

/** mfapi's full history; if that fails or is empty, AMFI's history report for the scheme's AMC in 90-day chunks. */
export async function runBackfill(env: Env, code: number, from: Ymd | undefined, opts: { now?: number } & FetchOpts = {}): Promise<BackfillOutcome> {
  const now = opts.now ?? Date.now()
  const today = istToday(now)
  const db = env.MARKET
  const state = await db.prepare('SELECT status FROM nav_backfill WHERE amfi_code = ?1').bind(code).first<{ status: string }>()
  if (state?.status === 'done') return { status: 'skipped' }

  let rows: NavRow[] = []
  let source: 'mfapi' | 'amfi_history' = 'mfapi'
  try {
    const res = await fetchWithRetry(`${MFAPI_URL}${code}`, { ...opts, tries: 2, timeoutMs: 30_000 })
    rows = parseMfapi(await res.json(), code, today)
  } catch (err) {
    console.log('nav_backfill_mfapi_failed', errorClass(err))
  }
  if (!rows.length) {
    source = 'amfi_history'
    rows = await amfiHistory(env, code, from ?? addDays(today, -DEFAULT_HISTORY_DAYS), today, opts)
  }
  if (!rows.length) throw new BackfillEmpty()

  const inserts = insertNav(db, rows)
  const res = await db.batch([
    ...inserts,
    ...anomalyStatements(db, anomalies(rows)),
    db
      .prepare(
        `INSERT INTO nav_backfill (amfi_code, status, source, rows, from_date, at)
         SELECT ?1, 'done', ?2, COUNT(*), MIN(date), ?3 FROM nav WHERE amfi_code = ?1
         ON CONFLICT (amfi_code) DO UPDATE SET status = 'done', source = excluded.source, rows = excluded.rows,
           from_date = excluded.from_date, at = excluded.at`,
      )
      .bind(code, source, now),
  ])
  const inserted = res.slice(0, inserts.length).reduce((n, r) => n + (r.meta.changes ?? 0), 0)
  await writeSeries(env, [code])
  console.log('nav_backfill', { source, rows: rows.length, inserted })
  return { status: 'done', source, rows: inserted }
}

function insertNav(db: D1Database, rows: NavRow[]): D1PreparedStatement[] {
  return chunk(rows, 2_000).map((c) =>
    db
      .prepare(
        `INSERT INTO nav (amfi_code, date, nav) SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]')
         FROM json_each(?1) WHERE true ON CONFLICT DO NOTHING`,
      )
      .bind(JSON.stringify(c.map((r) => [r.amfi_code, r.date, r.nav]))),
  )
}

/** One scheme's rows from its AMC's history report, `from` to `today`, oldest chunk first. */
async function amfiHistory(env: Env, code: number, from: Ymd, today: Ymd, opts: FetchOpts): Promise<NavRow[]> {
  const amc = await env.MARKET.prepare('SELECT amc FROM scheme WHERE amfi_code = ?1').bind(code).first<string>('amc')
  const mf = amcId(amc)
  if (mf === null) throw new NoAmcId()
  const rows: NavRow[] = []
  for (let start = Math.max(from, HISTORY_START); start <= today; start = addDays(start, HISTORY_CHUNK_DAYS)) {
    const end = Math.min(addDays(start, HISTORY_CHUNK_DAYS - 1), today)
    const res = await fetchWithRetry(`${HISTORY_URL}?mf=${mf}&frmdt=${ymdToAmfi(start)}&todt=${ymdToAmfi(end)}`, opts)
    try {
      rows.push(...parseAmfiNav(await res.text(), today, { onlyCode: code }).navs)
    } catch (err) {
      if (!(err instanceof AmfiFormatError)) throw err // a period with no report for this AMC: nothing to add
    }
  }
  return rows
}

// ─── nav-repair ─────────────────────────────────────────────────────────────────────────────────────────────────

/** A date is a full business day when it has at least half the window's busiest day's rows (holidays have ~5%). */
export const REPAIR_HIGH_SHARE = 0.5

/**
 * Sunday: for the last 30 business days (45 calendar days), find dates where tracked schemes miss a NAV although the
 * day is a full one, and weekdays with no market_day row at all (every run missed them). One repair message per date.
 * Also retries backfills that failed a week or more ago.
 */
export async function navRepair(env: Env, opts: { now?: number } = {}): Promise<{ dates: Ymd[]; backfills: number }> {
  const now = opts.now ?? Date.now()
  const today = istToday(now)
  const from = addDays(today, -RECENT_DAYS)
  const read = env.MARKET.withSession('first-unconstrained')
  const days = await read.prepare('SELECT date, schemes_updated FROM market_day WHERE date >= ?1 AND date < ?2').bind(from, today).all<{ date: Ymd; schemes_updated: number }>()
  const max = days.results.reduce((m, d) => Math.max(m, d.schemes_updated), 0)
  const high = Math.max(1, Math.ceil(max * REPAIR_HIGH_SHARE))

  const gaps = await read
    .prepare(
      `WITH t AS (SELECT amfi_code AS code FROM tracked_scheme WHERE amfi_code IS NOT NULL AND last_seen_at >= ?4 UNION SELECT ?5),
            d AS (SELECT date FROM market_day WHERE date >= ?1 AND date < ?2 AND schemes_updated >= ?3)
       SELECT d.date AS date, COUNT(*) AS missing FROM d JOIN t JOIN scheme s ON s.amfi_code = t.code
       WHERE s.latest_date >= d.date
         AND NOT EXISTS (SELECT 1 FROM nav n WHERE n.amfi_code = t.code AND n.date = d.date)
         AND EXISTS (SELECT 1 FROM nav p WHERE p.amfi_code = t.code AND p.date < d.date)
       GROUP BY d.date`,
    )
    .bind(from, today, high, now - TRACKED_UNSEEN_MS, BENCHMARK_CODE)
    .all<{ date: Ymd; missing: number }>()

  const known = new Set(days.results.map((d) => d.date))
  const missingDays: Ymd[] = []
  for (let d = from; d < today; d = addDays(d, 1)) {
    const dow = new Date(Date.UTC(Math.floor(d / 10_000), (Math.floor(d / 100) % 100) - 1, d % 100)).getUTCDay()
    if (dow !== 0 && dow !== 6 && !known.has(d)) missingDays.push(d)
  }
  const dates = [...new Set([...gaps.results.map((g) => g.date), ...missingDays])].sort((a, b) => a - b)

  const retry = await env.MARKET.prepare("UPDATE nav_backfill SET status = 'pending', at = ?1 WHERE status = 'failed' AND at < ?2 RETURNING amfi_code")
    .bind(now, now - BACKFILL_RETRY_MS)
    .all<{ amfi_code: number }>()
  await marketQueue.sendBatch(env, [
    ...dates.map((date): MarketMessage => ({ type: 'repair', date })),
    ...retry.results.map((r): MarketMessage => ({ type: 'backfill', code: r.amfi_code })),
  ])
  console.log('nav_repair', { dates: dates.length, gaps: gaps.results.length, missing_days: missingDays.length, backfills: retry.results.length })
  return { dates, backfills: retry.results.length }
}

/** One repair date: AMFI's history report for every scheme on that day, stored like a nav-ingest run (no scheme upsert). */
export async function runRepair(env: Env, date: Ymd, opts: { now?: number } & FetchOpts = {}): Promise<Run> {
  const now = opts.now ?? Date.now()
  const today = istToday(now)
  let navs: NavRow[]
  try {
    const res = await fetchWithRetry(`${HISTORY_URL}?frmdt=${ymdToAmfi(date)}&todt=${ymdToAmfi(date)}`, opts)
    navs = parseAmfiNav(await res.text(), today).navs.filter((r) => r.date === date)
  } catch (err) {
    const run = { ok: false, parsed: 0, inserted: 0, error_class: errorClass(err) }
    await recordRun(env, 'nav-repair', now, run)
    throw err
  }
  const stored = await storeNavs(env, navs, { now, today })
  const series = chunk(stored.changedTracked, SERIES_CODES_PER_MESSAGE).map((codes): MarketMessage => ({ type: 'series', codes }))
  await marketQueue.sendBatch(env, series)
  if (stored.finalized.length) await marketHooks.onFinal(env, stored.finalized)
  const run = { ok: navs.length > 0, parsed: navs.length, inserted: stored.inserted, error_class: navs.length ? null : 'AmfiEmpty' }
  await recordRun(env, 'nav-repair', now, run)
  console.log('nav_repair_date', { date, parsed: navs.length, inserted: stored.inserted })
  return run
}

// ─── pf-market consumer ─────────────────────────────────────────────────────────────────────────────────────────

/** Messages run one after another, so max_concurrency 4 keeps mfapi and AMFI at ≤ 4 requests at a time. */
export async function handleMarketBatch(batch: MessageBatch<MarketMessage>, env: Env): Promise<void> {
  for (const msg of batch.messages) {
    const body = msg.body
    try {
      if (body?.type === 'backfill' && Number.isSafeInteger(body.code) && body.code > 0) {
        const out = await runBackfill(env, body.code, validYmd(body.from))
        if (out.status === 'done' && REF_CODES.includes(body.code)) await refreshMetals(env)
      } else if (body?.type === 'series' && Array.isArray(body.codes)) {
        await writeSeries(env, body.codes.filter((c) => Number.isSafeInteger(c) && c > 0).slice(0, SERIES_CODES_PER_MESSAGE))
      } else if (body?.type === 'repair' && validYmd(body.date)) {
        await runRepair(env, body.date)
      } else if (body?.type === 'amc') {
        // Busy: another run is going (it re-sends for what it didn't reach). EngineBusy: no batch slot, try later.
        const res = await runAmc(env).catch((err) => {
          if (err instanceof EngineBusy) return { status: 'busy' as const }
          throw err
        })
        if (res.status === 'busy' && msg.attempts < MARKET_MAX_ATTEMPTS) {
          msg.retry({ delaySeconds: 120 })
          continue
        }
      } else if (body?.type === 'stocks') {
        // Another run holds the lock: it runs one more pass if this was asked after it started. Try again in a
        // minute anyway, in case it was just finishing.
        if ((await runStocks(env)).status === 'busy' && msg.attempts < MARKET_MAX_ATTEMPTS) {
          msg.retry({ delaySeconds: 60 })
          continue
        }
      }
      msg.ack()
    } catch (err) {
      console.error('market_job_error', body?.type, errorClass(err), msg.attempts)
      if (msg.attempts >= MARKET_MAX_ATTEMPTS) {
        if (body?.type === 'backfill') {
          await env.MARKET.prepare("UPDATE nav_backfill SET status = 'failed', at = ?2 WHERE amfi_code = ?1").bind(body.code, Date.now()).run()
        }
        msg.ack()
      } else {
        msg.retry({ delaySeconds: Math.min(900, 60 * 2 ** (msg.attempts - 1)) })
      }
    }
  }
}

function validYmd(v: unknown): Ymd | undefined {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 19900101 && v <= 22001231 ? v : undefined
}
