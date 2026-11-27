// Upload, direct path (plan §10.1 A–C, D19) and DELETE /api/statements/:id, on synthetic PDFs with a fake engine.
// Covers the §16 "Upload", "Pre-check (before storing)" and "No PAN input (D19)" rows; the real engine and private
// statements are in statements.private.test.ts.
import { env } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { blobKeys, getJsonBlob } from '../src/lib/blob'
import { LIMITS } from '../src/lib/limits'
import { fieldKey, panHmac } from '../src/lib/members'
import { quotaWindow } from '../src/lib/quota'
import { contentHash, schemeRows, trackSchemes } from '../src/lib/statements'
import { call } from './helpers/auth'
import { cdslPages, FAKE_PAN, FAKE_PAN_2, FAKE_TRUST_PAN, kfinPages, makePdf } from './helpers/pdf-fixture'
import { addMember, addStatement, count, type Household, newHousehold, r2Keys } from './helpers/tenant'
import { fakeEngine, FUND_A, FUND_B, parsed, statementPdf, upload } from './helpers/upload'
import { engineApi } from '../src/lib/engine-client'

// The first test in a busy run also loads pdf.js into the isolate.
vi.setConfig({ testTimeout: 30_000 })
afterEach(() => {
  vi.restoreAllMocks()
})

const rows = async (h: Household) => ({
  members: await count('SELECT COUNT(*) AS n FROM member WHERE household_id = ?1', h.householdId),
  statements: await count('SELECT COUNT(*) AS n FROM statement WHERE household_id = ?1', h.householdId),
  jobs: await count('SELECT COUNT(*) AS n FROM parse_job WHERE household_id = ?1', h.householdId),
  blobs: (await r2Keys(blobKeys.householdPrefix(h.householdId))).length,
  tmp: (await r2Keys(blobKeys.tmpPrefix(h.householdId))).length,
})
const NOTHING = { members: 0, statements: 0, jobs: 0, blobs: 0, tmp: 0 }

async function addPending(h: Household, pan: string, password: string) {
  const hmac = await panHmac(env, pan)
  const vault = await h.tenant.vault()
  await env.DB.prepare('INSERT INTO pending_statement_password (household_id, pan_hmac, password_enc, expires_at) VALUES (?1, ?2, ?3, ?4)')
    .bind(h.householdId, hmac, await vault.sealText(fieldKey.pendingPassword(hmac), password), Date.now() + 30 * 86_400_000)
    .run()
}

async function setQuota(h: Household, metric: string, period: 'hour' | 'day' | 'month', n: number) {
  await env.DB.prepare('INSERT OR REPLACE INTO quota (subject, metric, window, count) VALUES (?1, ?2, ?3, ?4)')
    .bind(`user:${h.userId}`, metric, quotaWindow(period), n)
    .run()
}

