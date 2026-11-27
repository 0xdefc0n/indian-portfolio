// FD, PPF and EPF (plan §21.12, D28, M19), gold, silver and SGBs (§21.5, M29) entered by hand. The Worker stores only
// the inputs; values are computed here, on every render, with the calculator the Worker uses too (@manual-assets →
// worker/src/lib/manual-assets.ts).
import {
  ASSET_CATEGORY, type AssetValue, assetName, type Flow, isMetalType, metalRate, RATES, type RateTable, sgbOfHolding, type SgbSeries, todayIst,
  valueAsset,
} from "@manual-assets"
import { useCallback, useEffect, useState } from "react"

import { api, type Holding, type ManualAsset, SignedOut } from "@/lib/api"
import { day, inr, inrExact } from "@/lib/format"

export type AssetRow = ManualAsset & { name: string; category: string; v: AssetValue }

/** Today's approximate values, worked out from the inputs. */
export function valued(assets: ManualAsset[], rates: RateTable, today = todayIst()): AssetRow[] {
  return assets.map((a) => ({ ...a, name: assetName(a), category: ASSET_CATEGORY[a.type], v: valueAsset(a, today, rates) }))
}

/** The assets for the member switch: a member's own, or everyone's (including those filed under no member). */
export const forMember = (rows: AssetRow[], who: string | null) => (who === null ? rows : rows.filter((r) => r.member_id === who))

/** The two groups the screens show apart. */
export const fixedOnly = (rows: AssetRow[]) => rows.filter((r) => !isMetalType(r.type))
export const metalsOnly = (rows: AssetRow[]) => rows.filter((r) => isMetalType(r.type))

/**
 * Value of everything; invested and gain only where the cost is known (gold or silver with no price paid has none),
 * and `costValue` is the value of those, so current − invested = gain.
 */
export const assetTotals = (rows: AssetRow[]) => {
  const known = rows.filter((r) => !r.v.cost_unknown)
  return {
    value: rows.reduce((s, r) => s + r.v.value, 0),
    costValue: known.reduce((s, r) => s + r.v.value, 0),
    invested: known.reduce((s, r) => s + r.v.invested, 0),
    gain: known.reduce((s, r) => s + r.v.gain, 0),
  }
}

/** Cash flows for Overall XIRR (funds and stocks plus these). */
export const assetFlows = (rows: AssetRow[]): Flow[] => rows.flatMap((r) => r.v.flows)

/** Loads /api/assets. A failure never breaks the page: the list is empty and `failed` is set. */
export function useAssets() {
  const [state, setState] = useState<{ assets: ManualAsset[] | null; rates: RateTable; failed: boolean }>({ assets: null, rates: RATES, failed: false })
  const reload = useCallback(() => {
    api.assets().then(
      (r) => setState({ assets: r.assets, rates: r.rates ?? RATES, failed: false }),
      (e: Error) => !(e instanceof SignedOut) && setState((s) => ({ ...s, assets: s.assets ?? [], failed: true })),
    )
  }, [])
  useEffect(reload, [reload])
  return { ...state, reload }
}

/**
 * Sovereign Gold Bonds in a CDSL statement (M29, owner 2026-11-27): valued at units × today's gold rate instead of the
 * exchange price, and filed under Gold & silver. `sgb` carries the series (its coupon) when the ISIN is in the table.
 * Without a rate the statement's value stays.
 */
export type SgbHolding = Holding & { sgb: SgbSeries | null; gold_rate_date: string | null }

export function revalueSgbs(holdings: Holding[], rates: RateTable, today = todayIst()): (Holding | SgbHolding)[] {
  const rate = metalRate(rates.metals, "gold", today)
  return holdings.map((h) => {
    const s = sgbOfHolding(h.isin, h.name)
    if (!s) return h
    const units = h.units ?? h.statement?.units ?? null
    const value = rate && units ? Math.round(units * rate.rate * 100) / 100 : h.value
    return {
      ...h,
      value,
      nav: rate && units ? rate.rate : h.nav,
      category: "SGB",
      asset_class: "Gold & silver",
      sgb: s === "unknown" ? null : s,
      gold_rate_date: rate && units ? rate.date : null,
    }
  })
}

export const isSgbHolding = (h: Holding): h is SgbHolding => "sgb" in h

/** "₹12,630/g on 26 Nov" (the date only when it isn't today's). */
export function perGram(r: AssetRow, today = todayIst()): string {
  const p = r.v.price
  if (!p) return "Rate unavailable"
  // silver is ~₹150/g: paise matter there
  return `${p.rate < 1000 ? inrExact(p.rate) : inr(p.rate)}/g${p.date < today ? ` on ${day(p.date)}` : ""}`
}
