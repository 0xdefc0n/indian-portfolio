// User blobs in R2 (plan §6 key layout, §8 format, D18 compress-then-encrypt).
// JSON is gzip-compressed, then sealed (flags bit 0 set). Parked PDFs are already compressed, so they are only sealed
// (flags clear). Never compress after encrypting. Keys are built only here, only from server-side IDs, and always
// under the household's own prefix.
import { type Bytes, FLAG_GZIP, SealError, type Vault } from './crypto'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export const isUuid = (id: unknown): id is string => typeof id === 'string' && UUID_RE.test(id)

function part(id: string, what: string): string {
  // Only our own ids reach a key; anything else is a bug, never a client value.
  if (!/^[0-9a-zA-Z_-]{1,128}$/.test(id)) throw new BlobKeyError(`bad ${what}`)
  return id
}

export class BlobKeyError extends Error {
  override name = 'BlobKeyError'
}

/** R2 key layout (plan §6). Every user key starts with h/{household_id}/ or tmp/{household_id}/. */
export const blobKeys = {
  householdPrefix: (hid: string) => `h/${part(hid, 'household')}/`,
  tmpPrefix: (hid: string) => `tmp/${part(hid, 'household')}/`,
  statement: (hid: string, statementId: string) => `h/${part(hid, 'household')}/statements/${part(statementId, 'statement')}.bin`,
  snapshot: (hid: string, inputsHash: string) => `h/${part(hid, 'household')}/snapshot/${part(inputsHash, 'hash')}.bin`,
  tradebook: (hid: string, id: string) => `h/${part(hid, 'household')}/tradebooks/${part(id, 'tradebook')}.bin`,
  parkedPdf: (hid: string, jobId: string) => `tmp/${part(hid, 'household')}/${part(jobId, 'job')}.bin`,
  /** Cached daily series (§10.5.3): one per snapshot inputs, latest NAV date and member (or `all`). */
  dailyPrefix: (hid: string, inputsHash?: string) =>
    `h/${part(hid, 'household')}/daily/${inputsHash === undefined ? '' : `${part(inputsHash, 'hash')}_`}`,
  daily: (hid: string, inputsHash: string, navDate: string, member: string) =>
    `h/${part(hid, 'household')}/daily/${part(inputsHash, 'hash')}_${part(navDate, 'date')}_${part(member, 'member')}.bin`,
}

/** True when an R2 key belongs to this household. Checked again before every read and write. */
export function ownsKey(householdId: string, key: string): boolean {
  return key.startsWith(blobKeys.householdPrefix(householdId)) || key.startsWith(blobKeys.tmpPrefix(householdId))
}

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream))
  return new Uint8Array(await out.arrayBuffer())
}

export const gzip = (bytes: Uint8Array<ArrayBuffer>) => pipe(bytes, new CompressionStream('gzip'))
export const gunzip = (bytes: Uint8Array<ArrayBuffer>) => pipe(bytes, new DecompressionStream('gzip'))

/** JSON → gzip → seal (flags bit 0 set). */
export async function sealJson(vault: Vault, key: string, value: unknown): Promise<Uint8Array<ArrayBuffer>> {
  const plain = new TextEncoder().encode(JSON.stringify(value)) as Uint8Array<ArrayBuffer>
  return vault.seal(key, await gzip(plain), FLAG_GZIP)
}

/** open → gunzip (if flagged) → JSON. */
export async function openJson<T = unknown>(vault: Vault, key: string, sealed: Bytes): Promise<T> {
  const { bytes, flags } = await vault.open(key, sealed)
  const plain = flags & FLAG_GZIP ? await gunzip(bytes) : bytes
  return JSON.parse(new TextDecoder().decode(plain)) as T
}

/** A PDF for the queued path (M8): sealed as is, no gzip. */
export function sealPdf(vault: Vault, key: string, pdf: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return vault.seal(key, pdf, 0)
}

export async function openPdf(vault: Vault, key: string, sealed: Bytes): Promise<Uint8Array<ArrayBuffer>> {
  const { bytes, flags } = await vault.open(key, sealed)
  if (flags & FLAG_GZIP) throw new SealError('not a parked PDF')
  return bytes
}

type BucketEnv = { BUCKET: R2Bucket }

function checkKey(vault: Vault, key: string) {
  if (!ownsKey(vault.householdId, key)) throw new BlobKeyError('key outside the household')
}

/** Write a JSON blob for the vault's household. */
export async function putJsonBlob(env: BucketEnv, vault: Vault, key: string, value: unknown): Promise<number> {
  checkKey(vault, key)
  const sealed = await sealJson(vault, key, value)
  await env.BUCKET.put(key, sealed, { httpMetadata: { contentType: 'application/octet-stream' } })
  return sealed.length
}

/** Read a JSON blob for the vault's household; null if it doesn't exist. */
export async function getJsonBlob<T = unknown>(env: BucketEnv, vault: Vault, key: string): Promise<T | null> {
  checkKey(vault, key)
  const obj = await env.BUCKET.get(key)
  return obj ? openJson<T>(vault, key, await obj.arrayBuffer()) : null
}

/** Delete R2 keys (up to 1,000 per call, the R2 limit), all checked against the household. */
export async function deleteBlobs(env: BucketEnv, householdId: string, keys: string[]): Promise<void> {
  for (const k of keys) if (!ownsKey(householdId, k)) throw new BlobKeyError('key outside the household')
  for (let i = 0; i < keys.length; i += 1000) await env.BUCKET.delete(keys.slice(i, i + 1000))
}

/** Delete everything under an R2 prefix. Returns how many objects were removed. */
export async function deletePrefix(env: BucketEnv, prefix: string): Promise<number> {
  let removed = 0
  let cursor: string | undefined
  do {
    const page = await env.BUCKET.list({ prefix, cursor, limit: 1000 })
    if (page.objects.length) await env.BUCKET.delete(page.objects.map((o) => o.key))
    removed += page.objects.length
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return removed
}
