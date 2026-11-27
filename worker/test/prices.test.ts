// Exchange prices for shares and bonds (plan §10.4.5, M20). Upstox is mocked: the saved public answers in
// test/fixtures/upstox (two NSE shares for November 2026, one intraday candle, the "invalid instrument" error),
// served by date range like the real API. Synthetic ISINs are INE9xx… made-up ones. Public market data only.
import { createExecutionContext, createMessageBatch, createScheduledController, env, getQueueResult, waitOnExecutionContext } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../src/index'
import { cleanup } from '../src/lib/cleanup'
import { handleMarketBatch, type MarketMessage, marketQueue } from '../src/market/jobs'
import {
  ADJUST_TOLERANCE,
  ASK_AGAIN_MS,
  equityIsins,
  ISINS_PER_MESSAGE,
  NONE_RECHECK_MS,
  parseCandles,
  PriceFormatError,
  type PriceSeries,
  priceSeriesKey,
  pricesPending,
  priceVersion,
  requestPrices,
  runPrices,
  trackEquities,
} from '../src/market/prices'
import { serveMarket } from '../src/market-gateway'
import intraday from './fixtures/upstox/intraday-INE002A01018-20261127.json?raw'
import invalid from './fixtures/upstox/invalid-instrument.json?raw'
import rel from './fixtures/upstox/nse-INE002A01018-202611.json?raw'
import tcs from './fixtures/upstox/nse-INE467B01029-202611.json?raw'

vi.setConfig({ testTimeout: 30_000 })
afterEach(() => vi.restoreAllMocks())
beforeEach(async () => {
  await env.MARKET.batch(['tracked_equity', 'stock_price'].map((t) => env.MARKET.prepare(`DELETE FROM ${t}`)))
  const listed = await env.BUCKET.list({ prefix: 'market/px/' })
  if (listed.objects.length) await env.BUCKET.delete(listed.objects.map((o) => o.key))
})

const REL = 'INE002A01018'
const TCS = 'INE467B01029'
type Candle = [string, number, number, number, number, number, number]
const candlesOf = (raw: string) => (JSON.parse(raw) as { data: { candles: Candle[] } }).data.candles

/** 27 Nov 2026 at hh:mm IST. */
const ist = (hh: number, mm = 0, day = 27) => Date.UTC(2026, 10, day, hh - 5, mm - 30)
const noSleep = { sleep: async () => undefined }

/**
 * A stand-in for Upstox: `books[exchange][isin]` = candles (any order); intraday answers `live[isin]` (today's candle).
 * Unknown instruments get the real 400. Returns the URLs asked for.
 */
function upstox(books: Partial<Record<'NSE' | 'BSE', Record<string, Candle[]>>>, live: Record<string, Candle> = {}, opts: { fail?: number } = {}) {
  const calls: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    calls.push(decodeURIComponent(url.pathname))
    if (opts.fail) return new Response('busy', { status: opts.fail })
    const intra = /^\/v3\/historical-candle\/intraday\/(NSE|BSE)_EQ\|(\w+)\/days\/1$/.exec(decodeURIComponent(url.pathname))
    const hist = /^\/v3\/historical-candle\/(NSE|BSE)_EQ\|(\w+)\/days\/1\/(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})$/.exec(decodeURIComponent(url.pathname))
    const [ex, isin] = (intra ?? hist ?? [])[1] ? [(intra ?? hist)![1] as 'NSE' | 'BSE', (intra ?? hist)![2]!] : ['', '']
    const book = books[ex as 'NSE' | 'BSE']?.[isin]
    if (!book) return new Response(invalid, { status: 400, headers: { 'content-type': 'application/json' } })
    if (intra) return Response.json({ status: 'success', data: { candles: live[isin] ? [live[isin]] : [] } })
    const [, , , to, from] = hist!
    const rows = book.filter((c) => c[0].slice(0, 10) >= from! && c[0].slice(0, 10) <= to!).sort((a, b) => b[0].localeCompare(a[0]))
    return Response.json({ status: 'success', data: { candles: rows } })
  })
  return calls
}

