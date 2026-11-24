import type { Activity, Member } from "@/lib/api"
import { day, inr, units } from "@/lib/format"

type Props = { items: Activity[]; members: Map<string, Member>; showMember: boolean }

export function ActivityList({ items, members, showMember }: Props) {
  if (!items.length) {
    return <p className="py-6 text-sm text-muted-foreground">No purchases or redemptions in the latest statements.</p>
  }
  return (
    <ul className="divide-y">
      {items.map((a, i) => {
        const bought = a.units > 0
        return (
          <li key={`${a.member_id}-${a.isin}-${a.date}-${i}`} className="flex items-baseline gap-4 py-3 text-sm">
            <time dateTime={a.date} className="hidden w-24 shrink-0 text-muted-foreground sm:block">
              {day(a.date)}
            </time>
            <div className="min-w-0 flex-1">
              <div className="font-medium sm:truncate">{a.name}</div>
              <div className="text-xs text-muted-foreground">
                <span className="sm:hidden">{day(a.date)}</span>
                {showMember && <span className="ml-3 sm:ml-0">{members.get(a.member_id)?.name}</span>}
              </div>
            </div>
            <div className="shrink-0 text-right">
              {a.amount != null ? (
                <>
                  <div className={bought ? "text-foreground" : "text-loss"}>
                    {bought ? (a.sip ? "SIP " : "Bought ") : "Sold "}
                    {inr(Math.abs(a.amount))}
                  </div>
                  <div className="text-xs text-muted-foreground">{units(Math.abs(a.units))} units</div>
                </>
              ) : (
                <div className={bought ? "text-gain" : "text-loss"}>
                  {bought ? "+" : "−"}
                  {units(Math.abs(a.units))} units
                </div>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
