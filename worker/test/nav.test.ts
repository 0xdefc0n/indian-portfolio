// NAV store jobs (plan §10.4.3, §16 "NAV ingest", and the Jobs row's "NAV batch retry" and "Scheme upsert skips
// unchanged rows"). AMFI and mfapi are mocked: the real daily file excerpt or synthetic files in the same format.
// Synthetic schemes use 9000xx codes and fake ISINs. Public market data only; nothing here touches a user.
import { createExecutionContext, createMessageBatch, createScheduledController, env, getQueueResult, waitOnExecutionContext } from 'cloudflare:test'
import { exports } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../src/index'
import { addDays, ymdToAmfi, type Ymd } from '../src/market/amfi'
import {
  BACKFILL_STUCK_MS,
  fetchWithRetry,
  handleMarketBatch,
  HISTORY_URL,
  type MarketMessage,
  marketHooks,
  marketQueue,
  MFAPI_URL,
  NAV_FINAL_CRON,
  NAVALL_URL,
  navIngest,
  navRepair,
  runBackfill,
  runRepair,
} from '../src/market/jobs'
import { BENCHMARK_CODE, type NavSeries, seriesKey } from '../src/market/store'
import { firstTransactionDates, trackSchemes } from '../src/lib/statements'
import { marketStatus } from '../src/routes/market'
import historyUti from './fixtures/amfi/history-uti-excerpt.txt?raw'
import mfapiJson from './fixtures/amfi/mfapi-120716-excerpt.json?raw'
import navAll from './fixtures/amfi/NAVAll-excerpt.txt?raw'

vi.setConfig({ testTimeout: 30_000 })

const NAVALL_HEADER = 'Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date'
const HISTORY_HEADER = 'Scheme Code;NAV Name;Plan;Option;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Net Asset Value;Date'
const isinOf = (code: number) => `INF9S${String(code).padStart(6, '0')}0`
type Row = { code: number; nav: number; date: Ymd; name?: string }

/** A daily file in AMFI's format (CRLF, blank lines holding a space, category and AMC lines). */
function navFile(rows: Row[]): string {
  const lines = [NAVALL_HEADER, ' ', 'Open Ended Schemes(Equity Scheme - Flexi Cap Fund)', ' ', 'UTI Mutual Fund', ' ']
  for (const r of rows) lines.push(`${r.code};${isinOf(r.code)};-;${r.name ?? `Synth Fund ${r.code}`};Direct Plan;Growth;${r.nav.toFixed(4)};${ymdToAmfi(r.date)}`)
  return `${lines.join('\r\n')}\r\n`
}
function historyFile(rows: Row[]): string {
  const lines = [HISTORY_HEADER, '', 'Open Ended Schemes ( Equity Scheme - Flexi Cap Fund )', '', '', 'UTI Mutual Fund', '']
  for (const r of rows) lines.push(`${r.code};Synth Fund ${r.code} - Direct;Direct Plan;Growth;${isinOf(r.code)};;${r.nav.toFixed(4)};${ymdToAmfi(r.date)}`)
  return `${lines.join('\r\n')}\r\n`
}
const codes = (n: number, from = 900001) => Array.from({ length: n }, (_, i) => from + i)
const day = (list: number[], date: Ymd, nav = 100) => list.map((code) => ({ code, date, nav: nav + (code % 100) / 10 }))

/** Mock fetch; returns the URLs asked for. */
function mockFetch(handler: (url: URL) => Response | Promise<Response>) {
  const calls: URL[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    calls.push(url)
    return handler(url)
  })
  return calls
}
const text = (body: string, status = 200) => new Response(body, { status })
const navAllServes = (body: () => string) => mockFetch((u) => (u.toString() === NAVALL_URL ? text(body()) : text('', 404)))

function captureMarket() {
  const sent: MarketMessage[] = []
  vi.spyOn(marketQueue, 'sendBatch').mockImplementation(async (_env, msgs) => {
    sent.push(...msgs)
  })
  return sent
}

