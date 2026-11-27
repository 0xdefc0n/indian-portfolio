// /api/assets (plan §21.12, D28, M19): fixed deposits, PPF and EPF entered by hand. Inputs only: the SPA computes
// the values with the shared lib/manual-assets.ts. All behind the session and the tenant guard; another household's
// asset or member id is a 404.
import { type Context, Hono } from 'hono'
import { createAsset, deleteAsset, listAssets, updateAsset } from '../lib/assets'
import { auditStatement } from '../lib/audit'
import { ApiError, notFound } from '../lib/errors'
import { RATES } from '../lib/rates'
import { tenant } from '../lib/tenant'
import { requireSession } from '../middleware/session'
import type { AppBindings } from '../types'

export const assetRoutes = new Hono<AppBindings>()
const signedIn = requireSession() // per route, so unknown paths stay JSON 404s

async function bodyOf(c: Context<AppBindings>): Promise<Record<string, unknown>> {
  const body = await c.req.json<unknown>().catch(() => null)
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new ApiError(400, 'bad_request')
  return body as Record<string, unknown>
}

assetRoutes.get('/assets', signedIn, async (c) => {
  c.header('Cache-Control', 'no-store')
  return c.json({ assets: await listAssets(tenant(c)), rates: RATES })
})

assetRoutes.post('/assets', signedIn, async (c) => {
  const asset = await createAsset(tenant(c), await bodyOf(c), await auditStatement(c, 'asset_added', { onlyIfChanged: true }))
  return c.json({ asset }, 201)
})

assetRoutes.patch('/assets/:id', signedIn, async (c) => {
  const asset = await updateAsset(tenant(c), c.req.param('id'), await bodyOf(c), await auditStatement(c, 'asset_changed', { onlyIfChanged: true }))
  return c.json({ asset })
})

assetRoutes.delete('/assets/:id', signedIn, async (c) => {
  if (!(await deleteAsset(tenant(c), c.req.param('id'), await auditStatement(c, 'asset_deleted', { onlyIfChanged: true })))) throw notFound()
  return c.json({ ok: true })
})
