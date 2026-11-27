// mfforecast on RapidAPI, the last stocks fallback (plan §10.3.1, M18 follow-up): row mapping, the hourly and monthly
// budgets, when it is asked (only what the AMCs and BharatStock can't serve), and what builds read. RapidAPI is mocked
// in the response shape verified live on 2026-11-27; every fund and ISIN here is made up.
import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { quotaWindow } from '../src/lib/quota'
import { fetchMff, MFF_HOST, MFF_HOUR_LIMIT, MffSpent, toRows } from '../src/market/mfforecast'
import { holdingsKey, runStocks, stockData } from '../src/market/stocks'

vi.setConfig({ testTimeout: 30_000 })

const NOV12 = Date.UTC(2026, 10, 12, 3, 30)
const DAY = 86_400_000
const F = 'INF000M01FF1' // Synth Forecast Flexi Cap, AMFI code 991001, fund house without an adapter
const G = 'INF000M02GG2' // Synth Forecast Gamma, code 991002: mfforecast doesn't have it

const keyOnly = (extra: Record<string, unknown> = {}) => ({ ...env, BHARATSTOCK_API_KEY: '', RAPIDAPI_KEY: 'test-only-rapidapi-key', ...extra }) as unknown as Env
const both = (extra: Record<string, unknown> = {}) => keyOnly({ BHARATSTOCK_API_KEY: 'test-only-bharatstock-key', ...extra })
const all = async <T>(sql: string, ...args: unknown[]) => (await env.MARKET.prepare(sql).bind(...args).all<T>()).results

const holdings = [
  { isin: 'INE000S01011', name: 'Synth Bank Limited', ticker: 'SYNTHBANK.NS', weight_pct: 0.6, quantity: 10, asset_type: 'EQUITY' },
  { isin: 'US0000000001', name: 'Synth Inc A', ticker: null, weight_pct: 0.2, quantity: 1, asset_type: 'OTHER' },
  { isin: 'INE000R25011', name: 'Synth Office REIT', ticker: null, weight_pct: 0.05, quantity: 1, asset_type: 'REIT' },
  { isin: 'INF000L01AA1', name: 'Synth Liquid Fund - Direct Growth', ticker: null, weight_pct: 0.05, quantity: 1, asset_type: 'DEBT' },
  { isin: 'IN8000000000', name: 'Cash & Cash Equivalents', ticker: null, weight_pct: 0.1, quantity: 0, asset_type: 'CASH' },
]

/** A fake RapidAPI: F has holdings, anything else is a 404. `remaining` / `status` shape the answer. */
function rapid(opts: { remaining?: number; status?: number } = {}) {
  const calls: URL[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    calls.push(url)
    if (url.host === 'bharatstockapi.com') return url.pathname === '/v1/mf-coverage' ? Response.json({ houses: [] }) : Response.json({ data: [] })
    if (url.host !== MFF_HOST) return new Response('unexpected host', { status: 599 })
    expect(new Headers(init?.headers).get('x-rapidapi-key')).toBe('test-only-rapidapi-key')
    const headers = { 'x-ratelimit-requests-limit': '500000', 'x-ratelimit-requests-remaining': String(opts.remaining ?? 499_000) }
    if (opts.status) return Response.json({ message: 'synthetic' }, { status: opts.status, headers })
    if (url.pathname !== '/funds/991001/holdings') return Response.json({ detail: 'Fund not found' }, { status: 404, headers })
    return Response.json({ amfi_code: '991001', scheme_name: 'Synth Forecast Flexi Cap Fund', snapshot: { snapshot_date: '2026-09-30' }, holdings_count: holdings.length, holdings }, { headers })
  })
  return calls.filter.bind(calls, (u: URL) => u.host === MFF_HOST) as () => URL[]
}

async function seed() {
  await env.MARKET.batch([
    env.MARKET.prepare(
      `INSERT INTO scheme (amfi_code, isin_growth, name, amc, updated_at) VALUES
         (991001, ?1, 'Synth Forecast Flexi Cap Fund - Direct Plan - Growth', 'Synth Other Mutual Fund', 0),
         (991002, ?2, 'Synth Forecast Gamma Fund - Direct Plan - Growth', 'Synth Other Mutual Fund', 0) ON CONFLICT DO NOTHING`,
    ).bind(F, G),
    env.MARKET.prepare("INSERT INTO stock_match (isin, name, wanted_at) VALUES (?1, 'Synth Forecast Flexi Cap Fund', ?3), (?2, 'Synth Forecast Gamma Fund', ?3)").bind(F, G, NOV12),
  ])
}

