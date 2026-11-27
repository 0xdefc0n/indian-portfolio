// Buy prices for a share or ETF in the holding dialog (plan §21.6, M21): where the cost comes from, a manual average
// buy price (and optionally the month first bought) for shares without a tradebook, and the merger banner. Same
// Section, Input and Button pieces as the rest of the dialog (§13).
import { Loader2Icon } from "lucide-react"
import { type FormEvent, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api, type Holding, SignedOut, type StockCost, waitForPortfolio } from "@/lib/api"
import { day, inr, units } from "@/lib/format"

/** The banner for a merger, demerger or a fund whose NAV stopped (no units are guessed, D25). */
export function NoticeBanner({ h }: { h: Holding }) {
  if (!h.notice) return null
  return <p className="rounded-lg border px-3 py-2 text-sm" role="status">{h.notice.text}</p>
}

const SOURCE: Record<NonNullable<Holding["cost_source"]>, string> = {
  tradebook: "From your broker tradebook.",
  "tradebook+manual": "From your broker tradebook, plus your average price for the shares it doesn't cover.",
  manual: "From the average price you added.",
  partial: "Your tradebook doesn't cover every share.",
  none: "",
}

export function BuyPrice({ h, cost, onChanged }: { h: Holding; cost: StockCost | undefined; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const src = h.cost_source ?? "none"
  const unknown = h.unknown_units ?? 0
  const needs = h.invested == null

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const price = Number(String(f.get("price") ?? "").replace(/,/g, ""))
    const since = String(f.get("since") ?? "") || null
    setBusy(true)
    setError(null)
    try {
      await api.setStockCost({ member_id: h.member_id, isin: h.isin, avg_price: price, since })
      await done("Buy price saved")
      setEditing(false)
    } catch (err) {
      if (!(err instanceof SignedOut)) setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    try {
      await api.deleteStockCost(h.member_id, h.isin)
      await done("Buy price removed")
    } catch (err) {
      if (!(err instanceof SignedOut)) setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function done(title: string) {
    toast.success(title, { description: "Updating your dashboard…" })
    await waitForPortfolio({ maxMs: 60_000 }).catch(() => null)
    onChanged()
  }

  return (
    <div className="grid gap-2 text-sm">
      {!needs && SOURCE[src] && <p className="text-xs text-muted-foreground">{SOURCE[src]}</p>}
      {needs && (
        <p className="text-xs text-muted-foreground">
          {src === "partial" && unknown > 0
            ? `The buy price of ${units(unknown)} of ${units(h.units)} shares isn't known (bought before your tradebook starts, or through another broker).`
            : "Your CDSL statement doesn't say what you paid."}{" "}
          Add a broker tradebook (Add statement → Broker), or your average buy price below.
        </p>
      )}
      {cost && !editing && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>Your average price: <span className="font-medium">{inr(cost.avg_price)}</span> a share{cost.since ? `, since ${day(`${cost.since}-01`)}` : ""}</span>
          <span className="flex gap-1">
            <Button type="button" variant="ghost" className="h-11" onClick={() => setEditing(true)}>Change</Button>
            <Button type="button" variant="ghost" className="h-11 text-loss" disabled={busy} onClick={remove}>Remove</Button>
          </span>
        </div>
      )}
      {!cost && !editing && (needs || src === "partial") && (
        <Button type="button" variant="outline" className="h-11 justify-self-start" onClick={() => setEditing(true)}>Add buy price</Button>
      )}
      {editing && (
        <form onSubmit={save} className="grid gap-3 rounded-xl bg-muted/50 p-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="bp-price">Average buy price per share (₹)</Label>
            <Input id="bp-price" name="price" inputMode="decimal" required defaultValue={cost?.avg_price ?? ""} className="h-11" autoFocus />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="bp-since">First bought (optional)</Label>
            <Input id="bp-since" name="since" type="month" defaultValue={cost?.since ?? ""} className="h-11" />
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            As your broker shows it today (after any splits or bonuses). Without a month, we count from your first
            statement that shows this share, for long-term and short-term.
          </p>
          {error && <p className="text-sm text-loss sm:col-span-2" role="alert">{error}</p>}
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" className="h-11" disabled={busy}>{busy && <Loader2Icon className="animate-spin" />}Save</Button>
            <Button type="button" variant="ghost" className="h-11" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </form>
      )}
      {h.corp_actions_tracked === false && /^INE/.test(h.isin) && (
        <p className="text-xs text-muted-foreground">Splits and bonuses aren't tracked for this share (not listed on NSE).</p>
      )}
    </div>
  )
}

/** Estimated dividends since the first statement (before TDS). */
export function Dividends({ h }: { h: Holding }) {
  const list = h.dividends ?? []
  if (!list.length) return null
  const total = list.reduce((s, [, a]) => s + a, 0)
  return (
    <ul className="divide-y text-sm">
      {[...list].reverse().slice(0, 6).map(([d, a]) => (
        <li key={d} className="flex justify-between gap-3 py-2"><span>{day(d)}</span><span>{inr(a)}</span></li>
      ))}
      <li className="pt-2 text-xs text-muted-foreground">
        {inr(total)} in all. Estimated from the dividend per share and the shares you held, before TDS.
      </li>
    </ul>
  )
}
