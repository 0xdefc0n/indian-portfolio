// Seeding for tenant tests: a signed-in household, members (through the real memberInsert) and statements with
// sealed blobs in R2. All values are synthetic (fake PANs and names), never real statement data.
import { env } from 'cloudflare:test'
import { blobKeys, putJsonBlob, sealPdf } from '../../src/lib/blob'
import { memberInsert } from '../../src/lib/members'
import { Tenant } from '../../src/lib/tenant'
import { Jar, signInWithCode, sinkAddress } from './auth'

export type Household = { jar: Jar; email: string; userId: string; householdId: string; tenant: Tenant }

let households = 0

export async function newHousehold(tag = 'h'): Promise<Household> {
  const email = sinkAddress(tag)
  const jar = await signInWithCode(email, undefined, `198.51.100.${1 + (households++ % 250)}`)
  const row = await env.DB.prepare('SELECT u.id AS user_id, h.id AS household_id FROM user u JOIN household h ON h.owner_user_id = u.id WHERE u.email = ?1')
    .bind(email)
    .first<{ user_id: string; household_id: string }>()
  if (!row) throw new Error('no household')
  return { jar, email, userId: row.user_id, householdId: row.household_id, tenant: new Tenant(env, row.household_id, row.user_id) }
}

export async function addMember(h: Household, pan: string, name: string | null) {
  const vault = await h.tenant.vault()
  const { id, stmt } = await memberInsert(h.tenant, vault, { pan, name })
  await stmt.run()
  return id
}

/** A statement row plus its sealed JSON blob, as storeStatement (M7) will write them. */
export async function addStatement(h: Household, memberId: string, opts: { kind?: 'CDSL' | 'CAMS' | 'KFINTECH'; asOf?: string } = {}) {
  const id = crypto.randomUUID()
  const key = blobKeys.statement(h.householdId, id)
  await putJsonBlob(env, await h.tenant.vault(), key, { synthetic: true, holdings: [{ isin: 'INF000000000', units: 1 }] })
  await env.DB.prepare(
    `INSERT INTO statement (id, household_id, member_id, kind, as_of, blob_key, content_hash, parser_version, holdings_count, warnings_count, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'test', 1, 0, ?8)`,
  ).bind(id, h.householdId, memberId, opts.kind ?? 'CAMS', opts.asOf ?? '2026-10-31', key, crypto.randomUUID(), Date.now()).run()
  return { id, key }
}

/** A queued parse job with a parked (sealed) PDF under tmp/, as the queued path (M8) will write it. */
export async function addParkedJob(h: Household, memberId: string | null) {
  const id = crypto.randomUUID()
  const key = blobKeys.parkedPdf(h.householdId, id)
  const pdf = new TextEncoder().encode('%PDF-1.7 synthetic test bytes') as Uint8Array<ArrayBuffer>
  await env.BUCKET.put(key, await sealPdf(await h.tenant.vault(), key, pdf))
  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO parse_job (id, household_id, member_id, blob_key, content_hash, kind, password_source, status, seq, created_at, updated_at, expires_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 'RTA', 'pan', 'queued', 1, ?6, ?6, ?7)`,
  ).bind(id, h.householdId, memberId, key, crypto.randomUUID(), now, now + 86_400_000).run()
  return { id, key }
}

export const count = async (sql: string, ...args: unknown[]) =>
  (await env.DB.prepare(sql).bind(...args).first<{ n: number }>())!.n

export async function r2Keys(prefix: string) {
  return (await env.BUCKET.list({ prefix })).objects.map((o) => o.key)
}
