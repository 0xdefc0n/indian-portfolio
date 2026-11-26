// Stocks inside funds (plan §10.3.1, D10, M11): the BharatStock fallback job on pf-market, its global daily budget in
// `quota`, fund_portfolio rows and R2 blobs, and the snapshot's stock data. BharatStock is mocked with a synthetic
// server in its real response shape (✅ checked against the live API on 2026-11-26); every fund, stock and ISIN here
// is made up.
import { createExecutionContext, createMessageBatch, createScheduledController, env, getQueueResult, waitOnExecutionContext } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../src/index'
import { quotaWindow } from '../src/lib/quota'
import { requestRebuild, runRebuild } from '../src/lib/snapshot'
import { handleMarketBatch, type MarketMessage } from '../src/market/jobs'
import {
  budgetLeft,
  decodeWant,
  holdingsKey,
  JOB_LEASE_MS,
  recordWants,
  requestStocks,
  runStocks,
  score,
  searchQuery,
  stockData,
  STOCKS_CRON,
  UNMATCHED_RETRY_MS,
  WANT_REFRESH_MS,
} from '../src/market/stocks'
import { FAKE_PAN } from './helpers/pdf-fixture'
import { deliverRebuilds, fakeBuild, fakeSnapshot, okBuild, setMarketDay, storedStatement, takeRebuilds } from './helpers/snapshot'
import { addMember, newHousehold } from './helpers/tenant'

vi.setConfig({ testTimeout: 30_000 })

const recordedStocks = () => (globalThis as { pfRecordedStocks?: number[] }).pfRecordedStocks!
const DAY = 86_400_000

// Synthetic funds (ISIN-shaped, made up) and the portfolios our fake BharatStock serves for them.
const A = 'INF000K01AA1' // Synth Alpha Flexi Cap, direct
const A_REG = 'INF000K01AB9' // the same fund, regular plan: same portfolio
const B = 'INF000K02BB2' // Synth Beta Nifty 50 Index
const C = 'INF000K03CC3' // Synth Gamma Fund of Funds (holds D)
const D = 'INF000K04DD4' // Synth Delta Overseas, inside C
const X = 'INF000K09XX9' // no portfolio anywhere

type Row = { isin: string; symbol: string; company_name: string; sector: string; instrument_type: string; pct_of_aum: number }
const stock = (n: number, pct: number, type = 'EQUITY'): Row => ({
  isin: `INE00S${String(n).padStart(5, '0')}1`,
  symbol: `SYN${n}`,
  company_name: `Synth Company ${n} Limited`,
  sector: 'Synthetic',
  instrument_type: type,
  pct_of_aum: pct,
})
type Portfolio = { name: string; house: string; month: string; rows: Row[]; byMonth?: Record<string, Row[]> }
const ALPHA: Portfolio = { name: 'Synth Alpha Flexi Cap Fund', house: 'Synth Mutual Fund', month: '2026-10', rows: [stock(1, 40), stock(2, 35), stock(3, 25)] }
const BETA: Portfolio = { name: 'Synth Beta Nifty 50 Index Fund', house: 'Synth Mutual Fund', month: '2026-10', rows: [stock(4, 60), stock(5, 40)] }
const GAMMA: Portfolio = {
  name: 'Synth Gamma Fund of Funds',
  house: 'Other Synth Mutual Fund',
  month: '2026-10',
  rows: [{ ...stock(6, 95, 'MUTUAL_FUND_UNIT'), isin: D, company_name: 'Synth Delta Overseas Fund - Direct Growth' }, stock(7, 5, 'CASH')],
}
const DELTA: Portfolio = { name: 'Synth Delta Overseas Fund', house: 'Other Synth Mutual Fund', month: '2026-10', rows: [stock(8, 100, 'FOREIGN_EQUITY')] }
const ALL = [ALPHA, BETA, GAMMA, DELTA]

