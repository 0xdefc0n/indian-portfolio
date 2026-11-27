import { useMemo, useState } from "react"

import { ActivityList } from "@/components/activity-list"
import { isBuy } from "@/lib/activity"
import type { Activity, Member } from "@/lib/api"
import { inr } from "@/lib/format"
import { cn } from "@/lib/utils"

const FILTERS = [
  { id: "all", label: "All", test: () => true },
  { id: "sip", label: "SIPs", test: (a: Activity) => a.kind === "sip" },
  { id: "purchase", label: "One-time purchases", test: (a: Activity) => a.kind === "purchase" || a.kind === "switch_in" },
  { id: "out", label: "Redemptions", test: (a: Activity) => a.kind === "redemption" || a.kind === "switch_out" },
] as const

const monthLabel = (iso: string) =>
  new Date(`${iso.slice(0, 7)}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" })

/** Full transaction history, grouped by month, with a type filter. */
export function TransactionsView({ items, members, showMember }: { items: Activity[]; members: Map<string, Member>; showMember: boolean }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all")
  // the last 12 months first; older ones on request (display only, the data is already here)
  const [months, setMonths] = useState(12)

  const groups = useMemo(() => {
    const test = FILTERS.find((f) => f.id === filter)!.test
    const out = new Map<string, Activity[]>()
    for (const a of items.filter(test)) {
      const k = a.date.slice(0, 7)
      out.set(k, [...(out.get(k) ?? []), a])
    }
    return [...out.entries()]
  }, [items, filter])

  const counts = Object.fromEntries(FILTERS.map((f) => [f.id, items.filter(f.test).length]))

  return (
    <div>
      <div
        role="radiogroup"
        aria-label="Transaction type"
        className="sticky top-[calc(68px+env(safe-area-inset-top))] z-10 -mx-2 mb-4 flex flex-wrap gap-2 rounded-2xl bg-surface/90 px-2 py-2 backdrop-blur-md"
      >
        {FILTERS.filter((f) => f.id === "all" || counts[f.id] > 0).map((f) => (
          <button
            key={f.id}
            role="radio"
            aria-checked={filter === f.id}
            onClick={() => { setFilter(f.id); setMonths(12) }}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-sm ring-1 transition-colors pointer-coarse:min-h-11",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              filter === f.id ? "bg-foreground text-background ring-foreground" : "bg-surface ring-border hover:bg-muted",
            )}
          >
            {f.label}
            <span className={cn("ml-1.5", filter === f.id ? "text-background/70" : "text-muted-foreground")}>{counts[f.id]}</span>
          </button>
        ))}
      </div>

      {!groups.length && <p className="py-6 text-sm text-muted-foreground">No transactions in the statements yet.</p>}

      <div className="space-y-6">
        {groups.slice(0, months).map(([key, rows]) => {
          const bought = rows.filter((r) => isBuy(r) && r.amount).reduce((s, r) => s + Math.abs(r.amount ?? 0), 0)
          const sold = rows.filter((r) => r.units < 0 && r.amount).reduce((s, r) => s + Math.abs(r.amount ?? 0), 0)
          return (
            <section key={key}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b pb-2">
                <h3 className="text-sm font-medium whitespace-nowrap text-muted-foreground">{monthLabel(key)}</h3>
                <p className="flex flex-wrap gap-x-4 text-sm text-muted-foreground">
                  {bought > 0 && <span className="whitespace-nowrap">Invested {inr(bought)}</span>}
                  {sold > 0 && <span className="whitespace-nowrap">Withdrawn {inr(sold)}</span>}
                </p>
              </div>
              <ActivityList items={rows} members={members} showMember={showMember} />
            </section>
          )
        })}
      </div>
      {groups.length > months && (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={() => setMonths((m) => m + 12)}
            className="inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-medium text-primary ring-1 ring-border transition-colors hover:bg-muted"
          >
            Show older · {groups.length - months} more month{groups.length - months === 1 ? "" : "s"}
          </button>
        </div>
      )}
    </div>
  )
}
