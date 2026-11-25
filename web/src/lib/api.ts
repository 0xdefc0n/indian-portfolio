export type Account = { depository: string; broker: string; funds: number | null; value: number | null }

export type Member = {
  id: string
  name: string
  pan: string // masked by the server
  as_of: string | null
  total: number
  previous_total: number | null
  history: { month: string; value: number; flow?: number }[] // flow: net money in that month (transaction rebuild only)
  history_covers_all: boolean
  history_source: "transactions" | "cdsl"
  sources: string[]
  sips_known: boolean // false when the member has no CAMS/KFintech statement
  accounts: Account[]
  analysis: Analysis
}

export type HealthItem = { level: "ok" | "warn" | "info"; title: string; detail: string | null }

export type Analysis = {
  gains_by_fy: { fy: string; ltcg: number; stcg: number; equity_ltcg: number; sale: number }[]
  realised_funds: number
  replayed_funds: number
  harvest: {
    fy: string
    exemption: number
    realised_ltcg: number
    unrealised_lt_gain: number
    can_book: number
    funds_covered: number
    funds_total: number
  }
  money: {
    monthly: { month: string; invested: number; withdrawn: number }[]
    sip: number
    lumpsum: number
    stamp_duty: number
    stt: number
    dividends: number
    redeemed: number // gross redemptions (switches excluded)
    tds: number
    switched: number // moved between funds; not counted as money in or out
    period: [string | null, string | null] | null
  }
  health: HealthItem[]
}

export type TaxSplit = {
  equity: boolean
  since: string
  lt_value: number
  lt_gain: number
  st_value: number
  st_gain: number
  lt_units: number
}

export type Holding = {
  member_id: string
  isin: string
  name: string
  amc: string
  category: string
  broker: string
  folio: string | null
  sources: string[]
  units: number | null
  pledged: number
  nav: number | null
  value: number
  invested: number | null // cost of units held; only when the statement has full history
  as_of: string
  cashflows: [string, number][] | null // [date, ₹] money in negative; only with full history
  sip: { amount: number; frequency: string } | null // active SIP(s) in this fund
  sebi_category: string | null // e.g. "Mid Cap Fund"
  asset_class: string // Equity / Debt / Hybrid / Gold & silver / International / Stocks & bonds
  tax: TaxSplit | null // long/short-term split, only when every lot is known
  returns: Returns // the fund's own NAV returns (not the investor's)
  benchmark_value: number | null // same cash flows replayed into a Nifty 50 index fund
}

/** 1Y absolute, 3Y / 5Y annualised, as fractions; null when the fund is younger. */
export type Returns = { "1y": number | null; "3y": number | null; "5y": number | null }

export type Sip = {
  member_id: string
  isin: string
  name: string
  category: string
  folio: string | null
  amount: number // latest instalment, ₹
  frequency: "weekly" | "fortnightly" | "monthly" | "quarterly" | "irregular" | string
  interval_days: number
  start_date: string
  last_date: string
  next_date: string | null
  instalments: number
  invested: number
  status: "active" | "stopped"
}

export type Activity = {
  member_id: string
  isin: string
  name: string
  date: string
  units: number // + bought, − sold
  amount: number | null // ₹, from CAMS/KFintech statements
  sip: boolean
  kind: "sip" | "purchase" | "redemption" | "switch_in" | "switch_out" | "dividend"
  source: string
}

export type Portfolio = {
  members: Member[]
  holdings: Holding[]
  activity: Activity[]
  sips: Sip[]
  benchmark: { name: string; returns: Returns } | null
  stocks: StockData
}

/** Stocks inside each equity fund (monthly disclosures), keyed by the fund's ISIN. */
export type StockData = {
  enabled: boolean
  funds: Record<string, [string, number][]> // fund ISIN -> [stock ISIN, % of the fund]
  stocks: Record<string, { symbol: string | null; name: string; sector: string | null; type: string | null }>
  month: string | null // latest portfolio month
  oldest_month: string | null
  unmatched: string[] // fund ISINs with no portfolio found
  no_stocks: string[] // fund ISINs the provider has no portfolio rows for
  look_through: Record<string, { funds: number; looked_through: number }> // fund-of-funds progress
  pending: number // funds still waiting for a fetch
  refreshing: boolean
}