/** A fake BharatStock: coverage (free), portfolio search, paged holdings. Returns the URLs asked for. */
function bharatStock(portfolios: Portfolio[] = ALL, opts: { coverage?: Record<string, string>; status?: (u: URL) => number | null; pageSize?: number } = {}) {
  const calls: { url: URL; key: string | null }[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    calls.push({ url, key: new Headers(init?.headers).get('x-api-key') })
    if (url.hostname !== 'bharatstockapi.com') return new Response('unexpected host', { status: 599 })
    const status = opts.status?.(url)
    if (status) return Response.json({ error: 'synthetic' }, { status })
    if (url.pathname === '/v1/mf-coverage') {
      const houses = opts.coverage ?? Object.fromEntries(portfolios.map((p) => [p.house, p.month]))
      return Response.json({ houses: Object.entries(houses).map(([fund_house, latest_month]) => ({ fund_house, latest_month, scheme_count: 1 })) })
    }
    if (url.pathname === '/v1/mf/portfolios') {
      const q = (url.searchParams.get('q') ?? '').toLowerCase()
      const data = portfolios.filter((p) => p.name.toLowerCase().includes(q)).map((p) => ({ scheme_name: p.name, fund_house: p.house, latest_month: p.month }))
      return Response.json({ count: data.length, total: data.length, limit: 50, offset: 0, data })
    }
    const m = /^\/v1\/mf\/portfolios\/(.+)\/holdings$/.exec(url.pathname)
    const p = m && portfolios.find((x) => x.name === decodeURIComponent(m[1]!))
    if (!p) return Response.json({ detail: 'not found' }, { status: 404 })
    const month = url.searchParams.get('month')
    const rows = month ? (p.byMonth?.[month] ?? []) : p.rows
    const size = Math.min(opts.pageSize ?? Number(url.searchParams.get('page_size')), 100)
    const page = Number(url.searchParams.get('page') ?? 1)
    return Response.json({
      scheme_name: p.name,
      fund_house: p.house,
      portfolio_date: rows.length ? `${month ?? p.month}-01` : null,
      data: rows.slice((page - 1) * size, page * size),
      pagination: { page, page_size: size, total_items: rows.length, total_pages: Math.max(1, Math.ceil(rows.length / size)) },
    })
  })
  const paid = () => calls.filter((c) => c.url.pathname !== '/v1/mf-coverage')
  return { calls, paid }
}

const NAMES: Record<string, string> = {
  [A]: 'Synth Alpha Flexi Cap Fund',
  [A_REG]: 'Synth Alpha Flexi Cap Fund',
  [B]: 'Synth Beta Nifty 50 Index Fund',
  [C]: 'Synth Gamma Fund of Funds',
  [D]: 'Synth Delta Overseas Fund - Direct Growth',
  [X]: 'Synth Unknown Thematic Fund',
}
const want = (...isins: string[]): [string, string][] => isins.map((i) => [i, NAMES[i]!])

const one = async <T>(sql: string, ...args: unknown[]) => env.MARKET.prepare(sql).bind(...args).first<T>()
const all = async <T>(sql: string, ...args: unknown[]) => (await env.MARKET.prepare(sql).bind(...args).all<T>()).results
const used = async (now = Date.now()) =>
  (await env.DB.prepare("SELECT count FROM quota WHERE subject = 'global' AND metric = 'bharatstock' AND window = ?1").bind(quotaWindow('day', now, true)).first<number>('count')) ?? 0
const withLimit = (limit: number) => ({ ...env, BHARATSTOCK_DAILY_LIMIT: String(limit) }) as Env

