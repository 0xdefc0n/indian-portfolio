// /api/assets (plan §21.12, M19): create, list, edit and delete FD/PPF/EPF; the tenant guard (another household gets
// 404); no plaintext amounts, rates or dates in D1; limits; the member cascade; export and account deletion.
// All values synthetic.
import { env } from 'cloudflare:test'
import { describe, expect, it, vi } from 'vitest'
import { assetFieldKey } from '../src/lib/assets'
import { SealError } from '../src/lib/crypto'
import { LIMITS } from '../src/lib/limits'
import { todayIst } from '../src/lib/manual-assets'
import { quotaWindow } from '../src/lib/quota'
import { call, callWith, countingEnv } from './helpers/auth'
import { addMember, count, type Household, newHousehold } from './helpers/tenant'

vi.setConfig({ testTimeout: 30_000 })

// Distinctive synthetic values, so the D1 scan below can't match by accident.
const FD = { amount: 7_654_321, rate: 7.35, start: '2019-03-17', tenure: { years: 5, months: 0, days: 0 } }
const PPF = { balance: 4_321_987, as_of: '2023-06-19', opened_year: 2013, yearly: 1_234_567 }
const EPF = { balance: 2_468_013, as_of: '2024-08-23', monthly: 1_357_913 }

type AssetJson = { id: string; type: string; member_id: string | null; inputs: Record<string, unknown>; created_at: number; updated_at: number }
const send = (h: Household, path: string, method: string, body?: unknown) => call(path, { jar: h.jar, method, body })
async function add(h: Household, body: unknown) {
  const res = await send(h, '/api/assets', 'POST', body)
  expect(res.status).toBe(201)
  return (await res.json<{ asset: AssetJson }>()).asset
}
const list = async (h: Household) => (await (await call('/api/assets', { jar: h.jar })).json<{ assets: AssetJson[]; rates: { checked: string } }>())

describe('/api/assets', () => {
  it('creates, lists, edits and deletes (inputs only, normalised; the rate table comes along)', async () => {
    const h = await newHousehold('assets')
    const member = await addMember(h, 'ABCDE1234F', 'SYNTHETIC HOLDER')
    const fd = await add(h, { type: 'fd', inputs: FD })
    expect(fd).toMatchObject({ type: 'fd', member_id: null, inputs: { ...FD, payout: null, closed: null } })
    const ppf = await add(h, { type: 'ppf', member_id: member, inputs: PPF })
    expect(ppf.inputs).toEqual({ ...PPF, overrides: [], rate: null })

    const got = await list(h)
    expect(got.rates.checked).toBe('2026-11-27')
    expect(got.assets.map((a) => a.id)).toEqual([fd.id, ppf.id])

    // closed early, then moved to the member: PATCH replaces the inputs and/or the member
    const closed = { ...FD, closed: { on: '2020-01-10', penalty: 1 } }
    let res = await send(h, `/api/assets/${fd.id}`, 'PATCH', { inputs: closed })
    expect(res.status).toBe(200)
    res = await send(h, `/api/assets/${fd.id}`, 'PATCH', { member_id: member })
    expect((await res.json<{ asset: AssetJson }>()).asset).toMatchObject({ member_id: member, inputs: { closed: { on: '2020-01-10', penalty: 1 } } })
    res = await send(h, `/api/assets/${fd.id}`, 'PATCH', { member_id: null })
    expect((await res.json<{ asset: AssetJson }>()).asset.member_id).toBeNull()

    expect((await send(h, `/api/assets/${fd.id}`, 'DELETE')).status).toBe(200)
    expect((await send(h, `/api/assets/${fd.id}`, 'DELETE')).status).toBe(404)
    expect((await list(h)).assets.map((a) => a.id)).toEqual([ppf.id])
    const events = await env.DB.prepare("SELECT event FROM audit_event WHERE household_id = ?1 AND event LIKE 'asset_%' ORDER BY id").bind(h.householdId).all<{ event: string }>()
    expect(events.results.map((e) => e.event)).toEqual(['asset_added', 'asset_added', 'asset_changed', 'asset_changed', 'asset_changed', 'asset_deleted'])
  })

  it('GET is one D1 round trip', async () => {
    const h = await newHousehold('assets-d1')
    await add(h, { type: 'epf', inputs: EPF })
    const counted = countingEnv()
    const res = await callWith(counted.env, '/api/assets', { jar: h.jar })
    expect(res.status).toBe(200)
    expect(counted.sql).toEqual(['BATCH'])
  })

  it('400 bad_input names the field, never the value', async () => {
    const h = await newHousehold('assets-bad')
    const res = await send(h, '/api/assets', 'POST', { type: 'fd', inputs: { ...FD, amount: 98_765.5 } })
    expect(res.status).toBe(400)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ ok: false, code: 'bad_input', field: 'amount' })
    expect(text).not.toContain('98765')
    expect((await send(h, '/api/assets', 'POST', { type: 'nsc', inputs: {} })).status).toBe(400)
    expect((await send(h, '/api/assets', 'POST', [1])).status).toBe(400)
    const epf = await add(h, { type: 'epf', inputs: EPF })
    expect(await (await send(h, `/api/assets/${epf.id}`, 'PATCH', {})).json()).toMatchObject({ code: 'bad_input', field: 'inputs' })
    // the stored type decides the rules: EPF inputs can't become an FD's
    expect(await (await send(h, `/api/assets/${epf.id}`, 'PATCH', { inputs: FD })).json()).toMatchObject({ code: 'bad_input', field: 'balance' })
  })

  it('needs a session', async () => {
    expect((await call('/api/assets')).status).toBe(401)
    expect((await call('/api/assets', { method: 'POST', body: { type: 'epf', inputs: EPF } })).status).toBe(401)
  })
})

