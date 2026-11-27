// The consent screen (plan §12 Rule 3, §13 item 3): shown after sign-in until the current notice is accepted.
// A short, plain-English notice: what we collect, why, the PDFs, how it's kept, your rights and how to withdraw, and
// who to contact. "I agree" with the 18+ box ticked writes the consent (POST /api/consent).
// The card fits the screen: the notice scrolls inside it, the checkbox and buttons stay in view.
import { Loader2Icon, LogOutIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Link } from "wouter"

import { PublicShell } from "@/components/public-shell"
import { Button } from "@/components/ui/button"
import { api, auth, type Me } from "@/lib/api"
import { INACTIVE_PERIOD, LEGAL, NOTICE_VERSION, PDF_HANDLING } from "@/lib/legal"

const link = "text-primary underline-offset-4 hover:underline"

function Item({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-1 text-muted-foreground">{children}</p>
    </div>
  )
}

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
    <PublicShell home={false} footer={false}>
      {/* the viewport minus the 68 px header */}
      <main className="mx-auto flex h-[calc(100svh-68px)] max-w-2xl flex-col px-4 pt-1 pb-4 sm:px-7 sm:pt-4 sm:pb-8">
        <section
          className="flex min-h-0 flex-1 flex-col glass rounded-[24px] p-4 sm:flex-initial sm:p-7"
          aria-labelledby="consent-title"
        >
          <span className="eyebrow">Before you start</span>
          <h1 id="consent-title" className="mt-2 text-xl font-semibold tracking-tight sm:mt-3 sm:text-2xl">How PocketFolio uses your data</h1>
          <p className="mt-1 text-sm text-muted-foreground sm:mt-2">Signed in as {me.user.email}.</p>

          <div
            className="mt-3 min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain border-y border-border py-4 pr-1 text-sm leading-relaxed"
            tabIndex={0}
            aria-label="Privacy notice"
          >
            <Item title="What we collect">
              Your email address, and from the statements you add: your family's names, PANs (kept encrypted, and only
              ever shown masked), holdings and transactions.
            </Item>
            <Item title="Why">
              Only to show you your family's portfolio and how it's doing. We never sell your data, show you ads or share
              it for marketing.
            </Item>
            <Item title="Your statement PDFs">{PDF_HANDLING}</Item>
            <Item title="Kept safe">
              Everything is protected with bank-grade AES-256 encryption, under a private key that belongs to your family
              alone.
            </Item>
            <Item title="Always in your control">
              Download everything, correct it or delete it whenever you like, in Settings. Deleting your account withdraws
              this consent and erases your data for good. If you stop using PocketFolio for {INACTIVE_PERIOD}, we'll email
              you before removing your account.
            </Item>
            <Item title="Questions">
              Write to {LEGAL.contactEmail}. We reply within {LEGAL.replyWithin}. You can also reach the Data Protection
              Board of India.
            </Item>
            <p className="text-muted-foreground">
              The full <Link href="/privacy" className={link}>Privacy policy</Link> and{" "}
              <Link href="/terms" className={link}>Terms of use</Link> have the details.
            </p>
          </div>

          <label className="mt-3 flex min-h-11 shrink-0 cursor-pointer items-start gap-3 rounded-xl bg-surface-2 p-3 text-sm ring-1 ring-border sm:mt-4">
            <input
              type="checkbox"
              checked={adult}
              onChange={(e) => setAdult(e.target.checked)}
              className="mt-0.5 size-5 shrink-0 accent-primary"
            />
            <span>I'm 18 or older, and I'll only add statements I'm entitled to: mine, or a family member's that I manage or they've agreed to.</span>
          </label>

          {error && <p className="mt-3 shrink-0 text-sm text-loss" role="alert">{error}</p>}

          <div className="mt-3 flex shrink-0 flex-col-reverse gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
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
