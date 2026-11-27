// Broker files as a source (plan §21.13, D29, M34): holdings statements and tradebooks through the statement upload,
// with a fake engine (the real parsers are tested in engine/tests/test_broker_holdings.py). Whose file it is, members
// without a PAN, a newer file from the same account, the same file twice, nothing in the clear in D1 or R2, the
// build request, member delete, export, and "Is this the same person?". All values synthetic.
import { env } from 'cloudflare:test'
import { exports } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { blobKeys } from '../src/lib/blob'
import type { EngineParse } from '../src/lib/engine-client'
import { sameName } from '../src/lib/members'
import { runRebuild } from '../src/lib/snapshot'
import { call, type Jar, ORIGIN } from './helpers/auth'
import { fakeBuild, storedStatement, takeRebuilds } from './helpers/snapshot'
import { addMember, count, type Household, newHousehold, r2Keys } from './helpers/tenant'
import { fakeEngine } from './helpers/upload'

vi.setConfig({ testTimeout: 30_000 })
afterEach(() => vi.restoreAllMocks())

const PAN = 'ABCDE1234F'
const ISIN = 'INE000Q02BH5' // distinctive, so the scans below can't match by accident
const HOLDER = 'Gammaq Samplez Person'
const CODE = '99887766QZ'
let nonce = 0
const file = () => new TextEncoder().encode(`Stock Name,ISIN,Quantity,Average buy price\nSYNTH,${ISIN},7,4321.5\n${'#'.repeat(++nonce)}`)

function holdingsParse(opts: { asOf?: string | null; code?: string | null; holder?: string | null; qty?: number; pan?: string | null; rows?: number } = {}): EngineParse {
  const holdings = Array.from({ length: opts.rows ?? 1 }, () => ({ isin: ISIN, name: 'SYNTHQ BH LTD', symbol: null, qty: opts.qty ?? 7, avg_price: 4321.5, close: 4400 }))
  return {
    ok: true,
    kind: 'HOLDINGS',
    source: 'groww',
    pan: opts.pan ?? null,
    version: '0.3.0',
    statement: {
      broker: 'groww',
      broker_name: 'Groww',
      holder_name: opts.holder === undefined ? HOLDER : opts.holder,
      client_code: opts.code === undefined ? CODE : opts.code,
      as_of: opts.asOf === undefined ? '2026-11-20' : opts.asOf,
      holdings,
      counts: { rows: holdings.length, holdings: holdings.length },
    },
  }
}

