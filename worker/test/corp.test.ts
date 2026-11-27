// Corporate actions and NSE symbols (plan §21.6, M21): the subject parser on saved NSE rows (public data, committed
// byte for byte), the jobs (a re-run writes 0, the version moves only on a change, the backfill is asked once), and
// the build lookup (an old ISIN reaches its symbol's actions).
import corpJson from './fixtures/nse/corporate-actions.json?raw'
import symbolsCsv from './fixtures/nse/EQUITY_L-head.csv?raw'
import { env } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { corpFor, corpUrl, corpVersion, nseDate, parseCorpActions, parseSubject, parseSymbols, requestCorp, runCorp, runSymbols, type CorpMessage } from '../src/market/corp'

afterEach(() => vi.restoreAllMocks())

describe('NSE subjects', () => {
  it('reads every kind in the saved rows', () => {
    const rows = parseCorpActions(JSON.parse(corpJson))
    const by = (s: string) => rows.filter((r) => r.subject.toLowerCase().includes(s.toLowerCase()))
    expect(rows.length).toBe(12) // 11 rows, one with two actions
    expect(by('Bonus 1:4')[0]).toMatchObject({ kind: 'bonus', num: 1, den: 4, ex_date: '2017-01-10' })
    expect(by('Interim Dividend Rs 1.70')[0]).toMatchObject({ kind: 'dividend', amount: 1.7 })
    expect(by('Face Value Split From Rs 10/- Per Share To Rs 2/-')[0]).toMatchObject({ kind: 'split', num: 10, den: 2 })
    expect(by('To Re 1/-')[0]).toMatchObject({ kind: 'split', num: 10, den: 1 })
    const both = rows.filter((r) => r.ex_date === '2017-02-14')
    expect(both.map((r) => [r.kind, r.num, r.den, r.amount])).toEqual([['bonus', 1, 1, null], ['dividend', null, null, 2]])
    expect(by('Amalgamation')[0]!.kind).toBe('merger')
    expect(by('Demerger')[0]!.kind).toBe('demerger')
    expect(by('Debenture')[0]!.kind).toBe('other') // bonus debentures aren't equity units
    expect(rows.every((r) => r.symbol && /^IN[A-Z0-9]{10}$/.test(r.isin ?? ''))).toBe(true)
  })

  it('tolerates spacing and spelling, and never guesses', () => {
    expect(parseSubject('Bonus 3 : 2')[0]).toMatchObject({ kind: 'bonus', num: 3, den: 2 })
    expect(parseSubject('Face Value Split (Sub-Division) - From RsN/- Per Share')[0]!.kind).toBe('other')
    expect(parseSubject('Face Value Split (Sub-Division) - From Rs5/- Per Share To Re 1/- Per Share')[0]).toMatchObject({ kind: 'split', num: 5, den: 1 })
    expect(parseSubject('Final Dividend - Rs 1,250 Per Share')[0]).toMatchObject({ kind: 'dividend', amount: 1250 })
    expect(parseSubject('Annual General Meeting')[0]!.kind).toBe('other')
    expect(parseSubject('Rights 1:5 @ Premium Rs 90/-')[0]!.kind).toBe('other') // rights issues aren't applied
    expect(nseDate('01-Oct-2026')).toBe('2026-10-01')
    expect(nseDate('-')).toBeNull()
    expect(corpUrl('2026-10-01', '2026-11-27')).toContain('from_date=01-10-2026&to_date=27-11-2026')
  })

  it('reads the symbol list by header', () => {
    const rows = parseSymbols(symbolsCsv)
    expect(rows.length).toBe(11)
    expect(rows[0]).toEqual({ symbol: '20MICRONS', isin: 'INE144J01027', name: '20 Microns Limited' })
  })
})

function answer(body: string, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(body, { status }))
}

describe('corp jobs', () => {
  it('stores actions once, bumps the version only on a change, and serves them by symbol for an old ISIN', async () => {
    const fetch = answer(corpJson)
    const v0 = await corpVersion(env)
    const first = await runCorp(env, '2017-01-01', '2019-12-31')
    expect(first).toEqual({ rows: 12, changed: 12 })
    expect(String(fetch.mock.calls[0]![0])).toContain('nseindia.com/api/corporates-corporateActions')
    expect((fetch.mock.calls[0]![1] as RequestInit).headers).toMatchObject({ 'user-agent': 'market-data/1.0' })
    expect(await corpVersion(env)).toBe(v0 + 1)
    expect((await runCorp(env, '2017-01-01', '2019-12-31')).changed).toBe(0) // a re-run writes 0
    expect(await corpVersion(env)).toBe(v0 + 1)

    // a split gave the share a new ISIN: the symbol list has the new one, the action row the old one
    const row = parseCorpActions(JSON.parse(corpJson)).find((r) => r.kind === 'split')!
    await env.MARKET.prepare('INSERT OR REPLACE INTO nse_symbol (symbol, isin, name, seen_at) VALUES (?1, ?2, ?3, 1)').bind(row.symbol, 'INE999Z01019', 'Synthetic Co').run()
    const got = await corpFor(env, [row.isin!], [])
    expect(got.symbols).toEqual([{ symbol: row.symbol, isin: 'INE999Z01019', name: 'Synthetic Co' }])
    expect(got.corp_actions.some((a) => a.kind === 'split' && a.symbol === row.symbol)).toBe(true)
    expect(got.corp_actions.every((a) => a.kind !== 'other')).toBe(true)
    expect((await corpFor(env, ['INE999Z01019'], [])).corp_actions.length).toBeGreaterThan(0) // by the current ISIN too
  })

  it('refreshes the symbol list, and refuses a broken one', async () => {
    answer(symbolsCsv)
    await expect(runSymbols(env)).rejects.toThrow('too_few') // 11 rows: too few to be the real list
    const many = [symbolsCsv.split('\n')[0], ...Array.from({ length: 150 }, (_, i) => `SYN${i},Synthetic ${i} Limited,EQ,01-JAN-2020,10,1,INE${String(i).padStart(3, '0')}S01010,10`)].join('\n')
    vi.restoreAllMocks()
    answer(many)
    expect(await runSymbols(env, 1_000)).toEqual({ rows: 150, changed: 150 })
    expect((await runSymbols(env, 2_000)).changed).toBe(0)
  })

  it('asks for the backfill once, and the symbols weekly', async () => {
    await env.MARKET.prepare('UPDATE corp_state SET backfill_asked_at = NULL, symbols_at = NULL WHERE id = 1').run()
    const sent: CorpMessage[] = []
    const now = Date.parse('2026-11-27T02:00:00Z')
    await requestCorp(env, now, async (m) => void sent.push(...m))
    expect(sent[0]).toEqual({ type: 'symbols' })
    expect(sent[1]).toEqual({ type: 'corp', from: '2026-10-28', to: '2026-11-27' })
    const years = sent.filter((m) => m.type === 'corp').slice(1)
    expect(years[0]).toEqual({ type: 'corp', from: '2010-01-01', to: '2010-12-31' })
    expect(years.at(-1)).toEqual({ type: 'corp', from: '2026-01-01', to: '2026-11-27' })
    expect(years.length).toBe(17)
    await env.MARKET.prepare('UPDATE corp_state SET symbols_at = ?1 WHERE id = 1').bind(now).run()
    sent.length = 0
    await requestCorp(env, now + 86_400_000, async (m) => void sent.push(...m))
    expect(sent).toEqual([{ type: 'corp', from: '2026-10-29', to: '2026-11-28' }])
  })
})
