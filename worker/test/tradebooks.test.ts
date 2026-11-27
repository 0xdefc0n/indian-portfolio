// Broker tradebooks and manual buy prices (plan §21.6, M21): upload with a fake engine (the real parsers are tested
// in engine/tests/test_tradebook.py), refusals, the tenant guard, nothing in the clear in D1 or R2, the member
// cascade, the build request and its inputs hash, and the export. All values synthetic.
import { env } from 'cloudflare:test'
import { exports } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { blobKeys } from '../src/lib/blob'
import type { EngineParse, ParseRequest } from '../src/lib/engine-client'
import { looksLikeTradebook } from '../src/lib/tradebooks'
import { runRebuild } from '../src/lib/snapshot'
import { call, type Jar, ORIGIN } from './helpers/auth'
import { fakeBuild, storedStatement, takeRebuilds } from './helpers/snapshot'
import { addMember, count, type Household, newHousehold, r2Keys } from './helpers/tenant'
import { busyEngine, fakeEngine } from './helpers/upload'

vi.setConfig({ testTimeout: 30_000 })
afterEach(() => vi.restoreAllMocks())

const PAN = 'ABCDE1234F'
const SYMBOL = 'SYNTHQX' // distinctive, so the scans below can't match by accident
const ISIN = 'INE000Q01QX7'
let nonce = 0
const csv = () => new TextEncoder().encode(`symbol,isin,trade_date,trade_type,quantity,price\n${SYMBOL},${ISIN},2024-01-0${1 + (nonce++ % 9)},buy,7,4321.5\n${'#'.repeat(nonce)}`)

function tradebookParse(opts: { pan?: string | null; trades?: number; broker?: string } = {}): EngineParse {
  const trades = Array.from({ length: opts.trades ?? 2 }, (_, i) => ({
    date: `2024-01-1${i}`, time: null, symbol: SYMBOL, isin: ISIN, name: null, side: 'buy', qty: 7, price: 4321.5, exchange: 'NSE', id: `T${i}`, product: null,
  }))
  return {
    ok: true,
    kind: 'TRADEBOOK',
    source: opts.broker ?? 'zerodha',
    pan: opts.pan ?? null,
    version: '0.2.0',
    statement: { broker: opts.broker ?? 'zerodha', period_from: '2024-01-10', period_to: '2024-01-11', trades, counts: { rows: 2, trades: trades.length } },
  }
}

async function send(jar: Jar, file: Uint8Array, memberId: string | null) {
  const form = new FormData()
  if (memberId) form.append('member_id', memberId)
  form.append('file', new Blob([file as Uint8Array<ArrayBuffer>], { type: 'text/csv' }), 'tradebook.csv')
  const res = await exports.default.fetch(
    new Request(`${ORIGIN}/api/tradebooks`, { method: 'POST', headers: { origin: ORIGIN, 'cf-connecting-ip': '203.0.113.9', cookie: jar.header() }, body: form }),
  )
  return { status: res.status, body: await res.json<Record<string, unknown>>() }
}

async function rawR2(prefix: string) {
  const out: string[] = []
  for (const k of await r2Keys(prefix)) out.push(new TextDecoder('latin1').decode(await (await env.BUCKET.get(k))!.arrayBuffer()))
  return out.join('')
}

async function d1Text(householdId: string) {
  const rows = await env.DB.batch([
    env.DB.prepare('SELECT * FROM tradebook WHERE household_id = ?1').bind(householdId),
    env.DB.prepare('SELECT * FROM stock_cost WHERE household_id = ?1').bind(householdId),
  ])
  return JSON.stringify(rows.map((r) => r.results), (_k, v) => (v instanceof ArrayBuffer || ArrayBuffer.isView(v) ? new TextDecoder('latin1').decode(v as ArrayBuffer) : v))
}

