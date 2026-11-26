// Daily returns (plan §10.5.4, M12): the overview's Today tile and the Insights panel. Same design system (§13):
// Cell/Panel surfaces, the gain/loss tokens, Segmented, Recharts through ChartContainer.
import { InfoIcon, TriangleAlertIcon } from "lucide-react"
import { useMemo, useState } from "react"
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, XAxis, YAxis } from "recharts"

import { type ChartConfig, ChartContainer, ChartTooltip } from "@/components/ui/chart"
import { Money, Percent } from "@/components/ui/rolling-number"
import { Segmented } from "@/components/ui/segmented"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { Daily } from "@/lib/api"
import { day, inr, inrShort, pct, signed } from "@/lib/format"
import { cn } from "@/lib/utils"

type Point = Daily["series"][number]

const short = (iso: string) => day(iso).split(" ").slice(0, 2).join(" ")

/** Today's date and weekday in India, where NAVs are published. */
function indiaToday(): { iso: string; weekday: boolean } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(new Date())
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ""
  return { iso: `${get("year")}-${get("month")}-${get("day")}`, weekday: !["Sat", "Sun"].includes(get("weekday")) }
}

/** "NAV of 25 Nov", plus the partial-coverage or market-day hint (§10.5.4). */
function navLine(d: Daily): string[] {
  const out = [`NAV of ${short(d.as_of!)}`]
  const { updated, total } = d.coverage
  if (updated < total) out.push(`${updated} of ${total} funds updated · rest after 11 PM`)
  else {
    const today = indiaToday()
    if (today.weekday && d.as_of! < today.iso) out.push("Today's NAVs usually arrive after 9 PM")
  }
  return out
}

/* ---------------------------------------------------------------- Today tile */

export function TodayTile({ daily, onOpen }: { daily: Daily | null | undefined; onOpen: () => void }) {
  const t = daily?.today
  const bars = (daily?.series ?? []).slice(-30)
  const max = Math.max(...bars.map((b) => Math.abs(b.change)), 1)
  const tone = t && t.change >= 0 ? "gain" : "loss"
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!t}
      aria-label={t ? `Today ${signed(t.change, inr)}. Open daily returns` : "Today's change"}
      className="flex h-full w-full flex-col gap-1.5 rounded-[14px] text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
    >
      <span className="eyebrow">Today{daily && daily.coverage.updated < daily.coverage.total ? " so far" : ""}</span>
      <div className={cn("mt-2 text-[34px] leading-tight font-semibold tracking-[-0.035em]", t && (tone === "gain" ? "text-gain" : "text-loss"))}>
        {t ? <Money value={t.change} signed /> : "—"}
      </div>
      {t ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] text-muted-foreground">
          {t.pct != null && (
            <span className={cn("rounded-full px-2 py-0.5 text-[12.5px] font-semibold", tone === "gain" ? "bg-gain/15 text-gain" : "bg-loss/15 text-loss")}>
              <Percent value={t.pct * 100} digits={2} signed />
            </span>
          )}
          <span className="truncate">{navLine(daily!)[0]}</span>
        </p>
      ) : (
        <p className="text-[13.5px] text-muted-foreground">{daily === undefined ? "Loading…" : "Shows once your funds have NAVs"}</p>
      )}
      {daily && t && navLine(daily)[1] && <p className="text-[12.5px] text-muted-foreground">{navLine(daily)[1]}</p>}
      {bars.length > 1 && (
        <div className="mt-auto flex h-12 gap-[3px] pt-3" aria-hidden>
          {bars.map((b) => {
            const h = `${Math.max((Math.abs(b.change) / max) * 100, 6)}%`
            return (
              <span key={b.date} className="flex h-full flex-1 flex-col">
                <span className="flex flex-1 items-end">{b.change >= 0 && <span className="w-full rounded-t-[2px] bg-gain/70" style={{ height: h }} />}</span>
                <span className="flex flex-1 items-start">{b.change < 0 && <span className="w-full rounded-b-[2px] bg-loss/70" style={{ height: h }} />}</span>
              </span>
            )
          })}
        </div>
      )}
    </button>
  )
}

