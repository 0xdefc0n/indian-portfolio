// UTI Mutual Fund. ⚠️ VERIFY findings (checked 2026-11-27):
// ✅ Page: https://www.utimf.com/downloads/consolidate-all-portfolio-disclosure is an Angular page; its year/month form
//    calls the CMS JSON endpoint `/api/get-consolidate-portfolio-disclosure?year=2026&month=October` (the template comes
//    from `/api/page/forms-and-downloads-downloads`, entry `consolidate-all-portfolio-disclosure`). It answers
//    {rows: [{name: "Consolidated Portfolio October 2026", type: "Zip", url, month, year}]}, and {rows: []} for a month
//    that isn't up yet. The file is one zip of every scheme's workbook on the CMS's CloudFront bucket,
//    `https://d3ce1o48hc5oli.cloudfront.net/s3fs-public/{upload yyyy-mm}/uti_mf_scheme_portfolios_{dd.mm.yyyy}_1.zip
//    ?VersionId=…` (~1.7 MB for October 2026, which was up by 2026-11-27). Per-scheme files exist too
//    (`/api/get-scheme-portfolio-disclosure?dofa_scheme_code=…`), one request each, so the zip is used.
// ✅ Bot protection: none seen (CloudFront + F5 Distributed Cloud "volt-adc", plain 200 JSON to a generic user agent).
//    www.utimf.com robots.txt is `Allow: /` with a few account paths disallowed (not /api/). The CloudFront file host
//    has no robots.txt (403 from S3), which the fetcher treats as allow-all.
// ✅ Terms (https://www.utimf.com/terms-and-conditions, /disclaimer): informational disclaimers only, e.g. "The
//    information contained on this site is for informational purposes only and should not be construed as an offer to
//    sell…". No clause on downloading, reproduction or commercial reuse found.
import { type AmcAdapter, monthParts } from './types'

const API = 'https://www.utimf.com/api/get-consolidate-portfolio-disclosure'

type Row = { name?: string; type?: string; url?: string; doc?: string; month?: string; year?: string }

export const uti: AmcAdapter = {
  slug: 'uti',
  amfi: ['uti mutual fund'],
  hosts: ['www.utimf.com', 'd3ce1o48hc5oli.cloudfront.net'],
  async discover(month, http) {
    const { y, name } = monthParts(month)
    const res = await http.json<{ rows?: Row[] }>(`${API}?year=${y}&month=${name}`, { headers: { accept: 'application/json' } })
    if (!res || !Array.isArray(res.rows)) throw new Error('uti: unexpected answer')
    const files = res.rows
      .filter((r) => (!r.month || r.month.toLowerCase() === name.toLowerCase()) && (!r.year || r.year === String(y)))
      .map((r) => r.url || r.doc)
      .filter((u): u is string => !!u && /\.(zip|xlsx?|xlsb)$/i.test(new URL(u).pathname))
    // One zip of every scheme. If they ever publish more than one row (a corrected re-upload), take the zip first.
    const zip = files.filter((u) => /\.zip$/i.test(new URL(u).pathname))
    return (zip.length ? zip.slice(0, 1) : files).map((url) => ({ url, name: decodeURIComponent(new URL(url).pathname.split('/').pop()!) }))
  },
}
