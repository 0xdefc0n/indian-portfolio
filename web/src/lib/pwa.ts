// The installable app's hooks and actions (plan §13A): what "Install" does from a menu, when the sheet opens by
// itself, launch counters and reconnecting. The rules themselves are in install.ts; the UI is components/pwa.tsx.
import { useEffect, useRef, useSyncExternalStore } from "react"

import { api } from "@/lib/api"
import {
  type InstallAction, canInstall, installAction, installEligibility, markUploaded, openInstallSheet, promptInstall,
  launchedFrom, readVisits, recordVisit, snapshot, subscribe,
} from "@/lib/install"

export function useInstall() {
  const s = useSyncExternalStore(subscribe, snapshot)
  const action = installAction({ platform: s.platform, canPrompt: s.canPrompt, standalone: s.standalone, installed: s.record.installed })
  return { ...s, action, installable: canInstall(action) }
}

/**
 * "Install" from a menu, Settings or the login page. Chromium: the browser's own dialog straight away (this runs in
 * the click, which it needs). Everywhere else: our sheet with the steps, or a note on why it can't.
 */
export async function installFromMenu(action: InstallAction) {
  if (action !== "prompt") {
    openInstallSheet("manual")
    api.metric("install_prompt_shown")
    return
  }
  const outcome = await promptInstall()
  if (outcome === "accepted") api.metric("install_accepted")
  else if (outcome === "dismissed") api.metric("install_dismissed")
}

// ─── When to ask by itself ───────────────────────────────────────────────────────────────────────────────────────

const FINAL = new Set<string>(["installed", "dismissed_too_often", "dismissed_recently", "shown_this_session"])

/** A dialog (Radix sets data-state) or our own sheet is open. */
const dialogOpen = () => !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [data-install-sheet]')

/**
 * The dashboard calls this. `ready`: a real portfolio is on screen; `busy`: an upload or rebuild is running.
 * Records the day's visit, notices the first upload of the session, and opens the sheet when every rule in
 * installEligibility() holds (checked every few seconds, since "20 s after the upload" and "no dialog open" change
 * without a render).
 */
export function useAutoInstallPrompt({ ready, busy }: { ready: boolean; busy: boolean }) {
  const sawEmpty = useRef(false)
  const counted = useRef(false)
  const since = useRef<number | null>(null)
  const busyRef = useRef(busy)
  useEffect(() => {
    busyRef.current = busy
  }, [busy])

  useEffect(() => {
    if (!ready) {
      sawEmpty.current = true
      return
    }
    if (!counted.current) {
      counted.current = true
      recordVisit()
    }
    // The household was empty earlier in this session and now has a portfolio: the first upload just finished.
    if (sawEmpty.current) markUploaded()

    const check = () => {
      const s = snapshot()
      if (s.uploadedAt != null && since.current == null) since.current = Date.now()
      const action = installAction({ platform: s.platform, canPrompt: s.canPrompt, standalone: s.standalone, installed: s.record.installed })
      const verdict = installEligibility({
        now: Date.now(),
        signedIn: true,
        consented: true, // the dashboard only renders after consent
        hasPortfolio: true,
        visitDays: readVisits().days,
        uploadedAt: s.uploadedAt,
        dashboardMsSinceUpload: since.current == null ? 0 : Date.now() - since.current,
        standalone: s.standalone,
        launchedFromApp: s.launchedFromApp,
        action,
        record: s.record,
        busy: busyRef.current || dialogOpen() || document.visibilityState !== "visible",
        shownThisSession: s.shownThisSession,
      })
      if (verdict.show) {
        openInstallSheet("auto")
        api.metric("install_prompt_shown")
      }
      return verdict
    }
    // Reasons that can't change during this visit stop the checks. ("cannot_install" can: Chromium may hand over
    // its event later.)
    const final = (v: ReturnType<typeof check>) => v.show || FINAL.has(v.why)
    if (final(check())) return
    const t = setInterval(() => final(check()) && clearInterval(t), 3_000)
    return () => clearInterval(t)
  }, [ready])
}

// ─── Launch counters ─────────────────────────────────────────────────────────────────────────────────────────────

/** Counts launches from the installed app or a shortcut (once the session is known, so the counter is accepted). */
export function countLaunch() {
  const src = launchedFrom()
  if (src === "pwa") api.metric("launch_standalone")
  else if (src === "shortcut") api.metric("launch_shortcut")
}

// ─── Offline ─────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * While `when` (offline), retries `reload` when the network comes back. Browsers don't always send "online" (seen in
 * headless Chromium), so also on focus and every 15 s.
 */
export function useReloadWhenOnline(reload: () => void, when: boolean) {
  const latest = useRef(reload)
  useEffect(() => {
    latest.current = reload
  }, [reload])
  useEffect(() => {
    if (!when) return
    const retry = () => navigator.onLine && latest.current()
    window.addEventListener("online", retry)
    window.addEventListener("focus", retry)
    const t = setInterval(retry, 15_000)
    return () => {
      window.removeEventListener("online", retry)
      window.removeEventListener("focus", retry)
      clearInterval(t)
    }
  }, [when])
}
