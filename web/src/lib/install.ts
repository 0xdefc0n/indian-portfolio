// Installable app (plan §13A, D14). The pure part (platform detection, when to ask) is unit-tested in install.test.ts;
// the browser part keeps the held `beforeinstallprompt` event, the small localStorage records and the sheet state.
// Nothing here is personal data: counts, timestamps and flags only.

// ─── Pure ────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * chromium: may fire `beforeinstallprompt` (Android Chrome, Edge, Samsung Internet; desktop Chrome and Edge).
 * ios / ipad: Safari's Share menu (no API). mac-safari: File → Add to Dock. webview: an in-app browser, which can't
 * install. other: e.g. Firefox desktop.
 */
export type Platform = "chromium" | "ios" | "ipad" | "mac-safari" | "webview" | "other"

/** Webviews of apps people open links in (WhatsApp, Instagram, Facebook, Gmail, LinkedIn, X, the Google app). */
const IN_APP = /\bFBAN|\bFBAV|Instagram|WhatsApp|LinkedInApp|Twitter|\bGSA\/|\bLine\/|Snapchat|; wv\)/

export function detectPlatform(ua: string, maxTouchPoints = 0): Platform {
  const ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1) // iPadOS asks for the desktop site
  const ios = ipad || /iPhone|iPod/.test(ua)
  if (IN_APP.test(ua)) return "webview"
  if (ios) {
    // Every iOS browser has a Share menu with Add to Home Screen (Chrome, Edge and Firefox too, since iOS 16.4).
    // An in-app WKWebView has no "Safari/" token.
    if (!/Safari\//.test(ua)) return "webview"
    return ipad ? "ipad" : "ios"
  }
  if (/Firefox\//.test(ua)) return "other"
  if (/Chrome\/|Chromium\/|Edg\/|SamsungBrowser\//.test(ua)) return "chromium"
  if (/Macintosh/.test(ua) && /Version\/\d+.*Safari\//.test(ua)) return "mac-safari"
  return "other"
}

/** Phone or tablet (the mobile copy and a bottom sheet) rather than a computer (the desktop copy and a card). */
export const isMobileUa = (ua: string, maxTouchPoints = 0) =>
  /Android|iPhone|iPad|iPod|Mobile/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)

/** What "Install" does here. `prompt`: the browser's own dialog; `ios`/`ipad`/`mac`: our instructions. */
export type InstallAction = "installed" | "prompt" | "ios" | "ipad" | "mac" | "webview" | "unsupported"

export function installAction(p: { platform: Platform; canPrompt: boolean; standalone: boolean; installed?: boolean }): InstallAction {
  if (p.standalone) return "installed"
  if (p.platform === "chromium") return p.canPrompt ? "prompt" : p.installed ? "installed" : "unsupported"
  if (p.platform === "ios" || p.platform === "ipad") return p.platform
  if (p.platform === "mac-safari") return "mac"
  if (p.platform === "webview") return "webview"
  return "unsupported"
}

/** Things we can do something with: the avatar menu shows "Install PocketFolio" only for these. */
export const canInstall = (a: InstallAction) => a === "prompt" || a === "ios" || a === "ipad" || a === "mac"

/** localStorage["pf.install"]. */
export type InstallRecord = { dismissals: number; lastDismissedAt: number | null; installed: boolean }
export const EMPTY_RECORD: InstallRecord = { dismissals: 0, lastDismissedAt: null, installed: false }

export const DAY_MS = 86_400_000
export const SNOOZE_MS = 14 * DAY_MS
export const MAX_DISMISSALS = 3
export const AFTER_UPLOAD_MS = 20_000

export type EligibilityInput = {
  now: number
  signedIn: boolean
  consented: boolean
  /** The dashboard has rendered a real portfolio (at least one statement). */
  hasPortfolio: boolean
  /** Distinct days with a signed-in visit, today included. */
  visitDays: number
  /** When this session's first successful upload finished, and how long the dashboard has been open since. */
  uploadedAt: number | null
  dashboardMsSinceUpload: number
  standalone: boolean
  /** Launched from the installed app's icon (`start_url` carries ?source=pwa). */
  launchedFromApp: boolean
  action: InstallAction
  record: InstallRecord
  /** A dialog is open or an upload is running. */
  busy: boolean
  shownThisSession: boolean
}

export type Ineligible =
  | "signed_out" | "no_consent" | "no_portfolio" | "no_value_yet" | "installed" | "cannot_install"
  | "dismissed_too_often" | "dismissed_recently" | "busy" | "shown_this_session"

/** Whether to show the install prompt by itself now (plan §13A.2). Every rule must pass; the first failure is named. */
export function installEligibility(s: EligibilityInput): { show: true } | { show: false; why: Ineligible } {
  const no = (why: Ineligible) => ({ show: false as const, why })
  // 1. signed in, consented, a real portfolio on screen
  if (!s.signedIn) return no("signed_out")
  if (!s.consented) return no("no_consent")
  if (!s.hasPortfolio) return no("no_portfolio")
  // 3. not already installed
  if (s.standalone || s.launchedFromApp || s.record.installed || s.action === "installed") return no("installed")
  // 4. the platform can install
  if (!canInstall(s.action)) return no("cannot_install")
  // 5. at most 3 dismissals, and none in the last 14 days
  if (s.record.dismissals >= MAX_DISMISSALS) return no("dismissed_too_often")
  if (s.record.lastDismissedAt != null && s.now - s.record.lastDismissedAt < SNOOZE_MS) return no("dismissed_recently")
  // 6. nothing else going on, once per session
  if (s.shownThisSession) return no("shown_this_session")
  if (s.busy) return no("busy")
  // 2. a moment of value: a later day, or 20 s on the dashboard after the first upload
  const laterDay = s.visitDays >= 2
  const afterUpload = s.uploadedAt != null && s.dashboardMsSinceUpload >= AFTER_UPLOAD_MS
  if (!laterDay && !afterUpload) return no("no_value_yet")
  return { show: true }
}

/** A dismissal (Not now, close, Escape, or "Got it" on the instructions) of a prompt that showed by itself. */
export const dismissed = (r: InstallRecord, now: number): InstallRecord => ({ ...r, dismissals: r.dismissals + 1, lastDismissedAt: now })

/** localStorage["pf.visits"]: distinct days with a signed-in visit. Only the count and the last day are kept. */
export type VisitRecord = { days: number; last: string | null }

export function countVisit(r: VisitRecord, today: string): VisitRecord {
  return r.last === today ? r : { days: r.days + 1, last: today }
}

/** Launch source from the URL: the installed app's start_url, or one of its shortcuts. */
export function launchSource(search: string): "pwa" | "shortcut" | null {
  const s = new URLSearchParams(search).get("source")
  return s === "pwa" || s === "shortcut" ? s : null
}

// ─── Browser ─────────────────────────────────────────────────────────────────────────────────────────────────────

type BeforeInstallPromptEvent = Event & {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

const INSTALL_KEY = "pf.install"
const VISITS_KEY = "pf.visits"

function readJson<T extends object>(key: string, fallback: T): T {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key) ?? "null")
    return v && typeof v === "object" ? { ...fallback, ...(v as Partial<T>) } : fallback
  } catch {
    return fallback
  }
}
function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // private mode or storage full: the prompt just behaves as if this were a first visit
  }
}

