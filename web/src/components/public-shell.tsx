// The header for pages you can see without signing in (/login, /privacy, /terms, /security, the consent screen).
import { Link } from "wouter"

import { LegalFooter } from "@/components/legal-footer"
import { ThemeToggle } from "@/components/theme-toggle"

export function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <span className="grid size-[30px] place-items-center rounded-[9px] bg-foreground text-sm font-bold text-background">₹</span>
      <span className="font-semibold tracking-tight">PocketFolio</span>
    </span>
  )
}

/** footer: false for a screen that fits the viewport (the consent screen links the policies itself). */
export function PublicShell({ children, home = true, footer = true }: { children: React.ReactNode; home?: boolean; footer?: boolean }) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="mx-auto flex h-[68px] w-full max-w-[1240px] items-center justify-between px-4 sm:px-7">
        {home ? (
          <Link href="/" aria-label="PocketFolio, go to your portfolio" className="flex min-h-11 items-center">
            <Wordmark />
          </Link>
        ) : (
          <Wordmark />
        )}
        <ThemeToggle />
      </header>
      <div className="flex-1">{children}</div>
      {footer && <LegalFooter />}
    </div>
  )
}
