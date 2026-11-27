import type { Asset as CalcAsset, RateTable } from "@manual-assets"

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
  /** "waiting": some months use the statement's own NAVs while a sold fund's daily NAVs download (rebuilt soon);
   *  "estimated": some months stay on statement NAVs (no daily NAVs exist for that fund). */
  history_note?: "waiting" | "estimated" | null
  sources: string[]
  sips_known: boolean // false when the member has no CAMS/KFintech statement
  accounts: Account[]
  analysis: Analysis
  // M12: `total` is at the latest NAV (value_date); `as_of` stays the newest statement date
  statement_total?: number
  value_date?: string | null
  estimated?: EstimatedTotals & { pending_amount: number }
}

/** SIP instalments estimated since the statement (plan §10.5.1, M12). `pending`: run, but their NAV isn't out yet. */
export type EstimatedTotals = { instalments: number; amount: number; pending: number; in_progress: number; in_progress_amount: number }

/** Why an instalment runs on another day than its due date: the next business day (as brokers do). */
export type Moved = "weekend" | "holiday" | null

/** Broker-style instalment status: debited and waiting for units (T to T+2 business days), or done. */
export type InstalmentStatus = "in_progress" | "done"

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
  // M12: units / nav / value / as_of are at the latest NAV, estimated SIP units included; the statement's own figures:
  statement?: { units: number | null; nav: number | null; value: number; as_of: string }
  amfi_code?: string | null
  /** M20: "exchange" = a share or bond at its latest exchange close; "nav" = a fund at its latest NAV; "statement" =
   *  the statement's own price (unlisted, or no price yet). */
  price_source?: "nav" | "exchange" | "statement"
  units_exact?: boolean
  estimated?: (EstimatedTotals & { since: string; units: number }) | null
  /** M28: how the fund or share did against its index (market data, the same for everyone). Absent on older builds. */
  score?: Score | null
  /** M21 (shares and ETFs): where the buy price comes from. "partial": some shares have no known price. */
  cost_source?: "tradebook" | "manual" | "partial" | "tradebook+manual" | "none"
  /** Shares whose buy price isn't known (bought before the tradebook covers, or no buy price added). */
  unknown_units?: number
  avg_price?: number | null
  /** M21: a merger or demerger after the statement (shares), or a fund whose NAV stopped (a possible scheme merger). */
  notice?: { kind: "merger" | "demerger" | "fund_merger"; ex_date: string | null; text: string } | null
  /** M21: estimated dividends since the first statement, [ex-date, ₹] (before TDS). */
  dividends?: [string, number][]
  /** M21: false for a share NSE doesn't list (BSE only): splits and bonuses aren't tracked for it. */
  corp_actions_tracked?: boolean
}

/** GET /api/tradebooks (M21): broker tradebooks (parsed trades only) and manual average buy prices. */
export type Tradebook = { id: string; member_id: string; broker: string; broker_name: string; period_from: string | null; period_to: string | null; trades_count: number }
export type StockCost = { member_id: string; isin: string; avg_price: number; since: string | null }

/** A benchmark score (worker/src/market/score.ts `ScoreView`). Percentages are numbers like 12.34 (= 12.34%). */
export type Score = {
  score: number | null
  reason: "young" | "unmapped" | "index_fund" | "not_equity" | "no_data" | "waiting" | "idcw_no_twin" | null
  index: string | null
  as_of: string
  months?: number
  since?: string
  excess?: number // risk-adjusted, points a year
  consistency?: number
  horizons?: { years: number; fund: number; index: number }[]
  rolling?: { years: number; windows: number; beat: number }[]
  sector?: { index: string; years: number; windows: number; beat: number; excess: number } | null
  growth_option?: boolean
  price_only?: boolean
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
  next_date: string | null // the next run date (moved past weekends and holidays)
  instalments: number
  invested: number
  status: "active" | "stopped" | "cancelled" // cancelled: the user told PocketFolio (M12)
  sip_day?: number | null // the mandate's day of the month
  next_due?: string | null // the scheduled date behind next_date
  next_moved?: Moved
  /** The latest instalment run since the statement (estimated). */
  latest?: { due: string; date: string; moved: Moved; amount: number; status: InstalmentStatus; units_by: string } | null
  estimated?: { instalments: number; amount: number }
  skipped?: string[] // upcoming due dates the user skipped
  cancelled_on?: string | null
}

