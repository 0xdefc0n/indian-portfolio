// Polite HTTP for the AMC scrapers (plan §10.3.1): only the adapter's hosts, robots.txt respected, at most one request
// per second per host, a generic user agent, a size cap. Bot protection (a challenge page, 403/429 from a WAF) throws
// AmcBlocked so the run is recorded `blocked` and the funds go to BharatStock. Public market data only.
import type { AmcHttp, AmcRequest } from './types'

export const USER_AGENT = 'Mozilla/5.0 (compatible; fund-portfolios/1.0)' // generic, like the NAV and BharatStock fetches
export const MIN_GAP_MS = 1_000
export const MAX_FILE_BYTES = 48 * 1024 * 1024 // the engine's limit for one disclosure file
const MAX_PAGE_BYTES = 8 * 1024 * 1024
const TIMEOUT_MS = 60_000

export class AmcBlocked extends Error {
  override name = 'AmcBlocked'
}
export class AmcHttpError extends Error {
  override name = 'AmcHttpError'
  constructor(readonly status: number) {
    super(`status ${status}`)
  }
}
export class AmcDisallowed extends Error {
  override name = 'AmcDisallowed'
}
export class AmcTooLarge extends Error {
  override name = 'AmcTooLarge'
}

type Rules = { allow: string[]; disallow: string[] }

/** The `User-agent: *` group of a robots.txt (we send no product token of our own, so only `*` applies). */
export function parseRobots(txt: string): Rules {
  const rules: Rules = { allow: [], disallow: [] }
  let inStar = false
  let groupHasRules = false
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    const i = line.indexOf(':')
    if (i < 0) continue
    const key = line.slice(0, i).trim().toLowerCase()
    const value = line.slice(i + 1).trim()
    if (key === 'user-agent') {
      if (groupHasRules) {
        inStar = false
        groupHasRules = false
      }
      if (value === '*') inStar = true
    } else if (key === 'allow' || key === 'disallow') {
      groupHasRules = true
      if (inStar && value) rules[key].push(value)
    }
  }
  return rules
}

function ruleMatches(rule: string, path: string): number {
  // Google's semantics: `*` any run, `$` end; the longest matching rule wins, Allow wins a tie.
  const re = new RegExp('^' + rule.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replaceAll('*', '.*').replace(/\\\$$|\$$/, '$'))
  return re.test(path) ? rule.length : -1
}

export function robotsAllows(rules: Rules, pathAndQuery: string): boolean {
  let path = pathAndQuery
  try {
    path = decodeURI(pathAndQuery)
  } catch {
    // keep it encoded
  }
  const allow = Math.max(-1, ...rules.allow.map((r) => ruleMatches(r, path)))
  const disallow = Math.max(-1, ...rules.disallow.map((r) => ruleMatches(r, path)))
  return disallow < 0 || allow >= disallow
}

/** Signs of a bot wall rather than a real answer. */
function looksBlocked(res: Response, body?: string): boolean {
  if (res.headers.get('cf-mitigated') === 'challenge') return true
  if ((res.status === 403 || res.status === 429 || res.status === 503) && (res.headers.has('cf-ray') || /akamai|incapsula|imperva|cloudflare|captcha|access denied/i.test(`${res.headers.get('server') ?? ''} ${body ?? ''}`))) return true
  return !!body && /<title>\s*(just a moment|attention required|access denied)|captcha|cf-challenge|_incapsula_resource|bot\s*protection/i.test(body.slice(0, 4000))
}

export type FetchStats = { requests: number; bytes: number }

/**
 * One fetcher per AMC run. `fetchImpl` and `sleep` are injectable for tests. Requests run one at a time (the run is
 * sequential), so the per-host gap holds without locking.
 */
export class AmcFetcher implements AmcHttp {
  readonly stats: FetchStats = { requests: 0, bytes: 0 }
  private readonly last = new Map<string, number>()
  private readonly robots = new Map<string, Promise<Rules>>()

