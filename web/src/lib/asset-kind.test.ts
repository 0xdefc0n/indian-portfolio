import { describe, expect, it } from "vitest"

import { holdingKind } from "@/lib/asset-kind"

describe("holdingKind", () => {
  it("tells mutual funds, ETFs and listed shares apart (synthetic names)", () => {
    expect(holdingKind({ isin: "INF000S01FC1", name: "Synth Flexi Cap Fund - Direct Growth", sebi_category: "Flexi Cap Fund" })).toBe("mf")
    expect(holdingKind({ isin: "INF000S02ET2", name: "Synth Nifty 50 ETF", sebi_category: null })).toBe("etf")
    expect(holdingKind({ isin: "INF000S03BE3", name: "Synth Gold BeES", sebi_category: null })).toBe("etf")
    expect(holdingKind({ isin: "INF000S04IX4", name: "Synth Nifty 50 Index Fund", sebi_category: "Index Funds" })).toBe("mf")
    expect(holdingKind({ isin: "INE000S01EQ1", name: "Synth Industries Limited", sebi_category: null })).toBe("stock")
  })
})
