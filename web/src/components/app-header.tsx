// The signed-in header: wordmark, optional section nav, theme toggle, page actions and the avatar menu.
import { Link } from "wouter"

import { AccountMenu } from "@/components/account-menu"
import { ThemeToggle } from "@/components/theme-toggle"
import type { Me } from "@/lib/api"

const mark = (
  <>
    <span className="grid size-[30px] place-items-center rounded-[9px] bg-foreground text-sm font-bold text-background">₹</span>
    <span className="hidden font-semibold tracking-tight sm:inline">PocketFolio</span>
  </>
)

/** onHome: the dashboard resets its tab instead of navigating; other pages link back to "/". */
export function AppHeader({ me, onHome, nav, actions }: { me: Me; onHome?: () => void; nav?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-20 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-[68px] max-w-[1240px] items-center justify-between gap-5 px-4 sm:px-7">
        <div className="flex min-w-0 items-center gap-6">
          {onHome ? (
            <button className="flex shrink-0 items-center gap-2.5" onClick={onHome}>{mark}</button>
          ) : (
            <Link href="/" aria-label="PocketFolio, go to your portfolio" className="flex shrink-0 items-center gap-2.5">{mark}</Link>
          )}
          {nav && <div className="hidden md:block">{nav}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle />
          {actions}
          <AccountMenu me={me} />
        </div>
      </div>
    </header>
  )
}

/** Layout for the signed-in pages other than the dashboard. */
export function PageShell({ me, children }: { me: Me; children: React.ReactNode }) {
  return (
    <div className="min-h-svh">
      <AppHeader me={me} />
      <main className="mx-auto max-w-[1240px] space-y-8 px-4 pt-3 pb-20 sm:px-7 sm:pt-4">{children}</main>
    </div>
  )
}