describe('isolation between households', () => {
  it("B can't see, edit, move or delete A's assets, or file one under A's member (404, nothing changes)", async () => {
    const a = await newHousehold('assets-a')
    const b = await newHousehold('assets-b')
    const aMember = await addMember(a, 'ABCDE1234F', 'SYNTHETIC A')
    const bMember = await addMember(b, 'PQRST6789K', 'SYNTHETIC B')
    const asset = await add(a, { type: 'fd', member_id: aMember, inputs: FD })
    const before = await env.DB.prepare('SELECT inputs_enc, member_id, updated_at FROM manual_asset WHERE id = ?1').bind(asset.id).first()

    expect((await list(b)).assets).toEqual([])
    expect((await send(b, `/api/assets/${asset.id}`, 'PATCH', { inputs: { ...FD, amount: 1 } })).status).toBe(404)
    expect((await send(b, `/api/assets/${asset.id}`, 'PATCH', { member_id: bMember })).status).toBe(404)
    expect((await send(b, `/api/assets/${asset.id}`, 'DELETE')).status).toBe(404)
    expect((await send(b, '/api/assets', 'POST', { type: 'fd', member_id: aMember, inputs: FD })).status).toBe(404)
    expect((await send(a, `/api/assets/${asset.id}`, 'PATCH', { member_id: bMember })).status).toBe(404) // and A can't use B's member
    expect((await send(a, '/api/assets/not-a-uuid', 'PATCH', { member_id: null })).status).toBe(404)

    expect(await env.DB.prepare('SELECT inputs_enc, member_id, updated_at FROM manual_asset WHERE id = ?1').bind(asset.id).first()).toEqual(before)
    expect(await count('SELECT COUNT(*) AS n FROM manual_asset WHERE household_id = ?1', b.householdId)).toBe(0)
    expect(await count("SELECT COUNT(*) AS n FROM audit_event WHERE household_id = ?1 AND event LIKE 'asset_%'", b.householdId)).toBe(0)
  })

  it("a sealed row can't be opened as another asset's (the AAD names the id)", async () => {
    const h = await newHousehold('assets-aad')
    const one = await add(h, { type: 'epf', inputs: EPF })
    const two = await add(h, { type: 'epf', inputs: { ...EPF, monthly: 1 } })
    const row = await env.DB.prepare('SELECT inputs_enc FROM manual_asset WHERE id = ?1').bind(one.id).first<{ inputs_enc: number[] }>()
    const vault = await h.tenant.vault()
    await expect(vault.openText(assetFieldKey(two.id), row!.inputs_enc)).rejects.toThrow(SealError)
    expect(JSON.parse(await vault.openText(assetFieldKey(one.id), row!.inputs_enc))).toMatchObject({ monthly: EPF.monthly })
  })
})

