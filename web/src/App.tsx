import { BuildingIcon, FileTextIcon, InfoIcon, Loader2Icon, SmartphoneIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { AppHeader } from "@/components/app-header"
import { LegalFooter } from "@/components/legal-footer"
import { AddStatementDialog } from "@/components/add-statement-dialog"
import { type AssetDialogState, AssetDialogs } from "@/components/asset-dialogs"
import { AddAssetButton, FixedIncome } from "@/components/fixed-income"
import type { Slice } from "@/components/allocation-strip"
import { AssetsView } from "@/components/assets-view"
import { type AssetKind, holdingKind } from "@/lib/asset-kind"
import { BottomNav, type TabId, TabNav, useTab } from "@/components/tab-nav"
import { TransactionsView } from "@/components/transactions-view"
import { AllocationBreakdown, BenchmarkComparison, FundPerformance, FundReturns, MoneyFlow, UpsAndDowns } from "@/components/insights"
import { PageTitle, Panel } from "@/components/panel"
import { OfflinePanel } from "@/components/pwa"
import { useAutoInstallPrompt, useReloadWhenOnline } from "@/lib/pwa"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
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
import { day, inr } from "@/lib/format"
import { cn } from "@/lib/utils"
import { upcomingSips } from "@/lib/sips"
import { holdingFlows, xirr } from "@/lib/xirr"
import { assetFlows, assetTotals, forMember, useAssets, valued } from "@/lib/assets"

const EVERYONE = "all"

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
function Onboarding({ onAdded, fixedIncome }: { onAdded: () => void; fixedIncome: React.ReactNode }) {
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
      {fixedIncome}
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
  // An old #sips link opens Assets scrolled to the SIPs (read before useTab settles on "assets").
  const [sipsLink] = useState(() => window.location.hash === "#sips")
  const [tab, setTab] = useTab()
  const [assetKind, setAssetKind] = useState<AssetKind | null>(() => (window.location.hash === "#sips" ? "mf" : null))
  const [fund, setFund] = useState<Holding | null>(null)
  const [offline, setOffline] = useState(false)
  // FD, PPF and EPF (M19): loaded beside the snapshot, valued here on every render with the shared calculator.
  const assets = useAssets()
  const assetRows = useMemo(() => valued(assets.assets ?? [], assets.rates), [assets.assets, assets.rates])
  const [assetDlg, setAssetDlg] = useState<AssetDialogState>(null)

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
  // A sold fund's NAV history is still downloading: the Worker rebuilds by itself once it lands (a few minutes), so
  // check back a few times and swap in the better chart without a reload.
  const enriching = !!data?.members.some((m) => m.history_note === "waiting")
  useEffect(() => {
    if (!enriching || updating) return
    let tries = 0
    const timer = setInterval(() => {
      if (++tries > 6) return clearInterval(timer)
      load()
    }, 2.5 * 60_000)
    return () => clearInterval(timer)
  }, [enriching, updating, load])
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

    // Manual assets (M19): a member's own, or everyone's (those filed under no member show only for Everyone).
    const fixed = forMember(assetRows, who === EVERYONE ? null : who)
    const fixedTotals = assetTotals(fixed)
    const grandTotal = total + fixedTotals.value
    const byAsset = new Map<string, Slice>()
    for (const r of fixed) {
      const s = byAsset.get(r.category) ?? { category: r.category, value: 0, share: 0, funds: 0 }
      s.value += r.v.value
      s.funds += 1
      byAsset.set(r.category, s)
    }
    const allSlices = [...byCat.values(), ...byAsset.values()]
      .map((s) => ({ ...s, share: grandTotal ? (s.value / grandTotal) * 100 : 0 }))
      .sort((a, b) => b.value - a.value)

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
    // Months valued at the statement's own NAVs (a sold fund's daily NAVs are downloading, or don't exist)
    const historyNote = members.some((m) => m.history_note === "waiting") ? "waiting" : members.some((m) => m.history_note === "estimated") ? "estimated" : null
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
    // The dashboard's invested and gain include the manual assets; Funds & stocks XIRR stays as it is, and Overall
    // XIRR adds them (plan §21.12: two XIRRs).
    const dashReturns: Returns | null =
      returns && fixed.length
        ? {
            ...returns,
            invested: returns.invested + fixedTotals.invested,
            current: returns.current + fixedTotals.value,
            gain: returns.gain + fixedTotals.gain,
            overall: xirr([...holdingFlows(withCost), ...assetFlows(fixed)]),
          }
        : returns
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
      members, total, slices, history, flowsKnown, prev, change, asOf, valueDate, est, historyPartial, historyNote,
      returns, dashReturns, fixed, fixedTotal: fixedTotals.value, grandTotal, allSlices,
      allHoldings: holdings,
      activity: data.activity.filter((a) => ids.has(a.member_id)),
      sips: data.sips.filter((x) => ids.has(x.member_id)),
      sipsMissing: members.filter((m) => !m.sips_known),
    }
  }, [data, who, assetRows])

  const memberMap = useMemo(() => new Map(data?.members.map((m) => [m.id, m])), [data])
  const pickMembers = useMemo(() => (data?.members ?? []).map((m) => ({ id: m.id, name: m.name })), [data])
  const assetMemberName = (id: string | null) => (id ? memberMap.get(id)?.name.split(" ")[0] : undefined)
  const openFixedIncome = () => document.getElementById("fixed-income")?.scrollIntoView({ behavior: "smooth", block: "start" })
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

  /** Open a tab, then scroll to a section in it once it has rendered. */
  const goTo = useCallback((to: TabId, anchor?: string) => {
    setTab(to)
    if (anchor) requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" })))
  }, [setTab])
  const sipsLinkDone = useRef(false)
  useEffect(() => {
    if (!sipsLink || sipsLinkDone.current || !ready) return
    sipsLinkDone.current = true
    goTo("assets", "sips")
  }, [sipsLink, ready, goTo])

  const viewAll = (to: TabId, label: string, anchor?: string) => (
    <button className="-my-2 py-2 text-primary underline-offset-4 hover:underline" onClick={() => goTo(to, anchor)}>
      {label}
    </button>
  )

  return (
    <OpenFundContext.Provider value={setFund}>
    <div className="min-h-svh">
      <AppHeader
        me={me}
        onHome={() => setTab("overview")}
        nav={ready ? <TabNav tab={tab} onChange={setTab} counts={{ assets: view.allHoldings.length + view.fixed.length }} /> : undefined}
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
        {data && data.members.length === 0 && (data.building ? <BuildingState /> : (
          <Onboarding
            onAdded={load}
            fixedIncome={
              <Cell className="md:col-span-6 lg:col-span-12" delay={200} lift={false} label="Fixed income">
                <CellHead title="Fixed income" aside={assetRows.length ? <AddAssetButton onClick={() => setAssetDlg({ kind: "add" })} /> : undefined} />
                <FixedIncome rows={assetRows} failed={assets.failed} onAction={setAssetDlg} onChanged={assets.reload} />
              </Cell>
            }
          />
        ))}

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
                  <HeroFigures total={view.grandTotal} change={view.change} prev={view.prev} />
                  {view.est.n > 0 && (
                    <p className="mt-3 max-w-xl text-[13px] text-muted-foreground">
                      At the latest NAV, with {view.est.n} SIP instalment{view.est.n === 1 ? "" : "s"} ({inr(view.est.amount)}) estimated since
                      your statement of {day(view.asOf)}
                      {view.est.running > 0 && <>, {view.est.running} still in progress</>}. A newer statement replaces the estimates.
                    </p>
                  )}
                  <div className="mt-6">
                    {view.dashReturns?.complete ? (
                      <ReturnBoxes returns={view.dashReturns} />
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
                    {view.historyNote && (
                      <p className="mt-3 flex items-start gap-2 text-[13px] text-muted-foreground" role="status">
                        {view.historyNote === "waiting" ? <Loader2Icon className="mt-0.5 size-3.5 shrink-0 animate-spin" /> : <InfoIcon className="mt-0.5 size-3.5 shrink-0" />}
                        {view.historyNote === "waiting"
                          ? "Enriching your chart: we're fetching daily NAVs for funds you've sold. Until then those months use the NAVs printed in your statement. It updates by itself."
                          : "Some months use the NAVs printed in your statement: daily NAVs aren't available for a fund you've sold."}
                      </p>
                    )}
                  </div>
                </Cell>

                <Cell className="md:col-span-6 lg:col-span-4" delay={80} label="Allocation">
                  <CellHead title="Allocation" aside={<span className="eyebrow">{view.allSlices.length} categories</span>} />
                  <AllocationDonut
                    slices={view.allSlices}
                    total={view.grandTotal}
                    funds={view.allHoldings.length}
                    others={view.fixed.length}
                    onSelect={(c) => {
                      if (!view.slices.some((s) => s.category === c)) return openFixedIncome() // FD, PPF, EPF
                      const h = view.allHoldings.find((x) => x.category === c)
                      setAssetKind(h ? holdingKind(h) : null)
                      setCategory(c); setHovered(null); setTab("assets")
                    }}
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
                  <CellHead title="Top holdings" aside={viewAll("assets", `View all ${view.allHoldings.length + view.fixed.length}`)} />
                  <HoldingBars holdings={view.allHoldings} total={view.total} members={memberMap} showMember={showMember} />
                </Cell>
                <Cell className="md:col-span-6 lg:col-span-5" delay={390} label="Upcoming SIPs">
                  <CellHead
                    title="Upcoming SIPs"
                    aside={upcoming.list.length ? <span className="eyebrow">Next {upcoming.days} day{upcoming.days === 1 ? "" : "s"}</span> : undefined}
                  />
                  <SipTimeline upcoming={upcoming} members={memberMap} showMember={showMember} />
                  {activeSips.length > 0 && <div className="mt-2 text-[13px]"><button className="-my-2 py-2 text-primary underline-offset-4 hover:underline" onClick={() => { setAssetKind("mf"); setCategory(null); goTo("assets", "sips") }}>View all SIPs</button></div>}
                </Cell>

                <div id="fixed-income" className="scroll-mt-24 md:col-span-6 lg:col-span-12">
                  <Cell className="h-full" delay={420} lift={false} label="Fixed income">
                    <CellHead
                      title="Fixed income"
                      aside={view.fixed.length ? <span className="flex items-center gap-3"><span className="eyebrow">{inr(view.fixedTotal)}</span><AddAssetButton onClick={() => setAssetDlg({ kind: "add", member: who === EVERYONE ? undefined : who })} /></span> : undefined}
                    />
                    <FixedIncome rows={view.fixed} memberName={showMember ? assetMemberName : undefined} failed={assets.failed} onAction={setAssetDlg} onChanged={assets.reload} />
                  </Cell>
                </div>

                <Cell className="md:col-span-6 lg:col-span-12" delay={440} lift={false} label="Latest transactions">
                  <CellHead title="Latest transactions" aside={view.activity.length ? viewAll("transactions", "View all") : undefined} />
                  <ActivityGrid items={view.activity.slice(0, 6)} members={memberMap} showMember={showMember} />
                </Cell>
              </div>
            )}

            {tab === "assets" && (
              <AssetsView
                holdings={view.allHoldings}
                fixed={view.fixed}
                total={view.grandTotal}
                kind={assetKind}
                onKind={setAssetKind}
                category={category}
                onCategory={setCategory}
                hovered={hovered}
                onHover={setHovered}
                members={memberMap}
                showMember={showMember}
                oneDay={oneDay}
                sips={view.sips}
                sipsMissing={view.sipsMissing}
                onSipsChanged={load}
                assetMemberName={showMember ? assetMemberName : undefined}
                assetsFailed={assets.failed}
                onAssetAction={setAssetDlg}
                onAssetsChanged={assets.reload}
              />
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
                  <AllocationBreakdown holdings={view.allHoldings} total={view.total} fixedIncome={view.fixedTotal} />
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
      <AssetDialogs state={assetDlg} members={pickMembers} rates={assets.rates} onClose={() => setAssetDlg(null)} onSaved={assets.reload} />
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
