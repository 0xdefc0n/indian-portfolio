// The Assets tab: everything the family owns, one kind at a time. The boxes at the top are the switch (mutual funds,
// ETFs, stocks & bonds, FD/PPF/EPF): picking one shows only that kind, with its own allocation strip, so nothing has
// to be scrolled past. SIPs sit with the mutual funds (they're a mutual-fund thing). Gold (M29) and live stock prices
// (M20) join the same switch later. Same Panel, table and list components as before (§13).
import type { AssetDialogState } from "@/components/asset-dialogs"
import { AllocationStrip, type Slice } from "@/components/allocation-strip"
import { AddAssetButton, FixedIncome } from "@/components/fixed-income"
import { HoldingsTable } from "@/components/holdings-table"
import { PageTitle, Panel } from "@/components/panel"
import { SipTable, sipSummary } from "@/components/sip-table"
import type { DayChange, Holding, Member, Sip } from "@/lib/api"
import { type AssetKind, holdingKind, KIND_LABEL } from "@/lib/asset-kind"
import type { AssetRow } from "@/lib/assets"
import { day, inr, monthly, pct } from "@/lib/format"
import { nextRun } from "@/lib/sips"
import { cn } from "@/lib/utils"

type Props = {
  holdings: Holding[]
  fixed: AssetRow[]
  /** Funds, shares and FD/PPF/EPF together. */
  total: number
  /** The kind shown; null: the first kind that has anything. */
  kind: AssetKind | null
  onKind: (k: AssetKind) => void
  category: string | null
  onCategory: (c: string | null) => void
  hovered: string | null
  onHover: (c: string | null) => void
  members: Map<string, Member>
  showMember: boolean
  oneDay?: Map<string, DayChange & { nav_date: string }>
  sips: Sip[]
  sipsMissing: Member[]
  onSipsChanged: () => void
  assetMemberName?: (id: string | null) => string | undefined
  assetsFailed: boolean
  onAssetAction: (s: AssetDialogState) => void
  onAssetsChanged: () => void
}

const ORDER: AssetKind[] = ["mf", "etf", "stock", "fixed"]
const TABLE_LABELS = {
  mf: { item: "Fund", price: "NAV" },
  etf: { item: "ETF", price: "Price" },
  stock: { item: "Stock or bond", price: "Price" },
} as const

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tracking-tight sm:text-xl">{children}</dd>
    </div>
  )
}

/** Category slices within one kind (shares of that kind's value). */
function slicesOf(items: { category: string; value: number }[]): Slice[] {
  const by = new Map<string, Slice>()
  for (const it of items) {
    const s = by.get(it.category) ?? { category: it.category, value: 0, share: 0, funds: 0 }
    s.value += it.value
    s.funds += 1
    by.set(it.category, s)
  }
  const total = items.reduce((s, it) => s + it.value, 0)
  return [...by.values()].map((s) => ({ ...s, share: total ? (s.value / total) * 100 : 0 })).sort((a, b) => b.value - a.value)
}

