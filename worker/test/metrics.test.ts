// POST /api/metrics (plan §13A.6, M15): anonymous daily counters for the installable app.
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { LIMITS } from '../src/lib/limits'
import { quotaWindow } from '../src/lib/quota'
import { call, sinkAddress, signInWithCode } from './helpers/auth'

const today = () => quotaWindow('day')
const total = async (metric: string) =>
  (await env.DB.prepare('SELECT count FROM metric_daily WHERE metric = ?1 AND date = ?2').bind(metric, today()).first<{ count: number }>())?.count ?? 0

describe('/api/metrics', () => {
  it('needs a session (and consent)', async () => {
    expect((await call('/api/metrics', { body: { metric: 'launch_standalone' } })).status).toBe(401)
    const jar = await signInWithCode(sinkAddress('mc'), undefined, '192.0.2.61', { consent: false })
    expect((await call('/api/metrics', { jar, body: { metric: 'launch_standalone' } })).status).toBe(403)
  })

  it('adds one to today’s total of a known metric, and stores nothing about the user', async () => {
    const jar = await signInWithCode(sinkAddress('m'), undefined, '192.0.2.62')
    const before = await total('install_prompt_shown')
    for (let i = 0; i < 2; i++) expect((await call('/api/metrics', { jar, body: { metric: 'install_prompt_shown' } })).status).toBe(204)
    expect(await total('install_prompt_shown')).toBe(before + 2)
    const cols = await env.DB.prepare('SELECT name FROM pragma_table_info(?1)').bind('metric_daily').all<{ name: string }>()
    expect(cols.results.map((c) => c.name).sort()).toEqual(['count', 'date', 'metric'])
  })

  it('rejects unknown metrics and bad bodies', async () => {
    const jar = await signInWithCode(sinkAddress('mu'), undefined, '192.0.2.63')
    for (const body of [{ metric: 'pan_seen' }, { metric: 7 }, {}]) {
      const res = await call('/api/metrics', { jar, body })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ ok: false, code: 'unknown_metric' })
    }
  })

  it('one account can add at most the daily cap; past it the answer is still 204 and the total stops', async () => {
    const jar = await signInWithCode(sinkAddress('mq'), undefined, '192.0.2.64')
    const before = await total('launch_shortcut')
    for (let i = 0; i < LIMITS.metricEventsPerDay + 3; i++) {
      expect((await call('/api/metrics', { jar, body: { metric: 'launch_shortcut' } })).status).toBe(204)
    }
    expect(await total('launch_shortcut')).toBe(before + LIMITS.metricEventsPerDay)
  })
})
