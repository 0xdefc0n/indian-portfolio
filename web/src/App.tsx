import { BuildingIcon, FileTextIcon, InfoIcon, Loader2Icon } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { AppHeader } from "@/components/app-header"
import { LegalFooter } from "@/components/legal-footer"
import { type AddPick, AddAssetDialog, AddAssetTrigger, type Have } from "@/components/add-asset-dialog"
import { type AssetDialogState, AssetDialogs } from "@/components/asset-dialogs"
import { AddAssetButton, FixedIncome, GoldSilver } from "@/components/fixed-income"
import type { Slice } from "@/components/allocation-strip"
import { AssetsView } from "@/components/assets-view"
import { AllocationDonut } from "@/components/allocation-donut"
import { type AssetClass, AssetClasses, FamilyCard, type FamilyRow } from "@/components/family"
import { type AssetKind, holdingKind } from "@/lib/asset-kind"
import { BottomNav, type TabId, TabNav, useTab } from "@/components/tab-nav"
import { TransactionsView } from "@/components/transactions-view"
import { AllocationBreakdown, BenchmarkComparison, FundPerformance, FundReturns, MoneyFlow, UpsAndDowns } from "@/components/insights"
import { PageTitle, Panel } from "@/components/panel"
import { OfflinePanel } from "@/components/pwa"
import { useAutoInstallPrompt, useReloadWhenOnline } from "@/lib/pwa"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ValueChart } from "@/components/value-chart"
import { FundDialog } from "@/components/fund-dialog"
import { StockExposure } from "@/components/stock-exposure"
import {
  ActivityGrid, Cell, CellHead, HeroFigures, HoldingBars, PartialNotice, ReturnBoxes, type Returns, SipTimeline,
} from "@/components/overview"
import { Segmented } from "@/components/ui/segmented"
import { OpenFundContext } from "@/lib/fund-context"
import {
  api, type Daily, type Holding, isOffline, type MarketStatus, type Me, type Member, type Portfolio, SignedOut, type StockCost, waitForPortfolio,
} from "@/lib/api"
import { DailyReturns } from "@/components/daily-returns"
import { byFund } from "@/lib/daily"
import { day, inr, inrShort, monthly, pct } from "@/lib/format"
import { cn } from "@/lib/utils"
import { upcomingSips } from "@/lib/sips"
import { holdingFlows, xirr } from "@/lib/xirr"
import { assetFlows, assetTotals, fixedOnly, forMember, metalsOnly, revalueSgbs, useAssets, valued } from "@/lib/assets"

const EVERYONE = "all"

/** A link that opens Add asset on the statement upload. */
function RequestLink({ onOpen, label }: { onOpen: () => void; label: string }) {
  return <button type="button" onClick={onOpen} className="-my-2 py-2 text-left text-primary underline-offset-4 hover:underline">{label}</button>
}

const flowsLabel = (members: Member[]) =>
  members.every((m) => m.history_source === "transactions") ? "From your transactions" : "Portfolio value"

function MemberSwitch({ members, value, onChange }: { members: Member[]; value: string; onChange: (v: string) => void }) {
  const options = [{ id: EVERYONE, label: "Everyone" }, ...members.map((m) => ({ id: m.id, label: m.name.split(" ")[0] }))]
  return <Segmented kind="radio" label="Show portfolio for" size="sm" value={value} onChange={onChange} options={options} />
}

