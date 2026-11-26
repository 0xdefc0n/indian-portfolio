import { ArrowDownIcon, RepeatIcon } from "lucide-react"
import { useState } from "react"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { DayChange, Holding, Member } from "@/lib/api"
import { categoryColor, inr, nav, pct, per, signed, units } from "@/lib/format"
import { useOpenFund } from "@/lib/fund-context"
import { cn } from "@/lib/utils"
import { holdingFlows, xirr } from "@/lib/xirr"

type Props = {
  holdings: Holding[]
  total: number
  members: Map<string, Member>
  showMember: boolean
  highlight: string | null
  /** Today's change per `${member_id}|${isin}` (plan §10.5.4 "1D"), from /api/portfolio/daily. */
  oneDay?: Map<string, DayChange & { nav_date: string }>
}

function OneDay({ d, className }: { d: (DayChange & { nav_date: string }) | undefined; className?: string }) {
  if (!d) return <span className={cn("text-muted-foreground", className)}>—</span>
  return (
    <span className={cn(d.change >= 0 ? "text-gain" : "text-loss", className)}>
      {signed(d.change, inr)}
      {d.pct != null && <span className="ml-1 text-xs">{signed(d.pct * 100, (n) => pct(n, 2))}</span>}
    </span>
  )
}

export function HoldingsTable({ holdings, total, members, showMember, highlight, oneDay }: Props) {
  const openFund = useOpenFund()
  const [by1d, setBy1d] = useState(false)
  const key = (h: Holding) => `${h.member_id}|${h.isin}`
  const rows = by1d ? [...holdings].sort((a, b) => (oneDay?.get(key(b))?.change ?? -Infinity) - (oneDay?.get(key(a))?.change ?? -Infinity)) : holdings
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-full pl-0">Fund</TableHead>
          <TableHead className="hidden px-4 text-right md:table-cell">Units</TableHead>
          <TableHead className="hidden px-4 text-right md:table-cell">NAV</TableHead>
          <TableHead className="px-4 text-right">Value</TableHead>
          {oneDay && (
            <TableHead className="hidden px-4 text-right lg:table-cell" aria-sort={by1d ? "descending" : "none"}>
              <button
                type="button"
                onClick={() => setBy1d((v) => !v)}
                className="-my-2 inline-flex items-center gap-1 py-2 hover:text-foreground"
                title={by1d ? "Sort by value" : "Sort by today's change"}
              >
                1D
                <ArrowDownIcon className={cn("size-3 transition-opacity", by1d ? "opacity-100" : "opacity-30")} />
              </button>
            </TableHead>
          )}
          <TableHead className="hidden pr-0 text-right sm:table-cell">Share</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((h) => {
          const share = total ? (h.value / total) * 100 : 0
          const dim = highlight && highlight !== h.category
          return (
            <TableRow
              key={`${h.member_id}-${h.isin}`}
              className={cn("cursor-pointer transition-opacity duration-200 hover:bg-muted/50", dim && "opacity-30")}
              onClick={() => openFund(h)}
            >
              <TableCell className="py-3.5 pr-6 pl-0 whitespace-normal">
                <FundButton>{h.name}</FundButton>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2 rounded-full" style={{ background: categoryColor(h.category) }} />
                    {h.category}
                  </span>
                  {showMember && <span>{members.get(h.member_id)?.name.split(" ")[0]}</span>}
                  {h.sip && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                      <RepeatIcon className="size-3" />
                      Active SIP: {inr(h.sip.amount)}
                      {per(h.sip.frequency)}
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell className="hidden px-4 text-right text-muted-foreground md:table-cell">{units(h.units)}</TableCell>
              <TableCell className="hidden px-4 text-right text-muted-foreground md:table-cell">{nav(h.nav)}</TableCell>
              <TableCell className="px-4 text-right">
                <div className="font-medium">{inr(h.value)}</div>
                {oneDay && <div className="text-xs lg:hidden"><OneDay d={oneDay.get(key(h))} /></div>}
                {h.invested ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div onClick={(e) => e.stopPropagation()} className={cn("cursor-help text-xs", h.value >= h.invested ? "text-gain" : "text-loss")}>
                        {signed(((h.value - h.invested) / h.invested) * 100, (n) => pct(n))}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      Invested {inr(h.invested)}, gain {signed(h.value - h.invested, inr)}
                      {(() => {
                        const r = h.cashflows ? xirr(holdingFlows([h])) : null
                        return r == null ? null : <>, XIRR {signed(r * 100, (n) => pct(n, 2))}</>
                      })()}
                    </TooltipContent>
                  </Tooltip>
                ) : null}
              </TableCell>
              {oneDay && (
                <TableCell className="hidden px-4 text-right whitespace-nowrap lg:table-cell">
                  <OneDay d={oneDay.get(key(h))} />
                </TableCell>
              )}
              <TableCell className="hidden pr-0 sm:table-cell">
                <div className="flex items-center justify-end gap-3">
                  <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.min(100, share)}%`, background: categoryColor(h.category) }}
                    />
                  </div>
                  <span className="w-12 text-right text-muted-foreground">{pct(share)}</span>
                </div>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

/** Fund name as a real button so the details dialog is reachable by keyboard; the row handles the click. */
export function FundButton({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      className={cn(
        "-my-1.5 rounded-sm py-1.5 text-left font-medium leading-snug underline-offset-4 hover:underline",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
    >
      {children}
    </button>
  )
}
