// Privacy and compliance (plan §12, §16, M14): consent gating, export (all of the user's data and nothing else),
// account deletion (no rows, no R2 objects, no DEK), the DPDP inactivity job and the nightly cleanup.
// All data is synthetic: fake PANs, names and statement JSON.
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { blobKeys, putJsonBlob } from '../src/lib/blob'
import { cleanup, INACTIVE_MS, NOTICE_MS } from '../src/lib/cleanup'
import { NOTICE_VERSION } from '../src/lib/consent'
import { hmacHex } from '../src/lib/crypto'
import type { SinkedEmail } from '../src/lib/email'
import { ensureHousehold } from '../src/lib/household'
import { fieldKey } from '../src/lib/members'
import { sipFieldKey } from '../src/lib/sip-overrides'
import { holdingsKey } from '../src/market/stocks'
import { acceptConsent, call, callWith, countingEnv, requestLoginEmail, signInWithCode, sinkAddress, sinkHeaders } from './helpers/auth'
import { addMember, addParkedJob, addStatement, count, type Household, newHousehold, r2Keys } from './helpers/tenant'

const DAY = 86_400_000

async function sinked(to: string, kind: SinkedEmail['kind']): Promise<SinkedEmail> {
  for (let i = 0; i < 100; i++) {
    const r = await call(`/api/test/email-sink?to=${encodeURIComponent(to)}`, { headers: sinkHeaders() })
    if (r.status === 200) {
      const mail = await r.json<SinkedEmail>()
      if (mail.kind === kind) return mail
    }
    await new Promise((ok) => setTimeout(ok, 50))
  }
  throw new Error(`no ${kind} email in the sink`)
}