async function deliver(msgs: MarketMessage[], attempts = 1) {
  const batch = createMessageBatch<MarketMessage>('pf-market', msgs.map((body, i) => ({ id: `m${i}`, timestamp: new Date(), attempts, body })))
  const ctx = createExecutionContext()
  await handleMarketBatch(batch, env)
  return getQueueResult(batch, ctx)
}

const n = async (sql: string, ...binds: unknown[]) => (await env.MARKET.prepare(sql).bind(...binds).first<number>('n')) ?? 0
const marketDay = (date: Ymd) => env.MARKET.prepare('SELECT * FROM market_day WHERE date = ?1').bind(date).first<Record<string, number>>()
async function track(list: number[], opts: { withCode?: boolean; at?: number } = {}) {
  for (const code of list) {
    await env.MARKET.prepare('INSERT INTO tracked_scheme (isin, amfi_code, amc, last_seen_at) VALUES (?1, ?2, ?3, ?4)')
      .bind(isinOf(code), opts.withCode === false ? null : code, 'UTI Mutual Fund', opts.at ?? Date.now())
      .run()
  }
}

// 23:00 IST on Thursday 19-Nov and Friday 20-Nov 2026 (crons are UTC).
const D0: Ymd = 20261119
const D: Ymd = 20261120
const night = (date: Ymd, hourUtc: number) => Date.UTC(Math.floor(date / 10_000), (Math.floor(date / 100) % 100) - 1, date % 100, hourUtc, 30)

beforeEach(async () => {
  await env.MARKET.batch(['scheme', 'nav', 'market_day', 'nav_backfill', 'nav_anomaly', 'nav_run', 'tracked_scheme'].map((t) => env.MARKET.prepare(`DELETE FROM ${t}`)))
  const keys = (await env.BUCKET.list({ prefix: 'market/' })).objects.map((o) => o.key)
  if (keys.length) await env.BUCKET.delete(keys)
})
afterEach(() => vi.restoreAllMocks())

