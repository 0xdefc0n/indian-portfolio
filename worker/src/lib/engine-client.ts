// The one way routes and jobs reach the engine: lease a slot from EnginePool, call that slot, release it.
import type { AcquireOptions, AcquireResult, EngineClass } from '../pool-core'

export type Busy = { ok: false; code: 'busy'; queued_ahead: number; eta_s: number; ticket?: number }
export type Full = { ok: false; code: 'full'; retry_after: number }
export type Leased<T> = { ok: true; slot: string; value: T }
/** A held engine slot (from acquireEngine). Pass it to parseOnLease or releaseLease exactly once. */
export type EngineLease = Extract<AcquireResult, { ok: true }> & { cls: EngineClass; started: number }

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
  if (!lease.ok) return lease.code === 'busy' ? lease : { ok: false, code: 'busy', queued_ahead: 0, eta_s: lease.retry_after }
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

/**
 * Ask EnginePool for a slot. `busy` (with a ticket when `wait`) when none is free; `full` when `park` was asked and
 * the global parked-PDF cap is reached.
 */
export async function acquireEngine(env: Env, opts: AcquireOptions): Promise<EngineLease | Busy | Full> {
  const r = await enginePool(env).acquire(opts)
  return r.ok ? { ...r, cls: opts.cls, started: Date.now() } : r
}

/** Give a slot back without using it. */
export async function releaseLease(env: Env, lease: EngineLease, ok = false): Promise<void> {
  await enginePool(env).release(lease.lease_id, { duration_ms: Date.now() - lease.started, ok, record: ok })
}

/** Parse one verified PDF on a held EngineFast slot. The lease is always released, also when this throws. */
export async function parseOnLease(env: Env, lease: EngineLease, req: ParseRequest): Promise<EngineParse> {
  let ok = false
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const engine = engineNamespace(env, 'fast').getByName(lease.name)
    const timeout = new Promise<EngineParse>((done) => {
      timer = setTimeout(() => done({ ok: false, code: 'parse_timeout' }), PARSE_TIMEOUT_MS)
    })
    const res = await Promise.race([callParse(engine, req), timeout])
    ok = res.ok
    return res
  } finally {
    clearTimeout(timer)
    await releaseLease(env, lease, ok)
  }
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

/**
 * The engine calls the upload route and the parse consumer make. A plain object so tests can swap in a fake engine
 * (vi.spyOn), or a pool with no free slot.
 */
export const engineApi = { acquire: acquireEngine, parse: parseOnLease, release: releaseLease }
