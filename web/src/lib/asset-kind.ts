// What kind of asset a holding is, for the Assets page groups. The engine knows a fund (INF ISIN) from a listed share
// or bond (INE/IN9); ETFs are exchange-traded funds (INF too), told apart by name.
import type { Holding } from "@/lib/api"

export type HoldingKind = "mf" | "etf" | "stock"

const ETF_RE = /\bETF\b|exchange traded|\bBeES\b/i

export function holdingKind(h: Pick<Holding, "isin" | "name" | "sebi_category">): HoldingKind {
  if (!h.isin.startsWith("INF")) return "stock"
  return ETF_RE.test(h.name) || ETF_RE.test(h.sebi_category ?? "") ? "etf" : "mf"
}

export const KIND_LABEL: Record<HoldingKind | "fixed", string> = {
  mf: "Mutual funds",
  etf: "ETFs",
  stock: "Stocks & bonds",
  fixed: "FD, PPF & EPF",
}
