// Exchange prices for shares and bonds held in demat (plan §10.4.5, M20): one daily close per ISIN, so CDSL holdings
// are valued at the latest price and join daily returns.
//
// Source (owner, 2026-11-27): Upstox's public candle API, by ISIN, no key. NSE's and BSE's own end-of-day files
// ("bhavcopy") turn away automated clients (NSE drops the connection, BSE answers 403), so the plan's first choice
// failed its ⚠️ VERIFY. Everything source-specific is in the "Source" section below, so a licensed feed can replace
// it without touching the store, the jobs or the engine. Its terms for third-party use are on the launch checklist
// (M17). ✅ 2026-11-27, live:
//   - `GET /v3/historical-candle/{NSE_EQ|BSE_EQ}|{ISIN}/days/1/{to}/{from}`: 10 years of daily candles in one call
//     (~2,480 rows, 168 KB, 0.15 s), newest first, `[ts, open, high, low, close, volume, oi]`. Holidays have no row.
//     NSE shares, BSE shares and ETFs all answer. An unknown ISIN is 400 with errorCode UDAPI100011.
//   - Today's candle isn't in the history until later; `/v3/historical-candle/intraday/{key}/days/1` has it.
//   - History is adjusted for bonuses and splits (Reliance's 1:1 bonus of Oct 2024 shows ~₹1,340 before it, not
//     ~₹2,700). So stored closes can change after a corporate action: every run reads back a few days it already has,
//     and a mismatch beyond 2% replaces the ISIN's whole series.
//
// Jobs: the upload path tracks the INE/IN9 ISINs it saw (tracked_equity) and asks for their history at once; the
// 23:00 and 07:00 IST crons send every live ISIN through pf-market, 50 per message. Re-runs write 0 rows. A changed
// ISIN's R2 series (`market/px/{isin}.json`) is rewritten and price_state.version goes up (part of the inputs hash).
// Public market data only. Logs carry counts and error class names, never ISINs: one logged right after an upload
// would tie that household to a share it holds (§0.1).
import { addDays, istToday, type Ymd, ymdToIso } from './amfi'
import { TRACKED_UNSEEN_MS } from './store'

/** Shares and bonds (the engine's `equity_or_bond`). Funds and ETFs are INF and priced from AMFI's NAVs. */
export const EQUITY_ISIN = /^IN[E9][0-9A-Z]{9}$/
export const PRICE_CRONS = ['30 17 * * *', '30 1 * * *'] // 23:00 IST (today's close) and 07:00 IST (the official one)
export const ISINS_PER_MESSAGE = 50
/** Backfill depth: 10 years, so a share gets a 10-year score part (owner, M28; Upstox serves it in one call). */
export const PRICE_HISTORY_DAYS = 10 * 365
/** Each incremental fetch reads back this many days it already has, to catch adjustments and late corrections. */
export const OVERLAP_DAYS = 10
/** A stored close this far off the source's on the same date means the history was adjusted: replace it all. */
export const ADJUST_TOLERANCE = 0.02
/** ISINs neither exchange lists (unlisted shares, many bonds) are looked up again after this long. */
export const NONE_RECHECK_MS = 30 * 86_400_000
/** An ISIN asked for (upload) but not fetched in this long lost its message: asked again. */
export const ASK_AGAIN_MS = 6 * 3_600_000
/** From this IST hour today's candle is worth reading (the market closes at 15:30). */
const INTRADAY_FROM_HOUR = 16
const ROWS_PER_STATEMENT = 2_000

export type PriceRow = { isin: string; date: Ymd; close: number }
export type Exchange = 'NSE' | 'BSE'

export class PriceFormatError extends Error {
  override name = 'PriceFormatError'
}
export class UnknownInstrument extends Error {
  override name = 'UnknownInstrument'
}
export class PriceFetchError extends Error {
  override name = 'PriceFetchError'
  constructor(readonly status: number) {
    super(`status ${status}`)
  }
}

