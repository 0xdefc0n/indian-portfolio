// Sign-in smoke test against a running app (wrangler dev or staging), through the test email sink (src/lib/email.ts).
//   node scripts/auth-smoke.ts http://localhost:8787            # sink key: EMAIL_SINK_KEY from .dev.vars
//   node scripts/auth-smoke.ts https://staging.pocketfolio.in   # sink key: STAGING_EMAIL_SINK_KEY from .dev.vars
// Uses synthetic @sink.pocketfolio.test addresses only and prints ok/fail lines, never keys, links or codes.
import { devVar } from '../test/helpers/private-pdfs.ts'

const base = (process.argv[2] ?? 'http://localhost:8787').replace(/\/$/, '')
const sinkKey = base.includes('localhost') ? devVar('EMAIL_SINK_KEY') : devVar('STAGING_EMAIL_SINK_KEY')
if (!sinkKey) throw new Error('sink key missing from .dev.vars')

class Jar {
  c = new Map<string, string>()
  absorb(r: Response) {
    for (const line of r.headers.getSetCookie()) {
      const [pair] = line.split(';')
      const i = pair!.indexOf('=')
      const v = pair!.slice(i + 1)
      if (/max-age=0/i.test(line) || !v) this.c.delete(pair!.slice(0, i))
      else this.c.set(pair!.slice(0, i), v)
    }
  }
  get header() {
    return [...this.c].map(([k, v]) => `${k}=${v}`).join('; ')
  }
}

async function req(path: string, opts: { body?: unknown; jar?: Jar; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { origin: base, ...opts.headers }
  if (opts.jar?.c.size) headers.cookie = opts.jar.header
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  const r = await fetch(base + path, {
    method: opts.body !== undefined ? 'POST' : 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    redirect: 'manual',
  })
  opts.jar?.absorb(r)
  return r
}

let failed = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail && !ok ? ` (${detail})` : ''}`)
  if (!ok) failed++
}

async function loginEmail(email: string) {
  const r = await req('/api/login/email', { body: { email }, headers: { 'x-email-sink-key': sinkKey! } })
  check('POST /api/login/email', r.status === 200, String(r.status))
  for (let i = 0; i < 60; i++) {
    const s = await req(`/api/test/email-sink?to=${encodeURIComponent(email)}`, { headers: { 'x-email-sink-key': sinkKey! } })
    if (s.status === 200) {
      const m = (await s.json()) as { link: string; otp: string }
      check('email arrived (via pf-email queue)', true)
      return { otp: m.otp, token: decodeURIComponent(new URL(m.link).hash.replace(/^#token=/, '')), linkOk: m.link.startsWith(`${base}/login/verify#token=`) }
    }
    await new Promise((ok) => setTimeout(ok, 500))
  }
  check('email arrived (via pf-email queue)', false, 'timeout')
  throw new Error('stop')
}

const t0 = Date.now()
const cfg = await req('/api/config')
check('GET /api/config', cfg.status === 200)
check('GET /login serves the SPA', (await req('/login')).headers.get('content-type')?.includes('text/html') ?? false)
check('GET /api/me signed out → 401', (await req('/api/me')).status === 401)

const email = `smoke-${crypto.randomUUID().slice(0, 8)}@sink.pocketfolio.test`

// 1. Code
const codeMail = await loginEmail(email)
check('email link points at /login/verify#token=…', codeMail.linkOk)
const a = new Jar()
const code = await req('/api/auth/sign-in/email-otp', { body: { email, otp: codeMail.otp }, jar: a })
check('6-digit code signs in', code.status === 200, String(code.status))
const meA = await req('/api/me', { jar: a })
const bodyA = (await meA.json()) as { household?: { id?: string } }
check('GET /api/me → 200 with a household', meA.status === 200 && !!bodyA.household?.id, String(meA.status))

// 2. Magic link (same user → same household)
const linkMail = await loginEmail(email)
const b = new Jar()
const q = new URLSearchParams({ token: linkMail.token, callbackURL: '/', errorCallbackURL: '/login?error=link' })
const verify = await req(`/api/auth/magic-link/verify?${q}`, { jar: b })
check('magic link signs in (302 to /)', verify.status === 302 && new URL(verify.headers.get('location') ?? '', base).pathname === '/', String(verify.status))
const bodyB = (await (await req('/api/me', { jar: b })).json()) as { household?: { id?: string } }
check('same household for the same user', bodyB.household?.id === bodyA.household?.id)
const again = await req(`/api/auth/magic-link/verify?${q}`, { jar: new Jar() })
check('magic link is single use', (again.headers.get('location') ?? '').includes('/login?error='))

// 3. Sign out
check('sign out', (await req('/api/auth/sign-out', { body: {}, jar: a })).status === 200)
check('after sign out /api/me → 401', (await req('/api/me', { jar: a })).status === 401)

console.log(`${failed ? 'FAILED' : 'PASSED'}: ${failed} failed, ${((Date.now() - t0) / 1000).toFixed(1)} s`)
process.exit(failed ? 1 : 0)