describe('POST /api/statements: direct path', () => {
  it('needs a session', async () => {
    const h = await newHousehold('s0')
    const { res } = await upload(h.jar.without('session'), statementPdf(cdslPages()))
    expect(res.status).toBe(401)
  })

  it('stores a new member\'s statement: sealed JSON in R2, nothing in tmp/, the row, the member from the statement', async () => {
    const h = await newHousehold('s1')
    const calls = fakeEngine(parsed(FAKE_PAN, { name: 'Synthetic Holder', isins: [FUND_A, FUND_B] }))
    const { res, body } = await upload(h.jar, statementPdf(cdslPages(), { userPassword: FAKE_PAN }), { password: FAKE_PAN })
    expect(res.status).toBe(201)
    expect(body.statement).toMatchObject({ kind: 'CDSL', as_of: '2026-10-31', holdings_count: 2, warnings_count: 0 })
    expect(body.member).toMatchObject({ name: 'Synthetic Holder', pan_masked: 'AB••••••4F', created: true })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ password: FAKE_PAN, kind: 'CDSL' })
    expect(await rows(h)).toEqual({ members: 1, statements: 1, jobs: 0, blobs: 1, tmp: 0 })

    const key = blobKeys.statement(h.householdId, body.statement!.id)
    const raw = new Uint8Array(await (await env.BUCKET.get(key))!.arrayBuffer())
    const text = new TextDecoder('latin1').decode(raw)
    expect(text.includes(FAKE_PAN) || text.includes('Synthetic') || text.includes('INF0') || text.includes('%PDF')).toBe(false)
    expect([raw[0], raw[2]]).toEqual([0x01, 0x01]) // sealed blob format 1, gzip flag set
    const blob = await getJsonBlob<{ kind: string; statement: { pan: string } }>(env, await h.tenant.vault(), key)
    expect(blob).toMatchObject({ format: 1, kind: 'CDSL', parser_version: '0.1.0', statement: { pan: FAKE_PAN } })

    const row = await env.DB.prepare('SELECT member_id, content_hash, parser_version, period_from FROM statement WHERE id = ?1').bind(body.statement!.id).first()
    expect(row).toMatchObject({ member_id: body.member!.id, parser_version: '0.1.0', period_from: '2026-10-01' })
    expect(await count("SELECT COUNT(*) AS n FROM audit_event WHERE household_id = ?1 AND event = 'statement_added'", h.householdId)).toBe(1)
    expect(await count("SELECT count AS n FROM quota WHERE subject = ?1 AND metric = 'upload' AND window = ?2", `user:${h.userId}`, quotaWindow('day'))).toBe(1)

    const members = await (await call('/api/members', { jar: h.jar })).json<{ members: { id: string; name: string; statements: unknown[] }[] }>()
    expect(members.members).toEqual([expect.objectContaining({ id: body.member!.id, name: 'Synthetic Holder', statements: [expect.objectContaining({ id: body.statement!.id })] })])
  })

  it('upserts the public scheme ids into MARKET.tracked_scheme (no user link), one statement per 30 rows', async () => {
    const h = await newHousehold('s2')
    fakeEngine(parsed(FAKE_PAN, { kind: 'KFINTECH', isins: [FUND_A, FUND_B, 'INE000X01011'] }))
    const { res } = await upload(h.jar, statementPdf(kfinPages()))
    expect(res.status).toBe(201)
    const tracked = await env.MARKET.prepare('SELECT * FROM tracked_scheme WHERE isin IN (?1, ?2, ?3) ORDER BY isin').bind(FUND_A, FUND_B, 'INE000X01011').all()
    expect(tracked.results.map((r) => [r.isin, r.amfi_code, r.amc])).toEqual([[FUND_A, 100000, 'Example AMC'], [FUND_B, 100001, 'Example AMC']])
    expect(Object.keys(tracked.results[0]!).sort()).toEqual(['amc', 'amfi_code', 'isin', 'last_seen_at'])

    // Unchanged rows seen within a day are skipped; a CDSL statement (no AMFI code) doesn't erase a known code.
    const now = Date.now()
    expect(await trackSchemes(env, [{ isin: FUND_A, amc: 'Example AMC', amfi: '100000' }], now)).toBe(0)
    expect(await trackSchemes(env, [{ isin: FUND_A, amc: 'Example AMC' }], now + 2 * 86_400_000)).toBe(1)
    expect(await env.MARKET.prepare('SELECT amfi_code FROM tracked_scheme WHERE isin = ?1').bind(FUND_A).first('amfi_code')).toBe(100000)

    const many = Array.from({ length: 65 }, (_, i) => ({ isin: `INF999Z${String(i).padStart(5, '0')}`, amc: 'Bulk AMC', amfi: String(500000 + i) }))
    expect(schemeRows(many)).toHaveLength(65)
    expect(await trackSchemes(env, many, now)).toBe(65)
  })

  it('files a second statement under the existing member and never renames them', async () => {
    const h = await newHousehold('s3')
    const memberId = await addMember(h, FAKE_PAN, 'Renamed By User')
    fakeEngine(parsed(FAKE_PAN, { name: 'Holder From Statement' }))
    const { res, body } = await upload(h.jar, statementPdf(cdslPages(), { userPassword: FAKE_PAN }))
    expect(res.status).toBe(201)
    expect(body.member).toEqual({ id: memberId, name: 'Renamed By User', pan_masked: 'AB••••••4F', created: false })
    expect((await rows(h)).members).toBe(1)
  })

  it('an existing member without a name gets the holder\'s name from the statement', async () => {
    const h = await newHousehold('s4')
    const memberId = await addMember(h, FAKE_PAN, null)
    fakeEngine(parsed(FAKE_PAN, { name: 'Holder From Statement' }))
    const { body } = await upload(h.jar, statementPdf(cdslPages()))
    expect(body.member).toMatchObject({ id: memberId, name: 'Holder From Statement', created: false })
    const members = await (await call('/api/members', { jar: h.jar })).json<{ members: { name: string }[] }>()
    expect(members.members[0]!.name).toBe('Holder From Statement')
  })

  it('keeps 24 statements per member: the oldest of the same kind goes, with its blob', async () => {
    const h = await newHousehold('s5')
    const memberId = await addMember(h, FAKE_PAN, 'Synthetic')
    const old = []
    for (let i = 0; i < LIMITS.statementsPerMember; i++) {
      const asOf = new Date(Date.UTC(2024, 0, 1 + i * 10)).toISOString().slice(0, 10) // oldest first
      old.push(await addStatement(h, memberId, { kind: i === 0 ? 'CDSL' : 'CAMS', asOf }))
    }
    fakeEngine(parsed(FAKE_PAN, { kind: 'CAMS', asOf: '2026-10-31' }))
    const { res } = await upload(h.jar, statementPdf(kfinPages()))
    expect(res.status).toBe(201)
    expect((await rows(h)).statements).toBe(LIMITS.statementsPerMember)
    // The oldest CAMS one (index 1) went; the even older CDSL one (index 0) stays: it's another kind.
    const gone = await env.DB.prepare('SELECT id FROM statement WHERE id IN (?1, ?2)').bind(old[0]!.id, old[1]!.id).all()
    expect(gone.results.map((r) => r.id)).toEqual([old[0]!.id])
    expect(await env.BUCKET.head(old[1]!.key)).toBeNull()
    expect(await env.BUCKET.head(old[0]!.key)).not.toBeNull()
  })
})

