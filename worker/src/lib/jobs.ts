// Parse jobs: the queued upload path (plan §10.1 D, §9.2 jobs, §10.3 tmp-sweep, M8).
//
// A job exists only after the upload passed every check the user could fix (§10.1 A), so nothing about it ever needs
// the user again. Its PDF is parked sealed with the household DEK (no gzip) at tmp/{household_id}/{job_id}.bin, and
// is deleted on every outcome: parsed, failed, cancelled or expired. Never kept longer than 24 h (tmp-sweep, and the
// R2 lifecycle rule on tmp/ as the safety net).
//
// Life of a job: queued → parsing → done | failed, or → expired (tmp-sweep) or deleted (cancel). The pf-parse
// consumer waits for an engine slot by re-sending the message with a delay; those waits aren't attempts (only engine
// tries are, at most 3). Its place in the queue is its EnginePool ticket (`seq`).
//
// Privacy (§0.1): logs carry the job id's status changes, codes, counts and durations only.
import { auditJobStatement } from './audit'
import { deleteBlobs, isUuid, openPdf, sealPdf } from './blob'
import type { Vault } from './crypto'
import { engineApi, enginePool } from './engine-client'
import { ApiError, notFound } from './errors'
import { LIMITS, uploadQuota } from './limits'
import { fieldKey } from './members'
import { isQuotaRefusal, quotaStatement, refusal } from './quota'
import { type AddedStatement, engineFailure, finishParsed, type PasswordSource, type StatementKind } from './statements'
import { requestRebuild } from './snapshot'
import { Tenant } from './tenant'

/** A parked PDF is never kept longer than this (§0.5). */
export const JOB_TTL_MS = 24 * 3_600_000
/** Engine tries per job (a crash or timeout); slot waits don't count. */
export const MAX_ATTEMPTS = 3
/** A job left 'parsing' this long lost its consumer (the engine call times out after 60 s). */
export const STALE_PARSING_MS = 2 * 60_000
/** A waiting job refreshes updated_at this often, so tmp-sweep can tell a lost message from a long wait. */
export const TOUCH_MS = 5 * 60_000
/** An open job untouched this long has lost its queue message: tmp-sweep sends it again. */
export const LOST_MS = 15 * 60_000
/** Finished jobs stay visible in GET /api/jobs this long (the "Processing" list and the failed-upload toast). */
export const RECENT_MS = 24 * 3_600_000
const SWEEP_BATCH = 500
const IN_CHUNK = 90 // ids per `IN (…)`: under D1's 100 bound parameters

export type JobStatus = 'queued' | 'parsing' | 'done' | 'failed' | 'expired'
export type ParseMessage = { job_id: string }
export type QueuedUpload = { id: string; position: number; eta_s: number }

/** pf-parse sends, through one object so tests can capture them instead of the real queue. */
export const parseQueue = {
  async send(env: Env, msg: ParseMessage, delaySeconds = 0): Promise<void> {
    await env.Q_PARSE.send(msg, delaySeconds > 0 ? { delaySeconds } : undefined)
  },
  async sendBatch(env: Env, msgs: ParseMessage[]): Promise<void> {
    await env.Q_PARSE.sendBatch(msgs.map((body) => ({ body })))
  },
}

// ─── Park (§10.1 D5–D7) ─────────────────────────────────────────────────────────────────────────────────────────

export type ParkInput = {
  bytes: Uint8Array<ArrayBuffer>
  contentHash: string
  kind: 'CDSL' | 'RTA'
  source: PasswordSource
  /** The verified password, kept (sealed) only when it was typed. PANs and pending passwords are looked up again. */
  typedPassword: string | null
  pendingPanHmac: string | null
  prePanHmac: string | null
  /** The existing member the pre-check matched (for source 'pan', the member whose PAN opened it). */
  memberId: string | null
  /** From EnginePool's busy answer; the parked-PDF counter was taken with it. */
  ticket: number
  queuedAhead: number
  etaS: number
}

/**
 * Seal the PDF into tmp/, then in one batch: drop a finished job for the same file (so a retry isn't blocked by the
 * UNIQUE), insert the job (refused by its NOT NULL status when the household has 10 open jobs), keep the pending
 * KFintech password alive until the job expires, and take the upload quota. Any refusal deletes the PDF again.
 */
