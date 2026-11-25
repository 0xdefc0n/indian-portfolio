import { FileTextIcon, InfoIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"

import { AppHeader } from "@/components/app-header"
import { AddStatementDialog } from "@/components/add-statement-dialog"
import { AllocationStrip, type Slice } from "@/components/allocation-strip"
import { HoldingsTable } from "@/components/holdings-table"
import { SipTable, sipSummary } from "@/components/sip-table"
import { BottomNav, type TabId, TabNav, useTab } from "@/components/tab-nav"
import { TransactionsView } from "@/components/transactions-view"
import { AllocationBreakdown, BenchmarkComparison, FundPerformance, FundReturns, MoneyFlow, UpsAndDowns } from "@/components/insights"
import { PageTitle, Panel } from "@/components/panel"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ValueChart } from "@/components/value-chart"
import { FundDialog } from "@/components/fund-dialog"
import { StockExposure } from "@/components/stock-exposure"
import {
  ActivityGrid, AllocationDonut, Cell, CellHead, FundsTile, HeroFigures, HoldingBars, LargestTile, PartialNotice, ReturnBoxes, type Returns,
  SipTile, SipTimeline,
} from "@/components/overview"
import { Segmented } from "@/components/ui/segmented"
import { OpenFundContext } from "@/lib/fund-context"
import { api, type Holding, type Me, type Member, type Portfolio, SignedOut } from "@/lib/api"
import { day, inr, monthly } from "@/lib/format"
import { cn } from "@/lib/utils"
import { upcomingSips } from "@/lib/sips"
import { holdingFlows, xirr } from "@/lib/xirr"

const EVERYONE = "all"

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

const flowsLabel = (members: Member[]) =>
  members.every((m) => m.history_source === "transactions") ? "From your transactions" : "Portfolio value"

function MemberSwitch({ members, value, onChange }: { members: Member[]; value: string; onChange: (v: string) => void }) {
  const options = [{ id: EVERYONE, label: "Everyone" }, ...members.map((m) => ({ id: m.id, label: m.name.split(" ")[0] }))]
  return <Segmented kind="radio" label="Show portfolio for" size="sm" value={value} onChange={onChange} options={options} />
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
    <div className="grid gap-4 lg:grid-cols-12">
      <Skeleton className="h-[540px] rounded-[22px] lg:col-span-8" />
      <Skeleton className="h-[540px] rounded-[22px] lg:col-span-4" />
      <Skeleton className="h-44 rounded-[22px] lg:col-span-4" />
      <Skeleton className="h-44 rounded-[22px] lg:col-span-4" />
      <Skeleton className="h-44 rounded-[22px] lg:col-span-4" />
    </div>
  )
}