let day = 20261101
beforeEach(async () => {
  await env.MARKET.batch([
    env.MARKET.prepare('DELETE FROM stock_match'),
    env.MARKET.prepare('DELETE FROM fund_portfolio'),
    env.MARKET.prepare('DELETE FROM stock_coverage'),
    env.MARKET.prepare("UPDATE job_lock SET until = 0, started_at = 0, requested_at = 0 WHERE name = 'stocks'"),
  ])
  await env.DB.prepare("DELETE FROM quota WHERE subject = 'global'").run()
  await setMarketDay(++day)
  takeRebuilds()
  recordedStocks().length = 0
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('matching (the old app\'s rules)', () => {
  it('scores plan and option words away, and searches by the fund\'s own name', () => {
    expect(score('Synth Alpha Flexi Cap Fund - Direct Plan - Growth', 'Synth Alpha Flexi Cap Fund')).toBe(1)
    expect(score('Synth Alpha Flexi Cap Fund', 'Synth Beta Large Cap Fund')).toBeLessThan(0.6)
    expect(score('Synth Gold & Silver FoF', 'Synth Gold and Silver Fund of Funds')).toBe(1)
    expect(searchQuery('Synth Alpha Flexi Cap Fund - Direct Plan - Growth')).toBe('Synth Alpha Flexi Cap')
    expect(searchQuery('Synth ETF')).toBe('Synth ETF')
  })

  it('decodes the engine header and drops anything that isn\'t an ISIN', () => {
    // What engine/engine/server.py encode_want() sends for [["INF000K01AA1", "Synth Alpha"], ["bad", "x"]].
    const header = btoa(JSON.stringify([['INF000K01AA1', 'Synth Alpha'], ['bad', 'x'], [1, 2]])).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
    expect(decodeWant(header)).toEqual([['INF000K01AA1', 'Synth Alpha']])
    expect(decodeWant('%%%')).toEqual([])
    expect(decodeWant(null)).toEqual([])
    const unicode = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify([[A, 'Synth Fund – Direct']])))).replace(/=+$/, '')
    expect(decodeWant(unicode)).toEqual([[A, 'Synth Fund – Direct']])
  })
})

