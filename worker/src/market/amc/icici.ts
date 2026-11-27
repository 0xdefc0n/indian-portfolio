// ICICI Prudential Mutual Fund. ⚠️ VERIFY findings (checked 2026-11-27):
// ✅ Page: https://www.icicipruamc.com/media-center/downloads (a React app; the old
//    /downloads/others/monthly-portfolio-disclosures now redirects to a host that doesn't resolve). The page lists files
//    with a POST the page itself makes, `https://apimf.icicipruamc.com/nms/v1/downloads/files`, JSON {categoryId:
//    <the "Monthly Portfolio Disclosures" sub-category id from GET /nms/v1/downloads/categories?userType=Investor>,
//    userType: "Investor", fileType: "All", page: "1", size: "…"}, plus the `env: api` header the app sends on every
//    API call (the gateway routes on it; without it every path answers the app's 404 page). Newest first. One zip per
//    month, titled "Monthly Portfolio Disclosure October 2026", at a relative url
//    `/downloads/Files/Monthly Portfolio Disclosures/2026/Oct/Monthly-Portfolio-Disclosure-October-2026.zip` served
//    from `https://www.icicipruamc.com/blob` (an Azure blob behind the site; ~26 MB, one workbook per scheme). The month
//    folder is irregular (Oct, Sep, July, June; none before 2025) and the entries' FINANCIAL_YEAR tag is wrong
//    (October 2026 is tagged 2025-2026), so the title is matched and the year filter isn't used. October 2026 was up
//    on 2026-11-09. Standard SEBI layout.
// ✅ Bot protection: none seen. F5 BIG-IP cookies are set but plain requests with a generic user agent get 200s, no
//    challenge. www robots.txt is `Disallow:` (empty: all allowed); apimf has no robots.txt (its gateway answers 200
//    with an "Original Status Code: 404" body, which has no rules: all allowed).
// ⚠️ Terms: the site's Terms & Conditions (GET apimf /term-condition, shown at /terms-and-conditions) are per-service
//    (transactions, WhatsApp, voice assistants) with no website-wide clause on downloading or reuse of disclosures. The
//    nearest, in the "Google Assistant and Amazon Alexa" services terms: "You may not systematically extract/ or
//    re-utilise parts of the contents of the Services without Mutual Fund's express written consent. In particular, you
//    may not utilise any data mining, robots, or similar data gathering and extraction tools …". Its scope is those
//    voice services, not the website, but the owner decides (AMC_SCRAPERS, plan §10.3.1).
import { type AmcAdapter, monthParts } from './types'

const API = 'https://apimf.icicipruamc.com/nms/v1/downloads/files'
const BLOB = 'https://www.icicipruamc.com/blob'
const MONTHLY_PORTFOLIO = '26a073d7-08d2-4a95-95fa-f83a4ee51e40' // the "Monthly Portfolio Disclosures" sub-category
const PAGE_SIZE = 36 // three years of months, newest first: one request
const MAX_PAGES = 4

type IciciFile = { title?: { text?: string }; url?: string; fileType?: string }
type IciciFiles = { success?: { data?: { files?: IciciFile[] } } | null }

export const icici: AmcAdapter = {
  slug: 'icici',
  amfi: ['icici prudential mutual fund'],
  hosts: ['apimf.icicipruamc.com', 'www.icicipruamc.com'],
  async discover(month, http) {
    const { y, m, name } = monthParts(month)
    const want = new RegExp(`\\bmonthly\\s+portfolio\\s+disclosure\\s+${name}\\s+${y}\\s*$`, 'i')
    const file = new RegExp(`-${name}-${y}\\.(zip|xlsx?)$`, 'i')
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await http.json<IciciFiles>(API, {
        method: 'POST',
        body: JSON.stringify({ categoryId: MONTHLY_PORTFOLIO, schemeCategory: '', userType: 'Investor', fileType: 'All', page: String(page), size: String(PAGE_SIZE) }),
        headers: { 'content-type': 'application/json', accept: 'application/json', env: 'api' },
      })
      if (!res?.success) throw new Error('icici: unexpected files response')
      const files = res.success.data?.files ?? []
      const hit = files.find((f) => f.url && (want.test(f.title?.text?.trim() ?? '') || file.test(f.url)))
      if (hit?.url) {
        const url = new URL(encodeURI(hit.url.startsWith('/') ? `${BLOB}${hit.url}` : hit.url))
        if (url.host !== 'www.icicipruamc.com') throw new Error('icici: file on an unexpected host')
        return [{ url: url.toString(), name: decodeURIComponent(url.pathname.split('/').pop() ?? '') }]
      }
      // Newest first: stop once a page ends before the month (or the list runs out).
      const oldest = files.at(-1)?.title?.text?.match(/(\w+)\s+(\d{4})\s*$/)
      if (files.length < PAGE_SIZE || !oldest) return []
      const oldestKey = Number(oldest[2]) * 12 + ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(oldest[1]!.slice(0, 3).toLowerCase())
      if (oldestKey < y * 12 + m - 1) return []
    }
    return []
  },
}
