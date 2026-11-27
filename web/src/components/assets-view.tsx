// The Assets tab: everything the family owns, one kind at a time. The boxes at the top are the switch (mutual funds,
// ETFs, stocks & bonds, FD/PPF/EPF): picking one shows only that kind, with its own allocation strip, so nothing has
// to be scrolled past. SIPs sit with the mutual funds (they're a mutual-fund thing). Shares and bonds are at their
// latest exchange close (M20), with the price date under the table. Gold & silver (M29): SGBs from statements plus gold, silver and SGBs added by hand. Same Panel, table and list components as before (§13).
import type { AssetDialogState } from "@/components/asset-dialogs"
import { AllocationStrip, type Slice } from "@/components/allocation-strip"
import { AddAssetButton, FixedIncome, GoldSilver } from "@/components/fixed-income"
import { HoldingsTable } from "@/components/holdings-table"
import { ReturnBoxes } from "@/components/overview"
import { PageTitle, Panel } from "@/components/panel"
import { SipTable, sipSummary } from "@/components/sip-table"
import type { DayChange, Holding, Member, Sip } from "@/lib/api"
import { type AssetKind, holdingKind, KIND_LABEL } from "@/lib/asset-kind"
import { type AssetRow, assetFlows, assetTotals } from "@/lib/assets"
import { day, inr, monthly, pct } from "@/lib/format"
import { nextRun } from "@/lib/sips"
import { cn } from "@/lib/utils"
import { costKnown, dated, holdingFlows, xirr } from "@/lib/xirr"

