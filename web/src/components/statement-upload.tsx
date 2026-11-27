// The statement upload (plan §13 item 5): a CDSL or CAMS / KFintech PDF and an optional password. Shown inside the
// Add asset dialog (add-asset-dialog.tsx) for mutual funds and for stocks & ETFs.
import { CheckIcon, ChevronDownIcon, FileUpIcon, Loader2Icon } from "lucide-react"
import { type FormEvent, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { QueuedUpload } from "@/components/jobs"
import { type AddedStatement, ApiFailure, api, type QueuedUpload as Queued, SignedOut, waitForPortfolio } from "@/lib/api"
import { cn } from "@/lib/utils"

const PASSWORD_HINT =
  "For a CDSL eCAS this is usually the PAN in capital letters. For CAMS/KFintech it's the password you chose when requesting it."

/** Say whose portfolio it went to (plan §13 item 5). */
function report({ member }: AddedStatement) {
  const name = member.name ?? member.pan_masked
  toast.success("Statement added", {
    description: member.created ? `New member added: ${name} (${member.pan_masked})` : `Added to ${name}`,
  })
}

type Problem = { message: string; hint?: string }
type Phase = "uploading" | "reading" | "updating"
const STEPS: { id: Phase; label: string }[] = [
  { id: "uploading", label: "Uploading" },
  { id: "reading", label: "Reading statement" },
  { id: "updating", label: "Updating dashboard" },
]

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
function UpdatingDashboard({ added, onDone }: { added: AddedStatement; onDone: () => void }) {
  const done = useRef(onDone)
  useEffect(() => {
    done.current = onDone
  })
  useEffect(() => {
    const ctl = new AbortController()
    const finish = () => {
      if (ctl.signal.aborted) return
      report(added)
      done.current()
    }
    waitForPortfolio({ maxMs: 60_000, signal: ctl.signal }).then(finish, finish) // on a timeout or error, the banner takes over
    return () => ctl.abort()
  }, [added])
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
export function UploadForm({ onDone, onQueued, kind = "mf" }: {
  onDone: () => void
  onQueued: () => void
  /** Which help to show: funds (CAMS / KFintech first) or shares (CDSL). The upload is the same. */
  kind?: "mf" | "listed"
}) {
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState<Phase>("uploading")
  const [added, setAdded] = useState<AddedStatement | null>(null)
  const [queued, setQueued] = useState<Queued["job"] | null>(null)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const passwordRef = useRef<HTMLInputElement>(null)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!file) return
    const password = showPassword ? String(new FormData(e.currentTarget).get("password") ?? "") : ""
    setBusy(true)
    setPhase("uploading")
    setProblem(null)
    try {
      const result = await api.addStatement(file, password, () => setPhase("reading"))
      if ("job" in result) {
        setQueued(result.job) // 202: parked until an engine slot is free
        onQueued()
      } else {
        setAdded(result)
        onQueued() // the members list can show it already; the dashboard follows once rebuilt
      }
    } catch (err) {
      if (err instanceof SignedOut) return
      if (err instanceof ApiFailure && err.code === "password_required") {
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

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="u-file">Statement PDF</Label>
        <label
          htmlFor="u-file"
          className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-dashed px-4 py-4 text-sm transition-colors hover:bg-muted/60 focus-within:outline-2 focus-within:outline-ring"
        >
          <FileUpIcon className="size-5 shrink-0 text-muted-foreground" />
          <span className={file ? "min-w-0 truncate font-medium" : "text-muted-foreground"}>{file ? file.name : "Choose a PDF"}</span>
          <input id="u-file" type="file" accept="application/pdf" required className="sr-only"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setProblem(null) }} />
        </label>
        {kind === "mf" ? (
          <p className="text-xs text-muted-foreground">
            A{" "}
            <a className="-my-2 py-2 text-primary underline-offset-4 hover:underline" href="https://www.camsonline.com" target="_blank" rel="noopener noreferrer">
            CAMS / KFintech
          </a>{" "}
            statement has every fund with its full history: choose “Detailed” with the earliest start date to see
            returns. A{" "}
            <a className="-my-2 py-2 text-primary underline-offset-4 hover:underline" href="https://www.cdslindia.com/CAS/LoginCAS.aspx" target="_blank" rel="noopener noreferrer">
            CDSL
          </a>{" "}
            statement works too.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            A{" "}
            <a className="-my-2 py-2 text-primary underline-offset-4 hover:underline" href="https://www.cdslindia.com/CAS/LoginCAS.aspx" target="_blank" rel="noopener noreferrer">
            CDSL
          </a>{" "}
            eCAS lists every share and ETF in your demat account, with its funds. The password is usually the PAN in
            capital letters.
          </p>
        )}
      </div>
      {showPassword ? (
        <div className="grid gap-2">
          <Label htmlFor="u-password">PDF password</Label>
          <Input id="u-password" ref={passwordRef} name="password" type="password" autoComplete="off" className="h-11"
            aria-describedby="u-password-hint" onChange={() => { if (problem?.hint) setProblem(null) }} />
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
          Add statement
        </Button>
      )}
    </form>
  )
}
