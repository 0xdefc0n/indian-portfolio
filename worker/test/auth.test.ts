// Sign-in (plan §7.1, §16 "Auth" and "D1 budget"). Emails go to the test sink through the real pf-email queue.
import { env } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { unwrapDek } from '../src/lib/crypto'
import { call, callWith, countingEnv, Jar, requestLoginEmail, signInWithCode, sinkAddress, sinkHeaders } from './helpers/auth'

const me = (jar: Jar) => call('/api/me', { jar })
const verifyLink = (token: string, jar: Jar) =>
  call(`/api/auth/magic-link/verify?token=${encodeURIComponent(token)}&callbackURL=%2F&errorCallbackURL=%2Flogin%3Ferror%3Dlink`, { jar })

afterEach(() => vi.restoreAllMocks())

describe('email sign-in', () => {
  it('a 6-digit code signs in, creates the household with a wrapped DEK and an empty snapshot', async () => {
    const email = sinkAddress()
    const jar = await signInWithCode(email)
    const res = await me(jar)
    expect(res.status).toBe(200)
    const body = await res.json<{ user: { email: string }; household: { id: string; created_at: number } }>()
    expect(body.user.email).toBe(email)
    const hh = await env.DB.prepare(
      'SELECT h.id, h.dek_wrapped, h.kek_version, s.status, s.blob_key FROM household h JOIN user u ON u.id = h.owner_user_id JOIN snapshot s ON s.household_id = h.id WHERE u.email = ?',
    ).bind(email).all<{ id: string; dek_wrapped: ArrayBuffer; kek_version: number; status: string; blob_key: string | null }>()
    expect(hh.results).toHaveLength(1)
    const row = hh.results[0]!
    expect(row.id).toBe(body.household.id)
    expect([row.status, row.blob_key, row.kek_version]).toEqual(['ready', null, 1])
    // The wrap opens for its own household only (AAD), so it can't be moved to another one.
    await expect(unwrapDek(env, row.id, new Uint8Array(row.dek_wrapped), 1)).resolves.toBeTruthy()
    await expect(unwrapDek(env, crypto.randomUUID(), new Uint8Array(row.dek_wrapped), 1)).rejects.toThrow(/./)
  })

  it('signing in again keeps the same household', async () => {
    const email = sinkAddress()
    const a = await (await me(await signInWithCode(email))).json<{ household: { id: string } }>()
    const b = await (await me(await signInWithCode(email))).json<{ household: { id: string } }>()
    expect(b.household.id).toBe(a.household.id)
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM household h JOIN user u ON u.id = h.owner_user_id WHERE u.email = ?').bind(email).first<{ n: number }>()
    expect(n!.n).toBe(1)
  })

  it('one email holds both the link and the code; the link opens the SPA with the token in the fragment', async () => {
    const mail = await requestLoginEmail(sinkAddress())
    expect(mail.otp).toMatch(/^\d{6}$/)
    expect(mail.link).toMatch(/^http:\/\/localhost:8787\/login\/verify#token=/)
    expect(mail.subject).not.toContain(mail.otp)
  })

  it('the magic link works once', async () => {
    const mail = await requestLoginEmail(sinkAddress())
    const jar = new Jar()
    const first = await verifyLink(mail.token, jar)
    expect(first.status).toBe(302)
    expect((await me(jar)).status).toBe(200)

    const again = new Jar()
    const second = await verifyLink(mail.token, again)
    expect(second.headers.get('location')).toMatch(/^http:\/\/localhost:8787\/login\?error=/)
    expect((await me(again)).status).toBe(401)
  })

  it('an expired magic link and an expired code do not sign in', async () => {
    const email = sinkAddress()
    const mail = await requestLoginEmail(email)
    await env.DB.prepare('UPDATE verification SET expiresAt = ?').bind(new Date(Date.now() - 1000).toISOString()).run()
    const jar = new Jar()
    expect((await verifyLink(mail.token, jar)).headers.get('location')).toMatch(/^http:\/\/localhost:8787\/login\?error=/)
    expect((await call('/api/auth/sign-in/email-otp', { body: { email, otp: mail.otp }, jar })).status).toBe(400)
    expect((await me(jar)).status).toBe(401)
  })

  it('a code allows 3 tries, then the right code no longer works', async () => {
    const email = sinkAddress()
    const mail = await requestLoginEmail(email)
    const wrong = mail.otp === '000000' ? '111111' : '000000'
    for (let i = 0; i < 3; i++) expect((await call('/api/auth/sign-in/email-otp', { body: { email, otp: wrong } })).status).not.toBe(200)
    expect((await call('/api/auth/sign-in/email-otp', { body: { email, otp: mail.otp } })).status).not.toBe(200)
  })

  it('tokens and codes are stored hashed', async () => {
    const mail = await requestLoginEmail(sinkAddress())
    const rows = await env.DB.prepare('SELECT identifier, value FROM verification').all<{ identifier: string; value: string }>()
    const text = JSON.stringify(rows.results)
    expect(text).not.toContain(mail.token)
    expect(text).not.toMatch(new RegExp(`"${mail.otp}"|:${mail.otp}"`))
  })
})

describe('/api/login/email guards', () => {
  it('needs a Turnstile token for real addresses, and checks it with siteverify', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    spy.mockImplementationOnce(async () => Response.json({ success: false })) // created inside the Worker's request
    const bad = await call('/api/login/email', { body: { email: 'someone@example.com', turnstile_token: 'x' } })
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({ ok: false, code: 'turnstile_failed' })
    expect(String(spy.mock.calls[0]![0])).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')

    const none = await call('/api/login/email', { body: { email: 'someone@example.com' } })
    expect(none.status).toBe(400)

    spy.mockImplementationOnce(async () => Response.json({ success: true }))
    const ok = await call('/api/login/email', { body: { email: `ok-${crypto.randomUUID().slice(0, 6)}@example.com`, turnstile_token: 'good' } })
    expect(await ok.json()).toEqual({ ok: true })
  })

  it('a sink address with a wrong sink key still needs Turnstile', async () => {
    const res = await call('/api/login/email', { body: { email: sinkAddress() }, headers: { 'x-email-sink-key': 'wrong' } })
    expect(res.status).toBe(400)
  })

  it('rejects malformed addresses', async () => {
    const res = await call('/api/login/email', { body: { email: 'not-an-email' }, headers: sinkHeaders() })
    expect(res.status).toBe(400)
  })

  it('limits sign-in emails per address (5 an hour) with 429 and Retry-After', async () => {
    const email = sinkAddress()
    for (let i = 0; i < 5; i++) expect((await call('/api/login/email', { body: { email }, headers: sinkHeaders() })).status).toBe(200)
    const res = await call('/api/login/email', { body: { email }, headers: sinkHeaders() })
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(3000)
  })

  it("the plugins' own email endpoints and unused Better Auth routes are not reachable", async () => {
    const email = sinkAddress()
    expect((await call('/api/auth/sign-in/magic-link', { body: { email } })).status).toBe(404)
    expect((await call('/api/auth/email-otp/send-verification-otp', { body: { email, type: 'sign-in' } })).status).toBe(404)
    expect((await call('/api/auth/sign-up/email', { body: { email, password: 'x'.repeat(12), name: 'x' } })).status).toBe(404)
    expect((await call('/api/auth/delete-user', { body: {} })).status).toBe(404)
  })

  it('the test sink answers 404 without the right key', async () => {
    const res = await call(`/api/test/email-sink?to=${encodeURIComponent(sinkAddress())}`, { headers: { 'x-email-sink-key': 'nope' } })
    expect(res.status).toBe(404)
  })
})

