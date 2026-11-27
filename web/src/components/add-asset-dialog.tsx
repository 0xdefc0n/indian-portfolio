// Add asset (owner, 2026-11-28): one place to add anything. A short list first, then the form for what was picked,
// with a way back. Statements bring in funds and shares; FD, PPF, EPF, gold, silver and SGBs are entered by hand;
// a broker tradebook adds buy prices once there are shares without one. First time in, the list leads with a
// statement and folds the hand-entered kinds into one row; after that, kinds not yet added come first.
import type { AssetType, RateTable } from "@manual-assets"
import { ChartCandlestickIcon, ChartPieIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, PlusIcon, ReceiptTextIcon } from "lucide-react"
import { useState } from "react"

import { AssetForm, type PickMember } from "@/components/asset-dialogs"
import { UploadForm } from "@/components/statement-upload"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

export type AddPick = "mf" | "listed" | "costs" | AssetType

/** What the household has already: counts per kind, and shares still without a buy price. */
export type Have = Partial<Record<"mf" | "listed" | AssetType, number>> & {
  uncosted?: number
  /** "statements": mf / listed count statements (Members page), not funds and holdings. */
  counting?: "holdings" | "statements"
}

const STATEMENT: { id: "mf" | "listed"; label: string; hint: string; icon: typeof ChartPieIcon }[] = [
  { id: "mf", label: "Mutual funds", hint: "CAMS, KFintech or CDSL PDF", icon: ChartPieIcon },
  { id: "listed", label: "Stocks & ETFs", hint: "CDSL PDF or broker file", icon: ChartCandlestickIcon },
]

const BY_HAND: { id: AssetType; label: string; hint: string; color: string }[] = [
  { id: "fd", label: "Fixed deposit", hint: "Amount, rate, dates", color: "var(--cat-fd)" },
  { id: "ppf", label: "PPF", hint: "Balance, deposits", color: "var(--cat-ppf)" },
  { id: "epf", label: "EPF", hint: "Balance, monthly", color: "var(--cat-epf)" },
  { id: "gold", label: "Gold", hint: "Coins, bars, jewellery", color: "var(--cat-gold)" },
  { id: "silver", label: "Silver", hint: "By weight", color: "var(--cat-silver)" },
  { id: "sgb", label: "Gold bonds", hint: "Outside demat", color: "var(--cat-gold)" },
]

const METALS = new Set<AssetType>(["gold", "silver", "sgb"])

/** Kinds not added yet first; otherwise the order above. */
const missingFirst = <T extends { id: string }>(list: T[], have: Have) =>
  [...list].sort((a, b) => Number(!!have[a.id as keyof Have]) - Number(!!have[b.id as keyof Have]))

const added = (n: number | undefined, one = "added", many = one) => (n ? `${n} ${n === 1 ? one : many}` : null)
const UNITS = { mf: ["fund", "funds"], listed: ["holding", "holdings"] } as const

function Back({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="-mt-1 -ml-2 flex min-h-10 items-center gap-1 self-start rounded-lg pr-2 pl-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-11">
      <ChevronLeftIcon className="size-4" />
      All assets
    </button>
  )
}

/** One row in the statement group: icon, label, what's needed, chevron. */
function StatementRow({ icon: Icon, label, hint, meta, onClick, lead }: {
  icon: typeof ChartPieIcon; label: string; hint: string; meta?: string | null; onClick: () => void; lead?: boolean
}) {
  return (
    <button type="button" onClick={onClick}
      className={cn(
        "lift group flex min-h-16 w-full items-center gap-3 rounded-[16px] p-3 text-left ring-1 ring-border transition-colors duration-300 hover:bg-foreground/[0.04] focus-visible:outline-2 focus-visible:outline-ring",
        lead && "bg-primary/[0.06] ring-primary/25",
      )}>
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-background ring-1 ring-border">
        <Icon className="size-[18px] text-primary" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[14.5px] font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </span>
      {meta && <span className="shrink-0 text-xs text-muted-foreground">{meta}</span>}
      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform duration-500 group-hover:translate-x-0.5" />
    </button>
  )
}

function HandTile({ label, hint, color, meta, onClick }: { label: string; hint: string; color: string; meta?: string | null; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="lift flex min-h-16 min-w-0 flex-col justify-center gap-0.5 rounded-[14px] px-3 py-2.5 text-left ring-1 ring-border transition-colors duration-300 hover:bg-foreground/[0.04] focus-visible:outline-2 focus-visible:outline-ring">
      <span className="flex items-center gap-2 text-sm font-medium">
        <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: color }} />
        <span className="truncate">{label}</span>
      </span>
      <span className="pl-[18px] text-xs text-muted-foreground">{meta ?? hint}</span>
    </button>
  )
}

