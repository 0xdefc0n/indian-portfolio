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
      <div role="radiogroup" aria-label="Transaction type" className="mb-6 flex flex-wrap gap-2">
        {FILTERS.filter((f) => f.id === "all" || counts[f.id] > 0).map((f) => (
          <button
            key={f.id}
            role="radio"
            aria-checked={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-sm ring-1 transition-colors",
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

      <div className="space-y-8">
        {groups.map(([key, rows]) => {
          const bought = rows.filter((r) => isBuy(r) && r.amount).reduce((s, r) => s + Math.abs(r.amount ?? 0), 0)
          const sold = rows.filter((r) => r.units < 0 && r.amount).reduce((s, r) => s + Math.abs(r.amount ?? 0), 0)
          return (
            <section key={key}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b pb-2">
                <h3 className="font-semibold whitespace-nowrap">{monthLabel(key)}</h3>
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
    </div>
  )
}
