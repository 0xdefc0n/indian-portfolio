import { useEffect, useMemo, useState } from "react"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"

import { type ChartConfig, ChartContainer, ChartTooltip } from "@/components/ui/chart"
import { inr, inrShort, month, pct, signed } from "@/lib/format"
import { setScrub } from "@/lib/scrub"
import { cn } from "@/lib/utils"

const config = { value: { label: "Value", color: "var(--primary)" } } satisfies ChartConfig

type Point = { month: string; value: number }
type Slot = { month: string; value: number | null }

const PRESETS = [
  { id: "1y", label: "1Y", months: 12 },
  { id: "3y", label: "3Y", months: 36 },
  { id: "5y", label: "5Y", months: 60 },
]

/** '2026-10' <-> months since year 0 */
const idx = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1
const key = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`

/** Ranges the statements actually reach: 3Y / 5Y only when that much history exists, All when there is more still. */
function rangesFor(span: number) {
  if (span <= 12) return []
  const out: { id: string; label: string; months: number | null }[] = PRESETS.filter((r) => r.id === "1y" || span >= r.months)
  if (span > out[out.length - 1].months!) out.push({ id: "all", label: "All", months: null })
  return out
}

/**
 * scrub: the pointer drives the hero figures (via lib/scrub) instead of a floating tooltip.
 * label: shown at the left of the range picker.
 */
export function ValueChart({ data: points, scrub = false, label }: { data: Point[]; scrub?: boolean; label?: React.ReactNode }) {
  // One slot per calendar month; months no statement covers stay empty and show as a break.
  const all = useMemo<Slot[]>(() => {
    if (!points.length) return []
    const byMonth = new Map(points.map((p) => [p.month, p.value]))
    const start = idx(points[0].month), end = idx(points[points.length - 1].month)
    return Array.from({ length: end - start + 1 }, (_, i) => ({ month: key(start + i), value: byMonth.get(key(start + i)) ?? null }))
  }, [points])

  const ranges = useMemo(() => rangesFor(all.length), [all.length])
  const [range, setRange] = useState("1y")
  const chosen = ranges.find((r) => r.id === range) ?? ranges[0]
  const data = chosen?.months ? all.slice(-chosen.months) : all

  useEffect(() => () => setScrub(null), [])

  const known = data.filter((d): d is Point => d.value != null)
  if (known.length < 2) {
    return (
      <p className="mx-auto max-w-sm py-16 text-center text-sm text-muted-foreground">
        The value chart needs at least two months of history. A detailed CAMS or KFintech statement from your first
        investment gives the full chart.
      </p>
    )
  }
  const first = known[0], last = known[known.length - 1]
  const hasGaps = known.length < data.length
  const long = data.length > 24
  const ticks = long ? data.filter((d) => d.month.endsWith("-01")).map((d) => d.month) : undefined

  const values = known.map((d) => d.value)
  const min = Math.min(...values), max = Math.max(...values)
  const pad = (max - min) * 0.15 || max * 0.05
  const change = last.value - first.value

  function pick(i: unknown) {
    const p = i == null ? null : data[Number(i)]
    setScrub(p && p.value != null ? { month: p.month, value: p.value, base: first } : null)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {label ?? <span />}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-[13px]">
            <span className={change >= 0 ? "text-gain" : "text-loss"}>
              {signed(change, inr)} ({signed((change / first.value) * 100, (n) => pct(n, 1))})
            </span>
            <span className="ml-1 text-muted-foreground">since {month(first.month, true)}</span>
          </span>
          {ranges.length > 0 && (
            <div role="radiogroup" aria-label="Chart range" className="flex gap-0.5">
              {ranges.map((r) => (
                <button
                  key={r.id}
                  role="radio"
                  aria-checked={chosen?.id === r.id}
                  onClick={() => setRange(r.id)}
                  className={cn(
                    "min-h-9 min-w-10 rounded-lg px-2.5 font-mono text-xs transition-colors sm:min-h-7 sm:min-w-0",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    chosen?.id === r.id ? "bg-surface-2 text-foreground ring-1 ring-border" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <ChartContainer config={config} className={cn("aspect-auto min-h-[240px] w-full flex-1", scrub && "draw-in cursor-crosshair touch-none")}>
        <AreaChart
          data={data}
          margin={{ left: 4, right: 8, top: 8, bottom: 0 }}
          onMouseMove={scrub ? (st) => pick(st.activeTooltipIndex) : undefined}
          onTouchMove={scrub ? (st) => pick(st.activeTooltipIndex) : undefined}
          onMouseLeave={scrub ? () => setScrub(null) : undefined}
          onTouchEnd={scrub ? () => setScrub(null) : undefined}
        >
          <defs>
            <linearGradient id="valueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-value)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--color-value)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="2 4" />
          <XAxis
            dataKey="month"
            tickLine={false}
            axisLine={false}
            tickMargin={10}
            ticks={ticks}
            interval={long ? 0 : "preserveStartEnd"}
            minTickGap={long ? 8 : 24}
            tickFormatter={(m: string, i: number) => (long ? m.slice(0, 4) : month(m, i === 0 || m.endsWith("-01")))}
          />
          <YAxis
            width={56}
            tickLine={false}
            axisLine={false}
            tickMargin={6}
            domain={[Math.max(0, min - pad), max + pad]}
            tickFormatter={(v: number) => inrShort(v)}
            tickCount={4}
          />
          <ChartTooltip
            cursor={{ stroke: scrub ? "var(--color-value)" : "var(--border)", strokeWidth: 1, strokeOpacity: scrub ? 0.5 : 1 }}
            content={({ active, payload }) => {
              if (scrub || !active || !payload?.length) return null
              const p = payload[0].payload as Slot
              const i = data.findIndex((d) => d.month === p.month)
              const prev = i > 0 ? data[i - 1].value : null
              return (
                <div className="rounded-lg border bg-popover px-3 py-2 text-sm shadow-md">
                  <div className="text-muted-foreground">{month(p.month, true)}</div>
                  {p.value == null ? (
                    <div className="text-muted-foreground">Not in any uploaded statement</div>
                  ) : (
                    <>
                      <div className="font-semibold">{inr(p.value)}</div>
                      {prev ? (
                        <div className={p.value >= prev ? "text-gain" : "text-loss"}>
                          {signed(p.value - prev, inr)} ({signed(((p.value - prev) / prev) * 100, (n) => pct(n, 2))})
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              )
            }}
          />
          <Area
            dataKey="value"
            type="monotone"
            stroke="var(--color-value)"
            strokeWidth={2}
            fill="url(#valueFill)"
            connectNulls={false}
            activeDot={{ r: scrub ? 6 : 4, strokeWidth: scrub ? 4 : 2, stroke: "var(--surface)" }}
            isAnimationActive={scrub}
            animationDuration={700}
            animationEasing="ease-out"
          />
        </AreaChart>
      </ChartContainer>
      {hasGaps && (
        <p className="mt-2 text-xs text-muted-foreground">Breaks are months no uploaded statement covers.</p>
      )}
    </div>
  )
}
