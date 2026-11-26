import { useMemo, useState } from "react"

import { BarList } from "@/components/insights"
import type { Holding, Member, StockData } from "@/lib/api"
import { inr, month, pct } from "@/lib/format"
import { cn } from "@/lib/utils"

type Exposure = {
  isin: string
  name: string
  symbol: string | null
  sector: string
  value: number
  funds: Set<string>
  byMember: Map<string, number>
}

const SHOW = 12
export const STOCK_TYPES = new Set(["EQUITY", "FOREIGN_EQUITY"])
const FUND_UNIT = "MUTUAL_FUND_UNIT"

/** What the family really owns: every fund's stocks, weighted by how much is in each fund. */
export function StockExposure({ holdings, total, members, showMember, data }: {
  holdings: Holding[]
  total: number
  members: Member[]
  showMember: boolean
  data: StockData
}) {
  const [all, setAll] = useState(false)
  const { rows, sectors, covered, memberTotals, cash, unlooked } = useMemo(() => {
    const map = new Map<string, Exposure>()
    const memberTotals = new Map<string, number>()
    for (const h of holdings) memberTotals.set(h.member_id, (memberTotals.get(h.member_id) ?? 0) + h.value)
    let cash = 0, unlooked = 0
    const covered = new Set<string>()
    for (const h of holdings) {
      const weights = data.funds[h.isin]
      if (!weights?.length) continue
      covered.add(h.isin)
      for (const [isin, w] of weights) {
        const info = data.stocks[isin]
        const v = (h.value * w) / 100
        if (!STOCK_TYPES.has(info?.type ?? "")) {
          if (info?.type === FUND_UNIT) unlooked += v
          else cash += v
          continue
        }
        const e = map.get(isin) ?? {
          isin, name: info?.name ?? isin, symbol: info?.symbol ?? null, sector: info?.sector || "Other",
          value: 0, funds: new Set(), byMember: new Map(),
        }
        e.value += v
        e.funds.add(h.isin)
        e.byMember.set(h.member_id, (e.byMember.get(h.member_id) ?? 0) + v)
        map.set(isin, e)
      }
    }
    const rows = [...map.values()].sort((a, b) => b.value - a.value)
    const bySector = new Map<string, number>()
    for (const r of rows) bySector.set(r.sector, (bySector.get(r.sector) ?? 0) + r.value)
    const sorted = [...bySector.entries()].sort((a, b) => b[1] - a[1])
    const sectors = [
      ...sorted.slice(0, 8).map(([label, value]) => ({ label, value })),
      ...(sorted.length > 8 ? [{ label: "Other sectors", value: sorted.slice(8).reduce((s, [, v]) => s + v, 0) }] : []),
    ]
    return { rows, sectors, covered, memberTotals, cash, unlooked }
  }, [holdings, data])

  if (!data.enabled) {
    return <p className="text-sm text-muted-foreground">Stocks inside funds aren't available right now.</p>
  }
  if (!rows.length) {
    return (
      <p className="text-sm text-muted-foreground">
        {data.pending || data.refreshing ? "Fetching fund portfolios. This takes a few minutes." : "No stock-level data for these funds yet."}
      </p>
    )
  }

  const equityFunds = new Set(holdings.filter((h) => h.asset_class === "Equity").map((h) => h.isin))
  const missing = [...equityFunds].filter((i) => !covered.has(i)).length
  const shown = all ? rows : rows.slice(0, SHOW)
  const top10 = rows.slice(0, 10).reduce((s, r) => s + r.value, 0)
  const inStocks = rows.reduce((s, r) => s + r.value, 0)
  const lookThrough = holdings.map((h) => data.look_through?.[h.isin]).filter(Boolean)
  const waiting = lookThrough.reduce((s, l) => s + (l!.funds - l!.looked_through), 0)
  const empty = holdings.filter((h) => data.no_stocks.includes(h.isin)).length
  const multi = showMember && members.length > 1
  const memberName = new Map(members.map((m) => [m.id, m.name.split(" ")[0]]))

  return (
    <div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Stocks owned</dt>
          <dd className="mt-0.5 text-xl font-semibold">{rows.length}</dd>
          <dd className="text-xs text-muted-foreground">through {covered.size} fund{covered.size > 1 ? "s" : ""}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">In stocks</dt>
          <dd className="mt-0.5 text-xl font-semibold">{inr(inStocks)}</dd>
          <dd className="text-xs text-muted-foreground">{pct(total ? (inStocks / total) * 100 : 0, 0)} of the portfolio</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Top 10 stocks</dt>
          <dd className="mt-0.5 text-xl font-semibold">{pct(inStocks ? (top10 / inStocks) * 100 : 0, 0)}</dd>
          <dd className="text-xs text-muted-foreground">of the money in stocks</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Largest sector</dt>
          <dd className="mt-0.5 text-lg leading-snug font-semibold">{sectors[0]?.label ?? "—"}</dd>
          <dd className="text-xs text-muted-foreground">{sectors[0] && inStocks ? `${pct((sectors[0].value / inStocks) * 100, 0)} of stocks` : null}</dd>
        </div>
      </dl>

      <div className="mt-8 grid gap-10 lg:grid-cols-[3fr_2fr]">
        <section className="min-w-0">
          <h3 className="mb-2 text-sm font-medium text-muted-foreground">Largest stocks</h3>
          <ul className="divide-y text-sm">
            {shown.map((r, i) => (
              <li key={r.isin} className="flex items-baseline gap-3 py-2.5">
                <span className="w-6 shrink-0 text-right text-xs text-muted-foreground">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate">{r.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.sector}
                    <span className="ml-3">in {r.funds.size} fund{r.funds.size > 1 ? "s" : ""}</span>
                  </div>
                  {multi && (
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                      {[...r.byMember.entries()].sort((a, b) => b[1] - a[1]).map(([id, v]) => (
                        <span key={id}>
                          {memberName.get(id)} <span className="text-foreground/80">{pct(((v / (memberTotals.get(id) || 1)) * 100), 1)}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-medium">{inr(r.value)}</div>
                  <div className="text-xs text-muted-foreground">{pct(total ? (r.value / total) * 100 : 0, 2)}</div>
                </div>
              </li>
            ))}
          </ul>
          {rows.length > SHOW && (
            <button type="button" onClick={() => setAll((a) => !a)}
              className="mt-2 rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              {all ? "Show fewer" : `Show all ${rows.length}`}
            </button>
          )}
        </section>
        <section className="min-w-0">
          <h3 className="mb-3 text-sm font-medium text-muted-foreground">Sectors</h3>
          <BarList rows={sectors} total={inStocks} />
          {(cash > 0 || unlooked > 0) && (
            <dl className="mt-5 space-y-1.5 border-t pt-4 text-sm">
              {cash > 0 && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Cash, debt &amp; money market</dt>
                  <dd>{inr(cash)}</dd>
                </div>
              )}
              {unlooked > 0 && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Inside other funds, not yet broken down</dt>
                  <dd>{inr(unlooked)}</dd>
                </div>
              )}
            </dl>
          )}
        </section>
      </div>

      <p className={cn("mt-6 text-xs text-muted-foreground")}>
        From fund portfolios disclosed for {data.month ? month(data.month, true) : "the latest month"}
        {data.oldest_month && data.oldest_month !== data.month ? ` (some from ${month(data.oldest_month, true)})` : ""}, weighted by
        what you hold today. % is of the whole portfolio{multi ? "; per person, of that person's portfolio" : ""}.
        {waiting > 0 && ` ${waiting} fund${waiting > 1 ? "s" : ""} held inside a fund of funds still to be broken down; this fills in automatically over the next day or two.`}
        {empty > 0 && ` ${empty} fund${empty > 1 ? "s have" : " has"} no portfolio published by the data provider yet.`}
        {missing - empty > 0 && ` ${missing - empty} equity fund${missing - empty > 1 ? "s" : ""} not covered yet.`}
      </p>
    </div>
  )
}
