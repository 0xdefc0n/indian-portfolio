import { RepeatIcon } from "lucide-react"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { Holding, Member } from "@/lib/api"
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
}

export function HoldingsTable({ holdings, total, members, showMember, highlight }: Props) {
  const openFund = useOpenFund()
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-full pl-0">Fund</TableHead>
          <TableHead className="hidden px-4 text-right md:table-cell">Units</TableHead>
          <TableHead className="hidden px-4 text-right md:table-cell">NAV</TableHead>
          <TableHead className="px-4 text-right">Value</TableHead>
          <TableHead className="hidden pr-0 text-right sm:table-cell">Share</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {holdings.map((h) => {
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
        "rounded-sm text-left font-medium leading-snug underline-offset-4 hover:underline",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
    >
      {children}
    </button>
  )
}
