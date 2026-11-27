// PPFAS Mutual Fund (Parag Parikh). ⚠️ VERIFY findings (checked 2026-11-27):
// ✅ Page: https://amc.ppfas.com/downloads/portfolio-disclosure/ lists every month as links, newest first. One combined
//    workbook per month, `/downloads/portfolio-disclosure/{yyyy}/PPFAS_Monthly_Portfolio_Report_{Month}_{dd}_{yyyy}.xls`
//    (an xlsx despite the name; one sheet per scheme, sheet names are scheme codes such as PPFCF), plus one
//    `{CODE}_PPFAS_Monthly_Portfolio_Report_…xlsx` per scheme. A `?ddmmyyyy` cache-buster follows the link. October
//    2026 was up on 2026-11-09. Standard SEBI layout; weights are fractions (0.0749), which the engine scales.
// ✅ Bot protection: none. Plain HTML, 200 with a generic user agent. robots.txt allows /downloads/.
// ⚠️ Terms (https://amc.ppfas.com/other-links/disclaimer.php): downloads are for "non-commercial and/or personal use
//    only"; public or commercial reuse needs PPFAS's written permission. The owner decides (AMC_SCRAPERS, plan §10.3.1).
import { type AmcAdapter, links, monthParts } from './types'

const PAGE = 'https://amc.ppfas.com/downloads/portfolio-disclosure/'

export const ppfas: AmcAdapter = {
  slug: 'ppfas',
  amfi: ['ppfas mutual fund'],
  hosts: ['amc.ppfas.com'],
  async discover(month, http) {
    const { y, name } = monthParts(month)
    const files = links(await http.text(PAGE), PAGE).filter((u) => {
      const path = new URL(u).pathname
      return path.includes(`/portfolio-disclosure/${y}/`) && new RegExp(`_${name}_\\d{1,2}_${y}\\.xlsx?$`, 'i').test(path)
    })
    // The combined workbook has every scheme: one download instead of eight. Per-scheme files only if it's missing.
    const combined = files.filter((u) => /\/PPFAS_Monthly_Portfolio_Report_/i.test(new URL(u).pathname))
    return (combined.length ? combined.slice(0, 1) : files).map((url) => ({ url }))
  },
}
