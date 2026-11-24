import { RepeatIcon } from "lucide-react"

import type { Holding, Member, Sip } from "@/lib/api"
import { categoryColor, day, inr, pct, per } from "@/lib/format"
import { useOpenFund } from "@/lib/fund-context"
import { FundButton } from "@/components/holdings-table"

/** Compact list of the largest holdings for the Overview tab. */
export function TopHoldings({ holdings, total, members, showMember, limit = 5 }: {
  holdings: Holding[]
  total: number
  members: Map<string, Member>
  showMember: boolean
  limit?: number
}) {
  const openFund = useOpenFund()
  return (
    <ul className="divide-y">
      {holdings.slice(0, limit).map((h) => (
        <li key={`${h.member_id}-${h.isin}`} onClick={() => openFund(h)} className="-mx-2 flex cursor-pointer items-center gap-4 rounded-lg px-2 py-3 text-sm hover:bg-muted/50">
          <span className="size-2.5 shrink-0 rounded-full" style={{ background: categoryColor(h.category) }} />
          <div className="min-w-0 flex-1">
            <FundButton className="block w-full truncate">{h.name}</FundButton>
            <div className="text-xs text-muted-foreground">
              {h.category}
              {showMember && <span className="ml-3">{members.get(h.member_id)?.name.split(" ")[0]}</span>}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="font-medium">{inr(h.value)}</div>
            <div className="text-xs text-muted-foreground">{pct(total ? (h.value / total) * 100 : 0)}</div>
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Next instalments of active SIPs, soonest first. */
export function UpcomingSips({ sips, members, showMember, limit = 4 }: {
  sips: Sip[]
  members: Map<string, Member>
  showMember: boolean
  limit?: number
}) {
  const next = sips
    .filter((s) => s.status === "active" && s.next_date)
    .sort((a, b) => (a.next_date ?? "").localeCompare(b.next_date ?? ""))
    .slice(0, limit)
  if (!next.length) return <p className="py-4 text-sm text-muted-foreground">No active SIPs found.</p>
  return (
    <ul className="divide-y">
      {next.map((s) => (
        <li key={`${s.member_id}-${s.folio}-${s.isin}`} className="flex items-center gap-4 py-3 text-sm">
          <RepeatIcon className="size-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{s.name}</div>
            <div className="text-xs text-muted-foreground">
              Next on {day(s.next_date)}
              {showMember && <span className="ml-3">{members.get(s.member_id)?.name.split(" ")[0]}</span>}
            </div>
          </div>
          <div className="shrink-0 text-right font-medium">
            {inr(s.amount)}
            <span className="text-xs font-normal text-muted-foreground">{per(s.frequency)}</span>
          </div>
        </li>
      ))}
    </ul>
  )
}
