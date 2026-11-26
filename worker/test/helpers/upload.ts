// Upload helpers: a multipart POST /api/statements, synthetic statement PDFs that differ per call (so they aren't
// duplicates), and a fake engine for the synthetic tests (the real one is used in statements.private.test.ts).
// All values are synthetic: fake PANs, names and ISINs.
import { exports } from 'cloudflare:workers'
import { vi } from 'vitest'
import { engineApi, type EngineParse, type ParseRequest } from '../../src/lib/engine-client'
import { type FixturePage, makePdf } from './pdf-fixture'
import { type Jar, ORIGIN } from './auth'

export type UploadBody = {
  ok?: false
  code?: string
  typed?: boolean
  retry_after?: number
  statement?: { id: string; kind: string; as_of: string; holdings_count: number; warnings_count: number }
  member?: { id: string; name: string | null; pan_masked: string; created: boolean }
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

/** Replace the engine: `answer` decides each parse. Returns the requests it saw (to check the password sent). */
export function fakeEngine(answer: EngineParse | ((req: ParseRequest) => EngineParse | Promise<EngineParse>)) {
  const calls: ParseRequest[] = []
  vi.spyOn(engineApi, 'parse').mockImplementation(async (_env, req) => {
    calls.push(req)
    return { ok: true, slot: 'EngineFast-0', value: typeof answer === 'function' ? await answer(req) : answer }
  })
  return calls
}

/** All engine slots busy. */
export function busyEngine() {
  const spy = vi.spyOn(engineApi, 'parse').mockResolvedValue({ ok: false, code: 'busy', queued_ahead: 3, eta_s: 7.2 })
  return spy
}