describe('nav-ingest', () => {
  it('stores the real daily file; a re-run inserts 0 rows and rewrites no scheme', async () => {
    const calls = navAllServes(() => navAll)
    const sent = captureMarket()
    const final = vi.spyOn(marketHooks, 'onFinal')
    const now = Date.UTC(2026, 10, 25, 20, 30) // 02:00 IST on 26-Nov

    const r1 = await navIngest(env, { cron: '30 20 * * *', now })
    expect(r1).toMatchObject({ ok: true, parsed: 65, inserted: 65, schemes: 65, error_class: null })
    expect(calls.map((u) => u.toString())).toEqual([NAVALL_URL])
    expect(await n('SELECT COUNT(*) AS n FROM nav')).toBe(65)
    expect(await n('SELECT COUNT(*) AS n FROM scheme')).toBe(65)
    expect(await env.MARKET.prepare('SELECT * FROM scheme WHERE amfi_code = ?1').bind(BENCHMARK_CODE).first()).toMatchObject({
      isin_growth: 'INF789F01XA0', isin_reinvest: null, amc: 'UTI Mutual Fund', latest_nav: 181.9059, latest_date: 20261125,
    })
    // Only recent dates get a market_day row (stale dates of wound-up schemes don't). Only the benchmark is tracked.
    expect((await env.MARKET.prepare('SELECT date FROM market_day').all()).results).toEqual([{ date: 20261125 }])
    expect(await marketDay(20261125)).toMatchObject({ schemes_updated: 47, tracked_total: 1, tracked_updated: 1, final: 1 })
    expect(final).toHaveBeenCalledTimes(1)
    expect(final.mock.calls[0]![1]).toEqual([20261125])
    expect(sent).toEqual([{ type: 'backfill', code: BENCHMARK_CODE }, { type: 'series', codes: [BENCHMARK_CODE] }])

    sent.length = 0
    const r2 = await navIngest(env, { cron: '30 1 * * *', now: now + 5 * 3_600_000 })
    expect(r2).toMatchObject({ ok: true, parsed: 65, inserted: 0, schemes: 0, finalized: [], series_msgs: 0, backfills: 0 })
    expect(await n('SELECT COUNT(*) AS n FROM nav')).toBe(65)
    expect(await marketDay(20261125)).toMatchObject({ schemes_updated: 47, final: 1 })
    expect(final).toHaveBeenCalledTimes(1)
    expect(sent).toEqual([])
    expect(await n('SELECT COUNT(*) AS n FROM nav_run WHERE job = ?1 AND ok = 1', 'nav-ingest')).toBe(2)
  })

  it('the scheme upsert skips unchanged rows, takes a new name, and never goes back to an older NAV', async () => {
    captureMarket()
    let file = navFile(day(codes(3), D0))
    navAllServes(() => file)
    expect((await navIngest(env, { now: night(D0, 17) })).schemes).toBe(3)
    expect((await navIngest(env, { now: night(D0, 20) })).schemes).toBe(0)

    file = navFile([{ code: 900001, nav: 100.1, date: D0, name: 'Synth Fund Renamed' }, ...day([900002, 900003], D0)])
    expect((await navIngest(env, { now: night(D0, 21) })).schemes).toBe(1)

    file = navFile([{ code: 900002, nav: 55, date: addDays(D0, -1) }])
    const r = await navIngest(env, { now: night(D0, 22) })
    expect([r.schemes, r.inserted]).toEqual([0, 1]) // the older NAV row is stored, the scheme keeps its latest
    expect(await env.MARKET.prepare('SELECT name, latest_date, latest_nav FROM scheme WHERE amfi_code IN (900001, 900002) ORDER BY amfi_code').all()).toMatchObject({
      results: [{ name: 'Synth Fund Renamed', latest_date: D0 }, { name: 'Synth Fund 900002', latest_date: D0, latest_nav: 100.2 }],
    })
  })

  it('partial nights move market_day coverage; the date turns final at 98%, once', async () => {
    captureMarket()
    const final = vi.spyOn(marketHooks, 'onFinal')
    const all = codes(50)
    await track(all)
    let file = navFile(day(all, D0))
    navAllServes(() => file)
    await navIngest(env, { cron: NAV_FINAL_CRON, now: night(D0, 4) + 86_400_000 }) // D0 complete
    expect(await marketDay(D0)).toMatchObject({ schemes_updated: 50, tracked_total: 50, tracked_updated: 50, final: 1 })
    final.mockClear()

    // 23:00 IST: 30 of 50 have D. The others still show D0 (no new row for D0).
    file = navFile([...day(all.slice(0, 30), D, 101), ...day(all.slice(30), D0)])
    expect((await navIngest(env, { cron: '30 17 * * *', now: night(D, 17) })).inserted).toBe(30)
    expect(await marketDay(D)).toMatchObject({ schemes_updated: 30, tracked_total: 50, tracked_updated: 30, final: 0 })
    expect(final).not.toHaveBeenCalled()

    // 02:00 IST: 49 of 50 (98%) → final, and the hook runs for D.
    file = navFile([...day(all.slice(0, 49), D, 101), ...day(all.slice(49), D0)])
    expect((await navIngest(env, { cron: '30 20 * * *', now: night(D, 20) })).inserted).toBe(19)
    expect(await marketDay(D)).toMatchObject({ schemes_updated: 49, tracked_updated: 49, final: 1 })
    expect(final.mock.calls.map((c) => c[1])).toEqual([[D]])

    // 07:00 IST: the last one arrives. Counts move; the date doesn't become final a second time.
    file = navFile(day(all, D, 101))
    await navIngest(env, { cron: '30 1 * * *', now: night(D, 1) + 86_400_000 })
    expect(await marketDay(D)).toMatchObject({ schemes_updated: 50, tracked_updated: 50, final: 1 })
    expect(final).toHaveBeenCalledTimes(1)
  })

  it('the 10:00 IST run makes the night final whatever its coverage', async () => {
    captureMarket()
    const final = vi.spyOn(marketHooks, 'onFinal')
    const all = codes(50)
    await track(all)
    navAllServes(() => navFile([...day(all.slice(0, 10), D), ...day(all.slice(10), D0)]))
    await navIngest(env, { cron: '30 1 * * *', now: night(D, 1) + 86_400_000 })
    expect(await marketDay(D)).toMatchObject({ tracked_updated: 10, final: 0 })
    await navIngest(env, { cron: NAV_FINAL_CRON, now: night(D, 4) + 86_400_000 })
    expect(await marketDay(D)).toMatchObject({ tracked_updated: 10, final: 1 })
    expect(final.mock.calls.at(-1)![1]).toContain(D)
  })

  it('a tracked scheme that stopped publishing does not hold a date back', async () => {
    captureMarket()
    await track(codes(2))
    navAllServes(() => navFile([{ code: 900001, nav: 10, date: D }, { code: 900002, nav: 10, date: addDays(D, -30) }]))
    await navIngest(env, { now: night(D, 17) })
    expect(await marketDay(D)).toMatchObject({ tracked_total: 1, tracked_updated: 1, final: 1 })
  })

  it('flags a day-on-day move over 20% in nav_anomaly, once', async () => {
    captureMarket()
    let file = navFile([{ code: 900001, nav: 100, date: D0 }, { code: 900002, nav: 100, date: D0 }])
    navAllServes(() => file)
    await navIngest(env, { now: night(D0, 17) })
    file = navFile([{ code: 900001, nav: 125, date: D }, { code: 900002, nav: 115, date: D }])
    await navIngest(env, { now: night(D, 17) })
    await navIngest(env, { now: night(D, 20) })
    expect((await env.MARKET.prepare('SELECT * FROM nav_anomaly').all()).results).toEqual([{ amfi_code: 900001, date: D, prev_date: D0, prev_nav: 100, nav: 125 }])
    expect(await n('SELECT COUNT(*) AS n FROM nav WHERE amfi_code = 900001')).toBe(2) // stored anyway
  })

  it('writes the R2 series of tracked schemes that changed, through pf-market', async () => {
    const sent = captureMarket()
    await track([900001, 900002])
    let file = navFile(day(codes(3), D0))
    navAllServes(() => file)
    await navIngest(env, { now: night(D0, 17) })
    file = navFile([...day([900001, 900003], D, 102), ...day([900002], D0)])
    sent.length = 0
    await navIngest(env, { now: night(D, 17) })
    const series = sent.filter((m) => m.type === 'series')
    expect(series).toEqual([{ type: 'series', codes: [900001] }]) // 900002 didn't change, 900003 isn't tracked

    expect((await deliver([{ type: 'series', codes: [900001, 900002] }])).explicitAcks).toHaveLength(1)
    const s = await (await env.BUCKET.get(seriesKey(900001)))!.json<NavSeries>()
    expect(s).toEqual({ amfi_code: 900001, dates: ['2026-11-19', '2026-11-20'], navs: [100.1, 102.1] })
    expect((await env.BUCKET.get(seriesKey(900002)))).not.toBeNull()
    expect(await env.BUCKET.get(seriesKey(900003))).toBeNull()
  })

  it('resolves CDSL-only tracked ISINs to a code, asks for each backfill once, and again when it is stuck', async () => {
    const sent = captureMarket()
    await track([900001], { withCode: false })
    navAllServes(() => navFile(day(codes(2), D)))
    const now = night(D, 17)
    await navIngest(env, { now })
    expect(await env.MARKET.prepare('SELECT amfi_code FROM tracked_scheme WHERE isin = ?1').bind(isinOf(900001)).first('amfi_code')).toBe(900001)
    expect(sent.filter((m) => m.type === 'backfill').sort((a, b) => (a as { code: number }).code - (b as { code: number }).code)).toEqual([
      { type: 'backfill', code: BENCHMARK_CODE },
      { type: 'backfill', code: 900001 },
    ])
    expect((await env.MARKET.prepare("SELECT COUNT(*) AS n FROM nav_backfill WHERE status = 'pending'").first('n'))).toBe(2)

    sent.length = 0
    await navIngest(env, { now: now + 3_600_000 })
    expect(sent.filter((m) => m.type === 'backfill')).toEqual([])
    await navIngest(env, { now: now + BACKFILL_STUCK_MS + 1 })
    expect(sent.filter((m) => m.type === 'backfill')).toHaveLength(2)
  })

  it('runs from the cron trigger', async () => {
    captureMarket()
    navAllServes(() => navFile(day(codes(2), D)))
    const ctx = createExecutionContext()
    await worker.scheduled!(createScheduledController({ cron: '30 17 * * *', scheduledTime: night(D, 17) }), env, ctx)
    await waitOnExecutionContext(ctx)
    expect(await n('SELECT COUNT(*) AS n FROM nav')).toBe(2)
  })
})

