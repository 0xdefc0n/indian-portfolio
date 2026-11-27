// Broker tradebook upload (plan §21.6, M21): buy prices for shares and ETFs, so they get gains, XIRR and tax like
// funds. The member is picked here (tradebooks rarely carry a PAN). The file is read once and never kept; only the
// trades are stored, encrypted. Same form pieces as the statement upload (§13).
import { FileUpIcon, Loader2Icon, Trash2Icon } from "lucide-react"
import { type FormEvent, useEffect, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { ApiFailure, api, type MemberSummary, SignedOut, type Tradebook, waitForPortfolio } from "@/lib/api"
import { day } from "@/lib/format"

/** Where each broker's file is (plan §21.6 "Brokers"). */
const WHERE: [string, string][] = [
  ["Zerodha", "Console → Reports → Tradebook (Equity), CSV or XLSX. Up to a year per file: add one per year."],
  ["Groww", "Profile → Reports → Transactions → Stocks order history (Excel)."],
  ["Angel One", "Account → Trades and charges → Download trade history."],
  ["Upstox", "Reports → Trade report (Excel)."],
  ["ICICI Direct", "Trade & Invest → Equity → Trade book (CSV or Excel)."],
  ["Paytm Money", "Statements → Tradebook (Excel)."],
  ["Dhan", "Journal → Global transactions (CSV)."],
]

/** The statement messages, worded for a tradebook. */
const TRADEBOOK_MESSAGES: Record<string, string> = {
  pan_mismatch: "This tradebook belongs to a different PAN than the member you picked.",
  already_added: "This tradebook has already been added.",
  file_too_large: "That file is over 5 MB. Download a shorter date range.",
  parse_error: "We couldn't read this tradebook. Download it again as CSV or Excel.",
}

const shortName = (m: MemberSummary) => m.name ?? m.pan_masked

export function TradebookForm({ onDone }: { onDone: () => void }) {
  const [members, setMembers] = useState<MemberSummary[] | null>(null)
  const [books, setBooks] = useState<Tradebook[]>([])
  const [member, setMember] = useState<string>("")
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState<"reading" | "updating" | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const refresh = () =>
    Promise.all([api.members(), api.tradebooks()]).then(([m, t]) => {
      setMembers(m)
      setBooks(t.tradebooks)
      setMember((cur) => cur || (m.length === 1 ? m[0]!.id : ""))
    }, (e) => { if (!(e instanceof SignedOut)) setProblem((e as Error).message) })
  useEffect(() => {
    void refresh()
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!file || !member) return
    setBusy("reading")
    setProblem(null)
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          const { tradebook } = await api.addTradebook(file, member)
          setBusy("updating")
          await waitForPortfolio({ maxMs: 60_000 }).catch(() => null)
          toast.success("Tradebook added", { description: `${tradebook.trades_count} ${tradebook.trades_count === 1 ? "trade" : "trades"} from ${tradebook.broker_name}` })
          setFile(null)
          onDone()
          return
        } catch (err) {
          // Busy reading other files: the server says when to try again; do it for the user, a few times.
          const wait = err instanceof ApiFailure && err.code === "engine_busy" ? Number(err.data.retry_after) || 10 : 0
          if (!wait || attempt >= 3) throw err
          await new Promise((r) => setTimeout(r, wait * 1000))
        }
      }
    } catch (err) {
      if (err instanceof SignedOut) return
      setProblem(err instanceof ApiFailure && err.code && TRADEBOOK_MESSAGES[err.code] ? TRADEBOOK_MESSAGES[err.code]! : (err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function remove(id: string) {
    try {
      await api.deleteTradebook(id)
      toast.success("Tradebook removed", { description: "Updating your dashboard…" })
      await refresh()
      onDone()
    } catch (err) {
      if (!(err instanceof SignedOut)) toast.error((err as Error).message)
    }
  }

  if (members && !members.length) {
    return <p className="text-sm text-muted-foreground">Add a CDSL statement first. A tradebook adds buy prices to the shares it shows.</p>
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Your CDSL statement shows which shares you hold, but not what you paid. A broker tradebook adds the buy prices, so
        shares get gains, XIRR and tax like funds.
      </p>
      {members && members.length > 1 && (
        <div className="grid gap-2">
          <Label htmlFor="tb-member">Whose tradebook</Label>
          <select id="tb-member" value={member} onChange={(e) => setMember(e.target.value)} required
            className="h-11 rounded-md border bg-transparent px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring">
            <option value="" disabled>Choose a member</option>
            {members.map((m) => <option key={m.id} value={m.id}>{shortName(m)}</option>)}
          </select>
        </div>
      )}
      <div className="grid gap-2">
        <Label htmlFor="tb-file">Tradebook (CSV or Excel)</Label>
        <label htmlFor="tb-file"
          className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-dashed px-4 py-4 text-sm transition-colors hover:bg-muted/60 focus-within:outline-2 focus-within:outline-ring">
          <FileUpIcon className="size-5 shrink-0 text-muted-foreground" />
          <span className={file ? "min-w-0 truncate font-medium" : "text-muted-foreground"}>{file ? file.name : "Choose a file"}</span>
          <input id="tb-file" type="file" required className="sr-only"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setProblem(null) }} />
        </label>
        <details className="text-xs text-muted-foreground">
          <summary className="-my-2 cursor-pointer py-2 text-primary">Where to download it</summary>
          <ul className="mt-1 grid gap-1.5">
            {WHERE.map(([b, w]) => <li key={b}><span className="font-medium text-foreground">{b}:</span> {w}</li>)}
          </ul>
        </details>
        <p className="text-xs text-muted-foreground">Read once and never kept: only the trades are saved, encrypted.</p>
      </div>
      {problem && <p className="text-sm text-loss" role="alert">{problem}</p>}
      <Button type="submit" className="h-11" disabled={!file || !member || !!busy}>
        {busy && <Loader2Icon className="animate-spin" />}
        {busy === "reading" ? "Reading tradebook…" : busy === "updating" ? "Updating dashboard…" : "Add tradebook"}
      </Button>
      {books.length > 0 && (
        <div className="grid gap-2 border-t pt-4">
          <h3 className="text-sm font-semibold">Added</h3>
          <ul className="divide-y text-sm">
            {books.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="font-medium">{b.broker_name}{members && members.length > 1 ? ` · ${shortName(members.find((m) => m.id === b.member_id) ?? members[0]!)}` : ""}</div>
                  <div className="text-xs text-muted-foreground">{b.trades_count} {b.trades_count === 1 ? "trade" : "trades"}{b.period_from ? `, ${day(b.period_from)} to ${day(b.period_to)}` : ""}</div>
                </div>
                <Button type="button" variant="ghost" size="icon" className="size-11 shrink-0" aria-label={`Remove the ${b.broker_name} tradebook`} onClick={() => remove(b.id)}>
                  <Trash2Icon />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </form>
  )
}
