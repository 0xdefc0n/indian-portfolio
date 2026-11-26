// AMFI and mfapi parsers (plan §10.4.4, §16 "NAV ingest": the real file format). The fixtures are excerpts of the
// public files fetched on 2026-11-26, kept byte for byte (CRLF, blank lines holding a space, "-" ISINs, stale dates).
import { describe, expect, it } from 'vitest'
import { amcId } from '../src/market/amc-ids'
import {
  addDays,
  AmfiFormatError,
  anomalies,
  daysBetween,
  istToday,
  parseAmfiDate,
  parseAmfiNav,
  parseMfapi,
  parseNav,
  ymdToAmfi,
  ymdToIso,
} from '../src/market/amfi'
import history1Day from './fixtures/amfi/history-1day-excerpt.txt?raw'
import historyUti from './fixtures/amfi/history-uti-excerpt.txt?raw'
import mfapiJson from './fixtures/amfi/mfapi-120716-excerpt.json?raw'
import navAll from './fixtures/amfi/NAVAll-excerpt.txt?raw'

const TODAY = 20261126

describe('NAVAll.txt (daily file)', () => {
  it('keeps the real file byte for byte (CRLF line ends)', () => {
    expect(navAll.includes('\r\n')).toBe(true)
    expect(navAll.split('\r\n')[0]).toBe('Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date')
  })

  it('reads every row with its AMC and category, "-" ISINs as null, and stale dates kept', () => {
    const p = parseAmfiNav(navAll, TODAY)
    expect(p.schemes).toHaveLength(65)
    expect(p.navs).toHaveLength(65)
    expect(p.dropped).toBe(0)
    const byCode = new Map(p.schemes.map((s) => [s.amfi_code, s]))
    expect(byCode.get(120716)).toEqual({
      amfi_code: 120716,
      isin_growth: 'INF789F01XA0',
      isin_reinvest: null,
      name: 'UTI Nifty 50 Index Fund',
      amc: 'UTI Mutual Fund',
      category: 'Open Ended Schemes (Other Scheme - Index Funds)',
      plan: 'Direct Plan',
      option: 'Growth',
      nav: 181.9059,
      date: 20261125,
    })
    expect(byCode.get(135762)).toMatchObject({ amc: 'Axis Mutual Fund', category: "Open Ended Schemes (Children’s Fund - Childrens' Fund)", date: 20261125 })
    expect(p.schemes.filter((s) => s.isin_reinvest === null)).toHaveLength(40)
    expect(p.schemes.filter((s) => s.isin_growth === null)).toHaveLength(4)
    const dates = new Set(p.navs.map((r) => r.date))
    expect(dates.size).toBe(12) // wound-up schemes keep their last date
    expect(p.navs.filter((r) => r.date === 20261125)).toHaveLength(47)
    expect(dates.has(20180702)).toBe(true)
    // No AMC line is taken for a category, and no row lacks one.
    expect(p.schemes.every((s) => s.amc && !/^Open Ended/.test(s.amc) && s.category?.startsWith('Open Ended'))).toBe(true)
  })

  it('drops NAVs dated after today (IST) but keeps the scheme', () => {
    const p = parseAmfiNav(navAll, 20261124)
    expect(p.schemes).toHaveLength(65)
    expect(p.navs).toHaveLength(18)
    expect(p.dropped).toBe(47)
    expect(p.schemes.find((s) => s.amfi_code === 120716)).toMatchObject({ nav: null, date: null })
  })

  it('drops N.A., zero, negative and unreadable values, skips rows of the wrong width, and reads LF files', () => {
    const body = [
      'Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date',
      ' ',
      'Close Ended Schemes ( Income )',
      '',
      'Synth Mutual Fund',
      '900001;INF900S01011;-;Synth A;Direct Plan;Growth;N.A.;25-Nov-2026',
      '900002;INF900S02012;;Synth B;Direct Plan;Growth;0;25-Nov-2026',
      '900003;inf900s03013;INF900S03021;Synth C;Direct Plan;IDCW;-1.5;25-Nov-2026',
      '900004;INF900S04014;-;Synth D;Direct Plan;Growth;10.5;31-Feb-2026',
      '900005;INF900S05015;-;Synth E;Direct Plan;Growth;1,003.8576;25-Nov-2026',
      '900006;bad;-;Synth F;Direct Plan;Growth;12.25;25-nov-2026',
      '900007;INF900S07017;-;Synth G;12.0;25-Nov-2026',
      'Interval Fund Schemes(Income)',
      'Other AMC',
      '900008;-;-;Synth H;Regular Plan;Growth;20;24-Nov-2026',
    ].join('\n')
    const p = parseAmfiNav(body, TODAY)
    expect(p.schemes.map((s) => s.amfi_code)).toEqual([900001, 900002, 900003, 900004, 900005, 900006, 900008])
    expect(p.navs).toEqual([
      { amfi_code: 900005, date: 20261125, nav: 1003.8576 },
      { amfi_code: 900006, date: 20261125, nav: 12.25 },
      { amfi_code: 900008, date: 20261124, nav: 20 },
    ])
    expect(p.dropped).toBe(4)
    const c = p.schemes.find((s) => s.amfi_code === 900003)!
    expect([c.isin_growth, c.isin_reinvest, c.category, c.amc]).toEqual(['INF900S03013', 'INF900S03021', 'Close Ended Schemes (Income)', 'Synth Mutual Fund'])
    expect(p.schemes.find((s) => s.amfi_code === 900006)!.isin_growth).toBeNull()
    expect(p.schemes.find((s) => s.amfi_code === 900008)).toMatchObject({ amc: 'Other AMC', category: 'Interval Fund Schemes (Income)', isin_growth: null })
  })

  it('refuses a body that is not an AMFI report (the HTML page served for a too-long range, or nothing)', () => {
    expect(() => parseAmfiNav('<!DOCTYPE html><html lang="en"><head>…', TODAY)).toThrow(AmfiFormatError)
    expect(() => parseAmfiNav('', TODAY)).toThrow(AmfiFormatError)
    expect(() => parseAmfiNav('Scheme Code;Scheme Name;Date\r\n1;x;25-Nov-2026', TODAY)).toThrow(AmfiFormatError)
  })
})

