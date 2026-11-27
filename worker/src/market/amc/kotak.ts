// Kotak Mahindra Mutual Fund. ⚠️ VERIFY findings (checked 2026-11-27):
// ✅ Page: https://www.kotakmf.com/Information/portfolios is an Angular app (chunk 194.js). It picks a scheme, then a
//    year, month and period through `folderlist?scheme=<CODE>/<yyyy>/<Month>/<period>` and downloads with
//    `downloadfile?path=<CODE>/<yyyy>/<Month>/Consolidated&filename=<file>`, both under the bundle's `kotakapi` API
//    host https://java17vlbapi.kotakmf.com/kotakapi/portfolio/ (the download link is that absolute URL in the page's
//    own code). `folderlist?scheme=` with no scheme lists every scheme folder (~240 codes such as SEF, K30, EME, LIQ,
//    plus `Factsheet`, `files`, `Thumbs`). The month's monthly file is `<CODE>/<yyyy>/<Month>/Consolidated/<CODE>.xlsx`
//    (debt schemes also have `01 to 15` / `16 to 31` fortnightly folders, skipped). A month that isn't up answers
//    400 "Error occured while fetching folder list". No combined all-schemes workbook: one file per scheme (~150 for
//    October 2026), so a run is ~240 listing requests plus the downloads, at 1/s. Standard SEBI layout per sheet.
// ⚠️ Flaky or throttled API: for minutes at a time (seen 5 times in ~90 min on 2026-11-27, each after ~100–250 of
//    our paced requests; curl from a fresh connection often still got 200) every call answers 400 — listings with
//    the "missing folder" JSON, downloads with an empty body — then recovers. discover() re-checks the scheme list
//    and throws instead of returning a short list; downloads that hit such a window fail (the fetcher has no retry).
// ⚠️ Bot protection: www.kotakmf.com is behind Radware Bot Manager (server `rdwr`, `__uzm*` cookies). The first page
//    load answered 200, but the `/api/kotakapi/...` proxy and later pages answered 302 to validate.perfdrive.com (a
//    challenge). The API host java17vlbapi.kotakmf.com answered plain 200 JSON / xlsx with no challenge and has no
//    robots.txt (404, so everything allowed). This adapter only uses that host — the one the page itself downloads
//    from — but its listing calls go around the www proxy the browser uses; the owner decides if that is acceptable.
// ⚠️ Terms: the kotakmf.com terms page (/documents/TermsConditions) is behind the same bot wall and could not be read.
//    Kotak group sites (e.g. the Kotak Bank website disclaimer) restrict downloads to "noncommercial, personal use"
//    and need written permission for "public or commercial purposes"; assume the same until checked by hand.
import { AmcHttpError } from './fetcher'
import { type AmcAdapter, type AmcFile, monthParts } from './types'

const API = 'https://java17vlbapi.kotakmf.com/kotakapi/portfolio/'
const NOT_SCHEMES = new Set(['factsheet', 'files', 'thumbs'])
const BELLWETHERS = ['SEF', 'K30', 'EME', 'MID'] // big equity schemes: if none has the month, it isn't up yet

type FolderList = { status?: string; dataList?: string[] }

/** The folder's entries, or null when it doesn't exist (the API answers 400). */
async function folder(http: Parameters<AmcAdapter['discover']>[1], path: string): Promise<string[] | null> {
  try {
    const res = await http.json<FolderList>(`${API}folderlist?scheme=${path}`)
    if (res.status !== 'Success' || !Array.isArray(res.dataList)) return null
    return res.dataList
  } catch (e) {
    if (e instanceof AmcHttpError && e.status === 400) return null
    throw e
  }
}

export const kotak: AmcAdapter = {
  slug: 'kotak',
  amfi: ['kotak mahindra mutual fund'],
  hosts: ['java17vlbapi.kotakmf.com'],
  // The owner decides (see VERIFY above): www is behind a bot wall, the terms couldn't be read, and the API host
  // starts answering 400 after ~100–200 paced requests, which a ~240-request listing can't avoid.
  blocked: 'www.kotakmf.com is behind Radware Bot Manager (challenge redirects); the API host is unprotected but throttles/flaps under a full listing',
  async discover(month, http) {
    const { y, name } = monthParts(month)
    const root = await folder(http, '')
    if (!root?.length) throw new Error('kotak: scheme folder list is empty')
    const codes = [...new Set(root.filter((c) => /^[A-Za-z0-9_]+$/.test(c) && !NOT_SCHEMES.has(c.toLowerCase())))]

    // The API flaps: for minutes at a time every call answers the same 400 "Error occured while fetching folder
    // list" that a missing folder gets. So a miss is only trusted while the scheme list still answers; otherwise the
    // run throws (recorded `failed`) rather than return a short list or a false "not published yet".
    const healthy = async () => {
      if (!(await folder(http, ''))?.length) throw new Error('kotak: portfolio API is answering errors, try later')
    }

    const files: AmcFile[] = []
    const done = new Set<string>()
    let misses = 0
    const look = async (code: string): Promise<boolean> => {
      done.add(code)
      const dir = `${code}/${y}/${name}/Consolidated`
      const list = await folder(http, dir)
      const xls = (list ?? []).filter((f) => /^[\w .()-]+\.xlsx?$/i.test(f))
      for (const f of xls) {
        const url = `${API}downloadfile?path=${encodeURI(dir)}&filename=${encodeURIComponent(f)}`
        files.push({ url, name: f.toUpperCase().startsWith(code.toUpperCase()) ? f : `${code}_${f}` })
      }
      misses = xls.length ? 0 : misses + 1
      if (misses >= 10) {
        await healthy() // a long run of misses: matured FMPs, or the API went bad
        misses = 0
      }
      return xls.length > 0
    }

    // Not published yet: the big schemes don't have the month. Saves ~240 requests on every early check.
    const bell = BELLWETHERS.filter((c) => codes.includes(c))
    if (bell.length) {
      let any = false
      for (const c of bell) if (await look(c)) { any = true; break }
      if (!any) {
        await healthy()
        return []
      }
    }
    for (const c of codes) if (!done.has(c)) await look(c)
    await healthy()
    return files
  },
}
