// Manual assets: fixed deposits, PPF and EPF (plan §21.12, D28, M19).
//
// One pure module, imported by the Worker (validation, export) and by the SPA (through the `@manual-assets` path
// alias), so values are computed live in the browser and the logic exists in one place only. It must stay free of
// Worker and DOM imports, and compile under both tsconfigs (no enums, no parameter properties, ES2023 only).
//
// Only the inputs are stored (sealed). Every value here is approximate: we model the rules, not the bank's or
// EPFO's ledger. Everything is pre-tax (no TDS, no 80C). Dates are ISO 'YYYY-MM-DD' strings, Indian days.
import { RATES, type RateTable } from './rates'

export { RATES, type RateTable }

export type AssetType = 'fd' | 'ppf' | 'epf'
export const ASSET_TYPES: readonly AssetType[] = ['fd', 'ppf', 'epf']

export type Tenure = { years: number; months: number; days: number }
export type FdInputs = {
  amount: number
  rate: number
  start: string
  tenure: Tenure
  /** null: cumulative (interest added to the deposit, compounded quarterly). Otherwise interest is paid out. */
  payout: 'monthly' | 'quarterly' | null
  /** Closed before maturity: the date and the bank's penalty (percentage points off the rate). */
  closed: { on: string; penalty: number } | null
}
export type PpfInputs = {
  balance: number
  as_of: string
  /** The financial year the account was opened in (its start year), for the 15-year maturity. */
  opened_year: number
  /** Deposited by 5 April each year from the next 5 April after `as_of`. */
  yearly: number
  /** One financial year's deposit changed or skipped (amount 0). `fy` is the year's start (2026 = FY 2026-27). */
  overrides: { fy: number; amount: number }[]
  /** null: the government rate table. */
  rate: number | null
}
export type EpfInputs = {
  balance: number
  as_of: string
  /** Employee's + employer's monthly contribution. */
  monthly: number
  /** Contributions stopped (changed job, retired): none from this date's month on. */
  stopped: string | null
  rate: number | null
}
export type AssetInputs = FdInputs | PpfInputs | EpfInputs
export type Asset = { type: 'fd'; inputs: FdInputs } | { type: 'ppf'; inputs: PpfInputs } | { type: 'epf'; inputs: EpfInputs }

/** A cash flow from the investor's side, for XIRR: money in is negative, money out (or today's value) positive. */
export type Flow = { date: string; amount: number }

export type AssetStatus = 'active' | 'matured' | 'closed' | 'extended' | 'stopped'

export type AssetValue = {
  /** Approximate value today. */
  value: number
  /** Money put in: an FD's principal; PPF/EPF: the balance on the balance date plus deposits since. */
  invested: number
  /** FD interest paid out so far (counted in the gain, not in the value). */
  received: number
  /** value + received − invested. */
  gain: number
  /** PPF/EPF interest earned this financial year but not yet credited (it's credited on 31 March). */
  uncredited: number
  /** The rate in use today, % a year (an FD closed early: the rate after the penalty). */
  rate: number
  /** The rate comes from past the end of the government table (declared later). */
  provisional: boolean
  status: AssetStatus
  /** FD: maturity date. PPF: the end of the 15 years (it keeps earning after). EPF: null. */
  maturity: string | null
  /** FD only: the amount at maturity (cumulative), or the principal returned (payout). */
  maturity_amount: number | null
  /** FD with payouts: one interest payment. */
  payout_amount: number | null
  /** 'ppf_over_limit': a year's deposit is above ₹1.5 lakh (PPF accepts no more; a warning, not an error). */
  warnings: string[]
  /** For Overall XIRR. */
  flows: Flow[]
}

// ─── Limits (plan §21.12, §11) ──────────────────────────────────────────────────────────────────────────────────