describe('POST /api/tradebooks', () => {
  it('parses with the member PAN as the password, stores only sealed trades, and asks for a rebuild', async () => {
    const h = await newHousehold('tb')
    const member = await addMember(h, PAN, 'SYNTHETIC HOLDER')
    const calls = fakeEngine(tradebookParse())
    takeRebuilds(h.householdId)
    const res = await send(h.jar, csv(), member)
    expect(res.status).toBe(201)
    expect(res.body.tradebook).toMatchObject({ broker: 'zerodha', broker_name: 'Zerodha', trades_count: 2, period_from: '2024-01-10', period_to: '2024-01-11' })
    expect(calls).toEqual([expect.objectContaining({ kind: 'TRADEBOOK', password: PAN } satisfies Partial<ParseRequest>)])
    const id = (res.body.tradebook as { id: string }).id
    expect(await r2Keys(`h/${h.householdId}/tradebooks/`)).toEqual([blobKeys.tradebook(h.householdId, id)])
    const raw = await rawR2(`h/${h.householdId}/tradebooks/`)
    expect(raw).not.toContain(SYMBOL)
    expect(raw).not.toContain(ISIN)
    expect(await d1Text(h.householdId)).not.toContain(SYMBOL)
    expect(takeRebuilds(h.householdId).length).toBe(1)
    expect(await count("SELECT COUNT(*) AS n FROM audit_event WHERE household_id = ?1 AND event = 'tradebook_added'", h.householdId)).toBe(1)

    const list = await (await call('/api/tradebooks', { jar: h.jar })).json<{ tradebooks: { id: string; member_id: string }[] }>()
    expect(list.tradebooks).toEqual([expect.objectContaining({ id, member_id: member, broker_name: 'Zerodha' })])
  })

  it('refuses the same file twice, a PDF, an unknown layout, a PAN that differs, and an empty tradebook', async () => {
    const h = await newHousehold('tb-refuse')
    const member = await addMember(h, PAN, null)
    const file = csv()
    fakeEngine(tradebookParse())
    expect((await send(h.jar, file, member)).status).toBe(201)
    expect((await send(h.jar, file, member)).body.code).toBe('already_added')
    expect((await send(h.jar, new TextEncoder().encode('%PDF-1.7 synthetic'), member)).body.code).toBe('not_tradebook')
    vi.restoreAllMocks()
    fakeEngine({ ok: false, code: 'unrecognised' })
    expect((await send(h.jar, csv(), member)).body.code).toBe('not_tradebook')
    vi.restoreAllMocks()
    fakeEngine({ ok: false, code: 'wrong_password' })
    expect((await send(h.jar, csv(), member)).body.code).toBe('tradebook_locked')
    vi.restoreAllMocks()
    fakeEngine(tradebookParse({ pan: 'ZZZZZ9999Z' }))
    expect((await send(h.jar, csv(), member)).body.code).toBe('pan_mismatch')
    vi.restoreAllMocks()
    fakeEngine(tradebookParse({ trades: 0 }))
    expect((await send(h.jar, csv(), member)).body.code).toBe('no_trades')
    expect(await count('SELECT COUNT(*) AS n FROM tradebook WHERE household_id = ?1', h.householdId)).toBe(1)
    // the engine's refusals count towards the hourly limit, like failed statements (a PDF is refused before it)
    expect(await count("SELECT SUM(count) AS n FROM quota WHERE subject = ?1 AND metric = 'parse_fail'", `user:${h.userId}`)).toBe(4)
  })

  it("is 404 for another household's member and for no member; 503 engine_busy when no slot is free", async () => {
    const a = await newHousehold('tb-a')
    const b = await newHousehold('tb-b')
    const theirs = await addMember(b, PAN, null)
    const mine = await addMember(a, 'FGHIJ5678K', null)
    fakeEngine(tradebookParse())
    expect((await send(a.jar, csv(), theirs)).status).toBe(404)
    expect((await send(a.jar, csv(), null)).status).toBe(404)
    busyEngine({ eta_s: 12 })
    const busy = await send(a.jar, csv(), mine)
    expect(busy.status).toBe(503)
    expect(busy.body).toMatchObject({ code: 'engine_busy', retry_after: 12 })
    expect(await count('SELECT COUNT(*) AS n FROM tradebook WHERE household_id = ?1', a.householdId)).toBe(0)
    expect(await r2Keys(`h/${a.householdId}/tradebooks/`)).toEqual([])
  })

  it('delete removes the row and the blob; deleting the member removes its tradebooks too', async () => {
    const h = await newHousehold('tb-del')
    const other = await newHousehold('tb-del-other')
    const member = await addMember(h, PAN, null)
    fakeEngine(tradebookParse())
    const one = ((await send(h.jar, csv(), member)).body.tradebook as { id: string }).id
    const two = ((await send(h.jar, csv(), member)).body.tradebook as { id: string }).id
    expect((await call(`/api/tradebooks/${one}`, { jar: other.jar, method: 'DELETE' })).status).toBe(404)
    expect((await call(`/api/tradebooks/${one}`, { jar: h.jar, method: 'DELETE' })).status).toBe(200)
    expect(await r2Keys(`h/${h.householdId}/tradebooks/`)).toEqual([blobKeys.tradebook(h.householdId, two)])
    expect((await call(`/api/members/${member}`, { jar: h.jar, method: 'DELETE' })).status).toBe(200)
    expect(await r2Keys(`h/${h.householdId}/tradebooks/`)).toEqual([])
    expect(await count('SELECT COUNT(*) AS n FROM tradebook WHERE household_id = ?1', h.householdId)).toBe(0)
  })

  it('looksLikeTradebook: CSV, XLSX and encrypted Excel yes; PDF and binary no', () => {
    expect(looksLikeTradebook(new TextEncoder().encode('a,b,c\n1,2,3'))).toBe(true)
    expect(looksLikeTradebook(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 0, 0]))).toBe(true)
    expect(looksLikeTradebook(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toBe(true)
    expect(looksLikeTradebook(new TextEncoder().encode('%PDF-1.7 ......'))).toBe(false)
    expect(looksLikeTradebook(new Uint8Array([1, 2, 0, 4, 5, 6, 7, 8, 9]))).toBe(false)
  })
})

