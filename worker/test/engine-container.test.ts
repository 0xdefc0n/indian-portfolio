// The full path with a real engine container (Docker): Worker → EnginePool → EngineFast-0 → engine /health.
import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

describe('engine container', () => {
  it('/api/health returns the engine version through the pool', { timeout: 120_000 }, async () => {
    const res = await exports.default.fetch('https://pocketfolio.test/api/health')
    const body = await res.json<{ ok: boolean; engine?: { version: string; slot: string } }>()
    expect({ status: res.status, ok: body.ok }).toEqual({ status: 200, ok: true })
    expect(body.engine?.slot).toBe('EngineFast-0')
    expect(body.engine?.version).toMatch(/^\d+\.\d+/)
  })
})
