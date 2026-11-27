// Benchmark score (plan §21.4, M28). Golden tests on synthetic series, the category map over every category header in
// today's AMFI file (test/fixtures/amfi/NAVAll-categories-20261127.txt), the niftyindices.com parser on a saved public
// answer, and the jobs against D1 and R2 with niftyindices mocked. Synthetic codes and ISINs. Public market data only.
import { createExecutionContext, createMessageBatch, env, getQueueResult, waitOnExecutionContext } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requestRebuild } from '../src/lib/snapshot'
import { parseAmfiNav } from '../src/market/amfi'
import { handleMarketBatch, type MarketMessage, marketQueue } from '../src/market/jobs'
import { priceSeriesKey } from '../src/market/prices'
import {
  fundIndex,
  INDICES,
  indexSeriesKey,
  mrar,
  parseTri,
  planScores,
  runIndices,
  runScores,
  scoreAsOf,
  type ScoresMessage,
  scoreSeries,
  scoresFor,
  scoreVersion,
  sectorIndex,
  sectorStatement,
  type Series,
  themeIndex,
  TRI_URL,
  TriFormatError,
} from '../src/market/score'
import { seriesKey } from '../src/market/store'
import categories from './fixtures/amfi/NAVAll-categories-20261127.txt?raw'
import tri from './fixtures/niftyindices/tri-nifty50-202611.json?raw'
import unknownTri from './fixtures/niftyindices/tri-unknown.json?raw'
import { FAKE_PAN } from './helpers/pdf-fixture'
import { deliverRebuilds, fakeBuild, storedStatement, takeRebuilds } from './helpers/snapshot'
import { addMember, newHousehold } from './helpers/tenant'

vi.setConfig({ testTimeout: 30_000 })
afterEach(() => vi.restoreAllMocks())

// ─── Synthetic month-end series ─────────────────────────────────────────────────────────────────────────────────

/** Month-end ISO dates from Jan of `startYear`, `n` of them. */
function monthEndDates(startYear: number, n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    const y = startYear + Math.floor(i / 12)
    const m = (i % 12) + 1
    const d = new Date(Date.UTC(y, m, 0)).getUTCDate()
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  })
}
/** A series compounding at `yearly` (e.g. 0.03), with an optional monthly wiggle. */
function grow(dates: string[], yearly: number, wiggle: (i: number) => number = () => 0): Series {
  let v = 100
  const values = dates.map((_, i) => {
    if (i) v *= (1 + yearly) ** (1 / 12) * (1 + wiggle(i))
    return v
  })
  return { dates, values }
}
const AS_OF = '2026-10-31'
const datesTo = (months: number) => {
  // `months` returns ending Oct 2026 → months + 1 points
  const first = 2026 * 12 + 9 - months
  return monthEndDates(Math.floor(first / 12), months + 1 + (first % 12)).slice(first % 12)
}
const wiggle = (i: number) => (i % 2 ? 0.05 : -0.05) // a volatile market, ±5% a month