describe('/api/stocks/cost', () => {
  const put = (h: Household, body: unknown) => call('/api/stocks/cost', { jar: h.jar, method: 'PUT', body })

  it('sets, replaces, lists and deletes a manual price, sealed, behind the tenant guard', async () => {
    const h = await newHousehold('cost')
    const other = await newHousehold('cost-other')
    const member = await addMember(h, PAN, null)
    takeRebuilds(h.householdId)
    let res = await put(h, { member_id: member, isin: ISIN.toLowerCase(), avg_price: 1234.56789, since: '2021-03' })
    expect(res.status).toBe(200)
    expect((await res.json<{ cost: unknown }>()).cost).toEqual({ member_id: member, isin: ISIN, avg_price: 1234.5679, since: '2021-03' })
    res = await put(h, { member_id: member, isin: ISIN, avg_price: 987.65 })
    expect(res.status).toBe(200)
    expect(await count('SELECT COUNT(*) AS n FROM stock_cost WHERE household_id = ?1', h.householdId)).toBe(1)
    expect(takeRebuilds(h.householdId).length).toBe(2)
    const text = await d1Text(h.householdId)
    expect(text).not.toContain(ISIN)
    expect(text).not.toContain('987.65')
    const list = await (await call('/api/tradebooks', { jar: h.jar })).json<{ costs: unknown[] }>()
    expect(list.costs).toEqual([{ member_id: member, isin: ISIN, avg_price: 987.65, since: null }])

    expect((await put(other, { member_id: member, isin: ISIN, avg_price: 1 })).status).toBe(404)
    expect((await put(h, { member_id: member, isin: 'NOTANISIN', avg_price: 1 })).status).toBe(400)
    expect((await put(h, { member_id: member, isin: ISIN, avg_price: 0 })).status).toBe(400)
    expect((await put(h, { member_id: member, isin: ISIN, avg_price: 5, since: '2099-01' })).status).toBe(400)
    expect((await call('/api/stocks/cost', { jar: other.jar, method: 'DELETE', body: { member_id: member, isin: ISIN } })).status).toBe(404)
    expect((await call('/api/stocks/cost', { jar: h.jar, method: 'DELETE', body: { member_id: member, isin: ISIN } })).status).toBe(200)
    expect((await call('/api/stocks/cost', { jar: h.jar, method: 'DELETE', body: { member_id: member, isin: ISIN } })).status).toBe(404)
  })
})