export async function parkUpload(t: Tenant, vault: Vault, p: ParkInput): Promise<QueuedUpload> {
  const { env } = t
  const db = env.DB
  const id = crypto.randomUUID()
  const key = t.keys.parkedPdf(id)
  const now = Date.now()
  const expiresAt = now + JOB_TTL_MS
  const giveBack = () => enginePool(env).unpark(p.bytes.length, p.ticket).catch(() => undefined)

  try {
    await env.BUCKET.put(key, await sealPdf(vault, key, p.bytes), { httpMetadata: { contentType: 'application/octet-stream' } })
  } catch (err) {
    await giveBack()
    throw err
  }
  const passwordEnc = p.typedPassword ? await vault.sealText(fieldKey.jobPassword(id), p.typedPassword) : null
  const quota = uploadQuota(t.userId)
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(`DELETE FROM parse_job WHERE household_id = ?1 AND content_hash = ?2 AND status IN ('done','failed','expired') RETURNING blob_key`)
      .bind(t.householdId, p.contentHash),
    db
      .prepare(
        `INSERT INTO parse_job (id, household_id, user_id, member_id, pan_hmac, pending_pan_hmac, blob_key, pdf_bytes, content_hash, kind,
                                password_source, password_enc, status, seq, created_at, updated_at, expires_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                CASE WHEN (SELECT COUNT(*) FROM parse_job WHERE household_id = ?2 AND status IN ('queued','parsing')) < ?13 THEN 'queued' END,
                ?14, ?15, ?15, ?16`,
      )
      .bind(id, t.householdId, t.userId, p.memberId, p.prePanHmac, p.pendingPanHmac, key, p.bytes.length, p.contentHash, p.kind,
        p.source, passwordEnc, LIMITS.openJobsPerHousehold, p.ticket, now, expiresAt),
  ]
  if (p.pendingPanHmac) {
    // §10.1 D8.7: the pending password must outlive the job, or the job couldn't be opened when its turn comes.
    stmts.push(
      db.prepare('UPDATE pending_statement_password SET expires_at = MAX(expires_at, ?3) WHERE household_id = ?1 AND pan_hmac = ?2')
        .bind(t.householdId, p.pendingPanHmac, expiresAt),
    )
  }
  for (const q of quota) stmts.push(quotaStatement(db, q, now))

  let results: D1Result<{ blob_key: string | null }>[]
  try {
    results = await db.batch<{ blob_key: string | null }>(stmts)
  } catch (err) {
    await env.BUCKET.delete(key).catch(() => undefined)
    await giveBack()
    const message = err instanceof Error ? err.message : ''
    if (isQuotaRefusal(err)) throw new ApiError(429, 'upload_limit', { retry_after: (await refusal(env, quota, now)).retryAfter })
    if (/NOT NULL constraint failed: parse_job\.status/.test(message)) throw new ApiError(429, 'jobs_limit', { retry_after: 30 })
    if (/UNIQUE constraint failed: parse_job\./.test(message)) throw new ApiError(409, 'already_processing')
    throw err
  }
  const stale = (results[0]?.results ?? []).map((r) => r.blob_key).filter((k): k is string => !!k)
  if (stale.length) await deleteBlobs(env, t.householdId, stale).catch((e) => console.error('blob_delete_failed', (e as Error).name, stale.length))

  try {
    await parseQueue.send(env, { job_id: id })
  } catch (err) {
    console.error('parse_enqueue_failed', (err as Error).name) // the job is safe: tmp-sweep re-sends lost messages
  }
  return { id, position: p.queuedAhead + 1, eta_s: p.etaS }
}

// ─── Consumer (§10.1 D8) ────────────────────────────────────────────────────────────────────────────────────────

type JobRow = {
  id: string
  household_id: string
  user_id: string | null
  member_id: string | null
  pan_hmac: string | null
  pending_pan_hmac: string | null
  blob_key: string | null
  pdf_bytes: number
  content_hash: string
  kind: 'CDSL' | 'RTA'
  password_source: PasswordSource
  password_enc: number[] | null
  status: JobStatus
  attempts: number
  seq: number
  updated_at: number
  expires_at: number
}
type MemberRow = { id: string; pan_hmac: string; pan_enc: number[]; pan_masked: string; display_name_enc: number[] | null }

