// Upload, queued path (plan §10.1 D, §9.2 jobs, §10.3 tmp-sweep), on synthetic PDFs with a fake engine container.
// Covers the §16 "Queued upload" row with the real EnginePool forced to 0 free slots (every lease held), and the
// parked-PDF cap from the "EnginePool" row. The consumer runs on captured messages, except in the last test, which
// goes through the real pf-parse queue.
import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../src/index'
import { blobKeys, openPdf } from '../src/lib/blob'
import { enginePool } from '../src/lib/engine-client'
import { shredHousehold } from '../src/lib/household'
import { JOB_TTL_MS, LOST_MS, MAX_ATTEMPTS, parkUpload, runParseJob, tmpSweep, waitDelay } from '../src/lib/jobs'
import { LIMITS } from '../src/lib/limits'
import { fieldKey, panHmac } from '../src/lib/members'
import { contentHash } from '../src/lib/statements'
import { call } from './helpers/auth'
import { cdslPages, FAKE_PAN, FAKE_PAN_2, kfinPages } from './helpers/pdf-fixture'
import { addMember, count, type Household, newHousehold, r2Keys } from './helpers/tenant'
import { captureQueue, deliver, fakeEngine, fillPool, parsed, statementPdf, upload } from './helpers/upload'

vi.setConfig({ testTimeout: 30_000 })
let freePool: (() => Promise<void>) | null = null
afterEach(async () => {
  vi.restoreAllMocks()
  await freePool?.()
  freePool = null
})

/** Hold every fast slot, so the next upload is queued. */
async function forceQueue() {
  freePool = await fillPool()
}
async function releasePool() {
  await freePool?.()
  freePool = null
}

type JobRow = {
  status: string
  kind: string
  password_source: string
  password_enc: ArrayBuffer | null
  blob_key: string | null
  member_id: string | null
  pan_hmac: string | null
  attempts: number
  seq: number
  error_code: string | null
  statement_id: string | null
  expires_at: number
  created_at: number
  updated_at: number
  pdf_bytes: number
  user_id: string | null
}
const jobRow = (id: string) => env.DB.prepare('SELECT * FROM parse_job WHERE id = ?1').bind(id).first<JobRow>()
const tmpKeys = (h: Household) => r2Keys(blobKeys.tmpPrefix(h.householdId))
const statements = (h: Household) => count('SELECT COUNT(*) AS n FROM statement WHERE household_id = ?1', h.householdId)
const members = (h: Household) => count('SELECT COUNT(*) AS n FROM member WHERE household_id = ?1', h.householdId)

async function queuedUpload(h: Household, pdf: Uint8Array<ArrayBuffer>, fields: Record<string, string> = {}) {
  const { res, body } = await upload(h.jar, pdf, fields)
  expect([res.status, body.code]).toEqual([202, undefined])
  return body.job!
}

