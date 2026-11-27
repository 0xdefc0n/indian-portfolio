// Add, edit and change FD / PPF / EPF (plan §21.12, D28, M19) and gold / silver / SGB (§21.5, M29) entered by hand.
// Only the fields the maths needs: no bank name, account number, certificate number or label. The value and maturity update live under the form, computed with the same
// calculator the Worker uses. Same Dialog / Input / Label / Segmented / ToggleGroup as the rest of the app (§13).
import {
  type AssetInputs, type AssetType, DEFAULT_PENALTY, type EpfInputs, epfRate, type FdInputs, fyLabel, fyOf, GOLD_PURITIES, isMetalType,
  parseInputs, PPF_YEAR_LIMIT, type PpfInputs, ppfRate, type RateTable, SGB_SERIES, sgbEarliestRedemption, sgbMaturity, sgbSeries,
  type SgbInputs, TENURE_CHIPS, tenureChip, todayIst, valueAsset,
} from "@manual-assets"
import { ChevronDownIcon, Loader2Icon, XIcon } from "lucide-react"
import { type FormEvent, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Segmented } from "@/components/ui/segmented"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { AssetDetails } from "@/components/asset-details"
import { ApiFailure, api, SignedOut } from "@/lib/api"
import type { AssetRow } from "@/lib/assets"
import { day, inr } from "@/lib/format"
import { cn } from "@/lib/utils"

/** Which add dialog: FD / PPF / EPF, or gold / silver / SGB. */
export type AssetGroup = "fixed" | "metal"

export type AssetDialogState =
  | { kind: "add"; member?: string | null; group?: AssetGroup }
  | { kind: "details" | "edit" | "close" | "stop" | "adjust" | "redeem" | "delete"; asset: AssetRow }
  | null

export type PickMember = { id: string; name: string }

const TYPE_LABEL: Record<AssetType, string> = { fd: "FD", ppf: "PPF", epf: "EPF", gold: "Gold", silver: "Silver", sgb: "SGB" }

const FIELD_HELP: Record<string, string> = {
  amount: "Enter the amount in whole rupees.",
  balance: "Enter the balance in whole rupees (0 for a new account).",
  yearly: "Enter the yearly deposit in whole rupees (0 if none).",
  monthly: "Enter the monthly contribution in whole rupees (0 if none).",
  rate: "Enter a rate between 0 and 20%.",
  start: "Pick a start date up to today.",
  as_of: "Pick a date up to today.",
  tenure: "Pick a tenure between 7 days and 10 years.",
  opened_year: "Enter the year the account was opened, up to this year.",
  closed: "Pick a date after the start and before maturity, with a penalty from 0 to 5%.",
  overrides: "Check the year and the amount.",
  stopped: "Pick a date up to today.",
  member: "Pick whose it is.",
  grams: "Enter the weight in grams (whole units for an SGB).",
  purity: "Pick the purity.",
  paid: "Enter what you paid in whole rupees, with the date.",
  bought: "Pick the date you bought it, up to today (an SGB: after its issue, with the price per gram).",
  series: "Pick the series.",
  redeemed: "Pick a date from the 5th year after issue, before maturity.",
}
const helpFor = (field: string) => FIELD_HELP[field] ?? "Check the amounts and dates and try again."

/** "" → NaN, so validation names the field; commas typed in amounts are fine. */
const num = (s: string) => (s.trim() === "" ? Number.NaN : Number(s.replace(/[,\s₹]/g, "")))
const str = (n: number | null | undefined) => (n == null ? "" : String(n))

