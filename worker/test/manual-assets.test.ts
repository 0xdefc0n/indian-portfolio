// Golden tests for the manual-asset calculator (plan §21.12, M19). Every expected value is worked out by hand in the
// comment next to it (the formulas the plan states; cross-checked against the usual bank and EPFO-style
// calculators), not by running the code. All inputs are synthetic.
import { describe, expect, it } from 'vitest'
import {
  addMonths, assetName, epfValue, fdMaturity, fdValue, type FdInputs, parseInputs, ppfDeposits, ppfValue, type PpfInputs,
  type RateTable, RATES, TENURE_CHIPS, tenureChip, tenureLabel, valueAsset,
} from '../src/lib/manual-assets'

const fd = (over: Partial<FdInputs> = {}): FdInputs => ({
  amount: 100_000, rate: 7, start: '2025-01-15', tenure: { years: 1, months: 0, days: 0 }, payout: null, closed: null, ...over,
})
const ppf = (over: Partial<PpfInputs> = {}): PpfInputs => ({ balance: 0, as_of: '2026-01-01', opened_year: 2015, yearly: 0, overrides: [], rate: null, ...over })

describe('FD', () => {
  it('cumulative with a broken period: whole quarters compounded, then simple interest for the days left', () => {
    // 15 Jan → 1 Sep 2025: quarters end 15 Apr and 15 Jul (k = 2), then 15 Jul → 1 Sep = 16 + 31 + 1 = 48 days.
    // 1,00,000 × 1.0175² × (1 + 0.07 × 48/365) = 1,03,530.625 × 1.00920548 = 1,04,483.67
    const v = fdValue(fd(), '2025-09-01')
    expect(v.value).toBeCloseTo(104_483.67, 2)
    expect(v.invested).toBe(100_000)
    expect(v.gain).toBeCloseTo(4_483.67, 2)
    expect(v.status).toBe('active')
    expect(v.maturity).toBe('2026-01-15')
    // at maturity, 4 whole quarters: 1,00,000 × 1.0175⁴ = 1,07,185.90
    expect(v.maturity_amount).toBeCloseTo(107_185.9, 2)
    expect(v.flows).toEqual([{ date: '2025-01-15', amount: -100_000 }, { date: '2025-09-01', amount: v.value }])
  })

  it('after maturity the value freezes at the maturity amount (no guessed renewal)', () => {
    const v = fdValue(fd(), '2027-06-01')
    expect(v.status).toBe('matured')
    expect(v.value).toBeCloseTo(107_185.9, 2)
    expect(v.flows.at(-1)).toEqual({ date: '2026-01-15', amount: v.value }) // the money left the FD on maturity
  })

  it('a tenure under 6 months earns simple interest', () => {
    // 10 Jan → 10 Apr 2026 = 21 + 28 + 31 + 10 = 90 days: 50,000 × (1 + 0.065 × 90/365) = 50,801.37
    const v = fdValue(fd({ amount: 50_000, rate: 6.5, start: '2026-01-10', tenure: { years: 0, months: 3, days: 0 } }), '2026-05-01')
    expect(v.maturity).toBe('2026-04-10')
    expect(v.value).toBeCloseTo(50_801.37, 2)
    expect(v.status).toBe('matured')
  })

  it('payout: the value stays at the principal and the interest paid so far is the gain', () => {
    // quarterly payouts of 2,00,000 × 7.5% / 4 = 3,750 on 1 May, 1 Aug and 1 Nov 2025 (by 20 Nov): 11,250
    const v = fdValue(fd({ amount: 200_000, rate: 7.5, start: '2025-02-01', payout: 'quarterly' }), '2025-11-20')
    expect(v.value).toBe(200_000)
    expect(v.received).toBeCloseTo(11_250, 6)
    expect(v.gain).toBeCloseTo(11_250, 6)
    expect(v.payout_amount).toBeCloseTo(3_750, 6)
    expect(v.flows).toEqual([
      { date: '2025-02-01', amount: -200_000 },
      { date: '2025-05-01', amount: 3_750 },
      { date: '2025-08-01', amount: 3_750 },
      { date: '2025-11-01', amount: 3_750 },
      { date: '2025-11-20', amount: 200_000 },
    ])
    // monthly, 7 days in: nothing paid yet; at maturity of a 7-day FD the 7 days are paid as simple interest
    expect(fdValue(fd({ payout: 'monthly', start: '2025-02-01' }), '2025-02-08').received).toBe(0)
    const week = fdValue(fd({ payout: 'monthly', start: '2025-02-01', tenure: { years: 0, months: 0, days: 7 } }), '2025-03-01')
    expect(week.received).toBeCloseTo((100_000 * 0.07 * 7) / 365, 6) // 134.25
  })

  it('closed early: valued at rate − penalty for the time actually held', () => {
    // 1 Jan → 15 Oct 2025 at 7% − 1% = 6%: quarters end 1 Apr, 1 Jul, 1 Oct (k = 3), then 14 days.
    // 1,00,000 × 1.015³ × (1 + 0.06 × 14/365) = 1,04,567.84 × 1.00230137 = 1,04,808.49
    const v = fdValue(fd({ start: '2025-01-01', tenure: { years: 2, months: 0, days: 0 }, closed: { on: '2025-10-15', penalty: 1 } }), '2026-02-01')
    expect(v.status).toBe('closed')
    expect(v.rate).toBe(6)
    expect(v.value).toBeCloseTo(104_808.49, 2)
    expect(v.flows.at(-1)).toEqual({ date: '2025-10-15', amount: v.value })
    // held under 6 months: simple. 1 Jan → 1 Mar 2025 = 59 days: 1,00,000 × (1 + 0.06 × 59/365) = 1,00,969.86
    expect(fdValue(fd({ start: '2025-01-01', tenure: { years: 2, months: 0, days: 0 }, closed: { on: '2025-03-01', penalty: 1 } }), '2025-06-01').value).toBeCloseTo(100_969.86, 2)
  })

  it("each tenure chip's maturity date, including a month-end start", () => {
    const from31Jan = Object.fromEntries(TENURE_CHIPS.map((c) => [c.id, fdMaturity('2026-01-31', c.tenure)]))
    expect(from31Jan).toEqual({
      '7d': '2026-02-07',
      '1m': '2026-02-28', // 31 Jan + 1 month: clamped to the month's end
      '3m': '2026-04-30',
      '6m': '2026-07-31',
      '1y': '2027-01-31',
      '2y': '2028-01-31',
      '3y': '2029-01-31',
      '5y': '2031-01-31',
    })
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29') // leap year
    expect(addMonths('2024-02-29', 12)).toBe('2025-02-28')
    expect(fdMaturity('2026-03-10', { years: 1, months: 2, days: 10 })).toBe('2027-05-20') // Custom
    expect(tenureChip({ years: 0, months: 6, days: 0 })).toBe('6m')
    expect(tenureChip({ years: 1, months: 2, days: 10 })).toBe('custom')
    expect(tenureLabel({ years: 1, months: 2, days: 10 })).toBe('1 year 2 months 10 days')
    expect(assetName({ type: 'fd', inputs: fd({ rate: 7.25 }) })).toBe('FD · 1 year · 7.25%')
  })
})