describe('score maths (golden)', () => {
  it('MRAR(2): constant returns are their CAGR; volatility costs (±5% a month → −4.40% a year)', () => {
    expect(mrar(Array(12).fill(0.01))).toBeCloseTo(1.01 ** 12 - 1, 10)
    // mean((1.05)^-2, (0.95)^-2) = 1.0075310 → ^-6 − 1
    expect(mrar([0.05, -0.05])).toBeCloseTo(-0.04402, 4)
    expect(mrar([0.05, -0.05])).toBeLessThan(Math.sqrt(1.05 * 0.95) ** 12 - 1) // below the geometric return
  })

  it('a fund identical to its index scores 50 (every window a tie)', () => {
    const d = datesTo(120)
    const x = grow(d, 0.12, wiggle)
    const r = scoreSeries(x, x, AS_OF)
    expect(r).toMatchObject({ score: 50, months: 120, excess: 0, consistency: 0.5 })
  })

  it('3 points a year ahead of a flat index, every month: 90; 3 behind: 10', () => {
    const d = datesTo(120)
    const flat = grow(d, 0)
    const ahead = scoreSeries(grow(d, 0.03), flat, AS_OF)
    // excess part 50 + 10 × 3 = 80, consistency 100 → 90
    expect(ahead.score).toBe(90)
    if (ahead.score === null) throw new Error('scored')
    expect(ahead.excess).toBeCloseTo(0.03, 10)
    expect(ahead.horizons.map((h) => h.years)).toEqual([3, 5, 10])
    expect(ahead.rolling).toEqual([
      { years: 3, windows: 85, beat: 1 },
      { years: 5, windows: 61, beat: 1 },
    ])
    expect(ahead.since).toBe('2016-10-31')
    expect(scoreSeries(grow(d, -0.03), flat, AS_OF).score).toBe(10) // 50 − 30 = 20, consistency 0 → 10
  })

  it('the excess part is capped at 0 and 100', () => {
    const d = datesTo(60)
    const flat = grow(d, 0)
    expect(scoreSeries(grow(d, 0.2), flat, AS_OF).score).toBe(100)
    expect(scoreSeries(grow(d, -0.2), flat, AS_OF).score).toBe(0)
  })

  it('weights follow the months there are: 36–59 → 3y; 60–119 → 40/60; 120+ → 20/30/50', () => {
    const flat = (n: number) => grow(datesTo(n), 0)
    // ahead 6% a year for the older half, level for the newer half: the horizons differ
    const mixed = (n: number) => grow(datesTo(n), 0, (i) => (i <= n - 36 ? 1.06 ** (1 / 12) - 1 : 0))
    for (const [n, w] of [
      [40, { 3: 1 }],
      [72, { 3: 0.4, 5: 0.6 }],
      [120, { 3: 0.2, 5: 0.3, 10: 0.5 }],
    ] as const) {
      const r = scoreSeries(mixed(n), flat(n), AS_OF)
      if (r.score === null) throw new Error('scored')
      const want = r.horizons.reduce((a, h) => a + ((w as Record<number, number>)[h.years] ?? 0) * h.excess, 0)
      expect(r.excess).toBeCloseTo(want, 12)
      expect(r.horizons.map((h) => h.years)).toEqual(Object.keys(w).map(Number))
    }
  })

  it('a 5-year consistency part needs 12 windows; under 36 months is "young"; a missing month ends the run', () => {
    const r = scoreSeries(grow(datesTo(65), 0.03), grow(datesTo(65), 0), AS_OF)
    if (r.score === null) throw new Error('scored')
    expect(r.rolling.map((w) => w.years)).toEqual([3]) // only 6 five-year windows
    expect(scoreSeries(grow(datesTo(35), 0.03), grow(datesTo(35), 0), AS_OF)).toEqual({ score: null, reason: 'young', months: 35 })
    // drop one month two years back from the fund: only 23 months run back unbroken
    const d = datesTo(120)
    const f = grow(d, 0.03)
    const gap = { dates: f.dates.filter((_, i) => i !== 96), values: f.values.filter((_, i) => i !== 96) }
    expect(scoreSeries(gap, grow(d, 0), AS_OF)).toMatchObject({ score: null, reason: 'young', months: 23 })
    expect(scoreSeries(f, grow(d, 0), '2030-01-31')).toEqual({ score: null, reason: 'no_data', months: 0 })
  })

  it('daily series use the last value of each month; later dates are ignored', () => {
    const d = datesTo(48)
    const daily: Series = { dates: [], values: [] }
    const f = grow(d, 0.03)
    f.dates.forEach((iso, i) => {
      daily.dates.push(`${iso.slice(0, 8)}15`, iso) // a mid-month value that must not count
      daily.values.push(1, f.values[i]!)
    })
    daily.dates.push('2026-11-20')
    daily.values.push(9_999)
    expect(scoreSeries(daily, grow(d, 0), AS_OF)).toEqual(scoreSeries(f, grow(d, 0), AS_OF))
  })

  it('scores use the last month-end before the latest index level', () => {
    expect(scoreAsOf(20261126)).toBe(20261031)
    expect(scoreAsOf(20260105)).toBe(20251231)
    expect(scoreAsOf(20260301)).toBe(20260228)
  })
})

// ─── Category → index ───────────────────────────────────────────────────────────────────────────────────────────