describe('privacy', () => {
  it('no plaintext amounts, rates or dates anywhere in D1', async () => {
    const h = await newHousehold('assets-scan')
    const member = await addMember(h, 'ABCDE1234F', 'SYNTHETIC HOLDER')
    await add(h, { type: 'fd', member_id: member, inputs: { ...FD, closed: { on: '2021-07-29', penalty: 1.5 } } })
    await add(h, { type: 'ppf', inputs: { ...PPF, overrides: [{ fy: 2031, amount: 1_111_193 }] } })
    await add(h, { type: 'epf', inputs: { ...EPF, stopped: '2025-02-27' } })
    const needles = ['7654321', '7.35', '2019-03-17', '4321987', '2023-06-19', '1234567', '2468013', '2024-08-23', '1357913', '2021-07-29', '1111193', '2025-02-27']

    const tables = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all<{ name: string }>()
    expect(tables.results.map((t) => t.name)).toContain('manual_asset')
    for (const { name } of tables.results) {
      const rows = await env.DB.prepare(`SELECT * FROM "${name}"`).all()
      // BLOBs come back as byte arrays, so a sealed column can't spell a number out by accident
      const text = JSON.stringify(rows.results)
      for (const n of needles) expect(text, `${name} holds ${n}`).not.toContain(n)
    }
    const row = await env.DB.prepare('SELECT * FROM manual_asset WHERE household_id = ?1 LIMIT 1').bind(h.householdId).first<Record<string, unknown>>()
    expect(Object.keys(row!).sort()).toEqual(['created_at', 'household_id', 'id', 'inputs_enc', 'member_id', 'type', 'updated_at'])
  })

  it('export has the inputs and today\'s values; deleting a member deletes their assets; account deletion leaves no rows', async () => {
    const h = await newHousehold('assets-export')
    const member = await addMember(h, 'ABCDE1234F', 'SYNTHETIC HOLDER')
    const mine = await add(h, { type: 'ppf', member_id: member, inputs: PPF })
    const loose = await add(h, { type: 'fd', inputs: FD })

    const text = await (await call('/api/account/export', { jar: h.jar })).text()
    const data = JSON.parse(text)
    expect(data.manual_assets).toHaveLength(2)
    expect(data.manual_assets[0]).toMatchObject({
      id: mine.id,
      type: 'ppf',
      member_id: member,
      name: 'PPF · opened 2013',
      inputs: { ...PPF, overrides: [], rate: null },
      approximate_value: { as_of: todayIst(), status: 'active', provisional: expect.any(Boolean) },
    })
    expect(data.manual_assets[0].approximate_value.value).toBeGreaterThan(PPF.balance)
    expect(data.manual_assets[1]).toMatchObject({ id: loose.id, member_id: null, approximate_value: { status: 'matured' } })
    expect(text).not.toContain('inputs_enc')
    expect(text).not.toContain('"flows"')

    // the member goes, and with them their assets (the cascade); the household's own FD stays
    expect((await call(`/api/members/${member}`, { jar: h.jar, method: 'DELETE' })).status).toBe(200)
    expect((await list(h)).assets.map((a) => a.id)).toEqual([loose.id])

    expect((await call('/api/account', { jar: h.jar, method: 'DELETE', body: { confirm: 'DELETE' } })).status).toBe(200)
    expect(await count('SELECT COUNT(*) AS n FROM manual_asset WHERE household_id = ?1', h.householdId)).toBe(0)
  })
})

describe('limits (plan §21.12, §11)', () => {
  it(`${LIMITS.assetsPerHousehold} assets per household`, async () => {
    const h = await newHousehold('assets-cap')
    const now = Date.now()
    const fill = Array.from({ length: LIMITS.assetsPerHousehold }, () =>
      env.DB.prepare("INSERT INTO manual_asset (id, household_id, type, inputs_enc, created_at, updated_at) VALUES (?1, ?2, 'epf', x'00', ?3, ?3)").bind(crypto.randomUUID(), h.householdId, now),
    )
    await env.DB.batch(fill)
    const res = await send(h, '/api/assets', 'POST', { type: 'epf', inputs: EPF })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'asset_limit', limit: 50 })
    expect(await count('SELECT COUNT(*) AS n FROM manual_asset WHERE household_id = ?1', h.householdId)).toBe(50)
  })

  it(`${LIMITS.assetWritesPerDay} adds and edits a day; deleting is never limited`, async () => {
    const h = await newHousehold('assets-quota')
    const asset = await add(h, { type: 'epf', inputs: EPF })
    await env.DB.prepare("UPDATE quota SET count = ?1 WHERE subject = ?2 AND metric = 'asset_write' AND window = ?3")
      .bind(LIMITS.assetWritesPerDay, `household:${h.householdId}`, quotaWindow('day'))
      .run()
    let res = await send(h, '/api/assets', 'POST', { type: 'epf', inputs: EPF })
    expect(res.status).toBe(429)
    expect(await res.json()).toMatchObject({ code: 'asset_write_limit', retry_after: expect.any(Number) })
    expect(res.headers.get('retry-after')).toMatch(/^\d+$/)
    res = await send(h, `/api/assets/${asset.id}`, 'PATCH', { inputs: { ...EPF, monthly: 1 } })
    expect(res.status).toBe(429)
    expect((await list(h)).assets[0]!.inputs.monthly).toBe(EPF.monthly) // unchanged
    expect((await send(h, `/api/assets/${asset.id}`, 'DELETE')).status).toBe(200)
  })
})
