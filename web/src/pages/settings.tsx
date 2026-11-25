// /settings (plan §13 item 7), the shell. Devices arrive with QR login (M13), fair-use usage with uploads (M7),
// and Download my data / Delete account with privacy (M14).
import { ChevronRightIcon, LogOutIcon } from "lucide-react"
import { useTheme } from "next-themes"
import { toast } from "sonner"
import { Link } from "wouter"

import { PageShell } from "@/components/app-header"
import { PageTitle, Panel } from "@/components/panel"
import { Button } from "@/components/ui/button"
import { Segmented } from "@/components/ui/segmented"
import { auth, type Me } from "@/lib/api"

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