describe('category map', () => {
  // every category header of today's NAVAll, each with one made-up scheme, through the real parser
  const header = 'Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date'
  const body = [header, ...categories.split('\n').filter(Boolean).flatMap((c, i) => [c, 'Synthetic Mutual Fund', `${900000 + i};-;-;Synthetic Fund ${i};Direct Plan;Growth;10.5;26-Nov-2026`])].join('\n')
  const parsed = parseAmfiNav(body, 20261127).schemes

  it('covers every equity category in the current AMFI file', () => {
    expect(parsed.length).toBe(104)
    const equity = parsed.filter((s) => /\((equity|elss|growth)/i.test(s.category ?? ''))
    expect(equity.length).toBe(28) // 13 + 12 open-ended equity (two vocabularies), close-ended ELSS and Growth, open-ended Growth
    for (const s of equity) expect({ category: s.category, ...fundIndex(s.category, s.name) }).toHaveProperty('index')
    // nothing in the file is left "unmapped": every other category is a deliberate no-score group
    expect(parsed.filter((s) => 'none' in fundIndex(s.category, s.name) && (fundIndex(s.category, s.name) as { none: string }).none === 'unmapped')).toEqual([])
  })

  it('maps both vocabularies to SEBI tier-1 indices', () => {
    const at = (inner: string, name = 'Synthetic Fund') => fundIndex(`Open Ended Schemes (${inner})`, name)
    expect(at('Equity Scheme - Large Cap Fund')).toEqual({ index: 'nifty100' })
    expect(at('Equity Schemes - Large Cap Fund')).toEqual({ index: 'nifty100' })
    expect(at('Equity Scheme - Large & Mid Cap Fund')).toEqual({ index: 'largemid250' })
    expect(at('Equity Schemes - Mid Cap Fund')).toEqual({ index: 'midcap150' })
    expect(at('Equity Scheme - Small Cap Fund')).toEqual({ index: 'smallcap250' })
    expect(at('Equity Scheme - Multi Cap Fund')).toEqual({ index: 'multicap' })
    for (const c of ['Flexi Cap Fund', 'Focused Fund', 'ELSS', 'ELSS- Tax Saver Fund', 'Value Fund', 'Contra Fund', 'Dividend Yield Fund'])
      expect(at(`Equity Scheme - ${c}`)).toEqual({ index: 'nifty500' })
    expect(fundIndex('Close Ended Schemes (ELSS)', 'x')).toEqual({ index: 'nifty500' })
    expect(at('Equity Scheme - Sectoral/ Thematic', 'Synthetic Banking & Financial Services Fund')).toEqual({ index: 'finserv' })
    expect(at('Equity Schemes - Thematic Fund', 'Synthetic Business Cycle Fund')).toEqual({ index: 'nifty500' })
    expect(at('Other Scheme - Index Funds', 'Synthetic Nifty 50 Index Fund')).toEqual({ none: 'index_fund' })
    expect(at('Exchange Traded Funds (ETFs) - Equity ETF')).toEqual({ none: 'index_fund' })
    expect(at('Equity Scheme - Large Cap Fund', 'Synthetic Nifty 100 ETF')).toEqual({ none: 'index_fund' })
    expect(at('Debt Scheme - Liquid Fund')).toEqual({ none: 'not_equity' })
    expect(at('Hybrid Scheme - Aggressive Hybrid Fund')).toEqual({ none: 'not_equity' })
    expect(fundIndex(null, 'x')).toEqual({ none: 'unmapped' })
  })

  it('reads a theme from the fund name, and a share sector from AMFI industry names', () => {
    expect(themeIndex('Synthetic Technology Fund')).toBe('it')
    expect(themeIndex('Synthetic Pharma and Healthcare Fund')).toBe('healthcare')
    expect(themeIndex('Synthetic Infrastructure Fund')).toBe('infra')
    expect(themeIndex('Synthetic Consumption Fund')).toBe('consumption')
    expect(themeIndex('Synthetic PSU Equity Fund')).toBe('pse')
    expect(themeIndex('Synthetic ESG Fund')).toBe('nifty500')
    expect(sectorIndex('Banks')).toBe('bank')
    expect(sectorIndex('IT - Software')).toBe('it')
    expect(sectorIndex('Pharmaceuticals & Biotechnology')).toBe('pharma')
    expect(sectorIndex('Automobiles')).toBe('auto')
    expect(sectorIndex('Petroleum Products')).toBe('energy')
    expect(sectorIndex('Diversified FMCG')).toBe('fmcg')
    expect(sectorIndex('Cement & Cement Products')).toBe('infra')
    expect(sectorIndex('Leisure Services')).toBeNull()
    expect(sectorIndex(null)).toBeNull()
  })
})

// ─── Source ─────────────────────────────────────────────────────────────────────────────────────────────────────

describe('niftyindices.com parser', () => {
  it('parses the saved public answer: oldest first, numbers, no future dates', () => {
    const rows = parseTri(JSON.parse(tri), 20261127)
    expect(rows.length).toBe(18)
    expect(rows.at(-1)).toEqual({ date: 20261126, tri: 39363.6 })
    expect(rows.every((r, i) => i === 0 || r.date > rows[i - 1]!.date)).toBe(true)
    expect(parseTri(JSON.parse(tri), 20261120).at(-1)!.date).toBe(20261120)
    expect(parseTri(JSON.parse(unknownTri), 20261127)).toEqual([])
    expect(parseTri({ d: JSON.stringify([{ Date: '02 Jan 2025', TotalReturnsIndex: '1,234.5' }]) }, 20261127)).toEqual([{ date: 20250102, tri: 1234.5 }])
    expect(() => parseTri({ Message: 'There was an error' }, 20261127)).toThrow(TriFormatError)
  })
})

// ─── Jobs ───────────────────────────────────────────────────────────────────────────────────────────────────────

const ymdOf = (iso: string) => Number(iso.replaceAll('-', ''))
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dmy = (iso: string) => `${iso.slice(8, 10)} ${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`

/** niftyindices.com, mocked: each index a flat series (or `levels` by name) served by the date range asked for. */
function niftyindices(levels: Record<string, Series> = {}, opts: { failAll?: boolean } = {}) {
  const asked: Array<{ name: string; from: string }> = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url !== TRI_URL) return new Response('unexpected', { status: 500 })
    if (opts.failAll) return new Response('busy', { status: 503 })
    const cinfo = String(JSON.parse(String(init?.body)).cinfo)
    const name = /'name':'([^']+)'/.exec(cinfo)![1]!
    const [from, to] = [/'startDate':'([^']+)'/.exec(cinfo)![1]!, /'endDate':'([^']+)'/.exec(cinfo)![1]!].map((s) => {
      const [d, m, y] = s.split('-')
      return Number(`${y}${String(MON.indexOf(m!) + 1).padStart(2, '0')}${d}`)
    })
    asked.push({ name, from: String(from) })
    const s = levels[name] ?? grow(datesTo(130), 0.1)
    // plus one level in November, as the live feed has (scores then end on 31 Oct)
    const rows = [...s.dates, '2026-11-26']
      .map((iso, i) => ({ iso, v: s.values[i] ?? s.values.at(-1)! }))
      .filter((r) => ymdOf(r.iso) >= from! && ymdOf(r.iso) <= to!)
      .reverse()
      .map((r) => ({ 'Index Name': name, Date: dmy(r.iso), TotalReturnsIndex: String(r.v), NTR_Value: '0', RequestNumber: 'TRI0' }))
    return new Response(JSON.stringify(rows), { headers: { 'content-type': 'text/html; charset=utf-8' } })
  })
  return asked
}

