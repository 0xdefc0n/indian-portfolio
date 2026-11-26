// Sign-in helpers for tests: a cookie jar, the sink-backed email flow, and a D1 wrapper that counts queries.
import { env } from 'cloudflare:test'
import { exports } from 'cloudflare:workers'
import worker from '../../src/index'
import { NOTICE_VERSION } from '../../src/lib/consent'
import { SINK_DOMAIN } from '../../src/lib/email'

export const ORIGIN = 'http://localhost:8787' // = APP_URL in vitest.config.ts

export class Jar {
  cookies = new Map<string, string>()
  absorb(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';')
      const i = pair!.indexOf('=')
      const name = pair!.slice(0, i).trim()
      const value = pair!.slice(i + 1).trim()
      const expired = /max-age=0/i.test(line) || value === ''
      if (expired) this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
    return res
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ')
  }
  without(fragment: string) {
    const j = new Jar()
    for (const [k, v] of this.cookies) if (!k.includes(fragment)) j.cookies.set(k, v)
    return j
  }
}

type Init = { method?: string; body?: unknown; headers?: Record<string, string>; jar?: Jar }

export function request(path: string, init: Init = {}) {
  const headers: Record<string, string> = { origin: ORIGIN, 'cf-connecting-ip': '203.0.113.7', ...init.headers }
  if (init.jar?.cookies.size) headers.cookie = init.jar.header()
  if (init.body !== undefined) headers['content-type'] = 'application/json'
  return new Request(`${ORIGIN}${path}`, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    redirect: 'manual',
  })
}

export async function call(path: string, init: Init = {}) {
  const res = await exports.default.fetch(request(path, init))
  init.jar?.absorb(res)
  return res
}

export const sinkAddress = (tag = 'u') => `${tag}-${crypto.randomUUID().slice(0, 8)}@${SINK_DOMAIN}`
export const sinkHeaders = () => ({ 'x-email-sink-key': env.EMAIL_SINK_KEY! })

/** Ask for a sign-in email and wait for it in the sink (it goes through the real pf-email queue). */
export async function requestLoginEmail(email: string) {
  const res = await call('/api/login/email', { body: { email }, headers: sinkHeaders() })
  if (res.status !== 200) throw new Error(`login/email ${res.status}`)
  for (let i = 0; i < 100; i++) {
    const r = await call(`/api/test/email-sink?to=${encodeURIComponent(email)}`, { headers: sinkHeaders() })
    if (r.status === 200) {
      const mail = await r.json<{ link: string; otp: string; subject: string }>()
      const token = decodeURIComponent(new URL(mail.link).hash.replace(/^#token=/, ''))
      return { ...mail, token }
    }
    await new Promise((ok) => setTimeout(ok, 50))
  }
  throw new Error('no email in the sink')
}

/**
 * `ip` gives the sign-in its own client address, so files that create many households stay under the per-IP limit.
 * The user also accepts the consent notice (M14), as every real user must before using the app, unless
 * `consent: false`.
 */
export async function signInWithCode(email: string, jar = new Jar(), ip?: string, opts: { consent?: boolean } = {}) {
  const mail = await requestLoginEmail(email)
  const headers = ip ? { 'cf-connecting-ip': ip } : undefined
  const res = await call('/api/auth/sign-in/email-otp', { body: { email, otp: mail.otp }, jar, headers })
  if (res.status !== 200) throw new Error(`sign-in/email-otp ${res.status}`)
  if (opts.consent !== false) await acceptConsent(jar)
  return jar
}

export async function acceptConsent(jar: Jar) {
  const res = await call('/api/consent', { body: { notice_version: NOTICE_VERSION, adult: true }, jar })
  if (res.status !== 200) throw new Error(`consent ${res.status}`)
}

/** env with DB wrapped so every prepared statement's SQL is recorded (for the D1-budget tests, plan §16). */
export function countingEnv() {
  const sql: string[] = []
  const wrapStmt = (stmt: D1PreparedStatement, q: string): D1PreparedStatement =>
    new Proxy(stmt, {
      get(target, prop, receiver) {
        if (prop === 'bind') return (...args: unknown[]) => wrapStmt(target.bind(...args), q)
        if (prop === 'first' || prop === 'all' || prop === 'run' || prop === 'raw') {
          return (...args: unknown[]) => {
            sql.push(q)
            return (target[prop] as (...a: unknown[]) => unknown).apply(target, args)
          }
        }
        return Reflect.get(target, prop, receiver)
      },
    })
  const db = new Proxy(env.DB, {
    get(target, prop, receiver) {
      if (prop === 'prepare') return (q: string) => wrapStmt(target.prepare(q), q)
      if (prop === 'batch') {
        return (stmts: D1PreparedStatement[]) => {
          sql.push('BATCH')
          return target.batch(stmts)
        }
      }
      if (prop === 'exec') return (q: string) => (sql.push(q), target.exec(q))
      const v = Reflect.get(target, prop, receiver)
      return typeof v === 'function' ? v.bind(target) : v
    },
  })
  return { env: { ...env, DB: db } as typeof env, sql }
}

/** Call the Worker's fetch handler directly with a custom env (e.g. the counting one). */
export async function callWith(customEnv: typeof env, path: string, init: Init = {}) {
  const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext
  const res = await worker.fetch!(request(path, init) as Request<unknown, IncomingRequestCfProperties>, customEnv, ctx)
  init.jar?.absorb(res)
  return res
}
