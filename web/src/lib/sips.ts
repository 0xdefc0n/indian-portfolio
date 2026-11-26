import type { Moved, Sip } from "@/lib/api"

const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
const todayIso = () => isoOf(new Date())

/** Whole days from today to an ISO date (negative when it has passed). */
export function daysFrom(iso: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((new Date(`${iso}T00:00:00`).getTime() - today.getTime()) / 864e5)
}

/** A weekend date moves to Monday, as the broker would run it. (Holidays come from the server's calendar.) */
function weekdayOf(d: Date): { date: Date; moved: Moved } {
  const out = new Date(d)
  let moved: Moved = null
  while (out.getDay() === 0 || out.getDay() === 6) {
    out.setDate(out.getDate() + 1)
    moved = "weekend"
  }
  return { date: out, moved }
}

/**
 * The next run of an active SIP from today. The snapshot's `next_date` is right on the day it was built; if that day
 * has passed (the dashboard hasn't been rebuilt since), step on by the SIP's schedule instead of asking for a new
 * statement.
 */
export function nextRun(s: Sip, today = todayIso()): { date: string; due: string; moved: Moved } | null {
  if (s.status !== "active" || !s.next_date) return null
  if (s.next_date >= today) return { date: s.next_date, due: s.next_due ?? s.next_date, moved: s.next_moved ?? null }
  const months = s.frequency === "monthly" ? 1 : s.frequency === "quarterly" ? 3 : 0
  const stepDays = s.frequency === "weekly" ? 7 : s.frequency === "fortnightly" ? 14 : 0
  if (!months && !stepDays) return null
  const due = new Date(`${s.next_due ?? s.next_date}T00:00:00`)
  // Snapshots from before M12 have no sip_day and a drifted next_date (last + 30 days): the last instalment's day of
  // the month is the better guess until the rebuild brings the real one.
  const day = s.sip_day ?? new Date(`${s.last_date}T00:00:00`).getDate()
  for (let i = 0; i < 400; i++) {
    if (months) {
      const y = due.getFullYear()
      const m = due.getMonth() + months
      const last = new Date(y, m + 1, 0).getDate()
      due.setFullYear(y, m, Math.min(day, last))
    } else due.setDate(due.getDate() + stepDays)
    if (s.skipped?.includes(isoOf(due))) continue
    const run = weekdayOf(due)
    if (isoOf(run.date) >= today) return { date: isoOf(run.date), due: isoOf(due), moved: run.moved }
  }
  return null
}

/** The latest instalment if it's still being processed today (debited, units not shown yet). */
export function inProgress(s: Sip, today = todayIso()) {
  const l = s.latest
  return l && l.status === "in_progress" && l.units_by >= today ? l : null
}

export type UpcomingItem = { s: Sip; n: number; date: string; due: string; moved: Moved }
export type Upcoming = { list: UpcomingItem[]; days: number; running: Sip[] }

/** The next few instalments still ahead, and the days until the last of them (the Upcoming SIPs window). */
export function upcomingSips(sips: Sip[], limit = 4): Upcoming {
  const list = sips
    .map((s) => ({ s, run: nextRun(s) }))
    .filter((x): x is { s: Sip; run: NonNullable<ReturnType<typeof nextRun>> } => !!x.run)
    .map(({ s, run }) => ({ s, n: daysFrom(run.date), ...run }))
    .sort((a, b) => a.n - b.n)
    .slice(0, limit)
  return { list, days: Math.max(list.at(-1)?.n ?? 0, 1), running: sips.filter((s) => inProgress(s)) }
}

const MOVED_LABEL: Record<string, string> = { weekend: "weekend", holiday: "market holiday" }
/** The upcoming instalment the user skipped, if any. */
export const upcomingSkip = (s: Sip, today = todayIso()) => s.skipped?.filter((d) => d >= today).sort()[0] ?? null

/** "Moved from 24 Nov (market holiday)" */
export const movedNote = (moved: Moved, due: string, fmt: (iso: string) => string) =>
  moved ? `Moved from ${fmt(due)} (${MOVED_LABEL[moved] ?? moved})` : null