describe('build and export', () => {
  it('sends trades, manual prices and corporate actions to /build, and a change rebuilds', async () => {
    const h = await newHousehold('tb-build')
    const member = await addMember(h, PAN, null)
    await storedStatement(h, member, { isins: [ISIN] })
    await env.MARKET.batch([
      env.MARKET.prepare("INSERT OR REPLACE INTO nse_symbol (symbol, isin, name, seen_at) VALUES (?1, ?2, 'Synthetic QX Limited', 1)").bind(SYMBOL, ISIN),
      env.MARKET.prepare("INSERT OR REPLACE INTO corp_action (symbol, ex_date, kind, subject, isin, num, den, amount) VALUES (?1, '2026-11-10', 'split', 'Face Value Split', ?2, 5, 1, NULL)").bind(SYMBOL, ISIN),
      env.MARKET.prepare("INSERT OR REPLACE INTO stock_fmv_2018 (isin, high) VALUES (?1, 321.5)").bind(ISIN),
    ])
    const builds = fakeBuild()
    expect((await runRebuild(env, { household_id: h.householdId })).outcome).toBe('built')
    fakeEngine(tradebookParse())
    expect((await send(h.jar, csv(), member)).status).toBe(201)
    expect((await call('/api/stocks/cost', { jar: h.jar, method: 'PUT', body: { member_id: member, isin: ISIN, avg_price: 100 } })).status).toBe(200)
    expect((await runRebuild(env, { household_id: h.householdId })).outcome).toBe('built') // new inputs: not 'current'
    const req = builds.at(-1) as unknown as { trades: { member_id: string; trades: unknown[] }[]; stock_costs: unknown[]; market: Record<string, unknown> }
    expect(req.trades).toEqual([{ member_id: member, broker: 'zerodha', trades: expect.arrayContaining([expect.objectContaining({ symbol: SYMBOL })]) }])
    expect(req.stock_costs).toEqual([{ member_id: member, isin: ISIN, avg_price: 100, since: null }])
    expect(req.market.symbols).toEqual([{ symbol: SYMBOL, isin: ISIN, name: 'Synthetic QX Limited' }])
    expect(req.market.corp_actions).toEqual([expect.objectContaining({ symbol: SYMBOL, kind: 'split', num: 5, den: 1 })])
    expect(req.market.fmv_2018).toEqual({ [ISIN]: 321.5 })
    expect((await runRebuild(env, { household_id: h.householdId })).outcome).toBe('current')
  })

  it('the export has the tradebooks (parsed trades) and the manual prices', async () => {
    const h = await newHousehold('tb-export')
    const member = await addMember(h, PAN, null)
    fakeEngine(tradebookParse())
    expect((await send(h.jar, csv(), member)).status).toBe(201)
    await call('/api/stocks/cost', { jar: h.jar, method: 'PUT', body: { member_id: member, isin: ISIN, avg_price: 55.5, since: '2020-01' } })
    const doc = JSON.parse(await (await call('/api/account/export', { jar: h.jar })).text()) as {
      tradebooks: { broker: string; trades_count: number; data: { trades: unknown[] } }[]
      stock_buy_prices: unknown[]
      statements: unknown[]
    }
    expect(doc.statements).toEqual([])
    expect(doc.tradebooks).toEqual([expect.objectContaining({ broker: 'zerodha', trades_count: 2 })])
    expect(doc.tradebooks[0]!.data.trades.length).toBe(2)
    expect(doc.stock_buy_prices).toEqual([expect.objectContaining({ member_id: member, isin: ISIN, average_price: 55.5, since: '2020-01' })])
  })
})