const NOW = Date.UTC(2026, 10, 27, 12) // 27 Nov 2026
const noSleep = { sleep: async () => undefined }
const FUND = 990001
const IDCW = 990002
const GROWTH = 990003
const SHARE = 'INE9SY0SCR01'

async function clearAll() {
  await env.MARKET.batch(
    ['index_level', 'score', 'stock_sector', 'tracked_scheme', 'tracked_equity', 'scheme', 'nav_backfill'].map((t) => env.MARKET.prepare(`DELETE FROM ${t}`)),
  )
  for (const prefix of ['market/idx/', 'market/nav/', 'market/px/']) {
    const listed = await env.BUCKET.list({ prefix })
    if (listed.objects.length) await env.BUCKET.delete(listed.objects.map((o) => o.key))
  }
}

async function seedFunds() {
  const scheme = (code: number, name: string, option: string, cat = 'Open Ended Schemes (Equity Scheme - Mid Cap Fund)') =>
    env.MARKET.prepare(
      `INSERT INTO scheme (amfi_code, isin_growth, isin_reinvest, name, amc, category, plan, option, latest_nav, latest_date, updated_at)
       VALUES (?1, ?2, NULL, ?3, 'Synthetic Mutual Fund', ?4, 'Direct Plan', ?5, 10, 20261126, 0)`,
    ).bind(code, `INF9SY${code}`.slice(0, 12), name, cat, option)
  await env.MARKET.batch([
    scheme(FUND, 'Synthetic Midcap Fund', 'Growth'),
    scheme(IDCW, 'Synthetic Other Midcap Fund', 'IDCW'),
    scheme(GROWTH, 'Synthetic Other Midcap Fund', 'Growth'),
    env.MARKET.prepare("INSERT INTO tracked_scheme (isin, amfi_code, amc, last_seen_at) VALUES ('INF9SYFUND01', ?1, 'x', ?3), ('INF9SYIDCW01', ?2, 'x', ?3)").bind(FUND, IDCW, NOW),
  ])
  // the fund beats a flat-ish midcap index by 3% a year
  const d = datesTo(130)
  await env.BUCKET.put(seriesKey(FUND), JSON.stringify({ amfi_code: FUND, dates: d, navs: grow(d, 0.13).values }))
}