const JOB_COLUMNS = `id, household_id, user_id, member_id, pan_hmac, pending_pan_hmac, blob_key, pdf_bytes, content_hash, kind,
  password_source, password_enc, status, attempts, seq, updated_at, expires_at`

export type JobOutcome = { outcome: string; requeue?: number }

/** pf-parse consumer (max_batch_size 1). Each message is acked once handled; a slot wait sends a fresh, delayed one. */
export async function handleParseBatch(batch: MessageBatch<ParseMessage>, env: Env): Promise<void> {
  for (const msg of batch.messages) {
    const jobId = msg.body?.job_id
    if (!isUuid(jobId)) {
      msg.ack()
      continue
    }
    try {
      const next = await runParseJob(env, jobId)
      // A new message rather than msg.retry(): retries count toward max_retries (then the DLQ), and a long wait
      // for a slot isn't a failure.
      if (next.requeue !== undefined) await parseQueue.send(env, { job_id: jobId }, next.requeue)
      msg.ack()
    } catch (err) {
      console.error('parse_job_error', (err as Error).name)
      msg.retry({ delaySeconds: 30 })
    }
  }
}

/** Seconds until a waiting job asks for a slot again: about half its ETA, 5–60 s, with ±20% jitter. */
export function waitDelay(etaS: number, random = Math.random()): number {
  const base = Math.min(60, Math.max(5, etaS / 2))
  return Math.max(5, Math.round(base * (0.8 + random * 0.4)))
}

