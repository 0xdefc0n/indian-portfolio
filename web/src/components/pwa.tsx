// The installable app's UI (plan §13A): the install sheet, the "new version" toast, the offline panel and the
// theme-colour meta. Hooks and actions are in lib/pwa.ts; the rules for when to ask are in lib/install.ts.
import { ArrowDownIcon, ArrowUpIcon, ShareIcon, ShieldCheckIcon, TrendingUpIcon, WifiOffIcon, XIcon, ZapIcon } from "lucide-react"
import { useTheme } from "next-themes"
import { useEffect, useId, useRef } from "react"
import { toast } from "sonner"
import { useRegisterSW } from "virtual:pwa-register/react"

import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { clearJustInstalled, closeInstallSheet, promptInstall, snapshot } from "@/lib/install"
import { useInstall } from "@/lib/pwa"
import { cn } from "@/lib/utils"

// ─── The sheet ───────────────────────────────────────────────────────────────────────────────────────────────────

function Icon() {
  return <img src="/icons/icon-192.png" alt="" width={44} height={44} className="size-11 shrink-0 rounded-xl ring-1 ring-border" />
}

const BENEFITS = [
  { Icon: ZapIcon, text: "Opens instantly, full screen, just like an app" },
  { Icon: TrendingUpIcon, text: "Today's change for the whole family at a glance" },
  { Icon: ShieldCheckIcon, text: "Same secure sign-in. No app store, nothing extra to download" },
]

function Kbd({ children }: { children: React.ReactNode }) {
  return <span className="font-semibold text-foreground">{children}</span>
}

function dismiss() {
  if (snapshot().sheet === "auto") api.metric("install_dismissed")
  closeInstallSheet()
}

/** "Add to home screen" / "Install" in the sheet: the browser's own dialog. */
async function install() {
  const outcome = await promptInstall()
  if (outcome === "accepted") {
    api.metric("install_accepted")
    closeInstallSheet()
  } else dismiss()
}

