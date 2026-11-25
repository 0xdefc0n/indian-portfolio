// EnginePool as a real Durable Object in workerd: RPC, caps from env, state kept across eviction.
import { env, evictDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

describe('EnginePool Durable Object', () => {
  it('leases fill-first up to ENGINE_FAST_MAX, then reports busy', async () => {
    const pool = env.ENGINE_POOL.getByName('pool-cap-test')
    const names: string[] = []
    for (let i = 0; i < 3; i++) {
      const r = await pool.acquire({ cls: 'fast' })
      if (!r.ok) throw new Error('expected a lease')
      names.push(r.name)
    }
    expect(names).toEqual(['EngineFast-0', 'EngineFast-1', 'EngineFast-2'])
    const r = await pool.acquire({ cls: 'fast' })
    expect(r).toMatchObject({ ok: false, code: 'busy', queued_ahead: 0 })
    expect(await pool.status()).toMatchObject({ fast: { cap: 3, busy: 3 }, batch: { cap: 2, busy: 0 } })
  })

  it('keeps leases when the object is evicted and restarted', async () => {
    const pool = env.ENGINE_POOL.getByName('pool-evict-test')
    const lease = await pool.acquire({ cls: 'batch' })
    if (!lease.ok) throw new Error('expected a lease')
    await evictDurableObject(pool)
    const after = env.ENGINE_POOL.getByName('pool-evict-test')
    expect((await after.status()).batch.busy).toBe(1)
    expect(await after.release(lease.lease_id, { duration_ms: 3000, ok: true })).toBe(true)
    expect((await after.status()).batch).toMatchObject({ busy: 0, avg_ms: 3000 })
  })
})
