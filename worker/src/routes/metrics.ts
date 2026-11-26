// POST /api/metrics (plan §13A.6, M15): anonymous product counters for the installable app. The body names one
// metric from a fixed list; the Worker adds 1 to today's total. Nothing about the user is stored with it.
import { Hono } from 'hono'
import { ApiError } from '../lib/errors'
import { metricQuota } from '../lib/limits'
import { isQuotaRefusal, quotaStatement, quotaWindow } from '../lib/quota'
import { requireSession } from '../middleware/session'
import type { AppBindings } from '../types'

export const METRICS = [
  'install_prompt_shown',
  'install_accepted',
  'install_dismissed',
  'app_installed',
  'launch_standalone',
  'launch_shortcut',
] as const
export type Metric = (typeof METRICS)[number]

export const metricRoutes = new Hono<AppBindings>()

metricRoutes.post('/metrics', requireSession(), async (c) => {
  const body = await c.req.json<{ metric?: unknown }>().catch(() => null)
  const metric = body?.metric
  if (typeof metric !== 'string' || !(METRICS as readonly string[]).includes(metric)) throw new ApiError(400, 'unknown_metric')
  const now = Date.now()
  try {
    // One round trip. Past the account's daily cap the quota UPSERT aborts the batch, so the total isn't moved.
    await c.env.DB.batch([
      quotaStatement(c.env.DB, metricQuota(c.var.user.id), now),
      c.env.DB.prepare(
        `INSERT INTO metric_daily (metric, date, count) VALUES (?1, ?2, 1)
         ON CONFLICT (metric, date) DO UPDATE SET count = count + 1`,
      ).bind(metric, quotaWindow('day', now)),
    ])
  } catch (err) {
    if (!isQuotaRefusal(err)) throw err
  }
  return c.body(null, 204) // the same answer either way: a counter is never worth an error on screen
})