type Props = {
  holdings: Holding[]
  fixed: AssetRow[]
  /** Gold, silver and SGBs added by hand. */
  metals: AssetRow[]
  /** Funds, shares, FD/PPF/EPF and gold together. */
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

const ORDER: AssetKind[] = ["mf", "etf", "stock", "fixed", "gold"]
const TABLE_LABELS = {
  mf: { item: "Fund", price: "NAV" },
  etf: { item: "ETF", price: "Price" },
  stock: { item: "Stock or bond", price: "Price" },
  gold: { item: "SGB in demat", price: "Gold rate" },
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
    <div role="tablist" aria-label="Kind of asset" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
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

/** What a holding or hand-entered asset is called in the coverage note. */
const NOUN: Record<AssetKind, [string, string]> = {
  mf: ["fund", "funds"], etf: ["ETF", "ETFs"], stock: ["holding", "holdings"], fixed: ["account", "accounts"], gold: ["holding", "holdings"],
}
/** What would make returns known, when nothing in the section has a cost yet. */
const NONE: Record<AssetKind, string> = {
  mf: "you add a CAMS / KFintech statement that goes back to the first investment",
  etf: "you add your broker's tradebook from Add asset (it has the buy prices)",
  stock: "you add your broker's tradebook from Add asset (it has the buy prices)",
  fixed: "the amounts are entered",
  gold: "you enter the price paid",
}
/** Why the rest aren't in the figures, when some are. */
const REST: Record<AssetKind, string> = {
  mf: "were bought before your CAMS / KFintech statement starts",
  etf: "have no buy price yet (add your broker's tradebook from Add asset)",
  stock: "have no buy price yet (add your broker's tradebook from Add asset)",
  fixed: "need their amounts",
  gold: "have no price paid entered",
}

/**
 * Invested, value now, returns and XIRR for one kind (owner, 2026-11-28), over what has a known cost: funds with full
 * history, shares with a buy price, hand-entered assets with their amounts. Same maths as the overview.
 */
function KindReturns({ kind, holdings, rows }: { kind: AssetKind; holdings: Holding[]; rows: AssetRow[] }) {
  const value = holdings.reduce((s, h) => s + h.value, 0) + rows.reduce((s, r) => s + r.v.value, 0)
  if (value <= 0) return null
  const withCost = holdings.filter(costKnown)
  const known = rows.filter((r) => !r.v.cost_unknown)
  const t = assetTotals(known)
  const invested = withCost.reduce((s, h) => s + (h.invested ?? 0), 0) + t.invested
  const current = withCost.reduce((s, h) => s + h.value, 0) + t.costValue
  const n = holdings.length + rows.length
  const covered = withCost.length + known.length
  const [one, many] = NOUN[kind]
  if (!covered || invested <= 0) {
    return (
      <p className="glass rounded-[24px] p-5 text-sm text-muted-foreground sm:p-6">
        Returns show here once {NONE[kind]}.
      </p>
    )
  }
  return (
    <section className="glass rounded-[24px] p-5 sm:p-6" aria-label="Returns">
      <ReturnBoxes
        showValue
        valueLabel={covered < n ? `Value of these ${covered === 1 ? one : many}` : "Current value"}
        returns={{ invested, current, gain: current - invested, xirr: xirr([...holdingFlows(dated(withCost)), ...assetFlows(known)]), funds: covered, complete: covered === n }}
      />
      {covered < n && (
        <p className="mt-4 border-t pt-3 text-[12.5px] text-muted-foreground">
          Covers {covered} of {n} {many}: the rest {REST[kind]}.
        </p>
      )}
    </section>
  )
}

/** Under the Stocks & bonds table (M20): the price date, and which ones keep the statement's price. */
export function PriceNote({ holdings }: { holdings: Holding[] }) {
  const priced = holdings.filter((h) => h.price_source === "exchange")
  const kept = holdings.length - priced.length
  if (!holdings.length) return null
  const latest = priced.map((h) => h.as_of).sort().at(-1)
  return (
    <p className="mt-3 border-t pt-3 text-[12.5px] text-muted-foreground">
      {latest ? `Valued at the closing price of ${day(latest)} on NSE (BSE if it isn't listed there).` : "Valued at the price on your statement."}
      {latest && kept > 0 && ` ${kept} without an exchange price ${kept === 1 ? "keeps" : "keep"} your statement's price.`}
    </p>
  )
}

/**
 * M34 (plan §21.13 rule 4): shares in a broker holdings statement newer than the CDSL statement but not in it. CDSL's
 * quantities win, so they aren't counted: a newer CDSL statement is asked for.
 */
export function BrokerNote({ members }: { members: Iterable<Member> }) {
  const notes = [...members].flatMap((m) => (m.broker_notes ?? []).map((n) => ({ ...n, who: m.name })))
  if (!notes.length) return null
  const names = notes.slice(0, 3).map((n) => n.name).join(", ") + (notes.length > 3 ? ` and ${notes.length - 3} more` : "")
  return (
    <p className="mt-3 border-t pt-3 text-[12.5px] text-muted-foreground" role="status">
      {notes.length === 1 ? "1 share" : `${notes.length} shares`} in your {notes[0]!.broker} holdings statement of {day(notes[0]!.as_of)}{" "}
      {notes.length === 1 ? "isn't" : "aren't"} in your CDSL statement yet ({names}). Upload a newer CDSL statement to count{" "}
      {notes.length === 1 ? "it" : "them"}.
    </p>
  )
}

export function AssetsView(p: Props) {
  const byKind: Record<Exclude<AssetKind, "fixed">, Holding[]> = { mf: [], etf: [], stock: [], gold: [] }
  for (const h of p.holdings) byKind[holdingKind(h)].push(h)
  const fixedValue = p.fixed.reduce((s, r) => s + r.v.value, 0)
  const metalValue = p.metals.reduce((s, r) => s + r.v.value, 0)
  const sum = (hs: Holding[]) => hs.reduce((s, h) => s + h.value, 0)
  const groups = ORDER.map((k) =>
    k === "fixed" ? { kind: k, value: fixedValue, count: p.fixed.length }
    : k === "gold" ? { kind: k, value: sum(byKind.gold) + metalValue, count: byKind.gold.length + p.metals.length }
    : { kind: k, value: sum(byKind[k]), count: byKind[k].length },
  ).filter((g) => g.count > 0 || g.kind === "fixed" || g.kind === "gold") // these always show, so there's a way to add the first one
  const current = groups.some((g) => g.kind === p.kind) ? p.kind! : (groups[0]?.kind ?? "fixed")
  const count = p.holdings.length + p.fixed.length + p.metals.length
  const pick = (k: AssetKind) => {
    p.onCategory(null)
    p.onKind(k)
  }

  let body: React.ReactNode
  if (current === "fixed") {
    body = (
      <>
        <KindReturns kind="fixed" holdings={[]} rows={p.fixed} />
        {p.fixed.length > 0 && <AllocationStrip slices={slicesOf(p.fixed.map((r) => ({ category: r.category, value: r.v.value })))} active={p.hovered} onHover={p.onHover} selected={null} onSelect={() => undefined} />}
        <Panel
          title={KIND_LABEL.fixed}
          aside={p.fixed.length ? <span className="flex items-center gap-3">{inr(fixedValue)}<AddAssetButton onClick={() => p.onAssetAction({ kind: "add", group: "fixed" })} /></span> : undefined}
        >
          <FixedIncome rows={p.fixed} memberName={p.assetMemberName} failed={p.assetsFailed} onAction={p.onAssetAction} onChanged={p.onAssetsChanged} />
        </Panel>
      </>
    )
  } else if (current === "gold") {
    const demat = byKind.gold
    const items = [...demat.map((h) => ({ category: h.category, value: h.value })), ...p.metals.map((r) => ({ category: r.category, value: r.v.value }))]
    body = (
      <>
        <KindReturns kind="gold" holdings={demat} rows={p.metals} />
        {items.length > 0 && <AllocationStrip slices={slicesOf(items)} active={p.hovered} onHover={p.onHover} selected={null} onSelect={() => undefined} />}
        {demat.length > 0 && (
          <Panel title="SGBs in demat" aside={`${demat.length} · ${inr(sum(demat))}`}>
            <HoldingsTable holdings={demat} total={p.total} members={p.members} showMember={p.showMember} highlight={p.hovered}
              itemLabel={TABLE_LABELS.gold.item} priceLabel={TABLE_LABELS.gold.price} />
            <p className="mt-3 border-t pt-3 text-[12.5px] text-muted-foreground">
              From your CDSL statement, valued at today's gold rate (what RBI pays at maturity), not the exchange price. Interest is paid to your bank every six months.
            </p>
          </Panel>
        )}
        <Panel
          title={demat.length ? "Held outside demat" : KIND_LABEL.gold}
          aside={p.metals.length ? <span className="flex items-center gap-3">{inr(metalValue)}<AddAssetButton onClick={() => p.onAssetAction({ kind: "add", group: "metal" })} /></span> : undefined}
        >
          <GoldSilver rows={p.metals} memberName={p.assetMemberName} failed={p.assetsFailed} onAction={p.onAssetAction} onChanged={p.onAssetsChanged} />
        </Panel>
      </>
    )
  } else {
    const all = byKind[current]
    const rows = p.category ? all.filter((h) => h.category === p.category) : all
    const activeSips = p.sips.filter((x) => x.status === "active")
    body = (
      <>
        <KindReturns key={`${current}-${p.category}`} kind={current} holdings={rows} rows={[]} />
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
          {current === "stock" && <PriceNote holdings={rows} />}
          {(current === "stock" || current === "etf") && !p.category && <BrokerNote members={p.members.values()} />}
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