export const readRecord = (): InstallRecord => readJson(INSTALL_KEY, EMPTY_RECORD)
export const writeRecord = (r: InstallRecord) => writeJson(INSTALL_KEY, r)
export const readVisits = (): VisitRecord => readJson<VisitRecord>(VISITS_KEY, { days: 0, last: null })

/** Today as the user's local calendar day. */
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

/** Called when the signed-in dashboard shows a portfolio. Returns the updated count. */
export function recordVisit(): VisitRecord {
  const next = countVisit(readVisits(), localDay())
  writeJson(VISITS_KEY, next)
  return next
}

/** Someone has used PocketFolio signed in on this browser before: the login page offers "Get the app". */
export const returningUser = () => readVisits().days > 0

export function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as { standalone?: boolean }).standalone === true
  )
}

// One small store shared by the sheet, the menus and the eligibility check (useSyncExternalStore).
type Snapshot = {
  platform: Platform
  mobile: boolean
  canPrompt: boolean
  standalone: boolean
  launchedFromApp: boolean
  record: InstallRecord
  /** The sheet: null = closed; auto = opened by itself (dismissals count), manual = from a menu or link. */
  sheet: null | "auto" | "manual"
  shownThisSession: boolean
  uploadedAt: number | null
  /** Set when `appinstalled` fires: the toast shows once. */
  justInstalled: boolean
}

let deferred: BeforeInstallPromptEvent | null = null
let state: Snapshot | null = null
const listeners = new Set<() => void>()

function set(patch: Partial<Snapshot>) {
  state = { ...snapshot(), ...patch }
  for (const l of listeners) l()
}

export function snapshot(): Snapshot {
  state ??= {
    platform: detectPlatform(navigator.userAgent, navigator.maxTouchPoints),
    mobile: isMobileUa(navigator.userAgent, navigator.maxTouchPoints),
    canPrompt: false,
    standalone: isStandalone(),
    launchedFromApp: launch === "pwa",
    record: readRecord(),
    sheet: null,
    shownThisSession: false,
    uploadedAt: null,
    justInstalled: false,
  }
  return state
}

export function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

let started = false
let launch: ReturnType<typeof launchSource> = null
/** How this page load was opened (read before the dashboard tidies the URL). */
export const launchedFrom = () => launch

/** Call once, before React renders: Chromium can fire `beforeinstallprompt` right after load. */
export function startInstallListeners(onInstalled: () => void) {
  if (started) return
  started = true
  launch = launchSource(window.location.search)
  snapshot()
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault() // keep it for our own sheet (plan §13A.3)
    deferred = e as BeforeInstallPromptEvent
    // Chromium only offers this while the app isn't installed, so an earlier install was removed since.
    let record = readRecord()
    if (record.installed) writeRecord((record = { ...record, installed: false }))
    set({ canPrompt: true, record })
  })
  window.addEventListener("appinstalled", () => {
    deferred = null
    const record = { ...readRecord(), installed: true }
    writeRecord(record)
    set({ canPrompt: false, record, sheet: null, justInstalled: true })
    onInstalled()
  })
  window.matchMedia?.("(display-mode: standalone)").addEventListener?.("change", () => set({ standalone: isStandalone() }))
}

export const openInstallSheet = (how: "auto" | "manual") => set({ sheet: how, shownThisSession: true })

/** Closing without installing. Only a sheet that opened by itself counts as a dismissal. */
export function closeInstallSheet() {
  const s = snapshot()
  if (s.sheet === "auto") {
    const record = dismissed(readRecord(), Date.now())
    writeRecord(record)
    set({ sheet: null, record })
  } else set({ sheet: null })
}

/**
 * The browser's own install dialog. Must be called inside the click handler (it needs user activation). The event
 * is single use, so it's dropped afterwards whatever the answer.
 */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const e = deferred
  if (!e) return "unavailable"
  deferred = null
  set({ canPrompt: false })
  await e.prompt()
  const { outcome } = await e.userChoice
  return outcome
}

export const markUploaded = () => {
  if (snapshot().uploadedAt == null) set({ uploadedAt: Date.now() })
}

export const clearJustInstalled = () => set({ justInstalled: false })
