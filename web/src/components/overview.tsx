import { ArrowDownLeftIcon, ArrowUpRightIcon, ChevronDownIcon, InfoIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { Count, Money, Percent } from "@/components/ui/rolling-number"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { Activity, Holding, Member, Sip } from "@/lib/api"
import { CATEGORY_COLOR, categoryColor, day, inr, inrShort, month, monthly, pct, per, signed, units } from "@/lib/format"
import { useOpenFund } from "@/lib/fund-context"
import { useScrub } from "@/lib/scrub"
import { estimateNote, isBuy, unitsText } from "@/lib/activity"
import { movedNote, type Upcoming } from "@/lib/sips"
import { cn } from "@/lib/utils"
import { holdingFlows, xirr } from "@/lib/xirr"
import type { Slice } from "@/components/allocation-strip"

export type Returns = { invested: number; current: number; gain: number; xirr: number | null; funds: number; complete: boolean }
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
        "rise relative min-w-0 rounded-[22px] bg-surface p-5 ring-1 ring-border sm:p-6",
        lift && "transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(.2,.8,.2,1)] hover:-translate-y-0.5 hover:shadow-[0_24px_48px_-24px_var(--shadow)]",
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
      <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
      {aside && <div className="text-[13px]">{aside}</div>}
    </div>
  )
}

/* ---------------------------------------------------------------- hero */

/** Big total. While the value chart is scrubbed it shows that month instead. */
export function HeroFigures({ total, change, prev }: { total: number; change: number | null; prev: { month: string; value: number } | null }) {
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
  const delta = scrub ? scrub.value - scrub.base.value : change
  const base = scrub ? scrub.base.value : prev?.value
  const since = scrub ? month(scrub.base.month, true) : prev ? month(prev.month) : null

  return (
    <div>
      <p className="eyebrow">{scrub ? `Value in ${month(scrub.month, true)}` : "Total value"}</p>
      <h1 className="mt-2 text-5xl leading-none font-semibold tracking-[-0.045em] sm:text-[76px]">
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
          {since && <span className="text-sm text-muted-foreground">since {since}</span>}
        </div>
      ) : null}
    </div>
  )
}

function Box({ label, children, help }: { label: string; children: React.ReactNode; help?: string }) {
  return (
    <div className="min-w-0 rounded-2xl bg-surface-2 px-3.5 py-3 ring-1 ring-border">
      <dt className="eyebrow flex items-center gap-1.5">
        {label}
        {help && (
          <Tooltip>
            <TooltipTrigger aria-label={`About ${label}`} className="-m-2 p-2">
              <InfoIcon className="size-3" />
            </TooltipTrigger>
            <TooltipContent className="max-w-64 normal-case tracking-normal">{help}</TooltipContent>
          </Tooltip>
        )}
      </dt>
      <dd className="mt-1.5 truncate text-lg font-semibold tracking-tight sm:text-xl">{children}</dd>
    </div>
  )
}

const XIRR_HELP = "Annualised return that accounts for when each rupee went in, the same measure Groww and Kuvera show. Includes stamp duty, redemptions and dividends."

export function ReturnBoxes({ returns, showValue }: { returns: Returns; showValue?: boolean }) {
  const tone = returns.gain >= 0 ? "text-gain" : "text-loss"
  return (
    <dl className={cn("grid grid-cols-2 gap-3", showValue ? "lg:grid-cols-4" : "sm:grid-cols-3")}>
      {showValue && <Box label="Value of these funds"><Money value={returns.current} /></Box>}
      <Box label="Invested"><Money value={returns.invested} /></Box>
      <Box label="Total returns">
        <span className={tone}><Money value={returns.gain} signed /></span>
        <span className="ml-1.5 text-sm font-medium text-muted-foreground">
          <Percent value={(returns.gain / returns.invested) * 100} signed />
        </span>
      </Box>
      <Box label="XIRR" help={XIRR_HELP}>
        {returns.xirr == null ? "—" : <span className={tone}><Percent value={returns.xirr * 100} digits={2} signed /></span>}
      </Box>
    </dl>
  )
}