/* ---------------------------------------------------------------- Insights panel */

const RANGES = [
  { id: "1m", label: "1M", days: 31 },
  { id: "3m", label: "3M", days: 92 },
  { id: "1y", label: "1Y", days: 366 },
] as const
type RangeId = (typeof RANGES)[number]["id"]

const dailyConfig = { change: { label: "Day change" } } satisfies ChartConfig

/** Gain/loss tokens at 3 intensities, by the size of the day's move. */
function heat(p: Point | undefined): string | undefined {
  if (!p || p.pct == null) return undefined
  const a = Math.abs(p.pct)
  const strength = a < 0.005 ? 25 : a < 0.015 ? 55 : 90
  return `color-mix(in srgb, var(${p.change >= 0 ? "--gain" : "--loss"}) ${strength}%, transparent)`
}

function MonthGrid({ month, byDate }: { month: string; byDate: Map<string, Point> }) {
  const [y, m] = month.split("-").map(Number)
  const first = new Date(y!, m! - 1, 1)
  const lead = (first.getDay() + 6) % 7 // Monday first
  const days = new Date(y!, m!, 0).getDate()
  const label = first.toLocaleDateString("en-IN", { month: "short", year: "numeric" })
  return (
    <div className="min-w-0">
      <div className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</div>
      <div className="grid grid-cols-7 gap-[3px]">
        {Array.from({ length: lead }, (_, i) => <span key={`l${i}`} />)}
        {Array.from({ length: days }, (_, i) => {
          const iso = `${month}-${String(i + 1).padStart(2, "0")}`
          const p = byDate.get(iso)
          return (
            <span
              key={iso}
              title={p ? `${day(iso)}: ${signed(p.change, inr)}${p.pct != null ? ` (${signed(p.pct * 100, (n) => pct(n, 2))})` : ""}` : `${day(iso)}: no NAV (weekend or holiday)`}
              className={cn("aspect-square rounded-[3px]", !p && "ring-1 ring-border ring-inset")}
              style={{ background: heat(p) }}
            />
          )
        })}
      </div>
    </div>
  )
}