/** Which SIP a skip or cancel is about (the snapshot's member, fund and folio). */
export type SipRef = { member_id: string; isin: string; folio: string | null }

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
  // M12: an estimated SIP instalment since the statement (units are 0 until its NAV is out)
  estimated?: boolean
  status?: InstalmentStatus
  due?: string
  moved?: Moved
  units_by?: string
}

/** GET /api/portfolio/daily (plan §10.5.3). Fractions for pct. */
export type DayChange = { change: number; pct: number | null }
export type Daily = {
  as_of: string | null
  coverage: { updated: number; total: number }
  today: (DayChange & { by_member: (DayChange & { member_id: string })[]; by_fund: (DayChange & { member_id: string; isin: string; nav_date: string })[] }) | null
  series: { date: string; value: number; change: number; pct: number | null; flag: string | null }[]
  notes: { units_as_of: string | null; units_exact: boolean; estimated: { instalments: number; amount: number }; excluded: number }
}

export type Portfolio = {
  members: Member[]
  holdings: Holding[]
  activity: Activity[]
  sips: Sip[]
  benchmark: { name: string; returns: Returns } | null
  stocks: StockData
  /** From the X-Snapshot-* headers (plan §10.2): built on an older NAV day, or an update is on its way. */
  stale: boolean
  building: boolean
}

/** GET /api/market/status (public, cached 5 min): the latest full NAV day and how complete it is. */
export type MarketStatus = { latest_nav_date: string | null; coverage_pct: number | null; final: boolean }

