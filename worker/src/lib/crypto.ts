// Application-level encryption (plan §8). WebCrypto only.
//
// - KEK: 32 bytes in the Worker secret DATA_KEK_V<n>. New DEKs are wrapped with the highest version present, so a
//   rotation is: add DATA_KEK_V2 → run rewrapDeks() until it returns 0 → remove DATA_KEK_V1.
// - DEK: 32 random bytes per household, stored wrapped in household.dek_wrapped. Unwrapped once per request into a
//   non-extractable CryptoKey held by a Vault; never stored anywhere.
// - D1 returns BLOB columns as number arrays, so the readers below accept ArrayLike<number> as well as bytes.
// - Sealed blob (R2 objects and *_enc columns):
//     0x01 | kek_version (1 B) | flags (1 B) | iv (12 B) | AES-256-GCM ciphertext + tag
//   flags bit 0 = the plaintext was gzip-compressed before encryption (D18, src/lib/blob.ts).
//   AAD = those 3 header bytes || "{household_id}:{key}", where key is the R2 key or a field name such as
//   "member/{id}/pan". So a blob can't be moved to another household or key, and its header can't be edited.
//   kek_version records the KEK that wrapped the DEK at seal time. A re-wrap keeps the DEK, so old blobs still open.

const MAX_KEK_VERSION = 16

/** Bytes as they arrive: from R2 (ArrayBuffer), WebCrypto (Uint8Array) or a D1 BLOB column (number[]). */
export type Bytes = Uint8Array | ArrayBuffer | ArrayLike<number>
export const toBytes = (b: Bytes): Uint8Array => (b instanceof Uint8Array ? b : new Uint8Array(b as ArrayLike<number>))

// DATA_KEK_V2+ exist only during a rotation, so they're read by name rather than declared.
type KekEnv = { DATA_KEK_V1: string }
const kekSecret = (env: KekEnv, version: number) => (env as unknown as Record<string, string | undefined>)[`DATA_KEK_V${version}`]

// dek_wrapped = 0x01 | iv (12 B) | AES-256-GCM(KEK, DEK, aad = "dek:{household_id}") ciphertext + tag (48 B)
const WRAP_FORMAT = 0x01
const IV_BYTES = 12
const WRAPPED_BYTES = 1 + IV_BYTES + 48

export const BLOB_FORMAT = 0x01
export const BLOB_HEADER_BYTES = 3 + IV_BYTES
export const FLAG_GZIP = 0x01

export class KeyConfigError extends Error {
  override name = 'KeyConfigError'
}

/** A sealed value failed to open: wrong household or key, edited bytes, or a shredded DEK. */
export class SealError extends Error {
  override name = 'SealError'
}

/** Decode a 32-byte key given as 64 hex chars or as base64. Throws without echoing the value. */
export function decodeKey(value: string | undefined, name: string): Uint8Array<ArrayBuffer> {
  const v = (value ?? '').trim()
  let bytes: Uint8Array<ArrayBuffer> | null = null
  if (/^[0-9a-fA-F]{64}$/.test(v)) {
    bytes = new Uint8Array(32)
    for (let i = 0; i < 32; i++) bytes[i] = Number.parseInt(v.slice(i * 2, i * 2 + 2), 16)
  } else if (/^[A-Za-z0-9+/_-]{43}=?$/.test(v)) {
    const bin = atob(v.replace(/-/g, '+').replace(/_/g, '/').padEnd(44, '='))
    bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0))
  }
  if (!bytes || bytes.length !== 32) throw new KeyConfigError(`${name} must be 32 bytes (hex or base64)`)
  return bytes
}

/** The KEK version new DEKs are wrapped with: the highest DATA_KEK_V<n> that is set. */
export function currentKekVersion(env: KekEnv): number {
  for (let v = MAX_KEK_VERSION; v > 1; v--) if (kekSecret(env, v)) return v
  return 1
}