describe('jobs', () => {
  beforeEach(clearAll)

  it('runIndices stores every index from 2010 once, then only the overlap; a re-run writes 0 rows', async () => {
    const asked = niftyindices()
    const first = await runIndices(env, { now: NOW, ...noSleep })
    expect(first).toMatchObject({ indices: INDICES.length, changed: INDICES.length, failed: 0 })
    expect(first.rows).toBe(INDICES.length * 132)
    expect(asked.every((a) => a.from === '20100101')).toBe(true)
    const s = (await (await env.BUCKET.get(indexSeriesKey('midcap150')))!.json()) as { dates: string[]; tris: number[] }
    expect(s.dates.length).toBe(132)
    asked.length = 0
    const again = await runIndices(env, { now: NOW, ...noSleep })
    expect(again).toMatchObject({ changed: 0, rows: 0, failed: 0 })
    expect(asked[0]!.from).toBe('20261116') // the latest stored (26 Nov) minus 10 days
  })

  it('runIndices throws only when every index failed', async () => {
    niftyindices({}, { failAll: true })
    await expect(runIndices(env, { now: NOW, ...noSleep })).rejects.toThrow('status 0')
  })

  it('plans, scores, upserts only changes, carries IDCW to the growth option, and serves by ISIN', async () => {
    niftyindices({ 'NIFTY MIDCAP 150': grow(datesTo(130), 0.1) })
    await runIndices(env, { now: NOW, ...noSleep })
    await seedFunds()
    const sent: ScoresMessage[] = []
    await planScores(env, NOW, async (m) => void sent.push(...m))
    expect(sent).toEqual([{ type: 'scores', keys: [`mf:${FUND}`, `mf:${IDCW}`] }])

    const v0 = await scoreVersion(env)
    const run = await runScores(env, sent[0]!.keys, NOW)
    expect(run).toMatchObject({ keys: 2, scored: 1, unscored: 1, changed: 2 })
    expect(await scoreVersion(env)).toBe(v0 + 1)
    const row = await env.MARKET.prepare('SELECT * FROM score WHERE key = ?1').bind(`mf:${FUND}`).first<{ score: number; as_of: number; data: string }>()
    expect(row).toMatchObject({ score: 90, as_of: 20261031 })
    expect(JSON.parse(row!.data)).toMatchObject({ score: 90, index: 'Nifty Midcap 150', as_of: '2026-10-31', months: 120, consistency: 100, excess: 3 })
    // the IDCW option waits for its growth option's history, which is now tracked (public ids only)
    expect(JSON.parse((await env.MARKET.prepare('SELECT data FROM score WHERE key = ?1').bind(`mf:${IDCW}`).first<string>('data'))!)).toMatchObject({
      score: null,
      reason: 'waiting',
      growth_option: true,
    })
    expect(await env.MARKET.prepare('SELECT amfi_code FROM tracked_scheme WHERE amfi_code = ?1').bind(GROWTH).first()).not.toBeNull()

    // nothing changed: a re-run writes no score and leaves the version
    expect(await runScores(env, sent[0]!.keys, NOW + 1)).toMatchObject({ changed: 0 })
    expect(await scoreVersion(env)).toBe(v0 + 1)
    sent.length = 0
    await planScores(env, NOW, async (m) => void sent.push(...m))
    expect(sent.flatMap((m) => m.keys)).toEqual([`mf:${IDCW}`, `mf:${GROWTH}`]) // waiting, and the newly tracked option

    // the growth option's history arrives: the IDCW option shows its score
    const d = datesTo(130)
    await env.BUCKET.put(seriesKey(GROWTH), JSON.stringify({ amfi_code: GROWTH, dates: d, navs: grow(d, 0.1).values }))
    await runScores(env, [`mf:${IDCW}`, `mf:${GROWTH}`], NOW + 2)
    const idcw = JSON.parse((await env.MARKET.prepare('SELECT data FROM score WHERE key = ?1').bind(`mf:${IDCW}`).first<string>('data'))!)
    expect(idcw).toMatchObject({ score: 50, growth_option: true })

    const by = await scoresFor(env, [`INF9SY${FUND}`.slice(0, 12), 'INF9SYNOTHELD'])
    expect(Object.keys(by)).toEqual([`INF9SY${FUND}`.slice(0, 12)])
    expect(by[`INF9SY${FUND}`.slice(0, 12)]!.score).toBe(90)
  })

  it('a share is scored against Nifty 50 with a sector line, priced without dividends', async () => {
    const d = datesTo(130)
    niftyindices({ 'NIFTY 50': grow(d, 0.1), 'NIFTY IT': grow(d, 0.16) })
    await runIndices(env, { now: NOW, ...noSleep })
    await env.MARKET.prepare("INSERT INTO tracked_equity (isin, exchange, last_seen_at, latest_date, backfilled_at) VALUES (?1, 'NSE', ?2, 20261126, ?2)").bind(SHARE, NOW).run()
    await env.BUCKET.put(priceSeriesKey(SHARE), JSON.stringify({ isin: SHARE, dates: d, closes: grow(d, 0.13).values }))
    const stmt = sectorStatement(env.MARKET, [{ isin: SHARE.toLowerCase(), sector: ' IT -  Software ' }, { isin: 'INF000000000', sector: 'x' }], NOW)
    await stmt!.run()
    const sent: ScoresMessage[] = []
    await planScores(env, NOW, async (m) => void sent.push(...m))
    expect(sent).toEqual([{ type: 'scores', keys: [`eq:${SHARE}`] }])
    await runScores(env, sent[0]!.keys, NOW)
    const view = (await scoresFor(env, [SHARE]))[SHARE]!
    expect(view).toMatchObject({ score: 90, index: 'Nifty 50', price_only: true, sector: { index: 'Nifty IT', years: 5, windows: 61, beat: 0 } })
    expect(view.sector!.excess).toBeLessThan(0)
  })

  it('handleMarketBatch: an indices message stores levels and sends the score plan', async () => {
    niftyindices()
    await seedFunds()
    const sent: MarketMessage[] = []
    vi.spyOn(marketQueue, 'sendBatch').mockImplementation(async (_e, msgs) => void sent.push(...msgs))
    const batch = createMessageBatch<MarketMessage>('pf-market', [{ id: 'i1', timestamp: new Date(), attempts: 1, body: { type: 'indices' } }])
    const ctx = createExecutionContext()
    await handleMarketBatch(batch, env as Env)
    await waitOnExecutionContext(ctx)
    expect((await getQueueResult(batch, ctx)).explicitAcks).toEqual(['i1'])
    expect(sent).toEqual([{ type: 'scores', keys: [`mf:${FUND}`, `mf:${IDCW}`] }])
  })

  it('a build carries the held scores by ISIN to the engine, and a new score rebuilds', async () => {
    niftyindices({ 'NIFTY MIDCAP 150': grow(datesTo(130), 0.1) })
    await runIndices(env, { now: NOW, ...noSleep })
    await seedFunds()
    await runScores(env, [`mf:${FUND}`], NOW)
    const held = `INF9SY${FUND}`.slice(0, 12)
    const h = await newHousehold('score-build')
    const m = await addMember(h, FAKE_PAN, 'SYNTHETIC SCORES')
    await storedStatement(h, m, { isins: [held, 'INF000A01011'] })
    vi.spyOn(marketQueue, 'sendBatch').mockImplementation(async () => undefined)
    const calls = fakeBuild()
    await requestRebuild(env, h.householdId)
    await deliverRebuilds(takeRebuilds(h.householdId))
    const market = (calls.at(-1) as unknown as { market: { scores: Record<string, { score: number; index: string }> } }).market
    expect(Object.keys(market.scores)).toEqual([held])
    expect(market.scores[held]).toMatchObject({ score: 90, index: 'Nifty Midcap 150' })

    // unchanged inputs: current; a changed score (new month-end data) bumps score_state and rebuilds
    await requestRebuild(env, h.householdId)
    expect((await deliverRebuilds(takeRebuilds(h.householdId)))[0]).toMatchObject({ outcome: 'current' })
    const d = datesTo(130)
    await env.BUCKET.put(seriesKey(FUND), JSON.stringify({ amfi_code: FUND, dates: d, navs: grow(d, 0.11).values }))
    expect((await runScores(env, [`mf:${FUND}`], NOW + 1)).changed).toBe(1)
    await requestRebuild(env, h.householdId)
    expect((await deliverRebuilds(takeRebuilds(h.householdId)))[0]).toMatchObject({ outcome: 'built' })
  })
})