describe('POST /api/statements with no free engine slot (§16 "Queued upload")', () => {
  it('202 with position and ETA; the parked PDF is sealed (no %PDF in a raw read); after processing it is gone and blob_key is NULL', async () => {
    const h = await newHousehold('q1')
    const sent = captureQueue()
    await forceQueue()
    const pdf = statementPdf(cdslPages(), { userPassword: 'typed-secret' })
    const job = await queuedUpload(h, pdf, { password: 'typed-secret' })
    expect(job.position).toBeGreaterThanOrEqual(1)
    expect(job.eta_s).toBeGreaterThan(0)
    expect(sent).toEqual([{ job_id: job.id, delay: 0 }])

    // Parked: one sealed object under tmp/, nothing under h/, no statement or member yet.
    const key = blobKeys.parkedPdf(h.householdId, job.id)
    expect(await tmpKeys(h)).toEqual([key])
    expect(await r2Keys(blobKeys.householdPrefix(h.householdId))).toEqual([])
    const raw = new Uint8Array(await (await env.BUCKET.get(key))!.arrayBuffer())
    const text = new TextDecoder('latin1').decode(raw)
    expect(text.includes('%PDF') || text.includes('typed-secret')).toBe(false)
    expect([raw[0], raw[2]]).toEqual([0x01, 0x00]) // sealed blob format 1, gzip flag clear (§8)
    expect(await openPdf(await h.tenant.vault(), key, raw)).toEqual(pdf)

    const row = (await jobRow(job.id))!
    expect(row).toMatchObject({ status: 'queued', kind: 'CDSL', password_source: 'typed', blob_key: key, attempts: 0, user_id: h.userId, pdf_bytes: pdf.length })
    expect(row.expires_at - row.created_at).toBe(JOB_TTL_MS)
    // The typed password is kept only sealed, bound to this job.
    const sealedPassword = new TextDecoder('latin1').decode(new Uint8Array(row.password_enc!))
    expect(sealedPassword.includes('typed-secret')).toBe(false)
    expect(await (await h.tenant.vault()).openText(fieldKey.jobPassword(job.id), row.password_enc!)).toBe('typed-secret')
    // The upload quota was taken when it was parked.
    expect(await count("SELECT COALESCE(SUM(count), 0) AS n FROM quota WHERE subject = ?1 AND metric = 'upload'", `user:${h.userId}`)).toBe(2)
    expect(await statements(h)).toBe(0)

    // Its turn: the consumer parses it with the verified password and stores the statement.
    await releasePool()
    const calls = fakeEngine(parsed(FAKE_PAN, { name: 'Queued Holder' }))
    const result = await deliver(job.id)
    expect(result.explicitAcks).toEqual([`m-${job.id}`])
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ password: 'typed-secret', kind: 'CDSL' })
    expect(await tmpKeys(h)).toEqual([])
    expect(await jobRow(job.id)).toMatchObject({ status: 'done', blob_key: null, password_enc: null, attempts: 1, error_code: null })
    expect(await statements(h)).toBe(1)
    // The quota isn't taken twice; the audit row is written when the statement is stored.
    expect(await count("SELECT COALESCE(SUM(count), 0) AS n FROM quota WHERE subject = ?1 AND metric = 'upload'", `user:${h.userId}`)).toBe(2)
    expect(await count("SELECT COUNT(*) AS n FROM audit_event WHERE household_id = ?1 AND event = 'statement_added'", h.householdId)).toBe(1)

    // GET /api/jobs/:id says where it went.
    const res = await call(`/api/jobs/${job.id}`, { jar: h.jar })
    const body = await res.json<{ job: Record<string, unknown> }>()
    expect(res.status).toBe(200)
    expect(res.headers.get('retry-after')).toBeNull()
    expect(body.job).toMatchObject({
      id: job.id, status: 'done', position: null, error_code: null,
      statement: { kind: 'CDSL', as_of: '2026-10-31', holdings_count: 1 },
      member: { name: 'Queued Holder', pan_masked: 'AB••••••4F', created: true },
    })
  })

  it('re-derives the password at parse time: a member\'s PAN, a pending KFintech password (kept alive until the job expires), or none', async () => {
    const h = await newHousehold('q2')
    const memberId = await addMember(h, FAKE_PAN, 'Existing')
    const pendingHmac = await panHmac(env, FAKE_PAN_2)
    const vault = await h.tenant.vault()
    const soon = Date.now() + 60_000
    await env.DB.prepare('INSERT INTO pending_statement_password (household_id, pan_hmac, password_enc, expires_at) VALUES (?1, ?2, ?3, ?4)')
      .bind(h.householdId, pendingHmac, await vault.sealText(fieldKey.pendingPassword(pendingHmac), 'kfin-pending'), soon)
      .run()
    captureQueue()
    await forceQueue()
    const byPan = await queuedUpload(h, statementPdf(cdslPages(), { userPassword: FAKE_PAN }))
    const byPending = await queuedUpload(h, statementPdf(kfinPages(FAKE_PAN_2), { userPassword: 'kfin-pending' }))
    const open = await queuedUpload(h, statementPdf(cdslPages()))

    expect(await jobRow(byPan.id)).toMatchObject({ password_source: 'pan', member_id: memberId, password_enc: null })
    expect(await jobRow(byPending.id)).toMatchObject({ password_source: 'kfintech_pending', password_enc: null })
    expect(await jobRow(open.id)).toMatchObject({ password_source: 'none', password_enc: null })
    const pendingExpiry = await count('SELECT expires_at AS n FROM pending_statement_password WHERE household_id = ?1', h.householdId)
    expect(pendingExpiry).toBe((await jobRow(byPending.id))!.expires_at) // extended from `soon` to the job's expiry

    await releasePool()
    const calls = fakeEngine((req) => (req.kind === 'RTA' ? parsed(FAKE_PAN_2, { kind: 'KFINTECH' }) : parsed(FAKE_PAN)))
    for (const j of [byPan, byPending, open]) await deliver(j.id)
    expect(calls.map((c) => c.password)).toEqual([FAKE_PAN, 'kfin-pending', ''])
    for (const j of [byPan, byPending]) expect((await jobRow(j.id))!.status).toBe('done')
    // The open one is the same member's statement with the same PAN: stored too.
    expect((await jobRow(open.id))!.status).toBe('done')
    expect(await count('SELECT COUNT(*) AS n FROM pending_statement_password WHERE household_id = ?1', h.householdId)).toBe(0) // used, so deleted
    expect(await members(h)).toBe(2)
    expect(await tmpKeys(h)).toEqual([])
  })

  it('waiting for a slot is not an attempt: the message is acked and sent again with a delay, and the job keeps its place', async () => {
    const h = await newHousehold('q3')
    const sent = captureQueue()
    await forceQueue()
    const a = await queuedUpload(h, statementPdf(cdslPages()))
    const b = await queuedUpload(h, statementPdf(cdslPages()))
    expect(b.position).toBe(a.position + 1)
    const seq = (await jobRow(a.id))!.seq

    const engine = fakeEngine(parsed(FAKE_PAN))
    for (let i = 0; i < 3; i++) {
      const r = await deliver(a.id)
      expect(r.explicitAcks).toEqual([`m-${a.id}`])
      expect(r.retryMessages).toEqual([])
    }
    const resent = sent.filter((m) => m.job_id === a.id && m.delay > 0)
    expect(resent).toHaveLength(3)
    for (const m of resent) expect(m.delay >= 5 && m.delay <= 60).toBe(true)
    expect(await jobRow(a.id)).toMatchObject({ status: 'queued', attempts: 0, seq })
    expect(engine).toHaveLength(0)

    // GET /api/jobs/:id: still in line, with an ETA, and a server-set Retry-After of 2–10 s.
    const res = await call(`/api/jobs/${b.id}`, { jar: h.jar })
    const view = (await res.json<{ job: { status: string; position: number; eta_s: number } }>()).job
    expect(view).toMatchObject({ status: 'queued', position: b.position })
    expect(view.eta_s).toBeGreaterThan(0)
    const after = Number(res.headers.get('retry-after'))
    expect(after >= 2 && after <= 10).toBe(true)
  })

  it('a duplicate of a queued file is 409 already_processing; after a failed job the same file can be uploaded again', async () => {
    const h = await newHousehold('q4')
    captureQueue()
    await forceQueue()
    const pdf = statementPdf(cdslPages())
    const job = await queuedUpload(h, pdf)
    const again = await upload(h.jar, pdf)
    expect([again.res.status, again.body.code]).toEqual([409, 'already_processing'])

    await releasePool()
    fakeEngine({ ok: false, code: 'parse_error' })
    await deliver(job.id)
    expect(await jobRow(job.id)).toMatchObject({ status: 'failed', error_code: 'parse_error', blob_key: null })
    vi.restoreAllMocks()
    captureQueue()
    await forceQueue()
    const retry = await queuedUpload(h, pdf)
    expect(await jobRow(job.id)).toBeNull() // the finished row made way
    expect((await jobRow(retry.id))!.status).toBe('queued')
  })

  it('parse failures fail the job and delete the PDF, with no member; GET /api/jobs shows the code', async () => {
    const h = await newHousehold('q5')
    captureQueue()
    await forceQueue()
    const jobs = []
    for (let i = 0; i < 3; i++) jobs.push(await queuedUpload(h, statementPdf(kfinPages())))
    await releasePool()
    const codes = ['parse_error', 'multi_pan', 'something_new']
    for (const [i, j] of jobs.entries()) {
      vi.restoreAllMocks()
      captureQueue()
      fakeEngine({ ok: false, code: codes[i]! })
      await deliver(j.id)
    }
    expect(await tmpKeys(h)).toEqual([])
    expect(await members(h)).toBe(0)
    const list = await (await call('/api/jobs', { jar: h.jar })).json<{ jobs: { id: string; status: string; error_code: string }[] }>()
    expect(list.jobs.map((j) => `${j.status}:${j.error_code}`).sort()).toEqual(['failed:multi_pan', 'failed:parse_error', 'failed:parse_error'])
    // No failed-parse quota for these: nothing the user did.
    expect(await count("SELECT COALESCE(SUM(count), 0) AS n FROM quota WHERE subject = ?1 AND metric = 'parse_fail'", `user:${h.userId}`)).toBe(0)
  })

  it('an engine crash is retried up to 3 attempts, then fails as parse_timeout and the PDF is deleted', async () => {
    const h = await newHousehold('q6')
    const sent = captureQueue()
    await forceQueue()
    const job = await queuedUpload(h, statementPdf(cdslPages()))
    await releasePool()
    const calls = fakeEngine(() => {
      throw new Error('container crashed')
    })
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      await deliver(job.id)
      expect((await jobRow(job.id))!.attempts).toBe(i)
    }
    expect(calls).toHaveLength(MAX_ATTEMPTS)
    expect(await jobRow(job.id)).toMatchObject({ status: 'failed', error_code: 'parse_timeout', blob_key: null })
    expect(sent.filter((m) => m.delay > 0)).toHaveLength(MAX_ATTEMPTS - 1)
    expect(await tmpKeys(h)).toEqual([])
    // The slot was always given back.
    expect((await enginePool(env).status()).fast.busy).toBe(0)
  })

  it('a full household after the parse fails the job with member_limit; a picked-up-twice job is left to the first consumer', async () => {
    const h = await newHousehold('q7')
    captureQueue()
    await forceQueue()
    const job = await queuedUpload(h, statementPdf(kfinPages(FAKE_PAN_2).map((p) => p.filter((l) => !l.includes('Folio')))))
    for (let i = 0; i < LIMITS.membersPerHousehold; i++) await addMember(h, `AAAPA${String(1000 + i)}A`, null)
    await releasePool()
    fakeEngine(parsed(FAKE_PAN_2, { kind: 'KFINTECH' }))
    await deliver(job.id)
    expect(await jobRow(job.id)).toMatchObject({ status: 'failed', error_code: 'member_limit', blob_key: null })

    // A job another consumer is parsing right now: this delivery leaves it and looks again in a minute.
    const now = Date.now()
    await env.DB.prepare("UPDATE parse_job SET status = 'parsing', error_code = NULL, updated_at = ?1 WHERE id = ?2").bind(now, job.id).run()
    expect(await runParseJob(env, job.id, now + 1000)).toEqual({ outcome: 'running', requeue: 60 })
  })
})

