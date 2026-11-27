// What kind of asset a holding is, for the Assets page groups. The engine knows a fund (INF ISIN) from a listed share
// or bond (INE/IN9). ETFs have INF ISINs too, so they're told apart by where they're held and by name:
// - anything in a CAMS/KFintech statement, or held in a folio, is a mutual fund (ETFs live only in demat);
// - a fund of funds that invests in an ETF ("Gold ETF FoF", "… ETF Fund of Fund") is a mutual fund, not an ETF.
// - a Sovereign Gold Bond in demat (M29) is gold, not a bond: it's valued at the gold rate.
import { sgbOfHolding } from "@manual-assets"

import type { Holding } from "@/lib/api"

export type HoldingKind = "mf" | "etf" | "stock" | "gold"
/** The Assets tab's switch: the holding kinds plus FD/PPF/EPF entered by hand (gold & silver ones join "gold"). */
export type AssetKind = HoldingKind | "fixed"

const ETF_RE = /\bETF\b|exchange traded|\bBeES\b/i
const FOF_RE = /\bFoF\b|fund of funds?|\bFOF\b/i

export function holdingKind(h: Pick<Holding, "isin" | "name" | "sebi_category" | "sources" | "folio">): HoldingKind {
  if (!h.isin.startsWith("INF")) return sgbOfHolding(h.isin, h.name) ? "gold" : "stock"
  const rtaHeld = !!h.folio || (h.sources ?? []).some((s) => s !== "CDSL")
  if (rtaHeld) return "mf"
  const text = `${h.name} ${h.sebi_category ?? ""}`
  return ETF_RE.test(text) && !FOF_RE.test(text) ? "etf" : "mf"
}

export const KIND_LABEL: Record<AssetKind, string> = {
  mf: "Mutual funds",
  etf: "ETFs",
  stock: "Stocks & bonds",
  fixed: "FD, PPF & EPF",
  gold: "Gold & silver",
}