describe('sessions', () => {
  it('signed-in routes answer 401 without a session', async () => {
    for (const path of ['/api/me', '/api/portfolio']) {
      const res = await call(path)
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ ok: false, code: 'unauthorized' })
    }
  })

  it('a warm cookie cache makes 0 D1 session queries (§16 D1 budget)', async () => {
    const jar = await signInWithCode(sinkAddress())
    expect([...jar.cookies.keys()].some((k) => k.endsWith('session_data'))).toBe(true)
    const { env: counted, sql } = countingEnv()
    const res = await callWith(counted, '/api/me', { jar })
    expect(res.status).toBe(200)
    expect(sql.filter((q) => /\b(session|user|account|verification)\b/i.test(q))).toEqual([])
    expect(sql).toHaveLength(1) // /api/me's own household read
    const empty = await callWith(counted, '/api/portfolio', { jar })
    expect(empty.status).toBe(200)
    expect(sql).toHaveLength(2) // the portfolio: one snapshot read (snapshot + household key + statement count)
  })

  it('without the cache cookie, the session is read from D1 and the cache cookie is re-issued', async () => {
    const jar = (await signInWithCode(sinkAddress())).without('session_data')
    const { env: counted, sql } = countingEnv()
    const res = await callWith(counted, '/api/me', { jar })
    expect(res.status).toBe(200)
    expect(sql.some((q) => /\bsession\b/i.test(q))).toBe(true)
    expect([...jar.cookies.keys()].some((k) => k.endsWith('session_data'))).toBe(true)
  })

  it('sign-out ends the session', async () => {
    const jar = await signInWithCode(sinkAddress())
    expect((await call('/api/auth/sign-out', { body: {}, jar })).status).toBe(200)
    expect((await me(jar)).status).toBe(401)
  })

  it('a revoked session stops working once the 5-minute cookie cache is gone', async () => {
    const email = sinkAddress()
    const a = await signInWithCode(email)
    const b = await signInWithCode(email)
    const sessions = await (await call('/api/auth/list-sessions', { jar: a })).json<{ token: string }[]>()
    expect(sessions).toHaveLength(2)
    expect((await call('/api/auth/revoke-other-sessions', { body: {}, jar: a })).status).toBe(200)
    expect((await me(a)).status).toBe(200)
    expect((await me(b.without('session_data'))).status).toBe(401)
  })
})