async function send(jar: Jar, bytes: Uint8Array, fields: Record<string, string> = {}) {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  form.append('file', new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/vnd.ms-excel' }), 'holdings.xlsx')
  const res = await exports.default.fetch(
    new Request(`${ORIGIN}/api/statements`, { method: 'POST', headers: { origin: ORIGIN, 'cf-connecting-ip': '203.0.113.9', cookie: jar.header() }, body: form }),
  )
  return { status: res.status, body: await res.json<Record<string, unknown>>() }
}

const members = async (h: Household) =>
  (await (await call('/api/members', { jar: h.jar })).json<{ members: { id: string; name: string | null; pan_masked: string; no_pan: boolean; same_as: { id: string }[] }[] }>()).members

async function sealedText(h: Household) {
  const parts: string[] = []
  for (const k of await r2Keys(`h/${h.householdId}/`)) parts.push(new TextDecoder('latin1').decode(await (await env.BUCKET.get(k))!.arrayBuffer()))
  const rows = await env.DB.batch([
    env.DB.prepare('SELECT * FROM broker_holding WHERE household_id = ?1').bind(h.householdId),
    env.DB.prepare('SELECT * FROM member WHERE household_id = ?1').bind(h.householdId),
  ])
  parts.push(JSON.stringify(rows.map((r) => r.results), (_k, v) => (v instanceof ArrayBuffer || ArrayBuffer.isView(v) ? new TextDecoder('latin1').decode(v as ArrayBuffer) : v)))
  return parts.join('')
}

describe('POST /api/statements with a broker holdings statement', () => {
  it('asks whose it is, then makes a member without a PAN from the name the user confirms; stores only sealed rows', async () => {
    const h = await newHousehold('bh')
    const calls = fakeEngine(holdingsParse())
    takeRebuilds(h.householdId)
    const bytes = file()
    const ask = await send(h.jar, bytes)
    expect(ask.status).toBe(422)
    expect(ask.body).toMatchObject({ code: 'needs_member', kind: 'HOLDINGS', broker_name: 'Groww', suggested_name: HOLDER })
    expect(await count('SELECT COUNT(*) AS n FROM broker_holding WHERE household_id = ?1', h.householdId)).toBe(0)
    // asking isn't a failed upload
    expect(await count("SELECT COALESCE(SUM(count), 0) AS n FROM quota WHERE subject = ?1 AND metric = 'parse_fail'", `user:${h.userId}`)).toBe(0)

    const res = await send(h.jar, bytes, { new_member_name: HOLDER })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ kind: 'HOLDINGS', replaced: false, member: { name: HOLDER, pan_masked: '', created: true } })
    expect(res.body.holdings).toMatchObject({ broker: 'groww', broker_name: 'Groww', as_of: '2026-11-20', holdings_count: 1 })
    expect(calls.map((c) => c.kind)).toEqual(['BROKER', 'BROKER'])
    expect(calls[0]!.password).toBe('[]') // no member, no PAN to try
    const id = (res.body.holdings as { id: string }).id
    expect(await r2Keys(`h/${h.householdId}/holdings/`)).toEqual([blobKeys.holdings(h.householdId, id)])
    const raw = await sealedText(h)
    for (const secret of [ISIN, HOLDER, CODE, '4321.5']) expect(raw).not.toContain(secret)
    expect(takeRebuilds(h.householdId).length).toBe(1)
    expect(await count("SELECT COUNT(*) AS n FROM audit_event WHERE household_id = ?1 AND event = 'broker_holdings_added'", h.householdId)).toBe(1)

    const [m] = await members(h)
    expect(m).toMatchObject({ name: HOLDER, pan_masked: '', no_pan: true, same_as: [] })
    const list = await (await call('/api/broker-files', { jar: h.jar })).json<{ holdings: unknown[]; tradebooks: unknown[] }>()
    expect(list.holdings).toEqual([expect.objectContaining({ id, member_id: m!.id, broker_name: 'Groww' })])
  })

  it('goes to the member the account, the PAN or the name points at, without asking', async () => {
    const h = await newHousehold('bh-auto')
    const panMember = await addMember(h, PAN, 'SOMEONE ELSE')
    fakeEngine(holdingsParse({ holder: null }))
    const first = await send(h.jar, file(), { member_id: panMember })
    expect(first.status).toBe(201)
    // the same account (client code), newer: replaces the older file, no question
    vi.restoreAllMocks()
    fakeEngine(holdingsParse({ holder: null, asOf: '2026-11-24' }))
    const again = await send(h.jar, file())
    expect(again.status).toBe(201)
    expect(again.body).toMatchObject({ replaced: true, member: { id: panMember, created: false } })
    expect(await count('SELECT COUNT(*) AS n FROM broker_holding WHERE household_id = ?1', h.householdId)).toBe(1)
    expect((await r2Keys(`h/${h.householdId}/holdings/`)).length).toBe(1)
    // an older file from the account is refused
    vi.restoreAllMocks()
    fakeEngine(holdingsParse({ holder: null, asOf: '2026-11-01' }))
    expect((await send(h.jar, file())).body).toMatchObject({ code: 'older_file', as_of: '2026-11-24' })
    // another account: the PAN in the file
    vi.restoreAllMocks()
    fakeEngine(holdingsParse({ code: 'OTHER1', holder: null, pan: PAN }))
    expect((await send(h.jar, file())).body).toMatchObject({ member: { id: panMember } })
    // another account: the holder's name
    vi.restoreAllMocks()
    fakeEngine(holdingsParse({ code: 'OTHER2', holder: 'Someone Else' }))
    expect((await send(h.jar, file())).body).toMatchObject({ member: { id: panMember } })
    expect(await count('SELECT COUNT(*) AS n FROM broker_holding WHERE household_id = ?1', h.householdId)).toBe(3)
  })

  it('tries the members PANs for an encrypted file, says file_locked, and refuses the same file twice and a PAN that differs', async () => {
    const h = await newHousehold('bh-refuse')
    const member = await addMember(h, PAN, null)
    const calls = fakeEngine({ ok: false, code: 'wrong_password' })
    expect((await send(h.jar, file(), { member_id: member })).body).toMatchObject({ code: 'file_locked', typed: false })
    expect(JSON.parse(calls[0]!.password)).toEqual([PAN])
    vi.restoreAllMocks()
    const typed = fakeEngine({ ok: false, code: 'wrong_password' })
    expect((await send(h.jar, file(), { member_id: member, password: 'abcde9999z' })).body).toMatchObject({ code: 'file_locked' })
    expect(JSON.parse(typed[0]!.password)).toEqual(['abcde9999z', PAN])
    vi.restoreAllMocks()
    fakeEngine(holdingsParse())
    const bytes = file()
    expect((await send(h.jar, bytes, { member_id: member })).status).toBe(201)
    expect((await send(h.jar, bytes, { member_id: member })).body).toMatchObject({ code: 'already_added' })
    vi.restoreAllMocks()
    fakeEngine(holdingsParse({ pan: 'ZZZZZ9999Z', code: 'X9' }))
    expect((await send(h.jar, file(), { member_id: member })).body).toMatchObject({ code: 'pan_mismatch' })
    vi.restoreAllMocks()
    fakeEngine({ ok: false, code: 'unrecognised' })
    expect((await send(h.jar, file(), { member_id: member })).body).toMatchObject({ code: 'not_broker_file' })
    vi.restoreAllMocks()
    fakeEngine(holdingsParse({ rows: 0, code: 'X8' }))
    expect((await send(h.jar, file(), { member_id: member })).body).toMatchObject({ code: 'no_holdings' })
    expect(await count('SELECT COUNT(*) AS n FROM broker_holding WHERE household_id = ?1', h.householdId)).toBe(1)
  })

  it("is 404 for another household's member, and a tradebook through the same upload is stored as a tradebook", async () => {
    const a = await newHousehold('bh-a')
    const b = await newHousehold('bh-b')
    const theirs = await addMember(b, PAN, null)
    fakeEngine(holdingsParse())
    expect((await send(a.jar, file(), { member_id: theirs })).status).toBe(404)
    vi.restoreAllMocks()
    const trades = [{ date: '2024-01-10', time: null, symbol: 'SYNTHQ', isin: ISIN, name: null, side: 'buy', qty: 7, price: 10, exchange: 'NSE', id: 'T1', product: null }]
    fakeEngine({ ok: true, kind: 'TRADEBOOK', source: 'zerodha', pan: null, version: '0.3.0',
      statement: { broker: 'zerodha', period_from: '2024-01-10', period_to: '2024-01-10', trades, counts: { trades: 1 } } } as EngineParse)
    const ask = await send(a.jar, file())
    expect(ask.body).toMatchObject({ code: 'needs_member', kind: 'TRADEBOOK', broker_name: 'Zerodha', suggested_name: null })
    const res = await send(a.jar, file(), { new_member_name: 'Delta Example' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ kind: 'TRADEBOOK', tradebook: { broker: 'zerodha', trades_count: 1 }, member: { name: 'Delta Example', created: true } })
    expect(await count('SELECT COUNT(*) AS n FROM tradebook WHERE household_id = ?1', a.householdId)).toBe(1)
    expect(await count('SELECT COUNT(*) AS n FROM member WHERE household_id = ?1 AND no_pan = 1', a.householdId)).toBe(1)
  })
})

