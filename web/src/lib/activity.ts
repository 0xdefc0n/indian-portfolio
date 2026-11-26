import type { Activity } from "@/lib/api"
import { day, units } from "@/lib/format"
import { movedNote } from "@/lib/sips"

const short = (iso: string) => day(iso).split(" ").slice(0, 2).join(" ")

/** Money in: positive units, or an estimated SIP instalment whose units aren't known yet (its NAV isn't out). */
export const isBuy = (a: Activity) => a.units > 0 || (!!a.estimated && a.kind === "sip")

/** "12.345 units", or for an instalment still waiting for its NAV "units after tonight's NAV". */
export const unitsText = (a: Activity) => (a.estimated && !a.units ? "units after its NAV is out" : `${units(Math.abs(a.units))} units`)

/** "Estimated · in progress, units by 27 Nov · moved from 24 Nov (market holiday)" for estimated SIP instalments. */
export function estimateNote(a: Activity): string | null {
  if (!a.estimated) return null
  const parts = ["Estimated"]
  if (a.status === "in_progress" && a.units_by) parts.push(`in progress, units by ${short(a.units_by)}`)
  const moved = a.due ? movedNote(a.moved ?? null, a.due, short) : null
  if (moved) parts.push(moved.charAt(0).toLowerCase() + moved.slice(1))
  return parts.join(" · ")
}
