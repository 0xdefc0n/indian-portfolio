// EnginePool unit tests (plan §16 "EnginePool"): fill-first, lease expiry, one job per slot, busy + ETA.
import { describe, expect, it } from 'vitest'
import { type AcquireResult, ENGINE_CLASSES, PoolCore, WAITER_TTL_MS, WARM_MS, emptyPoolState } from '../src/pool-core'

function pool(caps = { fast: 3, batch: 2 }) {
  let n = 0
  return new PoolCore(emptyPoolState(), caps, () => `lease-${++n}`)
}

function leased(r: AcquireResult) {
  if (!r.ok) throw new Error(`expected a lease, got ${r.code}`)
  return r
}

function busy(r: AcquireResult) {
  if (r.ok) throw new Error(`expected busy, got ${r.name}`)
  if (r.code !== 'busy') throw new Error(`expected busy, got ${r.code}`)
  return r
}

const T0 = 1_000_000

describe('fill-first routing', () => {
  it('light sequential traffic only ever uses slot 0', () => {
    const p = pool()
    for (let i = 0; i < 20; i++) {
      const now = T0 + i * 5_000
      const l = leased(p.acquire({ cls: 'fast' }, now))
      expect(l.name).toBe('EngineFast-0')
      expect(p.release(l.lease_id, { duration_ms: 1200, ok: true }, now + 1200)).toBe(true)
    }
    expect(p.state.fast.slots).toHaveLength(1)
  })

  it('a burst fills the lowest-numbered slots in order', () => {
    const p = pool()
    expect(leased(p.acquire({ cls: 'fast' }, T0)).name).toBe('EngineFast-0')
    expect(leased(p.acquire({ cls: 'fast' }, T0)).name).toBe('EngineFast-1')
    expect(leased(p.acquire({ cls: 'fast' }, T0)).name).toBe('EngineFast-2')
  })

  it('prefers a warm free slot over a lower-numbered cold one', () => {
    const p = pool()
    const a = leased(p.acquire({ cls: 'fast' }, T0)) // slot 0
    const b = leased(p.acquire({ cls: 'fast' }, T0)) // slot 1
    p.release(a.lease_id, { duration_ms: 1000, ok: true }, T0 + 1000)
    // slot 0 goes cold; slot 1 is used again later and stays warm
    p.release(b.lease_id, { duration_ms: 1000, ok: true }, T0 + WARM_MS)
    const c = leased(p.acquire({ cls: 'fast' }, T0 + WARM_MS + 10_000))
    expect(c.name).toBe('EngineFast-1')
    expect(c.warm).toBe(true)
  })

  it('falls back to the lowest free slot when none is warm', () => {
    const p = pool()
    const a = leased(p.acquire({ cls: 'fast' }, T0))
    const b = leased(p.acquire({ cls: 'fast' }, T0))
    p.release(b.lease_id, { duration_ms: 1, ok: true }, T0 + 1)
    p.release(a.lease_id, { duration_ms: 1, ok: true }, T0 + 1)
    const c = leased(p.acquire({ cls: 'fast' }, T0 + 10 * WARM_MS))
    expect(c.name).toBe('EngineFast-0')
    expect(c.warm).toBe(false)
  })

  it('keeps the classes apart', () => {
    const p = pool()
    expect(leased(p.acquire({ cls: 'fast' }, T0)).name).toBe('EngineFast-0')
    expect(leased(p.acquire({ cls: 'batch' }, T0)).name).toBe('EngineBatch-0')
  })
})

describe('one job per slot', () => {
  it('never hands out a leased slot, and is busy at the cap', () => {
    const p = pool({ fast: 3, batch: 2 })
    const names = [0, 1, 2].map(() => leased(p.acquire({ cls: 'fast' }, T0)).name)
    expect(new Set(names).size).toBe(3)
    busy(p.acquire({ cls: 'fast' }, T0 + 1))
    expect(p.status('fast', T0 + 1)).toMatchObject({ cap: 3, busy: 3 })
  })

  it('a released slot is reusable at once', () => {
    const p = pool({ fast: 1, batch: 1 })
    const a = leased(p.acquire({ cls: 'fast' }, T0))
    busy(p.acquire({ cls: 'fast' }, T0 + 1))
    p.release(a.lease_id, { duration_ms: 500, ok: true }, T0 + 500)
    expect(leased(p.acquire({ cls: 'fast' }, T0 + 501)).name).toBe('EngineFast-0')
  })

  it('a cap of 0 is always busy (forces the queued path)', () => {
    const p = pool({ fast: 0, batch: 0 })
    expect(busy(p.acquire({ cls: 'fast' }, T0)).code).toBe('busy')
  })

  it('releasing twice, or an unknown lease, is a no-op', () => {
    const p = pool()
    const a = leased(p.acquire({ cls: 'fast' }, T0))
    expect(p.release(a.lease_id, { duration_ms: 1, ok: true }, T0 + 1)).toBe(true)
    expect(p.release(a.lease_id, { duration_ms: 1, ok: true }, T0 + 2)).toBe(false)
    expect(p.release('nope', { duration_ms: 1, ok: true }, T0 + 2)).toBe(false)
  })
})

