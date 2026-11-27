// Mirae Asset Mutual Fund. ⚠️ VERIFY findings (checked 2026-11-27):
// ✅ Page: https://www.miraeassetmf.co.in/downloads/portfolio (the old `/downloads/portfolios` 301s there) fills its
//    "Monthly Portfolio" tab with a POST the page itself makes (DownloadPortfolio.js → main.js AjaxService):
//    `/AjaxService/GetDownloadsData` with JSON {request: {modulename: "portfolio_tab1", pgno, pgsize}}. It answers
//    {ReturnCode: "0", DataCount, Data: [{Title, URL, PublishDate}]}, newest first, every month ever published
//    (~3,900 rows). Titles read "Portfolio Details as on 31st October 2026 for Mirae Asset <scheme>"; URLs are
//    `/docs/default-source/portfolios/<code>_<mon><yyyy>.xlsx` with an irregular month token (`oct2026`, `sept2026`),
//    one or two missing the leading slash, so the month is read from the title. No combined workbook or zip: one xlsx
//    per scheme, 101 for October 2026 (up on 2026-11-09). Standard SEBI layout.
// ✅ Bot protection: none seen (Azure Front Door, plain 200s to a generic user agent; the page loads reCAPTCHA only
//    for its forms). robots.txt `User-agent: *` disallows only /cgi-bin/ and /docs/default-source/remuneration-details/.
// ⚠️ Terms (https://www.miraeassetmf.co.in/terms-of-use): "MAMF / AMC grants you a non-exclusive, personal,
//    non-transferable, non-sub-licensable, limited and revocable right to access, use and display this Site … for your
//    personal and non-commercial use only" and "No part of this website may be copied or reproduced in any manner
//    whatsoever without the prior permission of Mirae Asset Mutual Fund / AMC." The owner decides (AMC_SCRAPERS,
//    plan §10.3.1).
import { type AmcAdapter, MONTH_NAMES, monthParts } from './types'

const BASE = 'https://www.miraeassetmf.co.in/'
const LIST = 'https://www.miraeassetmf.co.in/AjaxService/GetDownloadsData'
const PAGE_SIZE = 150 // a month is ~100 files, so the newest month is normally one request
const MAX_PAGES = 30 // ~4,500 rows: the whole history, then stop

type Row = { Title?: string; URL?: string }
type Answer = { ReturnCode?: string; DataCount?: number; Data?: Row[] | null }

const TITLE = /\bas on\s+\d{1,2}(?:st|nd|rd|th)?\s+([a-z]+)[\s,]+(\d{4})\b/i

/** The YYYY-MM a row is as of, from its title ("… as on 31st October 2026 for …"). */
function rowMonth(title: string): string | null {
  const m = TITLE.exec(title)
  if (!m) return null
  const i = MONTH_NAMES.findIndex((n) => n.slice(0, 3).toLowerCase() === m[1]!.slice(0, 3).toLowerCase())
  return i < 0 ? null : `${m[2]}-${String(i + 1).padStart(2, '0')}`
}

export const mirae: AmcAdapter = {
  slug: 'mirae',
  amfi: ['mirae asset mutual fund'],
  hosts: ['www.miraeassetmf.co.in'],
  async discover(month, http) {
    monthParts(month) // validates the month
    const files = new Map<string, string | undefined>()
    for (let pgno = 1; pgno <= MAX_PAGES; pgno++) {
      const res = await http.json<Answer>(LIST, {
        method: 'POST',
        body: JSON.stringify({ request: { modulename: 'portfolio_tab1', pgno, pgsize: PAGE_SIZE } }),
        headers: { 'content-type': 'application/json;charset=utf-8', accept: 'application/json, */*' },
      })
      if (res.ReturnCode === '101') break // "no data"
      if (res.ReturnCode !== '0' || !Array.isArray(res.Data)) throw new Error(`mirae: unexpected answer ${res.ReturnCode}`)
      let older = false
      let dated = 0
      for (const row of res.Data) {
        const m = rowMonth(row.Title ?? '')
        if (!m) continue
        dated++
        if (m < month) older = true
        if (m !== month || !row.URL) continue
        const url = new URL(row.URL.trim(), BASE)
        if (url.host !== 'www.miraeassetmf.co.in' || !/\.xlsx?$/i.test(url.pathname)) continue
        // One file per scheme: its name lets the job fetch only the files of funds someone holds.
        files.set(url.toString(), /\bfor\s+(.+)$/i.exec(row.Title ?? '')?.[1]?.trim())
      }
      if (res.Data.length && !dated) throw new Error('mirae: no row titles carry a date (layout changed)')
      // Newest first: once rows older than the month show up, the month is complete (or was never there).
      if (older || res.Data.length < PAGE_SIZE || pgno * PAGE_SIZE >= (res.DataCount ?? 0)) break
    }
    return [...files].map(([url, scheme]) => ({ url, scheme }))
  },
}
