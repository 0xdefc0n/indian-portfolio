import type { Daily } from "@/lib/api"

/** The 1D figures per holding: `${member_id}|${isin}` → today's change (plan §10.5.4). */
export function byFund(daily: Daily | null | undefined) {
  return new Map((daily?.today?.by_fund ?? []).map((f) => [`${f.member_id}|${f.isin}`, f]))
}