function kekFor(env: KekEnv, version: number): Promise<CryptoKey> {
  const name = `DATA_KEK_V${version}`
  const value = version >= 1 && version <= MAX_KEK_VERSION ? kekSecret(env, version) : undefined
  if (!value) throw new KeyConfigError(`unknown KEK version ${version}`)
  return crypto.subtle.importKey('raw', decodeKey(value, name), 'AES-GCM', false, ['encrypt', 'decrypt'])
}

const utf8 = new TextEncoder()
const dekAad = (householdId: string) => utf8.encode(`dek:${householdId}`)

/** A new random 32-byte household DEK, wrapped with the current KEK. The raw DEK is not returned. */
export async function newWrappedDek(env: KekEnv, householdId: string): Promise<{ wrapped: Uint8Array; kekVersion: number }> {
  const dek = crypto.getRandomValues(new Uint8Array(32))
  const kekVersion = currentKekVersion(env)
  try {
    return { wrapped: await wrapDek(env, householdId, dek, kekVersion), kekVersion }
  } finally {
    dek.fill(0)
  }
}

export async function wrapDek(env: KekEnv, householdId: string, dek: Uint8Array<ArrayBuffer>, kekVersion: number): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: dekAad(householdId) }, await kekFor(env, kekVersion), dek),
  )
  const out = new Uint8Array(WRAPPED_BYTES)
  out[0] = WRAP_FORMAT
  out.set(iv, 1)
  out.set(ct, 1 + IV_BYTES)
  return out
}

/** The raw DEK bytes. Callers must zero them when done. */
async function unwrapRaw(env: KekEnv, householdId: string, wrapped: Uint8Array, kekVersion: number): Promise<Uint8Array<ArrayBuffer>> {
  if (wrapped.length !== WRAPPED_BYTES || wrapped[0] !== WRAP_FORMAT) throw new KeyConfigError('bad wrapped DEK')
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: wrapped.slice(1, 1 + IV_BYTES), additionalData: dekAad(householdId) },
        await kekFor(env, kekVersion),
        wrapped.slice(1 + IV_BYTES),
      ),
    )
  } catch (err) {
    if (err instanceof KeyConfigError) throw err
    throw new KeyConfigError('wrapped DEK did not open') // wrong KEK, or the wrap was moved to another household
  }
}

/** The household DEK as a non-extractable AES-GCM key. Fails if the wrap was moved to another household. */
export async function unwrapDek(env: KekEnv, householdId: string, wrapped: Uint8Array, kekVersion: number): Promise<CryptoKey> {
  const raw = await unwrapRaw(env, householdId, wrapped, kekVersion)
  try {
    return await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
  } finally {
    raw.fill(0)
  }
}

/** Re-wrap one DEK under another KEK version (rotation). The DEK itself, and so every sealed blob, is unchanged. */
export async function rewrapDek(env: KekEnv, householdId: string, wrapped: Uint8Array, from: number, to: number): Promise<Uint8Array> {
  const raw = await unwrapRaw(env, householdId, wrapped, from)
  try {
    return await wrapDek(env, householdId, raw, to)
  } finally {
    raw.fill(0)
  }
}

/**
 * KEK rotation step: re-wrap up to `limit` households not yet on the current KEK version. Returns how many were moved;
 * call until it returns 0, then remove the old secret. Each row is switched with a compare-and-set on kek_version, so
 * a concurrent run can't write a stale wrap.
 */
export async function rewrapDeks(env: KekEnv & { DB: D1Database }, limit = 100): Promise<number> {
  const to = currentKekVersion(env)
  const { results } = await env.DB.prepare('SELECT id, dek_wrapped, kek_version FROM household WHERE kek_version != ?1 AND kek_version > 0 LIMIT ?2')
    .bind(to, limit)
    .all<{ id: string; dek_wrapped: number[]; kek_version: number }>()
  if (!results.length) return 0
  const updates = await Promise.all(
    results.map(async (h) => {
      const wrapped = await rewrapDek(env, h.id, toBytes(h.dek_wrapped), h.kek_version, to)
      return env.DB.prepare('UPDATE household SET dek_wrapped = ?1, kek_version = ?2 WHERE id = ?3 AND kek_version = ?4')
        .bind(wrapped, to, h.id, h.kek_version)
    }),
  )
  const done = await env.DB.batch(updates)
  return done.reduce((n, r) => n + (r.meta.changes ?? 0), 0)
}

