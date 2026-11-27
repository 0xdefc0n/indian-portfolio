// Golden tests for gold and silver (plan §21.5, M29): the per-gram rate lookup, physical gold and silver values, and
// the rate derivation from ETF NAVs. Expected values are worked out by hand in the comments. All inputs are
// synthetic (made-up rates and NAVs), except where a test names the real series table.
import { describe, expect, it } from 'vitest'
import {
  assetName, metalRate, type MetalRates, metalValue, parseInputs, projectAsset, projectionEnd, projectionStart, RATES, type RateTable,
  purityFactor, sgbOfHolding, sgbSeries, sgbValue, SGB_SERIES, valueAsset,
} from '../src/lib/manual-assets'
import { anchorFactors, deriveRates, factorAt, splitAdjusted } from '../src/market/metals'

const metals: MetalRates = {
  gold: [['2026-10-31', 12_000], ['2026-11-20', 12_500], ['2026-11-23', 12_600], ['2026-11-24', 12_700], ['2026-11-26', 12_800]],
  silver: [['2026-11-20', 150], ['2026-11-26', 154.3]],
}
const rates: RateTable = { ...RATES, metals }

describe('rate lookup', () => {
  it('takes the latest rate on or before the day, and none before the series starts', () => {
    expect(metalRate(metals, 'gold', '2026-11-26')).toEqual({ rate: 12_800, date: '2026-11-26' })
    expect(metalRate(metals, 'gold', '2026-11-25')).toEqual({ rate: 12_700, date: '2026-11-24' }) // a missing day falls back
    expect(metalRate(metals, 'gold', '2026-11-28')).toEqual({ rate: 12_800, date: '2026-11-26' }) // the weekend
    expect(metalRate(metals, 'gold', '2026-11-10')).toEqual({ rate: 12_000, date: '2026-10-31' }) // a month-end point
    expect(metalRate(metals, 'gold', '2026-10-30')).toBeNull()
    expect(metalRate(undefined, 'gold', '2026-11-26')).toBeNull()
    expect(metalRate({ gold: [], silver: [] }, 'silver', '2026-11-26')).toBeNull()
  })
})

