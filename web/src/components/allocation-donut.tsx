// The allocation donut by category (restored in the unslop pass, now on Insights beside the asset-class and fund-house
// bars). Hovering a slice or legend row focuses it; clicking opens Assets filtered to that category.
import { useState } from "react"

import type { Slice } from "@/components/allocation-strip"
import { CATEGORY_COLOR, categoryColor, inr, inrShort, pct } from "@/lib/format"
import { cn } from "@/lib/utils"

const R = 80
const C = 2 * Math.PI * R

/** Donut of categories; hovering a slice or legend row focuses it, clicking opens Holdings filtered to it. */
/** `others`: FD, PPF and EPF (M19) in the slices, besides the funds. */
/** `side`: the legend beside the donut (half-width card on the overview); otherwise below it. */
export function AllocationDonut({ slices, total, funds, others = 0, onSelect, side = false }: { slices: Slice[]; total: number; funds: number; others?: number; onSelect: (c: string) => void; side?: boolean }) {
  const [focus, setFocus] = useState<string | null>(null)
  // One arc per known category, always mounted, so arcs animate between members instead of popping.
  const by = new Map(slices.map((s) => [s.category, s]))
  const all = [...new Set([...Object.keys(CATEGORY_COLOR), ...slices.map((s) => s.category)])]
  const ordered = [...slices.map((s) => s.category), ...all.filter((c) => !by.has(c))]
  let offset = 0
  const arcs = new Map(ordered.map((c) => {
    const s = by.get(c)
    const arc = { len: s ? Math.max((s.share / 100) * C - 3, 0.5) : 0, offset }
    if (s) offset += (s.share / 100) * C
    return [c, arc] as const
  }))
  const f = focus ? by.get(focus) : null

  return (
    <div className={cn(side && "sm:grid sm:grid-cols-[180px_minmax(0,1fr)] sm:items-center sm:gap-8")}>
      <div className={cn("relative mx-auto mb-5", side ? "size-[180px] sm:mb-0" : "size-[210px]")}>
        <svg viewBox="0 0 200 200" className="size-full -rotate-90 overflow-visible" aria-hidden>
          <circle cx="100" cy="100" r={R} fill="none" stroke="var(--border)" strokeWidth={22} />
          {all.map((c) => {
            const a = arcs.get(c)!
            return (
              <circle
                key={c}
                cx="100" cy="100" r={R} fill="none"
                stroke={categoryColor(c)}
                strokeWidth={focus === c ? 28 : 22}
                strokeDasharray={`${a.len} ${C}`}
                strokeDashoffset={-a.offset}
                onMouseEnter={() => setFocus(c)}
                onMouseLeave={() => setFocus(null)}
                onClick={() => by.has(c) && onSelect(c)}
                className={cn(
                  "cursor-pointer transition-[stroke-dasharray,stroke-dashoffset,stroke-width,opacity] duration-700 ease-[cubic-bezier(.3,.85,.2,1)] [pointer-events:stroke]",
                  focus && focus !== c && "opacity-25",
                )}
              />
            )
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
          <b className="text-[26px] font-semibold tracking-[-0.03em]">{f ? pct(f.share) : inrShort(total)}</b>
          <span className="mx-auto max-w-32 text-[12.5px] text-muted-foreground">{f ? `${f.category} · ${inr(f.value)}` : others ? `across ${funds + others} holdings` : `across ${funds} funds`}</span>
        </div>
      </div>
      <ul className="grid grid-cols-1 gap-0.5">
        {slices.map((s) => (
          <li key={s.category}>
            <button
              type="button"
              onMouseEnter={() => setFocus(s.category)}
              onMouseLeave={() => setFocus(null)}
              onFocus={() => setFocus(s.category)}
              onBlur={() => setFocus(null)}
              onClick={() => onSelect(s.category)}
              aria-label={`${s.category}: ${pct(s.share)} (${inr(s.value)}). Show these funds`}
              className={cn(
                "-mx-2 grid w-[calc(100%+1rem)] grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1.5 rounded-lg px-2 py-1.5 text-left text-[13.5px] transition-colors pointer-coarse:min-h-11",
                "focus-visible:outline-2 focus-visible:outline-ring",
                focus === s.category ? "bg-surface-2" : "hover:bg-surface-2",
              )}
            >
              <span className="size-2.5 rounded-[3px]" style={{ background: categoryColor(s.category) }} />
              <span className="truncate">{s.category}</span>
              <span className="font-semibold tabular-nums">{pct(s.share, 0)}</span>
              <span className="col-span-2 col-start-2 h-[3px] overflow-hidden rounded-full bg-border">
                <span
                  className="block h-full rounded-full transition-[width] duration-700 ease-[cubic-bezier(.3,.85,.2,1)]"
                  style={{ width: `${s.share}%`, background: categoryColor(s.category) }}
                />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