/** One delivery of a job's message. Returns what happened, and a delay when the message must come back later. */
export async function runParseJob(env: Env, jobId: string, now = Date.now()): Promise<JobOutcome> {
  const db = env.DB
  const job = await db.prepare(`SELECT ${JOB_COLUMNS} FROM parse_job WHERE id = ?1`).bind(jobId).first<JobRow>()
  // 1. Stop if it's no longer open: cancelled, done, failed, expired, or deleted with its member or household.
  if (!job || (job.status !== 'queued' && job.status !== 'parsing')) return { outcome: 'gone' }
  if (job.expires_at <= now) {
    await endJob(env, job, { status: 'expired' })
    return { outcome: 'expired' }
  }
  // Picked up twice: another consumer is on it. Look again later in case that one died.
  if (job.status === 'parsing' && now - job.updated_at < STALE_PARSING_MS) return { outcome: 'running', requeue: 60 }

  // 2. A slot, keeping the job's place in the queue. No slot: wait, which doesn't count as an attempt.
  const slot = await engineApi.acquire(env, { cls: 'fast', wait: true, ticket: job.seq })
  if (!slot.ok) {
    if (now - job.updated_at >= TOUCH_MS) {
      await db.prepare('UPDATE parse_job SET updated_at = ?1 WHERE id = ?2 AND status = ?3').bind(now, job.id, job.status).run()
    }
    return { outcome: 'waiting', requeue: waitDelay(slot.code === 'busy' ? slot.eta_s : 30) }
  }

  // 3. Claim it: exactly one consumer moves it to 'parsing' (compare-and-set on status and updated_at).
  const claim = await db
    .prepare(`UPDATE parse_job SET status = 'parsing', attempts = attempts + 1, updated_at = ?1 WHERE id = ?2 AND status = ?3 AND updated_at = ?4 RETURNING attempts`)
    .bind(now, job.id, job.status, job.updated_at)
    .first<{ attempts: number }>()
  if (!claim) {
    await engineApi.release(env, slot)
    return { outcome: 'taken' }
  }

  const started = Date.now()
  let holding = true
  try {
    const [keyRes, memberRes, pendingRes] = await db.batch([
      db.prepare('SELECT dek_wrapped, kek_version FROM household WHERE id = ?1').bind(job.household_id),
      db.prepare('SELECT id, pan_hmac, pan_enc, pan_masked, display_name_enc FROM member WHERE household_id = ?1 ORDER BY created_at, id').bind(job.household_id),
      db
        .prepare('SELECT password_enc FROM pending_statement_password WHERE household_id = ?1 AND pan_hmac = ?2 AND expires_at > ?3')
        .bind(job.household_id, job.pending_pan_hmac ?? '', now),
    ])
    const keyRow = keyRes!.results[0] as { dek_wrapped: number[]; kek_version: number } | undefined
    if (!keyRow) throw new JobError('household gone') // the household delete cascades the row; nothing left to do
    const t = new Tenant(env, job.household_id, job.user_id ?? '')
    const vault = await t.vaultFromRow(keyRow)
    const members = memberRes!.results as MemberRow[]

    const obj = job.blob_key ? await env.BUCKET.get(job.blob_key) : null
    if (!obj) {
      // The PDF is gone (the R2 lifecycle rule, or a manual delete): nothing to parse.
      await engineApi.release(env, slot)
      holding = false
      await endJob(env, job, { status: 'expired' })
      return { outcome: 'expired' }
    }
    const bytes = await openPdf(vault, job.blob_key!, await obj.arrayBuffer())
    const password = await jobPassword(vault, job, members, pendingRes!.results[0] as { password_enc: number[] } | undefined)
    if (password === null) {
      await engineApi.release(env, slot)
      holding = false
      await endJob(env, job, { status: 'failed', error: 'password_unavailable' })
      return { outcome: 'password_unavailable' }
    }

    // 3 (cont.). Parse on the held slot; parse() releases it.
    holding = false
    const parsed = await engineApi.parse(env, slot, { bytes, password, kind: job.kind })
    if (!parsed.ok) {
      const code = engineFailure(parsed.code, job.kind)
      if (code === 'parse_timeout') return await retryOrFail(env, job, claim.attempts, code)
      // 5. None of these can be fixed by the user typing something: fail, and delete the PDF.
      await endJob(env, job, { status: 'failed', error: code })
      return { outcome: code }
    }

    // 4. Success: PAN check and store; the job row turns 'done' in the same batch. Then delete the PDF.
    const added: AddedStatement = await finishParsed(t, vault, members, {
      parsed,
      contentHash: job.content_hash,
      prePanHmac: job.pan_hmac,
      pendingPanHmac: job.password_source === 'kfintech_pending' ? job.pending_pan_hmac : null,
      audit: auditJobStatement(db, { userId: job.user_id, householdId: job.household_id, event: 'statement_added' }),
      quota: false, // taken when it was parked
      extra: (statementId) => [
        db
          .prepare(`UPDATE parse_job SET status = 'done', statement_id = ?1, error_code = NULL, password_enc = NULL, updated_at = ?2 WHERE id = ?3 AND household_id = ?4`)
          .bind(statementId, Date.now(), job.id, job.household_id),
      ],
    })
    await endJob(env, job, { status: 'done', statementId: added.statement.id, ms: Date.now() - started })
    await requestRebuild(env, job.household_id)
    return { outcome: 'done' }
  } catch (err) {
    if (holding) await engineApi.release(env, slot).catch(() => undefined)
    if (err instanceof ApiError) {
      if (err.code === 'already_added') {
        // The same file was stored meanwhile (a direct upload raced this job): nothing is lost.
        const row = await db.prepare('SELECT id FROM statement WHERE household_id = ?1 AND content_hash = ?2').bind(job.household_id, job.content_hash).first<{ id: string }>()
        await endJob(env, job, { status: 'done', statementId: row?.id ?? null, setStatus: true })
        return { outcome: 'done' }
      }
      await endJob(env, job, { status: 'failed', error: err.code }) // parse_error, precheck_disagree, member_limit
      return { outcome: err.code }
    }
    if (err instanceof JobError) return { outcome: 'gone' }
    // 6. Engine crash, container start error or an infrastructure error: try again, up to 3 attempts.
    console.error('parse_job_attempt_failed', (err as Error).name)
    return retryOrFail(env, job, claim.attempts, 'parse_timeout')
  }
}

class JobError extends Error {
  override name = 'JobError'
}

/** The verified password, derived again for a PAN or a pending KFintech password. Null if it's no longer there. */
async function jobPassword(vault: Vault, job: JobRow, members: MemberRow[], pending: { password_enc: number[] } | undefined): Promise<string | null> {
  switch (job.password_source) {
    case 'none':
      return ''
    case 'typed':
      return job.password_enc ? vault.openText(fieldKey.jobPassword(job.id), job.password_enc) : null
    case 'pan': {
      const m = members.find((x) => x.id === job.member_id)
      return m ? vault.openText(fieldKey.pan(m.id), m.pan_enc) : null
    }
    case 'kfintech_pending':
      return pending && job.pending_pan_hmac ? vault.openText(fieldKey.pendingPassword(job.pending_pan_hmac), pending.password_enc) : null
  }
}