describe('DELETE /api/jobs/:id', () => {
  it('cancel deletes the parked PDF and the job; the message is then dropped without a parse', async () => {
    const h = await newHousehold('c1')
    captureQueue()
    await forceQueue()
    const job = await queuedUpload(h, statementPdf(cdslPages()))
    expect((await call(`/api/jobs/${job.id}`, { method: 'DELETE', jar: h.jar })).status).toBe(200)
    expect(await tmpKeys(h)).toEqual([])
    expect(await jobRow(job.id)).toBeNull()
    await releasePool()
    const calls = fakeEngine(parsed(FAKE_PAN))
    expect((await deliver(job.id)).explicitAcks).toHaveLength(1)
    expect(calls).toHaveLength(0)
  })

  it('another household\'s job, an unknown id and a malformed id are 404; a job being parsed is 409', async () => {
    const a = await newHousehold('c2a')
    const b = await newHousehold('c2b')
    captureQueue()
    await forceQueue()
    const job = await queuedUpload(a, statementPdf(cdslPages()))
    for (const path of [`/api/jobs/${job.id}`, `/api/jobs/${crypto.randomUUID()}`, '/api/jobs/nope']) {
      expect((await call(path, { jar: b.jar })).status).toBe(404)
      expect((await call(path, { method: 'DELETE', jar: b.jar })).status).toBe(404)
    }
    expect((await (await call('/api/jobs', { jar: b.jar })).json<{ jobs: unknown[] }>()).jobs).toEqual([])
    expect(await tmpKeys(a)).toHaveLength(1)

    await env.DB.prepare("UPDATE parse_job SET status = 'parsing' WHERE id = ?1").bind(job.id).run()
    const res = await call(`/api/jobs/${job.id}`, { method: 'DELETE', jar: a.jar })
    expect([res.status, (await res.json<{ code: string }>()).code]).toEqual([409, 'job_running'])
    expect(await tmpKeys(a)).toHaveLength(1)
  })
})

