// The user's data rights (plan §12 Rule 14, §9.2): access (GET /api/account/export) and erasure (DELETE /api/account,
// and the DPDP inactivity erasure in lib/cleanup.ts).
//
// Export: everything stored about the user, decrypted, and nothing else. Internal keys and lookup values (the DEK,
// PAN HMACs, R2 keys, content hashes, session tokens) are not "their data" and would only help an attacker who got
// the file, so they're left out. Snapshots are left out too: they're computed from the statements below plus public
// NAVs, and the dashboard shows them.
//
// Deletion is crypto-shredding (§8): shredHousehold() destroys the DEK first, then the R2 prefixes, then the rows.
// Then every row that names the user goes: user (cascades session, account, consent), quota counters, pending
// sign-in codes and links, the per-address sign-in rate limit. The security log (audit_event) is kept: it holds
// only random ids, a country and a UA hash, DPDP Rule 6(1)(e) and 8(3) want logs for a year, and cleanup deletes
// rows older than AUDIT_RETENTION_MS.
import { AUDIT_RETENTION_MS, type AuditEvent } from './audit'
import { blobKeys, deletePrefix, openJson } from './blob'
import { type Bytes, hmacHex, Vault } from './crypto'
import type { DeletedEmailJob } from './email'
import { shredHousehold } from './household'
import { assetFieldKey } from './assets'
import { type Asset, assetName, isMetalType, RATES, type RateTable, todayIst, valueAsset } from './manual-assets'
import { readMetalRates } from '../market/metals'
import { fieldKey } from './members'
import { sipFieldKey } from './sip-overrides'

export { AUDIT_RETENTION_MS }

/** The rates the export values with: gold and silver need the market DB's (M29); read once per export, only if needed. */
const exportRateCache = new WeakMap<object, Promise<RateTable>>()
function exportRates(env: AccountEnv, rows: { type?: unknown }[], today: string): Promise<RateTable> {
  if (!env.MARKET || !rows.some((r) => isMetalType(r.type as Asset['type']))) return Promise.resolve(RATES)
  let p = exportRateCache.get(rows)
  if (!p) {
    const market = env.MARKET
    p = readMetalRates({ MARKET: market }, Number(today.replace(/-/g, ''))).then((metals) => ({ ...RATES, metals }), () => RATES)
    exportRateCache.set(rows, p)
  }
  return p
}

/** A session must be this fresh to delete the account (plan §9.2: "a session less than 10 min old"). */
export const DELETE_REAUTH_MS = 10 * 60_000
/** The typed confirmation (plan §13 item 7). */
export const DELETE_CONFIRM = 'DELETE'

type AccountEnv = Pick<Env, 'DB' | 'BUCKET' | 'Q_EMAIL' | 'BETTER_AUTH_SECRET' | 'DATA_KEK_V1'> & { MARKET?: D1Database }

export type DeleteTarget = { userId: string; householdId: string; email: string }
export type AuditMeta = { country: string | null; uaHash: string | null }

/**
 * Delete one account and everything in it. Idempotent: a second call finds nothing left and still succeeds.
 * Returns the number of R2 objects removed.
 */
