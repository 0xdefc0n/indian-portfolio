// Axis Mutual Fund. ⚠️ VERIFY findings (checked 2026-11-27):
// ⚠️ Page: https://www.axismf.com/statutory-disclosures (AMFI's portfolio-disclosure page links Axis's monthly
//    portfolios here). It is a Next.js page; accordion "8. Portfolios" (sdId `sdPortfolios`, type `nestedList`) has no
//    file links in the HTML. The page's own JS (chunk 6051, StatutoryNestedList / StatutoryDocumentDownload) fills it
//    with JSON POSTs to `/cms/get-nested-list` {sdParentID} (→ data.sdNestedList [{sdNestedId, sdNestedTitle,
//    sdNestedType}]) and `/cms/get-scheme-documents` {sdType, sdID, year?, month?} (→ data.documentList
//    [{documentName, docuementURL}] — sic, and data.years/months for the dropdowns). Files are Strapi-style uploads
//    under `https://www.axismf.com/1/5/<ids>/<name>_<hash>.xlsx`: the ids and hash can't be guessed, so the API is the
//    only way to find them. The CMS calls are unencrypted (API_ENCRYPTION_STATUS_CMS "none") but send CMS service
//    headers from the browser's storage. NOT run: request/response shapes below are read from the JS, not observed,
//    and the October 2026 file names are unknown.
// ⚠️ Bot protection: none seen (Akamai CDN, plain 200s to a generic user agent for the HTML pages and JS). But
//    robots.txt has `User-agent: *` → `Disallow: /cms/`, which covers both API endpoints, so the fetcher refuses them
//    (AmcDisallowed 'robots') and we don't call them. Hence `blocked`.
// ⚠️ Terms (https://www.axismf.com/term-of-use): "AMC grants user a non-exclusive, personal, non-transferable, non-sub
//    licensable, limited and revocable right to access, use and display this Site … for users personal and
//    non-commercial use only", and "User may not publicly perform, publicly display, transmit, publish, participate in
//    the sale or transfer of, modify, or create derivative works based on anything available through the Site, in
//    whole or in part. User shall not store electronically any significant portion of any part of the Site." The owner
//    decides (AMC_SCRAPERS, plan §10.3.1).
import { type AmcAdapter, type AmcHttp, type AmcRequest, monthParts } from './types'

const BASE = 'https://www.axismf.com'
const NESTED = `${BASE}/cms/get-nested-list`
const DOCS = `${BASE}/cms/get-scheme-documents`

type Nested = { sdNestedId?: string | null; sdNestedTitle?: string | null; sdNestedType?: string | null }
type Doc = { documentName?: string | null; docuementURL?: string | null; documentURL?: string | null }
type Reply<T> = { status?: string; data?: T }

const post = (body: unknown): AmcRequest => ({
  method: 'POST',
  body: JSON.stringify(body),
  headers: { 'content-type': 'application/json', accept: 'application/json, */*' },
})

async function nested(http: AmcHttp, body: Record<string, string>): Promise<Nested[]> {
  const r = await http.json<Reply<{ sdNestedList?: Nested[] }>>(NESTED, post(body))
  return r?.data?.sdNestedList ?? []
}

async function documents(http: AmcHttp, body: Record<string, string>): Promise<Doc[]> {
  const r = await http.json<Reply<{ documentList?: Doc[] }>>(DOCS, post(body))
  return r?.data?.documentList ?? []
}

export const axis: AmcAdapter = {
  slug: 'axis',
  amfi: ['axis mutual fund'],
  hosts: ['www.axismf.com'],
  blocked: 'robots.txt disallows /cms/, the only API that lists the portfolio files (their URLs carry upload ids and hashes)',
  async discover(month, http) {
    const { y, name } = monthParts(month)
    const ym = { year: String(y), month: name }
    // "Portfolios" → its "Monthly Portfolio" child (not fortnightly / half-yearly).
    const kids = await nested(http, { sdParentID: 'sdPortfolios' })
    const monthly = kids.find((k) => /monthly/i.test(k.sdNestedTitle ?? '') && !/fortnight|half/i.test(k.sdNestedTitle ?? ''))
    if (!monthly?.sdNestedId) throw new Error('axis: no monthly portfolio section under sdPortfolios')
    const id = monthly.sdNestedId
    let docs: Doc[]
    if (monthly.sdNestedType === 'nestedList') {
      // A year/month picker over per-category children, each with its own document list.
      docs = []
      for (const c of await nested(http, { sdParentID: id, ...ym })) {
        if (c.sdNestedId && c.sdNestedType) docs.push(...(await documents(http, { sdType: c.sdNestedType, sdID: c.sdNestedId })))
      }
    } else {
      docs = await documents(http, { sdType: monthly.sdNestedType ?? 'yearMonthDocs', sdID: id, ...ym })
    }
    const files = new Map<string, string>()
    for (const d of docs) {
      const raw = (d.docuementURL ?? d.documentURL ?? '').trim()
      if (!raw) continue
      const url = new URL(raw, BASE)
      if (url.host !== 'www.axismf.com' || !/\.(xlsx?|xlsb|zip)$/i.test(url.pathname)) continue
      const label = `${d.documentName ?? ''} ${decodeURIComponent(url.pathname)}`
      if (/fortnight|half[- ]?year/i.test(label)) continue
      files.set(url.toString(), label)
    }
    // A combined workbook/zip of all schemes, if offered: one download instead of one per scheme.
    const all = [...files.keys()]
    const combined = all.filter((u) => /\ball[\s_-]*schemes?\b|consolidated|\.zip$/i.test(files.get(u)!))
    return (combined.length ? combined.slice(0, 1) : all).map((url) => ({ url }))
  },
}