describe('Limits on parking (§11)', () => {
  it('over the global parked-PDF cap: 503 queue_full with Retry-After, nothing stored', async () => {
    const h = await newHousehold('l1')
    captureQueue()
    await forceQueue()
    const pool = enginePool(env)
    const before = (await pool.status()).parked
    await pool.setParked(Number(env.TMP_MAX_OBJECTS), 0)
    try {
      const { res, body } = await upload(h.jar, statementPdf(cdslPages()))
      expect([res.status, body.code, res.headers.get('retry-after')]).toEqual([503, 'queue_full', '60'])
      expect(await tmpKeys(h)).toEqual([])
      expect(await count('SELECT COUNT(*) AS n FROM parse_job WHERE household_id = ?1', h.householdId)).toBe(0)
    } finally {
      await pool.setParked(before.objects, before.bytes)
    }
  })

  it('the open-jobs cap holds inside the park batch too (a race past the early check), and the PDF is deleted again', async () => {
    const h = await newHousehold('l2')
    captureQueue()
    const now = Date.now()
    for (let i = 0; i < LIMITS.openJobsPerHousehold; i++) {
      await env.DB.prepare(
        `INSERT INTO parse_job (id, household_id, content_hash, kind, password_source, status, seq, created_at, updated_at, expires_at)
         VALUES (?1, ?2, ?3, 'CDSL', 'none', 'queued', ?4, ?5, ?5, ?6)`,
      ).bind(crypto.randomUUID(), h.householdId, crypto.randomUUID(), i, now, now + JOB_TTL_MS).run()
    }
    const bytes = statementPdf(cdslPages())
    const err = await parkUpload(h.tenant, await h.tenant.vault(), {
      bytes, contentHash: await contentHash(env, bytes), kind: 'CDSL', source: 'none', typedPassword: null, pendingPanHmac: null,
      prePanHmac: null, memberId: null, ticket: 1, queuedAhead: 0, etaS: 2,
    }).catch((e: unknown) => e)
    expect(err).toMatchObject({ status: 429, code: 'jobs_limit' })
    expect(await tmpKeys(h)).toEqual([])
    expect(await count("SELECT COALESCE(SUM(count), 0) AS n FROM quota WHERE subject = ?1 AND metric = 'upload'", `user:${h.userId}`)).toBe(0)
  })
})

