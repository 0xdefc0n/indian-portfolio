import { ThemeProvider } from "next-themes"
import { StrictMode, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { Route, Switch } from "wouter"

import App from "./App.tsx"
import { Toaster } from "@/components/ui/sonner"
import { Skeleton } from "@/components/ui/skeleton"
import { TooltipProvider } from "@/components/ui/tooltip"
import { api, type Me, SignedOut } from "@/lib/api"
import { LoginPage, VerifyLinkPage } from "@/pages/login"
import { MembersPage } from "@/pages/members"
import { SettingsPage } from "@/pages/settings"
import "./index.css"

// /api/me is loaded once per page load and shared by every signed-in route.
let mePromise: Promise<Me> | null = null
const loadMe = () => {
  mePromise ??= api.me().catch((e) => {
    mePromise = null
    throw e
  })
  return mePromise
}

/** Loads the session (/api/me); a 401 sends the user to /login via the global handler in lib/api.ts. */
function SignedIn({ page: Page }: { page: React.ComponentType<{ me: Me }> }) {
  const [me, setMe] = useState<Me | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    loadMe().then(setMe, (e: Error) => !(e instanceof SignedOut) && setError(e.message))
  }, [])
  if (error)
    return (
      <p className="mx-auto mt-24 max-w-md rounded-xl bg-surface p-4 text-sm text-loss ring-1 ring-border" role="alert">
        Couldn't load your account: {error}. Reload to try again.
      </p>
    )
  if (!me) return <Skeleton className="mx-auto mt-24 h-40 max-w-md rounded-[22px]" />
  return <Page me={me} />
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
        <Switch>
          <Route path="/login/verify" component={VerifyLinkPage} />
          <Route path="/login" component={LoginPage} />
          <Route path="/">{() => <SignedIn page={App} />}</Route>
          <Route path="/members">{() => <SignedIn page={MembersPage} />}</Route>
          <Route path="/settings">{() => <SignedIn page={SettingsPage} />}</Route>
          <Route component={NotFound} />
        </Switch>
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
)