/** The sheet (mobile: bottom sheet; desktop: a card bottom-right). Non-blocking: no overlay, the page stays usable. */
export function InstallSheet() {
  const s = useInstall()
  const titleId = useId()
  const ref = useRef<HTMLDivElement>(null)
  const open = s.sheet !== null

  useEffect(() => {
    if (!open) return
    // A sheet opened from a menu takes focus; one that opened by itself doesn't interrupt typing or reading.
    if (snapshot().sheet === "manual") ref.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && dismiss()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  // After install (from our sheet or the browser's own menu)
  useEffect(() => {
    if (!s.justInstalled) return
    clearJustInstalled()
    toast.success("PocketFolio is on your home screen.", { description: "Open it any time for today's numbers." })
  }, [s.justInstalled])

  if (!open) return null

  const a = s.action
  const head = (title: string, body: React.ReactNode) => (
    <div className="flex items-start gap-3.5 pr-8">
      <Icon />
      <div className="min-w-0">
        <h2 id={titleId} className="text-[15px] font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      </div>
    </div>
  )
  const later = (label = "Not now") => (
    <Button variant="ghost" className="h-11" onClick={dismiss}>{label}</Button>
  )

  let content: React.ReactNode
  if (a === "prompt" && s.mobile) {
    content = (
      <>
        {head("Your portfolio, one tap away", "Add PocketFolio to your home screen and check today's gain or loss in a single tap. No searching, no typing the address.")}
        <ul className="mt-4 grid gap-2.5 text-sm">
          {BENEFITS.map(({ Icon: I, text }) => (
            <li key={text} className="flex items-start gap-2.5"><I className="mt-0.5 size-4 shrink-0 text-primary" />{text}</li>
          ))}
        </ul>
        <div className="mt-5 grid gap-2 sm:flex sm:flex-row-reverse">
          <Button className="h-11" onClick={install}>Add to home screen</Button>
          {later()}
        </div>
      </>
    )
  } else if (a === "prompt") {
    content = (
      <>
        {head("Install PocketFolio on this computer", "Open it from your Dock, taskbar or Start menu and see your portfolio in one click.")}
        <div className="mt-5 flex flex-row-reverse gap-2">
          <Button className="h-11" onClick={install}>Install</Button>
          {later()}
        </div>
      </>
    )
  } else if (a === "ios" || a === "ipad") {
    // ✅ iOS 26 (checked 2026-11-27): Safari's compact tab bar hides Share behind ⋯; the Bottom and Top layouts show
    // it directly. Add to Home Screen opens as a web app by default ("Open as Web App" on).
    const Arrow = a === "ipad" ? ArrowUpIcon : ArrowDownIcon
    content = (
      <>
        {head(`Add PocketFolio to your Home Screen`, "Check your portfolio in one tap, right from your Home Screen.")}
        <ol className="mt-4 grid gap-2.5 text-sm">
          <li className="flex items-start gap-2.5">
            <span className="w-4 shrink-0 font-mono text-muted-foreground">1</span>
            <span>
              Tap <Kbd>Share</Kbd> <ShareIcon className="inline size-4 align-text-bottom text-primary" aria-hidden /> in
              Safari's toolbar {a === "ipad" ? "at the top" : "at the bottom"}. If you don't see it, tap <Kbd>⋯</Kbd> first.
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="w-4 shrink-0 font-mono text-muted-foreground">2</span>
            <span>Scroll down and tap <Kbd>Add to Home Screen</Kbd>.</span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="w-4 shrink-0 font-mono text-muted-foreground">3</span>
            <span>Tap <Kbd>Add</Kbd>.</span>
          </li>
        </ol>
        <p className="mt-4 text-sm text-muted-foreground">You'll sign in once inside the app.</p>
        <div className="mt-5 flex items-center justify-between gap-3">
          <Arrow className="size-5 animate-bounce text-primary motion-reduce:animate-none" aria-hidden />
          <Button className="h-11" onClick={dismiss}>Got it</Button>
        </div>
      </>
    )
  } else if (a === "mac") {
    content = (
      <>
        {head("Install PocketFolio on this Mac", "Open it from your Dock and see your portfolio in one click.")}
        <p className="mt-4 text-sm">
          In Safari's menu bar, choose <Kbd>File</Kbd> → <Kbd>Add to Dock</Kbd>. Or click <Kbd>Share</Kbd>{" "}
          <ShareIcon className="inline size-4 align-text-bottom text-primary" aria-hidden /> → <Kbd>Add to Dock</Kbd>.
        </p>
        <div className="mt-5 flex justify-end"><Button className="h-11" onClick={dismiss}>Got it</Button></div>
      </>
    )
  } else if (a === "installed") {
    content = (
      <>
        {head("PocketFolio is installed", "Open it from your home screen, Dock or Start menu.")}
        <div className="mt-5 flex justify-end">{later("Close")}</div>
      </>
    )
  } else {
    const webview = a === "webview"
    content = (
      <>
        {head(
          "Get the PocketFolio app",
          webview
            ? "Open in Chrome or Safari to add PocketFolio to your home screen."
            : s.platform === "chromium"
              ? "Use your browser's menu: Install PocketFolio, or Add to home screen. If it isn't there, PocketFolio may already be installed."
              : "This browser can't install apps. Open PocketFolio in Chrome, Edge or Safari to install it.",
        )}
        <div className="mt-5 flex justify-end">{later("Close")}</div>
      </>
    )
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-install-sheet=""
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 rounded-t-[22px] bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-lg ring-1 ring-border outline-none",
        "sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[400px] sm:rounded-[22px] sm:p-6",
        "animate-in fade-in-0 slide-in-from-bottom-4 duration-200 motion-reduce:animate-none",
      )}
    >
      <Button variant="ghost" size="icon" className="absolute top-3 right-3" onClick={dismiss} aria-label="Close">
        <XIcon />
      </Button>
      {content}
    </div>
  )
}

// ─── Service worker updates ──────────────────────────────────────────────────────────────────────────────────────

/** Registers the service worker; when a new one is waiting, offers to reload (plan §13A.1). */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      // Look for a new version every hour while the app stays open (an installed app can run for days).
      if (reg) setInterval(() => reg.update().catch(() => undefined), 60 * 60_000)
    },
  })
  useEffect(() => {
    if (!needRefresh) return
    toast("A new version of PocketFolio is ready", {
      id: "sw-update",
      duration: Infinity,
      action: { label: "Reload", onClick: () => updateServiceWorker(true) },
    })
  }, [needRefresh, updateServiceWorker])
  return null
}

// ─── Offline ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Shown instead of the dashboard when there's no network. No portfolio data is kept offline, by design (DPDP). */
export function OfflinePanel({ className }: { className?: string }) {
  return (
    <div className={cn("mx-auto mt-24 max-w-md text-center", className)} role="status">
      <div className="mx-auto mb-6 grid size-14 place-items-center rounded-2xl bg-surface ring-1 ring-border">
        <WifiOffIcon className="size-6 text-muted-foreground" />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">You're offline</h1>
      <p className="mt-3 text-muted-foreground">Connect to see today's numbers.</p>
    </div>
  )
}

// ─── Theme colour ────────────────────────────────────────────────────────────────────────────────────────────────

/** --background of each theme in src/index.css (the class lands on <html> after this effect, so it can't be read). */
const THEME_COLOUR = { light: "#F2F3F7", dark: "#0A0C14" } as const

/** The status bar and title bar follow the chosen theme (index.html starts them on the system theme). */
export function ThemeColorSync() {
  const { resolvedTheme } = useTheme()
  useEffect(() => {
    if (resolvedTheme !== "light" && resolvedTheme !== "dark") return
    for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) m.content = THEME_COLOUR[resolvedTheme]
  }, [resolvedTheme])
  return null
}
