// PocketFolio Worker (plan §4). Static assets (web/dist, SPA fallback) are served by the platform;
// only /api/* reaches this code (assets.run_worker_first in wrangler.jsonc).
import { Hono } from 'hono'
import { withEngine } from './lib/engine-client'

export { EngineBatch, EngineFast } from './engine'
export { EnginePool } from './engine-pool'

type EngineHealth = { ok: boolean; version: string; isin_db: string | null; busy: boolean }

const app = new Hono<{ Bindings: Env }>().basePath('/api')

// Deep health: Worker → EnginePool → EngineFast-<n> (fill-first, so normally -0) → engine GET /health.
app.get('/health', async (c) => {
  const result = await withEngine(c.env, { cls: 'fast', record: false }, async (engine) => {
    const res = await engine.fetch('http://engine/health')
    if (!res.ok) throw new EngineUnavailable(`engine /health ${res.status}`)
    return res.json<EngineHealth>()
  })
  if (!result.ok) {
    c.header('Retry-After', String(result.eta_s))
    return c.json({ ok: false, code: 'busy', eta_s: result.eta_s }, 503)
  }
  return c.json({
    ok: true,
    engine: { version: result.value.version, isin_db: result.value.isin_db, slot: result.slot },
  })
})

app.notFound((c) => c.json({ ok: false, code: 'not_found' }, 404))

// Privacy (§0.1): log the error class only, never messages that could carry request data.
app.onError((err, c) => {
  console.error('api_error', err.name)
  if (err instanceof EngineUnavailable || err.name === 'EngineStartError') {
    return c.json({ ok: false, code: 'engine_unavailable' }, 502)
  }
  return c.json({ ok: false, code: 'internal' }, 500)
})

class EngineUnavailable extends Error {
  override name = 'EngineUnavailable'
}

export default {
  fetch: app.fetch,

  // Cron jobs arrive in M8 (tmp-sweep), M9 (nav-*), M10 (prebuild), M11 (stocks), M14 (cleanup).
  async scheduled(controller) {
    console.log('cron_unhandled', controller.cron)
  },

  // Queue consumers arrive in M5 (email), M8 (parse), M9 (market), M10 (rebuild). Nothing produces messages yet;
  // retrying keeps any stray message until its consumer exists (then the DLQ after max_retries).
  async queue(batch) {
    console.log('queue_unhandled', batch.queue, batch.messages.length)
    batch.retryAll({ delaySeconds: 60 })
  },
} satisfies ExportedHandler<Env>
