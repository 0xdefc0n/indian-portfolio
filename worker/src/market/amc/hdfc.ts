// HDFC Mutual Fund. ⚠️ VERIFY findings (checked 2026-11-27):
// ✅ Page: https://www.hdfcfund.com/statutory-disclosure/portfolio/monthly-portfolio (a JS app). The files live on
//    the S3/CloudFront file host, one workbook per scheme, no combined file or zip seen:
//    `https://files.hdfcfund.com/s3fs-public/{upload yyyy-mm}/Monthly {Scheme} - {dd} {Month} {yyyy}.xlsx`, where the
//    upload folder is the month after the portfolio month (October 2026 → `2026-11/… - 31 October 2026.xlsx`, up on
//    2026-11-07; same pattern May–September 2026). {Scheme} is HDFC's own spelling and S3 keys are case-sensitive:
//    `&` is dropped leaving a double space ("Banking  Financial Services"), apostrophes dropped ("Childrens"), and
//    capitalisation differs from AMFI's ("BSE 500 INDEX FUND"). A missing key answers 403 (S3 AccessDenied XML).
// ⚠️ Bot protection: www.hdfcfund.com (Akamai) answers 403 "Access Denied" to a generic user agent for every path,
//    robots.txt included, so the listing (and the API it calls) can't be read politely. files.hdfcfund.com serves the
//    files to a generic user agent (200; its robots.txt is a 403 = none). So discover() never touches www: it probes
//    the known scheme files below (a one-byte Range GET each) and keeps the ones that exist. A new or renamed scheme
//    is missed until it's added to SCHEMES. Not yet found on the file host for 2026-10 (other spellings): NIFTY100
//    Quality 30 ETF, NIFTY50 Equal Weight Index Fund, NIFTY50 Value 20 ETF, NIFTY500 Multicap 50:25:25 Index Fund,
//    Nifty LargeMidcap250 Plus G-sec 70:30 Index Fund. Debt, FMP, gold/silver and FoF schemes are left out (no stocks).
// ⚠️ Terms (https://www.hdfcfund.com/disclaimer): "The User of this Site may download materials, data etc displayed on
//    the Site for non-commercial and/or personal use only." and "The User may not, however, distribute, modify,
//    transmit, reuse, report, or use the contents of the Site … without HDFC AMC's written permission." The owner
//    decides (AMC_SCRAPERS, plan §10.3.1).
import { type AmcAdapter, monthParts } from './types'

const FILES = 'https://files.hdfcfund.com/s3fs-public/'

