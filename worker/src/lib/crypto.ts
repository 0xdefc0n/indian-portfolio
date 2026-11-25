// Household data keys (plan §8). M5 holds the key parts only: generate a household DEK and wrap / unwrap it with the
// KEK. Blob seal/open, AAD and KEK rotation arrive in M6. WebCrypto only; the unwrapped DEK lives for one request.

/** The DATA_KEK_V<n> that wraps new DEKs. Rotation adds DATA_KEK_V2 and bumps this (plan §8). */
export const CURRENT_KEK_VERSION = 1

type KekEnv = { DATA_KEK_V1: string }

// dek_wrapped = 0x01 | iv (12 B) | AES-256-GCM(KEK, DEK, aad = "dek:{household_id}") ciphertext + tag (48 B)
const WRAP_FORMAT = 0x01
const IV_BYTES = 12

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

export class KeyConfigError extends Error {
  override name = 'KeyConfigError'
}

function kekFor(env: KekEnv, version: number): Promise<CryptoKey> {
  if (version !== 1) throw new KeyConfigError(`unknown KEK version ${version}`)
  return crypto.subtle.importKey('raw', decodeKey(env.DATA_KEK_V1, 'DATA_KEK_V1'), 'AES-GCM', false, ['encrypt', 'decrypt'])
}

const dekAad = (householdId: string) => new TextEncoder().encode(`dek:${householdId}`)

/** A new random 32-byte household DEK, wrapped with the current KEK. The raw DEK is not returned. */
export async function newWrappedDek(env: KekEnv, householdId: string): Promise<{ wrapped: Uint8Array; kekVersion: number }> {
  const dek = crypto.getRandomValues(new Uint8Array(32))
  const wrapped = await wrapDek(env, householdId, dek, CURRENT_KEK_VERSION)
  dek.fill(0)
  return { wrapped, kekVersion: CURRENT_KEK_VERSION }
}

export async function wrapDek(env: KekEnv, householdId: string, dek: Uint8Array<ArrayBuffer>, kekVersion: number): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: dekAad(householdId) }, await kekFor(env, kekVersion), dek),
  )
  const out = new Uint8Array(1 + IV_BYTES + ct.length)
  out[0] = WRAP_FORMAT
  out.set(iv, 1)
  out.set(ct, 1 + IV_BYTES)
  return out
}

/** The household DEK as a non-extractable AES-GCM key. Fails if the wrap was moved to another household. */
export async function unwrapDek(env: KekEnv, householdId: string, wrapped: Uint8Array, kekVersion: number): Promise<CryptoKey> {
  if (wrapped[0] !== WRAP_FORMAT || wrapped.length !== 1 + IV_BYTES + 48) throw new KeyConfigError('bad wrapped DEK')
  const raw = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: wrapped.slice(1, 1 + IV_BYTES), additionalData: dekAad(householdId) },
      await kekFor(env, kekVersion),
      wrapped.slice(1 + IV_BYTES),
    ),
  )
  try {
    return await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
  } finally {
    raw.fill(0)
  }
}

/** HMAC-SHA256 hex, for opaque keys that must not reveal their input (rate-limit buckets, sink addresses). */
export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)))
  return Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Constant-time string compare (for shared keys in headers). */
export function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  let diff = ea.length ^ eb.length
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0)
  return diff === 0
}