/** The switch: one box per kind with its value, count and share of everything. */
function KindTabs({ groups, total, current, onPick }: {
  groups: { kind: AssetKind; value: number; count: number }[]
  total: number
  current: AssetKind
  onPick: (k: AssetKind) => void
}) {
  return (
    <div role="tablist" aria-label="Kind of asset" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {groups.map((g) => {
        const on = g.kind === current
        return (
          <button
            key={g.kind}
            type="button"
            role="tab"
            id={`asset-tab-${g.kind}`}
            aria-selected={on}
            aria-controls="asset-panel"
            onClick={() => onPick(g.kind)}
            className={cn(
              "w-full rounded-2xl px-3.5 py-3 text-left ring-1 transition-colors focus-visible:outline-2 focus-visible:outline-ring",
              on ? "bg-surface-2 ring-2 ring-primary" : "bg-surface ring-border hover:bg-surface-2",
            )}
          >
            <span className={cn("eyebrow block", on && "text-foreground")}>{KIND_LABEL[g.kind]}</span>
            <span className="mt-1.5 block truncate text-lg font-semibold tracking-tight sm:text-xl">{inr(g.value)}</span>
            <span className="mt-0.5 block text-[13px] text-muted-foreground">
              {g.count} · {pct(total ? (g.value / total) * 100 : 0, 0)}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function AssetsView(p: Props) {
  const byKind: Record<Exclude<AssetKind, "fixed">, Holding[]> = { mf: [], etf: [], stock: [] }
  for (const h of p.holdings) byKind[holdingKind(h)].push(h)
  const fixedValue = p.fixed.reduce((s, r) => s + r.v.value, 0)
  const sum = (hs: Holding[]) => hs.reduce((s, h) => s + h.value, 0)
  const groups = ORDER.map((k) =>
    k === "fixed" ? { kind: k, value: fixedValue, count: p.fixed.length } : { kind: k, value: sum(byKind[k]), count: byKind[k].length },
  ).filter((g) => g.count > 0 || g.kind === "fixed") // FD/PPF/EPF always shows, so there's a way to add the first one
  const current = groups.some((g) => g.kind === p.kind) ? p.kind! : (groups[0]?.kind ?? "fixed")
  const count = p.holdings.length + p.fixed.length
  const pick = (k: AssetKind) => {
    p.onCategory(null)
    p.onKind(k)
  }

  let body: React.ReactNode
  if (current === "fixed") {
    body = (
      <>
        {p.fixed.length > 0 && <AllocationStrip slices={slicesOf(p.fixed.map((r) => ({ category: r.category, value: r.v.value })))} active={p.hovered} onHover={p.onHover} selected={null} onSelect={() => undefined} />}
        <Panel
          title={KIND_LABEL.fixed}
          aside={p.fixed.length ? <span className="flex items-center gap-3">{inr(fixedValue)}<AddAssetButton onClick={() => p.onAssetAction({ kind: "add" })} /></span> : undefined}
        >
          <FixedIncome rows={p.fixed} memberName={p.assetMemberName} failed={p.assetsFailed} onAction={p.onAssetAction} onChanged={p.onAssetsChanged} />
        </Panel>
      </>
    )
  } else {
    const all = byKind[current]
    const rows = p.category ? all.filter((h) => h.category === p.category) : all
    const activeSips = p.sips.filter((x) => x.status === "active")
    body = (
      <>
        <AllocationStrip slices={slicesOf(all)} active={p.hovered} onHover={p.onHover} selected={p.category} onSelect={p.onCategory} holdings={all} />
        <Panel
          title={p.category ?? KIND_LABEL[current]}
          aside={
            p.category ? (
              <button className="-my-2 py-2 text-primary hover:underline" onClick={() => p.onCategory(null)}>Show all</button>
            ) : (
              `${all.length} · ${inr(sum(all))}`
            )
          }
        >
          <HoldingsTable
            holdings={rows}
            total={p.total}
            members={p.members}
            showMember={p.showMember}
            highlight={p.category ? null : p.hovered}
            oneDay={p.oneDay}
            itemLabel={TABLE_LABELS[current].item}
            priceLabel={TABLE_LABELS[current].price}
          />
        </Panel>
        {current === "mf" && !p.category && (p.sips.length > 0 || p.sipsMissing.length > 0) && (
          <div id="sips" className="scroll-mt-24">
            <Panel title="SIPs" aside={sipSummary(p.sips, (x) => monthly(x.amount, x.frequency))}>
              {activeSips.length > 0 && (
                <dl className="mb-4 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
                  <Stat label="Monthly amount">{inr(activeSips.reduce((s, x) => s + monthly(x.amount, x.frequency), 0))}</Stat>
                  <Stat label="Active SIPs">{activeSips.length}</Stat>
                  <Stat label="Invested via these SIPs">{inr(activeSips.reduce((s, x) => s + x.invested, 0))}</Stat>
                  <Stat label="Next instalment">{day(activeSips.map((x) => nextRun(x)?.date).filter(Boolean).sort()[0] ?? null)}</Stat>
                </dl>
              )}
              <SipTable sips={p.sips} members={p.members} showMember={p.showMember} missing={p.sipsMissing} onChanged={p.onSipsChanged} />
            </Panel>
          </div>
        )}
      </>
    )
  }

  return (
    <>
      <PageTitle title="Assets" detail={`${count} ${count === 1 ? "holding" : "holdings"} worth ${inr(p.total)}`} />
      <KindTabs groups={groups} total={p.total} current={current} onPick={pick} />
      <div id="asset-panel" role="tabpanel" aria-labelledby={`asset-tab-${current}`} className="space-y-8">
        {body}
      </div>
    </>
  )
}