describe('fetch failures', () => {
  it('retries network errors and 5xx with backoff, not other statuses', async () => {
    let i = 0
    mockFetch(() => {
      i++
      if (i === 1) throw new TypeError('network')
      if (i === 2) return text('', 502)
      return text('ok')
    })
    const sleeps: number[] = []
    const res = await fetchWithRetry('https://portal.amfiindia.com/x', { sleep: async (ms) => void sleeps.push(ms) })
    expect([res.status, i, sleeps]).toEqual([200, 3, [2_000, 8_000]])

    const calls = mockFetch(() => text('', 404))
    await expect(fetchWithRetry('https://portal.amfiindia.com/y', { sleep: async () => {} })).rejects.toMatchObject({ name: 'FetchError', status: 404 })
    expect(calls).toHaveLength(1)
  })

  it('a run that fetches nothing is recorded; two in a row raise the alert', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const sleep = async () => {}
    mockFetch(() => text('', 503))
    expect(await navIngest(env, { now: night(D, 17), sleep })).toMatchObject({ ok: false, error_class: 'FetchError', inserted: 0 })
    expect(errors.mock.calls.filter((c) => c[0] === 'nav_fetch_alert')).toHaveLength(0)
    mockFetch(() => text('<!DOCTYPE html><html>…</html>')) // 200, but not the file
    expect(await navIngest(env, { now: night(D, 20), sleep })).toMatchObject({ ok: false, error_class: 'AmfiFormatError' })
    expect(errors.mock.calls.filter((c) => c[0] === 'nav_fetch_alert')).toEqual([['nav_fetch_alert', { job: 'nav-ingest', error_class: 'AmfiFormatError' }]])
    expect(await n('SELECT COUNT(*) AS n FROM nav_run WHERE ok = 0')).toBe(2)
  })
})

