// EnginePool slot logic (plan §14), kept pure so it can be unit-tested with an injected clock.
// The Durable Object in engine-pool.ts owns one PoolState, persists it after each call, and is single-threaded,
// so slot counts here are exact.

export type EngineClass = 'fast' | 'batch'

export const ENGINE_CLASSES: Record<
  EngineClass,
  { prefix: 'EngineFast' | 'EngineBatch'; leaseMs: number; defaultAvgMs: number }
> = {
  // parse: ~1.2 s CDSL on 1 vCPU (§3.3); a lease outlives any parse, so a crashed caller frees the slot in 90 s.
  fast: { prefix: 'EngineFast', leaseMs: 90_000, defaultAvgMs: 2_000 },
  // build on 1/4 vCPU: slower, nobody waits for it.
  batch: { prefix: 'EngineBatch', leaseMs: 120_000, defaultAvgMs: 5_000 },
}

/** A slot used this recently still has a running container (inactivity timeout, src/engine.ts). */
export const WARM_MS = 60_000
/** A waiter that hasn't asked again in this long is forgotten (its consumer died or gave up). */
export const WAITER_TTL_MS = 5 * 60_000
/** Weight of the newest job in the moving average of job time. */
export const AVG_ALPHA = 0.2

export interface Lease {
  id: string
  expiresAt: number
}

export interface SlotState {
  lease: Lease | null
  /** Last time a job started or ended on this slot (ms), 0 if never. */
  lastUsed: number
}

export interface ClassState {
  slots: SlotState[]
  avgMs: number
  jobs: number
  /** Last waiter ticket issued (the queue `seq` counter). */
  seq: number
  /** Live waiters: ticket → expiry (ms). */
  waiters: Record<string, number>
}

export type PoolState = Record<EngineClass, ClassState>

/** Parked PDFs in R2 tmp/, all users (§11). Counted here so the cap check is exact; tmp-sweep recounts from D1. */
export interface ParkedState {
  objects: number
  bytes: number
}

export interface ParkedCaps {
  objects: number
  bytes: number
}

/** Default global cap on parked PDFs (§11): 50,000 objects (TMP_MAX_OBJECTS) or 5 GB. */
export const TMP_MAX_BYTES = 5 * 1024 ** 3
/** Retry-After for an upload refused because the parked-PDF cap is reached. */
export const PARKED_FULL_RETRY_S = 60

export type AcquireResult =
  | { ok: true; lease_id: string; name: string; expires_at: number; warm: boolean }
  | { ok: false; code: 'busy'; queued_ahead: number; eta_s: number; ticket?: number }
  | { ok: false; code: 'full'; retry_after: number }

export interface AcquireOptions {
  cls: EngineClass
  /** The caller will wait for a slot: give it a place in the queue (a ticket) if all slots are busy. */
  wait?: boolean
  /**
   * A ticket from an earlier busy answer, to keep the caller's place. A queued job asks again every few seconds to
   * minutes and keeps its ticket in D1 (parse_job.seq), so an expired ticket is re-registered at the same number.
   */
  ticket?: number
  /**
   * With `wait`: the caller will park a PDF of this many bytes if no slot is free. The parked-PDF counter is taken
   * with the ticket, or the answer is `full` (no ticket, nothing counted) when the global cap is reached.
   */
  park?: number
}

export interface Position {
  ticket: number
  queued_ahead: number
  eta_s: number
}

export interface ReleaseInfo {
  duration_ms: number
  ok: boolean
  /** false for probes such as /api/health, which shouldn't move the job-time average. */
  record?: boolean
}

export interface ClassStatus {
  cap: number
  busy: number
  warm: number
  waiting: number
  avg_ms: number
}

export interface PoolStatus {
  fast: ClassStatus
  batch: ClassStatus
  parked: ParkedState
}

export function emptyClassState(cls: EngineClass): ClassState {
  return { slots: [], avgMs: ENGINE_CLASSES[cls].defaultAvgMs, jobs: 0, seq: 0, waiters: {} }
}

export function emptyPoolState(): PoolState {
  return { fast: emptyClassState('fast'), batch: emptyClassState('batch') }
}

export function slotName(cls: EngineClass, index: number): string {
  return `${ENGINE_CLASSES[cls].prefix}-${index}`
}

export class PoolCore {
  constructor(
    readonly state: PoolState,
    private readonly caps: Record<EngineClass, number>,
    private readonly newId: () => string = () => crypto.randomUUID(),
    readonly parked: ParkedState = { objects: 0, bytes: 0 },
    private readonly parkedCaps: ParkedCaps = { objects: 50_000, bytes: TMP_MAX_BYTES },
  ) {}

