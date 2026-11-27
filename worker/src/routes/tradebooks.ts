// /api/tradebooks and /api/stocks/cost (plan §21.6, M21): broker tradebooks and manual average buy prices. All behind
// the session and the tenant guard; another household's tradebook or member id is a 404.
import { Hono } from 'hono'
import { auditStatement } from '../lib/audit'
import { ApiError, notFound } from '../lib/errors'
import { LIMITS } from '../lib/limits'
import { tenant } from '../lib/tenant'
import { deleteStockCost, deleteTradebook, listStockCosts, listTradebooks, parseStockCost, setStockCost, uploadTradebook } from '../lib/tradebooks'
import { requireSession } from '../middleware/session'
import type { AppBindings } from '../types'

export const tradebookRoutes = new Hono<AppBindings>()
const signedIn = requireSession()
const MULTIPART_SLACK = 64 * 1024

tradebookRoutes.get('/tradebooks', signedIn, async (c) => {
  c.header('Cache-Control', 'no-store')
  const t = tenant(c)
  const [tradebooks, costs] = await Promise.all([listTradebooks(t), listStockCosts(t)])
  return c.json({ tradebooks, costs })
})

tradebookRoutes.post('/tradebooks', signedIn, async (c) => {
  const declared = Number(c.req.header('content-length') ?? NaN)
  if (Number.isFinite(declared) && declared > LIMITS.tradebookBytes + MULTIPART_SLACK) throw new ApiError(413, 'file_too_large')
  if (!/^multipart\/form-data/i.test(c.req.header('content-type') ?? '')) throw new ApiError(400, 'bad_request')
  const form = await c.req.formData().catch(() => null)
  const file = form?.get('file')
  if (!form || !(file instanceof File)) throw new ApiError(400, 'bad_request')
  if (file.size > LIMITS.tradebookBytes) throw new ApiError(413, 'file_too_large')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const tradebook = await uploadTradebook(tenant(c), form.get('member_id'), bytes, await auditStatement(c, 'tradebook_added'))
  return c.json({ tradebook }, 201)
})

tradebookRoutes.delete('/tradebooks/:id', signedIn, async (c) => {
  const ok = await deleteTradebook(tenant(c), c.req.param('id'), await auditStatement(c, 'tradebook_deleted', { onlyIfChanged: true }))
  if (!ok) throw notFound()
  return c.json({ ok: true })
})

tradebookRoutes.put('/stocks/cost', signedIn, async (c) => {
  const cost = await setStockCost(tenant(c), parseStockCost(await c.req.json<unknown>().catch(() => null)), await auditStatement(c, 'stock_cost_set'))
  return c.json({ cost })
})

tradebookRoutes.delete('/stocks/cost', signedIn, async (c) => {
  const body = ((await c.req.json<unknown>().catch(() => null)) ?? {}) as Record<string, unknown>
  const ok = await deleteStockCost(tenant(c), body.member_id, body.isin, await auditStatement(c, 'stock_cost_deleted', { onlyIfChanged: true }))
  if (!ok) throw notFound()
  return c.json({ ok: true })
})