function Picker({ have, first, onPick }: { have: Have; first: boolean; onPick: (p: AddPick) => void }) {
  const [more, setMore] = useState(!first)
  const statements = first ? STATEMENT : missingFirst(STATEMENT, have)
  const hand = missingFirst(BY_HAND, have)
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <section className="flex min-w-0 flex-col gap-2" aria-labelledby="add-from-statement">
        <h3 id="add-from-statement" className="text-[13px] text-muted-foreground">
          {first ? "Start with a statement. It brings in every fund and share at once" : "From a statement"}
        </h3>
        {statements.map((s, i) => (
          <StatementRow key={s.id} icon={s.icon} label={s.label} hint={s.hint} meta={added(have[s.id], ...(have.counting === "statements" ? (["statement", "statements"] as const) : UNITS[s.id]))} lead={first && i === 0} onClick={() => onPick(s.id)} />
        ))}
        {!!have.uncosted && (
          <StatementRow icon={ReceiptTextIcon} label="Buy prices for shares" onClick={() => onPick("costs")}
            hint={`Broker file · ${have.uncosted} ${have.uncosted === 1 ? "share has" : "shares have"} no buy price`} />
        )}
      </section>

      <section className="flex min-w-0 flex-col gap-2" aria-labelledby="add-by-hand">
        <h3 id="add-by-hand" className="text-[13px] text-muted-foreground">Enter by hand</h3>
        {more ? (
          <div className="grid grid-cols-2 gap-2">
            {hand.map((h) => (
              <HandTile key={h.id} label={h.label} hint={h.hint} color={h.color} meta={added(have[h.id])} onClick={() => onPick(h.id)} />
            ))}
          </div>
        ) : (
          <button type="button" onClick={() => setMore(true)} aria-expanded={false}
            className="flex min-h-12 w-full items-center gap-3 rounded-[14px] px-3 text-left text-sm ring-1 ring-border transition-colors duration-300 hover:bg-foreground/[0.04] focus-visible:outline-2 focus-visible:outline-ring">
            <span className="flex -space-x-1" aria-hidden>
              {["var(--cat-fd)", "var(--cat-ppf)", "var(--cat-gold)", "var(--cat-silver)"].map((c) => (
                <span key={c} className="size-2.5 rounded-[3px] ring-2 ring-background" style={{ background: c }} />
              ))}
            </span>
            <span className="flex-1">FD, PPF, EPF, gold or silver</span>
            <ChevronDownIcon className="size-4 text-muted-foreground" />
          </button>
        )}
      </section>
    </div>
  )
}

/** The header's "Add asset" button: an icon on phones, icon and label from `sm` up. */
export function AddAssetTrigger(props: React.ComponentProps<typeof Button>) {
  return (
    <Button aria-label="Add asset" className="h-11 rounded-xl px-4 max-sm:w-11 max-sm:px-0" {...props}>
      <PlusIcon className="size-[18px]" />
      <span className="max-sm:sr-only">Add asset</span>
    </Button>
  )
}

export function AddAssetDialog({
  onAdded, onAssetSaved, members, rates, have, member, trigger, start, open: controlledOpen, onOpenChange,
}: {
  /** A statement or tradebook was added, or a queued upload changed: reload. */
  onAdded: () => void
  /** An asset entered by hand was saved. */
  onAssetSaved: () => void
  members: PickMember[]
  rates: RateTable
  have: Have
  /** Whose a hand-entered asset is by default (the member in focus). */
  member?: string | null
  /** null: no trigger (the page opens it with `open`). */
  trigger?: React.ReactNode | null
  /** Open straight on one form ("Try again" opens the statement upload); back still leads to the list. */
  start?: AddPick
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [ownOpen, setOwnOpen] = useState(false)
  const open = controlledOpen ?? ownOpen
  const [pick, setPick] = useState<AddPick | null>(start ?? null)
  // each time it opens (from its trigger or from the page), start on the list or on `start`
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setPick(start ?? null)
  }
  const setOpen = (o: boolean) => {
    setOwnOpen(o)
    onOpenChange?.(o)
  }
  const close = () => setOpen(false)
  const first = !members.length && !Object.entries(have).some(([k, v]) => k !== "counting" && !!v)
  const back = <Back onClick={() => setPick(null)} />

  let body: React.ReactNode
  if (pick === "mf" || pick === "listed") {
    body = (
      <>
        <DialogHeader>
          {back}
          <DialogTitle>{pick === "mf" ? "Add mutual funds" : "Add stocks & ETFs"}</DialogTitle>
          <DialogDescription>Any family member's statement. We file it under the right person from its PAN.</DialogDescription>
        </DialogHeader>
        <UploadForm kind={pick} onDone={() => { close(); onAdded() }} onQueued={onAdded} />
      </>
    )
  } else if (pick === "costs") {
    // the broker file tab of the shares upload: a holdings statement or tradebook brings the buy prices (M34)
    body = (
      <>
        <DialogHeader>
          {back}
          <DialogTitle>Add buy prices for shares</DialogTitle>
          <DialogDescription>From your broker's holdings statement or tradebook. The file is read once and never kept.</DialogDescription>
        </DialogHeader>
        <UploadForm kind="listed" source="broker" onDone={() => { close(); onAdded() }} onQueued={onAdded} />
      </>
    )
  } else if (pick) {
    body = (
      <AssetForm key={pick} embedded open preset={pick} group={METALS.has(pick) ? "metal" : "fixed"} back={back}
        member={member} members={members} rates={rates} onClose={close} onSaved={() => { close(); onAssetSaved() }} />
    )
  } else {
    body = (
      <>
        <DialogHeader>
          <DialogTitle>Add asset</DialogTitle>
          <DialogDescription>
            {first ? "Your family's funds, shares, deposits and gold, in one place." : "Pick what to add."}
          </DialogDescription>
        </DialogHeader>
        <Picker have={have} first={first} onPick={setPick} />
      </>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger !== null && (
        <DialogTrigger asChild>
          {trigger ?? <AddAssetTrigger />}
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-md">
        <div key={pick ?? "list"} className="rise grid min-w-0 gap-4" style={{ animationDuration: ".5s" }}>{body}</div>
      </DialogContent>
    </Dialog>
  )
}
