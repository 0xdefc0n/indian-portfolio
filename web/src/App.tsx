import { ChevronDownIcon, FileTextIcon, InfoIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"

import { ActivityList } from "@/components/activity-list"
import { AddStatementDialog } from "@/components/add-statement-dialog"
import { AllocationStrip, type Slice } from "@/components/allocation-strip"
import { HoldingsTable } from "@/components/holdings-table"
import { TopHoldings, UpcomingSips } from "@/components/previews"
import { SipTable, sipSummary } from "@/components/sip-table"
import { BottomNav, type TabId, TabNav, useTab } from "@/components/tab-nav"
import { TransactionsView } from "@/components/transactions-view"
import { AllocationBreakdown, BenchmarkComparison, FundPerformance, FundReturns, MoneyFlow, UpsAndDowns } from "@/components/insights"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ValueChart } from "@/components/value-chart"
import { FundDialog } from "@/components/fund-dialog"
import { StockExposure } from "@/components/stock-exposure"
import { OpenFundContext } from "@/lib/fund-context"
import { api, type Holding, type Member, type Portfolio } from "@/lib/api"
import { day, inr, month, monthly, pct, signed } from "@/lib/format"
import { cn } from "@/lib/utils"
import { holdingFlows, xirr } from "@/lib/xirr"

const EVERYONE = "all"

function Panel({ title, aside, children, className }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-2xl bg-surface p-4 ring-1 ring-border sm:p-6", className)}>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-base font-semibold">{title}</h2>
        {aside && <div className="text-sm text-muted-foreground">{aside}</div>}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  )
}

function PageTitle({ title, detail }: { title: string; detail?: string }) {
  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      {detail && <p className="mt-1 text-muted-foreground">{detail}</p>}
    </div>
  )
}

function Fact({ label, value, detail, help }: { label: string; value: React.ReactNode; detail?: React.ReactNode; help?: string }) {
  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <dt className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {label}
        {help && (
          <Tooltip>
            <TooltipTrigger aria-label={`About ${label}`} className="-m-2 p-2">
              <InfoIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent className="max-w-64">{help}</TooltipContent>
          </Tooltip>
        )}
      </dt>
      <dd className="mt-1 text-xl font-semibold tracking-tight">{value}</dd>
      {detail && <dd className="mt-0.5 truncate text-sm text-muted-foreground">{detail}</dd>}
    </div>
  )
}

type Returns = { invested: number; current: number; gain: number; xirr: number | null; funds: number; complete: boolean }

function Stat({ label, children, help }: { label: string; children: React.ReactNode; help?: string }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {label}
        {help && (
          <Tooltip>
            <TooltipTrigger aria-label={`About ${label}`} className="-m-2 p-2">
              <InfoIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent className="max-w-64">{help}</TooltipContent>
          </Tooltip>
        )}
      </dt>
      <dd className="mt-1 text-lg font-semibold tracking-tight sm:text-xl">{children}</dd>
    </div>
  )
}

function RequestLink({ onAdded, label }: { onAdded: () => void; label: string }) {
  return (
    <AddStatementDialog
      onAdded={onAdded}
      defaultTab="request"
      trigger={<button className="-my-2 py-2 text-left text-primary underline-offset-4 hover:underline">{label}</button>}
    />
  )
}

function ReturnStats({ returns, showValue }: { returns: Returns; showValue?: boolean }) {
  const tone = returns.gain >= 0 ? "text-gain" : "text-loss"
  return (
    <dl className={cn("grid grid-cols-2 gap-x-8 gap-y-4", showValue ? "sm:grid-cols-4" : "sm:grid-cols-3")}>
      {showValue && <Stat label="Value of these funds">{inr(returns.current)}</Stat>}
      <Stat label="Invested">{inr(returns.invested)}</Stat>
      <Stat label="Total returns">
        <span className={tone}>
          {signed(returns.gain, inr)}{" "}
          <span className="text-sm font-medium">({signed((returns.gain / returns.invested) * 100, (n) => pct(n, 2))})</span>
        </span>
      </Stat>
      <Stat
        label="XIRR"
        help="Annualised return that accounts for when each rupee went in, the same measure Groww and Kuvera show. Includes stamp duty, redemptions and dividends."
      >
        {returns.xirr == null ? "—" : <span className={tone}>{signed(returns.xirr * 100, (n) => pct(n, 2))}</span>}
      </Stat>
    </dl>
  )
}