// ─── Source: Upstox (swap this section for another feed) ────────────────────────────────────────────────────────

export const UPSTOX_CANDLE_URL = 'https://api.upstox.com/v3/historical-candle'
const USER_AGENT = 'Mozilla/5.0 (compatible; price-fetch/1.0)' // generic (§10.4.1)
const key = (ex: Exchange, isin: string) => `${ex}_EQ%7C${isin}`

export const historyUrl = (ex: Exchange, isin: string, from: Ymd, to: Ymd) => `${UPSTOX_CANDLE_URL}/${key(ex, isin)}/days/1/${ymdToIso(to)}/${ymdToIso(from)}`
export const intradayUrl = (ex: Exchange, isin: string) => `${UPSTOX_CANDLE_URL}/intraday/${key(ex, isin)}/days/1`

/** Daily closes from a candle answer, oldest first. Drops future dates and non-positive closes. Throws on a bad shape. */
export function parseCandles(body: unknown, isin: string, today: Ymd): PriceRow[] {
  const b = body as { status?: unknown; data?: { candles?: unknown } }
  if (b?.status !== 'success' || !Array.isArray(b.data?.candles)) throw new PriceFormatError('shape')
  const byDate = new Map<Ymd, number>()
  for (const c of b.data.candles as unknown[]) {
    if (!Array.isArray(c) || typeof c[0] !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(c[0])) throw new PriceFormatError('candle')
    const date = Number(c[0].slice(0, 10).replaceAll('-', ''))
    const close = Number(c[4])
    if (date > today || !Number.isFinite(close) || close <= 0) continue
    byDate.set(date, close)
  }
  return [...byDate.entries()].sort((x, y) => x[0] - y[0]).map(([date, close]) => ({ isin, date, close }))
}

export type FetchOpts = { tries?: number; sleep?: (ms: number) => Promise<void>; timeoutMs?: number }
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** One candle request: retries network errors, 429 and 5xx (2 s, 8 s). 400 "Invalid Instrument key" → UnknownInstrument. */
async function candles(url: string, isin: string, today: Ymd, opts: FetchOpts): Promise<PriceRow[]> {
  const tries = opts.tries ?? 3
  const sleep = opts.sleep ?? realSleep
  let last: unknown
  for (let attempt = 1; attempt <= tries; attempt++) {
    if (attempt > 1) await sleep(2_000 * 4 ** (attempt - 2))
    let res: Response
    try {
      res = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' }, signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000) })
    } catch (err) {
      last = err
      continue
    }
    if (res.ok) return parseCandles(await res.json().catch(() => null), isin, today)
    if (res.status === 400) {
      const body = (await res.json().catch(() => null)) as { errors?: { errorCode?: string }[] } | null
      if (body?.errors?.some((e) => e.errorCode === 'UDAPI100011')) throw new UnknownInstrument()
      throw new PriceFetchError(400)
    }
    await res.body?.cancel()
    last = new PriceFetchError(res.status)
    if (res.status !== 429 && res.status < 500) break
  }
  throw last instanceof Error ? last : new PriceFetchError(0)
}

/** IST hour of `now` (0–23). */
const istHour = (now: number) => new Date(now + 5.5 * 3_600_000).getUTCHours()

/**
 * An ISIN's closes from `from` to today, from the exchange already known, else NSE then BSE. Today's candle comes from
 * the intraday endpoint once the market has closed. `exchange: null`: neither lists it.
 */
