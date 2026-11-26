// AMFI and mfapi parsers (plan §10.4.4). Pure: text in, rows out. Public market data only.
//
// Both AMFI formats are semicolon separated, with category lines ("Open Ended Schemes(...)"), AMC lines and blank
// lines (sometimes a single space) between the rows, and CRLF line ends. The daily file and the history report put
// the columns in different orders, so rows are read by header name, not position.

/** A date as the YYYYMMDD integer the market DB stores (20261124). */
export type Ymd = number

export type SchemeRow = {
  amfi_code: number
  isin_growth: string | null
  isin_reinvest: string | null
  name: string
  amc: string | null
  category: string | null
  plan: string | null
  option: string | null
  /** null when AMFI shows N.A., a non-positive value, an unreadable date, or a date after `today`. */
  nav: number | null
  date: Ymd | null
}

export type NavRow = { amfi_code: number; date: Ymd; nav: number }

export type ParsedNavFile = {
  schemes: SchemeRow[]
  navs: NavRow[]
  /** NAV rows dropped by the value rules (N.A., ≤ 0, bad or future date). */
  dropped: number
}

/** A body that isn't an AMFI report (an HTML error page, an empty body, a changed header). */
export class AmfiFormatError extends Error {
  override name = 'AmfiFormatError'
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const CATEGORY = /^(Open Ended|Close Ended|Interval Fund)/i
const ISIN = /^[A-Z]{2}[0-9A-Z]{9}[0-9]$/

/** Header names (lowercased, spaces removed) → field. Both AMFI formats. */
const COLUMNS: Record<string, keyof Omit<SchemeRow, 'amc' | 'category'>> = {
  schemecode: 'amfi_code',
  'isindivpayout/isingrowth': 'isin_growth',
  isindivreinvestment: 'isin_reinvest',
  schemename: 'name',
  navname: 'name',
  plan: 'plan',
  option: 'option',
  netassetvalue: 'nav',
  date: 'date',
}
const REQUIRED = ['amfi_code', 'name', 'nav', 'date'] as const

// ─── Dates ──────────────────────────────────────────────────────────────────────────────────────────────────────

const ymdOf = (y: number, m: number, d: number): Ymd => y * 10_000 + m * 100 + d

function validYmd(y: number, m: number, d: number): boolean {
  if (y < 1990 || y > 2200 || m < 1 || m > 12 || d < 1) return false
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** "24-Nov-2026" → 20261124. Null if unreadable. */
export function parseAmfiDate(s: string): Ymd | null {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(s.trim())
  if (!m) return null
  const [d, mon, y] = [Number(m[1]), MONTHS[m[2]!.toLowerCase()], Number(m[3])]
  return mon && validYmd(y, mon, d) ? ymdOf(y, mon, d) : null
}

/** mfapi's "24-11-2026" → 20261124. Null if unreadable. */
export function parseDmyDate(s: string): Ymd | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s.trim())
  if (!m) return null
  const [d, mon, y] = [Number(m[1]), Number(m[2]), Number(m[3])]
  return validYmd(y, mon, d) ? ymdOf(y, mon, d) : null
}

/** 20261124 → "2026-11-24" (the API edge and the R2 series use ISO dates). */
export function ymdToIso(ymd: Ymd): string {
  const s = String(ymd)
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
}

/** 20261124 → "24-Nov-2026" (the history report's query format). */
export function ymdToAmfi(ymd: Ymd): string {
  const s = String(ymd)
  return `${s.slice(6, 8)}-${MONTH_NAMES[Number(s.slice(4, 6)) - 1]}-${s.slice(0, 4)}`
}

const toUtc = (ymd: Ymd) => Date.UTC(Math.floor(ymd / 10_000), (Math.floor(ymd / 100) % 100) - 1, ymd % 100)
const fromUtc = (ms: number): Ymd => {
  const d = new Date(ms)
  return ymdOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

/** `ymd` moved by `days` calendar days. */
export function addDays(ymd: Ymd, days: number): Ymd {
  return fromUtc(toUtc(ymd) + days * 86_400_000)
}

/** Whole calendar days from `a` to `b`. */
export function daysBetween(a: Ymd, b: Ymd): number {
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000)
}

/** Today's date in India (IST, UTC+5:30): NAVs are dated in IST. */
export function istToday(now = Date.now()): Ymd {
  return fromUtc(now + 330 * 60_000)
}

// ─── Values ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** "1,003.8576" → 1003.8576. Null for N.A., blanks, and zero or negative values. */
export function parseNav(s: string): number | null {
  const t = s.trim().replaceAll(',', '')
  if (!/^\d+(\.\d+)?$/.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) && n > 0 ? n : null
}

function parseIsin(s: string | undefined): string | null {
  const t = (s ?? '').trim().toUpperCase()
  return ISIN.test(t) ? t : null
}