describe('build, delete and export', () => {
  it('a household with only a broker file builds, with the holdings and the member sent to /build', async () => {
    const h = await newHousehold('bh-build')
    fakeEngine(holdingsParse())
    const res = await send(h.jar, file(), { new_member_name: HOLDER })
    const memberId = (res.body.member as { id: string }).id
    const builds = fakeBuild()
    expect((await runRebuild(env, { household_id: h.householdId })).outcome).toBe('built')
    const req = builds.at(-1) as unknown as { statements: unknown[]; broker_holdings: Record<string, unknown>[]; members: unknown[] }
    expect(req.statements).toEqual([])
    expect(req.members).toEqual([{ member_id: memberId, name: HOLDER }])
    expect(req.broker_holdings).toEqual([
      expect.objectContaining({ member_id: memberId, broker: 'groww', broker_name: 'Groww', as_of: '2026-11-20', holdings: [expect.objectContaining({ isin: ISIN, qty: 7, avg_price: 4321.5 })] }),
    ])
    expect((await runRebuild(env, { household_id: h.householdId })).outcome).toBe('current')
    const status = await (await call('/api/portfolio/status', { jar: h.jar })).json<{ status: string }>()
    expect(status.status).not.toBe('empty')
  })

  it('deleting the file or the member removes the blob; the export has the holdings statement and a member with no PAN', async () => {
    const h = await newHousehold('bh-del')
    const member = await addMember(h, PAN, null)
    fakeEngine(holdingsParse())
    const one = ((await send(h.jar, file(), { member_id: member })).body.holdings as { id: string }).id
    vi.restoreAllMocks()
    fakeEngine(holdingsParse({ code: 'X2' }))
    const res2 = await send(h.jar, file(), { new_member_name: 'Epsilon Example' })
    const panLess = (res2.body.member as { id: string }).id
    const doc = JSON.parse(await (await call('/api/account/export', { jar: h.jar })).text()) as {
      broker_holdings: { member_id: string; broker: string; data: { holdings: unknown[] } }[]
      members: { id: string; pan: string | null }[]
      statements: unknown[]
      tradebooks: unknown[]
    }
    expect(doc.statements).toEqual([])
    expect(doc.tradebooks).toEqual([])
    expect(doc.broker_holdings.map((b) => b.member_id).sort()).toEqual([member, panLess].sort())
    expect(doc.broker_holdings[0]!.data.holdings.length).toBe(1)
    expect(doc.members.find((m) => m.id === panLess)!.pan).toBeNull()

    expect((await call(`/api/broker-files/${one}`, { jar: h.jar, method: 'DELETE' })).status).toBe(200)
    expect((await call(`/api/broker-files/${one}`, { jar: h.jar, method: 'DELETE' })).status).toBe(404)
    expect((await call(`/api/members/${panLess}`, { jar: h.jar, method: 'DELETE' })).status).toBe(200)
    expect(await r2Keys(`h/${h.householdId}/holdings/`)).toEqual([])
    expect(await count('SELECT COUNT(*) AS n FROM broker_holding WHERE household_id = ?1', h.householdId)).toBe(0)
  })
})