export async function deleteAccount(
  env: AccountEnv,
  target: DeleteTarget,
  opts: { event: Extract<AuditEvent, 'account_deleted' | 'account_erased_inactive'>; meta?: AuditMeta; now?: number },
): Promise<{ objects: number }> {
  const { userId, householdId, email } = target
  const now = opts.now ?? Date.now()
  const { objects } = await shredHousehold(env, householdId)
  const addrLimit = await hmacHex(env.BETTER_AUTH_SECRET, `rl:login-email:addr:${email.toLowerCase()}`) // routes/auth.ts
  const db = env.DB
  await db.batch([
    db.prepare('DELETE FROM quota WHERE subject IN (?1, ?2)').bind(`user:${userId}`, `household:${householdId}`),
    // email-OTP codes are keyed "{type}-otp-{email}", magic links carry the address in their JSON value
    db
      .prepare(
        `DELETE FROM verification WHERE identifier IN ('sign-in-otp-' || ?1, 'email-verification-otp-' || ?1, 'forget-password-otp-' || ?1)
           OR (identifier LIKE 'magic-link:%' AND json_valid(value) AND json_extract(value, '$.email') = ?1)`,
      )
      .bind(email.toLowerCase()),
    db.prepare('DELETE FROM rate_limit WHERE key = ?1').bind(addrLimit),
    db.prepare('DELETE FROM "deviceCode" WHERE "userId" = ?1').bind(userId), // QR codes claimed by this user (M13)
    db.prepare('DELETE FROM user WHERE id = ?1').bind(userId), // cascades session, account, consent
    db
      .prepare('INSERT INTO audit_event (user_id, household_id, event, ip_country, ua_hash, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
      .bind(userId, householdId, opts.event, opts.meta?.country ?? null, opts.meta?.uaHash ?? null, now),
  ])
  // A build or parse that was already running may have written a sealed object after the first sweep. It can't be
  // read (the DEK is gone), but it shouldn't linger either.
  const late = (await deletePrefix(env, blobKeys.householdPrefix(householdId))) + (await deletePrefix(env, blobKeys.tmpPrefix(householdId)))
  const job: DeletedEmailJob = { kind: 'account_deleted', to: email, reason: opts.event === 'account_deleted' ? 'user' : 'inactive', created_at: now }
  try {
    await env.Q_EMAIL.send(job)
  } catch (err) {
    console.error('account_deleted_email_failed', (err as Error).name) // the account is gone either way
  }
  return { objects: objects + late }
}

// ─── Export ─────────────────────────────────────────────────────────────────────────────────────────────────────

export const EXPORT_FORMAT = 'pocketfolio-export'
export const EXPORT_VERSION = 1

const iso = (ms: number | string | null | undefined) => {
  if (ms === null || ms === undefined) return null
  const d = new Date(typeof ms === 'string' && /^\d+$/.test(ms) ? Number(ms) : ms)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

type Row = Record<string, unknown>

/**
 * The export as a stream of JSON text: the small sections first, then each statement's parsed data, opened one at a
 * time so a large household never sits in memory at once. A failure part-way aborts the stream, so the download
 * fails instead of producing a truncated file that looks complete.
 */
export async function exportAccount(
  env: AccountEnv,
  who: { userId: string; householdId: string; sessionId: string },
  now = Date.now(),
): Promise<ReadableStream<Uint8Array>> {
  const db = env.DB
  const { userId, householdId } = who
  const [user, accounts, sessions, consents, household, members, statements, sips, jobs, pending, audit, assets] = await db.batch<Row>([
    db.prepare('SELECT id, name, email, "emailVerified" AS email_verified, image, "createdAt" AS created_at FROM user WHERE id = ?1').bind(userId),
    db.prepare('SELECT "providerId" AS provider, "createdAt" AS created_at FROM account WHERE "userId" = ?1 ORDER BY "createdAt"').bind(userId),
    db
      .prepare('SELECT id, "createdAt" AS created_at, "updatedAt" AS updated_at, "expiresAt" AS expires_at, "ipAddress" AS ip_address, "userAgent" AS user_agent, city, country, "linkedAt" AS linked_at FROM session WHERE "userId" = ?1 ORDER BY "createdAt"')
      .bind(userId),
    db.prepare('SELECT notice_version, accepted_at, withdrawn_at FROM consent WHERE user_id = ?1 ORDER BY accepted_at').bind(userId),
    db.prepare('SELECT id, created_at, last_active_at, dek_wrapped, kek_version FROM household WHERE id = ?1 AND owner_user_id = ?2').bind(householdId, userId),
    db.prepare('SELECT id, pan_enc, pan_masked, display_name_enc, created_at FROM member WHERE household_id = ?1 ORDER BY created_at, id').bind(householdId),
    db
      .prepare(
        `SELECT id, member_id, kind, as_of, period_from, parser_version, holdings_count, warnings_count, created_at, blob_key
         FROM statement WHERE household_id = ?1 ORDER BY as_of, created_at`,
      )
      .bind(householdId),
    db.prepare('SELECT id, member_id, kind, due, sip_enc, created_at FROM sip_override WHERE household_id = ?1 ORDER BY created_at').bind(householdId),
    db
      .prepare('SELECT id, member_id, kind, status, error_code, statement_id, created_at FROM parse_job WHERE household_id = ?1 ORDER BY created_at')
      .bind(householdId),
    db.prepare('SELECT pan_hmac, password_enc, expires_at FROM pending_statement_password WHERE household_id = ?1').bind(householdId),
    db
      .prepare('SELECT event, ip_country, at FROM audit_event WHERE (user_id = ?1 OR household_id = ?2) AND at > ?3 ORDER BY at')
      .bind(userId, householdId, now - AUDIT_RETENTION_MS),
    db.prepare('SELECT id, type, member_id, inputs_enc, created_at, updated_at FROM manual_asset WHERE household_id = ?1 ORDER BY created_at, id').bind(householdId),
  ])
  const h = household?.results[0] as { id: string; created_at: number; last_active_at: number; dek_wrapped: Bytes; kek_version: number } | undefined
  const u = user?.results[0]
  if (!h || !u) throw new ExportError('account gone')
  const vault = await Vault.fromRow(env, householdId, h)
  const open = (key: string, sealed: unknown) => (sealed ? vault.openText(key, sealed as Bytes) : Promise.resolve(null))
  const today = todayIst(now)

  const head = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exported_at: iso(now),
    about:
      'Everything PocketFolio stores about you, decrypted. Statement data is what we read from your PDFs (the PDFs themselves are never kept). Keep this file safe: it contains your PANs and holdings.',
    account: {
      id: u.id,
      name: u.name,
      email: u.email,
      email_verified: !!u.email_verified,
      image: u.image ?? null,
      created_at: iso(u.created_at as string),
      // Email links and codes work for every account (Better Auth keeps no row for them); Google etc. are linked accounts.
      sign_in_methods: [
        { provider: 'email', linked_at: iso(u.created_at as string) },
        ...(accounts?.results ?? []).filter((a) => !['email-otp', 'magic-link', 'credential'].includes(a.provider as string)).map((a) => ({ provider: a.provider, linked_at: iso(a.created_at as string) })),
      ],
    },
    sessions: (sessions?.results ?? []).map((s) => ({
      current: s.id === who.sessionId,
      signed_in_at: iso(s.created_at as string),
      last_refreshed_at: iso(s.updated_at as string),
      expires_at: iso(s.expires_at as string),
      ip_address: s.ip_address ?? null,
      user_agent: s.user_agent ?? null,
      city: s.city ?? null,
      country: s.country ?? null,
      linked_by_qr_at: iso((s.linked_at as number | null) ?? null),
    })),
    consents: (consents?.results ?? []).map((c) => ({ notice_version: c.notice_version, accepted_at: iso(c.accepted_at as number), withdrawn_at: iso(c.withdrawn_at as number | null) })),
    household: { id: h.id, created_at: iso(h.created_at), last_active_at: iso(h.last_active_at) },
    members: await Promise.all(
      (members?.results ?? []).map(async (m) => ({
        id: m.id,
        name: await open(fieldKey.name(m.id as string), m.display_name_enc),
        pan: await open(fieldKey.pan(m.id as string), m.pan_enc),
        pan_masked: m.pan_masked,
        created_at: iso(m.created_at as number),
      })),
    ),
    sip_changes: await Promise.all(
      (sips?.results ?? []).map(async (s) => {
        const sip = JSON.parse((await open(sipFieldKey(s.id as string), s.sip_enc)) ?? '{}') as { isin?: string; folio?: string | null }
        return { member_id: s.member_id, kind: s.kind, date: s.due, isin: sip.isin ?? null, folio: sip.folio ?? null, created_at: iso(s.created_at as number) }
      }),
    ),
    // FD, PPF and EPF entered by hand (M19): the inputs as typed, and today's approximate values worked out from them.
    manual_assets: await Promise.all(
      (assets?.results ?? []).map(async (a, _i, all) => {
        const inputs = JSON.parse((await open(assetFieldKey(a.id as string), a.inputs_enc)) ?? '{}')
        const asset = { type: a.type, inputs } as Asset
        const { flows: _flows, ...value } = valueAsset(asset, today, await exportRates(env, all, today))
        return {
          id: a.id,
          type: a.type,
          member_id: a.member_id ?? null,
          name: assetName(asset),
          inputs,
          approximate_value: { as_of: today, ...value },
          created_at: iso(a.created_at as number),
          updated_at: iso(a.updated_at as number),
        }
      }),
    ),
    uploads: (jobs?.results ?? []).map((j) => ({
      id: j.id,
      member_id: j.member_id ?? null,
      kind: j.kind,
      status: j.status,
      error_code: j.error_code ?? null,
      statement_id: j.statement_id ?? null,
      created_at: iso(j.created_at as number),
    })),
    pending_statement_passwords: await Promise.all(
      (pending?.results ?? []).map(async (p) => ({
        password: await open(fieldKey.pendingPassword(p.pan_hmac as string), p.password_enc),
        expires_at: iso(p.expires_at as number),
      })),
    ),
    security_log: (audit?.results ?? []).map((a) => ({ event: a.event, country: a.ip_country ?? null, at: iso(a.at as number) })),
  }

  const list = (statements?.results ?? []) as (Row & { id: string; blob_key: string })[]
  const enc = new TextEncoder()
  let i = -1
  return new ReadableStream<Uint8Array>({
    async pull(ctl) {
      try {
        if (i === -1) {
          ctl.enqueue(enc.encode(`${JSON.stringify(head, null, 1).slice(0, -2)},\n "statements": [`))
        } else if (i < list.length) {
          const s = list[i]!
          const obj = await env.BUCKET.get(s.blob_key)
          if (!obj) throw new ExportError('statement blob missing')
          const data = await openJson(vault, s.blob_key, await obj.arrayBuffer())
          const { blob_key: _key, ...meta } = s
          const out = { ...meta, created_at: iso(s.created_at as number), data }
          ctl.enqueue(enc.encode(`${i ? ',' : ''}\n  ${JSON.stringify(out)}`))
        } else {
          ctl.enqueue(enc.encode('\n ]\n}\n'))
          ctl.close()
        }
        i++
      } catch (err) {
        console.error('export_failed', (err as Error).name)
        ctl.error(err)
      }
    },
  })
}

export class ExportError extends Error {
  override name = 'ExportError'
}