/* ---------------------------------------------------------------- allocation */

const R = 80
const C = 2 * Math.PI * R

/** Donut of categories; hovering a slice or legend row focuses it, clicking opens Holdings filtered to it. */
export function AllocationDonut({ slices, total, funds, onSelect }: { slices: Slice[]; total: number; funds: number; onSelect: (c: string) => void }) {
  const [focus, setFocus] = useState<string | null>(null)
  // One arc per known category, always mounted, so arcs animate between members instead of popping.
  const by = new Map(slices.map((s) => [s.category, s]))
  const all = [...new Set([...Object.keys(CATEGORY_COLOR), ...slices.map((s) => s.category)])]
  const ordered = [...slices.map((s) => s.category), ...all.filter((c) => !by.has(c))]
  let offset = 0
  const arcs = new Map(ordered.map((c) => {
    const s = by.get(c)
    const arc = { len: s ? Math.max((s.share / 100) * C - 3, 0.5) : 0, offset }
    if (s) offset += (s.share / 100) * C
    return [c, arc] as const
  }))
  const f = focus ? by.get(focus) : null

  return (
    <div className="md:grid md:grid-cols-[210px_minmax(0,1fr)] md:items-center md:gap-8 lg:block">
      <div className="relative mx-auto mb-5 size-[210px] md:mb-0 lg:mb-5">
        <svg viewBox="0 0 200 200" className="size-full -rotate-90 overflow-visible" aria-hidden>
          <circle cx="100" cy="100" r={R} fill="none" stroke="var(--border)" strokeWidth={22} />
          {all.map((c) => {
            const a = arcs.get(c)!
            return (
              <circle
                key={c}
                cx="100" cy="100" r={R} fill="none"
                stroke={categoryColor(c)}
                strokeWidth={focus === c ? 28 : 22}
                strokeDasharray={`${a.len} ${C}`}
                strokeDashoffset={-a.offset}
                onMouseEnter={() => setFocus(c)}
                onMouseLeave={() => setFocus(null)}
                onClick={() => by.has(c) && onSelect(c)}
                className={cn(
                  "cursor-pointer transition-[stroke-dasharray,stroke-dashoffset,stroke-width,opacity] duration-700 ease-[cubic-bezier(.3,.85,.2,1)] [pointer-events:stroke]",
                  focus && focus !== c && "opacity-25",
                )}
              />
            )
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
          <b className="text-[26px] font-semibold tracking-[-0.03em]">{f ? pct(f.share) : inrShort(total)}</b>
          <span className="mx-auto max-w-32 text-[12.5px] text-muted-foreground">{f ? `${f.category} · ${inr(f.value)}` : `across ${funds} funds`}</span>
        </div>
      </div>
      <ul className="grid grid-cols-1 gap-0.5">
        {slices.map((s) => (
          <li key={s.category}>
            <button
              type="button"
              onMouseEnter={() => setFocus(s.category)}
              onMouseLeave={() => setFocus(null)}
              onFocus={() => setFocus(s.category)}
              onBlur={() => setFocus(null)}
              onClick={() => onSelect(s.category)}
              aria-label={`${s.category}: ${pct(s.share)} (${inr(s.value)}). Show these funds`}
              className={cn(
                "-mx-2 grid w-[calc(100%+1rem)] grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1.5 rounded-lg px-2 py-1.5 text-left text-[13.5px] transition-colors",
                "focus-visible:outline-2 focus-visible:outline-ring",
                focus === s.category ? "bg-surface-2" : "hover:bg-surface-2",
              )}
            >
              <span className="size-2.5 rounded-[3px]" style={{ background: categoryColor(s.category) }} />
              <span className="truncate">{s.category}</span>
              <span className="font-semibold tabular-nums">{pct(s.share, 0)}</span>
              <span className="col-span-2 col-start-2 h-[3px] overflow-hidden rounded-full bg-border">
                <span
                  className="block h-full rounded-full transition-[width] duration-700 ease-[cubic-bezier(.3,.85,.2,1)]"
                  style={{ width: `${s.share}%`, background: categoryColor(s.category) }}
                />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ---------------------------------------------------------------- tiles */

export function SipTile({ sips, missing }: { sips: Sip[]; missing: boolean }) {
  const amounts = sips.map((s) => monthly(s.amount, s.frequency))
  const max = Math.max(...amounts, 1)
  return (
    <div className="flex h-full flex-col gap-1.5">
      <span className="eyebrow">Monthly SIPs</span>
      <div className="mt-2 text-[34px] leading-tight font-semibold tracking-[-0.035em]">
        {sips.length ? <Money value={amounts.reduce((a, b) => a + b, 0)} /> : "—"}
      </div>
      <p className="truncate text-[13.5px] text-muted-foreground">
        {sips.length ? `${sips.length} active SIP${sips.length > 1 ? "s" : ""}` : missing ? "needs a CAMS / KFintech statement" : "none active"}
      </p>
      {sips.length > 0 && (
        <div className="mt-auto flex h-11 items-end gap-1.5 pt-3" aria-hidden>
          {sips.slice(0, 14).map((s, i) => (
            <span
              key={`${s.member_id}-${s.isin}-${s.folio}`}
              title={`${s.name}: ${inr(s.amount)}${per(s.frequency)}`}
              className="flex-1 origin-bottom rounded-t-[5px] rounded-b-[2px] bg-primary/55 animate-[grow-y_.7s_cubic-bezier(.2,.8,.2,1)_both]"
              style={{ height: `${(amounts[i] / max) * 100}%`, animationDelay: `${300 + i * 60}ms` }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function LargestTile({ holding, total }: { holding: Holding | undefined; total: number }) {
  const share = holding && total ? (holding.value / total) * 100 : 0
  const r = 30, c = 2 * Math.PI * r
  return (
    <div className="relative flex h-full flex-col gap-1.5">
      <span className="eyebrow">Largest holding</span>
      <svg viewBox="0 0 76 76" className="absolute top-0 right-0 size-16 lg:size-[76px]" aria-hidden>
        <circle cx="38" cy="38" r={r} fill="none" stroke="var(--border)" strokeWidth={9} />
        <circle
          cx="38" cy="38" r={r} fill="none" stroke="var(--primary)" strokeWidth={9} strokeLinecap="round"
          strokeDasharray={`${(share / 100) * c} ${c}`} transform="rotate(-90 38 38)"
          className="transition-[stroke-dasharray] duration-[900ms] ease-[cubic-bezier(.3,.85,.2,1)]"
        />
      </svg>
      <div className="mt-2 text-[34px] leading-tight font-semibold tracking-[-0.035em]">{holding ? <Percent value={share} /> : "—"}</div>
      <p className="line-clamp-2 text-[13.5px] leading-snug text-muted-foreground">{holding?.name}</p>
    </div>
  )
}

export function FundsTile({ holdings }: { holdings: Holding[] }) {
  const amcs = useMemo(() => [...new Set(holdings.map((h) => h.amc || h.name))], [holdings])
  return (
    <div className="flex h-full flex-col gap-1.5">
      <span className="eyebrow">Funds held</span>
      <div className="mt-2 text-[34px] leading-tight font-semibold tracking-[-0.035em]"><Count value={holdings.length} /></div>
      <p className="text-[13.5px] text-muted-foreground">across {amcs.length} fund house{amcs.length === 1 ? "" : "s"}</p>
      <ul className="mt-auto flex flex-wrap gap-1.5 pt-3">
        {amcs.slice(0, 10).map((a, i) => (
          <li
            key={a}
            className="rise rounded-full bg-surface-2 px-2.5 py-0.5 text-xs text-muted-foreground ring-1 ring-border"
            style={{ animationDelay: `${300 + i * 40}ms` }}
          >
            {a}
          </li>
        ))}
        {amcs.length > 10 && <li className="px-1 text-xs text-muted-foreground">+{amcs.length - 10} more</li>}
      </ul>
    </div>
  )
}

/* ---------------------------------------------------------------- partial data */

export function PartialNotice({ returns, included, missing, total, request }: {
  returns: Returns
  included: string[]
  missing: string[]
  total: number
  request: (label: string) => React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <Cell className="p-0 sm:p-0 md:col-span-6 lg:col-span-12" delay={290} lift={false} label="Partial data">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-4 rounded-[22px] px-5 py-4.5 text-left focus-visible:outline-2 focus-visible:outline-ring sm:px-6"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-[10px] text-[var(--cat-gold)]" style={{ background: "color-mix(in srgb, var(--cat-gold) 16%, transparent)" }}>
          <TriangleAlertIcon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">Partial data</span>
          <span className="block text-[13.5px] text-muted-foreground">
            Invested amount, returns and XIRR for {returns.funds} of {returns.funds + missing.length} funds, not the whole portfolio
          </span>
        </span>
        <ChevronDownIcon className={cn("size-5 shrink-0 text-muted-foreground transition-transform duration-300", open && "rotate-180")} />
      </button>
      <div className="expander" data-open={open}>
        <div>
          <div className={cn("px-5 pb-6 transition-opacity duration-300 sm:pr-6 sm:pl-[74px]", open ? "opacity-100 delay-75" : "opacity-0")}>
            <ReturnBoxes returns={returns} showValue />
            <p className="mt-4 text-[13.5px] text-muted-foreground">
              These funds are {inr(returns.current)} of {inr(total)}. The rest were bought before the CAMS / KFintech statement
              starts, so what was paid for them isn't known. {request("Request a statement from the first investment")}
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
    </Cell>
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
                  style={{ width: `${(h.value / max) * 100}%`, background: categoryColor(h.category), animationDelay: `${200 + i * 70}ms` }}
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
        <span className="absolute top-[50px] left-0 font-mono text-[10.5px] text-muted-foreground">Today</span>
        <span className="absolute top-[50px] right-0 font-mono text-[10.5px] text-muted-foreground">{short(last.date)}</span>
        {list.map(({ s, n, date }, i) => (
          <span key={`${s.member_id}-${s.isin}-${s.folio}`}>
            <span
              title={`${s.name}: ${inr(s.amount)} on ${day(date)}`}
              className={cn(
                "absolute top-[22px] -ml-[9px] size-[18px] rounded-full ring-2 ring-primary ring-inset animate-[pop_.5s_cubic-bezier(.2,1.4,.4,1)_both]",
                n <= 7 ? "bg-primary" : "bg-surface",
              )}
              style={{ left: `${at(n)}%`, animationDelay: `${300 + i * 80}ms` }}
            />
            {labelled.has(i) && (
              <span className="absolute top-[50px] -translate-x-1/2 font-mono text-[10.5px] whitespace-nowrap text-muted-foreground" style={{ left: `${at(n)}%` }}>
                {short(date)}
              </span>
            )}
          </span>
        ))}
      </div>
      <ul className="divide-y">
        {list.map(({ s, n, date, due, moved }) => {
          const [d, m] = day(date).split(" ")
          const note = movedNote(moved, due, short)
          return (
            <li key={`${s.member_id}-${s.folio}-${s.isin}`} className="flex items-center gap-3.5 py-2.5 text-sm">
              <span className="w-11 shrink-0 text-center leading-tight">
                <b className="block text-lg font-semibold">{d}</b>
                <span className="font-mono text-[10.5px] text-muted-foreground uppercase">{m}</span>
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

export function ActivityGrid({ items, members, showMember }: { items: Activity[]; members: Members; showMember: boolean }) {
  if (!items.length) return <p className="py-6 text-sm text-muted-foreground">No purchases or redemptions in the latest statements.</p>
  return (
    <ul className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
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
