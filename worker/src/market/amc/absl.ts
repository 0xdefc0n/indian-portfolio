// Aditya Birla Sun Life Mutual Fund. ⚠️ VERIFY findings (checked 2026-11-27):
// ✅ Page: https://mutualfund.adityabirlacapital.com/forms-and-downloads/portfolio is a Sitecore page whose "Monthly
//    Portfolio" accordion is filled by a GET the page itself makes (global.js resourceAccordianAjax):
//    `/postlogin/CustomApi/Resources/FactsheetAccordionById?id=3ccab227-…&ctype=…&month= &year=0`. It answers JSON
//    {ReturnCode: "1", AccordionList: [{ResourceLink: "Monthly Portfolios as on October 31, 2026", pdfUrl}, …]} with
//    every month back to ~2009 (213 entries, ~150 KB), newest first. One zip per month with every scheme's workbook,
//    e.g. `/-/media/bsl/files/resources/monthly-portfolio/2026/31102026_abslmf_monthlydisclosure.zip` (~2.1 MB). The
//    file name changes from month to month (`monthly-portfolio-31082026_abslmf.zip`,
//    `absl_monthly_portfolio_report_july--2026.zip`, `sebi_monthly_portfolio-31-jan-2026.zip`…), so the month is
//    matched on the entry's title, not the file name. pdfUrl points at `abcscprod.azureedge.net`, which no longer
//    resolves (Azure CDN/Edgio retired); the same path is served from mutualfund.adityabirlacapital.com, so the host is
//    rewritten. October 2026 was up by 2026-11-27.
// ✅ Bot protection: none seen (F5 Distributed Cloud `volt-adc` + TS cookies, but plain 200s to a generic user agent,
//    no challenge). robots.txt disallows only /admin/, /private/, /scripts/, `utm_` query strings, .php/.cgi and a few
//    remuneration PDFs: /postlogin/CustomApi/ and /-/media/ are allowed.
// ⚠️ Terms (https://mutualfund.adityabirlacapital.com/terms-and-conditions, updated 2025-12-16): "You should not copy,
//    display, download, distribute, modify, reproduce, republish, or retransmit any information, text, or documents
//    contained in the Platform or the Services or any portion thereof in any electronic medium or in hard copy, or
//    create any derivative work based on such images, texts or documents, without our express written consent or as
//    otherwise permitted in these Terms." Also: "The contents of the Platform and the Services may not be copied,
//    recopied, reproduced, or otherwise redistributed." No clause on robots/scraping. The owner decides (AMC_SCRAPERS,
//    plan §10.3.1).
import { type AmcAdapter, monthParts } from './types'

const HOST = 'mutualfund.adityabirlacapital.com'
const LIST =
  `https://${HOST}/postlogin/CustomApi/Resources/FactsheetAccordionById?id=3ccab227-9de5-4494-b78d-2b4f7c0c054a` +
  '&ctype=%2Fsitecore%2Fcontent%2FRoot%2FBSL%2FLibrary%2FLists%2FFAQ%2FCustomer%20Types%2FIndividual&month=%20&year=0'

type Entry = { ResourceLink?: string; pdfUrl?: string }

export const absl: AmcAdapter = {
  slug: 'absl',
  amfi: ['aditya birla sun life mutual fund'],
  hosts: [HOST],
  async discover(month, http) {
    const { y, name } = monthParts(month)
    const res = await http.json<{ ReturnCode?: string; AccordionList?: Entry[] }>(LIST, { headers: { accept: 'application/json' } })
    if (res.ReturnCode !== '1' || !Array.isArray(res.AccordionList)) throw new Error('absl: unexpected portfolio list')
    // "Monthly Portfolios as on October 31, 2026" (the day is the month's last; don't depend on it)
    const title = new RegExp(`^\\s*monthly portfolios? as on ${name}\\s+\\d{1,2},?\\s+${y}\\s*$`, 'i')
    for (const e of res.AccordionList) {
      if (!e.ResourceLink || !e.pdfUrl || !title.test(e.ResourceLink)) continue
      const url = new URL(e.pdfUrl, `https://${HOST}/`)
      if (!/\.(zip|xlsx?|xlsb)$/i.test(url.pathname)) continue
      url.protocol = 'https:'
      url.host = HOST // the dead azureedge CDN host; the site serves the same path
      return [{ url: url.toString() }]
    }
    return []
  },
}
