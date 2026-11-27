// Words for a benchmark score (M28, plan §21.4). The number and its parts come from the Worker; this only phrases them.
import type { Score } from "@/lib/api"
import { day, pct, signed } from "@/lib/format"

export type Band = { label: string; tone: "gain" | "neutral" | "loss" }

/** 70–100 ahead, 40–69 close, 0–39 behind. */
export function band(score: number): Band {
  if (score >= 70) return { label: "Ahead of its index", tone: "gain" }
  if (score >= 40) return { label: "Close to its index", tone: "neutral" }
  return { label: "Behind its index", tone: "loss" }
}

export const toneClass = (b: Band) => (b.tone === "gain" ? "text-gain" : b.tone === "loss" ? "text-loss" : "text-muted-foreground")

const monthYear = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" })

/** "Beat Nifty Midcap 150 in 7 of every 10 rolling 5-year periods since Oct 2016." */
export function scoreLine(s: Score): string | null {
  const w = s.rolling?.at(-1)
  if (s.score == null || !w || !s.index || !s.since) return null
  return `Beat ${s.index} in ${Math.round(w.beat / 10)} of every 10 rolling ${w.years}-year periods since ${monthYear(s.since)}.`
}

/** "2.1 points a year ahead after adjusting for risk." */
export function excessLine(s: Score): string | null {
  if (s.score == null || s.excess == null) return null
  const e = Math.round(s.excess * 10) / 10
  if (e === 0) return "Level with the index after adjusting for risk."
  return `${pct(Math.abs(e), 1).replace("%", "")} points a year ${e > 0 ? "ahead" : "behind"} after adjusting for risk.`
}

export function sectorLine(s: Score): string | null {
  const x = s.sector
  if (!x) return null
  return `Against ${x.index}: beat it in ${Math.round(x.beat / 10)} of every 10 rolling ${x.years}-year periods (${signed(x.excess, (n) => `${n.toFixed(1)} points`)} a year).`
}

/** Why there is no score (null when it simply isn't ready yet). */
export function noScoreText(s: Score): string | null {
  switch (s.reason) {
    case "young":
      return `Scored once it has 3 years of history (it has ${s.months ?? 0} months).`
    case "index_fund":
      return "An index fund or ETF tracks its index, so it isn't scored."
    case "not_equity":
      return "Only equity funds and shares are scored for now."
    case "unmapped":
      return "No index for this fund's category yet."
    case "idcw_no_twin":
      return "No growth option found to score this payout option by."
    default:
      return null
  }
}

export const asOfText = (s: Score) => `as of ${day(s.as_of)}`