  acquire(opts: AcquireOptions, now: number): AcquireResult {
    const { cls } = opts
    const st = this.state[cls]
    this.expire(st, now)

    const index = this.pickFree(cls, now)
    if (index !== null) {
      const slot = this.slot(st, index)
      const warm = isWarm(slot, now)
      const lease: Lease = { id: this.newId(), expiresAt: now + ENGINE_CLASSES[cls].leaseMs }
      slot.lease = lease
      slot.lastUsed = now
      if (opts.ticket !== undefined) delete st.waiters[String(opts.ticket)]
      return { ok: true, lease_id: lease.id, name: slotName(cls, index), expires_at: lease.expiresAt, warm }
    }

    if (opts.wait && opts.park !== undefined) {
      const bytes = Math.max(0, Math.trunc(opts.park))
      if (this.parked.objects + 1 > this.parkedCaps.objects || this.parked.bytes + bytes > this.parkedCaps.bytes) {
        return { ok: false, code: 'full', retry_after: PARKED_FULL_RETRY_S }
      }
      this.parked.objects++
      this.parked.bytes += bytes
    }

    let ticket: number | undefined
    if (opts.wait) {
      const known = opts.ticket !== undefined && Number.isSafeInteger(opts.ticket) && opts.ticket > 0 && opts.ticket <= st.seq
      ticket = known ? opts.ticket! : ++st.seq
      st.waiters[String(ticket)] = now + WAITER_TTL_MS
    }
    const ahead = this.ahead(st, ticket)
    return { ok: false, code: 'busy', queued_ahead: ahead, eta_s: this.eta(cls, ahead), ...(ticket ? { ticket } : {}) }
  }

  /** Where these tickets stand now (for GET /api/jobs). Read-only: it doesn't renew or register a waiter. */
  positions(cls: EngineClass, tickets: number[], now: number): Position[] {
    const st = this.state[cls]
    this.expire(st, now)
    return tickets.map((ticket) => {
      const ahead = this.ahead(st, ticket)
      return { ticket, queued_ahead: ahead, eta_s: this.eta(cls, ahead) }
    })
  }

  /** A waiter that won't ask again (its job was cancelled, finished or failed to park). */
  forget(cls: EngineClass, ticket: number): void {
    delete this.state[cls].waiters[String(ticket)]
  }

  /** A parked PDF was deleted (parsed, failed, cancelled, expired, or it never got stored). */
  unpark(bytes: number): void {
    this.parked.objects = Math.max(0, this.parked.objects - 1)
    this.parked.bytes = Math.max(0, this.parked.bytes - Math.max(0, Math.trunc(bytes)))
  }

  /** tmp-sweep's recount from D1: corrects drift from callers that died between parking and unparking. */
  setParked(objects: number, bytes: number): void {
    this.parked.objects = Math.max(0, Math.trunc(objects))
    this.parked.bytes = Math.max(0, Math.trunc(bytes))
  }

  private ahead(st: ClassState, ticket: number | undefined): number {
    return Object.keys(st.waiters).filter((t) => ticket === undefined || Number(t) < ticket).length
  }

  /** Frees the slot holding this lease. Returns false if the lease is unknown or already expired. */
  release(leaseId: string, info: ReleaseInfo, now: number): boolean {
    for (const cls of Object.keys(this.state) as EngineClass[]) {
      const st = this.state[cls]
      const slot = st.slots.find((s) => s.lease?.id === leaseId)
      if (!slot) continue
      slot.lease = null
      slot.lastUsed = now
      if (info.ok && info.record !== false && info.duration_ms > 0) {
        st.avgMs = st.jobs === 0 ? info.duration_ms : st.avgMs * (1 - AVG_ALPHA) + info.duration_ms * AVG_ALPHA
        st.jobs++
      }
      return true
    }
    return false
  }

  status(cls: EngineClass, now: number): ClassStatus {
    const st = this.state[cls]
    this.expire(st, now)
    const live = st.slots.slice(0, this.caps[cls])
    return {
      cap: this.caps[cls],
      busy: live.filter((s) => s.lease).length,
      warm: live.filter((s) => isWarm(s, now)).length,
      waiting: Object.keys(st.waiters).length,
      avg_ms: Math.round(st.avgMs),
    }
  }

  /**
   * Seconds until a caller with `ahead` waiters in front of it gets a slot: every slot is busy, so it waits for
   * `ahead / cap` full rounds plus the current one. The load test (M16) checks this is within ±50%.
   */
  private eta(cls: EngineClass, ahead: number): number {
    const cap = Math.max(this.caps[cls], 1)
    const rounds = Math.floor(ahead / cap) + 1
    return Math.max(1, Math.ceil((rounds * this.state[cls].avgMs) / 1000))
  }

  /** Lowest-numbered free slot that is still warm, else the lowest-numbered free slot ("fill first"). */
  private pickFree(cls: EngineClass, now: number): number | null {
    const st = this.state[cls]
    const cap = this.caps[cls]
    let firstFree: number | null = null
    for (let i = 0; i < cap; i++) {
      const slot = st.slots[i]
      if (slot?.lease) continue
      if (slot && isWarm(slot, now)) return i
      firstFree ??= i
    }
    return firstFree
  }

  private slot(st: ClassState, index: number): SlotState {
    while (st.slots.length <= index) st.slots.push({ lease: null, lastUsed: 0 })
    return st.slots[index]!
  }

  private expire(st: ClassState, now: number): void {
    for (const slot of st.slots) {
      if (slot.lease && slot.lease.expiresAt <= now) slot.lease = null
    }
    for (const [ticket, expiresAt] of Object.entries(st.waiters)) {
      if (expiresAt <= now) delete st.waiters[ticket]
    }
  }
}

function isWarm(slot: SlotState, now: number): boolean {
  return slot.lastUsed > 0 && now - slot.lastUsed < WARM_MS
}

export function parseCap(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}
