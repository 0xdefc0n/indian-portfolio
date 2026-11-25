// HTTP surface that doesn't need a running container. The engine round trip is checked under `wrangler dev`.
import { env } from 'cloudflare:test'
import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

const api = (path: string) => exports.default.fetch(`https://pocketfolio.test${path}`)

describe('/api', () => {
  it('unknown API routes are JSON 404s, not the SPA', async () => {
    const res = await api('/api/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ ok: false, code: 'not_found' })
  })

  it('/api/health answers 503 busy with Retry-After when every EngineFast slot is leased', async () => {
    const pool = env.ENGINE_POOL.getByName('pool')
    for (let i = 0; i < 3; i++) expect((await pool.acquire({ cls: 'fast' })).ok).toBe(true)
    const res = await api('/api/health')
    expect(res.status).toBe(503)
    expect(res.headers.get('Retry-After')).toBe('2')
    expect(await res.json()).toEqual({ ok: false, code: 'busy', eta_s: 2 })
  })
})