describe('PPF', () => {
  it('irregular deposits: a skipped year, a year over ₹1.5 lakh, interest on the 5th-to-month-end balance', () => {
    // Balance 5,00,000 on 31 Mar 2024 (after that year's credit). March 2024 doesn't earn (31 Mar is after the 5th).
    // FY 2024-25: 1,00,000 by 5 Apr 2024 → 6,00,000 × 7.1%/12 = 3,550 a month × 12 = 42,600, credited 31 Mar 2025.
    // FY 2025-26: skipped (override 0) → 6,42,600 × 7.1%/12 × 12 = 45,624.60, credited 31 Mar 2026.
    // FY 2026-27: 2,00,000 by 5 Apr 2026 (over the limit: a warning) → (6,88,224.60 + 2,00,000) × 7.1%/12 × 3
    //   (Apr–Jun) = 15,765.99, not yet credited.
    // Value = 5,00,000 + 3,00,000 + 42,600 + 45,624.60 + 15,765.99 = 9,03,990.59
    const inp = ppf({ balance: 500_000, as_of: '2024-03-31', yearly: 100_000, overrides: [{ fy: 2025, amount: 0 }, { fy: 2026, amount: 200_000 }] })
    const v = ppfValue(inp, '2026-06-30')
    expect(v.value).toBeCloseTo(903_990.59, 2)
    expect(v.uncredited).toBeCloseTo(15_765.99, 2)
    expect(v.invested).toBe(800_000)
    expect(v.warnings).toEqual(['ppf_over_limit'])
    expect(v.rate).toBe(7.1)
    expect(v.provisional).toBe(false)
    expect(v.flows).toEqual([
      { date: '2024-03-31', amount: -500_000 },
      { date: '2024-04-05', amount: -100_000 },
      { date: '2026-04-05', amount: -200_000 },
      { date: '2026-06-30', amount: v.value },
    ])
    // the 2026 deposit isn't in the value before 5 April
    expect(ppfDeposits(inp, '2026-04-04').map((d) => d.fy)).toEqual([2024])
  })

  it('a "this year" override is a deposit on the balance date, earning from the next month whose 5th is after it', () => {
    // 1,00,000 on 27 Nov 2026 plus 50,000 this year. Nov doesn't earn (27th > 5th); Dec and Jan earn on 1,50,000:
    // 1,50,000 × 7.1%/12 = 887.50 × 2 = 1,775. Jan 2027 is past the notified table: provisional.
    const v = ppfValue(ppf({ balance: 100_000, as_of: '2026-11-27', overrides: [{ fy: 2026, amount: 50_000 }] }), '2027-01-31')
    expect(v.value).toBeCloseTo(151_775, 6)
    expect(v.provisional).toBe(true)
    expect(assetName({ type: 'ppf', inputs: ppf({ opened_year: 2018 }) })).toBe('PPF · opened 2018')
  })

  it('across a rate change (a synthetic table: the real rate has not changed since 2020)', () => {
    const rates: RateTable = { checked: 'test', ppf: [{ from: '2020-04-01', rate: 8 }, { from: '2020-07-01', rate: 6 }], ppfUntil: '2020-09-30', epf: {} }
    // 1,20,000 on 1 Apr 2020 (on or before the 5th, so April earns). Apr–Jun at 8%: 800 × 3 = 2,400; Jul–Sep at 6%:
    // 600 × 3 = 1,800; Oct–Dec past the table, the last rate (6%), provisional: 1,800. Value 1,26,000.
    const v = ppfValue(ppf({ balance: 120_000, as_of: '2020-04-01', opened_year: 2010 }), '2020-12-31', rates)
    expect(v.value).toBeCloseTo(126_000, 6)
    expect(v.uncredited).toBeCloseTo(6_000, 6)
    expect(v.provisional).toBe(true)
    expect(v.maturity).toBe('2026-04-01') // opened FY 2010-11 + 15 years
    expect(v.status).toBe('active')
    expect(ppfValue(ppf({ balance: 120_000, as_of: '2020-04-01', opened_year: 2010 }), '2026-05-01', rates).status).toBe('extended')
    // a user's rate wins over the table
    expect(ppfValue(ppf({ balance: 120_000, as_of: '2020-04-01', rate: 12 }), '2020-04-30', rates).value).toBeCloseTo(121_200, 6)
  })
})

