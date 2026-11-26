// Skip the next instalment, or cancel a SIP (M12, owner request 2026-11-26). Brokers let you skip one instalment or
// cancel for good; PocketFolio can't do either for you, so these record what the user did with their broker or fund
// house, and the estimates follow. Same Dialog / Button / DropdownMenu as Members (§13).
import { Loader2Icon, MoreHorizontalIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { api, type Sip, type SipRef, SignedOut } from "@/lib/api"
import { day, inr, per } from "@/lib/format"
import { nextRun, upcomingSkip } from "@/lib/sips"

const short = (iso: string) => day(iso).split(" ").slice(0, 2).join(" ")
const refOf = (s: Sip): SipRef => ({ member_id: s.member_id, isin: s.isin, folio: s.folio })

export function SipActions({ sip, onChanged }: { sip: Sip; onChanged: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  if (sip.status !== "active") return null
  const skipped = upcomingSkip(sip)
  const next = nextRun(sip)

  async function run(work: () => Promise<unknown>, done: string) {
    setBusy(true)
    try {
      await work()
      toast.success(done, { description: "Updating your dashboard…" })
      onChanged()
    } catch (err) {
      if (!(err instanceof SignedOut)) toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="-my-2 size-11" aria-label={`Change ${sip.name} SIP`} disabled={busy}>
            {busy ? <Loader2Icon className="animate-spin" /> : <MoreHorizontalIcon />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Changed it with your broker? Tell PocketFolio.</DropdownMenuLabel>
          {skipped ? (
            <DropdownMenuItem onSelect={() => run(() => api.undoSkipSip(refOf(sip)), `The ${short(skipped)} instalment is back`)}>
              Undo skip of {short(skipped)}
            </DropdownMenuItem>
          ) : (
            next && (
              <DropdownMenuItem onSelect={() => run(() => api.skipSip(refOf(sip), next.due), `Skipped the ${short(next.due)} instalment`)}>
                Skip next instalment ({short(next.due)})
              </DropdownMenuItem>
            )
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}>
            Cancel SIP…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CancelSipDialog
        sip={confirming ? sip : null}
        onClose={() => setConfirming(false)}
        onDone={() => {
          setConfirming(false)
          onChanged()
        }}
      />
    </>
  )
}

function CancelSipDialog({ sip, onClose, onDone }: { sip: Sip | null; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    if (!sip) return
    setBusy(true)
    setError(null)
    try {
      await api.cancelSip(refOf(sip))
      toast.success("SIP cancelled", { description: "Updating your dashboard…" })
      onDone()
    } catch (err) {
      if (!(err instanceof SignedOut)) setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={sip != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel this SIP for good?</DialogTitle>
          <DialogDescription>
            {sip && (
              <>
                PocketFolio will stop counting the {inr(sip.amount)}{per(sip.frequency)} instalments in {sip.name} from today. This
                can't be undone.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          This doesn't cancel the SIP with your broker or fund house. Cancel it there too, or the money will keep going out.
          If a newer statement shows more instalments, PocketFolio goes by the statement.
        </p>
        {error && <p className="text-sm text-loss" role="alert">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" className="h-11" onClick={onClose}>Keep SIP</Button>
          <Button type="button" variant="destructive" className="h-11" disabled={busy} onClick={confirm}>
            {busy && <Loader2Icon className="animate-spin" />}
            Cancel SIP
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