/** GET /api/portfolio/status: whether the dashboard is up to date with the latest statements and NAVs. */
export type PortfolioStatus = {
  status: "empty" | "ready" | "building" | "pending" | "failed"
  building: boolean
  pending: boolean
  stale: boolean
  market_date: string | null
  built_at: number | null
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

/** POST /api/statements, queued path (plan §10.1 D7): every check passed and the PDF waits for an engine slot. */
export type QueuedUpload = { job: { id: string; position: number; eta_s: number } }

/** GET /api/jobs (plan §9.2). No PDF data, names or PANs: a finished job points at its statement. */
export type JobStatus = "queued" | "parsing" | "done" | "failed" | "expired"
export type Job = {
  id: string
  status: JobStatus
  position: number | null // 1 = next in line; only while queued
  eta_s: number | null
  error_code: string | null
  statement_id: string | null
  created_at: number
}
export type JobDetail = Job & Partial<AddedStatement>

export type StatementRequestResult =
  | { mode: "sent"; password: string; msg: string }
  | { mode: "manual"; password: string; form_url: string }

/** Safe, user-facing copy for the Worker's error codes ({ ok: false, code }). */
/** The safe message for a failed job's code (plan §13 item 5). */
export const jobMessage = (code: string | null) => (code && MESSAGES[code]) || MESSAGES.parse_error

const MESSAGES: Record<string, string> = {
  invalid_email: "Enter a valid email address.",
  disposable_email: "That looks like a temporary email address. Use an inbox you'll keep, or continue with Google.",
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
  queue_full: "We're reading a lot of statements right now. Try again in a few minutes.",
  job_running: "This statement is being read right now. It'll be done in a moment.",
  password_unavailable: "The password for this statement expired before we could read it. Add it again.",
  expired: "We couldn't read this statement in time. Add it again.",
  engine_unavailable: "We can't read statements right now. Try again in a minute.",
  // SIP changes (M12)
  bad_due_date: "Only the next instalment can be skipped. Reload to see the latest dates.",
  sip_cancelled: "This SIP is cancelled in PocketFolio.",
  too_many_changes: "Too many SIP changes saved. Add a newer statement to clear the old ones.",
  confirm_required: "Confirm the cancellation to continue.",
  // Privacy (M14)
  adult_required: "Confirm that you're 18 or older to continue.",
  notice_changed: "The privacy notice has just changed. Reload to read the new one.",
  export_limit: "You've downloaded your data 3 times today. Try again tomorrow.",
  asset_limit: "You can add up to 50 FDs, PPF and EPF accounts.",
  asset_write_limit: "You've made a lot of changes today. Try again tomorrow.",
  bad_input: "Check the amounts and dates and try again.",
  reauth_required: "For your safety, sign in again to delete your account.",
  consent_required: "Accept the privacy notice to continue.",
  // Stock gains (M21)
  not_tradebook: "That doesn't look like a tradebook we can read. Download the equity tradebook (CSV or Excel) from your broker.",
  tradebook_locked: "This file is password-protected and the member's PAN didn't open it. Download it again without a password.",
  no_trades: "This tradebook has no share trades in it.",
  engine_busy: "We're busy reading other files. Try again in a minute.",
  tradebook_limit: "This member already has the most tradebooks we keep. Delete an old one first.",
  stock_cost_limit: "You've added the most buy prices we keep.",
  bad_since: "Pick a month that isn't in the future.",
  // QR device login (M13)
  qr_limit: "Too many QR codes from this network. Wait a bit, or sign in with Google or email.",
  link_limit: "Too many tries. Wait a few minutes, then scan the code again.",
  invalid_code: "That code isn't valid. Check it against the other screen, or show a new QR code there.",
  code_expired: "That code has expired. Show a new QR code on the other device.",
  already_used: "That code has already been used. Show a new QR code on the other device.",
  current_device: "That's this device. Use Sign out instead.",
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

/**
 * 403 consent_required (M14): the notice changed while the app was open. Reloading shows the consent screen, since
 * /api/me then says consent_ok: false. Throws SignedOut so callers stay quiet, as for a 401.
 */
async function consentGate(r: Response): Promise<void> {
  if (r.status !== 403) return
  const body = await r.clone().json().catch(() => null)
  if (body?.code !== "consent_required") return
  window.location.reload()
  throw new SignedOut("Consent required")
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init)
  // Global 401 handler (plan §13 item 8): the session ended, so go to /login and come back here afterwards.
  if (r.status === 401 && !url.startsWith("/api/auth/")) {
    goToLogin()
    throw new SignedOut("Signed out")
  }
  await consentGate(r)
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
  /** The privacy notice version the server wants accepted (M14). */
  notice_version?: string
  /** Devices linked by QR since this one last asked: shown once as a toast (plan §7.4, M13). */
  new_devices?: DevicePlace[]
}

/** "Chrome · macOS", plus Cloudflare's approximate city and country. */
export type DevicePlace = { label: string; city: string | null; country: string | null }

/** "Chrome · macOS · Mumbai" */
export const deviceLine = (d: DevicePlace) => [d.label, d.city ?? d.country].filter(Boolean).join(" · ")

/** A signed-out device's QR login request (plan §7.4). `user_code` is "ABCD-EFGH". */
export type QrCode = { device_code: string; user_code: string; verification_uri_complete: string; expires_in: number; interval: number }
export type QrStatus = "pending" | "slow_down" | "approved" | "denied" | "expired"

/** GET /api/link: the device asking to sign in, for the approval page. */
export type LinkRequest = { user_code: string; device: DevicePlace; expires_at: number | null }

/** Settings → Devices: one signed-in session of this account. */
export type Device = DevicePlace & {
  id: string
  signed_in_at: number | null
  last_active_at: number | null
  current: boolean
  /** Linked by QR in the last 7 days. */
  new: boolean
}

/** GET /api/members (plan §9.2). Names are null until a statement or a rename gives one. */
export type StatementKind = "CDSL" | "CAMS" | "KFINTECH"
export type MemberSummary = {
  id: string
  name: string | null
  pan_masked: string
  statements: { id: string; kind: StatementKind; as_of: string; holdings_count: number }[]
}

/** GET /api/assets (plan §21.12, M19): inputs only; values are computed here with the shared calculator. */
export type ManualAsset = { id: string; member_id: string | null; created_at: number; updated_at: number } & CalcAsset
export type AssetBody = CalcAsset & { member_id: string | null }

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
  /** QR login on this (signed-out) device; poll until another device approves it. */
  qrStart: () => call<QrCode>("/api/login/qr", json({})),
  qrPoll: (device_code: string) => call<{ status: QrStatus }>("/api/login/qr/poll", json({ device_code })),
}

/** Fetch with the global 401 handler, returning the raw response (for headers). */
async function raw(url: string): Promise<Response> {
  const r = await fetch(url)
  if (r.status === 401) {
    goToLogin()
    throw new SignedOut("Signed out")
  }
  await consentGate(r)
  if (!r.ok) throw await readError(r)
  return r
}

const retryAfter = (r: Response) => {
  const after = Number(r.headers.get("Retry-After"))
  return Number.isFinite(after) && after > 0 ? after : null
}

/**
 * Wait until the dashboard has caught up (no build running or due), polling /api/portfolio/status with backoff and
 * following Retry-After (§11). Resolves with the last status; gives up after `maxMs` (the build carries on).
 */
