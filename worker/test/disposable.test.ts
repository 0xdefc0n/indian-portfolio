// Disposable email domains (plan §21.7, D20, M22). Synthetic addresses only.
import { env } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isDisposableEmail } from '../src/lib/disposable'
import { callWith, sinkHeaders } from './helpers/auth'

afterEach(() => vi.restoreAllMocks())

const tag = () => crypto.randomUUID().slice(0, 8)

/** env whose email queue records what would be sent, and a fetch spy that passes Turnstile. */
function spied() {
  const sent: unknown[] = []
  const queue = { send: async (m: unknown) => void sent.push(m), sendBatch: async () => {} } as unknown as Queue
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ success: true }))
  return { env: { ...env, Q_EMAIL: queue } as typeof env, sent, fetchSpy }
}

const loginEmail = (e: typeof env, email: string) =>
  callWith(e, '/api/login/email', { body: { email, turnstile_token: 'good' }, headers: { 'cf-connecting-ip': `198.51.100.${Math.floor(Math.random() * 250)}` } })

describe('the bundled list', () => {
  it('lists well-known throwaway domains, their subdomains and any case', () => {
    expect(isDisposableEmail('a@mailinator.com')).toBe(true)
    expect(isDisposableEmail('a@yopmail.com')).toBe(true)
    expect(isDisposableEmail('a@inbox.mailinator.com')).toBe(true)
    expect(isDisposableEmail('a@deep.sub.mailinator.com')).toBe(true)
    expect(isDisposableEmail('A@MailInator.COM')).toBe(true)
  })

  it('does not list ordinary providers, look-alikes, the test sink or bare TLDs', () => {
    for (const e of ['a@gmail.com', 'a@outlook.com', 'a@yahoo.co.in', 'a@rediffmail.com', 'a@example.com',
      'a@mailinator.com.example.org', 'a@pocketfolio-mailinator.example', 'a@sink.pocketfolio.test', 'a@com', 'no-at-sign']) {
      expect([e, isDisposableEmail(e)]).toEqual([e, false])
    }
  })
})

describe('POST /api/login/email and disposable domains', () => {
  for (const [label, email] of [
    ['a listed domain', () => `x-${tag()}@mailinator.com`],
    ['a listed subdomain', () => `x-${tag()}@inbox.mailinator.com`],
    ['mixed case', () => `  X-${tag()}@YopMail.Com `],
  ] as const) {
    it(`refuses ${label} for a new account: 400 disposable_email, before Turnstile, nothing queued`, async () => {
      const s = spied()
      const log = vi.spyOn(console, 'log')
      const res = await loginEmail(s.env, email())
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ ok: false, code: 'disposable_email' })
      expect(s.fetchSpy).not.toHaveBeenCalled() // Turnstile's token isn't spent
      expect(s.sent).toEqual([])
      // Only the outcome code is logged: never the address or the domain.
      const logged = JSON.stringify(log.mock.calls)
      expect(log.mock.calls).toEqual([['login_email_refused', 'disposable_email']])
      expect(logged).not.toMatch(/mailinator|yopmail|@/i)
    })
  }

  it('does not use up the per-address limit', async () => {
    const s = spied()
    const email = `x-${tag()}@mailinator.com`
    const count = async () => (await env.DB.prepare('SELECT count(*) AS n FROM rate_limit').first<{ n: number }>())!.n
    const before = await count()
    for (let i = 0; i < 7; i++) expect((await loginEmail(s.env, email)).status).toBe(400)
    expect(await count()).toBe(before)
  })

  it('an existing user on a listed domain still gets a sign-in email', async () => {
    const email = `old-${tag()}@mailinator.com`
    const now = new Date().toISOString()
    await env.DB.prepare('INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)')
      .bind(`u-${tag()}`, '', email, now, now).run()
    const s = spied()
    const res = await loginEmail(s.env, email.toUpperCase())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(s.fetchSpy).toHaveBeenCalledOnce() // Turnstile checked as usual
    expect(s.sent).toHaveLength(1)
    expect(s.sent[0]).toMatchObject({ kind: 'login', to: email })
  })

  it('an unlisted domain is sent as before', async () => {
    const s = spied()
    const email = `new-${tag()}@example.com`
    const res = await loginEmail(s.env, email)
    expect(res.status).toBe(200)
    expect(s.sent).toHaveLength(1)
    expect(s.sent[0]).toMatchObject({ kind: 'login', to: email })
  })

  it('the test sink is unaffected', async () => {
    const s = spied()
    s.fetchSpy.mockRestore()
    const res = await callWith(s.env, '/api/login/email', { body: { email: `s-${tag()}@sink.pocketfolio.test` }, headers: sinkHeaders() })
    expect(res.status).toBe(200)
    expect(s.sent).toHaveLength(1)
  })
})
