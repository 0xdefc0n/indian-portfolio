/** Cash flow from the investor's side: money in is negative, money out (or current value) positive. */
export type Flow = { date: string; amount: number }

const DAY = 86_400_000

/**
 * Annualised internal rate of return for irregular cash flows (same as Excel XIRR / Groww).
 * Bisection on [-99.99%, +1000%]: slower than Newton but never diverges. Returns null if
 * there's no sign change (e.g. all flows positive).
 */
export function xirr(flows: Flow[]): number | null {
  const pts = flows
    .filter((f) => f.amount !== 0)
    .map((f) => ({ t: new Date(`${f.date}T00:00:00`).getTime(), a: f.amount }))
    .sort((x, y) => x.t - y.t)
  if (pts.length < 2 || !pts.some((p) => p.a < 0) || !pts.some((p) => p.a > 0)) return null
  const t0 = pts[0].t
  const npv = (r: number) => pts.reduce((s, p) => s + p.a / Math.pow(1 + r, (p.t - t0) / DAY / 365), 0)

  let lo = -0.9999
  let hi = 10
  let fLo = npv(lo)
  if (fLo * npv(hi) > 0) return null
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    const fMid = npv(mid)
    if (Math.abs(fMid) < 1e-7) return mid
    if (fLo * fMid > 0) {
      lo = mid
      fLo = fMid
    } else hi = mid
  }
  return (lo + hi) / 2
}

/** Flows for a set of holdings: their past cash flows plus today's value as a final inflow. */
export function holdingFlows(hs: { cashflows: [string, number][] | null; value: number; as_of: string }[]): Flow[] {
  return hs.flatMap((h) => [
    ...(h.cashflows ?? []).map(([date, amount]) => ({ date, amount })),
    { date: h.as_of, amount: h.value },
  ])
}