describe('Upload checks (§16 "Upload")', () => {
  it('rejects a file that is neither a PDF nor a broker file (M34), and a file over 10 MB, storing nothing', async () => {
    const h = await newHousehold('u1')
    const spy = fakeEngine(parsed(FAKE_PAN))
    const notPdf = await upload(h.jar, new TextEncoder().encode('just some text and not a pdf')) // no delimiter: not a CSV either
    expect([notPdf.res.status, notPdf.body.code]).toEqual([422, 'not_broker_file'])
    const big = await upload(h.jar, makePdf(cdslPages(), { padBytes: LIMITS.uploadBytes + 1024 }))
    expect([big.res.status, big.body.code]).toEqual([413, 'file_too_large'])
    expect(spy).toHaveLength(0)
    expect(await rows(h)).toEqual(NOTHING)
  })

  it('a wrong typed password falls through to a candidate that works (the member\'s PAN)', async () => {
    const h = await newHousehold('u2')
    await addMember(h, FAKE_PAN, 'Synthetic')
    const calls = fakeEngine(parsed(FAKE_PAN))
    const { res } = await upload(h.jar, statementPdf(cdslPages(), { userPassword: FAKE_PAN }), { password: 'not-it' })
    expect(res.status).toBe(201)
    expect(calls.map((c) => c.password)).toEqual([FAKE_PAN]) // only the verified one reaches the engine
  })

  it('rejects a statement whose printed PAN differs from the member PAN that opened it', async () => {
    const h = await newHousehold('u3')
    await addMember(h, FAKE_PAN_2, 'Synthetic')
    const calls = fakeEngine(parsed(FAKE_PAN))
    const { res, body } = await upload(h.jar, statementPdf(cdslPages(FAKE_PAN), { userPassword: FAKE_PAN_2 }))
    expect([res.status, body.code]).toEqual([422, 'pan_mismatch'])
    expect(calls).toHaveLength(0)
    expect((await rows(h)).statements).toBe(0)
  })

  it('rejects the engine reading a different PAN than the pre-check (precheck_disagree), storing nothing', async () => {
    const h = await newHousehold('u4')
    fakeEngine(parsed(FAKE_PAN_2))
    const { res, body } = await upload(h.jar, statementPdf(cdslPages(FAKE_PAN)))
    expect([res.status, body.code]).toEqual([422, 'precheck_disagree'])
    expect(await rows(h)).toEqual(NOTHING)
  })

  it('a duplicate is 409, also while the same file is queued', async () => {
    const h = await newHousehold('u5')
    fakeEngine(parsed(FAKE_PAN))
    const pdf = statementPdf(cdslPages())
    expect((await upload(h.jar, pdf)).res.status).toBe(201)
    const again = await upload(h.jar, pdf)
    expect([again.res.status, again.body.code]).toEqual([409, 'already_added'])

    const queued = statementPdf(cdslPages())
    const now = Date.now()
    await env.DB.prepare(
      `INSERT INTO parse_job (id, household_id, content_hash, kind, password_source, status, seq, created_at, updated_at, expires_at)
       VALUES (?1, ?2, ?3, 'CDSL', 'pan', 'queued', 1, ?4, ?4, ?5)`,
    ).bind(crypto.randomUUID(), h.householdId, await contentHash(env, queued), now, now + 86_400_000).run()
    const processing = await upload(h.jar, queued)
    expect([processing.res.status, processing.body.code]).toEqual([409, 'already_processing'])
    expect((await rows(h)).statements).toBe(1)
  })

  it('the same file in another household is not a duplicate', async () => {
    const a = await newHousehold('u6a')
    const b = await newHousehold('u6b')
    fakeEngine(parsed(FAKE_PAN))
    const pdf = statementPdf(cdslPages())
    expect((await upload(a.jar, pdf)).res.status).toBe(201)
    expect((await upload(b.jar, pdf)).res.status).toBe(201)
  })

  it('quotas give 429 with Retry-After: uploads per day and month, failed parses per hour, open jobs', async () => {
    const h = await newHousehold('u7')
    const calls = fakeEngine(parsed(FAKE_PAN))
    const expect429 = async (code: string) => {
      const { res, body } = await upload(h.jar, statementPdf(cdslPages()))
      expect([res.status, body.code]).toEqual([429, code])
      expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0)
      expect(body.retry_after).toBe(Number(res.headers.get('retry-after')))
    }
    await setQuota(h, 'upload', 'day', LIMITS.uploadsPerDay)
    await expect429('upload_limit')
    await setQuota(h, 'upload', 'day', 0)
    await setQuota(h, 'upload', 'month', LIMITS.uploadsPerMonth)
    await expect429('upload_limit')
    await setQuota(h, 'upload', 'month', 0)
    await setQuota(h, 'parse_fail', 'hour', LIMITS.failedParsesPerHour)
    await expect429('too_many_failures')
    await setQuota(h, 'parse_fail', 'hour', 0)
    const now = Date.now()
    for (let i = 0; i < LIMITS.openJobsPerHousehold; i++) {
      await env.DB.prepare(
        `INSERT INTO parse_job (id, household_id, content_hash, kind, password_source, status, seq, created_at, updated_at, expires_at)
         VALUES (?1, ?2, ?3, 'CDSL', 'pan', 'queued', ?4, ?5, ?5, ?6)`,
      ).bind(crypto.randomUUID(), h.householdId, crypto.randomUUID(), i, now, now + 86_400_000).run()
    }
    await expect429('jobs_limit')
    expect(calls).toHaveLength(0)
    expect((await rows(h)).statements).toBe(0)
  })

  it('the upload quota is enforced atomically in the store batch too (a race past the early check)', async () => {
    const h = await newHousehold('u8')
    // The early check reads 19 of 20, then a concurrent upload takes the 20th before this one stores.
    await setQuota(h, 'upload', 'day', LIMITS.uploadsPerDay - 1)
    fakeEngine(async () => {
      await env.DB.prepare("UPDATE quota SET count = ?1 WHERE subject = ?2 AND metric = 'upload' AND window = ?3")
        .bind(LIMITS.uploadsPerDay, `user:${h.userId}`, quotaWindow('day'))
        .run()
      return parsed(FAKE_PAN)
    })
    const { res, body } = await upload(h.jar, statementPdf(cdslPages()))
    expect([res.status, body.code]).toEqual([429, 'upload_limit'])
    expect(await rows(h)).toEqual(NOTHING) // the blob written before the batch was deleted again
  })

  it('failed uploads count toward the hourly failure limit; the first password prompt doesn\'t', async () => {
    const h = await newHousehold('u9')
    fakeEngine(parsed(FAKE_PAN))
    const fails = () => count("SELECT COALESCE(SUM(count), 0) AS n FROM quota WHERE subject = ?1 AND metric = 'parse_fail'", `user:${h.userId}`)
    const locked = statementPdf(cdslPages(), { userPassword: 'secret' })
    expect((await upload(h.jar, locked)).body).toMatchObject({ code: 'password_required', typed: false })
    expect(await fails()).toBe(0)
    expect((await upload(h.jar, locked, { password: 'wrong' })).body).toMatchObject({ code: 'password_required', typed: true })
    expect((await upload(h.jar, statementPdf([['Just a letter']]))).body.code).toBe('unrecognised')
    expect(await fails()).toBe(2)
  })

  it('a failed parse leaves no empty member, no row and no blob', async () => {
    const h = await newHousehold('u10')
    for (const code of ['parse_error', 'multi_pan', 'something_new']) {
      vi.restoreAllMocks()
      fakeEngine({ ok: false, code })
      const { res, body } = await upload(h.jar, statementPdf(kfinPages()))
      expect([res.status, body.code]).toEqual([422, code === 'something_new' ? 'parse_error' : code])
    }
    vi.restoreAllMocks()
    fakeEngine({ ok: false, code: 'parse_timeout' })
    expect((await upload(h.jar, statementPdf(kfinPages()))).res.status).toBe(504)
    vi.restoreAllMocks()
    fakeEngine(parsed(FAKE_PAN, { asOf: 'not a date' }))
    expect((await upload(h.jar, statementPdf(kfinPages()))).body.code).toBe('parse_error')
    expect(await rows(h)).toEqual(NOTHING)
  })

  it('no free slot and the global parked-PDF cap reached: 503 queue_full with Retry-After, nothing stored', async () => {
    const h = await newHousehold('u11')
    vi.spyOn(engineApi, 'acquire').mockResolvedValue({ ok: false, code: 'full', retry_after: 60 })
    const { res, body } = await upload(h.jar, statementPdf(cdslPages()))
    expect([res.status, body.code, res.headers.get('retry-after')]).toEqual([503, 'queue_full', '60'])
    expect(await rows(h)).toEqual(NOTHING)
  })

  it('a missing file or a non-multipart body is a 400', async () => {
    const h = await newHousehold('u12')
    expect((await call('/api/statements', { body: { file: 'x' }, jar: h.jar })).status).toBe(400)
  })
})

