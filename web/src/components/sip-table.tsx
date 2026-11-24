import { useState } from "react"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { Member, Sip } from "@/lib/api"
import { categoryColor, day, inr } from "@/lib/format"
import { cn } from "@/lib/utils"

type Props = { sips: Sip[]; members: Map<string, Member>; showMember: boolean; missing: Member[] }

const monthYear = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" })

export function SipTable({ sips, members, showMember, missing }: Props) {
  const [showStopped, setShowStopped] = useState(false)
  const active = sips.filter((s) => s.status === "active")
  const stopped = sips.filter((s) => s.status === "stopped")
  const rows = showStopped ? [...active, ...stopped] : active

  if (!sips.length) {
    return (
      <p className="py-6 text-sm text-muted-foreground">
        {missing.length
          ? "Add a CAMS / KFintech statement to see SIPs. CDSL statements don't show which purchases are SIPs."
          : "No SIPs found in the statements."}
      </p>
    )
  }

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-full pl-0">Fund</TableHead>
            <TableHead className="px-4 text-right">Instalment</TableHead>
            <TableHead className="hidden px-4 lg:table-cell">Started</TableHead>
            <TableHead className="hidden px-4 md:table-cell">Last paid</TableHead>
            <TableHead className="hidden px-4 sm:table-cell">Next expected</TableHead>
            <TableHead className="hidden pr-0 text-right md:table-cell">Invested via SIP</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((s) => {
            const off = s.status === "stopped"
            return (
              <TableRow key={`${s.member_id}-${s.folio}-${s.isin}`} className="hover:bg-muted/50">
                <TableCell className="py-3.5 pr-6 pl-0 whitespace-normal">
                  <div className={cn("font-medium leading-snug", off && "text-muted-foreground")}>{s.name}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-2 rounded-full" style={{ background: categoryColor(s.category) }} />
                      {s.category}
                    </span>
                    {showMember && <span>{members.get(s.member_id)?.name.split(" ")[0]}</span>}
                    {s.folio && <span>Folio {s.folio}</span>}
                    {off && <span className="rounded-full bg-muted px-2 py-0.5 text-foreground/70">Stopped</span>}
                    {s.next_date && <span className="sm:hidden">Next {day(s.next_date)}</span>}
                  </div>
                </TableCell>
                <TableCell className="px-4 text-right">
                  <div className={cn("font-medium", off && "text-muted-foreground")}>{inr(s.amount)}</div>
                  <div className="text-xs text-muted-foreground capitalize">{s.frequency}</div>
                </TableCell>
                <TableCell className="hidden px-4 text-muted-foreground lg:table-cell">
                  <div>{monthYear(s.start_date)}</div>
                  <div className="text-xs">
                    {s.instalments} instalment{s.instalments === 1 ? "" : "s"}
                  </div>
                </TableCell>
                <TableCell className="hidden px-4 text-muted-foreground md:table-cell">{day(s.last_date)}</TableCell>
                <TableCell className="hidden px-4 sm:table-cell">
                  {s.next_date ? <span>{day(s.next_date)}</span> : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="hidden pr-0 text-right text-muted-foreground md:table-cell">{inr(s.invested)}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>
          {missing.length > 0 &&
            `${missing.map((m) => m.name.split(" ")[0]).join(", ")}: add a CAMS / KFintech statement to see their SIPs.`}
        </span>
        {stopped.length > 0 && (
          <button className="-my-2 py-2 text-primary hover:underline" onClick={() => setShowStopped((v) => !v)}>
            {showStopped ? "Hide stopped SIPs" : `Show ${stopped.length} stopped SIP${stopped.length === 1 ? "" : "s"}`}
          </button>
        )}
      </div>
    </div>
  )
}

/** "₹60,000 a month across 6 SIPs" */
export function sipSummary(sips: Sip[], monthlyOf: (s: Sip) => number): string | undefined {
  const active = sips.filter((s) => s.status === "active")
  if (!active.length) return undefined
  const total = active.reduce((sum, s) => sum + monthlyOf(s), 0)
  return `${inr(total)} a month across ${active.length} SIP${active.length === 1 ? "" : "s"}`
}

