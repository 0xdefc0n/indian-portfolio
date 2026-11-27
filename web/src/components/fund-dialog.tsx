import { RepeatIcon } from "lucide-react"
import { useState } from "react"

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import type { Activity, Holding, Member, Returns, Sip, StockData } from "@/lib/api"
import { categoryColor, day, inr, inrExact, month, nav, pct, per, signed, units } from "@/lib/format"
import { cn } from "@/lib/utils"
import { estimateNote, isBuy, unitsText } from "@/lib/activity"
import { inProgress, movedNote, nextRun } from "@/lib/sips"
import { STOCK_TYPES } from "@/components/stock-exposure"
import { holdingFlows, xirr } from "@/lib/xirr"
import { asOfText, band, excessLine, noScoreText, scoreLine, sectorLine, toneClass } from "@/lib/score"
import type { Score } from "@/lib/api"

type Props = {
  holding: Holding | null
  onClose: () => void
  member: Member | undefined
  showMember: boolean
  activity: Activity[]
  sips: Sip[]
  benchmark: { name: string; returns: Returns } | null
  stocks: StockData | null
}

const PERIODS = ["1y", "3y", "5y"] as const

function Fact({ label, value, detail, className }: { label: string; value: React.ReactNode; detail?: React.ReactNode; className?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 font-medium", className)}>{value}</dd>
      {detail && <dd className="text-xs text-muted-foreground">{detail}</dd>}
    </div>
  )
}

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-t pt-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {aside && <span className="text-xs text-muted-foreground">{aside}</span>}
      </div>
      {children}
    </section>
  )
}

const KIND_LABEL: Record<Activity["kind"], string> = {
  sip: "SIP", purchase: "Bought", redemption: "Sold", switch_in: "Switched in", switch_out: "Switched out", dividend: "Dividend reinvested",
}

export function FundDialog({ holding: h, onClose, member, showMember, activity, sips, benchmark, stocks }: Props) {
  const [allTxns, setAllTxns] = useState(false)
  return (
    <Dialog open={!!h} onOpenChange={(o) => { if (!o) { onClose(); setAllTxns(false) } }}>
      <DialogContent className="max-h-[calc(100svh-2rem)] gap-5 overflow-y-auto p-5 sm:max-w-lg sm:p-6">
        {h && <Body h={h} member={member} showMember={showMember} activity={activity} sips={sips} benchmark={benchmark} stocks={stocks} allTxns={allTxns} onAllTxns={() => setAllTxns(true)} />}
      </DialogContent>
    </Dialog>
  )
}