describe('Pre-check before storing (§16 "Pre-check")', () => {
  it('wrong password: 422, no R2 object, no parse_job row, and the engine is never called', async () => {
    const h = await newHousehold('p1')
    const calls = fakeEngine(parsed(FAKE_PAN))
    const { res, body } = await upload(h.jar, statementPdf(cdslPages(), { userPassword: 'right' }), { password: 'wrong' })
    expect([res.status, body.code, body.typed]).toEqual([422, 'password_required', true])
    expect(calls).toHaveLength(0)
    expect(await rows(h)).toEqual(NOTHING)
  })

  it('all candidates wrong (members\' PANs, pending passwords, typed): 422', async () => {
    const h = await newHousehold('p2')
    await addMember(h, FAKE_PAN, 'A')
    await addMember(h, FAKE_PAN_2, 'B')
    await addPending(h, 'QWEPR5678T', 'pending-pass')
    fakeEngine(parsed(FAKE_PAN))
    const { res, body } = await upload(h.jar, statementPdf(kfinPages(), { userPassword: 'the-real-one' }), { password: 'typo' })
    expect([res.status, body.code]).toEqual([422, 'password_required'])
  })

  it('finds the right candidate when it is the typed password, a PAN or the pending KFintech password; only that reaches the engine', async () => {
    const h = await newHousehold('p3')
    await addMember(h, FAKE_PAN_2, 'Other')
    await addPending(h, FAKE_PAN, 'kfin-pending')
    const calls = fakeEngine(parsed(FAKE_PAN, { kind: 'KFINTECH' }))

    expect((await upload(h.jar, statementPdf(kfinPages(), { userPassword: 'typed-one' }), { password: '  typed-one ' })).res.status).toBe(201)
    expect((await upload(h.jar, statementPdf(kfinPages(), { userPassword: 'kfin-pending' }))).res.status).toBe(201)
    // The pending password that worked is deleted with the store.
    expect(await count('SELECT COUNT(*) AS n FROM pending_statement_password WHERE household_id = ?1', h.householdId)).toBe(0)
    vi.restoreAllMocks()
    const later = fakeEngine(parsed(FAKE_PAN_2))
    expect((await upload(h.jar, statementPdf(cdslPages(FAKE_PAN_2), { userPassword: FAKE_PAN_2 }))).res.status).toBe(201)
    expect([...calls, ...later].map((c) => c.password)).toEqual(['typed-one', 'kfin-pending', FAKE_PAN_2])
  })

  it('a PAN typed in lower case still opens a CDSL statement', async () => {
    const h = await newHousehold('p4')
    const calls = fakeEngine(parsed(FAKE_PAN))
    const { res } = await upload(h.jar, statementPdf(cdslPages(), { userPassword: FAKE_PAN }), { password: FAKE_PAN.toLowerCase() })
    expect(res.status).toBe(201)
    expect(calls[0]!.password).toBe(FAKE_PAN)
  })

  it('a non-CAS PDF is 422 unrecognised; over 300 pages is 422 too_large', async () => {
    const h = await newHousehold('p5')
    const calls = fakeEngine(parsed(FAKE_PAN))
    expect((await upload(h.jar, statementPdf([['An electricity bill'], ['Page two']]))).body.code).toBe('unrecognised')
    const long = statementPdf([...cdslPages(), ...Array.from({ length: 298 }, () => ['…'])])
    expect((await upload(h.jar, long)).body.code).toBe('too_large')
    expect(calls).toHaveLength(0)
    expect(await rows(h)).toEqual(NOTHING)
  })

  it('a holder PAN split by whitespace is found, and the engine agreeing with it is stored', async () => {
    const h = await newHousehold('p6')
    fakeEngine(parsed(FAKE_PAN, { kind: 'CAMS' }))
    const { res, body } = await upload(h.jar, statementPdf([['Consolidated Account Statement CAMS', 'PAN : ABC PD 1234 F']]))
    expect(res.status).toBe(201)
    expect(body.member!.pan_masked).toBe('AB••••••4F')
  })
})