/** "Open Ended Schemes ( Debt Scheme - Overnight Fund )" and "Open Ended Schemes(Debt …)" read the same. */
function normaliseCategory(line: string): string {
  return line.replace(/\s+/g, ' ').replace(/\s*\(\s*/, ' (').replace(/\s*\)\s*$/, ')').trim()
}

const text = (s: string | undefined, max: number) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, max) : null
}

// ─── AMFI files ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Parse AMFI's daily file (NAVAll.txt) or its NAV history report. The format is told apart by the header row.
 * `today` (IST) drops NAVs dated in the future. `onlyCode` keeps one scheme's rows (the history fallback reads a whole
 * AMC's report for one scheme).
 */
export function parseAmfiNav(body: string, today: Ymd, opts: { onlyCode?: number } = {}): ParsedNavFile {
  const lines = body.split(/\r?\n/)
  const headerAt = lines.findIndex((l) => l.trim() !== '')
  const header = (lines[headerAt] ?? '').split(';').map((h) => h.toLowerCase().replace(/\s+/g, ''))
  const index = new Map<string, number>()
  header.forEach((h, i) => {
    const field = COLUMNS[h]
    if (field && !index.has(field)) index.set(field, i)
  })
  if (REQUIRED.some((f) => !index.has(f))) throw new AmfiFormatError('header')
  const width = header.length
  const col = (fields: string[], f: string) => fields[index.get(f) ?? -1]
  const only = opts.onlyCode !== undefined ? `${opts.onlyCode};` : null

  const schemes: SchemeRow[] = []
  const navs: NavRow[] = []
  let amc: string | null = null
  let category: string | null = null
  let dropped = 0
  for (let i = headerAt + 1; i < lines.length; i++) {
    const line = lines[i]!
    const t = line.trim()
    if (!t) continue
    const fields = line.split(';')
    if (fields.length === width && /^\d+$/.test(fields[0]!.trim())) {
      if (only && !line.startsWith(only)) continue
      const code = Number(fields[0]!.trim())
      const name = text(col(fields, 'name'), 300)
      if (!Number.isSafeInteger(code) || code <= 0 || !name) continue
      let nav = parseNav(col(fields, 'nav') ?? '')
      let date = parseAmfiDate(col(fields, 'date') ?? '')
      if (nav === null || date === null || date > today) {
        dropped++
        nav = null
        date = null
      }
      schemes.push({
        amfi_code: code,
        isin_growth: parseIsin(col(fields, 'isin_growth')),
        isin_reinvest: parseIsin(col(fields, 'isin_reinvest')),
        name,
        amc,
        category,
        plan: text(col(fields, 'plan'), 80),
        option: text(col(fields, 'option'), 80),
        nav,
        date,
      })
      if (nav !== null && date !== null) navs.push({ amfi_code: code, date, nav })
    } else if (t.includes(';')) {
      continue // a row of the wrong width: skip it, don't take it for an AMC name
    } else if (CATEGORY.test(t)) {
      category = normaliseCategory(t).slice(0, 200)
      amc = null
    } else {
      amc = t.replace(/\s+/g, ' ').slice(0, 120)
    }
  }
  return { schemes, navs, dropped }
}

// ─── mfapi ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** mfapi.in `/mf/{code}` → NAV rows, oldest first. An unknown code comes back as `data: []` (status 200). */
export function parseMfapi(body: unknown, code: number, today: Ymd): NavRow[] {
  const data = (body as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) throw new AmfiFormatError('mfapi')
  const byDate = new Map<Ymd, number>()
  for (const r of data as Array<{ date?: unknown; nav?: unknown }>) {
    const date = typeof r?.date === 'string' ? parseDmyDate(r.date) : null
    const nav = typeof r?.nav === 'string' ? parseNav(r.nav) : typeof r?.nav === 'number' && r.nav > 0 ? r.nav : null
    if (date !== null && nav !== null && date <= today) byDate.set(date, nav)
  }
  return [...byDate.entries()].sort((a, b) => a[0] - b[0]).map(([date, nav]) => ({ amfi_code: code, date, nav }))
}

// ─── Anomalies (§10.4.4 "Sanity") ───────────────────────────────────────────────────────────────────────────────

export const ANOMALY_MOVE = 0.2

export type Anomaly = { amfi_code: number; date: Ymd; prev_date: Ymd; prev_nav: number; nav: number }

/** Day-on-day moves over ±20% in one scheme's rows (any order). */
export function anomalies(rows: NavRow[]): Anomaly[] {
  const sorted = [...rows].sort((a, b) => a.amfi_code - b.amfi_code || a.date - b.date)
  const out: Anomaly[] = []
  for (let i = 1; i < sorted.length; i++) {
    const [p, r] = [sorted[i - 1]!, sorted[i]!]
    if (p.amfi_code === r.amfi_code && Math.abs(r.nav / p.nav - 1) > ANOMALY_MOVE) {
      out.push({ amfi_code: r.amfi_code, date: r.date, prev_date: p.date, prev_nav: p.nav, nav: r.nav })
    }
  }
  return out
}