describe('equity funds in a test household get holdings', () => {
  it('build → wants → job → fund_portfolio + R2 → the follow-up build has the stocks', async () => {
    const h = await newHousehold('stocks')
    const m = await addMember(h, FAKE_PAN, null)
    await storedStatement(h, m, { isins: [A, B, 'INF000K05LQ5'] }) // two equity funds and a (made-up) liquid fund
    const builds = fakeBuild({ answer: async (req) => okBuild(fakeSnapshot(req), want(A, B)) })
    await requestRebuild(env, h.householdId)
    const [first] = await deliverRebuilds(takeRebuilds(h.householdId))
    expect(first?.outcome).toBe('built')
    expect(builds[0]!.market.stocks).toEqual({ enabled: true, matches: {}, holdings: {} })
    expect(first?.requeue?.msg).toMatchObject({ force: true, followups: 1 }) // build again for the stocks
    expect(recordedStocks()).toHaveLength(1) // and the job was asked for
    expect((await all<{ isin: string }>('SELECT isin FROM stock_match ORDER BY isin')).map((r) => r.isin)).toEqual([A, B])

    const api = bharatStock()
    const run = await runStocks(env)
    expect(run).toMatchObject({ status: 'done', matched: 2, unmatched: 0, fetched: 2, failed: 0, budget: false })
    expect(api.paid().every((c) => c.key === 'test-only-bharatstock-key')).toBe(true)
    expect(api.calls.find((c) => c.url.pathname === '/v1/mf-coverage')?.key).toBeNull() // the free list gets no key
    expect(await used()).toBe(api.paid().length) // every paid call took a budget unit: 2 searches + 2 holdings
    expect(api.paid()).toHaveLength(4)
    const fp = await all<{ scheme_isin: string; month: string; source: string; blob_key: string }>('SELECT * FROM fund_portfolio ORDER BY scheme_isin')
    expect(fp.map((r) => [r.scheme_isin, r.month, r.source])).toEqual([
      [A, '2026-10', 'bharatstock'],
      [B, '2026-10', 'bharatstock'],
    ])
    expect(fp[0]!.blob_key).toBe(holdingsKey(A, '2026-10'))
    const blob = await (await env.BUCKET.get(holdingsKey(A, '2026-10')))!.json<{ rows: { isin: string; pct: number; type: string }[] }>()
    expect(blob.rows.map((r) => r.pct)).toEqual([40, 35, 25])

    const second = await runRebuild(env, first!.requeue!.msg)
    expect(second.outcome).toBe('built')
    const stocks = builds[1]!.market.stocks
    expect(stocks.matches[A]?.scheme_name).toBe(ALPHA.name)
    expect(stocks.holdings[ALPHA.name]).toMatchObject({ month: '2026-10', data_month: '2026-10' })
    expect(stocks.holdings[ALPHA.name]!.rows).toHaveLength(3)
    expect(stocks.holdings[BETA.name]!.rows).toHaveLength(2)
    expect(second.requeue).toBeUndefined() // nothing waits any more: no more follow-ups
    expect(recordedStocks()).toHaveLength(1)

    // Idempotent: the next run spends nothing (fetched up to the house's latest month).
    const again = await runStocks(env)
    expect(again).toMatchObject({ status: 'done', calls: 0 })
  })

  it('a fund-of-funds: the fund inside it is wanted by the next build, fetched, and loaded one level deep', async () => {
    await recordWants(env, want(C))
    bharatStock()
    await runStocks(env)
    let loaded = await stockData(env, [C])
    expect(Object.keys(loaded.data.holdings)).toEqual([GAMMA.name])
    expect(loaded.waiting).toBe(false) // D isn't known until a build reports it

    expect(await recordWants(env, want(C, D))).toBe(1) // the engine now lists D (from C's rows): one new fund
    await runStocks(env)
    loaded = await stockData(env, [C])
    expect(Object.keys(loaded.data.holdings).sort()).toEqual([DELTA.name, GAMMA.name].sort())
    expect(loaded.data.matches[D]?.scheme_name).toBe(DELTA.name)
  })

  it('direct and regular plans share one portfolio: one search per name, one fetch, a blob for each ISIN', async () => {
    await recordWants(env, want(A, A_REG))
    const api = bharatStock()
    const run = await runStocks(env)
    expect(run).toMatchObject({ matched: 2, fetched: 1 })
    expect(api.paid().map((c) => c.url.pathname)).toEqual(['/v1/mf/portfolios', `/v1/mf/portfolios/${encodeURIComponent(ALPHA.name)}/holdings`])
    expect(await env.BUCKET.head(holdingsKey(A_REG, '2026-10'))).not.toBeNull()
  })

  it('an unmatched fund is not pending, and is searched again only after 30 days', async () => {
    await recordWants(env, want(X))
    const api = bharatStock()
    const now = Date.now()
    expect(await runStocks(env, { now: () => now })).toMatchObject({ matched: 0, unmatched: 1 })
    const searches = api.paid().length
    expect(searches).toBe(2) // the name, then its first two words
    expect((await stockData(env, [X])).data.matches[X]).toEqual({ scheme_name: null, checked_at: now })
    expect((await stockData(env, [X])).waiting).toBe(false)
    await runStocks(env, { now: () => now + UNMATCHED_RETRY_MS - 1 })
    expect(api.paid()).toHaveLength(searches)
    await runStocks(env, { now: () => now + UNMATCHED_RETRY_MS })
    expect(api.paid()).toHaveLength(searches * 2)
  })

  it('pages through holdings 100 at a time', async () => {
    const big = { ...ALPHA, rows: Array.from({ length: 230 }, (_, i) => stock(100 + i, 100 / 230)) }
    await recordWants(env, want(A))
    const api = bharatStock([big])
    await runStocks(env)
    expect(api.paid().filter((c) => c.url.pathname.endsWith('/holdings')).map((c) => [c.url.searchParams.get('page'), c.url.searchParams.get('page_size')])).toEqual([
      ['1', '100'],
      ['2', '100'],
      ['3', '100'],
    ])
    const blob = await (await env.BUCKET.get(holdingsKey(A, '2026-10')))!.json<{ rows: unknown[] }>()
    expect(blob.rows).toHaveLength(230)
  })

  it('refetches only when coverage shows a newer month; an empty newest month falls back to the month before', async () => {
    await recordWants(env, want(A))
    let api = bharatStock()
    const now = Date.now()
    await runStocks(env, { now: () => now })
    vi.restoreAllMocks()

    // November appears in the free coverage list a day later, but the holdings endpoint has no rows for it yet.
    const nov = { ...ALPHA, month: '2026-11', rows: [], byMonth: { '2026-10': [stock(9, 100)] } }
    api = bharatStock([nov], { coverage: { [ALPHA.house]: '2026-11' } })
    const later = now + DAY + 1
    expect(await runStocks(env, { now: () => later })).toMatchObject({ fetched: 1 })
    const holdingCalls = api.paid().map((c) => c.url.searchParams.get('month'))
    expect(holdingCalls).toEqual([null, '2026-10']) // the latest (empty), then the month before
    expect(await one('SELECT month FROM stock_match WHERE isin = ?1', A)).toEqual({ month: '2026-11' }) // not again until December
    const loaded = await stockData(env, [A], later)
    expect(loaded.data.holdings[ALPHA.name]).toMatchObject({ month: '2026-11', data_month: '2026-10' })
    expect(loaded.data.holdings[ALPHA.name]!.rows.map((r) => r.symbol)).toEqual(['SYN9'])

    expect(await runStocks(env, { now: () => later + 1 })).toMatchObject({ calls: 0 })
  })

  it('a fund the API refuses (4xx) is not tried again for a day, and the build doesn\'t wait for it', async () => {
    await recordWants(env, want(B, X))
    const api = bharatStock(ALL, { status: (u) => (u.pathname.endsWith('/holdings') || u.searchParams.get('q')?.includes('Unknown') ? 404 : null) })
    const now = Date.now()
    expect(await runStocks(env, { now: () => now })).toMatchObject({ matched: 1, fetched: 0, failed: 2 }) // B's fetch, X's search
    expect((await stockData(env, [B, X], now)).waiting).toBe(false)
    const n = api.paid().length
    await runStocks(env, { now: () => now + 1000 })
    expect(api.paid()).toHaveLength(n)
    expect((await stockData(env, [B], now + DAY)).waiting).toBe(true)
    expect((await stockData(env, [X], now + DAY)).waiting).toBe(true)
  })

  it('BharatStock down (5xx): the run stops, the lock is free, the queue retries the message', async () => {
    await recordWants(env, want(A))
    bharatStock(ALL, { status: (u) => (u.pathname === '/v1/mf/portfolios' ? 503 : null) })
    await expect(runStocks(env)).rejects.toThrow('status 503')
    expect(await one("SELECT until FROM job_lock WHERE name = 'stocks'")).toEqual({ until: 0 })
    expect(await one('SELECT checked_at, failed_at FROM stock_match WHERE isin = ?1', A)).toEqual({ checked_at: null, failed_at: null })
    const batch = createMessageBatch<MarketMessage>('pf-market', [{ id: 's2', timestamp: new Date(), attempts: 1, body: { type: 'stocks' } }])
    await handleMarketBatch(batch, env)
    expect((await getQueueResult(batch, createExecutionContext())).retryMessages).toEqual([expect.objectContaining({ msgId: 's2' })])
  })

  it('no key: stocks are off, builds send enabled: false and ask for nothing', async () => {
    const off = { ...env, BHARATSTOCK_API_KEY: '' } as Env
    expect(await runStocks(off)).toEqual({ status: 'disabled' })
    expect(await requestStocks(off)).toBe(false)
    expect((await stockData(off, [A])).data).toEqual({ enabled: false, matches: {}, holdings: {} })
  })
})