describe('the upload path (tracked_scheme)', () => {
  it('resolves a CDSL ISIN by the scheme table and sends one backfill with the first transaction date', async () => {
    const sent = captureMarket()
    navAllServes(() => navFile(day(codes(2), D)))
    await navIngest(env, { now: night(D, 17) })
    sent.length = 0

    const holdings = [{ isin: isinOf(900001), amc: 'UTI Mutual Fund' }, { isin: isinOf(900002), amc: 'UTI Mutual Fund', amfi: '900002' }]
    const first = firstTransactionDates([
      { isin: isinOf(900001), date: '2021-03-04' },
      { isin: isinOf(900001), date: '2020-01-15' },
      { isin: isinOf(900001), date: 'not a date' },
      { isin: 'INE000X01011', date: '2019-01-01' },
    ])
    expect([...first]).toEqual([[isinOf(900001), 20200115], ['INE000X01011', 20190101]])
    const now = Date.now()
    expect(await trackSchemes(env, holdings, now, first)).toBe(2)
    expect(await env.MARKET.prepare('SELECT amfi_code FROM tracked_scheme WHERE isin = ?1').bind(isinOf(900001)).first('amfi_code')).toBe(900001)
    expect(sent.sort((a, b) => (a as { code: number }).code - (b as { code: number }).code)).toEqual([
      { type: 'backfill', code: 900001, from: 20200115 },
      { type: 'backfill', code: 900002 },
    ])
    sent.length = 0
    await trackSchemes(env, holdings, now + 2 * 86_400_000, first)
    expect(sent).toEqual([])
  })
})

