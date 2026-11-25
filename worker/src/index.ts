// PocketFolio Worker (plan §4). Static assets (web/dist, SPA fallback) are served by the platform;
// only /api/* reaches this code (assets.run_worker_first in wrangler.jsonc).
import { Hono } from 'hono'
import { handleEmailBatch, type EmailJob } from './lib/email'
import { withEngine } from './lib/engine-client'
import { ApiError } from './lib/errors'
import { requireSession } from './middleware/session'
import { authRoutes } from './routes/auth'
import { memberRoutes } from './routes/members'
import type { AppBindings, AppEnv } from './types'

export { EngineBatch, EngineFast } from './engine'
export { EnginePool } from './engine-pool'

type EngineHealth = { ok: boolean; version: string; isin_db: string | null; busy: boolean }

const app = new Hono<AppBindings>().basePath('/api')

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

// ─── Public ──────────────────────────────────────────────────────────────────────────────────────────────────────
app.route('/', authRoutes)

const KFINTECH_FORM_URL = 'https://mfs.kfintech.com/investor/General/ConsolidatedAccountStatement'
app.get('/config', (c) =>
  c.json({
    features: { cdsl_fetch: false, kfintech_auto: false, stocks: true }, // D8, D9: "Coming soon"
    kfintech_form_url: KFINTECH_FORM_URL,
    turnstile_site_key: c.env.TURNSTILE_SITE_KEY,
  }),
)

// ─── Signed in ───────────────────────────────────────────────────────────────────────────────────────────────────
// Every route below takes `signedIn` (per route, so unknown paths stay JSON 404s). Routes read c.var.user and
// c.var.householdId and never take a household from the client (§9.1).
const signedIn = requireSession()

app.get('/me', signedIn, async (c) => {
  const user = c.var.user
  const household = await c.env.DB.prepare('SELECT id, created_at FROM household WHERE id = ?1')
    .bind(c.var.householdId)
    .first<{ id: string; created_at: number }>()
  return c.json({
    user: { name: user.name, email: user.email, image: user.image ?? null },
    household,
    consent_ok: true, // the consent screen and gating arrive in M14
  })
})

app.route('/', memberRoutes)

// Until the first build (M10) a household's snapshot row has no blob, so the portfolio is empty. M10 replaces this.
app.get('/portfolio', signedIn, (c) =>
  c.json({ members: [], holdings: [], activity: [], sips: [], benchmark: null, stocks: EMPTY_STOCKS, stale: false, building: false }),
)
const EMPTY_STOCKS = {
  enabled: false, funds: {}, stocks: {}, month: null, oldest_month: null, unmatched: [], no_stocks: [], look_through: {},
  pending: 0, refreshing: false,
}

app.notFound((c) => c.json({ ok: false, code: 'not_found' }, 404))

// Privacy (§0.1): log the error class only, never messages that could carry request data.
app.onError((err, c) => {
  if (err instanceof ApiError) return c.json({ ok: false, code: err.code, ...err.extra }, err.status)
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

  // Queue names carry an environment suffix (pf-email-staging). Consumers for parse (M8), market (M9) and rebuild
  // (M10) arrive later; until then retrying keeps a stray message until its consumer exists (then the DLQ).
  async queue(batch, env) {
    if (batch.queue.startsWith('pf-email')) return handleEmailBatch(batch as MessageBatch<EmailJob>, env)
    console.log('queue_unhandled', batch.queue, batch.messages.length)
    batch.retryAll({ delaySeconds: 60 })
  },
} satisfies ExportedHandler<AppEnv>
