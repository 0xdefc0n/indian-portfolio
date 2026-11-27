// The statement upload (plan §13 item 5): a CDSL or CAMS / KFintech PDF and an optional password. Shown inside the
// Add asset dialog (add-asset-dialog.tsx) for mutual funds and for stocks & ETFs. For stocks a switch picks a CDSL
// statement or a broker file (M34, plan §21.13: a holdings statement or tradebook, CSV or Excel), each with its own
// guide so the two aren't confused; the server reads either whichever is picked. Broker files carry no PAN, so when the server
// can't tell whose it is, the form asks ("Whose is this?") and sends the file again with the answer. After a
// statement makes a new member, a member made earlier from a broker file with the same name is offered as the same
// person (SamePerson).
import { CheckIcon, ChevronDownIcon, FileUpIcon, Loader2Icon } from "lucide-react"
import { type FormEvent, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Segmented } from "@/components/ui/segmented"
import { QueuedUpload } from "@/components/jobs"
import {
  type AddedBrokerFile, type AddedStatement, ApiFailure, api, type BrokerOwner, type MemberSummary, type QueuedUpload as Queued, SignedOut,
  waitForPortfolio,
} from "@/lib/api"
import { day } from "@/lib/format"
import { cn } from "@/lib/utils"

const PASSWORD_HINT =
  "For a CDSL eCAS this is usually the PAN in capital letters. For CAMS/KFintech it's the password you chose when requesting it."

const BROKER_ACCEPT = ".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
const isPdfFile = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name)

type Added = AddedStatement | AddedBrokerFile

/** Say whose portfolio it went to (plan §13 item 5). */
function report(added: Added) {
  const { member } = added
  const name = member.name ?? member.pan_masked
  const who = member.created ? `New member added: ${name}${member.pan_masked ? ` (${member.pan_masked})` : ""}` : `Added to ${name}`
  if (!("kind" in added)) return toast.success("Statement added", { description: who })
  if (added.kind === "TRADEBOOK") {
    const n = added.tradebook.trades_count
    return toast.success("Tradebook added", { description: `${n} ${n === 1 ? "trade" : "trades"} from ${added.tradebook.broker_name}. ${who}` })
  }
  const n = added.holdings.holdings_count
  toast.success(added.replaced ? "Holdings statement updated" : "Holdings statement added", {
    description: `${n} ${n === 1 ? "share" : "shares"} from ${added.holdings.broker_name}, as on ${day(added.holdings.as_of)}. ${who}`,
  })
}

/** Where each broker's holdings statement is (plan §21.13). */
const HOLDINGS_WHERE: [string, string][] = [
  ["Groww", "Profile → Reports → Holdings statement (stocks), Excel."],
  ["Zerodha", "Console → Portfolio → Holdings → Download (XLSX)."],
  ["Dhan", "Statements → Holding summary (Excel or CSV). It has no buy prices: add them on each share."],
]

/** Where each broker's tradebook is (plan §21.6 "Brokers"). */
const TRADEBOOK_WHERE: [string, string][] = [
  ["Zerodha", "Console → Reports → Tradebook (Equity), CSV or XLSX. Up to a year per file: add one per year."],
  ["Groww", "Profile → Reports → Transactions → Stocks order history (Excel)."],
  ["Angel One", "Account → Trades and charges → Download trade history."],
  ["Upstox", "Reports → Trade report (Excel)."],
  ["ICICI Direct", "Trade & Invest → Equity → Trade book (CSV or Excel)."],
  ["Paytm Money", "Statements → Tradebook (Excel)."],
  ["Dhan", "Journal → Global transactions (CSV)."],
]

/** "Where to download it", per broker. */
function Where({ title, list }: { title: string; list: [string, string][] }) {
  return (
    <details className="text-xs text-muted-foreground">
      <summary className="flex min-h-11 cursor-pointer items-center text-primary">{title}</summary>
      <ul className="mt-1 grid gap-1.5">
        {list.map(([b, w]) => <li key={b}><span className="font-medium text-foreground">{b}:</span> {w}</li>)}
      </ul>
    </details>
  )
}

