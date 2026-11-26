// Daily returns (plan §10.5.2, M12): a pure function over the snapshot's units timelines and daily NAVs.
//
// For each holding h and each market day d, with p the previous market day:
//   change_h(d) = units_h(d⁻) × (nav_h(d) − nav_h(p))     units_h(d⁻): after transactions dated before d
//   value_h(d)  = units_h(d) × nav_h(d)
// so units bought or sold on d never count as a gain or loss. Day % = Σ change / Σ units_h(d⁻) × nav_h(p), over the
// holdings with a NAV on d.
//
// Market days come from the household's own funds: a date counts when more than half of the funds alive then have a
// NAV for it. Weekends and holidays (only liquid and overnight funds publish) give no point; their moves roll into the
// next market day, because nav_h(p) is the last NAV on or before p. The latest market date always counts, with
// coverage = funds updated so far out of all funds.
//
// The snapshot's timelines already include the estimated SIP instalments after the statement (M12, engine
// projection.py), so a household that hasn't uploaded since its last SIP date still gets a full picture.
//
// IDCW: a payout the statement shows in (p, d] is added back to that day. A day-on-day move the NAV store flagged
// (nav_anomaly, ±20%) with no payout to explain it is left out of the day and flagged.
//
// Privacy (§0.1): this runs on the user's own data for the user; nothing here logs.

export type UnitsPoint = [string, number]

export type DailyHolding = {
  member_id: string
  isin: string
  amfi_code: string | null
  units_timeline: UnitsPoint[] | null
  units_exact?: boolean
  payouts?: [string, number][] | null
  statement?: { as_of: string } | null
  estimated?: { instalments: number; amount: number } | null
}

export type NavSeries = { dates: string[]; navs: number[] }

export type DailyPoint = { date: string; value: number; change: number; pct: number | null; flag: string | null }
export type DayChange = { change: number; pct: number | null }

export type FundChange = DayChange & { member_id: string; isin: string; nav_date: string }

export type DailyResult = {
  as_of: string | null
  coverage: { updated: number; total: number }
  today: (DayChange & { by_member: (DayChange & { member_id: string })[]; by_fund: FundChange[] }) | null
  series: DailyPoint[]
  notes: { units_as_of: string | null; units_exact: boolean; estimated: { instalments: number; amount: number }; excluded: number }
}

export type DailyInput = {
  holdings: DailyHolding[]
  navs: Map<string, NavSeries>
  /** `${amfi_code}|${iso date}` of flagged NAV moves (nav_anomaly). */
  anomalies?: Set<string>
  /** The latest full market day (market status). Dates after it are ignored. */
  latest: string | null
  /** Calendar days of history before `as_of`. */
  days: number
}

/** A NAV older than this isn't used as the day's base or value. */
export const MAX_STALE_DAYS = 10
/** Extra days read before the window, so its first market day has a previous one. */
export const LEAD_DAYS = 15

const DAY_MS = 86_400_000
export const addDaysIso = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS)
const round = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp

/** Index of the last element ≤ key (−1 if none). */
function lastLe(arr: readonly string[], key: string): number {
  let lo = 0
  let hi = arr.length - 1
  let out = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid]! <= key) {
      out = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return out
}

function navOn(s: NavSeries, d: string): number | undefined {
  const i = lastLe(s.dates, d)
  return i >= 0 && s.dates[i] === d ? s.navs[i] : undefined
}

function navOnOrBefore(s: NavSeries, d: string): number | undefined {
  const i = lastLe(s.dates, d)
  return i >= 0 && daysBetween(s.dates[i]!, d) <= MAX_STALE_DAYS ? s.navs[i] : undefined
}

/** Units at the end of `d` (before the first point: the first point's units). `dates`: the timeline's dates. */
export function unitsAt(tl: UnitsPoint[], d: string, dates: readonly string[] = tl.map((p) => p[0])): number {
  if (!tl.length) return 0
  return tl[Math.max(lastLe(dates, d), 0)]![1]
}

/** Units at the start of `d`: after everything dated before it. */
export function unitsBefore(tl: UnitsPoint[], d: string, dates?: readonly string[]): number {
  return unitsAt(tl, addDaysIso(d, -1), dates)
}

type Live = DailyHolding & { amfi_code: string; units_timeline: UnitsPoint[]; series: NavSeries; dates: string[] }

