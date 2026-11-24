import { useSyncExternalStore } from "react"

/** The month the pointer is on in the value chart, and the first month of the visible range. */
export type Scrub = { month: string; value: number; base: { month: string; value: number } } | null

// A tiny store so scrubbing the chart re-renders only the hero figures, not the whole page.
let current: Scrub = null
const listeners = new Set<() => void>()

export function setScrub(next: Scrub) {
  if (next?.month === current?.month && next?.base.month === current?.base.month) return
  current = next
  listeners.forEach((l) => l())
}

export function useScrub(): Scrub {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l) },
    () => current,
  )
}