const LINK = "-my-2 py-2 text-primary underline-offset-4 hover:underline"

type Problem = { message: string; hint?: string }
type Phase = "uploading" | "reading" | "updating"
const STEPS: { id: Phase; label: string }[] = [
  { id: "uploading", label: "Uploading" },
  { id: "reading", label: "Reading statement" },
  { id: "updating", label: "Updating dashboard" },
]

/**
 * "Whose is this?" (M34, D29): a broker file has no PAN. An existing member, or someone new named from the file.
 * Nothing is stored until the answer goes back with the file.
 */
function WhoseFile({ ask, busy, onAnswer, onCancel }: {
  ask: { kind: "HOLDINGS" | "TRADEBOOK"; broker: string; suggested: string | null }
  busy: boolean
  onAnswer: (owner: BrokerOwner) => void
  onCancel: () => void
}) {
  const [members, setMembers] = useState<MemberSummary[] | null>(null)
  const [pick, setPick] = useState<string>("")
  const [name, setName] = useState(ask.suggested ?? "")
  useEffect(() => {
    api.members().then((m) => {
      setMembers(m)
      setPick((cur) => cur || (ask.suggested || !m.length ? "new" : m[0]!.id))
    }, () => { setMembers([]); setPick("new") })
  }, [ask.suggested])
  const what = ask.kind === "HOLDINGS" ? "holdings statement" : "tradebook"
  const valid = pick && (pick !== "new" || name.trim().length > 0)
  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (valid) onAnswer(pick === "new" ? { new_member_name: name.trim() } : { member_id: pick }) }}>
      <div className="grid gap-1">
        <p className="text-sm font-medium">Whose is this {ask.broker ? `${ask.broker} ` : ""}{what}?</p>
        <p className="text-xs text-muted-foreground">Broker files don't carry a PAN, so we can't tell by ourselves.</p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="u-whose">Family member</Label>
        <select id="u-whose" value={pick} onChange={(e) => setPick(e.target.value)} disabled={!members}
          className="h-11 rounded-md border bg-transparent px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring">
          {(members ?? []).map((m) => <option key={m.id} value={m.id}>{m.name ?? m.pan_masked}</option>)}
          <option value="new">Someone new</option>
        </select>
      </div>
      {pick === "new" && (
        <div className="grid gap-2">
          <Label htmlFor="u-new-name">Their name</Label>
          <Input id="u-new-name" className="h-11" value={name} maxLength={60} autoComplete="off" onChange={(e) => setName(e.target.value)} />
          <p className="text-xs text-muted-foreground">
            {ask.suggested ? "As it's written in the file. Change it if you like." : "As you'd like it shown."} When their CDSL or CAMS
            statement comes later, we'll ask whether it's the same person.
          </p>
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <Button type="button" variant="outline" className="h-11" onClick={onCancel} disabled={busy}>Choose another file</Button>
        <Button type="submit" className="h-11" disabled={!valid || busy}>
          {busy && <Loader2Icon className="animate-spin" />}
          Add {what}
        </Button>
      </div>
    </form>
  )
}

/**
 * "Is this the same person?" (D29): members made from broker files whose names match a member with a PAN. Yes joins
 * them (the broker files move to the member with the PAN), no keeps two and stops asking. Shown after an upload and
 * on the Members page.
 */