describe('EPF', () => {
  it('across a financial year whose rate differs from the year before (the change applies from 1 April)', () => {
    // 10,00,000 on 31 Jan 2022, 10,000 a month (made at each month's end, earning from the next month).
    // FY 2021-22 at 8.10%: Feb on 10,00,000 = 6,750; Mar on 10,10,000 = 6,817.50; credited 31 Mar: 13,567.50.
    // FY 2022-23 at 8.15%: Apr on 10,33,567.50, May on 10,43,567.50, Jun on 10,53,567.50:
    //   (10,33,567.50 + 10,43,567.50 + 10,53,567.50) × 8.15%/12 = 31,30,702.50 × 0.0067916̅ = 21,262.69, not credited.
    // Value = 10,00,000 + 50,000 + 13,567.50 + 21,262.69 = 10,84,830.19
    const v = epfValue({ balance: 1_000_000, as_of: '2022-01-31', monthly: 10_000, stopped: null, rate: null }, '2022-06-30')
    expect(v.value).toBeCloseTo(1_084_830.19, 2)
    expect(v.uncredited).toBeCloseTo(21_262.69, 2)
    expect(v.invested).toBe(1_050_000)
    expect(v.gain).toBeCloseTo(34_830.19, 2)
    expect(v.rate).toBe(8.15)
    expect(v.provisional).toBe(false)
    expect(v.flows.slice(0, 3)).toEqual([{ date: '2022-01-31', amount: -1_000_000 }, { date: '2022-02-28', amount: -10_000 }, { date: '2022-03-31', amount: -10_000 }])
  })

  it('past the end of the rate table: the last rate, provisional', () => {
    // FY 2026-27 isn't declared yet: 8.25% (FY 2025-26). Apr + May on 1,00,000: 687.50 × 2 = 1,375.
    const v = epfValue({ balance: 100_000, as_of: '2026-03-31', monthly: 0, stopped: null, rate: null }, '2026-05-31')
    expect(v.value).toBeCloseTo(101_375, 6)
    expect(v.rate).toBe(8.25)
    expect(v.provisional).toBe(true)
  })

  it('contributions stopped: none from that month on, interest carries on', () => {
    // 1,00,000 on 31 Mar 2025, 5,000 a month, stopped 15 Jun 2025, at 8.25% (0.6875% a month):
    // Apr on 1,00,000 = 687.50; May on 1,05,000 = 721.875; Jun, Jul, Aug on 1,10,000 = 756.25 each.
    // Interest 3,678.125; value 1,10,000 + 3,678.125 = 1,13,678.125
    const v = epfValue({ balance: 100_000, as_of: '2025-03-31', monthly: 5_000, stopped: '2025-06-15', rate: null }, '2025-08-31')
    expect(v.value).toBeCloseTo(113_678.125, 6)
    expect(v.invested).toBe(110_000)
    expect(v.status).toBe('stopped')
    expect(valueAsset({ type: 'epf', inputs: { balance: 100_000, as_of: '2025-03-31', monthly: 5_000, stopped: '2025-06-15', rate: null } }, '2025-05-01').status).toBe('active')
  })
})

