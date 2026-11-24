import { cn } from "@/lib/utils"
import { categoryColor, inr, pct } from "@/lib/format"

export type Slice = { category: string; value: number; share: number; funds: number }

type Props = {
  slices: Slice[]
  active: string | null
  onHover: (c: string | null) => void
  onSelect: (c: string | null) => void
  selected: string | null
}

/** One bar, one segment per fund category, width ∝ value. Hover/click links to the holdings table. */
export function AllocationStrip({ slices, active, onHover, onSelect, selected }: Props) {
  const focus = active ?? selected
  return (
    <div>
      <div className="flex h-11 w-full gap-[3px]" role="list" aria-label="Allocation by category">
        {slices.map((s) => (
          <button
            key={s.category}
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
              "relative min-w-[6px] overflow-hidden rounded-[5px] transition-[opacity,transform] duration-200 first:rounded-l-xl last:rounded-r-xl",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              focus && focus !== s.category && "opacity-25",
            )}
            style={{ flexGrow: s.value, flexBasis: 0, background: categoryColor(s.category) }}
          >
            {s.share >= 9 && (
              <span className={cn("absolute inset-y-0 left-3 items-center", s.share >= 18 ? "flex" : "hidden sm:flex", " text-sm font-semibold text-white/95 [text-shadow:0_1px_2px_rgb(0_0_0/0.25)]")}>
                {Math.round(s.share)}%
              </span>
            )}
          </button>
        ))}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-0.5 text-sm">
        {slices.map((s) => (
          <li key={s.category}>
            <button
              type="button"
              onMouseEnter={() => onHover(s.category)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onSelect(selected === s.category ? null : s.category)}
              className={cn(
                "flex min-h-8 items-center gap-2 rounded-md transition-opacity",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                focus && focus !== s.category && "opacity-40",
              )}
            >
              <span className="size-2.5 rounded-full" style={{ background: categoryColor(s.category) }} />
              <span className="font-medium">{s.category}</span>
              <span className="text-muted-foreground">{pct(s.share)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