async function tracked(isins: string[], extra: Record<string, unknown> = {}) {
  await trackEquities(env, isins, ist(12))
  for (const [k, v] of Object.entries(extra)) {
    await env.MARKET.prepare(`UPDATE tracked_equity SET ${k} = ?1 WHERE isin IN (SELECT value FROM json_each(?2))`).bind(v, JSON.stringify(isins)).run()
  }
}
const n = async (sql: string, ...binds: unknown[]) => (await env.MARKET.prepare(sql).bind(...binds).first<number>('n')) ?? 0
const state = (isin: string) => env.MARKET.prepare('SELECT * FROM tracked_equity WHERE isin = ?1').bind(isin).first<Record<string, unknown>>()

describe('parseCandles (saved Upstox answers)', () => {
  it('reads the daily closes oldest first, as YYYYMMDD integers; holidays have no row', () => {
    const rows = parseCandles(JSON.parse(rel), REL, 20261127)
    expect(rows).toHaveLength(18)
    expect(rows[0]).toEqual({ isin: REL, date: 20261102, close: expect.any(Number) })
    expect(rows.at(-1)).toEqual({ isin: REL, date: 20261126, close: 1396.2 })
    expect(rows.map((r) => r.date)).not.toContain(20261124) // Guru Nanak Jayanti: no trading
    expect(rows.every((r, i) => i === 0 || r.date > rows[i - 1]!.date)).toBe(true)
    expect(parseCandles(JSON.parse(intraday), REL, 20261127)).toEqual([{ isin: REL, date: 20261127, close: 1382.6 }])
  })

  it('drops future dates and bad closes; a wrong shape throws', () => {
    expect(parseCandles(JSON.parse(rel), REL, 20261120).at(-1)!.date).toBe(20261120)
    const body = { status: 'success', data: { candles: [['2026-11-26T00:00:00+05:30', 1, 1, 1, 0, 0, 0], ['2026-11-25T00:00:00+05:30', 1, 1, 1, 'x', 0, 0]] } }
    expect(parseCandles(body, REL, 20261127)).toEqual([])
    expect(() => parseCandles(JSON.parse(invalid), REL, 20261127)).toThrow(PriceFormatError)
    expect(() => parseCandles({ status: 'success', data: { candles: [[123]] } }, REL, 20261127)).toThrow(PriceFormatError)
  })

  it('only shares and bonds are tracked (funds and ETFs have AMFI NAVs)', () => {
    expect(equityIsins([{ isin: REL }, { isin: 'ine467b01029' }, { isin: 'INF204KB17I5' }, { isin: 'IN0020230085' }, { isin: REL }])).toEqual([REL, TCS])
  })
})

