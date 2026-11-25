// Encryption (plan §8, §16 "Crypto"): sealed blobs, compress-then-encrypt, AAD binding, KEK rotation, crypto-shred.
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { blobKeys, getJsonBlob, openJson, openPdf, putJsonBlob, sealJson, sealPdf } from '../src/lib/blob'
import { currentKekVersion, FLAG_GZIP, KeyConfigError, newWrappedDek, rewrapDeks, SealError, Vault, wrapDek } from '../src/lib/crypto'
import { shredHousehold } from '../src/lib/household'
import { fieldKey } from '../src/lib/members'
import { addMember, addParkedJob, addStatement, count, newHousehold, r2Keys } from './helpers/tenant'

const KEK_V2 = 'ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100'
const hid = () => crypto.randomUUID()

async function vaultFor(householdId: string, e: Parameters<typeof newWrappedDek>[0] = env) {
  const { wrapped, kekVersion } = await newWrappedDek(e, householdId)
  return Vault.fromRow(e, householdId, { dek_wrapped: wrapped, kek_version: kekVersion })
}

const has = (haystack: Uint8Array, needle: string) => new TextDecoder('latin1').decode(haystack).includes(needle)

// Repetitive JSON, like a statement: many holdings with the same keys.
const statementLike = {
  synthetic: true,
  holdings: Array.from({ length: 200 }, (_, i) => ({ isin: `INF${String(i).padStart(9, '0')}`, scheme: 'Synthetic Equity Fund Direct Growth', units: i * 1.5 })),
}

describe('sealed blobs', () => {
  it('JSON round trip: gzip then encrypt, flags bit 0 set, no plaintext in the bytes, smaller than the JSON', async () => {
    const h = hid()
    const vault = await vaultFor(h)
    const key = blobKeys.statement(h, crypto.randomUUID())
    const sealed = await sealJson(vault, key, statementLike)
    expect(sealed[0]).toBe(0x01)
    expect(sealed[1]).toBe(1) // KEK version at seal time
    expect(sealed[2]! & FLAG_GZIP).toBe(FLAG_GZIP)
    expect(has(sealed, 'Synthetic Equity')).toBe(false)
    expect(sealed.length).toBeLessThan(JSON.stringify(statementLike).length / 5)
    expect(await openJson(vault, key, sealed)).toEqual(statementLike)
  })

  it('parked PDF round trip: encrypted only (flags clear), raw bytes show no %PDF', async () => {
    const h = hid()
    const vault = await vaultFor(h)
    const key = blobKeys.parkedPdf(h, crypto.randomUUID())
    const pdf = new TextEncoder().encode('%PDF-1.7 synthetic body %%EOF') as Uint8Array<ArrayBuffer>
    const sealed = await sealPdf(vault, key, pdf)
    expect(sealed[2]! & FLAG_GZIP).toBe(0)
    expect(has(sealed, '%PDF')).toBe(false)
    expect(await openPdf(vault, key, sealed)).toEqual(pdf)
    // A JSON blob is not accepted where a PDF is expected, and vice versa the flag is honoured.
    await expect(openPdf(vault, key, await sealJson(vault, key, { a: 1 }))).rejects.toBeInstanceOf(SealError)
  })

  it('the AAD binds a blob to its household and key: moving it fails, even under the same DEK', async () => {
    const [h1, h2] = [hid(), hid()]
    const dek = crypto.getRandomValues(new Uint8Array(32))
    const v1 = await Vault.fromRow(env, h1, { dek_wrapped: await wrapDek(env, h1, dek, 1), kek_version: 1 })
    const v2 = await Vault.fromRow(env, h2, { dek_wrapped: await wrapDek(env, h2, dek, 1), kek_version: 1 })
    const key = blobKeys.statement(h1, crypto.randomUUID())
    const sealed = await sealJson(v1, key, { a: 1 })
    expect(await openJson(v1, key, sealed)).toEqual({ a: 1 })
    await expect(openJson(v1, blobKeys.statement(h1, crypto.randomUUID()), sealed)).rejects.toBeInstanceOf(SealError) // other key
    await expect(openJson(v2, key, sealed)).rejects.toBeInstanceOf(SealError) // other household, same DEK
    // And a wrapped DEK can't be moved to another household either.
    await expect(Vault.fromRow(env, h2, { dek_wrapped: await wrapDek(env, h1, dek, 1), kek_version: 1 })).rejects.toBeInstanceOf(KeyConfigError)
  })

  it('editing the ciphertext, the tag, the flags or the KEK byte fails; so do short or foreign bytes', async () => {
    const h = hid()
    const vault = await vaultFor(h)
    const key = blobKeys.statement(h, crypto.randomUUID())
    const sealed = await sealJson(vault, key, statementLike)
    for (const at of [1, 2, 3, 20, sealed.length - 1]) {
      const bad = sealed.slice()
      bad[at]! ^= 0x01
      await expect(openJson(vault, key, bad)).rejects.toBeInstanceOf(SealError)
    }
    await expect(vault.open(key, sealed.slice(0, 20))).rejects.toBeInstanceOf(SealError)
    const foreign = sealed.slice()
    foreign[0] = 0x02
    await expect(vault.open(key, foreign)).rejects.toBeInstanceOf(SealError)
  })

  it('sealed member fields open only under their own field key', async () => {
    const h = await newHousehold('fld')
    const id = await addMember(h, 'ZZZPZ9999Z', 'Synthetic Holder')
    const row = (await env.DB.prepare('SELECT pan_enc, display_name_enc, pan_masked FROM member WHERE id = ?1').bind(id)
      .first<{ pan_enc: ArrayBuffer; display_name_enc: ArrayBuffer; pan_masked: string }>())!
    const vault = await h.tenant.vault()
    expect(row.pan_masked).toBe('ZZ••••••9Z')
    expect(has(new Uint8Array(row.pan_enc), 'ZZZPZ')).toBe(false)
    expect(await vault.openText(fieldKey.pan(id), row.pan_enc)).toBe('ZZZPZ9999Z')
    expect(await vault.openText(fieldKey.name(id), row.display_name_enc)).toBe('Synthetic Holder')
    // A sealed name can't be passed off as the PAN, or as another member's field.
    await expect(vault.openText(fieldKey.pan(id), row.display_name_enc)).rejects.toBeInstanceOf(SealError)
    await expect(vault.openText(fieldKey.pan(crypto.randomUUID()), row.pan_enc)).rejects.toBeInstanceOf(SealError)
  })

  it('R2 round trip through putJsonBlob/getJsonBlob; the stored object is the sealed form', async () => {
    const h = await newHousehold('r2')
    const vault = await h.tenant.vault()
    const key = h.tenant.keys.statement(crypto.randomUUID())
    await putJsonBlob(env, vault, key, statementLike)
    const raw = new Uint8Array(await (await env.BUCKET.get(key))!.arrayBuffer())
    expect(raw[0]).toBe(0x01)
    expect(has(raw, 'INF0000')).toBe(false)
    expect(await getJsonBlob(env, vault, key)).toEqual(statementLike)
    expect(await getJsonBlob(env, vault, h.tenant.keys.statement(crypto.randomUUID()))).toBeNull()
  })
})

