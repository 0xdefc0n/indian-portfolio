// PocketFolio Worker (plan §4). Static assets (web/dist, SPA fallback) are served by the platform;
// only /api/* reaches this code (assets.run_worker_first in wrangler.jsonc).
import { Hono } from 'hono'
import { handleEmailBatch, type EmailJob } from './lib/email'
import { withEngine } from './lib/engine-client'
import { ApiError } from './lib/errors'
import { handleParseBatch, type ParseMessage, TMP_SWEEP_CRON, tmpSweep } from './lib/jobs'
import { handleRebuildBatch, PREBUILD_CRON, prebuild, type RebuildMessage } from './lib/snapshot'
import { handleMarketBatch, type MarketMessage, NAV_INGEST_CRONS, NAV_REPAIR_CRON, navIngest, navRepair } from './market/jobs'
import { requireSession } from './middleware/session'
import { authRoutes } from './routes/auth'
import { jobRoutes } from './routes/jobs'
import { marketRoutes } from './routes/market'
import { memberRoutes } from './routes/members'
import { portfolioRoutes } from './routes/portfolio'
import { statementRoutes } from './routes/statements'
import type { AppBindings, AppEnv } from './types'

export { EngineBatch, EngineFast } from './engine'
export { EnginePool } from './engine-pool'
export { MarketGateway } from './market-gateway'

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
app.route('/', marketRoutes)

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
app.route('/', statementRoutes)
app.route('/', jobRoutes)
app.route('/', portfolioRoutes)

app.notFound((c) => c.json({ ok: false, code: 'not_found' }, 404))

// Privacy (§0.1): log the error class only, never messages that could carry request data.
app.onError((err, c) => {
  if (err instanceof ApiError) {
    if (typeof err.extra.retry_after === 'number') c.header('Retry-After', String(err.extra.retry_after))
    return c.json({ ok: false, code: err.code, ...err.extra }, err.status)
  }
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

  // Dispatch on event.cron (wrangler.jsonc triggers). Still to come: M11 (stocks), M14 (cleanup).
  async scheduled(controller, env, ctx) {
    const cron = controller.cron
    if (cron === TMP_SWEEP_CRON) {
      ctx.waitUntil(tmpSweep(env).then(() => undefined))
      return
    }
    if (NAV_INGEST_CRONS.includes(cron)) {
      ctx.waitUntil(navIngest(env, { cron, now: controller.scheduledTime }).then(() => undefined))
      return
    }
    if (cron === PREBUILD_CRON) {
      // The fallback: the 10:00 IST nav-ingest run normally made the day final and prebuilt already (once per date).
      ctx.waitUntil(prebuild(env, { now: controller.scheduledTime }).then(() => undefined))
      return
    }
    if (cron === NAV_REPAIR_CRON) {
      ctx.waitUntil(navRepair(env, { now: controller.scheduledTime }).then(() => undefined))
      return
    }
    console.log('cron_unhandled', controller.cron)
  },

  // Queue names carry an environment suffix (pf-email-staging). A queue with no consumer here retries (then the DLQ).
  async queue(batch, env) {
    if (batch.queue.startsWith('pf-email')) return handleEmailBatch(batch as MessageBatch<EmailJob>, env)
    if (batch.queue.startsWith('pf-parse')) return handleParseBatch(batch as MessageBatch<ParseMessage>, env)
    if (batch.queue.startsWith('pf-market')) return handleMarketBatch(batch as MessageBatch<MarketMessage>, env)
    if (batch.queue.startsWith('pf-rebuild')) return handleRebuildBatch(batch as MessageBatch<RebuildMessage>, env)
    console.log('queue_unhandled', batch.queue, batch.messages.length)
    batch.retryAll({ delaySeconds: 60 })
  },
} satisfies ExportedHandler<AppEnv>