async function retryOrFail(env: Env, job: JobRow, attempts: number, code: string): Promise<JobOutcome> {
  if (attempts >= MAX_ATTEMPTS) {
    await endJob(env, job, { status: 'failed', error: code })
    return { outcome: code }
  }
  await env.DB.prepare(`UPDATE parse_job SET status = 'queued', updated_at = ?1 WHERE id = ?2 AND status = 'parsing'`).bind(Date.now(), job.id).run()
  console.log('parse_job', { status: 'retry', attempts })
  return { outcome: 'retry', requeue: 10 * attempts }
}

type JobEnd =
  | { status: 'done'; statementId: string | null; ms?: number; setStatus?: boolean }
  | { status: 'failed'; error: string }
  | { status: 'expired' }

/**
 * Finish a job: delete its parked PDF first, then record the outcome. If the delete fails, blob_key stays set and
 * tmp-sweep deletes it later. The password is cleared with the PDF. The pool's parked counter and waiter go too.
 */
async function endJob(env: Env, job: JobRow, end: JobEnd): Promise<void> {
  let deleted = !job.blob_key
  if (job.blob_key) {
    try {
      await deleteBlobs(env, job.household_id, [job.blob_key])
      deleted = true
    } catch (err) {
      console.error('blob_delete_failed', (err as Error).name, 1)
    }
  }
  const now = Date.now()
  if (end.status === 'done' && !end.setStatus) {
    // storeStatement's batch already set 'done'.
    if (deleted) await env.DB.prepare('UPDATE parse_job SET blob_key = NULL WHERE id = ?1').bind(job.id).run()
  } else {
    await env.DB.prepare(
      `UPDATE parse_job SET status = ?1, error_code = ?2, statement_id = COALESCE(?3, statement_id), password_enc = NULL,
         blob_key = CASE WHEN ?4 THEN NULL ELSE blob_key END, updated_at = ?5
       WHERE id = ?6`,
    )
      .bind(end.status, end.status === 'failed' ? end.error : null, end.status === 'done' ? end.statementId : null, deleted ? 1 : 0, now, job.id)
      .run()
  }
  await enginePool(env).unpark(deleted && job.blob_key ? job.pdf_bytes : 0, job.seq).catch(() => undefined)
  console.log('parse_job', {
    status: end.status,
    code: end.status === 'failed' ? end.error : null,
    ...(end.status === 'done' && end.ms !== undefined ? { ms: end.ms } : {}),
  })
}

// ─── GET /api/jobs, GET /api/jobs/:id, DELETE /api/jobs/:id (§9.2) ─────────────────────────────────────────────

export type JobView = {
  id: string
  status: JobStatus
  /** 1 = next in line. Null unless queued. */
  position: number | null
  eta_s: number | null
  error_code: string | null
  statement_id: string | null
  created_at: number
}
type ViewRow = { id: string; status: JobStatus; seq: number; error_code: string | null; statement_id: string | null; created_at: number }

async function withPositions(env: Env, rows: ViewRow[]): Promise<JobView[]> {
  const queued = rows.filter((r) => r.status === 'queued')
  const positions = queued.length ? await enginePool(env).positions('fast', queued.map((r) => r.seq)) : []
  const byTicket = new Map(positions.map((p) => [p.ticket, p]))
  return rows.map((r) => {
    const p = r.status === 'queued' ? byTicket.get(r.seq) : undefined
    return {
      id: r.id,
      status: r.status,
      position: p ? p.queued_ahead + 1 : null,
      eta_s: p ? p.eta_s : null,
      error_code: r.status === 'failed' || r.status === 'expired' ? (r.error_code ?? r.status) : null,
      statement_id: r.statement_id,
      created_at: r.created_at,
    }
  })
}

/** The household's open jobs and those finished in the last day, newest first. One D1 read and one pool call. */
export async function listJobs(t: Tenant, now = Date.now()): Promise<JobView[]> {
  const { results } = await t.env.DB.prepare(
    `SELECT id, status, seq, error_code, statement_id, created_at FROM parse_job
     WHERE household_id = ?1 AND (status IN ('queued','parsing') OR updated_at > ?2)
     ORDER BY created_at DESC LIMIT 50`,
  )
    .bind(t.householdId, now - RECENT_MS)
    .all<ViewRow>()
  return withPositions(t.env, results)
}

