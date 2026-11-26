// Consent and the user's data rights (plan §9.2, §12): POST /api/consent, GET /api/account/export,
// DELETE /api/account. None of them needs consent first: you can always take your data out or delete it.
import { Hono } from 'hono'
import { createAuth } from '../auth'
import { auditStatement, requestMeta } from '../lib/audit'
import { DELETE_CONFIRM, DELETE_REAUTH_MS, deleteAccount, exportAccount } from '../lib/account'
import { NOTICE_VERSION, recordConsentStatements } from '../lib/consent'
import { ApiError } from '../lib/errors'
import { exportQuota } from '../lib/limits'
import { takeQuota } from '../lib/quota'
import { requireSession } from '../middleware/session'
import type { AppBindings } from '../types'

export const accountRoutes = new Hono<AppBindings>()
const signedInNoConsent = requireSession({ consent: false })
// Sensitive: always read the session from D1, so a revoked or deleted session can't use a cached cookie (§7.1).
const freshNoConsent = requireSession({ fresh: true, consent: false })

accountRoutes.post('/consent', signedInNoConsent, async (c) => {
  const body = await c.req.json<{ notice_version?: unknown; adult?: unknown }>().catch(() => null)
  if (body?.notice_version !== NOTICE_VERSION) throw new ApiError(409, 'notice_changed', { notice_version: NOTICE_VERSION })
  if (body.adult !== true) throw new ApiError(400, 'adult_required')
  await c.env.DB.batch([...recordConsentStatements(c.env.DB, c.var.user.id), await auditStatement(c, 'consent_given')])
  // Re-issue the cookie cache from D1, so the next requests carry the consent without a lookup.
  const { headers } = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
    query: { disableCookieCache: true },
    returnHeaders: true,
  })
  for (const v of headers.getSetCookie()) c.header('Set-Cookie', v, { append: true })
  return c.json({ ok: true, notice_version: NOTICE_VERSION })
})

accountRoutes.get('/account/export', freshNoConsent, async (c) => {
  const quota = await takeQuota(c.env, [exportQuota(c.var.user.id)])
  if (!quota.ok) throw new ApiError(429, 'export_limit', { retry_after: quota.retryAfter })
  const stream = await exportAccount(c.env, { userId: c.var.user.id, householdId: c.var.householdId, sessionId: c.var.sessionId })
  await auditStatement(c, 'export').then((s) => s.run())
  const day = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10) // IST
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="pocketfolio-export-${day}.json"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
})

accountRoutes.delete('/account', freshNoConsent, async (c) => {
  const body = await c.req.json<{ confirm?: unknown }>().catch(() => null)
  if (body?.confirm !== DELETE_CONFIRM) throw new ApiError(400, 'confirm_required')
  if (Date.now() - c.var.sessionCreatedAt > DELETE_REAUTH_MS) throw new ApiError(403, 'reauth_required')
  const auth = createAuth(c.env)
  // Cookie names and attributes as Better Auth sets them (the __Secure- prefix on https), so the clear matches.
  const cookies = (await auth.$context).authCookies
  await deleteAccount(
    c.env,
    { userId: c.var.user.id, householdId: c.var.householdId, email: c.var.user.email },
    { event: 'account_deleted', meta: await requestMeta(c) },
  )
  c.set('sessionEnded', true)
  const res = c.json({ ok: true })
  for (const ck of [cookies.sessionToken, cookies.sessionData, cookies.dontRememberToken]) {
    const o = ck.attributes as { sameSite?: string; secure?: boolean }
    const attrs = [`${ck.name}=`, 'Path=/', 'Max-Age=0', 'HttpOnly', `SameSite=${o.sameSite ?? 'lax'}`]
    if (o.secure || ck.name.startsWith('__Secure-')) attrs.push('Secure')
    res.headers.append('Set-Cookie', attrs.join('; '))
  }
  return res
})