describe('nav-backfill', () => {
  /** The benchmark's scheme row (AMC "UTI Mutual Fund"), as nav-ingest leaves it. */
  async function seedScheme() {
    captureMarket()
    navAllServes(() => navAll)
    await navIngest(env, { now: Date.UTC(2026, 10, 25, 20, 30) })
    await env.MARKET.prepare('DELETE FROM nav').run()
    vi.restoreAllMocks()
  }
  const now = Date.UTC(2026, 10, 26, 4, 0) // 09:30 IST on 26-Nov

  it('stores the full mfapi history and writes the R2 series; done is never fetched again', async () => {
    const calls = mockFetch((u) => (u.toString() === `${MFAPI_URL}${BENCHMARK_CODE}` ? text(mfapiJson) : text('', 404)))
    expect(await runBackfill(env, BENCHMARK_CODE, undefined, { now })).toEqual({ status: 'done', source: 'mfapi', rows: 33 })
    expect(await env.MARKET.prepare('SELECT status, source, rows, from_date FROM nav_backfill WHERE amfi_code = ?1').bind(BENCHMARK_CODE).first()).toEqual({
      status: 'done', source: 'mfapi', rows: 33, from_date: 20130102,
    })
    const s = await (await env.BUCKET.get(seriesKey(BENCHMARK_CODE)))!.json<NavSeries>()
    expect([s.dates.length, s.dates[0], s.dates.at(-1), s.navs.at(-1)]).toEqual([33, '2013-01-02', '2026-11-25', 181.9059])
    expect(await n('SELECT COUNT(*) AS n FROM nav_anomaly WHERE amfi_code = ?1', BENCHMARK_CODE)).toBe(1) // the 2013 → 2026 jump in the excerpt
    expect(await runBackfill(env, BENCHMARK_CODE, undefined, { now })).toEqual({ status: 'skipped' })
    expect(calls).toHaveLength(1)
  })

  it('falls back to the AMFI history report for its AMC, in chunks of at most 90 days, when mfapi fails', async () => {
    await seedScheme()
    const calls = mockFetch((u) => {
      if (u.hostname === 'api.mfapi.in') return text('', 500)
      if (u.toString().startsWith(HISTORY_URL)) return text(u.searchParams.get('todt') === '26-Nov-2026' ? historyUti : '<!DOCTYPE html><html></html>')
      return text('', 404)
    })
    const r = await runBackfill(env, BENCHMARK_CODE, 20260601, { now, sleep: async () => {} })
    expect(r).toEqual({ status: 'done', source: 'amfi_history', rows: 61 })
    const history = calls.filter((u) => u.toString().startsWith(HISTORY_URL))
    expect(history.map((u) => [u.searchParams.get('mf'), u.searchParams.get('frmdt'), u.searchParams.get('todt')])).toEqual([
      ['28', '01-Jun-2026', '29-Aug-2026'],
      ['28', '30-Aug-2026', '26-Nov-2026'],
    ])
    expect(calls.filter((u) => u.hostname === 'api.mfapi.in')).toHaveLength(2) // one retry
    // Requests carry a scheme code and dates only.
    expect(calls.every((u) => [...u.searchParams.keys()].every((k) => ['mf', 'frmdt', 'todt'].includes(k)))).toBe(true)
    expect(await env.MARKET.prepare('SELECT source, from_date FROM nav_backfill WHERE amfi_code = ?1').bind(BENCHMARK_CODE).first()).toEqual({ source: 'amfi_history', from_date: 20260826 })
    expect(await env.BUCKET.get(seriesKey(BENCHMARK_CODE))).not.toBeNull()
  })

  it("also falls back when mfapi doesn't know the code (200 with no data)", async () => {
    await seedScheme()
    mockFetch((u) => (u.hostname === 'api.mfapi.in' ? text(JSON.stringify({ meta: {}, data: [], status: 'SUCCESS' })) : text(historyUti)))
    expect(await runBackfill(env, BENCHMARK_CODE, 20261001, { now })).toMatchObject({ status: 'done', source: 'amfi_history' })
  })

  it('a failing backfill is retried with backoff, and marked failed on its last attempt', async () => {
    await env.MARKET.prepare("INSERT INTO nav_backfill (amfi_code, status, at) VALUES (900001, 'pending', 1)").run()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    mockFetch(() => text('', 404)) // mfapi refuses; the scheme has no AMC, so no history fallback
    const first = await deliver([{ type: 'backfill', code: 900001 }], 1)
    expect(first.retryMessages).toEqual([expect.objectContaining({ msgId: 'm0' })]) // getQueueResult doesn't report the delay
    expect(await env.MARKET.prepare('SELECT status FROM nav_backfill WHERE amfi_code = 900001').first('status')).toBe('pending')
    const last = await deliver([{ type: 'backfill', code: 900001 }], 5)
    expect([last.retryMessages, last.explicitAcks]).toEqual([[], ['m0']])
    expect(await env.MARKET.prepare('SELECT status FROM nav_backfill WHERE amfi_code = 900001').first('status')).toBe('failed')
  })

  it('ignores malformed messages', async () => {
    const r = await deliver([{ type: 'backfill', code: -1 } as MarketMessage, { type: 'nope' } as unknown as MarketMessage, { type: 'repair', date: 'x' } as unknown as MarketMessage])
    expect(r.explicitAcks).toHaveLength(3)
  })
})

