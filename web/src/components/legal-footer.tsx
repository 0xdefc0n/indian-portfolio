// The footer on every page (plan §12 Rule 9, §13 item 1): the analytics-only disclaimer, the legal pages and the
// grievance contact. Same tokens as the rest of the app (§13): muted text, no new colours.
import { Link } from "wouter"

import { LEGAL, NOT_ADVICE } from "@/lib/legal"
import { cn } from "@/lib/utils"

const linkClass = "inline-flex min-h-11 items-center px-1 underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"

export function LegalFooter({ className }: { className?: string }) {
  return (
    <footer className={cn("mx-auto w-full max-w-[1240px] px-4 pt-6 pb-8 text-xs text-muted-foreground sm:px-7", className)}>
      <div className="flex flex-col gap-1 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p>{NOT_ADVICE}</p>
        <nav aria-label="Legal" className="-mx-1 flex flex-wrap items-center gap-x-3">
          <Link href="/privacy" className={linkClass}>Privacy</Link>
          <Link href="/terms" className={linkClass}>Terms</Link>
          <Link href="/security" className={linkClass}>Security</Link>
          <a href={`mailto:${LEGAL.contactEmail}`} className={linkClass}>Contact</a>
        </nav>
      </div>
    </footer>
  )
}
