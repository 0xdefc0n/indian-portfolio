// Overall XIRR with funds plus manual assets (plan §21.12, M19), through the @manual-assets alias the app uses.
// Synthetic values; the expected numbers are worked out by hand below.
import { describe, expect, it } from "vitest"

import type { ManualAsset } from "@/lib/api"
import { assetFlows, assetTotals, forMember, valued } from "@/lib/assets"
import { holdingFlows, xirr } from "@/lib/xirr"
import { RATES } from "@manual-assets"

const fd: ManualAsset = {
  id: "a1", member_id: "m1", created_at: 0, updated_at: 0, type: "fd",
  inputs: { amount: 100_000, rate: 7, start: "2025-01-01", tenure: { years: 1, months: 0, days: 0 }, payout: null, closed: null },
}
const epf: ManualAsset = {
  id: "a2", member_id: null, created_at: 0, updated_at: 0, type: "epf",
  inputs: { balance: 50_000, as_of: "2026-01-01", monthly: 0, stopped: null, rate: null },
}

describe("Overall XIRR", () => {
  it("adds FD, PPF and EPF flows to the funds' flows", () => {
    // A fund: 1,00,000 in on 1 Jan 2025, worth 1,10,000 on 1 Jan 2026 (365 days): XIRR 10%.
    const fund = [{ cashflows: [["2025-01-01", -100_000]] as [string, number][], value: 110_000, as_of: "2026-01-01" }]
    expect(xirr(holdingFlows(fund))).toBeCloseTo(0.1, 6)
    // The FD: 1,00,000 at 7% for a year, matured on 1 Jan 2026 at 1,00,000 × 1.0175⁴ = 1,07,185.90.
    // Both went in and came out on the same days, so Overall = (1,10,000 + 1,07,185.90) / 2,00,000 − 1 = 8.5930%.
    const rows = valued([fd], RATES, "2026-01-01")
    expect(rows[0].name).toBe("FD · 1 year · 7%")
    expect(rows[0].category).toBe("Fixed deposit")
    expect(xirr([...holdingFlows(fund), ...assetFlows(rows)])).toBeCloseTo(0.0859295, 5)
  })

  it("filters by member (unassigned ones only for everyone) and totals", () => {
    const rows = valued([fd, epf], RATES, "2026-01-01")
    expect(forMember(rows, "m1").map((r) => r.id)).toEqual(["a1"])
    expect(forMember(rows, null).map((r) => r.id)).toEqual(["a1", "a2"])
    const t = assetTotals(rows)
    expect(t.invested).toBe(150_000)
    expect(t.value).toBeCloseTo(157_185.9, 1) // the EPF has earned nothing yet on its balance date
  })
})