/** The daily series, today's change and the notes for the holdings given (already filtered to a member). */
export function dailySeries(input: DailyInput): DailyResult {
  const live: Live[] = []
  let excluded = 0
  for (const h of input.holdings) {
    const series = h.amfi_code ? input.navs.get(h.amfi_code) : undefined
    if (!h.amfi_code || !h.units_timeline?.length || !series?.dates.length) {
      excluded++
      continue
    }
    live.push({ ...h, amfi_code: h.amfi_code, units_timeline: h.units_timeline, series, dates: h.units_timeline.map((p) => p[0]) })
  }
  const notes: DailyResult['notes'] = {
    units_as_of: live.map((h) => h.statement?.as_of ?? h.units_timeline.at(-1)![0]).sort().at(-1) ?? null,
    units_exact: live.length > 0 && live.every((h) => h.units_exact === true),
    estimated: {
      instalments: live.reduce((s, h) => s + (h.estimated?.instalments ?? 0), 0),
      amount: round(live.reduce((s, h) => s + (h.estimated?.amount ?? 0), 0), 2),
    },
    excluded,
  }
  const codes = [...new Set(live.map((h) => h.amfi_code))]
  const empty: DailyResult = { as_of: null, coverage: { updated: 0, total: codes.length }, today: null, series: [], notes }
  if (!live.length) return empty

  const latest = input.latest ?? codes.map((c) => input.navs.get(c)!.dates.at(-1)!).sort().at(-1)!
  const start = addDaysIso(latest, -(input.days + LEAD_DAYS))

  // Market days: more than half the funds alive on the date have a NAV for it; the latest date counts if any has.
  const counts = new Map<string, number>()
  for (const c of codes) {
    const s = input.navs.get(c)!
    for (let i = Math.max(lastLe(s.dates, start), 0); i < s.dates.length; i++) {
      const d = s.dates[i]!
      if (d > start && d <= latest) counts.set(d, (counts.get(d) ?? 0) + 1)
    }
  }
  const alive = (d: string) => codes.filter((c) => {
    const s = input.navs.get(c)!
    return s.dates[0]! <= d && s.dates.at(-1)! >= d
  }).length
  const points = [...counts.keys()].sort().filter((d) => (d === latest ? counts.get(d)! >= 1 : counts.get(d)! * 2 > alive(d)))
  if (!points.length) return empty

  const anomalies = input.anomalies ?? new Set<string>()
  const series: DailyPoint[] = []
  type Day = { change: number; base: number; byMember: Map<string, { change: number; base: number }>; byFund: FundChange[]; updated: Set<string> }
  let last: Day | null = null
  for (let k = 0; k < points.length; k++) {
    const d = points[k]!
    const p = k > 0 ? points[k - 1]! : addDaysIso(d, -1)
    const day: Day = { change: 0, base: 0, byMember: new Map(), byFund: [], updated: new Set() }
    let value = 0
    let flag: string | null = null
    for (const h of live) {
      const atEnd = unitsAt(h.units_timeline, d, h.dates)
      const navNow = navOnOrBefore(h.series, d)
      if (navNow !== undefined) value += atEnd * navNow
      const nd = navOn(h.series, d)
      if (nd === undefined) continue // not published for d: its move rolls into its next market day
      day.updated.add(h.amfi_code)
      const np = navOnOrBefore(h.series, p)
      const u = unitsBefore(h.units_timeline, d, h.dates)
      if (np === undefined || u <= 0) continue
      const paid = (h.payouts ?? []).filter(([t]) => t > p && t <= d).reduce((s, [, a]) => s + a, 0)
      if (!paid && anomalies.has(`${h.amfi_code}|${d}`)) {
        flag = 'nav_jump'
        continue
      }
      const change = u * (nd - np) + paid
      const base = u * np
      day.change += change
      day.base += base
      const m = day.byMember.get(h.member_id) ?? { change: 0, base: 0 }
      m.change += change
      m.base += base
      day.byMember.set(h.member_id, m)
      day.byFund.push({ member_id: h.member_id, isin: h.isin, change: round(change, 2), pct: base > 0 ? round(change / base, 6) : null, nav_date: d })
    }
    // The first market day read has no real previous day: it's only the base for the next one.
    if (k > 0 && d >= addDaysIso(latest, -input.days)) {
      series.push({ date: d, value: round(value, 2), change: round(day.change, 2), pct: day.base > 0 ? round(day.change / day.base, 6) : null, flag })
    }
    last = day
  }

  const asOf = points.at(-1)!
  return {
    as_of: asOf,
    coverage: { updated: last!.updated.size, total: codes.length },
    today: {
      change: round(last!.change, 2),
      pct: last!.base > 0 ? round(last!.change / last!.base, 6) : null,
      by_member: [...last!.byMember.entries()].map(([member_id, m]) => ({ member_id, change: round(m.change, 2), pct: m.base > 0 ? round(m.change / m.base, 6) : null })),
      by_fund: last!.byFund,
    },
    series,
    notes,
  }
}

/** The last `days` calendar days of a full result (the cache keeps 366). */
export function sliceDays(r: DailyResult, days: number): DailyResult {
  if (!r.as_of) return r
  const from = addDaysIso(r.as_of, -days)
  return { ...r, series: r.series.filter((p) => p.date >= from) }
}
