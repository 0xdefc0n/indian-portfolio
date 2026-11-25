// Fair-use counters (plan §11, src/lib/quota.ts): atomic, all-or-nothing, IST windows.
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { quotaCounts, quotaWindow, secondsLeft, takeQuota, type QuotaSpec } from '../src/lib/quota'

const subject = () => `user:${crypto.randomUUID()}`

describe('quota windows (IST)', () => {
  it('labels hours, days and months in IST and counts down to the end of the window', () => {
    const t = Date.UTC(2026, 10, 24, 18, 45) // 2026-11-25 00:15 IST
    expect(quotaWindow('hour', t)).toBe('2026-11-25T00')
    expect(quotaWindow('day', t)).toBe('2026-11-25')
    expect(quotaWindow('month', t)).toBe('2026-11')
    expect(quotaWindow('day', Date.UTC(2026, 10, 24, 18, 29))).toBe('2026-11-24')
    expect(secondsLeft('hour', t)).toBe(45 * 60)
    expect(secondsLeft('day', t)).toBe(23 * 3600 + 45 * 60)
    expect(secondsLeft('month', t)).toBe(5 * 86400 + 23 * 3600 + 45 * 60)
  })
})

describe('takeQuota', () => {
  it('takes up to the limit, then refuses with which counter and when it resets', async () => {
    const spec: QuotaSpec = { subject: subject(), metric: 'upload', period: 'day', limit: 3 }
    const now = Date.UTC(2026, 10, 24, 6, 30) // 12:00 IST
    for (let i = 0; i < 3; i++) expect(await takeQuota(env, [spec], now)).toEqual({ ok: true })
    expect(await takeQuota(env, [spec], now)).toEqual({ ok: false, ...spec, retryAfter: 12 * 3600 })
    expect(await quotaCounts(env, [spec], now)).toEqual([3])
    // A new day starts a new window.
    expect(await takeQuota(env, [spec], now + 12 * 3600_000)).toEqual({ ok: true })
  })

  it('is atomic under concurrency: 30 parallel takes at a limit of 20 give exactly 20', async () => {
    const spec: QuotaSpec = { subject: subject(), metric: 'upload', period: 'day', limit: 20 }
    const results = await Promise.all(Array.from({ length: 30 }, () => takeQuota(env, [spec])))
    expect(results.filter((r) => r.ok)).toHaveLength(20)
    expect(await quotaCounts(env, [spec])).toEqual([20])
  })

  it('is all-or-nothing across counters: a full month leaves the day counter untouched', async () => {
    const s = subject()
    const day: QuotaSpec = { subject: s, metric: 'upload', period: 'day', limit: 20 }
    const month: QuotaSpec = { subject: s, metric: 'upload', period: 'month', limit: 2 }
    expect((await takeQuota(env, [day, month])).ok).toBe(true)
    expect((await takeQuota(env, [day, month])).ok).toBe(true)
    const refused = await takeQuota(env, [day, month])
    expect(refused).toMatchObject({ ok: false, period: 'month', limit: 2 })
    expect(await quotaCounts(env, [day, month])).toEqual([2, 2])
  })

  it('a limit of 0 always refuses; counters are per subject and metric', async () => {
    const s = subject()
    expect((await takeQuota(env, [{ subject: s, metric: 'export', period: 'day', limit: 0 }])).ok).toBe(false)
    const one: QuotaSpec = { subject: s, metric: 'parse_fail', period: 'hour', limit: 1 }
    expect((await takeQuota(env, [one])).ok).toBe(true)
    expect((await takeQuota(env, [{ ...one, metric: 'upload' }])).ok).toBe(true)
    expect((await takeQuota(env, [{ ...one, subject: subject() }])).ok).toBe(true)
    expect((await takeQuota(env, [one])).ok).toBe(false)
  })
})
