// The "Fixed income" list (plan §21.12, M19): each FD, PPF and EPF with its generated name, member, approximate value,
// gain and the rate used. Gold, silver and SGBs (§21.5, M29) use the same list, with the rate per gram. Used on the
// dashboard and, per member, on Members. Same row, badge and menu patterns as the holdings and SIP lists (§13).
import { fyLabel, fyOf, isMetalType, sgbSeries, todayIst } from "@manual-assets"
import { Loader2Icon, MoreHorizontalIcon, PlusIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import type { AssetDialogState } from "@/components/asset-dialogs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { api, SignedOut } from "@/lib/api"
import { type AssetRow, perGram } from "@/lib/assets"
import { day, inr, signed } from "@/lib/format"
import { cn } from "@/lib/utils"

const STATUS: Partial<Record<AssetRow["v"]["status"], string>> = {
  matured: "Matured",
  closed: "Closed early",
  stopped: "Contributions stopped",
  extended: "Past 15 years",
  redeemed: "Redeemed early",
}

function metalDetail(r: AssetRow): string {
  const parts = [perGram(r)]
  if (r.type === "sgb") {
    const s = sgbSeries(r.inputs.series)
    if (r.v.status === "active" && r.v.maturity) parts.push(`matures ${day(r.v.maturity)}`)
    if (s) parts.push(`${s.coupon}% interest`)
    if (r.v.received > 0) parts.push(`${inr(r.v.received)} interest paid out`)
  } else if (r.v.cost_unknown) {
    parts.push("add what you paid or when you bought it to see the gain")
  } else if (r.v.cost === "estimated" && (r.type === "gold" || r.type === "silver") && r.inputs.bought) {
    parts.push(`cost estimated from ${day(r.inputs.bought)}'s rate`)
  }
  return parts.join(" · ")
}

function detail(r: AssetRow): string {
  if (isMetalType(r.type)) return metalDetail(r)
  const parts = [`${r.v.rate}%`]
  if (r.type === "fd") {
    if (r.v.status === "active") parts.push(`matures ${day(r.v.maturity)}`)
    if (r.v.status === "closed" && r.inputs.closed) parts.push(`closed ${day(r.inputs.closed.on)}`)
    if (r.v.received > 0) parts.push(`${inr(r.v.received)} interest paid out`)
  } else if (r.v.uncredited >= 1) {
    parts.push(`includes ${inr(r.v.uncredited)} interest not yet credited`)
  }
  return parts.join(" · ")
}

function RowMenu({ row, onAction, onChanged }: { row: AssetRow; onAction: (s: AssetDialogState) => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  async function undo(inputs: AssetRow["inputs"], done: string) {
    setBusy(true)
    try {
      await api.updateAsset(row.id, { inputs })
      toast.success(done)
      onChanged()
    } catch (err) {
      if (!(err instanceof SignedOut)) toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const act = (kind: "details" | "edit" | "close" | "stop" | "adjust" | "redeem" | "delete") => () => onAction({ kind, asset: row })
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="-my-2 -mr-2 size-11" aria-label={`Change ${row.name}`} disabled={busy}>
          {busy ? <Loader2Icon className="animate-spin" /> : <MoreHorizontalIcon />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={act("details")}>{isMetalType(row.type) ? "Details and history" : "Details and projection"}</DropdownMenuItem>
        <DropdownMenuItem onSelect={act("edit")}>Edit</DropdownMenuItem>
        {row.type === "fd" &&
          (row.inputs.closed ? (
            <DropdownMenuItem onSelect={() => row.type === "fd" && undo({ ...row.inputs, closed: null }, "No longer marked as closed")}>Not closed after all</DropdownMenuItem>
          ) : (
            row.v.status === "active" && <DropdownMenuItem onSelect={act("close")}>Closed early?</DropdownMenuItem>
          ))}
        {row.type === "ppf" && <DropdownMenuItem onSelect={act("adjust")}>Adjust a year</DropdownMenuItem>}
        {row.type === "epf" &&
          (row.inputs.stopped ? (
            <DropdownMenuItem onSelect={() => row.type === "epf" && undo({ ...row.inputs, stopped: null }, "Contributions back on")}>Contributions restarted</DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={act("stop")}>Contributions stopped</DropdownMenuItem>
          ))}
        {row.type === "sgb" &&
          (row.inputs.redeemed ? (
            <DropdownMenuItem onSelect={() => row.type === "sgb" && undo({ ...row.inputs, redeemed: null }, "No longer marked as redeemed")}>Not redeemed after all</DropdownMenuItem>
          ) : (
            row.v.status === "active" && <DropdownMenuItem onSelect={act("redeem")}>Redeemed early?</DropdownMenuItem>
          ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={act("delete")}>Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function FixedIncomeList({ rows, memberName, onAction, onChanged, compact }: {
  rows: AssetRow[]
  /** The member's first name, when the list mixes members. */
  memberName?: (id: string | null) => string | undefined
  onAction: (s: AssetDialogState) => void
  onChanged: () => void
  compact?: boolean
}) {
  return (
    <ul className="divide-y divide-border">
      {rows.map((r) => {
        const status = STATUS[r.v.status]
        const who = memberName?.(r.member_id)
        const overLimit = r.v.warnings.includes("ppf_over_limit")
        return (
          <li key={r.id} className={cn("grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3", compact ? "py-1.5" : "py-3")}>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onAction({ kind: "details", asset: r })}
                  className="-my-1.5 truncate rounded-sm py-1.5 text-left text-[14px] font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {r.name}
                </button>
                <Badge variant="secondary">Approximate</Badge>
                {status && <Badge variant="outline">{status}</Badge>}
                {r.v.provisional && <Badge variant="outline">Provisional rate</Badge>}
                {r.v.warnings.includes("stale_rate") && <Badge variant="outline">Older rate</Badge>}
              </div>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                {who && <>{who} · </>}
                {detail(r)}
              </p>
              {overLimit && <p className="mt-0.5 text-[13px] text-loss">A year's deposit is over the ₹1.5 lakh PPF limit.</p>}
            </div>
            <div className="text-right">
              <div className="text-[14px] font-semibold tabular-nums">{inr(r.v.value)}</div>
              {r.v.cost_unknown ? (
                <div className="text-[13px] text-muted-foreground">Gain unknown</div>
              ) : (
                <div className={cn("text-[13px] tabular-nums", r.v.gain >= 0 ? "text-gain" : "text-loss")}>{signed(r.v.gain, inr)}</div>
              )}
            </div>
            <RowMenu row={r} onAction={onAction} onChanged={onChanged} />
          </li>
        )
      })}
    </ul>
  )
}

/** The dashboard panel's body: the list, or a single line to add the first one. */
export function FixedIncome({ rows, memberName, failed, onAction, onChanged }: {
  rows: AssetRow[]
  memberName?: (id: string | null) => string | undefined
  failed: boolean
  onAction: (s: AssetDialogState) => void
  onChanged: () => void
}) {
  if (failed && !rows.length) return <p className="text-sm text-muted-foreground">Couldn't load your FDs, PPF and EPF. Reload to try again.</p>
  if (!rows.length) {
    return (
      <p className="text-sm text-muted-foreground">
        Track fixed deposits, PPF and EPF next to your funds.{" "}
        <button className="-my-2 py-2 text-primary underline-offset-4 hover:underline" onClick={() => onAction({ kind: "add", group: "fixed" })}>Add FD, PPF or EPF</button>
      </p>
    )
  }
  const fy = fyOf(todayIst())
  return (
    <div>
      <FixedIncomeList rows={rows} memberName={memberName} onAction={onAction} onChanged={onChanged} />
      <p className="mt-3 border-t pt-3 text-[12.5px] text-muted-foreground">
        Approximate values worked out from what you entered, before tax (no TDS or 80C). PPF and EPF use the government rates
        unless you set your own; FY {fyLabel(fy)} interest is credited on 31 March.
      </p>
    </div>
  )
}

/** The dashboard's Gold & silver panel body (M29): the list, or a single line to add the first one. */
export function GoldSilver({ rows, memberName, failed, onAction, onChanged }: {
  rows: AssetRow[]
  memberName?: (id: string | null) => string | undefined
  failed: boolean
  onAction: (s: AssetDialogState) => void
  onChanged: () => void
}) {
  if (failed && !rows.length) return <p className="text-sm text-muted-foreground">Couldn't load your gold and silver. Reload to try again.</p>
  if (!rows.length) {
    return (
      <p className="text-sm text-muted-foreground">
        Track gold and silver you hold and Sovereign Gold Bonds outside demat, valued every day.{" "}
        <button className="-my-2 py-2 text-primary underline-offset-4 hover:underline" onClick={() => onAction({ kind: "add", group: "metal" })}>Add gold or silver</button>
      </p>
    )
  }
  return (
    <div>
      <FixedIncomeList rows={rows} memberName={memberName} onAction={onAction} onChanged={onChanged} />
      <MetalsFootnote />
    </div>
  )
}

export function MetalsFootnote() {
  return (
    <p className="mt-3 border-t pt-3 text-[12.5px] text-muted-foreground">
      Approximate values at the day's bullion rate, before GST and making charges: about what a sale would fetch. The rate is
      worked out from gold and silver ETF prices. SGB interest is paid every six months.
    </p>
  )
}

export function AddAssetButton({ onClick, label = "Add" }: { onClick: () => void; label?: string }) {
  return (
    <Button variant="outline" size="sm" className="h-9" onClick={onClick}>
      <PlusIcon />
      {label}
    </Button>
  )
}
