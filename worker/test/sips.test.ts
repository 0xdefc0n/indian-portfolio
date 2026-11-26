// SIP run days and the user's SIP changes (M12, owner request 2026-11-26): the exchange-holiday job (Upstox's public
// list, saved byte for byte as a fixture: public market data), and POST/DELETE /api/sips/skip, POST /api/sips/cancel
// with what reaches the engine. All household data synthetic.
import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HOLIDAY_REFRESH_MS, HolidayFormatError, holidayDates, parseUpstoxHolidays, refreshHolidays } from '../src/market/holidays'
import { requestRebuild } from '../src/lib/snapshot'
import { call } from './helpers/auth'
import { FAKE_PAN } from './helpers/pdf-fixture'
import { type BuildBody, deliverRebuilds, fakeBuild, setMarketDay, storedStatement, takeRebuilds } from './helpers/snapshot'
import { addMember, newHousehold } from './helpers/tenant'
import upstoxRaw from './fixtures/holidays/upstox-2026.json?raw'

vi.setConfig({ testTimeout: 30_000 })
afterEach(() => vi.restoreAllMocks())

const upstox = JSON.parse(upstoxRaw) as { status: string; data: Array<Record<string, unknown>> }
const answer = (body: unknown, status = 200) =>
  vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))

describe('exchange holidays (Upstox, weekly)', () => {
  beforeEach(async () => {
    await env.MARKET.exec('DELETE FROM market_holiday; DELETE FROM holiday_run;')
  })

  it('parses the NSE trading holidays from the real 2026 answer', () => {
    const h = parseUpstoxHolidays(upstox)
    expect(h).toHaveLength(16)
    const dates = h.map((x) => x.date)
    expect(dates).toContain(20261124) // Guru Nanak Jayanti
    expect(dates).toContain(20261225)
    expect(dates).toContain(20260331) // closed although NAVs are published (year end)
    expect(dates).not.toContain(20260201) // Budget Day: a special session, not a closure
    expect(() => parseUpstoxHolidays({ status: 'error' })).toThrow(HolidayFormatError)
    expect(() => parseUpstoxHolidays({ status: 'success', data: [{ holiday_type: 'TRADING_HOLIDAY', closed_exchanges: ['NSE'], date: '25/12/2026' }] })).toThrow(HolidayFormatError)
    expect(() => parseUpstoxHolidays({ status: 'success', data: [] })).toThrow(HolidayFormatError)
  })

  it('stores them, then fetches at most weekly', async () => {
    const now = Date.parse('2026-11-26T04:00:00Z')
    const fetcher = answer(upstox)
    expect(await refreshHolidays(env, { now, fetcher })).toEqual({ ran: true, rows: 16 })
    expect(await holidayDates(env, 20261101)).toEqual(['2026-11-10', '2026-11-24', '2026-12-25'])
    expect(await refreshHolidays(env, { now: now + 86_400_000, fetcher })).toEqual({ ran: false })
    expect(fetcher).toHaveBeenCalledTimes(1)
    await refreshHolidays(env, { now: now + HOLIDAY_REFRESH_MS + 1, fetcher })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('a failed fetch keeps the stored dates and tries again the next day; a dropped holiday goes', async () => {
    const now = Date.parse('2026-11-26T04:00:00Z')
    await refreshHolidays(env, { now, fetcher: answer(upstox) })
    const later = now + HOLIDAY_REFRESH_MS + 1
    expect((await refreshHolidays(env, { now: later, fetcher: answer({ status: 'error' }) })).error).toBe('format_shape')
    expect((await refreshHolidays(env, { now: later, fetcher: answer({}, 503) })).error).toBe('format_status_503')
    expect(await holidayDates(env, 20260101)).toHaveLength(16) // kept
    // the next run fetches again (a failure isn't fresh); this time 25 Dec was dropped by the exchange
    const fewer = { ...upstox, data: upstox.data.filter((d) => d.date !== '2026-12-25') }
    expect(await refreshHolidays(env, { now: later + 86_400_000, fetcher: answer(fewer) })).toEqual({ ran: true, rows: 15 })
    expect(await holidayDates(env, 20261201)).toEqual([])
  })
})

// ─── Skip / cancel ──────────────────────────────────────────────────────────────────────────────────────────────

const SIP = { isin: 'INF000S01FC1', folio: 'F-1001' }

async function household(tag: string) {
  const h = await newHousehold(tag)
  const member = await addMember(h, FAKE_PAN, 'SYNTHETIC HOLDER')
  await storedStatement(h, member, { kind: 'KFINTECH' })
  return { h, member }
}
const post = (h: { jar: unknown }, path: string, body: unknown, method = 'POST') => call(path, { jar: h.jar as never, method, body })
const rows = (hid: string) => env.DB.prepare('SELECT kind, due, sip_enc FROM sip_override WHERE household_id = ?1 ORDER BY kind, due').bind(hid).all<{ kind: string; due: string; sip_enc: ArrayBuffer }>()
const istToday = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10)
const inDays = (n: number) => new Date(Date.parse(`${istToday()}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

describe('POST /api/sips/skip, DELETE /api/sips/skip, POST /api/sips/cancel', () => {
  beforeEach(async () => {
    await setMarketDay(20261125)
    takeRebuilds()
  })

  it('skip the next instalment: stored sealed, one at a time, undoable, and it rebuilds', async () => {
    const { h, member } = await household('sip-skip')
    const due = inDays(20)
    const res = await post(h, '/api/sips/skip', { member_id: member, ...SIP, due })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, skipped: due })
    expect(takeRebuilds(h.householdId)).toHaveLength(1)

    const stored = (await rows(h.householdId)).results
    expect(stored.map((r) => [r.kind, r.due])).toEqual([['skip', due]])
    expect(new TextDecoder('latin1').decode(new Uint8Array(stored[0]!.sip_enc))).not.toContain(SIP.isin) // sealed

    // a new skip of the same SIP replaces it ("the next one only")
    const next = inDays(50)
    await post(h, '/api/sips/skip', { member_id: member, ...SIP, due: next })
    expect((await rows(h.householdId)).results.map((r) => r.due)).toEqual([next])
    // another SIP keeps its own
    await post(h, '/api/sips/skip', { member_id: member, isin: 'INF000S02LQ2', folio: null, due })
    expect((await rows(h.householdId)).results).toHaveLength(2)

    const undo = await post(h, '/api/sips/skip', { member_id: member, ...SIP }, 'DELETE')
    expect(await undo.json()).toEqual({ ok: true, removed: 1 })
    expect((await rows(h.householdId)).results.map((r) => r.due)).toEqual([due])
  })

  it('refuses a past or far-off date, a bad fund id, and another household\'s member', async () => {
    const { h, member } = await household('sip-bad')
    expect((await post(h, '/api/sips/skip', { member_id: member, ...SIP, due: inDays(-1) })).status).toBe(400)
    expect((await post(h, '/api/sips/skip', { member_id: member, ...SIP, due: inDays(120) })).status).toBe(400)
    expect((await post(h, '/api/sips/skip', { member_id: member, ...SIP, due: 'soon' })).status).toBe(400)
    expect((await post(h, '/api/sips/skip', { member_id: member, isin: 'INE000000001', folio: 'x', due: inDays(3) })).status).toBe(400)
    const other = await household('sip-other')
    expect((await post(h, '/api/sips/skip', { member_id: other.member, ...SIP, due: inDays(3) })).status).toBe(404)
    expect((await post(h, '/api/sips/cancel', { member_id: other.member, ...SIP, confirm: true })).status).toBe(404)
    expect((await call('/api/sips/cancel', { method: 'POST' })).status).toBe(401)
    expect((await rows(h.householdId)).results).toHaveLength(0)
  })

  it('cancel needs confirm, is final, clears skips, and blocks new ones', async () => {
    const { h, member } = await household('sip-cancel')
    await post(h, '/api/sips/skip', { member_id: member, ...SIP, due: inDays(10) })
    expect((await post(h, '/api/sips/cancel', { member_id: member, ...SIP })).status).toBe(400) // no confirm
    const res = await post(h, '/api/sips/cancel', { member_id: member, ...SIP, confirm: true })
    expect(await res.json()).toEqual({ ok: true, cancelled_on: istToday() })
    expect((await rows(h.householdId)).results.map((r) => r.kind)).toEqual(['cancel'])
    // again: same answer, nothing new
    expect(await (await post(h, '/api/sips/cancel', { member_id: member, ...SIP, confirm: true })).json()).toEqual({ ok: true, cancelled_on: istToday() })
    expect((await post(h, '/api/sips/skip', { member_id: member, ...SIP, due: inDays(10) })).status).toBe(409)
    const audit = await env.DB.prepare(`SELECT event FROM audit_event WHERE household_id = ?1 AND event LIKE 'sip_%' ORDER BY id`).bind(h.householdId).all<{ event: string }>()
    expect(audit.results.map((r) => r.event)).toEqual(['sip_skipped', 'sip_cancelled'])
  })

  it('the build gets the overrides (unsealed) and the holidays; a change makes a new build', async () => {
    const { h, member } = await household('sip-build')
    await env.MARKET.exec('DELETE FROM market_holiday; DELETE FROM holiday_run;')
    await refreshHolidays(env, { now: Date.now(), fetcher: answer(upstox), force: true })
    const builds = fakeBuild()
    await requestRebuild(env, h.householdId)
    expect((await deliverRebuilds(takeRebuilds(h.householdId)))[0]?.outcome).toBe('built')
    const first = builds[0] as BuildBody & { overrides: unknown[]; market: { holidays: string[] } }
    expect(first.overrides).toEqual([])
    expect(first.market.holidays).toContain('2026-11-24')

    const due = inDays(15)
    await post(h, '/api/sips/skip', { member_id: member, ...SIP, due })
    expect((await deliverRebuilds(takeRebuilds(h.householdId)))[0]?.outcome).toBe('built') // not "current"
    const second = builds[1] as BuildBody & { overrides: unknown[] }
    expect(second.overrides).toEqual([{ member_id: member, isin: SIP.isin, folio: SIP.folio, kind: 'skip', due }])
  })

  it('deleting the member deletes its overrides', async () => {
    const { h, member } = await household('sip-member')
    await post(h, '/api/sips/cancel', { member_id: member, ...SIP, confirm: true })
    expect((await call(`/api/members/${member}`, { jar: h.jar, method: 'DELETE' })).status).toBe(200)
    expect((await rows(h.householdId)).results).toHaveLength(0)
  })
})
