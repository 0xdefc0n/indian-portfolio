// AMC disclosure scrapers (plan §10.3.1, D10, M18): the polite fetcher, the `amc` job on pf-market, fund_portfolio
// rows with source 'amc', scrape_run, BharatStock limited to the gaps, and the snapshot's stock data. AMC sites are
// mocked (the PPFAS adapter against a synthetic page in its real link shape); the engine's /stocks/parse is mocked
// (engine/tests/test_amc.py covers it). Every fund, stock and ISIN here is made up.
import { createExecutionContext, createMessageBatch, createScheduledController, env, getQueueResult, waitOnExecutionContext } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../src/index'
import { ADAPTERS, adapterFor } from '../src/market/amc'
import { amcCovers, enabledAdapters, FALLBACK_DAY, istDay, targetMonth } from '../src/market/amc/coverage'
import { AmcBlocked, AmcDisallowed, AmcFetcher, AmcTooLarge, parseRobots, robotsAllows } from '../src/market/amc/fetcher'
import { AMC_CRON, amcEngine, EngineBusy, requestAmc, runAmc } from '../src/market/amc-scrape'
import { handleMarketBatch, type MarketMessage } from '../src/market/jobs'
import { holdingsKey, runStocks, stockData } from '../src/market/stocks'

vi.setConfig({ testTimeout: 30_000 })

const recordedAmc = () => (globalThis as { pfRecordedAmc?: number[] }).pfRecordedAmc!
const HOUR = 3_600_000
const DAY = 24 * HOUR
// 12 November 2026, 09:00 IST: October's portfolios should be out, and it's before the day-15 fallback.
const NOV12 = Date.UTC(2026, 10, 12, 3, 30)
const NOV16 = Date.UTC(2026, 10, 16, 3, 30)

const P = 'INF000P01AA1' // Synth Parikh Flexi Cap, direct (PPFAS)
const P_REG = 'INF000P01AB9' // the same scheme, regular plan
const Q = 'INF000P02BB2' // Synth Parikh Small Cap: not in the disclosure
const O = 'INF000O01OO1' // another fund house, no adapter

const on = (extra: Record<string, unknown> = {}) => ({ ...env, AMC_SCRAPERS: 'ppfas,nippon', ...extra }) as unknown as Env
const all = async <T>(sql: string, ...args: unknown[]) => (await env.MARKET.prepare(sql).bind(...args).all<T>()).results
const one = async <T>(sql: string, ...args: unknown[]) => env.MARKET.prepare(sql).bind(...args).first<T>()

const PAGE = 'https://amc.ppfas.com/downloads/portfolio-disclosure/'
const FILE = '/downloads/portfolio-disclosure/2026/PPFAS_Monthly_Portfolio_Report_October_31_2026.xls'
const SEPT = '/downloads/portfolio-disclosure/2026/PPFAS_Monthly_Portfolio_Report_September_30_2026.xls'

/** A fake amc.ppfas.com: robots.txt, the disclosure page (with the given months' links) and the files. */
function ppfasSite(opts: { months?: string[]; robots?: string; page?: (u: URL) => Response | null } = {}) {
  const calls: URL[] = []
  const months = opts.months ?? [FILE, SEPT]
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    calls.push(url)
    if (url.host !== 'amc.ppfas.com') return new Response('unexpected host', { status: 599 })
    if (url.pathname === '/robots.txt') return new Response(opts.robots ?? 'User-agent: *\nDisallow: /register/\n')
    const custom = opts.page?.(url)
    if (custom) return custom
    if (url.pathname === '/downloads/portfolio-disclosure/') {
      return new Response(`<html><body>${months.map((m) => `<a href="${m}?09112026">x</a>`).join('')}<a href="/downloads/portfolio-disclosure/2020/Monthly-Portfolio-july-2020.xls">old</a></body></html>`, { headers: { 'content-type': 'text/html' } })
    }
    if (months.includes(url.pathname)) return new Response(new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3]), { headers: { 'content-type': 'application/vnd.ms-excel' } })
    return new Response('not found', { status: 404 })
  })
  return calls
}

