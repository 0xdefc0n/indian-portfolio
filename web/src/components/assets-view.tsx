// The Assets tab: everything the family owns, grouped so each kind is easy to find. Mutual funds (with their SIPs
// right below: SIPs are a mutual-fund thing), ETFs, stocks & bonds, and FD/PPF/EPF entered by hand. Gold (M29) and
// live stock prices (M20) join the same groups later. Same Panel, table and list components as before (§13).
import type { AssetDialogState } from "@/components/asset-dialogs"
import { AllocationStrip, type Slice } from "@/components/allocation-strip"
import { AddAssetButton, FixedIncome } from "@/components/fixed-income"
import { HoldingsTable } from "@/components/holdings-table"
import { PageTitle, Panel } from "@/components/panel"
import { SipTable, sipSummary } from "@/components/sip-table"
import type { DayChange, Holding, Member, Sip } from "@/lib/api"
import { type HoldingKind, holdingKind, KIND_LABEL } from "@/lib/asset-kind"
import type { AssetRow } from "@/lib/assets"
import { day, inr, monthly, pct } from "@/lib/format"
import { nextRun } from "@/lib/sips"

type Props = {
  holdings: Holding[]
  fixed: AssetRow[]
  /** Funds, shares and FD/PPF/EPF together. */
  total: number
  slices: Slice[]
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

const KINDS: HoldingKind[] = ["mf", "etf", "stock"]
const ANCHOR: Record<HoldingKind | "fixed", string> = { mf: "assets-mf", etf: "assets-etf", stock: "assets-stock", fixed: "assets-fixed" }
const TABLE_LABELS: Record<HoldingKind, { item: string; price: string }> = {
  mf: { item: "Fund", price: "NAV" },
  etf: { item: "ETF", price: "Price" },
  stock: { item: "Stock or bond", price: "Price" },
}

const scrollToId = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tracking-tight sm:text-xl">{children}</dd>
    </div>
  )
}

/** One box per kind: what's in it and its share; a tap jumps to the group. */
function KindSummary({ groups, total }: { groups: { kind: HoldingKind | "fixed"; value: number; count: number }[]; total: number }) {
  return (
    <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Your assets by kind">
      {groups.map((g) => (
        <li key={g.kind}>
          <button
            type="button"
            onClick={() => scrollToId(ANCHOR[g.kind])}
            className="w-full rounded-2xl bg-surface px-3.5 py-3 text-left ring-1 ring-border transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span className="eyebrow block">{KIND_LABEL[g.kind]}</span>
            <span className="mt-1.5 block truncate text-lg font-semibold tracking-tight sm:text-xl">{inr(g.value)}</span>
            <span className="mt-0.5 block text-[13px] text-muted-foreground">
              {g.count} · {pct(total ? (g.value / total) * 100 : 0, 0)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export function AssetsView(p: Props) {
  const byKind = new Map<HoldingKind, Holding[]>(KINDS.map((k) => [k, []]))
  for (const h of p.holdings) byKind.get(holdingKind(h))!.push(h)
  const shown = (hs: Holding[]) => (p.category ? hs.filter((h) => h.category === p.category) : hs)
  const fixedValue = p.fixed.reduce((s, r) => s + r.v.value, 0)
  const groups = [
    ...KINDS.map((k) => ({ kind: k, value: byKind.get(k)!.reduce((s, h) => s + h.value, 0), count: byKind.get(k)!.length })),
    { kind: "fixed" as const, value: fixedValue, count: p.fixed.length },
  ].filter((g) => g.count > 0)
  const manual = new Set(p.fixed.map((r) => r.category))
  const activeSips = p.sips.filter((x) => x.status === "active")
  const count = p.holdings.length + p.fixed.length

  const select = (c: string | null) => {
    if (c && manual.has(c)) return scrollToId(ANCHOR.fixed) // FD, PPF, EPF live in their own group
    p.onCategory(c)
  }

  return (
    <>
      <PageTitle title="Assets" detail={`${count} ${count === 1 ? "holding" : "holdings"} worth ${inr(p.total)}`} />
      {groups.length > 1 && <KindSummary groups={groups} total={p.total} />}
      <AllocationStrip slices={p.slices} active={p.hovered} onHover={p.onHover} selected={p.category} onSelect={select} holdings={p.holdings} />
      {p.category && (
        <p className="-mt-4 text-sm text-muted-foreground">
          Showing {p.category} only.{" "}
          <button className="-my-2 py-2 text-primary hover:underline" onClick={() => p.onCategory(null)}>Show everything</button>
        </p>
      )}

      {KINDS.map((k) => {
        const all = byKind.get(k)!
        const rows = shown(all)
        if (!rows.length) return null
        return (
          <div key={k} id={ANCHOR[k]} className="scroll-mt-24 space-y-6">
            <Panel title={KIND_LABEL[k]} aside={`${all.length} · ${inr(all.reduce((s, h) => s + h.value, 0))}`}>
              <HoldingsTable
                holdings={rows}
                total={p.total}
                members={p.members}
                showMember={p.showMember}
                highlight={p.category ? null : p.hovered}
                oneDay={p.oneDay}
                itemLabel={TABLE_LABELS[k].item}
                priceLabel={TABLE_LABELS[k].price}
              />
            </Panel>
            {k === "mf" && !p.category && (p.sips.length > 0 || p.sipsMissing.length > 0) && (
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
          </div>
        )
      })}

      {!p.category && (
        <div id={ANCHOR.fixed} className="scroll-mt-24">
          <Panel
            title={KIND_LABEL.fixed}
            aside={p.fixed.length ? <span className="flex items-center gap-3">{inr(fixedValue)}<AddAssetButton onClick={() => p.onAssetAction({ kind: "add" })} /></span> : undefined}
          >
            <FixedIncome rows={p.fixed} memberName={p.assetMemberName} failed={p.assetsFailed} onAction={p.onAssetAction} onChanged={p.onAssetsChanged} />
          </Panel>
        </div>
      )}
    </>
  )
}