async function save(work: () => Promise<unknown>, done: string, setError: (e: string | null) => void, setBusy: (b: boolean) => void): Promise<boolean> {
  setBusy(true)
  setError(null)
  try {
    await work()
    toast.success(done)
    return true
  } catch (err) {
    if (err instanceof SignedOut) return false
    const field = err instanceof ApiFailure && typeof err.data.field === "string" ? err.data.field : null
    setError(field ? helpFor(field) : (err as Error).message)
    return false
  } finally {
    setBusy(false)
  }
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-[13px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Money({ id, value, onChange, placeholder }: { id: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <Input id={id} inputMode="numeric" autoComplete="off" placeholder={placeholder ?? "₹"} value={value} onChange={(e) => onChange(e.target.value)} className="h-11" />
  )
}

function Rate({ id, value, onChange, placeholder }: { id: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <Input id={id} inputMode="decimal" autoComplete="off" placeholder={placeholder ?? "%"} value={value} onChange={(e) => onChange(e.target.value)} className="h-11" />
}

function DateInput({ id, value, onChange, min }: { id: string; value: string; onChange: (v: string) => void; min?: string }) {
  return <Input id={id} type="date" min={min} max={todayIst()} value={value} onChange={(e) => onChange(e.target.value)} className="h-11" />
}

function More({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="-my-2 flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronDownIcon className={cn("size-4 transition-transform", open && "rotate-180")} />
        More options
      </button>
      {open && <div className="mt-2 grid gap-4">{children}</div>}
    </div>
  )
}

/** Today's value (and maturity) for what's typed so far. */
function Preview({ type, raw, rates }: { type: AssetType; raw: unknown; rates: RateTable }) {
  const today = todayIst()
  const parsed = parseInputs(type, raw, today)
  if (!parsed.ok) return <p className="text-[13px] text-muted-foreground">Fill in the fields to see today's value.</p>
  const v = valueAsset({ type, inputs: parsed.inputs } as Parameters<typeof valueAsset>[0], today, rates)
  const rows: [string, string][] = [["Value today", v.price || !isMetalType(type) ? inr(v.value) : "Rate unavailable"]]
  if (isMetalType(type)) {
    rows.push(["Rate used", v.price ? `${inr(v.price.rate)}/g` : "–"])
    if (type === "sgb") {
      rows.push([v.status === "active" ? "Matures on" : v.status === "redeemed" ? "Redeemed on" : "Matured on", day(v.status === "redeemed" ? (parsed.inputs as SgbInputs).redeemed : v.maturity)])
      rows.push(["Interest every six months", inr(v.payout_amount)])
    } else if (!v.cost_unknown) {
      rows.push(["Gain", inr(v.gain)])
    }
  } else if (type === "fd") {
    const fd = parsed.inputs as FdInputs
    rows.push([v.status === "matured" ? "Matured on" : "Matures on", day(v.maturity)])
    if (fd.payout) rows.push([`Interest paid ${fd.payout === "monthly" ? "a month" : "a quarter"}`, inr(v.payout_amount)])
    else rows.push(["Maturity amount", inr(v.maturity_amount)])
  } else {
    rows.push(["Rate used", `${v.rate}%${v.provisional ? " (provisional)" : ""}`])
    if (type === "ppf") rows.push([v.status === "extended" ? "15 years ended" : "15 years end", day(v.maturity)])
  }
  return (
    <div className="rounded-2xl bg-surface-2 px-3.5 py-3 ring-1 ring-border" aria-live="polite">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
        {rows.map(([k, val]) => (
          <div key={k} className="min-w-0">
            <dt className="eyebrow">{k}</dt>
            <dd className="mt-0.5 truncate font-semibold tabular-nums">{val}</dd>
          </div>
        ))}
      </dl>
      {v.warnings.includes("ppf_over_limit") && <p className="mt-2 text-[13px] text-loss">PPF takes at most {inr(PPF_YEAR_LIMIT)} a year.</p>}
      <p className="mt-2 text-[12.5px] text-muted-foreground">{isMetalType(type) ? "Approximate, at the bullion rate (before GST and making charges)." : "Approximate, before tax."}</p>
    </div>
  )
}

// ─── Add / edit ─────────────────────────────────────────────────────────────────────────────────────────────────

type Draft = {
  amount: string; rate: string; start: string; chip: string; years: string; months: string; days: string; payout: "none" | "monthly" | "quarterly"
  balance: string; as_of: string; opened_year: string; yearly: string; monthly: string; own_rate: string
  grams: string; purity: string; paid: string; bought: string; series: string; sgb_on: string; sgb_price: string
}

function draftFrom(asset: AssetRow | undefined): Draft {
  const today = todayIst()
  const d: Draft = {
    amount: "", rate: "", start: today, chip: "1y", years: "1", months: "0", days: "0", payout: "none",
    balance: "", as_of: today, opened_year: "", yearly: "", monthly: "", own_rate: "",
    grams: "", purity: "916", paid: "", bought: "", series: SGB_SERIES.at(-1)?.id ?? "", sgb_on: "", sgb_price: "",
  }
  if (!asset) return d
  if (asset.type === "gold" || asset.type === "silver") {
    const i = asset.inputs
    return { ...d, grams: str(i.grams), purity: str(i.purity), paid: str(i.paid), bought: i.bought ?? "" }
  }
  if (asset.type === "sgb") {
    const i = asset.inputs
    return { ...d, series: i.series, grams: str(i.grams), sgb_on: i.bought?.on ?? "", sgb_price: str(i.bought?.price) }
  }
  if (asset.type === "fd") {
    const i = asset.inputs
    return { ...d, amount: str(i.amount), rate: str(i.rate), start: i.start, chip: tenureChip(i.tenure), years: str(i.tenure.years), months: str(i.tenure.months), days: str(i.tenure.days), payout: i.payout ?? "none" }
  }
  const i = asset.inputs as PpfInputs | EpfInputs
  return { ...d, balance: str(i.balance), as_of: i.as_of, own_rate: str(i.rate), ...(asset.type === "ppf" ? { opened_year: str(asset.inputs.opened_year), yearly: str(asset.inputs.yearly) } : { monthly: str(asset.inputs.monthly) }) }
}

/** The raw inputs for the API (and the preview). Saved details that the form doesn't show (closed, overrides, stopped) are kept. */
function rawInputs(type: AssetType, d: Draft, prev: AssetRow | undefined): Record<string, unknown> {
  const ownRate = d.own_rate.trim() === "" ? null : num(d.own_rate)
  if (type === "gold" || type === "silver") {
    const paid = d.paid.trim() === "" ? null : num(d.paid)
    return { grams: num(d.grams), purity: type === "silver" ? 999 : Number(d.purity), paid, bought: d.bought || null }
  }
  if (type === "sgb") {
    const redeemed = prev?.type === "sgb" ? prev.inputs.redeemed : null
    const bought = d.sgb_on || d.sgb_price.trim() ? { on: d.sgb_on, price: num(d.sgb_price) } : null
    return { series: d.series, grams: num(d.grams), bought, redeemed }
  }
  if (type === "fd") {
    const chip = TENURE_CHIPS.find((c) => c.id === d.chip)
    const tenure = chip ? chip.tenure : { years: num(d.years || "0"), months: num(d.months || "0"), days: num(d.days || "0") }
    const closed = prev?.type === "fd" ? prev.inputs.closed : null
    return { amount: num(d.amount), rate: num(d.rate), start: d.start, tenure, payout: d.payout === "none" ? null : d.payout, closed }
  }
  if (type === "ppf") {
    const overrides = prev?.type === "ppf" ? prev.inputs.overrides : []
    return { balance: num(d.balance), as_of: d.as_of, opened_year: num(d.opened_year), yearly: num(d.yearly || "0"), overrides, rate: ownRate }
  }
  const stopped = prev?.type === "epf" ? prev.inputs.stopped : null
  return { balance: num(d.balance), as_of: d.as_of, monthly: num(d.monthly || "0"), stopped, rate: ownRate }
}

const GROUP_TYPES: Record<AssetGroup, { id: AssetType; label: string }[]> = {
  fixed: [{ id: "fd", label: "Fixed deposit" }, { id: "ppf", label: "PPF" }, { id: "epf", label: "EPF" }],
  metal: [{ id: "gold", label: "Gold" }, { id: "silver", label: "Silver" }, { id: "sgb", label: "SGB" }],
}

/** A native select in the Input's style (there's no Select component; §13 keeps the existing styles). */
function SeriesSelect({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const today = todayIst()
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}
      className="h-11 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30">
      {[...SGB_SERIES].filter((x) => x.issue <= today).reverse().map((x) => (
        <option key={x.id} value={x.id}>{x.name} · issued {day(x.issue)} at {inr(x.price)}/g</option>
      ))}
    </select>
  )
}

export function AssetForm({ open, asset, member, group = "fixed", members, rates, onClose, onSaved }: {
  open: boolean
  asset?: AssetRow
  member?: string | null
  group?: AssetGroup
  members: PickMember[]
  rates: RateTable
  onClose: () => void
  onSaved: () => void
}) {
  const [type, setType] = useState<AssetType>(asset?.type ?? GROUP_TYPES[group][0]!.id)
  const [who, setWho] = useState<string>(asset ? (asset.member_id ?? "") : (member ?? (members.length === 1 ? members[0].id : "")))
  const [d, setD] = useState<Draft>(() => draftFrom(asset))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof Draft>(k: K) => (v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))
  const raw = rawInputs(type, d, asset)
  const today = todayIst()
  const tableRate = type === "ppf" ? ppfRate(rates, `${today.slice(0, 7)}-01`, null).rate : epfRate(rates, fyOf(today), null).rate

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (members.length > 0 && !who) return setError(helpFor("member"))
    const parsed = parseInputs(type, raw, todayIst())
    if (!parsed.ok) return setError(helpFor(parsed.field))
    const memberId = who || null
    const ok = await save(
      () => (asset ? api.updateAsset(asset.id, { inputs: parsed.inputs, member_id: memberId }) : api.addAsset({ type, inputs: parsed.inputs, member_id: memberId } as Parameters<typeof api.addAsset>[0])),
      asset ? "Saved" : `${TYPE_LABEL[type]} added`,
      setError,
      setBusy,
    )
    if (ok) onSaved()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{asset ? `Edit ${TYPE_LABEL[type]}` : group === "metal" ? "Add gold or silver" : "Add FD, PPF or EPF"}</DialogTitle>
          <DialogDescription>{group === "metal" || isMetalType(type) ? "Only weights and dates, no bills or certificate numbers needed." : "Only amounts and dates, no account details needed."}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          {!asset && (
            <Segmented kind="radio" label="Type" value={type} onChange={(t) => { setType(t); setError(null) }} options={GROUP_TYPES[group]} />
          )}
          {members.length > 1 && (
            <div className="grid gap-2">
              <span className="text-sm font-medium" id="asset-member">Whose is it?</span>
              <Segmented kind="radio" label="Whose is it?" size="sm" value={who} onChange={setWho}
                options={members.map((m) => ({ id: m.id, label: m.name.split(" ")[0] }))} />
            </div>
          )}

          {type === "fd" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field id="fd-amount" label="Amount"><Money id="fd-amount" value={d.amount} onChange={set("amount")} /></Field>
                <Field id="fd-rate" label="Interest rate"><Rate id="fd-rate" value={d.rate} onChange={set("rate")} placeholder="% a year" /></Field>
              </div>
              <div className="grid gap-2">
                <span className="text-sm font-medium">Tenure</span>
                <ToggleGroup type="single" variant="outline" size="sm" spacing={1.5} className="w-full flex-wrap" aria-label="Tenure"
                  value={d.chip} onValueChange={(v) => v && set("chip")(v)}>
                  {[...TENURE_CHIPS, { id: "custom", label: "Custom" }].map((c) => (
                    <ToggleGroupItem key={c.id} value={c.id} className="h-9 px-3">{c.label}</ToggleGroupItem>
                  ))}
                </ToggleGroup>
                {d.chip === "custom" && (
                  <div className="grid grid-cols-3 gap-3">
                    <Field id="fd-years" label="Years"><Input id="fd-years" inputMode="numeric" value={d.years} onChange={(e) => set("years")(e.target.value)} className="h-11" /></Field>
                    <Field id="fd-months" label="Months"><Input id="fd-months" inputMode="numeric" value={d.months} onChange={(e) => set("months")(e.target.value)} className="h-11" /></Field>
                    <Field id="fd-days" label="Days"><Input id="fd-days" inputMode="numeric" value={d.days} onChange={(e) => set("days")(e.target.value)} className="h-11" /></Field>
                  </div>
                )}
              </div>
              <Field id="fd-start" label="Start date"><DateInput id="fd-start" value={d.start} onChange={set("start")} /></Field>
              <More>
                <div className="grid gap-2">
                  <span className="text-sm font-medium">Interest</span>
                  <Segmented kind="radio" label="Interest" size="sm" value={d.payout} onChange={set("payout")}
                    options={[{ id: "none", label: "Added to the FD" }, { id: "monthly", label: "Paid monthly" }, { id: "quarterly", label: "Paid quarterly" }]} />
                </div>
              </More>
            </>
          )}

          {(type === "gold" || type === "silver") && (
            <>
              <Field id="m-grams" label="Weight" hint={type === "gold" ? "Coins, bars and jewellery: the gold's weight, without stones." : undefined}>
                <Input id="m-grams" inputMode="decimal" autoComplete="off" placeholder="grams" value={d.grams} onChange={(e) => set("grams")(e.target.value)} className="h-11" />
              </Field>
              {type === "gold" && (
                <div className="grid gap-2">
                  <span className="text-sm font-medium">Purity</span>
                  <ToggleGroup type="single" variant="outline" size="sm" spacing={1.5} className="w-full flex-wrap" aria-label="Purity"
                    value={d.purity} onValueChange={(v) => v && set("purity")(v)}>
                    {GOLD_PURITIES.map((p) => (
                      <ToggleGroupItem key={p.purity} value={String(p.purity)} className="h-9 px-3">{p.karat} ({p.purity})</ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
              )}
              <More>
                <div className="grid grid-cols-2 gap-3">
                  <Field id="m-paid" label="What you paid"><Money id="m-paid" value={d.paid} onChange={set("paid")} placeholder="₹ in all" /></Field>
                  <Field id="m-bought" label="Bought on"><DateInput id="m-bought" value={d.bought} onChange={set("bought")} /></Field>
                </div>
                <p className="-mt-2 text-[13px] text-muted-foreground">Optional. With both, you see the gain; without, just the value.</p>
              </More>
            </>
          )}

          {type === "sgb" && (
            <>
              <Field id="sgb-series" label="Series"><SeriesSelect id="sgb-series" value={d.series} onChange={set("series")} /></Field>
              <Field id="sgb-grams" label="Units" hint="1 unit is 1 gram. SGBs in your demat account come in with your CDSL statement; add only those held elsewhere.">
                <Input id="sgb-grams" inputMode="numeric" autoComplete="off" placeholder="grams" value={d.grams} onChange={(e) => set("grams")(e.target.value)} className="h-11" />
              </Field>
              <More>
                <p className="text-[13px] text-muted-foreground">Bought later on the exchange? The date and the price per gram you paid.</p>
                <div className="grid grid-cols-2 gap-3">
                  <Field id="sgb-on" label="Bought on"><DateInput id="sgb-on" value={d.sgb_on} onChange={set("sgb_on")} min={sgbSeries(d.series)?.issue} /></Field>
                  <Field id="sgb-price" label="Price per gram"><Money id="sgb-price" value={d.sgb_price} onChange={set("sgb_price")} /></Field>
                </div>
              </More>
            </>
          )}

          {(type === "ppf" || type === "epf") && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field id="pf-balance" label="Current balance"><Money id="pf-balance" value={d.balance} onChange={set("balance")} /></Field>
                <Field id="pf-asof" label="Balance as on"><DateInput id="pf-asof" value={d.as_of} onChange={set("as_of")} /></Field>
              </div>
              {type === "ppf" ? (
                <div className="grid grid-cols-2 gap-3">
                  <Field id="ppf-opened" label="Year opened">
                    <Input id="ppf-opened" inputMode="numeric" placeholder="e.g. 2018" value={d.opened_year} onChange={(e) => set("opened_year")(e.target.value)} className="h-11" />
                  </Field>
                  <Field id="ppf-yearly" label="Yearly deposit"><Money id="ppf-yearly" value={d.yearly} onChange={set("yearly")} /></Field>
                </div>
              ) : (
                <Field id="epf-monthly" label="Monthly PF contribution" hint="Yours plus your employer's. On your payslip or EPFO passbook.">
                  <Money id="epf-monthly" value={d.monthly} onChange={set("monthly")} />
                </Field>
              )}
              <More>
                <Field id="pf-rate" label="Your own rate" hint={`Leave empty for the government rate (${tableRate}% now).`}>
                  <Rate id="pf-rate" value={d.own_rate} onChange={set("own_rate")} placeholder={`${tableRate}%`} />
                </Field>
              </More>
            </>
          )}

          <Preview type={type} raw={raw} rates={rates} />
          {error && <p className="text-sm text-loss" role="alert">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="h-11" disabled={busy}>
              {busy && <Loader2Icon className="animate-spin" />}
              {asset ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Actions on a saved asset ───────────────────────────────────────────────────────────────────────────────────

function ActionDialog({ open, title, description, error, busy, confirm, destructive, onClose, onConfirm, children }: {
  open: boolean
  title: string
  description: React.ReactNode
  error: string | null
  busy: boolean
  confirm: string
  destructive?: boolean
  onClose: () => void
  onConfirm: () => void
  children?: React.ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" noValidate onSubmit={(e) => { e.preventDefault(); onConfirm() }}>
          {children}
          {error && <p className="text-sm text-loss" role="alert">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant={destructive ? "destructive" : "default"} className="h-11" disabled={busy}>
              {busy && <Loader2Icon className="animate-spin" />}
              {confirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function useAction(asset: AssetRow | undefined, onSaved: () => void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const patch = async (inputs: AssetInputs | Record<string, unknown>, done: string) => {
    if (!asset) return
    const parsed = parseInputs(asset.type, inputs, todayIst())
    if (!parsed.ok) return setError(helpFor(parsed.field))
    if (await save(() => api.updateAsset(asset.id, { inputs: parsed.inputs }), done, setError, setBusy)) onSaved()
  }
  return { busy, error, setError, setBusy, patch }
}

/** FD → Closed early? (date, default today; penalty 1%, editable). */
function CloseDialog({ asset, onClose, onSaved }: { asset?: AssetRow; onClose: () => void; onSaved: () => void }) {
  const fd = asset?.type === "fd" ? asset.inputs : null
  const [on, setOn] = useState(fd?.closed?.on ?? todayIst())
  const [penalty, setPenalty] = useState(str(fd?.closed?.penalty ?? DEFAULT_PENALTY))
  const a = useAction(asset, onSaved)
  return (
    <ActionDialog open={!!fd} title="Closed this FD early?" busy={a.busy} error={a.error} confirm="Save" onClose={onClose}
      description="Banks pay a lower rate when an FD is closed before maturity. We take the penalty off the rate for the time it was held."
      onConfirm={() => fd && a.patch({ ...fd, closed: { on, penalty: num(penalty) } }, "Marked as closed")}>
      <div className="grid grid-cols-2 gap-3">
        <Field id="close-on" label="Closed on"><DateInput id="close-on" value={on} onChange={setOn} min={fd?.start} /></Field>
        <Field id="close-penalty" label="Penalty"><Rate id="close-penalty" value={penalty} onChange={setPenalty} /></Field>
      </div>
    </ActionDialog>
  )
}

/** EPF → Contributions stopped (changed job, retired). */
function StopDialog({ asset, onClose, onSaved }: { asset?: AssetRow; onClose: () => void; onSaved: () => void }) {
  const epf = asset?.type === "epf" ? asset.inputs : null
  const [on, setOn] = useState(epf?.stopped ?? todayIst())
  const a = useAction(asset, onSaved)
  return (
    <ActionDialog open={!!epf} title="Contributions stopped?" busy={a.busy} error={a.error} confirm="Save" onClose={onClose}
      description="Changed job or retired? The balance keeps earning interest; no new contributions are added from this month."
      onConfirm={() => epf && a.patch({ ...epf, stopped: on } satisfies EpfInputs, "Contributions stopped")}>
      <Field id="stop-on" label="Stopped on"><DateInput id="stop-on" value={on} onChange={setOn} /></Field>
    </ActionDialog>
  )
}

/** SGB → Redeemed early? (from the 5th year after issue, on an interest date; the RBI pays the gold price then). */
function RedeemDialog({ asset, onClose, onSaved }: { asset?: AssetRow; onClose: () => void; onSaved: () => void }) {
  const sgb = asset?.type === "sgb" ? asset.inputs : null
  const s = sgb ? sgbSeries(sgb.series) : undefined
  const earliest = s ? sgbEarliestRedemption(s.issue) : undefined
  const [on, setOn] = useState(sgb?.redeemed ?? todayIst())
  const a = useAction(asset, onSaved)
  return (
    <ActionDialog open={!!sgb} title="Redeemed this SGB early?" busy={a.busy} error={a.error} confirm="Save" onClose={onClose}
      description={<>RBI buys SGBs back from the 5th year{earliest ? ` (for this series, from ${day(earliest)})` : ""}, on an interest date, at that week's gold price. The value stops on that date.</>}
      onConfirm={() => sgb && a.patch({ ...sgb, redeemed: on } satisfies SgbInputs, "Marked as redeemed")}>
      <Field id="redeem-on" label="Redeemed on"><DateInput id="redeem-on" value={on} onChange={setOn} min={earliest} /></Field>
      {s && <p className="text-[13px] text-muted-foreground">It matures on {day(sgbMaturity(s.issue))} anyway.</p>}
    </ActionDialog>
  )
}

/** PPF → Adjust a year: change or skip one financial year's deposit. */
function AdjustDialog({ asset, onClose, onSaved }: { asset?: AssetRow; onClose: () => void; onSaved: () => void }) {
  const ppf = asset?.type === "ppf" ? asset.inputs : null
  const [fy, setFy] = useState(String(fyOf(todayIst())))
  const [amount, setAmount] = useState("")
  const a = useAction(asset, onSaved)
  const fyNum = num(fy)
  const valid = Number.isInteger(fyNum) && fyNum >= 1968 && fyNum <= 2100
  const remove = (y: number) => ppf && a.patch({ ...ppf, overrides: ppf.overrides.filter((o) => o.fy !== y) } satisfies PpfInputs, `FY ${fyLabel(y)} back to the usual deposit`)
  return (
    <ActionDialog open={!!ppf} title="Adjust a year's deposit" busy={a.busy} error={a.error} confirm="Save" onClose={onClose}
      description={<>Deposited more or less than {ppf ? inr(ppf.yearly) : "usual"} in one year, or skipped it? Enter 0 to skip.</>}
      onConfirm={() => {
        if (!ppf) return
        if (!valid) return a.setError(helpFor("overrides"))
        a.patch({ ...ppf, overrides: [...ppf.overrides.filter((o) => o.fy !== fyNum), { fy: fyNum, amount: num(amount) }] }, `FY ${fyLabel(fyNum)} adjusted`)
      }}>
      <div className="grid grid-cols-2 gap-3">
        <Field id="adj-fy" label="Financial year" hint={valid ? `FY ${fyLabel(fyNum)}` : "The year it starts, e.g. 2026"}>
          <Input id="adj-fy" inputMode="numeric" value={fy} onChange={(e) => setFy(e.target.value)} className="h-11" />
        </Field>
        <Field id="adj-amount" label="Deposit that year"><Money id="adj-amount" value={amount} onChange={setAmount} /></Field>
      </div>
      {ppf && ppf.overrides.length > 0 && (
        <ul className="divide-y divide-border text-sm" aria-label="Adjusted years">
          {ppf.overrides.map((o) => (
            <li key={o.fy} className="flex items-center justify-between gap-3 py-0.5">
              <span>FY {fyLabel(o.fy)}</span>
              <span className="flex items-center gap-1 tabular-nums text-muted-foreground">
                {o.amount ? inr(o.amount) : "Skipped"}
                <Button type="button" variant="ghost" size="icon" className="-mr-2 size-11" aria-label={`Undo the change to FY ${fyLabel(o.fy)}`} disabled={a.busy}
                  onClick={() => remove(o.fy)}>
                  <XIcon />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </ActionDialog>
  )
}

function DeleteDialog({ asset, onClose, onSaved }: { asset?: AssetRow; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <ActionDialog open={!!asset} title={`Delete ${asset?.name ?? ""}?`} busy={busy} error={error} confirm="Delete" destructive onClose={onClose}
      description="It's removed from PocketFolio only. This can't be undone."
      onConfirm={async () => asset && (await save(() => api.deleteAsset(asset.id), "Deleted", setError, setBusy)) && onSaved()} />
  )
}

/** Every asset dialog, driven by one state value. Each opens fresh (keyed), so nothing typed lingers. */
export function AssetDialogs({ state, members, rates, onClose, onSaved, onState }: {
  state: AssetDialogState
  members: PickMember[]
  rates: RateTable
  onClose: () => void
  onSaved: () => void
  /** Move from one dialog to another (details → edit). */
  onState: (s: AssetDialogState) => void
}) {
  const done = () => { onClose(); onSaved() }
  const asset = state && state.kind !== "add" ? state.asset : undefined
  const key = `${state?.kind}-${asset?.id ?? (state?.kind === "add" ? `${state.member}-${state.group}` : "")}`
  return (
    <>
      <AssetForm key={`f-${key}`} open={state?.kind === "add" || state?.kind === "edit"} asset={state?.kind === "edit" ? asset : undefined}
        member={state?.kind === "add" ? state.member : undefined} group={state?.kind === "add" ? state.group : asset && isMetalType(asset.type) ? "metal" : "fixed"}
        members={members} rates={rates} onClose={onClose} onSaved={done} />
      <RedeemDialog key={`r-${key}`} asset={state?.kind === "redeem" ? asset : undefined} onClose={onClose} onSaved={done} />
      <CloseDialog key={`c-${key}`} asset={state?.kind === "close" ? asset : undefined} onClose={onClose} onSaved={done} />
      <StopDialog key={`s-${key}`} asset={state?.kind === "stop" ? asset : undefined} onClose={onClose} onSaved={done} />
      <AdjustDialog key={`a-${key}`} asset={state?.kind === "adjust" ? asset : undefined} onClose={onClose} onSaved={done} />
      <AssetDetails key={`i-${key}`} asset={state?.kind === "details" ? asset : undefined} rates={rates} onClose={onClose} onEdit={(a) => onState({ kind: "edit", asset: a })} />
      <DeleteDialog key={`d-${key}`} asset={state?.kind === "delete" ? asset : undefined} onClose={onClose} onSaved={done} />
    </>
  )
}