describe('the price job', () => {
  it('a first run stores the history and the R2 series; a re-run writes 0 rows and keeps the version', async () => {
    await tracked([REL, TCS])
    const calls = upstox({ NSE: { [REL]: candlesOf(rel), [TCS]: candlesOf(tcs) } })
    const v0 = await priceVersion(env)
    const first = await runPrices(env, [REL, TCS], { now: ist(12), ...noSleep })
    expect(first).toMatchObject({ isins: 2, changed: 2, rows: 36, replaced: 0, unlisted: 0, failed: 0 })
    expect(await n('SELECT COUNT(*) AS n FROM stock_price')).toBe(36)
    expect(await state(REL)).toMatchObject({ exchange: 'NSE', latest_date: 20261126, backfilled_at: ist(12), failed_at: null })
    expect(await priceVersion(env)).toBe(v0 + 1)
    const s = await (await env.BUCKET.get(priceSeriesKey(REL)))!.json<PriceSeries>()
    expect(s.dates.at(-1)).toBe('2026-11-26')
    expect(s.closes.at(-1)).toBe(1396.2)
    expect(s.dates).toHaveLength(18)
    expect(calls.every((c) => !c.includes('/intraday/'))).toBe(true) // noon: the market is still open

    calls.length = 0
    const again = await runPrices(env, [REL, TCS], { now: ist(12, 30), ...noSleep })
    expect(again).toMatchObject({ changed: 0, failed: 0 })
    expect(await n('SELECT COUNT(*) AS n FROM stock_price')).toBe(36)
    expect(await priceVersion(env)).toBe(v0 + 1)
    // incremental: from 10 days before the latest stored close
    expect(calls).toEqual([`/v3/historical-candle/NSE_EQ|${REL}/days/1/2026-11-27/2026-11-16`, `/v3/historical-candle/NSE_EQ|${TCS}/days/1/2026-11-27/2026-11-16`])
  })

  it('after the close, today comes from the intraday candle; the next morning the official close replaces it', async () => {
    await tracked([REL])
    upstox({ NSE: { [REL]: candlesOf(rel) } }, { [REL]: candlesOf(intraday)[0]! })
    await runPrices(env, [REL], { now: ist(23), ...noSleep })
    expect(await state(REL)).toMatchObject({ latest_date: 20261127 })
    expect(await env.MARKET.prepare('SELECT close FROM stock_price WHERE isin = ?1 AND date = 20261127').bind(REL).first('close')).toBe(1382.6)

    // 07:00 IST next day: the history now has 27 Nov with the exchange's official close (a little different)
    const official: Candle = ['2026-11-27T00:00:00+05:30', 1393.8, 1398, 1373.1, 1383.05, 1, 0]
    upstox({ NSE: { [REL]: [...candlesOf(rel), official] } })
    const v = await priceVersion(env)
    const r = await runPrices(env, [REL], { now: Date.UTC(2026, 10, 28, 1, 30), ...noSleep })
    expect(r).toMatchObject({ changed: 1, replaced: 0 }) // a small correction, not an adjustment
    expect(await env.MARKET.prepare('SELECT close FROM stock_price WHERE isin = ?1 AND date = 20261127').bind(REL).first('close')).toBe(1383.05)
    expect(await priceVersion(env)).toBe(v + 1)
  })

  it('a bonus or split (the source adjusts its history) replaces the whole series', async () => {
    await tracked([REL])
    upstox({ NSE: { [REL]: candlesOf(rel) } })
    await runPrices(env, [REL], { now: ist(12), ...noSleep })
    // a 1:1 bonus: every past close is halved by the source
    const halved = candlesOf(rel).map((c): Candle => [c[0], c[1] / 2, c[2] / 2, c[3] / 2, c[4] / 2, c[5], c[6]])
    expect(0.5).toBeLessThan(1 - ADJUST_TOLERANCE)
    const calls = upstox({ NSE: { [REL]: halved } })
    const r = await runPrices(env, [REL], { now: ist(13), ...noSleep })
    expect(r).toMatchObject({ replaced: 1, changed: 1 })
    expect(calls).toHaveLength(2) // the incremental read, then the full history again
    expect(calls[1]).toBe(`/v3/historical-candle/NSE_EQ|${REL}/days/1/2026-11-27/2021-11-28`)
    const closes = (await env.MARKET.prepare('SELECT close FROM stock_price WHERE isin = ?1 ORDER BY date').bind(REL).all<{ close: number }>()).results
    expect(closes).toHaveLength(18)
    expect(closes.at(-1)!.close).toBe(698.1)
  })

  it('NSE first, then BSE; listed on neither: "none", looked up again after 30 days', async () => {
    const BSE_ONLY = 'INE9X0000011'
    const UNLISTED = 'INE9X0000029'
    await tracked([BSE_ONLY, UNLISTED])
    upstox({ BSE: { [BSE_ONLY]: candlesOf(tcs) } })
    const r = await runPrices(env, [BSE_ONLY, UNLISTED], { now: ist(12), ...noSleep })
    expect(r).toMatchObject({ changed: 1, unlisted: 1, failed: 0 })
    expect(await state(BSE_ONLY)).toMatchObject({ exchange: 'BSE', latest_date: 20261126 })
    expect(await state(UNLISTED)).toMatchObject({ exchange: 'none', latest_date: null })
    expect(await pricesPending(env, [BSE_ONLY, UNLISTED])).toEqual([]) // builds don't wait for an unlisted bond

    const sent: MarketMessage[][] = []
    await requestPrices(env, ist(12) + 86_400_000, async (m) => void sent.push(m))
    expect(sent.flat()).toEqual([{ type: 'prices', isins: [BSE_ONLY] }])
    sent.length = 0
    await requestPrices(env, ist(12) + NONE_RECHECK_MS + 1, async (m) => void sent.push(m))
    expect(sent.flat()).toEqual([{ type: 'prices', isins: [BSE_ONLY, UNLISTED] }])
  })

  it('a failing source is retried with backoff; a whole message failing is retried by the queue', async () => {
    await tracked([REL])
    const calls = upstox({}, {}, { fail: 503 })
    await expect(runPrices(env, [REL], { now: ist(12), ...noSleep })).rejects.toThrow("status 0")
    expect(calls).toHaveLength(3) // three tries on NSE, then give up (BSE isn't asked: NSE didn't say "unknown")
    expect(await state(REL)).toMatchObject({ failed_at: ist(12), backfilled_at: null })
    expect(await n('SELECT COUNT(*) AS n FROM stock_price')).toBe(0)

    const batch = createMessageBatch<MarketMessage>('pf-market', [{ id: 'p1', timestamp: new Date(), attempts: 1, body: { type: 'prices', isins: [REL] } }])
    const ctx = createExecutionContext()
    await handleMarketBatch(batch, env)
    const result = getQueueResult(batch, ctx)
    expect((await result).retryMessages).toHaveLength(1)
  })

  it('the cron sends every live ISIN, 50 per message; unseen ones (90 days) are left out and cleaned up', async () => {
    const many = Array.from({ length: 120 }, (_, i) => `INE9Y${String(i).padStart(6, '0')}1`)
    await tracked(many)
    await env.MARKET.prepare('UPDATE tracked_equity SET last_seen_at = 0 WHERE isin = ?1').bind(many[0]).run()
    await env.MARKET.prepare('INSERT INTO stock_price (isin, date, close) VALUES (?1, 20261126, 10)').bind(many[0]).run()
    const sent: MarketMessage[] = []
    vi.spyOn(marketQueue, 'sendBatch').mockImplementation(async (_e, msgs) => void sent.push(...msgs))
    const ctrl = createScheduledController({ cron: '30 17 * * *', scheduledTime: ist(23) })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('down', { status: 503 })) // nav-ingest fails quietly
    const ctx = createExecutionContext()
    await worker.scheduled!(ctrl, env, ctx)
    await waitOnExecutionContext(ctx)
    const prices = sent.filter((m) => m.type === 'prices') as { isins: string[] }[]
    expect(prices.map((m) => m.isins.length)).toEqual([ISINS_PER_MESSAGE, ISINS_PER_MESSAGE, 19])
    expect(prices.flatMap((m) => m.isins)).not.toContain(many[0])

    await cleanup(env, { now: ist(23) })
    expect(await state(many[0]!)).toBeNull()
    expect(await n('SELECT COUNT(*) AS n FROM stock_price WHERE isin = ?1', many[0])).toBe(0)
  })
})

