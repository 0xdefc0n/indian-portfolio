import { ArrowDownLeftIcon, ArrowUpRightIcon, ChevronDownIcon, InfoIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Money, Percent } from "@/components/ui/rolling-number"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { Activity, Holding, Member, Sip } from "@/lib/api"
import { day, inr, month, pct, per, signed, units } from "@/lib/format"
import { useOpenFund } from "@/lib/fund-context"
import { useScrub } from "@/lib/scrub"
import { estimateNote, isBuy, unitsText } from "@/lib/activity"
import { movedNote, type Upcoming } from "@/lib/sips"
import { cn } from "@/lib/utils"
import { holdingFlows, xirr } from "@/lib/xirr"

/** `overall`: Overall XIRR (funds and stocks plus FD, PPF and EPF, M19); undefined when there are no manual assets. */
export type Returns = { invested: number; current: number; gain: number; xirr: number | null; funds: number; complete: boolean; overall?: number | null }
type Members = Map<string, Member>

const firstName = (members: Members, id: string) => members.get(id)?.name.split(" ")[0]
const inDays = (n: number) => (n === 0 ? "today" : n === 1 ? "tomorrow" : n > 0 ? `in ${n} days` : `${-n} days ago`)

/** A bento tile. `delay` staggers the entrance animation. */
export function Cell({ children, className, delay = 0, lift = true, label }: {
  children: React.ReactNode
  className?: string
  delay?: number
  lift?: boolean
  label?: string
}) {
  return (
    <section
      aria-label={label}
      style={{ animationDelay: `${delay}ms` }}
      className={cn(
        "rise glass relative min-w-0 rounded-[24px] p-5 sm:p-6",
        lift && "lift",
        className,
      )}
    >
      {children}
    </section>
  )
}

export function CellHead({ title, aside }: { title: string; aside?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      {aside && <div className="text-[13px]">{aside}</div>}
    </div>
  )
}

/* ---------------------------------------------------------------- hero */

/** Big total. While the value chart is scrubbed it shows that month instead. */
/** `today`: the day's change (M12). When it's known the chip shows it; otherwise the month-on-month change. */
export function HeroFigures({ total, change, prev, label = "Total value", today }: {
  total: number
  change: number | null
  prev: { month: string; value: number } | null
  label?: string
  today?: { change: number; base: number; date: string } | null
}) {
  const scrub = useScrub()
  const chipRef = useRef<HTMLSpanElement>(null)
  const shown = useRef(total)

  // Flash the change chip when the figure changes (member switch / new data), not on first paint or while scrubbing.
  useEffect(() => {
    if (shown.current === total) return
    shown.current = total
    const el = chipRef.current
    if (!el) return
    el.classList.remove("flash")
    void el.offsetWidth
    el.classList.add("flash")
  }, [total])

  const value = scrub ? scrub.value : total
  const useToday = !scrub && !!today
  const delta = scrub ? scrub.value - scrub.base.value : useToday ? today.change : change
  const base = scrub ? scrub.base.value : useToday ? today.base : prev?.value
  const since = scrub ? `since ${month(scrub.base.month, true)}` : useToday ? "today" : prev ? `since ${month(prev.month)}` : null

  return (
    <div>
      <p className="eyebrow">{scrub ? `Value in ${month(scrub.month, true)}` : label}</p>
      <h1 className="mt-2 text-[44px] leading-none font-semibold tracking-[-0.045em] sm:text-[64px]">
        <Money value={value} fast={!!scrub} />
      </h1>
      {delta != null && base ? (
        <div className="mt-4 flex flex-wrap items-center gap-x-3.5 gap-y-2">
          <span
            ref={chipRef}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[13.5px] font-semibold",
              delta >= 0 ? "bg-gain/15 text-gain" : "bg-loss/15 text-loss",
            )}
          >
            <Money value={delta} signed fast={!!scrub} />
            <span aria-hidden>·</span>
            <Percent value={(delta / base) * 100} digits={2} signed fast={!!scrub} />
          </span>
          {since && <span className="text-sm text-muted-foreground">{since}</span>}
        </div>
      ) : null}
    </div>
  )
}

