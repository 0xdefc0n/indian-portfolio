// EnginePool Durable Object (plan §14): one instance named "pool" leases engine slots to callers, gives queued jobs
// their place (tickets) and counts parked PDFs against the global cap (§11).
// Callers: acquire → env.ENGINE_FAST/ENGINE_BATCH.getByName(lease.name) → release. See lib/engine-client.ts.
import { DurableObject } from 'cloudflare:workers'
import {
  type AcquireOptions,
  type AcquireResult,
  type EngineClass,
  type ParkedState,
  type PoolState,
  type PoolStatus,
  type Position,
  type ReleaseInfo,
  PoolCore,
  TMP_MAX_BYTES,
  emptyPoolState,
  parseCap,
} from './pool-core'

const STATE_KEY = 'state'
const PARKED_KEY = 'parked'

export class EnginePool extends DurableObject<Env> {
  private readonly core: PoolCore

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    const state = ctx.storage.kv.get<PoolState>(STATE_KEY) ?? emptyPoolState()
    const parked = ctx.storage.kv.get<ParkedState>(PARKED_KEY) ?? { objects: 0, bytes: 0 }
    this.core = new PoolCore(
      state,
      { fast: parseCap(env.ENGINE_FAST_MAX, 60), batch: parseCap(env.ENGINE_BATCH_MAX, 60) },
      undefined,
      parked,
      { objects: parseCap(env.TMP_MAX_OBJECTS, 50_000), bytes: TMP_MAX_BYTES },
    )
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

  positions(cls: EngineClass, tickets: number[]): Position[] {
    return this.core.positions(cls, tickets, Date.now())
  }

  /** A parked PDF is gone. With a ticket, its waiter leaves the queue too. */
  unpark(bytes: number, ticket?: number): void {
    this.core.unpark(bytes)
    if (ticket !== undefined) this.core.forget('fast', ticket)
    this.save()
  }

  forget(cls: EngineClass, ticket: number): void {
    this.core.forget(cls, ticket)
    this.save()
  }

  setParked(objects: number, bytes: number): void {
    this.core.setParked(objects, bytes)
    this.save()
  }

  status(): PoolStatus {
    const now = Date.now()
    return { fast: this.core.status('fast', now), batch: this.core.status('batch', now), parked: { ...this.core.parked } }
  }

  // Synchronous KV on SQLite storage: the write is part of this call's output gate, so a reply never reports a lease
  // that wasn't persisted.
  private save(): void {
    this.ctx.storage.kv.put(STATE_KEY, this.core.state)
    this.ctx.storage.kv.put(PARKED_KEY, this.core.parked)
  }
}
