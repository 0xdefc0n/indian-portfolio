import { useMemo } from "react"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { Holding } from "@/lib/api"
import { categoryColor, inr, pct, signed } from "@/lib/format"
import { cn } from "@/lib/utils"
import { holdingFlows, xirr } from "@/lib/xirr"

export type Slice = { category: string; value: number; share: number; funds: number }

type Props = {
  slices: Slice[]
  active: string | null
  onHover: (c: string | null) => void
  onSelect: (c: string | null) => void
  selected: string | null
  /** When given, hovering a segment shows the category's returns and its funds. */
  holdings?: Holding[]
}

type Detail = {
  funds: Holding[]
  invested: number
  current: number // value of the funds with full purchase history
  xirr: number | null
  known: number // funds with full purchase history
}

function details(holdings: Holding[]): Map<string, Detail> {
  const out = new Map<string, Detail>()
  for (const h of holdings) {
    const d = out.get(h.category) ?? { funds: [], invested: 0, current: 0, xirr: null, known: 0 }
    d.funds.push(h)
    if (h.invested != null && h.cashflows?.length) {
      d.invested += h.invested
      d.current += h.value
      d.known += 1
    }
    out.set(h.category, d)
  }
  for (const d of out.values()) {
    d.funds.sort((a, b) => b.value - a.value)
    const withCost = d.funds.filter((h) => h.invested != null && h.cashflows?.length)
    d.xirr = withCost.length ? xirr(holdingFlows(withCost)) : null
  }
  return out
}

function SliceCard({ slice, detail }: { slice: Slice; detail: Detail }) {
  const gain = detail.current - detail.invested
  const tone = gain >= 0 ? "text-gain" : "text-loss"
  const partial = detail.known > 0 && detail.known < detail.funds.length
  const shown = detail.funds.slice(0, 5)
  return (
    <div className="w-[340px] max-w-[calc(100vw-3rem)] text-[13px]">
      <div className="flex items-center gap-2">
        <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: categoryColor(slice.category) }} />
        <span className="min-w-0 flex-1 truncate font-semibold">{slice.category}</span>
        <span className="font-semibold tabular-nums">{pct(slice.share)}</span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
        <div>
          <dt className="eyebrow">Value</dt>
          <dd className="mt-0.5 text-sm font-semibold tabular-nums">{inr(slice.value)}</dd>
        </div>
        <div>
          <dt className="eyebrow">Invested</dt>
          <dd className="mt-0.5 text-sm font-semibold tabular-nums">{detail.known ? inr(detail.invested) : "—"}</dd>
        </div>
        <div>
          <dt className="eyebrow">Returns</dt>
          <dd className={cn("mt-0.5 text-sm font-semibold tabular-nums", detail.known && tone)}>
            {detail.known ? (
              <>
                {signed(gain, inr)}
                <span className="ml-1 text-xs font-medium">({signed((gain / detail.invested) * 100, (n) => pct(n, 1))})</span>
              </>
            ) : "—"}
          </dd>
        </div>
        <div>
          <dt className="eyebrow">XIRR</dt>
          <dd className={cn("mt-0.5 text-sm font-semibold tabular-nums", detail.xirr != null && (detail.xirr >= 0 ? "text-gain" : "text-loss"))}>
            {detail.xirr != null ? signed(detail.xirr * 100, (n) => pct(n, 2)) : "—"}
          </dd>
        </div>
      </dl>
      {(partial || !detail.known) && (
        <p className="mt-2 text-xs text-muted-foreground">
          {detail.known
            ? `Returns cover ${detail.known} of ${detail.funds.length} funds with full purchase history.`
            : "Returns need a CAMS / KFintech statement from the first investment."}
        </p>
      )}

      <div className="mt-3 border-t pt-2.5">
        <div className="eyebrow mb-1.5">{detail.funds.length} fund{detail.funds.length === 1 ? "" : "s"}</div>
        <ul className="space-y-1.5">
          {shown.map((h) => (
            <li key={`${h.member_id}-${h.isin}-${h.folio}`} className="flex items-baseline gap-3">
              <span className="min-w-0 flex-1 truncate">{h.name}</span>
              <span className="shrink-0 tabular-nums">{inr(h.value)}</span>
              {h.invested != null && h.cashflows?.length ? (
                <span className={cn("w-14 shrink-0 text-right text-xs tabular-nums", h.value >= h.invested ? "text-gain" : "text-loss")}>
                  {signed(((h.value - h.invested) / h.invested) * 100, (n) => pct(n, 1))}
                </span>
              ) : (
                <span className="w-14 shrink-0 text-right text-xs text-muted-foreground">—</span>
              )}
            </li>
          ))}
        </ul>
        {detail.funds.length > shown.length && (
          <p className="mt-1.5 text-xs text-muted-foreground">+{detail.funds.length - shown.length} more</p>
        )}
      </div>
      <p className="mt-2.5 text-xs text-muted-foreground">Click to show only these funds</p>
    </div>
  )
}

/** One bar, one segment per fund category, width ∝ value. Hover/click links to the holdings table. */
export function AllocationStrip({ slices, active, onHover, onSelect, selected, holdings }: Props) {
  const focus = active ?? selected
  const byCat = useMemo(() => (holdings ? details(holdings) : null), [holdings])
  return (
    <div>
      <div className="flex h-11 w-full gap-[3px]" role="list" aria-label="Allocation by category">
        {slices.map((s) => {
          const detail = byCat?.get(s.category)
          const segment = (
            <button
              type="button"
              role="listitem"
              aria-label={`${s.category}: ${pct(s.share)} (${inr(s.value)})`}
              aria-pressed={selected === s.category}
              onMouseEnter={() => onHover(s.category)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(s.category)}
              onBlur={() => onHover(null)}
              onClick={() => onSelect(selected === s.category ? null : s.category)}
              className={cn(
                // v2: a slim 12 px bar inside a 44 px tap area; the legend carries the percentages
                "group/seg flex min-w-[6px] items-center rounded-md transition-opacity duration-300",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                focus && focus !== s.category && "opacity-25",
              )}
              style={{ flexGrow: s.value, flexBasis: 0 }}
            >
              <span className="h-3 w-full rounded-[3px] group-first/seg:rounded-l-full group-last/seg:rounded-r-full" style={{ background: categoryColor(s.category) }} />
            </button>
          )
          if (!detail) return <span key={s.category} className="contents">{segment}</span>
          return (
            <Tooltip key={s.category} delayDuration={80}>
              <TooltipTrigger asChild>{segment}</TooltipTrigger>
              <TooltipContent
                side="bottom"
                sideOffset={8}
                collisionPadding={12}
                className="block max-w-none rounded-2xl bg-popover p-4 text-popover-foreground shadow-[0_18px_40px_-12px_var(--shadow)] ring-1 ring-border"
                arrowClassName="bg-popover fill-popover"
              >
                <SliceCard slice={s} detail={detail} />
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>

      <ul className="mt-1 flex flex-wrap gap-x-6 gap-y-0.5 text-sm">
        {slices.map((s) => (
          <li key={s.category}>
            <button
              type="button"
              onMouseEnter={() => onHover(s.category)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onSelect(selected === s.category ? null : s.category)}
              className={cn(
                "flex min-h-8 items-center gap-2 rounded-md transition-opacity pointer-coarse:min-h-11",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                focus && focus !== s.category && "opacity-40",
              )}
            >
              <span className="size-2.5 rounded-full" style={{ background: categoryColor(s.category) }} />
              <span>{s.category}</span>
              <span className="text-muted-foreground">{pct(s.share)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
