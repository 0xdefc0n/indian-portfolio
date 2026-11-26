import { useState } from "react"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { Member, Sip } from "@/lib/api"
import { categoryColor, day, inr } from "@/lib/format"
import { SipActions } from "@/components/sip-actions"
import { inProgress, movedNote, nextRun, upcomingSkip } from "@/lib/sips"
import { cn } from "@/lib/utils"

type Props = { sips: Sip[]; members: Map<string, Member>; showMember: boolean; missing: Member[]; onChanged?: () => void }

const monthYear = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" })

export function SipTable({ sips, members, showMember, missing, onChanged }: Props) {
  const [showStopped, setShowStopped] = useState(false)
  const active = sips.filter((s) => s.status === "active")
  const stopped = sips.filter((s) => s.status !== "active") // stopped (from the statement) or cancelled (by the user)
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
            <TableHead className="hidden px-4 sm:table-cell">Next</TableHead>
            <TableHead className="hidden pr-0 text-right md:table-cell">Invested via SIP</TableHead>
            {onChanged && <TableHead className="w-11 pr-0"><span className="sr-only">Change</span></TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((s) => {
            const off = s.status !== "active"
            const skip = upcomingSkip(s)
            const run = nextRun(s)
            const running = inProgress(s)
            const moved = run ? movedNote(run.moved, run.due, day) : null
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
                    {s.status === "stopped" && <span className="rounded-full bg-muted px-2 py-0.5 text-foreground/70">Stopped</span>}
                    {s.status === "cancelled" && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-foreground/70">Cancelled{s.cancelled_on ? ` ${day(s.cancelled_on)}` : ""}</span>
                    )}
                    {skip && <span className="rounded-full bg-muted px-2 py-0.5 text-foreground/70">Skipping {day(skip)}</span>}
                    {running && <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">In progress</span>}
                    {run && <span className="sm:hidden">Next {day(run.date)}</span>}
                  </div>
                  {running && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {inr(running.amount)} debited {day(running.date)} (estimated), units usually by {day(running.units_by)}
                      {running.moved && <>. {movedNote(running.moved, running.due, day)}</>}
                    </div>
                  )}
                  {moved && <div className="mt-1 text-xs text-muted-foreground sm:hidden">{moved}</div>}
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
                <TableCell className="hidden px-4 text-muted-foreground md:table-cell">
                  <div>{day(s.latest?.date ?? s.last_date)}</div>
                  {s.latest && <div className="text-xs">{s.latest.status === "in_progress" && running ? "In progress" : "Estimated"}</div>}
                </TableCell>
                <TableCell className="hidden px-4 sm:table-cell">
                  {run ? <span>{day(run.date)}</span> : <span className="text-muted-foreground">—</span>}
                  {moved && <div className="text-xs text-muted-foreground">{moved}</div>}
                </TableCell>
                <TableCell className="hidden pr-0 text-right text-muted-foreground md:table-cell">{inr(s.invested)}</TableCell>
                {onChanged && (
                  <TableCell className="pr-0 text-right">
                    <SipActions sip={s} onChanged={onChanged} />
                  </TableCell>
                )}
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
            {showStopped ? "Hide stopped SIPs" : `Show ${stopped.length} stopped or cancelled SIP${stopped.length === 1 ? "" : "s"}`}
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