describe('KEK rotation', () => {
  it('adding DATA_KEK_V2 wraps new DEKs with V2; rewrapDeks moves old households and their blobs still open', async () => {
    const a = await newHousehold('rot')
    const memberId = await addMember(a, 'ZZZPZ1111Z', 'Synthetic Rotation')
    const st = await addStatement(a, memberId)
    const env2 = { ...env, DATA_KEK_V2: KEK_V2 }

    expect(currentKekVersion(env)).toBe(1)
    expect(currentKekVersion(env2)).toBe(2)
    expect((await newWrappedDek(env2, hid())).kekVersion).toBe(2)

    let moved = 0
    for (let n = await rewrapDeks(env2, 2); n > 0; n = await rewrapDeks(env2, 2)) moved += n
    expect(moved).toBeGreaterThanOrEqual(1)
    expect(await count('SELECT COUNT(*) AS n FROM household WHERE kek_version != 2')).toBe(0)

    const vault2 = await Vault.load(env2, a.householdId)
    expect(vault2.kekVersion).toBe(2)
    expect(await getJsonBlob(env2, vault2, st.key)).toMatchObject({ synthetic: true }) // sealed under V1, same DEK
    const name = (await env.DB.prepare('SELECT display_name_enc FROM member WHERE id = ?1').bind(memberId).first<{ display_name_enc: ArrayBuffer }>())!
    expect(await vault2.openText(fieldKey.name(memberId), name.display_name_enc)).toBe('Synthetic Rotation')

    // V1 can now be removed: without V2 the household no longer opens, so V2 really is in use.
    await expect(Vault.load(env, a.householdId)).rejects.toBeInstanceOf(KeyConfigError)
    expect(await rewrapDeks(env2)).toBe(0)
  })
})

describe('crypto-shredding', () => {
  it('shredHousehold destroys the DEK, empties h/{id}/ and tmp/{id}/, deletes the rows, and leaves others alone', async () => {
    const a = await newHousehold('shred')
    const b = await newHousehold('keep')
    const am = await addMember(a, 'ZZZPZ2222Z', 'Synthetic A')
    const bm = await addMember(b, 'ZZZPZ2222Z', 'Synthetic B') // same PAN in another household
    const aStatement = await addStatement(a, am)
    await addParkedJob(a, am)
    const bStatement = await addStatement(b, bm)
    const sealedCopy = new Uint8Array(await (await env.BUCKET.get(aStatement.key))!.arrayBuffer()) // e.g. a backup

    const { objects } = await shredHousehold(env, a.householdId)
    expect(objects).toBe(2)
    expect(await r2Keys(blobKeys.householdPrefix(a.householdId))).toEqual([])
    expect(await r2Keys(blobKeys.tmpPrefix(a.householdId))).toEqual([])
    for (const table of ['household', 'member', 'statement', 'parse_job', 'snapshot']) {
      const col = table === 'household' ? 'id' : 'household_id'
      expect(await count(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?1`, a.householdId)).toBe(0)
    }
    await expect(Vault.load(env, a.householdId)).rejects.toBeInstanceOf(KeyConfigError)
    expect(sealedCopy.length).toBeGreaterThan(0) // the copy exists, but no key for it does any more

    expect(await getJsonBlob(env, await b.tenant.vault(), bStatement.key)).toMatchObject({ synthetic: true })
    expect(await count('SELECT COUNT(*) AS n FROM member WHERE household_id = ?1', b.householdId)).toBe(1)
  })
})