function HonestyNote({ daily }: { daily: Daily }) {
  const n = daily.notes
  const est = n.estimated.instalments
  return (
    <p className="mt-4 flex items-start gap-1.5 text-xs text-muted-foreground">
      <span>
        Estimated from daily NAVs and your units as of {day(n.units_as_of)}
        {!n.units_exact && " (from your CDSL statement)"}
        {est > 0 && <>, plus {est} estimated SIP instalment{est === 1 ? "" : "s"} ({inr(n.estimated.amount)}) since then</>}.
        {n.excluded > 0 && <> {n.excluded} ETF{n.excluded === 1 ? "" : "s"} and share{n.excluded === 1 ? "" : "s"} aren't included.</>}
      </span>
      <Tooltip>
        <TooltipTrigger aria-label="About these estimates" className="-m-2 p-2">
          <InfoIcon className="size-3" />
        </TooltipTrigger>
        <TooltipContent className="max-w-72">
          Each day's change is your units at the start of the day times the NAV's move, so money you add or take out never
          counts as a gain or loss. SIPs after your statement are estimated at the NAV of the day they run (the next
          business day for a weekend or holiday). Add a newer statement any time: it replaces the estimates.
        </TooltipContent>
      </Tooltip>
    </p>
  )
}

export function DailyReturns({ daily }: { daily: Daily | null | undefined }) {
  const [range, setRange] = useState<RangeId>("1m")
  const days = RANGES.find((r) => r.id === range)!.days
  const points = useMemo(() => {
    if (!daily?.as_of) return []
    const from = new Date(`${daily.as_of}T00:00:00`)
    from.setDate(from.getDate() - days)
    const iso = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}-${String(from.getDate()).padStart(2, "0")}`
    return daily.series.filter((p) => p.date > iso)
  }, [daily, days])

  if (daily === undefined) return <p className="text-sm text-muted-foreground">Loading daily returns…</p>
  if (!daily?.as_of || points.length === 0) {
    return <p className="text-sm text-muted-foreground">Daily returns show once your funds have a few days of NAVs.</p>
  }

  const best = points.reduce((a, b) => (b.change > a.change ? b : a))
  const worst = points.reduce((a, b) => (b.change < a.change ? b : a))
  const up = points.filter((p) => p.change > 0).length
  const flagged = points.filter((p) => p.flag)
  const byDate = new Map(points.map((p) => [p.date, p]))
  const months = [...new Set(points.map((p) => p.date.slice(0, 7)))]

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Segmented kind="radio" label="Period" size="sm" value={range} onChange={setRange} options={RANGES.map((r) => ({ id: r.id, label: r.label }))} />
        <span className="text-xs text-muted-foreground">{navLine(daily).join(" · ")}</span>
      </div>
      <dl className="mb-5 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Best day</dt>
          <dd className="text-lg font-semibold text-gain">{signed(best.change, inr)}</dd>
          <dd className="text-xs text-muted-foreground">{day(best.date)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Worst day</dt>
          <dd className={cn("text-lg font-semibold", worst.change < 0 && "text-loss")}>{signed(worst.change, inr)}</dd>
          <dd className="text-xs text-muted-foreground">{day(worst.date)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Days up</dt>
          <dd className="text-lg font-semibold">{pct((up / points.length) * 100, 0)}</dd>
          <dd className="text-xs text-muted-foreground">{up} of {points.length} market days</dd>
        </div>
      </dl>

      <ChartContainer config={dailyConfig} className="aspect-auto h-[180px] w-full">
        <BarChart data={points} margin={{ left: 4, right: 4, top: 4, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="2 4" />
          <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} tickFormatter={(d: string) => short(d)} />
          <YAxis width={48} tickLine={false} axisLine={false} tickFormatter={(v: number) => inrShort(v)} tickCount={4} />
          <ReferenceLine y={0} stroke="var(--border)" />
          <ChartTooltip
            cursor={{ fill: "var(--muted)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const p = payload[0].payload as Point
              return (
                <div className="rounded-lg border bg-popover px-3 py-2 text-sm shadow-md">
                  <div className="text-muted-foreground">{day(p.date)}</div>
                  <div className={p.change >= 0 ? "text-gain" : "text-loss"}>
                    {signed(p.change, inr)}
                    {p.pct != null && <> ({signed(p.pct * 100, (n) => pct(n, 2))})</>}
                  </div>
                  <div className="text-xs text-muted-foreground">Value {inr(p.value)}</div>
                  {p.flag && <div className="text-xs text-muted-foreground">⚠ A fund's NAV jumped; left out of this day</div>}
                </div>
              )
            }}
          />
          <Bar dataKey="change" radius={[2, 2, 2, 2]} maxBarSize={14} isAnimationActive={false}>
            {points.map((p) => <Cell key={p.date} fill={p.change >= 0 ? "var(--gain)" : "var(--loss)"} />)}
          </Bar>
        </BarChart>
      </ChartContainer>

      <div className={cn("mt-6 grid gap-x-5 gap-y-4", months.length > 3 ? "grid-cols-3 sm:grid-cols-4 lg:grid-cols-6" : "grid-cols-2 sm:grid-cols-3")}>
        {months.map((m) => <MonthGrid key={m} month={m} byDate={byDate} />)}
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground" aria-hidden>
        <span>Loss</span>
        {[90, 55, 25].map((s) => <span key={`l${s}`} className="size-3 rounded-[3px]" style={{ background: `color-mix(in srgb, var(--loss) ${s}%, transparent)` }} />)}
        {[25, 55, 90].map((s) => <span key={`g${s}`} className="size-3 rounded-[3px]" style={{ background: `color-mix(in srgb, var(--gain) ${s}%, transparent)` }} />)}
        <span>Gain</span>
      </div>

      {flagged.length > 0 && (
        <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
          <TriangleAlertIcon className="size-3.5" />
          On {flagged.length} day{flagged.length === 1 ? "" : "s"} a fund's NAV jumped (a dividend or split the statement doesn't show), so it's left out of that day.
        </p>
      )}
      <HonestyNote daily={daily} />
    </div>
  )
}