describe('nav-repair', () => {
  // Sunday 29-Nov 08:30 IST. Window: 15-Oct to 28-Nov.
  const now = Date.UTC(2026, 10, 29, 3, 0)
  const HOLIDAY: Ymd = 20261124
  const MISSED: Ymd = 20261110 // no run saw it: no market_day row
  const GAP: Ymd = 20261118 // a full day, but the tracked scheme has no NAV

  async function seed() {
    const days: [Ymd, number][] = []
    for (let d: Ymd = 20261012; d <= 20261127; d = addDays(d, 1)) {
      const dow = new Date(Date.UTC(Math.floor(d / 10_000), (Math.floor(d / 100) % 100) - 1, d % 100)).getUTCDay()
      if (d === MISSED) continue
      days.push([d, dow === 0 || dow === 6 || d === HOLIDAY ? 650 : 9_000])
    }
    await env.MARKET.prepare(
      `INSERT INTO market_day (date, schemes_updated, tracked_total, tracked_updated, final)
       SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), 1, 1, 1 FROM json_each(?1)`,
    )
      .bind(JSON.stringify(days))
      .run()
    await track([900001])
    await env.MARKET.prepare("INSERT INTO scheme (amfi_code, name, amc, latest_nav, latest_date, updated_at) VALUES (900001, 'Synth', 'UTI Mutual Fund', 10, 20261127, 1)").run()
    const navs = days.filter(([d, c]) => c > 1_000 && d !== GAP).map(([d]) => [900001, d, 10])
    await env.MARKET.prepare(`INSERT INTO nav (amfi_code, date, nav) SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]') FROM json_each(?1)`)
      .bind(JSON.stringify(navs))
      .run()
  }

  it('asks for the full days with tracked gaps and the weekdays no run saw, not holidays or weekends', async () => {
    await seed()
    await env.MARKET.batch([
      env.MARKET.prepare("INSERT INTO nav_backfill (amfi_code, status, at) VALUES (900101, 'failed', ?1)").bind(now - 8 * 86_400_000),
      env.MARKET.prepare("INSERT INTO nav_backfill (amfi_code, status, at) VALUES (900102, 'failed', ?1)").bind(now - 86_400_000),
    ])
    const sent = captureMarket()
    const r = await navRepair(env, { now })
    expect(r).toEqual({ dates: [MISSED, GAP], backfills: 1 })
    expect(sent).toEqual([{ type: 'repair', date: MISSED }, { type: 'repair', date: GAP }, { type: 'backfill', code: 900101 }])
    expect(await env.MARKET.prepare('SELECT status FROM nav_backfill WHERE amfi_code = 900101').first('status')).toBe('pending')
  })

  it("a repair date stores AMFI's report for that day and moves market_day", async () => {
    await seed()
    const sent = captureMarket()
    const calls = mockFetch((u) => (u.toString().startsWith(HISTORY_URL) ? text(historyFile([{ code: 900001, nav: 10.2, date: GAP }, { code: 900009, nav: 5, date: GAP }])) : text('', 404)))
    const before = await marketDay(GAP)
    const r = await runRepair(env, GAP, { now })
    expect(r).toEqual({ ok: true, parsed: 2, inserted: 2, error_class: null })
    expect(calls.map((u) => [u.searchParams.get('frmdt'), u.searchParams.get('todt'), u.searchParams.get('mf')])).toEqual([['18-Nov-2026', '18-Nov-2026', null]])
    expect(await env.MARKET.prepare('SELECT nav FROM nav WHERE amfi_code = 900001 AND date = ?1').bind(GAP).first('nav')).toBe(10.2)
    expect(await marketDay(GAP)).toMatchObject({ schemes_updated: (before?.schemes_updated ?? 0) + 2, tracked_total: 1, tracked_updated: 1 })
    expect(sent).toEqual([{ type: 'series', codes: [900001] }])
    // Run again: nothing new.
    expect((await runRepair(env, GAP, { now })).inserted).toBe(0)
  })

  it('runs from the Sunday cron', async () => {
    await seed()
    const sent = captureMarket()
    const ctx = createExecutionContext()
    await worker.scheduled!(createScheduledController({ cron: '0 3 * * SUN', scheduledTime: now }), env, ctx)
    await waitOnExecutionContext(ctx)
    expect(sent.filter((m) => m.type === 'repair')).toHaveLength(2)
  })
})

