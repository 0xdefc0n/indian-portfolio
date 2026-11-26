// /api/members (plan §9.2). List, rename and delete. Members are created from statements (M7, D19), never here.
import { Hono } from 'hono'
import { auditStatement } from '../lib/audit'
import { ApiError, notFound } from '../lib/errors'
import { cleanName, deleteMember, listMembers, renameMember } from '../lib/members'
import { tenant } from '../lib/tenant'
import { isUuid } from '../lib/blob'
import { requireSession } from '../middleware/session'
import type { AppBindings } from '../types'

export const memberRoutes = new Hono<AppBindings>()
const signedIn = requireSession() // per route, so unknown paths stay JSON 404s

memberRoutes.get('/members', signedIn, async (c) => c.json({ members: await listMembers(tenant(c)) }))

memberRoutes.patch('/members/:id', signedIn, async (c) => {
  const id = c.req.param('id')
  if (!isUuid(id)) throw notFound()
  const body = await c.req.json<{ name?: unknown }>().catch(() => null)
  const name = cleanName(body?.name)
  if (!name) throw new ApiError(400, 'invalid_name')
  const ok = await renameMember(tenant(c), id, name, await auditStatement(c, 'member_renamed', { onlyIfChanged: true }))
  if (!ok) throw notFound()
  return c.json({ member: { id, name } })
})

memberRoutes.delete('/members/:id', signedIn, async (c) => {
  const id = c.req.param('id')
  if (!isUuid(id)) throw notFound()
  const ok = await deleteMember(tenant(c), id, await auditStatement(c, 'member_deleted', { onlyIfChanged: true }))
  if (!ok) throw notFound()
  return c.json({ ok: true })
})