function Box({ label, children, help }: { label: string; children: React.ReactNode; help?: string }) {
  return (
    <div className="min-w-0 py-1">
      <dt className="eyebrow flex items-center gap-1.5">
        {label}
        {help && (
          <Tooltip>
            <TooltipTrigger aria-label={`About ${label}`} className="-m-4 p-4">
              <InfoIcon className="size-3" />
            </TooltipTrigger>
            <TooltipContent className="max-w-64 normal-case tracking-normal">{help}</TooltipContent>
          </Tooltip>
        )}
      </dt>
      <dd className="mt-1 truncate text-lg font-semibold tracking-tight sm:text-xl">{children}</dd>
    </div>
  )
}

const XIRR_HELP = "Annualised return that accounts for when each rupee went in, the same measure Groww and Kuvera show. Includes stamp duty, redemptions and dividends."
const OVERALL_HELP = "XIRR with your FDs, PPF and EPF included (approximate, before tax). Funds & stocks XIRR leaves them out."

/** Phones: the amount short (₹3.1L); a tap shows the full figure. From `sm` up: the full figure. */
function PhoneShortMoney({ value, signed: sign, label }: { value: number; signed?: boolean; label: string }) {
  const full = sign ? signed(value, inr) : inr(value)
  return (
    <>
      <Tooltip>
        <TooltipTrigger aria-label={`${label}: ${full}`}
          className="-my-2 rounded-md py-2 underline decoration-current/30 decoration-dotted underline-offset-[5px] focus-visible:outline-2 focus-visible:outline-ring sm:hidden">
          <Money value={value} signed={sign} short />
        </TooltipTrigger>
        <TooltipContent className="text-sm font-semibold tabular-nums">{full}</TooltipContent>
      </Tooltip>
      <Money value={value} signed={sign} className="max-sm:hidden" />
    </>
  )
}

export function ReturnBoxes({ returns, showValue, valueLabel = "Value of these funds" }: { returns: Returns; showValue?: boolean; valueLabel?: string }) {
  const tone = returns.gain >= 0 ? "text-gain" : "text-loss"
  const withOverall = returns.overall !== undefined
  const overallTone = (returns.overall ?? 0) >= 0 ? "text-gain" : "text-loss"
  // three figures sit in one row on a phone too (no empty slot); four are 2×2
  const three = !showValue && !withOverall
  return (
    // v2: a strip of figures split by hairlines
    // on a phone amounts are short (₹18.9L, +₹69K; a tap shows the full one), so each figure and its % fit on one line
    <dl className={cn(
      "grid gap-y-3 [&>div]:sm:border-l [&>div]:sm:border-border [&>div]:sm:pl-5 [&>div:first-child]:border-0 [&>div:first-child]:pl-0",
      three ? "grid-cols-[auto_auto_auto] justify-between gap-x-3 sm:grid-cols-3 sm:justify-normal sm:gap-x-5 [&_dd]:max-sm:text-base" : "grid-cols-2 gap-x-5 sm:grid-cols-4",
    )}>
      {showValue && <Box label={valueLabel}><PhoneShortMoney value={returns.current} label={valueLabel} /></Box>}
      <Box label="Invested">
        <PhoneShortMoney value={returns.invested} label="Invested" />
      </Box>
      <Box label="Total returns">
        <span className={tone}>
          <PhoneShortMoney value={returns.gain} signed label="Total returns" />
        </span>
        {returns.invested > 0 && (
          <span className={"ml-1 text-xs font-medium text-muted-foreground sm:ml-1.5 sm:text-sm"}>
            <Percent value={(returns.gain / returns.invested) * 100} signed />
          </span>
        )}
      </Box>
      <Box label={withOverall ? "Funds & stocks XIRR" : "XIRR"} help={XIRR_HELP}>
        {returns.xirr == null ? "—" : <span className={tone}><Percent value={returns.xirr * 100} digits={2} signed /></span>}
      </Box>
      {withOverall && (
        <Box label="Overall XIRR" help={OVERALL_HELP}>
          {returns.overall == null ? "—" : <span className={overallTone}><Percent value={returns.overall * 100} digits={2} signed /></span>}
        </Box>
      )}
    </dl>
  )
}

/* ---------------------------------------------------------------- partial data */

