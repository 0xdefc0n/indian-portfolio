// Daily returns (plan §10.5, §16 "Daily returns", M12): dailySeries() golden tests, worked out by hand, then
// GET /api/portfolio/daily with its R2 cache (hit, invalidation, partial-coverage freshness, member filter, tenant
// isolation, < 50 ms cached). All data synthetic: made-up codes, NAVs and units.
import { env } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { blobKeys } from '../src/lib/blob'
import { type DailyHolding, dailySeries, type NavSeries, sliceDays, unitsAt, unitsBefore } from '../src/lib/daily'
import { DAILY_PARTIAL_FRESH_MS, dailyFor } from '../src/lib/daily-cache'
import { requestRebuild } from '../src/lib/snapshot'
import { call, callWith } from './helpers/auth'
import { FAKE_PAN, FAKE_PAN_2 } from './helpers/pdf-fixture'
import { deliverRebuilds, fakeBuild, okBuild, setMarketDay, storedStatement, takeRebuilds } from './helpers/snapshot'
import { addMember, type Household, newHousehold, r2Keys } from './helpers/tenant'

vi.setConfig({ testTimeout: 30_000 })
afterEach(() => vi.restoreAllMocks())

const series = (rows: [string, number][]): NavSeries => ({ dates: rows.map((r) => r[0]), navs: rows.map((r) => r[1]) })
const holding = (code: string, timeline: [string, number][], extra: Partial<DailyHolding> = {}): DailyHolding => ({
  member_id: 'm-1',
  isin: `INF${code}`,
  amfi_code: code,
  units_timeline: timeline,
  units_exact: true,
  statement: { as_of: timeline.at(-1)![0] },
  ...extra,
})
const byDate = (r: ReturnType<typeof dailySeries>) => new Map(r.series.map((p) => [p.date, p]))

// Mon 16 … Wed 18 Nov 2026
const A = series([['2026-11-16', 100], ['2026-11-17', 102], ['2026-11-18', 101]])
const B = series([['2026-11-16', 50], ['2026-11-17', 49], ['2026-11-18', 50.5]])

