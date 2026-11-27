// AMC disclosure adapters (plan §10.3.1, M18). One file per AMC in this folder; index.ts lists them.
//
// An adapter only finds the month's disclosure files. The Worker downloads them (fetcher.ts: robots.txt, at most one
// request per second per host, only the adapter's hosts, a generic user agent) and the engine parses them
// (`/stocks/parse`, engine/engine/amc). Each adapter file starts with its ⚠️ VERIFY findings: the disclosure page and
// file naming, bot protection, terms of use.

/**
 * A disclosure file to download. `name` is what the engine sees as the file name (default: the URL's last segment).
 * `scheme`: for one-file-per-scheme AMCs, the scheme the file is for; the job then downloads only the files whose
 * scheme could be a wanted fund (a loose name score), instead of every scheme the AMC has.
 */
export type AmcFile = { url: string; name?: string; scheme?: string; init?: AmcRequest }

export type AmcRequest = { method?: 'GET' | 'POST'; body?: string; headers?: Record<string, string> }

/** Polite HTTP for discover(): every call is checked against robots.txt and the adapter's hosts, and paced. */
export interface AmcHttp {
  text(url: string, init?: AmcRequest): Promise<string>
  json<T = unknown>(url: string, init?: AmcRequest): Promise<T>
  /** Status without throwing (a HEAD-like probe: GET, body discarded). */
  status(url: string, init?: AmcRequest): Promise<number>
}

export interface AmcAdapter {
  /** The engine's adapter slug (engine/engine/amc/__init__.py SLUGS). */
  slug: string
  /** AMFI fund-house names it covers, lower-case with single spaces (as in amc-ids.ts and the `scheme.amc` column). */
  amfi: string[]
  /** Hosts it may fetch from (exact host names). Anything else is refused. */
  hosts: string[]
  /** Set when the site can't be scraped (bot protection, terms of use): the reason. Its funds go to BharatStock. */
  blocked?: string
  /**
   * The disclosure files for `month` (YYYY-MM, the month the portfolio is as of). [] when that month isn't published
   * yet. Throw for anything else (a changed page layout): the run is recorded `failed`.
   */
  discover(month: string, http: AmcHttp): Promise<AmcFile[]>
}

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const

/** Helpers adapters share: the month's name, its last day, and links found in a page. */
export function monthParts(month: string): { y: number; m: number; name: string; short: string; lastDay: number } {
  const y = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  const name = MONTH_NAMES[m - 1]!
  return { y, m, name, short: name.slice(0, 3), lastDay: new Date(Date.UTC(y, m, 0)).getUTCDate() }
}

/** Every href in an HTML page, resolved against `base`, without duplicates. */
export function links(html: string, base: string): string[] {
  const out = new Set<string>()
  for (const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const raw = m[1]!.replaceAll('&amp;', '&').trim()
    if (!raw || raw.startsWith('#') || /^(javascript|mailto|tel):/i.test(raw)) continue
    try {
      out.add(new URL(raw, base).toString())
    } catch {
      // not a URL
    }
  }
  return [...out]
}