describe('the global daily budget', () => {
  it('stops at the limit, continues the next UTC day', async () => {
    await recordWants(env, want(A, B, C, X))
    const api = bharatStock()
    const now = Date.UTC(2026, 10, 26, 10, 0)
    const limited = withLimit(3)
    const run = await runStocks(limited, { now: () => now })
    expect(run).toMatchObject({ status: 'done', calls: 3, budget: true })
    expect(api.paid()).toHaveLength(3)
    expect(await used(now)).toBe(3)
    expect(await budgetLeft(limited, now)).toBe(0)

    expect(await runStocks(limited, { now: () => now + 60_000 })).toMatchObject({ calls: 0, budget: true }) // same day: nothing
    expect(api.paid()).toHaveLength(3)

    // 23:59 UTC is still the same budget day (it's 05:29 IST the next day): UTC windows, the provider's day.
    expect(await runStocks(limited, { now: () => Date.UTC(2026, 10, 26, 23, 59) })).toMatchObject({ calls: 0 })
    const tomorrow = Date.UTC(2026, 10, 27, 0, 1)
    expect(await runStocks(limited, { now: () => tomorrow })).toMatchObject({ calls: 3 })
    expect(api.paid()).toHaveLength(6)
  })

  it('parallel callers never spend more than the limit', async () => {
    await recordWants(env, want(A, B, C, X))
    const api = bharatStock()
    const limited = withLimit(5)
    // Two passes at once (as if the lock had been lost): the quota UPSERT still holds the line.
    const { stocksPass } = await import('../src/market/stocks')
    const now = Date.now()
    await Promise.all([stocksPass(limited, now), stocksPass(limited, now), stocksPass(limited, now)])
    expect(api.paid()).toHaveLength(5)
    expect(await used(now)).toBe(5)
  })

  it('a 429 from BharatStock spends the rest of the day', async () => {
    await recordWants(env, want(A, B))
    const api = bharatStock(ALL, { status: () => 429 })
    const now = Date.now()
    expect(await runStocks(env, { now: () => now })).toMatchObject({ calls: 1, budget: true })
    expect(await used(now)).toBe(50)
    vi.restoreAllMocks()
    bharatStock()
    expect(await runStocks(env, { now: () => now + 1 })).toMatchObject({ calls: 0, budget: true })
    expect(api.paid()).toHaveLength(1)
  })

  it('no follow-up builds while the budget is spent; the daily cron picks it up', async () => {
    const h = await newHousehold('stocks-budget')
    const m = await addMember(h, FAKE_PAN, null)
    await storedStatement(h, m, { isins: [A] })
    fakeBuild({ answer: async (req) => okBuild(fakeSnapshot(req), want(A)) })
    const limited = withLimit(0)
    await requestRebuild(limited, h.householdId)
    const [msg] = takeRebuilds(h.householdId)
    const r = await runRebuild(limited, msg!.msg)
    expect(r.outcome).toBe('built')
    expect(r.requeue).toBeUndefined()
    expect(recordedStocks()).toHaveLength(0)

    const ctx = createExecutionContext()
    await worker.scheduled(createScheduledController({ cron: STOCKS_CRON, scheduledTime: Date.now() }), env, ctx)
    await waitOnExecutionContext(ctx)
    expect(recordedStocks()).toHaveLength(1)
  })
})