describe('No PAN input (§16 "No PAN input (D19)")', () => {
  it('ignores pan and member_id fields: the member comes from the statement', async () => {
    const h = await newHousehold('n1')
    const other = await addMember(h, FAKE_PAN_2, 'Someone Else')
    fakeEngine(parsed(FAKE_PAN))
    const { res, body } = await upload(h.jar, statementPdf(cdslPages(FAKE_PAN)), { pan: FAKE_PAN_2, member_id: other })
    expect(res.status).toBe(201)
    expect(body.member!.id).not.toBe(other)
    expect(body.member).toMatchObject({ created: true, pan_masked: 'AB••••••4F' })
  })

  it('with no typed password, a CDSL statement of an existing member opens with their PAN and is filed under them', async () => {
    const h = await newHousehold('n2')
    await addMember(h, FAKE_PAN_2, 'First')
    const memberId = await addMember(h, FAKE_PAN, 'Second')
    const calls = fakeEngine(parsed(FAKE_PAN))
    const { res, body } = await upload(h.jar, statementPdf(cdslPages(FAKE_PAN), { userPassword: FAKE_PAN }))
    expect(res.status).toBe(201)
    expect(body.member).toMatchObject({ id: memberId, name: 'Second', created: false })
    expect(calls[0]!.password).toBe(FAKE_PAN)
  })

  it('a KFintech statement opens with the pending password; the trust PAN is never the holder', async () => {
    const h = await newHousehold('n3')
    await addPending(h, FAKE_PAN, 'kfin-pass-123')
    fakeEngine(parsed(FAKE_PAN, { kind: 'KFINTECH' }))
    const { res, body } = await upload(h.jar, statementPdf(kfinPages(FAKE_PAN), { userPassword: 'kfin-pass-123' }))
    expect(res.status).toBe(201)
    expect(body.statement!.kind).toBe('KFINTECH')
    expect(body.member!.pan_masked).toBe('AB••••••4F')
    const trust = await count('SELECT COUNT(*) AS n FROM member WHERE household_id = ?1 AND pan_hmac = ?2', h.householdId, await panHmac(env, FAKE_TRUST_PAN))
    expect(trust).toBe(0)
  })

  it('the first upload in a new household with no password is 422 with the hint flag, then succeeds once typed', async () => {
    const h = await newHousehold('n4')
    fakeEngine(parsed(FAKE_PAN, { name: 'New Person' }))
    const pdf = statementPdf(cdslPages(), { userPassword: FAKE_PAN })
    const first = await upload(h.jar, pdf)
    expect([first.res.status, first.body.code, first.body.typed]).toEqual([422, 'password_required', false])
    expect(await rows(h)).toEqual(NOTHING)
    const second = await upload(h.jar, pdf, { password: FAKE_PAN })
    expect(second.res.status).toBe(201)
    expect(second.body.member).toMatchObject({ name: 'New Person', pan_masked: 'AB••••••4F', created: true })
  })

  it('member cap: 422 member_limit before the engine runs when the PAN is known, and after the parse when it isn\'t', async () => {
    const h = await newHousehold('n5')
    for (let i = 0; i < LIMITS.membersPerHousehold; i++) await addMember(h, `QQQPQ${String(1000 + i)}Q`, `M${i}`)
    const calls = fakeEngine(parsed(FAKE_PAN))
    const known = await upload(h.jar, statementPdf(cdslPages(FAKE_PAN)))
    expect([known.res.status, known.body.code]).toEqual([422, 'member_limit'])
    expect(calls).toHaveLength(0)
    // No labelled PAN in the PDF: the engine's PAN decides, and the cap is checked then.
    const unlabelled = await upload(h.jar, statementPdf([['CENTRAL DEPOSITORY SERVICES', 'CAS ID 1']]))
    expect([unlabelled.res.status, unlabelled.body.code]).toEqual([422, 'member_limit'])
    expect(calls).toHaveLength(1)
    // An existing member's statement still goes in.
    vi.restoreAllMocks()
    fakeEngine(parsed('QQQPQ1003Q'))
    expect((await upload(h.jar, statementPdf(cdslPages('QQQPQ1003Q')))).res.status).toBe(201)
    expect((await rows(h)).members).toBe(LIMITS.membersPerHousehold)
  })
})