describe('Is this the same person? (D29)', () => {
  it('a PAN member with a matching name is asked about; yes merges the PAN-less member into it, no is remembered', async () => {
    const h = await newHousehold('bh-merge')
    const other = await newHousehold('bh-merge-other')
    fakeEngine(holdingsParse())
    const panLess = ((await send(h.jar, file(), { new_member_name: HOLDER })).body.member as { id: string }).id
    await call('/api/stocks/cost', { jar: h.jar, method: 'PUT', body: { member_id: panLess, isin: ISIN, avg_price: 12 } })
    // a CDSL statement arrives later for a new PAN with the holder's name in capitals
    const withPan = await addMember(h, PAN, 'GAMMAQ SAMPLEZ PERSON')
    await storedStatement(h, withPan, { isins: [ISIN] })
    const list = await members(h)
    expect(list.find((m) => m.id === withPan)!.same_as).toEqual([{ id: panLess, name: HOLDER }])

    // only a PAN-less member merges, only into a PAN member, only in this household
    expect((await call(`/api/members/${withPan}/merge`, { jar: h.jar, method: 'POST', body: { into: panLess } })).status).toBe(422)
    expect((await call(`/api/members/${panLess}/merge`, { jar: other.jar, method: 'POST', body: { into: withPan } })).status).toBe(404)
    expect((await call(`/api/members/${panLess}/merge`, { jar: h.jar, method: 'POST', body: { into: withPan } })).status).toBe(200)
    expect((await members(h)).map((m) => m.id)).toEqual([withPan])
    expect(await count('SELECT COUNT(*) AS n FROM broker_holding WHERE member_id = ?1', withPan)).toBe(1)
    const costs = await (await call('/api/tradebooks', { jar: h.jar })).json<{ costs: { member_id: string; isin: string }[] }>()
    expect(costs.costs).toEqual([expect.objectContaining({ member_id: withPan, isin: ISIN })])
    expect(await count("SELECT COUNT(*) AS n FROM audit_event WHERE household_id = ?1 AND event = 'members_merged'", h.householdId)).toBe(1)

    // no: never asked again for the pair
    vi.restoreAllMocks()
    fakeEngine(holdingsParse({ code: 'X3' }))
    const second = ((await send(h.jar, file(), { new_member_name: 'Gammaq Person Samplez' })).body.member as { id: string }).id
    expect((await members(h)).find((m) => m.id === withPan)!.same_as).toEqual([{ id: second, name: 'Gammaq Person Samplez' }])
    expect((await call(`/api/members/${second}/keep-separate`, { jar: h.jar, method: 'POST', body: { other: withPan } })).status).toBe(200)
    expect((await members(h)).find((m) => m.id === withPan)!.same_as).toEqual([])
  })

  it('sameName: same words in any order, or all of the shorter name with two or more words; titles and initials ignored', () => {
    expect(sameName('ASHA K RAO', 'Rao Asha')).toBe(true)
    expect(sameName('Mrs. Asha Rao', 'asha devi rao')).toBe(true)
    expect(sameName('Asha', 'Asha Rao')).toBe(false)
    expect(sameName('Asha Rao', 'Asha Iyer')).toBe(false)
    expect(sameName(null, 'Asha Rao')).toBe(false)
  })
})