/** Onboarding for an empty household (plan §13 item 4): what to upload, and how to get it. */
function Onboarding({ onAdd, fixedIncome }: { onAdd: () => void; fixedIncome: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-4 pt-3 sm:pt-4 md:grid-cols-6 lg:grid-cols-12">
      <Cell className="glass-hero flex flex-col justify-center sm:p-8 md:col-span-6 lg:col-span-7" lift={false} label="Welcome">
        <span className="eyebrow">Welcome to PocketFolio</span>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Your family's investments, in one place</h1>
        <p className="mt-3 max-w-xl text-muted-foreground">
          Add a consolidated statement for each family member. We'll file it under the right person automatically and
          keep the dashboard on the latest NAVs.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button size="lg" className="h-11" onClick={onAdd}>Add asset</Button>
        </div>
      </Cell>
      {/* which statement to add, right beside the button that adds it */}
      <div className="flex min-w-0 flex-col gap-4 md:col-span-6 lg:col-span-5">
      <Cell className="flex-1" delay={80} label="CDSL eCAS">
        <div className="mb-4 grid size-10 place-items-center rounded-xl bg-background ring-1 ring-border">
          <BuildingIcon className="size-5 text-primary" />
        </div>
        <h2 className="text-[15px] font-semibold tracking-tight">CDSL eCAS</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Everything held in demat (funds and shares), with month-end values. The password is usually the PAN in capital
          letters.
        </p>
      </Cell>
      <Cell className="flex-1" delay={140} label="CAMS / KFintech CAS">
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
      {fixedIncome}
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
      <Skeleton className="h-[540px] rounded-[24px] lg:col-span-8" />
      <Skeleton className="h-[540px] rounded-[24px] lg:col-span-4" />
      {/* the four asset-class cards */}
      {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-36 rounded-[20px] lg:col-span-3" />)}
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

  // Manual buy prices of shares (M21), for the holding dialog's form. Not needed to draw the dashboard.
  const [costs, setCosts] = useState<StockCost[]>([])
  const load = useCallback(() => {
    api.tradebooks().then((t) => setCosts(t.costs), () => undefined)
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
  // Add asset (one dialog for the page): "list" opens the list, a pick opens that form
  const [add, setAdd] = useState<AddPick | "list" | null>(shortcut === "add" ? "list" : null)

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
  // the hero's chip: today's change once daily returns are in (M12), else the month-on-month change
  const todayChange = daily?.today && daily.today.pct && daily.as_of ? { change: daily.today.change, base: daily.today.change / daily.today.pct, date: daily.as_of } : null
  const dailyReady = !!daily && daily.series.length >= 2

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
    // SGBs in demat are valued at today's gold rate and filed under Gold & silver (M29)
    const holdings = revalueSgbs(data.holdings.filter((h) => ids.has(h.member_id)), assets.rates)
    const total = holdings.reduce((s, h) => s + h.value, 0)

    const byCat = new Map<string, Slice>()
    for (const h of holdings) {
      const s = byCat.get(h.category) ?? { category: h.category, value: 0, share: 0, funds: 0 }
      s.value += h.value
      s.funds += 1
      byCat.set(h.category, s)
    }
    const slices = [...byCat.values()].map((s) => ({ ...s, share: total ? (s.value / total) * 100 : 0 })).sort((a, b) => b.value - a.value)

    // Manual assets (M19, M29): a member's own, or everyone's (those filed under no member show only for Everyone).
    const manual = forMember(assetRows, who === EVERYONE ? null : who)
    const fixed = fixedOnly(manual)
    const metals = metalsOnly(manual)
    const fixedTotals = assetTotals(manual)
    const grandTotal = total + fixedTotals.value
    // Same category from both sides (SGB: demat and by hand) is one slice
    const byAll = new Map([...byCat].map(([k, v]) => [k, { ...v }]))
    for (const r of manual) {
      const s = byAll.get(r.category) ?? { category: r.category, value: 0, share: 0, funds: 0 }
      s.value += r.v.value
      s.funds += 1
      byAll.set(r.category, s)
    }
    const allSlices = [...byAll.values()]
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
      returns && manual.length
        ? {
            ...returns,
            invested: returns.invested + fixedTotals.invested,
            current: returns.current + fixedTotals.costValue,
            gain: returns.gain + fixedTotals.gain,
            overall: xirr([...holdingFlows(withCost), ...assetFlows(manual)]),
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
      returns, dashReturns, fixed, metals, manual, grandTotal, allSlices,
      fixedTotal: fixed.reduce((t, r) => t + r.v.value, 0),
      metalTotal: metals.reduce((t, r) => t + r.v.value, 0),
      allHoldings: holdings,
      activity: data.activity.filter((a) => ids.has(a.member_id)),
      sips: data.sips.filter((x) => ids.has(x.member_id)),
      sipsMissing: members.filter((m) => !m.sips_known),
    }
  }, [data, who, assetRows, assets.rates])

  const memberMap = useMemo(() => new Map(data?.members.map((m) => [m.id, m])), [data])

  // v2 dashboard (M24): each member's total for the Family card, Everyone first
  const family = useMemo<FamilyRow[]>(() => {
    if (!data) return []
    const all = revalueSgbs(data.holdings, assets.rates)
    const total = all.reduce((s, h) => s + h.value, 0) + assetTotals(assetRows).value
    const share = (v: number) => (total ? (v / total) * 100 : 0)
    const rows = data.members.map((m) => {
      const mine = all.filter((h) => h.member_id === m.id)
      const value = mine.reduce((s, h) => s + h.value, 0) + assetTotals(forMember(assetRows, m.id)).value
      return { id: m.id, name: m.name.split(" ")[0], value, share: share(value), detail: `${pct(share(value))} of the family · ${mine.length} holding${mine.length === 1 ? "" : "s"}` }
    })
    // FD/PPF/gold added without a member count only for Everyone, so members' shares can add up to less than 100%
    const shared = total - rows.reduce((s, r) => s + r.value, 0)
    const everyone = `${data.members.length} members${shared >= 1 ? ` · ${inrShort(shared)} not under anyone` : ""}`
    return [{ id: EVERYONE, name: "Everyone", value: total, share: 100, detail: everyone }, ...rows]
  }, [data, assetRows, assets.rates])

  // One card per asset class for the member in view (funds, listed shares and ETFs, FD/PPF/EPF, gold and silver)
  const classes = useMemo<AssetClass[]>(() => {
    if (!view) return []
    const by: Record<"mf" | "listed" | "gold", Holding[]> = { mf: [], listed: [], gold: [] }
    for (const h of view.allHoldings) {
      const k = holdingKind(h)
      by[k === "mf" ? "mf" : k === "gold" ? "gold" : "listed"].push(h)
    }
    const sum = (hs: Holding[]) => hs.reduce((s, h) => s + h.value, 0)
    const gain = (hs: Holding[]) => {
      const known = hs.filter((h) => h.invested != null)
      return known.length ? known.reduce((s, h) => s + h.value - (h.invested ?? 0), 0) : null
    }
    const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`
    const fixed = assetTotals(view.fixed), metals = assetTotals(view.metals)
    const goldGain = gain(by.gold)
    return [
      { key: "mf", label: "Mutual funds", value: sum(by.mf), gain: gain(by.mf), count: n(by.mf.length, "fund", "funds"), color: "var(--chart-1)" },
      { key: "listed", label: "Stocks & ETFs", value: sum(by.listed), gain: gain(by.listed), count: n(by.listed.length, "holding", "holdings"), color: "var(--cat-stocks)" },
      { key: "fixed", label: "FD, PPF & EPF", value: fixed.value, gain: view.fixed.length ? fixed.gain : null, count: n(view.fixed.length, "account", "accounts"), color: "var(--cat-fd)" },
      {
        key: "gold", label: "Gold & silver", value: sum(by.gold) + metals.value,
        gain: goldGain == null && !view.metals.length ? null : (goldGain ?? 0) + (view.metals.length ? metals.gain : 0),
        count: n(by.gold.length + view.metals.length, "holding", "holdings"), color: "var(--cat-gold)",
      },
    ]
  }, [view])
  const pickMembers = useMemo(() => (data?.members ?? []).map((m) => ({ id: m.id, name: m.name })), [data])
  // what the family has, for the Add asset list: kinds already added go last; buy prices show once shares lack them
  const have = useMemo<Have>(() => {
    const h: Have = { uncosted: 0 }
    for (const x of data?.holdings ?? []) {
      const k = holdingKind(x)
      if (k === "mf") h.mf = (h.mf ?? 0) + 1
      if (k === "stock" || k === "etf") {
        h.listed = (h.listed ?? 0) + 1
        if (!costs.some((c) => c.isin === x.isin && c.member_id === x.member_id)) h.uncosted! += 1
      }
    }
    for (const a of assets.assets ?? []) h[a.type] = (h[a.type] ?? 0) + 1
    return h
  }, [data, costs, assets.assets])
  const assetMemberName = (id: string | null) => (id ? memberMap.get(id)?.name.split(" ")[0] : undefined)
  const switchMember = (v: string) => { setWho(v); setCategory(null) }
  /** A donut slice: Assets, filtered to that category (FD/PPF/EPF and gold added by hand open their group). */
  const openCategory = (c: string) => {
    const h = view?.allHoldings.find((x) => x.category === c)
    const kind: AssetKind = h ? holdingKind(h) : view?.metals.some((r) => r.category === c) ? "gold" : "fixed"
    setAssetKind(kind); setCategory(h ? c : null); setHovered(null); setTab("assets")
  }
  const openClass = (key: string) => {
    const kind: AssetKind = key === "listed" ? (view?.allHoldings.some((h) => holdingKind(h) === "stock") ? "stock" : "etf") : (key as AssetKind)
    setAssetKind(kind); setCategory(null); setTab("assets")
  }
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

  useAutoInstallPrompt({ ready: !!ready, busy: updating || !!add })

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

  // Overview side column (unslop pass): only cards with something in them
  const hasSips = upcoming.list.length > 0 || upcoming.running.length > 0
  // Coming up is not first-glance information (owner): it sits at the end of the overview, only when there are SIPs
  const side = multi ? ["family"] : []
  const assetClasses = (compact: boolean) => view && (
    <>
      <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
        <h2 className="text-base font-semibold tracking-tight">Where it's invested</h2>
        <span className="eyebrow">{who === EVERYONE ? (multi ? "Whole family" : "") : view.members[0]?.name.split(" ")[0]}</span>
      </div>
      <AssetClasses
        compact={compact}
        classes={classes}
        total={view.grandTotal}
        onOpen={openClass}
        addable={{
          fixed: { label: "Add FD, PPF or EPF", onAdd: () => setAssetDlg({ kind: "add", group: "fixed", member: who === EVERYONE ? undefined : who }) },
          gold: { label: "Add gold or silver", onAdd: () => setAssetDlg({ kind: "add", group: "metal", member: who === EVERYONE ? undefined : who }) },
        }}
      />
    </>
  )

  const viewAll = (to: TabId, label: string, anchor?: string) => (
    <button className="-my-3 inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline" onClick={() => goTo(to, anchor)}>
      {label}
    </button>
  )

  return (
    <OpenFundContext.Provider value={setFund}>
    <div className="min-h-svh">
      <AppHeader
        me={me}
        onHome={() => setTab("overview")}
        nav={ready ? <TabNav tab={tab} onChange={setTab} counts={{ assets: view.allHoldings.length + view.manual.length }} /> : undefined}
        actions={data && data.members.length > 0 ? <AddAssetTrigger onClick={() => setAdd("list")} /> : undefined}
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
            onAdd={() => setAdd("list")}
            fixedIncome={
              <>
                <Cell className="md:col-span-3 lg:col-span-6" delay={200} lift={false} label="Fixed income">
                  <CellHead title="Fixed income" aside={fixedOnly(assetRows).length ? <AddAssetButton onClick={() => setAssetDlg({ kind: "add", group: "fixed" })} /> : undefined} />
                  <FixedIncome rows={fixedOnly(assetRows)} failed={assets.failed} onAction={setAssetDlg} onChanged={assets.reload} />
                </Cell>
                <Cell className="md:col-span-3 lg:col-span-6" delay={240} lift={false} label="Gold and silver">
                  <CellHead title="Gold & silver" aside={metalsOnly(assetRows).length ? <AddAssetButton onClick={() => setAssetDlg({ kind: "add", group: "metal" })} /> : undefined} />
                  <GoldSilver rows={metalsOnly(assetRows)} failed={assets.failed} onAction={setAssetDlg} onChanged={assets.reload} />
                </Cell>
              </>
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
              // v2 after the unslop pass: every figure once. Phone order (max-lg): hero, asset classes, coming up,
              // family, holdings, activity. Desktop: hero with Family and Coming up beside it, then the rest.
              <div className="grid grid-cols-1 gap-4 md:grid-cols-6 lg:grid-cols-12 lg:gap-5">
                <Cell className={cn("glass-hero flex flex-col sm:p-7 md:col-span-6", side.length ? "lg:col-span-8" : "lg:col-span-12")} lift={false} label="Portfolio value">
                  <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                    {multi ? <div className="lg:hidden"><MemberSwitch members={data.members} value={who} onChange={switchMember} /></div> : <span />}
                    {view.valueDate && <span className="eyebrow">NAVs of {day(view.valueDate)}</span>}
                  </div>
                  <HeroFigures
                    total={view.grandTotal}
                    change={view.change}
                    prev={view.prev}
                    today={todayChange}
                    label={who === EVERYONE ? (multi ? "Family net worth" : "Net worth") : `${view.members[0]?.name.split(" ")[0]}'s net worth`}
                  />
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
                  <div className="mt-6 border-t border-border pt-4">
                    {view.dashReturns?.complete ? (
                      <div className="pt-1"><ReturnBoxes returns={view.dashReturns} /></div>
                    ) : view.returns ? (
                      <PartialNotice
                        inline
                        returns={view.returns}
                        included={view.allHoldings.filter((h) => h.invested != null && h.cashflows?.length).map((h) => h.name)}
                        missing={view.allHoldings.filter((h) => !(h.invested != null && h.cashflows?.length)).map((h) => h.name)}
                        total={view.total}
                        request={(label) => <RequestLink onOpen={() => setAdd("mf")} label={label} />}
                      />
                    ) : (
                      <p className="max-w-xl text-sm text-muted-foreground">
                        Invested amount, returns and XIRR show here once a fund has its full purchase history.{" "}
                        <RequestLink onOpen={() => setAdd("mf")} label="Add a full CAMS / KFintech statement" />
                      </p>
                    )}
                  </div>
                </Cell>

                {/* Beside the hero: Family (2+ members) with the asset classes as a 2×2 grid under it, so the column matches
                    the hero. One member: the hero takes the full width and the asset classes follow in a row. */}
                {side.length > 0 && (
                  <div className="flex min-w-0 flex-col gap-4 max-lg:order-3 md:col-span-6 lg:col-span-4 lg:gap-5">
                    {side.includes("family") && (
                      <Cell className="max-lg:order-2" delay={80} lift={false} label="Family">
                        <CellHead title="Family" aside={<span className="text-muted-foreground">Tap to focus</span>} />
                        <FamilyCard rows={family} value={who} onChange={switchMember} />
                      </Cell>
                    )}
                    {side.length === 1 && <div className="hidden lg:block">{assetClasses(true)}</div>}
                  </div>
                )}

                <section aria-label="Where it's invested" className={cn("max-lg:order-2 md:col-span-6 lg:col-span-12", side.length === 1 && "lg:hidden")}>
                  {assetClasses(false)}
                </section>

                {/* Two half-and-half rows (owner): holdings beside allocation, then coming up beside recent activity.
                    A card with nothing to show drops out and its partner takes the full width. */}
                <Cell className={cn("max-lg:order-4 md:col-span-6", view.allSlices.length ? "lg:col-span-6" : "lg:col-span-12")} delay={340} label="Top holdings">
                  <CellHead title="Top holdings" aside={viewAll("assets", `View all ${view.allHoldings.length + view.manual.length}`)} />
                  <HoldingBars holdings={view.allHoldings} total={view.total} members={memberMap} showMember={showMember} />
                </Cell>
                {view.allSlices.length > 0 && (
                  <Cell className="flex flex-col max-lg:order-5 md:col-span-6 lg:col-span-6" delay={380} label="Allocation">
                    <CellHead title="Allocation" aside={<span className="text-muted-foreground">{view.allSlices.length} categories</span>} />
                    {/* centred in the card, so a taller Top holdings beside it never leaves a gap at the bottom */}
                    <div className="flex flex-1 flex-col justify-center">
                      <AllocationDonut side slices={view.allSlices} total={view.grandTotal} funds={view.allHoldings.length} others={view.manual.length} onSelect={openCategory} />
                    </div>
                  </Cell>
                )}

                {hasSips && (
                  <Cell className={cn("max-lg:order-6 md:col-span-6", view.activity.length ? "lg:col-span-6" : "lg:col-span-12")} delay={420} label="Coming up">
                    <CellHead
                      title="Coming up"
                      aside={activeSips.length ? (
                        <span className="text-muted-foreground">
                          {inr(activeSips.reduce((t, x) => t + monthly(x.amount, x.frequency), 0))} a month · {activeSips.length} SIP{activeSips.length === 1 ? "" : "s"}
                        </span>
                      ) : undefined}
                    />
                    <SipTimeline upcoming={upcoming} members={memberMap} showMember={showMember} />
                    {activeSips.length > 0 && <div className="mt-2 text-[13px]"><button className="-my-3 inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline" onClick={() => { setAssetKind("mf"); setCategory(null); goTo("assets", "sips") }}>View all SIPs</button></div>}
                  </Cell>
                )}
                {view.activity.length > 0 && (
                  <Cell className={cn("max-lg:order-7 md:col-span-6", hasSips ? "lg:col-span-6" : "lg:col-span-12")} delay={460} label="Recent activity">
                    <CellHead title="Recent activity" aside={viewAll("transactions", "View all")} />
                    {/* beside Coming up: about as many rows as its timeline and list take; alone: two columns */}
                    <ActivityGrid
                      items={view.activity.slice(0, hasSips ? Math.min(5, upcoming.list.length + upcoming.running.length + 2) : 6)}
                      members={memberMap}
                      showMember={showMember}
                      columns={hasSips ? 1 : 2}
                    />
                  </Cell>
                )}
              </div>
            )}

            {tab === "assets" && (
              <AssetsView
                holdings={view.allHoldings}
                fixed={view.fixed}
                metals={view.metals}
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
                <PageTitle title="Insights" detail="Worked out from the uploaded statements" />

                <Panel title="Allocation" aside={`${view.allSlices.length} categories`}>
                  {/* the donut by category on the left; asset class and fund house stacked beside it */}
                  <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12">
                    <AllocationDonut slices={view.allSlices} total={view.grandTotal} funds={view.allHoldings.length} others={view.manual.length} onSelect={openCategory} />
                    <AllocationBreakdown stacked holdings={view.allHoldings} total={view.total} fixedIncome={view.fixedTotal} gold={view.metalTotal} />
                  </div>
                </Panel>

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

                {dailyReady && (
                  <div id="daily-returns" className="scroll-mt-24">
                    <Panel title="Daily returns">
                      <DailyReturns daily={daily} />
                    </Panel>
                  </div>
                )}

                <Panel title="Your returns by fund" aside="Funds with full purchase history">
                  <FundPerformance holdings={view.allHoldings} members={memberMap} showMember={showMember} />
                </Panel>

                {data?.stocks?.enabled && (
                  <Panel title="Stocks you own through funds">
                    <StockExposure holdings={view.allHoldings} total={view.total} members={view.members} showMember={showMember} data={data.stocks} />
                  </Panel>
                )}

                <Panel title="Fund track record" aside="Fund NAV returns">
                  <FundReturns holdings={view.allHoldings} benchmark={data?.benchmark ?? null} />
                </Panel>

                <Panel title="Money in and out">
                  <MoneyFlow analyses={view.members.map((m) => m.analysis)} activity={view.activity} members={memberMap} showMember={showMember} />
                </Panel>

                {!dailyReady && (
                  // no daily NAVs yet (or still loading): a quiet line at the end instead of an empty panel at the top
                  <div id="daily-returns" className="scroll-mt-24">
                    <Panel title="Daily returns">
                      <DailyReturns daily={daily} />
                    </Panel>
                  </div>
                )}
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
      <AddAssetDialog trigger={null} open={!!add} start={add && add !== "list" ? add : undefined} onOpenChange={(o) => { if (!o) setAdd(null) }}
        onAdded={load} onAssetSaved={assets.reload} members={pickMembers} rates={assets.rates} have={have} member={who === EVERYONE ? undefined : who} />
      <AssetDialogs state={assetDlg} members={pickMembers} rates={assets.rates} onClose={() => setAssetDlg(null)} onSaved={assets.reload} onState={setAssetDlg} />
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
        costs={costs}
        onChanged={() => {
          setFund(null)
          load()
        }}
      />
    </div>
    </OpenFundContext.Provider>
  )
}
