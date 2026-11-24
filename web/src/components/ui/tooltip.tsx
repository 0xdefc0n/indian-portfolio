"use client"

import * as React from "react"
import { cn } from "cn"
import { Tooltip as TooltipPrimitive } from "radix-ui"

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

// Radix tooltips only open on hover/focus, which never happens on a phone. Keep the open state
// here so a tap on the trigger toggles it too (hover and keyboard behave as before).
const TapContext = React.createContext<((fn: (o: boolean) => boolean) => void) | null>(null)

function Tooltip({
  open: openProp,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const [inner, setInner] = React.useState(false)
  const open = openProp ?? inner
  const set = React.useCallback(
    (fn: (o: boolean) => boolean) => {
      const next = fn(open)
      setInner(next)
      onOpenChange?.(next)
    },
    [open, onOpenChange],
  )
  return (
    <TapContext.Provider value={set}>
      <TooltipPrimitive.Root
        data-slot="tooltip"
        open={open}
        onOpenChange={(o) => set(() => o)}
        {...props}
      />
    </TapContext.Provider>
  )
}

function TooltipTrigger({
  onClick,
  onPointerDown,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  const toggle = React.useContext(TapContext)
  const touched = React.useRef(false)
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      onPointerDown={(e) => {
        onPointerDown?.(e)
        touched.current = e.pointerType !== "mouse"
        if (toggle && touched.current && !e.defaultPrevented) {
          e.preventDefault() // skip Radix's "close on pointer down"
          toggle((o) => !o)
        }
      }}
      onClick={(e) => {
        onClick?.(e)
        if (touched.current) e.preventDefault() // and its "close on click" after a tap
      }}
      {...props}
    />
  )
}

function TooltipContent({
  className,
  arrowClassName,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content> & { arrowClassName?: string }) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 inline-flex w-fit max-w-xs origin-(--radix-tooltip-content-transform-origin) items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs text-background has-data-[slot=kbd]:pr-1.5 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className={cn("z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground", arrowClassName)} />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
