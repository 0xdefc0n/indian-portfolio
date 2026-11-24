const inrFmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 })
const inrPaise = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 })
const numFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3, minimumFractionDigits: 3 })
const navFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 4, minimumFractionDigits: 2 })

/** ₹12,31,214 */
export const inr = (v: number | null | undefined) => (v == null ? "—" : inrFmt.format(v))
/** ₹12,31,214.30 */
export const inrExact = (v: number | null | undefined) => (v == null ? "—" : inrPaise.format(v))
/** ₹12.3L / ₹1.24Cr / ₹48.2K — for chart axes */
export function inrShort(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e7) return `₹${(v / 1e7).toFixed(2)}Cr`
  if (a >= 1e5) return `₹${(v / 1e5).toFixed(1)}L`
  if (a >= 1e3) return `₹${(v / 1e3).toFixed(0)}K`
  return `₹${v.toFixed(0)}`
}
export const units = (v: number | null | undefined) => (v == null ? "—" : numFmt.format(v))
export const nav = (v: number | null | undefined) => (v == null ? "—" : navFmt.format(v))
export const pct = (v: number, digits = 1) => `${v.toFixed(digits)}%`

export function signed(v: number, f: (n: number) => string): string {
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${f(Math.abs(v))}`
}

/** '2026-10-31' -> '31 Oct 2026' */
export function day(iso: string | null | undefined): string {
  if (!iso) return "—"
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
}
/** '2026-10' -> 'Oct' (or "Oct '26" with year) */
export function month(key: string, withYear = false): string {
  const d = new Date(`${key}-01T00:00:00`)
  const m = d.toLocaleDateString("en-IN", { month: "short" })
  return withYear ? `${m} ’${String(d.getFullYear()).slice(2)}` : m
}

export const CATEGORY_COLOR: Record<string, string> = {
  "Large cap": "var(--cat-large)",
  "Large & mid cap": "var(--cat-largemid)",
  "Mid cap": "var(--cat-mid)",
  "Small cap": "var(--cat-small)",
  "Flexi & multi cap": "var(--cat-flexi)",
  "Sectoral & thematic": "var(--cat-sector)",
  ELSS: "var(--cat-elss)",
  Hybrid: "var(--cat-hybrid)",
  Debt: "var(--cat-debt)",
  "Gold & silver": "var(--cat-gold)",
  International: "var(--cat-intl)",
  "Stocks & bonds": "var(--cat-stocks)",
  "Other funds": "var(--cat-other)",
}
export const categoryColor = (c: string) => CATEGORY_COLOR[c] ?? "var(--cat-other)"

const PER: Record<string, string> = { weekly: "week", fortnightly: "fortnight", monthly: "month", quarterly: "quarter" }
/** 'monthly' -> '/month' ; mixed/irregular -> '' */
export const per = (frequency: string) => (PER[frequency] ? `/${PER[frequency]}` : "")
/** Monthly equivalent of an instalment, for totals */
export function monthly(amount: number, frequency: string): number {
  const factor: Record<string, number> = { weekly: 52 / 12, fortnightly: 26 / 12, quarterly: 1 / 3 }
  return amount * (factor[frequency] ?? 1)
}

export const ASSET_COLOR: Record<string, string> = {
  Equity: "var(--cat-large)",
  Debt: "var(--cat-debt)",
  Hybrid: "var(--cat-hybrid)",
  "Gold & silver": "var(--cat-gold)",
  International: "var(--cat-intl)",
  "Stocks & bonds": "var(--cat-stocks)",
}
