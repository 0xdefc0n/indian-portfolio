// EnginePool Durable Object (plan §14): one instance named "pool" leases engine slots to callers.
// Callers: acquire → env.ENGINE_FAST/ENGINE_BATCH.getByName(lease.name) → release. See lib/engine-client.ts.
import { DurableObject } from 'cloudflare:workers'
import {
  type AcquireOptions,
  type AcquireResult,
  type ClassStatus,
  type EngineClass,
  type PoolState,
  type ReleaseInfo,
  PoolCore,
  emptyPoolState,
  parseCap,
} from './pool-core'

const STATE_KEY = 'state'

export class EnginePool extends DurableObject<Env> {
  private readonly core: PoolCore

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    const state = ctx.storage.kv.get<PoolState>(STATE_KEY) ?? emptyPoolState()
    this.core = new PoolCore(state, {
      fast: parseCap(env.ENGINE_FAST_MAX, 60),
      batch: parseCap(env.ENGINE_BATCH_MAX, 60),
    })
  }

  acquire(opts: AcquireOptions): AcquireResult {
    const result = this.core.acquire(opts, Date.now())
    this.save()
    return result
  }

  release(leaseId: string, info: ReleaseInfo): boolean {
    const released = this.core.release(leaseId, info, Date.now())
    if (released) this.save()
    return released
  }

  status(): Record<EngineClass, ClassStatus> {
    const now = Date.now()
    return { fast: this.core.status('fast', now), batch: this.core.status('batch', now) }
  }

  // Synchronous KV on SQLite storage: the write is part of this call's output gate, so a reply never reports a lease
  // that wasn't persisted.
  private save(): void {
    this.ctx.storage.kv.put(STATE_KEY, this.core.state)
  }
}
