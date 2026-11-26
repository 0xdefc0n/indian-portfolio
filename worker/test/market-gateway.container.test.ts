// Spike + regression: an EngineBatch container (no internet) reads a NAV series from R2 through MarketGateway.
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

describe('engine → market.internal → R2', () => {
  it('/build reads the benchmark series through the gateway', { timeout: 180_000 }, async () => {
    const dates = ['2025-11-24', '2026-11-24']
    await env.BUCKET.put('market/nav/120716.json', JSON.stringify({ amfi_code: 120716, dates, navs: [100, 110] }))
    const engine = env.ENGINE_BATCH.getByName('EngineBatch-1')
    const res = await engine.fetch('http://engine/build', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ statements: [], market: { market_date: '2026-11-24' }, today: '2026-11-25' }),
    })
    const body = await res.json<{ ok: boolean; snapshot?: { benchmark: { returns: { '1y': number } } | null } }>()
    expect(res.status).toBe(200)
    expect(body.snapshot?.benchmark?.returns['1y']).toBeCloseTo(0.1, 5)
  })
})