describe('lease expiry', () => {
  it('frees a slot whose caller crashed, after the class lease time', () => {
    const p = pool({ fast: 1, batch: 1 })
    const crashed = leased(p.acquire({ cls: 'fast' }, T0))
    const leaseMs = ENGINE_CLASSES.fast.leaseMs
    expect(crashed.expires_at).toBe(T0 + leaseMs)
    busy(p.acquire({ cls: 'fast' }, T0 + leaseMs - 1))
    const next = leased(p.acquire({ cls: 'fast' }, T0 + leaseMs))
    expect(next.name).toBe('EngineFast-0')
    // the crashed caller's late release can't free the new holder's lease
    expect(p.release(crashed.lease_id, { duration_ms: 1, ok: true }, T0 + leaseMs + 1)).toBe(false)
    busy(p.acquire({ cls: 'fast' }, T0 + leaseMs + 2))
  })

  it('build leases last longer than parse leases', () => {
    expect(ENGINE_CLASSES.batch.leaseMs).toBeGreaterThan(ENGINE_CLASSES.fast.leaseMs)
    const p = pool()
    expect(leased(p.acquire({ cls: 'batch' }, T0)).expires_at).toBe(T0 + 120_000)
  })
})

describe('busy, queue position and ETA', () => {
  it('reports the default job time as ETA before any job has run', () => {
    const p = pool({ fast: 1, batch: 1 })
    leased(p.acquire({ cls: 'fast' }, T0))
    const b = busy(p.acquire({ cls: 'fast' }, T0))
    expect(b).toMatchObject({ code: 'busy', queued_ahead: 0, eta_s: 2 })
    expect(b.ticket).toBeUndefined()
  })

  it('waiters get increasing tickets and positions; the ETA grows by whole rounds', () => {
    const p = pool({ fast: 2, batch: 1 })
    leased(p.acquire({ cls: 'fast' }, T0))
    leased(p.acquire({ cls: 'fast' }, T0))
    const w = [0, 1, 2, 3].map(() => busy(p.acquire({ cls: 'fast', wait: true }, T0)))
    expect(w.map((x) => x.ticket)).toEqual([1, 2, 3, 4])
    expect(w.map((x) => x.queued_ahead)).toEqual([0, 1, 2, 3])
    // 2 slots, 2 s average: positions 0–1 wait one round, 2–3 two rounds
    expect(w.map((x) => x.eta_s)).toEqual([2, 2, 4, 4])
    // a non-waiting caller sees everyone queued
    expect(busy(p.acquire({ cls: 'fast' }, T0)).queued_ahead).toBe(4)
  })

  it('a waiter keeps its place when it asks again, and leaves the queue when it gets a slot', () => {
    const p = pool({ fast: 1, batch: 1 })
    const holder = leased(p.acquire({ cls: 'fast' }, T0))
    const first = busy(p.acquire({ cls: 'fast', wait: true }, T0))
    const second = busy(p.acquire({ cls: 'fast', wait: true }, T0))
    expect(busy(p.acquire({ cls: 'fast', wait: true, ticket: second.ticket }, T0 + 1000)).queued_ahead).toBe(1)
    p.release(holder.lease_id, { duration_ms: 1000, ok: true }, T0 + 1000)
    leased(p.acquire({ cls: 'fast', wait: true, ticket: first.ticket }, T0 + 1001))
    expect(p.status('fast', T0 + 1001).waiting).toBe(1)
  })

  it('forgets waiters that stop asking', () => {
    const p = pool({ fast: 1, batch: 1 })
    leased(p.acquire({ cls: 'fast' }, T0))
    busy(p.acquire({ cls: 'fast', wait: true }, T0))
    expect(p.status('fast', T0 + WAITER_TTL_MS - 1).waiting).toBe(1)
    expect(p.status('fast', T0 + WAITER_TTL_MS).waiting).toBe(0)
  })

  it('ETA follows the moving average of successful jobs only', () => {
    const p = pool({ fast: 1, batch: 1 })
    let t = T0
    for (const ms of [10_000, 10_000, 10_000]) {
      const l = leased(p.acquire({ cls: 'fast' }, t))
      t += ms
      p.release(l.lease_id, { duration_ms: ms, ok: true }, t)
    }
    const failed = leased(p.acquire({ cls: 'fast' }, t))
    p.release(failed.lease_id, { duration_ms: 1, ok: false }, t + 1)
    const probe = leased(p.acquire({ cls: 'fast' }, t + 2))
    p.release(probe.lease_id, { duration_ms: 1, ok: true, record: false }, t + 3)
    expect(p.status('fast', t + 3).avg_ms).toBe(10_000)
    leased(p.acquire({ cls: 'fast' }, t + 4))
    expect(busy(p.acquire({ cls: 'fast' }, t + 4)).eta_s).toBe(10)
  })
})

