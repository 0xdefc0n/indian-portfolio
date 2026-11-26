import { BuildingIcon, FileTextIcon, InfoIcon, Loader2Icon, SmartphoneIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { AppHeader } from "@/components/app-header"
import { LegalFooter } from "@/components/legal-footer"
import { AddStatementDialog } from "@/components/add-statement-dialog"
import { AllocationStrip, type Slice } from "@/components/allocation-strip"
import { HoldingsTable } from "@/components/holdings-table"
import { SipTable, sipSummary } from "@/components/sip-table"
import { BottomNav, type TabId, TabNav, useTab } from "@/components/tab-nav"
import { TransactionsView } from "@/components/transactions-view"
import { AllocationBreakdown, BenchmarkComparison, FundPerformance, FundReturns, MoneyFlow, UpsAndDowns } from "@/components/insights"
import { PageTitle, Panel } from "@/components/panel"
import { OfflinePanel } from "@/components/pwa"
import { useAutoInstallPrompt, useReloadWhenOnline } from "@/lib/pwa"
import { Badge } from "@/components/ui/badge"
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
import {
  api, type Daily, type Holding, isOffline, type MarketStatus, type Me, type Member, type Portfolio, SignedOut, waitForPortfolio,
} from "@/lib/api"
import { DailyReturns, TodayTile } from "@/components/daily-returns"
import { byFund } from "@/lib/daily"
import { day, inr, monthly } from "@/lib/format"
import { cn } from "@/lib/utils"
import { nextRun, upcomingSips } from "@/lib/sips"
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

/** Onboarding for an empty household (plan §13 item 4): what to upload, and how to get it. */
function Onboarding({ onAdded }: { onAdded: () => void }) {
  return (
    <div className="grid grid-cols-1 gap-4 pt-3 sm:pt-4 md:grid-cols-6 lg:grid-cols-12">
      <Cell className="dot-texture flex flex-col sm:p-7 md:col-span-6 lg:col-span-12" lift={false} label="Welcome">
        <span className="eyebrow">Welcome to PocketFolio</span>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Your family's mutual funds, in one place.</h1>
        <p className="mt-3 max-w-xl text-muted-foreground">
          Add a consolidated statement for each family member. We'll file it under the right person automatically and
          keep the dashboard on the latest NAVs.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          <AddStatementDialog onAdded={onAdded} trigger={<Button size="lg" className="h-11">Add statement</Button>} />
          <AddStatementDialog
            onAdded={onAdded}
            defaultTab="request"
            trigger={<button className="min-h-11 text-left text-sm text-primary underline-offset-4 hover:underline">Don't have one? Get your CAMS/KFintech statement</button>}
          />
        </div>
        <div className="mt-6 flex min-h-11 items-center gap-2 text-sm text-muted-foreground" aria-disabled="true">
          <SmartphoneIcon className="size-4" />
          Fetch from CDSL with OTP
          <Badge variant="secondary">Coming soon</Badge>
        </div>
      </Cell>
      <Cell className="md:col-span-3 lg:col-span-6" delay={80} label="CDSL eCAS">
        <div className="mb-4 grid size-10 place-items-center rounded-xl bg-background ring-1 ring-border">
          <BuildingIcon className="size-5 text-primary" />
        </div>
        <h2 className="text-[15px] font-semibold tracking-tight">CDSL eCAS</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Everything held in demat (funds and shares), with month-end values. The password is usually the PAN in capital
          letters.
        </p>
      </Cell>
      <Cell className="md:col-span-3 lg:col-span-6" delay={140} label="CAMS / KFintech CAS">
        <div className="mb-4 grid size-10 place-items-center rounded-xl bg-background ring-1 ring-border">
          <FileTextIcon className="size-5 text-primary" />
        </div>
        <h2 className="text-[15px] font-semibold tracking-tight">CAMS / KFintech CAS</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Every mutual fund folio with its full transaction history, so you see what you invested, your returns and XIRR,
          SIPs and capital gains. Choose “Detailed” with the earliest start date.
        </p>
      </Cell>
    </div>
  )
}

/** Statements are in, the first build hasn't finished yet. */
function BuildingState() {
  return (
    <div className="mx-auto mt-24 max-w-md text-center" role="status">
      <div className="mx-auto mb-6 grid size-14 place-items-center rounded-2xl bg-surface ring-1 ring-border">
        <Loader2Icon className="size-6 animate-spin text-primary" />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">Building your dashboard…</h1>
      <p className="mt-3 text-muted-foreground">This usually takes a few seconds. It'll appear here by itself.</p>
    </div>
  )
}

/** The latest NAV day is still filling in (nav-ingest runs a few times a night): say so, quietly. */
function NavsUpdatingHint({ market }: { market: MarketStatus }) {
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
      <InfoIcon className="size-3.5" />
      Some funds' NAVs for {day(market.latest_nav_date)} are still coming in. Values update by themselves.
    </p>
  )
}

/** "Updating to today's NAV…" while a rebuild is due (plan §13 item 8). */
function UpdatingBanner({ stale }: { stale: boolean }) {
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
      <Loader2Icon className="size-3.5 animate-spin" />
      {stale ? "Updating to today's NAV…" : "Updating your dashboard…"}
    </p>
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
  const [offline, setOffline] = useState(false)

  const load = useCallback(() => {
    api.portfolio().then(
      (d) => {
        setOffline(false)
        setError(null)
        setData(d)
      },
      (e: Error) => {
        if (e instanceof SignedOut) return
        // Nothing from the API is kept offline (plan §13A.1), so without a network there's nothing to show.
        if (isOffline(e)) setOffline(true)
        else setError(e.message)
      },
    )
  }, [])
  useEffect(load, [load])
  useReloadWhenOnline(load, offline)

  // Home-screen shortcuts (manifest "shortcuts"): ?view=today and ?action=add-statement, read once.
  const [shortcut] = useState(() => {
    const q = new URLSearchParams(window.location.search)
    const s = q.get("view") === "today" ? "today" : q.get("action") === "add-statement" ? "add" : null
    if (q.has("source") || q.has("view") || q.has("action")) history.replaceState(null, "", window.location.pathname + window.location.hash)
    return s
  })
  const [adding, setAdding] = useState(shortcut === "add")

  // Daily returns (plan §10.5.3): asked for after the snapshot, per member key; the overview never waits on it.
  // undefined = loading, null = unavailable.
  const [dailyGot, setDailyGot] = useState<{ data: Portfolio; who: string; d: Daily | null } | null>(null)
  const hasMembers = (data?.members.length ?? 0) > 0
  useEffect(() => {
    if (!hasMembers || !data) return
    let live = true
    api.daily(who).then((d) => live && setDailyGot({ data, who, d }), () => live && setDailyGot({ data, who, d: null }))
    return () => { live = false }
  }, [data, who, hasMembers])
  // undefined while the answer for this snapshot and member is on its way
  const daily = dailyGot && dailyGot.data === data && dailyGot.who === who ? dailyGot.d : undefined

  const [market, setMarket] = useState<MarketStatus | null>(null)
  useEffect(() => {
    api.marketStatus().then(setMarket, () => undefined) // a hint only
  }, [])

  // While a rebuild is due, wait for it (status polling with backoff and Retry-After), then reload once.
  const updating = !!data && (data.stale || data.building)
  useEffect(() => {
    if (!updating) return
    const ctl = new AbortController()
    waitForPortfolio({ maxMs: 5 * 60_000, signal: ctl.signal }).then(
      (s) => !ctl.signal.aborted && s && load(),
      () => undefined,
    )
    return () => ctl.abort()
  }, [updating, load])

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
    // M12: values are at the latest NAV; the statement date stays for the notes
    const valueDate = members.map((m) => m.value_date ?? m.as_of).filter(Boolean).sort().at(-1) ?? null
    const est = members.reduce(
      (t, m) => ({
        n: t.n + (m.estimated?.instalments ?? 0) + (m.estimated?.pending ?? 0),
        amount: t.amount + (m.estimated?.amount ?? 0) + (m.estimated?.pending_amount ?? 0),
        running: t.running + (m.estimated?.in_progress ?? 0),
      }),
      { n: 0, amount: 0, running: 0 },
    )

    return {
      members, total, slices, history, flowsKnown, prev, change, asOf, valueDate, est, historyPartial,
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
  const oneDay = useMemo(() => byFund(daily), [daily])
  const openDaily = useCallback(() => {
    setTab("insights")
    requestAnimationFrame(() => document.getElementById("daily-returns")?.scrollIntoView({ behavior: "smooth", block: "start" }))
  }, [setTab])

  const shortcutDone = useRef(false)
  useEffect(() => {
    if (shortcutDone.current || shortcut !== "today" || !data) return
    shortcutDone.current = true
    if (data.members.length > 0) openDaily()
  }, [shortcut, data, openDaily])

  useAutoInstallPrompt({ ready: !!ready, busy: updating || adding })

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

      <main className="mx-auto max-w-[1240px] px-4 pb-4 sm:px-7 md:pb-12">
        {offline && !data && <OfflinePanel />}
        {error && (
          <p className="mt-10 rounded-xl bg-surface p-4 text-sm text-loss ring-1 ring-border" role="alert">
            Couldn't load the portfolio: {error}. Reload to try again.
          </p>
        )}
        {!data && !error && !offline && <div className="pt-8"><LoadingState /></div>}
        {data && data.members.length === 0 && (data.building ? <BuildingState /> : <Onboarding onAdded={load} />)}

        {ready && (
          <div className="space-y-8 pt-3 sm:pt-4">
            {updating ? (
              <UpdatingBanner stale={data.stale} />
            ) : (
              market?.latest_nav_date && !market.final && <NavsUpdatingHint market={market} />
            )}
            {multi && tab !== "overview" && <MemberSwitch members={data.members} value={who} onChange={switchMember} />}

            {tab === "overview" && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-6 lg:grid-cols-12">
                <Cell className="dot-texture flex flex-col sm:p-7 md:col-span-6 lg:col-span-8" lift={false} label="Portfolio value">
                  <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                    {multi ? <MemberSwitch members={data.members} value={who} onChange={switchMember} /> : <span />}
                    <span className="eyebrow">
                      {who === EVERYONE ? (multi ? `${data.members.length} members` : "") : view.members[0]?.name.split(" ")[0]}
                      {view.valueDate && <>{who === EVERYONE && !multi ? "" : " · "}{day(view.valueDate)}</>}
                    </span>
                  </div>
                  <HeroFigures total={view.total} change={view.change} prev={view.prev} />
                  {view.est.n > 0 && (
                    <p className="mt-3 max-w-xl text-[13px] text-muted-foreground">
                      At the latest NAV, with {view.est.n} SIP instalment{view.est.n === 1 ? "" : "s"} ({inr(view.est.amount)}) estimated since
                      your statement of {day(view.asOf)}
                      {view.est.running > 0 && <>, {view.est.running} still in progress</>}. A newer statement replaces the estimates.
                    </p>
                  )}
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

                <Cell className="min-h-[172px] md:col-span-3 lg:col-span-3" delay={120} label="Today">
                  <TodayTile daily={daily} onOpen={openDaily} />
                </Cell>
                <Cell className="min-h-[172px] md:col-span-3 lg:col-span-3" delay={160}>
                  <SipTile sips={activeSips} missing={view.sipsMissing.length > 0} />
                </Cell>
                <Cell className="min-h-[172px] md:col-span-3 lg:col-span-3" delay={200}>
                  <LargestTile holding={view.allHoldings[0]} total={view.total} />
                </Cell>
                <Cell className="min-h-[172px] md:col-span-3 lg:col-span-3" delay={240}>
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
                  <HoldingsTable holdings={view.holdings} total={view.total} members={memberMap} showMember={showMember} highlight={category ? null : hovered} oneDay={oneDay} />
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
                      {day(activeSips.map((x) => nextRun(x)?.date).filter(Boolean).sort()[0] ?? null)}
                    </Stat>
                  </dl>
                )}
                <Panel title="All SIPs">
                  <SipTable sips={view.sips} members={memberMap} showMember={showMember} missing={view.sipsMissing} onChanged={load} />
                </Panel>
              </>
            )}

            {tab === "insights" && (
              <>
                <PageTitle title="Insights" detail="Worked out from the uploaded statements." />

                <div id="daily-returns" className="scroll-mt-24">
                  <Panel title="Daily returns">
                    <DailyReturns daily={daily} />
                  </Panel>
                </div>

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
      <LegalFooter className={ready ? "pb-28 md:pb-8" : undefined} />
      {/* the "Add statement" shortcut; the header and onboarding have their own buttons */}
      <AddStatementDialog onAdded={load} trigger={null} open={adding} onOpenChange={setAdding} />
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