function Body({ h, member, showMember, activity, sips, benchmark, stocks, allTxns, onAllTxns }: Omit<Props, "holding" | "onClose"> & {
  h: Holding
  allTxns: boolean
  onAllTxns: () => void
}) {
  const invested = h.invested
  const gain = invested != null ? h.value - invested : null
  const gainPct = invested ? (gain! / invested) * 100 : null
  const x = h.cashflows?.length ? xirr(holdingFlows([h])) : null
  const avgCost = invested != null && h.units ? invested / h.units : null
  const txns = activity.filter((a) => a.member_id === h.member_id && a.isin === h.isin)
  const fundSips = sips.filter((s) => s.member_id === h.member_id && s.isin === h.isin && s.status === "active")
  const shownTxns = allTxns ? txns : txns.slice(0, 5)
  const vsNifty = h.benchmark_value != null ? h.value - h.benchmark_value : null
  const hasReturns = PERIODS.some((p) => h.returns?.[p] != null)
  const weights = stocks?.funds[h.isin]
  const stockWeights = (weights ?? []).filter(([i]) => STOCK_TYPES.has(stocks?.stocks[i]?.type ?? ""))
  const topStocks = [...stockWeights].sort((a, b) => b[1] - a[1]).slice(0, 10)
  const otherPct = (weights ?? []).reduce((s, w) => s + w[1], 0) - stockWeights.reduce((s, w) => s + w[1], 0)

  return (
    <>
      {/* header */}
      <div className="pr-8">
        <DialogTitle className="text-lg leading-snug font-semibold">{h.name}</DialogTitle>
        <DialogDescription className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: categoryColor(h.category) }} />
            {h.sebi_category?.replace(/\s+Fund$/i, "") ?? h.category}
          </span>
          {h.amc && <span>{h.amc}</span>}
          {showMember && member && <span>{member.name}</span>}
        </DialogDescription>
      </div>

      {/* value and P&L */}
      <div>
        <div className="text-xs text-muted-foreground">Current value{h.as_of ? ` on ${day(h.as_of)}` : ""}</div>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3">
          <span className="text-3xl font-semibold tracking-tight">{inr(h.value)}</span>
          {gain != null && (
            <span className={cn("font-medium", gain >= 0 ? "text-gain" : "text-loss")}>
              {signed(gain, inr)} ({signed(gainPct!, (n) => pct(n, 2))})
            </span>
          )}
        </div>
        {h.estimated && h.estimated.instalments + h.estimated.pending > 0 && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            Includes {h.estimated.instalments + h.estimated.pending} estimated SIP instalment{h.estimated.instalments + h.estimated.pending === 1 ? "" : "s"} since
            your statement of {day(h.estimated.since)}. A newer statement replaces the estimate.
          </p>
        )}
        {h.sip && (
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
              <RepeatIcon className="size-3" /> SIP {inr(h.sip.amount)}{per(h.sip.frequency)}
            </span>
          </div>
        )}
      </div>

      {/* the numbers */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl bg-muted/50 p-4 text-sm sm:grid-cols-3">
        <Fact label="Invested" value={inr(invested)} />
        <Fact label="Total returns" value={gain == null ? "—" : signed(gain, inr)} className={gain == null ? "" : gain >= 0 ? "text-gain" : "text-loss"} />
        <Fact label="XIRR" value={x == null ? "—" : signed(x * 100, (n) => pct(n, 2))} className={x == null ? "" : x >= 0 ? "text-gain" : "text-loss"} />
        <Fact label="Units" value={units(h.units)} />
        <Fact label="Average cost" value={avgCost == null ? "—" : inrExact(avgCost)} detail="per unit" />
        <Fact label={h.isin.startsWith("INF") ? "Current NAV" : "Last price"} value={h.nav == null ? "—" : `₹${nav(h.nav)}`}
          detail={h.as_of ? (h.price_source === "statement" && !h.isin.startsWith("INF") ? `${day(h.as_of)}, from your statement` : day(h.as_of)) : undefined} />
      </dl>
      {invested == null && (
        <p className="-mt-2 text-xs text-muted-foreground">
          Invested amount, returns and average cost need a CAMS / KFintech statement that starts from the first purchase.
        </p>
      )}

      {/* holding details */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
        {h.tax?.since && <Fact label="Investing since" value={day(h.tax.since)} />}
        {h.tax && h.units ? (
          <Fact
            label="Long-term units"
            value={pct((h.tax.lt_units / h.units) * 100, 0)}
            detail={`held over ${h.tax.equity ? "1 year" : "2 years"}`}
          />
        ) : null}
        {h.folio && <Fact label="Folio" value={h.folio} />}
        {fundSips[0] && (() => {
          const run = nextRun(fundSips[0])
          const running = inProgress(fundSips[0])
          const moved = run ? movedNote(run.moved, run.due, day) : null
          return (
            <Fact
              label={running ? "SIP status" : "Next SIP"}
              value={running ? "In progress" : day(run?.date ?? null)}
              detail={running ? `Debited ${day(running.date)}, units by ${day(running.units_by)}` : moved ?? `${fundSips.reduce((s, x) => s + x.instalments, 0)} instalments so far`}
            />
          )
        })()}
      </dl>
      {h.tax && (
        <p className="-mt-2 text-xs text-muted-foreground">Long-term and short-term splits are for information only, not tax or investment advice.</p>
      )}

      {vsNifty != null && (
        <Section title="Versus the Nifty 50">
          <p className="text-sm">
            The same rupees on the same days in a Nifty 50 index fund would be worth{" "}
            <span className="font-medium">{inr(h.benchmark_value)}</span>. This fund is{" "}
            <span className={cn("font-medium", vsNifty >= 0 ? "text-gain" : "text-loss")}>
              {vsNifty >= 0 ? "ahead" : "behind"} by {inr(Math.abs(vsNifty))}
            </span>.
          </p>
        </Section>
      )}

      {hasReturns && (
        <Section title="Fund track record" aside="NAV returns; 3Y and 5Y yearly">
          <div className="grid grid-cols-3 gap-2 text-center">
            {PERIODS.map((p) => {
              const v = h.returns[p], ref = benchmark?.returns[p]
              return (
                <div key={p} className="rounded-lg bg-muted/50 px-2 py-2.5">
                  <div className="text-xs text-muted-foreground">{p.toUpperCase()}</div>
                  <div className={cn("font-semibold", v == null ? "" : v >= 0 ? "text-gain" : "text-loss")}>
                    {v == null ? "—" : signed(v * 100, (n) => pct(n))}
                  </div>
                  {ref != null && <div className="text-xs text-muted-foreground">Nifty {signed(ref * 100, (n) => pct(n))}</div>}
                </div>
              )
            })}
          </div>
        </Section>
      )}

      {h.score && <ScoreSection s={h.score} />}

      {topStocks.length > 0 && (
        <Section title="Top holdings" aside={stocks?.month ? `${stockWeights.length} stocks, ${month(stocks.month, true)}` : undefined}>
          <ul className="space-y-2 text-sm">
            {topStocks.map(([isin, w]) => (
              <li key={isin}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate">{stocks!.stocks[isin]?.name ?? isin}</span>
                  <span className="shrink-0 text-muted-foreground">
                    <span className="mr-2 text-foreground">{inr((h.value * w) / 100)}</span>
                    {pct(w)}
                  </span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${(w / topStocks[0][1]) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            ₹ is your share, based on your current value in this fund.
            {otherPct >= 0.5 && ` ${pct(otherPct, 0)} is in cash, debt${stocks?.look_through?.[h.isin] ? " or funds not yet broken down" : ""}.`}
            {stocks?.look_through?.[h.isin] && ` Includes the stocks of ${stocks.look_through[h.isin].looked_through} of the ${stocks.look_through[h.isin].funds} funds it holds.`}
          </p>
        </Section>
      )}

      {txns.length > 0 && (
        <Section title="Transactions" aside={`${txns.length} in the statements`}>
          <ul className="divide-y text-sm">
            {shownTxns.map((a, i) => (
              <li key={`${a.date}-${i}`} className="flex items-baseline justify-between gap-4 py-2.5">
                <div>
                  <div>{KIND_LABEL[a.kind] ?? (isBuy(a) ? "Bought" : "Sold")}</div>
                  <div className="text-xs text-muted-foreground">{day(a.date)}</div>
                  {estimateNote(a) && <div className="text-xs text-muted-foreground">{estimateNote(a)}</div>}
                </div>
                <div className="text-right">
                  <div className={!isBuy(a) ? "text-loss" : ""}>{a.amount != null ? inr(Math.abs(a.amount)) : "—"}</div>
                  <div className="text-xs text-muted-foreground">
                    {a.estimated && !a.units ? unitsText(a) : <>{isBuy(a) ? "+" : "−"}{units(Math.abs(a.units))} units</>}
                    {a.amount && a.units ? <> at ₹{nav(Math.abs(a.amount / a.units))}</> : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {!allTxns && txns.length > 5 && (
            <button type="button" onClick={onAllTxns} className="mt-2 text-sm font-medium text-primary hover:underline">
              Show all {txns.length}
            </button>
          )}
        </Section>
      )}
    </>
  )
}

/** The benchmark score (M28, plan §21.4): number and band, the plain lines, 3/5/10-year CAGRs against the index. */
function ScoreSection({ s }: { s: Score }) {
  if (s.score == null) {
    const why = noScoreText(s)
    return why ? (
      <Section title="Benchmark score">
        <p className="text-sm text-muted-foreground">{why}</p>
      </Section>
    ) : null
  }
  const b = band(s.score)
  const lines = [scoreLine(s), excessLine(s), sectorLine(s)].filter(Boolean)
  return (
    <Section title="Benchmark score" aside={`vs ${s.index}, ${asOfText(s)}`}>
      <div className="flex items-baseline gap-3">
        <span className={cn("text-2xl font-semibold tabular-nums", toneClass(b))}>{s.score}</span>
        <span className="text-sm text-muted-foreground">/ 100 · {b.label}</span>
      </div>
      {lines.map((l) => (
        <p key={l} className="mt-1.5 text-sm">{l}</p>
      ))}
      {!!s.horizons?.length && (
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          {s.horizons.map((x) => (
            <div key={x.years} className="rounded-lg bg-muted/50 px-2 py-2.5">
              <div className="text-xs text-muted-foreground">{x.years}Y yearly</div>
              <div className={cn("font-semibold", x.fund >= x.index ? "text-gain" : "text-loss")}>{signed(x.fund, (n) => pct(n))}</div>
              <div className="text-xs text-muted-foreground">Index {signed(x.index, (n) => pct(n))}</div>
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Half risk-adjusted return against the index, half how often it beat the index over rolling 3- and 5-year periods,
        on month-end values{s.months ? ` (${Math.round(s.months / 12)} years)` : ""}.
        {s.growth_option && " Shown for the growth option of this fund, since payouts lower this option's NAV."}
        {s.price_only && " Share prices only: dividends aren't counted."}
        {" "}Not investment advice. Past performance doesn't predict future returns.
      </p>
    </Section>
  )
}

