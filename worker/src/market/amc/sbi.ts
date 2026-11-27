// SBI Mutual Fund. ⚠️ VERIFY findings (checked 2026-11-27):
// ✅ Page: https://www.sbimf.com/portfolios fills its file table with a POST the page itself makes,
//    `/ajaxcall/CMS/GetSchemePortfolioSheets` with JSON {FundId: 0, PSYear: "2026", PSMonth: "October",
//    PSFrequency: "Monthly"} (FundId 0 = all schemes). It answers with HTML table rows of links, and none for a month
//    that isn't up yet. For October 2026 there were 120 rows: one combined workbook
//    `/docs/default-source/scheme-portfolios/all-schemes-monthly-portfolio---as-on-31st-october-2026.xlsx` (one sheet
//    per scheme, ~2.6 MB) plus one `sbi-<scheme>-monthly-portfolio---october-2026.xlsx` per scheme. Links carry a
//    Sitefinity `?sfvrsn=…` version; the files are served the same without it. Standard SEBI layout.
// ✅ Bot protection: none seen (Azure Application Gateway, plain 200s to a generic user agent). robots.txt allows `/`
//    but disallows `/*?*` (any query string), so the `?sfvrsn=` is stripped and the POST has no query.
// ✅ Terms (https://www.sbimf.com/disclaimer): a general disclaimer with no clause on downloading or reuse: "Access to
//    this website/mobile application is confirmation that you understand and agree to be bound by all of these terms
//    and conditions" and "Use of this website is at your own risk." No non-commercial restriction found.
import { type AmcAdapter, links, monthParts } from './types'

const BASE = 'https://www.sbimf.com/'
const SHEETS = 'https://www.sbimf.com/ajaxcall/CMS/GetSchemePortfolioSheets'

export const sbi: AmcAdapter = {
  slug: 'sbi',
  amfi: ['sbi mutual fund'],
  hosts: ['www.sbimf.com'],
  async discover(month, http) {
    const { y, name } = monthParts(month)
    const html = await http.text(SHEETS, {
      method: 'POST',
      body: JSON.stringify({ FundId: 0, PSYear: String(y), PSMonth: name, PSFrequency: 'Monthly' }),
      headers: { 'content-type': 'application/json;charset=utf-8', accept: 'text/html, */*' },
    })
    const files = new Set<string>()
    for (const u of links(html, BASE)) {
      const url = new URL(u)
      const path = url.pathname.toLowerCase()
      if (url.host !== 'www.sbimf.com' || !path.startsWith('/docs/default-source/')) continue
      if (!/\.xlsx?$/.test(path) || !path.includes(`${name.toLowerCase()}-${y}`) || /fortnight|half-?year/.test(path)) continue
      url.search = '' // robots.txt disallows query strings; the file is the same without `?sfvrsn=`
      files.add(url.toString())
    }
    // The combined workbook has every scheme: one download instead of ~120. Per-scheme files only if it's missing.
    const all = [...files]
    const combined = all.filter((u) => /\/all-schemes-monthly-portfolio[^/]*$/i.test(new URL(u).pathname))
    return (combined.length ? combined.slice(0, 1) : all).map((url) => ({ url }))
  },
}