export async function fetchPrices(isin: string, known: Exchange | null, from: Ymd, now: number, opts: FetchOpts = {}): Promise<{ exchange: Exchange | null; rows: PriceRow[] }> {
  const today = istToday(now)
  let found: { exchange: Exchange; rows: PriceRow[] } | null = null
  for (const ex of known ? [known] : (['NSE', 'BSE'] as const)) {
    try {
      const rows = await candles(historyUrl(ex, isin, from, today), isin, today, opts)
      if (!found) found = { exchange: ex, rows }
      if (rows.length) {
        found = { exchange: ex, rows }
        break
      }
    } catch (err) {
      if (!(err instanceof UnknownInstrument)) throw err
    }
  }
  if (!found) return { exchange: null, rows: [] }
  if (istHour(now) >= INTRADAY_FROM_HOUR) {
    const live = await candles(intradayUrl(found.exchange, isin), isin, today, opts).catch((err) => {
      if (err instanceof UnknownInstrument) return []
      throw err
    })
    const byDate = new Map(found.rows.map((r) => [r.date, r]))
    for (const r of live) if (r.date === today) byDate.set(r.date, r)
    found.rows = [...byDate.values()].sort((a, b) => a.date - b.date)
  }
  return found
}

// ─── Store ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const priceSeriesKey = (isin: string) => `market/px/${isin}.json`
export type PriceSeries = { isin: string; dates: string[]; closes: number[] }

/** Upsert closes; only new or changed rows count, so a re-run writes 0. */
function upsertStatements(db: D1Database, rows: PriceRow[]): D1PreparedStatement[] {
  const out: D1PreparedStatement[] = []
  for (let i = 0; i < rows.length; i += ROWS_PER_STATEMENT) {
    const chunk = rows.slice(i, i + ROWS_PER_STATEMENT)
    out.push(
      db
        .prepare(
          `INSERT INTO stock_price (isin, date, close)
           SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]') FROM json_each(?1) WHERE true
           ON CONFLICT (isin, date) DO UPDATE SET close = excluded.close WHERE stock_price.close <> excluded.close`,
        )
        .bind(JSON.stringify(chunk.map((r) => [r.isin, r.date, r.close]))),
    )
  }
  return out
}

/** Rewrite the R2 series of these ISINs from D1 (the primary: the rows were just written). */
export async function writePriceSeries(env: { MARKET: D1Database; BUCKET: R2Bucket }, isins: string[]): Promise<void> {
  if (!isins.length) return
  const db = env.MARKET.withSession('first-primary')
  const res = await db.prepare('SELECT isin, date, close FROM stock_price WHERE isin IN (SELECT value FROM json_each(?1)) ORDER BY isin, date').bind(JSON.stringify(isins)).all<PriceRow>()
  const by = new Map<string, PriceSeries>(isins.map((i) => [i, { isin: i, dates: [], closes: [] }]))
  for (const r of res.results) {
    const s = by.get(r.isin)!
    s.dates.push(ymdToIso(r.date))
    s.closes.push(r.close)
  }
  for (const s of by.values()) {
    if (s.dates.length) await env.BUCKET.put(priceSeriesKey(s.isin), JSON.stringify(s), { httpMetadata: { contentType: 'application/json' } })
    else await env.BUCKET.delete(priceSeriesKey(s.isin))
  }
}

/** price_state.version: part of every snapshot's inputs hash, so a build after new closes isn't skipped as current. */
export async function priceVersion(env: { MARKET: D1Database }): Promise<number> {
  return (await env.MARKET.withSession('first-unconstrained').prepare('SELECT version FROM price_state WHERE id = 1').first<number>('version')) ?? 0
}

// ─── Jobs ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type PricesMessage = { type: 'prices'; isins: string[] }

type State = { isin: string; exchange: Exchange | 'none' | null; latest_date: Ymd | null; backfilled_at: number | null }
export type PricesResult = { isins: number; changed: number; rows: number; replaced: number; unlisted: number; failed: number }

/**
 * One pf-market message: fetch each ISIN (one after another; pf-market's max_concurrency 4 keeps Upstox at ≤ 4
 * requests at a time), store what changed, rewrite those series, and bump price_state. Throws only when every ISIN
 * failed (the message is retried); single failures are recorded and the next run tries again.
 */
