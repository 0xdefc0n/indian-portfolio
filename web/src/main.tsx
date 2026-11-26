import { ThemeProvider } from "next-themes"
import { StrictMode, Suspense, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { Route, Switch } from "wouter"

import { FailedJobNotices } from "@/components/jobs"
import { InstallSheet, OfflinePanel, ThemeColorSync, UpdatePrompt } from "@/components/pwa"
import { Toaster } from "@/components/ui/sonner"
import { Skeleton } from "@/components/ui/skeleton"
import { TooltipProvider } from "@/components/ui/tooltip"
import { api, isOffline, type Me, SignedOut } from "@/lib/api"
import { startInstallListeners } from "@/lib/install"
import { countLaunch, useReloadWhenOnline } from "@/lib/pwa"
import { LoginPage, VerifyLinkPage } from "@/pages/login"
import "./index.css"

import { App, ConsentPage, MembersPage, PrivacyPage, SecurityPage, SettingsPage, TermsPage } from "@/pages/lazy"

// Before the first render: Chromium can fire beforeinstallprompt right after load (plan §13A.3).
startInstallListeners(() => api.metric("app_installed"))

// /api/me is loaded once per page load and shared by every signed-in route.
let mePromise: Promise<Me> | null = null
const loadMe = () => {
  mePromise ??= api.me().catch((e) => {
    mePromise = null
    throw e
  })
  return mePromise
}

/**
 * Loads the session (/api/me); a 401 sends the user to /login via the global handler in lib/api.ts. Until the
 * current privacy notice is accepted, every signed-in page is the consent screen (plan §12, M14).
 */
function SignedIn({ page: Page }: { page: React.ComponentType<{ me: Me }> }) {
  const [me, setMe] = useState<Me | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const load = () => {
    loadMe().then((m) => {
      setOffline(false)
      setMe(m)
    }, (e: Error) => {
      if (e instanceof SignedOut) return
      if (isOffline(e)) setOffline(true)
      else setError(e.message)
    })
  }
  useEffect(load, [])
  useReloadWhenOnline(load, offline)
  useEffect(() => {
    if (me?.consent_ok) countLaunch()
  }, [me?.consent_ok])
  const accepted = () => {
    mePromise = null
    load()
  }
  if (offline) return <OfflinePanel />
  if (error)
    return (
      <p className="mx-auto mt-24 max-w-md rounded-xl bg-surface p-4 text-sm text-loss ring-1 ring-border" role="alert">
        Couldn't load your account: {error}. Reload to try again.
      </p>
    )
  if (!me) return <Skeleton className="mx-auto mt-24 h-40 max-w-md rounded-[22px]" />
  if (!me.consent_ok) return <ConsentPage me={me} onAccepted={accepted} />
  return (
    <>
      <Page me={me} />
      <FailedJobNotices />
    </>
  )
}

function NotFound() {
  return (
    <div className="mx-auto mt-24 max-w-md text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <a href="/" className="mt-4 inline-block py-2 text-primary underline-offset-4 hover:underline">Go to your portfolio</a>
    </div>
  )
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <TooltipProvider delayDuration={150}>
        <Suspense fallback={<Skeleton className="mx-auto mt-24 h-40 max-w-md rounded-[22px]" />}>
        <Switch>
          <Route path="/login/verify" component={VerifyLinkPage} />
          <Route path="/login" component={LoginPage} />
          <Route path="/privacy" component={PrivacyPage} />
          <Route path="/terms" component={TermsPage} />
          <Route path="/security" component={SecurityPage} />
          <Route path="/">{() => <SignedIn page={App} />}</Route>
          <Route path="/members">{() => <SignedIn page={MembersPage} />}</Route>
          <Route path="/settings">{() => <SignedIn page={SettingsPage} />}</Route>
          <Route component={NotFound} />
        </Switch>
        </Suspense>
        <InstallSheet />
        <UpdatePrompt />
        <ThemeColorSync />
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
)