describe('NAV history report', () => {
  it('reads its own column order by header name', () => {
    const p = parseAmfiNav(history1Day, TODAY)
    expect(p.navs).toHaveLength(127)
    expect(new Set(p.navs.map((r) => r.date))).toEqual(new Set([20261125]))
    expect(p.schemes.find((s) => s.amfi_code === 120716)).toMatchObject({
      name: 'UTI Nifty 50 Index Fund - Growth Option- Direct',
      isin_growth: 'INF789F01XA0',
      isin_reinvest: null,
      plan: 'Direct Plan',
      option: 'Growth',
      nav: 181.9059,
      category: 'Open Ended Schemes (Other Scheme - Index Funds)',
      amc: 'UTI Mutual Fund',
    })
  })

  it('reads a multi-day report for one AMC, and can keep one scheme only', () => {
    const all = parseAmfiNav(historyUti, TODAY)
    expect(all.navs).toHaveLength(61)
    expect(all.navs[0]).toEqual({ amfi_code: 120716, date: 20260826, nav: 170.4559 })
    expect(all.navs.at(-1)).toEqual({ amfi_code: 120716, date: 20261125, nav: 181.9059 })
    expect(parseAmfiNav(historyUti, TODAY, { onlyCode: 120716 }).navs).toHaveLength(61)
    expect(parseAmfiNav(historyUti, TODAY, { onlyCode: 12071 }).navs).toHaveLength(0)
  })
})

describe('mfapi', () => {
  it('reads the history oldest first', () => {
    const rows = parseMfapi(JSON.parse(mfapiJson), 120716, TODAY)
    expect(rows).toHaveLength(33)
    expect(rows[0]).toEqual({ amfi_code: 120716, date: 20130102, nav: 37.404 })
    expect(rows.at(-1)).toEqual({ amfi_code: 120716, date: 20261125, nav: 181.9059 })
    expect(rows.every((r, i) => i === 0 || r.date > rows[i - 1]!.date)).toBe(true)
  })

  it('an unknown code is an empty list (mfapi answers 200); a malformed body throws', () => {
    expect(parseMfapi({ meta: { scheme_code: 0 }, data: [], status: 'SUCCESS' }, 1, TODAY)).toEqual([])
    expect(() => parseMfapi({ status: 'ERROR' }, 1, TODAY)).toThrow(AmfiFormatError)
    expect(parseMfapi({ data: [{ date: '27-11-2026', nav: '10' }, { date: '25-11-2026', nav: 'N.A.' }, { date: 'x', nav: '1' }] }, 1, TODAY)).toEqual([])
  })
})

describe('dates and values', () => {
  it('converts between AMFI, ISO and YYYYMMDD', () => {
    expect(parseAmfiDate('24-Nov-2026')).toBe(20261124)
    expect(parseAmfiDate('5-Jan-2026')).toBe(20260105)
    expect(parseAmfiDate('29-Feb-2025')).toBeNull()
    expect(parseAmfiDate('29-Feb-2024')).toBe(20240229)
    expect(ymdToIso(20261124)).toBe('2026-11-24')
    expect(ymdToAmfi(20260105)).toBe('05-Jan-2026')
    expect(addDays(20261231, 1)).toBe(20270101)
    expect(addDays(20240301, -1)).toBe(20240229)
    expect(addDays(20261126, -90)).toBe(20260828)
    expect(daysBetween(20260826, 20261125)).toBe(91)
  })

  it("uses India's date: midnight IST is 18:30 UTC", () => {
    expect(istToday(Date.UTC(2026, 10, 25, 18, 29))).toBe(20261125)
    expect(istToday(Date.UTC(2026, 10, 25, 18, 30))).toBe(20261126)
  })

  it('reads NAV values', () => {
    expect(parseNav('181.9059')).toBe(181.9059)
    expect(parseNav(' 1,003.8576 ')).toBe(1003.8576)
    for (const bad of ['N.A.', '', '0', '0.0000', '-5', '1e3', 'abc']) expect(parseNav(bad)).toBeNull()
  })

  it('flags day-on-day moves over ±20% only', () => {
    const rows = [
      { amfi_code: 1, date: 20261101, nav: 100 },
      { amfi_code: 1, date: 20261102, nav: 119 },
      { amfi_code: 1, date: 20261103, nav: 90 },
      { amfi_code: 2, date: 20261101, nav: 10 },
      { amfi_code: 2, date: 20261104, nav: 7.9 },
    ]
    expect(anomalies(rows)).toEqual([
      { amfi_code: 1, date: 20261103, prev_date: 20261102, prev_nav: 119, nav: 90 },
      { amfi_code: 2, date: 20261104, prev_date: 20261101, prev_nav: 10, nav: 7.9 },
    ])
  })

  it('maps AMC lines to the history report ids', () => {
    expect(amcId('UTI Mutual Fund')).toBe(28)
    expect(amcId('  Axis   Mutual Fund ')).toBe(53)
    expect(amcId('IL&FS Mutual Fund (IDF)')).toBeNull()
    expect(amcId(null)).toBeNull()
  })
})
