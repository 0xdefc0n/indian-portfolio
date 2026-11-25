// Session middleware (plan §7.1). With the cookie cache warm this makes no D1 query: the user, the session and its
// householdId all come from the signed session_data cookie. When the cache is stale Better Auth reads D1 once and
// re-issues the cookie, so its Set-Cookie headers are passed on to the response.
import { createMiddleware } from 'hono/factory'
import { createAuth } from '../auth'
import type { AppBindings } from '../types'

export const requireSession = (opts: { fresh?: boolean } = {}) =>
  createMiddleware<AppBindings>(async (c, next) => {
    const { headers, response } = await createAuth(c.env).api.getSession({
      headers: c.req.raw.headers,
      query: opts.fresh ? { disableCookieCache: true } : undefined, // sensitive routes always check D1
      returnHeaders: true,
    })
    const householdId = (response?.session as { householdId?: string | null } | undefined)?.householdId
    if (!response || !householdId) {
      for (const v of headers.getSetCookie()) c.header('Set-Cookie', v, { append: true })
      return c.json({ ok: false, code: 'unauthorized' }, 401)
    }
    c.set('user', response.user)
    c.set('householdId', householdId)
    c.set('sessionId', response.session.id)
    await next()
    for (const v of headers.getSetCookie()) c.res.headers.append('Set-Cookie', v)
  })
