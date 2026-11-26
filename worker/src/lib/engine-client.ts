// The one way routes and jobs reach the engine: lease a slot from EnginePool, call that slot, release it.
import type { AcquireOptions, EngineClass } from '../pool-core'

export type Busy = { ok: false; code: 'busy'; queued_ahead: number; eta_s: number; ticket?: number }
export type Leased<T> = { ok: true; slot: string; value: T }

export function enginePool(env: Env) {
  return env.ENGINE_POOL.getByName('pool')
}

function engineNamespace(env: Env, cls: EngineClass) {
  return cls === 'fast' ? env.ENGINE_FAST : env.ENGINE_BATCH
}

/**
 * Runs `fn` against a leased engine slot. Returns `busy` (with the queue position and ETA) when no slot is free;
 * the caller decides whether to queue or answer 503. The lease is always released, also when `fn` throws.
 */
export async function withEngine<T>(
  env: Env,
  opts: AcquireOptions & { record?: boolean },
  fn: (engine: Fetcher) => Promise<T>,
): Promise<Leased<T> | Busy> {
  const pool = enginePool(env)
  const lease = await pool.acquire({ cls: opts.cls, wait: opts.wait, ticket: opts.ticket })
  if (!lease.ok) return lease
  const started = Date.now()
  let ok = false
  try {
    const value = await fn(engineNamespace(env, opts.cls).getByName(lease.name))
    ok = true
    return { ok: true, slot: lease.name, value }
  } finally {
    await pool.release(lease.lease_id, { duration_ms: Date.now() - started, ok, record: opts.record })
  }
}

// ─── /parse (plan §10.1 C5) ──────────────────────────────────────────────────────────────────────────────────────

/** Engine /parse timeout (§10.1). A large CAMS statement on standard-2 is expected to take ≤ 10 s. */
export const PARSE_TIMEOUT_MS = 60_000
/** The engine restarts its process every 200 requests (engine/entrypoint.sh): a refused connection is retried. */
const CONNECT_RETRIES = 3
const CONNECT_RETRY_MS = 1_000

export type ParsedStatement = Record<string, unknown> & {
  pan?: string | null
  holder_name?: string | null
  period_from?: string | null
  period_to?: string | null
  valuation_date?: string | null
  holdings?: Array<Record<string, unknown>>
  warnings?: unknown[]
}
export type EngineParse =
  | { ok: true; kind: 'CDSL' | 'RTA'; source: string; pan: string | null; statement: ParsedStatement; version: string }
  | { ok: false; code: string }

export type ParseRequest = { bytes: Uint8Array<ArrayBuffer>; password: string; kind: 'CDSL' | 'RTA' }

/** base64url of the UTF-8 password, the X-Pdf-Password header format (engine/engine/server.py). */
export function passwordHeader(password: string): string {
  let bin = ''
  for (const b of new TextEncoder().encode(password)) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Parse one verified PDF on a leased EngineFast slot. `busy` when no slot is free (the caller queues it, M8). */
export function parseOnEngine(env: Env, req: ParseRequest): Promise<Leased<EngineParse> | Busy> {
  return withEngine(env, { cls: 'fast' }, async (engine) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<EngineParse>((done) => {
      timer = setTimeout(() => done({ ok: false, code: 'parse_timeout' }), PARSE_TIMEOUT_MS)
    })
    try {
      return await Promise.race([callParse(engine, req), timeout])
    } finally {
      clearTimeout(timer)
    }
  })
}

async function callParse(engine: Fetcher, req: ParseRequest): Promise<EngineParse> {
  const headers = { 'content-type': 'application/pdf', 'x-pdf-password': passwordHeader(req.password), 'x-statement-kind': req.kind }
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await engine.fetch('http://engine/parse', { method: 'POST', headers, body: req.bytes })
    } catch (err) {
      if (attempt >= CONNECT_RETRIES || (err as Error).name === 'EngineStartError') throw err
      await scheduler.wait(CONNECT_RETRY_MS)
      continue
    }
    const body = await res.json<Record<string, unknown>>().catch(() => null)
    // 503 busy only if the pool and the engine disagree about a slot (a lease expired mid-parse): wait, then retry.
    if (res.status === 503 && attempt < CONNECT_RETRIES) {
      await scheduler.wait(CONNECT_RETRY_MS)
      continue
    }
    if (body && body.ok === true) return body as EngineParse
    return { ok: false, code: typeof body?.code === 'string' ? body.code : 'parse_error' }
  }
}

/** The engine calls the upload route makes. A plain object so tests can swap in a fake engine (vi.spyOn). */
export const engineApi = { parse: parseOnEngine }