beforeEach(async () => {
  await env.MARKET.batch([
    env.MARKET.prepare('DELETE FROM stock_match'),
    env.MARKET.prepare('DELETE FROM fund_portfolio'),
    env.MARKET.prepare('DELETE FROM stock_coverage'),
    env.MARKET.prepare('DELETE FROM scheme WHERE amfi_code >= 990000'),
    env.MARKET.prepare("UPDATE job_lock SET until = 0, started_at = 0, requested_at = 0 WHERE name = 'stocks'"),
  ])
  await env.DB.prepare("DELETE FROM quota WHERE subject = 'global'").run()
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('rows', () => {
  it('maps mfforecast holdings to the stocks view: percent, foreign shares, fund units, cash', () => {
    expect(toRows(holdings)).toEqual([
      { isin: 'INE000S01011', symbol: 'SYNTHBANK', name: 'Synth Bank Limited', sector: null, type: 'EQUITY', pct: 60 },
      { isin: 'US0000000001', symbol: null, name: 'Synth Inc A', sector: null, type: 'FOREIGN_EQUITY', pct: 20 }, // comes as OTHER
      { isin: 'INE000R25011', symbol: null, name: 'Synth Office REIT', sector: null, type: 'OTHER', pct: 5 },
      { isin: 'INF000L01AA1', symbol: null, name: 'Synth Liquid Fund - Direct Growth', sector: null, type: 'MUTUAL_FUND_UNIT', pct: 5 },
      { isin: 'IN8000000000', symbol: null, name: 'Cash & Cash Equivalents', sector: null, type: 'CASH', pct: 10 },
    ])
  })
})

describe('budgets', () => {
  it('takes one unit of the hourly and the monthly budget per call, and stops at the hourly one', async () => {
    rapid()
    await env.DB.prepare("INSERT INTO quota (subject, metric, window, count) VALUES ('global', 'mfforecast', ?1, ?2)").bind(quotaWindow('hour', NOV12, true), MFF_HOUR_LIMIT - 1).run()
    expect((await fetchMff(keyOnly(), 991001, NOV12))!.month).toBe('2026-09')
    await expect(fetchMff(keyOnly(), 991001, NOV12)).rejects.toBeInstanceOf(MffSpent)
    expect(await fetchMff(keyOnly(), 991001, NOV12 + 3_600_000)).not.toBeNull() // the next hour
    const month = await env.DB.prepare("SELECT count FROM quota WHERE subject = 'global' AND metric = 'mfforecast' AND window = '2026-11'").first<number>('count')
    expect(month).toBe(2) // the refused call took nothing
  })

  it('a 429 spends the hour; RapidAPI nearly out spends the month; a 404 is "not one of its funds"', async () => {
    rapid({ status: 429 })
    await expect(fetchMff(keyOnly(), 991001, NOV12)).rejects.toBeInstanceOf(MffSpent)
    await expect(fetchMff(keyOnly(), 991001, NOV12 + 60_000)).rejects.toBeInstanceOf(MffSpent) // no call made
    vi.restoreAllMocks()
    rapid({ remaining: 50 })
    await expect(fetchMff(keyOnly(), 991001, NOV12 + 3_600_000)).rejects.toBeInstanceOf(MffSpent)
    await expect(fetchMff(keyOnly(), 991001, NOV12 + 2 * 3_600_000)).rejects.toBeInstanceOf(MffSpent) // month spent
    vi.restoreAllMocks()
    rapid()
    expect(await fetchMff(keyOnly(), 991002, Date.UTC(2026, 11, 1, 1))).toBeNull()
  })
})

describe('the fallback in the stocks job', () => {
  it('without BharatStock: fetches what nothing else covers, stores it as mfforecast, and waits a week to ask again', async () => {
    await seed()
    const mff = rapid()
    expect((await runStocks(keyOnly(), { now: () => NOV12 })).status).toBe('done')
    expect(mff().map((u) => u.pathname).sort()).toEqual(['/funds/991001/holdings', '/funds/991002/holdings'])
    expect(await all('SELECT scheme_isin, month, source FROM fund_portfolio')).toEqual([{ scheme_isin: F, month: '2026-09', source: 'mfforecast' }])
    const blob = await (await env.BUCKET.get(holdingsKey(F, '2026-09')))!.json<{ source: string; rows: unknown[] }>()
    expect(blob.source).toBe('mfforecast')
    expect(blob.rows).toHaveLength(5)

    // Builds read it, keyed per fund; G (not one of its funds) is unmatched.
    const { data, waiting } = await stockData(keyOnly(), [F, G], NOV12)
    expect(data.enabled).toBe(true)
    expect(data.matches[F]).toEqual({ scheme_name: `mfforecast:${F}`, checked_at: NOV12 })
    expect(data.holdings[`mfforecast:${F}`]!.rows).toHaveLength(5)
    expect(data.matches[G]).toEqual({ scheme_name: null, checked_at: NOV12 })
    expect(waiting).toBe(false)

    const calls = mff().length
    await runStocks(keyOnly(), { now: () => NOV12 + DAY })
    expect(mff()).toHaveLength(calls) // F has recent data; G was asked a day ago
    await runStocks(keyOnly(), { now: () => NOV12 + 8 * DAY })
    expect(mff()).toHaveLength(calls + 1) // G again after a week
  })

  it('with BharatStock and budget left, only the funds it found no match for go to mfforecast', async () => {
    await seed()
    await env.MARKET.prepare('UPDATE stock_match SET checked_at = ?2, provider_name = NULL WHERE isin = ?1').bind(G, NOV12 - DAY).run() // BharatStock: no match
    const mff = rapid()
    await runStocks(both(), { now: () => NOV12 })
    // F: BharatStock searched it this run (no match) -> also mfforecast's; G: unmatched yesterday -> mfforecast's.
    expect(mff().map((u) => u.pathname).sort()).toEqual(['/funds/991001/holdings', '/funds/991002/holdings'])
  })

  it('never overwrites AMC or BharatStock data, and BharatStock replaces an mfforecast month', async () => {
    await env.MARKET.prepare("INSERT INTO fund_portfolio (scheme_isin, month, source, blob_key, fetched_at) VALUES (?1, '2026-09', 'bharatstock', 'b', 1)").bind(F).run()
    await seed()
    await env.MARKET.prepare('UPDATE stock_match SET mff_at = NULL').run()
    rapid()
    await runStocks(keyOnly(), { now: () => NOV12 }) // F has recent (BharatStock) data: not asked
    expect(await all('SELECT source FROM fund_portfolio WHERE scheme_isin = ?1', F)).toEqual([{ source: 'bharatstock' }])
  })
})
