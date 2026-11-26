// Sign-in routes (plan §7.1, §7.3, §13A.5).
import { Hono } from 'hono'
import { createAuth, type LoginCapture } from '../auth'
import { allowedForLogin } from '../lib/disposable'
import { isSinkAddress, sinkEnabled, sinkKeyValid, takeSink, type EmailJob } from '../lib/email'
import { consume } from '../lib/rate-limit'
import { verifyTurnstile } from '../lib/turnstile'
import type { AppBindings } from '../types'

export const authRoutes = new Hono<AppBindings>()

// Better Auth endpoints the app uses. Everything else under /api/auth is a 404. In particular, the plugins' own email
// endpoints (/sign-in/magic-link, /email-otp/send-verification-otp) aren't routed: every sign-in email goes through
// /api/login/email below (Turnstile, per-address limit, one email holding both the link and the code).
const ALLOWED = new Set([
  'GET /get-session',
  'POST /sign-out',
  'POST /sign-in/social', // Google: returns the consent-screen URL
  'GET /callback/google',
  'GET /magic-link/verify',
  'POST /sign-in/email-otp',
  'GET /list-sessions',
  'POST /revoke-session',
  'POST /revoke-other-sessions',
  'GET /error', // where Better Auth sends OAuth failures without an errorCallbackURL
])

authRoutes.all('/auth/*', async (c) => {
  const path = new URL(c.req.url).pathname.replace(/^\/api\/auth/, '').replace(/\/+$/, '')
  if (!ALLOWED.has(`${c.req.method} ${path}`)) return c.json({ ok: false, code: 'not_found' }, 404)
  return createAuth(c.env).handler(c.req.raw)
})

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/
// Per address: enough for "resend" a few times, not enough to flood an inbox. Per IP is generous because Indian
// mobile carriers put many users behind one address (CGNAT); Turnstile is the bot defence.
const PER_EMAIL = { window: 3600, max: 5 }
const PER_IP = { window: 3600, max: 60 }

// One sign-in email holding both a magic link and a 6-digit code. Always the same answer whether or not the
// account exists (signup and sign-in are the same flow), so it reveals nothing about who has an account.
authRoutes.post('/login/email', async (c) => {
  const body = await c.req.json<{ email?: unknown; turnstile_token?: unknown }>().catch(() => ({}) as Record<string, unknown>)
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!EMAIL_RE.test(email) || email.length > 254) return c.json({ ok: false, code: 'invalid_email' }, 400)

  // Before Turnstile, so the user's token isn't spent and they can retry with another address at once (§21.7).
  // Existing users on a listed domain still sign in. The log carries the outcome code only: no address, no domain.
  if (!(await allowedForLogin(c.env.DB, email))) {
    console.log('login_email_refused', 'disposable_email')
    return c.json({ ok: false, code: 'disposable_email' }, 400)
  }

  const ip = c.req.header('cf-connecting-ip') ?? null
  // Automated staging tests: a sink address with the sink key skips Turnstile. Production has no sink key.
  const testBypass = isSinkAddress(email) && sinkKeyValid(c.env, c.req.header('x-email-sink-key'))
  if (!testBypass && !(await verifyTurnstile(c.env.TURNSTILE_SECRET, String(body.turnstile_token ?? ''), ip))) {
    return c.json({ ok: false, code: 'turnstile_failed' }, 400)
  }

  for (const [key, rule] of [[`login-email:addr:${email}`, PER_EMAIL], [`login-email:ip:${ip ?? 'none'}`, PER_IP]] as const) {
    const r = await consume(c.env.DB, c.env.BETTER_AUTH_SECRET, key, rule)
    if (!r.allowed) {
      c.header('Retry-After', String(r.retryAfter))
      return c.json({ ok: false, code: 'rate_limited', retry_after_s: r.retryAfter }, 429)
    }
  }

  const capture: LoginCapture = {}
  const auth = createAuth(c.env, capture)
  const headers = c.req.raw.headers
  await auth.api.signInMagicLink({ body: { email, callbackURL: '/' }, headers })
  await auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' }, headers })
  if (!capture.token || !capture.otp) throw new Error('login capture incomplete')

  // The link opens the SPA, which reads the token from the fragment and calls /api/auth/magic-link/verify. Link
  // scanners that prefetch URLs (Outlook Safe Links and the like) can't burn the single-use token, and the fragment
  // never reaches a server log.
  const link = `${c.env.APP_URL}/login/verify#token=${encodeURIComponent(capture.token)}`
  const job: EmailJob = { kind: 'login', to: email, link, otp: capture.otp, created_at: Date.now() }
  await c.env.Q_EMAIL.send(job)
  return c.json({ ok: true })
})

// Staging/local only: an automated test reads the email "sent" to a sink address. 404 unless the sink key matches.
authRoutes.get('/test/email-sink', async (c) => {
  const to = c.req.query('to') ?? ''
  if (!sinkEnabled(c.env) || !isSinkAddress(to) || !sinkKeyValid(c.env, c.req.header('x-email-sink-key'))) {
    return c.json({ ok: false, code: 'not_found' }, 404)
  }
  const mail = await takeSink(c.env, to)
  return mail ? c.json({ ok: true, ...mail }) : c.json({ ok: false, code: 'empty' }, 404)
})