describe('tmp-sweep (hourly cron)', () => {
  it('expires a job older than 24 h and deletes its object; deletes leftover PDFs of finished jobs; recounts the parked PDFs', async () => {
    const h = await newHousehold('t1')
    captureQueue()
    await forceQueue()
    const old = await queuedUpload(h, statementPdf(cdslPages()))
    const leftover = await queuedUpload(h, statementPdf(cdslPages()))
    const live = await queuedUpload(h, statementPdf(cdslPages()))
    const past = Date.now() - JOB_TTL_MS - 1
    await env.DB.prepare('UPDATE parse_job SET created_at = ?1, updated_at = ?1, expires_at = ?1 + 0 WHERE id = ?2').bind(past, old.id).run()
    await env.DB.prepare("UPDATE parse_job SET status = 'failed', error_code = 'parse_error' WHERE id = ?1").bind(leftover.id).run()

    const result = await tmpSweep(env)
    expect(result.expired).toBeGreaterThanOrEqual(1)
    expect(result.leftovers).toBeGreaterThanOrEqual(1)
    expect(await jobRow(old.id)).toMatchObject({ status: 'expired', blob_key: null, password_enc: null })
    expect(await jobRow(leftover.id)).toMatchObject({ status: 'failed', blob_key: null })
    expect(await tmpKeys(h)).toEqual([blobKeys.parkedPdf(h.householdId, live.id)])
    const parked = await count('SELECT COUNT(*) AS n FROM parse_job WHERE blob_key IS NOT NULL')
    expect((await enginePool(env).status()).parked.objects).toBe(parked)

    // An expired job's late message does nothing; the job list shows it as expired.
    await releasePool()
    const calls = fakeEngine(parsed(FAKE_PAN))
    await deliver(old.id)
    expect(calls).toHaveLength(0)
    const list = await (await call('/api/jobs', { jar: h.jar })).json<{ jobs: { id: string; status: string; error_code: string | null }[] }>()
    expect(list.jobs.find((j) => j.id === old.id)).toMatchObject({ status: 'expired', error_code: 'expired' })
  })

  it('re-sends a job whose message was lost (no change for 15 min) once, and the scheduled() handler runs the sweep', async () => {
    const h = await newHousehold('t2')
    const sent = captureQueue()
    await forceQueue()
    const job = await queuedUpload(h, statementPdf(cdslPages()))
    sent.length = 0
    await env.DB.prepare('UPDATE parse_job SET updated_at = ?1 WHERE id = ?2').bind(Date.now() - LOST_MS - 1, job.id).run()

    const ctrl = createScheduledController({ cron: '15 * * * *', scheduledTime: Date.now() })
    const ctx = createExecutionContext()
    await worker.scheduled!(ctrl, env, ctx)
    await waitOnExecutionContext(ctx)
    expect(sent.filter((m) => m.job_id === job.id)).toHaveLength(1)
    expect(Date.now() - (await jobRow(job.id))!.updated_at).toBeLessThan(LOST_MS)
    await tmpSweep(env) // touched: not sent again
    expect(sent.filter((m) => m.job_id === job.id)).toHaveLength(1)
  })

  it('account deletion removes tmp/{household_id}/ with a queued upload in it', async () => {
    const h = await newHousehold('t3')
    captureQueue()
    await forceQueue()
    await queuedUpload(h, statementPdf(cdslPages()))
    expect(await tmpKeys(h)).toHaveLength(1)
    await shredHousehold(env, h.householdId)
    expect(await tmpKeys(h)).toEqual([])
    expect(await count('SELECT COUNT(*) AS n FROM parse_job WHERE household_id = ?1', h.householdId)).toBe(0)
  })
})

describe('slot-wait delay', () => {
  it('is about half the ETA, 5–60 s, with jitter', () => {
    expect(waitDelay(2, 0.5)).toBe(5)
    expect(waitDelay(40, 0.5)).toBe(20)
    expect(waitDelay(1000, 0.5)).toBe(60)
    expect(waitDelay(40, 0)).toBe(16)
    expect(waitDelay(40, 1)).toBe(24)
  })
})

describe('through the real pf-parse queue', () => {
  it('a queued upload finishes on its own once a slot frees up', { timeout: 120_000 }, async () => {
    const h = await newHousehold('r1')
    await forceQueue()
    const job = await queuedUpload(h, statementPdf(cdslPages()))
    fakeEngine(parsed(FAKE_PAN))
    await releasePool()
    let status = 'queued'
    for (let i = 0; i < 100 && status !== 'done'; i++) {
      const res = await call(`/api/jobs/${job.id}`, { jar: h.jar })
      status = (await res.json<{ job: { status: string } }>()).job.status
      if (status !== 'done') await scheduler.wait(1000)
    }
    expect(status).toBe('done')
    expect(await tmpKeys(h)).toEqual([])
    expect(await statements(h)).toBe(1)
  })
})