/** Invested / returns / XIRR in the header only when every fund has full purchase history. */
function ReturnsRow({ returns, onAdded }: { returns: Returns | null; onAdded: () => void }) {
  if (returns?.complete) {
    return (
      <div className="mt-6 max-w-2xl border-t pt-5">
        <ReturnStats returns={returns} />
      </div>
    )
  }
  return (
    <p className="mt-5 max-w-2xl text-sm text-muted-foreground">
      Invested amount, returns and XIRR show here once every fund has its full purchase history
      {returns ? " (partial figures are under Partial data below)" : ""}.{" "}
      <RequestLink onAdded={onAdded} label="Request a full statement" />
    </p>
  )
}

/** Collapsed section for figures that only cover some funds, so they're never mistaken for the whole portfolio. */
function PartialData({ returns, included, missing, total, onAdded }: {
  returns: Returns
  included: string[]
  missing: string[]
  total: number
  onAdded: () => void
}) {
  return (
    <details className="group rounded-2xl bg-surface ring-1 ring-border">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 sm:px-6 [&::-webkit-details-marker]:hidden">
        <div>
          <h2 className="text-base font-semibold">Partial data</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Invested amount, returns and XIRR for {returns.funds} of {returns.funds + missing.length} funds, not the whole portfolio
          </p>
        </div>
        <ChevronDownIcon className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t px-5 pt-5 pb-6 sm:px-6">
        <ReturnStats returns={returns} showValue />
        <p className="mt-4 text-sm text-muted-foreground">
          These funds are {inr(returns.current)} of {inr(total)}. The rest were bought before the CAMS / KFintech statement
          starts, so what was paid for them isn't known.{" "}
          <RequestLink onAdded={onAdded} label="Request a statement from the first investment" />
        </p>
        <div className="mt-5 grid gap-6 text-sm sm:grid-cols-2">
          <div>
            <h3 className="font-medium">Included</h3>
            <ul className="mt-2 space-y-1 text-muted-foreground">
              {included.map((n, i) => <li key={`${n}-${i}`}>{n}</li>)}
            </ul>
          </div>
          <div>
            <h3 className="font-medium">Missing purchase history</h3>
            <ul className="mt-2 space-y-1 text-muted-foreground">
              {missing.map((n, i) => <li key={`${n}-${i}`}>{n}</li>)}
            </ul>
          </div>
        </div>
      </div>
    </details>
  )
}

function MemberSwitch({ members, value, onChange, family }: { members: Member[]; value: string; onChange: (v: string) => void; family: number }) {
  const options = [{ id: EVERYONE, name: "Everyone", total: family }, ...members]
  return (
    <div role="radiogroup" aria-label="Show portfolio for" className="flex flex-wrap gap-2">
      {options.map((m) => {
        const on = value === m.id
        return (
          <button
            key={m.id}
            role="radio"
            aria-checked={on}
            onClick={() => onChange(m.id)}
            className={cn(
              "rounded-xl px-3.5 py-2 text-left text-sm ring-1 transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              on ? "bg-foreground text-background ring-foreground" : "bg-surface ring-border hover:bg-muted",
            )}
          >
            <span className="font-medium">{m.id === EVERYONE ? m.name : m.name.split(" ")[0]}</span>
            <span className={cn("ml-2", on ? "text-background/70" : "text-muted-foreground")}>{inr(m.total)}</span>
          </button>
        )
      })}
    </div>
  )
}

function EmptyState({ onAdded }: { onAdded: () => void }) {
  return (
    <div className="mx-auto mt-24 max-w-md text-center">
      <div className="mx-auto mb-6 grid size-14 place-items-center rounded-2xl bg-surface ring-1 ring-border">
        <FileTextIcon className="size-6 text-primary" />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">Add your first statement</h1>
      <p className="mt-3 text-muted-foreground">
        Upload a family member's CDSL consolidated statement, or fetch it with an OTP. Add one per member to see everyone together.
      </p>
      <div className="mt-8">
        <AddStatementDialog onAdded={onAdded} trigger={<Button size="lg">Add statement</Button>} />
      </div>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-16 w-72" />
      <Skeleton className="h-11 w-full rounded-xl" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-72 lg:col-span-2" />
        <Skeleton className="h-72" />
      </div>
    </div>
  )
}