export type SaveResult = {
  saved: string[]
  failed: { file: string; error: string }[]
  parsed?: { ok: boolean; error?: string; holdings?: number }[]
  msg?: string
}

export type StatementRequestResult =
  | { mode: "sent"; password: string; msg: string }
  | { mode: "manual"; password: string; form_url: string }

/** Safe, user-facing copy for the Worker's error codes ({ ok: false, code }). */
const MESSAGES: Record<string, string> = {
  invalid_email: "Enter a valid email address.",
  turnstile_failed: "We couldn't check that you're not a bot. Try again.",
  rate_limited: "Too many sign-in emails. Wait a bit, then try again.",
  INVALID_OTP: "That code didn't work. Check it and try again.",
  OTP_EXPIRED: "That code has expired. Send a new one.",
  TOO_MANY_ATTEMPTS: "Too many tries with that code. Send a new one.",
}

async function readError(r: Response): Promise<string> {
  const data = await r.json().catch(() => ({}))
  if (typeof data.code === "string") return MESSAGES[data.code] ?? `Something went wrong (${data.code}).`
  let d = data.detail
  if (Array.isArray(d)) return d.map((e: { msg: string }) => e.msg.replace(/^Value error, /, "")).join("; ")
  if (d && typeof d === "object") {
    const reasons = (d.failed || []).map((f: { error: string }) => f.error)
    d = [d.msg, ...new Set(reasons)].join(" — ")
  }
  if (r.status === 429) return MESSAGES.rate_limited
  return d || data.message || `Request failed (${r.status})`
}

/** Only same-site paths: never send people to another origin after sign-in. */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") ? next : "/"
}

export function goToLogin() {
  const here = window.location.pathname + window.location.search + window.location.hash
  window.location.assign(`/login?next=${encodeURIComponent(safeNext(here))}`)
}

export class SignedOut extends Error {
  name = "SignedOut"
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init)
  // Global 401 handler (plan §13 item 8): the session ended, so go to /login and come back here afterwards.
  if (r.status === 401 && !url.startsWith("/api/auth/")) {
    goToLogin()
    throw new SignedOut("Signed out")
  }
  if (!r.ok) throw new Error(await readError(r))
  return r.json()
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
})

export type Me = {
  user: { name: string; email: string; image: string | null }
  household: { id: string; created_at: number }
  consent_ok: boolean
}

export type AppConfig = {
  features: { cdsl_fetch: boolean; kfintech_auto: boolean; stocks: boolean }
  kfintech_form_url: string
  turnstile_site_key: string
}

/** Sign-in calls (Better Auth under /api/auth, plus our one-email route, plan §7.1). */
export const auth = {
  emailLink: (email: string, turnstile_token: string) => call<{ ok: true }>("/api/login/email", json({ email, turnstile_token })),
  verifyCode: (email: string, otp: string) => call<unknown>("/api/auth/sign-in/email-otp", json({ email, otp })),
  google: (next: string) =>
    call<{ url: string }>("/api/auth/sign-in/social", json({ provider: "google", callbackURL: next, errorCallbackURL: "/login?error=google" })),
  signOut: () => call<unknown>("/api/auth/sign-out", json({})),
}

export const api = {
  portfolio: () => call<Portfolio>("/api/portfolio"),
  me: () => call<Me>("/api/me"),
  config: () => call<AppConfig>("/api/config"),
  requestStatement: (body: { pan: string; email: string; from_date: string; to_date: string; password: string }) =>
    call<StatementRequestResult>("/api/kfintech/request", json(body)),
  upload: (pan: string, password: string, file: File) => {
    const fd = new FormData()
    fd.append("pan", pan)
    fd.append("password", password)
    fd.append("file", file)
    return call<SaveResult>("/api/upload", { method: "POST", body: fd })
  },
  requestOtp: (pan: string, bo_id: string, dob: string) =>
    call<{ session_id: string; msg: string }>("/api/cdsl/request-otp", json({ pan, bo_id, dob })),
  verifyOtp: (session_id: string, otp: string) => call<SaveResult>("/api/cdsl/verify", json({ session_id, otp })),
}
