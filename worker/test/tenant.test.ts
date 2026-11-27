// Tenant isolation (plan §0.4, §9.1, §16 "Tenant isolation") and the /api/members routes.
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { BlobKeyError, blobKeys, getJsonBlob, putJsonBlob } from '../src/lib/blob'
import { SealError } from '../src/lib/crypto'
import { ApiError } from '../src/lib/errors'
import { panHmac } from '../src/lib/members'
import { call, callWith, countingEnv, Jar } from './helpers/auth'
import { addMember, addParkedJob, addStatement, count, newHousehold, r2Keys } from './helpers/tenant'

type MembersBody = { members: { id: string; name: string | null; pan_masked: string; statements: { id: string; kind: string; as_of: string; holdings_count: number }[] }[] }

const list = async (jar: Jar) => {
  const res = await call('/api/members', { jar })
  expect(res.status).toBe(200)
  return (await res.json<MembersBody>()).members
}
const rename = (jar: Jar, id: string, name: unknown) => call(`/api/members/${id}`, { method: 'PATCH', body: { name }, jar })
const remove = (jar: Jar, id: string) => call(`/api/members/${id}`, { method: 'DELETE', jar })
const audits = (householdId: string, event: string) =>
  count('SELECT COUNT(*) AS n FROM audit_event WHERE household_id = ?1 AND event = ?2', householdId, event)

describe('GET /api/members', () => {
  it('needs a session', async () => {
    expect((await call('/api/members')).status).toBe(401)
  })

  it('an empty household has no members', async () => {
    const a = await newHousehold('empty')
    expect(await list(a.jar)).toEqual([])
  })

  it('lists the household\'s members with decrypted names, masked PANs and statements, newest first', async () => {
    const a = await newHousehold('list')
    const m1 = await addMember(a, 'ZZZPZ1234Z', 'Synthetic One')
    const m2 = await addMember(a, 'yyypy 5678 y', null) // normalised; no name yet
    // Members list oldest first (created_at, then id): two inserts in the same millisecond would fall back to random
    // ids, so make m1 clearly older.
    await env.DB.prepare('UPDATE member SET created_at = created_at - 1000 WHERE id = ?1').bind(m1).run()
    const older = await addStatement(a, m1, { kind: 'CAMS', asOf: '2026-09-30' })
    const newer = await addStatement(a, m1, { kind: 'CDSL', asOf: '2026-10-31' })
    const members = await list(a.jar)
    expect(members).toEqual([
      {
        id: m1, name: 'Synthetic One', pan_masked: 'ZZ••••••4Z',
        statements: [
          { id: newer.id, kind: 'CDSL', as_of: '2026-10-31', holdings_count: 1 },
          { id: older.id, kind: 'CAMS', as_of: '2026-09-30', holdings_count: 1 },
        ],
        no_pan: false,
        same_as: [],
      },
      { id: m2, name: null, pan_masked: 'YY••••••8Y', statements: [], no_pan: false, same_as: [] },
    ])
    expect(JSON.stringify(members)).not.toMatch(/ZZZPZ1234Z|YYYPY5678Y/)
  })

  it('costs one D1 round trip with a warm cookie cache (session from the cookie, key + rows in one batch)', async () => {
    const a = await newHousehold('budget')
    await addStatement(a, await addMember(a, 'ZZZPZ1234Z', 'Synthetic'))
    const counted = countingEnv()
    const res = await callWith(counted.env, '/api/members', { jar: a.jar })
    expect(res.status).toBe(200)
    expect(counted.sql).toEqual(['BATCH'])
  })
})