describe('physical gold and silver', () => {
  it('purity: 24K is the 999 rate itself, 22K × 0.916, 18K × 0.75 (how IBJA quotes them)', () => {
    expect(purityFactor(999)).toBe(1)
    expect(purityFactor(916)).toBe(0.916)
    expect(purityFactor(750)).toBe(0.75)
    // 20 g of 22K on 26 Nov: 20 × 12,800 × 0.916 = 2,34,496; rate shown per gram at that purity 11,724.80
    const v = metalValue('gold', { grams: 20, purity: 916, paid: 200_000, bought: '2025-01-10' }, '2026-11-26', rates)
    expect(v.value).toBeCloseTo(234_496, 6)
    expect(v.price).toEqual({ rate: 11_724.8, date: '2026-11-26' })
    expect(v.invested).toBe(200_000)
    expect(v.gain).toBeCloseTo(34_496, 6)
    expect(v.cost_unknown).toBe(false)
    expect(v.warnings).toEqual([])
    expect(v.flows).toEqual([{ date: '2025-01-10', amount: -200_000 }, { date: '2026-11-26', amount: v.value }])
    // 10 g of 24K: 1,28,000; 5 g of 18K: 5 × 12,800 × 0.75 = 48,000
    expect(metalValue('gold', { grams: 10, purity: 999, paid: null, bought: null }, '2026-11-26', rates).value).toBe(128_000)
    expect(metalValue('gold', { grams: 5, purity: 750, paid: null, bought: null }, '2026-11-26', rates).value).toBe(48_000)
  })

  it('silver: grams × the silver rate (999); 1 kg at ₹154.30/g = 1,54,300', () => {
    const v = valueAsset({ type: 'silver', inputs: { grams: 1000, purity: 999, paid: null, bought: null } }, '2026-11-26', rates)
    expect(v.value).toBeCloseTo(154_300, 6)
    expect(v.price).toEqual({ rate: 154.3, date: '2026-11-26' })
  })

  it('a missing rate day falls back to the last one; over 7 days old it is flagged', () => {
    const v = metalValue('gold', { grams: 10, purity: 999, paid: null, bought: null }, '2026-11-25', rates)
    expect(v.value).toBe(127_000) // 24 Nov's rate
    expect(v.price?.date).toBe('2026-11-24')
    expect(v.warnings).toEqual([])
    // 26 Nov's rate on 4 Dec: 8 days old
    const old = metalValue('gold', { grams: 10, purity: 999, paid: null, bought: null }, '2026-12-04', rates)
    expect(old.value).toBe(128_000)
    expect(old.warnings).toEqual(['stale_rate'])
  })

  it('no price paid: the value shows, the gain is left out (cost_unknown, no XIRR flows)', () => {
    const v = metalValue('gold', { grams: 10, purity: 916, paid: null, bought: '2020-05-01' }, '2026-11-26', rates)
    expect(v.value).toBeCloseTo(117_248, 6) // 10 × 12,800 × 0.916
    expect(v.cost_unknown).toBe(true)
    expect(v.invested).toBe(0)
    expect(v.gain).toBe(0)
    expect(v.flows).toEqual([])
  })

  it('no rate at all: the value is what was paid (or nothing), marked no_rate', () => {
    const paid = metalValue('gold', { grams: 10, purity: 999, paid: 90_000, bought: '2024-01-01' }, '2026-11-26', RATES)
    expect(paid.value).toBe(90_000)
    expect(paid.gain).toBe(0)
    expect(paid.price).toBeNull()
    expect(paid.warnings).toEqual(['no_rate'])
    expect(metalValue('silver', { grams: 100, purity: 999, paid: null, bought: null }, '2026-11-26', RATES).value).toBe(0)
  })

  it('names, validation and the history range', () => {
    expect(assetName({ type: 'gold', inputs: { grams: 20, purity: 916, paid: null, bought: null } })).toBe('Gold · 22K · 20 g')
    expect(assetName({ type: 'silver', inputs: { grams: 1000, purity: 999, paid: null, bought: null } })).toBe('Silver · 1 kg')
    expect(assetName({ type: 'gold', inputs: { grams: 12.3456, purity: 999, paid: null, bought: null } })).toBe('Gold · 24K · 12.346 g')

    const today = '2026-11-26'
    expect(parseInputs('gold', { grams: 12.34567, purity: 916 }, today)).toEqual({ ok: true, inputs: { grams: 12.346, purity: 916, paid: null, bought: null } })
    expect(parseInputs('silver', { grams: 500, purity: 916 }, today)).toEqual({ ok: true, inputs: { grams: 500, purity: 999, paid: null, bought: null } })
    expect(parseInputs('gold', { grams: 0, purity: 916 }, today)).toEqual({ ok: false, field: 'grams' })
    expect(parseInputs('gold', { grams: 200_000, purity: 916 }, today)).toEqual({ ok: false, field: 'grams' })
    expect(parseInputs('gold', { grams: 10, purity: 900 }, today)).toEqual({ ok: false, field: 'purity' })
    expect(parseInputs('gold', { grams: 10, purity: 916, paid: 50_000 }, today)).toEqual({ ok: false, field: 'bought' }) // XIRR needs it
    expect(parseInputs('gold', { grams: 10, purity: 916, paid: 50.5, bought: '2026-01-01' }, today)).toEqual({ ok: false, field: 'paid' })
    expect(parseInputs('gold', { grams: 10, purity: 916, bought: '2026-12-01' }, today)).toEqual({ ok: false, field: 'bought' })

    const g = { type: 'gold' as const, inputs: { grams: 10, purity: 999 as const, paid: 100_000, bought: '2026-09-15' } }
    expect(projectionStart(g, today)).toBe('2026-09-15')
    expect(projectionStart({ ...g, inputs: { ...g.inputs, paid: null, bought: null } }, today)).toBe('2021-11-26') // 5 years back
    expect(projectionEnd(g, today)).toBe(today)
    // month-ends at month-end rates: 30 Sep and 31 Oct have only 31 Oct's point → 30 Sep: no rate (paid), 31 Oct: 1,20,000
    const pts = projectAsset(g, '2026-10-31', today, rates)
    expect(pts.map((p) => [p.date, p.value])).toEqual([['2026-10-31', 120_000], ['2026-11-26', 128_000]])
  })
})

