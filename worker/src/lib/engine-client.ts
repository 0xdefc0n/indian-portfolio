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