describe('dailySeries (golden, worked by hand)', () => {
  it('day change and % match a hand calculation for a two-fund household', () => {
    const r = dailySeries({
      holdings: [holding('1', [['2026-11-01', 10]]), holding('2', [['2026-11-01', 5]])],
      navs: new Map([['1', A], ['2', B]]),
      latest: '2026-11-18',
      days: 30,
    })
    const d = byDate(r)
    // Tue: 10 × (102 − 100) + 5 × (49 − 50) = 15 on a base of 10 × 100 + 5 × 50 = 1,250
    expect(d.get('2026-11-17')).toEqual({ date: '2026-11-17', value: 1265, change: 15, pct: 0.012, flag: null })
    // Wed: 10 × (101 − 102) + 5 × (50.5 − 49) = −2.5 on 10 × 102 + 5 × 49 = 1,265
    expect(d.get('2026-11-18')).toEqual({ date: '2026-11-18', value: 1262.5, change: -2.5, pct: -0.001976, flag: null })
    expect(d.has('2026-11-16')).toBe(false) // the first NAV day has no previous day to compare with
    expect(r.as_of).toBe('2026-11-18')
    expect(r.coverage).toEqual({ updated: 2, total: 2 })
    expect(r.today).toMatchObject({ change: -2.5, pct: -0.001976 })
    expect(r.today!.by_fund).toEqual([
      { member_id: 'm-1', isin: 'INF1', change: -10, pct: -0.009804, nav_date: '2026-11-18' },
      { member_id: 'm-1', isin: 'INF2', change: 7.5, pct: 0.030612, nav_date: '2026-11-18' },
    ])
  })

  it('a purchase in the window is not counted as a gain', () => {
    // 10 more units bought on Tue: they earn nothing until Wed
    const r = dailySeries({ holdings: [holding('1', [['2026-11-16', 10], ['2026-11-17', 20]])], navs: new Map([['1', A]]), latest: '2026-11-18', days: 30 })
    const d = byDate(r)
    expect(d.get('2026-11-17')).toMatchObject({ change: 20, pct: 0.02, value: 2040 }) // 10 × 2, not 20 × 2 or +1,040
    expect(d.get('2026-11-18')).toMatchObject({ change: -20, value: 2020 })
  })

  it('a redemption in the window is not counted as a loss', () => {
    const r = dailySeries({ holdings: [holding('1', [['2026-11-16', 10], ['2026-11-17', 0]])], navs: new Map([['1', A]]), latest: '2026-11-18', days: 30 })
    const d = byDate(r)
    expect(d.get('2026-11-17')).toMatchObject({ change: 20, value: 0 }) // the day's move on the units held that morning
    expect(d.get('2026-11-18')).toMatchObject({ change: 0, pct: null, value: 0 })
  })

  it('estimated SIP units after the statement count from the day after allotment', () => {
    // statement on Mon 16 (10 units); an estimated instalment of ₹1,000 allotted Tue at 102 → 9.8039 units
    const h = holding('1', [['2026-11-16', 10], ['2026-11-17', 19.8039]], { statement: { as_of: '2026-11-16' }, estimated: { instalments: 1, amount: 1000 } })
    const r = dailySeries({ holdings: [h], navs: new Map([['1', A]]), latest: '2026-11-18', days: 30 })
    expect(byDate(r).get('2026-11-17')).toMatchObject({ change: 20 })
    expect(byDate(r).get('2026-11-18')!.change).toBe(-19.8) // 19.8039 units × (101 − 102), to the paisa
    expect(r.notes).toMatchObject({ units_as_of: '2026-11-16', estimated: { instalments: 1, amount: 1000 } })
  })

  it('weekends and holidays give no point; a liquid fund\'s holiday NAV rolls into the next market day', () => {
    const eq = series([['2026-11-20', 100], ['2026-11-23', 101], ['2026-11-25', 104]]) // Fri, Mon, (Tue 24 holiday), Wed
    const liquid = series([['2026-11-20', 1000], ['2026-11-21', 1000.1], ['2026-11-22', 1000.2], ['2026-11-23', 1000.3], ['2026-11-24', 1000.4], ['2026-11-25', 1000.5]])
    const r = dailySeries({
      holdings: [holding('1', [['2026-11-01', 10]]), holding('2', [['2026-11-01', 1]])],
      navs: new Map([['1', eq], ['2', liquid]]),
      latest: '2026-11-25',
      days: 30,
    })
    expect(r.series.map((p) => p.date)).toEqual(['2026-11-23', '2026-11-25'])
    // Mon: 10 × 1 + 1 × (1000.3 − 1000) — the weekend accrual lands on Monday
    expect(r.series[0]!.change).toBeCloseTo(10.3, 6)
    // Wed: 10 × 3 + 1 × (1000.5 − 1000.3)
    expect(r.series[1]!.change).toBeCloseTo(30.2, 6)
  })

  it('partial coverage: funds that have not published yet are left out of today, and counted', () => {
    const late = series([['2026-11-16', 50], ['2026-11-17', 49]]) // no Wed NAV yet
    const r = dailySeries({
      holdings: [holding('1', [['2026-11-01', 10]]), holding('2', [['2026-11-01', 5]])],
      navs: new Map([['1', A], ['2', late]]),
      latest: '2026-11-18',
      days: 30,
    })
    expect(r.coverage).toEqual({ updated: 1, total: 2 })
    expect(r.today).toMatchObject({ change: -10, pct: -0.009804 }) // only fund 1 so far
    expect(r.today!.by_fund.map((f) => f.isin)).toEqual(['INF1'])
    expect(byDate(r).get('2026-11-18')!.value).toBe(10 * 101 + 5 * 49) // the late fund at its last NAV
  })

  it('IDCW: a payout on the day is added back; an unexplained flagged move is left out and flagged', () => {
    const idcw = series([['2026-11-16', 12.1], ['2026-11-17', 12.0], ['2026-11-18', 11.5]]) // ₹0.60 a unit paid on Wed
    const split = series([['2026-11-16', 10], ['2026-11-17', 10.1], ['2026-11-18', 5.05]])
    const r = dailySeries({
      holdings: [holding('7', [['2026-11-01', 100]], { payouts: [['2026-11-18', 60]] }), holding('8', [['2026-11-01', 10]])],
      navs: new Map([['7', idcw], ['8', split]]),
      anomalies: new Set(['8|2026-11-18']),
      latest: '2026-11-18',
      days: 30,
    })
    const wed = byDate(r).get('2026-11-18')!
    expect(wed.change).toBeCloseTo(100 * (11.5 - 12.0) + 60, 6) // +10, not −50
    expect(wed.flag).toBe('nav_jump') // fund 8's −50% isn't counted
    expect(byDate(r).get('2026-11-17')!.flag).toBeNull()
  })

  it('notes: CDSL-only units are not exact; ETFs and shares are excluded and counted', () => {
    const r = dailySeries({
      holdings: [
        holding('1', [['2026-10-31', 10]], { units_exact: false }),
        holding('2', [['2026-11-01', 5]]),
        { member_id: 'm-1', isin: 'INE000000001', amfi_code: null, units_timeline: null },
      ],
      navs: new Map([['1', A], ['2', B]]),
      latest: '2026-11-18',
      days: 30,
    })
    expect(r.notes).toEqual({ units_as_of: '2026-11-01', units_exact: false, estimated: { instalments: 0, amount: 0 }, excluded: 1 })
    const exact = dailySeries({ holdings: [holding('2', [['2026-11-01', 5]])], navs: new Map([['2', B]]), latest: '2026-11-18', days: 30 })
    expect(exact.notes.units_exact).toBe(true)
  })

  it('by member, and the window and slicing', () => {
    const r = dailySeries({
      holdings: [holding('1', [['2026-11-01', 10]]), holding('2', [['2026-11-01', 5]], { member_id: 'm-2' })],
      navs: new Map([['1', A], ['2', B]]),
      latest: '2026-11-18',
      days: 1,
    })
    expect(r.series.map((p) => p.date)).toEqual(['2026-11-17', '2026-11-18'])
    expect(sliceDays(r, 0).series.map((p) => p.date)).toEqual(['2026-11-18'])
    expect(r.today!.by_member).toEqual([
      { member_id: 'm-1', change: -10, pct: -0.009804 },
      { member_id: 'm-2', change: 7.5, pct: 0.030612 },
    ])
  })

  it('no NAVs or no funds: an empty result, never a crash', () => {
    const r = dailySeries({ holdings: [holding('9', [['2026-11-01', 1]])], navs: new Map(), latest: '2026-11-18', days: 30 })
    expect(r).toMatchObject({ as_of: null, today: null, series: [], notes: { excluded: 1 } })
  })

  it('units before / at a date', () => {
    const tl: [string, number][] = [['2026-11-16', 10], ['2026-11-17', 20]]
    expect(unitsBefore(tl, '2026-11-17')).toBe(10)
    expect(unitsAt(tl, '2026-11-17')).toBe(20)
    expect(unitsAt(tl, '2026-10-01')).toBe(10)
  })
})

