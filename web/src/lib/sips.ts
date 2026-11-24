import type { Sip } from "@/lib/api"

/** Whole days from today to an ISO date (negative when it has passed). */
export function daysFrom(iso: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((new Date(`${iso}T00:00:00`).getTime() - today.getTime()) / 864e5)
}

export type Upcoming = { list: { s: Sip; n: number }[]; days: number; overdue: number }

/** The next few instalments still ahead, and the days until the last of them (the Upcoming SIPs window). */
export function upcomingSips(sips: Sip[], limit = 4): Upcoming {
  const dated = sips
    .filter((s) => s.status === "active" && s.next_date)
    .map((s) => ({ s, n: daysFrom(s.next_date!) }))
    .sort((a, b) => a.n - b.n)
  const list = dated.filter((x) => x.n >= 0).slice(0, limit)
  return { list, days: Math.max(list.at(-1)?.n ?? 0, 1), overdue: dated.filter((x) => x.n < 0).length }
}
