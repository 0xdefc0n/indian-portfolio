import { ArrowLeftRightIcon, LayoutGridIcon, LightbulbIcon, PieChartIcon, RepeatIcon } from "lucide-react"
import { useEffect, useState } from "react"

import { Segmented } from "@/components/ui/segmented"
import { cn } from "@/lib/utils"

export const TABS = [
  { id: "overview", label: "Overview", short: "Overview", Icon: LayoutGridIcon },
  { id: "holdings", label: "Holdings", short: "Holdings", Icon: PieChartIcon },
  { id: "sips", label: "SIPs", short: "SIPs", Icon: RepeatIcon },
  { id: "transactions", label: "Transactions", short: "Activity", Icon: ArrowLeftRightIcon },
  { id: "insights", label: "Insights", short: "Insights", Icon: LightbulbIcon },
] as const
export type TabId = (typeof TABS)[number]["id"]

const fromHash = (): TabId => {
  const h = window.location.hash.slice(1)
  return (TABS.find((t) => t.id === h)?.id ?? "overview") as TabId
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
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <div className="mx-auto grid max-w-md grid-cols-5">
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
