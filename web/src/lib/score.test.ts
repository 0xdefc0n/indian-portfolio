import { describe, expect, it } from "vitest"

import type { Score } from "@/lib/api"
import { band, excessLine, noScoreText, scoreLine, sectorLine } from "@/lib/score"

const base: Score = { score: 72, reason: null, index: "Nifty Midcap 150", as_of: "2026-10-31", months: 120, since: "2016-10-31", excess: 2.14,
  rolling: [{ years: 3, windows: 85, beat: 80 }, { years: 5, windows: 61, beat: 68.85 }] }

describe("benchmark score words", () => {
  it("bands at 70 and 40", () => {
    expect([100, 70, 69, 40, 39, 0].map((s) => band(s).tone)).toEqual(["gain", "gain", "neutral", "neutral", "loss", "loss"])
  })
  it("says it plainly, from the longest rolling period", () => {
    expect(scoreLine(base)).toBe("Beat Nifty Midcap 150 in 7 of every 10 rolling 5-year periods since Oct 2016.")
    expect(excessLine(base)).toBe("2.1 points a year ahead after adjusting for risk.")
    expect(excessLine({ ...base, excess: -0.04 })).toBe("Level with the index after adjusting for risk.")
    expect(excessLine({ ...base, excess: -1.26 })).toBe("1.3 points a year behind after adjusting for risk.")
    expect(sectorLine(base)).toBeNull()
    expect(sectorLine({ ...base, sector: { index: "Nifty IT", years: 5, windows: 61, beat: 31, excess: -1.5 } })).toBe(
      "Against Nifty IT: beat it in 3 of every 10 rolling 5-year periods (−1.5 points a year).",
    )
  })
  it("explains a missing score, or says nothing while it's being worked out", () => {
    const none = { ...base, score: null, rolling: undefined }
    expect(scoreLine(none)).toBeNull()
    expect(noScoreText({ ...none, reason: "young", months: 20 })).toBe("Scored once it has 3 years of history (it has 20 months).")
    expect(noScoreText({ ...none, reason: "index_fund" })).toMatch(/index fund/)
    expect(noScoreText({ ...none, reason: "waiting" })).toBeNull()
  })
})
