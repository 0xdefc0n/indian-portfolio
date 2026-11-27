import { ChevronDownIcon } from "lucide-react"
import { useState } from "react"
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, XAxis, YAxis } from "recharts"

import { type ChartConfig, ChartContainer, ChartTooltip } from "@/components/ui/chart"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { Activity, Analysis, Holding, Member, Returns } from "@/lib/api"
import { ASSET_COLOR, day, inr, inrShort, month, pct, signed, units } from "@/lib/format"
import { cn } from "@/lib/utils"
import { holdingFlows, xirr } from "@/lib/xirr"
import { useOpenFund } from "@/lib/fund-context"
import { FundButton } from "@/components/holdings-table"

/** X-axis ticks for monthly charts: one per year on long series, months otherwise. */
function monthAxis(months: string[]) {
  const long = months.length > 24
  return {
    ticks: long ? months.filter((m) => m.endsWith("-01")) : undefined,
    interval: long ? (0 as const) : ("preserveStartEnd" as const),
    minTickGap: long ? 8 : 24,
    tickFormatter: (m: string, i: number) => (long ? m.slice(0, 4) : month(m, i === 0 || m.endsWith("-01"))),
  }
}

/* ------------------------------------------------------------------ bar list */

type Row = { label: string; value: number; color?: string }