export default function App() {
  const [data, setData] = useState<Portfolio | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [who, setWho] = useState(EVERYONE)
  const [hovered, setHovered] = useState<string | null>(null)
  const [category, setCategory] = useState<string | null>(null)
  const [tab, setTab] = useTab()
  const [fund, setFund] = useState<Holding | null>(null)

  const load = useCallback(() => {
    api.portfolio().then(setData, (e: Error) => setError(e.message))
  }, [])
  useEffect(load, [load])

  const view = useMemo(() => {
    if (!data) return null
    const members = who === EVERYONE ? data.members : data.members.filter((m) => m.id === who)
    const ids = new Set(members.map((m) => m.id))
    const holdings = data.holdings.filter((h) => ids.has(h.member_id))
    const total = holdings.reduce((s, h) => s + h.value, 0)

    const byCat = new Map<string, Slice>()
    for (const h of holdings) {
      const s = byCat.get(h.category) ?? { category: h.category, value: 0, share: 0, funds: 0 }
      s.value += h.value
      s.funds += 1
      byCat.set(h.category, s)
    }
    const slices = [...byCat.values()].map((s) => ({ ...s, share: total ? (s.value / total) * 100 : 0 })).sort((a, b) => b.value - a.value)

    // Family total only for months every member's statements cover, so older months don't drop people silently.
    const withHistory = members.filter((m) => m.history.length)
    const hist = new Map<string, { value: number; flow: number; n: number }>()
    for (const m of withHistory) for (const p of m.history) {
      const cur = hist.get(p.month) ?? { value: 0, flow: 0, n: 0 }
      hist.set(p.month, { value: cur.value + p.value, flow: cur.flow + (p.flow ?? 0), n: cur.n + 1 })
    }
    const history = [...hist.entries()]
      .filter(([, v]) => v.n === withHistory.length)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({ month, value: v.value, flow: v.flow }))
    // Monthly flows are known only when every member's chart is rebuilt from transactions
    const flowsKnown = withHistory.length > 0 && withHistory.every((m) => m.history_source === "transactions")

    // Month-on-month change from the statement history itself (same coverage on both ends),
    // not from the merged total, which may include newer or non-demat figures.
    const prev = history.length >= 2 ? history[history.length - 2] : null
    const change = prev ? history[history.length - 1].value - prev.value : null
    const historyPartial = members.some((m) => !m.history_covers_all)
    // Invested / returns / XIRR only over funds with complete purchase history (CAMS/KFintech from inception)
    const withCost = holdings.filter((h) => h.invested != null && h.cashflows?.length)
    const invested = withCost.reduce((s, h) => s + (h.invested ?? 0), 0)
    const costValue = withCost.reduce((s, h) => s + h.value, 0)
    const returns: Returns | null = withCost.length
      ? {
          invested,
          current: costValue,
          gain: costValue - invested,
          xirr: xirr(holdingFlows(withCost)),
          funds: withCost.length,
          complete: withCost.length === holdings.length,
        }
      : null
    const asOf = members.map((m) => m.as_of).filter(Boolean).sort().at(-1) ?? null

    return {
      members, total, slices, history, flowsKnown, prev, change, asOf, historyPartial,
      returns,
      holdings: category ? holdings.filter((h) => h.category === category) : holdings,
      allHoldings: holdings,
      activity: data.activity.filter((a) => ids.has(a.member_id)),
      sips: data.sips.filter((x) => ids.has(x.member_id)),
      sipsMissing: members.filter((m) => !m.sips_known),
    }
  }, [data, who, category])

  const memberMap = useMemo(() => new Map(data?.members.map((m) => [m.id, m])), [data])
  const family = data?.members.reduce((s, m) => s + m.total, 0) ?? 0
  const multi = (data?.members.length ?? 0) > 1
  const showMember = multi && who === EVERYONE
  const ready = view && data && data.members.length > 0
  const activeSips = view?.sips.filter((x) => x.status === "active") ?? []

  const viewAll = (to: TabId, label: string) => (
    <button className="-my-2 py-2 text-primary underline-offset-4 hover:underline" onClick={() => setTab(to)}>
      {label}
    </button>
  )

  return (
    <OpenFundContext.Provider value={setFund}>
    <div className="min-h-svh">
      <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-5 sm:px-8">
          <div className="flex min-w-0 items-center gap-6">
            <button className="flex shrink-0 items-center gap-2.5 py-3.5" onClick={() => setTab("overview")}>
              <span className="grid size-8 place-items-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">₹</span>
              <span className="hidden font-semibold sm:inline">Family portfolio</span>
            </button>
            {ready && (
              <div className="hidden md:block">
                <TabNav tab={tab} onChange={setTab} counts={{ holdings: view.allHoldings.length, sips: activeSips.length || undefined }} />
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ThemeToggle />
            {data && data.members.length > 0 && <AddStatementDialog onAdded={load} />}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 pb-28 sm:px-8 md:pb-20">
        {error && (
          <p className="mt-10 rounded-xl bg-surface p-4 text-sm text-loss ring-1 ring-border" role="alert">
            Couldn't load the portfolio: {error}. Check that the server is running, then reload.
          </p>
        )}
        {!data && !error && <div className="pt-8"><LoadingState /></div>}
        {data && data.members.length === 0 && <EmptyState onAdded={load} />}

        {ready && (
          <div className="space-y-8 pt-6 sm:pt-8">
            {multi && (
              <MemberSwitch members={data.members} value={who} onChange={(v) => { setWho(v); setCategory(null) }} family={family} />
            )}

            {tab === "overview" && (
              <>
                <section>
                  <p className="text-sm text-muted-foreground">
                    {who === EVERYONE ? (multi ? `${data.members.length} members` : "Total value") : view.members[0]?.name}
                    {view.asOf && <> on {day(view.asOf)}</>}
                  </p>
                  <div className="mt-2 flex flex-wrap items-end gap-x-5 gap-y-2">
                    <h1 className="text-5xl font-semibold tracking-[-0.03em] sm:text-6xl">{inr(view.total)}</h1>
                    {view.change != null && view.prev && (
                      <p className={cn("pb-1.5 text-base font-medium sm:pb-2.5", view.change >= 0 ? "text-gain" : "text-loss")}>
                        {signed(view.change, inr)}{" "}
                        <span className="font-normal">
                          ({signed((view.change / view.prev.value) * 100, (n) => pct(n, 2))}) since {month(view.prev.month)}
                        </span>
                      </p>
                    )}
                  </div>
                  <ReturnsRow returns={view.returns} onAdded={load} />
                </section>

                <section aria-label="Allocation">
                  <AllocationStrip
                    slices={view.slices}
                    active={hovered}
                    onHover={setHovered}
                    selected={null}
                    onSelect={(c) => { setCategory(c); setHovered(null); setTab("holdings") }}
                  />
                </section>

                <div className="grid gap-6 lg:grid-cols-3">
                  <Panel title="Portfolio value" className="lg:col-span-2" aside={view.historyPartial ? "Demat holdings only" : view.members.every((m) => m.history_source === "transactions") ? "From your transactions" : undefined}>
                    <ValueChart data={view.history} />
                  </Panel>
                  <Panel title="At a glance">
                    <dl className="divide-y">
                      <Fact
                        label="Monthly SIPs"
                        value={activeSips.length ? inr(activeSips.reduce((s, x) => s + monthly(x.amount, x.frequency), 0)) : "—"}
                        detail={activeSips.length ? `${activeSips.length} active` : view.sipsMissing.length ? "needs a CAMS / KFintech statement" : "none active"}
                      />
                      <Fact
                        label="Largest holding"
                        value={view.allHoldings[0] ? pct((view.allHoldings[0].value / view.total) * 100) : "—"}
                        detail={view.allHoldings[0]?.name}
                      />
                      <Fact
                        label="Funds held"
                        value={String(view.allHoldings.length)}
                        detail={`across ${new Set(view.allHoldings.map((h) => h.amc || h.name)).size} fund houses`}
                      />
                    </dl>
                  </Panel>
                </div>

                {view.returns && !view.returns.complete && (
                  <PartialData
                    returns={view.returns}
                    included={view.allHoldings.filter((h) => h.invested != null && h.cashflows?.length).map((h) => h.name)}
                    missing={view.allHoldings.filter((h) => !(h.invested != null && h.cashflows?.length)).map((h) => h.name)}
                    total={view.total}
                    onAdded={load}
                  />
                )}

                <div className="grid gap-6 lg:grid-cols-2">
                  <Panel title="Top holdings" aside={viewAll("holdings", `View all ${view.allHoldings.length}`)}>
                    <TopHoldings holdings={view.allHoldings} total={view.total} members={memberMap} showMember={showMember} />
                  </Panel>
                  <Panel title="Upcoming SIPs" aside={activeSips.length ? viewAll("sips", "View all SIPs") : undefined}>
                    <UpcomingSips sips={view.sips} members={memberMap} showMember={showMember} />
                  </Panel>
                </div>

                <Panel title="Latest transactions" aside={view.activity.length ? viewAll("transactions", "View all") : undefined}>
                  <ActivityList items={view.activity.slice(0, 5)} members={memberMap} showMember={showMember} />
                </Panel>
              </>
            )}

            {tab === "holdings" && (
              <>
                <PageTitle title="Holdings" detail={`${view.allHoldings.length} funds worth ${inr(view.total)}`} />
                <AllocationStrip slices={view.slices} active={hovered} onHover={setHovered} selected={category} onSelect={setCategory} />
                <Panel
                  title={category ?? "All funds"}
                  aside={category ? <button className="-my-2 py-2 text-primary hover:underline" onClick={() => setCategory(null)}>Show all funds</button> : undefined}
                >
                  <HoldingsTable holdings={view.holdings} total={view.total} members={memberMap} showMember={showMember} highlight={category ? null : hovered} />
                </Panel>
              </>
            )}

            {tab === "sips" && (
              <>
                <PageTitle title="SIPs" detail={sipSummary(view.sips, (x) => monthly(x.amount, x.frequency)) ?? "No active SIPs"} />
                {activeSips.length > 0 && (
                  <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
                    <Stat label="Monthly amount">{inr(activeSips.reduce((s, x) => s + monthly(x.amount, x.frequency), 0))}</Stat>
                    <Stat label="Active SIPs">{activeSips.length}</Stat>
                    <Stat label="Invested via these SIPs">{inr(activeSips.reduce((s, x) => s + x.invested, 0))}</Stat>
                    <Stat label="Next instalment">
                      {day(activeSips.map((x) => x.next_date).filter(Boolean).sort()[0] ?? null)}
                    </Stat>
                  </dl>
                )}
                <Panel title="All SIPs">
                  <SipTable sips={view.sips} members={memberMap} showMember={showMember} missing={view.sipsMissing} />
                </Panel>
              </>
            )}

            {tab === "insights" && (
              <>
                <PageTitle title="Insights" detail="Worked out from the uploaded statements." />

                <Panel title="Allocation">
                  <AllocationBreakdown holdings={view.allHoldings} total={view.total} />
                </Panel>

                {data?.stocks?.enabled && (
                  <Panel title="Stocks you own through funds">
                    <StockExposure holdings={view.allHoldings} total={view.total} members={view.members} showMember={showMember} data={data.stocks} />
                  </Panel>
                )}

                <div className={cn("grid gap-6", view.flowsKnown && "lg:grid-cols-2")}>
                  <Panel title="Versus the Nifty 50">
                    <BenchmarkComparison holdings={view.allHoldings} />
                  </Panel>
                  {view.flowsKnown && (
                    <Panel title="Ups and downs">
                      <UpsAndDowns history={view.history} />
                    </Panel>
                  )}
                </div>

                <Panel title="Your returns by fund" aside="Funds with full purchase history">
                  <FundPerformance holdings={view.allHoldings} members={memberMap} showMember={showMember} />
                </Panel>

                <Panel title="Fund track record" aside="1, 3 and 5 years">
                  <FundReturns holdings={view.allHoldings} benchmark={data?.benchmark ?? null} />
                </Panel>

                <Panel title="Money in and out">
                  <MoneyFlow analyses={view.members.map((m) => m.analysis)} activity={view.activity} members={memberMap} showMember={showMember} />
                </Panel>
              </>
            )}

            {tab === "transactions" && (
              <>
                <PageTitle
                  title="Transactions"
                  detail={view.activity.length ? `${view.activity.length} from the latest statements` : undefined}
                />
                <Panel title="History">
                  <TransactionsView items={view.activity} members={memberMap} showMember={showMember} />
                </Panel>
              </>
            )}
          </div>
        )}
      </main>
      {ready && <BottomNav tab={tab} onChange={setTab} />}
      <FundDialog
        holding={fund}
        onClose={() => setFund(null)}
        member={fund ? memberMap.get(fund.member_id) : undefined}
        showMember={multi}
        activity={data?.activity ?? []}
        sips={data?.sips ?? []}
        benchmark={data?.benchmark ?? null}
        stocks={data?.stocks ?? null}
      />
    </div>
    </OpenFundContext.Provider>
  )
}
