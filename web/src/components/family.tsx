// Dashboard v2 (M24): the Family card (Everyone first, then each member, tap to focus) and the asset-class cards.
// Same data as before: member totals and class totals are sums of the snapshot and the manual assets.
import { ChevronRightIcon, PlusIcon } from "lucide-react"

import { Money } from "@/components/ui/rolling-number"
import { pct, signed, inrShort } from "@/lib/format"
import { cn } from "@/lib/utils"

export type FamilyRow = { id: string; name: string; value: number; share: number; detail: string }

/** A ring showing a share (0–100) around an initial. */
function ShareRing({ share, label }: { share: number; label: string }) {
  return (
    <span
      aria-hidden
      className="grid size-[42px] shrink-0 place-items-center rounded-full transition-[background] duration-700"
      style={{ background: `conic-gradient(var(--primary) 0 ${share}%, color-mix(in srgb, var(--foreground) 9%, transparent) 0)` }}
    >
      <span className="grid size-[34px] place-items-center rounded-full bg-background text-[13px] font-semibold">{label}</span>
    </span>
  )
}

export function FamilyCard({ rows, value, onChange }: { rows: FamilyRow[]; value: string; onChange: (id: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Show portfolio for" className="-mx-1.5 flex flex-col gap-0.5">
      {rows.map((r, i) => {
        const on = r.id === value
        return (
          <button
            key={r.id}
            role="radio"
            aria-checked={on}
            onClick={() => onChange(r.id)}
            className={cn(
              "flex min-h-[60px] w-full items-center gap-3 rounded-[14px] px-2 py-2 text-left transition-colors duration-500",
              on ? "bg-primary/10 ring-1 ring-primary/25" : "hover:bg-foreground/[0.04]",
            )}
          >
            <ShareRing share={r.share} label={i === 0 ? "∑" : r.name.slice(0, 1).toUpperCase()} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-[14.5px] font-medium">{r.name}</span>
              <span className="truncate text-xs text-muted-foreground">{r.detail}</span>
            </span>
            <span className="text-right text-[14.5px] font-semibold tracking-tight"><Money value={r.value} /></span>
          </button>
        )
      })}
    </div>
  )
}

export type AssetClass = { key: string; label: string; value: number; gain: number | null; count: string; color: string }

/** `addable`: classes entered by hand (FD/PPF/EPF, gold) that show an "Add" card while empty, so adding stays one tap away. */
/** `compact`: always two columns (beside the hero); otherwise four on desktop. */
export function AssetClasses({ classes, total, onOpen, addable = {}, compact = false }: {
  classes: AssetClass[]
  total: number
  onOpen: (key: string) => void
  addable?: Record<string, { label: string; onAdd: () => void }>
  compact?: boolean
}) {
  const filled = classes.filter((c) => c.value > 0)
  // largest first, then the empty "Add" cards. No grid slot is ever left empty: in two columns an odd count makes
  // the first (largest) card wide; in a row the column count follows the number of cards.
  const shown = [...filled].sort((a, b) => b.value - a.value).concat(classes.filter((c) => c.value <= 0 && addable[c.key]))
  const n = shown.length
  const wide = (i: number) => i === 0 && n % 2 === 1 && n > 1
  const span = (i: number) => cn(wide(i) && "col-span-2", wide(i) && !compact && "lg:col-span-1")
  return (
    <>
      <div
        role="img"
        aria-label={filled.map((c) => `${c.label} ${pct(total ? (c.value / total) * 100 : 0, 0)}`).join(", ")}
        className="mb-4 flex h-2 gap-[3px] overflow-hidden rounded-full"
      >
        {filled.map((c) => (
          <span key={c.key} className="h-full transition-[flex-grow] duration-1000 ease-[cubic-bezier(.65,0,.35,1)]" style={{ flexGrow: c.value, flexBasis: 0, background: c.color }} />
        ))}
      </div>
      <div
        className={cn("grid grid-cols-2 gap-3", n === 1 && "grid-cols-1", !compact && "lg:[grid-template-columns:var(--cards)]")}
        style={{ "--cards": `repeat(${n}, minmax(0, 1fr))` } as React.CSSProperties}
      >
        {shown.map((c, i) => c.value <= 0 && addable[c.key] ? (
          <button
            key={c.key}
            onClick={addable[c.key].onAdd}
            style={{ animationDelay: `${120 + i * 70}ms` }}
            className={cn("rise lift group flex min-w-0 flex-col justify-between rounded-[20px] border border-dashed border-border p-4 text-left sm:p-5", span(i))}
          >
            <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: c.color }} />
              <span className="truncate">{c.label}</span>
            </span>
            <span className="mt-6 flex items-center gap-1.5 text-sm font-medium text-primary">
              <PlusIcon className="size-4" />
              {addable[c.key].label}
            </span>
          </button>
        ) : (
          <button
            key={c.key}
            onClick={() => onOpen(c.key)}
            style={{ animationDelay: `${120 + i * 70}ms` }}
            className={cn("rise glass lift group flex min-w-0 flex-col rounded-[20px] p-4 text-left sm:p-5", span(i))}
          >
            <span className="flex items-center justify-between gap-2 text-[13px] text-muted-foreground">
              <span className="flex min-w-0 items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: c.color }} />
                <span className="truncate">{c.label}</span>
              </span>
            </span>
            <span className="mt-2.5 truncate text-lg font-semibold tracking-tight sm:text-[22px]"><Money value={c.value} /></span>
            <span className="mt-0.5 truncate text-[13px]">
              {c.gain != null ? (
                <span className={cn("font-semibold", c.gain >= 0 ? "text-gain" : "text-loss")}>{signed(c.gain, inrShort)}</span>
              ) : (
                <span className="text-muted-foreground">Value today</span>
              )}
            </span>
            <span className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="truncate">{c.count} · {pct(total ? (c.value / total) * 100 : 0, 0)}</span>
              <ChevronRightIcon className="size-4 shrink-0 transition-transform duration-500 group-hover:translate-x-0.5" />
            </span>
          </button>
        ))}
      </div>
    </>
  )
}
