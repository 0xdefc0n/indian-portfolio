// Session middleware (plan §7.1). With the cookie cache warm this makes no D1 query: the user, the session, its
// householdId and its consentVersion all come from the signed session_data cookie. When the cache is stale Better
// Auth reads D1 once and re-issues the cookie, so its Set-Cookie headers are passed on to the response.
//
// Consent gating (plan §12, M14): every signed-in route needs the current notice accepted (403 consent_required)
// unless it passes `consent: false`: /me, /consent, and the two rights that need no consent (export, delete account).
import { createMiddleware } from 'hono/factory'
import { createAuth } from '../auth'
import { consentFromDb, NOTICE_VERSION } from '../lib/consent'
import type { AppBindings } from '../types'

export const requireSession = (opts: { fresh?: boolean; consent?: boolean } = {}) =>
  createMiddleware<AppBindings>(async (c, next) => {
    const { headers, response } = await createAuth(c.env).api.getSession({
      headers: c.req.raw.headers,
      query: opts.fresh ? { disableCookieCache: true } : undefined, // sensitive routes always check D1
      returnHeaders: true,
    })
    const session = response?.session as { householdId?: string | null; consentVersion?: string | null; createdAt?: Date | string } | undefined
    const householdId = session?.householdId
    const passCookies = () => {
      for (const v of headers.getSetCookie()) c.header('Set-Cookie', v, { append: true })
    }
    if (!response || !householdId) {
      passCookies()
      return c.json({ ok: false, code: 'unauthorized' }, 401)
    }
    c.set('user', response.user)
    c.set('householdId', householdId)
    c.set('sessionId', response.session.id)
    c.set('sessionCreatedAt', new Date(session?.createdAt ?? 0).getTime())
    const consented = session?.consentVersion === NOTICE_VERSION || (opts.consent !== false && (await consentFromDb(c.env.DB, response.user.id, response.session.id)))
    c.set('consentOk', consented)
    if (opts.consent !== false && !consented) {
      passCookies()
      return c.json({ ok: false, code: 'consent_required' }, 403)
    }
    await next()
    // A route that ended the session (account deletion) has cleared the cookies itself; don't re-issue them.
    if (c.get('sessionEnded')) return
    for (const v of headers.getSetCookie()) c.res.headers.append('Set-Cookie', v)
  })
