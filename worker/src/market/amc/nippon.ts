// Nippon India Mutual Fund. ⚠️ VERIFY findings (checked 2026-11-27):
// ✅ Page: https://mf.nipponindiaim.com/investor-service/downloads/factsheet-portfolio-and-other-disclosures (SharePoint,
//    server-rendered: every file is a plain link, newest first). One combined workbook per month, all schemes, one
//    sheet per scheme: `/InvestorServices/FactsheetsDocuments/NIMF-MONTHLY-PORTFOLIO-{dd}-{Mon}-{yy}.xls`, e.g.
//    `NIMF-MONTHLY-PORTFOLIO-31-Oct-26.xls`, `-30-Sep-26.xls`. The month token drifts (`Jun`/`June`, `July`,
//    `April`, older ones `Nov-25`, `APRIL-2024`, `REPORT-March-24`), so the match takes a 3-letter or full month name
//    and a 2- or 4-digit year. Fortnightly portfolios (`NIMF-FORTNIGHTLY-PORTFOLIO-…`), risk parameters and the
//    `Weblink-file-{Month}-{yyyy}.zip` (per-scheme web disclosures) sit on the same page and are skipped. October 2026
//    was up by 2026-11-27.
// ⚠️ Bot protection: Cloudflare in front (cf-ray, __cf_bm cookie) but no challenge: plain 200s to a generic user agent.
//    robots.txt, though, has `Disallow: /InvestorServices/Factsheets` in its `User-agent: *` group, which by prefix
//    match covers `/InvestorServices/FactsheetsDocuments/` where the workbooks live (the page itself is allowed). The
//    fetcher refuses those downloads (AmcDisallowed 'robots'), so the adapter is marked blocked. (SharePoint paths are
//    case-insensitive, but a re-cased URL to dodge the rule would not be polite; not done.) If Nippon changes robots.txt
//    or the owner gets permission, drop `blocked`: discover already returns the right file.
// ✅ Terms (https://mf.nipponindiaim.com/Pages/DisclaimerspolicyPrivacypolicy.aspx): a general disclaimer with no
//    clause on downloading or reuse: "The information provided on this website is meant only for general reading
//    purposes and the views being expressed only constitute opinions…". No non-commercial restriction found.
import { type AmcAdapter, links, monthParts } from './types'

const PAGE = 'https://mf.nipponindiaim.com/investor-service/downloads/factsheet-portfolio-and-other-disclosures'

export const nippon: AmcAdapter = {
  slug: 'nippon',
  amfi: ['nippon india mutual fund'],
  hosts: ['mf.nipponindiaim.com'],
  blocked: 'robots.txt disallows /InvestorServices/Factsheets*, where the monthly portfolio workbooks are',
  async discover(month, http) {
    const { y, name, short } = monthParts(month)
    const mon = name === 'September' ? `${name}|Sept|Sep` : `${name}|${short}`
    const yy = String(y).slice(2)
    const re = new RegExp(`/NIMF-MONTHLY-PORTFOLIO(?:-REPORT)?-(?:\\d{1,2}-)?(?:${mon})-(?:${y}|${yy})\\.xlsx?$`, 'i')
    const files = links(await http.text(PAGE), PAGE).filter((u) => {
      const url = new URL(u)
      return url.host === 'mf.nipponindiaim.com' && url.pathname.startsWith('/InvestorServices/FactsheetsDocuments/') && re.test(url.pathname)
    })
    // One combined workbook a month; if the page ever lists two (a re-upload), take the first (newest).
    return files.slice(0, 1).map((u) => {
      const url = new URL(u)
      url.port = ''
      return { url: url.toString() }
    })
  },
}