  constructor(
    private readonly hosts: readonly string[],
    private readonly opts: { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
  ) {}

  private async pace(host: string): Promise<void> {
    const now = this.opts.now ?? Date.now
    const prev = this.last.get(host)
    const wait = prev === undefined ? 0 : prev + MIN_GAP_MS - now()
    if (wait > 0) await (this.opts.sleep ?? ((ms) => scheduler.wait(ms)))(wait)
    this.last.set(host, now())
  }

  private async raw(url: URL, init: AmcRequest = {}): Promise<Response> {
    await this.pace(url.host)
    this.stats.requests++
    return (this.opts.fetch ?? fetch)(url.toString(), {
      method: init.method ?? 'GET',
      body: init.body,
      headers: { 'user-agent': USER_AGENT, accept: '*/*', ...init.headers },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  }

  private rules(origin: URL): Promise<Rules> {
    let p = this.robots.get(origin.host)
    if (!p) {
      p = (async () => {
        try {
          const res = await this.raw(new URL('/robots.txt', origin))
          if (res.status >= 400 && res.status < 500) {
            await res.body?.cancel()
            return { allow: [], disallow: [] } // no robots.txt: everything allowed
          }
          if (!res.ok) {
            await res.body?.cancel()
            return { allow: [], disallow: ['/'] } // a 5xx: assume nothing is allowed (Google does the same)
          }
          return parseRobots((await res.text()).slice(0, 512 * 1024))
        } catch {
          return { allow: [], disallow: ['/'] }
        }
      })()
      this.robots.set(origin.host, p)
    }
    return p
  }

  /** Checks host and robots.txt, then fetches. Redirects to another host are refused. */
  async request(target: string, init: AmcRequest = {}): Promise<Response> {
    const url = new URL(target)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new AmcDisallowed('scheme')
    if (!this.hosts.includes(url.host)) throw new AmcDisallowed('host')
    if (!robotsAllows(await this.rules(url), url.pathname + url.search)) throw new AmcDisallowed('robots')
    const res = await this.raw(url, init)
    const final = res.url ? new URL(res.url) : url
    if (!this.hosts.includes(final.host)) {
      await res.body?.cancel()
      throw new AmcDisallowed('redirect')
    }
    if (looksBlocked(res)) {
      await res.body?.cancel()
      throw new AmcBlocked(String(res.status))
    }
    return res
  }

  private async body(res: Response, limit: number): Promise<Uint8Array<ArrayBuffer>> {
    const declared = Number(res.headers.get('content-length') ?? '')
    if (declared > limit) {
      await res.body?.cancel()
      throw new AmcTooLarge()
    }
    const reader = res.body?.getReader()
    if (!reader) return new Uint8Array(0)
    const parts: Uint8Array[] = []
    let n = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      n += value.byteLength
      if (n > limit) {
        await reader.cancel()
        throw new AmcTooLarge()
      }
      parts.push(value)
    }
    const out = new Uint8Array(n)
    let at = 0
    for (const p of parts) {
      out.set(p, at)
      at += p.byteLength
    }
    this.stats.bytes += n
    return out
  }

  async text(url: string, init?: AmcRequest): Promise<string> {
    const res = await this.request(url, init)
    if (!res.ok) {
      await res.body?.cancel()
      throw new AmcHttpError(res.status)
    }
    const text = new TextDecoder().decode(await this.body(res, MAX_PAGE_BYTES))
    if (looksBlocked(res, text)) throw new AmcBlocked('page')
    return text
  }

  async json<T = unknown>(url: string, init?: AmcRequest): Promise<T> {
    return JSON.parse(await this.text(url, init)) as T
  }

  async status(url: string, init?: AmcRequest): Promise<number> {
    const res = await this.request(url, init)
    await res.body?.cancel()
    return res.status
  }

  /** A disclosure file's bytes. Throws AmcHttpError for a non-2xx answer, AmcBlocked for an HTML bot wall. */
  async file(url: string, init?: AmcRequest): Promise<Uint8Array<ArrayBuffer>> {
    const res = await this.request(url, init)
    if (!res.ok) {
      await res.body?.cancel()
      throw new AmcHttpError(res.status)
    }
    const bytes = await this.body(res, MAX_FILE_BYTES)
    if (/text\/html/i.test(res.headers.get('content-type') ?? '') && looksBlocked(res, new TextDecoder().decode(bytes.subarray(0, 4000)))) throw new AmcBlocked('file')
    return bytes
  }
}