describe('Sovereign Gold Bonds', () => {
  it('the series table: 67 tranches, 2.75% for the first five, ISINs unique', () => {
    expect(SGB_SERIES).toHaveLength(67)
    expect(SGB_SERIES.filter((s) => s.coupon === 2.75).map((s) => s.id)).toEqual(['2015-I', '2016-I', '2016-II', '2016-17-I', '2016-17-II'])
    expect(new Set(SGB_SERIES.map((s) => s.isin)).size).toBe(67)
    expect(sgbSeries('2020-21-I')).toMatchObject({ name: '2020-21 Series I', issue: '2020-04-28', price: 4639, coupon: 2.5 })
    expect(sgbOfHolding('IN0020200062', 'SGB anything')).toMatchObject({ id: '2020-21-I' })
    expect(sgbOfHolding('IN0020990000', '2.50% GOLDBONDS 2031 SR-I')).toBe('unknown') // a G-sec ISIN that says gold bond
    expect(sgbOfHolding('IN0020230085', 'GOI 7.18% 2033')).toBeNull() // a plain G-sec
    expect(sgbOfHolding('INF000S03BE3', 'Synth Gold BeES')).toBeNull() // a gold ETF stays an ETF
  })

  it('active, subscribed at issue: units × gold rate, interest every six months on the issue price', () => {
    // 2020-21 Series I: issued 28 Apr 2020 at ₹4,639, 2.5%. 10 units on 26 Nov 2026:
    // interest dates 28 Oct 2020 … 28 Oct 2026 = 13, each 10 × 4,639 × 2.5% / 2 = 579.875 → 7,538.375
    // value 10 × 12,800 = 1,28,000; invested 46,390; gain 1,28,000 + 7,538.375 − 46,390 = 89,148.375
    const v = sgbValue({ series: '2020-21-I', grams: 10, bought: null, redeemed: null }, '2026-11-26', rates)
    expect(v.value).toBe(128_000)
    expect(v.invested).toBe(46_390)
    expect(v.received).toBeCloseTo(7_538.375, 9)
    expect(v.gain).toBeCloseTo(89_148.375, 9)
    expect(v.payout_amount).toBeCloseTo(579.875, 9)
    expect(v.maturity).toBe('2028-04-28')
    expect(v.status).toBe('active')
    expect(v.flows[0]).toEqual({ date: '2020-04-28', amount: -46_390 })
    expect(v.flows[1]).toEqual({ date: '2020-10-28', amount: 579.875 })
    expect(v.flows).toHaveLength(15)
    expect(v.flows.at(-1)).toEqual({ date: '2026-11-26', amount: 128_000 })
    expect(assetName({ type: 'sgb', inputs: { series: '2020-21-I', grams: 10, bought: null, redeemed: null } })).toBe('SGB 2020-21 Series I · 10 g')
  })

  it('bought later on the exchange: invested at the price paid, interest only after the purchase', () => {
    // bought 15 Jan 2023 at ₹5,600: interest dates 28 Apr 2023 … 28 Oct 2026 = 8 × 579.875 = 4,639
    const v = sgbValue({ series: '2020-21-I', grams: 10, bought: { on: '2023-01-15', price: 5600 }, redeemed: null }, '2026-11-26', rates)
    expect(v.invested).toBe(56_000)
    expect(v.received).toBeCloseTo(4_639, 9)
    expect(v.gain).toBeCloseTo(128_000 + 4_639 - 56_000, 9)
    expect(v.flows[0]).toEqual({ date: '2023-01-15', amount: -56_000 })
  })

  it('matured (a 2.75% tranche): the value freezes at the gold rate on maturity, all 16 interest payments', () => {
    // 2015-I: issued 30 Nov 2015 at ₹2,684, 2.75%; matured 30 Nov 2023. 5 units: each payment 5 × 2,684 × 2.75% / 2 = 184.525,
    // × 16 = 2,952.40; value 5 × 6,132 = 30,660 (the rate on 30 Nov 2023)
    const r: RateTable = { ...RATES, metals: { gold: [['2023-11-30', 6132], ...metals.gold], silver: [] } }
    const v = sgbValue({ series: '2015-I', grams: 5, bought: null, redeemed: null }, '2026-11-26', r)
    expect(v.status).toBe('matured')
    expect(v.maturity).toBe('2023-11-30')
    expect(v.value).toBe(30_660)
    expect(v.received).toBeCloseTo(2_952.4, 9)
    expect(v.price).toEqual({ rate: 6132, date: '2023-11-30' })
    expect(v.warnings).toEqual([]) // an old rate is history here, not stale
    expect(v.flows.at(-1)).toEqual({ date: '2023-11-30', amount: 30_660 })
  })

  it('redeemed early (from year 5): value at that date, interest up to it', () => {
    // 2017-18 Series IV: issued 23 Oct 2017 at ₹2,987. Redeemed 23 Apr 2023: interest 23 Apr 2018 … 23 Apr 2023 = 11 ×
    // (4 × 2,987 × 2.5% / 2 = 149.35) = 1,642.85; value 4 × 6,037 (the rate on or before 23 Apr 2023) = 24,148
    const r: RateTable = { ...RATES, metals: { gold: [['2023-04-21', 6037], ...metals.gold], silver: [] } }
    const v = sgbValue({ series: '2017-18-IV', grams: 4, bought: null, redeemed: '2023-04-23' }, '2026-11-26', r)
    expect(v.status).toBe('redeemed')
    expect(v.value).toBe(24_148)
    expect(v.received).toBeCloseTo(1_642.85, 9)
    expect(v.invested).toBe(11_948)
  })

  it('validation', () => {
    const today = '2026-11-26'
    expect(parseInputs('sgb', { series: '2020-21-I', grams: 10 }, today)).toEqual({ ok: true, inputs: { series: '2020-21-I', grams: 10, bought: null, redeemed: null } })
    expect(parseInputs('sgb', { series: 'nope', grams: 10 }, today)).toEqual({ ok: false, field: 'series' })
    expect(parseInputs('sgb', { series: '2020-21-I', grams: 2.5 }, today)).toEqual({ ok: false, field: 'grams' })
    expect(parseInputs('sgb', { series: '2020-21-I', grams: 1, redeemed: '2025-04-27' }, today)).toEqual({ ok: false, field: 'redeemed' }) // before year 5
    expect(parseInputs('sgb', { series: '2020-21-I', grams: 1, redeemed: '2025-04-28' }, today)).toMatchObject({ ok: true })
    expect(parseInputs('sgb', { series: '2020-21-I', grams: 1, bought: { on: '2020-01-01', price: 4000 } }, today)).toEqual({ ok: false, field: 'bought' }) // before issue
    expect(parseInputs('sgb', { series: '2020-21-I', grams: 1, bought: { on: '2024-01-01', price: 0 } }, today)).toEqual({ ok: false, field: 'bought' })
    // the value dispatch and the history range
    const a = { type: 'sgb' as const, inputs: { series: '2015-I', grams: 1, bought: null, redeemed: null } }
    expect(valueAsset(a, today, rates).status).toBe('matured')
    expect(projectionStart(a, today)).toBe('2015-11-30')
    expect(projectionEnd(a, today)).toBe('2023-11-30')
  })
})