export default function App({ me }: { me: Me }) {
  const [data, setData] = useState<Portfolio | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [who, setWho] = useState(EVERYONE)
  const [hovered, setHovered] = useState<string | null>(null)
  const [category, setCategory] = useState<string | null>(null)
  const [tab, setTab] = useTab()
  const [fund, setFund] = useState<Holding | null>(null)

  const load = useCallback(() => {
    api.portfolio().then(setData, (e: Error) => !(e instanceof SignedOut) && setError(e.message))
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
  const switchMember = (v: string) => { setWho(v); setCategory(null) }
  const multi = (data?.members.length ?? 0) > 1
  const showMember = multi && who === EVERYONE
  const ready = view && data && data.members.length > 0
  const activeSips = view?.sips.filter((x) => x.status === "active") ?? []
  const upcoming = upcomingSips(view?.sips ?? [])

  const viewAll = (to: TabId, label: string) => (
    <button className="-my-2 py-2 text-primary underline-offset-4 hover:underline" onClick={() => setTab(to)}>
      {label}
    </button>
  )

  return (
    <OpenFundContext.Provider value={setFund}>
    <div className="min-h-svh">
      <AppHeader
        me={me}
        onHome={() => setTab("overview")}
        nav={ready ? <TabNav tab={tab} onChange={setTab} counts={{ holdings: view.allHoldings.length, sips: activeSips.length || undefined }} /> : undefined}
        actions={data && data.members.length > 0 ? <AddStatementDialog onAdded={load} /> : undefined}
      />

      <main className="mx-auto max-w-[1240px] px-4 pb-28 sm:px-7 md:pb-20">
        {error && (
          <p className="mt-10 rounded-xl bg-surface p-4 text-sm text-loss ring-1 ring-border" role="alert">
            Couldn't load the portfolio: {error}. Reload to try again.
          </p>
        )}
        {!data && !error && <div className="pt-8"><LoadingState /></div>}
        {data && data.members.length === 0 && <EmptyState onAdded={load} />}

        {ready && (
          <div className="space-y-8 pt-3 sm:pt-4">
            {multi && tab !== "overview" && <MemberSwitch members={data.members} value={who} onChange={switchMember} />}

            {tab === "overview" && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-6 lg:grid-cols-12">
                <Cell className="dot-texture flex flex-col sm:p-7 md:col-span-6 lg:col-span-8" lift={false} label="Portfolio value">
                  <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                    {multi ? <MemberSwitch members={data.members} value={who} onChange={switchMember} /> : <span />}
                    <span className="eyebrow">
                      {who === EVERYONE ? (multi ? `${data.members.length} members` : "") : view.members[0]?.name.split(" ")[0]}
                      {view.asOf && <>{who === EVERYONE && !multi ? "" : " · "}{day(view.asOf)}</>}
                    </span>
                  </div>
                  <HeroFigures total={view.total} change={view.change} prev={view.prev} />
                  <div className="mt-6">
                    {view.returns?.complete ? (
                      <ReturnBoxes returns={view.returns} />
                    ) : (
                      <p className="max-w-xl text-sm text-muted-foreground">
                        Invested amount, returns and XIRR show here once every fund has its full purchase history
                        {view.returns ? " (partial figures are under Partial data below)" : ""}.{" "}
                        <RequestLink onAdded={load} label="Request a full statement" />
                      </p>
                    )}
                  </div>
                  <div className="mt-6 flex flex-1 flex-col">
                    <ValueChart
                      data={view.history}
                      scrub
                      label={
                        <span className="eyebrow">
                          {view.historyPartial ? "Demat holdings only" : flowsLabel(view.members)}
                          <span className="hidden sm:inline"> · drag to explore</span>
                        </span>
                      }
                    />
                  </div>
                </Cell>

                <Cell className="md:col-span-6 lg:col-span-4" delay={80} label="Allocation">
                  <CellHead title="Allocation" aside={<span className="eyebrow">{view.slices.length} categories</span>} />
                  <AllocationDonut
                    slices={view.slices}
                    total={view.total}
                    funds={view.allHoldings.length}
                    onSelect={(c) => { setCategory(c); setHovered(null); setTab("holdings") }}
                  />
                </Cell>

                <Cell className="min-h-[172px] md:col-span-2 lg:col-span-4" delay={140}>
                  <SipTile sips={activeSips} missing={view.sipsMissing.length > 0} />
                </Cell>
                <Cell className="min-h-[172px] md:col-span-2 lg:col-span-4" delay={190}>
                  <LargestTile holding={view.allHoldings[0]} total={view.total} />
                </Cell>
                <Cell className="min-h-[172px] md:col-span-2 lg:col-span-4" delay={240}>
                  <FundsTile holdings={view.allHoldings} />
                </Cell>

                {view.returns && !view.returns.complete && (
                  <PartialNotice
                    returns={view.returns}
                    included={view.allHoldings.filter((h) => h.invested != null && h.cashflows?.length).map((h) => h.name)}
                    missing={view.allHoldings.filter((h) => !(h.invested != null && h.cashflows?.length)).map((h) => h.name)}
                    total={view.total}
                    request={(label) => <RequestLink onAdded={load} label={label} />}
                  />
                )}

                <Cell className="md:col-span-6 lg:col-span-7" delay={340} label="Top holdings">
                  <CellHead title="Top holdings" aside={viewAll("holdings", `View all ${view.allHoldings.length}`)} />
                  <HoldingBars holdings={view.allHoldings} total={view.total} members={memberMap} showMember={showMember} />
                </Cell>
                <Cell className="md:col-span-6 lg:col-span-5" delay={390} label="Upcoming SIPs">
                  <CellHead
                    title="Upcoming SIPs"
                    aside={upcoming.list.length ? <span className="eyebrow">Next {upcoming.days} day{upcoming.days === 1 ? "" : "s"}</span> : undefined}
                  />
                  <SipTimeline upcoming={upcoming} members={memberMap} showMember={showMember} />
                  {activeSips.length > 0 && <div className="mt-2 text-[13px]">{viewAll("sips", "View all SIPs")}</div>}
                </Cell>

                <Cell className="md:col-span-6 lg:col-span-12" delay={440} lift={false} label="Latest transactions">
                  <CellHead title="Latest transactions" aside={view.activity.length ? viewAll("transactions", "View all") : undefined} />
                  <ActivityGrid items={view.activity.slice(0, 6)} members={memberMap} showMember={showMember} />
                </Cell>
              </div>
            )}

            {tab === "holdings" && (
              <>
                <PageTitle title="Holdings" detail={`${view.allHoldings.length} funds worth ${inr(view.total)}`} />
                <AllocationStrip slices={view.slices} active={hovered} onHover={setHovered} selected={category} onSelect={setCategory} holdings={view.allHoldings} />
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
