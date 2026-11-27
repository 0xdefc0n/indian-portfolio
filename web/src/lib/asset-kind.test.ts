import { describe, expect, it } from "vitest"

import { holdingKind } from "@/lib/asset-kind"

const demat = { sources: ["CDSL"], folio: null }
const rta = { sources: ["CAMS"], folio: "F-1" }

describe("holdingKind", () => {
  it("tells mutual funds, ETFs and listed shares apart (synthetic names)", () => {
    expect(holdingKind({ isin: "INF000S01FC1", name: "Synth Flexi Cap Fund - Direct Growth", sebi_category: "Flexi Cap Fund", ...rta })).toBe("mf")
    expect(holdingKind({ isin: "INF000S02ET2", name: "Synth Nifty 50 ETF", sebi_category: null, ...demat })).toBe("etf")
    expect(holdingKind({ isin: "INF000S03BE3", name: "Synth Gold BeES", sebi_category: null, ...demat })).toBe("etf")
    expect(holdingKind({ isin: "INF000S04IX4", name: "Synth Nifty 50 Index Fund", sebi_category: "Index Funds", ...demat })).toBe("mf")
    expect(holdingKind({ isin: "INE000S01EQ1", name: "Synth Industries Limited", sebi_category: null, ...demat })).toBe("stock")
  })

  it("a fund of funds that invests in an ETF is a mutual fund", () => {
    expect(holdingKind({ isin: "INF000S05GF5", name: "Synth Gold ETF FoF", sebi_category: "FoF Domestic", ...rta })).toBe("mf")
    expect(holdingKind({ isin: "INF000S05GF5", name: "Synth Gold ETF FoF", sebi_category: null, ...demat })).toBe("mf") // even in demat
    expect(holdingKind({ isin: "INF000S06GF6", name: "Synth Silver ETF Fund of Fund", sebi_category: null, ...demat })).toBe("mf")
  })

  it("anything from a CAMS/KFintech statement or a folio is a mutual fund, whatever its name", () => {
    expect(holdingKind({ isin: "INF000S02ET2", name: "Synth Nifty 50 ETF", sebi_category: null, ...rta })).toBe("mf")
    expect(holdingKind({ isin: "INF000S02ET2", name: "Synth Nifty 50 ETF", sebi_category: null, sources: ["CDSL", "KFINTECH"], folio: null })).toBe("mf")
  })
})