describe('single flight', () => {
  it('one run at a time; a request during a run gets one more pass', async () => {
    await recordWants(env, want(A))
    bharatStock()
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const realGet = env.MARKET.prepare.bind(env.MARKET)
    let held = false
    // Hold the first pass at its first D1 read until the second run has tried.
    vi.spyOn(env.MARKET, 'prepare').mockImplementation((sql: string) => {
      const stmt = realGet(sql)
      if (!held && sql.startsWith('SELECT isin, name, provider_name')) {
        held = true
        const bindAll = stmt.bind.bind(stmt)
        return Object.assign(stmt, {
          bind: (...a: unknown[]) => {
            const b = bindAll(...a)
            const run = b.all.bind(b)
            return Object.assign(b, { all: async () => (await gate, run()) })
          },
        }) as D1PreparedStatement
      }
      return stmt
    })
    const first = runStocks(env)
    await vi.waitFor(() => expect(held).toBe(true))
    expect(await runStocks(env)).toEqual({ status: 'busy' })
    expect(await requestStocks(env)).toBe(true) // asked after the run started
    release()
    expect(await first).toMatchObject({ status: 'done', passes: 2 })
    expect(await one<{ until: number }>("SELECT until FROM job_lock WHERE name = 'stocks'")).toEqual({ until: 0 })
  })

  it('requests: one message until a run starts; a lost one is sent again after 15 min', async () => {
    const now = Date.now()
    expect(await requestStocks(env, now)).toBe(true)
    expect(await requestStocks(env, now + 1)).toBe(false)
    expect(await requestStocks(env, now + 15 * 60_000 + 1)).toBe(true)
    expect(recordedStocks()).toHaveLength(2)
    expect(await requestStocks(env, now + 15 * 60_000 + 2, true)).toBe(true) // the cron always sends
  })

  it('a busy message is retried in a minute; a stale lock expires', async () => {
    await env.MARKET.prepare("UPDATE job_lock SET until = ?1 WHERE name = 'stocks'").bind(Date.now() + JOB_LEASE_MS).run()
    const batch = createMessageBatch<MarketMessage>('pf-market', [{ id: 's1', timestamp: new Date(), attempts: 1, body: { type: 'stocks' } }])
    await handleMarketBatch(batch, env)
    const res = await getQueueResult(batch, createExecutionContext())
    expect(res.explicitAcks).toEqual([])
    expect(res.retryMessages).toEqual([expect.objectContaining({ msgId: 's1' })]) // getQueueResult doesn't report the delay
    await env.MARKET.prepare("UPDATE job_lock SET until = ?1 WHERE name = 'stocks'").bind(Date.now() - 1).run()
    bharatStock([])
    expect(await runStocks(env)).toMatchObject({ status: 'done' })
  })
})