export async function runPrices(env: { MARKET: D1Database; BUCKET: R2Bucket }, isins: string[], opts: { now?: number } & FetchOpts = {}): Promise<PricesResult> {
  const now = opts.now ?? Date.now()
  const today = istToday(now)
  const db = env.MARKET
  const list = [...new Set(isins.filter((i) => EQUITY_ISIN.test(i)))].slice(0, ISINS_PER_MESSAGE)
  const out: PricesResult = { isins: list.length, changed: 0, rows: 0, replaced: 0, unlisted: 0, failed: 0 }
  if (!list.length) return out
  const json = JSON.stringify(list)
  const [stateRes, overlapRes] = await db.batch([
    db.prepare('SELECT isin, exchange, latest_date, backfilled_at FROM tracked_equity WHERE isin IN (SELECT value FROM json_each(?1))').bind(json),
    db.prepare('SELECT isin, date, close FROM stock_price WHERE isin IN (SELECT value FROM json_each(?1)) AND date >= ?2').bind(json, addDays(today, -(OVERLAP_DAYS + 30))),
  ])
  const states = new Map((stateRes!.results as State[]).map((s) => [s.isin, s]))
  const stored = new Map<string, Map<Ymd, number>>()
  for (const r of overlapRes!.results as PriceRow[]) {
    if (!stored.has(r.isin)) stored.set(r.isin, new Map())
    stored.get(r.isin)!.set(r.date, r.close)
  }

  const stmts: D1PreparedStatement[] = []
  const counted: number[] = [] // indexes of the upserts, to count changed rows per ISIN
  const owner: string[] = []
  let errorClass: string | null = null
  for (const isin of list) {
    const st = states.get(isin)
    if (!st) continue // cleaned up meanwhile
    const known = st.exchange === 'NSE' || st.exchange === 'BSE' ? st.exchange : null
    const incremental = !!(known && st.backfilled_at && st.latest_date)
    try {
      let got = await fetchPrices(isin, known, incremental ? addDays(st.latest_date!, -OVERLAP_DAYS) : addDays(today, -PRICE_HISTORY_DAYS), now, opts)
      let replace = false
      if (incremental) {
        const mine = stored.get(isin)
        const adjusted = got.rows.some((r) => {
          const old = mine?.get(r.date)
          return old !== undefined && r.date !== today && Math.abs(r.close / old - 1) > ADJUST_TOLERANCE
        })
        if (adjusted) {
          got = await fetchPrices(isin, known, addDays(today, -PRICE_HISTORY_DAYS), now, opts)
          replace = true
          out.replaced++
        }
      }
      if (!got.exchange) {
        out.unlisted++
        stmts.push(db.prepare("UPDATE tracked_equity SET exchange = 'none', backfilled_at = ?2, checked_at = ?2, failed_at = NULL WHERE isin = ?1").bind(isin, now))
        continue
      }
      if (replace) {
        stmts.push(db.prepare('DELETE FROM stock_price WHERE isin = ?1').bind(isin))
        counted.push(stmts.length - 1)
        owner.push(isin)
      }
      for (const s of upsertStatements(db, got.rows)) {
        stmts.push(s)
        counted.push(stmts.length - 1)
        owner.push(isin)
      }
      out.rows += got.rows.length
      stmts.push(
        db
          .prepare(
            `UPDATE tracked_equity SET exchange = ?2, checked_at = ?3, failed_at = NULL, backfilled_at = COALESCE(backfilled_at, ?3),
               latest_date = (SELECT MAX(date) FROM stock_price WHERE isin = ?1) WHERE isin = ?1`,
          )
          .bind(isin, got.exchange, now),
      )
    } catch (err) {
      out.failed++
      errorClass = err instanceof Error ? err.name : 'Error'
      stmts.push(db.prepare('UPDATE tracked_equity SET failed_at = ?2, checked_at = ?2 WHERE isin = ?1').bind(isin, now))
    }
  }
  const res = stmts.length ? await db.batch(stmts) : []
  // A replaced series counts as changed even if every row came back the same (the delete's changes are counted too).
  const changed = new Set<string>()
  counted.forEach((idx, k) => {
    if ((res[idx]?.meta.changes ?? 0) > 0) changed.add(owner[k]!)
  })
  out.changed = changed.size
  if (changed.size) {
    await db.prepare('UPDATE price_state SET version = version + 1 WHERE id = 1').run()
    await writePriceSeries(env, [...changed])
  }
  console.log('prices', { ...out, error_class: errorClass })
  if (out.failed && out.failed === list.length) throw new PriceFetchError(0)
  return out
}