describe('queued jobs keep their place (M8)', () => {
  it('a ticket asked again after the waiter TTL is re-registered at the same number, not sent to the back', () => {
    const p = pool({ fast: 1, batch: 1 })
    leased(p.acquire({ cls: 'fast' }, T0))
    const first = busy(p.acquire({ cls: 'fast', wait: true }, T0))
    leased(p.acquire({ cls: 'fast' }, T0 + WAITER_TTL_MS)) // the first lease expired; someone else holds the slot now
    busy(p.acquire({ cls: 'fast', wait: true }, T0 + WAITER_TTL_MS)) // a later job
    const back = busy(p.acquire({ cls: 'fast', wait: true, ticket: first.ticket }, T0 + WAITER_TTL_MS + 1))
    expect(back).toMatchObject({ ticket: first.ticket, queued_ahead: 0 })
    // A ticket the pool never issued gets a new one.
    expect(busy(p.acquire({ cls: 'fast', wait: true, ticket: 999 }, T0 + WAITER_TTL_MS + 2)).ticket).toBe(3)
  })

  it('positions() reports where tickets stand without renewing them', () => {
    const p = pool({ fast: 1, batch: 1 })
    leased(p.acquire({ cls: 'fast' }, T0))
    const a = busy(p.acquire({ cls: 'fast', wait: true }, T0))
    const b = busy(p.acquire({ cls: 'fast', wait: true }, T0))
    expect(p.positions('fast', [a.ticket!, b.ticket!], T0 + 1)).toEqual([
      { ticket: a.ticket, queued_ahead: 0, eta_s: 2 },
      { ticket: b.ticket, queued_ahead: 1, eta_s: 4 },
    ])
    p.forget('fast', a.ticket!)
    expect(p.positions('fast', [b.ticket!], T0 + 2)[0]!.queued_ahead).toBe(0)
    expect(p.status('fast', T0 + WAITER_TTL_MS + 1).waiting).toBe(0) // positions() didn't renew b
  })
})

describe('parked-PDF cap (§11)', () => {
  const capped = () => {
    let n = 0
    return new PoolCore(emptyPoolState(), { fast: 1, batch: 1 }, () => `lease-${++n}`, { objects: 0, bytes: 0 }, { objects: 2, bytes: 1000 })
  }

  it('a busy answer with `park` takes the counter; at the cap the answer is `full`, with no ticket and nothing counted', () => {
    const p = capped()
    leased(p.acquire({ cls: 'fast', wait: true, park: 100 }, T0)) // a free slot: nothing is parked
    expect(p.parked).toEqual({ objects: 0, bytes: 0 })
    busy(p.acquire({ cls: 'fast', wait: true, park: 100 }, T0))
    busy(p.acquire({ cls: 'fast', wait: true, park: 100 }, T0))
    expect(p.parked).toEqual({ objects: 2, bytes: 200 })
    expect(p.acquire({ cls: 'fast', wait: true, park: 100 }, T0)).toEqual({ ok: false, code: 'full', retry_after: 60 })
    expect(p.status('fast', T0).waiting).toBe(2)
    p.unpark(100)
    expect(p.parked).toEqual({ objects: 1, bytes: 100 })
    // The byte cap counts too.
    expect(p.acquire({ cls: 'fast', wait: true, park: 901 }, T0)).toMatchObject({ code: 'full' })
    busy(p.acquire({ cls: 'fast', wait: true, park: 900 }, T0))
  })

  it('unpark never goes below zero, and setParked (the tmp-sweep recount) replaces the counts', () => {
    const p = capped()
    p.unpark(50)
    expect(p.parked).toEqual({ objects: 0, bytes: 0 })
    p.setParked(7, 7000)
    expect(p.parked).toEqual({ objects: 7, bytes: 7000 })
  })
})