describe('wants', () => {
  it('a build refreshes wanted_at at most daily, so the nightly prebuild writes almost nothing', async () => {
    const now = Date.now()
    expect(await recordWants(env, want(A, B), now)).toBe(2)
    expect(await recordWants(env, want(A, B), now + 1000)).toBe(0) // nothing written (the build's own load saw them waiting)
    bharatStock()
    await runStocks(env, { now: () => now + 2000 })
    expect(await recordWants(env, want(A, B), now + 3000)).toBe(0)
    const before = await one<{ wanted_at: number }>('SELECT wanted_at FROM stock_match WHERE isin = ?1', A)
    expect(before?.wanted_at).toBe(now)
    await recordWants(env, want(A), now + WANT_REFRESH_MS)
    expect(await one('SELECT wanted_at FROM stock_match WHERE isin = ?1', A)).toEqual({ wanted_at: now + WANT_REFRESH_MS })
  })

  it('funds not wanted for 90 days drop out of the job', async () => {
    const now = Date.now()
    await recordWants(env, want(A), now - 91 * DAY)
    const api = bharatStock()
    expect(await runStocks(env, { now: () => now })).toMatchObject({ calls: 0 })
    expect(api.paid()).toHaveLength(0)
  })

  it('the stocks version is part of the inputs hash: a build after the job stored something is not skipped', async () => {
    const h = await newHousehold('stocks-hash')
    const m = await addMember(h, FAKE_PAN, null)
    await storedStatement(h, m, { isins: [A] })
    const builds = fakeBuild({ answer: async (req) => okBuild(fakeSnapshot(req), want(A)) })
    await requestRebuild(env, h.householdId)
    await deliverRebuilds(takeRebuilds(h.householdId))
    bharatStock()
    await runStocks(env)
    await requestRebuild(env, h.householdId)
    const [r] = await deliverRebuilds(takeRebuilds(h.householdId))
    expect(r?.outcome).toBe('built') // not 'current'
    expect(builds.at(-1)!.market.stocks.holdings[ALPHA.name]).toBeDefined()
    await requestRebuild(env, h.householdId)
    const [r2] = await deliverRebuilds(takeRebuilds(h.householdId))
    expect(r2?.outcome).toBe('current')
  })
})