describe('DELETE /api/statements/:id', () => {
  it('deletes the row and its blob, writes an audit row, and leaves the member', async () => {
    const h = await newHousehold('d1')
    fakeEngine(parsed(FAKE_PAN))
    const { body } = await upload(h.jar, statementPdf(cdslPages()))
    const id = body.statement!.id
    const res = await call(`/api/statements/${id}`, { method: 'DELETE', jar: h.jar })
    expect(res.status).toBe(200)
    expect(await rows(h)).toEqual({ members: 1, statements: 0, jobs: 0, blobs: 0, tmp: 0 })
    expect(await count("SELECT COUNT(*) AS n FROM audit_event WHERE household_id = ?1 AND event = 'statement_deleted'", h.householdId)).toBe(1)
    expect((await call(`/api/statements/${id}`, { method: 'DELETE', jar: h.jar })).status).toBe(404)
  })

  it('another household\'s statement, an unknown id and a malformed id are all 404; nothing changes', async () => {
    const a = await newHousehold('d2a')
    const b = await newHousehold('d2b')
    const memberId = await addMember(a, FAKE_PAN, 'A')
    const st = await addStatement(a, memberId)
    for (const id of [st.id, crypto.randomUUID(), 'not-a-uuid', '..%2F..%2Fx']) {
      const res = await call(`/api/statements/${id}`, { method: 'DELETE', jar: b.jar })
      expect([id, res.status]).toEqual([id, 404])
    }
    expect((await rows(a)).statements).toBe(1)
    expect(await env.BUCKET.head(st.key)).not.toBeNull()
    expect(await count("SELECT COUNT(*) AS n FROM audit_event WHERE household_id = ?1 AND event = 'statement_deleted'", b.householdId)).toBe(0)
  })
})
