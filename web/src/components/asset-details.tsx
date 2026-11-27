// The details of one FD, PPF or EPF (M19 follow-up, owner request 2026-11-27): where it stands today and where it's
// heading, as a chart of value against money put in up to maturity (or a chosen number of years), worked out with the
// same calculator as everything else. Same Dialog, Segmented, chart and box styles as the rest of the app (§13).
import {
  addMonths, type Asset, isMetalType, metalRate, projectAsset, projectionEnd, projectionStart, type RateTable, sgbSeries, todayIst,
} from "@manual-assets"
import { useMemo, useState } from "react"
import { Area, AreaChart, CartesianGrid, Line, ReferenceLine, XAxis, YAxis } from "recharts"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { type ChartConfig, ChartContainer, ChartTooltip } from "@/components/ui/chart"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Segmented } from "@/components/ui/segmented"
import { type AssetRow, perGram } from "@/lib/assets"
import { day, inr, inrShort } from "@/lib/format"

const config = {
  total: { label: "Value", color: "var(--primary)" },
  invested: { label: "Put in", color: "var(--muted-foreground)" },
} satisfies ChartConfig

type Horizon = { id: string; label: string; until: string }

/** The end dates offered: an FD has one; PPF to maturity and beyond; EPF a few years out. */
function horizons(asset: Asset, today: string): Horizon[] {
  if (asset.type === "fd") return [{ id: "end", label: "", until: projectionEnd(asset, today) }]
  const plus = (base: string, years: number) => addMonths(base, 12 * years)
  if (asset.type === "ppf") {
    const maturity = projectionEnd(asset, today)
    if (maturity > today) {
      return [
        { id: "m", label: `To maturity (${maturity.slice(0, 4)})`, until: maturity },
        { id: "m5", label: "+5 years", until: plus(maturity, 5) },
        { id: "m10", label: "+10 years", until: plus(maturity, 10) },
      ]
    }
    return [5, 10, 15].map((y) => ({ id: `${y}`, label: `${y} years`, until: plus(today, y) }))
  }
  return [5, 10, 20].map((y) => ({ id: `${y}`, label: `${y} years`, until: plus(today, y) }))
}

type ChartPoint = { date: string; total: number; invested: number | null }

/** Value (area) against money put in (dashed step), month by month, with a Today marker inside the range. */
function ValueChart({ data, today }: { data: ChartPoint[]; today: string }) {
  // Only inside the range: a history that ends today needs no marker (its label would clip at the edge)
  const todayX = data.at(-1)?.date === today ? undefined : data.find((d) => d.date >= today)?.date
  // A narrow range (an FD over a year) needs more digits, or ticks repeat ("₹2.6L", "₹2.6L")
  const ys = data.flatMap((d) => (d.invested === null ? [d.total] : [d.total, d.invested]))
  const narrow = ys.length > 0 && Math.max(...ys) - Math.min(...ys) < 0.25 * Math.max(...ys)
  const tick = (v: number) => (narrow && Math.abs(v) >= 1e5 ? `₹${(v / 1e5).toFixed(2)}L` : inrShort(v))
  return (
    <ChartContainer config={config} className="aspect-auto h-[220px] w-full">
      <AreaChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="projFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-total)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--color-total)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="2 4" />
        <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={10} minTickGap={32}
          tickFormatter={(d: string) => (data.length > 30 ? d.slice(0, 4) : day(d).split(" ").slice(1).join(" "))} />
        <YAxis width={60} tickLine={false} axisLine={false} tickMargin={6} tickFormatter={tick} domain={["auto", "auto"]} />
        {todayX && todayX !== data[0]?.date && (
          <ReferenceLine x={todayX} stroke="var(--muted-foreground)" strokeDasharray="3 3" label={{ value: "Today", position: "insideTopLeft", fill: "var(--muted-foreground)", fontSize: 11 }} />
        )}
        <ChartTooltip
          cursor={{ stroke: "var(--border)" }}
          content={({ active, payload }) => {
            const d = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined
            if (!d) return null
            return (
              <div className="rounded-lg bg-popover px-3 py-2 text-xs shadow-md ring-1 ring-border">
                <div className="mb-1 font-medium">{day(d.date)}{d.date > today ? " (projected)" : ""}</div>
                <div>Value {inr(d.total)}</div>
                {d.invested !== null && <div className="text-muted-foreground">Put in {inr(d.invested)}</div>}
              </div>
            )
          }}
        />
        <Area dataKey="total" type="monotone" stroke="var(--color-total)" strokeWidth={2} fill="url(#projFill)" isAnimationActive={false} />
        <Line dataKey="invested" connectNulls={false} type="stepAfter" stroke="var(--color-invested)" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
      </AreaChart>
    </ChartContainer>
  )
}