describe('the upload path (tracked_equity)', () => {
  it('tracks shares and bonds, asks for a new one once (again after 6 h if it never arrived)', async () => {
    const now = ist(12)
    expect(await trackEquities(env, [REL, TCS], now)).toEqual([REL, TCS])
    expect(await trackEquities(env, [REL, TCS], now + 60_000)).toEqual([])
    expect(await pricesPending(env, [REL, TCS])).toEqual([REL, TCS])
    expect(await trackEquities(env, [REL], now + ASK_AGAIN_MS + 1)).toEqual([REL])

    upstox({ NSE: { [REL]: candlesOf(rel), [TCS]: candlesOf(tcs) } })
    const batch = createMessageBatch<MarketMessage>('pf-market', [{ id: 'p1', timestamp: new Date(), attempts: 1, body: { type: 'prices', isins: [REL, TCS, 'not-an-isin'] } }])
    const ctx = createExecutionContext()
    await handleMarketBatch(batch, env)
    expect((await getQueueResult(batch, ctx)).explicitAcks).toEqual(['p1'])
    expect(await pricesPending(env, [REL, TCS])).toEqual([])
    expect(await trackEquities(env, [REL], now + 2 * ASK_AGAIN_MS)).toEqual([]) // stored: never asked again
  })
})

describe('the market gateway', () => {
  it('serves /px/{isin}.json from R2 and refuses anything else', async () => {
    await env.BUCKET.put(priceSeriesKey(REL), JSON.stringify({ isin: REL, dates: ['2026-11-26'], closes: [1396.2] }))
    const ok = await serveMarket(env, new Request(`http://market.internal/px/${REL}.json`))
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ isin: REL, dates: ['2026-11-26'], closes: [1396.2] })
    expect((await serveMarket(env, new Request(`http://market.internal/px/${TCS}.json`))).status).toBe(404)
    for (const path of ['/px/INF204KB17I5.json', '/px/INE002A01018.json/x', `/px/${REL.toLowerCase()}.json`, '/px/']) {
      expect((await serveMarket(env, new Request(`http://market.internal${path}`))).status).toBe(403)
    }
  })
})