function blobAad(header: Uint8Array, householdId: string, key: string): Uint8Array<ArrayBuffer> {
  const tail = utf8.encode(`${householdId}:${key}`)
  const aad = new Uint8Array(3 + tail.length)
  aad.set(header.subarray(0, 3))
  aad.set(tail, 3)
  return aad
}

/**
 * One household's data key for the length of a request (plan §8: "cache the unwrapped DEK per request only").
 * seal/open bind every value to this household and to its key (R2 key or field name) through the AAD.
 */
export class Vault {
  private constructor(
    readonly householdId: string,
    private readonly dek: CryptoKey,
    readonly kekVersion: number,
  ) {}

  /** Unwrap the household's DEK: one D1 read. Throws KeyConfigError if the household is gone or was shredded. */
  static async load(env: KekEnv & { DB: D1Database }, householdId: string): Promise<Vault> {
    const row = await env.DB.prepare('SELECT dek_wrapped, kek_version FROM household WHERE id = ?1')
      .bind(householdId)
      .first<{ dek_wrapped: number[]; kek_version: number }>()
    if (!row) throw new KeyConfigError('no household key')
    return Vault.fromRow(env, householdId, row)
  }

  /** From a household row already read (e.g. inside a batch). */
  static async fromRow(env: KekEnv, householdId: string, row: { dek_wrapped: Bytes; kek_version: number }): Promise<Vault> {
    const wrapped = toBytes(row.dek_wrapped)
    return new Vault(householdId, await unwrapDek(env, householdId, wrapped, row.kek_version), row.kek_version)
  }

  async seal(key: string, plaintext: Uint8Array<ArrayBuffer>, flags = 0): Promise<Uint8Array<ArrayBuffer>> {
    const out = new Uint8Array(BLOB_HEADER_BYTES + plaintext.length + 16)
    out[0] = BLOB_FORMAT
    out[1] = this.kekVersion
    out[2] = flags
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
    out.set(iv, 3)
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: blobAad(out, this.householdId, key) }, this.dek, plaintext)
    out.set(new Uint8Array(ct), BLOB_HEADER_BYTES)
    return out
  }

  async open(key: string, sealed: Bytes): Promise<{ bytes: Uint8Array<ArrayBuffer>; flags: number }> {
    const blob = toBytes(sealed)
    if (blob.length < BLOB_HEADER_BYTES + 16 || blob[0] !== BLOB_FORMAT) throw new SealError('not a sealed blob')
    try {
      const pt = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: blob.slice(3, BLOB_HEADER_BYTES), additionalData: blobAad(blob, this.householdId, key) },
        this.dek,
        blob.slice(BLOB_HEADER_BYTES),
      )
      return { bytes: new Uint8Array(pt), flags: blob[2]! }
    } catch {
      throw new SealError('sealed blob did not open')
    }
  }

  sealText(key: string, text: string) {
    return this.seal(key, utf8.encode(text) as Uint8Array<ArrayBuffer>)
  }

  async openText(key: string, sealed: Bytes): Promise<string> {
    return new TextDecoder().decode((await this.open(key, sealed)).bytes)
  }
}

/** HMAC-SHA256 hex, for opaque keys that must not reveal their input (rate-limit buckets, sink addresses, PANs). */
export async function hmacHex(secret: string, message: string | Uint8Array<ArrayBuffer>): Promise<string> {
  const key = await crypto.subtle.importKey('raw', utf8.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const data = typeof message === 'string' ? utf8.encode(message) : message
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, data))
  return Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Constant-time string compare (for shared keys in headers). */
export function safeEqual(a: string, b: string): boolean {
  const ea = utf8.encode(a)
  const eb = utf8.encode(b)
  let diff = ea.length ^ eb.length
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0)
  return diff === 0
}
