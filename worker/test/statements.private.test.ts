// Upload on real statements through the real engine container (Docker): Worker → pre-check → EnginePool →
// EngineFast → /parse → sealed JSON in R2. The PDFs come from git-ignored folders via test/global-setup.ts and skip
// when absent (CI).
// Privacy (§0.1): assertions compare in memory and report pdf<N> + a boolean or a status code, never a value. Don't
// use toBe/toEqual on anything derived from a statement: vitest would print both sides on failure.
import { env } from 'cloudflare:test'
import { afterEach, describe, expect, inject, it, vi } from 'vitest'
import { blobKeys, getJsonBlob } from '../src/lib/blob'
import { call } from './helpers/auth'
import { newHousehold, r2Keys } from './helpers/tenant'
import { captureQueue, deliver, fillPool, upload } from './helpers/upload'

const pdfs = inject('privatePdfs').filter((p) => p.engine.ok)
const skipReason = inject('privatePdfsSkipReason')
const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/
afterEach(() => {
  vi.restoreAllMocks()
})

describe.skipIf(!pdfs.length)(`upload on private statements (${pdfs.length || skipReason})`, () => {
  it.each(pdfs.map((p) => [p.id, p] as const))('%s: stored sealed, nothing in tmp/, duplicate refused, re-filed by the member PAN', { timeout: 180_000 }, async (id, p) => {
    const h = await newHousehold(`priv-${id}`)
    const bytes = fromBase64(p.base64)
    const password = p.candidates[p.engine.password_index] ?? ''
    const t0 = Date.now()

    // D19: the first statement of a new household. Encrypted → asks for the password; unencrypted → goes straight in.
    const untyped = await upload(h.jar, bytes)
    const asked = untyped.res.status === 422 && untyped.body.code === 'password_required' && untyped.body.typed === false
    expect(untyped.res.status === 201 || asked, `${id}: first upload gave ${untyped.body.code}`).toBe(true)
    const first = asked ? await upload(h.jar, bytes, { password }) : untyped
    expect(first.res.status, `${id}: upload failed with ${first.body.code}`).toBe(201)
    const ms = Date.now() - t0
    const st = first.body.statement!
    const kindOk = (p.engine.kind === 'CDSL') === (st.kind === 'CDSL')
    expect(kindOk, `${id}: stored kind differs from the engine`).toBe(true)
    expect(first.body.member?.created, `${id}: no new member`).toBe(true)
    expect(/^[A-Z]{2}•{6}[A-Z0-9]{2}$/.test(first.body.member!.pan_masked), `${id}: PAN not masked`).toBe(true)

    // One sealed blob under h/, nothing under tmp/.
    const keys = await r2Keys(blobKeys.householdPrefix(h.householdId))
    expect(keys.length === 1 && keys[0] === blobKeys.statement(h.householdId, st.id), `${id}: expected exactly one statement blob`).toBe(true)
    expect((await r2Keys(blobKeys.tmpPrefix(h.householdId))).length, `${id}: something in tmp/`).toBe(0)

    // A raw read shows no plaintext: no PDF, no PAN or password, no JSON keys.
    const raw = new TextDecoder('latin1').decode(await (await env.BUCKET.get(keys[0]!))!.arrayBuffer())
    const secrets = [...p.candidates.filter(Boolean), '%PDF-', '"isin"', 'holder_name']
    expect(secrets.some((s) => raw.includes(s)), `${id}: plaintext found in the raw blob`).toBe(false)
    const blob = await getJsonBlob<{ statement: { holdings?: unknown[] } }>(env, await h.tenant.vault(), keys[0]!)
    const holdingsOk = Array.isArray(blob?.statement.holdings) && blob.statement.holdings.length === st.holdings_count
    expect(holdingsOk, `${id}: blob doesn't open to the parsed statement`).toBe(true)

    // The same file again: 409.
    const again = await upload(h.jar, bytes, { password })
    expect(again.res.status, `${id}: duplicate not refused`).toBe(409)

    // Delete it, then upload with no password: when the PAN is the password, the member's PAN opens it (D19).
    expect((await call(`/api/statements/${st.id}`, { method: 'DELETE', jar: h.jar })).status).toBe(200)
    expect((await r2Keys(blobKeys.householdPrefix(h.householdId))).length, `${id}: blob not deleted`).toBe(0)
    const panIsPassword = PAN_RE.test(password)
    const refiled = panIsPassword ? await upload(h.jar, bytes) : null
    const refiledOk = !refiled || (refiled.res.status === 201 && refiled.body.member?.id === first.body.member!.id)
    expect(refiledOk, `${id}: no-password re-upload gave ${refiled?.res.status} ${refiled?.body.code ?? ''}`).toBe(true)
    console.log(`${id}: ok (${st.kind}, first upload ${ms} ms)`) // counts and timings only
  })

  // Queued path (M8): no free slot, so the verified PDF is parked sealed; the consumer parses it on the real engine.
  it.each(pdfs.map((p) => [p.id, p] as const))('%s: queued, parked sealed, parsed by the consumer, nothing left in tmp/', { timeout: 180_000 }, async (id, p) => {
    const h = await newHousehold(`privq-${id}`)
    const bytes = fromBase64(p.base64)
    const password = p.candidates[p.engine.password_index] ?? ''
    const sent = captureQueue()
    const free = await fillPool()
    let queued
    try {
      queued = await upload(h.jar, bytes, password ? { password } : {})
    } finally {
      await free()
    }
    expect(queued.res.status, `${id}: expected 202, got ${queued.body.code}`).toBe(202)
    const jobId = queued.body.job!.id
    expect(sent.some((m) => m.job_id === jobId), `${id}: no queue message`).toBe(true)
    const parkedKeys = await r2Keys(blobKeys.tmpPrefix(h.householdId))
    const parkedRaw = new TextDecoder('latin1').decode(await (await env.BUCKET.get(parkedKeys[0]!))!.arrayBuffer())
    expect(parkedKeys.length === 1 && !parkedRaw.includes('%PDF-') && !(password && parkedRaw.includes(password)), `${id}: parked PDF not sealed`).toBe(true)

    const t0 = Date.now()
    await deliver(jobId)
    const ms = Date.now() - t0
    const job = await env.DB.prepare('SELECT status, blob_key, password_enc FROM parse_job WHERE id = ?1').bind(jobId).first<{ status: string; blob_key: string | null; password_enc: unknown }>()
    expect(job?.status, `${id}: job ended ${job?.status}`).toBe('done')
    expect(job?.blob_key === null && job?.password_enc === null, `${id}: job kept its PDF or password`).toBe(true)
    expect((await r2Keys(blobKeys.tmpPrefix(h.householdId))).length, `${id}: something left in tmp/`).toBe(0)
    const keys = await r2Keys(blobKeys.householdPrefix(h.householdId))
    const raw = new TextDecoder('latin1').decode(await (await env.BUCKET.get(keys[0]!))!.arrayBuffer())
    const secrets = [...p.candidates.filter(Boolean), '%PDF-', '"isin"', 'holder_name']
    expect(keys.length === 1 && !secrets.some((x) => raw.includes(x)), `${id}: expected one sealed statement blob`).toBe(true)
    console.log(`${id}: queued ok (consumer ${ms} ms)`) // counts and timings only
  })
})
