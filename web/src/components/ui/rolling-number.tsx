import NumberFlow, { type Format } from "@number-flow/react"

import { cn } from "@/lib/utils"

const FAST = { duration: 220, easing: "ease-out" }

type Props = { value: number; signed?: boolean; fast?: boolean; className?: string }

/** ₹ amount whose digits roll to the new value (Indian grouping). */
export function Money({ value, signed, fast, className }: Props) {
  const format: Format = { style: "currency", currency: "INR", maximumFractionDigits: 0, signDisplay: signed ? "exceptZero" : "auto" }
  return (
    <NumberFlow
      value={Math.round(value)}
      locales="en-IN"
      format={format}
      className={cn("tabular-nums", className)}
      {...(fast ? { transformTiming: FAST, spinTiming: FAST } : {})}
    />
  )
}

/** Percentage (pass 12.3 for 12.3%) with rolling digits. */
export function Percent({ value, digits = 1, signed, fast, className }: Props & { digits?: number }) {
  const format: Format = {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay: signed ? "exceptZero" : "auto",
  }
  return (
    <NumberFlow
      value={value / 100}
      locales="en-IN"
      format={format}
      className={cn("tabular-nums", className)}
      {...(fast ? { transformTiming: FAST, spinTiming: FAST } : {})}
    />
  )
}

/** Plain count. */
export function Count({ value, className }: { value: number; className?: string }) {
  return <NumberFlow value={value} locales="en-IN" className={cn("tabular-nums", className)} />
}