describe('Google', () => {
  const idToken = (claims: Record<string, unknown>) => {
    const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
    return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: 'https://accounts.google.com', aud: 'test-google-client-id', exp: Math.floor(Date.now() / 1000) + 600, iat: Math.floor(Date.now() / 1000), ...claims })}.sig`
  }

  async function googleSignIn(email: string, jar = new Jar()) {
    const start = await call('/api/auth/sign-in/social', { body: { provider: 'google', callbackURL: '/' }, jar })
    expect(start.status).toBe(200)
    const { url } = await start.json<{ url: string }>()
    const consent = new URL(url)
    expect(consent.origin).toBe('https://accounts.google.com')
    expect(consent.searchParams.get('redirect_uri')).toBe('http://localhost:8787/api/auth/callback/google')
    expect(consent.searchParams.get('prompt')).toBe('select_account')
    const state = consent.searchParams.get('state')!

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const u = String(input instanceof Request ? input.url : input)
      if (u.startsWith('https://oauth2.googleapis.com/token')) {
        return Response.json({
          access_token: 'ya29.test-access', refresh_token: 'test-refresh', expires_in: 3600, token_type: 'Bearer', scope: 'openid email profile',
          id_token: idToken({ sub: `g-${email}`, email, email_verified: true, name: 'Test Person', picture: null }),
        })
      }
      throw new Error('unexpected fetch in test')
    })
    const cb = await call(`/api/auth/callback/google?code=test-code&state=${encodeURIComponent(state)}`, { jar })
    vi.restoreAllMocks()
    expect(cb.status).toBe(302)
    return jar
  }

  it('signs in, and links to an existing email user instead of creating a second one', async () => {
    const email = sinkAddress('g')
    const viaEmail = await (await me(await signInWithCode(email))).json<{ household: { id: string } }>()
    const jar = await googleSignIn(email)
    const viaGoogle = await (await me(jar)).json<{ household: { id: string } }>()
    expect(viaGoogle.household.id).toBe(viaEmail.household.id)
    const users = await env.DB.prepare('SELECT COUNT(*) AS n FROM user WHERE email = ?').bind(email).first<{ n: number }>()
    expect(users!.n).toBe(1)
  })

  it("keeps none of Google's OAuth tokens", async () => {
    const email = sinkAddress('g')
    await googleSignIn(email)
    const acc = await env.DB.prepare(
      "SELECT accessToken, refreshToken, idToken FROM account a JOIN user u ON u.id = a.userId WHERE u.email = ? AND a.providerId = 'google'",
    ).bind(email).first()
    expect(acc).toEqual({ accessToken: null, refreshToken: null, idToken: null })
  })
})

describe('/api/config', () => {
  it('is public and carries the Turnstile site key and "coming soon" flags', async () => {
    const res = await call('/api/config')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      features: { cdsl_fetch: false, kfintech_auto: false, stocks: true },
      turnstile_site_key: env.TURNSTILE_SITE_KEY,
    })
  })
})