/** `inline`: a quiet row inside the hero (v2) instead of its own card. */
export function PartialNotice({ returns, included, missing, total, request, inline = false }: {
  returns: Returns
  included: string[]
  missing: string[]
  total: number
  request: (label: string) => React.ReactNode
  inline?: boolean
}) {
  const [open, setOpen] = useState(false)
  const body = (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn(
          "flex w-full items-center gap-4 text-left focus-visible:outline-2 focus-visible:outline-ring",
          inline ? "min-h-11 rounded-xl py-1" : "rounded-[24px] px-5 py-4 sm:px-6",
        )}
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-[10px] text-[var(--cat-gold)]" style={{ background: "color-mix(in srgb, var(--cat-gold) 16%, transparent)" }}>
          <TriangleAlertIcon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium">Partial data</span>
          <span className="block text-[13.5px] text-muted-foreground">
            Invested amount, returns and XIRR for {returns.funds} of {returns.funds + missing.length} funds, not the whole portfolio
          </span>
        </span>
        <ChevronDownIcon className={cn("size-5 shrink-0 text-muted-foreground transition-transform duration-300", open && "rotate-180")} />
      </button>
      <div className="expander" data-open={open}>
        <div>
          <div className={cn("pb-6 transition-opacity duration-300", inline ? "pt-4" : "px-5 sm:pr-6 sm:pl-[72px]", open ? "opacity-100 delay-75" : "opacity-0")}>
            <ReturnBoxes returns={returns} showValue />
            <p className="mt-4 text-[13.5px] text-muted-foreground">
              These funds are {inr(returns.current)} of {inr(total)}. The rest were bought before the CAMS / KFintech statement
              starts, so what was paid for them isn't known. {request("Add a CAMS / KFintech statement from the first investment")}
            </p>
            <div className="mt-5 grid gap-6 text-[13.5px] sm:grid-cols-2">
              <div>
                <h3 className="eyebrow">Included</h3>
                <ul className="mt-2 space-y-1 text-muted-foreground">{included.map((n, i) => <li key={`${n}-${i}`}>{n}</li>)}</ul>
              </div>
              <div>
                <h3 className="eyebrow">Missing purchase history</h3>
                <ul className="mt-2 space-y-1 text-muted-foreground">{missing.map((n, i) => <li key={`${n}-${i}`}>{n}</li>)}</ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
  return inline ? (
    <section aria-label="Partial data">{body}</section>
  ) : (
    <Cell className="p-0 sm:p-0 md:col-span-6 lg:col-span-12" delay={290} lift={false} label="Partial data">{body}</Cell>
  )
}

/* ---------------------------------------------------------------- holdings */

