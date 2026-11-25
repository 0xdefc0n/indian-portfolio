// /login and /login/verify (plan §13 item 1, §13A.5). Google is the primary button: it sends no email (§7.3).
import { ArrowLeftIcon, Loader2Icon, MailIcon } from "lucide-react"
import { type FormEvent, useEffect, useState } from "react"

import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api, auth, safeNext } from "@/lib/api"
import { useTurnstile } from "@/lib/turnstile"

/** Installed app (PWA). iOS keeps its cookies apart from Safari, so the emailed link would sign in the wrong place. */
const standalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true

const LINK_ERRORS: Record<string, string> = {
  google: "Google sign-in didn't finish. Try again.",
}
const DEFAULT_LINK_ERROR = "That sign-in link has expired or was already used. Send yourself a new one."

function Wordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-[30px] place-items-center rounded-[9px] bg-foreground text-sm font-bold text-background">₹</span>
      <span className="font-semibold tracking-tight">PocketFolio</span>
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="mx-auto flex h-[68px] w-full max-w-[1240px] items-center justify-between px-4 sm:px-7">
        <Wordmark />
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-10 pb-16 sm:pt-20">
        <section className="w-full max-w-[400px] rounded-[22px] bg-surface p-5 ring-1 ring-border sm:p-7">{children}</section>
      </main>
    </div>
  )
}

export function LoginPage() {
  const params = new URLSearchParams(window.location.search)
  const next = safeNext(params.get("next"))
  const errorParam = params.get("error")
  const [siteKey, setSiteKey] = useState<string | null>(null)
  const [email, setEmail] = useState("")
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [busy, setBusy] = useState<"google" | "email" | "code" | null>(null)
  const [error, setError] = useState<string | null>(errorParam ? (LINK_ERRORS[errorParam] ?? DEFAULT_LINK_ERROR) : null)
  const turnstile = useTurnstile(siteKey)

  useEffect(() => {
    api.config().then((c) => setSiteKey(c.turnstile_site_key), () => setError("Couldn't reach PocketFolio. Check your connection and reload."))
  }, [])

  async function google() {
    setBusy("google")
    setError(null)
    try {
      const { url } = await auth.google(next)
      window.location.assign(url)
    } catch (e) {
      setError((e as Error).message)
      setBusy(null)
    }
  }

  async function sendEmail(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy("email")
    setError(null)
    try {
      const token = await turnstile.getToken()
      await auth.emailLink(email.trim(), token)
      setSentTo(email.trim())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function verifyCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!sentTo) return
    const code = String(new FormData(e.currentTarget).get("code") ?? "").replace(/\D/g, "")
    setBusy("code")
    setError(null)
    try {
      await auth.verifyCode(sentTo, code)
      window.location.assign(next)
    } catch (err) {
      setError((err as Error).message)
      setBusy(null)
    }
  }

  const errorLine = error && (
    <p className="text-sm text-loss" role="alert">
      {error}
    </p>
  )

  if (sentTo) {
    const app = standalone()
    return (
      <Shell>
        <div className="mx-auto mb-5 grid size-12 place-items-center rounded-2xl bg-surface-2 ring-1 ring-border">
          <MailIcon className="size-5 text-primary" />
        </div>
        <h1 className="text-center text-xl font-semibold tracking-tight">{app ? "Enter the 6-digit code we emailed you" : "Check your inbox"}</h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          We sent an email to <span className="font-medium text-foreground">{sentTo}</span>.{" "}
          {app ? "Type the code from it here." : "Open the link in it, or type the 6-digit code here."} It expires in 10 minutes.
        </p>
        <form onSubmit={verifyCode} className="mt-6 grid gap-3">
          <Label htmlFor="code">6-digit code</Label>
          <Input
            id="code"
            name="code"
            required
            autoFocus={app}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,7}"
            maxLength={7}
            placeholder="123456"
            className="h-11 text-center font-mono text-lg tracking-[0.3em]"
          />
          {errorLine}
          <Button type="submit" size="lg" className="h-11" disabled={busy !== null}>
            {busy === "code" && <Loader2Icon className="animate-spin" />}
            Sign in
          </Button>
        </form>
        <button
          className="mx-auto mt-5 flex items-center gap-1.5 py-2 text-sm text-muted-foreground hover:text-foreground"
          onClick={() => {
            setSentTo(null)
            setError(null)
          }}
        >
          <ArrowLeftIcon className="size-3.5" /> Use another email, or send it again
        </button>
      </Shell>
    )
  }

  return (
    <Shell>
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1.5 text-muted-foreground">Your family's mutual funds, in one place.</p>

      <Button size="lg" className="mt-7 h-11 w-full" onClick={google} disabled={busy !== null}>
        {busy === "google" && <Loader2Icon className="animate-spin" />}
        Continue with Google
      </Button>

      <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={sendEmail} className="grid gap-3">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-11"
        />
        <div ref={turnstile.ref} />
        {errorLine}
        <Button type="submit" variant="secondary" size="lg" className="h-11" disabled={busy !== null || !siteKey}>
          {busy === "email" && <Loader2Icon className="animate-spin" />}
          Email me a link
        </Button>
        <p className="text-xs text-muted-foreground">We'll email you a sign-in link and a 6-digit code. No password needed.</p>
      </form>
    </Shell>
  )
}

/** /login/verify#token=… — the emailed link. The token sits in the fragment, so link scanners that prefetch URLs
 * can't use it up and it never reaches a server log; this page hands it to Better Auth. */
export function VerifyLinkPage() {
  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("token")
    history.replaceState(null, "", "/login/verify")
    if (!token) {
      window.location.replace("/login?error=link")
      return
    }
    const q = new URLSearchParams({ token, callbackURL: "/", errorCallbackURL: "/login?error=link" })
    window.location.replace(`/api/auth/magic-link/verify?${q}`)
  }, [])
  return (
    <Shell>
      <p className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" /> Signing you in…
      </p>
    </Shell>
  )
}