/** Horizontal bars, largest first: label, bar, share. */
export function BarList({ rows, total }: { rows: Row[]; total: number }) {
  const sorted = [...rows].sort((a, b) => b.value - a.value)
  return (
    <ul className="space-y-3">
      {sorted.map((r) => {
        const share = total ? (r.value / total) * 100 : 0
        return (
          <li key={r.label} className="text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate">{r.label}</span>
              <span className="shrink-0 text-muted-foreground">
                <span className="mr-2 text-foreground">{inr(r.value)}</span>
                {pct(share)}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full" style={{ width: `${share}%`, background: r.color ?? "var(--primary)" }} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function sumBy(hs: Holding[], key: (h: Holding) => string): Row[] {
  const m = new Map<string, number>()
  for (const h of hs) m.set(key(h), (m.get(key(h)) ?? 0) + h.value)
  return [...m.entries()].map(([label, value]) => ({ label, value }))
}

/**
 * Asset class and fund house splits, with plain-language concentration notes. `fixedIncome`: FD, PPF and EPF entered
 * by hand (M19), counted under Debt in the asset-class split only.
 */
export function AllocationBreakdown({ holdings, total, fixedIncome = 0, gold = 0 }: { holdings: Holding[]; total: number; fixedIncome?: number; gold?: number }) {
  const classes = sumBy(holdings, (h) => h.asset_class)
  const addTo = (label: string, value: number) => {
    if (value <= 0) return
    const row = classes.find((r) => r.label === label)
    if (row) row.value += value
    else classes.push({ label, value })
  }
  addTo("Debt", fixedIncome)
  addTo("Gold & silver", gold) // gold, silver and SGBs added by hand (M29)
  const assets = classes.sort((x, y) => y.value - x.value).map((r) => ({ ...r, color: ASSET_COLOR[r.label] }))
  const amcs = sumBy(holdings, (h) => h.amc || "Other")
  const top = [...amcs].sort((a, b) => b.value - a.value)[0]
  const biggest = [...holdings].sort((a, b) => b.value - a.value)[0]
  const notes: string[] = []
  if (top && total && top.value / total > 0.4 && amcs.length > 1) notes.push(`${pct((top.value / total) * 100, 0)} is with one fund house (${top.label}).`)
  if (biggest && total && biggest.value / total > 0.3) notes.push(`${biggest.name} alone is ${pct((biggest.value / total) * 100, 0)} of the portfolio.`)
  notes.push(...categoryOverlap(holdings))

  return (
    <div>
      <div className="grid gap-8 md:grid-cols-2">
        <section>
          <h3 className="mb-3 text-sm font-medium text-muted-foreground">Asset class</h3>
          <BarList rows={assets} total={total + fixedIncome + gold} />
          {fixedIncome > 0 && <p className="mt-2 text-[13px] text-muted-foreground">Debt includes your FDs, PPF and EPF.</p>}
          {gold > 0 && <p className="mt-2 text-[13px] text-muted-foreground">Gold &amp; silver includes what you added by hand.</p>}
        </section>
        <section>
          <h3 className="mb-3 text-sm font-medium text-muted-foreground">Fund house</h3>
          <BarList rows={amcs} total={total} />
        </section>
      </div>
      {notes.length > 0 && (
        <ul className="mt-6 space-y-1 border-t pt-4 text-sm text-muted-foreground">
          {notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ performance */

/** Per-fund returns for funds whose whole purchase history is known. */
export function FundPerformance({ holdings, members, showMember }: { holdings: Holding[]; members: Map<string, Member>; showMember: boolean }) {
  const openFund = useOpenFund()
  const rows = holdings
    .filter((h) => h.invested != null && h.cashflows?.length)
    .map((h) => ({ h, x: xirr(holdingFlows([h])), gain: h.value - (h.invested ?? 0) }))
    .sort((a, b) => (b.x ?? -9) - (a.x ?? -9))
  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">Needs a CAMS / KFintech statement that starts from the first investment.</p>
  }
  return (
    <>
    {/* phones: one card per fund, figures under the name */}
    <ul className="divide-y sm:hidden">
      {rows.map(({ h, x, gain }) => (
        <li key={`${h.member_id}-${h.isin}`}>
          <button type="button" onClick={() => openFund(h)} className="w-full py-3 text-left">
            <div className="text-sm leading-snug font-medium">{h.name}</div>
            <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
              {h.tax?.since && <span>Since {day(h.tax.since)}</span>}
              {showMember && <span>{members.get(h.member_id)?.name.split(" ")[0]}</span>}
            </div>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
              <div><dt className="eyebrow">Invested</dt><dd className="mt-0.5 tabular-nums">{inr(h.invested)}</dd></div>
              <div>
                <dt className="eyebrow">Gain</dt>
                <dd className={cn("mt-0.5 tabular-nums", gain >= 0 ? "text-gain" : "text-loss")}>
                  {signed(gain, inr)}
                  <span className="block text-xs text-muted-foreground">{signed((gain / (h.invested || 1)) * 100, (n) => pct(n))}</span>
                </dd>
              </div>
              <div className="text-right">
                <dt className="eyebrow">XIRR</dt>
                <dd className={cn("mt-0.5 font-medium tabular-nums", (x ?? 0) >= 0 ? "text-gain" : "text-loss")}>{x == null ? "—" : signed(x * 100, (n) => pct(n))}</dd>
              </div>
            </dl>
          </button>
        </li>
      ))}
    </ul>
    <Table className="hidden sm:table">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-full pl-0">Fund</TableHead>
          <TableHead className="hidden px-4 text-right sm:table-cell">Invested</TableHead>
          <TableHead className="px-4 text-right">Gain</TableHead>
          <TableHead className="pr-0 text-right">XIRR</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ h, x, gain }) => (
          <TableRow key={`${h.member_id}-${h.isin}`} onClick={() => openFund(h)} className="cursor-pointer hover:bg-muted/50">
            <TableCell className="py-3 pr-4 pl-0 whitespace-normal">
              <FundButton>{h.name}</FundButton>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {h.tax?.since && <>Since {day(h.tax.since)}</>}
                {showMember && <span className="ml-3">{members.get(h.member_id)?.name.split(" ")[0]}</span>}
              </div>
            </TableCell>
            <TableCell className="hidden px-4 text-right text-muted-foreground sm:table-cell">{inr(h.invested)}</TableCell>
            <TableCell className="px-4 text-right">
              <div className={gain >= 0 ? "text-gain" : "text-loss"}>{signed(gain, inr)}</div>
              <div className="text-xs text-muted-foreground">{signed((gain / (h.invested || 1)) * 100, (n) => pct(n))}</div>
            </TableCell>
            <TableCell className={cn("pr-0 text-right font-medium", (x ?? 0) >= 0 ? "text-gain" : "text-loss")}>
              {x == null ? "—" : signed(x * 100, (n) => pct(n))}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
    </>
  )
}

/* ------------------------------------------------------------------ money flow */

const flowConfig = {
  invested: { label: "Money in", color: "var(--primary)" },
  withdrawn: { label: "Withdrawn", color: "var(--loss)" },
} satisfies ChartConfig

function Line({ label, value, detail, strong, tone }: { label: string; value: string; detail?: string; strong?: boolean; tone?: "gain" | "loss" }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className={cn(strong ? "font-medium" : "text-muted-foreground")}>
        {label}
        {detail && <span className="ml-1.5 text-xs text-muted-foreground">{detail}</span>}
      </dt>
      <dd className={cn(strong ? "text-base font-semibold" : "", tone === "gain" && "text-gain", tone === "loss" && "text-loss")}>{value}</dd>
    </div>
  )
}

export function MoneyFlow({ analyses, activity, members, showMember }: {
  analyses: Analysis[]
  activity: Activity[]
  members: Map<string, Member>
  showMember: boolean
}) {
  const [open, setOpen] = useState(false)
  const byMonth = new Map<string, { month: string; invested: number; withdrawn: number }>()
  let sip = 0, lumpsum = 0, stamp = 0, stt = 0, tds = 0, dividends = 0, redeemed = 0, switched = 0
  const periods: string[] = []
  for (const a of analyses) {
    for (const r of a.money.monthly) {
      const cur = byMonth.get(r.month) ?? { month: r.month, invested: 0, withdrawn: 0 }
      cur.invested += r.invested
      cur.withdrawn += r.withdrawn
      byMonth.set(r.month, cur)
    }
    const m = a.money
    sip += m.sip; lumpsum += m.lumpsum; stamp += m.stamp_duty; stt += m.stt; tds += m.tds ?? 0
    dividends += m.dividends; redeemed += m.redeemed ?? 0; switched += m.switched ?? 0
    if (m.period?.[0]) periods.push(m.period[0])
  }
  const data = [...byMonth.values()].filter((d) => d.invested || d.withdrawn).sort((a, b) => a.month.localeCompare(b.month))
  if (!data.length) {
    return <p className="text-sm text-muted-foreground">Needs a CAMS / KFintech statement; CDSL statements don't include amounts.</p>
  }
  const moneyIn = sip + lumpsum + stamp
  const taxes = stt + tds
  const received = redeemed - taxes
  const moneyOut = received + dividends
  const net = moneyIn - moneyOut
  const hasWithdrawals = data.some((d) => d.withdrawn > 0)
  const withdrawals = activity.filter((a) => a.kind === "redemption" && a.amount)

  return (
    <div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="flex items-center gap-2 text-muted-foreground"><span className="size-2 rounded-full bg-primary" />Total in</dt>
          <dd className="mt-0.5 text-xl font-semibold">{inr(moneyIn)}</dd>
          <dd className="text-xs text-muted-foreground">{moneyIn ? `${pct((sip / moneyIn) * 100, 0)} through SIPs` : null}</dd>
        </div>
        <div>
          <dt className="flex items-center gap-2 text-muted-foreground"><span className="size-2 rounded-full bg-loss" />Total out</dt>
          <dd className="mt-0.5 text-xl font-semibold">{inr(moneyOut)}</dd>
          <dd className="text-xs text-muted-foreground">
            {withdrawals.length ? `${withdrawals.length} withdrawal${withdrawals.length > 1 ? "s" : ""}` : "No withdrawals"}
          </dd>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <dt className="text-muted-foreground">Net invested</dt>
          <dd className="mt-0.5 text-xl font-semibold">{inr(net)}</dd>
          <dd className="text-xs text-muted-foreground">{moneyIn ? `${pct((moneyOut / moneyIn) * 100, 0)} has come back out` : null}</dd>
        </div>
      </dl>

      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="mt-5 inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {open ? "Hide details" : "Show details"}
        <ChevronDownIcon className={cn("size-4 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="mt-5 border-t pt-5">
          <div className="grid gap-x-10 gap-y-6 sm:grid-cols-2">
            <section>
              <h3 className="mb-1 flex items-center gap-2 text-sm font-medium">
                <span className="size-2 rounded-full bg-primary" /> Money in
              </h3>
              <dl className="divide-y text-sm">
                <Line label="SIPs" value={inr(sip)} detail={moneyIn ? pct((sip / moneyIn) * 100, 0) : undefined} />
                <Line label="One-time purchases" value={inr(lumpsum)} />
                <Line label="Stamp duty" value={inr(stamp)} />
                <Line label="Total in" value={inr(moneyIn)} strong />
              </dl>
            </section>
            <section>
              <h3 className="mb-1 flex items-center gap-2 text-sm font-medium">
                <span className="size-2 rounded-full bg-loss" /> Money out
              </h3>
              <dl className="divide-y text-sm">
                <Line label="Withdrawn" value={inr(redeemed)} detail={withdrawals.length ? `${withdrawals.length}×` : undefined} />
                <Line label="Tax deducted" value={taxes ? `−${inr(taxes)}` : inr(0)} detail={stt && tds ? "STT, TDS" : tds ? "TDS" : "STT"} />
                <Line label="Dividends paid out" value={inr(dividends)} />
                <Line label="Total out" value={inr(moneyOut)} strong />
              </dl>
            </section>
          </div>

          <ChartContainer config={flowConfig} className="mt-8 aspect-auto h-[200px] w-full">
            <BarChart data={data} margin={{ left: 4, right: 4, top: 4, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="2 4" />
              <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} {...monthAxis(data.map((d) => d.month))} />
              <YAxis width={52} tickLine={false} axisLine={false} tickFormatter={(v: number) => inrShort(v)} tickCount={4} />
              <ChartTooltip
                cursor={{ fill: "var(--muted)" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const p = payload[0].payload as { month: string; invested: number; withdrawn: number }
                  return (
                    <div className="rounded-lg border bg-popover px-3 py-2 text-sm shadow-md">
                      <div className="text-muted-foreground">{month(p.month, true)}</div>
                      {p.invested > 0 && <div>In {inr(p.invested)}</div>}
                      {p.withdrawn > 0 && <div className="text-loss">Out {inr(p.withdrawn)}</div>}
                    </div>
                  )
                }}
              />
              <Bar dataKey="invested" isAnimationActive={false} fill="var(--color-invested)" radius={[4, 4, 0, 0]} maxBarSize={28} />
              {hasWithdrawals && <Bar dataKey="withdrawn" isAnimationActive={false} fill="var(--color-withdrawn)" radius={[4, 4, 0, 0]} maxBarSize={28} />}
            </BarChart>
          </ChartContainer>

          {withdrawals.length > 0 && (
            <section className="mt-6 border-t pt-4">
              <h3 className="mb-1 text-sm font-medium">Withdrawals</h3>
              <ul className="divide-y text-sm">
                {withdrawals.map((a, i) => (
                  <li key={`${a.member_id}-${a.isin}-${a.date}-${i}`} className="flex items-baseline justify-between gap-4 py-2.5">
                    <div className="min-w-0">
                      <div className="leading-snug">{a.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {day(a.date)}
                        {showMember && <span className="ml-3">{members.get(a.member_id)?.name.split(" ")[0]}</span>}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-loss">{inr(Math.abs(a.amount ?? 0))}</div>
                      <div className="text-xs text-muted-foreground">{units(Math.abs(a.units))} units</div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <p className="mt-3 text-xs text-muted-foreground">
            {periods.length > 0 && <>Covers the CAMS / KFintech statement period, from {day(periods.sort()[0])}. </>}
            {switched > 0 && <>{inr(switched)} moved between funds through switches isn't counted as money in or out.</>}
          </p>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ overlap */

/** Equity funds sharing a SEBI category usually hold many of the same stocks. */
function categoryOverlap(holdings: Holding[]): string[] {
  const byCat = new Map<string, Map<string, string>>()
  for (const h of holdings) {
    if (h.asset_class !== "Equity") continue
    const cat = (h.sebi_category ?? h.category).replace(/\s+Fund$/i, "")
    const funds = byCat.get(cat) ?? new Map<string, string>()
    funds.set(h.isin, h.name)
    byCat.set(cat, funds)
  }
  return [...byCat.entries()]
    .filter(([, f]) => f.size > 1)
    .sort((a, b) => b[1].size - a[1].size)
    .map(([cat, f]) => `${f.size} ${cat.toLowerCase()} funds (${[...f.values()].join(", ")}): funds in the same category often hold many of the same stocks.`)
}

/* ------------------------------------------------------------------ benchmark */

/** The investor's own cash flows replayed into a Nifty 50 index fund, side by side with what they hold. */
export function BenchmarkComparison({ holdings }: { holdings: Holding[] }) {
  const eligible = holdings.filter((h) => h.cashflows?.length && h.benchmark_value != null)
  if (!eligible.length) {
    return <p className="text-sm text-muted-foreground">Needs a CAMS / KFintech statement that starts from the first investment.</p>
  }
  const yours = eligible.reduce((s, h) => s + h.value, 0)
  const nifty = eligible.reduce((s, h) => s + (h.benchmark_value ?? 0), 0)
  const xYours = xirr(holdingFlows(eligible))
  const xNifty = xirr(holdingFlows(eligible.map((h) => ({ ...h, value: h.benchmark_value ?? 0 }))))
  const diff = yours - nifty
  const max = Math.max(yours, nifty) || 1
  const rows = [
    { label: "Your funds", value: yours, x: xYours, color: "var(--primary)" },
    { label: "Nifty 50 index fund", value: nifty, x: xNifty, color: "var(--muted-foreground)" },
  ]
  return (
    <div>
      <p className="text-sm">
        {diff >= 0 ? "Your funds are ahead of" : "Your funds are behind"} a Nifty 50 index fund by{" "}
        <span className={cn("font-semibold", diff >= 0 ? "text-gain" : "text-loss")}>{inr(Math.abs(diff))}</span>
        {xYours != null && xNifty != null && <> ({signed((xYours - xNifty) * 100, (n) => pct(n))} a year)</>}.
      </p>
      <ul className="mt-5 space-y-4">
        {rows.map((r) => (
          <li key={r.label} className="text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span>{r.label}</span>
              <span className="text-muted-foreground">
                <span className="mr-3 font-medium text-foreground">{inr(r.value)}</span>
                XIRR {r.x == null ? "—" : pct(r.x * 100)}
              </span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: r.color }} />
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-muted-foreground">
        The same rupees on the same days, put into UTI Nifty 50 Index Fund (Direct) instead
        {eligible.length < holdings.length ? `. Covers ${eligible.length} of ${holdings.length} funds, the ones with full purchase history` : ""}.
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ fund returns */

const PERIODS = ["1y", "3y", "5y"] as const

/** Each fund's own NAV returns, with the Nifty 50 index fund as the reference row. */
export function FundReturns({ holdings, benchmark }: { holdings: Holding[]; benchmark: { name: string; returns: Returns } | null }) {
  const openFund = useOpenFund()
  const funds = [...new Map(holdings.map((h) => [h.isin, h])).values()]
    .filter((h) => PERIODS.some((p) => h.returns?.[p] != null))
    .sort((a, b) => (b.returns["3y"] ?? b.returns["1y"] ?? -9) - (a.returns["3y"] ?? a.returns["1y"] ?? -9))
  if (!funds.length) return <p className="text-sm text-muted-foreground">NAV history isn't available right now.</p>
  const cell = (v: number | null, ref: number | null | undefined, compare: boolean) => (
    <span className={cn(v != null && compare && ref != null && (v >= ref ? "text-gain" : "text-loss"))}>
      {v == null ? "—" : signed(v * 100, (n) => pct(n))}
    </span>
  )
  const periods = (r: Returns, ref: Returns | undefined, compare: boolean) => (
    <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
      {PERIODS.map((p) => (
        <div key={p} className={p === "5y" ? "text-right" : undefined}>
          <dt className="eyebrow">{p.toUpperCase()}</dt>
          <dd className="mt-0.5 tabular-nums">{cell(r[p], ref?.[p], compare)}</dd>
        </div>
      ))}
    </dl>
  )
  return (
    <div>
      {/* phones: one card per fund, 1Y / 3Y / 5Y under the name */}
      <ul className="divide-y sm:hidden">
        {benchmark && (
          <li className="-mx-3 rounded-xl bg-muted/50 px-3 py-3">
            <div className="text-sm font-medium">{benchmark.name}</div>
            {periods(benchmark.returns, undefined, false)}
          </li>
        )}
        {funds.map((h) => (
          <li key={h.isin}>
            <button type="button" onClick={() => openFund(h)} className="w-full py-3 text-left">
              <div className="text-sm leading-snug">{h.name}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{h.sebi_category?.replace(/\s+Fund$/i, "") ?? h.category}</div>
              {periods(h.returns, benchmark?.returns, h.asset_class === "Equity")}
            </button>
          </li>
        ))}
      </ul>
      <Table className="hidden sm:table">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-full pl-0">Fund</TableHead>
            {PERIODS.map((p) => (
              <TableHead key={p} className={cn("text-right", p === "5y" ? "pr-0" : "px-3")}>{p.toUpperCase()}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {benchmark && (
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableCell className="py-3 pr-3 pl-0 font-medium whitespace-normal">{benchmark.name}</TableCell>
              {PERIODS.map((p) => (
                <TableCell key={p} className={cn("text-right font-medium", p === "5y" ? "pr-0" : "px-3")}>{cell(benchmark.returns[p], null, false)}</TableCell>
              ))}
            </TableRow>
          )}
          {funds.map((h) => (
            <TableRow key={h.isin} onClick={() => openFund(h)} className="cursor-pointer hover:bg-muted/50">
              <TableCell className="py-3 pr-3 pl-0 whitespace-normal">
                <FundButton className="font-normal">{h.name}</FundButton>
                <div className="mt-0.5 text-xs text-muted-foreground">{h.sebi_category?.replace(/\s+Fund$/i, "") ?? h.category}</div>
              </TableCell>
              {PERIODS.map((p) => (
                <TableCell key={p} className={cn("text-right", p === "5y" ? "pr-0" : "px-3")}>
                  {cell(h.returns[p], benchmark?.returns[p], h.asset_class === "Equity")}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="mt-3 text-xs text-muted-foreground">
        Fund NAV returns, not your own; 3Y and 5Y are yearly averages. For equity funds, green beat the Nifty 50 index fund over the same period.
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ ups and downs */

type MonthPoint = { month: string; value: number; flow?: number }

/** Month-by-month returns with new money taken out (modified Dietz), chained into an index for the drawdown. */
function monthlyReturns(history: MonthPoint[]) {
  const top = Math.max(...history.map((h) => h.value), 0)
  const out: { month: string; r: number }[] = []
  for (let i = 1; i < history.length; i++) {
    const a = history[i - 1], b = history[i]
    const flow = b.flow ?? 0
    const base = a.value + flow / 2
    if (base < top * 0.02) continue // a tiny starting balance makes the percentage meaningless
    out.push({ month: b.month, r: (b.value - a.value - flow) / base })
  }
  return out
}

const upsConfig = { r: { label: "Return" } } satisfies ChartConfig

export function UpsAndDowns({ history }: { history: MonthPoint[] }) {
  const rets = monthlyReturns(history)
  if (rets.length < 3) return <p className="text-sm text-muted-foreground">Needs a few months of history.</p>

  let index = 1, peak = 1, peakMonth = rets[0].month
  let worst = { dd: 0, from: "", to: "" }
  for (const { month: m, r } of rets) {
    index *= 1 + r
    if (index > peak) { peak = index; peakMonth = m }
    const dd = index / peak - 1
    if (dd < worst.dd) worst = { dd, from: peakMonth, to: m }
  }
  const fromPeak = index / peak - 1
  const best = rets.reduce((a, b) => (b.r > a.r ? b : a))
  const low = rets.reduce((a, b) => (b.r < a.r ? b : a))
  const up = rets.filter((x) => x.r > 0).length
  const data = rets.map((x) => ({ month: x.month, r: x.r * 100 }))

  return (
    <div>
      <dl className="mb-5 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Biggest fall</dt>
          <dd className="text-lg font-semibold text-loss">{pct(worst.dd * 100)}</dd>
          {worst.from && <dd className="text-xs text-muted-foreground">{month(worst.from, true)} to {month(worst.to, true)}</dd>}
        </div>
        <div>
          <dt className="text-muted-foreground">Now vs peak</dt>
          <dd className={cn("text-lg font-semibold", fromPeak < -0.005 ? "text-loss" : "")}>{fromPeak < -0.005 ? pct(fromPeak * 100) : "At peak"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Months up</dt>
          <dd className="text-lg font-semibold">{up} of {rets.length}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Best month</dt>
          <dd className="text-lg font-semibold text-gain">{signed(best.r * 100, (n) => pct(n))}</dd>
          <dd className="text-xs text-muted-foreground">{month(best.month, true)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Worst month</dt>
          <dd className="text-lg font-semibold text-loss">{signed(low.r * 100, (n) => pct(n))}</dd>
          <dd className="text-xs text-muted-foreground">{month(low.month, true)}</dd>
        </div>
      </dl>
      <ChartContainer config={upsConfig} className="aspect-auto h-[160px] w-full">
        <BarChart data={data} margin={{ left: 4, right: 4, top: 4, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="2 4" />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} {...monthAxis(data.map((d) => d.month))} />
          <YAxis width={40} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v.toFixed(0)}%`} tickCount={4} />
          <ReferenceLine y={0} stroke="var(--border)" />
          <ChartTooltip
            cursor={{ fill: "var(--muted)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const p = payload[0].payload as { month: string; r: number }
              return (
                <div className="rounded-lg border bg-popover px-3 py-2 text-sm shadow-md">
                  <div className="text-muted-foreground">{month(p.month, true)}</div>
                  <div className={p.r >= 0 ? "text-gain" : "text-loss"}>{signed(p.r, (n) => pct(n, 2))}</div>
                </div>
              )
            }}
          />
          <Bar dataKey="r" radius={[3, 3, 3, 3]} maxBarSize={18} isAnimationActive={false}>
            {data.map((d) => <Cell key={d.month} fill={d.r >= 0 ? "var(--gain)" : "var(--loss)"} />)}
          </Bar>
        </BarChart>
      </ChartContainer>
      <p className="mt-2 text-xs text-muted-foreground">Monthly returns with new money (SIPs, purchases, withdrawals) taken out.</p>
    </div>
  )
}