export async function waitForPortfolio(opts: { maxMs?: number; signal?: AbortSignal } = {}): Promise<PortfolioStatus | null> {
  const deadline = Date.now() + (opts.maxMs ?? 90_000)
  let wait = 2
  while (Date.now() < deadline && !opts.signal?.aborted) {
    const r = await raw("/api/portfolio/status")
    const s = (await r.json()) as PortfolioStatus
    if (!s.building && !s.pending) return s
    await new Promise((done) => setTimeout(done, 1000 * Math.min(15, Math.max(wait, retryAfter(r) ?? 0))))
    wait = Math.min(15, wait * 1.5)
  }
  return null
}

export type Metric =
  | "install_prompt_shown" | "install_accepted" | "install_dismissed" | "app_installed" | "launch_standalone" | "launch_shortcut"
const sentMetrics = new Set<Metric>()

/** No network, as opposed to an HTTP error answer: fetch() rejects with a TypeError whose message differs by browser. */
export const isOffline = (e: unknown) =>
  !navigator.onLine || (e instanceof TypeError && /fetch|network|load failed/i.test(e.message))

export const api = {
  /** The snapshot JSON (sent gzip as stored) plus the stale/building flags from its headers. */
  portfolio: async (): Promise<Portfolio> => {
    const r = await raw("/api/portfolio")
    const body = (await r.json()) as Omit<Portfolio, "stale" | "building">
    return { ...body, stale: r.headers.get("X-Snapshot-Stale") === "1", building: r.headers.get("X-Snapshot-Building") === "1" }
  },
  portfolioStatus: () => call<PortfolioStatus>("/api/portfolio/status"),
  /** The whole year for one member key (the server caches 366 days per key); views slice it. */
  daily: (member: string, days = 366) =>
    call<Daily>(`/api/portfolio/daily?days=${days}&member=${encodeURIComponent(member)}`).then((d) => {
      // A hint, never a reason to break the dashboard: anything malformed counts as "unavailable".
      if (!d || !d.coverage || !Array.isArray(d.series) || !d.notes) throw new Error("bad daily answer")
      return d
    }),
  marketStatus: () => call<MarketStatus>("/api/market/status"),
  members: () => call<{ members: MemberSummary[] }>("/api/members").then((r) => r.members),
  renameMember: (id: string, name: string) =>
    call<{ member: { id: string; name: string } }>(`/api/members/${encodeURIComponent(id)}`, { ...json({ name }), method: "PATCH" }),
  deleteMember: (id: string) => call<{ ok: true }>(`/api/members/${encodeURIComponent(id)}`, { method: "DELETE" }),
  me: () => call<Me>("/api/me"),
  /** Accept the privacy notice (plan §12): the 18+ box is part of it. */
  consent: (notice_version: string) => call<{ ok: true }>("/api/consent", json({ notice_version, adult: true })),
  /** Everything PocketFolio holds about the user, decrypted (DPDP access right), saved as a JSON file. */
  downloadMyData: async () => {
    const r = await raw("/api/account/export")
    const blob = await r.blob()
    const name = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") ?? "")?.[1] ?? "pocketfolio-export.json"
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = name
    document.body.append(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  },
  /** Delete the account and everything in it (crypto-shred). Needs a sign-in from the last 10 minutes. */
  deleteAccount: () => call<{ ok: true }>("/api/account", { ...json({ confirm: "DELETE" }), method: "DELETE" }),
  config: () => call<AppConfig>("/api/config"),
  /** The approval page (/link): looking a code up also claims it for this account. */
  linkRequest: (userCode: string) => call<LinkRequest>(`/api/link?user_code=${encodeURIComponent(userCode)}`),
  approveLink: (user_code: string) => call<{ ok: true }>("/api/link/approve", json({ user_code })),
  denyLink: (user_code: string) => call<{ ok: true }>("/api/link/deny", json({ user_code })),
  devices: () => call<{ devices: Device[] }>("/api/devices").then((r) => r.devices),
  signOutDevice: (id: string) => call<{ ok: true }>(`/api/devices/${encodeURIComponent(id)}`, { method: "DELETE" }),
  signOutOtherDevices: () => call<{ ok: true; signed_out: number }>("/api/devices/sign-out-others", json({})),
  /**
   * An anonymous product counter (plan §13A.6). Fire and forget: never an error on screen and never a redirect to
   * /login (signed out, the Worker answers 401 and nothing is counted). Each metric is sent once per page load.
   */
  metric: (name: Metric) => {
    if (sentMetrics.has(name)) return
    sentMetrics.add(name)
    fetch("/api/metrics", { ...json({ metric: name }), keepalive: true }).catch(() => undefined)
  },
  requestStatement: (body: { pan: string; email: string; from_date: string; to_date: string; password: string }) =>
    call<StatementRequestResult>("/api/kfintech/request", json(body)),
  /**
   * The file and an optional password only: no PAN and no member (D19). XHR, not fetch, so the dialog can tell
   * "uploading" from "reading statement" (`onUploaded` fires once the body is sent).
   */
  addStatement: (file: File, password: string, onUploaded?: () => void) => {
    const fd = new FormData()
    fd.append("file", file)
    if (password) fd.append("password", password)
    return new Promise<AddedStatement | QueuedUpload>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open("POST", "/api/statements")
      xhr.upload.onload = () => onUploaded?.()
      xhr.onerror = () => reject(new ApiFailure("Couldn't reach PocketFolio. Check your connection and try again.", 0, null, {}))
      xhr.onload = async () => {
        const r = new Response(xhr.responseText, { status: xhr.status, headers: { "content-type": "application/json" } })
        if (r.status === 401) {
          goToLogin()
          return reject(new SignedOut("Signed out"))
        }
        if (!r.ok) return reject(await readError(r))
        resolve(await r.json())
      }
      xhr.send(fd)
    })
  },
  jobs: () => call<{ jobs: Job[] }>("/api/jobs").then((r) => r.jobs),
  /** One job, and the server's suggested next poll in seconds (Retry-After, §11). */
  job: async (id: string) => {
    const r = await raw(`/api/jobs/${encodeURIComponent(id)}`)
    return { job: ((await r.json()) as { job: JobDetail }).job, retryAfter: retryAfter(r) }
  },
  cancelJob: (id: string) => call<{ ok: true }>(`/api/jobs/${encodeURIComponent(id)}`, { method: "DELETE" }),
  deleteStatement: (id: string) => call<{ ok: true }>(`/api/statements/${encodeURIComponent(id)}`, { method: "DELETE" }),
  /** SIP changes made with the broker or fund house, so the estimates match (M12). The dashboard rebuilds after. */
  skipSip: (sip: SipRef, due: string) => call<{ ok: true; skipped: string }>("/api/sips/skip", json({ ...sip, due })),
  undoSkipSip: (sip: SipRef) => call<{ ok: true; removed: number }>("/api/sips/skip", { ...json(sip), method: "DELETE" }),
  cancelSip: (sip: SipRef) => call<{ ok: true; cancelled_on: string }>("/api/sips/cancel", json({ ...sip, confirm: true })),
  /** FD, PPF and EPF entered by hand (M19). Nothing to rebuild: the values are computed in the browser. */
  assets: () => call<{ assets: ManualAsset[]; rates: RateTable }>("/api/assets"),
  addAsset: (body: AssetBody) => call<{ asset: ManualAsset }>("/api/assets", json(body)),
  updateAsset: (id: string, body: Partial<Pick<AssetBody, "inputs" | "member_id">>) =>
    call<{ asset: ManualAsset }>(`/api/assets/${encodeURIComponent(id)}`, { ...json(body), method: "PATCH" }),
  deleteAsset: (id: string) => call<{ ok: true }>(`/api/assets/${encodeURIComponent(id)}`, { method: "DELETE" }),
  /** Stock gains (M21): broker tradebooks and manual average buy prices. The dashboard rebuilds after each change. */
  tradebooks: () => call<{ tradebooks: Tradebook[]; costs: StockCost[] }>("/api/tradebooks"),
  addTradebook: (file: File, memberId: string) => {
    const fd = new FormData()
    fd.append("member_id", memberId)
    fd.append("file", file)
    return call<{ tradebook: Tradebook }>("/api/tradebooks", { method: "POST", body: fd })
  },
  deleteTradebook: (id: string) => call<{ ok: true }>(`/api/tradebooks/${encodeURIComponent(id)}`, { method: "DELETE" }),
  setStockCost: (body: StockCost) => call<{ cost: StockCost }>("/api/stocks/cost", { ...json(body), method: "PUT" }),
  deleteStockCost: (member_id: string, isin: string) => call<{ ok: true }>("/api/stocks/cost", { ...json({ member_id, isin }), method: "DELETE" }),
}
