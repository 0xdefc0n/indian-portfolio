// /settings (plan §13 item 7). Devices arrive with QR login (M13). Download my data and Delete account are the
// DPDP access and erasure rights (plan §12, M14).
import { ChevronRightIcon, DownloadIcon, Loader2Icon, LogOutIcon, Trash2Icon } from "lucide-react"
import { useTheme } from "next-themes"
import { type FormEvent, useState } from "react"
import { toast } from "sonner"
import { Link } from "wouter"

import { PageShell } from "@/components/app-header"
import { PageTitle, Panel } from "@/components/panel"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Segmented } from "@/components/ui/segmented"
import { api, ApiFailure, auth, type Me, SignedOut } from "@/lib/api"

const CONFIRM_WORD = "DELETE"

/** Typed confirmation (plan §13 item 7). The server also wants a sign-in from the last 10 minutes. */
function DeleteAccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [typed, setTyped] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reauth, setReauth] = useState(false)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (typed.trim() !== CONFIRM_WORD) return
    setBusy(true)
    setError(null)
    try {
      await api.deleteAccount()
      window.location.assign("/login?deleted=1")
    } catch (err) {
      if (err instanceof SignedOut) return
      if (err instanceof ApiFailure && err.code === "reauth_required") setReauth(true)
      setError((err as Error).message)
      setBusy(false)
    }
  }

  async function signInAgain() {
    setBusy(true)
    try {
      await auth.signOut()
    } finally {
      window.location.assign(`/login?next=${encodeURIComponent("/settings?delete=1")}`)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete your account?</DialogTitle>
          <DialogDescription>
            This deletes every family member, statement and SIP change, and your dashboard, straight away. It can't be
            undone. Download your data first if you want a copy.
          </DialogDescription>
        </DialogHeader>
        {reauth ? (
          <div className="grid gap-4">
            <p className="text-sm">For your safety, deleting needs a sign-in from the last 10 minutes. Sign in again, then come back here.</p>
            <DialogFooter>
              <Button type="button" variant="outline" className="h-11" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="button" className="h-11" disabled={busy} onClick={signInAgain}>
                {busy && <Loader2Icon className="animate-spin" />}
                Sign in again
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="confirm-delete">Type {CONFIRM_WORD} to confirm</Label>
              <Input
                id="confirm-delete"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                className="h-11"
              />
            </div>
            {error && <p className="text-sm text-loss" role="alert">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" className="h-11" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" variant="destructive" className="h-11" disabled={busy || typed.trim() !== CONFIRM_WORD}>
                {busy && <Loader2Icon className="animate-spin" />}
                Delete account
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 py-2.5 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-sm font-medium">{children}</dd>
    </div>
  )
}

type ThemeChoice = "dark" | "light" | "system"

export function SettingsPage({ me }: { me: Me }) {
  const { theme, setTheme } = useTheme()
  // ?delete=1: back from the re-sign-in the delete dialog asked for
  const [deleting, setDeleting] = useState(() => new URLSearchParams(window.location.search).get("delete") === "1")
  const [exporting, setExporting] = useState(false)

  async function downloadData() {
    setExporting(true)
    try {
      await api.downloadMyData()
      toast.success("Your data is downloading.")
    } catch (e) {
      if (!(e instanceof SignedOut)) toast.error((e as Error).message)
    } finally {
      setExporting(false)
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
    <PageShell me={me}>
      <PageTitle title="Settings" />
      <div className="grid max-w-3xl gap-4">
        <Panel title="Account">
          <dl className="divide-y divide-border">
            {me.user.name && <Row label="Name">{me.user.name}</Row>}
            <Row label="Email">{me.user.email}</Row>
          </dl>
          <Button variant="outline" className="mt-4 h-11" onClick={signOut}><LogOutIcon /> Sign out</Button>
        </Panel>

        <Panel title="Family members">
          <Link
            href="/members"
            className="-mx-2 flex min-h-11 items-center justify-between gap-3 rounded-lg px-2 text-sm transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span>
              <span className="font-medium">Manage members</span>
              <span className="block text-muted-foreground">Rename people or remove them and their statements.</span>
            </span>
            <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        </Panel>

        <Panel title="Your data">
          <p className="text-sm text-muted-foreground">
            A file with everything PocketFolio holds about you and your family, decrypted: members, PANs, every statement's
            data and your SIP changes. Keep it somewhere safe.
          </p>
          <Button variant="outline" className="mt-4 h-11" onClick={downloadData} disabled={exporting}>
            {exporting ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}
            Download my data
          </Button>
          <p className="mt-3 text-sm text-muted-foreground">
            How we use it: <Link href="/privacy" className="text-primary underline-offset-4 hover:underline">Privacy policy</Link>.
          </p>
        </Panel>

        <Panel title="Delete account">
          <p className="text-sm text-muted-foreground">
            Erases your account and everything in it at once, for good, and withdraws your consent.
          </p>
          <Button variant="destructive" className="mt-4 h-11" onClick={() => setDeleting(true)}>
            <Trash2Icon /> Delete account
          </Button>
          <DeleteAccountDialog open={deleting} onOpenChange={setDeleting} />
        </Panel>

        <Panel title="Appearance">
          <Segmented<ThemeChoice>
            kind="radio"
            label="Theme"
            value={(theme as ThemeChoice | undefined) ?? "dark"}
            onChange={setTheme}
            options={[{ id: "dark", label: "Dark" }, { id: "light", label: "Light" }, { id: "system", label: "System" }]}
          />
        </Panel>
      </div>
    </PageShell>
  )
}