describe('the rate table and the inputs', () => {
  it('has the rates checked on 2026-11-27', () => {
    expect(RATES.checked).toBe('2026-11-27')
    expect(RATES.ppf.at(-1)?.rate).toBe(7.1)
    expect(RATES.ppfUntil).toBe('2026-12-31')
    expect(RATES.epf).toMatchObject({ '2021': 8.1, '2022': 8.15, '2025': 8.25 })
  })

  it('normalises good inputs and names the first wrong field, never the value', () => {
    const today = '2026-11-27'
    const ok = parseInputs('fd', { amount: 100000, rate: 7.255, start: '2026-11-01', tenure: { years: 1, months: 0, days: 0 }, extra: 'dropped' }, today)
    expect(ok).toEqual({ ok: true, inputs: { amount: 100000, rate: 7.26, start: '2026-11-01', tenure: { years: 1, months: 0, days: 0 }, payout: null, closed: null } })
    const bad = (type: string, raw: unknown) => parseInputs(type, raw, today)
    const fdOk = { amount: 1, rate: 7, start: '2026-11-01', tenure: { years: 1, months: 0, days: 0 } }
    expect(bad('rd', fdOk)).toEqual({ ok: false, field: 'type' })
    expect(bad('fd', [])).toEqual({ ok: false, field: 'inputs' })
    expect(bad('fd', { ...fdOk, amount: 10.5 })).toEqual({ ok: false, field: 'amount' }) // whole rupees
    expect(bad('fd', { ...fdOk, amount: 1_000_000_001 })).toEqual({ ok: false, field: 'amount' }) // ≤ ₹100 crore
    expect(bad('fd', { ...fdOk, rate: 20.5 })).toEqual({ ok: false, field: 'rate' })
    expect(bad('fd', { ...fdOk, start: '2026-11-29' })).toEqual({ ok: false, field: 'start' }) // after tomorrow
    expect(bad('fd', { ...fdOk, start: '2026-02-30' })).toEqual({ ok: false, field: 'start' })
    expect(bad('fd', { ...fdOk, tenure: { years: 0, months: 0, days: 6 } })).toEqual({ ok: false, field: 'tenure' })
    expect(bad('fd', { ...fdOk, payout: 'yearly' })).toEqual({ ok: false, field: 'payout' })
    expect(bad('fd', { ...fdOk, closed: { on: '2026-10-01' } })).toEqual({ ok: false, field: 'closed' }) // before the start
    const closed = parseInputs('fd', { ...fdOk, closed: { on: '2026-11-20' } }, today)
    expect(closed.ok && (closed.inputs as FdInputs).closed).toEqual({ on: '2026-11-20', penalty: 1 }) // default penalty
    const ppfOk = { balance: 0, as_of: today, opened_year: 2018, yearly: 150000 }
    expect(parseInputs('ppf', ppfOk, today)).toEqual({ ok: true, inputs: { ...ppfOk, overrides: [], rate: null } })
    expect(bad('ppf', { ...ppfOk, opened_year: 2027 })).toEqual({ ok: false, field: 'opened_year' })
    expect(bad('ppf', { ...ppfOk, overrides: [{ fy: 2026, amount: 1 }, { fy: 2026, amount: 2 }] })).toEqual({ ok: false, field: 'overrides' })
    expect(bad('ppf', { ...ppfOk, overrides: Array.from({ length: 61 }, (_, i) => ({ fy: 2000 + i, amount: 0 })) })).toEqual({ ok: false, field: 'overrides' })
    expect(bad('epf', { balance: 1, as_of: today, monthly: -1 })).toEqual({ ok: false, field: 'monthly' })
    expect(bad('epf', { balance: 1, as_of: today, monthly: 1, rate: 'x' })).toEqual({ ok: false, field: 'rate' })
  })
})