// ─── Endpoint ───────────────────────────────────────────────────────────────────────────────────────────────────

let codeSeq = 9_100_000
async function navRows(code: number, rows: [number, number][]) {
  await env.MARKET.prepare(
    `INSERT INTO nav (amfi_code, date, nav) SELECT ?1, json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?2) WHERE true
     ON CONFLICT DO NOTHING`,
  ).bind(code, JSON.stringify(rows)).run()
}

/** A household with two members, one fund each, built through the real pf-rebuild consumer (fake engine). */
async function dailyHousehold(tag: string) {
  const h = await newHousehold(tag)
  const m1 = await addMember(h, FAKE_PAN, 'SYNTHETIC ONE')
  const m2 = await addMember(h, FAKE_PAN_2, 'SYNTHETIC TWO')
  await storedStatement(h, m1)
  const c1 = ++codeSeq
  const c2 = ++codeSeq
  await navRows(c1, [[20261116, 100], [20261117, 102], [20261118, 101]])
  await navRows(c2, [[20261116, 50], [20261117, 49], [20261118, 50.5]])
  const snapshot = {
    members: [{ id: m1 }, { id: m2 }],
    holdings: [
      { member_id: m1, isin: 'INF000D00011', amfi_code: String(c1), units_timeline: [['2026-11-01', 10]], units_exact: true, statement: { as_of: '2026-11-01' }, payouts: [] },
      { member_id: m2, isin: 'INF000D00022', amfi_code: String(c2), units_timeline: [['2026-11-01', 5]], units_exact: false, statement: { as_of: '2026-11-01' }, payouts: [] },
      { member_id: m1, isin: 'INE000D00033', amfi_code: null, units_timeline: null },
    ],
    activity: [],
    sips: [],
    benchmark: null,
    stocks: { enabled: false },
  }
  fakeBuild({ answer: () => okBuild(snapshot) })
  await requestRebuild(env, h.householdId)
  const [r] = await deliverRebuilds(takeRebuilds(h.householdId))
  expect(r?.outcome).toBe('built')
  return { h, m1, m2, c1, c2 }
}

const daily = (h: Household, q = '') => call(`/api/portfolio/daily${q}`, { jar: h.jar })
const dailyKeys = (h: Household) => r2Keys(blobKeys.dailyPrefix(h.householdId))