function Box({ label, children, tone }: { label: string; children: React.ReactNode; tone?: "gain" }) {
  return (
    <div className="min-w-0 rounded-2xl bg-surface-2 px-3.5 py-3 ring-1 ring-border">
      <dt className="eyebrow">{label}</dt>
      <dd className={tone === "gain" ? "mt-1.5 truncate text-lg font-semibold tracking-tight text-gain" : "mt-1.5 truncate text-lg font-semibold tracking-tight"}>{children}</dd>
    </div>
  )
}

function endLabel(asset: AssetRow, until: string, today: string): string {
  if (asset.type === "fd") return asset.v.status === "closed" ? "When closed" : asset.v.status === "matured" ? "At maturity (paid)" : "At maturity"
  if (asset.type === "ppf" && asset.v.maturity === until && until > today) return "At maturity"
  return `On ${day(until)}`
}

export function AssetDetails({ asset, rates, onClose, onEdit }: { asset?: AssetRow; rates: RateTable; onClose: () => void; onEdit: (a: AssetRow) => void }) {
  const today = todayIst()
  const options = useMemo(() => (asset && !isMetalType(asset.type) ? horizons(asset, today) : []), [asset, today])
  const [pick, setPick] = useState<string | null>(null)
  const horizon = options.find((o) => o.id === pick) ?? options[0]
  const points = useMemo(() => (asset && horizon ? projectAsset(asset, projectionStart(asset), horizon.until, rates) : []), [asset, horizon, rates])
  if (asset && isMetalType(asset.type)) return <MetalDetails asset={asset} rates={rates} onClose={onClose} onEdit={onEdit} />
  if (!asset || !horizon) return <Dialog open={false} />

  const now = asset.v
  const end = points.at(-1) ?? { value: now.value, invested: now.invested, received: now.received, date: today }
  const endTotal = end.value + end.received
  const putInLater = Math.max(0, end.invested - now.invested)
  const interest = endTotal - end.invested
  const data = points.map((p) => ({ date: p.date, total: Math.round(p.value + p.received), invested: Math.round(p.invested) }))
  const payout = asset.type === "fd" && asset.inputs.payout
  const rateNote = asset.type === "fd"
    ? `${asset.v.rate}% a year${asset.inputs.payout ? `, interest paid out ${asset.inputs.payout}` : ", compounded quarterly"}`
    : `${asset.v.rate}% a year now${(asset.inputs as { rate: number | null }).rate === null ? " (government rate); later years assume today's rate" : " (your rate)"}`
  const depositNote =
    asset.type === "ppf" ? (asset.inputs.yearly ? `${inr(asset.inputs.yearly)} deposited by 5 April each year` : "No more yearly deposits")
    : asset.type === "epf" ? (asset.inputs.stopped ? "No contributions after they stopped" : `${inr(asset.inputs.monthly)} contributed each month`)
    : null

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] gap-5 overflow-y-auto p-5 sm:max-w-lg sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {asset.name}
            <Badge variant="secondary">Approximate</Badge>
            {now.provisional && <Badge variant="outline">Provisional rate</Badge>}
          </DialogTitle>
          <DialogDescription>{rateNote}.</DialogDescription>
        </DialogHeader>

        {options.length > 1 && (
          <Segmented kind="radio" label="How far ahead" size="sm" value={horizon.id} onChange={setPick} options={options.map((o) => ({ id: o.id, label: o.label }))} />
        )}

        <dl className="grid grid-cols-2 gap-3">
          <Box label="Value today">{inr(now.value)}</Box>
          <Box label={endLabel(asset, horizon.until, today)}>{inr(endTotal)}</Box>
          <Box label={putInLater ? "Still to put in" : "Put in"}>{inr(putInLater || end.invested)}</Box>
          <Box label={payout ? "Interest paid out" : "Interest by then"} tone="gain">{inr(interest)}</Box>
        </dl>

        <div>
          <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 rounded-full bg-primary" />{payout ? "Value with interest paid out" : "Value"}</span>
            <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 rounded-full bg-muted-foreground" />Money put in</span>
            <span className="ml-auto">{day(points[0]?.date)} – {day(horizon.until)}</span>
          </div>
          <ValueChart data={data} today={today} />
        </div>

        <ul className="space-y-1 text-[13px] text-muted-foreground">
          {depositNote && <li>{depositNote}.</li>}
          {asset.type === "ppf" && asset.v.maturity && <li>The 15 years end on {day(asset.v.maturity)}; after that it can be extended in blocks of 5 years.</li>}
          {asset.type === "fd" && asset.v.status === "active" && <li>Matures on {day(asset.v.maturity)}. We don't assume a renewal.</li>}
          <li>A projection from what you entered, before tax. Real rates change; PPF and EPF rates are set each quarter and year.</li>
        </ul>

        <DialogFooter>
          <Button type="button" variant="outline" className="h-11" onClick={() => onEdit(asset)}>Edit</Button>
          <Button type="button" className="h-11" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Gold, silver and SGBs (M29): value today and its history from the buy date (or 5 years back) at month-end rates.
 * No projection: nobody knows the gold price ahead. An SGB adds the interest paid out.
 */
function MetalDetails({ asset, rates, onClose, onEdit }: { asset: AssetRow; rates: RateTable; onClose: () => void; onEdit: (a: AssetRow) => void }) {
  const today = todayIst()
  const metal = asset.type === "silver" ? "silver" : "gold"
  const points = useMemo(() => {
    const first = rates.metals?.[metal][0]?.[0]
    let from = projectionStart(asset, today)
    if (first && from < first) from = first
    if (!metalRate(rates.metals, metal, from)) return []
    return projectAsset(asset, from, projectionEnd(asset, today), rates)
  }, [asset, metal, rates, today])
  const v = asset.v
  const data: ChartPoint[] = points.map((p) => ({ date: p.date, total: Math.round(p.value + p.received), invested: v.cost_unknown ? null : Math.round(p.invested) }))
  const s = asset.type === "sgb" ? sgbSeries(asset.inputs.series) : undefined
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] gap-5 overflow-y-auto p-5 sm:max-w-lg sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {asset.name}
            <Badge variant="secondary">Approximate</Badge>
            {v.status === "matured" && <Badge variant="outline">Matured</Badge>}
            {v.status === "redeemed" && <Badge variant="outline">Redeemed early</Badge>}
          </DialogTitle>
          <DialogDescription>{perGram(asset)}{asset.type === "gold" ? " at this purity" : ""}.</DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-2 gap-3">
          <Box label={v.status === "active" ? "Value today" : v.status === "matured" ? "Paid at maturity" : "Paid on redemption"}>{v.price ? inr(v.value) : "–"}</Box>
          <Box label={v.cost === "estimated" ? "Put in (estimated)" : "Put in"}>{v.cost_unknown ? "Not entered" : inr(v.invested)}</Box>
          {asset.type === "sgb" && <Box label="Interest paid out" tone="gain">{inr(v.received)}</Box>}
          <Box label="Gain" tone={!v.cost_unknown && v.price && v.gain >= 0 ? "gain" : undefined}>{v.cost_unknown || !v.price ? "–" : inr(v.gain)}</Box>
        </dl>

        {data.length > 1 ? (
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 rounded-full bg-primary" />{asset.type === "sgb" ? "Value with interest paid out" : "Value"}</span>
              {!v.cost_unknown && <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 rounded-full bg-muted-foreground" />Money put in</span>}
              <span className="ml-auto">{day(data[0]?.date)} – {day(data.at(-1)?.date)}</span>
            </div>
            <ValueChart data={data} today={today} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{v.price ? "The history shows once there's more than a month of rates." : "No rate yet, so no value or history."}</p>
        )}

        <ul className="space-y-1 text-[13px] text-muted-foreground">
          {s && <li>{s.coupon}% a year on the issue price of {inr(s.price)}/g, paid every six months. Matures on {day(v.maturity)}; RBI buys it back from {day(addMonths(s.issue, 60))}.</li>}
          {asset.type !== "sgb" && v.cost_unknown && <li>Add what you paid, or when you bought it (Edit), to see the gain.</li>}
          {v.cost === "estimated" && <li>The cost is estimated from the bullion rate on the day you bought it. Jewellery also carried making charges and GST, so what you actually paid was higher and the real gain lower. Add the price paid (Edit) for an exact gain.</li>}
          {v.cost === "paid" && v.flows.length === 0 && <li>Add the date you bought it (Edit) to see the yearly return.</li>}
          <li>Valued at the bullion rate, before GST and making charges. The rate is worked out from gold and silver ETF prices: close to the IBJA rate, not exactly it.</li>
        </ul>

        <DialogFooter>
          <Button type="button" variant="outline" className="h-11" onClick={() => onEdit(asset)}>Edit</Button>
          <Button type="button" className="h-11" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