export type JobDetail = JobView & { statement?: AddedStatement['statement']; member?: AddedStatement['member'] }

/** One job; a finished one also says where the statement went ("Added to <member>"). 404 if not this household's. */
export async function getJob(t: Tenant, jobId: string): Promise<JobDetail> {
  if (!isUuid(jobId)) throw notFound()
  const db = t.env.DB
  const row = await db
    .prepare('SELECT id, status, seq, error_code, statement_id, created_at FROM parse_job WHERE id = ?1 AND household_id = ?2')
    .bind(jobId, t.householdId)
    .first<ViewRow>()
  if (!row) throw notFound()
  const [view] = await withPositions(t.env, [row])
  if (row.status !== 'done' || !row.statement_id) return view!

  const [keyRes, stRes] = await db.batch([
    db.prepare('SELECT dek_wrapped, kek_version FROM household WHERE id = ?1').bind(t.householdId),
    db
      .prepare(
        `SELECT s.id, s.kind, s.as_of, s.holdings_count, s.warnings_count, m.id AS member_id, m.pan_masked, m.display_name_enc, m.created_at AS member_created
         FROM statement s JOIN member m ON m.id = s.member_id WHERE s.id = ?1 AND s.household_id = ?2`,
      )
      .bind(row.statement_id, t.householdId),
  ])
  type St = { id: string; kind: StatementKind; as_of: string; holdings_count: number; warnings_count: number; member_id: string; pan_masked: string; display_name_enc: number[] | null; member_created: number }
  const st = stRes!.results[0] as St | undefined
  const keyRow = keyRes!.results[0] as { dek_wrapped: number[]; kek_version: number } | undefined
  if (!st || !keyRow) return view! // the statement was deleted since
  const vault = await t.vaultFromRow(keyRow)
  return {
    ...view!,
    statement: { id: st.id, kind: st.kind, as_of: st.as_of, holdings_count: st.holdings_count, warnings_count: st.warnings_count },
    member: {
      id: st.member_id,
      name: st.display_name_enc ? await vault.openText(fieldKey.name(st.member_id), st.display_name_enc) : null,
      pan_masked: st.pan_masked,
      created: st.member_created >= row.created_at, // the member came with this statement
    },
  }
}

/** Seconds until the SPA should poll a job again (§11: 1 → 10 s, set by the server). Null once it's finished. */
export function pollAfter(job: JobView): number | null {
  if (job.status === 'parsing') return 2
  if (job.status !== 'queued') return null
  return Math.min(10, Math.max(2, Math.ceil((job.eta_s ?? 8) / 4)))
}

/**
 * Cancel a queued job (its parked PDF is deleted) or dismiss a finished one. A job being parsed right now can't be
 * cancelled: 409 job_running (it finishes within a minute). False if it isn't this household's.
 */
export async function cancelJob(t: Tenant, jobId: string): Promise<boolean> {
  if (!isUuid(jobId)) return false
  const db = t.env.DB
  const [del, running] = await db.batch<{ blob_key: string | null; pdf_bytes: number; seq: number; status: JobStatus } | { n: number }>([
    db
      .prepare(`DELETE FROM parse_job WHERE id = ?1 AND household_id = ?2 AND status <> 'parsing' RETURNING blob_key, pdf_bytes, seq, status`)
      .bind(jobId, t.householdId),
    db.prepare(`SELECT COUNT(*) AS n FROM parse_job WHERE id = ?1 AND household_id = ?2 AND status = 'parsing'`).bind(jobId, t.householdId),
  ])
  const row = del?.results[0] as { blob_key: string | null; pdf_bytes: number; seq: number; status: JobStatus } | undefined
  if (!row) {
    if ((running?.results[0] as { n: number } | undefined)?.n) throw new ApiError(409, 'job_running', { retry_after: 5 })
    return false
  }
  if (row.blob_key) {
    await deleteBlobs(t.env, t.householdId, [row.blob_key]).catch((e) => console.error('blob_delete_failed', (e as Error).name, 1))
  }
  if (row.status === 'queued' || row.blob_key) await enginePool(t.env).unpark(row.blob_key ? row.pdf_bytes : 0, row.seq).catch(() => undefined)
  console.log('parse_job', { status: row.status === 'queued' ? 'cancelled' : 'dismissed' })
  return true
}