describe('GET /api/portfolio/daily', () => {
  it('the day change matches the hand calculation; cached after the first call', async () => {
    await setMarketDay(20261118)
    const { h } = await dailyHousehold('daily-hand')
    const first = await daily(h, '?days=30')
    expect(first.status).toBe(200)
    expect(first.headers.get('x-daily-cache')).toBe('miss')
    const body = await first.json<ReturnType<typeof dailySeries>>()
    expect(body.as_of).toBe('2026-11-18')
    expect(body.today).toMatchObject({ change: -2.5, pct: -0.001976 })
    expect(body.series.find((p) => p.date === '2026-11-17')).toMatchObject({ change: 15, pct: 0.012 })
    expect(body.notes).toMatchObject({ units_exact: false, excluded: 1 }) // member two's fund is CDSL-only; the share
    expect(await dailyKeys(h)).toHaveLength(1)

    const second = await daily(h, '?days=30')
    expect(second.headers.get('x-daily-cache')).toBe('hit')
    expect(await second.json()).toEqual(body)
  })

  it('a cached call reads no market data, makes one D1 query and takes < 50 ms', async () => {
    await setMarketDay(20261118)
    const { h } = await dailyHousehold('daily-fast')
    // uncached: a different member key each time misses (member check + snapshot + NAV query + compute + seal)
    const misses: number[] = []
    for (const m of ['all']) {
      const t0 = performance.now()
      const res = await daily(h, `?member=${m}`)
      misses.push(performance.now() - t0)
      expect(res.headers.get('x-daily-cache')).toBe('miss')
    }
    console.log(`daily uncached: ${misses[0]!.toFixed(1)} ms (tiny household, vitest/workerd)`)
    let marketReads = 0
    const market = new Proxy(env.MARKET, {
      get(target, prop, receiver) {
        if (prop === 'withSession' || prop === 'prepare' || prop === 'batch') marketReads++
        const v = Reflect.get(target, prop, receiver)
        return typeof v === 'function' ? v.bind(target) : v
      },
    })
    const times: number[] = []
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now()
      const res = await callWith({ ...env, MARKET: market } as typeof env, '/api/portfolio/daily', { jar: h.jar })
      times.push(performance.now() - t0)
      expect(res.headers.get('x-daily-cache')).toBe('hit')
      await res.arrayBuffer()
    }
    times.sort((a, b) => a - b)
    const p95 = times[Math.floor(times.length * 0.95) - 1]!
    console.log(`daily cached: p50 ${times[10]!.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms (20 calls, vitest/workerd)`)
    expect(marketReads).toBe(0) // the market status comes from the edge cache, the series from R2
    expect(p95).toBeLessThan(50)
  })

  it('a household with 50 funds and a year of NAVs (~19k rows): measured with and without the cache', async () => {
    await setMarketDay(20261118)
    const h = await newHousehold('daily-big')
    const m = await addMember(h, FAKE_PAN, 'SYNTHETIC BIG')
    await storedStatement(h, m)
    const holdings: DailyHolding[] = []
    const start = Date.parse('2025-10-01T00:00:00Z')
    for (let f = 0; f < 50; f++) {
      const code = ++codeSeq
      const rows: [number, number][] = []
      for (let t = start, i = 0; t <= Date.parse('2026-11-18T00:00:00Z'); t += 86_400_000, i++) {
        const d = new Date(t)
        if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue
        rows.push([Number(d.toISOString().slice(0, 10).replaceAll('-', '')), 100 + f + Math.sin(i / 7) * 3])
      }
      await navRows(code, rows)
      holdings.push({ member_id: m, isin: `INF000B${String(f).padStart(5, '0')}`, amfi_code: String(code), units_timeline: [['2025-09-01', 10 + f], ['2026-06-01', 20 + f]], units_exact: true, statement: { as_of: '2026-06-01' }, payouts: [] })
    }
    fakeBuild({ answer: () => okBuild({ members: [{ id: m }], holdings, activity: [], sips: [], benchmark: null, stocks: { enabled: false } }) })
    await requestRebuild(env, h.householdId)
    expect((await deliverRebuilds(takeRebuilds(h.householdId)))[0]?.outcome).toBe('built')
    const t0 = performance.now()
    const miss = await daily(h, '?days=366')
    const missMs = performance.now() - t0
    expect(miss.headers.get('x-daily-cache')).toBe('miss')
    const body = await miss.json<ReturnType<typeof dailySeries>>()
    expect(body.series.length).toBeGreaterThan(240)
    const hits: number[] = []
    for (let i = 0; i < 20; i++) {
      const t1 = performance.now()
      const res = await daily(h, '?days=366')
      await res.arrayBuffer()
      hits.push(performance.now() - t1)
    }
    hits.sort((a, b) => a - b)
    console.log(`daily 50 funds: uncached ${missMs.toFixed(0)} ms; cached p95 ${hits[18]!.toFixed(1)} ms (vitest/workerd)`)
    expect(hits[18]!).toBeLessThan(50)
  })

  it('member filter, and another household\'s member is a 404', async () => {
    await setMarketDay(20261118)
    const { h, m2 } = await dailyHousehold('daily-member')
    const res = await daily(h, `?member=${m2}`)
    expect(res.status).toBe(200)
    const body = await res.json<ReturnType<typeof dailySeries>>()
    expect(body.today).toMatchObject({ change: 7.5, by_member: [{ member_id: m2, change: 7.5 }] })
    expect(body.notes).toMatchObject({ units_exact: false, excluded: 0 })

    const other = await dailyHousehold('daily-other')
    expect((await daily(other.h, `?member=${m2}`)).status).toBe(404)
    expect((await daily(h, '?member=not-a-uuid')).status).toBe(404)
    expect((await daily(h, '?days=0')).status).toBe(400)
    expect((await daily(h, '?days=400')).status).toBe(400)
    expect(await dailyKeys(other.h)).toHaveLength(0) // nothing cached under the wrong household
  })

  it('a new NAV day uses a new key; a rebuild deletes the old inputs\' entries', async () => {
    await setMarketDay(20261118)
    const { h, c1, c2 } = await dailyHousehold('daily-invalidate')
    await daily(h)
    const [oldKey] = await dailyKeys(h)
    await navRows(c1, [[20261119, 103]])
    await navRows(c2, [[20261119, 51]])
    await setMarketDay(20261119)
    const res = await daily(h)
    expect(res.headers.get('x-daily-cache')).toBe('miss')
    expect((await res.json<ReturnType<typeof dailySeries>>()).as_of).toBe('2026-11-19')
    expect(await dailyKeys(h)).toHaveLength(2)

    // the new market day changes the snapshot's inputs: the rebuild drops every entry of the old inputs
    await requestRebuild(env, h.householdId)
    expect((await deliverRebuilds(takeRebuilds(h.householdId)))[0]?.outcome).toBe('built')
    const left = await dailyKeys(h)
    expect(left).not.toContain(oldKey)
    expect(left).toHaveLength(0)
  })

  it('partial coverage is cached for 30 minutes only', async () => {
    await setMarketDay(20261118)
    const { h, c1, c2 } = await dailyHousehold('daily-partial')
    await navRows(c1, [[20261120, 104]]) // fund two hasn't published the 20th yet
    await setMarketDay(20261120)
    const row = await env.DB.prepare('SELECT blob_key, inputs_hash FROM snapshot WHERE household_id = ?1').bind(h.householdId).first<{ blob_key: string; inputs_hash: string }>()
    const req = {
      householdId: h.householdId,
      vault: await h.tenant.vault(),
      snapshotKey: row!.blob_key,
      inputsHash: row!.inputs_hash,
      market: { latest_nav_date: '2026-11-20', coverage_pct: 50, final: false },
      member: 'all',
      days: 30,
    }
    const now = Date.now()
    const a = await dailyFor(env, { ...req, now })
    expect(a.cache).toBe('miss')
    expect(a.result.coverage).toEqual({ updated: 1, total: 2 })
    expect((await dailyFor(env, { ...req, now: now + DAILY_PARTIAL_FRESH_MS - 1000 })).cache).toBe('hit')
    await navRows(c2, [[20261120, 52]])
    const late = await dailyFor(env, { ...req, now: now + DAILY_PARTIAL_FRESH_MS + 1000 })
    expect(late.cache).toBe('miss')
    expect(late.result.coverage).toEqual({ updated: 2, total: 2 })
    // complete coverage stays cached
    expect((await dailyFor(env, { ...req, now: now + 10 * DAILY_PARTIAL_FRESH_MS })).cache).toBe('hit')
  })

  it('no snapshot yet: an empty result', async () => {
    const h = await newHousehold('daily-empty')
    const res = await daily(h)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ as_of: null, today: null, series: [] })
    expect((await call('/api/portfolio/daily')).status).toBe(401)
  })

  it('the cache blob is sealed: no plaintext in R2', async () => {
    await setMarketDay(20261118)
    const { h } = await dailyHousehold('daily-sealed')
    await daily(h)
    const [key] = await dailyKeys(h)
    const raw = new Uint8Array(await (await env.BUCKET.get(key!))!.arrayBuffer())
    const text = new TextDecoder('latin1').decode(raw)
    expect(text).not.toContain('series')
    expect(text).not.toContain('INF000D00011')
  })
})
