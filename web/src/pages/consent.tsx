// The consent screen (plan §12 Rule 3, §13 item 3): shown after sign-in until the current notice is accepted.
// A standalone, plain-English notice: what we collect, why, the PDFs, where it's stored, your rights and how to
// withdraw, and the grievance contact. "I agree" with the 18+ box ticked writes the consent (POST /api/consent).
import { Loader2Icon, LogOutIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Link } from "wouter"

import { PublicShell } from "@/components/public-shell"
import { Button } from "@/components/ui/button"
import { api, auth, type Me } from "@/lib/api"
import { INACTIVE_PERIOD, LEGAL, NOT_ADVICE, NOTICE_VERSION, PDF_HANDLING } from "@/lib/legal"

const link = "text-primary underline-offset-4 hover:underline"

export function ConsentPage({ me, onAccepted }: { me: Me; onAccepted: () => void }) {
  const [adult, setAdult] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function agree() {
    setBusy(true)
    setError(null)
    try {
      await api.consent(me.notice_version ?? NOTICE_VERSION)
      onAccepted()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  async function signOut() {
    try {
      await auth.signOut()
      window.location.assign("/login")
    } catch {
      toast.error("Couldn't sign out. Try again.")
    }
  }

  return (
    <PublicShell home={false}>
      <main className="mx-auto max-w-2xl px-4 pt-3 pb-12 sm:px-7 sm:pt-6">
        <section className="rounded-[22px] bg-surface p-5 ring-1 ring-border sm:p-7" aria-labelledby="consent-title">
          <span className="eyebrow">Before you start</span>
          <h1 id="consent-title" className="mt-3 text-2xl font-semibold tracking-tight">How PocketFolio uses your data</h1>
          <p className="mt-2 text-sm text-muted-foreground">Signed in as {me.user.email}.</p>

          <div className="mt-6 space-y-4 text-sm leading-relaxed">
            <div>
              <h2 className="font-semibold">What we collect</h2>
              <p className="mt-1 text-muted-foreground">
                Your email (and name, if you use Google). From the statements you add: each family member's name, PAN,
                folios, holdings and transactions. The devices you sign in from.
              </p>
            </div>
            <div>
              <h2 className="font-semibold">Why</h2>
              <p className="mt-1 text-muted-foreground">
                Only to show you your family's portfolio and its analytics. We don't sell it or use it for anything else.{" "}
                {NOT_ADVICE}
              </p>
            </div>
            <div>
              <h2 className="font-semibold">Your statement PDFs</h2>
              <p className="mt-1 text-muted-foreground">{PDF_HANDLING}</p>
            </div>
            <div>
              <h2 className="font-semibold">Where</h2>
              <p className="mt-1 text-muted-foreground">
                Encrypted, on Cloudflare's servers, which may be outside India. Unused accounts are deleted after{" "}
                {INACTIVE_PERIOD}, with an email 2 days before.
              </p>
            </div>
            <div>
              <h2 className="font-semibold">Your rights</h2>
              <p className="mt-1 text-muted-foreground">
                Download all your data, correct it, or delete it at any time in Settings. To withdraw this consent, delete
                your account: everything is erased at once. Questions or complaints: {LEGAL.grievanceOfficer},{" "}
                {LEGAL.grievanceEmail}. You can also complain to the Data Protection Board of India.
              </p>
            </div>
            <p className="text-muted-foreground">
              The full <Link href="/privacy" className={link}>Privacy policy</Link> and{" "}
              <Link href="/terms" className={link}>Terms of use</Link> have the details.
            </p>
          </div>

          <label className="mt-6 flex min-h-11 cursor-pointer items-start gap-3 rounded-xl bg-surface-2 p-3 text-sm ring-1 ring-border">
            <input
              type="checkbox"
              checked={adult}
              onChange={(e) => setAdult(e.target.checked)}
              className="mt-0.5 size-5 shrink-0 accent-primary"
            />
            <span>I'm 18 or older, and I'll only add statements I'm entitled to: mine, or a family member's that I manage or they've agreed to.</span>
          </label>

          {error && <p className="mt-4 text-sm text-loss" role="alert">{error}</p>}

          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="ghost" className="h-11" onClick={signOut}><LogOutIcon /> Not now, sign out</Button>
            <Button size="lg" className="h-11" disabled={!adult || busy} onClick={agree}>
              {busy && <Loader2Icon className="animate-spin" />}
              I agree
            </Button>
          </div>
        </section>
      </main>
    </PublicShell>
  )
}
