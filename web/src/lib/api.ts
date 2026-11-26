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

/** POST /api/statements, direct path (plan §10.1 C8). The member comes from the statement itself (D19). */
export type AddedStatement = {
  statement: { id: string; kind: StatementKind; as_of: string; holdings_count: number; warnings_count: number }
  member: { id: string; name: string | null; pan_masked: string; created: boolean }
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
  invalid_name: "Enter a name of 1 to 60 characters.",
  not_found: "That's no longer here. Reload to see the latest.",
  // Uploads (plan §10.1 A–C, §11)
  bad_request: "Choose a statement PDF to upload.",
  not_pdf: "That file isn't a PDF. Upload the statement PDF as you received it.",
  file_too_large: "That file is over 10 MB. Upload the statement PDF as you received it.",
  password_required: "This statement is password-protected. Enter its password.",
  unrecognised: "Upload a CDSL or CAMS/KFintech consolidated statement.",
  too_large: "That statement has more than 300 pages. Request one for a shorter period.",
  pan_mismatch: "This statement's PAN doesn't match the PAN that opened it. Check that it's the right file.",
  member_limit: "Your family portfolio already has 10 members. Remove one in Members to add someone new.",
  already_added: "This statement has already been added.",
  already_processing: "This statement is already being processed.",
  upload_limit: "You've reached the upload limit for now. Try again later.",
  too_many_failures: "Too many uploads didn't work in the last hour. Try again later.",
  jobs_limit: "Finish the uploads in progress first.",
  parse_error: "We couldn't read this statement. Download it again, or try the other statement type.",
  multi_pan: "This statement covers more than one PAN. Upload one statement per member.",
  precheck_disagree: "We couldn't read this statement. Try again, or try the other statement type.",
  parse_timeout: "Reading this statement took too long. Try again in a minute.",
  busy: "We're reading a lot of statements right now. Try again in a few seconds.",
  engine_unavailable: "We can't read statements right now. Try again in a minute.",
}

/** A refused API call: `code` is the Worker's stable error code, `data` the rest of its JSON body. */
export class ApiFailure extends Error {
  name = "ApiFailure"
  readonly status: number
  readonly code: string | null
  readonly data: Record<string, unknown>
  constructor(message: string, status: number, code: string | null, data: Record<string, unknown>) {
    super(message)
    this.status = status
    this.code = code
    this.data = data
  }
}

async function readError(r: Response): Promise<ApiFailure> {
  const data: Record<string, unknown> = await r.json().catch(() => ({}))
  const code = typeof data.code === "string" ? data.code : null
  return new ApiFailure(messageFor(r.status, code, data), r.status, code, data)
}

function messageFor(status: number, code: string | null, data: Record<string, unknown>): string {
  if (code) return MESSAGES[code] ?? `Something went wrong (${code}).`
  if (status === 429) return MESSAGES.rate_limited
  return typeof data.message === "string" ? data.message : `Request failed (${status})`
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
  if (!r.ok) throw await readError(r)
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

/** GET /api/members (plan §9.2). Names are null until a statement or a rename gives one. */
export type StatementKind = "CDSL" | "CAMS" | "KFINTECH"
export type MemberSummary = {
  id: string
  name: string | null
  pan_masked: string
  statements: { id: string; kind: StatementKind; as_of: string; holdings_count: number }[]
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
  members: () => call<{ members: MemberSummary[] }>("/api/members").then((r) => r.members),
  renameMember: (id: string, name: string) =>
    call<{ member: { id: string; name: string } }>(`/api/members/${encodeURIComponent(id)}`, { ...json({ name }), method: "PATCH" }),
  deleteMember: (id: string) => call<{ ok: true }>(`/api/members/${encodeURIComponent(id)}`, { method: "DELETE" }),
  me: () => call<Me>("/api/me"),
  config: () => call<AppConfig>("/api/config"),
  requestStatement: (body: { pan: string; email: string; from_date: string; to_date: string; password: string }) =>
    call<StatementRequestResult>("/api/kfintech/request", json(body)),
  /** The file and an optional password only: no PAN and no member (D19). */
  addStatement: (file: File, password: string) => {
    const fd = new FormData()
    fd.append("file", file)
    if (password) fd.append("password", password)
    return call<AddedStatement>("/api/statements", { method: "POST", body: fd })
  },
  deleteStatement: (id: string) => call<{ ok: true }>(`/api/statements/${encodeURIComponent(id)}`, { method: "DELETE" }),
}