export function SamePerson({ members, onChanged }: { members: MemberSummary[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const pairs = members.flatMap((m) => (m.same_as ?? []).map((o) => ({ withPan: m, panLess: o })))
  if (!pairs.length) return null
  async function answer(panLess: string, withPan: string, same: boolean) {
    setBusy(panLess + withPan)
    try {
      if (same) await api.mergeMember(panLess, withPan)
      else await api.keepSeparate(panLess, withPan)
      toast.success(same ? "Joined into one member" : "Kept as two members", same ? { description: "Updating your dashboard…" } : undefined)
      onChanged()
    } catch (err) {
      if (!(err instanceof SignedOut)) toast.error((err as Error).message)
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="grid gap-3">
      {pairs.map(({ withPan, panLess }) => (
        <div key={panLess.id + withPan.id} className="glass grid gap-3 rounded-xl p-4" role="group" aria-label="Is this the same person?">
          <div className="grid gap-1">
            <p className="text-sm font-medium">Is this the same person?</p>
            <p className="text-sm text-muted-foreground">
              <span className="text-foreground">{withPan.name ?? withPan.pan_masked}</span> ({withPan.pan_masked}) and{" "}
              <span className="text-foreground">{panLess.name}</span>, added from a broker file. If they are, their broker files
              join the member with the PAN.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" className="h-11" disabled={!!busy} onClick={() => answer(panLess.id, withPan.id, false)}>No, two people</Button>
            <Button className="h-11" disabled={!!busy} onClick={() => answer(panLess.id, withPan.id, true)}>
              {busy === panLess.id + withPan.id && <Loader2Icon className="animate-spin" />}
              Yes, same person
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}

/** uploading → reading statement → updating dashboard (plan §13 item 5). */
function Progress({ phase }: { phase: Phase }) {
  const at = STEPS.findIndex((s) => s.id === phase)
  return (
    <ol className="grid gap-3 text-sm" aria-live="polite">
      {STEPS.map((s, i) => (
        <li key={s.id} className={cn("flex items-center gap-3", i > at && "text-muted-foreground")}>
          <span className="grid size-5 place-items-center">
            {i < at ? <CheckIcon className="size-4 text-gain" /> : i === at ? <Loader2Icon className="size-4 animate-spin text-primary" /> : <span className="size-1.5 rounded-full bg-muted-foreground/50" />}
          </span>
          {s.label}{i === at ? "…" : ""}
        </li>
      ))}
    </ol>
  )
}

/**
 * The statement is stored: wait for the dashboard to catch up (GET /api/portfolio/status with backoff and
 * Retry-After), then report. Closing the dialog doesn't stop the build.
 */
function UpdatingDashboard({ added, onDone }: { added: Added; onDone: () => void }) {
  const done = useRef(onDone)
  const [ask, setAsk] = useState<MemberSummary[] | null>(null)
  useEffect(() => {
    done.current = onDone
  })
  useEffect(() => {
    const ctl = new AbortController()
    const finish = async () => {
      if (ctl.signal.aborted) return
      report(added)
      // A statement that made a new member: is it someone already added from a broker file (D29)?
      if (!("kind" in added) && added.member.created) {
        const list = await api.members().catch(() => [])
        const mine = list.filter((m) => m.id === added.member.id && m.same_as?.length)
        if (mine.length && !ctl.signal.aborted) return setAsk(mine)
      }
      done.current()
    }
    waitForPortfolio({ maxMs: 60_000, signal: ctl.signal }).then(finish, finish) // on a timeout or error, the banner takes over
    return () => ctl.abort()
  }, [added])
  if (ask) return <SamePerson members={ask} onChanged={() => done.current()} />
  return (
    <div className="grid gap-4">
      <Progress phase="updating" />
      <p className="text-xs text-muted-foreground">You can close this window; we'll finish it for you.</p>
    </div>
  )
}

/**
 * Only the file and an optional password (D19). Members' PANs and pending passwords are tried on the server. Every
 * check the user could fix happens before anything is queued, so a queued upload never needs them again (§10.1 A).
 */
export function UploadForm({ onDone, onQueued, kind = "mf", source: startSource = "cdsl" }: {
  onDone: () => void
  onQueued: () => void
  /** Which help to show: funds (CAMS / KFintech first) or shares (CDSL, or a broker file). The upload is the same. */
  kind?: "mf" | "listed"
  /** Shares only: the tab to open on ("Buy prices for shares" opens on the broker file). */
  source?: "cdsl" | "broker"
}) {
  const [source, setSource] = useState<"cdsl" | "broker">(startSource)
  const broker = kind === "listed" && source === "broker"
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState<Phase>("uploading")
  const [added, setAdded] = useState<Added | null>(null)
  const [whose, setWhose] = useState<{ kind: "HOLDINGS" | "TRADEBOOK"; broker: string; suggested: string | null } | null>(null)
  const [queued, setQueued] = useState<Queued["job"] | null>(null)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const passwordRef = useRef<HTMLInputElement>(null)

  const [password, setPassword] = useState("")

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    await send()
  }

  async function send(owner?: BrokerOwner) {
    if (!file) return
    const pw = showPassword ? password : ""
    setBusy(true)
    setPhase("uploading")
    setProblem(null)
    try {
      let result: Awaited<ReturnType<typeof api.addStatement>>
      for (let attempt = 0; ; attempt++) {
        try {
          result = await api.addStatement(file, pw, () => setPhase("reading"), owner)
          break
        } catch (err) {
          // A broker file isn't queued: when the engine is busy the server says when to try again (M21, M34).
          const wait = err instanceof ApiFailure && err.code === "engine_busy" ? Number(err.data.retry_after) || 10 : 0
          if (!wait || attempt >= 3) throw err
          await new Promise((r) => setTimeout(r, wait * 1000))
        }
      }
      setWhose(null)
      if ("job" in result) {
        setQueued(result.job) // 202: parked until an engine slot is free
        onQueued()
      } else {
        setAdded(result)
        onQueued() // the members list can show it already; the dashboard follows once rebuilt
      }
    } catch (err) {
      if (err instanceof SignedOut) return
      if (err instanceof ApiFailure && err.code === "needs_member") {
        // A broker file with no PAN and no member it clearly belongs to: ask (nothing was stored).
        setWhose({ kind: err.data.kind === "TRADEBOOK" ? "TRADEBOOK" : "HOLDINGS", broker: String(err.data.broker_name ?? ""),
          suggested: typeof err.data.suggested_name === "string" ? err.data.suggested_name : null })
      } else if (err instanceof ApiFailure && err.code === "file_locked") {
        setShowPassword(true)
        setProblem({ message: err.message, hint: "Groww's files open with the account holder's PAN in capital letters." })
        requestAnimationFrame(() => passwordRef.current?.focus())
      } else if (err instanceof ApiFailure && err.code === "password_required") {
        // Nothing was stored: open the password field and say what to type (plan §10.1 A5).
        const typed = err.data.typed === true
        setShowPassword(true)
        setProblem(typed
          ? { message: "That password didn't open this statement.", hint: PASSWORD_HINT }
          : { message: err.message, hint: PASSWORD_HINT })
        requestAnimationFrame(() => passwordRef.current?.focus())
      } else {
        setProblem({ message: (err as Error).message })
      }
    } finally {
      setBusy(false)
    }
  }

  if (added) return <UpdatingDashboard added={added} onDone={onDone} />
  if (whose) return <WhoseFile ask={whose} busy={busy} onAnswer={(owner) => void send(owner)} onCancel={() => { setWhose(null); setFile(null) }} />

  if (queued)
    return (
      <QueuedUpload
        initial={queued}
        onDone={(stored) => {
          setQueued(null)
          setAdded(stored)
        }}
        onFailed={(message) => {
          // The file is already deleted on the server: start again from the form.
          setQueued(null)
          setFile(null)
          setProblem({ message, hint: "Choose the statement PDF again to retry." })
          onQueued()
        }}
        onCancelled={() => {
          setQueued(null)
          setFile(null)
          onQueued()
        }}
      />
    )

  const pickSource = (v: "cdsl" | "broker") => {
    setSource(v)
    setFile(null)
    setProblem(null)
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      {kind === "listed" && (
        <Segmented kind="radio" label="What are you adding?" value={source} onChange={pickSource} className="w-full [&>button]:flex-1"
          options={[{ id: "cdsl", label: "CDSL statement" }, { id: "broker", label: "Broker file" }]} />
      )}
      <div className="grid gap-2">
        <Label htmlFor="u-file">{broker ? "Holdings statement or tradebook" : "Statement PDF"}</Label>
        <label
          htmlFor="u-file"
          className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-dashed px-4 py-4 text-sm transition-colors hover:bg-muted/60 focus-within:outline-2 focus-within:outline-ring"
        >
          <FileUpIcon className="size-5 shrink-0 text-muted-foreground" />
          <span className={file ? "min-w-0 truncate font-medium" : "text-muted-foreground"}>{file ? file.name : broker ? "Choose a CSV or Excel file" : "Choose a PDF"}</span>
          <input key={source} id="u-file" type="file" accept={broker ? BROKER_ACCEPT : "application/pdf,.pdf"} required className="sr-only"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setProblem(null) }} />
        </label>
        {kind === "mf" ? (
          <p className="text-xs text-muted-foreground">
            A{" "}
            <a className={LINK} href="https://www.camsonline.com" target="_blank" rel="noopener noreferrer">CAMS / KFintech</a>{" "}
            statement has every fund with its full history: choose “Detailed” with the earliest start date to see
            returns. A{" "}
            <a className={LINK} href="https://www.cdslindia.com/CAS/LoginCAS.aspx" target="_blank" rel="noopener noreferrer">CDSL</a>{" "}
            statement works too.
          </p>
        ) : broker ? (
          <>
            <p className="text-xs text-muted-foreground">
              Your broker's <span className="text-foreground">holdings statement</span> has each share's quantity and
              average buy price. A <span className="text-foreground">tradebook</span> adds the buy dates, for XIRR and tax.
              Read once and never kept: only the figures are saved, encrypted.
            </p>
            <Where title="Where to download a holdings statement" list={HOLDINGS_WHERE} />
            <Where title="Where to download a tradebook" list={TRADEBOOK_WHERE} />
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            A{" "}
            <a className={LINK} href="https://www.cdslindia.com/CAS/LoginCAS.aspx" target="_blank" rel="noopener noreferrer">CDSL</a>{" "}
            eCAS lists every share and ETF in your demat account, with its funds. The password is usually the PAN in
            capital letters. No CDSL statement?{" "}
            <button type="button" className={LINK} onClick={() => pickSource("broker")}>Add a broker file</button>.
          </p>
        )}
      </div>
      {showPassword ? (
        <div className="grid gap-2">
          <Label htmlFor="u-password">{broker || (file && !isPdfFile(file)) ? "File password" : "PDF password"}</Label>
          <Input id="u-password" ref={passwordRef} name="password" type="password" autoComplete="off" className="h-11"
            aria-describedby="u-password-hint" value={password} onChange={(e) => { setPassword(e.target.value); if (problem?.hint) setProblem(null) }} />
          <p id="u-password-hint" className="text-xs text-muted-foreground">
            Used once to open the file, never saved. Family members' PANs are tried automatically.
          </p>
        </div>
      ) : (
        <Button type="button" variant="ghost" className="-mx-3 h-11 justify-start px-3 text-muted-foreground" onClick={() => setShowPassword(true)}>
          <ChevronDownIcon />
          Has a password? Add it
        </Button>
      )}
      {problem && (
        <div className="grid gap-1" role="alert">
          <p className="text-sm text-loss">{problem.message}</p>
          {problem.hint && <p className="text-xs text-muted-foreground">{problem.hint}</p>}
        </div>
      )}
      {busy ? (
        <Progress phase={phase} />
      ) : (
        <Button type="submit" className="h-11" disabled={!file}>
          {broker ? "Add file" : "Add statement"}
        </Button>
      )}
    </form>
  )
}