const rows = [
  { isin: 'INE000S01011', symbol: null, name: 'Synth Bank Limited', sector: 'Banks', type: 'EQUITY', pct: 60 },
  { isin: 'TREPS', symbol: null, name: 'TREPS', sector: null, type: 'CASH', pct: 40 },
]

/** The engine's /stocks/parse, mocked: the Flexi Cap scheme matches P and P_REG, nothing else does. */
function engineParse(asOf = '2026-10') {
  return vi.spyOn(amcEngine, 'parse').mockImplementation(async (_env, _slug, _name, _bytes, want) => ({
    ok: true,
    schemes: 7,
    months: [asOf],
    matched: Object.fromEntries(want.filter(([i]) => i === P || i === P_REG).map(([i]) => [i, { scheme_name: 'Synth Parikh Flexi Cap Fund', score: 1, as_of: asOf, rows }])),
  }))
}

async function seedFunds(now = NOV12) {
  await env.MARKET.batch([
    env.MARKET.prepare(
      `INSERT INTO scheme (amfi_code, isin_growth, isin_reinvest, name, amc, updated_at) VALUES
        (990001, ?1, NULL, 'Synth Parikh Flexi Cap Fund - Direct Plan - Growth', 'PPFAS Mutual Fund', 0),
        (990002, ?2, NULL, 'Synth Parikh Flexi Cap Fund - Regular Plan - Growth', 'PPFAS Mutual Fund', 0),
        (990003, ?3, NULL, 'Synth Parikh Small Cap Fund - Direct Plan - Growth', 'PPFAS Mutual Fund', 0),
        (990004, ?4, NULL, 'Synth Other Value Fund - Direct Plan - Growth', 'Synth Other Mutual Fund', 0)
       ON CONFLICT DO NOTHING`,
    ).bind(P, P_REG, Q, O),
    env.MARKET.prepare(
      `INSERT INTO stock_match (isin, name, wanted_at) VALUES (?1, 'Synth Parikh Flexi Cap Fund', ?5), (?2, 'Synth Parikh Flexi Cap Fund', ?5),
         (?3, 'Synth Parikh Small Cap Fund', ?5), (?4, 'Synth Other Value Fund', ?5)`,
    ).bind(P, P_REG, Q, O, now),
  ])
}

const noSleep = { sleep: async () => undefined }

