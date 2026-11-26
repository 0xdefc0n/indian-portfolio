// /api/sips (M12, owner request 2026-11-26): the user tells PocketFolio they skipped the next SIP instalment, or
// cancelled a SIP, with their broker or fund house. Only the estimates change (lib/sip-overrides.ts); every change
// asks for a debounced rebuild, so the dashboard follows within seconds.
import { type Context, Hono } from 'hono'
import { auditStatement } from '../lib/audit'
import { ApiError } from '../lib/errors'
import { cancelSip, parseSipRef, skipNext, undoSkip } from '../lib/sip-overrides'
import { requestRebuild } from '../lib/snapshot'
import { tenant } from '../lib/tenant'
import { requireSession } from '../middleware/session'
import type { AppBindings } from '../types'

export const sipRoutes = new Hono<AppBindings>()
const signedIn = requireSession()

async function sipFrom(c: Context<AppBindings>) {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null)
  if (!body) throw new ApiError(400, 'bad_request')
  const ref = parseSipRef(body)
  await tenant(c).assertMember(ref.member_id)
  return { body, ref }
}

sipRoutes.post('/sips/skip', signedIn, async (c) => {
  const { body, ref } = await sipFrom(c)
  const out = await skipNext(tenant(c), ref, body.due)
  await (await auditStatement(c, 'sip_skipped')).run()
  await requestRebuild(c.env, c.var.householdId)
  return c.json({ ok: true, skipped: out.due })
})

sipRoutes.delete('/sips/skip', signedIn, async (c) => {
  const { ref } = await sipFrom(c)
  const removed = await undoSkip(tenant(c), ref)
  if (removed) {
    await (await auditStatement(c, 'sip_skip_undone')).run()
    await requestRebuild(c.env, c.var.householdId)
  }
  return c.json({ ok: true, removed })
})

sipRoutes.post('/sips/cancel', signedIn, async (c) => {
  const { body, ref } = await sipFrom(c)
  if (body.confirm !== true) throw new ApiError(400, 'confirm_required') // the UI asks first: there's no undo
  const out = await cancelSip(tenant(c), ref)
  if (out.changed) {
    await (await auditStatement(c, 'sip_cancelled')).run()
    await requestRebuild(c.env, c.var.householdId)
  }
  return c.json({ ok: true, cancelled_on: out.cancelled_on })
})
