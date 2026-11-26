// NAV store check on staging (M9 "Done when"), after at least one night of nav-ingest runs:
//   node scripts/nav-check.ts
// Read-only queries on pocketfolio-market-staging through the Cloudflare D1 API. Checks that the latest full NAV day
// is final and every tracked scheme has a NAV for it, that every tracked scheme is backfilled, and that the night's
// later runs inserted only what was new. Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in .dev.vars.
// Privacy (§0.1): prints ok/FAIL lines, dates and counts only. Never a scheme code: the tracked set is what users hold.
import { devVar } from '../test/helpers/private-pdfs.ts'

const MARKET_DB = '5468bd02-7c1e-457c-ad4f-7f639a07b337' // pocketfolio-market-staging (wrangler.jsonc)
const token = devVar('CLOUDFLARE_API_TOKEN')
const account = devVar('CLOUDFLARE_ACCOUNT_ID')
if (!token || !account) throw new Error('CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID missing from .dev.vars')

let failed = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
  if (!ok) failed++
}

async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${MARKET_DB}/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  })
  const body = (await res.json()) as { success: boolean; result?: { results: T[] }[]; errors?: { code: number }[] }
  if (!body.success) throw new Error(`D1 query failed (${body.errors?.map((e) => e.code).join(',')})`)
  return body.result?.[0]?.results ?? []
}

const TRACKED = `SELECT amfi_code AS code FROM tracked_scheme WHERE amfi_code IS NOT NULL AND last_seen_at >= ?1 UNION SELECT 120716`
const since = Date.now() - 90 * 86_400_000
const iso = (d: number) => `${String(d).slice(0, 4)}-${String(d).slice(4, 6)}-${String(d).slice(6, 8)}`
const minus14 = (d: number) => {
  const t = new Date(Date.UTC(Math.floor(d / 10_000), (Math.floor(d / 100) % 100) - 1, d % 100) - 14 * 86_400_000)
  return t.getUTCFullYear() * 10_000 + (t.getUTCMonth() + 1) * 100 + t.getUTCDate()
}

// 1. Runs
const runs = await query<{ at: number; ok: number; parsed: number; inserted: number; error_class: string | null }>(
  "SELECT at, ok, parsed, inserted, error_class FROM nav_run WHERE job = 'nav-ingest' AND at >= ?1 ORDER BY at",
  [Date.now() - 26 * 3_600_000],
)
console.log(`nav-ingest runs in the last 26 h: ${runs.map((r) => (r.ok ? `ok ${r.inserted}/${r.parsed}` : `failed ${r.error_class}`)).join(', ') || 'none'}`)
check('at least one nav-ingest run succeeded in the last 26 h', runs.some((r) => r.ok === 1))
check('no two failed runs in a row', !runs.some((r, i) => i > 0 && r.ok === 0 && runs[i - 1]!.ok === 0))
const okRuns = runs.filter((r) => r.ok === 1)
check(
  'later runs of the night insert only new rows',
  okRuns.slice(1).every((r) => r.inserted < r.parsed / 2),
  okRuns.length > 1 ? `${okRuns.slice(1).map((r) => r.inserted).join(', ')} rows after the first run` : 'only one run so far',
)

// 2. Latest full NAV day: final, and every live tracked scheme has a NAV for it.
const days = await query<{ date: number; schemes_updated: number; tracked_total: number; tracked_updated: number; final: number }>(
  'SELECT date, schemes_updated, tracked_total, tracked_updated, final FROM market_day ORDER BY date DESC LIMIT 10',
)
const max = days.reduce((m, d) => Math.max(m, d.schemes_updated), 0)
const latest = days.find((d) => d.schemes_updated * 2 >= max && d.final === 1)
check('a final full NAV day exists', !!latest, latest ? `${iso(latest.date)}, ${latest.schemes_updated} schemes` : '')
if (latest) {
  const [gap] = await query<{ total: number; missing: number }>(
    `WITH t AS (${TRACKED}), live AS (SELECT t.code FROM t JOIN scheme s ON s.amfi_code = t.code WHERE s.latest_date >= ?2)
     SELECT COUNT(*) AS total, SUM(NOT EXISTS (SELECT 1 FROM nav n WHERE n.amfi_code = live.code AND n.date = ?3)) AS missing FROM live`,
    [since, minus14(latest.date), latest.date],
  )
  check(`every tracked scheme has the ${iso(latest.date)} NAV`, (gap?.missing ?? 0) === 0, `${gap?.total ?? 0} tracked, ${gap?.missing ?? 0} missing`)
}

// 3. Backfills
const [bf] = await query<{ tracked: number; done: number; pending: number; failed: number; none: number }>(
  `WITH t AS (${TRACKED}) SELECT COUNT(*) AS tracked, SUM(b.status = 'done') AS done, SUM(b.status = 'pending') AS pending,
     SUM(b.status = 'failed') AS failed, SUM(b.status IS NULL) AS none FROM t LEFT JOIN nav_backfill b ON b.amfi_code = t.code`,
  [since],
)
check('every tracked scheme is backfilled', (bf?.done ?? 0) === (bf?.tracked ?? -1), `${bf?.done}/${bf?.tracked} done, ${bf?.pending} pending, ${bf?.failed} failed, ${bf?.none} not started`)

console.log(failed ? `${failed} check(s) failed` : 'all checks passed')
process.exit(failed ? 1 : 0)