beforeEach(async () => {
  await env.MARKET.batch([
    env.MARKET.prepare('DELETE FROM stock_match'),
    env.MARKET.prepare('DELETE FROM fund_portfolio'),
    env.MARKET.prepare('DELETE FROM scrape_run'),
    env.MARKET.prepare('DELETE FROM scheme WHERE amfi_code >= 990000'),
    env.MARKET.prepare("UPDATE job_lock SET until = 0, started_at = 0, requested_at = 0 WHERE name IN ('amc', 'stocks')"),
  ])
  recordedAmc().length = 0
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('polite fetcher', () => {
  it('reads the * group of robots.txt, longest rule wins, Allow wins a tie', () => {
    const r = parseRobots('User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nAllow: /\nDisallow: /InvestorServices/Factsheets\nDisallow: /*?*\nAllow: /docs/*.xlsx$\n')
    expect(robotsAllows(r, '/downloads/x.xls')).toBe(true)
    expect(robotsAllows(r, '/InvestorServices/FactsheetsDocuments/NIMF.xls')).toBe(false) // a prefix rule
    expect(robotsAllows(r, '/docs/a.xlsx?sfvrsn=2')).toBe(false) // query strings are disallowed
    expect(robotsAllows(r, '/docs/a.xlsx')).toBe(true)
    expect(robotsAllows(parseRobots(''), '/anything')).toBe(true)
  })

  it('refuses other hosts, paths robots.txt disallows, and redirects off the host', async () => {
    const calls = ppfasSite({ robots: 'User-agent: *\nDisallow: /secret/\n', page: (u) => (u.pathname === '/moved' ? Response.redirect('https://elsewhere.example/x', 302) : null) })
    const http = new AmcFetcher(['amc.ppfas.com'], noSleep)
    await expect(http.text('https://elsewhere.example/')).rejects.toBeInstanceOf(AmcDisallowed)
    await expect(http.text('https://amc.ppfas.com/secret/a')).rejects.toBeInstanceOf(AmcDisallowed)
    await expect(http.text(PAGE)).resolves.toContain('PPFAS_Monthly')
    expect(calls.map((c) => c.pathname)).toEqual(['/robots.txt', '/downloads/portfolio-disclosure/']) // robots once, never the refused ones
  })

  it('waits at least a second between requests to the same host', async () => {
    ppfasSite()
    const waits: number[] = []
    let t = 0
    const http = new AmcFetcher(['amc.ppfas.com'], { now: () => t, sleep: async (ms) => { waits.push(ms); t += ms } })
    await http.text(PAGE) // robots.txt, then the page
    await http.file(`https://amc.ppfas.com${FILE}`)
    expect(waits).toEqual([1000, 1000])
    expect(http.stats.requests).toBe(3)
  })

  it('reports a bot wall as blocked and stops at the size cap', async () => {
    ppfasSite({
      page: (u) =>
        u.pathname === '/wall'
          ? new Response('<html><title>Just a moment...</title></html>', { status: 403, headers: { 'cf-ray': 'x', 'content-type': 'text/html' } })
          : u.pathname === '/big'
            ? new Response('x', { headers: { 'content-length': String(60 * 1024 * 1024) } })
            : null,
    })
    const http = new AmcFetcher(['amc.ppfas.com'], noSleep)
    await expect(http.text('https://amc.ppfas.com/wall')).rejects.toBeInstanceOf(AmcBlocked)
    await expect(http.file('https://amc.ppfas.com/big')).rejects.toBeInstanceOf(AmcTooLarge)
  })
})

describe('adapters and coverage rules', () => {
  it('has the ten adapters, each with hosts and AMFI names, found by fund-house name', () => {
    expect(ADAPTERS.map((a) => a.slug).sort()).toEqual(['absl', 'axis', 'hdfc', 'icici', 'kotak', 'mirae', 'nippon', 'ppfas', 'sbi', 'uti'])
    for (const a of ADAPTERS) {
      expect(a.hosts.length).toBeGreaterThan(0)
      expect(a.amfi.every((h) => h === h.toLowerCase())).toBe(true)
    }
    expect(adapterFor('PPFAS  Mutual Fund')?.slug).toBe('ppfas')
    expect(adapterFor('Synth Other Mutual Fund')).toBeNull()
  })

  it('AMC_SCRAPERS picks the adapters: all, a list, or none', () => {
    expect(enabledAdapters({ AMC_SCRAPERS: '' })).toEqual([])
    expect(enabledAdapters({ AMC_SCRAPERS: 'all' })).toHaveLength(10)
    expect(enabledAdapters({ AMC_SCRAPERS: 'ppfas, sbi,nope' }).map((a) => a.slug)).toEqual(['sbi', 'ppfas'])
  })

  it('targets the month before today in IST, and hands over to BharatStock from day 15', () => {
    expect(targetMonth(Date.UTC(2026, 10, 30, 19))).toBe('2026-11') // 1 Dec 00:30 IST
    expect(targetMonth(Date.UTC(2026, 0, 5))).toBe('2025-12')
    expect(istDay(NOV12)).toBe(12)
    const e = { AMC_SCRAPERS: 'ppfas' }
    const r = { amc: 'PPFAS Mutual Fund', amc_at: null, amc_current: 0, has_data: 0 }
    expect(amcCovers(e, r, NOV12)).toBe(true) // not tried yet: wait for the scraper
    expect(amcCovers(e, { ...r, amc_at: NOV12 }, NOV12)).toBe(false) // tried, nothing at all: BharatStock now
    expect(amcCovers(e, { ...r, amc_at: NOV12, has_data: 1 }, NOV12)).toBe(true) // older data shown meanwhile
    expect(amcCovers(e, { ...r, amc_at: NOV12, has_data: 1 }, NOV16)).toBe(false) // day 15+: BharatStock fills in
    expect(amcCovers(e, { ...r, amc_current: 1 }, NOV16)).toBe(true)
    expect(amcCovers({ AMC_SCRAPERS: '' }, { ...r, amc_current: 1 }, NOV12)).toBe(false) // scrapers off
    expect(amcCovers({ AMC_SCRAPERS: 'nippon' }, { ...r, amc: 'Nippon India Mutual Fund' }, NOV12)).toBe(false) // blocked adapter
    expect(FALLBACK_DAY).toBe(15)
  })
})

describe('the amc job', () => {
  it('scrapes a due AMC, stores the matched funds as source amc, and records the run', async () => {
    await seedFunds()
    const calls = ppfasSite()
    const parse = engineParse()
    const res = await runAmc(on(), { now: () => NOV12, ...noSleep })
    expect(res.status).toBe('done')
    const run = res.status === 'done' ? res.runs.find((r) => r.slug === 'ppfas')! : null
    expect(run).toMatchObject({ month: '2026-10', status: 'ok', files: 1, schemes: 7, matched: 2, wanted: 3, requests: 3 })
    // One combined file, sent to the engine once with the AMC's three wanted funds (and their AMFI names).
    expect(parse).toHaveBeenCalledTimes(1)
    expect(parse.mock.calls[0]![1]).toBe('ppfas')
    expect(parse.mock.calls[0]![4].map((w) => w[0]).sort()).toEqual([P, P_REG, Q].sort())
    expect(parse.mock.calls[0]![4].find((w) => w[0] === P)![2]).toBe('Synth Parikh Flexi Cap Fund - Direct Plan - Growth')
    expect(calls.filter((c) => c.pathname === FILE)).toHaveLength(1)

    expect(await all('SELECT scheme_isin, month, source FROM fund_portfolio ORDER BY scheme_isin')).toEqual([
      { scheme_isin: P, month: '2026-10', source: 'amc' },
      { scheme_isin: P_REG, month: '2026-10', source: 'amc' },
    ])
    const blob = await (await env.BUCKET.get(holdingsKey(P, '2026-10')))!.json<{ source: string; rows: unknown[] }>()
    expect(blob.source).toBe('amc')
    expect(blob.rows).toEqual(rows)
    expect(await all('SELECT isin, amc, amc_month, amc_scheme FROM stock_match ORDER BY isin')).toEqual([
      { isin: O, amc: 'Synth Other Mutual Fund', amc_month: null, amc_scheme: null }, // no adapter: never scraped
      { isin: P, amc: 'PPFAS Mutual Fund', amc_month: '2026-10', amc_scheme: 'Synth Parikh Flexi Cap Fund' },
      { isin: P_REG, amc: 'PPFAS Mutual Fund', amc_month: '2026-10', amc_scheme: 'Synth Parikh Flexi Cap Fund' },
      { isin: Q, amc: 'PPFAS Mutual Fund', amc_month: '2026-10', amc_scheme: null }, // covered, no match: BharatStock's from day 15
    ])
    expect(await all('SELECT amc, month, status, schemes_found FROM scrape_run')).toEqual([{ amc: 'ppfas', month: '2026-10', status: 'ok', schemes_found: 7 }])

    // Done for the month: the next days' crons find nothing due.
    calls.length = 0
    const again = await runAmc(on(), { now: () => NOV12 + 2 * DAY, ...noSleep })
    expect(again.status === 'done' && again.runs).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('an AMC replaces a BharatStock month, and BharatStock never overwrites it', async () => {
    await seedFunds()
    await env.MARKET.prepare("INSERT INTO fund_portfolio (scheme_isin, month, source, blob_key, fetched_at) VALUES (?1, '2026-10', 'bharatstock', 'old', 1)").bind(P).run()
    ppfasSite()
    engineParse()
    await runAmc(on(), { now: () => NOV12, ...noSleep })
    expect(await one('SELECT source, blob_key FROM fund_portfolio WHERE scheme_isin = ?1', P)).toEqual({ source: 'amc', blob_key: holdingsKey(P, '2026-10') })
  })

  it('not published yet: records it, tries again the next day, and gives a fund with no data the month before', async () => {
    await seedFunds()
    const calls = ppfasSite({ months: [SEPT] })
    engineParse('2026-09')
    const res = await runAmc(on(), { now: () => NOV12, ...noSleep })
    expect(res.status === 'done' && res.runs.filter((r) => r.slug === 'ppfas').map((r) => [r.month, r.status])).toEqual([
      ['2026-10', 'not_published'],
      ['2026-09', 'ok'],
    ])
    expect(await all('SELECT scheme_isin, month FROM fund_portfolio ORDER BY scheme_isin')).toEqual([
      { scheme_isin: P, month: '2026-09' },
      { scheme_isin: P_REG, month: '2026-09' },
    ])
    // The fallback month doesn't count as covering October: still due, but not again within 20 h.
    expect(await one<{ amc_month: string | null }>('SELECT amc_month FROM stock_match WHERE isin = ?1', P)).toEqual({ amc_month: null })
    calls.length = 0
    expect((await runAmc(on(), { now: () => NOV12 + 4 * HOUR, ...noSleep })).status === 'done').toBe(true)
    expect(calls).toHaveLength(0)
    await runAmc(on(), { now: () => NOV12 + DAY, ...noSleep })
    expect(calls.some((c) => c.pathname === '/downloads/portfolio-disclosure/')).toBe(true)
  })

  it('a blocked adapter makes no request and leaves its funds to BharatStock', async () => {
    await env.MARKET.batch([
      env.MARKET.prepare("INSERT INTO scheme (amfi_code, isin_growth, name, amc, updated_at) VALUES (990010, 'INF000N01NN1', 'Synth Nippon Growth Fund - Direct Plan', 'Nippon India Mutual Fund', 0)"),
      env.MARKET.prepare("INSERT INTO stock_match (isin, name, wanted_at) VALUES ('INF000N01NN1', 'Synth Nippon Growth Fund', ?1)").bind(NOV12),
    ])
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    expect(adapterFor('Nippon India Mutual Fund')?.blocked).toBeTruthy()
    const res = await runAmc(on({ AMC_SCRAPERS: 'nippon' }), { now: () => NOV12, ...noSleep })
    expect(res.status === 'done' && res.runs.map((r) => r.status)).toEqual(['blocked'])
    expect(fetchSpy.mock.calls.filter(([u]) => String(u).includes('nippon'))).toHaveLength(0)
    expect(await all('SELECT amc, status FROM scrape_run')).toEqual([{ amc: 'nippon', status: 'blocked' }])
  })

  it('a changed page or an unparseable file is a failed run, not an error; a busy engine retries the message', async () => {
    await seedFunds()
    ppfasSite({ page: (u) => (u.pathname === '/downloads/portfolio-disclosure/' ? new Response('down', { status: 500 }) : null) })
    const res = await runAmc(on(), { now: () => NOV12, ...noSleep })
    expect(res.status === 'done' && res.runs[0]).toMatchObject({ status: 'failed', error: 'AmcHttpError' })

    vi.restoreAllMocks()
    ppfasSite()
    vi.spyOn(amcEngine, 'parse').mockResolvedValue({ ok: true, schemes: 0, months: [], matched: {} })
    const empty = await runAmc(on(), { now: () => NOV12 + DAY, ...noSleep })
    expect(empty.status === 'done' && empty.runs[0]).toMatchObject({ status: 'failed', error: 'AmcParseFailed' })

    vi.spyOn(amcEngine, 'parse').mockRejectedValue(new EngineBusy())
    await expect(runAmc(on(), { now: () => NOV12 + 2 * DAY, ...noSleep })).rejects.toBeInstanceOf(EngineBusy)
    expect(await one<{ until: number }>("SELECT until FROM job_lock WHERE name = 'amc'")).toEqual({ until: 0 }) // the lock is released
  })

  it('runs one at a time, and is off without AMC_SCRAPERS', async () => {
    await env.MARKET.prepare("UPDATE job_lock SET until = ?1 WHERE name = 'amc'").bind(NOV12 + HOUR).run()
    expect((await runAmc(on(), { now: () => NOV12 })).status).toBe('busy')
    expect((await runAmc(on({ AMC_SCRAPERS: '' }), { now: () => NOV12 })).status).toBe('disabled')
    expect(await requestAmc(on({ AMC_SCRAPERS: '' }), NOV12)).toBe(false)
  })

  it('one message is outstanding at a time; the cron always sends', async () => {
    expect(await requestAmc(on(), NOV12)).toBe(true)
    expect(await requestAmc(on(), NOV12 + 60_000)).toBe(false)
    expect(await requestAmc(on(), NOV12 + 60_000, true)).toBe(true)
    expect(await requestAmc(on(), NOV12 + 20 * 60_000)).toBe(true) // the last one counts as lost after 15 min
    expect(recordedAmc()).toHaveLength(3)
  })
})

describe('BharatStock fills the gaps only', () => {
  it('skips funds the AMC covers; a fund with only older AMC data goes to BharatStock from day 15', async () => {
    await seedFunds()
    ppfasSite()
    engineParse()
    await runAmc(on(), { now: () => NOV12, ...noSleep })
    // P_REG: say October didn't match after all, but September's AMC data is there to show meanwhile.
    await env.MARKET.batch([
      env.MARKET.prepare("UPDATE fund_portfolio SET month = '2026-09' WHERE scheme_isin = ?1").bind(P_REG),
      env.MARKET.prepare('UPDATE stock_match SET amc_scheme = NULL WHERE isin = ?1').bind(P_REG),
    ])
    vi.restoreAllMocks()

    const searched: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.pathname === '/v1/mf/portfolios') searched.push(url.searchParams.get('q') ?? '')
      if (url.pathname === '/v1/mf-coverage') return Response.json({ houses: [] })
      return Response.json({ data: [] })
    })
    await runStocks(on(), { now: () => NOV12 + HOUR })
    // P: October from the AMC. P_REG: older AMC data, before day 15. Q: the AMC tried and has nothing: BharatStock now.
    // O: no adapter. (Each search also tries its first two words when nothing scores.)
    expect(searched.sort()).toEqual(['Synth Other', 'Synth Other Value', 'Synth Parikh', 'Synth Parikh Small Cap'])
    searched.length = 0
    await env.MARKET.prepare("UPDATE job_lock SET until = 0 WHERE name = 'stocks'").run()
    await runStocks(on(), { now: () => NOV16 })
    expect(searched).toEqual(['Synth Parikh Flexi Cap', 'Synth Parikh']) // day 15+: P_REG has no October AMC data
  })
})

describe('builds read the AMC data', () => {
  it('stockData keys an AMC fund by its ISIN and says when the scraper is still on one', async () => {
    await seedFunds()
    // Not scraped yet: waiting, and nothing to show.
    const before = await stockData(on(), [P], NOV12)
    expect(before.waiting).toBe(true)
    expect(before.data.matches).toEqual({})

    ppfasSite()
    engineParse()
    await runAmc(on(), { now: () => NOV12, ...noSleep })
    const after = await stockData(on(), [P, Q], NOV12)
    expect(after.data.enabled).toBe(true)
    expect(after.data.matches[P]).toEqual({ scheme_name: `amc:${P}`, checked_at: NOV12 })
    expect(after.data.holdings[`amc:${P}`]).toEqual({ month: '2026-10', data_month: '2026-10', rows })
    expect(after.waiting).toBe(true) // Q: covered, no AMC match, and BharatStock hasn't searched it yet

    // Without a BharatStock key, Q counts as unmatched once the scraper has looked.
    const noKey = await stockData(on({ BHARATSTOCK_API_KEY: '' }), [P, Q], NOV16)
    expect(noKey.data.enabled).toBe(true)
    expect(noKey.data.matches[Q]).toEqual({ scheme_name: null, checked_at: NOV12 })
  })
})

describe('wiring', () => {
  it('the daily cron asks for a run, and pf-market runs it', async () => {
    const ctx = createExecutionContext()
    await worker.scheduled!(createScheduledController({ cron: AMC_CRON, scheduledTime: NOV12 }), on(), ctx)
    await waitOnExecutionContext(ctx)
    expect(recordedAmc()).toHaveLength(1)

    await seedFunds()
    ppfasSite()
    engineParse()
    const batch = createMessageBatch<MarketMessage>('pf-market', [{ id: 'm1', timestamp: new Date(), attempts: 1, body: { type: 'amc' } }])
    const qctx = createExecutionContext()
    await handleMarketBatch(batch, on())
    await waitOnExecutionContext(qctx)
    expect((await getQueueResult(batch, qctx)).explicitAcks).toEqual(['m1'])
    expect(await all('SELECT status FROM scrape_run')).toEqual([{ status: 'ok' }])
  })
})