describe('isolation between households', () => {
  it('B sees none of A\'s members, and can\'t rename or delete them by id (404, nothing changes, no audit row)', async () => {
    const a = await newHousehold('a')
    const b = await newHousehold('b')
    const am = await addMember(a, 'ZZZPZ1234Z', 'Synthetic A')
    const st = await addStatement(a, am)

    expect(await list(b.jar)).toEqual([])
    const r = await rename(b.jar, am, 'Hijacked')
    expect(r.status).toBe(404)
    expect(await r.json()).toEqual({ ok: false, code: 'not_found' })
    expect((await remove(b.jar, am)).status).toBe(404)

    const [aView] = await list(a.jar)
    expect(aView).toMatchObject({ id: am, name: 'Synthetic A', statements: [{ id: st.id }] })
    expect(await r2Keys(blobKeys.householdPrefix(a.householdId))).toEqual([st.key])
    expect(await audits(b.householdId, 'member_renamed')).toBe(0)
    expect(await audits(b.householdId, 'member_deleted')).toBe(0)
  })

  it('unknown and malformed ids are 404 too, without revealing anything', async () => {
    const a = await newHousehold('ids')
    for (const id of [crypto.randomUUID(), 'm0', '1%20OR%201=1', '..%2F..%2Fh']) {
      expect((await rename(a.jar, id, 'x')).status).toBe(404)
      expect((await remove(a.jar, id)).status).toBe(404)
    }
  })

  it('the tenant guard rejects another household\'s member and statement ids with a 404 ApiError', async () => {
    const a = await newHousehold('ga')
    const b = await newHousehold('gb')
    const am = await addMember(a, 'ZZZPZ1234Z', 'Synthetic A')
    const st = await addStatement(a, am)
    expect(await a.tenant.assertMember(am)).toBe(am)
    expect(await a.tenant.assertStatement(st.id)).toBe(st.id)
    for (const p of [() => b.tenant.assertMember(am), () => b.tenant.assertStatement(st.id), () => b.tenant.assertMember('not-a-uuid')]) {
      await expect(p()).rejects.toSatisfy((e) => e instanceof ApiError && e.status === 404)
    }
  })

  it('R2 keys always carry the session\'s household; another household\'s key is refused and its blobs don\'t open', async () => {
    const a = await newHousehold('ka')
    const b = await newHousehold('kb')
    const id = crypto.randomUUID()
    expect(a.tenant.keys.statement(id)).toBe(`h/${a.householdId}/statements/${id}.bin`)
    expect(a.tenant.keys.parkedPdf(id)).toBe(`tmp/${a.householdId}/${id}.bin`)
    expect(a.tenant.keys.snapshot('abc123')).toBe(`h/${a.householdId}/snapshot/abc123.bin`)
    expect(() => blobKeys.statement('../x', id)).toThrow(BlobKeyError)

    const st = await addStatement(a, await addMember(a, 'ZZZPZ1234Z', 'Synthetic A'))
    const bVault = await b.tenant.vault()
    await expect(getJsonBlob(env, bVault, st.key)).rejects.toBeInstanceOf(BlobKeyError)
    await expect(putJsonBlob(env, bVault, st.key, { overwrite: true })).rejects.toBeInstanceOf(BlobKeyError)
    // Even copied under B's own prefix, A's sealed bytes don't open with B's key.
    const copied = b.tenant.keys.statement(crypto.randomUUID())
    await env.BUCKET.put(copied, await (await env.BUCKET.get(st.key))!.arrayBuffer())
    await expect(getJsonBlob(env, bVault, copied)).rejects.toBeInstanceOf(SealError)
  })

  it('two households with the same PAN stay separate; one household can\'t hold a PAN twice', async () => {
    const a = await newHousehold('pa')
    const b = await newHousehold('pb')
    const am = await addMember(a, 'ZZZPZ1234Z', 'Synthetic A')
    const bm = await addMember(b, 'ZZZPZ1234Z', 'Synthetic B')
    expect(am).not.toBe(bm)
    const rows = await env.DB.prepare('SELECT household_id, pan_hmac FROM member WHERE id IN (?1, ?2)').bind(am, bm).all<{ household_id: string; pan_hmac: string }>()
    expect(new Set(rows.results.map((r) => r.pan_hmac))).toEqual(new Set([await panHmac(env, 'ZZZPZ1234Z')]))
    expect(new Set(rows.results.map((r) => r.household_id))).toEqual(new Set([a.householdId, b.householdId]))
    expect((await list(a.jar)).map((m) => m.name)).toEqual(['Synthetic A'])
    expect((await list(b.jar)).map((m) => m.name)).toEqual(['Synthetic B'])
    await expect(addMember(a, 'zzzpz1234z', 'Again')).rejects.toThrow(/UNIQUE/)
  })
})

describe('PATCH /api/members/:id', () => {
  it('renames (sealed), trims, and writes an audit row', async () => {
    const a = await newHousehold('ren')
    const id = await addMember(a, 'ZZZPZ1234Z', 'Synthetic')
    const res = await rename(a.jar, id, '  Synthetic   Renamed ')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ member: { id, name: 'Synthetic Renamed' } })
    expect((await list(a.jar))[0]!.name).toBe('Synthetic Renamed')
    const raw = (await env.DB.prepare('SELECT display_name_enc FROM member WHERE id = ?1').bind(id).first<{ display_name_enc: ArrayBuffer }>())!
    expect(new TextDecoder('latin1').decode(new Uint8Array(raw.display_name_enc))).not.toContain('Renamed')
    expect(await audits(a.householdId, 'member_renamed')).toBe(1)
  })

  it('rejects empty, too long and non-string names', async () => {
    const a = await newHousehold('bad')
    const id = await addMember(a, 'ZZZPZ1234Z', 'Synthetic')
    for (const name of ['', '   ', 'x'.repeat(61), 42, null]) {
      const res = await rename(a.jar, id, name)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ ok: false, code: 'invalid_name' })
    }
    expect((await rename(a.jar, id, 'x'.repeat(60))).status).toBe(200)
  })
})

describe('DELETE /api/members/:id', () => {
  it('deletes the member, their statements, queued jobs and blobs (h/ and tmp/), and nothing of other members', async () => {
    const a = await newHousehold('del')
    const gone = await addMember(a, 'ZZZPZ1234Z', 'Synthetic Gone')
    const kept = await addMember(a, 'YYYPY5678Y', 'Synthetic Kept')
    const s1 = await addStatement(a, gone)
    const s2 = await addStatement(a, gone, { kind: 'CDSL' })
    const job = await addParkedJob(a, gone)
    const keptSt = await addStatement(a, kept)
    const keptJob = await addParkedJob(a, null) // a queued upload not yet matched to a member stays

    const res = await remove(a.jar, gone)
    expect(res.status).toBe(200)
    expect(await count('SELECT COUNT(*) AS n FROM member WHERE id = ?1', gone)).toBe(0)
    expect(await count('SELECT COUNT(*) AS n FROM statement WHERE member_id = ?1', gone)).toBe(0)
    expect(await count('SELECT COUNT(*) AS n FROM parse_job WHERE id = ?1', job.id)).toBe(0)
    for (const k of [s1.key, s2.key, job.key]) expect(await env.BUCKET.head(k)).toBeNull()

    expect((await list(a.jar)).map((m) => m.id)).toEqual([kept])
    expect(await env.BUCKET.head(keptSt.key)).not.toBeNull()
    expect(await env.BUCKET.head(keptJob.key)).not.toBeNull()
    expect(await audits(a.householdId, 'member_deleted')).toBe(1)

    expect((await remove(a.jar, gone)).status).toBe(404) // already gone; no second audit row
    expect(await audits(a.householdId, 'member_deleted')).toBe(1)
  })
})