describe('rate derivation from ETF NAVs', () => {
  it('splits and consolidations are undone (a day-on-day move beyond ±30%)', () => {
    // 1:100 split on day 3: earlier NAVs × 1/100
    const s = splitAdjusted(new Map([[20200101, 4000], [20200102, 4040], [20200103, 40.5], [20200106, 41]]))
    expect(s.get(20200101)).toBeCloseTo(4000 * (40.5 / 4040), 9)
    expect(s.get(20200102)).toBeCloseTo(40.5, 9)
    expect(s.get(20200103)).toBe(40.5)
    expect(s.get(20200106)).toBe(41)
  })

  it('k at each anchor is the price over the mean NAV on its dates; between anchors log-linear, beyond them the slope (clamped)', () => {
    // anchor A: NAVs 100, 101, 102 (mean 101) at ₹10,100/g → k = 100; anchor B a year later (365 days): NAV 110 at ₹11,110 → k = 101
    const navs = new Map([[20250102, 100], [20250103, 101], [20250106, 102], [20260105, 110]])
    const points = anchorFactors(navs, [
      { dates: [20250102, 20250103, 20250106], price: 10_100, source: 'synthetic' },
      { dates: [20260105], price: 11_110, source: 'synthetic' },
      { dates: [20270105], price: 1, source: 'synthetic: no NAV that day, skipped' },
    ])
    expect(points).toHaveLength(2)
    expect(Math.exp(points[0]!.lnK)).toBeCloseTo(100, 9)
    expect(Math.exp(points[1]!.lnK)).toBeCloseTo(101, 9)
    // Mid-way (≈182.5 days on from A's mean day): √(100 × 101) = 100.4988
    const mid = (points[0]!.t + points[1]!.t) / 2
    expect(factorAt(points, mid)).toBeCloseTo(Math.sqrt(100 * 101), 6)
    // A year past B: the slope is ln(1.01)/yr (under the 2% cap) → 101 × 1.01 = 102.01
    expect(factorAt(points, points[1]!.t + (points[1]!.t - points[0]!.t))).toBeCloseTo(102.01, 6)
    // Clamped: a 10%/yr slope extends at 2%/yr at most; a falling k doesn't extend at all
    const steep = [{ t: 0, lnK: Math.log(100) }, { t: 365, lnK: Math.log(110) }]
    expect(factorAt(steep, 730)).toBeCloseTo(110 * 1.02, 6)
    const falling = [{ t: 0, lnK: Math.log(100) }, { t: 365, lnK: Math.log(99) }]
    expect(factorAt(falling, 730)).toBeCloseTo(99, 9)
    expect(factorAt(falling, -365)).toBeCloseTo(100, 9)
    expect(factorAt([{ t: 0, lnK: Math.log(50) }], 1000)).toBeCloseTo(50, 9) // one anchor: constant
    expect(factorAt([], 0)).toBeNull()
  })

  it('the rate is the median of NAV × k over the ETFs with a NAV that day; an ETF missing a day is left out of it', () => {
    const refs = [
      { metal: 'gold' as const, code: 1 },
      { metal: 'gold' as const, code: 2 },
      { metal: 'gold' as const, code: 3 },
      { metal: 'silver' as const, code: 9 },
    ]
    const anchors = {
      gold: [{ dates: [20261120], price: 12_500, source: 'synthetic' }],
      silver: [{ dates: [20261120], price: 150, source: 'synthetic' }],
    }
    // k: ETF 1 = 12,500/100 = 125; ETF 2 = 12,500/10 = 1,250; ETF 3 = 12,500/50 = 250
    const navs = new Map([
      [1, new Map([[20261120, 100], [20261123, 101]])],
      [2, new Map([[20261120, 10], [20261123, 10.2]])], // 26 Nov missing
      [3, new Map([[20261120, 50], [20261123, 50.3], [20261126, 50.5]])],
      [9, new Map([[20261120, 15], [20261126, 15.43]])],
    ])
    navs.get(1)!.set(20261126, 102)
    const rows = deriveRates(navs, refs, anchors)
    // 23 Nov: 101 × 125 = 12,625; 10.2 × 1,250 = 12,750; 50.3 × 250 = 12,575 → median 12,625
    // 26 Nov: 102 × 125 = 12,750; 50.5 × 250 = 12,625 → median of two = 12,687.50
    // silver: k = 10; 26 Nov 15.43 × 10 = 154.30
    expect(rows).toEqual([
      { metal: 'gold', date: 20261120, rate: 12_500, etfs: 3 },
      { metal: 'gold', date: 20261123, rate: 12_625, etfs: 3 },
      { metal: 'gold', date: 20261126, rate: 12_687.5, etfs: 2 },
      { metal: 'silver', date: 20261120, rate: 150, etfs: 1 },
      { metal: 'silver', date: 20261126, rate: 154.3, etfs: 1 },
    ])
  })
})