/** Largest funds as proportional bars; a row expands in place with the investor's figures. */
export function HoldingBars({ holdings, total, members, showMember, limit = 5 }: {
  holdings: Holding[]
  total: number
  members: Members
  showMember: boolean
  limit?: number
}) {
  const openFund = useOpenFund()
  const [open, setOpen] = useState<string | null>(null)
  const max = holdings[0]?.value ?? 1
  return (
    <ul className="grid grid-cols-1 gap-1">
      {holdings.slice(0, limit).map((h, i) => {
        const key = `${h.member_id}-${h.isin}-${h.folio}`
        const on = open === key
        const fx = h.invested != null && h.cashflows?.length ? xirr(holdingFlows([h])) : null
        return (
          <li key={key}>
            <button
              type="button"
              aria-expanded={on}
              onClick={() => setOpen(on ? null : key)}
              className={cn(
                "-mx-3 grid w-[calc(100%+1.5rem)] grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 rounded-2xl px-3 py-2.5 text-left transition-colors",
                "focus-visible:outline-2 focus-visible:outline-ring",
                on ? "bg-surface-2" : "hover:bg-surface-2",
              )}
            >
              <span className="min-w-0">
                <span className="line-clamp-2 block text-sm leading-snug font-medium sm:truncate">{h.name}</span>
                <span className="block text-[12.5px] text-muted-foreground">
                  {h.category}
                  {showMember && <> · {firstName(members, h.member_id)}</>}
                </span>
              </span>
              <span className="text-right text-sm font-semibold tabular-nums">
                {inr(h.value)}
                <span className="block text-[12.5px] font-normal text-muted-foreground">{pct(total ? (h.value / total) * 100 : 0)}</span>
              </span>
              <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-border">
                <span
                  className="block h-full origin-left rounded-full animate-[grow-x_.9s_cubic-bezier(.2,.8,.2,1)_both] transition-[width] duration-700"
                  style={{ width: `${(h.value / max) * 100}%`, background: "var(--chart-1)", animationDelay: `${200 + i * 70}ms` }}
                />
              </span>
            </button>
            <div className="expander" data-open={on}>
              <div>
                <div className={cn("grid grid-cols-3 items-end gap-x-4 gap-y-3 py-3 text-[13px] transition-opacity duration-300 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto]", on ? "opacity-100" : "opacity-0")}>
                  <div><div className="eyebrow">Invested</div><div className="mt-0.5 text-sm font-semibold">{inr(h.invested)}</div></div>
                  <div>
                    <div className="eyebrow">Returns</div>
                    <div className={cn("mt-0.5 text-sm font-semibold", h.invested != null && (h.value >= h.invested ? "text-gain" : "text-loss"))}>
                      {h.invested != null ? signed(h.value - h.invested, inr) : "Needs full statement"}
                    </div>
                  </div>
                  <div>
                    <div className="eyebrow">XIRR</div>
                    <div className={cn("mt-0.5 text-sm font-semibold", fx != null && (fx >= 0 ? "text-gain" : "text-loss"))}>{fx != null ? signed(fx * 100, (n) => pct(n, 1)) : "—"}</div>
                  </div>
                  <button
                    type="button"
                    tabIndex={on ? 0 : -1}
                    onClick={() => openFund(h)}
                    className="col-span-3 -my-2 justify-self-start py-2 text-[13px] font-medium text-primary hover:underline sm:col-span-1 sm:justify-self-end"
                  >
                    Full details
                  </button>
                </div>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/* ---------------------------------------------------------------- SIPs */

const short = (iso: string) => day(iso).split(" ").slice(0, 2).join(" ")

/** Instalments debited and waiting for units (T to T+2 business days), as the broker shows them. */
function InProgressList({ sips, members, showMember }: { sips: Sip[]; members: Members; showMember: boolean }) {
  return (
    <ul className="mb-3 space-y-2">
      {sips.map((s) => {
        const l = s.latest!
        const moved = movedNote(l.moved, l.due, short)
        return (
          <li key={`run-${s.member_id}-${s.folio}-${s.isin}`} className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2.5 text-sm ring-1 ring-border">
            <Loader2Icon className="size-4 shrink-0 animate-spin text-primary" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="line-clamp-2 leading-snug font-medium sm:truncate">{s.name}</div>
              <div className="text-[12.5px] text-muted-foreground">
                In progress · debited {short(l.date)} · units by {short(l.units_by)}
                {moved && <> · {moved}</>}
                {showMember && <> · {firstName(members, s.member_id)}</>}
              </div>
            </div>
            <div className="shrink-0 text-right font-semibold tabular-nums">{inr(l.amount)}</div>
          </li>
        )
      })}
    </ul>
  )
}

/** Timeline from today to the last listed run date, one pin per instalment, then the same instalments as a list. */
export function SipTimeline({ upcoming, members, showMember }: { upcoming: Upcoming; members: Members; showMember: boolean }) {
  const { list, days, running } = upcoming
  if (!list.length) {
    return (
      <>
        {running.length > 0 && <InProgressList sips={running} members={members} showMember={showMember} />}
        <p className="py-4 text-sm text-muted-foreground">No active SIPs found.</p>
      </>
    )
  }
  const at = (n: number) => (n / days) * 100
  // Date labels under pins, skipping any that would crowd the previous label or the end labels.
  let lastLabel = 0
  const labelled = new Set<number>()
  list.forEach(({ n }, i) => {
    const x = at(n)
    if (x > 16 && x < 70 && x - lastLabel > 22) { labelled.add(i); lastLabel = x }
  })
  const last = list[list.length - 1]
  return (
    <div>
      {running.length > 0 && <InProgressList sips={running} members={members} showMember={showMember} />}
      <div className="relative mx-1.5 mt-1 mb-4 h-16" aria-hidden>
        <span className="absolute inset-x-0 top-[30px] h-0.5 rounded-full bg-border" />
        <span className="absolute top-[18px] left-0 h-[26px] w-0.5 rounded-full bg-foreground" />
        <span className="absolute top-[50px] left-0 text-[11px] text-muted-foreground">Today</span>
        <span className="absolute top-[50px] right-0 text-[11px] text-muted-foreground">{short(last.date)}</span>
        {list.map(({ s, n, date }, i) => (
          <span key={`${s.member_id}-${s.isin}-${s.folio}`}>
            <span
              title={`${s.name}: ${inr(s.amount)} on ${day(date)}`}
              className={cn(
                "absolute top-[22px] -ml-[9px] size-[18px] rounded-full ring-2 ring-primary ring-inset animate-[pop_.6s_cubic-bezier(.2,.8,.2,1)_both]",
                n <= 7 ? "bg-primary" : "bg-surface",
              )}
              style={{ left: `${at(n)}%`, animationDelay: `${300 + i * 80}ms` }}
            />
            {labelled.has(i) && (
              <span className="absolute top-[50px] -translate-x-1/2 text-[11px] whitespace-nowrap text-muted-foreground" style={{ left: `${at(n)}%` }}>
                {short(date)}
              </span>
            )}
          </span>
        ))}
      </div>
      <ul className="divide-y">
        {list.map(({ s, n, date, due, moved }) => {
          const [d, m] = day(date).split(" ")
          const skipped = s.skipped?.filter((d) => d < due).at(-1)
          const note = movedNote(moved, due, short) ?? (skipped ? `${short(skipped)} skipped` : null)
          return (
            <li key={`${s.member_id}-${s.folio}-${s.isin}`} className="flex items-center gap-3.5 py-2.5 text-sm">
              <span className="w-11 shrink-0 text-center leading-tight">
                <b className="block text-lg font-semibold">{d}</b>
                <span className="text-xs text-muted-foreground">{m}</span>
              </span>
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 leading-snug font-medium sm:truncate">{s.name}</div>
                <div className="text-[12.5px] text-muted-foreground">
                  {inDays(n)}
                  {note && <> · {note}</>}
                  {showMember && <> · {firstName(members, s.member_id)}</>}
                </div>
              </div>
              <div className="shrink-0 text-right font-semibold tabular-nums">
                {inr(s.amount)}
                <div className="text-[12.5px] font-normal text-muted-foreground">{per(s.frequency)}</div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/* ---------------------------------------------------------------- activity */

export function ActivityGrid({ items, members, showMember, columns = 2 }: { items: Activity[]; members: Members; showMember: boolean; columns?: 1 | 2 }) {
  if (!items.length) return <p className="py-6 text-sm text-muted-foreground">No purchases or redemptions in the latest statements.</p>
  return (
    <ul className={cn("grid grid-cols-1 gap-x-8", columns === 2 && "md:grid-cols-2")}>
      {items.map((a, i) => {
        const bought = isBuy(a)
        const note = estimateNote(a)
        return (
          <li
            key={`${a.member_id}-${a.isin}-${a.date}-${i}`}
            className="rise flex items-center gap-3.5 border-t py-3 text-sm"
            style={{ animationDelay: `${450 + i * 50}ms` }}
          >
            <span className={cn("hidden size-[34px] shrink-0 place-items-center rounded-[11px] sm:grid", bought ? "bg-gain/15 text-gain" : "bg-loss/15 text-loss")}>
              {bought ? <ArrowDownLeftIcon className="size-4" /> : <ArrowUpRightIcon className="size-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="line-clamp-2 leading-snug font-medium sm:truncate">{a.name}</div>
              <div className="text-[12.5px] text-muted-foreground">
                {day(a.date)}
                {showMember && <> · {members.get(a.member_id)?.name}</>}
              </div>
              {note && <div className="text-[12.5px] text-muted-foreground">{note}</div>}
            </div>
            <div className="shrink-0 text-right">
              {a.amount != null ? (
                <>
                  <div className={cn("font-semibold tabular-nums", !bought && "text-loss")}>
                    {bought ? (a.sip ? "SIP " : "Bought ") : "Sold "}
                    {inr(Math.abs(a.amount))}
                  </div>
                  <div className="text-[12.5px] text-muted-foreground">{unitsText(a)}</div>
                </>
              ) : (
                <div className={cn("font-semibold", bought ? "text-gain" : "text-loss")}>
                  {bought ? "+" : "−"}
                  {units(Math.abs(a.units))} units
                </div>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