/** The cron: every live ISIN (seen in 90 days; 'none' ones once a month) to pf-market, 50 per message. */
export async function requestPrices(env: { MARKET: D1Database; Q_MARKET: Queue }, now = Date.now(), send: (msgs: PricesMessage[]) => Promise<void>): Promise<number> {
  const res = await env.MARKET.prepare(
    `SELECT isin FROM tracked_equity WHERE last_seen_at >= ?1 AND (exchange IS NULL OR exchange <> 'none' OR checked_at IS NULL OR checked_at < ?2) ORDER BY isin`,
  )
    .bind(now - TRACKED_UNSEEN_MS, now - NONE_RECHECK_MS)
    .all<{ isin: string }>()
  const isins = res.results.map((r) => r.isin)
  const msgs: PricesMessage[] = []
  for (let i = 0; i < isins.length; i += ISINS_PER_MESSAGE) msgs.push({ type: 'prices', isins: isins.slice(i, i + ISINS_PER_MESSAGE) })
  await send(msgs)
  console.log('prices_request', { isins: isins.length, messages: msgs.length })
  return msgs.length
}

/** Shares and bonds in a statement's holdings, deduplicated. */
export function equityIsins(holdings: Array<Record<string, unknown>>): string[] {
  const out = new Set<string>()
  for (const h of holdings) {
    const isin = typeof h.isin === 'string' ? h.isin.toUpperCase() : ''
    if (EQUITY_ISIN.test(isin)) out.add(isin)
  }
  return [...out]
}

/**
 * The upload path: track the shares and bonds it saw (last_seen refreshed at most daily), and return the ones whose
 * history isn't stored yet and weren't asked for in the last 6 h (marked asked now), for one prices message each 50.
 */
export async function trackEquities(env: { MARKET: D1Database }, isins: string[], now = Date.now()): Promise<string[]> {
  if (!isins.length) return []
  const db = env.MARKET
  const json = JSON.stringify(isins)
  const [, ask] = await db.batch<{ isin: string }>([
    db
      .prepare(
        `INSERT INTO tracked_equity (isin, last_seen_at) SELECT value, ?2 FROM json_each(?1) WHERE true
         ON CONFLICT (isin) DO UPDATE SET last_seen_at = excluded.last_seen_at WHERE excluded.last_seen_at - tracked_equity.last_seen_at >= 86400000`,
      )
      .bind(json, now),
    db
      .prepare(
        `UPDATE tracked_equity SET checked_at = ?2 WHERE isin IN (SELECT value FROM json_each(?1)) AND backfilled_at IS NULL
           AND (checked_at IS NULL OR checked_at < ?3) RETURNING isin`,
      )
      .bind(json, now, now - ASK_AGAIN_MS),
  ])
  return (ask?.results ?? []).map((r) => r.isin)
}

/** For a build: held shares whose history is still being fetched (the engine reads them fresh; build again later). */
export async function pricesPending(env: { MARKET: D1Database }, isins: string[]): Promise<string[]> {
  if (!isins.length) return []
  const res = await env.MARKET.withSession('first-unconstrained')
    .prepare('SELECT isin FROM tracked_equity WHERE isin IN (SELECT value FROM json_each(?1)) AND backfilled_at IS NULL')
    .bind(JSON.stringify(isins))
    .all<{ isin: string }>()
  return res.results.map((r) => r.isin)
}
