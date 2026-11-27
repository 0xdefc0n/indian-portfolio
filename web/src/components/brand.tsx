// The PocketFolio wordmark (M24, plan §13): "Pocket" plus "folio" on a gold glass block. The SVGs are outlined
// (scripts/brand.mjs), so they render the same before fonts load. One per theme; the other is hidden.
import { cn } from "@/lib/utils"

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex h-[26px] items-center", className)}>
      <img src="/brand/wordmark-light.svg" alt="PocketFolio" className="h-full w-auto dark:hidden" />
      <img src="/brand/wordmark-dark.svg" alt="PocketFolio" className="hidden h-full w-auto dark:block" />
    </span>
  )
}