// ─── tmp-sweep cron (hourly, §10.3) ─────────────────────────────────────────────────────────────────────────────

export type SweepResult = { expired: number; leftovers: number; resent: number; parked: number }

/** tmp-sweep (§10.3): hourly at :15. Not exported from src/index.ts: workerd refuses non-handler exports there. */
export const TMP_SWEEP_CRON = '15 * * * *'

/**
 * 1. Open jobs past expires_at: delete the PDF, mark 'expired'.
 * 2. Finished jobs whose PDF delete failed earlier: delete it now.
 * 3. Open jobs untouched for 15 min lost their queue message (or it went to the DLQ): send it again.
 * 4. Recount the parked PDFs for EnginePool's global cap.
 * Counts only in logs.
 */
export async function tmpSweep(env: Env, now = Date.now()): Promise<SweepResult> {
  const db = env.DB
  type Row = { id: string; household_id: string; blob_key: string | null }
  const [expiredRes, leftoverRes, lostRes] = await db.batch<Row>([
    db.prepare(`SELECT id, household_id, blob_key FROM parse_job WHERE status IN ('queued','parsing') AND expires_at <= ?1 LIMIT ${SWEEP_BATCH}`).bind(now),
    db.prepare(`SELECT id, household_id, blob_key FROM parse_job WHERE status IN ('done','failed','expired') AND blob_key IS NOT NULL LIMIT ${SWEEP_BATCH}`),
    db
      .prepare(`SELECT id, household_id, blob_key FROM parse_job WHERE status IN ('queued','parsing') AND updated_at < ?1 AND expires_at > ?2 LIMIT ${SWEEP_BATCH}`)
      .bind(now - LOST_MS, now),
  ])
  const expired = expiredRes?.results ?? []
  const leftovers = leftoverRes?.results ?? []
  const lost = lostRes?.results ?? []

  const deletedIds = async (rows: Row[]) => {
    const ok: string[] = []
    const byHousehold = new Map<string, Row[]>()
    for (const r of rows) byHousehold.set(r.household_id, [...(byHousehold.get(r.household_id) ?? []), r])
    for (const [hid, list] of byHousehold) {
      const keys = list.map((r) => r.blob_key).filter((k): k is string => !!k)
      try {
        if (keys.length) await deleteBlobs(env, hid, keys)
        ok.push(...list.map((r) => r.id))
      } catch (err) {
        console.error('blob_delete_failed', (err as Error).name, keys.length)
      }
    }
    return ok
  }

  const expiredIds = await deletedIds(expired)
  for (const ids of chunks(expiredIds)) {
    await db
      .prepare(
        `UPDATE parse_job SET status = 'expired', blob_key = NULL, password_enc = NULL, updated_at = ?1
         WHERE status IN ('queued','parsing') AND id IN (${ids.map((_, i) => `?${i + 2}`).join(', ')})`,
      )
      .bind(now, ...ids)
      .run()
  }
  const leftoverIds = await deletedIds(leftovers)
  for (const ids of chunks(leftoverIds)) {
    await db.prepare(`UPDATE parse_job SET blob_key = NULL WHERE id IN (${ids.map((_, i) => `?${i + 1}`).join(', ')})`).bind(...ids).run()
  }

  // Lost messages: touch first, so the next sweep doesn't send them again while they wait in the queue.
  const lostIds = lost.map((r) => r.id)
  for (const ids of chunks(lostIds)) {
    await db.prepare(`UPDATE parse_job SET updated_at = ?1 WHERE id IN (${ids.map((_, i) => `?${i + 2}`).join(', ')})`).bind(now, ...ids).run()
  }
  for (let i = 0; i < lostIds.length; i += 100) {
    await parseQueue.sendBatch(env, lostIds.slice(i, i + 100).map((job_id) => ({ job_id })))
  }

  const parked = await db
    .prepare('SELECT COUNT(*) AS n, COALESCE(SUM(pdf_bytes), 0) AS b FROM parse_job WHERE blob_key IS NOT NULL')
    .first<{ n: number; b: number }>()
  await enginePool(env).setParked(parked?.n ?? 0, parked?.b ?? 0)

  const result = { expired: expiredIds.length, leftovers: leftoverIds.length, resent: lostIds.length, parked: parked?.n ?? 0 }
  console.log('tmp_sweep', result)
  return result
}

function chunks<T>(list: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}
