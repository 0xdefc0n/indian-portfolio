// Overall XIRR with funds plus manual assets (plan §21.12, M19), gold and SGBs (§21.5, M29), through the @manual-assets alias the app uses.
// Synthetic values; the expected numbers are worked out by hand below.
import { describe, expect, it } from "vitest"

import type { Holding, ManualAsset } from "@/lib/api"
import { holdingKind } from "@/lib/asset-kind"
import { assetFlows, assetTotals, fixedOnly, forMember, isSgbHolding, metalsOnly, perGram, revalueSgbs, valued } from "@/lib/assets"
import { inr } from "@/lib/format"
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

describe("gold and silver (M29)", () => {
  const rates = { ...RATES, metals: { gold: [["2026-11-26", 12_800]] as [string, number][], silver: [["2026-11-26", 154.3]] as [string, number][] } }
  const goldPaid: ManualAsset = { id: "g1", member_id: "m1", created_at: 0, updated_at: 0, type: "gold", inputs: { grams: 10, purity: 999, paid: 100_000, bought: "2025-01-01" } }
  const goldGift: ManualAsset = { id: "g2", member_id: "m1", created_at: 0, updated_at: 0, type: "gold", inputs: { grams: 10, purity: 916, paid: null, bought: null } }

  it("totals: everything's value, but invested and gain only where the price paid is known", () => {
    // paid: 1,28,000 value, 1,00,000 in, 28,000 gain; the gift: 10 × 12,800 × 0.916 = 1,17,248 value, no cost
    const rows = valued([goldPaid, goldGift], rates, "2026-11-26")
    expect(rows.map((r) => r.category)).toEqual(["Gold", "Gold"])
    const t = assetTotals(rows)
    expect(t.value).toBeCloseTo(245_248, 6)
    expect(t.costValue).toBe(128_000)
    expect(t.invested).toBe(100_000)
    expect(t.gain).toBe(28_000)
    expect(assetFlows(rows)).toEqual([{ date: "2025-01-01", amount: -100_000 }, { date: "2026-11-26", amount: 128_000 }])
    expect(fixedOnly(rows)).toEqual([])
    expect(metalsOnly(rows)).toHaveLength(2)
    expect(perGram(rows[1], "2026-11-26")).toBe(`${inr(11_724.8)}/g`)
    expect(perGram(rows[1], "2026-11-30")).toContain(" on ")
  })

  it("an SGB in a CDSL statement is valued at units × today's gold rate and filed under Gold & silver", () => {
    const base = { member_id: "m1", amc: "", broker: "CDSL", folio: null, sources: ["CDSL"], pledged: 0, invested: null, as_of: "2026-11-20", cashflows: null, sip: null, sebi_category: null, tax: null, returns: { "1y": null, "3y": null, "5y": null }, benchmark_value: null }
    const sgb = { ...base, isin: "IN0020200062", name: "SGB SYNTH", category: "Stocks & bonds", asset_class: "Stocks & bonds", units: 12, nav: 11_000, value: 132_000 } as Holding
    const share = { ...base, isin: "INE000S01EQ1", name: "Synth Industries", category: "Stocks & bonds", asset_class: "Stocks & bonds", units: 5, nav: 100, value: 500 } as Holding
    const [a, b] = revalueSgbs([sgb, share], rates, "2026-11-26")
    expect(a).toMatchObject({ value: 153_600, nav: 12_800, category: "SGB", asset_class: "Gold & silver", gold_rate_date: "2026-11-26" }) // 12 × 12,800
    expect(isSgbHolding(a) && a.sgb?.id).toBe("2020-21-I")
    expect(b).toBe(share)
    expect(holdingKind(a)).toBe("gold")
    // no rate yet: the statement's value stays
    expect(revalueSgbs([sgb], RATES, "2026-11-26")[0]).toMatchObject({ value: 132_000, category: "SGB", gold_rate_date: null })
  })
})
