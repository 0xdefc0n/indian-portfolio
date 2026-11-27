import { useLayoutEffect, useRef, useState } from "react"

import { cn } from "@/lib/utils"

type Option<T> = { id: T; label: React.ReactNode }

/**
 * Pill control whose highlight slides to the selected option.
 * kind "nav" marks the current item with aria-current; kind "radio" behaves as a radiogroup.
 */
export function Segmented<T extends string>({ options, value, onChange, kind, label, className, size = "md" }: {
  options: Option<T>[]
  value: T
  onChange: (v: T) => void
  kind: "nav" | "radio"
  label: string
  className?: string
  size?: "sm" | "md"
}) {
  const box = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null)

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => {
      const on = el.querySelector<HTMLElement>("[data-on='true']")
      setPill(on ? { x: on.offsetLeft, w: on.offsetWidth } : null)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    document.fonts?.ready.then(measure)
    return () => ro.disconnect()
  }, [value, options.length])

  const Tag = kind === "nav" ? "nav" : "div"
  return (
    <Tag
      ref={box}
      aria-label={label}
      role={kind === "radio" ? "radiogroup" : undefined}
      className={cn("relative inline-flex max-w-full overflow-x-auto rounded-xl bg-surface p-1 ring-1 ring-border [scrollbar-width:none]", className)}
    >
      {pill && (
        <span
          aria-hidden
          className="absolute top-1 bottom-1 left-0 rounded-lg bg-surface-2 shadow-[0_2px_8px_-2px_var(--shadow)] ring-1 ring-border transition-[transform,width] duration-500 ease-[cubic-bezier(.3,.85,.2,1)]"
          style={{ width: pill.w, transform: `translateX(${pill.x}px)` }}
        />
      )}
      {options.map((o) => {
        const on = o.id === value
        return (
          <button
            key={o.id}
            type="button"
            data-on={on}
            role={kind === "radio" ? "radio" : undefined}
            aria-checked={kind === "radio" ? on : undefined}
            aria-current={kind === "nav" && on ? "page" : undefined}
            onClick={() => onChange(o.id)}
            className={cn(
              "relative z-10 shrink-0 whitespace-nowrap rounded-lg font-medium transition-colors duration-300",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              size === "sm" ? "px-3 py-1.5 text-[13px] pointer-coarse:min-h-11" : "px-3.5 py-1.5 text-[13.5px] pointer-coarse:min-h-11",
              on ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        )
      })}
    </Tag>
  )
}
