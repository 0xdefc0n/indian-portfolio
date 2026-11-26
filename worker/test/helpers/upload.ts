// Upload helpers: a multipart POST /api/statements, synthetic statement PDFs that differ per call (so they aren't
// duplicates), and a fake engine for the synthetic tests (the real one is used in statements.private.test.ts).
// All values are synthetic: fake PANs, names and ISINs.
import { createExecutionContext, createMessageBatch, env, getQueueResult } from 'cloudflare:test'
import { exports } from 'cloudflare:workers'
import { vi } from 'vitest'
import { acquireEngine, engineApi, type EngineLease, type EngineParse, type ParseRequest, releaseLease } from '../../src/lib/engine-client'
import { handleParseBatch, type ParseMessage, parseQueue } from '../../src/lib/jobs'
import { type FixturePage, makePdf } from './pdf-fixture'
import { type Jar, ORIGIN } from './auth'

export type UploadBody = {
  ok?: false
  code?: string
  typed?: boolean
  retry_after?: number
  statement?: { id: string; kind: string; as_of: string; holdings_count: number; warnings_count: number }
  member?: { id: string; name: string | null; pan_masked: string; created: boolean }
  job?: { id: string; position: number; eta_s: number }
}

export async function upload(jar: Jar, file: Uint8Array | Blob, fields: Record<string, string> = {}) {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  form.append('file', file instanceof Blob ? file : new Blob([file as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), 'statement.pdf')
  const res = await exports.default.fetch(
    new Request(`${ORIGIN}/api/statements`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'cf-connecting-ip': '203.0.113.7', cookie: jar.header() },
      body: form,
    }),
  )
  jar.absorb(res)
  return { res, body: await res.json<UploadBody>() }
}

let nonce = 0
/** A synthetic statement PDF; each call gives different bytes. */
export function statementPdf(pages: FixturePage[], opts: { userPassword?: string } = {}) {
  const tagged = pages.map((p, i) => (i === 0 ? [...p, `ref ${Date.now()}-${nonce++}`] : p))
  return makePdf(tagged, opts) as Uint8Array<ArrayBuffer>
}

export const FUND_A = 'INF000A01011'
export const FUND_B = 'INF000B02022'

/** What the engine returns for a CDSL or CAMS/KFintech statement of `pan`. */
export function parsed(pan: string, opts: { kind?: 'CDSL' | 'CAMS' | 'KFINTECH'; name?: string | null; asOf?: string; isins?: string[] } = {}): EngineParse {
  const kind = opts.kind ?? 'CDSL'
  const asOf = opts.asOf ?? '2026-10-31'
  const holdings = (opts.isins ?? [FUND_A]).map((isin, i) => ({
    isin,
    amc: 'Example AMC',
    name: `Example Fund ${i}`,
    units: 1,
    value: 10,
    ...(kind === 'CDSL' ? {} : { amfi: String(100000 + i), valuation_date: asOf }),
  }))
  return {
    ok: true,
    kind: kind === 'CDSL' ? 'CDSL' : 'RTA',
    source: kind,
    pan,
    version: '0.1.0',
    statement: {
      statement_type: kind === 'CDSL' ? 'CDSL_CAS' : 'RTA_CAS',
      pan,
      holder_name: opts.name === undefined ? 'Synthetic Holder' : opts.name,
      period_from: '2026-10-01',
      period_to: asOf,
      valuation_date: kind === 'CDSL' ? undefined : asOf,
      holdings,
      warnings: [],
    },
  }
}

/**
 * Replace the engine container: `answer` decides each parse. Slots still come from the real EnginePool, and the
 * lease is released as the real parse does. Returns the requests it saw (to check the password sent).
 */
export function fakeEngine(answer: EngineParse | ((req: ParseRequest) => EngineParse | Promise<EngineParse>)) {
  const calls: ParseRequest[] = []
  vi.spyOn(engineApi, 'parse').mockImplementation(async (workerEnv, lease, req) => {
    calls.push(req)
    try {
      const res = typeof answer === 'function' ? await answer(req) : answer
      await releaseLease(workerEnv, lease, res.ok)
      return res
    } catch (err) {
      await releaseLease(workerEnv, lease)
      throw err
    }
  })
  return calls
}

/** No free engine slot, without touching the pool (a fixed answer). */
export function busyEngine(answer: Partial<{ queued_ahead: number; eta_s: number; ticket: number }> = {}) {
  return vi.spyOn(engineApi, 'acquire').mockResolvedValue({ ok: false, code: 'busy', queued_ahead: 3, eta_s: 7.2, ticket: 1, ...answer })
}

/**
 * Force the real EnginePool to 0 free fast slots by holding every lease (plan §16 "with the pool forced to 0 free
 * slots"). Returns a function that gives them back.
 */
export async function fillPool(): Promise<() => Promise<void>> {
  const leases: EngineLease[] = []
  for (;;) {
    const r = await acquireEngine(env, { cls: 'fast' })
    if (!r.ok) break
    leases.push(r)
  }
  return async () => {
    for (const l of leases.splice(0)) await releaseLease(env, l)
  }
}

/** Capture pf-parse sends instead of delivering them, so a test runs the consumer itself. */
export function captureQueue() {
  const sent: { job_id: string; delay: number }[] = []
  vi.spyOn(parseQueue, 'send').mockImplementation(async (_env, msg, delay = 0) => {
    sent.push({ job_id: msg.job_id, delay })
  })
  vi.spyOn(parseQueue, 'sendBatch').mockImplementation(async (_env, msgs) => {
    for (const m of msgs) sent.push({ job_id: m.job_id, delay: 0 })
  })
  return sent
}

/** Run the pf-parse consumer on one message, as the queue would deliver it. */
export async function deliver(jobId: string) {
  const batch = createMessageBatch<ParseMessage>('pf-parse', [{ id: `m-${jobId}`, timestamp: new Date(), attempts: 1, body: { job_id: jobId } }])
  const ctx = createExecutionContext()
  await handleParseBatch(batch, env)
  return getQueueResult(batch, ctx)
}