export const MAX_ASSETS = 50
export const MAX_PPF_OVERRIDES = 60
/** ₹100 crore, in whole rupees. */
export const MAX_AMOUNT = 1_000_000_000
export const MAX_RATE = 20
export const MAX_PENALTY = 5
export const DEFAULT_PENALTY = 1
export const PPF_YEAR_LIMIT = 150_000

// ─── Dates (UTC arithmetic on calendar days) ────────────────────────────────────────────────────────────────────

const DAY = 86_400_000
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/
const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (iso: string): [number, number, number] => [Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), Number(iso.slice(8, 10))]
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`
const msOf = (iso: string) => {
  const [y, m, d] = ymd(iso)
  return Date.UTC(y, m - 1, d)
}
/** Days in month m (1–12). */
const monthDays = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const monthIndex = (iso: string) => {
  const [y, m] = ymd(iso)
  return y * 12 + m - 1
}

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !ISO_RE.test(v)) return false
  const [y, m, d] = ymd(v)
  return m >= 1 && m <= 12 && d >= 1 && d <= monthDays(y, m)
}

/** Today in India (UTC+05:30). */
export const todayIst = (now = Date.now()) => new Date(now + 330 * 60_000).toISOString().slice(0, 10)
export const addDays = (iso: string, n: number) => new Date(msOf(iso) + n * DAY).toISOString().slice(0, 10)
export const daysBetween = (from: string, to: string) => Math.round((msOf(to) - msOf(from)) / DAY)

/** Calendar months later, clamped to the month's end (31 Jan + 1 month = 28 or 29 Feb), as bank calculators do. */
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = ymd(iso)
  const idx = y * 12 + (m - 1) + n
  const ny = Math.floor(idx / 12)
  const nm = (idx % 12) + 1
  return isoOf(ny, nm, Math.min(d, monthDays(ny, nm)))
}

/** The financial year (its start year) a date falls in: 2026-03-31 → 2025, 2026-04-01 → 2026. */
export const fyOf = (iso: string) => {
  const [y, m] = ymd(iso)
  return m >= 4 ? y : y - 1
}
export const fyLabel = (fy: number) => `${fy}-${pad((fy + 1) % 100)}`

const maxIso = (a: string, b: string) => (a > b ? a : b)

// ─── FD ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The tenure chips, the way banks offer them. Anything else is Custom. */
export const TENURE_CHIPS: readonly { id: string; label: string; tenure: Tenure }[] = [
  { id: '7d', label: '7 days', tenure: { years: 0, months: 0, days: 7 } },
  { id: '1m', label: '1 month', tenure: { years: 0, months: 1, days: 0 } },
  { id: '3m', label: '3 months', tenure: { years: 0, months: 3, days: 0 } },
  { id: '6m', label: '6 months', tenure: { years: 0, months: 6, days: 0 } },
  { id: '1y', label: '1 year', tenure: { years: 1, months: 0, days: 0 } },
  { id: '2y', label: '2 years', tenure: { years: 2, months: 0, days: 0 } },
  { id: '3y', label: '3 years', tenure: { years: 3, months: 0, days: 0 } },
  { id: '5y', label: '5 years', tenure: { years: 5, months: 0, days: 0 } },
]

const sameTenure = (a: Tenure, b: Tenure) => a.years === b.years && a.months === b.months && a.days === b.days
export const tenureChip = (t: Tenure) => TENURE_CHIPS.find((c) => sameTenure(c.tenure, t))?.id ?? 'custom'

export function tenureLabel(t: Tenure): string {
  const chip = TENURE_CHIPS.find((c) => sameTenure(c.tenure, t))
  if (chip) return chip.label
  const part = (n: number, one: string) => (n ? `${n} ${one}${n === 1 ? '' : 's'}` : '')
  return [part(t.years, 'year'), part(t.months, 'month'), part(t.days, 'day')].filter(Boolean).join(' ')
}

export const fdMaturity = (start: string, t: Tenure) => addDays(addMonths(start, t.years * 12 + t.months), t.days)

/** Whole quarters from `start` to `end` (each quarter ends on the same day of the month, clamped). */
function wholeQuarters(start: string, end: string): number {
  let q = Math.max(0, Math.floor((monthIndex(end) - monthIndex(start)) / 3))
  while (q > 0 && addMonths(start, 3 * q) > end) q--
  while (addMonths(start, 3 * (q + 1)) <= end) q++
  return q
}

/**
 * A cumulative deposit's value: P·(1 + r/4)^k for the k whole quarters held, then simple interest for the days left
 * (Actual/365), which is how Indian bank calculators value a broken period. `simple`: a tenure under 6 months, which
 * earns simple interest only.
 */
export function cumulativeValue(principal: number, ratePct: number, start: string, end: string, simple: boolean): number {
  const days = daysBetween(start, end)
  if (days <= 0) return principal
  const r = ratePct / 100
  if (simple) return principal * (1 + (r * days) / 365)
  const q = wholeQuarters(start, end)
  return principal * (1 + r / 4) ** q * (1 + (r * daysBetween(addMonths(start, 3 * q), end)) / 365)
}

export function fdValue(inp: FdInputs, today: string): AssetValue {
  const P = inp.amount
  const maturity = fdMaturity(inp.start, inp.tenure)
  const simple = maturity < addMonths(inp.start, 6)
  const closed = inp.closed
  const status: AssetStatus = closed ? 'closed' : today >= maturity ? 'matured' : 'active'
  // Where the value stops: the close, the maturity (we don't guess a renewal), or today.
  const end = closed ? closed.on : status === 'matured' ? maturity : maxIso(today, inp.start)
  // Closed early: the rate after the penalty, for the time actually held. Banks use the card rate for that shorter
  // tenure, which we don't know, so this is approximate by design.
  const rate = closed ? Math.max(0, inp.rate - closed.penalty) : inp.rate
  const started = inp.start <= today
  const base = { invested: P, uncredited: 0, rate, provisional: false, status, maturity, warnings: [] as string[] }

  if (!inp.payout) {
    const heldSimple = closed ? closed.on < addMonths(inp.start, 6) : simple
    const value = cumulativeValue(P, rate, inp.start, end, heldSimple)
    return {
      ...base,
      value,
      received: 0,
      gain: value - P,
      maturity_amount: cumulativeValue(P, inp.rate, inp.start, maturity, simple),
      payout_amount: null,
      flows: started ? [{ date: inp.start, amount: -P }, { date: end, amount: value }] : [],
    }
  }

  // Payout: the interest for each whole period goes to the bank account; the deposit stays at the principal. (Banks
  // pay monthly interest at a slightly discounted rate; we don't model that.) At maturity the days after the last
  // payout are paid as simple interest.
  const step = inp.payout === 'monthly' ? 1 : 3
  const each = (P * (inp.rate / 100) * step) / 12
  const paid: Flow[] = []
  let last = inp.start
  for (let i = 1; ; i++) {
    const d = addMonths(inp.start, step * i)
    if (d > maturity || d > end) break
    paid.push({ date: d, amount: each })
    last = d
  }
  if (!closed && status === 'matured' && daysBetween(last, maturity) > 0) {
    paid.push({ date: maturity, amount: (P * (inp.rate / 100) * daysBetween(last, maturity)) / 365 })
  }
  const received = paid.reduce((s, f) => s + f.amount, 0)
  // Closed early: the bank works out simple interest at the reduced rate for the days held, and settles the
  // difference with what it already paid out (it can take some back).
  const value = closed ? P + (P * (rate / 100) * daysBetween(inp.start, closed.on)) / 365 - received : P
  return {
    ...base,
    value,
    received,
    gain: value + received - P,
    maturity_amount: P,
    payout_amount: each,
    flows: started ? [{ date: inp.start, amount: -P }, ...paid, { date: end, amount: value }] : [],
  }
}

// ─── PPF ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The PPF rate for the month starting `first` (a user's rate wins), and whether it's past the notified table. */
export function ppfRate(rates: RateTable, first: string, override: number | null): { rate: number; provisional: boolean } {
  if (override !== null) return { rate: override, provisional: false }
  let rate = rates.ppf[0]?.rate ?? 0
  for (const e of rates.ppf) if (e.from <= first) rate = e.rate
  return { rate, provisional: first > rates.ppfUntil }
}

/**
 * The deposits after the balance date, up to today. Each year's is assumed made by 5 April (it then earns for the
 * whole year), from the next 5 April after the balance date. An override for the balance date's own year adds a
 * deposit on that date, on top of the balance.
 */
export function ppfDeposits(inp: PpfInputs, today: string): (Flow & { fy: number })[] {
  const over = new Map(inp.overrides.map((o) => [o.fy, o.amount]))
  const out: (Flow & { fy: number })[] = []
  for (let fy = fyOf(inp.as_of); fy <= fyOf(today); fy++) {
    const fifth = isoOf(fy, 4, 5)
    const later = fifth > inp.as_of
    const amount = over.get(fy) ?? (later ? inp.yearly : 0)
    const date = later ? fifth : inp.as_of
    if (amount > 0 && date <= today) out.push({ fy, date, amount })
  }
  return out
}

/**
 * From the balance date, interest for each month on the lowest balance between the 5th and the month's end (a
 * deposit made by the 5th counts), at that quarter's rate / 12, credited on 31 March. A month earns once it's over,
 * and only if the balance date is on or before its 5th (we don't know the balance before that date).
 */
export function ppfValue(inp: PpfInputs, today: string, rates: RateTable = RATES): AssetValue {
  const T = maxIso(today, inp.as_of)
  const deposits = ppfDeposits(inp, T)
  let [y, m] = ymd(inp.as_of)
  let credited = 0
  let accrued = 0
  let counted = 0
  let i = 0
  let provisional = false
  while (isoOf(y, m, monthDays(y, m)) <= T) {
    const fifth = isoOf(y, m, 5)
    if (fifth >= inp.as_of) {
      for (; i < deposits.length && deposits[i]!.date <= fifth; i++) counted += deposits[i]!.amount
      const r = ppfRate(rates, isoOf(y, m, 1), inp.rate)
      provisional ||= r.provisional
      accrued += ((inp.balance + counted + credited) * r.rate) / 1200
    }
    if (m === 3) {
      credited += accrued
      accrued = 0
    }
    if (++m > 12) {
      m = 1
      y++
    }
  }
  const deposited = deposits.reduce((s, d) => s + d.amount, 0)
  const value = inp.balance + deposited + credited + accrued
  const invested = inp.balance + deposited
  const now = ppfRate(rates, `${T.slice(0, 7)}-01`, inp.rate)
  const maturity = isoOf(inp.opened_year + 16, 4, 1) // 15 whole financial years after the year of opening
  const overLimit = inp.yearly > PPF_YEAR_LIMIT || inp.overrides.some((o) => o.amount > PPF_YEAR_LIMIT)
  return {
    value,
    invested,
    received: 0,
    gain: value - invested,
    uncredited: accrued,
    rate: now.rate,
    provisional: provisional || now.provisional,
    status: T >= maturity ? 'extended' : 'active', // after the 15 years it keeps earning (the extension rules)
    maturity,
    maturity_amount: null,
    payout_amount: null,
    warnings: overLimit ? ['ppf_over_limit'] : [],
    flows: [
      ...(inp.balance > 0 ? [{ date: inp.as_of, amount: -inp.balance }] : []),
      ...deposits.map((d) => ({ date: d.date, amount: -d.amount })),
      { date: T, amount: value },
    ],
  }
}

// ─── EPF ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The EPF rate of a financial year (a user's rate wins). Past the table: the last rate, provisional. */
export function epfRate(rates: RateTable, fy: number, override: number | null): { rate: number; provisional: boolean } {
  if (override !== null) return { rate: override, provisional: false }
  const known = rates.epf[String(fy)]
  if (known !== undefined) return { rate: known, provisional: false }
  const years = Object.keys(rates.epf).map(Number).sort((a, b) => a - b)
  const first = years[0]
  const last = years.at(-1)
  if (first === undefined || last === undefined) return { rate: 0, provisional: true }
  return fy > last ? { rate: rates.epf[String(last)]!, provisional: true } : { rate: rates.epf[String(first)]!, provisional: false }
}

/**
 * From the balance date, interest each month on the month's opening balance at that financial year's rate / 12,
 * credited on 31 March. A contribution is made at the end of each month after the balance date's month and counts
 * from the month after it's made (EPFO's rule). Contributions stop from the `stopped` date's month.
 */
export function epfValue(inp: EpfInputs, today: string, rates: RateTable = RATES): AssetValue {
  const T = maxIso(today, inp.as_of)
  const stopAt = inp.stopped ? monthIndex(inp.stopped) : Infinity
  let [y, m] = ymd(inp.as_of)
  const contributions: Flow[] = []
  let contributed = 0
  let credited = 0
  let accrued = 0
  let provisional = false
  if (++m > 12) {
    m = 1
    y++
  }
  while (isoOf(y, m, monthDays(y, m)) <= T) {
    const r = epfRate(rates, m >= 4 ? y : y - 1, inp.rate)
    provisional ||= r.provisional
    accrued += ((inp.balance + contributed + credited) * r.rate) / 1200
    if (inp.monthly > 0 && y * 12 + m - 1 < stopAt) {
      contributions.push({ date: isoOf(y, m, monthDays(y, m)), amount: inp.monthly })
      contributed += inp.monthly
    }
    if (m === 3) {
      credited += accrued
      accrued = 0
    }
    if (++m > 12) {
      m = 1
      y++
    }
  }
  const value = inp.balance + contributed + credited + accrued
  const invested = inp.balance + contributed
  const now = epfRate(rates, fyOf(T), inp.rate)
  return {
    value,
    invested,
    received: 0,
    gain: value - invested,
    uncredited: accrued,
    rate: now.rate,
    provisional: provisional || now.provisional,
    status: inp.stopped && inp.stopped <= T ? 'stopped' : 'active',
    maturity: null,
    maturity_amount: null,
    payout_amount: null,
    warnings: [],
    flows: [
      ...(inp.balance > 0 ? [{ date: inp.as_of, amount: -inp.balance }] : []),
      ...contributions.map((c) => ({ date: c.date, amount: -c.amount })),
      { date: T, amount: value },
    ],
  }
}

// ─── Any asset ──────────────────────────────────────────────────────────────────────────────────────────────────

export function valueAsset(asset: Asset, today: string, rates: RateTable = RATES): AssetValue {
  if (asset.type === 'fd') return fdValue(asset.inputs, today)
  if (asset.type === 'ppf') return ppfValue(asset.inputs, today, rates)
  return epfValue(asset.inputs, today, rates)
}

/** The generated name ("FD · 1 year · 7.25%", "PPF · opened 2018"): never a typed label (D28). */
export function assetName(asset: Asset): string {
  if (asset.type === 'fd') return `FD · ${tenureLabel(asset.inputs.tenure)} · ${asset.inputs.rate}%`
  if (asset.type === 'ppf') return `PPF · opened ${asset.inputs.opened_year}`
  return 'EPF'
}

export const ASSET_CATEGORY: Record<AssetType, string> = { fd: 'Fixed deposit', ppf: 'PPF', epf: 'EPF' }

// ─── Validation (the API and the form use the same rules) ───────────────────────────────────────────────────────

export type ParseResult = { ok: true; inputs: AssetInputs } | { ok: false; field: string }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const wholeRupees = (v: unknown, min = 0): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= MAX_AMOUNT
const intIn = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi
const numIn = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi
const round2 = (v: number) => Math.round(v * 100) / 100

/**
 * The inputs for `type`, normalised (unknown keys dropped, defaults filled), or the first field that's wrong.
 * `today` (IST) bounds the dates: nothing after tomorrow, so a clock a few hours apart still passes.
 */
export function parseInputs(type: unknown, raw: unknown, today: string): ParseResult {
  if (!ASSET_TYPES.includes(type as AssetType)) return { ok: false, field: 'type' }
  if (!isRecord(raw)) return { ok: false, field: 'inputs' }
  const latest = addDays(today, 1)
  const dateOk = (v: unknown): v is string => isIsoDate(v) && v >= '1970-01-01' && v <= latest
  const bad = (field: string): ParseResult => ({ ok: false, field })
  const rateOrNull = (v: unknown) => (v === undefined || v === null ? null : numIn(v, 0, MAX_RATE) ? round2(v) : undefined)

  if (type === 'fd') {
    if (!wholeRupees(raw.amount, 1)) return bad('amount')
    if (!numIn(raw.rate, 0, MAX_RATE)) return bad('rate')
    if (!dateOk(raw.start)) return bad('start')
    const t = raw.tenure
    if (!isRecord(t) || !intIn(t.years, 0, 10) || !intIn(t.months, 0, 11) || !intIn(t.days, 0, 365)) return bad('tenure')
    const tenure = { years: t.years, months: t.months, days: t.days }
    const maturity = fdMaturity(raw.start, tenure)
    if (maturity < addDays(raw.start, 7) || maturity > addMonths(raw.start, 120)) return bad('tenure')
    const payout = raw.payout ?? null
    if (payout !== null && payout !== 'monthly' && payout !== 'quarterly') return bad('payout')
    let closed: FdInputs['closed'] = null
    if (raw.closed !== undefined && raw.closed !== null) {
      const c = raw.closed
      if (!isRecord(c) || !dateOk(c.on) || c.on < raw.start || c.on >= maturity) return bad('closed')
      const penalty = c.penalty ?? DEFAULT_PENALTY
      if (!numIn(penalty, 0, MAX_PENALTY)) return bad('closed')
      closed = { on: c.on, penalty: round2(penalty) }
    }
    return { ok: true, inputs: { amount: raw.amount, rate: round2(raw.rate), start: raw.start, tenure, payout, closed } }
  }

  if (!wholeRupees(raw.balance)) return bad('balance')
  if (!dateOk(raw.as_of)) return bad('as_of')
  const rate = rateOrNull(raw.rate)
  if (rate === undefined) return bad('rate')

  if (type === 'ppf') {
    if (!intIn(raw.opened_year, 1968, Number(today.slice(0, 4)))) return bad('opened_year')
    if (!wholeRupees(raw.yearly)) return bad('yearly')
    const list = raw.overrides ?? []
    if (!Array.isArray(list) || list.length > MAX_PPF_OVERRIDES) return bad('overrides')
    const overrides: PpfInputs['overrides'] = []
    for (const o of list) {
      if (!isRecord(o) || !intIn(o.fy, 1968, 2100) || !wholeRupees(o.amount) || overrides.some((x) => x.fy === o.fy)) return bad('overrides')
      overrides.push({ fy: o.fy, amount: o.amount })
    }
    overrides.sort((a, b) => a.fy - b.fy)
    return { ok: true, inputs: { balance: raw.balance, as_of: raw.as_of, opened_year: raw.opened_year, yearly: raw.yearly, overrides, rate } }
  }

  if (!wholeRupees(raw.monthly)) return bad('monthly')
  const stopped = raw.stopped ?? null
  if (stopped !== null && !dateOk(stopped)) return bad('stopped')
  return { ok: true, inputs: { balance: raw.balance, as_of: raw.as_of, monthly: raw.monthly, stopped, rate } }
}
