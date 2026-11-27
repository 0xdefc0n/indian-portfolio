import { ArrowLeftRightIcon, LayoutGridIcon, LightbulbIcon, WalletIcon } from "lucide-react"
import { useEffect, useState } from "react"

import { Segmented } from "@/components/ui/segmented"
import { cn } from "@/lib/utils"

// Assets holds every kind of holding (mutual funds, ETFs, stocks, FD/PPF/EPF), with SIPs under the mutual funds:
// SIPs are a mutual-fund thing, not a top-level section of a multi-asset app.
export const TABS = [
  { id: "overview", label: "Overview", short: "Overview", Icon: LayoutGridIcon },
  { id: "assets", label: "Assets", short: "Assets", Icon: WalletIcon },
  { id: "transactions", label: "Transactions", short: "Activity", Icon: ArrowLeftRightIcon },
  { id: "insights", label: "Insights", short: "Insights", Icon: LightbulbIcon },
] as const
export type TabId = (typeof TABS)[number]["id"]

/** Old links (#holdings, #sips) open Assets; #sips also scrolls to the SIPs there (see App). */
const LEGACY: Record<string, TabId> = { holdings: "assets", sips: "assets" }

const fromHash = (): TabId => {
  const h = window.location.hash.slice(1)
  return (TABS.find((t) => t.id === h)?.id ?? LEGACY[h] ?? "overview") as TabId
}

/** Current tab, kept in the URL hash so refresh and back/forward work. */
export function useTab(): [TabId, (t: TabId) => void] {
  const [tab, setTab] = useState<TabId>(fromHash)
  useEffect(() => {
    const on = () => setTab(fromHash())
    window.addEventListener("hashchange", on)
    return () => window.removeEventListener("hashchange", on)
  }, [])
  const go = (t: TabId) => {
    if (t !== tab) {
      window.location.hash = t === "overview" ? "" : t
      if (t === "overview") history.replaceState(null, "", window.location.pathname)
      setTab(t)
    }
    window.scrollTo({ top: 0 })
  }
  return [tab, go]
}

export function TabNav({ tab, onChange, counts }: { tab: TabId; onChange: (t: TabId) => void; counts: Partial<Record<TabId, number>> }) {
  return (
    <Segmented
      kind="nav"
      label="Sections"
      value={tab}
      onChange={onChange}
      options={TABS.map((t) => ({
        id: t.id,
        label: (
          <>
            {t.label}
            {counts[t.id] != null && <span className="ml-1.5 hidden font-mono text-[11px] text-muted-foreground lg:inline">{counts[t.id]}</span>}
          </>
        ),
      }))}
    />
  )
}

/** Phone navigation: fixed bottom bar with icons, like most investing apps. */
export function BottomNav({ tab, onChange }: { tab: TabId; onChange: (t: TabId) => void }) {
  return (
    <nav
      aria-label="Sections"
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/90 pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] backdrop-blur md:hidden"
    >
      <div className="mx-auto grid max-w-md grid-cols-4">
        {TABS.map(({ id, short, Icon }) => {
          const on = id === tab
          return (
            <button
              key={id}
              onClick={() => onChange(id)}
              aria-current={on ? "page" : undefined}
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
                "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                on ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Icon className="size-5" strokeWidth={on ? 2.25 : 1.75} />
              {short}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