/** Every row in the app DB (any table, any column) that holds one of these values. */
async function rowsMentioning(values: string[]): Promise<Record<string, number>> {
  const tables = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'",
  ).all<{ name: string }>()
  const found: Record<string, number> = {}
  for (const { name } of tables.results) {
    const cols = await env.DB.prepare(`SELECT name FROM pragma_table_info(?1)`).bind(name).all<{ name: string }>()
    const where = cols.results.flatMap((c) => values.map((_, i) => `instr(CAST("${c.name}" AS TEXT), ?${i + 1}) > 0`)).join(' OR ')
    const n = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM "${name}" WHERE ${where}`).bind(...values).first<{ n: number }>())!.n
    if (n) found[name] = n
  }
  return found
}

async function addSkip(h: Household, memberId: string, due: string, sip = { isin: 'INF000K01AB1', folio: '1234/56' }) {
  const id = crypto.randomUUID()
  const sealed = await (await h.tenant.vault()).sealText(sipFieldKey(id), JSON.stringify(sip))
  await env.DB.prepare(
    `INSERT INTO sip_override (id, household_id, member_id, sip_key, kind, due, sip_enc, created_at) VALUES (?1, ?2, ?3, ?4, 'skip', ?5, ?6, ?7)`,
  ).bind(id, h.householdId, memberId, crypto.randomUUID(), due, sealed, Date.now()).run()
  return id
}

describe('consent (plan §12 Rule 3)', () => {
  it('blocks data routes with 403 consent_required until the notice is accepted', async () => {
    const email = sinkAddress('c')
    const jar = await signInWithCode(email, undefined, '192.0.2.10', { consent: false })
    const me = await (await call('/api/me', { jar })).json<{ consent_ok: boolean; notice_version: string }>()
    expect(me).toMatchObject({ consent_ok: false, notice_version: NOTICE_VERSION })
    for (const [path, method] of [['/api/members', 'GET'], ['/api/portfolio', 'GET'], ['/api/portfolio/status', 'GET'], ['/api/jobs', 'GET'], ['/api/statements', 'POST']] as const) {
      const res = await call(path, { jar, method })
      expect({ path, status: res.status, body: await res.json() }).toEqual({ path, status: 403, body: { ok: false, code: 'consent_required' } })
    }
    // the rights that need no consent still work
    expect((await call('/api/account/export', { jar })).status).toBe(200)

    expect((await call('/api/consent', { jar, body: { notice_version: '2020-01-01', adult: true } })).status).toBe(409)
    expect(await (await call('/api/consent', { jar, body: { notice_version: NOTICE_VERSION } })).json()).toEqual({ ok: false, code: 'adult_required' })
    await acceptConsent(jar)
    expect((await call('/api/members', { jar })).status).toBe(200)
    expect((await (await call('/api/me', { jar })).json<{ consent_ok: boolean }>()).consent_ok).toBe(true)
    const row = await env.DB.prepare('SELECT c.notice_version, c.withdrawn_at FROM consent c JOIN user u ON u.id = c.user_id WHERE u.email = ?1').bind(email).first()
    expect(row).toEqual({ notice_version: NOTICE_VERSION, withdrawn_at: null })
  })

  it('a consented session needs no D1 query for consent (cookie cache)', async () => {
    const jar = await signInWithCode(sinkAddress('c'), undefined, '192.0.2.11')
    await call('/api/members', { jar }) // warm
    const { env: counted, sql } = countingEnv()
    const res = await callWith(counted, '/api/members', { jar })
    expect(res.status).toBe(200)
    expect(sql.filter((q) => /consent|FROM session|UPDATE session/i.test(q))).toEqual([])
  })

  it('consent given on another device counts at once, and a new sign-in carries it', async () => {
    const email = sinkAddress('c')
    const a = await signInWithCode(email, undefined, '192.0.2.12', { consent: false })
    const b = await signInWithCode(email, undefined, '192.0.2.12', { consent: false })
    await acceptConsent(a)
    expect((await call('/api/members', { jar: b })).status).toBe(200) // b's cookie says no; one D1 check says yes
    const c = await signInWithCode(email, undefined, '192.0.2.12', { consent: false })
    const { env: counted, sql } = countingEnv()
    expect((await callWith(counted, '/api/members', { jar: c })).status).toBe(200)
    expect(sql.filter((q) => /consent/i.test(q))).toEqual([])
  })

  it('a new notice version asks again', async () => {
    const email = sinkAddress('c')
    await signInWithCode(email, undefined, '192.0.2.13')
    await env.DB.prepare(`UPDATE consent SET notice_version = '2020-01-01' WHERE user_id = (SELECT id FROM user WHERE email = ?1)`).bind(email).run()
    const jar = await signInWithCode(email, undefined, '192.0.2.13', { consent: false })
    expect((await call('/api/members', { jar })).status).toBe(403)
  })
})

describe('export (plan §9.2, Rule 14 access)', () => {
  it('contains all of the user’s data, decrypted, and nothing else', async () => {
    const h = await newHousehold('x')
    const other = await newHousehold('y')
    const m1 = await addMember(h, 'ABCDE1234F', 'Test Parent')
    const m2 = await addMember(h, 'PQRST6789K', 'Test Child')
    const s1 = await addStatement(h, m1, { kind: 'CAMS', asOf: '2026-10-31' })
    const s2 = await addStatement(h, m2, { kind: 'CDSL', asOf: '2026-09-30' })
    await addSkip(h, m1, '2026-12-24')
    const om = await addMember(other, 'ZZZZZ9999Z', 'Other Person')
    await addStatement(other, om)

    const res = await call('/api/account/export', { jar: h.jar })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="pocketfolio-export-\d{4}-\d{2}-\d{2}\.json"$/)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const text = await res.text()
    const data = JSON.parse(text)

    expect(data).toMatchObject({ format: 'pocketfolio-export', version: 1, account: { email: h.email }, household: { id: h.householdId } })
    expect(data.account.sign_in_methods.map((a: { provider: string }) => a.provider)).toContain('email')
    expect(data.sessions.length).toBeGreaterThanOrEqual(1)
    expect(data.sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1)
    expect(data.consents).toEqual([expect.objectContaining({ notice_version: NOTICE_VERSION, withdrawn_at: null })])
    expect(data.members).toEqual([
      expect.objectContaining({ id: m1, name: 'Test Parent', pan: 'ABCDE1234F', pan_masked: 'AB••••••4F' }),
      expect.objectContaining({ id: m2, name: 'Test Child', pan: 'PQRST6789K' }),
    ])
    expect(data.statements.map((s: { id: string }) => s.id).sort()).toEqual([s1.id, s2.id].sort())
    for (const s of data.statements) expect(s.data).toEqual({ synthetic: true, holdings: [{ isin: 'INF000000000', units: 1 }] })
    expect(data.sip_changes).toEqual([expect.objectContaining({ member_id: m1, kind: 'skip', date: '2026-12-24', isin: 'INF000K01AB1', folio: '1234/56' })])
    expect(data.security_log.map((e: { event: string }) => e.event)).toContain('consent_given')

    // nothing else: no other household, no internal keys or lookup values, no session token
    for (const v of [other.email, other.householdId, om, 'ZZZZZ9999Z', 'Other Person']) expect(text).not.toContain(v)
    for (const k of ['dek_wrapped', 'pan_hmac', 'pan_enc', 'display_name_enc', 'blob_key', 'content_hash', 'sip_key', 'sip_enc', 'kek_version', '"token"']) {
      expect(text).not.toContain(k)
    }
    for (const v of h.jar.cookies.values()) expect(text).not.toContain(decodeURIComponent(v).split('.')[0]!)
    expect(await count("SELECT COUNT(*) AS n FROM audit_event WHERE household_id = ?1 AND event = 'export'", h.householdId)).toBe(1)
  })

  it('is limited to 3 a day, and needs a session', async () => {
    const h = await newHousehold('x')
    for (let i = 0; i < 3; i++) expect((await call('/api/account/export', { jar: h.jar })).status).toBe(200)
    const res = await call('/api/account/export', { jar: h.jar })
    expect(res.status).toBe(429)
    expect(await res.json()).toMatchObject({ code: 'export_limit' })
    expect((await call('/api/account/export')).status).toBe(401)
  })
})

describe('delete account (plan §8, §9.2, Rule 14 erasure)', () => {
  it('needs the typed confirmation and a session under 10 minutes old', async () => {
    const h = await newHousehold('d')
    expect(await (await call('/api/account', { jar: h.jar, method: 'DELETE', body: {} })).json()).toEqual({ ok: false, code: 'confirm_required' })
    await env.DB.prepare('UPDATE session SET "createdAt" = ?1 WHERE "userId" = ?2').bind(new Date(Date.now() - 11 * 60_000).toISOString(), h.userId).run()
    const res = await call('/api/account', { jar: h.jar, method: 'DELETE', body: { confirm: 'DELETE' } })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ ok: false, code: 'reauth_required' })
    expect(await count('SELECT COUNT(*) AS n FROM household WHERE id = ?1', h.householdId)).toBe(1)
  })

  it('leaves no rows, no R2 objects and no DEK, signs out, and emails a confirmation', async () => {
    const h = await newHousehold('d')
    const keep = await newHousehold('k')
    const m = await addMember(h, 'ABCDE1234F', 'Test Parent')
    await addStatement(h, m)
    await addParkedJob(h, m)
    await addSkip(h, m, '2026-12-24')
    await putJsonBlob(env, await h.tenant.vault(), `${blobKeys.householdPrefix(h.householdId)}snapshot/test.bin`, { synthetic: true })
    const pw = await (await h.tenant.vault()).sealText(fieldKey.pendingPassword('hmac-test'), 'test-password')
    await env.DB.prepare('INSERT INTO pending_statement_password (household_id, pan_hmac, password_enc, expires_at) VALUES (?1, ?2, ?3, ?4)').bind(h.householdId, 'hmac-test', pw, Date.now() + DAY).run()
    expect((await call('/api/account/export', { jar: h.jar })).status).toBe(200) // a quota row
    await requestLoginEmail(h.email) // an unused code and link, and the per-address rate-limit row
    const second = await signInWithCode(h.email, undefined, '192.0.2.20') // a second device
    const km = await addMember(keep, 'PQRST6789K', 'Kept Person')
    await addStatement(keep, km)

    const del = await call('/api/account', { jar: h.jar, method: 'DELETE', body: { confirm: 'DELETE' } })
    expect(del.status).toBe(200)
    expect([...h.jar.cookies.keys()]).toEqual([]) // every Better Auth cookie cleared
    expect((await call('/api/me', { jar: second })).status).toBe(401)

    // no rows anywhere name the user, the household or the address, except the security log (ids only, kept a year)
    expect(await rowsMentioning([h.userId, h.householdId, h.email])).toEqual({ audit_event: expect.any(Number) })
    const audit = await env.DB.prepare('SELECT DISTINCT event FROM audit_event WHERE user_id = ?1 OR household_id = ?2').bind(h.userId, h.householdId).all<{ event: string }>()
    expect(audit.results.map((r) => r.event)).toContain('account_deleted')
    const auditCols = await env.DB.prepare('SELECT * FROM audit_event WHERE household_id = ?1 LIMIT 1').bind(h.householdId).first()
    expect(Object.keys(auditCols!).sort()).toEqual(['at', 'event', 'household_id', 'id', 'ip_country', 'ua_hash', 'user_id'])
    const addrKey = await hmacHex(env.BETTER_AUTH_SECRET, `rl:login-email:addr:${h.email}`)
    expect(await count('SELECT COUNT(*) AS n FROM rate_limit WHERE key = ?1', addrKey)).toBe(0)
    // no DEK, no objects
    expect(await count('SELECT COUNT(*) AS n FROM household WHERE id = ?1', h.householdId)).toBe(0)
    expect(await r2Keys(blobKeys.householdPrefix(h.householdId))).toEqual([])
    expect(await r2Keys(blobKeys.tmpPrefix(h.householdId))).toEqual([])
    // the other household is untouched
    expect(await count('SELECT COUNT(*) AS n FROM member WHERE household_id = ?1', keep.householdId)).toBe(1)
    expect((await r2Keys(blobKeys.householdPrefix(keep.householdId))).length).toBe(1)
    expect((await call('/api/members', { jar: keep.jar })).status).toBe(200)

    const mail = await sinked(h.email, 'account_deleted')
    expect(mail.subject).toBe('Your PocketFolio account was deleted')
    expect(mail.text).not.toContain('Test Parent')
    // the old cookie can't come back
    expect((await call('/api/account', { jar: second, method: 'DELETE', body: { confirm: 'DELETE' } })).status).toBe(401)
  }, 30_000)

  it('signing up again with the same address starts from nothing', async () => {
    const h = await newHousehold('d')
    await addMember(h, 'ABCDE1234F', 'Test Parent')
    await call('/api/account', { jar: h.jar, method: 'DELETE', body: { confirm: 'DELETE' } })
    const jar = await signInWithCode(h.email, undefined, '192.0.2.21', { consent: false })
    expect((await call('/api/members', { jar })).status).toBe(403) // consent went with the account
    await acceptConsent(jar)
    expect(await (await call('/api/members', { jar })).json()).toEqual({ members: [] })
  })
})

describe('inactivity (plan §12, Rule 8)', () => {
  const setActive = (h: Household, at: number) => env.DB.prepare('UPDATE household SET last_active_at = ?1 WHERE id = ?2').bind(at, h.householdId).run()
  const notice = (h: Household) => env.DB.prepare('SELECT inactivity_notice_at AS at FROM household WHERE id = ?1').bind(h.householdId).first<{ at: number | null }>()

  it('emails a notice after 3 years, erases 48 h later, and a sign-in in between keeps the account', async () => {
    const now = Date.now()
    const idle = await newHousehold('i')
    const back = await newHousehold('i')
    const active = await newHousehold('i')
    await addStatement(idle, await addMember(idle, 'ABCDE1234F', 'Idle Person'))
    await setActive(idle, now - INACTIVE_MS - DAY)
    await setActive(back, now - INACTIVE_MS - DAY)
    await setActive(active, now - INACTIVE_MS + DAY)

    const first = await cleanup(env, { now })
    expect(first.inactivity_notices).toBeGreaterThanOrEqual(2)
    expect((await notice(idle))?.at).toBe(now)
    expect((await notice(back))?.at).toBe(now)
    expect((await notice(active))?.at).toBeNull()
    const mail = await sinked(idle.email, 'inactivity_notice')
    expect(mail.subject).toBe('Your PocketFolio account will be deleted in 2 days')
    expect(mail.text).toContain('3 years')
    expect(mail.text).toContain('/login')

    // a day later: no second notice, nothing erased yet
    await cleanup(env, { now: now + DAY })
    expect((await notice(idle))?.at).toBe(now)
    expect(await count('SELECT COUNT(*) AS n FROM household WHERE id = ?1', idle.householdId)).toBe(1)

    // `back` signs in again: the notice is cancelled
    await ensureHousehold(env, back.userId, now + DAY)
    expect((await notice(back))?.at).toBeNull()

    await cleanup(env, { now: now + NOTICE_MS })
    expect(await count('SELECT COUNT(*) AS n FROM household WHERE id = ?1', idle.householdId)).toBe(0)
    expect(await count('SELECT COUNT(*) AS n FROM user WHERE id = ?1', idle.userId)).toBe(0)
    expect(await r2Keys(blobKeys.householdPrefix(idle.householdId))).toEqual([])
    expect(await rowsMentioning([idle.userId, idle.householdId, idle.email])).toEqual({ audit_event: expect.any(Number) })
    expect(await count("SELECT COUNT(*) AS n FROM audit_event WHERE household_id = ?1 AND event = 'account_erased_inactive'", idle.householdId)).toBe(1)
    expect((await sinked(idle.email, 'account_deleted')).text).toContain('3 years')
    expect(await count('SELECT COUNT(*) AS n FROM household WHERE id = ?1', back.householdId)).toBe(1)
    expect(await count('SELECT COUNT(*) AS n FROM household WHERE id = ?1', active.householdId)).toBe(1)
  }, 30_000)

  it('using the app (the daily session refresh) counts as activity', async () => {
    const h = await newHousehold('i')
    const old = Date.now() - INACTIVE_MS - DAY
    await setActive(h, old)
    await env.DB.prepare('UPDATE household SET inactivity_notice_at = ?1 WHERE id = ?2').bind(old + DAY, h.householdId).run()
    // a session last refreshed 2 days ago: the next D1 session read refreshes it (updateAge 1 day)
    await env.DB.prepare('UPDATE session SET "expiresAt" = ?1 WHERE "userId" = ?2').bind(new Date(Date.now() + 28 * DAY).toISOString(), h.userId).run()
    expect((await call('/api/members', { jar: h.jar.without('session_data') })).status).toBe(200)
    const row = await env.DB.prepare('SELECT last_active_at, inactivity_notice_at FROM household WHERE id = ?1').bind(h.householdId).first<{ last_active_at: number; inactivity_notice_at: number | null }>()
    expect(row!.last_active_at).toBeGreaterThan(Date.now() - 60_000)
    expect(row!.inactivity_notice_at).toBeNull()
  })
})

describe('nightly cleanup (plan §10.3)', () => {
  it('deletes expired and finished rows, and keeps current ones', async () => {
    const now = Date.now()
    const h = await newHousehold('n')
    const m = await addMember(h, 'ABCDE1234F', 'Test Parent')
    await addStatement(h, m, { asOf: '2026-10-31' })
    const oldSkip = await addSkip(h, m, '2026-10-24') // covered by the statement
    const newSkip = await addSkip(h, m, '2026-12-24', { isin: 'INF000K01AB2', folio: '1' })
    const db = env.DB
    const iso = (ms: number) => new Date(ms).toISOString()
    await db.batch([
      db.prepare('INSERT INTO rate_limit (key, count, reset_at) VALUES (?1, 1, ?2), (?3, 1, ?4)').bind('rl-old', now - 1000, 'rl-new', now + 60_000),
      db.prepare("INSERT INTO quota (subject, metric, window, count) VALUES ('user:t', 'upload', ?1, 1), ('user:t', 'upload', ?2, 1), ('user:t', 'upload', ?3, 1)").bind('2025-01', '2025-01-02', '2025-01-02T03'),
      db.prepare("INSERT INTO quota (subject, metric, window, count) VALUES ('user:t2', 'upload', ?1, 1), ('user:t2', 'upload', ?2, 1)").bind(new Date(now + 19_800_000).toISOString().slice(0, 7), new Date(now + 19_800_000).toISOString().slice(0, 10)),
      db.prepare(
        `INSERT INTO parse_job (id, household_id, content_hash, kind, password_source, status, seq, created_at, updated_at, expires_at)
         VALUES (?1, ?2, ?3, 'RTA', 'pan', 'done', 1, ?4, ?4, ?5), (?6, ?2, ?7, 'RTA', 'pan', 'failed', 2, ?8, ?8, ?9)`,
      ).bind('00000000-0000-4000-8000-000000000001', h.householdId, 'old-job', now - 10 * DAY, now - 9 * DAY, '00000000-0000-4000-8000-000000000002', 'new-job', now - DAY, now),
      db.prepare('INSERT INTO verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt") VALUES (?1, ?2, ?3, ?4, ?5, ?5), (?6, ?7, ?3, ?8, ?5, ?5)')
        .bind('v-old', 'test-old', '{}', iso(now - 1000), iso(now - DAY), 'v-new', 'test-new', iso(now + 600_000)),
      db.prepare(`INSERT INTO session (id, "expiresAt", token, "createdAt", "updatedAt", "userId") VALUES ('s-old', ?1, 's-old-token', ?2, ?2, ?3)`).bind(iso(now - 1000), iso(now - 31 * DAY), h.userId),
      db.prepare("INSERT INTO audit_event (user_id, household_id, event, at) VALUES ('u-old', 'h-old', 'statement_added', ?1), ('u-new', 'h-new', 'statement_added', ?2)").bind(now - 401 * DAY, now - 399 * DAY),
    ])
    const mk = env.MARKET
    const oldKey = holdingsKey('INF000T01OLD', '2026-05')
    const newKey = holdingsKey('INF000T01NEW', '2026-10')
    await env.BUCKET.put(oldKey, '{}')
    await env.BUCKET.put(newKey, '{}')
    await mk.batch([
      mk.prepare('INSERT INTO tracked_scheme (isin, last_seen_at) VALUES (?1, ?2), (?3, ?4)').bind('INF000T01OLD', now - 91 * DAY, 'INF000T01NEW', now - DAY),
      mk.prepare("INSERT INTO nav_run (job, at, ok, parsed, inserted) VALUES ('nav-ingest', ?1, 1, 0, 0), ('nav-ingest', ?2, 1, 0, 0)").bind(now - 91 * DAY, now - DAY),
      mk.prepare('INSERT INTO stock_match (isin, wanted_at) VALUES (?1, ?2), (?3, ?4)').bind('INF000T01OLD', now - 91 * DAY, 'INF000T01NEW', now - DAY),
      mk.prepare("INSERT INTO fund_portfolio (scheme_isin, month, source, blob_key, fetched_at) VALUES (?1, '2026-05', 'bharatstock', ?2, ?3), (?4, '2026-10', 'bharatstock', ?5, ?3)")
        .bind('INF000T01OLD', oldKey, now, 'INF000T01NEW', newKey),
    ])

    const out = await cleanup(env, { now })
    expect(Object.values(out).every((n) => n >= 0)).toBe(true) // no step failed

    const keys = async (sql: string, ...args: unknown[]) => (await db.prepare(sql).bind(...args).all<{ k: string }>()).results.map((r) => r.k)
    expect(await keys("SELECT key AS k FROM rate_limit WHERE key IN ('rl-old','rl-new')")).toEqual(['rl-new'])
    expect(await count("SELECT COUNT(*) AS n FROM quota WHERE subject = 'user:t'")).toBe(0)
    expect(await count("SELECT COUNT(*) AS n FROM quota WHERE subject = 'user:t2'")).toBe(2)
    expect(await keys("SELECT content_hash AS k FROM parse_job WHERE household_id = ?1", h.householdId)).toEqual(['new-job'])
    expect(await keys("SELECT id AS k FROM verification WHERE id IN ('v-old','v-new')")).toEqual(['v-new'])
    expect(await count("SELECT COUNT(*) AS n FROM session WHERE id = 's-old'")).toBe(0)
    expect(await count('SELECT COUNT(*) AS n FROM session WHERE "userId" = ?1', h.userId)).toBe(1) // the live one
    expect(await keys("SELECT household_id AS k FROM audit_event WHERE household_id IN ('h-old','h-new')")).toEqual(['h-new'])
    expect(await keys('SELECT id AS k FROM sip_override WHERE household_id = ?1', h.householdId)).toEqual([newSkip])
    expect(oldSkip).not.toBe(newSkip)

    const mkeys = async (sql: string) => (await mk.prepare(sql).all<{ k: string }>()).results.map((r) => r.k)
    expect(await mkeys("SELECT isin AS k FROM tracked_scheme WHERE isin LIKE 'INF000T01%'")).toEqual(['INF000T01NEW'])
    expect(await mkeys("SELECT isin AS k FROM stock_match WHERE isin LIKE 'INF000T01%'")).toEqual(['INF000T01NEW'])
    expect(await mkeys("SELECT scheme_isin AS k FROM fund_portfolio WHERE scheme_isin LIKE 'INF000T01%'")).toEqual(['INF000T01NEW'])
    expect(await env.BUCKET.head(oldKey)).toBeNull()
    expect(await env.BUCKET.head(newKey)).not.toBeNull()
    expect((await mk.prepare("SELECT COUNT(*) AS n FROM nav_run WHERE at < ?1").bind(now - 90 * DAY).first<{ n: number }>())!.n).toBe(0)
    // the household itself is untouched
    expect((await call('/api/members', { jar: h.jar })).status).toBe(200)
  })
})