/** Scheme names exactly as HDFC spells them in the file names (checked against October 2026). */
export const SCHEMES = [
  'HDFC Flexi Cap Fund', // first: the canary for "is this month up yet"
  'HDFC Aggressive Hybrid Fund',
  'HDFC Arbitrage Fund',
  'HDFC Balanced Advantage Fund',
  'HDFC Banking  Financial Services Fund',
  'HDFC BSE 500 ETF',
  'HDFC BSE 500 INDEX FUND',
  'HDFC BSE India Sector Leaders Index Fund',
  'HDFC BSE REITS and Commercial Real Estate Index Fund',
  'HDFC BSE SENSEX ETF',
  'HDFC BSE Sensex Index Fund',
  'HDFC Business Cycle Fund',
  'HDFC Charity Fund for Cancer Cure',
  'HDFC Childrens Fund',
  'HDFC Conservative Hybrid Fund',
  'HDFC Consumption Fund',
  'HDFC Defence Fund',
  'HDFC Dividend Yield Fund',
  'HDFC ELSS - Tax Saver Fund',
  'HDFC Equity Savings Fund',
  'HDFC Focused Fund',
  'HDFC FTSE India Equity ETF',
  'HDFC Housing Opportunities Fund',
  'HDFC Infrastructure Fund',
  'HDFC Innovation Fund',
  'HDFC Large  Mid Cap Fund',
  'HDFC Large Cap Fund',
  'HDFC Long Term Fund',
  'HDFC Manufacturing Fund',
  'HDFC Mid Cap Fund',
  'HDFC MNC Fund',
  'HDFC Multi Asset Allocation Fund',
  'HDFC Multi Cap Fund',
  'HDFC NIFTY 100 Equal Weight Index Fund',
  'HDFC NIFTY 100 ETF',
  'HDFC NIFTY 100 Index Fund',
  'HDFC NIFTY 50 ETF',
  'HDFC Nifty 50 Index Fund',
  'HDFC Nifty Auto Index Fund',
  'HDFC NIFTY BANK ETF',
  'HDFC Nifty Growth Sectors 15 ETF',
  'HDFC Nifty India Consumption Index Fund',
  'HDFC Nifty India Digital Index Fund',
  'HDFC NIFTY IT ETF',
  'HDFC Nifty LargeMidcap 250 Index Fund',
  'HDFC Nifty Metal ETF',
  'HDFC NIFTY MIDCAP 150 ETF',
  'HDFC NIFTY MIDCAP 150 INDEX FUND',
  'HDFC NIFTY NEXT 50 ETF',
  'HDFC NIFTY Next 50 Index Fund',
  'HDFC NIFTY Private Bank ETF',
  'HDFC NIFTY PSU BANK ETF',
  'HDFC NIFTY REALTY INDEX FUND',
  'HDFC NIFTY SMALLCAP 250 ETF',
  'HDFC NIFTY SMALLCAP 250 INDEX FUND',
  'HDFC NIFTY Top 20 Equal Weight Index Fund',
  'HDFC NIFTY100 LOW VOLATILITY 30 ETF',
  'HDFC NIFTY100 Low Volatility 30 Index Fund',
  'HDFC Nifty100 Quality 30 Index Fund',
  'HDFC NIFTY200 MOMENTUM 30 ETF',
  'HDFC NIFTY200 MOMENTUM 30 INDEX FUND',
  'HDFC Pharma and Healthcare Fund',
  'HDFC Retirement Fund - Equity Plan',
  'HDFC Retirement Fund - Hybrid-Equity Plan',
  'HDFC Small Cap Fund',
  'HDFC Technology Fund',
  'HDFC Transportation and Logistics Fund',
  'HDFC Value Fund',
] as const

const PROBE = { headers: { range: 'bytes=0-0' } } // one byte: the probe only wants the status

export const hdfc: AmcAdapter = {
  slug: 'hdfc',
  amfi: ['hdfc mutual fund'],
  hosts: ['files.hdfcfund.com'],
  blocked: 'www.hdfcfund.com (Akamai) answers 403 Access Denied to a generic user agent, robots.txt included; the files host is open but the listing is not',
  async discover(month, http) {
    const { y, m, name, lastDay } = monthParts(month)
    const up = new Date(Date.UTC(y, m, 1)) // uploaded the month after
    const folder = `${up.getUTCFullYear()}-${String(up.getUTCMonth() + 1).padStart(2, '0')}`
    const url = (scheme: string) => FILES + folder + '/' + encodeURIComponent(`Monthly ${scheme} - ${lastDay} ${name} ${y}.xlsx`)
    const ok = (s: number) => s === 200 || s === 206
    const out = []
    for (const [i, scheme] of SCHEMES.entries()) {
      const s = await http.status(url(scheme), PROBE)
      if (i === 0 && !ok(s)) {
        if (s === 403 || s === 404) return [] // the canary isn't up: the month isn't published yet
        throw new Error(`hdfc: canary answered ${s}`)
      }
      if (ok(s)) out.push({ url: url(scheme) })
    }
    if (out.length < SCHEMES.length / 2) throw new Error(`hdfc: only ${out.length} of ${SCHEMES.length} files found (naming changed?)`)
    return out
  },
}