describe('GET /api/market/status', () => {
  const statusUrl = 'http://localhost:8787/api/market/status'
  const get = () => exports.default.fetch(new Request(statusUrl))
  beforeEach(() => caches.default.delete(new Request(statusUrl)))

  it('is null before the first ingest', async () => {
    expect(await marketStatus(env)).toEqual({ latest_nav_date: null, coverage_pct: null, final: false })
  })

  it('is public and cacheable, and reports the latest full NAV day (not the weekend)', async () => {
    await env.MARKET.batch([
      env.MARKET.prepare('INSERT INTO market_day VALUES (20261119, 9000, 50, 50, 1)'),
      env.MARKET.prepare('INSERT INTO market_day VALUES (20261120, 8800, 50, 40, 0)'),
      env.MARKET.prepare('INSERT INTO market_day VALUES (20261121, 620, 50, 3, 1)'),
      env.MARKET.prepare('INSERT INTO market_day VALUES (20261122, 610, 50, 3, 0)'),
    ])
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=300')
    expect(await res.json()).toEqual({ latest_nav_date: '2026-11-20', coverage_pct: 80, final: false })

    // Served from the edge cache for 5 minutes.
    await env.MARKET.prepare('UPDATE market_day SET final = 1 WHERE date = 20261120').run()
    expect(await (await get()).json()).toMatchObject({ final: false })
  })
})
